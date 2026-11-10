#!/usr/bin/env node
// 台本の検査（形・id の解決・経路・配置）。プレーヤーと同じ JS で配置を計算して調べる。
// 使い方: node check_storyboard.cjs storyboard.json [--theme 3b1b|flat|theme.json] [--timeline timeline.json] [--outline outline.json] [--complete] [--json]
//   --outline   構成メモ（references/outline.md）と突き合わせる。場面の chapter が構成メモの章にあるか、章ごとの見積もりの長さが尺の目安に合うかを見る
//   --complete  台本を書き終えたものとして見る。場面のない章を誤りにし、全体の長さも構成メモと比べる
// 終了コード: 0 = 誤りなし（警告は出る）、1 = 誤りか配置の問題がある、2 = 使い方の誤りかファイルを読めない
const fs = require("fs");
const { load, theme } = require("./uz_node.cjs");
const { checkAgainstOutline } = require("./outline_check.cjs");
const args = process.argv.slice(2);
const VAL = ["--theme", "--timeline", "--outline"];   // 値を取る引数
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith("--") && !VAL.includes(args[i - 1]));
if (!file) { console.error("使い方: node check_storyboard.cjs storyboard.json [--theme 3b1b] [--timeline timeline.json] [--outline outline.json] [--complete] [--json]"); process.exit(2); }
let outline = null;
if (args.includes("--outline")) {
  try { outline = JSON.parse(fs.readFileSync(opt("--outline") || "", "utf8")); }
  catch (e) { console.error(`構成メモを読めない: ${opt("--outline")}（${e.message}）`); process.exit(2); }
}
(async () => {
  const UZ = load();
  const sb = JSON.parse(fs.readFileSync(file, "utf8"));
  const th = theme(opt("--theme") || "3b1b");
  const tl = opt("--timeline") ? JSON.parse(fs.readFileSync(opt("--timeline"), "utf8")) : null;
  const M = await UZ.build(sb, th, tl);
  const issues = M.errors.length ? [] : UZ.checkLayout(M);
  const out = { file, theme: th.name, errors: M.errors, warnings: M.warnings, layout: issues, duration: M.duration ? +M.duration.toFixed(1) : null };
  if (outline && !M.errors.length) {   // 台本の形に誤りがあるときは突き合わせない（時刻を計算できていない）
    const r = checkAgainstOutline(sb, M, outline, { complete: args.includes("--complete") });
    out.errors = out.errors.concat(r.errors);
    out.warnings = out.warnings.concat(r.warnings);
    out.chapters = r.chapters;
  }
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${file}（テーマ ${th.name}${out.duration ? `、${out.duration} 秒` : ""}）`);
    for (const e of out.errors) console.log("  誤り: " + e);
    for (const l of out.layout) console.log(`  配置（${l.kind}・${l.at}s）: ${l.msg}`);
    for (const w of out.warnings) console.log("  警告: " + w);
    for (const c of out.chapters || []) console.log(`  章 ${c.id}: 見積もり ${c.estimated} 秒（${c.planned == null ? "目安なし" : `目安 ${c.planned} 秒`}）`);
    if (!out.errors.length && !out.layout.length) console.log("  OK");
  }
  process.exit(out.errors.length || out.layout.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
