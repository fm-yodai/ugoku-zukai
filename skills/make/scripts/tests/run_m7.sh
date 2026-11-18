#!/usr/bin/env bash
# M7（morph・zoom・pan・draw）の検査をまとめて回す。M7 の検査に続けて、R4 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m7.cjs >/dev/null 2>&1 || { ng "test_m7.cjs"; node scripts/tests/test_m7.cjs; }
node scripts/tests/test_m8.cjs >/dev/null 2>&1 || { ng "test_m8.cjs"; node scripts/tests/test_m8.cjs; }
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
# 文書: Morph・カメラ・線の描画は、「キャンバスの上を動くカメラ」という捉え方として visual-grammar.md の 1 か所に書き、ほかはそこを指す
A=../../agents
c=references/criteria
vg=references/visual-grammar.md
grep -q '^## キャンバスとカメラ' $vg || ng "visual-grammar.md に「キャンバスとカメラ」の節がない"
for id in VG-10 VG-11 VG-12; do grep -q "^### $id " $vg || ng "visual-grammar.md に $id がない"; done
grep -q 'Lichtschlag' $vg || ng "visual-grammar.md の VG-11 に、出どころ（Lichtschlag ら）がない"
for f in $A/writer.md $A/director.md references/storyboard.md SKILL.md references/run-chat.md; do
  grep -q '「キャンバスとカメラ」' $f || ng "$f が visual-grammar.md の「キャンバスとカメラ」を指していない"
done
# 前の、規則として書いた言い回しが残っていない
for w in '同じものが育つなら' '話している 1〜数個に寄せる' '線の形を追わせるときだけ' 'Morph でつなぐかを' '意図に合う所でだけ使う' '静止画なので' '演出の約束' 'その他の VG の約束' '線は一方向にする' '象限は塗り分ける。' '`table` か `list` にする' 'セルの中に箱を並べていない' '1 行 1 つの画面変化にし' '途中で質問を挟まない' '最初に全部読む' '| 呼びどころ |' '直してよいのは次のときだけ'; do
  grep -qF -- "$w" $vg $A/writer.md $A/director.md $c/structure.md references/storyboard.md references/themes.md SKILL.md references/run-code.md references/run-chat.md && ng "前の規則の言い回し「$w」が残っている"
done
for w in 'ugoku-zukai/4' '"morph"' '"zoom"' '"pan"' '"draw"'; do grep -qF -- "$w" references/storyboard.md || ng "storyboard.md に $w がない"; done
grep -q '^# 台本の形式（ugoku-zukai/3）' references/storyboard.md && ng "storyboard.md の題が ugoku-zukai/3 のまま"
for id in G-D17 G-D18 G-D19; do
  grep -q "^| $id " $c/structure.md && grep -q "$id" $A/director.md && grep -q "$id" $c/README.md || ng "$id が、structure.md・director.md・criteria/README にそろっていない"
done
grep -q 'M7' $c/structure.md && ng "structure.md に内部の語「M7」が残っている"
grep -q "morph" $A/writer.md && grep -q "camera-morph.json" $A/writer.md || ng "writer.md に morph と camera-morph.json がない"
grep -q "alts.py" $A/writer.md || ng "writer.md に、Morph と alts.py の組み合わせの注意がない"
grep -q "2 枚並べて" $A/director.md || ng "director.md に、Morph を 2 枚の完成形で見ることがない"
grep -q "切り取られ" $A/director.md || ng "director.md の screen に、zoom の行のコマの注記がない"
grep -q "Morph でつないだスライドは" SKILL.md || ng "SKILL.md の「案を並べる」に、Morph と alts.py の注意がない"
# スライドコンテで動きを再生できるので、進行役の添え書きは「この章を再生」を指す
for f in SKILL.md references/run-code.md references/run-chat.md; do grep -q "この章を再生" $f || ng "$f に「この章を再生」がない"; done
bash scripts/tests/run_r4.sh || fail=1
exit $fail
