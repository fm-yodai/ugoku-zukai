#!/usr/bin/env bash
# 作り直しの 3 本目（R3）の検査をまとめて回す。R2 までの検査に続けて、再生ページの位置の表示・作業フォルダの記録と一覧・声の試聴・直しの文書を検査する
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
bash scripts/tests/run_r2.sh || fail=1
for t in test_player_pos test_workdir; do
  python3 scripts/tests/$t.py >/dev/null 2>&1 || { ng "$t.py"; python3 scripts/tests/$t.py; }
done
[ $fail = 0 ] && echo "R3 の検査: すべて OK" || echo "R3 の検査: NG あり"
exit $fail
