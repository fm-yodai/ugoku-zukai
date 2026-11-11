#!/usr/bin/env node
// 通し（R3 の第 2 部）で見つかったプレーヤーの不具合の検査。node test_engine_tooshi.cjs で回す。
// hide で点（dot:<名前>）と注記（note:<id>）を消せる・点の速さ・シーケンスの参加者の sub
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const { load, theme } = require("../uz_node.cjs");
const UZ = load();
const TH = theme("flat");
const base = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "examples", "graph-flow.json"), "utf8"));
// 図 flow（app → sys → kacho …）だけを使う 1 場面の台本
function sb(lines) {
  const b = base();
  return { format: b.format, title: "検査", voice: b.voice, figures: { flow: b.figures.flow }, scenes: [{ id: "s1", figure: "flow", lines }] };
}
const showAt = (M, key, t) => { const s = UZ.frame(M, t).st[key]; return s ? s.show : 0; };

const tests = {
  async hide_dot() {
    const M = await UZ.build(sb([
      { id: "l1", text: "{a}申請を送ります。", do: [{ show: "flow" }, { at: "a", trace: ["app", "sys"], label: "申請書" }] },
      { id: "l2", text: "ここで点を消します。", do: [{ hide: "dot:dot" }] },
      { id: "l3", text: "もう一度、申請者から送ります。", do: [{ trace: ["app", "sys"] }] }]), TH, null);
    assert.deepStrictEqual(M.errors, []);
    const end = id => M.timeline.lines.find(l => l.id === id).start + M.timeline.lines.find(l => l.id === id).dur;
    assert.ok(showAt(M, "flow/dot:dot", end("l1")) > 0.99, "消す前は見えている");
    assert.ok(showAt(M, "flow/dot:dot", end("l2")) < 0.01, "hide の後は見えない");
    assert.ok(showAt(M, "flow/dot:dot", end("l3")) > 0.99, "消した後の trace で、1 つ目のノードにもう一度現れる");
  },
  async hide_note() {
    const M = await UZ.build(sb([
      { id: "l1", text: "課長に注記を付けます。", do: [{ show: "flow" }, { note: "kacho", text: "多くはここで終わる" }] },
      { id: "l2", text: "注記を消します。", do: [{ hide: "note:kacho" }] }]), TH, null);
    assert.deepStrictEqual(M.errors, []);
    const end = v => M.acts.find(a => a.verb === v && a.line === (v === "note" ? "l1" : "l2")).end;
    assert.ok(showAt(M, "flow/note:kacho", end("note")) > 0.99, "消す前は見えている");
    assert.ok(showAt(M, "flow/note:kacho", end("hide")) < 0.01, "hide の後は見えない");
  },
  async hide_note_with_id_and_fig() {
    const M = await UZ.build(sb([
      { id: "l1", text: "注記を付けて消します。", do: [{ show: "flow" }, { note: "kacho", id: "n1", text: "注記" }, { hide: ["flow/note:n1"] }] }]), TH, null);
    assert.deepStrictEqual(M.errors, []);
  },
  async hide_unknown_dot_is_error() {
    const M = await UZ.build(sb([{ id: "l1", text: "まだない点を消します。", do: [{ show: "flow" }, { hide: "dot:dot" }] }]), TH, null);
    assert.ok(M.errors.some(e => e.includes("dot:dot") && e.includes("まだ出ていない")), JSON.stringify(M.errors));
  },
  async show_dot_is_error() {
    const M = await UZ.build(sb([{ id: "l1", text: "点を出します。", do: [{ show: "flow" }, { trace: ["app", "sys"] }, { pulse: "dot:dot" }] }]), TH, null);
    assert.ok(M.errors.some(e => e.includes("hide だけ")), JSON.stringify(M.errors));
  },
  async trace_default_speed() {
    // 利用者の指摘: 区間 1 つに 1.0 秒では速くて見づらい → 2 秒
    const M = await UZ.build(sb([{ id: "l1", text: "申請を送ります。", do: [{ show: "flow" }, { trace: ["app", "sys", "kacho"] }] }]), TH, null);
    const a = M.acts.find(x => x.verb === "trace");
    assert.strictEqual(a.dur, 4.0);
  },
  async label_shown_once() {
    // 利用者の指摘: 札が出たり消えたりすると不自然 → 点が何を表すかを最初に 1 回だけ見せ、その後は出さない
    const M = await UZ.build(sb([
      { id: "l0", text: "経費の申請は、申請者から経理まで、五つの役割を順に通って届きます。全体を見てみましょう。", do: [{ show: "flow" }] },
      { id: "l1", text: "申請者が申請を送ると、最初に入力チェックを通ります。ここで金額と領収書を見ます。", do: [{ trace: ["app", "sys"], label: "申請書" }] },
      { id: "l2", text: "金額が十万円までなら、申請は課長へ進みます。多くの申請はここで終わります。", do: [{ trace: ["sys", "kacho"], label: "申請書" }] },
      { id: "l3", text: "課長が承認すると、経理に承認の通知が届きます。これで精算の手続きに進めます。", do: [{ trace: ["kacho", "keiri"], label: "承認の通知" }] }]), TH, null);
    assert.deepStrictEqual(M.errors, []);
    const [t1, t2, t3] = ["l1", "l2", "l3"].map(id => M.acts.find(a => a.verb === "trace" && a.line === id));
    assert.ok(t1.end <= t2.start && t2.end <= t3.start, "検査の前提: trace が台本の順に並ぶ");
    const lab = t => { const s = UZ.frame(M, t).st["flow/dot:dot"]; return { show: s.labelShow || 0, text: s.labelText }; };
    assert.ok(lab(t1.start + 1.0).show > 0.99, "最初の trace の頭で札が出る");
    assert.strictEqual(lab(t1.start + 1.0).text, "申請書");
    assert.ok(lab(t1.start + 3.5).show < 0.01, "しばらくしたら消える");
    assert.ok(lab(t2.start + 0.5).show < 0.01 && lab(t2.start + 1.5).show < 0.01, "同じ札の 2 回目の trace では出ない");
    assert.ok(lab(t3.start + 1.0).show > 0.99, "札の言葉が変わったら、もう一度だけ出る");
    assert.strictEqual(lab(t3.start + 1.0).text, "承認の通知");
    const view = fs.readFileSync(path.join(__dirname, "..", "..", "player", "src", "view_svg.js"), "utf8");
    assert.ok(view.includes("s.labelShow") && !view.includes("inBox"), "view_svg.js は labelShow で札を出す（箱の出入りで出し入れしない）");
  },
  async sequence_sub_warns() {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "examples", "sequence.json"), "utf8"));
    const fid = Object.keys(b.figures).find(k => b.figures[k].type === "sequence");
    b.figures[fid].participants[0].sub = "補足";
    const M = await UZ.build(b, TH, null);
    assert.ok(M.warnings.some(w => w.includes("sub") && w.includes("描かれない")), JSON.stringify(M.warnings));
  },
};

(async () => {
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log(`ok ${name}`); } catch (e) { fail = 1; console.log(`NG ${name}: ${e.message}`); }
  }
  process.exit(fail);
})();
