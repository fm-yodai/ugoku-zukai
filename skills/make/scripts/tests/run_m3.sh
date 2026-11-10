#!/usr/bin/env bash
# 核の検査をまとめて回す。M1 の検査に続けて、字幕と読み・コマ・再生ページ・作業フォルダと、文書とスクリプトの食い違いを見る
# （進め方の文書と評価役の検査は run_r2.sh、構成メモと絵コンテの検査は run_r1.sh）
set -u
cd "$(dirname "$0")/../.."
fail=0
bash scripts/tests/run_m1.sh || fail=1
python3 scripts/tests/test_tts_text.py >/dev/null 2>&1 || { echo "NG: test_tts_text.py"; python3 scripts/tests/test_tts_text.py; fail=1; }
# 読みの一覧（tts.py --readings。VOICEVOX が手元にあるときだけ。合成はしない）
vh=$(python3 -c "import sys; sys.path.insert(0,'scripts'); import setup_voice; print(setup_voice.default_home())")
if python3 -c "import voicevox_core" >/dev/null 2>&1 && [ -d "$vh" ]; then
  rd=$(mktemp -d)
  python3 scripts/tts.py scripts/tests/text/warn.json -o "$rd/voice" --readings >/dev/null 2>&1; code=$?
  while [ $code = 3 ]; do python3 scripts/tts.py scripts/tests/text/warn.json -o "$rd/voice" --readings >/dev/null 2>&1; code=$?; done
  [ $code = 0 ] && [ -f "$rd/voice/readings.md" ] || { echo "NG: tts.py --readings が readings.md を書かない（終了コード $code）"; fail=1; }
  [ -f "$rd/voice/readings.md" ] && grep -q "^| l1 " "$rd/voice/readings.md" || { echo "NG: readings.md に l1 の行がない"; fail=1; }
  ls "$rd/voice"/*.wav "$rd/voice"/audio/*.wav >/dev/null 2>&1 && { echo "NG: --readings が合成している"; fail=1; }
  rm -rf "$rd"
else
  echo "読みの一覧の検査: VOICEVOX がないので飛ばす"
fi
# 視聴者の言葉と読みの基準（S-W5〜S-W9）
for id in S-W5 S-W6 S-W7 S-W8 S-W9; do grep -q "^| $id " references/criteria/script.md || { echo "NG: script.md に $id がない"; fail=1; }; done
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
for f in scripts/tests/text/ok.json scripts/tests/text/bad.json scripts/tests/text/warn.json; do
  node scripts/check_storyboard.cjs "$f" >/dev/null 2>&1 || { echo "NG: $f が台本の形を通らない"; fail=1; }
done
for f in examples/*.json; do
  python3 scripts/check_text.py "$f" >/dev/null 2>&1 || { echo "NG: 見本 $f が字幕と読みの検査を通らない"; python3 scripts/check_text.py "$f"; fail=1; }
done
# 聞いて分かる文の警告（SP-4・SP-6）。終了コードは 0 のまま
out=$(python3 scripts/check_text.py scripts/tests/text/warn.json 2>&1) || { echo "NG: text/warn.json が誤りになった（警告だけのはず）"; fail=1; }
for l in l1 l2; do echo "$out" | grep -q "^警告 SP-4: 行 $l " || { echo "NG: text/warn.json の $l で SP-4 が出ない"; fail=1; }; done
echo "$out" | grep -q "^警告 SP-6: 行 l3 " || { echo "NG: text/warn.json の l3 で SP-6 が出ない"; fail=1; }
python3 scripts/check_text.py scripts/tests/text/warn.json --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["warnings"])>=3 and not d["errors"]' || { echo "NG: check_text --json の warnings"; fail=1; }
# 各行の落ち着いたコマ（SVG と PNG のシート。resvg がなければ PNG の検査は飛ばす）
sh scripts/tests/test_frames.sh || fail=1
# 再生ページのチャプター一覧と根拠の吹き出し（未解決の指摘は出さない）
python3 scripts/tests/test_build_chapters.py >/dev/null 2>&1 || { echo "NG: test_build_chapters.py"; python3 scripts/tests/test_build_chapters.py; fail=1; }
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
# 進行役の手順（SKILL.md・run-chat.md・run-code.md）
docs="SKILL.md references/run-chat.md references/run-code.md"
# 視聴者の言葉と読みの確認が、エージェントと進行役の文書に入っている
grep -q "spoken.md" ../../agents/writer.md && grep -q "spoken.md" ../../agents/writing-reviewer.md || { echo "NG: writer / writing-reviewer が spoken.md を読まない"; fail=1; }
grep -q "読みモード" ../../agents/writing-reviewer.md || { echo "NG: writing-reviewer.md に読みモードがない"; fail=1; }
grep -q "spoken.md" references/run-chat.md || { echo "NG: run-chat.md が spoken.md を読ませていない"; fail=1; }
grep -q "function seekTo(t) { if (playing) startAt(t)" player/template.html || { echo "NG: template.html の seek が再生中に startAt を呼ばない"; fail=1; }
for f in $docs; do
  grep -q -- "--readings" "$f" || { echo "NG: $f に tts.py --readings がない"; fail=1; }
  grep -qE -- "--review([^a-z]|$)" "$f" && { echo "NG: $f に build_player.py --review が残っている"; fail=1; }
done
grep -q "未解決の指摘" SKILL.md references/run-code.md references/run-chat.md references/review-protocol.md references/writing/review-format.md && { echo "NG: 再生ページの「未解決の指摘」の記述が残っている"; fail=1; }
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
# 機械検査の差し戻しは writer の別の呼び方（応答を書かない）。進行役の文書と review-protocol.md から指す
grep -q "^## 機械検査の差し戻し" ../../agents/writer.md || { echo "NG: writer.md に「機械検査の差し戻し」の節がない"; fail=1; }
for f in $docs references/review-protocol.md; do
  grep -q "機械検査の差し戻し" "$f" || { echo "NG: $f に「機械検査の差し戻し」がない"; fail=1; }
done
# チャットのスキルの探し方は /mnt/skills を先に見る
grep -q "/mnt/skills/\*/make" references/run-chat.md || { echo "NG: run-chat.md が /mnt/skills を先に見ていない"; fail=1; }
# 声の番号: writer が構成メモの voice を台本に写し、合成の前に進行役が一覧と照らして voice.speaker を確かめる
grep -q '\*\*声\*\*（`voice`）' ../../agents/writer.md || { echo "NG: writer.md の台本の書き方に voice がない"; fail=1; }
for f in $docs; do
  grep -q "voice.speaker" "$f" || { echo "NG: $f に voice.speaker を直す手順がない"; fail=1; }
done
# 聞いて分かる文の規則
for i in 1 2 3 4 5 6 7 8 9; do grep -q "^| SP-$i " references/writing/spoken.md || { echo "NG: spoken.md に SP-$i がない"; fail=1; }; done
grep -q "について説明します" references/storyboard.md || { echo "NG: storyboard.md の title に問いでない例がない"; fail=1; }
grep -q "問い・章の扉" references/storyboard.md && { echo "NG: storyboard.md の title がまだ「問い・章の扉」"; fail=1; }
grep -q "spoken.md" references/writing/rules.md || { echo "NG: rules.md が spoken.md を指していない"; fail=1; }
[ $fail = 0 ] && echo "M3 の検査: すべて OK" || echo "M3 の検査: NG あり"
exit $fail
