#!/usr/bin/env node
// M8（数式と座標）の検査。node test_m8.cjs で回す。
// タスクが進むごとに、ここに検査を足す
"use strict";
const assert = require("assert");
const { load } = require("../uz_node.cjs");
load();

const tests = {
  async tex_tree_basic() {
    const r = UZMJ.tex2tree("f'(a)=\\cssId{k1}{2.35}", { display: true });
    assert.ok(r.w > 0 && r.h > 0, JSON.stringify(r).slice(0, 200));
    const ids = []; (function walk(n) { if (n.attrs && n.attrs.id) ids.push(n.attrs.id); (n.children || []).forEach(walk); })(r.tree);
    assert.ok(ids.includes("k1"));
    assert.deepStrictEqual(UZMJ.tex2tree("x^2"), UZMJ.tex2tree("x^2"));   // 同じ入力は同じ木
  },
  async tex_cjk_text_has_width() {
    const r = UZMJ.tex2tree("v=\\text{速さ}");
    const hasText = JSON.stringify(r.tree).includes('"text":"速"') && JSON.stringify(r.tree).includes('"text":"さ"');   // MathJax は 1 文字ずつ <text> にする
    assert.ok(hasText && r.w > 1.5, `w=${r.w}`);
  },
  async tex_error_returns_error() {
    assert.strictEqual(UZMJ.tex2tree("\\frac{1}{").error, "Missing close brace");
    assert.ok(UZMJ.tex2tree("\\foo").error);
  },
  async tex_box_is_in_em() {
    const r = UZMJ.tex2tree("x^2");
    assert.ok(r.w > 0.5 && r.w < 3 && r.h > 0 && r.depth >= 0, JSON.stringify([r.w, r.h, r.depth]));
  },
  async bundle_has_no_script_close() {
    const fs = require("fs"), path = require("path");
    const t = fs.readFileSync(path.join(__dirname, "../../player/vendor/mathjax-uz.js"), "utf8");
    assert.ok(!t.includes("</script"), "束に </script がある（build_player.py が逃がす前提）");
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
  console.log(fail ? `M8 の検査: NG ${fail} 件` : "M8 の検査: すべて OK");
  process.exit(fail ? 1 : 0);
})();
