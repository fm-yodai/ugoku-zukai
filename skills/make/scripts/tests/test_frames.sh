#!/bin/sh
# 各行の落ち着いたコマ（frames.cjs）の検査。sh で動かす
# resvg（setup_render.py で入れる）がない環境では PNG の検査を飛ばし、そう表示する
set -u
cd "$(dirname "$0")/../.." || exit 2
fail=0
ng() { echo "NG: $1"; fail=1; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
sb=examples/sequence.json

node scripts/frames.cjs "$sb" --theme flat -o "$out/a" >"$out/a.log" 2>&1
code=$?
[ -f "$out/a/frames.json" ] || { ng "frames.json ができない（終了コード $code）"; cat "$out/a.log"; echo "frames の検査: NG あり"; exit 1; }

# 行の件数・SVG の有無・字幕の文
node -e '
const fs = require("fs"), path = require("path");
const [sbf, dir] = process.argv.slice(1);
const sb = JSON.parse(fs.readFileSync(sbf, "utf8"));
const fr = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
const lines = sb.scenes.flatMap(s => s.lines);
let bad = 0;
const ng = m => { console.log("NG: " + m); bad = 1; };
if (fr.lines.length !== lines.length) ng(`lines の件数 ${fr.lines.length} が台本の行数 ${lines.length} と違う`);
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "\x27").replace(/&amp;/g, "&");
for (const ln of lines) {
  const f = fr.lines.find(x => x.id === ln.id);
  if (!f) { ng(`行 ${ln.id} が frames.json にない`); continue; }
  const p = path.join(dir, f.svg);
  if (!fs.existsSync(p)) { ng(`行 ${ln.id} の SVG ${f.svg} がない`); continue; }
  const svg = fs.readFileSync(p, "utf8");
  const text = unesc((svg.match(/>[^<]+</g) || []).map(s => s.slice(1, -1)).join(""));
  const head = ln.text.replace(/\{[^}]*\}/g, "").slice(0, 10);
  if (!text.includes(head)) ng(`行 ${ln.id} の SVG に字幕「${head}」がない`);
}
process.exit(bad);
' "$sb" "$out/a" || fail=1

png=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).png)' "$out/a/frames.json")
if [ "$png" = "true" ]; then
  [ $code = 0 ] || ng "png: true なのに終了コードが $code"
  node -e '
const b = require("fs").readFileSync(process.argv[1]);
if (b.slice(0, 4).toString("latin1") !== "\x89PNG") { console.log("NG: sheet-01.png が PNG でない"); process.exit(1); }
const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
if (w !== 1280 || h !== 1080) { console.log(`NG: sheet-01.png が ${w}x${h}（1280x1080 のはず）`); process.exit(1); }
' "$out/a/sheet-01.png" || fail=1
else
  echo "（resvg がないので PNG の検査を飛ばした。python3 scripts/setup_render.py で入れる）"
fi

# resvg を読めないとき: 終了コード 4、png: false、SVG はそろう
mkdir -p "$out/empty"
UZ_RENDER_HOME="$out/empty" node scripts/frames.cjs "$sb" --theme flat -o "$out/b" >"$out/b.log" 2>&1
code=$?
[ $code = 4 ] || ng "resvg がないのに終了コードが $code（4 のはず）"
grep -q "setup_render.py" "$out/b.log" || ng "resvg がないときに setup_render.py の案内が出ない"
if [ -f "$out/b/frames.json" ]; then
  node -e '
const fs = require("fs"), path = require("path"), dir = process.argv[1];
const fr = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
if (fr.png !== false) { console.log("NG: resvg がないのに png が false でない"); process.exit(1); }
const miss = fr.lines.filter(l => !fs.existsSync(path.join(dir, l.svg)));
if (miss.length || !fr.lines.length) { console.log("NG: resvg がないときに SVG がそろわない"); process.exit(1); }
' "$out/b" || fail=1
else
  ng "resvg がないときに frames.json ができない"
fi

[ $fail = 0 ] && echo "frames の検査: すべて OK" || echo "frames の検査: NG あり"
exit $fail
