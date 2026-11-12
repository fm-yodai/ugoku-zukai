#!/usr/bin/env node
// スライド（R4 第 1 部）の検査。node test_slides.cjs で回す。
// 場面がスライドを指す形（/3）・区画・言いたいこと・テキスト・画像・フレーム・完成形・blur
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const EX = path.join(__dirname, "..", "..", "examples");
const FLOW = JSON.parse(fs.readFileSync(path.join(EX, "graph-flow.json"), "utf8")).figures.flow;
const LIST = [{ id: "a", text: "一つ目" }, { id: "b", text: "二つ目" }];
const deck = (slides, scenes, figures = {}, format = "ugoku-zukai/3") => ({ format, title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes });
const SC = (id, slide, lines) => ({ id, slide, lines: lines || [{ id: "l_" + id, text: "説明します。" }] });
const build = (sb, o) => UZ.build(sb, TH, null, o);
const lineEnd = (M, id) => { const l = M.timeline.lines.find(x => x.id === id); return l.start + l.dur; };
const showAt = (M, key, t) => { const s = UZ.frame(M, t).st[key]; return s ? s.show : 0; };
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const hasWarn = (M, re) => assert.ok((M.warnings || []).some(e => re.test(e)), `警告に ${re} がない: ${JSON.stringify(M.warnings)}`);
const TWO = { p1: { title: "見出し", parts: [
  { figure: "flow", area: { col: [1, 7], row: [1, 6] } },
  { id: "pts", type: "list", items: LIST, area: { col: [8, 12], row: [1, 6] } }] } };

const tests = {
  // ---- Task 1 ----
  async slide_scene_areas() {
    const M = await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }, { show: "pts" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const sc = M.scenes[0];
    assert.deepStrictEqual(sc.figs, ["flow", "pts"]);
    assert.strictEqual(sc.header, "見出し");
    assert.strictEqual(sc.slide, "p1");
    const cw = (1184 - 24 * 11) / 12;
    assert.ok(Math.abs(sc.areas[0].w - (cw * 7 + 24 * 6)) < 0.01);
    assert.ok(Math.abs(sc.areas[1].x - (48 + (cw + 24) * 7)) < 0.01);
    assert.strictEqual(sc.areas[0].y, 104); assert.strictEqual(sc.areas[0].h, 470);
    assert.ok(showAt(M, "pts/a", M.duration) > 0.99);
    assert.deepStrictEqual(M.slides.p1.figs, ["flow", "pts"]);
    assert.deepStrictEqual(M.slides.p1.scenes, ["s1"]);
  },
  async statement_shrinks_body() {
    const M = await build(deck({ p1: { title: "見出し", statement: "短い 1 文です。", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].areas[0].y, 104 + 48);
    assert.strictEqual(M.scenes[0].areas[0].h, 470 - 48);
    assert.deepStrictEqual(UZ.frame(M, M.scenes[0].start + 2).statement.lines, ["短い 1 文です。"]);
  },
  async slide_reused_later() {
    const slides = { ...TWO, p2: { title: "別", parts: [{ id: "other", type: "list", items: [{ id: "x", text: "別の話" }] }] } };
    const M = await build(deck(slides, [
      SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }] }]),
      SC("s2", "p2", [{ id: "l2", text: "別の話です。", do: [{ show: "other" }] }]),
      SC("s3", "p1", [{ id: "l3", text: "戻ります。" }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(showAt(M, "flow/app", lineEnd(M, "l3")) > 0.99, "戻っても出たまま");
    assert.deepStrictEqual(M.scenes[2].areas, M.scenes[0].areas);
    assert.ok(UZ.frame(M, lineEnd(M, "l3")).figs.flow.opacity > 0.99);
    assert.deepStrictEqual(M.slides.p1.scenes, ["s1", "s3"]);
  },
  async part_id_collision() {
    const p = id => ({ title: "t", parts: [{ id: "pts", type: "list", items: LIST }] });
    hasErr(await build(deck({ p1: p(), p2: p() }, [SC("s1", "p1"), SC("s2", "p2")])), /部品「pts」.*重複/);
    hasErr(await build(deck({ p1: { title: "t", parts: [{ id: "flow", type: "list", items: LIST }] } }, [SC("s1", "p1")], { flow: FLOW })), /部品「flow」.*重複/);
  },
  async shared_figure_ok() {
    const M = await build(deck({ p1: { title: "a", parts: [{ figure: "flow" }] }, p2: { title: "b", parts: [{ figure: "flow" }] } },
      [SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }] }]), SC("s2", "p2")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
  },
  async bad_shapes() {
    const one = parts => deck({ p1: { title: "t", parts } }, [SC("s1", "p1")], { flow: FLOW });
    hasErr(await build(deck(TWO, [{ id: "s1", slide: "p1", figure: "flow", lines: [{ id: "l1", text: "あ。" }] }], { flow: FLOW })), /slide か figure のどちらか/);
    hasErr(await build(deck(TWO, [SC("s1", "px")], { flow: FLOW })), /スライド「px」が slides にない/);
    for (const area of [{ col: [0, 5], row: [1, 6] }, { col: [5, 13], row: [1, 6] }, { col: [1, 6], row: [3, 2] }, { col: [1, 6] }])
      hasErr(await build(one([{ figure: "flow", area }])), /area/);
    hasErr(await build(one([{ figure: "flow", area: { col: [1, 6], row: [1, 6] } }, { id: "pts", type: "list", items: LIST }])), /area が要る/);
    hasErr(await build(one([{ figure: "flow", area: { col: [1, 7], row: [1, 6] } }, { id: "pts", type: "list", items: LIST, area: { col: [7, 12], row: [1, 6] } }])), /完成形で重なる/);
    const tr = await build(one([{ figure: "flow", area: { col: [1, 7], row: [1, 6] } }, { id: "pts", type: "list", items: LIST, area: { col: [7, 12], row: [1, 6] }, transient: true }]));
    assert.ok(!(tr.errors || []).some(e => /完成形で重なる/.test(e)), "transient の部品は重なってよい");
    hasErr(await build(deck({ p1: { title: "t", start: "empty", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /start は "complete"/);
    hasErr(await build(deck({ p1: { parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /title がない/);
    hasErr(await build(deck({ p1: { title: "t", parts: [] } }, [SC("s1", "p1")], { flow: FLOW })), /parts/);
    hasErr(await build(one([{ figure: "nai" }])), /図「nai」が figures にない/);
    hasWarn(await build(deck({ p1: { title: "t", statement: "とても長い言いたいことの文を書くと画面の幅を超えて折り返しが起きますがそれが三行以上に及ぶような長さの文になってしまうと読み切れないので警告を出して知らせることにしていますのでこの文はその警告が出ることを確かめるためにわざと長く書いてあります。", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /言いたいことが 2 行に収まらない/);
    hasErr(await build(deck(TWO, [SC("s1", "p1")], { flow: FLOW }, "ugoku-zukai/2")), /slides を使うには format を "ugoku-zukai\/3"/);
  },
  async legacy_unchanged() {
    const sb = JSON.parse(fs.readFileSync(path.join(EX, "sequence.json"), "utf8"));
    assert.strictEqual(sb.format, "ugoku-zukai/2");
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].slide, null);
    const single = M.scenes.find(s => s.figs.length === 1 && !s.captions.length);
    assert.deepStrictEqual(single.areas[0], UZ.AREA.body);
    assert.deepStrictEqual(UZ.frame(M, 3).statement.lines, []);
  },
};

(async () => {
  const only = process.argv[2];
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    if (only && !name.includes(only)) continue;
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { fail++; console.log(`NG   ${name}\n     ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n     ")}`); }
  }
  console.log(fail ? `スライドの検査: NG ${fail} 件` : "スライドの検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
