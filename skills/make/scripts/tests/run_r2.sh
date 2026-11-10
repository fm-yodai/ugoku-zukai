#!/usr/bin/env bash
# 作り直しの 2 本目（R2）の検査をまとめて回す。R1 の検査に続けて、指摘の一覧・成功基準・作り手と評価役の定義・進行役の文書を検査する
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
bash scripts/tests/run_r1.sh || fail=1
# 指摘の一覧（ledger.py）
python3 scripts/tests/test_ledger.py >/dev/null 2>&1 || { ng "test_ledger.py"; python3 scripts/tests/test_ledger.py; }
# 評価役の出力の形
f=references/writing/review-format.md
for w in '"level"' '"where"' '"rechecks"' '"target"' 'nits' 'combined'; do grep -q -- "$w" $f || ng "review-format.md に $w がない"; done
grep -qE 'responses\.json|rebutted|disputed|"severity"|"line_id"' $f && ng "review-format.md に古い形（応答ファイル・severity・line_id）が残っている"
[ $fail = 0 ] && echo "R2 の検査: すべて OK" || echo "R2 の検査: NG あり"
exit $fail
