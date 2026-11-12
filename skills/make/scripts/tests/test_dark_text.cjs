#!/usr/bin/env node
// 通し 4 の改善点 4（スライドの地を章扉の色にする tone: "dark"）と 5（テキストの部品の既定の文字の大きさ）の検査。node test_dark_text.cjs で回す。
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("koo");
const TEXT = { id: "x", type: "text", area: { col: [1, 12], row: [1, 6] }, blocks: [
  { id: "h", kind: "heading", text: "小見出し" }, { id: "p", kind: "para", text: "段落の **強調** です。" },
  { id: "b", kind: "bullets", items: ["一つ目"] }, { id: "q", kind: "quote", text: "引用" }] };
const deck = (slide, more = {}) => ({ format: "ugoku-zukai/3", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures: {},
  slides: { p1: { title: "見出し", start: "complete", parts: [TEXT], ...slide }, p2: { title: "明るい", start: "complete", parts: [{ ...TEXT, id: "y" }] } },
  scenes: [{ id: "s1", slide: "p1", lines: [{ id: "l1", text: "説明します。" }] }, { id: "s2", slide: "p2", lines: [{ id: "l2", text: "戻ります。" }] }], ...more });
const build = (sb, th) => UZ.build(sb, th || TH, null);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const textOf = (M, fid, id) => M.figs[fid].items[id].texts[0];

const tests = {
  async dark_slide() {
    const M = await build(deck({ tone: "dark" }));
    assert.deepStrictEqual(M.errors, []);
    assert.deepStrictEqual(M.scenes.map(s => s.tone), ["dark", "light"]);
    assert.strictEqual(M.figs.x.dark, true);
    assert.strictEqual(M.figs.y.dark, false);
    const ch = TH.chapter;
    assert.strictEqual(textOf(M, "x", "p").color, ch.ink, "暗い地の本文は章扉の文字の色");
    assert.strictEqual(textOf(M, "x", "p").emColor, ch.accent, "暗い地の強調は chapter.accent");
    assert.strictEqual(textOf(M, "y", "p").color, TH.colors.ink);
    assert.strictEqual(textOf(M, "y", "p").emColor, TH.colors.accent);
    // 完成形のコマも暗い地
    assert.strictEqual(UZ.finalFrame(M, "p1").dark, 1);
    assert.strictEqual(UZ.finalFrame(M, "p2").dark, 0);
    // 再生中のコマ: 暗いスライドの間は暗い地、次のスライドで明るい地に戻る
    assert.ok(UZ.frame(M, M.scenes[0].start + 0.5).dark > 0.99);
    assert.ok(UZ.frame(M, M.scenes[1].end - 0.5).dark < 0.01);
  },
  async no_chapter_theme_stays_light() {
    const th = JSON.parse(JSON.stringify(TH)); delete th.chapter;
    const M = await build(deck({ tone: "dark" }), th);
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].tone, "light");
    assert.strictEqual(M.figs.x.dark, false);
  },
  async tone_error() {
    hasErr(await build(deck({ tone: "navy" })), /tone は dark か light/);
  },
  async text_sizes() {
    const M = await build(deck({}));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(textOf(M, "x", "h").size, 26);
    assert.strictEqual(textOf(M, "x", "p").size, 24);
    assert.strictEqual(textOf(M, "x", "b.1").size, 24);
    assert.strictEqual(textOf(M, "x", "q").size, 28);
    // ブロックの size で変えられる
    const sb = deck({ parts: [{ ...TEXT, blocks: [{ id: "p", kind: "para", text: "小さく", size: 20 }] }] });
    const M2 = await build(sb);
    assert.deepStrictEqual(M2.errors, []);
    assert.strictEqual(textOf(M2, "x", "p").size, 20);
    hasErr(await build(deck({ parts: [{ ...TEXT, blocks: [{ id: "p", kind: "para", text: "あ", size: 8 }] }] })), /size は 15〜60/);
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
