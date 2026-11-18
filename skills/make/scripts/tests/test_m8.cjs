#!/usr/bin/env node
// M8（数式と座標）の検査。node test_m8.cjs で回す。
// タスクが進むごとに、ここに検査を足す
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");

// 台本の形式 /5 の小さな台本。extra は最上位の項目（values など）に重ねる
const deck5 = (slides, scenes, figures = {}, extra = {}) => ({ format: "ugoku-zukai/5", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes, ...extra });
const SC = (id, slide, lines) => ({ id, slide, lines: lines || [{ id: "l_" + id, text: "説明します。" }] });
const build = (sb, o) => UZ.build(sb, TH, null, o);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const L1 = { type: "list", items: [{ id: "i1", text: "項目" }] };
// 値の検査用: スライド a（箇条 1 つ）を場面ごとに使う。scenesLines = 場面ごとの行の列
const valDeck = (scenesLines, values = { a: 1 }, format) => {
  const sb = deck5({ a: { title: "A", parts: [{ figure: "f1" }] } }, scenesLines.map((ls, i) => SC(`s${i + 1}`, "a", ls)), { f1: L1 }, values ? { values } : {});
  if (format) sb.format = format;
  return sb;
};

// custom の部品: 値 a を 2 → 8 に動かし、点を w * a / 10 に描く
const DOT = "({ g, v, el, w, h }) => el('circle', { cx: w * v.a / 10, cy: h / 2, r: 6 }, g)";
const CPART = { id: "c1", type: "custom", draw: "dot" };
const customDeck = (part = CPART, lines, extra = {}) => deck5({ a: { title: "A", parts: [part] } },
  [SC("s1", "a", lines || [{ id: "l1", text: "{a}出して{b}動かします。", do: [{ show: "c1", at: "a" }, { set: "a", to: 8, at: "b", dur: 1 }] }])], {},
  { values: { a: 2 }, custom: { dot: DOT }, ...extra });
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
const circleCx = str => [...str.matchAll(/<circle [^>]*cx="([0-9.]+)"[^>]*r="6"/g)].map(m => +m[1]);

const tests = {
  async tex_tree_basic() {
    const r = UZMJ.tex2tree("f'(a)=\\cssId{k1}{2.35}", { display: true });
    assert.ok(r.w > 0 && r.h > 0, JSON.stringify(r).slice(0, 200));
    const ids = []; (function walk(n) { if (n.attrs && n.attrs.id) ids.push(n.attrs.id); (n.children || []).forEach(walk); })(r.tree);
    assert.ok(ids.includes("k1"));
    assert.deepStrictEqual(UZMJ.tex2tree("x^2"), UZMJ.tex2tree("x^2"));   // 同じ入力は同じ木
  },
  async tex_cjk_text_has_width() {
    const r = UZMJ.tex2tree("v=\\text{速さ}");
    const hasText = JSON.stringify(r.tree).includes('"text":"速"') && JSON.stringify(r.tree).includes('"text":"さ"');   // MathJax は 1 文字ずつ <text> にする
    assert.ok(hasText && r.w > 1.5, `w=${r.w}`);
  },
  async tex_error_returns_error() {
    assert.strictEqual(UZMJ.tex2tree("\\frac{1}{").error, "Missing close brace");
    assert.ok(UZMJ.tex2tree("\\foo").error);
  },
  async tex_box_is_in_em() {
    const r = UZMJ.tex2tree("x^2");
    assert.ok(r.w > 0.5 && r.w < 3 && r.h > 0 && r.depth >= 0, JSON.stringify([r.w, r.h, r.depth]));
  },
  async bundle_has_no_script_close() {
    const fs = require("fs"), path = require("path");
    const t = fs.readFileSync(path.join(__dirname, "../../player/vendor/mathjax-uz.js"), "utf8");
    assert.ok(!t.includes("</script"), "束に </script がある（build_player.py が逃がす前提）");
  },
  async values_basic() {   // set の前は初めの値、途中は補間、後は to
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かします。", do: [{ show: "f1" }, { set: "a", to: 3, at: "a", dur: 2 }] }]]));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.values0, { a: 1 });
    const s = M.acts.find(x => x.verb === "set");
    assert.strictEqual(UZ.valuesAt(M, s.start - 0.01).a, 1);
    assert.strictEqual(UZ.valuesAt(M, s.end + 0.01).a, 3);
    const mid = UZ.valuesAt(M, (s.start + s.end) / 2).a;
    assert.ok(mid > 1 && mid < 3, `mid=${mid}`);
    assert.deepStrictEqual(UZ.frame(M, s.end + 0.01).values, { a: 3 });
    assert.deepStrictEqual(UZ.frame(M, 0).values, { a: 1 });
  },
  async values_linear_ease() {   // ease: "linear" は真ん中でちょうど半分
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かします。", do: [{ show: "f1" }, { set: "a", to: 3, at: "a", dur: 2, ease: "linear" }] }]]));
    assert.deepStrictEqual(M.errors, []);
    const s = M.acts.find(x => x.verb === "set");
    assert.ok(Math.abs(UZ.valuesAt(M, s.start + 0.5).a - 1.5) < 1e-9);
  },
  async values_carry_across_scenes() {   // 場面 2 の初めで、場面 1 の set の後の値のまま
    const M = await build(valDeck([
      [{ id: "l1", text: "{a}動かします。", do: [{ show: "f1" }, { set: "a", to: 5, at: "a", dur: 0.5 }] }],
      [{ id: "l2", text: "次の場面です。" }]], { a: 1, b: 2 }));
    assert.deepStrictEqual(M.errors, []);
    const s2 = M.scenes[1];
    assert.deepStrictEqual(UZ.valuesAt(M, s2.start + 0.01), { a: 5, b: 2 });
    assert.deepStrictEqual(UZ.valuesAt(M, M.duration), { a: 5, b: 2 });
  },
  async set_overlap_starts_from_current() {   // 前の set の途中で始まる set は、その時点の値から動く
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かして、{b}また動かします。", do: [{ show: "f1" }, { set: "a", to: 10, at: "a", dur: 30 }, { set: "a", to: 0, at: "b", dur: 1 }] }]]));
    assert.deepStrictEqual(M.errors, []);
    const [s1, s2] = M.acts.filter(x => x.verb === "set");
    assert.ok(s2.start < s1.end, "2 つ目の set が 1 つ目の途中で始まっていない");
    const before = UZ.valuesAt(M, s2.start - 1e-4).a, after = UZ.valuesAt(M, s2.start + 1e-4).a;
    assert.ok(before > 1 && Math.abs(before - after) < 0.05, `before=${before} after=${after}`);
    assert.strictEqual(UZ.valuesAt(M, s2.end + 0.01).a, 0);
  },
  async values_pure_in_t() {   // シークの順によらず、同じ t は同じ値
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かして、{b}また動かします。", do: [{ show: "f1" }, { set: "a", to: 10, at: "a", dur: 3 }, { set: "a", to: 0, at: "b", dur: 1 }] }]]));
    assert.deepStrictEqual(M.errors, []);
    const v1 = UZ.valuesAt(M, 8), v2 = UZ.valuesAt(M, 2), v3 = UZ.valuesAt(M, 8);
    assert.deepStrictEqual(v1, v3);
    assert.deepStrictEqual(UZ.valuesAt(M, 2), v2);
  },
  async set_unknown_name_is_error() {
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かします。", do: [{ show: "f1" }, { set: "b", to: 3, at: "a" }] }]]));
    hasErr(M, /set の「b」が values にない/);
  },
  async values_set_shape_errors() {
    const mk = (values, act) => build(valDeck([[{ id: "l1", text: "動かします。", do: [{ show: "f1" }, act] }]], values));
    hasErr(await mk({ a: "1" }, { set: "a", to: 2 }), /values の「a」は数で書く/);
    hasErr(await mk([1], { set: "a", to: 2 }), /values（名前付きの値）は/);
    hasErr(await mk({ a: 1 }, { set: "a", to: "2" }), /to は数で書く/);
    hasErr(await mk({ a: 1 }, { set: "a" }), /to は数で書く/);
    hasErr(await mk({ a: 1 }, { set: "a", to: 2, ease: "bounce" }), /ease は smooth か linear/);
    hasErr(await mk({ a: 1 }, { set: "a", to: 2, dur: -1 }), /dur は 0 より大きい数/);
    hasErr(await mk(null, { set: "a", to: 2 }), /set の「a」が values にない/);
  },
  async format4_rejects_values() {   // /4 で values・set を書く → 種類ごとに 1 件
    const M = await build(valDeck([[{ id: "l1", text: "{a}動かします。", do: [{ show: "f1" }, { set: "a", to: 3, at: "a" }] }]], { a: 1 }, "ugoku-zukai/4"));
    const gate = (M.errors || []).filter(e => /format を "ugoku-zukai\/5" と書く/.test(e));
    assert.strictEqual(gate.length, 2, JSON.stringify(M.errors));
    assert.ok(gate.some(e => /values/.test(e)) && gate.some(e => /set/.test(e)), JSON.stringify(gate));
  },
  async format5_reads_m7_features() {   // /5 でも morph・zoom・pan・draw は使える（/4 のゲートに掛からない）
    const G = { type: "graph", nodes: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], edges: [{ from: "x", to: "y" }] };
    const M = await build(deck5({ a: { title: "A", parts: [{ figure: "g1" }] } },
      [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", draw: true }, { zoom: "x", at: "b" }] }])], { g1: G }));
    assert.deepStrictEqual(M.errors, []);
  },
  async custom_part_renders_in_frames() {
    const M = await build(customDeck());
    assert.deepStrictEqual(M.errors, []);
    const s = M.acts.find(x => x.verb === "set"), w = M.figs.c1.w;
    assert.ok(Math.abs(w - M.scenes[0].areas[0].w) < 1e-6, `部品の幅が区画の幅でない: ${w}`);
    const cx = circleCx(renderSvg(M, s.end + 0.05));
    assert.strictEqual(cx.length, 1, `circle の数: ${cx.length}`);
    assert.ok(Math.abs(cx[0] - w * 0.8) < 0.5, `cx=${cx[0]} w*0.8=${w * 0.8}`);
    const cx0 = circleCx(renderSvg(M, s.start - 0.01));   // set の前は a = 2
    assert.ok(Math.abs(cx0[0] - w * 0.2) < 0.5, `cx0=${cx0[0]}`);
  },
  async custom_part_in_complete_frame() {
    const M = await build(customDeck());
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(UZ.completeValues(M, "a"), { a: 8 });
    const fr = UZ.finalFrame(M, "a");
    assert.deepStrictEqual(fr.values, { a: 8 });
    const cx = circleCx(renderSvg(M, fr.t, fr));
    assert.ok(cx.length === 1 && Math.abs(cx[0] - M.figs.c1.w * 0.8) < 0.5, `完成形のコマの cx=${cx}`);
  },
  async custom_part_zoomable() {
    const part = { ...CPART, area: { col: [1, 4], row: [1, 2] } };
    const M = await build(customDeck(part, [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "c1", at: "a" }, { zoom: "c1", at: "b" }] }]));
    assert.deepStrictEqual(M.errors, []);
    const z = M.acts.find(a => a.verb === "zoom");
    const fr = UZ.frame(M, z.end + 0.01);
    assert.ok(fr.camera.s > 1, `倍率が 1 のまま（${fr.camera.s}）`);
    const P = M.scenes[0].place.c1, pl = fr.figs.c1.place, c = fr.camera;
    assert.ok(Math.abs(pl.s - P.s * c.s) < 1e-9, "place にカメラが合成されていない");
    assert.strictEqual(circleCx(renderSvg(M, z.end + 0.01)).length, 1);
  },
  async custom_draw_missing_is_error() {
    hasErr(await build(customDeck({ ...CPART, draw: "nope" })), /draw「nope」が台本の custom にない/);
    hasErr(await build(customDeck({ id: "c1", type: "custom" })), /draw がない/);
  },
  async custom_part_persists_across_slides() {
    const area = { col: [1, 6], row: [1, 6] };
    const sb = deck5({ a: { title: "A", parts: [{ figure: "c1", area }, { figure: "f1", area: { col: [7, 12], row: [1, 6] } }] },
      b: { title: "B", parts: [{ figure: "c1", area }] } },
      [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: "c1", at: "a" }, { show: "f1" }] }]), SC("s2", "b")],
      { c1: { type: "custom", draw: "dot" }, f1: L1 }, { values: { a: 2 }, custom: { dot: DOT } });
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const s2 = M.scenes[1];
    for (const t of [s2.start, s2.start + 0.2, s2.start + 0.5, s2.start + 1]) {
      const fr = UZ.frame(M, t);
      assert.strictEqual(fr.figs.c1.opacity, 1, `t=${t} で opacity=${fr.figs.c1.opacity}`);
      assert.strictEqual(fr.st["c1/draw"].show, 1);
    }
  },
  async custom_verb_still_works() {
    const RING = "({ g, p, el, area }) => el('circle', { cx: area.x + 50, cy: area.y + 50, r: 40 * p }, g)";
    for (const format of ["ugoku-zukai/5", "ugoku-zukai/4"]) {
      const sb = deck5({ a: { title: "A", parts: [{ figure: "f1" }] } }, [SC("s1", "a", [{ id: "l1", text: "{a}描きます。", do: [{ show: "f1" }, { custom: "ring", at: "a" }] }])], { f1: L1 }, { custom: { ring: RING } });
      sb.format = format;
      const M = await build(sb);
      assert.deepStrictEqual(M.errors, [], format);
      const a = M.acts.find(x => x.verb === "custom");
      assert.ok(/<circle /.test(renderSvg(M, a.end - 0.1)), `${format}: ring が描かれない`);
    }
  },
  async format4_rejects_custom_part() {   // /4 で custom の部品を書く → 1 件
    const sb = customDeck(CPART, [{ id: "l1", text: "出します。", do: [{ show: "c1" }] }]);
    sb.format = "ugoku-zukai/4"; delete sb.values;
    const M = await build(sb);
    const gate = (M.errors || []).filter(e => /format を "ugoku-zukai\/5" と書く/.test(e));
    assert.strictEqual(gate.length, 1, JSON.stringify(M.errors));
    assert.ok(/custom の部品/.test(gate[0]), gate[0]);
  },
  async custom_part_error_does_not_stop() {   // 関数が例外を投げても、その部品だけ描かない
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g, el }) => { el('circle', { r: 6 }, g); throw new Error('x'); }" } }));
    assert.deepStrictEqual(M.errors, []);
    const err = console.error; let n = 0; console.error = () => { n++; };
    let str;
    try { str = renderSvg(M, M.acts.find(x => x.verb === "set").end + 0.05); } finally { console.error = err; }
    assert.ok(n >= 1, "console.error に出ていない");
    assert.strictEqual(circleCx(str).length, 0);
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
  console.log(fail ? `M8 の検査: NG ${fail} 件` : "M8 の検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
