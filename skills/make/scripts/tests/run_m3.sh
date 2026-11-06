#!/usr/bin/env bash
# M3 の検査をまとめて回す。M1 の検査に続けて、M3 で足した検査を 1 つずつ並べる
set -u
cd "$(dirname "$0")/../.."
fail=0
bash scripts/tests/run_m1.sh || fail=1
python3 scripts/tests/test_ledger.py >/dev/null 2>&1 || { echo "NG: test_ledger.py"; python3 scripts/tests/test_ledger.py; fail=1; }
for d in scripts/tests/contracts/ok_*; do
  python3 scripts/check_contract.py "$d" >/dev/null 2>&1 || { echo "NG: 契約 $d が通らない"; fail=1; }
done
for d in scripts/tests/contracts/bad_*; do
  python3 scripts/check_contract.py "$d" >/dev/null 2>&1 && { echo "NG: 契約 $d が通ってしまう"; fail=1; }
done
# 字幕と読み（S-M2〜S-M4）
python3 scripts/check_text.py scripts/tests/text/ok.json >/dev/null 2>&1 || { echo "NG: text/ok.json が通らない"; fail=1; }
out=$(python3 scripts/check_text.py scripts/tests/text/bad.json 2>&1) && { echo "NG: text/bad.json が通ってしまう"; fail=1; }
for r in S-M2 S-M3 S-M4; do
  echo "$out" | grep -q "^$r:" || { echo "NG: text/bad.json で $r が出ない"; fail=1; }
done
# S-M3 は「。」の無い最後の文と「！」で終わる文も見る（bad の l4・l5）。「」の中の「。」では切らない（ok の l4）
for l in l4 l5; do
  echo "$out" | grep -q "^S-M3: 行 $l " || { echo "NG: text/bad.json の $l で S-M3 が出ない"; fail=1; }
done
for f in scripts/tests/text/ok.json scripts/tests/text/bad.json; do
  node scripts/check_storyboard.cjs "$f" >/dev/null 2>&1 || { echo "NG: $f が台本の形を通らない"; fail=1; }
done
for f in examples/*.json; do
  python3 scripts/check_text.py "$f" >/dev/null 2>&1 || { echo "NG: 見本 $f が字幕と読みの検査を通らない"; python3 scripts/check_text.py "$f"; fail=1; }
done
# 各行の落ち着いたコマ（SVG と PNG のシート。resvg がなければ PNG の検査は飛ばす）
sh scripts/tests/test_frames.sh || fail=1
# 再生ページの残論点と根拠の一覧
python3 scripts/tests/test_build_review.py >/dev/null 2>&1 || { echo "NG: test_build_review.py"; python3 scripts/tests/test_build_review.py; fail=1; }
# 作業フォルダ（題材の外に作る。同じ名前は -2 -3…、日本語だけの名前は run）
rh=$(mktemp -d)
w1=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new --now 20260101-0000 "this repo" 2>/dev/null)
w2=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new --now 20260101-0000 "this repo" 2>/dev/null)
w3=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new --now 20260101-0000 "このリポジトリ" 2>/dev/null)
for w in "$w1" "$w2" "$w3"; do
  [ -d "$w/sources" ] && [ -d "$w/review" ] || { echo "NG: workdir.py の作業フォルダに sources/ review/ がない: $w"; fail=1; }
done
case "$w1" in "$rh"/*-this-repo) ;; *) echo "NG: workdir.py の 1 つ目の名前: $w1"; fail=1;; esac
case "$w2" in *-this-repo-2) ;; *) echo "NG: workdir.py の 2 つ目が -2 で終わらない: $w2"; fail=1;; esac
case "$w3" in *-run) ;; *) echo "NG: workdir.py の日本語名が run にならない: $w3"; fail=1;; esac
rm -rf "$rh"
# 成功基準と演出の約束に、v1（Manim・ショット DSL）の語が残っていない
old=$(grep -rnE "lint_storyboard|render\.sh|shot_scene|custom\.py|occupancy|layout_report|map\.kind|\bops\b|Manim" references)
[ -z "$old" ] || { echo "NG: references に v1 の語が残っている"; echo "$old"; fail=1; }
# エージェントの定義に v1 の語と、もう無い文書の名前が残っていない（animator は保留中で v1 のまま残すので除く）
agents=$(ls ../../agents/*.md | grep -v '/animator\.md$')
old=$(grep -nE "lint_storyboard|render\.sh|shot_scene|custom\.py|occupancy|layout_report|map\.kind|\bops\b|Manim|shot-dsl|storyboard-guide|layout_map|op-proposals|移植中|Phase [0-9]" $agents)
[ -z "$old" ] || { echo "NG: agents に v1 の語が残っている"; echo "$old"; fail=1; }
# エージェントの tools: に書いたスクリプトが実在する（${CLAUDE_PLUGIN_ROOT} をリポジトリの直下に置き換える）
for f in $agents; do
  for p in $(grep '^tools:' "$f" | grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[^ )*]+'); do
    q=$(echo "$p" | sed 's|^\${CLAUDE_PLUGIN_ROOT}|../..|')
    [ -f "$q" ] || { echo "NG: $f の tools: のスクリプトがない: $p"; fail=1; }
  done
done
for s in check_storyboard.cjs check_text.py frames.cjs; do
  grep '^tools:' ../../agents/writer.md | grep -q "/scripts/$s " || { echo "NG: writer の tools: に $s がない"; fail=1; }
done
grep '^tools:' ../../agents/researcher.md | grep -q "/scripts/check_contract.py " || { echo "NG: researcher の tools: に check_contract.py がない"; fail=1; }
# 進行役の手順（SKILL.md・run-chat.md・run-code.md）
docs="SKILL.md references/run-chat.md references/run-code.md"
for f in $docs; do
  [ -f "$f" ] || { echo "NG: $f がない"; fail=1; continue; }
  # 出てくる scripts/ のファイルがすべて実在する
  for p in $(grep -oE 'scripts/[A-Za-z0-9_./-]*\.(py|cjs|sh)' "$f" | sort -u); do
    [ -f "$p" ] || { echo "NG: $f の $p がない"; fail=1; }
  done
  # コードの塊に bash 専用の書き方がない（claude.ai のシェルは sh）
  bad=$(awk '/^ *```/{c=!c; next} c' "$f" | grep -nE '\$\{PIPESTATUS|(^|[;&|( ])time |\[\[|<\(')
  [ -z "$bad" ] || { echo "NG: $f のコードに bash 専用の書き方がある"; echo "$bad"; fail=1; }
done
[ -f SKILL.md ] && [ "$(wc -l < SKILL.md)" -le 200 ] || { echo "NG: SKILL.md が 200 行を超える"; fail=1; }
# フェーズの番号と名前が criteria/README.md と同じ
for ph in "0 準備" "1 インタビュー" "2 取材と契約" "3 人の確認" "4 台本" "5 画面" "6 音声" "7 組み立てと公開" "8 報告"; do
  grep -q "^### $ph" SKILL.md || { echo "NG: SKILL.md に「### $ph」がない"; fail=1; }
  grep -q "$ph" references/criteria/README.md || { echo "NG: criteria/README.md に「$ph」がない"; fail=1; }
done
[ -f references/run-chat.md ] && { grep -q -- "--max-rounds 2" references/run-chat.md || { echo "NG: run-chat.md に --max-rounds 2 がない"; fail=1; }; }
# 機械検査の差し戻しは writer の別の呼び方（応答を書かない）。進行役の文書と loop-protocol から指す
grep -q "^## 機械検査の差し戻し" ../../agents/writer.md || { echo "NG: writer.md に「機械検査の差し戻し」の節がない"; fail=1; }
for f in $docs references/loop-protocol.md; do
  grep -q "機械検査の差し戻し" "$f" || { echo "NG: $f に「機械検査の差し戻し」がない"; fail=1; }
done
grep -q "ledger.py reset" references/loop-protocol.md || { echo "NG: loop-protocol.md に ledger.py reset がない"; fail=1; }
# チャットのスキルの探し方は /mnt/skills を先に見る
grep -q "/mnt/skills/\*/make" references/run-chat.md || { echo "NG: run-chat.md が /mnt/skills を先に見ていない"; fail=1; }
# 声の番号: writer が interview.md から voice を書き、6 音声で進行役が一覧と照らして voice.speaker を直す
grep -q '\*\*声\*\*（`voice`）' ../../agents/writer.md || { echo "NG: writer.md の台本の書き方に voice がない"; fail=1; }
for f in $docs; do
  grep -q "voice.speaker" "$f" || { echo "NG: $f に voice.speaker を直す手順がない"; fail=1; }
done
[ $fail = 0 ] && echo "M3 の検査: すべて OK" || echo "M3 の検査: NG あり"
exit $fail
