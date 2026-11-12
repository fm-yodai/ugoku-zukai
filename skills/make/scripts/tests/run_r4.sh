#!/usr/bin/env bash
# R4（スライドを先に作る進め方）の検査をまとめて回す。スライドの検査に続けて、R3 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_slides.cjs >/dev/null 2>&1 || { ng "test_slides.cjs"; node scripts/tests/test_slides.cjs; }
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
bash scripts/tests/run_r3.sh || fail=1
[ $fail = 0 ] && echo "R4 の検査: すべて OK" || echo "R4 の検査: NG あり"
exit $fail
