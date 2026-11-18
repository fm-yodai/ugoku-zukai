#!/usr/bin/env bash
# M9（立体と奥行き）の検査をまとめて回す。M9 の検査に続けて、M8 までの検査を呼ぶ
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
node scripts/tests/test_m9.cjs >/dev/null 2>&1 || { ng "test_m9.cjs"; node scripts/tests/test_m9.cjs; }
bash scripts/tests/run_m8.sh || fail=1
exit $fail
