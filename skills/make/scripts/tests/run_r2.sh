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
# 成功基準（構成メモ O-・合意との照合 A-・台本 S-・図 G-・画面 V-）
c=references/criteria
[ -f $c/contract.md ] && ng "criteria/contract.md が残っている"
[ -f references/loop-protocol.md ] && ng "loop-protocol.md が残っている"
for id in O-M1 O-F1 O-F2 O-F3 O-D1 O-D2 O-D3 O-D4 O-D5; do grep -q "^| $id " $c/outline.md || ng "outline.md に $id がない"; done
for id in A-M1 A-1 A-2 A-3 A-4; do grep -q "^| $id " $c/agreement.md || ng "agreement.md に $id がない"; done
for id in S-M1 S-W1 S-W5 S-W10 S-F1 S-F2 S-F4 S-D1 S-D2 S-D4; do grep -q "^| $id " $c/script.md || ng "script.md に $id がない"; done
for id in S-F3 S-D3; do grep -q "^| $id " $c/script.md && ng "script.md に $id が残っている"; done
for id in G-D1 G-D2 G-D8; do grep -q "^| $id " $c/structure.md || ng "structure.md に $id がない"; done
for id in V-1 V-5; do grep -q "^| $id " $c/screen.md || ng "screen.md に $id がない"; done
grep -q "start" $c/screen.md || ng "screen.md の frames.json の説明に start がない"
grep -rnE "contract|契約|interview\.md|フェーズ|[0-9] (台本|画面|音声|取材)" $c && ng "criteria/ に契約・フェーズの語が残っている"
for t in outline script screen voice; do grep -q "\`$t\`" $c/README.md || ng "criteria/README.md に target $t がない"; done
grep -q "nits" $c/README.md || ng "criteria/README.md に nits がない"
p=references/review-protocol.md
for h in "評価役の独立" "評価役の約束" "指摘の扱い" "作り手の約束" "チャットでの回し方" "設計の根拠"; do grep -q "^## $h" $p || ng "review-protocol.md に「## $h」がない"; done
grep -q "事実 > 合意 > 構造 > 文章 > 演出" $p || ng "review-protocol.md に衝突したときの順がない"
grep -qE "max-rounds|STOP_|CONTINUE|disputed|ledger.py (respond|reset)" $p && ng "review-protocol.md に周回の記述が残っている"
[ $fail = 0 ] && echo "R2 の検査: すべて OK" || echo "R2 の検査: NG あり"
exit $fail
