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
const G1 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "db" }] };
const G2 = { type: "graph", nodes: [{ id: "app", label: "アプリ" }, { id: "api", label: "API" }, { id: "cache", label: "キャッシュ" }, { id: "db", label: "DB" }], edges: [{ from: "app", to: "api" }, { from: "api", to: "cache" }, { from: "cache", to: "db" }] };
const M7 = format => deck4({ a: { title: "A", parts: [{ figure: "g1" }] }, b: { title: "B", parts: [{ figure: "g2", morph: "g1" }] } },
  [SC("s1", "a", [{ id: "l1", text: "{a}出して{b}寄ります。", do: [{ show: "g1", draw: true }, { zoom: "api", at: "b" }] }]),
   SC("s2", "b", [{ id: "l2", text: "{a}移ります。", do: [{ pan: "db", at: "a" }] }])], { g1: G1, g2: G2 }, format);

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
