// ugoku-zukai プレーヤー: 台本 → 時刻つきの動作の列 → 時刻 t のコマ（純粋に t だけで決まる）
(function (UZ) {
  "use strict";
  const { clamp, mix, smooth, ease } = UZ;

  UZ.FORMATS = ["ugoku-zukai/2", "ugoku-zukai/3", "ugoku-zukai/4", "ugoku-zukai/5", "ugoku-zukai/6"];   // /2 = 場面が図を指す形だけ。/3 = スライドも使える。/4 = morph・zoom・pan・draw も使える。/5 = values・set も使える。/6 = 立体と奥行きも使える
  UZ.FORMAT = "ugoku-zukai/6";
  UZ.VERBS = ["show", "hide", "focus", "unfocus", "blur", "unblur", "pulse", "mark", "unmark", "trace", "reply", "note", "badge", "relabel", "tint", "move", "resize", "zoom", "pan", "set", "custom"];
  const MARK_RE = /\{([A-Za-z0-9_]+)\}/g;

  // ---- 字幕の文と印 ----
  UZ.parseText = function (text) {
    const marks = {}, clean = [];
    let last = 0, m;
    MARK_RE.lastIndex = 0;
    while ((m = MARK_RE.exec(text))) {
      clean.push(text.slice(last, m.index));
      marks[m[1]] = clean.join("").length;   // 印の位置（印を除いた文での文字の位置）
      last = m.index + m[0].length;
    }
    clean.push(text.slice(last));
    return { text: clean.join(""), marks };
  };

  // ---- 音声がないときの時刻表（文字数からの見積もり）----
  // VOICEVOX の実測（ずんだもん・話速 1.1）で 1 文字およそ 0.17 秒。句読点で間を足す。
  function units(s) {
    let u = 0;
    for (const c of s) {
      if (c === "、" || c === ",") u += 1.8;
      else if (c === "。" || c === "！" || c === "？") u += 2.6;
      else if (/[A-Za-z]/.test(c)) u += 0.55;
      else if (/[0-9]/.test(c)) u += 0.9;
      else if (/[「」『』（）()・\s]/.test(c)) u += 0.2;
      else u += 1;
    }
    return u;
  }
  // 話者ごとの速さの係数（ずんだもんを 1 とした実測。春日部つむぎは 9 本の見本で 0.78）
  const PACE = { 1: 1, 3: 1, 5: 1, 7: 1, 8: 0.78 };
  UZ.DEFAULT_SPEAKER = 8;
  UZ.SPEAKER_NAMES = { 0: "四国めたん", 2: "四国めたん", 4: "四国めたん", 6: "四国めたん", 1: "ずんだもん", 3: "ずんだもん", 5: "ずんだもん", 7: "ずんだもん", 8: "春日部つむぎ", 10: "雨晴はう" };
  UZ.estimateTimeline = function (sb) {
    const speed = (sb.voice && sb.voice.speed) || 1.1;
    const sp = (sb.voice && sb.voice.speaker) ?? UZ.DEFAULT_SPEAKER;
    const per = 0.168 * 1.1 / speed * (PACE[sp] ?? 0.85);
    const lines = [];
    let t = 0.8;
    sb.scenes.forEach((sc, si) => {
      if (si > 0) t += 0.7;
      for (const ln of sc.lines) {
        const p = UZ.parseText(ln.read || ln.text);
        const dur = units(p.text) * per + 0.2;
        const marks = {};
        for (const k in p.marks) marks[k] = +(units(p.text.slice(0, p.marks[k])) * per).toFixed(3);
        lines.push({ id: ln.id, scene: sc.id, start: +t.toFixed(3), dur: +dur.toFixed(3), marks });
        t += dur + 0.45;
      }
    });
    return { source: "estimate", lines };
  };

  // ---- 動作の既定の長さ ----
  const LABEL_HOLD = 1.0;   // 点の札を見せておく秒数（この間、点は動かない）
  const DUR = { show: 0.7, hide: 0.5, focus: 0.6, unfocus: 0.6, blur: 0.6, unblur: 0.6, pulse: 0.8, mark: 0.5, unmark: 0.4, trace: 2.0, reply: 0.8, note: 0.6, badge: 0.5, relabel: 0.6, tint: 0.6, move: 1.0, resize: 0.9, zoom: 1.0, pan: 0.9, set: 1.0, custom: 2.0 };
  const STAGGER = 0.22;
  // カメラ（zoom・pan）: 倍率の上限と、寄せたときの既定の余白（画面の px）
  // 上限は 2.0。箱 1 つに寄せたとき、2.5 では文字が 40px を超えて隣の箱が画面から外れ、どこを見ているかが分からなくなった（M7 の見本で確認）
  UZ.CAMERA = { maxZoom: 2.0, pad: 40 };
  const CAM0 = { s: 1, tx: 0, ty: 0 };
  // カメラ cam（画面座標 p → p * s + t）を、図の写し方 pl に重ねる
  // 写し方 pl にカメラを合成する。custom の部品の描き場の大きさ（w・h。カメラの前の画面の px）は、そのまま持っていく
  const camOn = (cam, pl) => ({ ...pl, s: cam.s * pl.s, ox: cam.s * pl.ox + cam.tx, oy: cam.s * pl.oy + cam.ty });
  // 写し方の補間（場面が変わって区画が動く間）。custom の部品は、描き場の大きさも補間する
  const mixPlace = (a, b, q) => {
    const o = { s: mix(a.s, b.s, q), ox: mix(a.ox, b.ox, q), oy: mix(a.oy, b.oy, q) };
    if (a.w != null && b.w != null) { o.w = mix(a.w, b.w, q); o.h = mix(a.h, b.h, q); }
    return o;
  };
  // 図の、写し方 pl での外枠（図のローカル座標）。custom の部品は描き場の大きさ（場面ごとに変わる）
  const figBox = (F, pl) => (pl && pl.w != null ? { x: 0, y: 0, w: pl.w, h: pl.h } : { x: F.x0, y: F.y0, w: F.x1 - F.x0, h: F.y1 - F.y0 });
  // 補間は、見えている範囲（画面の点 p に写る図の点 (p - t) / s）が直線的に動くように、1/s と t/s を混ぜる（範囲は body の中に収まったまま）
  const camMix = (a, b, q) => {
    const u = mix(1 / a.s, 1 / b.s, q), vx = mix(a.tx / a.s, b.tx / b.s, q), vy = mix(a.ty / a.s, b.ty / b.s, q);
    return q >= 1 ? { ...b } : { s: 1 / u, tx: vx / u, ty: vy / u };
  };
  const camAt = (a, t) => (t >= a.end ? a.to : camMix(a.from, a.to, ease((t - a.start) / Math.max(0.001, a.dur))));

  const verbOf = a => UZ.VERBS.find(v => Object.prototype.hasOwnProperty.call(a, v));
  const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // ================= 組み立て =================
  UZ.build = async function (sb, theme, timeline, opts = {}) {
    const S = UZ.styleOf(theme), S0 = S;
    const errors = [], warnings = [];
    const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
    const v = UZ.validate(sb);
    errors.push(...v.errors); warnings.push(...v.warnings);
    if (errors.length) return { errors, warnings };
    timeline = timeline || UZ.estimateTimeline(sb);
    const TL = Object.fromEntries(timeline.lines.map(l => [l.id, l]));
    // 時刻表と台本の行が食い違っていたら、先へ進まない（合成した後に行を足した・消した。そのまま描くと、ない行を引いて止まる）
    const lineIds = new Set();
    for (const sc of sb.scenes) for (const ln of sc.lines) lineIds.add(ln.id);
    for (const id of lineIds) if (!TL[id]) err(`行 ${id}: 時刻表にない（台本を直したら tts.py をもう一度実行する）`);
    for (const l of timeline.lines) if (!lineIds.has(l.id)) err(`行 ${l.id}: 時刻表にあるが台本にない（合成した後に行を消した）。tts.py をもう一度実行する`);
    if (errors.length) return { errors, warnings };

    // ---- 場面ごとの配置区画 ----
    const FIGS = UZ.figuresOf(sb);   // figures と、スライドの中で宣言した部品
    const slides = {};
    const scenes = sb.scenes.map(sc => {
      const P = UZ.sceneParts(sb, sc);   // スライドを指す場面は、部品 = 図、区画 = 区画の矩形
      const figs = P.figs, header = P.header, areas = P.areas;
      if (P.slide) {
        areas.forEach((r, i) => { if (r.w < 40 || r.h < 40) err(`スライド「${P.slide}」: 部品「${figs[i]}」の区画が小さすぎる（フレームの中に置くなら、フレームの行か列を増やす）`); });
        const sl = slides[P.slide] || (slides[P.slide] = { id: P.slide, figs, transient: P.parts.filter(p => p.transient).map(p => p.id), complete: sb.slides[P.slide].start === "complete", scenes: [] });
        sl.scenes.push(sc.id);
      }
      const captions = [];
      figs.forEach((fid, i) => {
        const f = FIGS[fid];
        // スライドでは、図の題を図の上に出さない（見出しとテキストの部品がその役をする）
        if (!P.slide && f.title && f.title !== header && f.type !== "title") {
          captions.push({ fig: fid, text: f.title, x: areas[i].x + areas[i].w / 2, y: areas[i].y + 12 });
          areas[i] = { ...areas[i], y: areas[i].y + 36, h: areas[i].h - 36 };
        }
      });
      // 場面の地: 題の札か目次だけの場面は、テーマに chapter があれば暗い地（章扉）。それ以外は通常の地
      const tones = figs.map(fid => UZ.titleTone(FIGS[fid], theme));
      if (figs.length > 1 && tones.includes("dark") && !(P.slide && sb.slides[P.slide].tone === "dark")) err(`場面 ${sc.id}: 題の札や目次を他の図と並べるときは、その図に tone: "light" と書く（暗い地は題の札か目次だけの場面で使う）`);
      // スライドの地: tone: "dark" なら、テーマに chapter があれば暗い地（部品も暗い地の色で組む）
      const slideDark = P.slide && sb.slides[P.slide].tone === "dark" && theme.chapter;
      // カメラをかける領域（スライドなら見出しと言いたいことの下、図だけの場面なら body 全体）
      const body = P.slide ? UZ.slideBody(P.statement.length) : { ...UZ.AREA.body };
      return { id: sc.id, chapter: sc.chapter, figs, header, areas, captions, lines: sc.lines, tone: slideDark ? "dark" : figs.length === 1 ? tones[0] : "light", slideDark: !!slideDark, slide: P.slide, statement: P.statement, body };
    });
    // カメラの run: 同じスライドが続く場面の通し番号（図だけの場面は 1 場面で 1 run）。run が変わるとカメラは戻る
    scenes.forEach((sc, si) => { const pv = scenes[si - 1]; sc.run = pv && sc.slide != null && pv.slide === sc.slide ? pv.run : (pv ? pv.run + 1 : 0); });

    // ---- Morph: morph を書いた部品を最初に使う場面の直前の場面が、v1 を置いたスライドでなければ誤り ----
    // （morph が後のスライドを指す逆向きの鎖や、a ↔ b の輪も、ここで止まる）
    const morphs = [];   // { si: 場面の添字, from: v1, to: v2 }
    scenes.forEach((sc, si) => {
      if (sc.slide == null || slides[sc.slide].scenes[0] !== sc.id) return;
      sb.slides[sc.slide].parts.forEach((p, i) => {
        if (!p || typeof p.morph !== "string") return;
        const prev = scenes[si - 1];
        if (!prev || prev.slide == null || !prev.figs.includes(p.morph)) { err(`スライド「${sc.slide}」: morph「${p.morph}」は直前のシーンのスライドにない（「${p.morph}」を置いたスライドの、すぐ次の場面で使う）`); return; }
        morphs.push({ si, from: p.morph, to: sc.figs[i] });
      });
    });

    if (errors.length) return { errors, warnings };
    // 画像は、道具が先に読み込んで渡す（opts.assets。node は assets.cjs、組み立ては uz_assets.py）
    const assets = opts.assets || {};
    for (const [fid, f] of Object.entries(FIGS)) if (f.type === "image" && !assets[f.src]) err(`図「${fid}」: 画像「${f.src}」が読み込まれていない`);
    if (errors.length) return { errors, warnings };
    const credits = [];
    for (const f of Object.values(FIGS)) if (f.type === "image" && typeof f.credit === "string" && f.credit && !credits.includes(f.credit)) credits.push(f.credit);

    // ---- Morph の系列: morph でつながる graph（v1 → v2 → …）。場面の順に集め、1 枚のキャンバスに組む ----
    const nextOf = {}, prevOf = {};
    for (const sc of scenes) {
      if (sc.slide == null) continue;
      sb.slides[sc.slide].parts.forEach((p, i) => {
        const fid = sc.figs[i], mv = p && p.morph;
        if (typeof mv !== "string" || FIGS[fid].type !== "graph" || !FIGS[mv] || FIGS[mv].type !== "graph") return;
        if ((nextOf[mv] && nextOf[mv] !== fid) || (prevOf[fid] && prevOf[fid] !== mv)) {
          err(`スライド「${sc.slide}」: morph の系列が分かれている（「${mv}」→「${nextOf[mv] || fid}」と「${prevOf[fid] || mv}」→「${fid}」。graph の morph は 1 本の列にする）`);
          return;
        }
        nextOf[mv] = fid; prevOf[fid] = mv;
      });
    }
    if (errors.length) return { errors, warnings };
    const series = [], seriesOf = {};
    for (const head of Object.keys(nextOf)) {
      if (prevOf[head]) continue;
      const list = [head];
      while (nextOf[list[list.length - 1]] && !list.includes(nextOf[list[list.length - 1]])) list.push(nextOf[list[list.length - 1]]);
      const sr = { figs: list };
      series.push(sr);
      for (const fid of list) seriesOf[fid] = sr;
    }
    const canvases = new Map();
    for (const sr of series) {
      const last = FIGS[sr.figs[sr.figs.length - 1]];
      canvases.set(sr, await UZ.graphCanvas(sr.figs.map(fid => FIGS[fid]), S0, (last.direction || "right").toLowerCase()));
    }

    // ---- 図の配置（最初に出る場面の区画で 1 回だけ。色も、その場面の地で決まる）----
    const figs = {};
    const SD = UZ.darkStyleOf(S);
    for (const sc of scenes) {
      for (let i = 0; i < sc.figs.length; i++) {
        const fid = sc.figs[i];
        if (figs[fid]) continue;
        const f = FIGS[fid];
        const S = sc.slideDark ? SD : S0;
        const A = sc.areas[i];
        let L = null;
        // スライドの部品は、区画に合わせて組む（図が fill に対応していれば。fit: "content" で止める）。
        // 文字の倍率 k の候補（FILL_K）のうち、区画に収まり、折り返しの総数（図が返す lineCount）が k = 1 のときより増えない、一番大きい k を採る。
        // k = 1 でも収まらなければ、今までどおり組んで縮める
        if (sc.slide && UZ.FIG[f.type].fill && f.fit !== "content") {
          const fits = [];
          for (const k of UZ.FILL_K) {
            const T = await UZ.FIG[f.type].layout(f, S, { area: A, fill: { w: A.w, h: A.h, k }, assets });
            if (T.w <= A.w + 0.5 && T.h <= A.h + 0.5) fits.push({ k, T });
          }
          const base = fits.find(x => x.k === 1);
          const pick = fits.find(x => !base || x.T.lineCount == null || x.T.lineCount <= base.T.lineCount);
          if (pick) L = { ...pick.T, maxScale: 1, fillK: pick.k };
        }
        if (!L) L = await UZ.FIG[f.type].layout(f, S, { area: A, tryBoth: !f.direction, assets, canvas: seriesOf[fid] ? canvases.get(seriesOf[fid]) : undefined });
        if (L.morphWarn && L.morphWarn.length) warn(`スライド「${sc.slide}」: 部品「${fid}」: Morph の系列で矢印が箱に重なる（${L.morphWarn.join("、")}）。系列の図のノードか辺を見直す`);
        const items = {};
        for (const it of L.items) { it.fig = fid; it.key = `${fid}/${it.id}`; items[it.id] = it; }
        figs[fid] = { id: fid, type: f.type, spec: f, w: L.w, h: L.h, items, order: L.order, autoShow: !!L.autoShow, fixed: !!L.fixed, extra: L, dark: !!sc.slideDark };
      }
    }
    // ---- id の解決 ----
    function resolve(sc, ref, ctxv) {
      let fid = null, id = ref;
      if (typeof ref !== "string") { err(`${ctxv}: 対象は文字列で書く（${JSON.stringify(ref)}）`); return null; }
      if (ref.includes("/")) [fid, id] = ref.split("/");
      if (!fid && sc.figs.includes(id) && figs[id]) return { fig: id, whole: true };   // 図（部品）の全体。この場面にある図だけ
      const cands = (fid ? [fid] : sc.figs).filter(f => figs[f] && figs[f].items[id]);
      if (!cands.length) {
        if (fid && figs[fid] && id === "dot") return { fig: fid, id };
        err(`${ctxv}: 「${ref}」がこの場面の図（${sc.figs.join(", ")}）に見つからない`); return null;
      }
      if (cands.length > 1) { err(`${ctxv}: 「${ref}」が複数の図にある。「図/id」で書く（${cands.join(", ")}）`); return null; }
      return { fig: cands[0], id };
    }
    // 点（dot:<名前>）と注記（note:<id>）は、trace と note が出した後でだけ指せる。
    // 返すもの: 部品のキー / null = 誤り（知らせた）/ undefined = 点でも注記でもない
    function extraKey(sc, ref, ctxv) {
      if (typeof ref !== "string") return undefined;
      const [fid, id] = ref.includes("/") ? ref.split("/") : [null, ref];
      if (!/^(dot|note):/.test(id)) return undefined;
      const pool = id.startsWith("dot:") ? extras.dots : extras.notes;
      const hit = (fid ? [fid] : sc.figs).map(f => `${f}/${id}`).filter(k => pool[k]);
      if (hit.length === 1) return hit[0];
      if (hit.length > 1) err(`${ctxv}: 「${ref}」が複数の図にある。「図/${id}」で書く`);
      else err(`${ctxv}: 「${ref}」はまだ出ていない（${id.startsWith("dot:") ? "trace" : "note"} で出した後に消す）`);
      return null;
    }
    // 表示・強調の対象を部品の列に広げる（図ごと・行・カード・枠 → 中身も）
    function expand(r) {
      const F = figs[r.fig];
      const inOrder = new Set(F.order);
      const one = (id, whole) => {
        const it = F.items[id], out = [];
        if (it.kind !== "group") out.push(it.key);
        // 図ごと出すときは、順番の列に載っている中身（枠の中のノードなど）はその順番で出す
        for (const m of it.members || []) if (F.items[m] && !(whole && inOrder.has(m))) out.push(F.items[m].key);
        return out;
      };
      if (r.whole) return [...new Set(F.order.flatMap(id => one(id, true)))];
      return one(r.id);
    }

    // ---- 動作の列 ----
    const acts = [], extras = { marks: {}, notes: {}, dots: {}, replies: [], customs: [] };
    const values0 = { ...(sb.values || {}) };   // 名前付きの値の初め（set で動かす）
    const itemByKey = {};
    for (const F of Object.values(figs)) for (const it of Object.values(F.items)) itemByKey[it.key] = it;
    const dotState = {};   // 点の今の位置（台本を読みながら追う）
    const sizeState = {};  // 大きさを変えた箱の今の形（resize を重ねたとき、前の形から続ける）

    for (const sc of scenes) {
      const si = scenes.indexOf(sc), morphHere = morphs.some(m => m.si === si);
      const first = TL[sc.lines[0].id];
      sc.start = Math.max(0, first.start - 0.35);
      // 最初から完成形で出すスライド（start: "complete"）: 最初に使う場面の頭で、完成形に含める部品をすべて出す
      const sl = sc.slide && slides[sc.slide];
      if (sl && sl.complete && sl.scenes[0] === sc.id) {
        const keys = sl.figs.filter(fid => !sl.transient.includes(fid) && !figs[fid].autoShow).flatMap(fid => expand({ fig: fid, whole: true }));
        if (keys.length) acts.push({ verb: "show", keys, start: sc.start + 0.25, dur: 0.5, each: 0.5, stagger: 0.04, end: sc.start + 0.75 + 0.04 * keys.length });
      }
      // 場面の頭で自動で出す図（題の札・目次）。項目の多い図は間隔を詰める（図が autoStagger で決める）
      for (const fid of sc.figs) if (figs[fid].autoShow) {
        const st = figs[fid].extra.autoStagger ?? 0.35;
        acts.push({ verb: "show", keys: figs[fid].order.map(id => figs[fid].items[id].key), start: sc.start + 0.25, dur: 0.8, each: 0.8, stagger: st, end: sc.start + 1.2 + st * figs[fid].order.length });
      }
      for (const ln of sc.lines) {
        const tl = TL[ln.id];
        if (tl.text != null && tl.text !== UZ.parseText(ln.read || ln.text).text) { err(`行 ${ln.id}: 音声が古い（合成した後に文が変わった）。tts.py をもう一度実行する`); continue; }
        let cursor = tl.start + 0.05;
        (ln.do || []).forEach((a, ai) => {
          const verb = verbOf(a), where = `行 ${ln.id} の do[${ai}]（${verb}）`;
          let start = cursor;
          if (a.at != null) {
            if (tl.marks[a.at] == null) { err(`${where}: 印 {${a.at}} が字幕の文にない`); return; }
            start = tl.start + tl.marks[a.at];
          }
          start += a.after || 0;
          const act = { verb, start, line: ln.id, scene: sc.id, a };
          let dur = a.dur ?? DUR[verb];
          const val = a[verb];
          if (verb === "show" || verb === "hide" || verb === "pulse" || verb === "focus" || verb === "blur") {
            const keys = [];
            let wholeRef = false;   // 図（部品）の全体を指したか
            for (const ref of asList(val)) {
              const x = extraKey(sc, ref, where);   // 点（dot:<名前>）と注記（note:<id>）
              if (x !== undefined) {
                if (x && verb !== "hide") err(`${where}: 点と注記（${ref}）に使えるのは hide だけ`);
                else if (x) { keys.push(x); delete dotState[x]; }   // 消した点は、次の trace で 1 つ目のノードにもう一度現れる
                continue;
              }
              const r = resolve(sc, ref, where); if (r) { keys.push(...expand(r)); if (r.whole) wholeRef = true; }
            }
            act.keys = keys;
            if (verb === "show" || verb === "hide") {
              act.stagger = a.stagger ?? (keys.length > 1 ? STAGGER : 0);
              act.each = a.dur ?? (verb === "show" && a.draw ? 1.4 : DUR[verb]);   // draw は線が伸びる分だけ、既定でゆっくり出す
              if (verb === "show" && a.draw) {
                act.draw = true;
                const lined = keys.some(k => { const [f, ...r] = k.split("/"); const it = figs[f] && figs[f].items[r.join("/")]; return it && (it.kind === "box" || it.kind === "edge" || it.kind === "frame"); });
                if (keys.length && !lined) warn(`${where}: draw は線のない要素には効かない（枠・辺・グループの枠に使う）`);
              }
              dur = act.each + act.stagger * Math.max(0, keys.length - 1);
            }
            // focus は同じ図の中を薄くする。部品の全体を指したときは、同じ場面のほかの部品を薄くする（指した部品は薄くしない）
            if (verb === "focus") act.figsOf = wholeRef ? sc.figs.slice() : [...new Set(keys.map(k => k.split("/")[0]))];
            if (verb === "blur") act.figsOf = sc.figs;   // ぼかしは、対象のない図も含めて場面の全部の図に及ぶ
          } else if (verb === "unblur") {
            act.figsOf = val === true || val == null ? sc.figs : asList(val);
          } else if (verb === "unfocus") {
            act.figsOf = val === true || val == null ? sc.figs : asList(val);
          } else if (verb === "mark" || verb === "unmark") {
            const r = resolve(sc, val, where);
            if (!r || r.whole) { if (r) err(`${where}: 図全体には印を付けられない`); return; }
            const key = `${r.fig}/mark:${r.id}`;
            if (!extras.marks[key]) extras.marks[key] = { key, fig: r.fig, target: r.id, kind: "mark" };
            act.key = key; act.kind = a.as || "check";
            if (!["check", "cross", "question"].includes(act.kind)) err(`${where}: as は check / cross / question`);
          } else if (verb === "note") {
            const r = resolve(sc, val, where);
            if (!r) return;
            const nid = a.id || `${r.id}`;
            const key = `${r.fig}/note:${nid}`;
            extras.notes[key] = { key, fig: r.fig, target: r.whole ? null : r.id, text: a.text || "", link: !!a.link };
            act.key = key;
          } else if (verb === "trace") {
            const path = asList(val);
            const fid = (a.fig) || sc.figs.find(f => path.every(p => figs[f].items[p] && figs[f].items[p].dotAt));
            if (!fid) { err(`${where}: 経路 ${path.join("→")} のノードが 1 つの図にそろっていない（点が通れるのは箱と矢印・スイムレーン・ツリー・サイクルなどの箱）`); return; }
            const F = figs[fid], did = a.dot || "dot", key = `${fid}/dot:${did}`;
            if (!extras.dots[key]) extras.dots[key] = { key, fig: fid, id: did };
            let cur = dotState[key];
            if (cur && cur.node !== path[0]) {
              err(`${where}: 点「${did}」はいま ${cur.node} にいる。経路は ${cur.node} から書く`); return;
            }
            // 点は辺の上だけに出る（辺の始まりから終わりまで。角は丸める）。箱にいる間は、点の代わりに箱を強調する
            const legs = [];
            let ok = true;
            for (let i = 1; i < path.length; i++) {
              const e = F.items[`${path[i - 1]}>${path[i]}`];
              if (!e) { err(`${where}: 辺 ${path[i - 1]}>${path[i]} が宣言されていない（点は宣言した辺の上だけを通る）`); ok = false; break; }
              const lp = roundCorners(dedupe(e.pts), 30);
              legs.push({ poly: UZ.withLengths(lp), from: F.items[path[i - 1]].key, to: F.items[path[i]].key });
            }
            if (!ok) return;
            act.key = key; act.legs = legs; act.appear = !cur;
            act.node = F.items[path[0]].key; act.at = F.items[path[0]].dotAt; act.endAt = F.items[path[path.length - 1]].dotAt; act.color = S.warn;
            act.label = a.label; act.fig = fid;
            // 札は、点が何を表すかを最初に 1 回だけ見せる（同じ言葉の札は、その後の trace では出さない）。
            // 札を見せる間（LABEL_HOLD 秒）は、点は動かずに箱を強調し、札が消えてから動き出す
            act.labelNew = a.label != null && a.label !== (cur ? cur.label : undefined);
            act.hold = act.labelNew ? LABEL_HOLD : act.appear ? 0.35 : 0;
            dur = a.dur ?? Math.max(0.6, DUR.trace * legs.length + (act.labelNew ? LABEL_HOLD : 0));
            dotState[key] = { node: path[path.length - 1], last: path, label: a.label != null ? a.label : (cur ? cur.label : undefined) };
          } else if (verb === "reply") {
            const path = asList(val);
            const fid = a.fig || sc.figs.find(f => path.every(p => figs[f].items[p] && figs[f].items[p].dotAt));
            if (!fid) { err(`${where}: 経路 ${path.join("→")} のノードが 1 つの図にそろっていない`); return; }
            const F = figs[fid];
            let pts = [], ok = true;
            for (let i = 1; i < path.length; i++) {
              const e = F.items[`${path[i]}>${path[i - 1]}`];
              if (!e) { err(`${where}: 戻りの経路 ${path[i - 1]}→${path[i]} には辺 ${path[i]}>${path[i - 1]} が要る`); ok = false; break; }
              const rev = e.pts.slice().reverse();
              pts = pts.length ? pts.concat(rev.slice(1)) : rev;
            }
            if (!ok) return;
            const n = extras.replies.length;
            const key = `${fid}/reply:${a.id || n}`;
            const colr = a.as ? S.role(a.as) : S.accent;
            const off = pickOffset(F, pts, path);
            const poly = UZ.trimPoly(UZ.offsetPoly(dedupe(pts), off), 4, 8);
            const label = a.label ? placeReplyLabel(F, poly, off, a.label, colr) : null;
            extras.replies.push({ key, fig: fid, kind: "edge", pts: poly, stroke: colr, width: S.edgeW + 0.6, head: true, label, id: `reply:${a.id || n}`, isReply: true });
            act.key = key;
            dur = a.dur ?? (DUR.reply * (path.length - 1) + 0.4);
          } else if (verb === "badge") {
            act.text = String(val ?? "");
          } else if (verb === "relabel" || verb === "tint") {
            act.keys = [];
            for (const ref of asList(val)) { const r = resolve(sc, ref, where); if (r && !r.whole) act.keys.push(`${r.fig}/${r.id}`); }
            act.text = a.text;
            // as: "off" は、2×2 の象限を「該当しない」のグレーにする
            act.off = verb === "tint" && a.as === "off";
            if (act.off && act.keys.some(k => !itemByKey[k] || !itemByKey[k].quad)) { err(`${where}: as: "off" は 2×2（matrix）の象限だけに使える`); return; }
            act.color = act.off ? S.muted : a.as ? S.role(a.as) : S.accent;
            if (verb === "relabel" && a.text == null) err(`${where}: text が要る`);
          } else if (verb === "move") {
            const r = resolve(sc, val, where);
            if (!r || r.whole) return;
            const it = figs[r.fig].items[r.id];
            const c0 = center(it.bbox);
            let to = a.to;
            if (to && !Array.isArray(to) && typeof to === "object") {
              if (!figs[r.fig].extra.coord) { err(`${where}: to の {x, y} は 2×2 の図（matrix）だけで使える`); return; }
              to = figs[r.fig].extra.coord(to.x, to.y);
            }
            if (typeof to === "string") { const r2 = resolve(sc, to, where); if (!r2) return; to = center(figs[r2.fig].items[r2.id].bbox); }
            if (a.by) to = [c0[0] + a.by[0], c0[1] + a.by[1]];
            if (!to) { err(`${where}: to（座標か id）か by が要る`); return; }
            act.key = it.key; act.delta = [to[0] - c0[0], to[1] - c0[1]];
          } else if (verb === "resize") {
            const r = resolve(sc, val, where);
            if (!r) return;
            const it = r.whole ? null : figs[r.fig].items[r.id];
            if (!it || it.kind !== "box" || ["diamond", "poly", "store"].includes(it.shape) || it.header || it.life) { err(`${where}: 大きさを変えられるのは、四角と楕円の箱だけ（「${val}」は違う）`); return; }
            const to = a.to && typeof a.to === "object" && !Array.isArray(a.to) ? a.to : null;
            const sc2 = a.scale == null ? null : Array.isArray(a.scale) ? a.scale : [a.scale, a.scale];
            if ((!to || (to.w == null && to.h == null)) && !sc2) { err(`${where}: to（{ w, h } のどちらかか両方）か scale（倍率）が要る`); return; }
            const nums = [...(to ? [to.w, to.h].filter(v => v != null) : []), ...(sc2 || [])];
            if (nums.some(v => typeof v !== "number" || !(v > 0)) || (sc2 && sc2.length !== 2)) { err(`${where}: 大きさと倍率は正の数で書く`); return; }
            const AN = { center: [0.5, 0.5], left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1], "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1] };
            const an = AN[a.anchor || "center"];
            if (!an) { err(`${where}: anchor は ${Object.keys(AN).join(" / ")} のどれか`); return; }
            if (a.text != null && !["center", "top"].includes(a.text)) { err(`${where}: text は center（箱の中心に付いていく）か top（箱の上に寄せる）`); return; }
            const cur = sizeState[it.key] || { rect: { x: it.x, y: it.y, w: it.w, h: it.h }, textOff: [0, 0] };
            const w = to && to.w != null ? to.w : cur.rect.w * (sc2 ? sc2[0] : 1), h = to && to.h != null ? to.h : cur.rect.h * (sc2 ? sc2[1] : 1);
            const rect = { x: cur.rect.x + (cur.rect.w - w) * an[0], y: cur.rect.y + (cur.rect.h - h) * an[1], w, h };
            // 文字は箱の中心に付いていく。text: "top" なら、新しい箱の上に寄せる（中に別の箱を入れるとき）
            const textOff = [rect.x + rect.w / 2 - (it.x + it.w / 2), rect.y + rect.h / 2 - (it.y + it.h / 2)];
            if (a.text === "top" && it.texts && it.texts.length) textOff[1] = rect.y + 14 - Math.min(...it.texts.map(t => t.bbox.y));
            act.key = it.key; act.from = cur.rect; act.to = rect; act.textFrom = cur.textOff; act.textTo = textOff;
            sizeState[it.key] = { rect, textOff };
          } else if (verb === "zoom" || verb === "pan") {
            // 寄せる先は、place が決まってから画面座標にする（下の「カメラ」）。ここでは対象だけを決める
            if (verb === "zoom" && val === "all") act.target = null;
            else {
              // zoom は id の配列も書ける（数個の要素をまとめて写す）。pan は 1 つ
              const rs = [];
              for (const v of Array.isArray(val) ? val : [val]) {
                const r = resolve(sc, v, where);
                if (!r) return;
                if (!r.whole && !figs[r.fig].items[r.id].bbox) { err(`${where}: 「${v}」には大きさがない（寄せる先にできない）`); return; }
                rs.push(r);
              }
              act.target = rs; act.keys = rs.flatMap(expand);
            }
            // Morph のある場面では、Morph が終わってから動かす
            if (morphHere) { start = Math.max(start, sc.start + 0.8); act.start = start; }
            act.run = sc.run;
          } else if (verb === "set") {
            // 名前付きの値を to へ動かす。始まりの値は、下の「値」で前の set から決める
            if (!Object.prototype.hasOwnProperty.call(values0, val)) { err(`${where}: set の「${val}」が values にない`); return; }
            act.name = val; act.to = a.to; act.ease = a.ease === "linear" ? "linear" : "smooth";
          } else if (verb === "custom") {
            const src = sb.custom && sb.custom[val];
            if (!src) { err(`${where}: custom「${val}」が台本の custom にない`); return; }
            const key = `custom:${extras.customs.length}`;
            extras.customs.push({ key, name: val, src, fig: a.fig || sc.figs[0] });
            act.key = key;
          }
          act.dur = dur; act.end = start + dur; act.line = ln.id;
          acts.push(act);
          cursor = act.end;
          if (act.end > tl.start + tl.dur + 1.2) warn(`${where}: 動きが行の終わりより ${(act.end - tl.start - tl.dur).toFixed(1)} 秒はみ出す（次の行の声に重なる）`);
        });
      }
    }
    // ---- 印・注記・点・戻りの矢印を部品として足す ----
    for (const m of Object.values(extras.marks)) {
      const F = figs[m.fig], t = F.items[m.target];
      const pos = markPos(F, t);
      Object.assign(m, { id: `mark:${m.target}`, x: pos[0], y: pos[1], size: 26, bbox: { x: pos[0] - 15, y: pos[1] - 15, w: 30, h: 30 } });
      F.items[m.id] = m;
    }
    for (const n of Object.values(extras.notes)) {
      const F = figs[n.fig];
      const placed = placeNote(F, n, S);
      Object.assign(n, placed, { id: n.key.split("/")[1], kind: "note" });
      F.items[n.id] = n;
    }
    for (const d of Object.values(extras.dots)) {
      const F = figs[d.fig];
      Object.assign(d, { kind: "dot", id: `dot:${d.id}`, r: 9, color: S.warn, bbox: { x: 0, y: 0, w: 0, h: 0 } });
      F.items[d.id] = d;
    }
    for (const r of extras.replies) {
      const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]);
      r.bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      figs[r.fig].items[r.id] = r;
    }
    for (const F of Object.values(figs)) for (const it of Object.values(F.items)) { it.fig = F.id; it.key = `${F.id}/${it.id}`; itemByKey[it.key] = it; }

    // 注記・印・戻りの矢印のぶん、図の外枠を広げる
    for (const F of Object.values(figs)) {
      // 系列の graph は、キャンバス座標での自分の外接矩形（extra.x0・y0 から w・h まで）
      let x0 = F.extra.x0 ?? 0, y0 = F.extra.y0 ?? 0, x1 = F.w, y1 = F.h;
      for (const it of Object.values(F.items)) {
        const bs = [];
        if (it.kind === "note" || it.kind === "mark" || it.isReply) bs.push(it.bbox);
        if (it.isReply && it.label) bs.push(it.label.bbox);
        for (const b of bs) { x0 = Math.min(x0, b.x - 4); y0 = Math.min(y0, b.y - 4); x1 = Math.max(x1, b.x + b.w + 4); y1 = Math.max(y1, b.y + b.h + 4); }
      }
      Object.assign(F, { x0, y0, x1, y1 });
    }
    const place = (fid, area) => {
      const F = figs[fid], w = F.x1 - F.x0, h = F.y1 - F.y0;
      // custom の部品は伸び縮みさせず、場面ごとの区画の大きさで描き直す（関数に渡す w・h = 区画の px。文字の大きさが保たれる）
      if (F.type === "custom") return { s: 1, ox: area.x, oy: area.y, w: area.w, h: area.h };
      // 拡大の上限: 図が決めていればそれ（テキストは 1 = 文字の大きさを保つ）
      const s = Math.min(area.w / w, area.h / h, F.extra.maxScale ?? (F.fixed ? 10 : (F.type === "title" ? 1 : 1.3)));
      // 区画の中の揃え: 部品の valign・halign。なければ図の既定（テキストは上）、それもなければ中央
      const va = F.spec.valign || F.extra.valign || "middle", ha = F.spec.halign || "center";
      const dx = area.w - w * s, dy = area.h - h * s;
      const ox = area.x + (ha === "start" ? 0 : ha === "end" ? dx : dx / 2) - F.x0 * s;
      const oy = area.y + (va === "top" ? 0 : va === "bottom" ? dy : dy / 2) - F.y0 * s;
      return { s, ox, oy };
    };
    for (const sc of scenes) sc.place = Object.fromEntries(sc.figs.map((fid, i) => [fid, place(fid, sc.areas[i])]));
    // 時刻 T の場面 sc で見えている箱・グループの枠・テキストの部品の、画面上の矩形（カメラの前）。
    // show・hide をたどる。Morph の v2 の要素は、同じ id の v1 の要素が出ていれば出ているとみなす
    const visibleRects = (sc, T) => {
      const vis = new Set();
      for (const a of acts.filter(x => (x.verb === "show" || x.verb === "hide") && x.start <= T).sort((x, y) => x.start - y.start)) {
        for (const k of a.keys) { if (a.verb === "show") vis.add(k); else vis.delete(k); }
      }
      const si = scenes.indexOf(sc), out = [];
      for (const fid of sc.figs) {
        const F = figs[fid], pl = sc.place[fid], mo = morphs.find(m => m.si === si && m.to === fid);
        for (const it of Object.values(F.items)) {
          if (!["box", "frame", "text"].includes(it.kind) || !it.bbox) continue;
          if (!vis.has(it.key) && !(mo && vis.has(`${mo.from}/${it.id}`))) continue;
          const b = it.bbox;
          out.push({ x: pl.ox + b.x * pl.s, y: pl.oy + b.y * pl.s, w: b.w * pl.s, h: b.h * pl.s });
        }
      }
      return out;
    };
    // 寄せ先 R を写すカメラのうち、見えている部品が body の端で一部だけ切れないものを探す。
    // 倍率は s0 から下げていき（pan は s0 のまま）、各倍率で、写す範囲の位置を中央（s0 での位置）に近い順に試す。
    // R に重なる部品（寄せ先と、それを囲む枠）は数えない。見つからなければ null（今のまま）
    function fitCamera(sc, R, s0, fixed, T, pad) {
      const B = sc.body, tol = 1;
      const rects = visibleRects(sc, T).filter(r => !(r.x < R.x + R.w - tol && R.x < r.x + r.w - tol && r.y < R.y + R.h - tol && R.y < r.y + r.h - tol));
      if (!rects.length) return null;
      // 写す範囲（カメラの前の画面座標）: W = { x: (B.x - tx) / s, y: (B.y - ty) / s, w: B.w / s, h: B.h / s }
      const ideal = s => ({ x: clamp(R.x + R.w / 2 - B.w / s / 2, B.x, B.x + B.w - B.w / s), y: clamp(R.y + R.h / 2 - B.h / s / 2, B.y, B.y + B.h - B.h / s) });
      const c0 = ideal(s0), cx0 = c0.x + B.w / s0 / 2, cy0 = c0.y + B.h / s0 / 2;
      const cut = (wx, wy, ww, wh, e) => rects.some(r => {
        const over = r.x < wx + ww - e && wx < r.x + r.w - e && r.y < wy + wh - e && wy < r.y + r.h - e;
        const inside = r.x >= wx - e && r.y >= wy - e && r.x + r.w <= wx + ww + e && r.y + r.h <= wy + wh + e;
        return over && !inside;
      });
      const axis = (lo, hi, id, size, list) => {
        const c = new Set([clamp(id, lo, hi), lo, hi]);
        for (const [a, b] of list) for (const v of [a, b - size, b, a - size]) if (v >= lo && v <= hi) c.add(v);
        return [...c];
      };
      for (let s = s0; s >= 1; s = s > 1.0001 ? Math.max(1, s * 0.97) : 0) {
        const ww = B.w / s, wh = B.h / s, p = Math.min(pad, 16) / s, e = tol / s;
        // R を余白 p 付きで含む位置。R が body の端にあれば、その側の余白は body の端まで
        const lox = Math.max(B.x, Math.min(B.x + B.w - ww, R.x + R.w + p - ww)), hix = Math.min(B.x + B.w - ww, Math.max(B.x, R.x - p));
        const loy = Math.max(B.y, Math.min(B.y + B.h - wh, R.y + R.h + p - wh)), hiy = Math.min(B.y + B.h - wh, Math.max(B.y, R.y - p));
        if (lox > hix + 1e-6 || loy > hiy + 1e-6) { if (fixed) return null; continue; }
        const id = ideal(s);
        const xs = axis(lox, Math.max(lox, hix), id.x, ww, rects.map(r => [r.x, r.x + r.w]));
        const ys = axis(loy, Math.max(loy, hiy), id.y, wh, rects.map(r => [r.y, r.y + r.h]));
        let best = null, bd = Infinity;
        for (const wx of xs) for (const wy of ys) {
          if (cut(wx, wy, ww, wh, e)) continue;
          const d = (wx + ww / 2 - cx0) ** 2 + (wy + wh / 2 - cy0) ** 2;
          if (d < bd) { bd = d; best = { s, tx: B.x - s * wx, ty: B.y - s * wy }; }
        }
        if (best) return best;
        if (fixed) return null;
      }
      return null;
    }
    // ---- カメラ: run ごとに状態を追い、zoom・pan の from・to を決める。場面の終わりのカメラは sc.camEnd ----
    {
      const CA = UZ.CAMERA;
      const perLine = {};
      let cur = CAM0, last = null, run = -1;
      for (const sc of scenes) {
        if (sc.run !== run) { run = sc.run; cur = CAM0; last = null; }
        const B = sc.body;
        for (const a of acts.filter(x => (x.verb === "zoom" || x.verb === "pan") && x.scene === sc.id).sort((x, y) => x.start - y.start)) {
          const where = `行 ${a.line}（${a.verb}）`;
          perLine[a.line] = (perLine[a.line] || 0) + 1;
          // 前の動きの途中で始まったら、その時点の状態から動く（跳ばない）
          a.from = last && a.start < last.end ? camAt(last, a.start) : cur;
          let R = null;
          if (a.target) {   // 対象が数個なら、画面上の外接矩形
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const t of a.target) {
              const F = figs[t.fig], pl = sc.place[t.fig];
              const b = t.whole || F.type === "custom" ? figBox(F, pl) : F.items[t.id].bbox;
              x0 = Math.min(x0, pl.ox + b.x * pl.s); y0 = Math.min(y0, pl.oy + b.y * pl.s);
              x1 = Math.max(x1, pl.ox + (b.x + b.w) * pl.s); y1 = Math.max(y1, pl.oy + (b.y + b.h) * pl.s);
            }
            R = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            // region: 対象の矩形の中の一部（割合 0〜1）。custom の部品の中のように、id のない所に寄るとき
            const rg = a.a.region;
            if (rg) {
              const [ax0, ax1] = rg.x || [0, 1], [ay0, ay1] = rg.y || [0, 1];
              R = { x: R.x + R.w * ax0, y: R.y + R.h * ay0, w: R.w * (ax1 - ax0), h: R.h * (ay1 - ay0) };
            }
          }
          let s = 1;   // all は恒等（スライドの写し方）に戻す
          if (R && a.verb === "pan") s = a.from.s;
          else if (R) {
            const pad = a.a.pad ?? CA.pad;
            s = Math.min((B.w - 2 * pad) / Math.max(1, R.w), (B.h - 2 * pad) / Math.max(1, R.h), CA.maxZoom);
            if (!(s >= 1)) { warn(`${where}: 寄せる倍率が 1 未満になる（pad ${pad} が大きい）。倍率 1 で止める`); s = 1; }
          }
          // 対象の中心を body の中心へ。拡大した body が body の枠を覆い続ける範囲に収める
          let tx = 0, ty = 0;
          if (R && s > 1) {
            tx = clamp(B.x + B.w / 2 - s * (R.x + R.w / 2), (B.x + B.w) * (1 - s), B.x * (1 - s));
            ty = clamp(B.y + B.h / 2 - s * (R.y + R.h / 2), (B.y + B.h) * (1 - s), B.y * (1 - s));
            // 隣の箱が body の端で半分だけ写らないように、写す範囲をずらすか、倍率を下げる
            const fit = fitCamera(sc, R, s, a.verb === "pan", a.end, a.a.pad ?? CA.pad);
            if (fit) ({ s, tx, ty } = fit);
          }
          a.to = { s, tx, ty };
          a.target = R;
          if (R) {
            const V = { x: R.x * s + tx, y: R.y * s + ty, w: R.w * s, h: R.h * s };
            if (V.x < B.x - 1 || V.y < B.y - 1 || V.x + V.w > B.x + B.w + 1 || V.y + V.h > B.y + B.h + 1) warn(`${where}: zoom 先が body に収まらない（倍率 ${s.toFixed(2)}。小さな要素に寄せるか、先に zoom: "all" で戻す）`);
          }
          cur = a.to; last = a;
        }
        // 場面の終わり（次の場面の頭）のカメラ。動きの途中で場面が変わったら、その時点の状態
        const nx = scenes[scenes.indexOf(sc) + 1];
        sc.camEnd = last && nx ? camAt(last, nx.start) : cur;
      }
      for (const [ln, n] of Object.entries(perLine)) if (n >= 3) warn(`行 ${ln}: カメラが 1 行で ${n} 回動く（せわしない。2 回までにして、行を分ける）`);
    }
    // ---- Morph: v1 と v2 で同じ id の要素を対応づける（act は場面の頭から 0.8 秒）----
    // graph の系列は、対応する要素がキャンバス上で同じ座標なので、写し方の補間（frame）だけで動く。
    // list・compare・table は、v1 の要素の画面上の位置を v2 の写し方で逆変換した位置（fromBox・fromPts）から動かす
    for (const mo of morphs) {
      const sc = scenes[mo.si], prev = scenes[mo.si - 1], F1 = figs[mo.from], F2 = figs[mo.to];
      const series = !!seriesOf[mo.to] && seriesOf[mo.to] === seriesOf[mo.from];
      const pairs = [], auto = [];
      if (!MORPH_TYPES.includes(F2.type)) warn(`スライド「${sc.slide}」: 部品「${mo.to}」: Morph で要素をつなげない type（${F2.type}）。「${mo.from}」を消しながら「${mo.to}」を出す`);
      else {
        const P1 = camOn(prev.camEnd, prev.place[mo.from]), P2 = sc.place[mo.to], k = P1.s / P2.s;   // v1 は、前の場面の最後のカメラで写った位置
        const loc = ([x, y]) => [(P1.ox + x * P1.s - P2.ox) / P2.s, (P1.oy + y * P1.s - P2.oy) / P2.s];
        for (const it2 of Object.values(F2.items)) {
          const it1 = F1.items[it2.id];
          if (!it1 || it1.kind !== it2.kind || !MORPH_KINDS.includes(it2.kind) || it1.isReply || it2.isReply) continue;
          if (it1.autoId || it2.autoId) { auto.push(it2.id); continue; }
          const pr = { from: it1.key, to: it2.key, kind: it2.kind, fromBox: null, fromPts: null, fromStroke: it1.stroke ?? null, fromFill: it1.fill ?? null, fromText: textOf(it1), toText: textOf(it2) };
          if (!series) {
            const b = boxOfItem(it1);
            if (b) { const [x, y] = loc([b.x, b.y]); pr.fromBox = { x, y, w: b.w * k, h: b.h * k }; }
            if (it1.pts) pr.fromPts = it1.pts.map(loc);
          }
          pairs.push(pr);
        }
        if (auto.length) warn(`スライド「${sc.slide}」: 部品「${mo.to}」: 自動で付いた id の要素（${auto.join("、")}）は Morph でつながない。Morph でつなぐなら id を書く`);
      }
      acts.push({ verb: "morph", scene: sc.id, line: sc.lines[0].id, start: sc.start, dur: 0.8, end: sc.start + 0.8, from: mo.from, to: mo.to, series, pairs });
    }
    acts.sort((a, b) => a.start - b.start);
    // ---- 値: 名前ごとに set を始まりの順に並べ、各 set の始まりの値（from）を、その時点の値から決めておく ----
    // （前の set の途中で始まる set は、その時点の値から動く。これで valuesAt は t だけで決まる）
    const lastSet = {};
    for (const a of acts) if (a.verb === "set") {
      const p = lastSet[a.name];
      a.from = p ? valueOfSet(p, a.start) : values0[a.name];
      lastSet[a.name] = a;
    }
    const lastLine = timeline.lines[timeline.lines.length - 1];
    const speechEnd = lastLine.start + lastLine.dur;
    const actsEnd = Math.max(...acts.map(a => a.end), speechEnd);
    const endCard = Math.max(speechEnd, actsEnd) + 0.8;
    const duration = endCard + 3.2;
    for (let i = 0; i < scenes.length; i++) scenes[i].end = i + 1 < scenes.length ? scenes[i + 1].start : endCard;

    // 一度も出ない図への警告
    // スライドの部品は、そのスライドを使うどの場面でも出ないときだけ知らせる（場面をまたいで少しずつ出すのは普通の使い方）
    // Morph で v1 の表示を引き継ぐ図も、出たものとみなす
    const shown = fid => acts.some(a => (a.verb === "show" && a.keys.some(k => k.startsWith(fid + "/"))) || (a.verb === "morph" && a.to === fid && a.pairs.length));
    for (const sc of scenes) for (const fid of sc.figs) {
      if (figs[fid].autoShow || sc.slide) continue;
      const any = acts.some(a => a.verb === "show" && a.keys.some(k => k.startsWith(fid + "/")) && a.start < sc.end);
      if (!any) warn(`場面 ${sc.id}: 図「${fid}」を show していない（何も出ない）`);
    }
    for (const sl of Object.values(slides)) for (const fid of sl.figs) {
      if (!figs[fid].autoShow && !shown(fid)) warn(`スライド「${sl.id}」: 部品「${fid}」を、どの場面でも show していない（何も出ない）`);
    }
    const sp = (sb.voice && sb.voice.speaker) ?? UZ.DEFAULT_SPEAKER;
    const credit = sb.credit || (sb.voice && sb.voice.credit) || timeline.credit || `VOICEVOX:${UZ.SPEAKER_NAMES[sp] || "話者 " + sp}`;
    return { errors, warnings, sb, theme, S, timeline, TL, scenes, figs, series, slides, assets, credits, acts, itemByKey, values0, duration, endCard, credit, title: sb.title || "" };
  };

  // ---- 名前付きの値 ----
  // set 1 つの、時刻 t での値（始まる前は from、終わった後は to）
  const valueOfSet = (a, t) => {
    const q = clamp((t - a.start) / Math.max(0.001, a.dur));
    return a.from + (a.to - a.from) * (a.ease === "linear" ? q : smooth(q));
  };
  // 時刻 t の値: 名前ごとに、t 以前に始まった最後の set を補間する（なければ初めの値）
  UZ.valuesAt = function (M, t) {
    const v = { ...(M.values0 || {}) };
    for (const a of M.acts) {
      if (t < a.start) break;
      if (a.verb === "set") v[a.name] = valueOfSet(a, t);
    }
    return v;
  };

  // Morph で要素をつなぐ type と、要素の kind（group は描かない。印・注記・点は動作で足したもので、引き継がない）
  const MORPH_TYPES = ["graph", "list", "compare", "table"];
  const MORPH_KINDS = ["box", "edge", "text", "rect", "band", "frame"];
  const textOf = it => { const T = it.kind === "edge" ? it.label : it.texts && it.texts[0]; return T ? T.lines.join("\n") : null; };
  const boxOfItem = it => (it.kind === "box" || it.kind === "rect" || it.kind === "frame" || it.kind === "band" ? { x: it.x, y: it.y, w: it.w, h: it.h } : it.bbox || null);
  // 2 本の折れ線の補間。点の数が違うときは、両方の頂点の位置（長さの割合）で取り直す
  function lerpPts(A, B, q) {
    if (A.length === B.length) return A.map((p, i) => [mix(p[0], B[i][0], q), mix(p[1], B[i][1], q)]);
    const pa = UZ.withLengths(A), pb = UZ.withLengths(B);
    const us = [...new Set([...pa.L.map(l => l / (pa.total || 1)), ...pb.L.map(l => l / (pb.total || 1))])].sort((x, y) => x - y);
    return us.map(u => { const a = UZ.along(pa, u), b = UZ.along(pb, u); return [mix(a[0], b[0], q), mix(a[1], b[1], q)]; });
  }

  // 折れ線の角を、半径 r ぶん手前から曲線でつなぐ
  function roundCorners(pts, r) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), d = Math.min(r, la / 2, lb / 2);
      if (d < 1) { out.push(p); continue; }
      const p1 = [p[0] + (a[0] - p[0]) / la * d, p[1] + (a[1] - p[1]) / la * d], p2 = [p[0] + (b[0] - p[0]) / lb * d, p[1] + (b[1] - p[1]) / lb * d];
      for (let k = 0; k <= 6; k++) { const u = k / 6, v = 1 - u; out.push([v * v * p1[0] + 2 * v * u * p[0] + u * u * p2[0], v * v * p1[1] + 2 * v * u * p[1] + u * u * p2[1]]); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function dedupe(pts) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) out.push(p); }
    return out;
  }
  const center = b => [b.x + b.w / 2, b.y + b.h / 2];
  const unionRect = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  // 戻りの矢印は、行きの辺のラベルと反対の側へずらす
  function pickOffset(F, pts, path) {
    const labels = [];
    for (let i = 1; i < path.length; i++) { const e = F.items[`${path[i]}>${path[i - 1]}`]; if (e && e.label) labels.push(center(e.label.bbox)); }
    const score = d => { const op = UZ.offsetPoly(pts, d); const m = UZ.along(UZ.withLengths(op), 0.5); return Math.min(...labels.map(l => Math.hypot(l[0] - m[0], l[1] - m[1])), 1e9); };
    return score(16) >= score(-16) ? 16 : -16;
  }
  // 戻りの矢印のラベル: 各区間の中点の外側を候補にし、箱やラベルと重ならない所を選ぶ
  function placeReplyLabel(F, poly, off, text, color) {
    const w = UZ.textW(text, 18, 700), h = 25;
    const obst = Object.values(F.items).filter(it => it.kind === "box" || (it.kind === "edge" && it.label));
    let best = null, bestS = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 30) continue;
      const nx = (b[1] - a[1]) / L * Math.sign(off), ny = -(b[0] - a[0]) / L * Math.sign(off);
      for (const f of [0.5, 0.3, 0.7]) {
        const mx = a[0] + (b[0] - a[0]) * f, my = a[1] + (b[1] - a[1]) * f;
        const dist = Math.abs(nx) > 0.5 ? w / 2 + 10 : h / 2 + 6;
        const cx = mx + nx * dist, cy = my + ny * dist;
        const box = { x: cx - w / 2, y: cy - h / 2, w, h };
        let sc = (f === 0.5 ? 0 : 3) - L * 0.01;
        for (const o of obst) { sc += UZ.rectOverlap(box, o.kind === "box" ? o.bbox : o.label.bbox, 8) * 5; }
        if (box.x < (F.extra.x0 ?? 0) || box.y < (F.extra.y0 ?? 0) || box.x + w > F.w || box.y + h > F.h) sc += 40;
        if (sc < bestS) { bestS = sc; best = [cx, cy]; }
      }
    }
    if (!best) best = UZ.along(UZ.withLengths(poly), 0.5);
    return UZ.mkText(text, best[0], best[1], 18, { weight: 700, color });
  }
  function markPos(F, t) {
    if (t.kind === "edge") return UZ.along(UZ.withLengths(t.pts), 0.5);
    if (F.type === "table" && t.kind === "rect") return [F.extra.rowMarkX, t.y + t.h / 2];
    if (F.type === "table" && t.textBox) return [t.bbox.x + t.bbox.w - 24, t.bbox.y + t.bbox.h / 2];
    if (t.kind === "text" && t.texts) { const b = t.texts[0].bbox; return [b.x + b.w + 22, b.y + Math.min(b.h, t.texts[0].lineH) / 2]; }
    return [t.bbox.x + t.bbox.w - 2, t.bbox.y + 2];
  }
  // 注記は対象の下・上・右・左の順に、他の部品と重ならない所へ置く
  function placeNote(F, n, S) {
    const size = 18, lines = UZ.wrap(n.text, size, 300, 500, 3);
    const tw = Math.max(...lines.map(s => UZ.textW(s, size, 500))), th = lines.length * 25;
    const tb = n.target ? F.items[n.target].bbox : { x: ((F.extra.x0 ?? 0) + F.w) / 2, y: F.h, w: 0, h: 0 };
    const gap = n.link ? 26 : 10;
    const cands = [
      [tb.x + tb.w / 2 - tw / 2, tb.y + tb.h + gap], [tb.x + tb.w / 2 - tw / 2, tb.y - gap - th],
      [tb.x + tb.w + gap, tb.y + tb.h / 2 - th / 2], [tb.x - gap - tw, tb.y + tb.h / 2 - th / 2],
      [tb.x + tb.w + gap, tb.y + tb.h + gap], [tb.x - gap - tw, tb.y + tb.h + gap],
    ];
    for (const fr of Object.values(F.items)) if (fr.kind === "frame" && n.target && (fr.members || []).includes(n.target)) {
      cands.push([tb.x + tb.w / 2 - tw / 2, fr.bbox.y + fr.bbox.h + gap], [tb.x + tb.w / 2 - tw / 2, fr.bbox.y - gap - th]);
    }
    const others = Object.values(F.items).filter(it => it.bbox && it.id !== n.target && it.kind !== "group" && it.kind !== "band" && it.kind !== "frame");
    const frames = Object.values(F.items).filter(it => it.kind === "frame" && it.id !== n.target);
    let best = null, bestS = Infinity;
    cands.forEach(([x, y], i) => {
      const b = { x: x - 6, y: y - 4, w: tw + 12, h: th + 8 };
      let s = i * 2;
      for (const o of others) { s += UZ.rectOverlap(b, o.bbox) * 4; if (o.label) s += UZ.rectOverlap(b, o.label.bbox) * 4; }
      for (const fr of frames) { const ov = UZ.rectOverlap(b, fr.bbox); const inside = b.x >= fr.bbox.x && b.y >= fr.bbox.y && b.x + b.w <= fr.bbox.x + fr.bbox.w && b.y + b.h <= fr.bbox.y + fr.bbox.h; if (ov > 0 && !inside) s += ov * 4; }
      if (b.x < (F.extra.x0 ?? 0) || b.y < (F.extra.y0 ?? 0) || b.x + b.w > F.w || b.y + b.h > F.h) s += 40;
      if (s < bestS) { bestS = s; best = [x, y]; }
    });
    const t = UZ.mkText(lines, best[0], best[1] + th / 2, size, { anchor: "start", weight: 500, color: S.accent, lineH: 25 });
    const link = n.link ? [[best[0] + tw / 2, best[1] < tb.y ? best[1] + th : best[1]], [tb.x + tb.w / 2, best[1] < tb.y ? tb.y : tb.y + tb.h]] : null;
    return { texts: [t], bbox: { ...t.bbox }, link };
  }

  // ================= 時刻 t のコマ =================
  UZ.frame = function (M, t) {
    const st = {};
    const get = k => st[k] || (st[k] = { show: 0, dim: 1, blur: 0, pulse: 0, tint: null, tintP: 0, text: null, textFrom: null, textP: 1, mark: null, pos: null, off: [0, 0], labelText: null });
    let badge = { text: "", show: 0, from: "" };
    const customs = {};
    // 今の場面（Morph の act が、自分の場面の間だけ v1 を隠すのに使う）
    let si = M.scenes.findIndex((sc, i) => t < sc.end || i === M.scenes.length - 1);
    if (t < M.scenes[0].start) si = 0;
    const sc = M.scenes[si], prev = si > 0 ? M.scenes[si - 1] : null;
    for (const a of M.acts) {
      if (t < a.start) break;
      const p = clamp((t - a.start) / Math.max(0.001, a.dur));
      switch (a.verb) {
        case "show": a.keys.forEach((k, i) => { const s = get(k); s.show = Math.max(s.show, clamp((t - a.start - i * a.stagger) / a.each)); if (a.draw) s.draw = true; }); break;
        case "hide": a.keys.forEach((k, i) => { const s = get(k); delete s.draw; s.show = Math.min(s.show, 1 - clamp((t - a.start - i * a.stagger) / a.each)); }); break;
        case "pulse": for (const k of a.keys) { if (p < 1) get(k).pulse = Math.sin(Math.PI * p); } break;
        case "focus": {
          const set = new Set(a.keys);
          for (const fid of a.figsOf) for (const it of Object.values(M.figs[fid].items)) {
            const s = get(it.key); const target = set.has(it.key) || set.has(`${fid}/${it.target}`) || it.kind === "dot" || it.kind === "note" || it.isReply ? 1 : 0.2;
            s.dim = mix(s.dim, target, smooth(p));
          }
          break;
        }
        case "blur": {
          const set = new Set(a.keys);
          for (const fid of a.figsOf) for (const it of Object.values(M.figs[fid].items)) {
            const s = get(it.key); const target = set.has(it.key) || set.has(`${fid}/${it.target}`) || it.kind === "dot" || it.kind === "note" || it.isReply ? 0 : 1;
            s.blur = mix(s.blur, target, smooth(p));
          }
          break;
        }
        case "unblur": for (const fid of a.figsOf) for (const it of Object.values(M.figs[fid] ? M.figs[fid].items : {})) { const s = get(it.key); s.blur = mix(s.blur, 0, smooth(p)); } break;
        case "unfocus": for (const fid of a.figsOf) for (const it of Object.values(M.figs[fid] ? M.figs[fid].items : {})) { const s = get(it.key); s.dim = mix(s.dim, 1, smooth(p)); } break;
        case "mark": { const s = get(a.key); if (s.mark && s.mark !== a.kind && s.show > 0) { s.mark = a.kind; s.show = Math.max(0.6, ease(p)); } else { s.mark = a.kind; s.show = Math.max(s.show, ease(p)); } s.markPop = p < 1 ? Math.sin(Math.PI * p) : 0; break; }
        case "unmark": { const s = get(a.key); s.show = Math.min(s.show, 1 - p); break; }
        case "note": get(a.key).show = Math.max(get(a.key).show, smooth(p)); break;
        case "trace": {
          // 点は辺の上を動く間だけ見える（dotVis）。箱にいる間は、その箱を強調する（heres = 箱ごとの強さ）
          const s = get(a.key), u0 = t - a.start, n = a.legs.length;
          s.show = 1; s.heres = {}; s.hereColor = a.color; s.herePop = null;
          const slice = n ? Math.max(0.1, a.dur - a.hold) / n : 1;
          const x = n ? clamp((u0 - a.hold) / slice / n) * n : 0;
          if (!n || x <= 0) {
            s.pos = a.at.slice(); s.dotVis = 0; s.heres[a.node] = a.appear ? smooth(clamp(u0 / 0.3)) : 1;
            if (a.labelNew) s.herePop = [a.node, Math.sin(Math.PI * clamp(u0 / 0.8))];   // 札を見せる間に、箱を一度強く見せる
          } else if (x >= n) { s.pos = a.endAt.slice(); s.dotVis = 0; s.heres[a.legs[n - 1].to] = 1; }
          else {
            const i = Math.min(n - 1, Math.floor(x)), lg = a.legs[i], m = clamp((x - i) / 0.9);
            s.pos = UZ.along(lg.poly, ease(m));
            s.dotVis = smooth(clamp(m / 0.1)) * (1 - smooth(clamp((m - 0.9) / 0.1)));
            s.heres[lg.from] = 1 - smooth(clamp(m / 0.3));
            s.heres[lg.to] = Math.max(s.heres[lg.to] || 0, smooth(clamp((m - 0.75) / 0.25)));
          }
          if (a.label != null) s.labelText = a.label;
          // 札は、止まっている間だけ出る（動き出す前に消える）
          s.labelShow = a.labelNew ? smooth(clamp(u0 / 0.2)) * (1 - smooth(clamp((u0 - (a.hold - 0.25)) / 0.2))) : 0;
          s.labelPop = 0;
          s.moving = s.dotVis > 0;
          break;
        }
        case "reply": get(a.key).show = clamp(p / 0.85); break;
        case "badge": if (a.text) { const was = badge.text; badge = { text: a.text, show: was ? 1 : ease(p), from: was && was !== a.text ? was : "", p: smooth(p) }; } else badge = { text: badge.text, show: Math.min(badge.show, 1 - p), from: "", p: 1 }; break;
        case "relabel": for (const k of a.keys) { const s = get(k); s.textFrom = s.text; s.text = a.text; s.textP = smooth(p); } break;
        case "tint": for (const k of a.keys) { const s = get(k); s.tintFrom = s.tint; s.tint = a.color; s.tintP = smooth(p); s.tintOff = !!a.off; } break;
        case "move": { const s = get(a.key); const q = ease(p); s.off = [s.off[0] + a.delta[0] * q, s.off[1] + a.delta[1] * q]; break; }
        case "resize": {
          const s = get(a.key), q = ease(p);
          s.rect = p >= 1 ? { ...a.to } : { x: mix(a.from.x, a.to.x, q), y: mix(a.from.y, a.to.y, q), w: mix(a.from.w, a.to.w, q), h: mix(a.from.h, a.to.h, q) };
          s.textOff = p >= 1 ? a.textTo.slice() : [mix(a.textFrom[0], a.textTo[0], q), mix(a.textFrom[1], a.textTo[1], q)];
          break;
        }
        case "custom": customs[a.key] = p; break;
        case "morph": {
          // 対応する要素: v2 は v1 の表示（出ているかどうか）だけを引き継ぐ。Morph の場面の間は v1 を隠す（重ねて描かない）
          const here = sc.id === a.scene, q = ease(p);
          for (const pr of a.pairs) {
            const s1 = get(pr.from), s2 = get(pr.to);
            s2.show = Math.max(s2.show, s1.show);
            if (!here) continue;
            s1.show = 0;
            if (p >= 1) continue;
            const it = M.itemByKey[pr.to];
            s2.morph = true;
            if (pr.fromBox) {
              const B = pr.fromBox;
              if (it.kind === "box") {
                const R = { x: mix(B.x, it.x, q), y: mix(B.y, it.y, q), w: mix(B.w, it.w, q), h: mix(B.h, it.h, q) };
                s2.rect = R; s2.textOff = [R.x + R.w / 2 - (it.x + it.w / 2), R.y + R.h / 2 - (it.y + it.h / 2)];
              } else {
                const b = it.kind === "text" ? it.bbox : it;
                s2.off = [s2.off[0] + (B.x - b.x) * (1 - q), s2.off[1] + (B.y - b.y) * (1 - q)];
              }
            }
            if (pr.fromPts && it.pts) s2.pts = lerpPts(pr.fromPts, it.pts, q);
            const fillDiff = pr.fromFill != null && it.fill != null && pr.fromFill !== it.fill;
            if ((pr.fromStroke != null && it.stroke != null && pr.fromStroke !== it.stroke) || fillDiff) {
              s2.tintFrom = pr.fromStroke ?? it.stroke; s2.tint = it.stroke ?? null; s2.tintP = q;
              if (fillDiff) s2.fillFrom = pr.fromFill;
            }
            if (pr.fromText != null && pr.toText != null && pr.fromText !== pr.toText) { s2.textFrom = pr.fromText; s2.text = pr.toText; s2.textP = q; }
          }
          break;
        }
      }
    }
    // 点のいる箱の強調（点を消すと、強調も消える）
    for (const s of Object.values(st)) if (s.heres) {
      for (const [k, v] of Object.entries(s.heres)) { const ns = get(k); ns.here = Math.max(ns.here || 0, v * s.show); ns.hereColor = s.hereColor; }
      if (s.herePop) { const ns = get(s.herePop[0]); ns.pulse = Math.max(ns.pulse || 0, s.herePop[1] * s.show); }
    }
    // 場面: 図の出入りと置き場所
    const k = smooth((t - sc.start) / 0.6);
    const figsF = {};
    for (const fid of Object.keys(M.figs)) figsF[fid] = { opacity: 0, place: null };
    // この場面の Morph（v2 → act）。要素をつなぐ v2 は図ごとの fade in をしない（要素ごとに出る）。
    // graph の系列は、v2 の写し方を v1 の写し方から補間し、fade out する v1 も同じ写し方で写す
    const morphTo = {}, morphFrom = {};
    if (prev) for (const a of M.acts) if (a.verb === "morph" && a.scene === sc.id) { morphTo[a.to] = a; morphFrom[a.from] = a; }
    // カメラ: 今の run の、t 以前の最後の zoom・pan を補間する（なければ恒等 = スライドの写し方）
    let cam = CAM0;
    for (const a of M.acts) {
      if (t < a.start) break;
      if ((a.verb === "zoom" || a.verb === "pan") && a.run === sc.run) cam = camAt(a, t);
    }
    // 前の場面が別の run なら、前の場面の図は前の場面の最後のカメラのまま写る（同じ図が続くときは、そこから新しい区画へ補間する）
    const newRun = prev && prev.run !== sc.run;
    const prevPl = fid => (newRun ? camOn(prev.camEnd, prev.place[fid]) : prev.place[fid]);
    for (const fid of sc.figs) {
      let pl = sc.place[fid];
      const mo = morphTo[fid], from = prev && (prev.place[fid] ? prevPl(fid) : mo && mo.series ? prevPl(mo.from) : null);
      if (from) pl = mixPlace(from, pl, ease((t - sc.start) / 0.8));
      figsF[fid] = { opacity: prev && (prev.figs.includes(fid) || (mo && mo.pairs.length)) ? 1 : k, place: camOn(cam, pl) };
    }
    if (prev) for (const fid of prev.figs) if (!sc.figs.includes(fid)) {
      const mo = morphFrom[fid];
      figsF[fid] = { opacity: 1 - k, place: mo && mo.series && figsF[mo.to] ? figsF[mo.to].place : prevPl(fid) };
    }
    // body の clip: 寄せている間と、寄せたスライドから次のスライドへ移る 0.8 秒の間（前後の body を合わせた範囲）
    const leaving = newRun && prev.camEnd.s > 1.001 && t < sc.start + 0.8;
    const U = leaving ? unionRect(prev.body, sc.body) : sc.body;
    const camera = { s: cam.s, tx: cam.tx, ty: cam.ty, clip: { ...U }, on: cam.s > 1.001 || leaving };
    for (const a of M.acts) if (a.verb === "custom" && a.scene !== sc.id) delete customs[a.key];
    // 終わりの札
    const endP = smooth((t - M.endCard) / 0.6);
    if (endP > 0) for (const fid in figsF) figsF[fid].opacity *= 1 - endP;
    // 字幕
    let sub = null;
    for (const ln of M.timeline.lines) {
      if (t >= ln.start - 0.05 && t < ln.start + ln.dur + 0.3) {
        const line = findLine(M.sb, ln.id);
        const o = Math.min(smooth((t - ln.start + 0.05) / 0.15), smooth((ln.start + ln.dur + 0.3 - t) / 0.15));
        sub = { id: ln.id, text: UZ.parseText(line.text).text, opacity: o };
      }
    }
    // 地の暗さ（0 = 通常の地、1 = 章扉の地）。場面の変わり目でなめらかに切り替え、終わりの札では通常の地に戻す
    const toneOf = s => (s && s.tone === "dark" ? 1 : 0);
    const dark = mix(prev ? toneOf(prev) : toneOf(sc), toneOf(sc), k) * (1 - endP);
    const header = { text: sc.header, opacity: (prev && prev.header !== sc.header ? k : 1) * (1 - endP), prev: prev && prev.header !== sc.header ? { text: prev.header, opacity: 1 - k } : null };
    const stSame = prev && prev.statement.join("\n") === sc.statement.join("\n");
    const statement = { lines: sc.statement, opacity: (prev && !stSame ? k : 1) * (1 - endP), prev: prev && !stSame && prev.statement.length ? { lines: prev.statement, opacity: 1 - k } : null };
    return { t, st, figs: figsF, camera, scene: sc, statement, captions: sc.captions.map(c => ({ ...c, opacity: (prev && prev.figs.includes(c.fig) && prev.captions.some(x => x.text === c.text) ? 1 : k) * (1 - endP) })), header, sub, badge, customs, values: UZ.valuesAt(M, t), end: endP, dark };
  };
  // ================= スライドの完成形のコマ =================
  // 完成形 = 宣言した部品がすべて出た状態。完成形に含めない部品（transient）と、動作で足したもの（印・注記・点・戻りの矢印）は出さない。
  // 字幕・札はなし。frame() と同じ形で返す（そのスライドを最初に使う場面の区画）。スライドがなければ null
  UZ.finalFrame = function (M, slideId) {
    const sl = M.slides && M.slides[slideId];
    if (!sl) return null;
    const sc = M.scenes.find(s => s.id === sl.scenes[0]);
    const st = {}, figsF = {};
    for (const fid of Object.keys(M.figs)) figsF[fid] = { opacity: 0, place: null };
    for (const fid of sl.figs) {
      if (sl.transient.includes(fid)) continue;
      figsF[fid] = { opacity: 1, place: sc.place[fid] };
      for (const it of Object.values(M.figs[fid].items)) {
        if (it.kind === "mark" || it.kind === "note" || it.kind === "dot" || it.isReply) continue;
        st[it.key] = { show: 1, dim: 1, blur: 0, pulse: 0, tint: null, tintP: 0, text: null, textFrom: null, textP: 1, mark: null, pos: null, off: [0, 0], labelText: null };
      }
    }
    // 大きさを変えた箱（resize）は、変えた後の形で出す（中に入れた部品と重ならないように）
    for (const a of M.acts) if (a.verb === "resize" && sl.scenes.includes(a.scene) && st[a.key]) { st[a.key].rect = { ...a.to }; st[a.key].textOff = a.textTo.slice(); }
    return { t: sc.start, st, figs: figsF, camera: { ...CAM0, clip: { ...sc.body }, on: false }, scene: sc, statement: { lines: sc.statement, opacity: 1, prev: null }, captions: [],
      header: { text: sc.header, opacity: 1, prev: null }, sub: null, badge: { text: "", show: 0, from: "" }, customs: {}, values: UZ.completeValues(M, slideId), end: 0, dark: sc.tone === "dark" ? 1 : 0 };
  };
  // スライドの完成形の値 = そのスライドを使う最後の場面の終わりの値（完成形のコマで custom の部品に渡す）
  UZ.completeValues = function (M, slideId) {
    const sl = M.slides && M.slides[slideId];
    if (!sl) return { ...(M.values0 || {}) };
    const lastSc = M.scenes.find(s => s.id === sl.scenes[sl.scenes.length - 1]);
    return UZ.valuesAt(M, lastSc.end - 0.001);
  };
  const lineCache = new WeakMap();
  function findLine(sb, id) {
    let m = lineCache.get(sb);
    if (!m) { m = {}; for (const sc of sb.scenes) for (const l of sc.lines) m[l.id] = l; lineCache.set(sb, m); }
    return m[id];
  }
})(globalThis.UZ = globalThis.UZ || {});
