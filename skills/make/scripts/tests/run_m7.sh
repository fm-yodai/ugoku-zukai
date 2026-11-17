#!/usr/bin/env bash
# M7（morph・zoom・pan・draw）の検査をまとめて回す。M7 の検査に続けて、R4 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m7.cjs >/dev/null 2>&1 || { ng "test_m7.cjs"; node scripts/tests/test_m7.cjs; }
# 見本（Morph・カメラ・線の描画）: 構成メモと突き合わせて誤りがなく、コマが書ける
ex=examples/camera-morph.json
ol=examples/outlines/camera-morph.json
node scripts/check_storyboard.cjs $ex --outline $ol --complete >/dev/null 2>&1 || { ng "$ex（check_storyboard --outline --complete）"; node scripts/check_storyboard.cjs $ex --outline $ol --complete; }
python3 scripts/check_outline.py $ol --ready >/dev/null 2>&1 || { ng "$ol（check_outline --ready）"; python3 scripts/check_outline.py $ol --ready; }
python3 scripts/check_text.py $ex >/dev/null 2>&1 || { ng "$ex（check_text）"; python3 scripts/check_text.py $ex; }
fd=$(mktemp -d)
node scripts/frames.cjs $ex -o "$fd" >/dev/null 2>&1; code=$?
{ [ $code = 0 ] || [ $code = 4 ]; } && [ -f "$fd/svg/slide-arch-v3.svg" ] || ng "$ex のコマが書けない（frames.cjs の終了コード $code）"
# zoom の行（l13）のコマは寄った絵（body の clip が付く）、zoom: all で戻った行（l14）と完成形のコマはカメラなし
grep -q 'clip-path="url(#uz-body-' "$fd/svg/l13.svg" 2>/dev/null || ng "$ex の l13（zoom）のコマが寄っていない"
for f in l14 slide-arch-v3; do grep -q 'clip-path="url(#uz-body-' "$fd/svg/$f.svg" 2>/dev/null && ng "$ex の $f のコマにカメラが掛かっている"; done
rm -rf "$fd"
# 文書: writer・director・基準・進行役が、Morph・zoom・draw の使いどころを知っている
A=../../agents
c=references/criteria
for id in VG-10 VG-11 VG-12; do grep -q "^## $id " references/visual-grammar.md || ng "visual-grammar.md に $id がない"; done
for w in 'ugoku-zukai/4' '"morph"' '"zoom"' '"pan"' '"draw"'; do grep -qF -- "$w" references/storyboard.md || ng "storyboard.md に $w がない"; done
grep -qF 'ugoku-zukai/3' references/storyboard.md && grep -q '^# 台本の形式（ugoku-zukai/3）' references/storyboard.md && ng "storyboard.md の題が ugoku-zukai/3 のまま"
for id in G-D17 G-D18 G-D19; do
  grep -q "^| $id " $c/structure.md && grep -q "$id" $A/director.md && grep -q "$id" $c/README.md && grep -q "$id" references/run-chat.md || ng "$id が、structure.md・director.md・criteria/README・run-chat にそろっていない"
done
grep -q "morph" $A/writer.md && grep -q "camera-morph.json" $A/writer.md || ng "writer.md に morph と camera-morph.json がない"
grep -q "alts.py" $A/writer.md || ng "writer.md に、Morph と alts.py の組み合わせの注意がない"
grep -q "2 枚並べて" $A/director.md || ng "director.md に、Morph を 2 枚の完成形で見ることがない"
for f in SKILL.md references/run-code.md references/run-chat.md; do grep -q "Morph" $f || ng "$f に Morph がない"; done
bash scripts/tests/run_r4.sh || fail=1
exit $fail
