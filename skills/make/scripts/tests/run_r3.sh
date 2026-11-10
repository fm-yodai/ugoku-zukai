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
[ $fail = 0 ] && echo "R3 の検査: すべて OK" || echo "R3 の検査: NG あり"
exit $fail
