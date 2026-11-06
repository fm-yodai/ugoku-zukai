#!/usr/bin/env node
// 台本の各行の「落ち着いたコマ」を SVG に書き、6 コマずつ並べたシートを PNG にする（評価役が画面を見るため）
// 使い方: node frames.cjs <storyboard.json> --theme <名前|パス> -o <出力先> [--timeline timeline.json]
// 書くもの: <出力先>/svg/<行 id>.svg、<出力先>/sheet-NN.png、<出力先>/frames.json
// 終了コード: 0 = PNG まで書けた、1 = 台本の誤り、2 = 使い方の誤り、4 = resvg を読めず SVG と frames.json だけ書いた
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os"), cp = require("child_process");
const { load, theme, PLAYER } = require("./uz_node.cjs");
const { makeDocument, serialize } = require("./svg_dom.cjs");

const args = process.argv.slice(2);
const VAL = ["--theme", "--timeline", "-o"];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith("-") && !VAL.includes(args[i - 1]));
const outDir = opt("-o");
if (!file || !outDir) { console.error("使い方: node frames.cjs <storyboard.json> --theme <名前|パス> -o <出力先> [--timeline timeline.json]"); process.exit(2); }

const W = 1280, H = 720, CW = 640, CH = 360, COLS = 2, ROWS = 3, PER = COLS * ROWS;
const BAND = 30;   // シートのコマの上に重ねる帯の高さ（シートの座標）

function renderHome() {
  if (process.env.UZ_RENDER_HOME) return process.env.UZ_RENDER_HOME;
  if (process.env.CLAUDE_PLUGIN_DATA) return path.join(process.env.CLAUDE_PLUGIN_DATA, "render");
  return path.join(os.homedir(), ".cache", "ugoku-zukai", "render");
}
function loadResvg() {
  try { return require(path.join(renderHome(), "node_modules", "@resvg", "resvg-js")).Resvg; } catch (e) { return null; }
}
// 日本語を描ける字体: Noto Sans CJK JP、なければ IPAGothic。fc-list がなければ両方を候補にする
function jpFonts() {
  const has = fam => {
    try { return cp.execFileSync("fc-list", [`:family=${fam}`, "family"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== ""; }
    catch (e) { return null; }
  };
  const noto = has("Noto Sans CJK JP");
  if (noto === null) return ["Noto Sans CJK JP", "IPAGothic"];
  if (noto) return ["Noto Sans CJK JP"];
  if (has("IPAGothic")) return ["IPAGothic"];
  return ["Noto Sans CJK JP", "IPAGothic"];
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

(async () => {
  const UZ = load();
  globalThis.document = makeDocument();
  vm.runInThisContext(fs.readFileSync(path.join(PLAYER, "src", "view_svg.js"), "utf8"), { filename: "view_svg.js" });
  const sb = JSON.parse(fs.readFileSync(file, "utf8"));
  const th = theme(opt("--theme") || "3b1b");
  const tl = opt("--timeline") ? JSON.parse(fs.readFileSync(opt("--timeline"), "utf8")) : null;
  const M = await UZ.build(sb, th, tl);
  if (M.errors && M.errors.length) {
    for (const e of M.errors) console.error("誤り: " + e);
    process.exit(1);
  }

  // コマには必ずその行の字幕を出す（動きが行の声より長いと、frame() では字幕が消えている時刻になるため）
  const frameOrig = UZ.frame;
  let forceSub = null;
  UZ.frame = (m, t) => { const fr = frameOrig(m, t); if (forceSub) fr.sub = { ...forceSub, opacity: 1 }; return fr; };

  const textOf = {};
  for (const sc of sb.scenes) for (const ln of sc.lines) textOf[ln.id] = UZ.parseText(ln.text).text;
  const sceneStart = Object.fromEntries(M.scenes.map(s => [s.id, s.start]));
  const L = M.timeline.lines;
  fs.mkdirSync(path.join(outDir, "svg"), { recursive: true });
  const frames = [], inner = [];
  L.forEach((ln, i) => {
    const actsEnd = Math.max(-Infinity, ...M.acts.filter(a => a.line === ln.id).map(a => a.end));
    let t = Math.max(ln.start + ln.dur, actsEnd) + 0.05;
    const next = L[i + 1];
    // 次の行の字幕（start - 0.05 から出る）と、次の場面への切り替え（場面の start から）より手前で止める
    if (next) t = Math.min(t, next.start - 0.06);
    if (next && next.scene !== ln.scene && sceneStart[next.scene] != null) t = Math.min(t, sceneStart[next.scene] - 0.01);
    t = Math.min(t, M.endCard - 0.01);
    t = Math.max(t, ln.start);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    forceSub = { id: ln.id, text: textOf[ln.id] };
    new UZ.View(svg, M).render(t);
    forceSub = null;
    const rel = `svg/${ln.id}.svg`;
    fs.writeFileSync(path.join(outDir, rel), serialize(svg, { xmlns: "http://www.w3.org/2000/svg", width: W, height: H }));
    inner.push(svg.childNodes.map(c => serialize(c)).join(""));
    frames.push({ id: ln.id, scene: ln.scene, t: +t.toFixed(3), text: textOf[ln.id], svg: rel });
  });

  // シート: 6 コマずつ、入れ子の <svg>（はみ出しを切る）を <g transform> で並べ、帯を重ねる
  const fonts = jpFonts();
  const famList = fonts.map(f => `"${f}"`).join(", ");
  const sheets = [];
  for (let s = 0; s * PER < frames.length; s++) {
    const group = frames.slice(s * PER, (s + 1) * PER);
    let body = `<rect width="${CW * COLS}" height="${CH * ROWS}" fill="#ffffff"/>`;
    group.forEach((f, k) => {
      const x = (k % COLS) * CW, y = Math.floor(k / COLS) * CH, idx = s * PER + k;
      const label = `${f.id}  ${[...f.text].slice(0, 20).join("")}`;
      body += `<g transform="translate(${x},${y})"><svg width="${CW}" height="${CH}" viewBox="0 0 ${W} ${H}">${inner[idx]}</svg>` +
        `<rect width="${CW}" height="${BAND}" fill="#000000" fill-opacity="0.72"/>` +
        `<text x="10" y="${BAND / 2}" font-size="16" font-family="${esc(famList)}" font-weight="700" fill="#ffffff" dominant-baseline="central">${esc(label)}</text>` +
        `<rect x="0.5" y="0.5" width="${CW - 1}" height="${CH - 1}" fill="none" stroke="#888888"/></g>`;
    });
    // テーマの字体（Web フォントなど）は入っていないことが多いので、日本語の字体を最後の候補に足す
    body = body.replace(/font-family="([^"]*)"/g, (m0, v) => `font-family="${v}, ${esc(famList)}"`);
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW * COLS}" height="${CH * ROWS}">${body}</svg>`;
    sheets.push({ file: `sheet-${String(s + 1).padStart(2, "0")}.png`, lines: group.map(f => f.id), svg: svgStr });
  }

  const Resvg = loadResvg();
  const writeJson = png => fs.writeFileSync(path.join(outDir, "frames.json"),
    JSON.stringify({ png, sheets: sheets.map(({ file: f, lines }) => ({ file: f, lines })), lines: frames }, null, 2) + "\n");
  if (!Resvg) {
    writeJson(false);
    console.error(`resvg を読めない（置き場 ${renderHome()}）。PNG は作らず SVG と frames.json だけ書いた。python3 setup_render.py を実行する`);
    process.exit(4);
  }
  try {
    for (const sh of sheets) {
      const r = new Resvg(sh.svg, { font: { loadSystemFonts: true, defaultFontFamily: fonts[0], sansSerifFamily: fonts[0] }, background: "#ffffff" });
      fs.writeFileSync(path.join(outDir, sh.file), r.render().asPng());
    }
  } catch (e) {
    writeJson(false);
    console.error(`PNG にできなかった（${e.message}）。SVG と frames.json だけ書いた。python3 setup_render.py を実行し直す`);
    process.exit(4);
  }
  writeJson(true);
  console.log(`${frames.length} コマ、シート ${sheets.length} 枚 → ${outDir}`);
})().catch(e => { console.error(e); process.exit(2); });
