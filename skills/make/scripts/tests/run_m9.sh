#!/usr/bin/env bash
# M9（立体と奥行き）の検査をまとめて回す。M9 の検査に続けて、M8 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m9.cjs >/dev/null 2>&1 || { ng "test_m9.cjs"; node scripts/tests/test_m9.cjs; }
# 見本（回る曲面・起き上がる層・中へ入るズーム）: 構成メモ（テーマ kuro）と突き合わせて誤りも警告もなく、コマが書ける
ex=examples/depth.json
ol=examples/outlines/depth.json
out=$(node scripts/check_storyboard.cjs $ex --theme kuro --outline $ol --complete 2>&1) || { ng "$ex（check_storyboard --outline --complete）"; echo "$out"; }
# 警告は「  警告: …」の行で出る（要約の文言には反応しない）
echo "$out" | grep -q "^ *警告: " && { ng "$ex の検査に警告がある"; echo "$out"; }
grep -q '"theme": "kuro"' $ol || ng "$ol のテーマが kuro でない"
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
bash scripts/tests/run_m8.sh || fail=1
exit $fail
