#!/usr/bin/env node
// 台本の検査（形・id の解決・経路・配置）。プレーヤーと同じ JS で配置を計算して調べる。
// 使い方: node check_storyboard.cjs storyboard.json [--theme 3b1b|flat|theme.json] [--timeline timeline.json] [--json]
// 終了コード: 0 = 誤りなし（警告は出る）、1 = 誤りか配置の問題がある
const fs = require("fs");
const { load, theme } = require("./uz_node.cjs");
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--theme" && args[args.indexOf(a) - 1] !== "--timeline");
if (!file) { console.error("使い方: node check_storyboard.cjs storyboard.json [--theme 3b1b] [--timeline timeline.json] [--json]"); process.exit(2); }
(async () => {
  const UZ = load();
  const sb = JSON.parse(fs.readFileSync(file, "utf8"));
  const th = theme(opt("--theme") || "3b1b");
  const tl = opt("--timeline") ? JSON.parse(fs.readFileSync(opt("--timeline"), "utf8")) : null;
  const M = await UZ.build(sb, th, tl);
  const issues = M.errors.length ? [] : UZ.checkLayout(M);
  const out = { file, theme: th.name, errors: M.errors, warnings: M.warnings, layout: issues, duration: M.duration ? +M.duration.toFixed(1) : null };
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${file}（テーマ ${th.name}${out.duration ? `、${out.duration} 秒` : ""}）`);
    for (const e of out.errors) console.log("  誤り: " + e);
    for (const l of out.layout) console.log(`  配置（${l.kind}・${l.at}s）: ${l.msg}`);
    for (const w of out.warnings) console.log("  警告: " + w);
    if (!out.errors.length && !out.layout.length) console.log("  OK");
  }
  process.exit(out.errors.length || out.layout.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
