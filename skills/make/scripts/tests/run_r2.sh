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
# 作り手と評価役の定義（animator は保留中で触らない）
A=../../agents
for f in researcher writer fact-checker writing-reviewer director; do
  grep -nE "contract|契約|interview\.md|responses\.json|disputed|周目|周回|loop-protocol|フェーズ" $A/$f.md && ng "agents/$f.md に古い進め方の語が残っている"
  grep -q "review-protocol.md" $A/$f.md || ng "agents/$f.md が review-protocol.md を読まない"
done
for f in fact-checker writing-reviewer director; do
  for w in "level" "nits" "rechecks" "target"; do grep -q "$w" $A/$f.md || ng "agents/$f.md に $w がない"; done
done
grep -q "brief.md" $A/researcher.md || ng "researcher.md が brief.md を書かない"
grep '^tools:' $A/researcher.md | grep -q "check_contract" && ng "researcher の tools: に check_contract.py が残っている"
for w in "outline.json" "chapter" "tone" "knows" "機械検査の差し戻し"; do grep -q "$w" $A/writer.md || ng "writer.md に $w がない"; done
for id in O-F1 O-F2 O-F3 S-F1 S-F2 S-F4; do grep -q "$id" $A/fact-checker.md || ng "fact-checker.md に $id がない"; done
for id in O-D1 O-D5 A-1 A-4 S-D1 G-D1 V-1; do grep -q "$id" $A/director.md || ng "director.md に $id がない"; done
for id in S-W1 S-W10 S-W8 S-W9; do grep -q "$id" $A/writing-reviewer.md || ng "writing-reviewer.md に $id がない"; done
grep -q "読みモード" $A/writing-reviewer.md || ng "writing-reviewer.md に読みモードがない"
# SKILL.md（原則・道具の一覧・必ず守る条件。番号の付いたフェーズは置かない）
s=SKILL.md
for h in "最初に環境を判定する" "会話の進め方" "任せると言われたとき" "必ず守る条件" "道具" "見せるもの" "検査" "指摘の扱い" "声" "組み立てと公開" "報告" "不変条件"; do
  grep -q "^## $h" $s || ng "SKILL.md に「## $h」がない"
done
grep -qE "^### [0-9] " $s && ng "SKILL.md に番号の付いたフェーズが残っている"
for w in "聞く" "案を出す" "調べる" "他の選択肢" "outline.json" "check_outline.py" "build_sheet.py" "--outline" "--complete" "frames.cjs" "ledger.py" "must" "should" "nits" "残論点" "proposed" "TERMS.txt" "review-protocol.md"; do
  grep -q -- "$w" $s || ng "SKILL.md に $w がない"
done
for c in ingest list decide status residual; do grep -q "$c" $s || ng "SKILL.md に ledger.py $c がない"; done
grep -nE "contract|interview\.md|check_contract|max-rounds|STOP_|人の確認|既定は 3 分|loop-protocol" $s && ng "SKILL.md に古い進め方の語が残っている"
grep -q '^  version: "0.3.0"' $s || ng "SKILL.md の version が 0.3.0 でない"
grep -nE "contract|契約|budget\.parts|interview" references/structures.md && ng "structures.md に契約の語が残っている"
grep -q "引き出し" references/structures.md || ng "structures.md が型を引き出しとして位置づけていない"
[ $fail = 0 ] && echo "R2 の検査: すべて OK" || echo "R2 の検査: NG あり"
exit $fail
