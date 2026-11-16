#!/usr/bin/env node
// 通し 4 の改善点 6: スライドの部品を区画に合わせて組む（fill）と、区画の中の揃え（valign・halign）の検査。node test_fill.cjs で回す。
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const deck = parts => ({ format: "ugoku-zukai/3", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures: {},
  slides: { p1: { title: "見出し", parts } },
  scenes: [{ id: "s1", slide: "p1", lines: [{ id: "l1", text: "説明します。", do: parts.filter(p => p.type !== "frame").map(p => ({ show: p.id })) }] }] });
const build = sb => UZ.build(sb, TH, null);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const FULL = { col: [1, 12], row: [1, 6] };
const TABLE = { id: "t", type: "table", area: FULL, columns: [{ id: "a", label: "名前" }, { id: "b", label: "中身" }],
  rows: [{ id: "r1", cells: ["診断", "専門家のレビューと少人数のテスト"] }, { id: "r2", cells: ["伴走", "リリース後の改善の繰り返し"] }] };
const LIST = { id: "l", type: "list", numbered: true, area: { col: [1, 7], row: [1, 4] },
  items: [{ id: "a1", text: "気づく", sub: "顧客の言葉を聞き取る" }, { id: "a2", text: "説明する", sub: "一言で伝える" }, { id: "a3", text: "つなぐ", sub: "相談先に渡す" }] };
const CYCLE = { id: "c", type: "cycle", area: { col: [1, 7], row: [1, 6] }, center: "中心",
  steps: [{ id: "s1", label: "調べる" }, { id: "s2", label: "決める" }, { id: "s3", label: "作る" }, { id: "s4", label: "確かめる" }] };
const areaOf = (M, fid) => { const sc = M.scenes[0]; return sc.areas[sc.figs.indexOf(fid)]; };
const placed = (M, fid) => { const p = M.scenes[0].place[fid], F = M.figs[fid]; return { x: p.ox + F.x0 * p.s, y: p.oy + F.y0 * p.s, w: (F.x1 - F.x0) * p.s, h: (F.y1 - F.y0) * p.s, s: p.s }; };
const cellSize = (M, fid, id) => M.figs[fid].items[id].texts[0].size * M.scenes[0].place[fid].s;

const tests = {
  async table_fills_area() {
    const M = await build(deck([TABLE]));
    assert.deepStrictEqual(M.errors, []);
    const A = areaOf(M, "t"), P = placed(M, "t");
    assert.ok(M.figs.t.extra.fillK >= 1, "区画に合わせて組んでいない");
    assert.ok(Math.abs(P.w - A.w) < 1, `幅が区画いっぱいでない（${P.w} / ${A.w}）`);
    assert.strictEqual(P.s, 1);
    assert.ok(cellSize(M, "t", "r1.b") >= 20, "文字が既定より小さい");
    // 余った高さを行に配る（既定の組み方より行が高い）
    const M0 = await build(deck([{ ...TABLE, fit: "content" }]));
    assert.ok(M.figs.t.items.r1.h > M0.figs.t.items.r1.h * M0.scenes[0].place.t.s, "行が高くなっていない");
  },
  async fit_content_keeps_old_layout() {
    const M = await build(deck([{ ...TABLE, fit: "content" }]));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.figs.t.extra.fillK, undefined);
    assert.ok(placed(M, "t").w < areaOf(M, "t").w - 1, "fit: content でも区画いっぱいになっている");
  },
  async list_fills_width_and_left() {
    const M = await build(deck([LIST]));
    assert.deepStrictEqual(M.errors, []);
    const A = areaOf(M, "l"), P = placed(M, "l");
    assert.ok(M.figs.l.extra.fillK >= 1);
    assert.ok(Math.abs(P.x - A.x) < 1, "左に揃っていない");
    assert.ok(P.h <= A.h + 1);
    assert.ok(P.h > A.h * 0.8, `高さが区画の 8 割に満たない（${P.h} / ${A.h}）`);
  },
  async cycle_wide_area_gets_wide_ring() {
    const M = await build(deck([{ ...CYCLE, area: FULL }]));
    assert.deepStrictEqual(M.errors, []);
    const A = areaOf(M, "c"), P = placed(M, "c");
    assert.ok(M.figs.c.extra.fillK >= 1);
    assert.ok(P.w > A.w * 0.85 || P.h > A.h * 0.85, "区画を使い切っていない");
    // 横に広い区画では、組み方なしより大きい
    const M0 = await build(deck([{ ...CYCLE, area: FULL, fit: "content" }]));
    assert.ok(P.w * P.h > placed(M0, "c").w * placed(M0, "c").h * 1.05);
  },
  async no_extra_wrapping() {
    // 大きい文字を選んでも、k = 1 のときより折り返しを増やさない
    const M = await build(deck([TABLE]));
    const k1 = await UZ.FIG.table.layout(UZ.figuresOf(deck([TABLE])).t, M.S, { fill: { w: areaOf(M, "t").w, h: areaOf(M, "t").h, k: 1 } });
    assert.ok(M.figs.t.extra.lineCount <= k1.lineCount);
  },
  async align() {
    const small = { id: "l", type: "list", fit: "content", area: FULL, items: [{ id: "a", text: "短い" }] };
    for (const [va, ha] of [["top", "start"], ["bottom", "end"], ["middle", "center"]]) {
      const M = await build(deck([{ ...small, valign: va, halign: ha }]));
      assert.deepStrictEqual(M.errors, []);
      const A = areaOf(M, "l"), P = placed(M, "l");
      if (va === "top") assert.ok(Math.abs(P.y - A.y) < 1, "上に揃っていない");
      if (va === "bottom") assert.ok(Math.abs(P.y + P.h - (A.y + A.h)) < 1, "下に揃っていない");
      if (va === "middle") assert.ok(Math.abs(P.y + P.h / 2 - (A.y + A.h / 2)) < 1, "上下の中央でない");
      if (ha === "start") assert.ok(Math.abs(P.x - A.x) < 1, "左に揃っていない");
      if (ha === "end") assert.ok(Math.abs(P.x + P.w - (A.x + A.w)) < 1, "右に揃っていない");
    }
    // テキストの既定は上。valign: middle で上下の中央にできる
    const text = { id: "x", type: "text", area: FULL, blocks: [{ id: "p", kind: "para", text: "一行" }] };
    const T0 = await build(deck([text]));
    assert.ok(Math.abs(placed(T0, "x").y - areaOf(T0, "x").y) < 1);
    const T1 = await build(deck([{ ...text, valign: "middle" }]));
    const P = placed(T1, "x"), A = areaOf(T1, "x");
    assert.ok(Math.abs(P.y + P.h / 2 - (A.y + A.h / 2)) < 1, "テキストが上下の中央でない");
  },
  async errors() {
    hasErr(await build(deck([{ ...LIST, valign: "center" }])), /valign は top \/ middle \/ bottom/);
    hasErr(await build(deck([{ ...LIST, halign: "left" }])), /halign は start \/ center \/ end/);
    hasErr(await build(deck([{ ...LIST, fit: "auto" }])), /fit は fill か content/);
  },
};

(async () => {
  let ng = 0;
  const only = process.argv[2];
  for (const [name, fn] of Object.entries(tests)) {
    if (only && !name.includes(only)) continue;
    try { await fn(); console.log("ok   " + name); } catch (e) { ng++; console.log("NG   " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     ")); }
  }
  console.log(ng ? `NG ${ng} 件` : "すべて OK");
  process.exit(ng ? 1 : 0);
})();
