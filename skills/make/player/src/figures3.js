// ugoku-zukai プレーヤー: スライドの部品のうち、図でないもの（テキスト・画像・フレーム・自由描画）。
// どれも図と同じ約束で { w, h, items, order } を返す。区画の大きさに合わせて配置する（ctx.area）。
(function (UZ) {
  "use strict";
  const FIG = UZ.FIG;

  // 文中の **語** を外し、強調の範囲（外した後の文字位置。終わりは含まない）を返す
  UZ.parseEm = function (s) {
    const src = String(s), ranges = [];
    let text = "", last = 0, m;
    const re = /\*\*([^*]+)\*\*/g;
    while ((m = re.exec(src))) {
      text += src.slice(last, m.index);
      const from = [...text].length;
      text += m[1];
      ranges.push([from, [...text].length]);
      last = m.index + m[0].length;
    }
    text += src.slice(last);
    return { text, ranges };
  };

  // 折り返した文字の塊。強調があれば spans（行ごとの [{ t, em }]）を付ける。x・top は左上
  function block(raw, x, top, size, maxW, o) {
    const { text, ranges } = UZ.parseEm(raw);
    const lineH = Math.round(size * 1.6), weight = o.weight || 400;
    const lines = [], spans = [];
    let off = 0;
    for (const para of text.split("\n")) {
      for (const ln of UZ.wrap(para, size, maxW, weight, 99)) {
        const chars = [...ln], row = [];
        chars.forEach((c, i) => {
          const em = ranges.some(([a, b]) => off + i >= a && off + i < b);
          const lastSeg = row[row.length - 1];
          if (lastSeg && lastSeg.em === em) lastSeg.t += c; else row.push({ t: c, em });
        });
        lines.push(ln); spans.push(row.length ? row : [{ t: "", em: false }]);
        off += chars.length;
      }
      off += 1;   // 改行
    }
    const T = UZ.mkText(lines, x, top + lines.length * lineH / 2, size, { anchor: "start", weight, color: o.color, lineH });
    if (ranges.length) T.spans = spans;
    return T;
  }

  // ======== テキスト（text）========
  // 既定の文字の大きさ（1280×720 の画面の px）。利用者の要望があれば、ブロックの size で変える
  const SIZE = { heading: 26, para: 24, bullets: 24, quote: 28 };
  UZ.TEXT_KINDS = Object.keys(SIZE);
  FIG.text = {
    async layout(f, S, ctx) {
      const W = (ctx && ctx.area ? ctx.area.w : UZ.AREA.body.w);
      const items = [], order = [];
      let y = 0, prevKind = null;
      for (const b of f.blocks) {
        if (prevKind) y += prevKind === "heading" ? 6 : 18;
        const size = typeof b.size === "number" ? b.size : SIZE[b.kind];
        if (b.kind === "heading") {
          const T = block(b.text, 0, y, size, W, { weight: S.bold, color: S.ink });
          items.push({ id: b.id, kind: "text", texts: [T], bbox: { x: 0, y, w: T.bbox.w, h: T.bbox.h } });
          order.push(b.id); y += T.bbox.h;
        } else if (b.kind === "para") {
          const T = block(b.text, 0, y, size, W, { color: S.ink });
          items.push({ id: b.id, kind: "text", texts: [T], bbox: { x: 0, y, w: T.bbox.w, h: T.bbox.h } });
          order.push(b.id); y += T.bbox.h;
        } else if (b.kind === "bullets") {
          const members = [];
          b.items.forEach((s, i) => {
            if (i) y += 8;
            const id = `${b.id}.${i + 1}`;
            const T = block(s, 28, y, size, W - 28, { color: S.ink });
            items.push({ id, kind: "text", texts: [T], bullet: { kind: "dot", x: 10, y: y + T.lineH / 2, r: 5 }, bbox: { x: 0, y, w: 28 + T.bbox.w, h: T.bbox.h }, parent: b.id });
            members.push(id); order.push(id); y += T.bbox.h;
          });
          items.push({ id: b.id, kind: "group", members });
        } else if (b.kind === "quote") {
          const pad = 18;
          const T = block(b.text, pad, y + pad, size, W - pad * 2, { weight: 500, color: S.ink });
          const texts = [T];
          let h = T.bbox.h + pad * 2;
          const src = [].concat(b.source || []).filter(x => typeof x === "string").join(" / ");
          if (src) {
            const ST = block(src, pad, y + pad + T.bbox.h + 8, 15, W - pad * 2, { color: S.muted });
            texts.push(ST); h += ST.bbox.h + 8;
          }
          items.push({ id: b.id, kind: "text", texts, panel: { x: 0, y, w: W, h, r: S.radius, fill: S.surface, stroke: S.line }, bbox: { x: 0, y, w: W, h } });
          order.push(b.id); y += h;
        }
        prevKind = b.kind;
      }
      // 強調の色は、組んだときの地の色（暗い地のスライドでは chapter.accent）
      for (const it of items) for (const T of it.texts || []) if (T.spans) T.emColor = S.accent;
      // 幅は区画いっぱい。拡大しない（文字の大きさを保つ）。区画の上に寄せる
      return { w: W, h: Math.max(y, 1), items, order, maxScale: 1, valign: "top" };
    },
  };

  // ======== フレーム（frame）========
  // 区画いっぱいの囲み。他の部品と同じ区画に重ねて、部品をまとめる枠にする（台本で、中に入る部品より前に書く）
  FIG.frame = {
    async layout(f, S, ctx) {
      const W = ctx.area.w, H = ctx.area.h;
      const items = [{ id: "box", kind: "text", texts: [], panel: { x: 0, y: 0, w: W, h: H, r: S.radius, fill: S.surface, stroke: S.line }, bbox: { x: 0, y: 0, w: W, h: H } }];
      if (f.title) {
        const T = UZ.mkText([String(f.title)], 16, 24, 18, { anchor: "start", weight: S.bold, color: S.muted });
        items.push({ id: "title", kind: "text", texts: [T], bbox: { ...T.bbox } });
      }
      return { w: W, h: H, items, order: items.map(i => i.id), maxScale: 1 };
    },
  };

  // ======== 自由描画（custom）========
  // 区画いっぱいの描き場。中身は台本の custom の関数（draw で名前を指す）が毎コマ描く（view_svg.js）。
  // 項目は 1 つ（draw）。出し方・薄くする・カメラは、ほかの部品と同じくこの項目と図に掛かる
  FIG.custom = {
    async layout(f, S, ctx) {
      const W = ctx.area.w, H = ctx.area.h;
      const items = [{ id: "draw", kind: "custom", fn: f.draw, x: 0, y: 0, w: W, h: H, bbox: { x: 0, y: 0, w: W, h: H } }];
      return { w: W, h: H, items, order: ["draw"], maxScale: 1 };
    },
  };

  // ======== 画像（image）========
  // 画像の大きさ（ctx.assets[src] の w・h）をそのまま図の大きさにし、区画に収まる最大まで伸び縮みさせる
  FIG.image = {
    async layout(f, S, ctx) {
      const a = ctx.assets[f.src];
      return { w: a.w, h: a.h, items: [{ id: "img", kind: "image", src: f.src, x: 0, y: 0, w: a.w, h: a.h, bbox: { x: 0, y: 0, w: a.w, h: a.h } }], order: ["img"], fixed: true };
    },
  };
})(globalThis.UZ = globalThis.UZ || {});
