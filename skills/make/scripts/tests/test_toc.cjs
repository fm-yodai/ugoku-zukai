#!/usr/bin/env node
// 通し 4 の改善点 3: 目次の部品（toc）の検査。node test_toc.cjs で回す。
// 左揃えの並び、今の章の強調、地（章扉の色）、形の誤り、構成メモとの照合
"use strict";
const assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const { checkAgainstOutline } = require("../outline_check.cjs");
const UZ = load();
const TH = theme("koo");
const ITEMS = [{ id: "c1", text: "UX とは" }, { id: "c2", text: "ユーザビリティとの違い" }, { id: "c3", text: "UX 設計とは" }];
const sb1 = (fig, more = {}) => ({ format: "ugoku-zukai/3", title: "検査", voice: { speaker: 8, speed: 1.1 }, figures: { t: fig, ...(more.figures || {}) },
  scenes: [{ id: "s1", chapter: "c1", figure: more.figure || "t", lines: [{ id: "l1", text: "この三つの章で説明します。" }] }] });
const build = sb => UZ.build(sb, TH, null);
const hasErr = (M, re) => assert.ok((M.errors || []).some(e => re.test(e)), `誤りに ${re} がない: ${JSON.stringify(M.errors)}`);
const OUTLINE = chapters => ({ format: "ugoku-zukai-outline/2", basics: {}, chapters });

const tests = {
  async layout_left_aligned_and_dark() {
    const M = await build(sb1({ type: "toc", items: ITEMS }));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].tone, "dark", "章扉の色があるテーマでは暗い地");
    const I = M.figs.t.items;
    assert.ok(I.heading && I.rule, "見出しと線がある");
    assert.strictEqual(I.heading.texts[0].lines[0], "目次");
    // 章の題は左揃えで、左端がそろう
    const lefts = ITEMS.map(it => I[it.id].texts[1]).map(T => T.bbox.x);
    assert.ok(lefts.every(x => Math.abs(x - lefts[0]) < 0.01), `題の左端がそろっていない: ${lefts}`);
    assert.ok(ITEMS.every(it => I[it.id].texts[1].anchor === "start"));
    assert.deepStrictEqual(ITEMS.map(it => I[it.id].texts[0].lines[0]), ["1", "2", "3"]);
    // 場面の頭で自動で全部出る
    const st = UZ.frame(M, M.endCard - 0.01).st;
    for (const it of ITEMS) assert.ok(st[`t/${it.id}`].show > 0.99, `${it.id} が出ていない`);
  },
  async current_highlight() {
    const M = await build(sb1({ type: "toc", items: ITEMS, current: "c2" }));
    assert.deepStrictEqual(M.errors, []);
    const I = M.figs.t.items, ch = TH.chapter;
    assert.strictEqual(I.c2.texts[1].color, ch.ink);
    assert.ok(I.c2.texts[1].weight > I.c1.texts[1].weight, "今の章を太くする");
    assert.strictEqual(I.c1.texts[1].color, ch.muted);
    assert.strictEqual(I.c3.texts[1].color, ch.muted);
  },
  async light_tone_and_heading() {
    const M = await build(sb1({ type: "toc", items: ITEMS, tone: "light", heading: "" }));
    assert.deepStrictEqual(M.errors, []);
    assert.strictEqual(M.scenes[0].tone, "light");
    assert.ok(!M.figs.t.items.heading, "heading: \"\" で見出しを出さない");
  },
  async errors() {
    hasErr(await build(sb1({ type: "toc", items: [] })), /items（章）が空/);
    hasErr(await build(sb1({ type: "toc", items: [{ id: "c1" }] })), /text がない/);
    hasErr(await build(sb1({ type: "toc", items: ITEMS, current: "c9" })), /current「c9」/);
    hasErr(await build(sb1({ type: "toc", items: [{ id: "heading", text: "あ" }] })), /重複/);
    hasErr(await build(sb1({ type: "toc", items: ITEMS, tone: "navy" })), /tone は dark か light/);
    // 暗い地の目次を他の図と並べると誤り
    const sb = sb1({ type: "toc", items: ITEMS }, { figures: { l: { type: "list", items: [{ id: "a", text: "あ" }] } }, figure: ["t", "l"] });
    hasErr(await build(sb), /目次を他の図と並べる/);
  },
  async outline_compare() {
    const M = await build(sb1({ type: "toc", items: ITEMS }));
    const ok = checkAgainstOutline(M.sb, M, OUTLINE([{ id: "c1", title: "UX とは" }, { id: "c2", title: "ユーザビリティとの違い" }, { id: "c3", title: "UX 設計とは" }]), {});
    assert.deepStrictEqual(ok.warnings.filter(w => w.includes("目次")), []);
    const r = checkAgainstOutline(M.sb, M, OUTLINE([{ id: "c1", title: "UX とは何か" }, { id: "c3", title: "UX 設計とは" }, { id: "c2", title: "ユーザビリティとの違い" }, { id: "c4", title: "まとめ" }]), {});
    const w = r.warnings.filter(x => x.includes("目次")).join("\n");
    assert.match(w, /章「c1」の題「UX とは」が構成メモの題「UX とは何か」と違う/);
    assert.match(w, /構成メモの章 「c4」 がない/);
    assert.match(w, /章の順が構成メモと違う/);
    const r2 = checkAgainstOutline(M.sb, M, OUTLINE([{ id: "c1", title: "UX とは" }, { id: "c2", title: "ユーザビリティとの違い" }]), {});
    assert.match(r2.warnings.join("\n"), /章「c3」が構成メモの章にない/);
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
