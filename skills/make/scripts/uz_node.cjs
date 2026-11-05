// プレーヤーの共通 JS を node に読み込む（ブラウザと同じコードで検査するため）
const fs = require("fs"), path = require("path"), vm = require("vm");
const PLAYER = path.join(__dirname, "..", "player");
const SRC = ["util.js", "figures.js", "validate.js", "engine.js", "check.js"];
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
module.exports = { load, theme, PLAYER, SRC };
