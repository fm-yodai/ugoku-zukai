// ugoku-zukai プレーヤー: 配置の検査。各行の終わりと各動作の終わりのコマで、見えている部品の位置を調べる。
// Morph の 0.8 秒の途中のコマは調べない（途中の形は一瞬で、終わりのコマで調べる）。カメラで寄せている間は、body の clip の外を調べない
(function (UZ) {
  "use strict";

  function textBoxes(it) {
    const out = [];
    for (const t of it.texts || []) if (t.lines.some(Boolean)) out.push({ box: t.bbox, size: t.size, what: "text" });
    if (it.label) out.push({ box: it.label.bbox, size: it.label.size, what: "label" });
    if (it.kind === "mark") out.push({ box: it.bbox, size: 20, what: "mark" });
    return out;
  }
  const tf = (b, pl) => ({ x: pl.ox + b.x * pl.s, y: pl.oy + b.y * pl.s, w: b.w * pl.s, h: b.h * pl.s });

  UZ.checkLayout = function (M) {
    const issues = [], seen = new Set();
    const add = (kind, msg, at) => { const k = kind + msg; if (seen.has(k)) return; seen.add(k); issues.push({ kind, msg, at: +at.toFixed(2) }); };
    const times = new Set();
    for (const l of M.timeline.lines) times.add(l.start + l.dur);
    for (const a of M.acts) times.add(a.end + 0.01);
    // Morph の途中（[start, end)）の時刻は外す。act の終わり + 0.01 は times に入っている
    const morphs = M.acts.filter(a => a.verb === "morph");
    for (const t of [...times]) if (morphs.some(a => t >= a.start && t < a.end)) times.delete(t);
    // カメラ: 寄せる先が、動き終わっても出ていない（まだ show していない要素に寄る。配列なら、どれか 1 つでも）
    for (const a of M.acts) {
      if ((a.verb !== "zoom" && a.verb !== "pan") || !a.keys || !a.keys.length) continue;
      const fr = UZ.frame(M, a.end);
      if (!a.keys.every(k => fr.st[k] && fr.st[k].show >= 0.5)) add("カメラ", `行 ${a.line}: ${a.verb} の対象「${a.a[a.verb]}」がまだ出ていない（show してから寄る）`, a.start);
    }
    const B = UZ.AREA.body;
    const bounds = { x: B.x - 16, y: B.y - 40, w: B.w + 32, h: B.h + 52 };
    // テキストの部品は縮めない約束なので、区画に収まらなければ知らせる
    for (const sc of M.scenes) for (const fid of sc.figs) {
      if (M.figs[fid].type === "text" && sc.place[fid].s < 0.999) add("はみ出し", `${fid} のテキストが区画に収まらない（文を減らすか、区画を広げる）`, sc.start);
    }
    for (const t of [...times].sort((a, b) => a - b)) {
      if (t >= M.endCard) continue;
      const fr = UZ.frame(M, t);
      const vis = [];
      // 寄せている間は body の clip の外が見えない。はみ出しは調べず、clip の外にある部品は重なりも調べない
      const clip = fr.camera && fr.camera.on ? fr.camera.clip : null;
      const outside = b => clip && (b.x + b.w <= clip.x || b.y + b.h <= clip.y || b.x >= clip.x + clip.w || b.y >= clip.y + clip.h);
      for (const [fid, F] of Object.entries(M.figs)) {
        const ff = fr.figs[fid];
        if (!ff || ff.opacity < 0.9 || !ff.place) continue;
        for (const it of Object.values(F.items)) {
          if (it.kind === "group" || it.kind === "dot") continue;
          const s = fr.st[it.key];
          if (!s || s.show < 0.95 || s.dim < 0.5 || s.blur > 0.5) continue;
          vis.push({ it, pl: ff.place, s });
        }
      }
      const texts = [], boxes = [];
      for (const v of vis) {
        const off = v.s.off || [0, 0];
        const pl = { ...v.pl, ox: v.pl.ox + off[0] * v.pl.s, oy: v.pl.oy + off[1] * v.pl.s };
        const name = `${v.it.fig}/${v.it.id}`;
        // 大きさを変えた箱（resize）は、変えた後の形と、付いていった文字の位置で調べる
        const rz = v.s.rect || null, tOff = (rz && v.s.textOff) || [0, 0];
        const bbox = rz || (v.it.kind === "custom" && v.pl.w != null ? { x: 0, y: 0, w: v.pl.w, h: v.pl.h } : v.it.bbox);
        if (bbox && outside(tf(bbox, pl))) continue;
        if (bbox && v.it.kind !== "band" && !clip) {
          const b = tf(bbox, pl);
          if (b.x < bounds.x || b.y < bounds.y || b.x + b.w > bounds.x + bounds.w || b.y + b.h > bounds.y + bounds.h) add("はみ出し", `${name} が図の区画からはみ出す`, t);
        }
        for (const tb of textBoxes(v.it)) {
          const b = tf(tb.what === "text" ? { ...tb.box, x: tb.box.x + tOff[0], y: tb.box.y + tOff[1] } : tb.box, pl);
          if (tb.size * pl.s < UZ.MIN_FONT - 0.01) add("小さい", `${name} の文字が ${(tb.size * pl.s).toFixed(1)}px（${UZ.MIN_FONT}px 未満）`, t);
          if (!clip && (b.x < bounds.x || b.y < bounds.y || b.x + b.w > bounds.x + bounds.w || b.y + b.h > bounds.y + bounds.h)) add("はみ出し", `${name} の文字が図の区画からはみ出す`, t);
          texts.push({ name, b, it: v.it, what: tb.what });
        }
        if ((v.it.kind === "box" || v.it.kind === "frame") && bbox) boxes.push({ name, b: tf(bbox, pl), it: v.it, resized: !!rz });
      }
      // 大きくした箱が、他の箱にかかる（中にすっぽり入る・入れるのは構わない）
      const insideOf = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
      for (const A of boxes) {
        if (!A.resized) continue;
        for (const Bx of boxes) {
          if (Bx === A || Bx.it.kind === "frame" || A.it.fig !== Bx.it.fig) continue;
          if (insideOf(A.b, Bx.b) || insideOf(Bx.b, A.b)) continue;
          if (UZ.rectOverlap(A.b, Bx.b) > 20) add("重なり", `${A.name} の箱が、大きさを変えた後に ${Bx.name} の箱に重なる`, t);
        }
      }
      // 文字どうしの重なり
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const A = texts[i], Bt = texts[j];
        if (A.it === Bt.it) continue;
        const ov = UZ.rectOverlap(A.b, Bt.b);
        if (ov > 12 && ov > 0.06 * Math.min(A.b.w * A.b.h, Bt.b.w * Bt.b.h)) add("重なり", `${A.name} と ${Bt.name} の文字が重なる`, t);
      }
      // ラベル・注記が他の箱に重なる
      for (const T of texts) {
        if (T.what === "text" && (T.it.kind === "box" || T.it.kind === "frame" || T.it.kind === "rect")) continue;
        for (const Bx of boxes) {
          if (Bx.it === T.it || (Bx.it.members || []).includes(T.it.id) || T.it.parent === Bx.it.id || T.it.target === Bx.it.id || (T.it.over || []).includes(Bx.it.id)) continue;
          if (Bx.it.kind === "frame") {
            // 枠は中に入るのは構わない。縁をまたぐときだけ
            const inside = T.b.x >= Bx.b.x && T.b.y >= Bx.b.y && T.b.x + T.b.w <= Bx.b.x + Bx.b.w && T.b.y + T.b.h <= Bx.b.y + Bx.b.h;
            const ov = UZ.rectOverlap(T.b, Bx.b);
            if (!inside && ov > 20) add("重なり", `${T.name} が枠 ${Bx.name} の縁にかかる`, t);
            continue;
          }
          const ov = UZ.rectOverlap(T.b, Bx.b);
          if (ov > 20) add("重なり", `${T.name} が ${Bx.name} の箱に重なる`, t);
        }
      }
    }
    return issues;
  };
  // ---- custom の部品を描いて見る（DOM には触らない。受け取った el で描き、要素の木を読んで調べる） ----
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  function parseTransform(s) {
    let M = [1, 0, 0, 1, 0, 0];
    for (const m of String(s || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
      const a = (m[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || []).map(Number);
      let T = null;
      if (m[1] === "translate") T = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
      else if (m[1] === "scale") T = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
      else if (m[1] === "matrix" && a.length === 6) T = a;
      else if (m[1] === "rotate") { const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), n = Math.sin(r); T = [c, n, -n, c, 0, 0]; if (a.length === 3) T = mul(mul([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]); }
      if (T) M = mul(M, T);
    }
    return M;
  }
  // path の d から点を拾う（相対コマンドは現在位置に足す。曲線は制御点も含める＝少し大きめ。円弧は終点だけ）
  function pathPoints(d) {
    const pts = [], toks = String(d || "").match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
    let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
    const num = () => Number(toks[i++]);
    const N = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++]; else if (cmd === "M") cmd = "L"; else if (cmd === "m") cmd = "l";
      const c = cmd.toLowerCase(), rel = cmd === c, n = N[c];
      if (n == null) break;
      if (c === "z") { x = sx; y = sy; if (i < toks.length && !/[a-zA-Z]/.test(toks[i])) break; continue; }
      const a = []; for (let k = 0; k < n; k++) a.push(num());
      if (a.some(v => !Number.isFinite(v))) { pts.push([NaN, NaN]); continue; }
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (c === "h") x = a[0] + ox;
      else if (c === "v") y = a[0] + oy;
      else {
        for (let k = 0; k + 1 < n && c !== "a"; k += 2) pts.push([a[k] + ox, a[k + 1] + oy]);
        x = a[n - 2] + ox; y = a[n - 1] + oy;
      }
      if (c === "m") { sx = x; sy = y; }
      pts.push([x, y]);
    }
    return pts;
  }
  // 要素の木から、変換を積んだ外接矩形の点を集める。NaN・Infinity の属性は warn に渡す
  function walkPoints(e, M, out, warn) {
    const at = k => e.getAttribute(k), nm = k => { const v = parseFloat(at(k)); return Number.isFinite(v) ? v : 0; };
    for (const [k, v] of e.attrs) if (/NaN|Infinity/.test(v)) warn(e, k, v);
    const T = e.attrs.has("transform") ? mul(M, parseTransform(at("transform"))) : M;
    const add = (x, y) => out.push([T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]);
    switch (e.tagName) {
      case "line": add(nm("x1"), nm("y1")); add(nm("x2"), nm("y2")); break;
      case "circle": { const r = nm("r"); add(nm("cx") - r, nm("cy") - r); add(nm("cx") + r, nm("cy") + r); break; }
      case "ellipse": add(nm("cx") - nm("rx"), nm("cy") - nm("ry")); add(nm("cx") + nm("rx"), nm("cy") + nm("ry")); break;
      case "rect": add(nm("x"), nm("y")); add(nm("x") + nm("width"), nm("y") + nm("height")); break;
      case "path": for (const p of pathPoints(at("d"))) add(p[0], p[1]); break;
      case "polyline": case "polygon": { const a = (at("points") || "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || []; for (let k = 0; k + 1 < a.length; k += 2) add(+a[k], +a[k + 1]); break; }
      case "text": {
        const size = nm("font-size") || 16, w = UZ.textW(e.textContent, size), x = nm("x"), y = nm("y"), an = at("text-anchor");
        const x0 = an === "middle" ? x - w / 2 : an === "end" ? x - w : x;
        const mid = at("dominant-baseline") === "central";
        add(x0, mid ? y - size / 2 : y - size * 0.8); add(x0 + w, mid ? y + size / 2 : y + size * 0.2); break;
      }
    }
    for (const c of e.childNodes || []) walkPoints(c, T, out, warn);
  }
  const SPILL = 8;

  // custom の部品を、見えている時刻で描いて検査する。時刻は、部品が見えている各行の終わり・各 set の終わり・set の 1/3 と 2/3。
  // el は svg 要素を作る関数（view_svg.js と同じ形）。返す errors は誤り、warnings は警告
  // opts.call(fn, args) = 関数を呼ぶ口（node の道具は、ここで時間の上限を掛ける。打ち切ったら e.uzTimeout = 上限のミリ秒の例外を投げる）
  // opts.slowMs = 1 回の描画の平均がこれを超えたら警告（毎コマ呼ばれるので、再生が引っかかる。既定 30）
  // 同じ部品の同じ知らせは 1 件にまとめ、最初の行と、ほかに出た行の数を添える
  UZ.checkCustoms = function (M, el, opts = {}) {
    const errors = [], warnings = [], found = new Map();
    const call = opts.call || ((fn, a) => fn(a)), slowMs = opts.slowMs ?? 30;
    const now = () => (globalThis.performance || Date).now();
    // kind が同じ知らせは 1 件にまとめる（はみ出しは座標が時刻ごとに違うので、kind で束ねる）
    const note = (list, lineId, partId, body, kind = body) => {
      const key = (list === errors ? "e" : "w") + "\0" + partId + "\0" + kind, f = found.get(key);
      if (f) { f.lines.add(lineId); f.n++; return; }
      found.set(key, { list, partId, body, line: lineId, lines: new Set([lineId]), n: 1 });
    };
    const parts = [];
    for (const F of Object.values(M.figs)) for (const it of Object.values(F.items)) if (it.kind === "custom") parts.push({ F, it });
    if (!parts.length) return { errors, warnings };
    const times = [];   // [t, 行の id]
    for (const l of M.timeline.lines) times.push([l.start + l.dur, l.id]);
    for (const a of M.acts) if (a.verb === "set") {
      const d = a.end - a.start;
      times.push([a.end, a.line], [a.start + d / 3, a.line], [a.start + d * 2 / 3, a.line]);
    }
    const fns = {};
    for (const { F, it } of parts) {
      if (it.fn in fns) continue;
      try { fns[it.fn] = new Function("return (" + M.sb.custom[it.fn] + ")")(); }
      catch (e) { fns[it.fn] = null; note(errors, null, F.id, `custom「${it.fn}」を読み込めない（${String(e && e.message || e)}）`); }
    }
    const stopped = new Set(), cost = {};   // stopped = 時間切れになった部品（もう呼ばない）。cost = 部品ごとの [合計ミリ秒, 回数]
    for (const [t, lineId] of times) {
      if (t >= M.endCard) continue;
      const fr = UZ.frame(M, t);
      for (const { F, it } of parts) {
        const fo = fr.figs[F.id], s = fr.st[it.key], fn = fns[it.fn];
        if (!fn || stopped.has(it.key) || !fo || fo.opacity <= 0.002 || !s || s.show <= 0.002) continue;
        const add = (list, body, kind) => note(list, lineId, F.id, body, kind);
        const root = el("g"), S = F.dark ? UZ.darkStyleOf(M.S) : M.S, geo = UZ.makeGeo(el, S);
        const t0 = now();
        // 描き場の大きさは、そのコマの区画（場面ごとに変わる。再生ページと同じ値）
        const W = fo.place && fo.place.w != null ? fo.place.w : it.w, H = fo.place && fo.place.w != null ? fo.place.h : it.h;
        try { call(fn, { g: root, v: fr.values || {}, t: fr.t, el, S, UZ, geo, w: W, h: H }); }
        catch (e) {
          if (e && e.uzTimeout) { stopped.add(it.key); add(errors, `関数が ${e.uzTimeout / 1000} 秒で終わらない（止まらない繰り返しか、繰り返しの数が多すぎる。再生ページが固まる）`, "timeout"); }
          else add(errors, `関数が例外を投げた（${String(e && e.message || e)}）`);
          continue;
        }
        const c = cost[it.key] || (cost[it.key] = [0, 0, F.id]); c[0] += now() - t0; c[1]++;
        for (const m of geo.errors) add(errors, m);
        const pts = [];
        walkPoints(root, [1, 0, 0, 1, 0, 0], pts, (e, k, v) => add(warnings, `要素 <${e.tagName}> の属性 ${k} が ${v}`));
        const ok = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!ok.length) continue;
        const x0 = Math.min(...ok.map(p => p[0])), x1 = Math.max(...ok.map(p => p[0])), y0 = Math.min(...ok.map(p => p[1])), y1 = Math.max(...ok.map(p => p[1]));
        if (x0 < -SPILL || y0 < -SPILL || x1 > W + SPILL || y1 > H + SPILL)
          add(warnings, `描いたものが部品の区画（0〜${Math.round(W)} × 0〜${Math.round(H)}）からはみ出す（x ${x0.toFixed(0)}〜${x1.toFixed(0)}、y ${y0.toFixed(0)}〜${y1.toFixed(0)}）`, "spill");
      }
    }
    for (const [sum, n, figId] of Object.values(cost)) if (n && sum / n > slowMs)
      note(warnings, null, figId, `1 回の描画に平均 ${Math.round(sum / n)}ms かかる（毎コマ呼ばれるので、再生が引っかかる。${slowMs}ms 以下を目安に、分割の数や繰り返しを減らす）`, "slow");
    for (const f of found.values()) {
      const more = f.lines.size > 1 ? `（ほか ${f.lines.size - 1} 行でも）` : f.n > 1 ? `（ほかの時刻でも）` : "";
      f.list.push(`${f.line ? `行 ${f.line}: ` : ""}部品「${f.partId}」: ${f.body}${more}`);
    }
    return { errors, warnings };
  };
})(globalThis.UZ = globalThis.UZ || {});
