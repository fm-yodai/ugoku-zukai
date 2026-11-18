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

// test_m7.cjs の morphDeck と同じ形（/4）
const deck4 = (slides, scenes, figures = {}) => ({ format: "ugoku-zukai/4", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes });
const G1 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "db" }] };
const G2 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "cache", label: "キャッシュ" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "cache" }, { from: "cache", to: "db" }] };
const morphDeck = (o = {}) => {
  const f1 = o.v1 ? "v1" : "g1", f2 = o.v2 ? "v2" : "g2";
  const b = { title: "B", parts: [{ figure: f2, morph: f1 }] };
  if (o.complete) b.start = "complete";
  const scenes = [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: o.show1 ? `${f1}/${o.show1}` : f1, at: "a" }] }]),
    SC("s2", "b", [{ id: "l2", text: "ここで、新しい部分を{a}足します。", do: [{ show: o.show2 || "cache", at: "a" }] }])];
  if (o.back) scenes.push(SC("s3", "a", [{ id: "l3", text: "元の形に戻ります。" }]));
  return deck4({ a: { title: "A", parts: [{ figure: f1 }] }, b }, scenes, { [f1]: o.v1 || G1, [f2]: o.v2 || G2 });
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
  async morph_back_single() {   // 戻るシークで、v2 と v1 を二重に描かない（M7 の制限 1）
    const M = await build(morphDeck({ back: true }));
    assert.deepStrictEqual(M.errors || [], []);
    const s1 = M.scenes[0], s3 = M.scenes[2];
    const fr = UZ.frame(M, s3.start + 0.1);
    assert.strictEqual(fr.figs.g2.opacity, 0, "戻った直後に g2 を描いている");
    assert.deepStrictEqual(fr.figs.g1.place, s1.place.g1, "g1 の写し方が s1 と違う（補間している）");
    assert.strictEqual(fr.figs.g1.opacity, 1);
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
