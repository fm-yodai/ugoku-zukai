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
w1=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new "this repo" 2>/dev/null)
w2=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new "this repo" 2>/dev/null)
w3=$(UZ_RUNS_HOME="$rh" python3 scripts/workdir.py new "このリポジトリ" 2>/dev/null)
for w in "$w1" "$w2" "$w3"; do
  [ -d "$w/sources" ] && [ -d "$w/review" ] || { echo "NG: workdir.py の作業フォルダに sources/ review/ がない: $w"; fail=1; }
done
case "$w1" in "$rh"/*-this-repo) ;; *) echo "NG: workdir.py の 1 つ目の名前: $w1"; fail=1;; esac
case "$w2" in *-this-repo-2) ;; *) echo "NG: workdir.py の 2 つ目が -2 で終わらない: $w2"; fail=1;; esac
case "$w3" in *-run) ;; *) echo "NG: workdir.py の日本語名が run にならない: $w3"; fail=1;; esac
rm -rf "$rh"
[ $fail = 0 ] && echo "M3 の検査: すべて OK" || echo "M3 の検査: NG あり"
exit $fail
