#!/usr/bin/env bash
# R4（スライドを先に作る進め方）の検査をまとめて回す。スライドの検査に続けて、R3 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_slides.cjs >/dev/null 2>&1 || { ng "test_slides.cjs"; node scripts/tests/test_slides.cjs; }
bash scripts/tests/run_r3.sh || fail=1
[ $fail = 0 ] && echo "R4 の検査: すべて OK" || echo "R4 の検査: NG あり"
exit $fail
