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
for id in O-M1 O-F1 O-F2 O-D1 O-D2 O-D3 O-D4 O-D5 O-D6 O-D7 O-D8 O-D9; do grep -q "^| $id " $c/outline.md || ng "outline.md に $id がない"; done
# O-F3（意図に出どころを求めていた基準）は R4 第 3 部で欠番にした。表には残さず、欠番の一覧に移り先を書く
grep -q "^| O-F3 " $c/outline.md && ng "outline.md に O-F3 が残っている"
grep -q "^| O-F3 " $c/README.md || ng "criteria/README.md の欠番の一覧に O-F3 がない"
for id in A-M1 A-1 A-2 A-3 A-4 A-5; do grep -q "^| $id " $c/agreement.md || ng "agreement.md に $id がない"; done
for id in S-M1 S-W1 S-W5 S-W10 S-W12 S-W13 S-F1 S-F2 S-F4 S-F5 S-D1 S-D2 S-D4; do grep -q "^| $id " $c/script.md || ng "script.md に $id がない"; done
for id in S-F3 S-D3; do grep -q "^| $id " $c/script.md && ng "script.md に $id が残っている"; done
for id in G-D1 G-D2 G-D8 G-D11 G-D12; do grep -q "^| $id " $c/structure.md || ng "structure.md に $id がない"; done
for id in V-1 V-5 V-6; do grep -q "^| $id " $c/screen.md || ng "screen.md に $id がない"; done
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
for w in "outline.json" "chapter" "tone" "knows" "機械検査の差し戻し" "意図" "完成形"; do grep -q "$w" $A/writer.md || ng "writer.md に $w がない"; done
for id in O-F1 O-F2 S-F1 S-F2 S-F4 S-F5; do grep -q "$id" $A/fact-checker.md || ng "fact-checker.md に $id がない"; done
for id in O-D1 O-D5 O-D6 O-D8 A-1 A-4 A-5 S-D1 G-D1 G-D12 V-1 V-6; do grep -q "$id" $A/director.md || ng "director.md に $id がない"; done
for id in S-W1 S-W10 S-W12 S-W13 S-W8 S-W9; do grep -q "$id" $A/writing-reviewer.md || ng "writing-reviewer.md に $id がない"; done
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
grep -qE '^  version: "[0-9]+\.[0-9]+\.[0-9]+"' $s || ng "SKILL.md に version がない"
grep -nE "contract|契約|budget\.parts|interview" references/structures.md && ng "structures.md に契約の語が残っている"
grep -q "引き出し" references/structures.md || ng "structures.md が型を引き出しとして位置づけていない"
# 環境ごとの文書（道具ごとのコマンド。フェーズごとの手順は置かない）
for f in references/run-code.md references/run-chat.md; do
  for h in "パスの書き方" "作業フォルダ" "構成メモ" "調べる" "台本と機械検査" "スライドコンテと粗い再生ページ" "評価役と指摘の一覧" "声" "組み立てと公開" "報告"; do
    grep -q "^## $h" $f || ng "$f に「## $h」がない"
  done
  grep -qE "^## [0-9] " $f && ng "$f に番号の付いたフェーズが残っている"
  for w in "check_outline.py" "--ready" "--outline" "--complete" "--scenes" "build_sheet.py" "ledger.py ingest" "ledger.py list" "ledger.py decide" "ledger.py residual" "--by lead" "回し直す" "frames-part"; do
    grep -q -- "$w" $f || ng "$f に $w がない"
  done
  grep -nE "contract|interview\.md|check_contract|max-rounds|STOP_|ledger.py (respond|reset)|responses\.json|loop-protocol|人の確認" $f && ng "$f に古い進め方の語が残っている"
done
grep -q "combined.json" references/run-chat.md || ng "run-chat.md に combined.json がない"
grep -q "^## サンドボックスの約束" references/run-chat.md && grep -q "^## 評価役の番の宣言" references/run-chat.md || ng "run-chat.md にサンドボックスの約束か評価役の番の宣言がない"
for a in researcher writer fact-checker director writing-reviewer; do grep -q "ugoku-zukai:$a" references/run-code.md || ng "run-code.md に ugoku-zukai:$a がない"; done
# 契約と周回の名残りがない（docs/design.md は経緯の記録なので見ない。animator は保留中で触らない）
[ -f scripts/check_contract.py ] && ng "check_contract.py が残っている"
[ -d scripts/tests/contracts ] && ng "tests/contracts が残っている"
old=$(grep -rnE "check_contract|contract\.json|interview\.md|loop-protocol|responses\.json|max-rounds|STOP_MAX|disputed" \
  SKILL.md references scripts assets ../../agents ../../CLAUDE.md ../../README.md \
  --include="*.md" --include="*.py" --include="*.cjs" --include="*.sh" --include="*.json" \
  | grep -v "/animator\.md:" | grep -v "scripts/tests/")
[ -z "$old" ] || { ng "契約と周回の名残りがある"; echo "$old"; }
grep -qE "interview\.md|contract\.json" scripts/workdir.py && ng "workdir.py の一覧に interview.md・contract.json が残っている"
for w in "outline.json" "check_outline.py" "ledger.py" "review-protocol.md" "run_r2.sh"; do grep -q "$w" ../../CLAUDE.md || ng "CLAUDE.md に $w がない"; done
grep -q "インタビュー → " ../../CLAUDE.md && ng "CLAUDE.md の流れが古いまま"
grep -q "R2" ../../docs/design.md || ng "docs/design.md に R2 の記述がない"
# 絵コンテまでの通し（2026-11-10）で、初めて読んだ人が迷った箇所
grep -q "まだ決めていないこと" SKILL.md || ng "SKILL.md に、まだ決めていないこと（open）を見せる記述がない"
for f in SKILL.md references/review-protocol.md references/run-chat.md references/run-code.md; do
  grep -q "任されているときは" $f || ng "$f に、任されているときの構成メモの指摘の扱いがない"
done
grep -q "開き直" references/run-chat.md || ng "run-chat.md に、評価役が資料を開き直す記述がない"
grep -q "利用者が渡した" references/criteria/outline.md || ng "criteria/outline.md の O-F2 に「資料のある題材」の意味がない"
grep -q "調べて決めた" references/outline.md || ng "outline.md に by: source と state: proposed の組み合わせの説明がない"
grep -q "再確認だけ" references/writing/review-format.md || ng "review-format.md に、再確認だけの回の checks の書き方がない"
grep -q "落ち着いたコマには残らない" references/criteria/screen.md || ng "screen.md に pulse がコマに残らない注意がない"
grep -q "preview.html" scripts/workdir.py || ng "workdir.py の一覧に preview.html がない"
old=$(grep -rnE "計画モード|画面モード|構造モード|契約モード|台本モード|docs/design\.md" references SKILL.md)
[ -z "$old" ] || { ng "references に古いモードの名前か、スキルの外の文書への参照がある"; echo "$old"; }
grep -rn 'CLAUDE_PLUGIN_ROOT' references | grep -v "references/run-code.md:" && ng "run-code.md のほかに \${CLAUDE_PLUGIN_ROOT} がある（チャットにはこの変数がない）"
c=$(awk '/^## スライドコンテと粗い再生ページ/{on=1} on && /setup_render.py/ && !a{a=NR} on && /frames.cjs .*-o/ && !b{b=NR} END{print (a && b && a < b) ? "ok" : "ng"}' references/run-chat.md)
[ "$c" = ok ] || ng "run-chat.md のスライドコンテの節で、setup_render.py が frames.cjs より後にある"
# 最終レビュー（2026-11-10）の指摘
# エージェントの本文に書いたスクリプトのコマンドが、tools: で許されている
for f in researcher writer fact-checker writing-reviewer director; do
  for sc in $(awk 'n>=2{print} /^---$/{n++}' $A/$f.md | grep -oE 'scripts/[a-z_]+\.(py|cjs)' | sort -u); do
    grep '^tools:' $A/$f.md | grep -q "/$sc " || ng "agents/$f.md の本文の $sc が tools: にない"
  done
done
# 利用者が言っていない事実は、利用者の章でも S-F4 で見る
grep "^| S-F4 " references/criteria/script.md | grep -q "言い換え" || ng "script.md の S-F4 が、利用者の意図に書かれた内容を言い換えた行だけを除く形になっていない"
grep "^| A-2 " references/criteria/agreement.md | grep -q "S-F4" || ng "agreement.md の A-2 が、事実を述べる具体例を S-F4 に回していない"
grep -q "言い換え" $A/fact-checker.md || ng "fact-checker.md が、利用者の意図に書かれた内容を言い換えた行だけを除く形になっていない"
# 先に直す範囲（最初のスライドコンテの前の評価と、原稿の初稿の評価。読みは別に 1 回）が、文書の間でそろっている
for f in SKILL.md references/run-chat.md references/run-code.md references/review-protocol.md; do
  grep -q "最初のスライドコンテ" $f || ng "$f に、最初のスライドコンテの指摘も先に直す対象だという記述がない"
  grep -q "原稿の初稿" $f || ng "$f に、原稿の初稿の指摘も先に直す対象だという記述がない"
done
grep -q "読みの一覧" SKILL.md && grep -q "同じ場所・同じ基準" references/writing/review-format.md || ng "SKILL.md の読みの扱いか、review-format.md の同じキーの扱いがない"
grep -q "設計書から広げた判断" ../../docs/design.md || ng "docs/design.md に、設計書から広げた判断の記録がない"
[ $fail = 0 ] && echo "R2 の検査: すべて OK" || echo "R2 の検査: NG あり"
exit $fail
