#!/usr/bin/env node
// 台本と構成メモ（/2 = 3 段の意図）の突き合わせの検査: スライドの id と章を照らす。node test_outline_pair.cjs で回す
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const { loadAssets } = require("../assets.cjs");
const { checkAgainstOutline } = require("../outline_check.cjs");
const UZ = load();
const EX = path.join(__dirname, "..", "..", "examples");
const SBP = path.join(EX, "slide-forms.json");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const outline = () => read(path.join(EX, "outlines", "slide-forms.json"));
async function run(o, opts, edit) {
  const sb = read(SBP);
  if (edit) edit(sb);
  const M = await UZ.build(sb, theme("koo"), null, { assets: loadAssets(SBP, sb) });
  assert.deepStrictEqual(M.errors, []);
  return checkAgainstOutline(sb, M, o, opts || {});
}
const has = (list, re) => assert.ok(list.some(x => re.test(x)), `${re} がない: ${JSON.stringify(list)}`);

const tests = {
  async ok_pair() {
    const r = await run(outline(), { complete: true });
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.warnings.filter(w => /スライド/.test(w)), []);
    assert.deepStrictEqual(r.slides, [
      { id: "relation", chapter: "c1", in_storyboard: true }, { id: "definitions", chapter: "c2", in_storyboard: true },
      { id: "ux-def", chapter: "c2", in_storyboard: true }, { id: "whose", chapter: "c3", in_storyboard: true }]);
  },
  async missing_in_storyboard() {
    const o = outline();
    o.chapters[0].slides.push({ id: "extra", intent: { text: "x", by: "claude", state: "agreed" } });
    let r = await run(o);
    has(r.warnings, /スライド「extra」が台本にない/);
    assert.ok(!r.errors.some(e => /extra/.test(e)));
    assert.deepStrictEqual(r.slides.find(s => s.id === "extra"), { id: "extra", chapter: "c1", in_storyboard: false });
    r = await run(o, { complete: true });
    has(r.errors, /スライド「extra」が台本にない/);
  },
  async missing_in_outline() {
    const o = outline();
    o.chapters[2].slides = [];
    has((await run(o)).warnings, /スライド「whose」が構成メモにない（意図を書く）/);
    has((await run(o, { complete: true })).errors, /スライド「whose」が構成メモにない/);
  },
  async wrong_chapter() {
    const o = outline();
    o.chapters[0].slides.push(o.chapters[1].slides.shift());   // definitions を c1 へ
    has((await run(o)).errors, /スライド「definitions」: 構成メモでは章「c1」だが、台本で最初に使う場面「s3」は章「c2」/);
  },
  async order() {
    const o = outline();
    o.chapters[1].slides.reverse();
    const r = await run(o);
    assert.deepStrictEqual(r.errors, []);
    has(r.warnings, /章「c2」: スライドの順が台本と違う/);
  },
  async unused_slide_ignored() {   // 台本の slides にあるが、どの場面も使わないスライドは、構成メモになくてよい
    const r = await run(outline(), { complete: true }, sb => { sb.slides.spare = { title: "予備", parts: [{ id: "sp", type: "list", items: [{ id: "x", text: "予備" }] }] }; });
    assert.ok(!r.errors.concat(r.warnings).some(x => /spare/.test(x)));
  },
  async v1_outline_unchanged() {
    const dir = path.join(__dirname, "outlines", "pair");
    const sb = read(path.join(dir, "storyboard.json"));
    const M = await UZ.build(sb, theme("koo"), null);
    const r = checkAgainstOutline(sb, M, read(path.join(dir, "outline.json")), {});
    assert.deepStrictEqual(r.errors, []);
    assert.ok(!r.warnings.some(w => /スライド/.test(w)));
    assert.deepStrictEqual(r.slides, []);
  },
};
(async () => {
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { fail++; console.log(`NG   ${name}\n     ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n     ")}`); }
  }
  console.log(fail ? `構成メモとスライドの突き合わせ: NG ${fail} 件` : "構成メモとスライドの突き合わせ: すべて OK");
  process.exit(fail ? 1 : 0);
})();
