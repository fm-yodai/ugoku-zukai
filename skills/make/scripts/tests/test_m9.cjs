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

// 部品 space の検査用: 値 th（yaw）を 0 → 90 に set する台本。lines を渡せば、その行で
const SPACE_PART = () => ({ id: "sp", type: "space", camera: { yaw: "th", pitch: 20 }, axes: { x: [-2, 2], y: [-2, 2], z: [0, 2] },
  items: [{ id: "P", kind: "point", at: [1, 0, 1], label: "P" }, { id: "L", kind: "line", from: [0, 0, 0], to: [1, 1, 1] },
    { id: "F", kind: "polygon", points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }] });
const spaceDeck = (lines, part = SPACE_PART(), format) => {
  const sb = deck6({ a: { title: "A", parts: [part] } },
    [SC("s1", "a", lines || [{ id: "l1", text: "{a}出して{b}回します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 90, at: "b", dur: 1 }] }])], {}, { values: { th: 0 } });
  if (format) sb.format = format;
  return sb;
};
// 要素 id の SVG 要素（data-s3 の付いたタグ）を拾う
const s3Tags = (svg, id, tag) => [...svg.matchAll(new RegExp(`<${tag || "[a-z]+"}\\b[^>]*data-s3="${id}"[^>]*>`, "g"))].map(m => m[0]);
const attrOf = (tag, k) => { const m = new RegExp(`\\s${k}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const rgbOf = c => { const m = /^#([0-9a-f]{6})$/i.exec(c); assert.ok(m, `色が #rrggbb でない: ${c}`); return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)); };
// 同じ View で続けて描いたときの SVG
const renderSeq = (M, ts) => {
  loadView();
  const { serialize } = require("../svg_dom.cjs");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const V = new UZ.View(svg, M);
  for (const t of ts) V.render(t);
  return serialize(svg);
};

// check_storyboard.cjs と同じ検査（build・配置・部品を描いて見る）。errors・warnings・layout を返す
const checkSpace = async sb => {
  const { guardedCall } = require("../uz_node.cjs");
  const M = await build(sb);
  if ((M.errors || []).length) return { errors: M.errors, warnings: M.warnings || [], layout: [] };
  const layout = UZ.checkLayout(M);
  const DOC = require("../svg_dom.cjs").makeDocument();
  const el = (tag, attrs, parent) => {
    const e = DOC.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const cr = UZ.checkCustoms(M, el, { call: guardedCall() });
  return { errors: cr.errors, warnings: (M.warnings || []).concat(cr.warnings), layout };
};

// geo 検査用（test_m8.cjs と同じ）: svg_dom の document で要素を作る el
const SVGDOM = require("../svg_dom.cjs");
const DOC = SVGDOM.makeDocument();
const fakeEl = (tag, attrs, parent) => {
  const e = DOC.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const newGeo = () => ({ geo: UZ.makeGeo(fakeEl, UZ.styleOf(TH)), g: fakeEl("g") });


// 2.5D の板（plate）の検査用: 部品 sp に板を並べたスライド 1 枚。lines は場面 s1 の行
const PL = (id, figure, z, o = {}) => ({ id, kind: "plate", figure, origin: [-2, 0, z], size: [4, 0.8], ...o });
const PF2 = { type: "list", items: [{ id: "i2", text: "中段の層" }] }, PF3 = { type: "list", items: [{ id: "i3", text: "下段の層" }] };
const plateDeck = (items, lines, o = {}) => deck6({ a: { title: "A", parts: [{ id: "sp", type: "space", camera: o.camera || { yaw: 0, pitch: "pt" }, ...(o.part || {}), items }, ...(o.parts || [])] } },
  [SC("s1", "a", lines)], o.figures || { g1: G1, f2: PF2, f3: PF3 }, { values: o.values || { th: 0, pt: 0 } });
const plateOrder = svg => [...svg.matchAll(/data-plate="([^"]+)"/g)].map(m => m[1]);
const lastEnd = M => Math.max(...M.timeline.lines.map(l => l.start + l.dur));

// 意味のズーム（inside）の検査用: 図 g の箱 server の中身が図 srv。srv の箱 db の中身を dbf にもできる（nested）
const SRV = (o = {}) => ({ type: "graph", nodes: [{ id: "web", label: "Web" }, { id: "cache", label: "キャッシュ" }, { id: "db", label: "DB", ...(o.db || {}) }], edges: [{ from: "web", to: "cache" }, { from: "cache", to: "db" }] });
const IG = () => ({ type: "graph", nodes: [{ id: "client", label: "利用者" }, { id: "server", label: "サーバー", inside: "srv" }], edges: [{ from: "client", to: "server" }] });
const DBF = { type: "graph", nodes: [{ id: "idx", label: "索引" }, { id: "tbl", label: "テーブル" }], edges: [{ from: "idx", to: "tbl" }] };
const insideDeck = (lines, figures = {}) => deck6({ a: { title: "A", parts: [{ figure: "g" }] } }, [SC("s1", "a", lines)], { g: IG(), srv: SRV(), ...figures });
const LN = (id, text, act) => ({ id, text, do: act ? [{ ...act, at: "a" }] : [] });
const lineEnd = (M, id) => { const l = M.timeline.lines.find(x => x.id === id); return l.start + l.dur; };
const zoomAct = (M, line) => M.acts.find(a => a.verb === "zoom" && a.line === line);

const tests = {
  async geo_space() {
    const { geo, g } = newGeo();
    const box = { x: 40, y: 30, w: 300, h: 200 };
    const sp = geo.space(g, box, { yaw: 30, pitch: 25, bounds: { min: [0, 0, 0], max: [2, 2, 2] } });
    sp.box([0, 0, 0], [1, 1, 1], { color: "accent" });
    sp.render();
    const svg = SVGDOM.serialize(g);
    const paths = [...svg.matchAll(/<path [^>]*>/g)].map(m => m[0]);
    assert.strictEqual(paths.length, 6, `面は 6 枚: ${paths.length}`);
    // 描いた順 = 奥から手前（同じ宣言を UZ.spacePrims で並べた順と同じ）
    const S = UZ.styleOf(TH), cam = UZ.spaceCamera({ yaw: 30, pitch: 25 }, box.w, box.h, { min: [0, 0, 0], max: [2, 2, 2] });
    const prims = UZ.spacePrims({ items: [{ id: "g1", kind: "box", min: [0, 0, 0], max: [1, 1, 1] }] }, {}, cam, S);
    assert.strictEqual(prims.length, 6);
    const dOf = p => "M" + p.pts.map(q => `${(Math.round(q[0] * 100) / 100).toFixed(2)},${(Math.round(q[1] * 100) / 100).toFixed(2)}`).join("L") + "Z";
    paths.forEach((tag, i) => assert.ok(tag.includes(`d="${dOf(prims[i])}"`), `${i} 番目の面の順・形が違う: ${tag}`));
    for (let i = 1; i < prims.length; i++) assert.ok(prims[i - 1].depth >= prims[i].depth, "奥から手前");
    assert.ok(svg.includes(`translate(${box.x},${box.y})`), "箱の位置に動かしている");
    // project は spaceCamera と同じ値（部品の座標 = 箱の左上を足す）
    for (const p of [[0, 0, 0], [1, 1, 1], [2, 0.5, 1.5]]) {
      const a = sp.project(p), b = cam.project(p);
      assert.ok(Math.abs(a[0] - (b[0] + box.x)) < 1e-9 && Math.abs(a[1] - (b[1] + box.y)) < 1e-9, `project(${p}) = ${a}`);
    }
  },
  async geo_space_items() {
    const { geo, g } = newGeo();
    const sp = geo.space(g, { x: 0, y: 0, w: 300, h: 200 }, { yaw: 20, pitch: 20 });
    sp.point([1, 1, 1], { id: "p", label: "P" });
    sp.line([[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    sp.arrow([0, 0, 0], [0, 0, 2]);
    sp.polygon([[0, 0, 0], [2, 0, 0], [2, 2, 1]], { opacity: 0.5 });
    sp.text([0, 0, 2], "ラベル");
    sp.surface((x, y) => x * y, [0, 1], [0, 1], { grid: 4 });
    // 式の surface と同じ網目（grid 4 → 16 面）
    const surf16 = (() => { const d = { items: [{ id: "a", kind: "surface", f: "x*y", x: [0, 1], y: [0, 1], grid: 4 }] };
      return UZ.spacePrims(d, {}, UZ.spaceCamera({}, 300, 200, UZ.spaceBounds(d, {})), UZ.styleOf(TH)).length; })();
    assert.strictEqual(surf16, 16);
    sp.render();
    const svg = SVGDOM.serialize(g);
    assert.ok(svg.includes('data-s3="p"'), "id を渡した要素");
    assert.ok(svg.includes('data-s3="g2"') && svg.includes('data-s3="g5"'), "自動の id");
    assert.ok(svg.includes("ラベル") && svg.includes(">P<"));
    assert.deepStrictEqual(geo.errors, []);
    // 関数の曲面は 16 面 = path が 16 枚（g6）
    assert.strictEqual([...svg.matchAll(/<path [^>]*data-s3="g6"/g)].length, 16);
    // 描き直しても同じ（時刻だけで決まる）
    const g2 = fakeEl("g"); const sp2 = geo.space(g2, { x: 0, y: 0, w: 300, h: 200 }, { yaw: 20, pitch: 20 });
    sp2.point([1, 1, 1], { id: "p", label: "P" }); sp2.line([[0, 0, 0], [1, 0, 0], [1, 1, 0]]); sp2.arrow([0, 0, 0], [0, 0, 2]);
    sp2.polygon([[0, 0, 0], [2, 0, 0], [2, 2, 1]], { opacity: 0.5 }); sp2.text([0, 0, 2], "ラベル"); sp2.surface((x, y) => x * y, [0, 1], [0, 1], { grid: 4 }); sp2.render();
    assert.strictEqual(SVGDOM.serialize(g2), svg);
  },
  async geo_space_bounds_freeze() {
    const { geo, g } = newGeo();
    const sp = geo.space(g, { x: 10, y: 10, w: 300, h: 200 }, { yaw: 0, pitch: 0 });
    sp.point([0, 0, 0]); sp.point([2, 2, 2]);
    const a = sp.project([1, 1, 1]);
    sp.point([10, 10, 10]);   // project の後に足しても、カメラは変わらない（凍結）
    const b = sp.project([1, 1, 1]);
    assert.deepStrictEqual(a, b);
    sp.render();
    const o = sp.project([0, 0, 0]);
    assert.ok(SVGDOM.serialize(g).includes(`cx="${(Math.round((o[0] - 10) * 100) / 100).toFixed(2)}"`), "render は project と同じカメラ");
  },
  async geo_space_fn_rejected_in_storyboard() {
    const M = await build(deck6({ a: { title: "A", parts: [{ figure: "sp" }] } }, [SC("s1", "a")],
      { sp: { type: "space", items: [{ id: "s", kind: "surface", f: () => 1, x: [0, 1], y: [0, 1] }] } }));
    assert.ok((M.errors || []).length > 0, "関数の f は台本では誤り");
  },
  async space_validate() {
    const one = (part, extra = {}) => build(deck6({ a: { title: "A", parts: [part] } }, [SC("s1", "a")], {}, { values: { th: 0 }, ...extra }));
    const P = SPACE_PART();
    hasErr(await one({ id: "sp", type: "space" }), /items がない/);
    hasErr(await one({ ...P, items: [{ id: "q", kind: "cone", at: [0, 0, 0] }] }), /kind は/);
    hasErr(await one({ ...P, items: [{ id: "q", kind: "point" }] }), /q.*at/);
    hasErr(await one({ ...P, items: [{ id: "q", kind: "point", at: [0, "zz", 0] }] }), /名前「zz」が分からない/);
    hasErr(await one({ ...P, camera: { yaw: "zz2", pitch: 0 } }), /名前「zz2」が分からない/);
    hasErr(await one({ ...P, items: [{ id: "q", kind: "point", at: [0, 0] }] }), /\[x, y, z\]/);
    hasErr(await one({ ...P, items: [{ id: "q", kind: "point", at: [0, 0, 0] }, { id: "q", kind: "point", at: [1, 0, 0] }] }), /重複/);
    hasErr(await one({ ...P, items: [{ id: "$axes", kind: "point", at: [0, 0, 0] }] }), /\$axes/);
    hasErr(await one({ ...P, items: [{ id: "s", kind: "surface", f: "x*q", x: [0, 1], y: [0, 1] }] }), /名前「q」が分からない/);
    const ok = await one(P);
    assert.deepStrictEqual(ok.errors || [], []);
    // /5 では 1 件だけ
    const M5 = await build(spaceDeck(null, SPACE_PART(), "ugoku-zukai/5"));
    const hits = (M5.errors || []).filter(e => /space の部品 を使っている。使うには format を "ugoku-zukai\/6" と書く/.test(e));
    assert.strictEqual(hits.length, 1, JSON.stringify(M5.errors));
  },
  async space_render_values() {
    const M = await build(spaceDeck());
    assert.deepStrictEqual(M.errors || [], []);
    const s = M.acts.find(a => a.verb === "set"), part = M.figs.sp.spec;
    const cxAt = t => { const c = s3Tags(renderSvg(M, t), "P", "circle"); assert.strictEqual(c.length, 1, `点の circle の数: ${c.length}`); return +attrOf(c[0], "cx"); };
    const before = cxAt(s.start - 0.01), after = cxAt(s.end + 0.05);
    assert.ok(Math.abs(before - after) > 5, `set の前後で cx が同じ: ${before} ${after}`);
    const fr = UZ.frame(M, s.end + 0.05), pl = fr.figs.sp.place;
    const v = { th: 90 }, cam = UZ.spaceCamera({ yaw: 90, pitch: 20 }, pl.w, pl.h, UZ.spaceBounds(part, v));
    const want = cam.project([1, 0, 1])[0];
    assert.ok(Math.abs(after - want) < 0.5, `cx=${after} 期待=${want}`);
  },
  async space_show_focus() {
    const M = await build(spaceDeck([
      { id: "l1", text: "{a}点を出し、{b}線を描きます。", do: [{ show: "sp/P", at: "a" }, { show: "L", at: "b", draw: true }] },
      { id: "l2", text: "{a}点に注目します。", do: [{ focus: "P", at: "a" }] }]));
    assert.deepStrictEqual(M.errors || [], []);
    const [shP, shL] = M.acts.filter(a => a.verb === "show"), fo = M.acts.find(a => a.verb === "focus");
    const mid = renderSvg(M, (shP.end + shL.start) / 2);
    assert.strictEqual(s3Tags(mid, "P", "circle").length, 1, "点が出ていない");
    assert.strictEqual(s3Tags(mid, "L").length, 0, "show の前に線が描かれている");
    assert.strictEqual(s3Tags(mid, "F").length, 0, "出していない面が描かれている");
    const drawing = renderSvg(M, shL.start + shL.each * 0.3);
    const lp = s3Tags(drawing, "L", "path");
    assert.ok(lp.length && lp.some(p => /stroke-dasharray=/.test(p)), `draw の途中で線が伸びていない: ${lp}`);
    const opL = t => +attrOf(s3Tags(renderSvg(M, t), "L", "path")[0], "opacity");
    const a = opL(fo.start - 0.01), b = opL(fo.end + 0.05);
    assert.ok(b < a - 0.3, `focus で他の要素が薄くならない: ${a} → ${b}`);
    const pO = +attrOf(s3Tags(renderSvg(M, fo.end + 0.05), "P", "circle")[0], "opacity");
    assert.ok(pO > 0.95, `focus の対象が薄い: ${pO}`);
  },
  async space_seek_same() {
    const M = await build(spaceDeck());
    assert.deepStrictEqual(M.errors || [], []);
    const s = M.acts.find(a => a.verb === "set"), tMid = (s.start + s.end) / 2, tEnd = M.duration - 0.5;
    const a = renderSeq(M, [tEnd, tMid]), b = renderSeq(M, [tMid]);
    assert.ok(s3Tags(b, "P", "circle").length === 1, "真ん中の時刻で点がない");
    assert.strictEqual(a, b);
  },
  async space_shade_themes() {
    const part = { id: "sp", type: "space", camera: { yaw: 30, pitch: 30 }, items: [{ id: "F", kind: "polygon", points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], color: "accent" }] };
    for (const name of ["koo", "kuro"]) {
      const th = theme(name), S = UZ.styleOf(th);
      const M = await UZ.build(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], part), th, null);
      assert.deepStrictEqual(M.errors || [], []);
      const fr = UZ.finalFrame(M, "a"), f = s3Tags(renderSvg(M, fr.t, fr), "F", "path");
      assert.strictEqual(f.length, 1, `${name}: 面の数 ${f.length}`);
      const fill = attrOf(f[0], "fill"), c = rgbOf(fill), o = rgbOf(UZ.colorOf(S, "accent")), bg = rgbOf(S.bg);
      assert.notStrictEqual(fill.toLowerCase(), UZ.colorOf(S, "accent").toLowerCase(), `${name}: 陰影が付いていない`);
      for (let i = 0; i < 3; i++) assert.ok(c[i] >= Math.min(o[i], bg[i]) - 1 && c[i] <= Math.max(o[i], bg[i]) + 1, `${name}: ${fill} が ${S.bg} と元の色の間にない`);
    }
  },
  async space_complete_frame() {
    const M = await build(spaceDeck());
    assert.deepStrictEqual(M.errors || [], []);
    const fr = UZ.finalFrame(M, "a");
    assert.deepStrictEqual(fr.values, { th: 90 });
    const svg = renderSvg(M, fr.t, fr), pl = fr.figs.sp.place;
    for (const id of ["P", "L", "F"]) assert.ok(s3Tags(svg, id).length, `完成形に ${id} がない`);
    const cam = UZ.spaceCamera({ yaw: 90, pitch: 20 }, pl.w, pl.h, UZ.spaceBounds(M.figs.sp.spec, { th: 90 }));
    const cx = +attrOf(s3Tags(svg, "P", "circle")[0], "cx");
    assert.ok(Math.abs(cx - cam.project([1, 0, 1])[0]) < 0.5, `完成形の cx=${cx}`);
  },
  // ---- Task 8: space の検査と、3D の要素への zoom ----
  async space_check_overflow() {
    const part = { ...SPACE_PART(), camera: { yaw: 30, pitch: 20, scale: 400 } };
    const r = await checkSpace(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], part));
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.warnings.some(w => /部品「sp」.*はみ出す/.test(w)), JSON.stringify(r.warnings));
    const ok = await checkSpace(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }]));
    assert.ok(!ok.warnings.some(w => /はみ出す/.test(w)), `収まる台本で警告: ${JSON.stringify(ok.warnings)}`);
  },
  async space_check_nan() {
    const part = { id: "sp", type: "space", camera: { yaw: 30, pitch: 20 }, axes: { x: [-2, 2], y: [-2, 2], z: [0, 2] },
      items: [{ id: "S", kind: "surface", f: "sqrt(-1 - x*x)", x: [-1, 1], y: [-1, 1], grid: 6 }, { id: "P", kind: "point", at: [0, 0, 1] }] };
    const r = await checkSpace(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], part));
    assert.ok(r.errors.some(e => /部品「sp」.*要素「S」.*数にならない/.test(e)), JSON.stringify(r.errors));
    assert.ok(!r.errors.some(e => /要素「P」/.test(e)), JSON.stringify(r.errors));
    // 一部の網目だけ NaN（定義域の外）は、誤りにしない
    part.items[0].f = "sqrt(1 - x*x - y*y)";
    const r2 = await checkSpace(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], part));
    assert.deepStrictEqual(r2.errors, []);
  },
  async space_check_intersect() {
    const A = { id: "A", kind: "polygon", points: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]] };
    const B = { id: "B", kind: "polygon", points: [[-0.5, 0, -1], [0.5, 0, -1], [0.5, 0, 1], [-0.5, 0, 1]] };
    const W = { id: "W", kind: "polygon", points: [[-1, 1, 0], [1, 1, 0], [1, 1, 1], [-1, 1, 1]] };   // A の縁に立つ壁（触れるだけ）
    const K = { id: "K", kind: "box", min: [0.2, -0.8, 0], max: [0.6, -0.4, 0.4] };   // A の上に載る箱（触れるだけ）
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [A, B] }, {}), [["A", "B"]]);
    // 同じ大きさの 2 枚が十字に貫き合う（どの辺も相手の面の縁で交わる）
    const X1 = { id: "X1", kind: "polygon", points: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]] };
    const X2 = { id: "X2", kind: "polygon", points: [[0, -1, -1], [0, 1, -1], [0, 1, 1], [0, -1, 1]] };
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [X1, X2] }, {}), [["X1", "X2"]]);
    // 縁どうしで触れる 2 枚（L 字）は数えない
    const X3 = { id: "X3", kind: "polygon", points: [[1, 0, -1], [1, 1, -1], [1, 1, 1], [1, 0, 1]] };
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [X1, X3] }, {}), []);
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [A, W, K] }, {}), []);
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [A, { ...K, id: "K2", min: [0.2, -0.8, -0.2] }] }, {}), [["A", "K2"]]);
    // 値で動く: 板 B を上へ上げきれば交差しない
    const Bv = { ...B, points: B.points.map(p => [p[0], p[1], `${p[2]} + h`]) };
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [A, Bv] }, { h: 0 }), [["A", "B"]]);
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [A, Bv] }, { h: 1 }), []);
    const part = { id: "sp", type: "space", camera: { yaw: 30, pitch: 20 }, axes: { x: [-2, 2], y: [-2, 2], z: [-1, 1] }, items: [A, B] };
    const r = await checkSpace(spaceDeck([{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], part));
    assert.ok(r.warnings.some(w => /部品「sp」.*「A」と「B」.*前後が決まらない/.test(w)), JSON.stringify(r.warnings));
  },
  async space_zoom_element() {
    // 値 a で点を動かした後、寄りながら yaw を回す。寄せ先は寄り始めの値で投影した点
    const part = { id: "sp", type: "space", camera: { yaw: "th", pitch: 20 }, axes: { x: [-2, 2], y: [-2, 2], z: [0, 2] },
      items: [{ id: "P", kind: "point", at: ["a", 0, 1] }, { id: "Q", kind: "point", at: [-1, -1, 0] }] };
    const mk = rot => build(deck6({ a: { title: "A", parts: [part] } }, [SC("s1", "a", [
      { id: "l1", text: "{a}出して{b}動かします。", do: [{ show: "sp", at: "a" }, { set: "a", to: 1.5, at: "b", dur: 0.5 }] },
      { id: "l2", text: "{a}点に寄って回します。", do: [{ zoom: "P", at: "a" }, ...(rot ? [{ set: "th", to: 90, at: "a", dur: 1 }] : [])] }])], {}, { values: { th: 0, a: -1 } }));
    const M = await mk(true);
    assert.deepStrictEqual(M.errors || [], []);
    const z = M.acts.find(a => a.verb === "zoom"), pl = M.scenes[0].place.sp;
    const v = UZ.valuesAt(M, z.start);
    assert.ok(Math.abs(v.a - 1.5) < 1e-9 && Math.abs(v.th) < 1e-9, JSON.stringify(v));
    const cam = UZ.spaceCamera({ yaw: 0, pitch: 20 }, pl.w, pl.h, UZ.spaceBounds(part, v)), p = cam.project([1.5, 0, 1]);
    const R = z.target, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    assert.ok(Math.abs(cx - (pl.ox + p[0])) <= 1 && Math.abs(cy - (pl.oy + p[1])) <= 1, `寄せ先の中心 ${cx},${cy} 期待 ${pl.ox + p[0]},${pl.oy + p[1]}`);
    assert.ok(R.w < pl.w / 4 && R.h < pl.h / 4, `寄せ先が区画全体のまま: ${JSON.stringify(R)}`);
    const M0 = await mk(false), z0 = M0.acts.find(a => a.verb === "zoom");
    assert.deepStrictEqual(z.to, z0.to, "yaw を回しても to は変わらない");
    // UZ.spaceBBox: 部品のローカル座標の矩形
    const b = UZ.spaceBBox(M.figs.sp, "P", v, pl.w, pl.h, M.S);
    assert.ok(Math.abs(b.x + b.w / 2 - p[0]) <= 1 && Math.abs(b.y + b.h / 2 - p[1]) <= 1, JSON.stringify(b));
  },
  async space_auto_bounds_fixed() {
    // axes も bounds もないとき、自動の大きさと中心は初めの値で 1 回だけ決まる（set で点が動いても全体が寄ったり縮んだりしない）
    const part = { id: "sp", type: "space", camera: { yaw: 30, pitch: 20 },
      items: [{ id: "P", kind: "point", at: ["a", 0, 0] }, { id: "Q", kind: "point", at: [0, 1, 1] }] };
    const sb = deck6({ a: { title: "A", parts: [part] } }, [SC("s1", "a", [
      { id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }, { id: "l2", text: "{a}動かします。", do: [{ set: "a", to: 3, at: "a", dur: 1 }] }])], {}, { values: { a: 0 } });
    const M = await build(sb);
    assert.deepStrictEqual(M.errors || [], []);
    const s = M.acts.find(a => a.verb === "set"), pl = M.scenes[0].place.sp;
    const c0 = UZ.spaceView(part, { a: 0 }, pl.w, pl.h, M.figs.sp.v0), c1 = UZ.spaceView(part, { a: 3 }, pl.w, pl.h, M.figs.sp.v0);
    assert.strictEqual(c0.s, c1.s);
    assert.deepStrictEqual(c0.project([0, 1, 1]), c1.project([0, 1, 1]));
    const qAt = t => { const c = s3Tags(renderSvg(M, t), "Q", "circle"); assert.strictEqual(c.length, 1); return [attrOf(c[0], "cx"), attrOf(c[0], "cy")]; };
    assert.deepStrictEqual(qAt(s.start - 0.01), qAt(s.end + 0.05), "動かない点 Q の位置が set で変わった");
  },
  async space_trace_warn() {
    const M = await build(spaceDeck([{ id: "l1", text: "{a}出して{b}たどります。", do: [{ show: "sp", at: "a" }, { trace: ["L"], at: "b" }] }]));
    assert.deepStrictEqual(M.errors || [], []);
    hasWarn(M, /行 l1（trace）: space の要素「L」には trace がまだ効かない/);
  },
  async space_check_time() {
    const items = [{ id: "S", kind: "surface", f: "sin(x + th/30) * cos(y)", x: [-3, 3], y: [-3, 3], grid: 24, opacity: 0.8 },
      ...Array.from({ length: 9 }, (_, i) => i % 3 === 0 ? { id: `p${i}`, kind: "point", at: [i / 3 - 1.5, 0, 1.2], label: `P${i}` }
        : i % 3 === 1 ? { id: `v${i}`, kind: "arrow", from: [0, 0, 0], to: [1, i / 9, 1] } : { id: `f${i}`, kind: "polygon", points: [[-3, -3, -1.5 - i / 10], [3, -3, -1.5 - i / 10], [3, 3, -1.5 - i / 10]], opacity: 0.4 })];
    const part = { id: "sp", type: "space", camera: { yaw: "th", pitch: 25 }, axes: { x: [-3, 3], y: [-3, 3], z: [-2, 2] }, items };
    const sb = spaceDeck([{ id: "l1", text: "{a}出して{b}回します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 90, at: "b", dur: 2 }] },
      { id: "l2", text: "{a}もう少し回します。", do: [{ set: "th", to: 180, at: "a", dur: 2 }] },
      { id: "l3", text: "{a}戻します。", do: [{ set: "th", to: 0, at: "a", dur: 2 }] }], part);
    const t0 = Date.now(), r = await checkSpace(sb), ms = Date.now() - t0;
    console.log(`     （検査の時間 ${ms}ms）`);
    assert.deepStrictEqual(r.errors, []);
    assert.ok(ms < 1000, `検査に ${ms}ms かかる`);
  },
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
  async plate_validate() {   // 板の宣言の誤り
    const bad = async (items, re, o) => hasErr(await build(plateDeck(items, [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], o)), re);
    await bad([{ id: "layer1", kind: "plate", figure: "g1", size: [4, 1] }], /要素 layer1（plate）に origin がない/);
    await bad([PL("layer1", "nai", 0)], /要素 layer1 の figure「nai」が figures にない/);
    await bad([PL("layer1", "g1", 0, { size: [4] })], /要素 layer1 の size は \[幅, 高さ\]/);
    await bad([PL("layer1", "g1", 0, { tilt: "zz" })], /tilt.*「zz」が分からない/);
    await bad([PL("layer1", "g1", 0)], /板「layer1」の図「g1」は、同じスライドに部品としても置いている/, { parts: [{ figure: "g1", area: { col: [1, 2], row: [1, 1] } }], part: { area: { col: [3, 12], row: [1, 6] } } });
    await bad([PL("g1", "f2", 0)], /板の id「g1」が、図か部品の id と重なる/);
    await bad([PL("layer1", "g1", 0), PL("layer2", { type: "space", items: [{ id: "q", kind: "point", at: [0, 0, 0] }] }, 1)], /要素 layer2 の figure に space は置けない/);
    // 正しい宣言（図の id と、その場の宣言）は通る
    const M = await build(plateDeck([PL("layer1", "g1", 1), PL("layer2", { type: "list", items: [{ id: "k1", text: "その場の層" }] }, 0)],
      [{ id: "l1", text: "{a}出して{b}見ます。", do: [{ show: "sp", at: "a" }, { show: "layer2/k1", at: "b" }] }]));
    assert.deepStrictEqual(M.errors || [], []);
    assert.ok(M.figs.layer1 && M.figs.layer2, "板の図が子の図になっていない");
    assert.deepStrictEqual(M.figs.layer1.parent, { fig: "sp", kind: "plate", item: "layer1" });
  },
  async plate_front_equals_2d() {   // 正面を向いた板（yaw 0・pitch 0）の中の箱は、普通の部品に置いたときと同じ縦横比
    const M2 = await build(deck6({ a: { title: "A", parts: [{ figure: "g1" }] } }, [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: "g1", at: "a" }] }])], { g1: G1 }));
    assert.deepStrictEqual(M2.errors || [], []);
    const A = M2.scenes[0].areas[0], it2 = M2.figs.g1.items.api;
    const W = A.w / 100, H = A.h / 100;
    const M = await build(plateDeck([{ id: "layer1", kind: "plate", figure: "g1", origin: [0, 0, 0], size: [W, H] }],
      [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], { camera: { yaw: 0, pitch: 0, scale: 100, target: [W / 2, 0, -H / 2] }, values: {} }));
    assert.deepStrictEqual(M.errors || [], []);
    const K = M.figs.layer1, it = K.items.api, P = M.figs.sp, pl = M.scenes[0].place.sp, v = {};
    const cam = UZ.spaceView(P.spec, v, pl.w, pl.h, P.v0);
    const m = UZ.childMatrix(K, P.spec.items[0], v, cam);
    assert.ok(Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9, `正面の板の行列に回転か傾きが入る: ${m}`);
    const map = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const p0 = map(it.x, it.y), p1 = map(it.x + it.w, it.y + it.h);
    const r = (p1[0] - p0[0]) / (p1[1] - p0[1]), r2 = it2.w / it2.h;
    assert.ok(Math.abs(r / r2 - 1) <= 0.01, `箱の縦横比 ${r} が普通の部品 ${r2} と違う`);
    // 部品の座標（区画の左上が原点）で、普通の部品の箱と同じ矩形（±1px）
    const pl2 = M2.scenes[0].place.g1, q0 = [pl2.ox - A.x + it2.x * pl2.s, pl2.oy - A.y + it2.y * pl2.s], q1 = [q0[0] + it2.w * pl2.s, q0[1] + it2.h * pl2.s];
    for (const [a, b, what] of [[p0[0], q0[0], "左"], [p0[1], q0[1], "上"], [p1[0], q1[0], "右"], [p1[1], q1[1], "下"]])
      assert.ok(Math.abs(a - b) <= 1, `箱の${what}の端 ${a.toFixed(1)} が普通の部品 ${b.toFixed(1)} と違う`);
    // 検査: 板の文字の小ささの警告は出ない
    const rc = await checkSpace(plateDeck([{ id: "layer1", kind: "plate", figure: "g1", origin: [0, 0, 0], size: [W, H] }],
      [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }, { id: "l2", text: "そのままです。" }], { camera: { yaw: 0, pitch: 0, scale: 100, target: [W / 2, 0, -H / 2] }, values: {} }));
    assert.ok(!rc.warnings.some(w => /小さすぎて読めない/.test(w)), JSON.stringify(rc.warnings));
    const svg = renderSvg(M, lastEnd(M));
    assert.ok(/<g\b[^>]*data-plate="layer1"[^>]*transform="matrix\(/.test(svg) || /<g\b[^>]*transform="matrix\([^"]*\)"[^>]*data-plate="layer1"/.test(svg), "板の図が matrix で描かれていない");
    assert.ok(svg.includes("API"), "板の中の箱の文字が描かれていない");
  },
  async plate_rise() {   // 縦に並べた板を倒しながら見下ろす: 終わりは投影の奥行きの順に描く。板の中の箱に focus が効く
    const items = [PL("layer1", "g1", 3, { tilt: "th" }), PL("layer2", "f2", 2, { tilt: "th" }), PL("layer3", "f3", 1, { tilt: "th" })];
    const M = await build(plateDeck(items, [
      { id: "l1", text: "{a}出して{b}倒します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 90, at: "b", dur: 1.5 }, { set: "pt", to: 50, at: "b", dur: 1.5 }] },
      { id: "l2", text: "ここで{a}一番上の層を見ます。", do: [{ focus: "layer1/api", at: "a" }] }]));
    assert.deepStrictEqual(M.errors || [], []);
    const setStart = M.acts.find(a => a.verb === "set").start;
    assert.deepStrictEqual(plateOrder(renderSvg(M, setStart - 0.01)), ["layer1", "layer2", "layer3"], "初め（正面）は宣言の順");
    const tEnd = lastEnd(M), v = UZ.valuesAt(M, tEnd);
    assert.strictEqual(v.th, 90); assert.strictEqual(v.pt, 50);
    // 期待する順 = 投影の奥行きの順（奥から）
    const P = M.figs.sp, pl = M.scenes[0].place.sp, cam = UZ.spaceView(P.spec, v, pl.w, pl.h, P.v0);
    const want = UZ.spacePrims(P.spec, v, cam, M.S).filter(p => p.kind === "plate").map(p => p.id);
    assert.deepStrictEqual(want, ["layer3", "layer2", "layer1"], "投影の奥行きの順が下の層から（見下ろすので上の層が手前）でない");
    assert.deepStrictEqual(plateOrder(renderSvg(M, tEnd)), want, "終わりの描画順が奥行きの順でない");
    const fr = UZ.frame(M, tEnd);
    assert.ok(fr.st["layer1/api"].dim > 0.99, "focus の対象が薄い");
    assert.ok(fr.st["layer1/app"].dim < 0.3, "同じ板の他の箱が薄くならない");
    assert.ok(fr.st["layer2/i2"].dim < 0.3, "他の板の中身が薄くならない");
    assert.deepStrictEqual(fr.figs.layer1.parent, { fig: "sp", kind: "plate", item: "layer1" });
  },
  async plate_angle_warn() {   // 落ち着いた時刻（行の終わり）で板が 70° より傾いていたら警告。set の途中では警告しない
    const items = [PL("layer1", "g1", 1, { tilt: "th" })];
    const r = await checkSpace(plateDeck(items, [{ id: "l1", text: "{a}出して{b}倒します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 75, at: "b", dur: 1 }] },
      { id: "l2", text: "そのままです。" }]));
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.warnings.some(w => /板「layer1」が傾きすぎて読めない（75°）/.test(w)), JSON.stringify(r.warnings));
    // 倒しながら見下ろす: 途中では板が視線に対して 75° を超えるが、終わりは 10°
    const sb2 = plateDeck(items, [{ id: "l1", text: "{a}出して{b}倒します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 90, at: "b", dur: 1 }, { set: "pt", to: 80, at: "b", dur: 5 }] },
      { id: "l2", text: "上から見下ろすと、層が高さの順に重なって見えます。" }, { id: "l3", text: "一番上の層が、利用者に一番近い所です。" }]);
    const M2 = await build(sb2), sets = M2.acts.filter(a => a.verb === "set");
    assert.ok(lastEnd(M2) > Math.max(...sets.map(a => a.end)) + 0.1, "set が終わった後の行の終わりがない（検査が空回りする）");
    const P = M2.figs.sp, pl = M2.scenes[0].place.sp, mid = sets[0].end, vm = UZ.valuesAt(M2, mid);
    assert.ok(UZ.plateAngle(P.spec.items[0], vm, UZ.spaceView(P.spec, vm, pl.w, pl.h, P.v0)) > 75, "途中で 75° を超えていない");
    const r2 = await checkSpace(sb2);
    assert.deepStrictEqual(r2.errors, []);
    assert.ok(!r2.warnings.some(w => /傾きすぎ/.test(w)), JSON.stringify(r2.warnings));
  },
  async plate_id_resolve() {   // 「板の id/要素の id」と、一意なら要素の id だけで、板の中の箱を指せる
    const items = [PL("layer1", "g1", 2), PL("layer2", "f2", 1)];
    for (const ref of ["layer1/api", "api"]) {
      const M = await build(plateDeck(items, [{ id: "l1", text: "{a}出します。", do: [{ show: ref, at: "a" }] }]));
      assert.deepStrictEqual(M.errors || [], [], ref);
      const st = UZ.frame(M, lastEnd(M)).st;
      assert.ok(st["layer1/api"] && st["layer1/api"].show > 0.99, `${ref} で板の中の箱が出ない`);
      assert.ok(!st["layer1/app"] || st["layer1/app"].show < 0.01, `${ref} で他の箱まで出た`);
      assert.ok(renderSvg(M, lastEnd(M)).includes("API"), `${ref}: 板の中の箱が描かれていない`);
    }
    // 2 枚の板に同じ図を置くと、要素の id だけでは決まらない
    const M3 = await build(plateDeck([PL("layer1", "g1", 2), PL("layer2", "g1", 1)], [{ id: "l1", text: "{a}出します。", do: [{ show: "api", at: "a" }] }]));
    hasErr(M3, /「api」が複数の図にある/);
    // 部品全体を出すと、板の中身も出る
    const M4 = await build(plateDeck(items, [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }]));
    const st4 = UZ.frame(M4, Math.max(...M4.acts.map(x => x.end)) + 0.01).st;
    assert.ok(st4["layer1/api"].show > 0.99 && st4["layer2/i2"].show > 0.99, "部品全体の show で板の中身が出ない");
  },
  async plate_intersect_zoom_complete() {   // 板どうし・板と面の交差、板の中の箱への zoom、完成形のコマ
    const X = { id: "wall", kind: "polygon", points: [[0, -1, 2], [0, 1, 2], [0, 1, 0], [0, -1, 0]] };
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [PL("layer1", "g1", 1.5), X] }, {}), [["layer1", "wall"]], "板と面の交差");
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [PL("layer1", "g1", 1, { tilt: 90 }), PL("layer2", "f2", 1.4, { origin: [-2, -0.4, 1.4] })] }, {}), [["layer1", "layer2"]], "板どうしの交差");
    assert.deepStrictEqual(UZ.spaceIntersections({ items: [PL("layer1", "g1", 3), PL("layer2", "f2", 2)] }, {}), [], "離れた板は交差しない");
    const items = [PL("layer1", "g1", 3, { tilt: "th" }), PL("layer2", "f2", 2, { tilt: "th" })];
    const M = await build(plateDeck(items, [
      { id: "l1", text: "{a}出して{b}倒します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 60, at: "b", dur: 1 }, { set: "pt", to: 40, at: "b", dur: 1 }] },
      { id: "l2", text: "ここで{a}この箱に寄ります。", do: [{ zoom: "layer1/api", at: "a" }] }]));
    assert.deepStrictEqual(M.errors || [], []);
    const z = M.acts.find(a => a.verb === "zoom"), K = M.figs.layer1, P = M.figs.sp, pl = M.scenes[0].place.sp, v = UZ.valuesAt(M, z.start);
    const m = UZ.childMatrix(K, P.spec.items[0], v, UZ.spaceView(P.spec, v, pl.w, pl.h, P.v0));
    const b = K.items.api, cx = m[0] * (b.x + b.w / 2) + m[2] * (b.y + b.h / 2) + m[4] + pl.ox, cy = m[1] * (b.x + b.w / 2) + m[3] * (b.y + b.h / 2) + m[5] + pl.oy;
    assert.ok(Math.abs(z.target.x + z.target.w / 2 - cx) < 1 && Math.abs(z.target.y + z.target.h / 2 - cy) < 1, `寄せ先の中心 ${z.target.x + z.target.w / 2},${z.target.y + z.target.h / 2} 期待 ${cx},${cy}`);
    assert.ok(z.target.w < pl.w / 3, "寄せ先が区画全体になっている");
    // 完成形のコマ: 板の中の図も出て、終わりの値で倒れている
    const fr = UZ.finalFrame(M, "a");
    assert.strictEqual(fr.values.th, 60);
    assert.ok(fr.figs.layer1.opacity === 1 && fr.figs.layer1.parent && fr.st["layer1/api"].show === 1, "完成形に板の中の図が出ない");
    assert.deepStrictEqual(plateOrder(renderSvg(M, 0, fr)).sort(), ["layer1", "layer2"]);
    // 検査が通る（はみ出し・交差・傾きの警告なし）
    const r = await checkSpace(plateDeck(items, [{ id: "l1", text: "{a}出して{b}倒します。", do: [{ show: "sp", at: "a" }, { set: "th", to: 60, at: "b", dur: 1 }, { set: "pt", to: 40, at: "b", dur: 1 }] }, { id: "l2", text: "そのままです。" }]));
    assert.deepStrictEqual(r.errors, []);
    assert.ok(!r.warnings.some(w => /部品「sp」/.test(w)), JSON.stringify(r.warnings));
  },
  async plate_small_text_warn() {   // 写した文字が MIN_FONT 未満なら警告（落ち着いた時刻）。板の中の図も配置の検査を通る
    const r = await checkSpace(plateDeck([{ id: "layer1", kind: "plate", figure: "g1", origin: [0, 0, 0], size: [0.6, 0.1] }],
      [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }, { id: "l2", text: "そのままです。" }],
      { camera: { yaw: 0, pitch: 0, scale: 100, target: [0.3, 0, -0.05] }, values: {} }));
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.warnings.some(w => /部品「sp」: 板「layer1」の文字が小さすぎて読めない（\d+\.\dpx）/.test(w)), JSON.stringify(r.warnings));
    // 板の中の図の文字の重なりも、自然な大きさで調べる
    const C = { type: "canvas", shapes: [{ id: "t1", shape: "text", x: 200, y: 50, text: "重なる文字です" }, { id: "t2", shape: "text", x: 205, y: 55, text: "重なる文字です" }] };
    const M = await build(plateDeck([PL("layer1", "c1", 1)], [{ id: "l1", text: "{a}出します。", do: [{ show: "sp", at: "a" }] }], { figures: { c1: C } }));
    assert.deepStrictEqual(M.errors || [], []);
    assert.ok(UZ.checkLayout(M).some(x => /layer1\/t1 と layer1\/t2 の文字が重なる/.test(x.msg)), JSON.stringify(UZ.checkLayout(M)));
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
  space_kinds() {   // 各種類がプリミティブになり、plate は板全体で 1 つ（中の図は描く側が描く）
    const S = UZ.styleOf(TH), v = { a: 1 };
    const decl = { axes: { x: [-2, 2], y: [-2, 2], z: [0, 3], labels: { x: "x" } }, items: [
      { id: "p", kind: "point", at: [1, "a", 2], label: "P" }, { id: "ln", kind: "line", from: [0, 0, 0], to: [1, 1, 1] },
      { id: "ar", kind: "arrow", from: [0, 0, 0], to: [1, 2, 2] }, { id: "bx", kind: "box", min: [0, 0, 0], max: [1, 1, 1] },
      { id: "cv", kind: "curve", fn: ["cos(t)", "sin(t)", "t"], t: [0, 3], n: 8 }, { id: "tx", kind: "text", at: [0, 0, 3], text: "最大" },
      { id: "pl", kind: "plate", figure: "x", origin: [0, 0, 0], size: [1, 1] }] };
    const cam = UZ.spaceCamera({ yaw: 30, pitch: 25 }, 300, 200, UZ.spaceBounds(decl, v));
    const P = UZ.spacePrims(decl, v, cam, S), cnt = k => P.filter(p => p.id === k).length;
    assert.strictEqual(cnt("bx"), 6); assert.strictEqual(cnt("cv"), 8); assert.strictEqual(cnt("p"), 2); assert.strictEqual(cnt("pl"), 1); assert.strictEqual(P.find(p => p.id === "pl").pts.length, 4);
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
  async inside_validate() {   // inside は graph のノードだけ・図がある・3 段まで・循環なし・/6 から
    const errs = async sb => (await build(sb)).errors || [];
    const has = (es, re) => assert.ok(es.some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(es)}`);
    has(await errs(deck6({ a: { title: "A", parts: [{ figure: "l" }] } }, [SC("s1", "a")], { l: { type: "list", items: [{ id: "i1", text: "項目", inside: "srv" }] }, srv: SRV() })), /inside は graph のノードにだけ書ける/);
    has(await errs(insideDeck(undefined, { g: { ...IG(), nodes: [{ id: "client", label: "利用者" }, { id: "server", label: "サーバー", inside: "nope" }] } })), /inside「nope」が図にない/);
    // 4 段: g → a1 → a2 → a3 → a4
    const chain = n => ({ type: "graph", nodes: [{ id: "x", label: "箱", ...(n ? { inside: n } : {}) }], edges: [] });
    has(await errs(insideDeck(undefined, { g: { ...IG(), nodes: [{ id: "server", label: "サーバー", inside: "a1" }] }, a1: chain("a2"), a2: chain("a3"), a3: chain("a4"), a4: chain(null) })), /3 段を超える/);
    const ok3 = await errs(insideDeck(undefined, { g: { ...IG(), nodes: [{ id: "server", label: "サーバー", inside: "a1" }] }, a1: chain("a2"), a2: chain("a3"), a3: chain(null) }));
    assert.ok(!ok3.some(e => /段を超える/.test(e)), `3 段は誤りにしない: ${JSON.stringify(ok3)}`);
    has(await errs(insideDeck(undefined, { g: { ...IG(), nodes: [{ id: "server", label: "サーバー", inside: "a1" }] }, a1: chain("a2"), a2: chain("a1") })), /inside が循環している/);
    const sb5 = insideDeck(); sb5.format = "ugoku-zukai/5";
    has(await errs(sb5), /inside を使っている。使うには format を "ugoku-zukai\/6" と書く/);
    // 中身の図を部品としても置く・板の図のノードに inside は誤り
    has(await errs(deck6({ a: { title: "A", parts: [{ figure: "g", area: { col: [1, 6], row: [1, 6] } }, { figure: "srv", area: { col: [7, 12], row: [1, 6] } }] } }, [SC("s1", "a")], { g: IG(), srv: SRV() })), /中身の図「srv」は、部品や場面の図としては置けない/);
    has(await errs(plateDeck([PL("layer1", "g", 1)], [{ id: "l1", text: "出します。" }], { figures: { g: IG(), srv: SRV() } })), /板に置いた図のノードには inside が効かない/);
  },
  async inside_crossfade() {   // 寄る前は箱の名前、寄った後は中身。途中は両方が薄い
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" }), LN("l3", "そのまま見ます。")]));
    assert.deepStrictEqual(M.errors, []);
    const z = zoomAct(M, "l2");
    const at = t => { const fr = UZ.frame(M, t); return { kid: fr.figs.srv.opacity, label: 1 - ((fr.st["g/server"] || {}).inside || 0) }; };
    const b = at(lineEnd(M, "l1"));
    assert.strictEqual(b.kid, 0, "寄る前は中身の不透明度 0"); assert.strictEqual(b.label, 1, "寄る前は箱の名前 1");
    const e = at(z.end + 0.05);
    assert.ok(e.kid > 0.999, `寄った後は中身 1: ${e.kid}`); assert.ok(e.label < 0.001, `寄った後は箱の名前 0: ${e.label}`);
    let mid = false;
    for (let t = z.start; t <= z.end; t += 0.02) { const m = at(t); if (m.kid > 0.01 && m.kid < 0.99 && m.label > 0.01 && m.label < 0.99) mid = true; }
    assert.ok(mid, "途中で両方が 0〜1 の間になる時刻がない");
    assert.deepStrictEqual(UZ.frame(M, z.end + 0.05).figs.srv.parent, { fig: "g", kind: "inside", item: "server" });
    // show g は中身の要素も出すが、中身の数だけ間隔を延ばさない（箱と同じ順番で出る）
    const sh = M.acts.find(a => a.verb === "show");
    assert.ok(sh.keys.includes("srv/cache"), "show g で中身の要素も出る");
    const plain = await build(deck6({ a: { title: "A", parts: [{ figure: "g" }] } }, [SC("s1", "a", [LN("l1", "{a}出します。", { show: "g" })])], { g: { ...IG(), nodes: IG().nodes.map(n => ({ id: n.id, label: n.label })) } }));
    assert.ok(Math.abs(sh.dur - plain.acts.find(a => a.verb === "show").dur) < 1e-9, `show の長さが中身の分だけ延びる: ${sh.dur}`);
    // シークで同じ絵（時刻だけで決まる）
    assert.strictEqual(UZ.frame(M, z.start + 0.4).figs.srv.opacity, UZ.frame(M, z.start + 0.4).figs.srv.opacity);
    // SVG: 寄った後に中身の文字が描かれ、寄る前は中身の g が出ていない
    const svgA = renderSvg(M, z.end + 0.05);
    assert.ok(svgA.includes("キャッシュ"), "寄った後の SVG に中身の文字がない");
  },
  async inside_readable() {   // 寄った後の中身は、ほぼ自然な大きさ（文字が普通の大きさ）
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" })]));
    assert.deepStrictEqual(M.errors, []);
    const z = zoomAct(M, "l2"), fr = UZ.frame(M, z.end + 0.05);
    assert.ok(fr.figs.srv.place.s >= 0.9, `中身の画面上の倍率が 0.9 未満: ${fr.figs.srv.place.s}`);
    assert.ok(z.to.s > UZ.CAMERA.maxZoom, `inside の箱への倍率が maxZoom を超えない: ${z.to.s}`);
    assert.ok(z.to.s <= UZ.CAMERA.insideMaxZoom + 1e-9, `1 段の上限を超える: ${z.to.s}`);
    // 中身の図は寄った後に本文に収まる
    const K = M.figs.srv, p = fr.figs.srv.place, B = fr.scene.body;
    const r = { x: p.ox + K.x0 * p.s, y: p.oy + K.y0 * p.s, w: (K.x1 - K.x0) * p.s, h: (K.y1 - K.y0) * p.s };
    assert.ok(r.x >= B.x - 1 && r.y >= B.y - 1 && r.x + r.w <= B.x + B.w + 1 && r.y + r.h <= B.y + B.h + 1, `中身が本文からはみ出す: ${JSON.stringify(r)} / ${JSON.stringify(B)}`);
    assert.ok(!(M.warnings || []).some(w => /倍率を .* に下げた|小さい/.test(w)), JSON.stringify(M.warnings));
  },
  async inside_nested() {   // 2 段: srv の箱 db にも inside。db に寄ると 2.0 を超え、server に寄ると 1 段目に戻る
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" }),
      LN("l3", "さらに DB の{a}中へ。", { zoom: "srv/db" }), LN("l4", "一段{a}戻ります。", { zoom: "server" })], { srv: SRV({ db: { inside: "dbf" } }), dbf: DBF }));
    assert.deepStrictEqual(M.errors, []);
    const z2 = zoomAct(M, "l2"), z3 = zoomAct(M, "l3"), z4 = zoomAct(M, "l4");
    assert.ok(z3.to.s > 2.0 && z3.to.s > z2.to.s, `db への倍率: ${z3.to.s}（server は ${z2.to.s}）`);
    assert.ok(z3.to.s <= UZ.CAMERA.insideMaxZoom ** 2 + 1e-9, `2 段の上限を超える: ${z3.to.s}`);
    assert.ok(Math.abs(z4.to.s - z2.to.s) < 0.01, `server に寄ると 1 段目に戻る: ${z4.to.s} と ${z2.to.s}`);
    const f3 = UZ.frame(M, z3.end + 0.05), f4 = UZ.frame(M, z4.end + 0.05);
    assert.ok(f3.figs.dbf.opacity > 0.999 && f3.figs.srv.opacity > 0.999, `db に寄った後: dbf ${f3.figs.dbf.opacity} srv ${f3.figs.srv.opacity}`);
    assert.ok(f3.figs.dbf.place.s >= 0.9, `dbf の画面上の倍率: ${f3.figs.dbf.place.s}`);
    assert.ok(f4.figs.dbf.opacity < 0.001 && f4.figs.srv.opacity > 0.999, `server に戻った後: dbf ${f4.figs.dbf.opacity} srv ${f4.figs.srv.opacity}`);
    assert.ok(1 - (f3.st["srv/db"].inside || 0) < 0.001, "db に寄った後は db の名前が消える");
  },
  async inside_inner_actions() {   // 寄った後で、中身の図の要素に focus が効く
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" }), LN("l3", "キャッシュを{a}見ます。", { focus: "srv/cache" })]));
    assert.deepStrictEqual(M.errors, []);
    const fr = UZ.frame(M, lineEnd(M, "l3") + 0.5);
    assert.ok(fr.st["srv/cache"].show > 0.999, "中身は show g で出ている");
    assert.ok(fr.st["srv/cache"].dim > 0.999 && fr.st["srv/web"].dim < 0.3, `focus: cache ${fr.st["srv/cache"].dim} web ${fr.st["srv/web"].dim}`);
    assert.ok(!fr.st["g/server"].dim || fr.st["g/server"].dim > 0.999, `中身の中の focus は外の箱を薄くしない: ${fr.st["g/server"].dim}`);
    const lay = UZ.checkLayout(M);
    assert.ok(!lay.some(x => /srv\//.test(x.msg)), `中身の図の配置の検査: ${JSON.stringify(lay)}`);
  },
  async inside_small_warn() {   // 中身の図が大きすぎて、寄り切っても自然な大きさにならない → 警告
    const N = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, label: `段階その${i + 1}` }));
    const big = { type: "graph", direction: "right", nodes: N, edges: N.slice(1).map((n, i) => ({ from: N[i].id, to: n.id })) };
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" })], { srv: big }));
    assert.deepStrictEqual(M.errors, []);
    hasWarn(M, /寄った後も中身の図「srv」が小さい/);
    assert.ok(UZ.checkLayout(M).some(x => x.kind === "小さい" && /^srv\//.test(x.msg)), "中身の図の自然な大きさでの検査（小さい文字）がない");
  },
  async inside_morph_series() {   // Morph でつながる系列の箱にも効く
    // v1 と v2 の同じ箱 api の両方に inside（書き手は宣言を写して次の図を書く）
    const withIn = G => ({ ...G, nodes: G.nodes.map(n => (n.id === "api" ? { ...n, inside: "srv" } : n)) });
    const g2 = withIn(G2);
    const sb = seriesDeck({ g1: withIn(G1), g2, srv: SRV() }, [["g1"], ["g2", "g1"]]);
    sb.format = "ugoku-zukai/6";
    sb.scenes[1].lines.push(LN("l3", "API の{a}中に入ります。", { zoom: "api" }));
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const z = zoomAct(M, "l3"), fr = UZ.frame(M, z.end + 0.05);
    assert.ok(z.to.s > UZ.CAMERA.maxZoom, `倍率: ${z.to.s}`);
    assert.ok(fr.figs.srv.opacity > 0.999 && fr.figs.srv.place.s >= 0.9, `系列の箱の中身: ${fr.figs.srv.opacity} ${fr.figs.srv.place.s}`);
    assert.strictEqual(UZ.frame(M, lineEnd(M, "l1")).figs.srv.opacity, 0, "前のスライドでは中身は出ない");
    assert.strictEqual(fr.figs.srv.parent.fig, "g2", "v2 のスライドでは親は g2");
    // 中身は v2 の箱 api の内側にある
    const P = fr.figs.g2.place, b = M.figs.g2.items.api, K = M.figs.srv, p = fr.figs.srv.place;
    const bx = P.ox + b.x * P.s, kx = p.ox + K.x0 * p.s;
    assert.ok(kx > bx && kx + (K.x1 - K.x0) * p.s < bx + b.w * P.s, "中身が v2 の箱の内側にない");
    // 寄る前の 1 枚目でも、箱の名前は薄くならない（中身は出ない）
    assert.ok(!(UZ.frame(M, lineEnd(M, "l1")).st["g1/api"] || {}).inside, "1 枚目で箱の名前が薄い");
    // 系列でない図・違う箱で同じ中身を使うのは誤り
    const sb2 = seriesDeck({ g1: withIn(G1), g2: { ...G2, nodes: G2.nodes.map(n => (n.id === "db" ? { ...n, inside: "srv" } : n)) }, srv: SRV() }, [["g1"], ["g2", "g1"]]);
    sb2.format = "ugoku-zukai/6";
    hasErr(await build(sb2), /中身の図「srv」を、別の箱（g1\/api）の inside にも使っている/);
    const sb3 = deck6({ a: { title: "A", parts: [{ figure: "g" }] }, b: { title: "B", parts: [{ figure: "h" }] } }, [SC("s1", "a"), SC("s2", "b")], { g: IG(), h: IG(), srv: SRV() });
    hasErr(await build(sb3), /中身の図「srv」を、別の箱（g\/server）の inside にも使っている/);
  },
  async inside_deep_fit_camera() {   // 中身の図の中の要素に寄るときも fitCamera が働く（隣の箱が端で切れれば、中身が読める倍率まで下げる）
    const N = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, label: `とても長い名前の段階その${i}とても長い名前の段階` }));
    const wide = { type: "graph", direction: "right", nodes: N, edges: N.slice(1).map((n, i) => ({ from: N[i].id, to: n.id })) };
    const lines = [LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" }), LN("l3", "真ん中に{a}寄ります。", { zoom: "srv/n1" })];
    const M = await build(insideDeck(lines, { srv: wide }));
    assert.deepStrictEqual(M.errors, []);
    hasWarn(M, /行 l3（zoom）: 寄せ先の隣の部品が body の端で切れるため、倍率を [\d.]+ に下げた/);
    const z = zoomAct(M, "l3"), fr = UZ.frame(M, z.end + 0.05), K = M.figs.srv, p = fr.figs.srv.place, B = fr.scene.body;
    assert.ok(p.s >= 0.9 - 1e-6, `中身が読める倍率より下げた: ${p.s}`);
    // 下げた後、寄せ先の隣の箱は端で切れない
    for (const id of ["n0", "n2"]) {
      const b = K.items[id], x0 = p.ox + b.x * p.s, x1 = x0 + b.w * p.s;
      assert.ok(x1 <= B.x + 1 || x0 >= B.x + B.w - 1 || (x0 >= B.x - 1 && x1 <= B.x + B.w + 1), `${id} が端で切れる: ${x0}〜${x1}`);
    }
    // 隣が収まる普通の中身では警告しない
    const M2 = await build(insideDeck([lines[0], lines[1], LN("l3", "キャッシュに{a}寄ります。", { zoom: "srv/cache" })]));
    assert.ok(!(M2.warnings || []).some(w => /行 l3/.test(w)), JSON.stringify(M2.warnings));
  },
  async inside_big_box_unzoomed() {   // 本文の 6 割を超える大きな箱でも、寄せていなければ中身は出ない（完成形も）
    const long = "とても長い名前のついたサーバーの箱、中に部品がいくつも入っている";
    const g = { type: "graph", nodes: [{ id: "server", label: long, inside: "srv" }], edges: [] };
    const M = await build(deck6({ a: { title: "A", parts: [{ figure: "g" }] } }, [SC("s1", "a", [LN("l1", "{a}出します。", { show: "g" })])], { g, srv: SRV() }));
    assert.deepStrictEqual(M.errors, []);
    const fr = UZ.frame(M, lineEnd(M, "l1"));
    const a = UZ.insidePlace(M.figs.srv, M.figs.g.items.server, fr.figs.g.place).a;
    assert.ok(a > 0.55, `前提: 倍率 1 で区画の倍率が 0.55 を超える大きな箱（${a}）`);
    assert.strictEqual(fr.figs.srv.opacity, 0, "寄せていないのに中身が出る");
    assert.strictEqual(UZ.finalFrame(M, "a").figs.srv.opacity, 0, "完成形で中身が出る");
  },
  async inside_cull_only_deep() {   // 画面から遠い要素を描かないのは、倍率 2 を超えるときだけ
    const N = ["利用者", "受付", "認証", "サーバー", "倉庫", "外部"].map((label, i) => ({ id: `n${i}`, label, ...(i === 3 ? { inside: "srv" } : {}) }));
    const g = { type: "graph", direction: "right", nodes: N, edges: N.slice(1).map((n, i) => ({ from: N[i].id, to: n.id })) };
    const M = await build(insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "利用者に{a}寄せます。", { zoom: "n0" })], { g }));
    assert.deepStrictEqual(M.errors, []);
    const t = zoomAct(M, "l2").end + 0.05, fr = UZ.frame(M, t), c = fr.camera.clip, P = fr.figs.g.place, b = M.figs.g.items.n5;
    assert.ok(fr.camera.on && fr.camera.s <= 2, `倍率: ${fr.camera.s}`);
    assert.ok(P.ox + b.x * P.s > c.x + c.w + 200, "前提: 最後の箱が clip から 200px より外");
    const svg = renderSvg(M, t);
    assert.ok(svg.includes("外部"), "倍率 2 以下で、画面の外の要素を描かない");
  },
  async inside_complete_unzoomed() {   // 完成形のコマは寄らない姿（中身は出さない）
    const sb = insideDeck([LN("l1", "{a}出します。", { show: "g" }), LN("l2", "サーバーの{a}中に入ります。", { zoom: "server" })]);
    sb.slides.a.start = "complete";
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const fr = UZ.finalFrame(M, "a");
    assert.strictEqual(fr.figs.srv.opacity, 0, "完成形で中身が出ている");
    assert.strictEqual(fr.figs.g.opacity, 1);
    assert.ok(!fr.st["g/server"].inside, "完成形で箱の名前が薄い");
    const svg = renderSvg(M, 0, fr);
    assert.ok(svg.includes("サーバー"), "完成形に箱の名前がない");
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
