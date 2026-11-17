// ugoku-zukai プレーヤー: 台本 → 時刻つきの動作の列 → 時刻 t のコマ（純粋に t だけで決まる）
(function (UZ) {
  "use strict";
  const { clamp, mix, smooth, ease } = UZ;

  UZ.FORMATS = ["ugoku-zukai/2", "ugoku-zukai/3", "ugoku-zukai/4"];   // /2 = 場面が図を指す形だけ。/3 = スライドも使える。/4 = morph・zoom・pan・draw も使える
  UZ.FORMAT = "ugoku-zukai/4";
  UZ.VERBS = ["show", "hide", "focus", "unfocus", "blur", "unblur", "pulse", "mark", "unmark", "trace", "reply", "note", "badge", "relabel", "tint", "move", "resize", "zoom", "pan", "custom"];
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
  const DUR = { show: 0.7, hide: 0.5, focus: 0.6, unfocus: 0.6, blur: 0.6, unblur: 0.6, pulse: 0.8, mark: 0.5, unmark: 0.4, trace: 2.0, reply: 0.8, note: 0.6, badge: 0.5, relabel: 0.6, tint: 0.6, move: 1.0, resize: 0.9, zoom: 1.0, pan: 0.9, custom: 2.0 };
  const STAGGER = 0.22;

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
      return { id: sc.id, chapter: sc.chapter, figs, header, areas, captions, lines: sc.lines, tone: slideDark ? "dark" : figs.length === 1 ? tones[0] : "light", slideDark: !!slideDark, slide: P.slide, statement: P.statement };
    });

    if (errors.length) return { errors, warnings };
    // 画像は、道具が先に読み込んで渡す（opts.assets。node は assets.cjs、組み立ては uz_assets.py）
    const assets = opts.assets || {};
    for (const [fid, f] of Object.entries(FIGS)) if (f.type === "image" && !assets[f.src]) err(`図「${fid}」: 画像「${f.src}」が読み込まれていない`);
    if (errors.length) return { errors, warnings };
    const credits = [];
    for (const f of Object.values(FIGS)) if (f.type === "image" && typeof f.credit === "string" && f.credit && !credits.includes(f.credit)) credits.push(f.credit);

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
        // Morph の graph は、前の図（v1）のレイアウトに寄せる。v1 がまだ配置されていなければ（場面の順の誤り）寄せずに組む
        const mv = sc.slide != null ? (sb.slides[sc.slide].parts[i] || {}).morph : null;
        const anchor = f.type === "graph" && mv && figs[mv] && figs[mv].type === "graph" ? graphAnchor(figs[mv]) : null;
        if (!L) L = await UZ.FIG[f.type].layout(f, S, { area: A, tryBoth: !f.direction, assets, anchor });
        if (L.morphBroken && L.morphBroken.length) warn(`スライド「${sc.slide}」: 部品「${fid}」の Morph の並びを保てない（${L.morphBroken.join("、")} の順が「${mv}」と入れ替わる）。edges の向きか direction を直す`);
        const items = {};
        for (const it of L.items) { it.fig = fid; it.key = `${fid}/${it.id}`; items[it.id] = it; }
        figs[fid] = { id: fid, type: f.type, spec: f, w: L.w, h: L.h, items, order: L.order, autoShow: !!L.autoShow, fixed: !!L.fixed, extra: L, dark: !!sc.slideDark };
      }
    }
    // Morph の anchor: v1 の向きと、ノードの矩形
    function graphAnchor(F) {
      const nodes = {};
      for (const it of Object.values(F.items)) if (it.kind === "box") nodes[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
      return { dir: F.extra.dir, nodes };
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
    const itemByKey = {};
    for (const F of Object.values(figs)) for (const it of Object.values(F.items)) itemByKey[it.key] = it;
    const dotState = {};   // 点の今の位置（台本を読みながら追う）
    const sizeState = {};  // 大きさを変えた箱の今の形（resize を重ねたとき、前の形から続ける）

    for (const sc of scenes) {
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
            for (const ref of asList(val)) {
              const x = extraKey(sc, ref, where);   // 点（dot:<名前>）と注記（note:<id>）
              if (x !== undefined) {
                if (x && verb !== "hide") err(`${where}: 点と注記（${ref}）に使えるのは hide だけ`);
                else if (x) { keys.push(x); delete dotState[x]; }   // 消した点は、次の trace で 1 つ目のノードにもう一度現れる
                continue;
              }
              const r = resolve(sc, ref, where); if (r) keys.push(...expand(r));
            }
            act.keys = keys;
            if (verb === "show" || verb === "hide") {
              act.stagger = a.stagger ?? (keys.length > 1 ? STAGGER : 0);
              act.each = a.dur ?? DUR[verb];
              dur = act.each + act.stagger * Math.max(0, keys.length - 1);
            }
            if (verb === "focus") act.figsOf = [...new Set(keys.map(k => k.split("/")[0]))];
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
      let x0 = 0, y0 = 0, x1 = F.w, y1 = F.h;
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
    acts.sort((a, b) => a.start - b.start);
    const lastLine = timeline.lines[timeline.lines.length - 1];
    const speechEnd = lastLine.start + lastLine.dur;
    const actsEnd = Math.max(...acts.map(a => a.end), speechEnd);
    const endCard = Math.max(speechEnd, actsEnd) + 0.8;
    const duration = endCard + 3.2;
    for (let i = 0; i < scenes.length; i++) scenes[i].end = i + 1 < scenes.length ? scenes[i + 1].start : endCard;

    // 一度も出ない図への警告
    // スライドの部品は、そのスライドを使うどの場面でも出ないときだけ知らせる（場面をまたいで少しずつ出すのは普通の使い方）
    const shown = fid => acts.some(a => a.verb === "show" && a.keys.some(k => k.startsWith(fid + "/")));
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
    return { errors, warnings, sb, theme, S, timeline, TL, scenes, figs, slides, assets, credits, acts, itemByKey, duration, endCard, credit, title: sb.title || "" };
  };

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
        if (box.x < 0 || box.y < 0 || box.x + w > F.w || box.y + h > F.h) sc += 40;
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
    const tb = n.target ? F.items[n.target].bbox : { x: F.w / 2, y: F.h, w: 0, h: 0 };
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
      if (b.x < 0 || b.y < 0 || b.x + b.w > F.w || b.y + b.h > F.h) s += 40;
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
    for (const a of M.acts) {
      if (t < a.start) break;
      const p = clamp((t - a.start) / Math.max(0.001, a.dur));
      switch (a.verb) {
        case "show": a.keys.forEach((k, i) => { const s = get(k); s.show = Math.max(s.show, clamp((t - a.start - i * a.stagger) / a.each)); }); break;
        case "hide": a.keys.forEach((k, i) => { const s = get(k); s.show = Math.min(s.show, 1 - clamp((t - a.start - i * a.stagger) / a.each)); }); break;
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
      }
    }
    // 点のいる箱の強調（点を消すと、強調も消える）
    for (const s of Object.values(st)) if (s.heres) {
      for (const [k, v] of Object.entries(s.heres)) { const ns = get(k); ns.here = Math.max(ns.here || 0, v * s.show); ns.hereColor = s.hereColor; }
      if (s.herePop) { const ns = get(s.herePop[0]); ns.pulse = Math.max(ns.pulse || 0, s.herePop[1] * s.show); }
    }
    // 場面: 図の出入りと置き場所
    let si = M.scenes.findIndex((sc, i) => t < sc.end || i === M.scenes.length - 1);
    if (t < M.scenes[0].start) si = 0;
    const sc = M.scenes[si], prev = si > 0 ? M.scenes[si - 1] : null;
    const k = smooth((t - sc.start) / 0.6);
    const figsF = {};
    for (const fid of Object.keys(M.figs)) figsF[fid] = { opacity: 0, place: null };
    for (const fid of sc.figs) {
      let pl = sc.place[fid];
      if (prev && prev.place[fid]) { const a = prev.place[fid], b = pl, q = ease((t - sc.start) / 0.8); pl = { s: mix(a.s, b.s, q), ox: mix(a.ox, b.ox, q), oy: mix(a.oy, b.oy, q) }; }
      figsF[fid] = { opacity: prev && prev.figs.includes(fid) ? 1 : k, place: pl };
    }
    if (prev) for (const fid of prev.figs) if (!sc.figs.includes(fid)) figsF[fid] = { opacity: 1 - k, place: prev.place[fid] };
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
    return { t, st, figs: figsF, scene: sc, statement, captions: sc.captions.map(c => ({ ...c, opacity: (prev && prev.figs.includes(c.fig) && prev.captions.some(x => x.text === c.text) ? 1 : k) * (1 - endP) })), header, sub, badge, customs, end: endP, dark };
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
    return { t: sc.start, st, figs: figsF, scene: sc, statement: { lines: sc.statement, opacity: 1, prev: null }, captions: [],
      header: { text: sc.header, opacity: 1, prev: null }, sub: null, badge: { text: "", show: 0, from: "" }, customs: {}, end: 0, dark: sc.tone === "dark" ? 1 : 0 };
  };
  const lineCache = new WeakMap();
  function findLine(sb, id) {
    let m = lineCache.get(sb);
    if (!m) { m = {}; for (const sc of sb.scenes) for (const l of sc.lines) m[l.id] = l; lineCache.set(sb, m); }
    return m[id];
  }
})(globalThis.UZ = globalThis.UZ || {});
