#!/usr/bin/env bash
# M3 の検査をまとめて回す。M1 の検査に続けて、M3 で足した検査を 1 つずつ並べる
set -u
cd "$(dirname "$0")/../.."
fail=0
bash scripts/tests/run_m1.sh || fail=1
python3 scripts/tests/test_ledger.py >/dev/null 2>&1 || { echo "NG: test_ledger.py"; python3 scripts/tests/test_ledger.py; fail=1; }
[ $fail = 0 ] && echo "M3 の検査: すべて OK" || echo "M3 の検査: NG あり"
exit $fail
