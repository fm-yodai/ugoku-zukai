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
    // カメラ: 寄せる先が、動き終わっても出ていない（まだ show していない要素に寄る）
    for (const a of M.acts) {
      if ((a.verb !== "zoom" && a.verb !== "pan") || !a.keys || !a.keys.length) continue;
      const fr = UZ.frame(M, a.end);
      if (!a.keys.some(k => fr.st[k] && fr.st[k].show >= 0.5)) add("カメラ", `行 ${a.line}: ${a.verb} の対象「${a.a[a.verb]}」がまだ出ていない（show してから寄る）`, a.start);
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
        const bbox = rz || v.it.bbox;
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
})(globalThis.UZ = globalThis.UZ || {});
