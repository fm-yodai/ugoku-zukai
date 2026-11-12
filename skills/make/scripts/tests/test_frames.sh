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

# 前の回の残り（sheet-*.png・svg/）は消え、ほかのファイルは残る
mkdir -p "$out/a/svg"
echo x >"$out/a/sheet-99.png"; echo x >"$out/a/svg/zz.svg"; echo x >"$out/a/keep.txt"
node scripts/frames.cjs "$sb" --theme koo -o "$out/a" >"$out/a.log" 2>&1
code=$?
[ -f "$out/a/frames.json" ] || { ng "frames.json ができない（終了コード $code）"; cat "$out/a.log"; echo "frames の検査: NG あり"; exit 1; }

[ -e "$out/a/sheet-99.png" ] && ng "前の回の sheet-99.png が残っている"
[ -e "$out/a/svg/zz.svg" ] && ng "前の回の svg/zz.svg が残っている"
[ -f "$out/a/keep.txt" ] || ng "出力先のほかのファイル（keep.txt）まで消えた"

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

# 時刻の決まり: 各行の t は行の終わり（start + dur）以上、次の行の始まり未満。sub_forced と settled がある
node -e '
const fs = require("fs"), path = require("path");
const [sbf, dir] = process.argv.slice(1);
const { load, theme } = require(path.resolve("scripts/uz_node.cjs"));
(async () => {
  const UZ = load();
  const M = await UZ.build(JSON.parse(fs.readFileSync(sbf, "utf8")), theme("koo"), null);
  const fr = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
  const L = M.timeline.lines;
  let bad = 0;
  const ng = m => { console.log("NG: " + m); bad = 1; };
  fr.lines.forEach((f, i) => {
    if (typeof f.sub_forced !== "boolean" || typeof f.settled !== "boolean") ng(`行 ${f.id} に sub_forced か settled がない`);
    const ln = L.find(x => x.id === f.id);
    if (!ln) { ng(`行 ${f.id} が時刻表にない`); return; }
    if (f.t < ln.start + ln.dur - 1e-6) ng(`行 ${f.id} の t=${f.t} が行の終わり ${(ln.start + ln.dur).toFixed(3)} より前`);
    const next = L[L.indexOf(ln) + 1];
    if (next && !(f.t < next.start)) ng(`行 ${f.id} の t=${f.t} が次の行の始まり ${next.start} 以上`);
  });
  process.exit(bad);
})();
' "$sb" "$out/a" || fail=1

png=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).png)' "$out/a/frames.json")
if [ "$png" = "true" ]; then
  [ $code = 0 ] || ng "png: true なのに終了コードが $code"
  node -e '
const b = require("fs").readFileSync(process.argv[1]);
if (b.slice(0, 4).toString("latin1") !== "\x89PNG") { console.log("NG: sheet-01.png が PNG でない"); process.exit(1); }
const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
if (w !== 1280 || h !== 1170) { console.log(`NG: sheet-01.png が ${w}x${h}（1280x1170 のはず）`); process.exit(1); }
' "$out/a/sheet-01.png" || fail=1
else
  echo "（resvg がないので PNG の検査を飛ばした。python3 scripts/setup_render.py で入れる）"
fi

# resvg を読めないとき: 終了コード 4、png: false、SVG はそろう
mkdir -p "$out/empty"
UZ_RENDER_HOME="$out/empty" node scripts/frames.cjs "$sb" --theme koo -o "$out/b" >"$out/b.log" 2>&1
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

# frames.json の行に start がある
node -e '
const fr = JSON.parse(require("fs").readFileSync(process.argv[1] + "/frames.json", "utf8"));
process.exit(fr.lines.every(l => typeof l.start === "number" && l.start <= l.t) ? 0 : 1);
' "$out/a" || ng "frames.json の行に start がない（か t より後）"

# --lines: 行の id から、その行のある場面を選ぶ（直しは行の id で来るため）
ln=$(node -e 'const sb = JSON.parse(require("fs").readFileSync("examples/mixed.json", "utf8")); console.log(sb.scenes[1].lines[0].id)')
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/bylines" --lines "$ln" >/dev/null 2>&1
code=$?
[ $code = 0 ] || [ $code = 4 ] || ng "--lines の終了コードが $code"
node -e '
const fs = require("fs"), sb = JSON.parse(fs.readFileSync("examples/mixed.json", "utf8"));
const got = JSON.parse(fs.readFileSync(process.argv[1] + "/frames.json", "utf8")).lines.map(l => l.id).join(",");
if (got !== sb.scenes[1].lines.map(l => l.id).join(",")) process.exit(1);
' "$out/bylines" 2>/dev/null || ng "--lines の出力が、その行のある場面の行になっていない"
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/nolines" --lines "$ln,l999" >"$out/nolines.log" 2>&1
[ $? = 2 ] && grep -q "l999" "$out/nolines.log" && [ ! -e "$out/nolines" ] || ng "--lines に台本にない行を渡したとき、終了コード 2 で止まらない"
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/both" --lines "$ln" --scenes s1 >/dev/null 2>&1
[ $? = 2 ] || ng "--lines と --scenes を両方渡したとき、終了コード 2 で止まらない"
# --scenes: その場面の行だけを書き、コマの中身は全体のときと同じ
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/all" >/dev/null 2>&1
sc=$(node -e 'const sb = JSON.parse(require("fs").readFileSync("examples/mixed.json", "utf8")); console.log(sb.scenes[1].id)')
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/part" --scenes "$sc" >/dev/null 2>&1
code=$?
[ $code = 0 ] || [ $code = 4 ] || ng "--scenes の終了コードが $code"
node -e '
const fs = require("fs"), [all, part, sc] = process.argv.slice(1);
const a = JSON.parse(fs.readFileSync(all + "/frames.json", "utf8")), p = JSON.parse(fs.readFileSync(part + "/frames.json", "utf8"));
const want = a.lines.filter(l => l.scene === sc).map(l => l.id);
let ok = want.length > 0 && JSON.stringify(p.lines.map(l => l.id)) === JSON.stringify(want);
for (const id of want) ok = ok && fs.readFileSync(all + "/svg/" + id + ".svg", "utf8") === fs.readFileSync(part + "/svg/" + id + ".svg", "utf8");
ok = ok && fs.readdirSync(part + "/svg").length === want.length;
ok = ok && JSON.stringify(p.sheets.flatMap(s => s.lines)) === JSON.stringify(want);
process.exit(ok ? 0 : 1);
' "$out/all" "$out/part" "$sc" 2>/dev/null || ng "--scenes の出力が、その場面の行だけになっていない（か中身が全体と違う）"

# 台本にない場面: 何も書かずに終了コード 2
mkdir -p "$out/none"; echo x >"$out/none/frames.json"
node scripts/frames.cjs examples/mixed.json --theme koo -o "$out/none" --scenes "$sc,s999" >"$out/none.log" 2>&1
[ $? = 2 ] || ng "台本にない場面で終了コード 2 にならない"
grep -q "s999" "$out/none.log" || ng "台本にない場面の id が表示されない"
[ "$(cat "$out/none/frames.json")" = x ] || ng "台本にない場面なのに出力先を書き換えた"

# スライドの完成形のコマ: svg/slide-<id>.svg と frames.json の slides[]。スライドのない台本では slides は空
cat >"$out/slide.json" <<'EOF'
{ "format": "ugoku-zukai/3", "title": "検査",
  "slides": { "p1": { "title": "見出し", "statement": "言いたいことの文。", "parts": [
    { "id": "pts", "type": "list", "items": [{ "id": "a", "text": "一つ目の項目" }, { "id": "b", "text": "二つ目の項目" }], "area": { "col": [1, 6], "row": [1, 6] } },
    { "id": "defs", "type": "text", "blocks": [{ "id": "p", "kind": "para", "text": "段落の**強調**の文。" }], "area": { "col": [7, 12], "row": [1, 6] } } ] },
    "p2": { "title": "別", "parts": [{ "id": "o", "type": "list", "items": [{ "id": "x", "text": "別の話" }] }] } },
  "scenes": [ { "id": "s1", "slide": "p1", "lines": [{ "id": "l1", "text": "一つ目だけ出します。", "do": [{ "show": "a" }] }] },
              { "id": "s2", "slide": "p2", "lines": [{ "id": "l2", "text": "別の話です。", "do": [{ "show": "o" }] }] } ] }
EOF
node scripts/frames.cjs "$out/slide.json" --theme koo -o "$out/sl" >"$out/sl.log" 2>&1
code=$?
[ $code = 0 ] || [ $code = 4 ] || { ng "スライドのある台本で終了コードが $code"; cat "$out/sl.log"; }
node -e '
const fs = require("fs"), [dir, legacy] = process.argv.slice(1);
const fr = JSON.parse(fs.readFileSync(dir + "/frames.json", "utf8"));
let ok = JSON.stringify(fr.slides) === JSON.stringify([{ id: "p1", svg: "svg/slide-p1.svg", scenes: ["s1"] }, { id: "p2", svg: "svg/slide-p2.svg", scenes: ["s2"] }]);
const fin = fs.readFileSync(dir + "/svg/slide-p1.svg", "utf8"), line = fs.readFileSync(dir + "/svg/l1.svg", "utf8");
// 完成形には、行でまだ出していない部品（二つ目の項目・段落）も出ていて、字幕は出ていない
ok = ok && fin.includes("二つ目の項目") && fin.includes("強調") && fin.includes("言いたいことの文。") && !fin.includes("一つ目だけ出します。");
ok = ok && !line.includes("二つ目の項目") && line.includes("一つ目だけ出します。");
ok = ok && JSON.stringify(JSON.parse(fs.readFileSync(legacy + "/frames.json", "utf8")).slides) === "[]";
process.exit(ok ? 0 : 1);
' "$out/sl" "$out/a" 2>/dev/null || ng "スライドの完成形のコマ（svg/slide-<id>.svg と frames.json の slides）が正しくない"
node scripts/frames.cjs "$out/slide.json" --theme koo -o "$out/sl2" --scenes s2 >/dev/null 2>&1
[ -f "$out/sl2/svg/slide-p2.svg" ] && [ ! -e "$out/sl2/svg/slide-p1.svg" ] || ng "--scenes のとき、選んだ場面が使うスライドの完成形だけになっていない"

[ $fail = 0 ] && echo "frames の検査: すべて OK" || echo "frames の検査: NG あり"
exit $fail
