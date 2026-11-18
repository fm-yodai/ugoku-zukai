#!/bin/sh
# 数式の組版（MathJax の TeX → SVG）を 1 枚の束にして skills/make/player/vendor/mathjax-uz.js に書く。
# 開発時にだけ使う（npm と npx が要る）。生成物はコミットしてあるので、利用者は回さなくてよい。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tools/mathjax/entry.js" "$TMP/entry.js"
cd "$TMP"
npm init -y >/dev/null
npm i mathjax-full@3.2.2 >/dev/null
npx -y esbuild@0.24.0 entry.js --bundle --minify --format=iife --platform=neutral --main-fields=main \
  --outfile="$ROOT/skills/make/player/vendor/mathjax-uz.js"
cp node_modules/mathjax-full/LICENSE "$ROOT/skills/make/player/vendor/mathjax-LICENSE.txt"
echo "書いた: skills/make/player/vendor/mathjax-uz.js"
