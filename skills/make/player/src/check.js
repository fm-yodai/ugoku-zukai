// ugoku-zukai プレーヤー: 配置の検査。各行の終わりと各動作の終わりのコマで、見えている部品の位置を調べる
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
      for (const [fid, F] of Object.entries(M.figs)) {
        const ff = fr.figs[fid];
        if (!ff || ff.opacity < 0.9 || !ff.place) continue;
        for (const it of Object.values(F.items)) {
          if (it.kind === "group" || it.kind === "dot") continue;
          const s = fr.st[it.key];
          if (!s || s.show < 0.95 || s.dim < 0.5) continue;
          vis.push({ it, pl: ff.place, s });
        }
      }
      const texts = [], boxes = [];
      for (const v of vis) {
        const off = v.s.off || [0, 0];
        const pl = { ...v.pl, ox: v.pl.ox + off[0] * v.pl.s, oy: v.pl.oy + off[1] * v.pl.s };
        const name = `${v.it.fig}/${v.it.id}`;
        if (v.it.bbox && v.it.kind !== "band") {
          const b = tf(v.it.bbox, pl);
          if (b.x < bounds.x || b.y < bounds.y || b.x + b.w > bounds.x + bounds.w || b.y + b.h > bounds.y + bounds.h) add("はみ出し", `${name} が図の区画からはみ出す`, t);
        }
        for (const tb of textBoxes(v.it)) {
          const b = tf(tb.box, pl);
          if (tb.size * pl.s < UZ.MIN_FONT - 0.01) add("小さい", `${name} の文字が ${(tb.size * pl.s).toFixed(1)}px（${UZ.MIN_FONT}px 未満）`, t);
          if (b.x < bounds.x || b.y < bounds.y || b.x + b.w > bounds.x + bounds.w || b.y + b.h > bounds.y + bounds.h) add("はみ出し", `${name} の文字が図の区画からはみ出す`, t);
          texts.push({ name, b, it: v.it, what: tb.what });
        }
        if ((v.it.kind === "box" || v.it.kind === "frame") && v.it.bbox) boxes.push({ name, b: tf(v.it.bbox, pl), it: v.it });
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
