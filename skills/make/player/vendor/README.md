elkjs 0.9.3（npm: elkjs@0.9.3 の lib/elk.bundled.js）。EPL-2.0。https://github.com/kieler/elkjs

mathjax-uz.js: mathjax-full 3.2.2（Apache-2.0。本文は mathjax-LICENSE.txt）を esbuild 0.24.0 で束ねたもの（約 1.6MB）。TeX → SVG（fontCache なし、liteAdaptor でブラウザの DOM なし）を、node とブラウザで同じコードで動かす。グローバル `UZMJ.tex2tree(tex, {display})` が `{w, h, depth, tree}`（em 単位）か `{error}` を返す。入口は tools/mathjax/entry.js、作り直しは `sh tools/build_mathjax.sh`（npm と npx が要る）。es5 の tex-svg.js は node で動かない（speech-rule-engine が xmldom を要る）ので使わない。
