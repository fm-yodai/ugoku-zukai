#!/usr/bin/env bash
# 作り直しの 1 本目（R1）の検査をまとめて回す。M3 の検査に続けて、R1 で足した検査を 1 つずつ並べる
set -u
cd "$(dirname "$0")/../.."
fail=0
bash scripts/tests/run_m3.sh || fail=1
# 構成メモ（outline.json）の形と、台本との突き合わせ
python3 scripts/tests/test_outline.py >/dev/null 2>&1 || { echo "NG: test_outline.py"; python3 scripts/tests/test_outline.py; fail=1; }
# 利用者向けの絵コンテのページ
python3 scripts/tests/test_build_sheet.py >/dev/null 2>&1 || { echo "NG: test_build_sheet.py"; python3 scripts/tests/test_build_sheet.py; fail=1; }
# 新しい道具の説明が文書にあり、書いてあるスクリプトが実在する
for s in check_outline.py build_sheet.py outline_check.cjs; do
  [ -f "scripts/$s" ] || { echo "NG: scripts/$s がない"; fail=1; }
done
grep -q "check_outline.py" ../../CLAUDE.md && grep -q "build_sheet.py" ../../CLAUDE.md || { echo "NG: CLAUDE.md に新しい道具のコマンドがない"; fail=1; }
grep -q -- "--scenes" ../../CLAUDE.md && grep -q -- "--outline" ../../CLAUDE.md && grep -q "run_r1.sh" ../../CLAUDE.md || { echo "NG: CLAUDE.md に --scenes・--outline・run_r1.sh がない"; fail=1; }
grep -q '"chapter"' references/storyboard.md || { echo "NG: storyboard.md に chapter の説明がない"; fail=1; }
grep -q "outline.json" scripts/workdir.py && grep -q "sheet.html" scripts/workdir.py || { echo "NG: workdir.py の説明に outline.json・sheet.html がない"; fail=1; }
[ -f references/outline.md ] || { echo "NG: references/outline.md がない"; fail=1; }
[ $fail = 0 ] && echo "R1 の検査: すべて OK" || echo "R1 の検査: NG あり"
exit $fail
