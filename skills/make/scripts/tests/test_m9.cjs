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

// 系列の検査用（test_m7.cjs の seriesDeck と同じ）: v1 → v2（→ v3）を 1 枚ずつ並べる。links = [[図, morph 先], …]
const seriesDeck = (figures, links) => deck4(
  Object.fromEntries(links.map(([fid, mv], i) => [`s${i + 1}`, { title: fid, parts: [mv ? { figure: fid, morph: mv } : { figure: fid }] }])),
  links.map(([fid], i) => SC(`c${i + 1}`, `s${i + 1}`, [{ id: `l${i + 1}`, text: "{a}出します。", do: [{ show: fid, at: "a" }] }])), figures);
// 区画を変える Morph（/6）: a の f1 → b の f2（morph: f1）。a1・a2 = それぞれの区画
const areaMorph = (f1, f2, a1, a2) => deck6({ a: { title: "A", parts: [{ figure: "f1", area: a1 }] }, b: { title: "B", parts: [{ figure: "f2", morph: "f1", area: a2 }] } },
  [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: "f1", at: "a" }] }]), SC("s2", "b")], { f1, f2 });
const between = (v, a, b, msg) => assert.ok(v > Math.min(a, b) + 1e-6 && v < Math.max(a, b) - 1e-6, `${msg}: ${v} が ${a} と ${b} の間にない`);
// 線分が矩形（内側）を横切るか
const segHitsRect = (p, q, r) => Math.min(p[0], q[0]) < r.x + r.w - 0.5 && Math.max(p[0], q[0]) > r.x + 0.5 && Math.min(p[1], q[1]) < r.y + r.h - 0.5 && Math.max(p[1], q[1]) > r.y + 0.5;

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
  async zoom_lowered_warns() {   // fitCamera が倍率を下げたら、台本の書き手に知らせる（M7 の制限 2）
    const nodes = [], edges = [];
    for (let i = 0; i < 8; i++) { nodes.push({ id: "n" + i, label: "ノード" + i }); if (i > 0) edges.push({ from: "n" + Math.floor((i - 1) / 3), to: "n" + i, label: "呼ぶ" }); }
    const mk = target => deck6({ a: { title: "A", parts: [{ figure: "g" }] } }, [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g", at: "a" }, { zoom: target, at: "b" }] }])], { g: { type: "graph", nodes, edges } });
    const M = await build(mk("n7"));   // 端の密な箱: 倍率 2 から 1.67 に下がる
    assert.deepStrictEqual(M.errors || [], []);
    hasWarn(M, /行 l1（zoom）: .*倍率を [0-9.]+ に下げた/);
    assert.ok(!(await build(mk("all")).then(m => m.warnings || [])).some(w => /倍率を [0-9.]+ に下げた/.test(w)), "zoom all で下げた警告が出た");
  },
  async figure_part_align() {   // figure を指す部品に書いた fit・valign・halign が効く（M7 の制限 3）
    const area = { col: [1, 12], row: [1, 6] };
    const mk = (part, fig = {}) => build(deck6({ a: { title: "A", parts: [{ figure: "f1", area, ...part }] } }, [SC("s1", "a")], { f1: { ...L1, ...fig } }));
    const bottom = async (part, fig) => { const M = await mk(part, fig); assert.deepStrictEqual(M.errors || [], []); const sc = M.scenes[0], F = M.figs.f1, pl = sc.place.f1, A = sc.areas[0]; return { M, F, pl, A, gap: A.y + A.h - (pl.oy + F.y1 * pl.s) }; };
    const b = await bottom({ valign: "bottom", fit: "content" });
    assert.ok(Math.abs(b.gap) <= 1, `部品の valign: bottom が効かない（下端の差 ${b.gap}）`);
    const t = await bottom({ fit: "content" });   // 図の既定（テキストは上）
    assert.ok(t.gap > 5, "valign を書かないと上に寄る");
    const d = await bottom({ valign: "top", fit: "content" }, {});   // 宣言が bottom、部品が top なら部品が勝つ
    const w = await bottom({ valign: "top" }, { valign: "bottom", fit: "content" });
    assert.ok(w.gap > 5, "部品の valign が図の宣言に負けた");
    const o = await bottom({}, { valign: "bottom", fit: "content" });
    assert.ok(Math.abs(o.gap) <= 1, "図の宣言だけの valign が効かなくなった");
    // fit: content を部品に書くと、区画に合わせて組まない（文字が既定の大きさのまま）
    const fitK = async part => (await bottom(part)).F.extra.fillK;
    assert.ok((await fitK({})) > 1, "fit を書かない部品は区画に合わせて組む");
    assert.strictEqual(await fitK({ fit: "content" }), undefined, "部品の fit: content が効かない");
    assert.strictEqual(d.F.spec.fit, undefined, "spec は図の宣言のまま");
    // 2 つの場面: 1 つ目の部品の valign は 2 つ目に引き継がれない
    const two = deck6({ a: { title: "A", parts: [{ figure: "f1", area, valign: "top", fit: "content" }] }, b: { title: "B", parts: [{ figure: "f1", area, fit: "content" }] } }, [SC("s1", "a"), SC("s2", "b")], { f1: { ...L1, valign: "bottom" } });
    const M2 = await build(two), g = M2.scenes[1], F2 = M2.figs.f1;
    assert.ok(Math.abs(g.areas[0].y + g.areas[0].h - (g.place.f1.oy + F2.y1 * g.place.f1.s)) <= 1, "2 つ目の場面が 1 つ目の valign を引き継いだ");
    // fit が最初の場面と違う部品は警告
    const three = deck6({ a: { title: "A", parts: [{ figure: "f1", area, fit: "content" }] }, b: { title: "B", parts: [{ figure: "f1", area }] } }, [SC("s1", "a"), SC("s2", "b")], { f1: L1 });
    hasWarn(await build(three), /部品「f1」の fit（指定なし）は効かない.*最初の場面の fit（content）/);
  },
  async pan_noop_warns() {   // 倍率 1 のままの pan は動かない
    const G = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "db" }] };
    const M = await build(deck6({ a: { title: "A", parts: [{ figure: "g1" }] } }, [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}移ります。", do: [{ show: "g1", at: "a" }, { pan: "db", at: "b" }] }])], { g1: G }));
    assert.deepStrictEqual(M.errors || [], []);
    hasWarn(M, /倍率 1 のまま pan しても動かない/);
  },
  async morph_size_interp() {   // Morph で、区画の大きさが変わると、項目の文字の大きさと表の見出しの矩形の幅が前後の間を通る（M7 の制限 4）
    const A1 = { col: [1, 3], row: [1, 2] }, A2 = { col: [1, 12], row: [1, 6] };
    const mkL = () => ({ type: "list", items: [{ id: "i1", text: "一つ目の項目" }, { id: "i2", text: "二つ目" }, { id: "i3", text: "三つ目" }] });
    const M = await build(areaMorph(mkL(), mkL(), A1, A2));
    assert.deepStrictEqual(M.errors || [], []);
    const s2 = M.scenes[1], it = M.figs.f2.items.i1, from = M.figs.f1.items.i1.texts[0].size, to = it.texts[0].size;
    assert.ok(from < to, `前後で文字の大きさが違わない（${from}・${to}）`);
    const fr = UZ.frame(M, s2.start + 0.4), st = fr.st[it.key];
    between(st.fontK * to, from, to, "項目の文字の大きさ");
    assert.strictEqual(UZ.frame(M, s2.start + 1.0).st[it.key].fontK ?? 1, 1, "Morph が終わっても文字の大きさが戻らない");
    // 描いた SVG の font-size も前後の間
    const sizes = [...renderSvg(M, s2.start + 0.4).matchAll(/font-size="([0-9.]+)"/g)].map(m => +m[1]);
    assert.ok(sizes.some(z => z > from + 0.05 && z < to - 0.05), `描いた文字の大きさが前後の間にない: ${[...new Set(sizes)]}`);
    // 表の見出しの矩形（rect）の幅
    const T = (c1, c2) => ({ type: "table", columns: [c1, c2], rows: [{ id: "r1", cells: ["あ", "い"] }] });
    const M2 = await build(areaMorph(T("名前", "値"), T("項目", "数値"), { col: [1, 6], row: [1, 3] }, A2));
    assert.deepStrictEqual(M2.errors || [], []);
    const h = M2.figs.f2.items.header, p = M2.acts.find(a => a.verb === "morph").pairs.find(x => x.to === h.key);
    assert.ok(p && p.fromBox && Math.abs(p.fromBox.w - h.w) > 5, "見出しの矩形の幅が前後で変わらない");
    const st2 = UZ.frame(M2, M2.scenes[1].start + 0.4).st[h.key];
    between(st2.rect.w, p.fromBox.w, h.w, "見出しの矩形の幅");
  },
  async morph_table_header_swap() {   // 見出しの文字が前後で違うと、入れ替える（項目と同じ）
    const T = (c1, c2) => ({ type: "table", columns: [c1, c2], rows: [{ id: "r1", cells: ["あ", "い"] }] });
    const A = { col: [1, 12], row: [1, 6] };
    const M = await build(areaMorph(T("名前", "値"), T("項目", "数値"), A, A));
    assert.deepStrictEqual(M.errors || [], []);
    const h = M.figs.f2.items.header, s2 = M.scenes[1];
    const early = UZ.frame(M, s2.start + 0.4).st[h.key];
    assert.deepStrictEqual(early.textsFrom, ["名前", "値"]);
    assert.deepStrictEqual(early.texts, ["項目", "数値"]);
    assert.ok(Math.abs(early.textP - 0.5) < 0.05, `入れ替えの進み具合 ${early.textP}`);
    // 描いた SVG: 前半は前の文字、後半は新しい文字
    assert.ok(renderSvg(M, s2.start + 0.15).includes("名前") && !renderSvg(M, s2.start + 0.15).includes("項目"), "前半に前の見出しが出ていない");
    assert.ok(renderSvg(M, s2.start + 0.65).includes("項目") && !renderSvg(M, s2.start + 0.65).includes("名前"), "後半に新しい見出しが出ていない");
    assert.ok(renderSvg(M, s2.start + 1.2).includes("数値"), "終わっても新しい見出しが出ない");
  },
  space_project_front() {
    const cam = UZ.spaceCamera({ yaw: 0, pitch: 0, scale: 10, target: [0, 0, 0] }, 200, 100, { min: [0, 0, 0], max: [1, 1, 1] });
    assert.deepStrictEqual(cam.project([1, 0, 0]).map(Math.abs), [110, 50, 0]);
    assert.deepStrictEqual(cam.project([0, 0, 1]), [100, 40, 0]);
    assert.strictEqual(cam.project([0, 1, 0])[2], 1);
  },
  space_project_top() {
    const cam = UZ.spaceCamera({ yaw: 0, pitch: 90, scale: 10, target: [0, 0, 0] }, 200, 100, { min: [0, 0, 0], max: [1, 1, 1] });
    assert.ok(Math.abs(cam.project([0, 1, 0])[1] - 40) < 1e-9);
    assert.ok(Math.abs(cam.project([0, 0, 1])[2] + 1) < 1e-9);
  },
  space_pitch_clamp() {
    const B = { min: [0, 0, 0], max: [1, 1, 1] }, p = [0.3, 0.7, 0.5];
    const a = UZ.spaceCamera({ yaw: 20, pitch: 120, scale: 10 }, 200, 100, B).project(p), b = UZ.spaceCamera({ yaw: 20, pitch: 90, scale: 10 }, 200, 100, B).project(p);
    assert.deepStrictEqual(a, b);
  },
  space_auto_scale_rotation_invariant() {
    const B = { min: [-1, -2, 0], max: [3, 2, 4] };
    assert.strictEqual(UZ.spaceCamera({ yaw: 0 }, 300, 200, B).s, UZ.spaceCamera({ yaw: 37 }, 300, 200, B).s);
    assert.strictEqual(UZ.spaceCamera({}, 300, 200, { min: [1, 1, 1], max: [1, 1, 1] }).s, 1);
  },
  space_expr() {
    assert.strictEqual(UZ.spaceExpr("a*2+sin(0)", ["a"])({ a: 3 }), 6);
    assert.strictEqual(UZ.spaceExpr(5, [])({}), 5);
    assert.throws(() => UZ.spaceExpr("b+1", ["a"]));
    assert.strictEqual(UZ.spaceExpr("a", ["a"]), UZ.spaceExpr("a", ["a"]), "同じ式はキャッシュされる");
  },
  space_sort() {
    const mkc = () => UZ.spaceCamera({ yaw: 0, pitch: 0, scale: 10 }, 200, 100, { min: [0, 0, 0], max: [4, 4, 4] });
    const sq = (id, y) => ({ id, kind: "polygon", points: [[0, y, 0], [1, y, 0], [1, y, 1], [0, y, 1]] });
    for (const items of [[sq("far", 3), sq("near", 1)], [sq("near", 1), sq("far", 3)]]) {
      const P = UZ.spacePrims({ items }, {}, mkc(), UZ.styleOf(TH));
      assert.deepStrictEqual(P.map(p => p.id), ["far", "near"]);
    }
  },
  space_surface_nan() {
    const S = UZ.styleOf(TH), decl = { items: [{ id: "s", kind: "surface", f: "1/x", x: [-1, 1], y: [-1, 1], grid: 4 }] };
    const cam = UZ.spaceCamera({}, 200, 100, UZ.spaceBounds(decl, {}));
    const P = UZ.spacePrims(decl, {}, cam, S);
    assert.ok(P.length > 0 && P.every(p => p.pts.every(q => q.every(Number.isFinite))));
    assert.ok(P.length < 16, "NaN を含む四角形が除かれている");
  },
  space_max_prims() {
    const S = UZ.styleOf(TH), sf = id => ({ id, kind: "surface", f: "x*y", x: [-1, 1], y: [-1, 1], grid: 64 });
    const decl = { items: [sf("a"), sf("b")] }, cam = UZ.spaceCamera({}, 200, 100, UZ.spaceBounds(decl, {}));
    assert.throws(() => UZ.spacePrims(decl, {}, cam, S), /プリミティブが多すぎる/);
    assert.ok(UZ.spacePrims({ items: [sf("a")] }, {}, cam, S).length <= UZ.SPACE.maxPrims);
  },
  space_kinds() {   // 各種類がプリミティブになり、plate は無視される
    const S = UZ.styleOf(TH), v = { a: 1 };
    const decl = { axes: { x: [-2, 2], y: [-2, 2], z: [0, 3], labels: { x: "x" } }, items: [
      { id: "p", kind: "point", at: [1, "a", 2], label: "P" }, { id: "ln", kind: "line", from: [0, 0, 0], to: [1, 1, 1] },
      { id: "ar", kind: "arrow", from: [0, 0, 0], to: [1, 2, 2] }, { id: "bx", kind: "box", min: [0, 0, 0], max: [1, 1, 1] },
      { id: "cv", kind: "curve", fn: ["cos(t)", "sin(t)", "t"], t: [0, 3], n: 8 }, { id: "tx", kind: "text", at: [0, 0, 3], text: "最大" },
      { id: "pl", kind: "plate", figure: "x", origin: [0, 0, 0], size: [1, 1] }] };
    const cam = UZ.spaceCamera({ yaw: 30, pitch: 25 }, 300, 200, UZ.spaceBounds(decl, v));
    const P = UZ.spacePrims(decl, v, cam, S), cnt = k => P.filter(p => p.id === k).length;
    assert.strictEqual(cnt("bx"), 6); assert.strictEqual(cnt("cv"), 8); assert.strictEqual(cnt("p"), 2); assert.strictEqual(cnt("pl"), 0);
    assert.strictEqual(cnt("ar"), 2); assert.ok(P.some(p => p.kind === "text" && p.text === "最大"));
    for (let i = 1; i < P.length; i++) assert.ok(P[i - 1].depth >= P[i].depth, "奥から手前");
  },
  space_expr_digits_and_clashes() {
    assert.strictEqual(UZ.spaceExpr("a2*3+1e2", ["a2"])({ a2: 2 }), 106);
    assert.strictEqual(UZ.spaceExpr("th1", ["th1"])({ th1: 5 }), 5);
    assert.throws(() => UZ.spaceExpr("max+1", ["max"]), /同じ/);
    assert.throws(() => UZ.spaceExpr("PI", ["PI"]));
  },
  space_value_named_x() {   // 値の名前が x・y・t でも落ちない（extra が優先）
    const S = UZ.styleOf(TH), v = { x: 3, t: 1 };
    const decl = { items: [{ id: "s", kind: "surface", f: "x+y", x: [0, 1], y: [0, 1], grid: 2 }, { id: "c", kind: "curve", fn: ["t", "x", "0"], t: [0, 1], n: 2 }] };
    const P = UZ.spacePrims(decl, v, UZ.spaceCamera({}, 200, 100, UZ.spaceBounds(decl, v)), S);
    assert.ok(P.length > 0);
  },
  space_prim_ids_and_bounds() {
    const S = UZ.styleOf(TH), v = {};
    const decl = { bounds: { min: [0, 0, 0], max: [2, 2, 2] }, axes: null, items: [{ id: "axes", kind: "box", min: [0, 0, 0], max: [1, 1, 1] }, { id: "ar", kind: "arrow", from: [0, 0, 0], to: [1, 0, 0] }] };
    const cam = UZ.spaceCamera({}, 200, 100, UZ.spaceBounds(decl, v));
    assert.ok(Math.abs(cam.R - Math.sqrt(3)) < 1e-9);
    const P = UZ.spacePrims({ ...decl, axes: { x: [0, 1] } }, v, cam, S);
    assert.strictEqual(P.filter(p => p.id === "axes").length, 6);
    assert.ok(P.some(p => p.id === "$axes") && P.some(p => p.id === "ar" && p.key === "ar:shaft") && P.every(p => p.el === undefined));
    assert.throws(() => UZ.spaceBounds({ bounds: { x: [0, 1] } }, v), /bounds/);
  },
  space_shade() {
    const S = UZ.styleOf(TH), c = "#2255aa";
    assert.strictEqual(UZ.spaceShade(c, [0.4, -0.5, 0.75], S), c, "光に正対すると元の色");
    assert.notStrictEqual(UZ.spaceShade(c, [0.5, 0.4, 0], S), c);
  },
  async series_z_avoids_boxes() {   // 系列で置き換わる辺（a>c）が、間にある箱 b を貫かない（M7 の制限 5）
    const N = ["a", "b", "c"].map(id => ({ id, label: id }));
    const H1 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }] };
    const H2 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] };
    const M = await build(seriesDeck({ g1: H1, g2: H2 }, [["g1"], ["g2", "g1"]]));
    assert.deepStrictEqual(M.errors || [], []);
    const e = M.figs.g1.items["a>c"], b = M.figs.g1.items.b;
    for (let i = 1; i < e.pts.length; i++) assert.ok(!segHitsRect(e.pts[i - 1], e.pts[i], b), `a>c の線が b を貫く: ${JSON.stringify(e.pts)}`);
    assert.ok(!(M.warnings || []).some(w => /Morph の系列で矢印が箱に重なる/.test(w)), JSON.stringify(M.warnings));
    const A = M.figs.g1.items.a, C = M.figs.g1.items.c, p0 = e.pts[0], pn = e.pts[e.pts.length - 1];
    assert.ok(p0[0] >= A.x - 0.5 && p0[0] <= A.x + A.w + 0.5 && p0[1] >= A.y - 0.5 && p0[1] <= A.y + A.h + 0.5, "始点が a の縁にない");
    assert.ok(pn[0] >= C.x - 0.5 && pn[0] <= C.x + C.w + 0.5 && pn[1] >= C.y - 0.5 && pn[1] <= C.y + C.h + 0.5, "終点が c の縁にない");
  },
  async series_replaced_heads_not_overlap() {   // 同じ箱に入る矢印の入り口が重ならない（置き換わる辺と、同じ図の別の辺）
    const N = ["a", "b", "c"].map(id => ({ id, label: id }));
    const H1 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }] };
    const H2 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] };
    const M = await build(seriesDeck({ g1: H1, g2: H2 }, [["g1"], ["g2", "g1"]]));
    const F = M.figs.g1, ends = ["b>c", "a>c"].map(id => F.items[id].pts[F.items[id].pts.length - 1]);
    assert.ok(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) >= 10, `c に入る 2 本の矢じりが重ならない: ${JSON.stringify(ends)}`);
  },
  async figure_scene_title_in_camera() {   // 図だけの場面で zoom すると、図の題も同じカメラの g の中にある（M7 の制限 6）
    const sb = { format: "ugoku-zukai/6", title: "検査", voice: { speaker: 8, speed: 1.1 },
      figures: { l1: { ...L1, title: "図の題です" }, l2: { ...L1, title: "もう 1 つの題" } },
      scenes: [{ id: "s1", figure: ["l1", "l2"], lines: [{ id: "l1", text: "{a}寄せます。", do: [{ show: "l1", at: "a" }, { zoom: "l1/i1", at: "a" }] }, { id: "l2", text: "そのままです。" }] }] };
    const M = await build(sb);
    assert.deepStrictEqual(M.errors || [], []);
    const t = M.timeline.lines.find(l => l.id === "l2").start + 0.5;
    const svg = renderSvg(M, t);
    assert.ok(UZ.frame(M, t).camera.on, "カメラが寄せている");
    const i = svg.indexOf("図の題です");
    assert.ok(i > 0, "題が描かれている");
    const before = svg.slice(0, i);
    // 題の祖先の g のうち、transform を持つものがある（開いたままの g を後ろから数える）
    const stack = [];
    for (const m of before.matchAll(/<g\b[^>]*>|<\/g>/g)) { if (m[0] === "</g>") stack.pop(); else if (!m[0].endsWith("/>")) stack.push(m[0]); }   // 空の <g/> は開かない
    assert.ok(stack.some(g => /^<g\b[^>]*transform="translate\([^"]*\) scale\([\d.]+\)"/.test(g)), `題がカメラの g の子孫にない: ${stack.join(" ")}`);
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
