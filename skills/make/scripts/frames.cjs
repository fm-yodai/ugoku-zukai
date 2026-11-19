#!/usr/bin/env node
// 台本の各行の「落ち着いたコマ」を SVG に書き、6 コマずつ並べたシートを PNG にする（評価役が画面を見るため）
// 使い方: node frames.cjs <storyboard.json> --theme <名前|パス> -o <出力先> [--timeline timeline.json] [--scenes s2,s3 | --lines l8,l33]
//   --lines   カンマで区切った行の id。その行のある場面を --scenes で選んだのと同じになる（直しは行の id で来るため）
//   --scenes  カンマで区切った場面の id。その場面の行だけを書く（配置と時刻は台本全体で計算するので、コマの中身は全体のときと同じ）。
//             出力先にある前の回のコマは消えるので、全体のコマを残したいときは出力先を分ける
// 書くもの: <出力先>/svg/<行 id>.svg、台本にスライドがあれば <出力先>/svg/slide-<スライドの id>.svg と <出力先>/slide-<スライドの id>.png
//   （完成形のコマ。frames.json の slides[] に id・svg・png・使う場面）、<出力先>/sheet-NN.png、<出力先>/frames.json（始めに、前の回のこれらだけを消す）
// シート: 1280×1170。1 コマは 640×390（上に 30 の帯「行 id ＋字幕の頭 20 字」、その下に 640×360 のコマ）を 2 列 × 3 行
// frames.json の timed = 時刻の出どころ（voice = --timeline で渡した合成した声の時刻表、estimate = 文字数からの見積もり）
// frames.json の theme = コマを書いたテーマ（同梱のテーマは名前、それ以外は実体の絶対パス。build_sheet.py の再生は、このテーマで流す）
// frames.json の lines[].start = その行の始まりの時刻、t = コマを取った時刻、sub_forced = 再生ではその時刻に字幕が出ていない（または薄い）ので補った、settled = その行の動作がすべて終わっている
// 終了コード: 0 = PNG まで書けた、1 = 台本の誤りか想定外の誤り、2 = 使い方の誤り（--scenes の場面が台本にないときも。何も書かない）、4 = resvg を読めず SVG と frames.json だけ書いた
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os"), cp = require("child_process");
const { load, theme, pickThemeRef, themeRecord, PLAYER, guarded, CUSTOM_TIMEOUT_MS } = require("./uz_node.cjs");
const { makeDocument, serialize } = require("./svg_dom.cjs");
const { loadAssets } = require("./assets.cjs");

const args = process.argv.slice(2);
const VAL = ["--theme", "--timeline", "-o", "--scenes", "--lines"];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith("-") && !VAL.includes(args[i - 1]));
const outDir = opt("-o");
const csv = k => args.includes(k) ? String(opt(k) || "").split(",").map(s => s.trim()).filter(Boolean) : null;
let only = csv("--scenes");
const onlyLines = csv("--lines");
if (!file || !outDir || (only && !only.length) || (onlyLines && !onlyLines.length) || (only && onlyLines)) { console.error("使い方: node frames.cjs <storyboard.json> --theme <名前|パス> -o <出力先> [--timeline timeline.json] [--scenes s2,s3 | --lines l8,l33]"); process.exit(2); }

const W = 1280, H = 720, CW = 640, CH = 360, COLS = 2, ROWS = 3, PER = COLS * ROWS;
const BAND = 30;   // シートのコマの上に置く帯の高さ（シートの座標）。コマには重ねない（章の題を隠さない）
const CELL = BAND + CH;

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
// 1 コマを描くのに掛ける時間の上限（custom の部品の関数が止まらないとき、固まらずに止まる）。custom の関数 1 回の上限の 5 倍
const FRAME_TIMEOUT_MS = CUSTOM_TIMEOUT_MS * 5;
function renderGuarded(view, t, what) {
  try { guarded(() => view.render(t), FRAME_TIMEOUT_MS); }
  catch (e) {
    if (!(e && e.uzTimeout)) throw e;
    console.error(`誤り: ${what}のコマを描くのが ${FRAME_TIMEOUT_MS / 1000} 秒で終わらない。custom の部品の関数が止まらないか重すぎる。check_storyboard.cjs で、どの行のどの部品かを見る`);
    process.exit(1);
  }
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

(async () => {
  const UZ = load();
  globalThis.document = makeDocument();
  vm.runInThisContext(fs.readFileSync(path.join(PLAYER, "src", "view_svg.js"), "utf8"), { filename: "view_svg.js" });
  const raw = fs.readFileSync(file);
  const sbHash = require("crypto").createHash("sha256").update(raw).digest("hex");   // コマを書いたときの台本（build_sheet.py が、台本が変わっていないかを見る）
  const sb = JSON.parse(raw.toString("utf8"));
  let th, thRef;   // 構成メモが見た目を決めていたら、そのテーマ（違うテーマを渡したら、何も書かずに止まる）
  try { thRef = pickThemeRef(file, opt("--theme")); th = theme(thRef); }
  catch (e) { if (e.code !== "THEME") throw e; console.error(e.message); process.exit(2); }
  const tl = opt("--timeline") ? JSON.parse(fs.readFileSync(opt("--timeline"), "utf8")) : null;
  // --lines は、その行のある場面に直す（台本にない行は、出力先に触る前に知らせる）
  if (onlyLines && Array.isArray(sb.scenes)) {
    const sceneOf = {};
    for (const sc of sb.scenes) for (const ln of sc.lines || []) sceneOf[ln.id] = sc.id;
    const unknown = onlyLines.filter(id => !sceneOf[id]);
    if (unknown.length) {
      for (const id of unknown) console.error(`行「${id}」が台本にない`);
      process.exit(2);
    }
    only = [...new Set(onlyLines.map(id => sceneOf[id]))];
  }
  // --scenes の場面が台本にあるかは、出力先に触る前に確かめる
  if (only && Array.isArray(sb.scenes)) {
    const known = new Set(sb.scenes.map(sc => sc.id));
    const unknown = only.filter(id => !known.has(id));
    if (unknown.length) {
      for (const id of unknown) console.error(`場面「${id}」が台本にない`);
      process.exit(2);
    }
  }
  let assets;
  try { assets = loadAssets(file, sb); }
  catch (e) { if (e.code !== "ASSET") throw e; console.error("誤り: " + e.message); process.exit(1); }
  const M = await UZ.build(sb, th, tl, { assets });
  if (M.errors && M.errors.length) {
    for (const e of M.errors) console.error("誤り: " + e);
    process.exit(1);
  }

  // コマには必ずその行の字幕を出す（動きが行の声より長いと、frame() では字幕が消えている時刻になるため）
  const frameOrig = UZ.frame;
  let forceSub = null, forceFrame = null;   // forceFrame = スライドの完成形のコマを描くとき、frame() の代わりに返すコマ
  UZ.frame = (m, t) => { if (forceFrame) return forceFrame; const fr = frameOrig(m, t); if (forceSub) fr.sub = { ...forceSub, opacity: 1 }; return fr; };

  const textOf = {};
  for (const sc of sb.scenes) for (const ln of sc.lines) textOf[ln.id] = UZ.parseText(ln.text).text;
  const sceneStart = Object.fromEntries(M.scenes.map(s => [s.id, s.start]));
  const L = M.timeline.lines;
  // 前の回の残り（行が減ったときの古いシートや SVG）を読まないよう、frames.cjs が書くものだけ消す。ほかのファイルは触らない
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) if (/^(sheet|slide)-.*\.png$/.test(f) || f === "frames.json") fs.rmSync(path.join(outDir, f), { force: true });
    fs.rmSync(path.join(outDir, "svg"), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(outDir, "svg"), { recursive: true });
  const frames = [], inner = [], unsettled = [];
  L.forEach((ln, i) => {
    if (only && !only.includes(ln.scene)) return;   // 時刻は全行から求めるので、書かない行もここまでは回す
    const actsEnd = Math.max(-Infinity, ...M.acts.filter(a => a.line === ln.id).map(a => a.end));
    let t = Math.max(ln.start + ln.dur, actsEnd) + 0.05;
    const next = L[i + 1];
    // 次の行の字幕（start - 0.05 から出る）と、次の場面への切り替え（場面の start から）より手前で止める
    if (next) t = Math.min(t, next.start - 0.06);
    if (next && next.scene !== ln.scene && sceneStart[next.scene] != null) t = Math.min(t, sceneStart[next.scene] - 0.01);
    t = Math.min(t, M.endCard - 0.01);
    t = Math.max(t, ln.start);
    // 再生と同じ frame() でその時刻の字幕と動作を調べる
    const fr0 = frameOrig(M, t);
    const subForced = !(fr0.sub && fr0.sub.id === ln.id && fr0.sub.opacity >= 0.99);
    const settled = actsEnd === -Infinity || actsEnd <= t + 1e-9;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    forceSub = { id: ln.id, text: textOf[ln.id] };
    renderGuarded(new UZ.View(svg, M), t, `行 ${ln.id} `);
    forceSub = null;
    const rel = `svg/${ln.id}.svg`;
    fs.writeFileSync(path.join(outDir, rel), serialize(svg, { xmlns: "http://www.w3.org/2000/svg", width: W, height: H }));
    inner.push(svg.childNodes.map(c => serialize(c)).join(""));
    frames.push({ id: ln.id, scene: ln.scene, start: +ln.start.toFixed(3), t: +t.toFixed(3), text: textOf[ln.id], svg: rel, sub_forced: subForced, settled });
    if (!settled || subForced) unsettled.push({ ln, t, subForced, acts: M.acts.filter(a => a.line === ln.id && a.end > t + 1e-9) });
  });

  // スライドの完成形のコマ（svg/slide-<id>.svg）。--scenes・--lines のときは、選んだ場面が使うスライドだけ。PNG のシートには入れない
  const slides = [];
  for (const sl of Object.values(M.slides || {})) {
    if (only && !sl.scenes.some(id => only.includes(id))) continue;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    forceFrame = UZ.finalFrame(M, sl.id);
    renderGuarded(new UZ.View(svg, M), forceFrame.t, `スライド ${sl.id} の完成形`);
    forceFrame = null;
    const rel = `svg/slide-${sl.id}.svg`, str = serialize(svg, { xmlns: "http://www.w3.org/2000/svg", width: W, height: H });
    fs.writeFileSync(path.join(outDir, rel), str);
    slides.push({ id: sl.id, svg: rel, png: `slide-${sl.id}.png`, scenes: sl.scenes, _svg: str });
  }

  // シート: 6 コマずつ、帯の下に入れ子の <svg>（はみ出しを切る）を置き、<g transform> で並べる
  const fonts = jpFonts();
  const famList = fonts.map(f => `"${f}"`).join(", ");
  const sheets = [];
  for (let s = 0; s * PER < frames.length; s++) {
    const group = frames.slice(s * PER, (s + 1) * PER);
    let body = `<rect width="${CW * COLS}" height="${CELL * ROWS}" fill="#ffffff"/>`;
    group.forEach((f, k) => {
      const x = (k % COLS) * CW, y = Math.floor(k / COLS) * CELL, idx = s * PER + k;
      const label = `${f.id}  ${[...f.text].slice(0, 20).join("")}`;
      body += `<g transform="translate(${x},${y})"><svg y="${BAND}" width="${CW}" height="${CH}" viewBox="0 0 ${W} ${H}">${inner[idx]}</svg>` +
        `<rect width="${CW}" height="${BAND}" fill="#2b2f36"/>` +
        `<text x="10" y="${BAND / 2}" font-size="16" font-family="${esc(famList)}" font-weight="700" fill="#ffffff" dominant-baseline="central">${esc(label)}</text>` +
        `<rect x="0.5" y="0.5" width="${CW - 1}" height="${CELL - 1}" fill="none" stroke="#888888"/></g>`;
    });
    // テーマの字体（Web フォントなど）は入っていないことが多いので、日本語の字体を最後の候補に足す
    body = body.replace(/font-family="([^"]*)"/g, (m0, v) => `font-family="${v}, ${esc(famList)}"`);
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW * COLS}" height="${CELL * ROWS}">${body}</svg>`;
    sheets.push({ file: `sheet-${String(s + 1).padStart(2, "0")}.png`, lines: group.map(f => f.id), svg: svgStr });
  }

  // 行の中で動きが終わらない行（settled: false か sub_forced: true）を、終わりに一覧で出す。終了コードは変えない。
  // settled: false = コマの時刻にまだ動作が続いている（コマは動きの途中）。sub_forced だけ = 声が終わった後に動作が終わる（コマは終わった後で取り、字幕を補った）
  if (unsettled.length) {
    const sec = x => Math.max(0.1, x).toFixed(1);
    const what = a => {
      const v = a.a && a.a[a.verb], sep = a.verb === "trace" || a.verb === "reply" ? "→" : "・";
      const s = Array.isArray(v) ? (v.length > 3 ? v.slice(0, 3).join(sep) + `…ほか ${v.length - 3} 件` : v.join(sep)) : (typeof v === "string" ? v : "");
      return s ? `${a.verb}「${s}」` : a.verb;
    };
    console.error(`行の中で動きが終わらない行が ${unsettled.length} 行ある（声が終わった時点で、画面が完成形に届いていない）:`);
    for (const u of unsettled) {
      let msg;
      if (u.acts.length) msg = u.acts.map(a => `${what(a)}がコマの後もあと ${sec(a.end - u.t)} 秒続く`).join("、") + "（コマは動きの途中）";
      else {
        const end = Math.max(...M.acts.filter(a => a.line === u.ln.id).map(a => a.end));
        msg = `声が終わった後も動きが ${sec(end - (u.ln.start + u.ln.dur))} 秒続く（コマは動きが終わった後で取り、字幕を補った）`;
      }
      console.error(`  ${u.ln.id}（${u.ln.scene}）: ${msg}`);
    }
  }

  const Resvg = loadResvg();
  const writeJson = png => fs.writeFileSync(path.join(outDir, "frames.json"),
    JSON.stringify({ png, timed: tl ? "voice" : "estimate", theme: themeRecord(thRef), storyboard_sha256: sbHash, sheets: sheets.map(({ file: f, lines }) => ({ file: f, lines })), lines: frames,
      slides: slides.map(({ _svg, png: p, ...x }) => (png ? { ...x, png: p } : x)) }, null, 2) + "\n");
  if (!Resvg) {
    writeJson(false);
    console.error(`resvg を読めない（置き場 ${renderHome()}）。PNG は作らず SVG と frames.json だけ書いた。python3 setup_render.py を実行する`);
    process.exit(4);
  }
  try {
    const fontOpt = { loadSystemFonts: true, defaultFontFamily: fonts[0], sansSerifFamily: fonts[0] };
    for (const sh of sheets) {
      const r = new Resvg(sh.svg, { font: fontOpt, background: "#ffffff" });
      fs.writeFileSync(path.join(outDir, sh.file), r.render().asPng());
    }
    // スライドの完成形は 1 枚ずつ PNG にする（進行役や評価役が 1 枚を大きく見るため。シートと同じく、日本語の字体を最後の候補に足す）
    for (const sl of slides) {
      const str = sl._svg.replace(/font-family="([^"]*)"/g, (m0, v) => `font-family="${v}, ${esc(famList)}"`);
      fs.writeFileSync(path.join(outDir, sl.png), new Resvg(str, { font: fontOpt }).render().asPng());
    }
  } catch (e) {
    writeJson(false);
    console.error(`PNG にできなかった（${e.message}）。SVG と frames.json だけ書いた。python3 setup_render.py を実行し直す`);
    process.exit(4);
  }
  writeJson(true);
  console.log(`${frames.length} コマ、シート ${sheets.length} 枚${slides.length ? `、スライドの完成形 ${slides.length} 枚` : ""} → ${outDir}`);
})().catch(e => { console.error(e); process.exit(1); });
