#!/usr/bin/env bash
# 作り直しの 1 本目（R1）の検査をまとめて回す。M3 の検査に続けて、R1 で足した検査を 1 つずつ並べる
set -u
cd "$(dirname "$0")/../.."
fail=0
bash scripts/tests/run_m3.sh || fail=1
# 構成メモ（outline.json）の形と、台本との突き合わせ
python3 scripts/tests/test_outline.py >/dev/null 2>&1 || { echo "NG: test_outline.py"; python3 scripts/tests/test_outline.py; fail=1; }
[ $fail = 0 ] && echo "R1 の検査: すべて OK" || echo "R1 の検査: NG あり"
exit $fail
