#!/usr/bin/env node
// M7（morph・zoom・pan・draw）の検査。node test_m7.cjs で回す。
// 台本の形式 /4 と静的な検証。以後のタスクで、補間・カメラ・draw のテストをここに足す
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const deck4 = (slides, scenes, figures = {}, format = "ugoku-zukai/4") => ({ format, title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes });
const SC = (id, slide, lines) => ({ id, slide, lines: lines || [{ id: "l_" + id, text: "説明します。" }] });
const build = (sb, o) => UZ.build(sb, TH, null, o);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const hasWarn = (M, re) => assert.ok((M.warnings || []).some(w => re.test(w)), `警告に ${re} がない: ${JSON.stringify(M.warnings)}`);
const G1 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "db" }] };
const G2 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "cache", label: "キャッシュ" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "cache" }, { from: "cache", to: "db" }] };
const M7 = format => deck4({ a: { title: "A", parts: [{ figure: "g1" }] }, b: { title: "B", parts: [{ figure: "g2", morph: "g1" }] } },
  [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", draw: true }, { zoom: "api", at: "b" }] }]),
   SC("s2", "b", [{ id: "l2", text: "{a}移ります。", do: [{ pan: "db", at: "a" }] }])], { g1: G1, g2: G2 }, format);

// 系列の検査用: v1 → v2（→ v3）を 1 枚ずつ並べる。figures = { g1, g2, … }、links = [[図, morph 先], …]
const seriesDeck = (figures, links) => deck4(
  Object.fromEntries(links.map(([fid, mv], i) => [`s${i + 1}`, { title: fid, parts: [mv ? { figure: fid, morph: mv } : { figure: fid }] }])),
  links.map(([fid], i) => SC(`c${i + 1}`, `s${i + 1}`, [{ id: `l${i + 1}`, text: "{a}出します。", do: [{ show: fid, at: "a" }] }])), figures);
const boxOf = (F, id) => { const it = F.items[id]; return it && [it.x, it.y, it.w, it.h]; };
// 系列でない graph の座標の指紋（この変更の前の値をテストに埋める）
const crypto = require("crypto");
const graphPrint = M => {
  const out = {};
  for (const [fid, F] of Object.entries(M.figs)) if (F.type === "graph") out[fid] = { w: F.w, h: F.h, x0: F.x0, y0: F.y0, items: Object.values(F.items).map(it => [it.id, it.x, it.y, it.w, it.h, it.pts, it.label && [it.label.x, it.label.y]]) };
  return crypto.createHash("sha1").update(JSON.stringify(out)).digest("hex");
};


const tests = {
  async format4_accepted() {   // /4 で morph・zoom・pan・draw を書いてもエラーにならない
    const M = await build(M7("ugoku-zukai/4"));
    assert.deepStrictEqual(M.errors, []);
  },
  async format3_rejects_m7_features() {   // 同じ台本を /3 にすると、4 種それぞれでエラー
    const M = await build(M7("ugoku-zukai/3"));
    const gate = (M.errors || []).filter(e => /format を "ugoku-zukai\/4" と書く/.test(e));
    assert.strictEqual(gate.length, 4, JSON.stringify(M.errors));
    for (const w of ["morph", "zoom", "pan", "draw"]) assert.ok(gate.some(e => e.includes(w)), `${w} のエラーがない: ${JSON.stringify(gate)}`);
  },
  async morph_static_errors() {
    const LIST = { type: "list", items: [{ id: "a", text: "あ" }] };
    const mk = (parts, extra = {}) => build(deck4({ a: { title: "A", parts: [{ figure: "g1" }] }, b: { title: "B", parts }, ...extra },
      [SC("s1", "a"), SC("s2", "b")], { g1: G1, g2: G2, l1: LIST }));
    hasErr(await mk([{ figure: "g2", morph: "x" }]), /morph「x」が見つからない|morph「x」が台本にない/);
    hasErr(await mk([{ figure: "l1", morph: "g1" }]), /同じ type/);
    hasErr(await mk([{ figure: "g1", morph: "g2" }, { figure: "g2", area: { col: [1, 6], row: [1, 6] } }].map((p, i) => i ? p : { ...p, area: { col: [7, 12], row: [1, 6] } })), /一緒に置けない/);
  },
  async zoom_pan_shape_errors() {
    const mk = act => build(deck4({ a: { title: "A", parts: [{ figure: "g1" }] } }, [SC("s1", "a", [{ id: "l1", text: "説明します。", do: [act] }])], { g1: G1 }));
    hasErr(await mk({ zoom: 3 }), /zoom の対象は文字列/);
    hasErr(await mk({ zoom: "api", pad: -1 }), /pad は 0 以上の数/);
    hasErr(await mk({ show: "api", draw: "yes" }), /draw は true か false/);
  },
  async series_shared_nodes_same_canvas_coords() {
    const M = await build(seriesDeck({ g1: G1, g2: G2 }, [["g1"], ["g2", "g1"]]));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.series, [{ figs: ["g1", "g2"] }]);
    for (const id of ["app", "api", "db"]) assert.deepStrictEqual(boxOf(M.figs.g2, id), boxOf(M.figs.g1, id), `${id} の座標が違う`);
    assert.deepStrictEqual(M.figs.g2.items["app>api"].pts, M.figs.g1.items["app>api"].pts);
    assert.ok(!M.figs.g1.items.cache, "g1 に cache がある");
  },
  async series_framing_fits_own_bbox() {
    // g1 の写し方は g1 自身の外接矩形で決まる（g2 の大きさに引きずられない）
    // g2 は g1 の先に鎖を伸ばし、倍率の上限（1.3）では区画に収まらない大きさにする（g1 の要素はキャンバスの左の部分にある）
    const ids = ["app", "api", "db", "backup", "archive", "report"];
    const LONG = { type: "graph", nodes: ids.map(id => ({ id, label: id })), edges: ids.slice(1).map((id, i) => ({ from: ids[i], to: id })) };
    const M = await build(seriesDeck({ g1: G1, g2: LONG }, [["g1"], ["g2", "g1"]]));
    assert.deepStrictEqual(M.errors, []);
    for (const [i, fid] of [[0, "g1"], [1, "g2"]]) {
      const sc = M.scenes[i], p = sc.place[fid], F = M.figs[fid], A = sc.areas[0];
      const own = Object.values(F.items).filter(it => it.kind === "box" || it.kind === "edge").map(it => it.bbox);
      const x0 = Math.min(...own.map(b => b.x)), x1 = Math.max(...own.map(b => b.x + b.w));
      assert.ok(F.x0 <= x0 && F.x1 >= x1 && F.x1 - F.x0 < x1 - x0 + 30, `${fid} の外枠が自分の要素の外接矩形でない`);
      const sw = (F.x1 - F.x0) * p.s, sh = (F.y1 - F.y0) * p.s;
      assert.ok(Math.abs(sw - A.w) < 1 || Math.abs(sh - A.h) < 1 || Math.abs(p.s - 1.3) < 1e-9, `${fid}: 区画に合わせて写していない（s=${p.s}）`);
      assert.ok(Math.abs(p.s - Math.min(A.w / (F.x1 - F.x0), A.h / (F.y1 - F.y0), 1.3)) < 1e-9, `${fid}: 倍率が自分の外接矩形で決まっていない`);
      assert.ok(p.ox + F.x0 * p.s >= A.x - 0.5 && p.ox + F.x1 * p.s <= A.x + A.w + 0.5, `${fid} が横にはみ出す`);
    }
    assert.ok(M.scenes[0].place.g1.s > M.scenes[1].place.g2.s, `g1 が g2 より大きく写っていない（${M.scenes[0].place.g1.s} と ${M.scenes[1].place.g2.s}）`);
  },
  async series_three_slides_with_removed_node() {
    // v1 にある log が v2 で消え、v3 で queue が足される。v1 の log は、v3 のどのノードとも重ならない（和集合で場所が取ってある）
    const V1 = { type: "graph", nodes: [...G1.nodes, { id: "log", label: "ログ" }], edges: [...G1.edges, { from: "api", to: "log" }] };
    const V3 = { type: "graph", nodes: [...G2.nodes, { id: "queue", label: "キュー" }], edges: [...G2.edges, { from: "api", to: "queue" }] };
    const M = await build(seriesDeck({ v1: V1, v2: G2, v3: V3 }, [["v1"], ["v2", "v1"], ["v3", "v2"]]));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.series, [{ figs: ["v1", "v2", "v3"] }]);
    const [lx, ly, lw, lh] = boxOf(M.figs.v1, "log");
    for (const it of Object.values(M.figs.v3.items).filter(it => it.kind === "box")) {
      const hit = lx < it.x + it.w && it.x < lx + lw && ly < it.y + it.h && it.y < ly + lh;
      assert.ok(!hit, `v1 の log が v3 の ${it.id} に重なる`);
    }
    assert.deepStrictEqual(boxOf(M.figs.v3, "app"), boxOf(M.figs.v1, "app"));
  },
  async series_branch_is_error() {
    const G3 = { type: "graph", nodes: [...G1.nodes, { id: "log", label: "ログ" }], edges: G1.edges };
    const M = await build(seriesDeck({ g1: G1, g2: G2, g3: G3 }, [["g1"], ["g2", "g1"], ["g3", "g1"]]));
    hasErr(M, /morph の系列が分かれている/);
  },
  async non_series_graph_unchanged() {
    // 系列に入らない graph は、この変更の前と同じ座標（examples の見本）
    const fs = require("fs"), path = require("path");
    for (const [name, want] of [["graph-flow.json", "51afd16b04f39b48f53f1839bae1795a683f41c2"], ["graph-state.json", "e909c63a9ebfa6049d40fc96e4e07aa2d452011e"], ["mixed.json", "b025d228599406535197115dd408b891192025f0"]]) {
      const M = await build(JSON.parse(fs.readFileSync(path.join(__dirname, "../../examples", name), "utf8")));
      assert.strictEqual(graphPrint(M), want, `${name} の graph の座標が変わった`);
    }
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
  console.log(fail ? `M7 の検査: NG ${fail} 件` : "M7 の検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
