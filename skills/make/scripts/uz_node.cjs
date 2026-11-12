// プレーヤーの共通 JS を node に読み込む（ブラウザと同じコードで検査するため）
const fs = require("fs"), path = require("path"), vm = require("vm");
const PLAYER = path.join(__dirname, "..", "player");
const SRC = ["util.js", "figures.js", "figures2.js", "figures3.js", "validate.js", "slides.js", "engine.js", "check.js"];
function load() {
  const ELK = require(path.join(PLAYER, "vendor", "elk.bundled.js"));
  globalThis.UZ = { ELK };
  for (const f of SRC) vm.runInThisContext(fs.readFileSync(path.join(PLAYER, "src", f), "utf8"), { filename: f });
  return globalThis.UZ;
}
function theme(nameOrPath) {
  const p = fs.existsSync(nameOrPath) ? nameOrPath : path.join(PLAYER, "themes", `${nameOrPath}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
// 台本と同じフォルダの構成メモ（outline.json）が見た目を決めていたら（basics.look.theme）、そのテーマを使う。
// --theme で別のテーマを渡したら止める（見本のコマンドの --theme を写して、決めたテーマから外れるのを防ぐ）。
// 返すもの: テーマ。決めたテーマがなければ、渡された名前かパス（なければ koo）。食い違いと読めないテーマは Error（code = "THEME"）
function themeId(p) {   // 同梱のテーマは名前、それ以外は実体のパスで比べる
  const builtin = path.join(PLAYER, "themes", `${p}.json`);
  if (!fs.existsSync(p) && fs.existsSync(builtin)) return `同梱:${p}`;
  if (!fs.existsSync(p)) return null;
  const real = fs.realpathSync(p);
  return path.dirname(real) === fs.realpathSync(path.join(PLAYER, "themes")) ? `同梱:${path.basename(real, ".json")}` : real;
}
function decidedTheme(storyboardPath) {
  const dir = path.dirname(path.resolve(storyboardPath));
  let look;
  try { look = JSON.parse(fs.readFileSync(path.join(dir, "outline.json"), "utf8")).basics.look.theme; } catch (e) { return null; }
  if (typeof look !== "string" || !look.trim()) return null;
  const inDir = path.resolve(dir, look);
  return { value: look, path: fs.existsSync(inDir) ? inDir : look };
}
function pickTheme(storyboardPath, given) {
  const fail = m => { const e = new Error(m); e.code = "THEME"; return e; };
  const dec = decidedTheme(storyboardPath);
  if (!dec) return theme(given || "koo");
  const want = themeId(dec.path);
  if (!want) throw fail(`構成メモの見た目（basics.look.theme = ${dec.value}）のテーマが見つからない。テーマを作るか、構成メモを直す`);
  if (given && themeId(given) !== want) throw fail(`--theme ${given} が、構成メモで決めた見た目（basics.look.theme = ${dec.value}）と違う。--theme を外すか合わせる。見た目を変えるなら、利用者と決めて構成メモを先に直す`);
  return theme(dec.path);
}
module.exports = { load, theme, pickTheme, PLAYER, SRC };
