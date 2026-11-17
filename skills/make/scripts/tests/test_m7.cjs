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
// Morph の検査用: スライド a（v1）→ b（v2、morph: v1）。o.v1・o.v2 = 図（既定は G1・G2 を g1・g2 で）、
// o.show1 = a で出すもの（既定は図ごと）、o.show2 = b で後から出すもの（既定は cache）、o.complete = b を完成形で始める、o.back = 最後に a へ戻る
const morphDeck = (o = {}) => {
  const f1 = o.v1 ? "v1" : "g1", f2 = o.v2 ? "v2" : "g2";
  const b = { title: "B", parts: [{ figure: f2, morph: f1 }] };
  if (o.complete) b.start = "complete";
  const scenes = [SC("s1", "a", [{ id: "l1", text: "{a}出します。", do: [{ show: o.show1 ? `${f1}/${o.show1}` : f1, at: "a" }] }]),
    SC("s2", "b", [{ id: "l2", text: "ここで、新しい部分を{a}足します。", do: [{ show: o.show2 || "cache", at: "a" }] }])];
  if (o.back) scenes.push(SC("s3", "a", [{ id: "l3", text: "元の形に戻ります。" }]));
  return deck4({ a: { title: "A", parts: [{ figure: f1 }] }, b }, scenes, { [f1]: o.v1 || G1, [f2]: o.v2 || G2 });
};
const boxOf =(F, id) => { const it = F.items[id]; return it && [it.x, it.y, it.w, it.h]; };
// 系列でない graph の座標の指紋（この変更の前の値をテストに埋める）
const crypto = require("crypto");
const graphPrint = M => {
  const out = {};
  for (const [fid, F] of Object.entries(M.figs)) if (F.type === "graph") out[fid] = { w: F.w, h: F.h, x0: F.x0, y0: F.y0, items: Object.values(F.items).map(it => [it.id, it.x, it.y, it.w, it.h, it.pts, it.label && [it.label.x, it.label.y]]) };
  return crypto.createHash("sha1").update(JSON.stringify(out)).digest("hex");
};

// カメラの検査用: スライド a（g1 = G1）を 1 場面で使う。lines = 行の列
const camDeck = (lines, figures) => deck4({ a: { title: "A", parts: [{ figure: "g1" }] } }, [SC("s1", "a", lines)], figures || { g1: G1 });
// 図の座標の矩形を、写し方 pl で画面座標にする
const scr = (b, pl) => ({ x: pl.ox + b.x * pl.s, y: pl.oy + b.y * pl.s, w: b.w * pl.s, h: b.h * pl.s });


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
  async series_replaced_edge_excluded() {
    // browser>app は g2 で browser>cdn>app に置き換わる。和集合の組み方に入れないので、g1 の 3 つは 1 列に並び、矢印はまっすぐ
    const W1 = { type: "graph", nodes: [{ id: "browser", label: "ブラウザ" }, { id: "app", label: "アプリ" }, { id: "db", label: "DB" }], edges: [{ from: "browser", to: "app", label: "依頼する" }, { from: "app", to: "db", label: "読み書きする" }] };
    const W2 = { type: "graph", nodes: [{ id: "browser", label: "ブラウザ" }, { id: "cdn", label: "CDN" }, { id: "app", label: "アプリ" }, { id: "db", label: "DB" }],
      edges: [{ from: "browser", to: "cdn", label: "依頼する" }, { from: "cdn", to: "app", label: "転送する" }, { from: "app", to: "db", label: "読み書きする" }] };
    const M = await build(seriesDeck({ g1: W1, g2: W2 }, [["g1"], ["g2", "g1"]]));
    assert.deepStrictEqual(M.errors, []);
    const cy = id => { const it = M.figs.g1.items[id]; return it.y + it.h / 2; };
    assert.ok(Math.abs(cy("browser") - cy("app")) < 0.5 && Math.abs(cy("app") - cy("db")) < 0.5, `1 列に並ばない: ${["browser", "app", "db"].map(cy)}`);
    const pts = M.figs.g1.items["browser>app"].pts;
    assert.ok(pts.every(p => Math.abs(p[1] - pts[0][1]) < 0.5), `browser>app がまっすぐでない: ${JSON.stringify(pts)}`);
    assert.ok(!(M.warnings || []).some(w => /Morph の系列で矢印が箱に重なる/.test(w)), JSON.stringify(M.warnings));
  },
  async series_replaced_edge_warns_when_crossing() {
    // g1 の a>c は g2 で消える（a・b・c は残る）。和集合は a → b → c の 1 列なので、a>c は g1 にある b を横切る
    const N = ["a", "b", "c"].map(id => ({ id, label: id }));
    const H1 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }] };
    const H2 = { type: "graph", nodes: N, edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] };
    const M = await build(seriesDeck({ g1: H1, g2: H2 }, [["g1"], ["g2", "g1"]]));
    hasWarn(M, /Morph の系列で矢印が箱に重なる/);
  },
  async series_replaced_edge_same_route_in_all_figs() {
    // a>c は v1・v2 にあり、v3 で a・c が残ったまま消える（置き換わる辺）。v2 にだけある b が v1 の Z の経路をふさぐ。
    // 経路は系列で 1 回だけ決めるので、v1 と v2 の a>c の pts は一致する
    const N = ids => ids.map(id => ({ id, label: id }));
    const E = str => str.split(" ").map(x => { const [from, to] = x.split(">"); return { from, to }; });
    const v1 = { type: "graph", nodes: N(["a", "c", "z"]), edges: E("a>c c>z") };
    const v2 = { type: "graph", nodes: N(["a", "b", "c", "z", "m"]), edges: E("a>c c>z m>c b>c") };
    const v3 = { type: "graph", nodes: N(["a", "b", "c", "z", "m"]), edges: E("a>b b>c c>z m>c") };
    const M = await build(seriesDeck({ v1, v2, v3 }, [["v1"], ["v2", "v1"], ["v3", "v2"]]));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.figs.v2.items["a>c"].pts, M.figs.v1.items["a>c"].pts);
  },
  async series_branch_is_error() {
    const G3 = { type: "graph", nodes: [...G1.nodes, { id: "log", label: "ログ" }], edges: G1.edges };
    // g1 のスライドに戻ってから g3 へ進む（どちらの morph も直前の場面に g1 がある）
    const sb = seriesDeck({ g1: G1, g2: G2, g3: G3 }, [["g1"], ["g2", "g1"], ["g3", "g1"]]);
    sb.scenes.splice(2, 0, SC("c1b", "s1", [{ id: "l1b", text: "戻ります。" }]));
    const M = await build(sb);
    hasErr(M, /morph の系列が分かれている/);
  },
  async morph_requires_previous_scene() {
    const LIST = { type: "list", items: [{ id: "a", text: "あ" }] };
    // v1 のスライドと v2 のスライドの間に別のスライドがある
    let M = await build(deck4({ a: { title: "A", parts: [{ figure: "g1" }] }, c: { title: "C", parts: [{ figure: "l1" }] }, b: { title: "B", parts: [{ figure: "g2", morph: "g1" }] } },
      [SC("s1", "a"), SC("s2", "c"), SC("s3", "b")], { g1: G1, g2: G2, l1: LIST }));
    hasErr(M, /morph「g1」は直前のシーンのスライドにない/);
    // 逆向き（morph が後のスライドを指す）
    M = await build(deck4({ a: { title: "A", parts: [{ figure: "g1", morph: "g2" }] }, b: { title: "B", parts: [{ figure: "g2" }] } }, [SC("s1", "a"), SC("s2", "b")], { g1: G1, g2: G2 }));
    hasErr(M, /morph「g2」は直前のシーンのスライドにない/);
    // 輪（a ↔ b）
    M = await build(deck4({ a: { title: "A", parts: [{ figure: "g1", morph: "g2" }] }, b: { title: "B", parts: [{ figure: "g2", morph: "g1" }] } }, [SC("s1", "a"), SC("s2", "b")], { g1: G1, g2: G2 }));
    hasErr(M, /morph「g2」は直前のシーンのスライドにない/);
  },
  async morph_pairs_and_interpolates() {
    const M = await build(morphDeck());
    assert.deepStrictEqual(M.errors, []);
    const ms = M.acts.filter(a => a.verb === "morph");
    assert.strictEqual(ms.length, 1);
    const a = ms[0], to = a.pairs.map(p => p.to);
    for (const k of ["g2/app", "g2/api", "g2/db", "g2/app>api"]) assert.ok(to.includes(k), `pairs に ${k} がない: ${to}`);
    assert.ok(!to.includes("g2/cache"), "pairs に g2/cache がある");
    assert.strictEqual(a.dur, 0.8);
    let fr = UZ.frame(M, a.start + 0.4);
    assert.strictEqual(fr.st["g1/api"].show, 0, "v1 の対応する要素を重ねて描いている");
    assert.strictEqual(fr.st["g2/api"].show, 1, "v2 が v1 の表示を引き継いでいない");
    assert.strictEqual(fr.figs.g2.opacity, 1, "v2 の図が fade in している（対応する要素がちらつく）");
    for (const it of Object.values(M.figs.g1.items)) assert.ok(M.figs.g2.items[it.id] || it.id === "api>db", `v1 だけの要素 ${it.id} がある`);
    for (const k of Object.keys(fr.st)) if (k.startsWith("g2/")) assert.ok(!fr.st[k].rect && !fr.st[k].pts, `graph の系列で ${k} を要素ごとに補間している`);
    fr = UZ.frame(M, a.start + 0.8);
    assert.strictEqual(fr.st["g2/api"].show, 1);
    // graph の系列: 写し方を補間する。v1 も同じ写し方で fade out する
    // （G1 → G2 は外接矩形が同じで写し方が変わらないので、DB の先に鎖を伸ばし、倍率の上限では区画に収まらない v2 にする）
    const ext = ["cache", "backup", "archive", "report"];
    const MG = await build(morphDeck({ show2: "v2/cache", v2: { type: "graph", nodes: [...G1.nodes, ...ext.map(id => ({ id, label: id }))], edges: [...G1.edges, ...ext.map((id, i) => ({ from: i ? ext[i - 1] : "db", to: id }))] } }));
    assert.deepStrictEqual(MG.errors, []);
    const ag = MG.acts.find(x => x.verb === "morph");
    const P1 = MG.scenes[0].place.g1, P2 = MG.scenes[1].place.v2;
    fr = UZ.frame(MG, ag.start + 0.4);
    const pl = fr.figs.v2.place;
    for (const k of ["s", "ox", "oy"]) assert.ok(pl[k] >= Math.min(P1[k], P2[k]) - 1e-9 && pl[k] <= Math.max(P1[k], P2[k]) + 1e-9, `${k} が間にない: ${pl[k]}（${P1[k]} と ${P2[k]}）`);
    assert.ok(Math.abs(pl.s - P1.s) > 1e-6 && Math.abs(pl.s - P2.s) > 1e-6, `倍率が途中の値でない（${P1.s} → ${pl.s} → ${P2.s}）`);
    assert.deepStrictEqual(fr.figs.g1.place, pl);
    assert.strictEqual(fr.st["g1/api"].show, 0);
    for (const it of Object.values(MG.figs.g1.items)) assert.ok(MG.figs.v2.items[it.id], `v1 だけの要素 ${it.id} がある（G1 ⊂ v2）`);
    fr = UZ.frame(MG, ag.start + 0.8);
    assert.deepStrictEqual(fr.figs.v2.place, P2);
    assert.strictEqual(fr.st["v2/api"].show, 1);
    // list（項目を 1 つ挿入）: 要素ごとの補間
    const L1 = { type: "list", items: [{ id: "a", text: "認証" }, { id: "b", text: "検索" }, { id: "c", text: "通知" }] };
    const L2 = { type: "list", items: [{ id: "a", text: "認証" }, { id: "x", text: "決済" }, { id: "b", text: "検索" }, { id: "c", text: "通知" }] };
    const ML = await build(morphDeck({ v1: L1, v2: L2, show2: "x" }));
    assert.deepStrictEqual(ML.errors, [], JSON.stringify(ML.errors));
    const al = ML.acts.find(x => x.verb === "morph");
    assert.ok(al.pairs.some(p => p.to === "v2/b" && p.fromBox), "list の pairs に fromBox がない");
    fr = UZ.frame(ML, al.start + 0.4);
    for (const id of ["b", "c"]) { const o = fr.st[`v2/${id}`].off; assert.ok(Math.abs(o[0]) + Math.abs(o[1]) > 0.5, `v2/${id} の off が 0（${o}）`); }
    assert.strictEqual(fr.st["v1/b"].show, 0);
    fr = UZ.frame(ML, al.start + 0.8);
    assert.deepStrictEqual(fr.st["v2/b"].off, [0, 0]);
  },
  async morph_new_items_follow_start() {
    let M = await build(morphDeck());
    let a = M.acts.find(x => x.verb === "morph");
    const showAt = M.acts.find(x => x.verb === "show" && x.keys.includes("g2/cache")).start;
    assert.ok(showAt > a.start + 0.8, "検査の前提: cache を出すのが Morph の後でない");
    assert.strictEqual((UZ.frame(M, a.start + 0.8).st["g2/cache"] || { show: 0 }).show, 0);
    assert.ok(UZ.frame(M, showAt + 1).st["g2/cache"].show > 0.99);
    M = await build(morphDeck({ complete: true }));
    a = M.acts.find(x => x.verb === "morph");
    assert.ok(UZ.frame(M, a.start + 0.8).st["g2/cache"].show > 0, "start: complete なのに cache が出ない");
  },
  async morph_inherits_hidden() {
    const M = await build(morphDeck({ show1: "app" }));
    const a = M.acts.find(x => x.verb === "morph");
    const fr = UZ.frame(M, a.start + 0.4);
    assert.strictEqual(fr.st["g2/app"].show, 1);
    assert.strictEqual((fr.st["g2/api"] || { show: 0 }).show, 0, "v1 で出していない api が v2 で出る");
  },
  async morph_back_to_v1() {
    const M = await build(morphDeck({ back: true }));
    assert.deepStrictEqual(M.errors, []);
    const s3 = M.scenes[2];
    const fr = UZ.frame(M, s3.start + 1.0);
    assert.strictEqual(fr.st["g1/api"].show, 1);
    assert.strictEqual(fr.figs.g1.opacity, 1);
  },
  async morph_auto_ids_not_matched() {
    const C1 = { type: "compare", items: [{ id: "card", label: "カード", points: ["速い", { id: "cheap", text: "安い" }] }, { id: "other", label: "ほか", points: ["遅い"] }] };
    const C2 = { type: "compare", items: [{ id: "card", label: "カード", points: ["速い", { id: "cheap", text: "安い" }, "軽い"] }, { id: "other", label: "ほか", points: ["遅い"] }] };
    const M = await build(morphDeck({ v1: C1, v2: C2, show2: "v2/card.3" }));
    assert.deepStrictEqual(M.errors, []);
    const to = M.acts.find(x => x.verb === "morph").pairs.map(p => p.to);
    assert.ok(to.includes("v2/card") && to.includes("v2/cheap"), JSON.stringify(to));
    assert.ok(!to.some(k => /card\.\d|other\.\d/.test(k)), `自動の id をつないでいる: ${to}`);
    hasWarn(M, /Morph でつなぐなら id を書く/);
  },
  async morph_unsupported_type_crossfades() {
    const V1 = { type: "venn", sets: [{ id: "a", label: "現場" }, { id: "b", label: "データ" }] };
    const V2 = { type: "venn", sets: [{ id: "a", label: "現場" }, { id: "b", label: "データ" }, { id: "c", label: "画面" }] };
    const M = await build(morphDeck({ v1: V1, v2: V2, show2: "c" }));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.acts.find(x => x.verb === "morph").pairs, []);
    hasWarn(M, /Morph で要素をつなげない type/);
  },
  async morph_final_frame_is_v2() {
    const M = await build(morphDeck());
    const fr = UZ.finalFrame(M, "b");
    assert.strictEqual(fr.figs.g1.opacity, 0);
    assert.strictEqual(fr.figs.g2.opacity, 1);
    for (const [k, s] of Object.entries(fr.st)) assert.ok(!s.rect && !s.pts, `${k} に Morph の途中の形がある`);
  },
  // ---- カメラ（zoom・pan）----
  async zoom_scales_body_only() {
    const M = await build(camDeck([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] }]));
    assert.deepStrictEqual(M.errors, []);
    const z = M.acts.find(a => a.verb === "zoom");
    assert.ok(z && z.run === 0 && z.from.s === 1, `zoom の act: ${JSON.stringify(z && { run: z.run, from: z.from })}`);
    const before = UZ.frame(M, z.start - 0.01), fr = UZ.frame(M, z.end + 0.01);
    assert.strictEqual(before.camera.s, 1);
    assert.ok(fr.camera.s > 1, `倍率が 1 のまま（${fr.camera.s}）`);
    const P = M.scenes[0].place.g1, pl = fr.figs.g1.place, c = fr.camera;
    assert.ok(Math.abs(pl.s - P.s * c.s) < 1e-9 && Math.abs(pl.ox - (c.s * P.ox + c.tx)) < 1e-9 && Math.abs(pl.oy - (c.s * P.oy + c.ty)) < 1e-9, "place にカメラが合成されていない");
    assert.deepStrictEqual(fr.header, before.header);
    assert.deepStrictEqual(fr.statement, before.statement);
    const B = M.scenes[0].body, r = scr(M.figs.g1.items.api.bbox, pl);
    assert.deepStrictEqual(fr.camera.clip, B);
    assert.ok(Math.abs(r.x + r.w / 2 - (B.x + B.w / 2)) < 5 && Math.abs(r.y + r.h / 2 - (B.y + B.h / 2)) < 5, `api が body の中心に来ない: ${JSON.stringify(r)}`);
  },
  async zoom_all_and_pan() {
    const M = await build(camDeck([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", pad: 120, at: "b" }] },
      { id: "l2", text: "{a}移ります。", do: [{ pan: "db", at: "a" }] }, { id: "l3", text: "{a}戻ります。", do: [{ zoom: "all", at: "a" }] }]));
    assert.deepStrictEqual(M.errors, []);
    const [z, p, all] = ["zoom", "pan", "zoom"].map((v, i) => M.acts.filter(a => a.verb === "zoom" || a.verb === "pan")[i]);
    assert.strictEqual(p.verb, "pan");
    const f1 = UZ.frame(M, z.end + 0.01), f2 = UZ.frame(M, p.end + 0.01), f3 = UZ.frame(M, all.end + 0.01);
    const B = M.scenes[0].body, cx = (fr, id) => { const r = scr(M.figs.g1.items[id].bbox, fr.figs.g1.place); return Math.abs(r.x + r.w / 2 - (B.x + B.w / 2)); };
    assert.ok(Math.abs(f2.camera.s - f1.camera.s) < 1e-9, `pan で倍率が変わった（${f1.camera.s} → ${f2.camera.s}）`);
    assert.ok(cx(f2, "db") < cx(f1, "db") - 10, `pan で db に寄っていない（${cx(f1, "db")} → ${cx(f2, "db")}）`);
    assert.deepStrictEqual(p.from, z.to);
    assert.deepStrictEqual({ s: f3.camera.s, tx: f3.camera.tx, ty: f3.camera.ty }, { s: 1, tx: 0, ty: 0 });
    assert.deepStrictEqual(f3.figs.g1.place, M.scenes[0].place.g1);
  },
  async camera_resets_on_slide_change_same_fig() {
    const LIST = { type: "list", items: [{ id: "x", text: "あ" }] };
    const sb = deck4({ a: { title: "A", parts: [{ figure: "g1" }] }, b: { title: "B", parts: [{ figure: "g1", area: { col: [1, 6], row: [1, 6] } }, { figure: "l1", area: { col: [7, 12], row: [1, 6] } }] } },
      [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] }]),
       SC("s2", "b", [{ id: "l2", text: "{a}並べます。", do: [{ show: "l1", at: "a" }] }])], { g1: G1, l1: LIST });
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const [s1, s2] = M.scenes;
    assert.ok(s1.run !== s2.run, "スライドが変わったのに run が同じ");
    const end1 = UZ.frame(M, s2.start - 0.001);
    assert.ok(end1.camera.s > 1);
    const fr = UZ.frame(M, s2.start + 0.4), show = M.acts.find(a => a.verb === "show" && a.scene === "s2");
    assert.strictEqual(fr.camera.s, 1);
    assert.strictEqual(UZ.frame(M, show.start + 0.3).camera.s, 1);
    // 前のスライドの最後の写り（カメラ込み）から、新しい区画の place へ補間する
    const A = end1.figs.g1.place, Bp = s2.place.g1, pl = fr.figs.g1.place;
    for (const k of ["s", "ox", "oy"]) assert.ok(pl[k] > Math.min(A[k], Bp[k]) - 1e-9 && pl[k] < Math.max(A[k], Bp[k]) + 1e-9 && Math.abs(pl[k] - Bp[k]) > 1e-6, `${k} が補間の途中でない: ${pl[k]}（${A[k]} → ${Bp[k]}）`);
    assert.deepStrictEqual(UZ.frame(M, s2.start + 0.9).figs.g1.place, Bp);
  },
  async zoom_waits_for_morph() {
    const sb = morphDeck();
    sb.scenes[1].lines[0].do = [{ zoom: "api" }, { show: "cache" }];
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    const mo = M.acts.find(a => a.verb === "morph"), z = M.acts.find(a => a.verb === "zoom");
    assert.ok(z.start >= mo.end - 1e-9, `zoom（${z.start}）が morph の終わり（${mo.end}）より前に始まる`);
  },
  async zoom_then_morph_starts_from_zoomed() {
    // list: a で b に寄ってから、b のスライドへ Morph。fromBox は、寄せた後の画面上の位置から作る
    const L1 = { type: "list", items: [{ id: "a", text: "認証" }, { id: "b", text: "検索" }, { id: "c", text: "通知" }] };
    const L2 = { type: "list", items: [{ id: "a", text: "認証" }, { id: "x", text: "決済" }, { id: "b", text: "検索" }, { id: "c", text: "通知" }] };
    const zoomFirst = (sb, to) => { sb.scenes[0].lines[0] = { id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: sb.scenes[0].lines[0].do[0].show, at: "a" }, { zoom: to, at: "b" }] }; return sb; };
    const ML = await build(zoomFirst(morphDeck({ v1: L1, v2: L2, show2: "x" }), "b"));
    assert.deepStrictEqual(ML.errors, [], JSON.stringify(ML.errors));
    const s2 = ML.scenes[1], end1 = UZ.frame(ML, s2.start - 0.001);
    assert.ok(end1.camera.s > 1, "検査の前提: a の終わりで寄っていない");
    const want = scr(ML.figs.v1.items.b.bbox, end1.figs.v1.place);
    const pr = ML.acts.find(a => a.verb === "morph").pairs.find(p => p.to === "v2/b");
    const got = scr(pr.fromBox, s2.place.v2);
    for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(got[k] - want[k]) <= 1, `fromBox の ${k} が寄せた後の位置と違う（${got[k]} と ${want[k]}）`);
    // graph の系列: v2 の写し方は、a の終わりの（寄せた）写し方から始まる
    const MG = await build(zoomFirst(morphDeck(), "api"));
    assert.deepStrictEqual(MG.errors, [], JSON.stringify(MG.errors));
    const g2s = MG.scenes[1], e1 = UZ.frame(MG, g2s.start - 0.001), f0 = UZ.frame(MG, g2s.start);
    for (const k of ["s", "ox", "oy"]) assert.ok(Math.abs(f0.figs.g2.place[k] - e1.figs.g1.place[k]) < 1e-6, `系列の v2 が寄せた写し方から始まらない（${k}: ${f0.figs.g2.place[k]} と ${e1.figs.g1.place[k]}）`);
  },
  async frame_is_pure_under_seek() {
    const M = await build(camDeck([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] },
      { id: "l2", text: "{a}移って{b}戻ります。", do: [{ pan: "db", at: "a" }, { zoom: "all", at: "b" }] }]));
    assert.deepStrictEqual(M.errors, []);
    const k = M.duration / 12, seen = {};
    for (const x of [10, 2, 7, 2, 10]) {
      const t = x * k, fr = UZ.frame(M, t), sig = JSON.stringify({ c: fr.camera, st: fr.st, f: fr.figs });
      if (seen[t] != null) assert.strictEqual(sig, seen[t], `t=${t} のコマが呼び出し順で変わる`);
      seen[t] = sig;
    }
  },
  async camera_checks() {
    const one = async (lines, figs) => build(camDeck(lines, figs));
    // まだ出していない要素に寄る
    let M = await one([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "app", at: "a" }, { zoom: "db", at: "b" }] }]);
    assert.deepStrictEqual(M.errors, []);
    assert.ok(UZ.checkLayout(M).some(i => i.kind === "カメラ"), JSON.stringify(UZ.checkLayout(M)));
    // 1 行で 3 回
    M = await one([{ id: "l1", text: "{a}出して{b}寄り{c}移り{d}移ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }, { pan: "db", at: "c" }, { pan: "app", at: "d" }] }]);
    hasWarn(M, /カメラが 1 行で 3 回/);
    // pad が大きくて倍率が 1 未満
    M = await one([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", pad: 400, at: "b" }] }]);
    hasWarn(M, /倍率が 1 未満/);
    // 倍率の上限で寄ったまま、図全体へ移る（図全体は body に収まらない）
    M = await one([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] }, { id: "l2", text: "{a}移ります。", do: [{ pan: "g1", at: "a" }] }]);
    hasWarn(M, /zoom 先が body に収まらない/);
    // 寄せて body の外に出た要素は、clip されるので「はみ出し」にしない
    M = await one([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] }]);
    const fr = UZ.frame(M, M.acts.find(a => a.verb === "zoom").end + 0.01);
    const db = scr(M.figs.g1.items.db.bbox, fr.figs.g1.place);
    assert.ok(db.x + db.w > fr.camera.clip.x + fr.camera.clip.w + 20, "検査の前提: db が body の外にはみ出していない");
    const iss = UZ.checkLayout(M);
    assert.ok(!iss.some(i => i.kind === "はみ出し" || i.kind === "カメラ"), JSON.stringify(iss));
    assert.ok(!(M.warnings || []).some(w => /カメラ|倍率|zoom 先/.test(w)), JSON.stringify(M.warnings));
  },
  async final_frame_has_no_camera() {
    const M = await build(camDeck([{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", at: "a" }, { zoom: "api", at: "b" }] }]));
    const fr = UZ.finalFrame(M, "a");
    assert.deepStrictEqual(fr.figs.g1.place, M.scenes[0].place.g1);
    assert.strictEqual(fr.camera.s, 1);
    assert.strictEqual(fr.camera.on, false);
  },
  async check_skips_mid_morph() {
    // 行が Morph の 0.8 秒の途中で終わっても、途中のコマで配置を調べない
    const sb = morphDeck();
    sb.scenes[1].lines[0] = { id: "l2", text: "はい。" };
    const tl = { source: "estimate", lines: [{ id: "l1", scene: "s1", start: 0.8, dur: 2, marks: { a: 0.1 } }, { id: "l2", scene: "s2", start: 3.5, dur: 0.3, marks: {} }] };
    const M = await UZ.build(sb, TH, tl);
    assert.deepStrictEqual(M.errors, []);
    const mo = M.acts.find(a => a.verb === "morph");
    assert.ok(3.8 > mo.start && 3.8 < mo.end, "検査の前提: 行の終わりが Morph の途中でない");
    const orig = UZ.frame, ts = [];
    UZ.frame = (m, t) => { ts.push(t); return orig(m, t); };
    try { UZ.checkLayout(M); } finally { UZ.frame = orig; }
    const mid = ts.filter(t => t >= mo.start && t < mo.end);
    assert.deepStrictEqual(mid, [], `Morph の途中の時刻で調べている: ${mid}`);
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
