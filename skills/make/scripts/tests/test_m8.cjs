#!/usr/bin/env node
// M8（数式と座標）の検査。node test_m8.cjs で回す。
// タスクが進むごとに、ここに検査を足す
"use strict";
const assert = require("assert");
const { load, theme, guardedCall } = require("../uz_node.cjs");
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
// geo の検査用: svg_dom の document で要素を作る el（view_svg.js の el と同じ形）と、空の <g>
const SVGDOM = require("../svg_dom.cjs");
const DOC = SVGDOM.makeDocument();
const fakeEl = (tag, attrs, parent) => {
  const e = DOC.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const newGeo = () => ({ geo: UZ.makeGeo(fakeEl, UZ.styleOf(TH)), g: fakeEl("g") });
const ser = e => SVGDOM.serialize(e);
const attrsOf = (str, tag) => [...str.matchAll(new RegExp(`<${tag} [^>]*>`, "g"))].map(m => m[0]);

// geometry.md のリファレンス（### R<n> の節）ごとに、値と動作の例（```json）と関数（```js）を取り出す
function geometryRefs() {
  const fs = require("fs"), path = require("path");
  const md = fs.readFileSync(path.join(__dirname, "../../references/geometry.md"), "utf8");
  return md.split(/^### /m).slice(1).filter(s => /^R\d /.test(s)).map(s => {
    const block = lang => { const m = s.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```")); assert.ok(m, `${s.slice(0, 10)} に ${lang} の塊がない`); return m[1]; };
    return { id: s.split(" ")[0], ex: JSON.parse(block("json")), js: block("js") };
  });
}

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
  async tex_color_package() {   // \color{#…}{…} は誤りにならず、その色の fill・stroke を持つ節になる
    const r = UZMJ.tex2tree("\\color{#58c4dd}{x}");
    assert.ok(!r.error, r.error);
    const cols = []; (function walk(n) { if (n.attrs) cols.push(n.attrs.fill, n.attrs.stroke); (n.children || []).forEach(walk); })(r.tree);
    assert.ok(cols.includes("#58c4dd"), JSON.stringify(cols));
    // \textcolor は囲んだ所だけに色を付ける（後ろの + b は元の色のまま）
    const paints = []; (function walk(n, c) { if (n.attrs && n.attrs.fill) c = n.attrs.fill; if (n.tag === "path" || n.tag === "use") paints.push(c); (n.children || []).forEach(k => walk(k, c)); })(UZMJ.tex2tree("\\textcolor{#58c4dd}{a}+b").tree, "");
    assert.deepStrictEqual(paints, ["#58c4dd", "currentColor", "currentColor"]);
  },
  async geo_tex_color_theme_key() {   // \textcolor{warn}{…} のテーマのキーは、テーマの色に置き換わる
    const { geo, g } = newGeo();
    geo.tex(g, "a+\\textcolor{warn}{b}", { x: 0, y: 0 });
    const str = ser(g), S = UZ.styleOf(TH);
    assert.ok(str.includes(`fill="${S.warn}"`), str.slice(0, 300));
    assert.ok(!/(fill|stroke)="warn"/.test(str), "キーの名前のまま残っている");
    assert.deepStrictEqual(geo.errors, []);
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
  async geo_axes_maps() {
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [0, 10], y: [0, 5], box: { x: 0, y: 0, w: 500, h: 250 } });
    assert.deepStrictEqual(Ax.toPx([10, 5]), [500, 0]);
    assert.deepStrictEqual(Ax.toNum([0, 250]), [0, 0]);
    assert.deepStrictEqual(Ax.toNum(Ax.toPx([3, 2])), [3, 2]);
    assert.ok(/<path /.test(ser(g)), "軸の線がない");
  },
  async geo_axes_show_grows() {   // show = 0 で軸の線が描かれず、0.5 で半分まで
    const box = { x: 0, y: 0, w: 400, h: 200 };
    const a = newGeo(); a.geo.axes(a.g, { x: [0, 4], y: [0, 2], box, show: 0 });
    const b = newGeo(); b.geo.axes(b.g, { x: [0, 4], y: [0, 2], box, show: 1, grid: true, labels: { x: "x", y: "$y$" } });
    assert.ok(ser(a.g).length < ser(b.g).length);
    assert.ok(!/NaN/.test(ser(b.g)));
  },
  async geo_axes_bad_ticks() {   // 負・0・数でない・細かすぎる間隔でも止まらず、目盛りは有限の数。潰れた範囲は知らせて NaN を書かない
    for (const step of [-1, 0, NaN, "x", 1e-12, -0.5]) {
      const { geo, g } = newGeo();
      geo.axes(g, { x: [0, 4], y: [0, 2], box: { x: 0, y: 0, w: 100, h: 100 }, ticks: { x: step, y: step } });
      const n = (ser(g).match(/<text /g) || []).length;
      assert.ok(n > 0 && n <= 202, `step=${step}: 目盛りの数 ${n}`);
    }
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [1, 1], y: [0, 2], box: { x: 0, y: 0, w: 100, h: 100 } });
    geo.tangent(g, Ax, x => 1 / (x - 1), 1);
    assert.strictEqual(geo.errors.length, 1);
    assert.ok(!/NaN|Infinity/.test(ser(g)));
  },
  async geo_deriv() {
    const { geo } = newGeo();
    assert.ok(Math.abs(geo.deriv(x => x * x, 3) - 6) < 1e-6);
  },
  async geo_plot_breaks_on_nan() {
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [-1, 1], y: [-5, 5], box: { x: 0, y: 0, w: 400, h: 300 } });
    const pg = geo.plot(g, Ax, x => 1 / x);
    const str = ser(pg), paths = attrsOf(str, "path");
    assert.ok(paths.length >= 2, `パスの数: ${paths.length}`);
    assert.ok(!/NaN|Infinity/.test(str), str.slice(0, 300));
    for (const d of str.matchAll(/ d="([^"]+)"/g)) for (const n of d[1].match(/-?[0-9.]+/g)) assert.ok(+n >= -0.01 && +n <= 400.01, `枠の外の座標 ${n}`);
  },
  async geo_plot_upto() {   // upto = 0.5 で x の半分まで
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [0, 10], y: [0, 10], box: { x: 0, y: 0, w: 500, h: 500 } });
    const d = ser(geo.plot(g, Ax, x => x, { upto: 0.5 })).match(/ d="([^"]+)"/)[1];
    const xs = d.match(/[ML]([-0-9.]+),/g).map(s => +s.slice(1, -1));
    assert.ok(Math.abs(Math.max(...xs) - 250) < 0.01, `最後の x: ${Math.max(...xs)}`);
  },
  async geo_riemann_count() {
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [0, 2], y: [0, 4], box: { x: 0, y: 0, w: 400, h: 300 } });
    const rg = geo.riemann(g, Ax, x => x * x, 0, 2, 8, { rule: "mid" });
    assert.strictEqual(attrsOf(ser(rg), "rect").length, 8);
  },
  async geo_shapes_draw() {   // 描く関数はどれも要素を返し、NaN を書かない
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [-3, 3], y: [-2, 9], box: { x: 50, y: 20, w: 600, h: 400 }, grid: true, ticks: { x: 1, y: 2 } });
    const f = x => x * x;
    const made = [geo.plot(g, Ax, f, { color: "accent" }), geo.point(g, Ax, [1, 1], { label: "P" }), geo.label(g, [10, 10], "ラベル"),
      geo.number(g, [10, 40], 2.345, { decimals: 1, prefix: "a=", unit: "m" }), geo.tangent(g, Ax, f, 1), geo.secant(g, Ax, f, 0, 2, { color: "good" }),
      geo.area(g, Ax, f, 0, 2), geo.vector(g, Ax, [0, 0], [2, 3], { label: "$\\vec v$", color: "#8c5e0a" }), geo.arc(g, [100, 100], 30, 0, Math.PI / 2),
      geo.circle(g, [100, 100], 20), geo.polygon(g, [[0, 0], [10, 0], [0, 10]], { fill: true }), geo.bar(g, Ax, 2, 5, { color: "store" })];
    for (const e of made) assert.ok(e && e.tagName, "要素を返さない");
    const str = ser(g);
    assert.ok(!/NaN|undefined/.test(str), str.match(/.{60}(NaN|undefined).{20}/)?.[0]);
    assert.ok(/>a=2\.3m</.test(str), "number の文字");
  },
  async geo_col_resolves() {
    const { geo } = newGeo(), S = UZ.styleOf(TH);
    assert.strictEqual(geo.col("accent"), S.accent);
    assert.strictEqual(geo.col("store"), S.role("store"));
    assert.strictEqual(geo.col("#123456"), "#123456");
  },
  async geo_tex_size() {
    const { geo, g } = newGeo();
    const r = geo.tex(g, "x^2", { x: 0, y: 0, size: 40 });
    assert.ok(r.w > 20 && r.h > 20, `${r.w} ${r.h}`);
    const str = ser(g);
    assert.ok(!/currentColor/.test(str) && /<path /.test(str), "数式の色か形がない");
    assert.deepStrictEqual(geo.errors, []);
  },
  async geo_tex_is_upright() {   // 上端を y に置く。外側は正の倍率（木の中の scale(1,-1) で上下がそろう）
    const { geo, g } = newGeo();
    const r = geo.tex(g, "x^2", { x: 100, y: 50, size: 40, anchor: "middle" });
    const tr = ser(g).match(/transform="translate\(([-0-9.]+),([-0-9.]+)\) scale\(([-0-9.]+)\)"/);
    assert.ok(tr, ser(g).slice(0, 200));
    const vb = UZMJ.tex2tree("x^2").vb;
    assert.ok(+tr[3] > 0);
    assert.ok(Math.abs(+tr[2] + vb[1] * +tr[3] - 50) < 0.01, "上端が y にない");
    assert.ok(Math.abs(+tr[1] + vb[0] * +tr[3] - (100 - r.w / 2)) < 0.01, "真ん中が x にない");
  },
  async tex_error_is_reported() {
    const { geo, g } = newGeo();
    geo.tex(g, "\\frac{1}{", {});
    assert.strictEqual(geo.errors.length, 1);
    assert.ok(/\\frac\{1\}\{/.test(ser(g)), "TeX がそのまま出ない");
  },
  async geo_texmorph_ends() {
    const from = "f(x)=\\cssId{a}{x^2}", to = "f'(x)=\\cssId{a}{2x}", o = { x: 40, y: 30, size: 36 };
    const pair = (fn) => { const { geo, g } = newGeo(); fn(geo, g); return ser(g); };
    assert.strictEqual(pair((geo, g) => geo.texMorph(g, from, to, 0, o)), pair((geo, g) => geo.tex(g, from, o)));
    assert.strictEqual(pair((geo, g) => geo.texMorph(g, from, to, 1, o)), pair((geo, g) => geo.tex(g, to, o)));
    const mid = pair((geo, g) => geo.texMorph(g, from, to, 0.5, o));
    assert.ok(/matrix\(/.test(mid) && /opacity="0\.5"/.test(mid) && !/NaN/.test(mid), mid.slice(0, 300));
  },
  async geo_texmorph_moves_shared() {   // 同じ id の部分は、両端の位置の間を動く
    const from = "\\cssId{k}{x}", to = "a+b+\\cssId{k}{x}", o = { x: 0, y: 0, size: 40 };
    const { geo, g } = newGeo();
    geo.texMorph(g, from, to, 0.5, o);
    const m = ser(g).match(/matrix\(([-0-9.]+),[-0-9.]+,[-0-9.]+,[-0-9.]+,([-0-9.]+),/);
    assert.ok(m, "共有の部分に matrix がない");
    assert.ok(+m[2] > 5, `x が動いていない: ${m[2]}`);
  },
  async custom_part_gets_geo() {   // custom の部品に geo が渡り、TeX の誤りはそのコマの geo.errors に出る
    const draw = "({ g, geo, w, h }) => { const Ax = geo.axes(g, { x: [0, 1], y: [0, 1], box: { x: 0, y: 0, w, h } }); geo.plot(g, Ax, x => x); geo.tex(g, '\\\\frac{1}{', {}); if (geo.errors.length !== 1) throw new Error('errors=' + geo.errors.length); }";
    const M = await build(customDeck(CPART, null, { custom: { dot: draw } }));
    assert.deepStrictEqual(M.errors, []);
    const err = console.error, msgs = []; console.error = (...a) => msgs.push(a.join(" "));
    let str;
    try { const s = M.acts.find(x => x.verb === "set"); str = renderSvg(M, s.end + 0.05); renderSvg(M, s.end + 0.2); } finally { console.error = err; }
    assert.ok(/<path /.test(str), "geo で描かれていない");
    assert.ok(!msgs.some(m => /errors=/.test(m)), msgs.join("\n"));   // コマごとに空にしている
    assert.ok(msgs.some(m => /TeX/.test(m)), "TeX の誤りが知らされない");
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
  // ---- custom の描画検査（Task 5） ----
  async check_exception_is_error() {
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g, el }) => { throw new Error('ぼん'); }" } }));
    const r = UZ.checkCustoms(M, fakeEl);
    assert.ok(r.errors.some(e => /^行 l1: 部品「c1」: .*ぼん/.test(e)), JSON.stringify(r));
  },
  async check_tex_error_is_error() {
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g, geo }) => geo.tex(g, '\\\\frac{', { x: 10, y: 10 })" } }));
    const r = UZ.checkCustoms(M, fakeEl);
    assert.ok(r.errors.some(e => /^行 l1: 部品「c1」: TeX/.test(e)), JSON.stringify(r));
  },
  async check_nan_warns() {
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g, v, el, h }) => el('circle', { cx: v.aa * 3, cy: h / 2, r: 6 }, g)" } }));
    const r = UZ.checkCustoms(M, fakeEl);
    assert.ok(r.warnings.some(w => /^行 l1: 部品「c1」/.test(w) && /NaN/.test(w) && /circle/.test(w) && /cx/.test(w)), JSON.stringify(r));
  },
  async check_overflow_warns() {
    const mk = async dx => {
      const M = await build(customDeck(CPART, null, { custom: { dot: `({ g, el, w, h }) => el('circle', { cx: w + ${dx}, cy: h / 2, r: 0.5 }, g)` } }));
      return UZ.checkCustoms(M, fakeEl);
    };
    const far = await mk(50), near = await mk(4);
    assert.ok(far.warnings.some(w => /はみ出す/.test(w)), JSON.stringify(far));
    assert.deepStrictEqual(near, { errors: [], warnings: [] });
  },
  async check_clean_custom_passes() {
    const src = "({ g, el, geo, w, h, v }) => { const ax = geo.axes(g, { x: [-3, 3], y: [-2, 2], box: { x: 40, y: 10, w: w - 60, h: h - 40 } }); geo.plot(g, ax, x => Math.sin(x) * v.a / 4); }";
    const M = await build(customDeck(CPART, null, { custom: { dot: src } }));
    assert.deepStrictEqual(M.errors, []);
    const r = UZ.checkCustoms(M, fakeEl);
    assert.deepStrictEqual(r, { errors: [], warnings: [] }, JSON.stringify(r));
  },
  async check_centered_tex_does_not_warn() {
    const src = "({ g, geo, w, h }) => { const r = geo.tex(g, '\\\\int_0^1 x^2\\\\,dx = \\\\frac{1}{3}', { x: w / 2, y: h / 2, size: 32, anchor: 'middle' }); }";
    const M = await build(customDeck(CPART, null, { custom: { dot: src } }));
    const r = UZ.checkCustoms(M, fakeEl);
    assert.deepStrictEqual(r, { errors: [], warnings: [] });
  },
  async geometry_md_references_run() {   // geometry.md のリファレンス R1〜R6 は、写せばそのまま誤りも警告もなく描ける
    const refs = geometryRefs();
    assert.deepStrictEqual(refs.map(r => r.id), ["R1", "R2", "R3", "R4", "R5", "R6"]);
    for (const r of refs) {
      const sb = deck5({ a: { title: "A", parts: [{ id: "p", type: "custom", draw: "r" }] } },
        [SC("s1", "a", [{ id: "l1", text: "{a}出して、{b}値を動かしながら、ゆっくりと説明していきます。",
          do: [{ show: "p", at: "a" }, { ...r.ex.do[0], at: "b" }, ...r.ex.do.slice(1)] }])], {},
        { values: r.ex.values, custom: { r: r.js } });
      const M = await build(sb);
      assert.deepStrictEqual(M.errors, [], `${r.id}: ${JSON.stringify(M.errors)}`);
      const c = UZ.checkCustoms(M, fakeEl);
      assert.deepStrictEqual(c, { errors: [], warnings: [] }, `${r.id}: ${JSON.stringify(c)}`);
    }
  },
  async example_matches_geometry_md() {   // 見本の接線と売上の関数は、リファレンス R1・R6 の写し
    const fs = require("fs"), path = require("path");
    const sb = JSON.parse(fs.readFileSync(path.join(__dirname, "../../examples/math-geometry.json"), "utf8"));
    const refs = Object.fromEntries(geometryRefs().map(r => [r.id, r.js]));
    assert.strictEqual(sb.custom.tangent, refs.R1, "見本の tangent が geometry.md の R1 と違う");
    assert.strictEqual(sb.custom.sales, refs.R6, "見本の sales が geometry.md の R6 と違う");
  },
  async check_cli_json_reports() {
    const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "m8chk-")), f = path.join(d, "sb.json");
    fs.writeFileSync(f, JSON.stringify(customDeck(CPART, null, { custom: { dot: "({ g, el }) => { throw new Error('ぼん'); }" } })));
    const r = cp.spawnSync("node", [path.join(__dirname, "../check_storyboard.cjs"), f, "--json"], { encoding: "utf8" });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(JSON.parse(r.stdout).errors.some(e => /ぼん/.test(e)));
  },
  // ---- 止まらない関数と、分割の数の上限（最終レビューの直し） ----
  async check_timeout_is_error() {   // 止まらない関数は、行と部品を挙げた誤りになり、その部品はもう呼ばない
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g }) => { while (true) {} }" } }));
    const t0 = Date.now(), r = UZ.checkCustoms(M, fakeEl, { call: guardedCall(50) });
    const hit = r.errors.filter(e => /^行 l1: 部品「c1」: 関数が 0.05 秒で終わらない/.test(e));
    assert.strictEqual(hit.length, 1, JSON.stringify(r));
    assert.ok(Date.now() - t0 < 2000, "時間切れの部品を何度も呼んでいる");
  },
  async check_slow_warns() {   // 1 回の描画の平均が slowMs を超えると警告
    const M = await build(customDeck(CPART, null, { custom: { dot: "({ g }) => { const e = Date.now() + 3; while (Date.now() < e) {} }" } }));
    const r = UZ.checkCustoms(M, fakeEl, { call: guardedCall(500), slowMs: 1 });
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.warnings.some(w => /^部品「c1」: 1 回の描画に平均 \d+ms かかる/.test(w)), JSON.stringify(r));
  },
  async check_dedupes_repeats() {   // 同じ部品の同じ誤り・はみ出しは、行と時刻をまたいで 1 件にまとめる
    const lines = [{ id: "l1", text: "{a}出して{b}動かします。", do: [{ show: "c1", at: "a" }, { set: "a", to: 8, at: "b", dur: 1 }] },
      { id: "l2", text: "{a}もう一度{b}動かします。", do: [{ set: "a", to: 3, at: "b", dur: 1 }] }];
    const thr = await build(customDeck(CPART, lines, { custom: { dot: "({ g }) => { throw new Error('ぼん'); }" } }));
    const r1 = UZ.checkCustoms(thr, fakeEl);
    assert.strictEqual(r1.errors.length, 1, JSON.stringify(r1));
    assert.match(r1.errors[0], /^行 l1: 部品「c1」: .*ぼん.*（ほか 1 行でも）$/);
    const spill = await build(customDeck(CPART, lines, { custom: { dot: "({ g, el, v, w, h }) => el('circle', { cx: w + 20 * v.a, cy: h / 2, r: 1 }, g)" } }));
    const r2 = UZ.checkCustoms(spill, fakeEl);
    assert.strictEqual(r2.warnings.filter(w => /はみ出す/.test(w)).length, 1, JSON.stringify(r2));
  },
  async geo_caps_sample_counts() {   // plot の samples と riemann の n は 2000 で頭打ち（大きな値でもすぐ終わる）
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [0, 1], y: [0, 1], box: { x: 0, y: 0, w: 400, h: 300 } });
    const t0 = Date.now();
    const p = geo.plot(g, Ax, x => x * 0.5, { samples: 3e7 });
    const rs = geo.riemann(g, Ax, x => x * 0.5, 0, 1, 1e7);
    assert.ok(Date.now() - t0 < 2000, "上限が効いていない");
    const pts = (ser(p).match(/[ML]/g) || []).length;
    assert.ok(pts > 1000 && pts <= 2002, `plot の点の数: ${pts}`);
    assert.strictEqual(rs.childNodes.length, 2000);
  },
  async custom_value_must_be_string() {   // custom の値がオブジェクトなら、読み込みの例外より先に分かる誤りを出す
    const M = await build(customDeck(CPART, null, { custom: { dot: { body: "x" } } }));
    hasErr(M, /custom「dot」の値が文字列でない/);
  },
  async tools_stop_on_endless_custom() {   // check_storyboard.cjs は誤りで、frames.cjs は誤りの文で止まる（固まらない）
    const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "m8hang-")), f = path.join(d, "sb.json");
    fs.writeFileSync(f, JSON.stringify(customDeck(CPART, null, { custom: { dot: "({ g }) => { while (true) {} }" } })));
    const env = { ...process.env, UZ_CUSTOM_TIMEOUT_MS: "100" }, o = { encoding: "utf8", env, timeout: 30000 };
    const c = cp.spawnSync("node", [path.join(__dirname, "../check_storyboard.cjs"), f], o);
    assert.strictEqual(c.status, 1, c.stdout + c.stderr);
    assert.match(c.stdout, /誤り: 行 l1: 部品「c1」: 関数が 0.1 秒で終わらない/);
    const fr = cp.spawnSync("node", [path.join(__dirname, "../frames.cjs"), f, "-o", path.join(d, "fr")], o);
    assert.strictEqual(fr.status, 1, fr.stdout + fr.stderr);
    assert.match(fr.stderr, /コマを描くのが 0.5 秒で終わらない/);
    fs.rmSync(d, { recursive: true, force: true });
  },
  // ---- writer の評価で詰まった点の直し（Task 8 fix） ----
  async shared_custom_redraws_at_new_area() {   // figures で共有した custom の部品は、場面ごとの区画の大きさ（px）で描き直す。伸び縮みしない
    const RECT = "({ g, el, w, h }) => el('rect', { x: 0, y: 0, width: w, height: h, fill: 'none' }, g)";
    const sb = deck5({
      a: { title: "A", parts: [{ figure: "c1" }] },
      b: { title: "B", parts: [{ figure: "c1", area: { col: [1, 12], row: [1, 3] } }, { id: "t", type: "text", area: { col: [1, 12], row: [4, 6] }, blocks: [{ id: "p", kind: "para", text: "下の段" }] }] },
    }, [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: "c1", at: "a" }] }]),
        SC("s2", "b", [{ id: "l2", text: "{a}下に文を足します。", do: [{ show: "t", at: "a" }] }])],
    { c1: { type: "custom", draw: "r" } }, { values: { a: 0 }, custom: { r: RECT } });
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const [s1, s2] = M.scenes, A1 = s1.areas[0], A2 = s2.areas[0];
    assert.ok(A2.h < A1.h * 0.7, "区画が変わっていない");
    for (const [sc, A] of [[s1, A1], [s2, A2]]) {
      const pl = sc.place.c1;
      assert.strictEqual(pl.s, 1, "custom の部品に伸び縮みが掛かっている");
      assert.deepStrictEqual([pl.ox, pl.oy, pl.w, pl.h], [A.x, A.y, A.w, A.h]);
    }
    // コマ: 続く場面の終わりは新しい区画の大きさ。移る途中は補間
    const end2 = M.timeline.lines[1].start + M.timeline.lines[1].dur;
    const f2 = UZ.frame(M, end2).figs.c1.place;
    assert.deepStrictEqual([f2.s, Math.round(f2.w), Math.round(f2.h)], [1, Math.round(A2.w), Math.round(A2.h)]);
    const fm = UZ.frame(M, s2.start + 0.3).figs.c1.place;
    assert.ok(fm.h < A1.h - 1 && fm.h > A2.h + 1, `移る途中の高さ ${fm.h}`);
    // 再生ページの描画: 関数に渡る w・h が新しい区画の大きさ
    const str = renderSvg(M, end2);
    assert.ok(new RegExp(`<rect [^>]*width="${+A2.w.toFixed(4)}"[^>]*height="${+A2.h.toFixed(4)}"`).test(str) || str.includes(`height="${A2.h}"`), "描画の w・h が新しい区画でない");
    // 検査: 場面ごとの w・h で呼ぶ。区画いっぱいの矩形ははみ出さない
    const seen = [];
    const r = UZ.checkCustoms(M, fakeEl, { call: (fn, a) => { seen.push([Math.round(a.w), Math.round(a.h)]); return fn(a); } });
    assert.deepStrictEqual(r, { errors: [], warnings: [] }, JSON.stringify(r));
    assert.ok(seen.some(([w, h]) => w === Math.round(A1.w) && h === Math.round(A1.h)), JSON.stringify(seen));
    assert.ok(seen.some(([w, h]) => w === Math.round(A2.w) && h === Math.round(A2.h)), JSON.stringify(seen));
    // 完成形のコマも、そのスライドの区画
    assert.strictEqual(Math.round(UZ.finalFrame(M, "b").figs.c1.place.h), Math.round(A2.h));
  },
  async series_colors_distinct_in_both_themes() {   // 線の色の並び s1〜: koo でも kuro でも別の色になる。色の名前と \textcolor の両方で使える
    for (const name of ["koo", "kuro"]) {
      const S = UZ.styleOf(theme(name)), geo = UZ.makeGeo(fakeEl, S);
      assert.ok(Array.isArray(S.series) && S.series.length >= 3, `${name}: series ${JSON.stringify(S.series)}`);
      const c = ["s1", "s2", "s3"].map(k => geo.col(k));
      assert.strictEqual(new Set(c).size, 3, `${name}: ${c}`);
      assert.deepStrictEqual(geo.series.slice(0, 3), c);
      assert.ok(c.every(x => /^#[0-9a-f]{6}$/i.test(x)), `${name}: ${c}`);
      const g = fakeEl("g");
      geo.tex(g, "\\textcolor{s2}{x}+\\textcolor{s3}{y}", { x: 10, y: 10 });
      assert.deepStrictEqual(geo.errors, []);
      const out = ser(g);
      assert.ok(out.includes(`fill="${c[1]}"`) && out.includes(`fill="${c[2]}"`), `${name}: \\textcolor{s2} が色にならない`);
    }
    // koo は意味のキーが重なる（warn = accent）が、並びは重ならない
    const K = UZ.styleOf(theme("koo"));
    assert.strictEqual(K.warn, K.accent);
    assert.deepStrictEqual(K.series.slice(0, 3), ["#286cb9", "#8c5e0a", "#0c1b32"]);
    // 並びのないテーマ（取り込んだテーマなど）: 意味の色と本文の色から、重なりを除いて作る
    const th = JSON.parse(JSON.stringify(theme("koo"))); delete th.colors.series;
    const D = UZ.styleOf(th).series;
    assert.ok(D.length >= 3 && new Set(D).size === D.length, JSON.stringify(D));
    assert.strictEqual(D[0], th.colors.accent);
    // s5 は並びを回る
    assert.strictEqual(UZ.makeGeo(fakeEl, K).col("s" + (K.series.length + 1)), K.series[0]);
  },
  async check_theme_series_distinct() {   // check_theme.py は、並びに同じ色・近すぎる色があると不合格にする
    const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "m8th-")), f = path.join(d, "t.json");
    const run = th => { fs.writeFileSync(f, JSON.stringify(th)); return cp.spawnSync("python3", [path.join(__dirname, "../check_theme.py"), f], { encoding: "utf8" }); };
    for (const n of ["koo", "kuro"]) assert.strictEqual(run(theme(n)).status, 0, n);
    const bad = JSON.parse(JSON.stringify(theme("koo"))); bad.colors.series = ["#286cb9", "#286cb9", "#8c5e0a"];
    const r = run(bad);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /series/);
    fs.rmSync(d, { recursive: true, force: true });
  },
  async zoom_region_inside_part() {   // zoom の region: 部品の区画に対する割合の矩形に寄る（区画いっぱいの部品でも倍率 1 未満にならない）
    const lines = [{ id: "l1", text: "{a}出して{b}右上に寄ります。", do: [{ show: "c1", at: "a" }, { zoom: "c1", region: { x: [0.5, 1], y: [0, 0.5] }, at: "b" }] }];
    const M = await build(customDeck(CPART, lines));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(!M.warnings.some(w => /倍率が 1 未満/.test(w)), JSON.stringify(M.warnings));
    const z = M.acts.find(a => a.verb === "zoom"), A = M.scenes[0].areas[0];
    assert.ok(Math.abs(z.target.x - (A.x + A.w / 2)) < 0.01 && Math.abs(z.target.w - A.w / 2) < 0.01 && Math.abs(z.target.h - A.h / 2) < 0.01, JSON.stringify(z.target));
    assert.ok(z.to.s > 1.5, `倍率 ${z.to.s}`);
    // 形の誤り
    for (const region of [{ x: [0.6, 0.2] }, { x: [0, 1.5] }, "right", { x: [0, 1], z: [0, 1] }]) {
      const bad = customDeck(CPART, [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "c1", at: "a" }, { zoom: "c1", region, at: "b" }] }]);
      hasErr(await build(bad), /region/);
    }
    const all = customDeck(CPART, [{ id: "l1", text: "{a}出して{b}戻ります。", do: [{ show: "c1", at: "a" }, { zoom: "all", region: { x: [0, 0.5] }, at: "b" }] }]);
    hasErr(await build(all), /region/);
  },
  async focus_whole_part_dims_other_parts() {   // 部品全体を focus すると、同じ場面のほかの部品が薄くなる。unfocus で戻る
    const sb = deck5({ a: { title: "A", start: "complete", parts: [
      { id: "c1", type: "custom", draw: "dot", area: { col: [1, 6], row: [1, 6] } },
      { id: "c2", type: "list", items: [{ id: "i1", text: "項目" }], area: { col: [7, 12], row: [1, 6] } }] } },
    [SC("s1", "a", [{ id: "l1", text: "{a}左だけを見ます。", do: [{ focus: "c1", at: "a" }] }, { id: "l2", text: "{a}戻します。", do: [{ unfocus: true, at: "a" }] }])],
    {}, { values: { a: 2 }, custom: { dot: DOT } });
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const L = M.timeline.lines, t1 = L[0].start + L[0].dur, t2 = L[1].start + L[1].dur;
    const f1 = UZ.frame(M, t1).st;
    assert.ok(f1["c2/i1"].dim < 0.3, `ほかの部品の dim ${f1["c2/i1"].dim}`);
    assert.ok(f1["c1/draw"].dim > 0.99);
    assert.ok(UZ.frame(M, t2).st["c2/i1"].dim > 0.99);
    // 部品の中の要素を指す focus は、今までどおり同じ図の中だけ
    const sb2 = JSON.parse(JSON.stringify(sb));
    sb2.scenes[0].lines[0].do = [{ focus: "i1", at: "a" }];
    const M2 = await build(sb2);
    const g = UZ.frame(M2, t1).st;
    assert.ok(!g["c1/draw"] || g["c1/draw"].dim > 0.99, "要素の focus が隣の部品を薄くした");
  },
  async secant_keeps_length_as_points_meet() {   // secant の len: 2 点が近づいても線の長さが len のまま（h = 0 でも NaN にならない）
    const { geo, g } = newGeo();
    const Ax = geo.axes(g, { x: [-3, 3], y: [-2, 10], box: { x: 0, y: 0, w: 600, h: 480 } });
    const f = x => x * x, pxPerX = 600 / 6;
    for (const h of [1, 0.1, 1e-3, 1e-9, 0]) {
      const p = geo.secant(g, Ax, f, 1, 1 + h, { len: 2 });
      const n = (p.getAttribute("d").match(/-?[0-9.]+/g) || []).map(Number);
      assert.strictEqual(n.length, 4, `h=${h}: ${p.getAttribute("d")}`);
      assert.ok(n.every(Number.isFinite), `h=${h}`);
      const L = Math.hypot(n[2] - n[0], n[3] - n[1]);
      assert.ok(Math.abs(L - 2 * pxPerX) < 1, `h=${h}: 長さ ${L}`);
    }
    // len を書かなければ今までどおり（2 点の間を延ばす）
    const p0 = geo.secant(g, Ax, f, 0, 1);
    assert.ok(/^M/.test(p0.getAttribute("d")) && p0.getAttribute("d") !== "M0,0");
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
