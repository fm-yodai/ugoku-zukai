#!/usr/bin/env bash
# 作り直しの 3 本目（R3）の検査をまとめて回す。R2 までの検査に続けて、再生ページの位置の表示・作業フォルダの記録と一覧・声の試聴・直しの文書を検査する
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
bash scripts/tests/run_r2.sh || fail=1
for t in test_player_pos test_workdir test_tts_audition; do
  python3 scripts/tests/$t.py >/dev/null 2>&1 || { ng "$t.py"; python3 scripts/tests/$t.py; }
done
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
else
  echo "声の試聴の検査: VOICEVOX がないので飛ばす"
fi
# 公開した後の直しと声の試聴（進行役の文書）
grep -q "^## 公開した後の直し" SKILL.md || ng "SKILL.md に「## 公開した後の直し」がない"
for w in "s2 / l2 @0:14" "直したい箇所を指す" "workdir.py" "audition" "新しく合成" "同じ Artifact"; do grep -q -- "$w" SKILL.md || ng "SKILL.md に $w がない"; done
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
[ $fail = 0 ] && echo "R3 の検査: すべて OK" || echo "R3 の検査: NG あり"
exit $fail
