#!/usr/bin/env node
// M9（立体と奥行き）の検査。node test_m9.cjs [名前の一部] で回す。
// タスクが進むごとに、ここに検査を足す
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");

// 台本の形式 /6 の小さな台本。extra は最上位の項目（values など）に重ねる
const deck6 = (slides, scenes, figures = {}, extra = {}) => ({ format: "ugoku-zukai/6", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes, ...extra });
const SC = (id, slide, lines) => ({ id, slide, lines: lines || [{ id: "l_" + id, text: "説明します。" }] });
const build = (sb, o) => UZ.build(sb, TH, null, o);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const hasWarn = (M, re) => assert.ok((M.warnings || []).some(e => re.test(e)), `警告に ${re} がない: ${JSON.stringify(M.warnings)}`);
const L1 = { type: "list", items: [{ id: "i1", text: "項目" }] };

// view_svg.js を node の最小の DOM で読む（frames.cjs と同じ）
let viewLoaded = false;
function loadView() {
  if (viewLoaded) return;
  const fs = require("fs"), path = require("path"), vm = require("vm");
  globalThis.document = require("../svg_dom.cjs").makeDocument();
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../player/src/view_svg.js"), "utf8"), { filename: "view_svg.js" });
  viewLoaded = true;
}
const renderSvg = (M, t, frameOverride) => {
  loadView();
  const { serialize } = require("../svg_dom.cjs");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const orig = UZ.frame;
  if (frameOverride) UZ.frame = () => frameOverride;
  try { new UZ.View(svg, M).render(t); } finally { UZ.frame = orig; }
  return serialize(svg);
};

const tests = {
  async format6_accepted() {
    assert.strictEqual(UZ.FORMAT, "ugoku-zukai/6");
    const M = build(deck6({ a: { title: "A", parts: [{ figure: "f1" }] } }, [SC("s1", "a")], { f1: L1 }));
    assert.deepStrictEqual(M.errors || [], []);
  },
  async format6_allows_values_and_custom() {   // /5 の機能は /6 でも使える
    const M = build(deck6({ a: { title: "A", parts: [{ figure: "f1" }] } }, [SC("s1", "a")], { f1: L1 }, { values: { a: 1 } }));
    assert.deepStrictEqual(M.errors || [], []);
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
  console.log(fail ? `M9 の検査: NG ${fail} 件` : "M9 の検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
