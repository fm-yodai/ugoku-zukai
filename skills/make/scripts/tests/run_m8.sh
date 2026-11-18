#!/usr/bin/env bash
# M8（値・数式・座標）の検査をまとめて回す。M8 の検査に続けて、M7 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m8.cjs >/dev/null 2>&1 || { ng "test_m8.cjs"; node scripts/tests/test_m8.cjs; }
# 見本（値・数式・グラフ）: 構成メモ（テーマ kuro）と突き合わせて誤りも警告もなく、コマが書ける
ex=examples/math-geometry.json
ol=examples/outlines/math-geometry.json
out=$(node scripts/check_storyboard.cjs $ex --theme kuro --outline $ol --complete 2>&1) || { ng "$ex（check_storyboard --outline --complete）"; echo "$out"; }
# 警告は「  警告: …」の行で出る（要約の文言には反応しない）
echo "$out" | grep -q "^ *警告: " && { ng "$ex の検査に警告がある"; echo "$out"; }
grep -q '"theme": "kuro"' $ol || ng "$ol のテーマが kuro でない"
python3 scripts/check_outline.py $ol --ready >/dev/null 2>&1 || { ng "$ol（check_outline --ready）"; python3 scripts/check_outline.py $ol --ready; }
python3 scripts/check_text.py $ex >/dev/null 2>&1 || { ng "$ex（check_text）"; python3 scripts/check_text.py $ex; }
fd=$(mktemp -d)
node scripts/frames.cjs $ex --theme kuro -o "$fd" >/dev/null 2>&1; code=$?
{ [ $code = 0 ] || [ $code = 4 ]; } || ng "$ex のコマが書けない（frames.cjs の終了コード $code）"
# 完成形のコマに、custom の部品が描いた数式の字形（MathJax のパス。"M52 289Q…" の形）がある
for s in tangent-slope square-expand growth-rate; do
  grep -Eq '<path d="M-?[0-9.]+ -?[0-9.]+[QLHVCZ]' "$fd/svg/slide-$s.svg" 2>/dev/null || ng "$ex の完成形のコマ slide-$s に数式の字形がない"
done
rm -rf "$fd"
# 文書: 値と数式は visual-grammar.md の「値と数式」に宣言し、道具とリファレンスは geometry.md。ほかはそこを指す
A=../../agents
c=references/criteria
vg=references/visual-grammar.md
geo=references/geometry.md
grep -q '^## 値と数式' $vg || ng "visual-grammar.md に「値と数式」の節がない"
for id in VG-13 VG-14; do grep -q "^### $id " $vg || ng "visual-grammar.md に $id がない"; done
n=$(grep -cE '^### R[1-6] ' $geo 2>/dev/null)
[ "$n" = 6 ] || ng "geometry.md のリファレンスの見出しが 6 つでない（$n）"
for r in 'R1 微分の接線' 'R2 リーマン和' 'R3 単位円と三角関数' 'R4 ベクトルの和' 'R5 損失曲線と勾配を下る点' 'R6 業務の数字の推移'; do
  grep -q "^### $r" $geo || ng "geometry.md に「$r」がない"
done
grep -q 'cssId' $geo && grep -q 'String.raw' $geo || ng "geometry.md に、変形の印（\\cssId）と String.raw の書き方がない"
for f in $A/writer.md $A/director.md references/storyboard.md SKILL.md references/run-chat.md references/run-code.md; do
  grep -q 'geometry.md' $f || ng "$f が geometry.md を指していない"
done
for f in $A/writer.md SKILL.md references/run-chat.md references/run-code.md; do
  grep -q 'VG-13' $f && grep -q 'VG-14' $f || ng "$f が VG-13・VG-14 を指していない"
done
for id in G-D20 G-D21; do
  grep -q "^| $id " $c/structure.md && grep -q "$id" $A/director.md && grep -q "$id" $c/README.md || ng "$id が、structure.md・director.md・criteria/README にそろっていない"
done
grep -q 'M8' $c/structure.md && ng "structure.md に内部の語「M8」が残っている"
for w in 'ugoku-zukai/5' '"values"' '"set"' '"type": "custom"'; do grep -qF -- "$w" references/storyboard.md || ng "storyboard.md に $w がない"; done
grep -q '^# 台本の形式（ugoku-zukai/5）' references/storyboard.md || ng "storyboard.md の題が ugoku-zukai/5 でない"
grep -q 'math-geometry.json' $A/writer.md || ng "writer.md に見本 math-geometry.json がない"
grep -q '^## 数学動画調のテーマ（kuro）' references/themes.md || ng "themes.md に kuro の節がない"
grep -q '"math-geometry"' ../../tools/build_gallery.py || ng "見本帳（build_gallery.py）に math-geometry がない"
bash scripts/tests/run_m7.sh || fail=1
exit $fail
