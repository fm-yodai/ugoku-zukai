#!/usr/bin/env bash
# M1 の検査をまとめて回す: 見本台本 × テーマの配置検査、テーマの検査、デザインの抽出
set -u
cd "$(dirname "$0")/../.."
fail=0
for th in player/themes/3b1b.json player/themes/flat.json examples/themes/kumo.json; do
  python3 scripts/check_theme.py "$th" || fail=1
  for sb in examples/*.json; do node scripts/check_storyboard.cjs "$sb" --theme "$th" >/dev/null || { echo "NG: $sb ($th)"; node scripts/check_storyboard.cjs "$sb" --theme "$th"; fail=1; }; done
done
tmp=$(mktemp -d)
for f in scripts/tests/design/*; do
  python3 scripts/extract_design.py "$f" --report "$tmp/r.json" --theme "$tmp/t.json" --name t >/dev/null && python3 scripts/check_theme.py "$tmp/t.json" >/dev/null || { echo "NG: extract $f"; fail=1; }
done
rm -rf "$tmp"
[ $fail = 0 ] && echo "M1 の検査: すべて OK" || echo "M1 の検査: NG あり"
exit $fail
