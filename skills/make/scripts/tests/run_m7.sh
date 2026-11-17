#!/usr/bin/env bash
# M7（morph・zoom・pan・draw）の検査をまとめて回す。M7 の検査に続けて、R4 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m7.cjs >/dev/null 2>&1 || { ng "test_m7.cjs"; node scripts/tests/test_m7.cjs; }
bash scripts/tests/run_r4.sh || fail=1
exit $fail
