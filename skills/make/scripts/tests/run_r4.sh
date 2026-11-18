#!/usr/bin/env bash
# R4（スライドを先に作る進め方）の検査をまとめて回す。スライドの検査に続けて、R3 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_slides.cjs >/dev/null 2>&1 || { ng "test_slides.cjs"; node scripts/tests/test_slides.cjs; }
node scripts/tests/test_figures_more.cjs >/dev/null 2>&1 || { ng "test_figures_more.cjs"; node scripts/tests/test_figures_more.cjs; }
node scripts/tests/test_toc.cjs >/dev/null 2>&1 || { ng "test_toc.cjs"; node scripts/tests/test_toc.cjs; }
node scripts/tests/test_fill.cjs >/dev/null 2>&1 || { ng "test_fill.cjs"; node scripts/tests/test_fill.cjs; }
node scripts/tests/test_dark_text.cjs >/dev/null 2>&1 || { ng "test_dark_text.cjs"; node scripts/tests/test_dark_text.cjs; }
node scripts/tests/test_outline_pair.cjs >/dev/null 2>&1 || { ng "test_outline_pair.cjs"; node scripts/tests/test_outline_pair.cjs; }
python3 scripts/tests/test_assets.py >/dev/null 2>&1 || { ng "test_assets.py"; python3 scripts/tests/test_assets.py; }
python3 scripts/tests/test_alts.py >/dev/null 2>&1 || { ng "test_alts.py"; python3 scripts/tests/test_alts.py; }
python3 scripts/tests/test_slide_text.py >/dev/null 2>&1 || { ng "test_slide_text.py"; python3 scripts/tests/test_slide_text.py; }
# 進行役の文書が、意図 → スライド → 原稿の順と、スライドコンテでの案の見比べに合っている
for w in "スライドコンテ" "意図" "alts.py"; do grep -q -- "$w" SKILL.md || ng "SKILL.md に $w がない"; done
for f in references/run-code.md references/run-chat.md; do
  grep -q "alts.py" $f && grep -q -- "--alts" $f || ng "$f に alts.py と --alts がない"
done
grep -q "ugoku-zukai-outline/2" references/outline.md && grep -q "聴衆の側から" references/outline.md || ng "outline.md に ugoku-zukai-outline/2 と「聴衆の側から」がない"
for f in SKILL.md references/run-code.md references/run-chat.md references/outline.md; do
  grep -q "絵コンテ" $f && ng "$f に「絵コンテ」が残っている"
done
# 評価役と基準（第 3 部）: 物差しは意図。前の進め方の言葉（絵コンテ・言うこと・視聴者）を残さない
A=../../agents
c=references/criteria
p=references/review-protocol.md
grep -q "意図" $A/director.md && grep -q "完成形" $A/director.md || ng "director.md に「意図」と「完成形」がない"
grep -q "スライドを説明" $A/writing-reviewer.md || ng "writing-reviewer.md に「スライドを説明」がない"
grep -q "聴衆の側から" $c/outline.md || ng "criteria/outline.md に「聴衆の側から」がない"
grep -q "意図" $c/agreement.md || ng "criteria/agreement.md に「意図」がない"
for f in $A/researcher.md $A/writer.md $A/fact-checker.md $A/writing-reviewer.md $A/director.md $c/*.md $p references/writing/review-format.md; do
  for w in "絵コンテ" "言うこと" "視聴者"; do grep -q "$w" $f && ng "$f に「$w」が残っている"; done
  grep -qE "\bsays\b|\bshows\b" $f && ng "$f に says・shows が残っている"
done
# 意図の 3 段に合わせた基準と、スライドの基準がある
for id in O-D6 O-D7 O-D8 O-D9; do grep -q "^| $id " $c/outline.md || ng "outline.md に $id がない"; done
grep -q "^| A-5 " $c/agreement.md || ng "agreement.md に A-5 がない"
for id in G-D11 G-D12 G-D13 G-D14 G-D15 G-D16; do grep -q "^| $id " $c/structure.md && grep -q "$id" $A/director.md || ng "$id が、structure.md と director.md にそろっていない"; done
grep -q "^| V-6 " $c/screen.md && grep -q "V-6" $A/director.md || ng "V-6（完成形への至り方）が、screen.md と director.md にそろっていない"
for id in S-W12 S-W13; do grep -q "^| $id " $c/script.md && grep -q "$id" $A/writing-reviewer.md && grep -q "$id" $c/README.md || ng "$id が、script.md・writing-reviewer.md・README にそろっていない"; done
grep -q "^| S-F5 " $c/script.md && grep -q "S-F5" $A/fact-checker.md || ng "S-F5（スライドのテキストの事実）が、script.md と fact-checker.md にそろっていない"
grep -q "読み上げ" $c/script.md || ng "script.md に、スライドの文字を読み上げるだけの原稿を止める基準がない"
grep -q "声と字幕" $c/structure.md || ng "structure.md に、声と字幕がなくても読めることの基準がない"
grep -q "どの文に照らしたか" $c/README.md || ng "criteria/README.md に、意図のどの文に照らしたかを書く約束がない"
# 評価役を呼ぶ場面の正は review-protocol.md。criteria/README（担当の基準）と環境ごとの文書はそこを指す
for w in "章の意図が固まったとき" "スライドコンテを見せる前" "スライドが固まった" "合成の前" "直した後"; do
  grep -q "$w" $p || ng "review-protocol.md に、呼ぶ場面「$w」がない"
done
for f in $c/README.md references/run-code.md references/run-chat.md SKILL.md; do grep -q "review-protocol.md" $f || ng "$f が review-protocol.md を指していない"; done
grep -q "評価役を呼ぶ場面" $c/README.md || ng "criteria/README.md が、review-protocol.md の「評価役を呼ぶ場面」を指していない"
grep -q "意図を変えない指摘" $p || ng "review-protocol.md に、先に直すのは意図を変えない指摘だという記述がない"
# 作り手: スライド → 意図 → 原稿の順。調べた事実は取材メモに置く
for w in "statement" "proposed" "案を並べる" "slide-<"; do grep -q -- "$w" $A/writer.md || ng "writer.md に $w がない"; done
grep -q "意図には書かない\|構成メモには書かない" $A/researcher.md || ng "researcher.md に、調べた事実を構成メモに書かない約束がない"
# 再生ページの「直したい箇所を指定する」は、編集できる人にだけ出る
for f in references/run-code.md references/run-chat.md; do
  grep -q "編集できる人" $f && grep -q "チャプター" $f || ng "$f に、「直したい箇所を指定する」が編集できる人にだけ出ることと、チャプターの時刻と章で伝える方法がない"
done
for h in "R4 第 3 部の実装" "R4 第 4 部の実装" "R4 第 5 部の実装"; do grep -q "^### $h" ../../docs/design.md || ng "docs/design.md に「### $h」がない"; done
grep -q "スライドコンテ" ../../CLAUDE.md && grep -q "run_r4.sh" ../../CLAUDE.md || ng "CLAUDE.md に、スライドコンテと run_r4.sh がない"
bash scripts/tests/run_r3.sh || fail=1
[ $fail = 0 ] && echo "R4 の検査: すべて OK" || echo "R4 の検査: NG あり"
exit $fail
