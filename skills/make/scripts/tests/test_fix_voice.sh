#!/usr/bin/env bash
# 直した後の声の使い回しの検査（VOICEVOX が手元にあるときに run_r3.sh が呼ぶ。3 行を合成するので数秒かかる）。
# 変えた行だけが作り直されること、消した行が時刻表からなくなることを確かめる
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $1"; fail=1; }
d=$(mktemp -d)
cp scripts/tests/text/warn.json "$d/sb.json"
# 文の警告の見本から、最初の 3 行（l1〜l3）だけを使う（見本の行が増えても、この検査の前提を変えない）
python3 - "$d/sb.json" <<'EOF0'
import json, sys
p = sys.argv[1]
sb = json.load(open(p, encoding="utf-8"))
for sc in sb["scenes"]:
    sc["lines"] = [ln for ln in sc["lines"] if ln["id"] in ("l1", "l2", "l3")]
json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
EOF0
# 終了コード 3（時間で区切った）の間くり返し、最後の回の出力を出す
synth() {
  local out code
  while :; do
    out=$(python3 scripts/tts.py "$d/sb.json" -o "$d/voice" --no-mix "$@" 2>&1); code=$?
    [ $code = 3 ] || break
  done
  echo "$out"
  return $code
}
# 時刻表の行の id を空白区切りで出す
ids() { python3 -c "import json,sys; print(' '.join(l['id'] for l in json.load(open(sys.argv[1]))['lines']))" "$d/voice/timeline.json"; }

out=$(synth) || ng "最初の合成が失敗する"
echo "$out" | grep -q "新しく合成 3 行" || ng "最初の合成が 3 行にならない: $out"

# l2 の言い回しだけを変える → l2 だけが作り直される
python3 - "$d/sb.json" <<'EOF'
import json, sys
p = sys.argv[1]
sb = json.load(open(p, encoding="utf-8"))
for sc in sb["scenes"]:
    for ln in sc["lines"]:
        if ln["id"] == "l2":
            ln["text"] = ln["text"].rstrip("。") + "ね。"
json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
EOF
out=$(synth) || ng "言い回しを変えた後の合成が失敗する"
echo "$out" | grep -q "新しく合成 1 行" || ng "1 行を変えたのに、作り直しが 1 行にならない: $out"
python3 -c "import json,sys; l=[x for x in json.load(open(sys.argv[1]))['lines'] if x['id']=='l2'][0]; sys.exit(0 if l['text'].endswith('ね。') else 1)" "$d/voice/timeline.json" || ng "時刻表の l2 の文が新しくなっていない"

# l3 を消す → どの行も作り直されず、時刻表から l3 がなくなる
python3 - "$d/sb.json" <<'EOF'
import json, sys
p = sys.argv[1]
sb = json.load(open(p, encoding="utf-8"))
for sc in sb["scenes"]:
    sc["lines"] = [ln for ln in sc["lines"] if ln["id"] != "l3"]
json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
EOF
out=$(synth) || ng "行を消した後の合成が失敗する"
echo "$out" | grep -q "新しく合成 0 行" || ng "行を消しただけなのに、声が作り直された: $out"
[ "$(ids)" = "l1 l2" ] || ng "時刻表に消した行が残っている: $(ids)"

rm -rf "$d"
[ $fail = 0 ] && echo "直しの声の検査: すべて OK" || echo "直しの声の検査: NG あり"
exit $fail
