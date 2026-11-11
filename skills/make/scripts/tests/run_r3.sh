#!/usr/bin/env bash
# 作り直しの 3 本目（R3）の検査をまとめて回す。R2 までの検査に続けて、再生ページの位置の表示・作業フォルダの記録と一覧・声の試聴・直しの文書を検査する
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
bash scripts/tests/run_r2.sh || fail=1
for t in test_player_pos test_workdir test_tts_audition test_stale_voice; do
  python3 scripts/tests/$t.py >/dev/null 2>&1 || { ng "$t.py"; python3 scripts/tests/$t.py; }
done
# 通し（第 2 部）で見つかったこと
node scripts/tests/test_engine_tooshi.cjs >/dev/null 2>&1 || { ng "test_engine_tooshi.cjs"; node scripts/tests/test_engine_tooshi.cjs; }
grep -q 'note:<id>' references/storyboard.md && grep -q 'note:<id>' references/visual-grammar.md || ng "hide で注記を消す書き方（note:<id>）が文書にない"
grep -q "^| SP-11 " references/writing/spoken.md && grep -q "^| SP-14 " references/writing/spoken.md && grep -q "^## 章扉" references/writing/spoken.md || ng "spoken.md に、話の流れ（SP-11〜SP-14）と章扉がない"
grep -q "^| SP-10 .*確認する" references/writing/spoken.md || ng "spoken.md に「確かめる」を重ねない規則（SP-10）がない"
grep -q "^| S-W11 " references/criteria/script.md || ng "script.md に S-W11（通して聞いて話がつながる）がない"
for f in ../../agents/writing-reviewer.md references/criteria/README.md references/run-chat.md; do grep -q "S-W11" $f || ng "$f に S-W11 がない"; done
grep -q "主張の範囲を変えない" ../../agents/writing-reviewer.md && grep -q "文の案をそのまま入れない" references/review-protocol.md || ng "文の案が主張の範囲を変えないことの約束がない"
grep -q "語りとして書く" ../../agents/writer.md && grep -q "章扉" ../../agents/writer.md && grep -q "かぎ括弧を外す" ../../agents/writer.md || ng "writer.md に、語りとして書く・章扉・read のかぎ括弧がない"
grep -q "FAIL にした基準には、必ず指摘" ../../agents/fact-checker.md || ng "fact-checker.md に、FAIL には指摘を付ける約束がない"
grep -q "言うこと 1 つで 8〜10 秒" references/outline.md || ng "outline.md に、言うことの数からの尺の見積もりがない"
for f in references/run-code.md references/run-chat.md; do
  for w in "--agree-all" "--lines" "--close"; do grep -q -- "$w" $f || ng "$f に $w がない"; done
done
grep -q "エージェントを呼べないとき" references/run-code.md || ng "run-code.md に、エージェントを呼べないときの代わり方がない"
grep -q "manim-web で描きます" ../../README.md && ng "README.md が、まだない manim-web を使えるように書いている"
grep -q '区間数 × 1.5' references/storyboard.md || ng "storyboard.md の trace の既定の長さが、エンジン（区間 1 つに 1.5 秒）と合っていない"
# 見送っていた軽い指摘（指摘の一覧の検査は run_r2.sh の test_ledger.py が回す）
grep -q "agents/" references/writing/review-format.md && ng "review-format.md が agents/ を指している（チャットの zip には入っていない）"
grep -q "scripts/tests/outlines/ok_ux.json" ../../CLAUDE.md && ng "CLAUDE.md の構成メモの見本が、検査用のファイルを指している"
# 声の試聴（tts.py --audition。VOICEVOX が手元にあるときだけ）
vh=$(python3 -c "import sys; sys.path.insert(0,'scripts'); import setup_voice; print(setup_voice.default_home())")
if python3 -c "import voicevox_core" >/dev/null 2>&1 && [ -d "$vh" ]; then
  ad=$(mktemp -d)
  python3 scripts/tts.py -o "$ad/voice" --audition 8,2 --sample "こんにちは。聞き比べの文です。" >/dev/null 2>&1 || ng "tts.py --audition が失敗する"
  grep -q "春日部つむぎ" "$ad/voice/audition.html" 2>/dev/null && grep -q "四国めたん" "$ad/voice/audition.html" || ng "audition.html に話者の名前がない"
  if [ -e "$ad/voice/audio" ] || [ -e "$ad/voice/timeline.json" ]; then ng "--audition が合成用のファイルを作っている"; fi
  out=$(python3 scripts/tts.py -o "$ad/none" --audition 9999 --sample "文です。" 2>&1) && ng "入っていない話者で --audition が通ってしまう"
  [ -e "$ad/none" ] && ng "入っていない話者で --audition が出力先を作っている"
  rm -rf "$ad"
  # 直した後の声の使い回し（変えた行だけが作り直される）
  bash scripts/tests/test_fix_voice.sh >/dev/null 2>&1 || { ng "test_fix_voice.sh"; bash scripts/tests/test_fix_voice.sh; }
else
  echo "声の試聴の検査: VOICEVOX がないので飛ばす"
  echo "直しの声の検査: VOICEVOX がないので飛ばす"
fi
# 公開した後の直しと声の試聴（進行役の文書）
grep -q "^## 公開した後の直し" SKILL.md || ng "SKILL.md に「## 公開した後の直し」がない"
for w in "s2 / l2 @0:14" "直したい箇所を指定する" "workdir.py" "audition" "新しく合成" "同じ Artifact"; do grep -q -- "$w" SKILL.md || ng "SKILL.md に $w がない"; done
for w in "字幕の言い回し" "図や動作" "章の中身や順番" "見た目（テーマ）" "声（話者・話速）"; do grep -q "^| $w" SKILL.md || ng "SKILL.md の直しの表に「$w」の行がない"; done
grep -q "published page" SKILL.md || ng "SKILL.md の description に、公開したページを指して直す場面がない"
grep -q 'version: "0.4.0"' SKILL.md || ng "SKILL.md の version が 0.4.0 でない"
for f in references/run-code.md references/run-chat.md; do
  grep -q "^## 公開した後の直し" $f || ng "$f に「## 公開した後の直し」がない"
  for w in "--audition" "--scenes" "frames-part" "新しく合成" "'\*:"; do grep -q -- "$w" $f || ng "$f に $w がない"; done
done
for w in "workdir.py list" "workdir.py publish" "published.json" "未公開"; do grep -q -- "$w" references/run-code.md || ng "run-code.md に $w がない"; done
for w in "同じ会話" "コメント"; do grep -q "$w" references/run-chat.md || ng "run-chat.md の直しの節に $w がない"; done
grep -q "run_r3.sh" ../../CLAUDE.md && grep -q "workdir.py list" ../../CLAUDE.md && grep -q -- "--audition" ../../CLAUDE.md || ng "CLAUDE.md に R3 のコマンドがない"
grep -q "^### R3 の実装" ../../docs/design.md || ng "docs/design.md に「### R3 の実装」がない"
# 直しを道具だけで通したときに、文書で迷った箇所
# （読みの一覧の「字幕」の列は test_tts_text.py が見る。run_m3.sh が回す）
grep -q "stagger" references/storyboard.md || ng "storyboard.md に stagger（1 つずつ出す間隔）の説明がない"
for f in SKILL.md references/run-code.md references/run-chat.md; do
  grep -q "直す前からある" $f || ng "$f に、直す前からある機械検査の誤りの扱いがない"
done
grep -q '`text` と `read` の両方' SKILL.md || ng "SKILL.md に、read のある行の字幕を変えるときの扱いがない"
grep -q "直せる幅に限り" SKILL.md || ng "SKILL.md に、字幕を変えずに直せる幅に限りがあるときの扱いがない"
grep -q "コマの場所" references/run-code.md && grep -q "コマの場所" ../../agents/director.md || ng "一部の場面のコマの場所を、director に渡す書き方がない"
grep -q "構成メモのない" references/run-code.md || ng "run-code.md に、構成メモのない作業フォルダ（前の進め方で作ったもの）の扱いがない"
for f in references/run-code.md references/run-chat.md; do
  awk '/^## 公開した後の直し/{on=1} /^## 報告/{on=0} on' $f | grep -n "コマを作る\|評価役。" | head -2 | tr '\n' ' ' | grep -q "コマを作る.*評価役" || ng "$f の直しの節で、コマを作るのが評価役の後になっている"
done
# 最終レビューの指摘: 行を足した・消したときも、声を作り直してから時刻表を使う
for f in references/run-code.md references/run-chat.md; do
  awk '/^## 公開した後の直し/{on=1} /^## 報告/{on=0} on' $f | grep -q "行を足した・消した" || ng "$f の直しの節に、行を足した・消したときの時刻表の扱いがない"
done
[ $fail = 0 ] && echo "R3 の検査: すべて OK" || echo "R3 の検査: NG あり"
exit $fail
