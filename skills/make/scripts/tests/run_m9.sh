#!/usr/bin/env bash
# M9（立体と奥行き）の検査をまとめて回す。M9 の検査に続けて、M8 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m9.cjs >/dev/null 2>&1 || { ng "test_m9.cjs"; node scripts/tests/test_m9.cjs; }
# 見本（回る曲面・中へ入るズーム）: 構成メモ（テーマ kuro）と突き合わせて誤りも警告もなく、コマが書ける
ex=examples/depth.json
ol=examples/outlines/depth.json
out=$(node scripts/check_storyboard.cjs $ex --theme kuro --outline $ol --complete 2>&1) || { ng "$ex（check_storyboard --outline --complete）"; echo "$out"; }
# 警告は「  警告: …」の行で出る（要約の文言には反応しない）
echo "$out" | grep -q "^ *警告: " && { ng "$ex の検査に警告がある"; echo "$out"; }
grep -q '"theme": "kuro"' $ol || ng "$ol のテーマが kuro でない"
# 板（plate）は保留中なので、見本には置かない
grep -q '"plate"' $ex && ng "$ex に保留中の板（plate）がある"
python3 scripts/check_outline.py $ol --ready >/dev/null 2>&1 || { ng "$ol（check_outline --ready）"; python3 scripts/check_outline.py $ol --ready; }
python3 scripts/check_text.py $ex >/dev/null 2>&1 || { ng "$ex（check_text）"; python3 scripts/check_text.py $ex; }
fd=$(mktemp -d)
node scripts/frames.cjs $ex --theme kuro -o "$fd" >/dev/null 2>&1; code=$?
{ [ $code = 0 ] || [ $code = 4 ]; } || ng "$ex のコマが書けない（frames.cjs の終了コード $code）"
# 完成形のコマに、曲面の面（data-s3="dome" の path）が 100 枚以上ある
n=$(grep -o '<path data-s3="dome"' "$fd/svg/slide-tangent-plane.svg" 2>/dev/null | wc -l)
[ "$n" -ge 100 ] || ng "$ex の完成形のコマ slide-tangent-plane に曲面の面が 100 枚未満（$n 枚）"
rm -rf "$fd"
grep -q '"depth"' ../../tools/build_gallery.py || ng "見本帳（build_gallery.py）に depth がない"
# 文書: 奥行き（立体・中に入る）は visual-grammar.md の「奥行き」に宣言し、書き方は storyboard.md、geo.space とリファレンス R7 は geometry.md。ほかはそこを指す。
# 層を起こす VG-16（板 plate）は保留中で欠番。storyboard.md には保留中と分かる形だけを残す
A=../../agents
c=references/criteria
vg=references/visual-grammar.md
geo=references/geometry.md
grep -q '^## 奥行き' $vg || ng "visual-grammar.md に「奥行き」の節がない"
for id in VG-15 VG-17; do grep -q "^### $id " $vg || ng "visual-grammar.md に $id がない"; done
grep -q '^### VG-16（欠番）' $vg || ng "visual-grammar.md の VG-16 が欠番になっていない"
grep -q '^- 奥行き: .*VG-16 層を起こす' $vg && ng "visual-grammar.md の目次に VG-16 層を起こすが残っている"
# VG-15〜17 は概念の宣言で、規則の言い回しを使わない
sed -n '/^## 奥行き/,$p' $vg | grep -qE 'しなければならない|必ず' && ng "visual-grammar.md の「奥行き」に「しなければならない」「必ず」がある"
grep -q 'depth.json' $vg || ng "visual-grammar.md の「奥行き」が見本 depth.json を指していない"
grep -q '^# 台本の形式（ugoku-zukai/6）' references/storyboard.md || ng "storyboard.md の題が ugoku-zukai/6 でない"
for w in '"format": "ugoku-zukai/6"' '"type": "space"' '"kind": "plate"' '"inside"' '"bounds"' '**板（`plate`。保留中）**' 'writer は使わない'; do grep -qF -- "$w" references/storyboard.md || ng "storyboard.md に $w がない"; done
grep -q 'geo\.space' $geo || ng "geometry.md に geo.space がない"
grep -q '^### R7 ' $geo || ng "geometry.md にリファレンス R7 がない"
for f in $A/writer.md SKILL.md references/run-chat.md references/run-code.md; do
  for w in VG-15 VG-17 depth.json; do grep -q "$w" $f || ng "$f が $w を指していない"; done
done
# 保留中の VG-16（層を起こす・板）を、見せ方として指す文書が残っていない
for f in $A/writer.md $A/director.md SKILL.md references/run-chat.md references/run-code.md $c/structure.md references/geometry.md; do
  grep -qE 'VG-16|層を起こす|\bplate\b' $f && ng "$f が保留中の VG-16（層を起こす・板 plate）を指している"
done
grep -q 'VG-1〜VG-17' $A/director.md || ng "director.md の読む文書に VG-1〜VG-17 がない"
grep -q "^| G-D22 " $c/structure.md && grep -q "G-D22" $A/director.md && grep -q "G-D22" $c/README.md || ng "G-D22 が、structure.md・director.md・criteria/README にそろっていない"
grep -q 'M9' $c/structure.md && ng "structure.md に内部の語「M9」が残っている"
bash scripts/tests/run_m8.sh || fail=1
exit $fail
