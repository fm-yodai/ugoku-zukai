#!/usr/bin/env node
// スライド（R4 第 1 部）の検査。node test_slides.cjs で回す。
// 場面がスライドを指す形（/3）・区画・言いたいこと・テキスト・画像・フレーム・完成形・blur
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const EX = path.join(__dirname, "..", "..", "examples");
const FLOW = JSON.parse(fs.readFileSync(path.join(EX, "graph-flow.json"), "utf8")).figures.flow;
const LIST = [{ id: "a", text: "一つ目" }, { id: "b", text: "二つ目" }];
const deck = (slides, scenes, figures = {}, format = "ugoku-zukai/3") => ({ format, title: "検査", voice: { speaker: 8, speed: 1.1 }, figures, slides, scenes });
const SC = (id, slide, lines) => ({ id, slide, lines: lines || [{ id: "l_" + id, text: "説明します。" }] });
const build = (sb, o) => UZ.build(sb, TH, null, o);
const lineEnd = (M, id) => { const l = M.timeline.lines.find(x => x.id === id); return l.start + l.dur; };
const showAt = (M, key, t) => { const s = UZ.frame(M, t).st[key]; return s ? s.show : 0; };
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const hasWarn = (M, re) => assert.ok((M.warnings || []).some(e => re.test(e)), `警告に ${re} がない: ${JSON.stringify(M.warnings)}`);
// 左に flow、右（col 7〜12）にテキストの部品 defs
const textDeck = (blocks, acts, area) => deck({ p1: { title: "見出し", parts: [
  { figure: "flow", area: { col: [1, 6], row: [1, 6] } },
  { id: "defs", type: "text", blocks, area: area || { col: [7, 12], row: [1, 6] } }] } },
  [SC("s1", "p1", [{ id: "l1", text: "説明します。", do: acts || [] }])], { flow: FLOW });
const { loadAssets } = require("../assets.cjs");
const SBP = path.join(__dirname, "storyboard.json");   // 画像の src は、台本のあるフォルダ（ここでは tests/）からの相対パス
const imgDeck = parts => deck({ p1: { title: "画像", parts } }, [SC("s1", "p1", [{ id: "l1", text: "出します。", do: parts.map(p => ({ show: p.id })) }])]);
const TWO = { p1: { title: "見出し", parts: [
  { figure: "flow", area: { col: [1, 7], row: [1, 6] } },
  { id: "pts", type: "list", items: LIST, area: { col: [8, 12], row: [1, 6] } }] } };

const tests = {
  // ---- Task 1 ----
  async slide_scene_areas() {
    const M = await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }, { show: "pts" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const sc = M.scenes[0];
    assert.deepStrictEqual(sc.figs, ["flow", "pts"]);
    assert.strictEqual(sc.header, "見出し");
    assert.strictEqual(sc.slide, "p1");
    const cw = (1184 - 24 * 11) / 12;
    assert.ok(Math.abs(sc.areas[0].w - (cw * 7 + 24 * 6)) < 0.01);
    assert.ok(Math.abs(sc.areas[1].x - (48 + (cw + 24) * 7)) < 0.01);
    assert.strictEqual(sc.areas[0].y, 104); assert.strictEqual(sc.areas[0].h, 470);
    assert.ok(showAt(M, "pts/a", M.duration) > 0.99);
    assert.deepStrictEqual(M.slides.p1.figs, ["flow", "pts"]);
    assert.deepStrictEqual(M.slides.p1.scenes, ["s1"]);
  },
  async statement_shrinks_body() {
    const M = await build(deck({ p1: { title: "見出し", statement: "短い 1 文です。", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].areas[0].y, 104 + 48);
    assert.strictEqual(M.scenes[0].areas[0].h, 470 - 48);
    assert.deepStrictEqual(UZ.frame(M, M.scenes[0].start + 2).statement.lines, ["短い 1 文です。"]);
  },
  async slide_reused_later() {
    const slides = { ...TWO, p2: { title: "別", parts: [{ id: "other", type: "list", items: [{ id: "x", text: "別の話" }] }] } };
    const M = await build(deck(slides, [
      SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }] }]),
      SC("s2", "p2", [{ id: "l2", text: "別の話です。", do: [{ show: "other" }] }]),
      SC("s3", "p1", [{ id: "l3", text: "戻ります。" }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(showAt(M, "flow/app", lineEnd(M, "l3")) > 0.99, "戻っても出たまま");
    assert.deepStrictEqual(M.scenes[2].areas, M.scenes[0].areas);
    assert.ok(UZ.frame(M, lineEnd(M, "l3")).figs.flow.opacity > 0.99);
    assert.deepStrictEqual(M.slides.p1.scenes, ["s1", "s3"]);
  },
  async part_id_collision() {
    const p = id => ({ title: "t", parts: [{ id: "pts", type: "list", items: LIST }] });
    hasErr(await build(deck({ p1: p(), p2: p() }, [SC("s1", "p1"), SC("s2", "p2")])), /部品「pts」.*重複/);
    hasErr(await build(deck({ p1: { title: "t", parts: [{ id: "flow", type: "list", items: LIST }] } }, [SC("s1", "p1")], { flow: FLOW })), /部品「flow」.*重複/);
  },
  async shared_figure_ok() {
    const M = await build(deck({ p1: { title: "a", parts: [{ figure: "flow" }] }, p2: { title: "b", parts: [{ figure: "flow" }] } },
      [SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "flow" }] }]), SC("s2", "p2")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
  },
  async bad_shapes() {
    const one = parts => deck({ p1: { title: "t", parts } }, [SC("s1", "p1")], { flow: FLOW });
    hasErr(await build(deck(TWO, [{ id: "s1", slide: "p1", figure: "flow", lines: [{ id: "l1", text: "あ。" }] }], { flow: FLOW })), /slide か figure のどちらか/);
    hasErr(await build(deck(TWO, [SC("s1", "px")], { flow: FLOW })), /スライド「px」が slides にない/);
    for (const area of [{ col: [0, 5], row: [1, 6] }, { col: [5, 13], row: [1, 6] }, { col: [1, 6], row: [3, 2] }, { col: [1, 6] }])
      hasErr(await build(one([{ figure: "flow", area }])), /area/);
    hasErr(await build(one([{ figure: "flow", area: { col: [1, 6], row: [1, 6] } }, { id: "pts", type: "list", items: LIST }])), /area が要る/);
    hasErr(await build(one([{ figure: "flow", area: { col: [1, 7], row: [1, 6] } }, { id: "pts", type: "list", items: LIST, area: { col: [7, 12], row: [1, 6] } }])), /完成形で重なる/);
    const tr = await build(one([{ figure: "flow", area: { col: [1, 7], row: [1, 6] } }, { id: "pts", type: "list", items: LIST, area: { col: [7, 12], row: [1, 6] }, transient: true }]));
    assert.ok(!(tr.errors || []).some(e => /完成形で重なる/.test(e)), "transient の部品は重なってよい");
    hasErr(await build(deck({ p1: { title: "t", start: "empty", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /start は "complete"/);
    hasErr(await build(deck({ p1: { parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /title がない/);
    hasErr(await build(deck({ p1: { title: "t", parts: [] } }, [SC("s1", "p1")], { flow: FLOW })), /parts/);
    hasErr(await build(one([{ figure: "nai" }])), /図「nai」が figures にない/);
    hasErr(await build(deck({ p1: { title: "t", statement: "とても長い言いたいことの文を書くと画面の幅を超えて折り返しが起きますがそれが三行以上に及ぶような長さの文になってしまうと読み切れないので警告を出して知らせることにしていますのでこの文はその警告が出ることを確かめるためにわざと長く書いてあります。", parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /言いたいことが 2 行に収まらない/);
    hasErr(await build(deck(TWO, [SC("s1", "p1")], { flow: FLOW }, "ugoku-zukai/2")), /slides を使うには format を "ugoku-zukai\/3"/);
  },
  async legacy_unchanged() {
    const sb = JSON.parse(fs.readFileSync(path.join(EX, "sequence.json"), "utf8"));
    assert.strictEqual(sb.format, "ugoku-zukai/2");
    const M = await build(sb);
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].slide, null);
    const single = M.scenes.find(s => s.figs.length === 1 && !s.captions.length);
    assert.deepStrictEqual(single.areas[0], UZ.AREA.body);
    assert.deepStrictEqual(UZ.frame(M, 3).statement.lines, []);
  },

  // ---- Task 2: テキストの部品 ----
  async text_blocks_layout() {
    const M = await build(textDeck([
      { id: "h", kind: "heading", text: "ユーザビリティ" },
      { id: "p", kind: "para", text: "決まった利用者が、決まった状況で、目的を有効に、効率よく、満足して達成できる度合い。" },
      { id: "b", kind: "bullets", items: ["使う前", "使っている間", "使った後"] },
      { id: "q", kind: "quote", text: "利用者の知覚と反応。", source: ["ISO 9241-210"] }], [{ show: "b" }]));
    assert.deepStrictEqual(M.errors, []);
    const F = M.figs.defs, W = M.scenes[0].areas[1].w;
    assert.ok(Math.abs(F.w - W) < 0.01, "図の幅は区画の幅");
    let y = -1;
    for (const id of ["h", "p", "b.1", "b.2", "b.3", "q"]) {
      const b = F.items[id].bbox;
      assert.ok(b.x >= -0.01 && b.x + b.w <= W + 0.01, `${id} が区画の幅に収まる`);
      assert.ok(b.y > y, `${id} は前のブロックより下`); y = b.y;
    }
    assert.ok(showAt(M, "defs/b.1", M.duration) > 0.99 && showAt(M, "defs/b.3", M.duration) > 0.99, "ブロックの id で全項目が出る");
    assert.ok(showAt(M, "defs/p", M.duration) < 0.01);
    assert.ok(F.items.q.texts.some(t => t.lines.join("").includes("ISO 9241-210")), "囲みに出どころが出る");
  },
  async text_em_spans() {
    assert.deepStrictEqual(UZ.parseEm("目的を**有効に**達成"), { text: "目的を有効に達成", ranges: [[3, 6]] });
    assert.deepStrictEqual(UZ.parseEm("強調なし"), { text: "強調なし", ranges: [] });
    const long = "決まった利用者が、決まった状況で、目的を**有効に、効率よく、満足して達成できる**度合いのことを、ユーザビリティと呼びます。";
    const M = await build(textDeck([{ id: "p", kind: "para", text: long }]));
    assert.deepStrictEqual(M.errors, []);
    const T = M.figs.defs.items.p.texts[0];
    assert.ok(T.lines.length >= 2, "折り返している");
    assert.strictEqual(T.lines.join(""), UZ.parseEm(long).text);
    assert.strictEqual(T.spans.flat().filter(x => x.em).map(x => x.t).join(""), "有効に、効率よく、満足して達成できる");
    assert.deepStrictEqual(T.spans.map(l => l.map(x => x.t).join("")), T.lines);
  },
  async text_long_ascii_wraps() {
    const M = await build(textDeck([{ id: "p", kind: "para", text: "https://example.com/" + "abcdefghij".repeat(12) }]));
    assert.deepStrictEqual(M.errors, []);
    const T = M.figs.defs.items.p.texts[0], W = M.scenes[0].areas[1].w;
    for (const l of T.lines) assert.ok(UZ.textW(l, T.size, T.weight) <= W + 0.01, "どの行も区画の幅以下");
    assert.deepStrictEqual(UZ.checkLayout(M).filter(i => /defs/.test(i.msg)), []);
  },
  async text_overflow_is_issue() {
    const blocks = [1, 2, 3, 4, 5, 6].map(i => ({ id: "p" + i, kind: "para", text: "決まった利用者が、決まった状況で、目的を達成できる度合いです。" }));
    const M = await build(textDeck(blocks, [{ show: "defs" }], { col: [7, 12], row: [1, 2] }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(UZ.checkLayout(M).some(i => /defs のテキストが区画に収まらない/.test(i.msg)));
  },
  async text_not_enlarged() {
    const M = await build(deck({ p1: { title: "t", parts: [{ id: "defs", type: "text", blocks: [{ id: "p", kind: "para", text: "短い文。" }] }] } }, [SC("s1", "p1")]));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].place.defs.s, 1);
    assert.strictEqual(M.scenes[0].place.defs.oy, M.scenes[0].areas[0].y, "区画の上に寄せる");
  },
  async text_bad_shapes() {
    hasErr(await build(textDeck([{ id: "x", kind: "memo", text: "あ" }])), /kind は heading \/ para \/ bullets \/ quote/);
    hasErr(await build(textDeck([{ id: "x", kind: "bullets" }])), /items/);
    hasErr(await build(textDeck([{ id: "x", kind: "para" }])), /text がない/);
    hasErr(await build(textDeck([{ kind: "para", text: "あ" }])), /id がない/);
    hasWarn(await build(textDeck([{ id: "x", kind: "para", text: "あ", source: 3 }])), /source は文字列か文字列の配列/);
  },

  // ---- Task 3: 画像の部品 ----
  async image_part_fits() {
    const sb = imgDeck([{ id: "im", type: "image", src: "assets/dot.svg", source: "検査用", area: { col: [1, 6], row: [1, 6] } }, { id: "pts", type: "list", items: LIST, area: { col: [7, 12], row: [1, 6] } }]);
    const M = await build(sb, { assets: loadAssets(SBP, sb) });
    assert.deepStrictEqual(M.errors, []);
    const b = M.figs.im.items.img.bbox, pl = M.scenes[0].place.im, ar = M.scenes[0].areas[0];
    assert.ok(Math.abs(b.w / b.h - 2) < 0.001, "縦横比を保つ");
    assert.ok(Math.abs(b.w * pl.s - ar.w) < 0.5, "区画の幅いっぱい");
    assert.ok(pl.oy >= ar.y - 0.01 && pl.oy + b.h * pl.s <= ar.y + ar.h + 0.01, "区画の中");
    assert.ok(showAt(M, "im/img", M.duration) > 0.99);
    assert.deepStrictEqual(UZ.checkLayout(M), []);
  },
  async image_missing_is_error() {
    const sb = imgDeck([{ id: "im", type: "image", src: "assets/dot.svg", source: "検査用" }]);
    hasErr(await build(sb), /画像「assets\/dot.svg」が読み込まれていない/);
    hasErr(await build(imgDeck([{ id: "im", type: "image", source: "検査用" }])), /src がない/);
  },
  async image_unsupported_is_error() {
    for (const src of ["assets/x.webp", "assets/nai.png", "../x.png"]) {
      const sb = imgDeck([{ id: "im", type: "image", src }]);
      assert.throws(() => loadAssets(SBP, sb), e => e.code === "ASSET" && e.message.includes(`画像「${src}」が読めない`));
    }
  },
  async image_credit_and_source() {
    const sb = imgDeck([
      { id: "im1", type: "image", src: "assets/dot.svg", source: "検査用", credit: "写真: A", area: { col: [1, 4], row: [1, 6] } },
      { id: "im2", type: "image", src: "assets/dot.svg", source: "検査用", credit: "写真: A", area: { col: [5, 8], row: [1, 6] } },
      { id: "im3", type: "image", src: "assets/dot.svg", area: { col: [9, 12], row: [1, 6] } }]);
    const M = await build(sb, { assets: loadAssets(SBP, sb) });
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.credits, ["写真: A"]);
    hasWarn(M, /図「im3」: 画像の出どころ（source）がない/);
    assert.ok(!M.warnings.some(w => /im1.*出どころ/.test(w)));
  },

  // ---- Task 4: フレーム・最初から完成形・完成形に含めない部品 ----
  async frame_behind_parts() {
    const R = { col: [7, 12], row: [1, 6] };
    const M = await build(deck({ p1: { title: "t", parts: [
      { figure: "flow", area: { col: [1, 6], row: [1, 6] } },
      { id: "fr", type: "frame", title: "定義", area: R },
      { id: "defs", type: "text", blocks: [{ id: "p", kind: "para", text: "本文。" }], area: R }] } },
      [SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "fr" }, { show: "defs" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const b = M.figs.fr.items.box.bbox, ar = M.scenes[0].areas[1];
    assert.ok(Math.abs(b.w - ar.w) < 0.01 && Math.abs(b.h - ar.h) < 0.01, "枠は区画の大きさ");
    assert.strictEqual(M.scenes[0].place.fr.s, 1);
    const inner = M.scenes[0].areas[2];   // 枠の区画の中の部品は、内側に余白（20）と題のぶん（30）を取る
    assert.ok(Math.abs(inner.x - (ar.x + 20)) < 0.01 && Math.abs(inner.y - (ar.y + 50)) < 0.01 && Math.abs(inner.w - (ar.w - 40)) < 0.01 && Math.abs(inner.h - (ar.h - 70)) < 0.01);
    assert.deepStrictEqual(M.scenes[0].areas[0], UZ.cellRect(UZ.slideBody(0), { col: [1, 6], row: [1, 6] }), "枠の外の部品はそのまま");
    assert.ok(M.figs.fr.items.title.texts[0].lines.join("") === "定義");
    assert.ok(showAt(M, "fr/box", M.duration) > 0.99 && showAt(M, "fr/title", M.duration) > 0.99);
    assert.ok(M.scenes[0].figs.indexOf("fr") < M.scenes[0].figs.indexOf("defs"), "宣言の順が描く順");
  },
  async complete_shows_all() {
    const M = await build(deck({ p1: { ...TWO.p1, start: "complete" } }, [SC("s1", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const t = lineEnd(M, "l_s1");
    for (const k of ["flow/app", "flow/app>sys", "pts/a", "pts/b"]) assert.ok(showAt(M, k, t + 3) > 0.99, `${k} が出ている`);
    assert.ok(!M.warnings.some(w => /show していない/.test(w)));
  },
  async complete_skips_transient() {
    const M = await build(deck({ p1: { title: "t", start: "complete", parts: [
      { figure: "flow", area: { col: [1, 12], row: [1, 6] } },
      { id: "pts", type: "list", items: LIST, area: { col: [1, 12], row: [1, 6] }, transient: true }] } }, [SC("s1", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(showAt(M, "flow/app", M.duration) > 0.99);
    assert.ok(showAt(M, "pts/a", M.duration) < 0.01, "完成形に含めない部品は自動では出ない");
    assert.deepStrictEqual(M.slides.p1.transient, ["pts"]);
  },
  async complete_only_first_scene() {
    const slides = { p1: { ...TWO.p1, start: "complete" }, p2: { title: "別", parts: [{ id: "other", type: "list", items: [{ id: "x", text: "別の話" }] }] } };
    const M = await build(deck(slides, [
      SC("s1", "p1", [{ id: "l1", text: "箇条を消します。", do: [{ hide: "pts", after: 2 }] }]),
      SC("s2", "p2", [{ id: "l2", text: "別の話です。", do: [{ show: "other" }] }]),
      SC("s3", "p1", [{ id: "l3", text: "戻ります。" }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(showAt(M, "pts/a", M.duration) < 0.01, "戻っても、消した部品は消えたまま");
    assert.ok(showAt(M, "flow/app", M.duration) > 0.99);
  },

  // ---- Task 5: 完成形のコマ ----
  async final_frame_shows_parts() {
    const M = await build(deck({ p1: { ...TWO.p1, statement: "言いたいこと。" } }, [SC("s1", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const fr = UZ.finalFrame(M, "p1");
    for (const k of ["flow/app", "flow/app>sys", "pts/a", "pts/b"]) assert.strictEqual(fr.st[k].show, 1, k);
    assert.strictEqual(fr.figs.flow.opacity, 1); assert.deepStrictEqual(fr.figs.flow.place, M.scenes[0].place.flow);
    assert.strictEqual(fr.sub, null); assert.strictEqual(fr.end, 0); assert.strictEqual(fr.dark, 0);
    assert.strictEqual(fr.header.text, "見出し"); assert.strictEqual(fr.header.opacity, 1);
    assert.deepStrictEqual(fr.statement.lines, ["言いたいこと。"]); assert.strictEqual(fr.statement.opacity, 1);
    assert.strictEqual(UZ.finalFrame(M, "nai"), null);
  },
  async final_frame_excludes() {
    const slides = { p1: { title: "t", parts: [
      { figure: "flow", area: { col: [1, 12], row: [1, 6] } },
      { id: "pts", type: "list", items: LIST, area: { col: [1, 12], row: [1, 6] }, transient: true }] },
      p2: { title: "別", parts: [{ id: "other", type: "list", items: [{ id: "x", text: "別の話" }] }] } };
    const M = await build(deck(slides, [
      SC("s1", "p1", [{ id: "l1", text: "{a}出します。", do: [{ show: "flow" }, { at: "a", trace: ["app", "sys"], label: "申請書" }, { note: "sys", text: "注記" }, { mark: "app", as: "check" }] }]),
      SC("s2", "p2")], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const fr = UZ.finalFrame(M, "p1");
    const show = k => (fr.st[k] ? fr.st[k].show : 0);
    assert.strictEqual(show("flow/app"), 1);
    for (const k of ["pts/a", "flow/dot:dot", "flow/note:sys", "flow/mark:app", "other/x"]) assert.strictEqual(show(k), 0, `${k} は完成形に出ない`);
    assert.strictEqual(fr.figs.pts.opacity, 0, "完成形に含めない部品の図は出さない");
    assert.strictEqual(fr.figs.other.opacity, 0);
  },

  // ---- Task 6: blur ----
  async blur_others() {
    const M = await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "出して、ぼかします。", do: [{ show: "flow", dur: 0.2, stagger: 0 }, { show: "pts" }, { blur: "flow/sys" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const st = UZ.frame(M, M.duration).st;
    assert.ok(st["flow/sys"].blur < 0.01, "対象はぼかさない");
    assert.ok(st["flow/app"].blur > 0.99, "同じ図のほかの部品はぼける");
    assert.ok(st["pts/a"].blur > 0.99, "対象のない図も、全体がぼける");
    assert.strictEqual(st["flow/app"].dim, 1, "薄くはしない（focus とは別）");
  },
  async unblur_restores() {
    const M = await build(deck(TWO, [SC("s1", "p1", [
      { id: "l1", text: "出して、ぼかします。", do: [{ show: "flow", dur: 0.2, stagger: 0 }, { show: "pts" }, { blur: "pts" }] },
      { id: "l2", text: "戻します。", do: [{ unblur: true }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(UZ.frame(M, lineEnd(M, "l1") + 0.2).st["flow/app"].blur > 0.99);
    const st = UZ.frame(M, M.duration).st;
    for (const k of ["flow/app", "flow/sys", "pts/a"]) assert.ok(st[k].blur < 0.01, `${k} が戻る`);
  },
  async blur_and_focus_independent() {
    const M = await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "出して、絞って、ぼかします。", do: [{ show: "flow", dur: 0.2, stagger: 0 }, { show: "pts" }, { focus: "flow/sys" }, { blur: "flow/sys" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    const st = UZ.frame(M, M.duration).st;
    assert.ok(Math.abs(st["flow/app"].dim - 0.2) < 0.01 && st["flow/app"].blur > 0.99);
    assert.strictEqual(st["pts/a"].dim, 1, "focus は同じ図の中だけ");
    hasErr(await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "あ。", do: [{ blur: "nai" }] }])], { flow: FLOW })), /「nai」がこの場面の図/);
  },

  // ---- 第 1 部のレビューで見つかったこと ----
  async show_across_scenes_no_false_warning() {   // 同じスライドを場面をまたいで少しずつ出しても「show していない」と言わない
    const M = await build(deck(TWO, [
      SC("s1", "p1", [{ id: "l1", text: "図を出します。", do: [{ show: "flow" }] }]),
      SC("s2", "p1", [{ id: "l2", text: "箇条を出します。", do: [{ show: "pts" }] }])], { flow: FLOW }));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.warnings.filter(w => /show していない/.test(w)), []);
    const N = await build(deck(TWO, [SC("s1", "p1", [{ id: "l1", text: "図を出します。", do: [{ show: "flow" }] }]), SC("s2", "p1")], { flow: FLOW }));
    assert.deepStrictEqual(N.warnings.filter(w => /show していない/.test(w)), ["スライド「p1」: 部品「pts」を、どの場面でも show していない（何も出ない）"]);
  },
  async inner_id_same_as_other_part() {   // ブロックの id が、この場面にない別の部品の id と同じでも、この場面のブロックを指す
    const slides = {
      p1: { title: "a", parts: [{ id: "defs", type: "list", items: LIST }] },
      p2: { title: "b", parts: [{ id: "t2", type: "text", blocks: [{ id: "defs", kind: "para", text: "定義の文。" }, { id: "more", kind: "para", text: "続きの文。" }] }] } };
    const M = await build(deck(slides, [
      SC("s1", "p1", [{ id: "l1", text: "出します。", do: [{ show: "defs" }] }]),
      SC("s2", "p2", [{ id: "l2", text: "定義だけ出します。", do: [{ show: "defs" }] }])]));
    assert.deepStrictEqual(M.errors, []);
    assert.ok(showAt(M, "t2/defs", M.duration) > 0.99, "この場面のブロックが出る");
    assert.ok(showAt(M, "t2/more", M.duration) < 0.01);
    assert.ok(showAt(M, "defs/a", M.duration) > 0.99, "s1 では部品 defs の全体");
    hasErr(await build(deck(slides, [SC("s1", "p1", [{ id: "l1", text: "ない図。", do: [{ show: "t2" }] }]), SC("s2", "p2", [{ id: "l2", text: "出します。", do: [{ show: "t2" }] }])])), /「t2」がこの場面の図/);
  },
  async statement_too_long_is_error() {
    hasErr(await build(deck({ p1: { title: "t", statement: "あ".repeat(130), parts: [{ figure: "flow" }] } }, [SC("s1", "p1")], { flow: FLOW })), /言いたいことが 2 行に収まらない/);
  },
  async prototype_names_do_not_crash() {
    hasErr(await build(deck(TWO, [SC("s1", "constructor")], { flow: FLOW })), /スライド「constructor」が slides にない/);
    hasErr(await build(deck({ p1: { title: "t", parts: [{ figure: "toString" }] } }, [SC("s1", "p1")], { flow: FLOW })), /図「toString」が figures にない/);
    hasErr(await build({ format: "ugoku-zukai/2", title: "t", figures: { flow: FLOW }, scenes: [{ id: "s1", figure: "constructor", lines: [{ id: "l1", text: "あ。" }] }] }), /図「constructor」が figures にない/);
  },
  async tiny_frame_inner_is_error() {
    const R = { col: [1, 12], row: [1, 1] };
    hasErr(await build(deck({ p1: { title: "t", parts: [{ id: "fr", type: "frame", title: "題", area: R }, { id: "tx", type: "text", blocks: [{ id: "p", kind: "para", text: "文。" }], area: R }] } }, [SC("s1", "p1")])),
      /スライド「p1」: 部品「tx」の区画が小さすぎる/);
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
  console.log(fail ? `スライドの検査: NG ${fail} 件` : "スライドの検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
