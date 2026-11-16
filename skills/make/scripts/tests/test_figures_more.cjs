#!/usr/bin/env node
// 通し 3 の改善点 2・3・14・16 の検査。node test_figures_more.cjs で回す。
// 包含のベン図（inside）、ロードマップの矢印（links）、象限の塗り分け（off・tint）、箱の大きさを変える動作（resize）
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const sb1 = (fig, acts, more = {}) => ({ format: "ugoku-zukai/3", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures: { f: fig },
  scenes: [{ id: "s1", figure: "f", lines: [{ id: "l1", text: more.text || "説明します。", do: acts || [{ show: "f" }] }, ...(more.lines || [])] }] });
const build = sb => UZ.build(sb, TH, null);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const end = M => M.endCard - 0.01;
const circ = it => ({ cx: it.x + it.w / 2, cy: it.y + it.h / 2, r: it.w / 2 });
const within = (inner, outer) => Math.hypot(inner.cx - outer.cx, inner.cy - outer.cy) + inner.r <= outer.r + 0.01;
const apart = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r - 0.01;
const inRect = (b, it) => b.x >= it.x - 0.5 && b.y >= it.y - 0.5 && b.x + b.w <= it.x + it.w + 0.5 && b.y + b.h <= it.y + it.h + 0.5;

const ROAD = links => ({ type: "roadmap", periods: ["p1", "p2", "p3"], tracks: [{ id: "t1", label: "当社" }, { id: "t2", label: "開発" }],
  items: [{ id: "a", track: "t1", from: "p1", to: "p1", label: "現状を知る" }, { id: "b", track: "t1", from: "p2", to: "p2", label: "決める" },
    { id: "c", track: "t2", from: "p3", to: "p3", label: "受託開発" }, { id: "d", track: "t2", from: "p1", to: "p2", label: "準備" }], links });
const MATRIX = q => ({ type: "matrix", x: { label: "要件" }, y: { label: "利用者" }, quadrants: q, items: [{ id: "k1", label: "新規", x: 0.2, y: 0.2 }] });
const CANVAS = { type: "canvas", shapes: [
  { id: "yoken", shape: "rect", x: 390, y: 185, w: 160, h: 100, text: "要件定義", size: 26 },
  { id: "sekkei", shape: "rect", x: 700, y: 185, w: 160, h: 100, text: "設計", size: 26 },
  { id: "maru", shape: "ellipse", x: 60, y: 185, w: 120, h: 100, text: "丸" },
  { id: "ya", shape: "arrow", points: [[550, 235], [700, 235]] }] };

const FLOW = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "examples", "graph-flow.json"), "utf8")).figures.flow;

const tests = {
  // ---- 2: 包含のベン図 ----
  async venn_inside_one() {
    const M = await build(sb1({ type: "venn", sets: [{ id: "ux", label: "UX" }, { id: "us", label: "ユーザビリティ", inside: "ux" }] }));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.f.items, ux = circ(I.ux), us = circ(I.us);
    assert.ok(within(us, ux), "内側の集合が外側の円に収まっていない");
    assert.ok(us.r < ux.r);
    // 外側の集合の名前は、外側の円の中で、内側の円の外にある
    const lb = I.ux.texts[0].bbox, lc = [lb.x + lb.w / 2, lb.y + lb.h / 2];
    assert.ok(Math.hypot(lc[0] - ux.cx, lc[1] - ux.cy) < ux.r, "外側の名前が円の外");
    assert.ok(Math.hypot(lc[0] - us.cx, lc[1] - us.cy) > us.r, "外側の名前が内側の円に重なる");
    assert.deepStrictEqual(UZ.checkLayout(M), []);
  },
  async venn_inside_chain_and_pair() {
    const M = await build(sb1({ type: "venn", sets: [{ id: "a", label: "体験" }, { id: "b", label: "使いやすさ", inside: "a" }, { id: "c", label: "効率", inside: "b" }] }));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.f.items;
    assert.ok(within(circ(I.c), circ(I.b)) && within(circ(I.b), circ(I.a)));
    assert.deepStrictEqual(UZ.checkLayout(M), []);
    const M2 = await build(sb1({ type: "venn", sets: [{ id: "a", label: "体験" }, { id: "b", label: "期待", inside: "a" }, { id: "c", label: "感情", inside: "a" }] }));
    assert.deepStrictEqual(M2.errors, []);
    const J = M2.figs.f.items;
    assert.ok(within(circ(J.b), circ(J.a)) && within(circ(J.c), circ(J.a)) && apart(circ(J.b), circ(J.c)), "内側の 2 つが収まっていないか、互いに重なる");
    assert.deepStrictEqual(UZ.checkLayout(M2), []);
  },
  async venn_inside_with_overlap() {
    // 重なる 2 つの集合の片方だけに含まれる集合は、もう片方の円にかからない
    const M = await build(sb1({ type: "venn", sets: [{ id: "a", label: "現場" }, { id: "b", label: "データ" }, { id: "c", label: "勘", inside: "a" }],
      overlaps: [{ id: "o", of: ["a", "b"], label: "改善" }] }));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.f.items;
    assert.ok(within(circ(I.c), circ(I.a)) && apart(circ(I.c), circ(I.b)));
    assert.deepStrictEqual(UZ.checkLayout(M), []);
  },
  async venn_inside_errors() {
    hasErr(await build(sb1({ type: "venn", sets: [{ id: "a", label: "A" }, { id: "b", label: "B", inside: "x" }] })), /inside/);
    hasErr(await build(sb1({ type: "venn", sets: [{ id: "a", label: "A", inside: "b" }, { id: "b", label: "B", inside: "a" }] })), /inside/);
    hasErr(await build(sb1({ type: "venn", sets: [{ id: "a", label: "A" }, { id: "b", label: "B", inside: "a" }, { id: "c", label: "C", inside: "a" }, { id: "d", label: "D", inside: "a" }] })), /2 つまで/);
    hasErr(await build(sb1({ type: "venn", sets: [{ id: "a", label: "A" }, { id: "b", label: "B", inside: "a" }, { id: "c", label: "C" }], overlaps: [{ id: "o", of: ["b", "c"], label: "x" }] })), /重なり/);
    // 含まれる集合がなければ、今までどおり 2〜3 個
    hasErr(await build(sb1({ type: "venn", sets: [{ id: "a", label: "A" }] })), /集合/);
  },

  // ---- 3: ロードマップの矢印 ----
  async roadmap_links() {
    const M = await build(sb1(ROAD([{ from: "a", to: "b", label: "受け渡す" }, { from: "b", to: "c" }])));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.f.items, e1 = I["a>b"], e2 = I["b>c"];
    assert.ok(e1 && e1.kind === "edge" && e1.head, "a>b の矢印がない");
    assert.ok(e2 && e2.head);
    // 同じ段で隣り合う帯の間は、まっすぐ右向き。帯の間に矢じりが入る隙間（30 以上）がある
    assert.strictEqual(e1.pts.length, 2);
    assert.strictEqual(e1.pts[0][1], e1.pts[1][1]);
    assert.ok(e1.pts[1][0] - e1.pts[0][0] >= 30, `矢印が短い: ${e1.pts[1][0] - e1.pts[0][0]}`);
    assert.ok(e1.pts[0][0] >= I.a.x + I.a.w - 0.5 && e1.pts[1][0] <= I.b.x + 0.5, "矢印が帯に重なる");
    assert.strictEqual(e1.label.lines.join(""), "受け渡す");
    // 別の流れへは、最後が右向きで相手の左端に着く
    const n = e2.pts.length;
    assert.ok(Math.abs(e2.pts[n - 1][0] - I.c.x) < 0.5 && e2.pts[n - 1][1] === e2.pts[n - 2][1] && e2.pts[n - 1][0] > e2.pts[n - 2][0]);
    assert.deepStrictEqual(UZ.checkLayout(M), []);
    // 図全体を出すと、矢印も出る。矢印だけを後から出すこともできる
    assert.strictEqual(UZ.frame(M, end(M)).st["f/a>b"].show, 1);
    const M2 = await build(sb1(ROAD([{ from: "a", to: "b" }]), [{ show: ["a", "b"] }, { show: "a>b" }]));
    assert.deepStrictEqual(M2.errors, []);
  },
  async roadmap_links_vertical_and_errors() {
    // 期間が重なる 2 つ（上下）は、縦の矢印
    const M = await build(sb1(ROAD([{ from: "a", to: "d" }])));
    assert.deepStrictEqual(M.errors, []);
    const e = M.figs.f.items["a>d"];
    assert.strictEqual(e.pts[0][0], e.pts[e.pts.length - 1][0]);
    hasErr(await build(sb1(ROAD([{ from: "a", to: "zz" }]))), /links/);
    hasErr(await build(sb1(ROAD([{ from: "a", to: "a" }]))), /links/);
    hasErr(await build(sb1(ROAD([{ from: "b", to: "a" }]))), /右から左/);
  },

  // ---- 14: 象限の塗り分け ----
  async matrix_quadrant_off() {
    const M = await build(sb1(MATRIX({ tl: { id: "q1", label: "必要", role: "accent" }, tr: { id: "q2", label: "必ずしも必要ない", off: true }, bl: "必要" })));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.f.items, S = M.S;
    assert.strictEqual(I.q2.off, true);
    assert.notStrictEqual(I.q2.fill, I.q1.fill);
    assert.notStrictEqual(I.q2.fill, I.bl.fill, "該当しない象限が、指定のない象限と同じ塗り");
    assert.strictEqual(I.q2.texts[0].color, S.muted);
    hasErr(await build(sb1(MATRIX({ tl: { label: "x", off: true, role: "accent" } }))), /off と role/);
  },
  async matrix_quadrant_tint() {
    // 話の途中で、象限を塗る（tint）。as: "off" は、該当しない象限の塗り
    const M = await build(sb1(MATRIX({ tl: { id: "q1", label: "必要" }, tr: { id: "q2", label: "必要ない" } }), [{ show: "f" }, { tint: "q1", as: "accent" }, { tint: "q2", as: "off" }]));
    assert.deepStrictEqual(M.errors, []);
    const st = UZ.frame(M, end(M)).st;
    assert.ok(st["f/q1"].tint && st["f/q1"].tintP === 1);
    assert.ok(st["f/q2"].tint && st["f/q2"].tintP === 1);
    assert.strictEqual(st["f/q2"].tintOff, true);
    assert.ok(!st["f/q1"].tintOff);
    // as: "off" は象限だけ
    const M2 = await build(sb1(MATRIX({ tl: { id: "q1", label: "必要" } }), [{ show: "f" }, { tint: "k1", as: "off" }]));
    hasErr(M2, /off/);
  },

  // ---- 16: 箱の大きさを変える ----
  async resize_to_and_text() {
    const M = await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", to: { w: 300, h: 210 }, text: "top" }]));
    assert.deepStrictEqual(M.errors, []);
    const a = M.acts.find(x => x.verb === "resize");
    // 既定は中心を動かさない
    assert.deepStrictEqual(a.to, { x: 320, y: 130, w: 300, h: 210 });
    const s0 = UZ.frame(M, a.start - 0.01).st["f/yoken"];
    assert.ok(!s0.rect, "動作の前から大きさが変わっている");
    const s1 = UZ.frame(M, end(M)).st["f/yoken"];
    assert.deepStrictEqual(s1.rect, { x: 320, y: 130, w: 300, h: 210 });
    // text: "top" で、文字は新しい箱の上に寄る（箱の中に収まる）
    const tb = M.figs.f.items.yoken.texts[0].bbox;
    const moved = { x: tb.x + s1.textOff[0], y: tb.y + s1.textOff[1], w: tb.w, h: tb.h };
    assert.ok(inRect(moved, s1.rect) && moved.y < 130 + 30, `文字が上に寄っていない: ${JSON.stringify(moved)}`);
    // 途中のコマは、前と後の間
    const sm = UZ.frame(M, a.start + a.dur / 2).st["f/yoken"];
    assert.ok(sm.rect.w > 160 && sm.rect.w < 300);
  },
  async resize_scale_anchor_chain() {
    const M = await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", scale: 1.5, anchor: "left" }, { resize: "yoken", scale: [1, 2], anchor: "top" }, { resize: "maru", scale: 1.2 }]));
    assert.deepStrictEqual(M.errors, []);
    const rs = M.acts.filter(x => x.verb === "resize");
    assert.deepStrictEqual(rs[0].to, { x: 390, y: 160, w: 240, h: 150 });   // 左端を保つ（縦は中心）
    assert.deepStrictEqual(rs[1].from, rs[0].to);                            // 2 回目は、前の大きさから
    assert.deepStrictEqual(rs[1].to, { x: 390, y: 160, w: 240, h: 300 });
    assert.deepStrictEqual(UZ.frame(M, end(M)).st["f/yoken"].rect, rs[1].to);
    // 既定の文字は箱の中心に付いていく
    const s = UZ.frame(M, end(M)).st["f/yoken"];
    assert.deepStrictEqual(s.textOff, [390 + 120 - 470, 160 + 150 - 235]);
  },
  async resize_errors_and_check() {
    hasErr(await build(sb1(CANVAS, [{ show: "f" }, { resize: "ya", scale: 2 }])), /箱/);
    hasErr(await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken" }])), /to.*scale/);
    hasErr(await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", scale: 2, anchor: "naname" }])), /anchor/);
    hasErr(await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", to: { w: -5 } }])), /正の数/);
    // 大きくした箱が隣の箱に重なると、配置の検査が知らせる
    const M = await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", scale: [2.2, 1], anchor: "left" }]));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(UZ.checkLayout(M).some(i => i.kind === "重なり" && /yoken/.test(i.msg) && /sekkei/.test(i.msg)), JSON.stringify(UZ.checkLayout(M)));
    // 区画からはみ出すのも知らせる
    const M2 = await build(sb1(CANVAS, [{ show: "f" }, { resize: "yoken", scale: [1, 8] }]));
    assert.ok(UZ.checkLayout(M2).some(i => i.kind === "はみ出し" && /yoken/.test(i.msg)));
  },
  async resize_in_final_frame() {
    // スライドの完成形のコマは、大きさを変えた後の形
    const sb = { format: "ugoku-zukai/3", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures: { f: CANVAS },
      slides: { p1: { title: "見出し", parts: [{ figure: "f" }] } },
      scenes: [{ id: "s1", slide: "p1", lines: [{ id: "l1", text: "説明します。", do: [{ show: "f" }, { resize: "yoken", to: { w: 300, h: 210 } }] }] }] };
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(UZ.finalFrame(M, "p1").st["f/yoken"].rect, { x: 320, y: 130, w: 300, h: 210 });
  },

  // ---- trace: 点は辺の上を動く間だけ見え、箱にいる間は箱を強調する ----
  async trace_dot_only_on_edges() {
    const M = await build(sb1(FLOW, [{ show: "f" }, { trace: ["app", "sys", "kacho"] }]));
    assert.deepStrictEqual(M.errors, []);
    const a = M.acts.find(x => x.verb === "trace"), I = M.figs.f.items;
    assert.strictEqual(a.dur, 4.0);   // 区間 1 つに 2 秒（札がなければ、止まる時間はない）
    const at = t => UZ.frame(M, t);
    const dist = (p, pts) => { let d = 1e9; for (let i = 1; i < pts.length; i++) { const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1; const k = Math.max(0, Math.min(1, ((p[0] - x1) * (x2 - x1) + (p[1] - y1) * (y2 - y1)) / L2)); d = Math.min(d, Math.hypot(p[0] - x1 - k * (x2 - x1), p[1] - y1 - k * (y2 - y1))); } return d; };
    // 動いている間: 点が見え、辺の上にいる（角を丸めるぶんだけ離れる）。箱の中には入らない
    const lead = 0.35, slice = (a.dur - lead) / 2;
    for (const [i, id] of [[0, "app>sys"], [1, "sys>kacho"]]) for (const f of [0.2, 0.45, 0.7]) {
      const fr = at(a.start + lead + slice * (i + f)), s = fr.st["f/dot:dot"];
      assert.ok(s.dotVis > 0.99, `区間 ${id} の途中で点が見えない（${f}）`);
      assert.ok(dist(s.pos, I[id].pts) < 14, `点が辺 ${id} から離れている: ${dist(s.pos, I[id].pts)}`);
    }
    // 途中の箱に着いた瞬間: 点は消え、箱が強調される
    const mid = at(a.start + lead + slice * 0.97);
    assert.ok(mid.st["f/dot:dot"].dotVis < 0.2 && mid.st["f/sys"].here > 0.9);
    // 終わった後: 点は見えず、最後の箱だけが強調されたまま
    const fin = at(end(M));
    assert.strictEqual(fin.st["f/dot:dot"].dotVis, 0);
    assert.strictEqual(fin.st["f/kacho"].here, 1);
    assert.ok(!(fin.st["f/sys"].here > 0.01) && !(fin.st["f/app"].here > 0.01));
  },
  async trace_label_holds_then_moves() {
    const M = await build(sb1(FLOW, [{ show: "f" }, { trace: ["app", "sys"], label: "申請書" }], { text: "申請者が申請を送ると、最初に入力チェックを通ります。ここで金額と領収書を見ます。その後で、次の承認へ進みます。", lines: [{ id: "l2", text: "次へ進みます。", do: [{ trace: ["sys", "kacho"], label: "申請書" }, { hide: "dot:dot" }] }] }));
    assert.deepStrictEqual(M.errors, []);
    const [a, b] = M.acts.filter(x => x.verb === "trace"), I = M.figs.f.items;
    assert.ok(a.line === "l1" && a.end <= b.start, "検査の前提: trace が台本の順に並ぶ");
    assert.strictEqual(a.dur, 3.0);   // 札を見せる 1 秒は止まり、その後 2 秒で動く
    assert.strictEqual(b.dur, 2.0);   // 同じ札の 2 回目は止まらない
    const st = t => UZ.frame(M, t).st;
    // 札が出ている 1 秒: 点は動かない（見えない）。札は箱の所に出て、箱が強調される
    for (const u of [0.3, 0.5, 0.75]) {
      const s = st(a.start + u), d = s["f/dot:dot"];
      assert.deepStrictEqual(d.pos, I.app.dotAt);
      assert.strictEqual(d.dotVis, 0);
      assert.ok(s["f/app"].here > 0.9, `札の間、箱が強調されていない（${u}）`);
    }
    assert.ok(st(a.start + 0.5)["f/dot:dot"].labelShow > 0.99);
    assert.ok(st(a.start + 0.4)["f/app"].pulse > 0.5, "札の間に、箱を一度強く見せる");
    // 動き出すときには札は消えている。動いている間も、着いた後も出ない
    for (const u of [1.0, 1.5, 2.5, 3.0, 4.0]) assert.ok(!(st(a.start + u)["f/dot:dot"].labelShow > 0.01), `札が残っている（${u}）`);
    assert.ok(st(a.start + 1.6)["f/dot:dot"].dotVis > 0.99);
    // 点を消すと、箱の強調も消える
    assert.ok(!(st(end(M))["f/kacho"].here > 0.01));
  },
};

(async () => {
  let ng = 0;
  const only = process.argv[2];
  for (const [name, fn] of Object.entries(tests)) {
    if (only && !name.includes(only)) continue;
    try { await fn(); console.log("ok   " + name); } catch (e) { ng++; console.log("NG   " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     ")); }
  }
  console.log(ng ? `NG ${ng} 件` : "すべて OK");
  process.exit(ng ? 1 : 0);
})();
