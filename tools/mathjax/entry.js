// MathJax（TeX → SVG）の束の入口。node とブラウザで同じコードを動かすため、DOM なしの liteAdaptor を使う。
// 変換結果の LiteElement を、素の木 {tag, attrs, children} / {text} に写して返す。
// 作り直すときは tools/build_mathjax.sh（mathjax-full@3.2.2 + esbuild）。
const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
require("mathjax-full/js/input/tex/base/BaseConfiguration.js");
require("mathjax-full/js/input/tex/ams/AmsConfiguration.js");
require("mathjax-full/js/input/tex/html/HtmlConfiguration.js");
require("mathjax-full/js/input/tex/color/ColorConfiguration.js");
const { SVG } = require("mathjax-full/js/output/svg.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");

// 日本語の <text> は MathJax が幅を見積もれないので、全角 1em を明示する
const adaptor = liteAdaptor({ cjkCharWidth: 1 });
RegisterHTMLHandler(adaptor);
const doc = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams", "html", "color"] }),
  OutputJax: new SVG({ fontCache: "none" }),
});

function toTree(node) {
  if (adaptor.kind(node) === "#text") return { text: adaptor.value(node) };
  const attrs = {};
  for (const a of adaptor.allAttributes(node)) attrs[a.name] = a.value;
  return { tag: adaptor.kind(node), attrs, children: adaptor.childNodes(node).map(toTree) };
}
// MathJax の SVG 出力では、TeX の誤りは data-mml-node="merror"（data-mjx-error にメッセージ）の <g> になる
function findError(node) {
  if (adaptor.kind(node) === "#text") return null;
  if (adaptor.getAttribute(node, "data-mml-node") === "merror") return adaptor.getAttribute(node, "data-mjx-error") || "TeX の誤り";
  for (const c of adaptor.childNodes(node)) { const r = findError(c); if (r) return r; }
  return null;
}
function findSvg(node) {
  if (adaptor.kind(node) === "svg") return node;
  for (const c of adaptor.childNodes(node)) {
    const r = adaptor.kind(c) === "#text" ? null : findSvg(c);
    if (r) return r;
  }
  return null;
}

function tex2tree(tex, opts) {
  try {
    const out = doc.convert(String(tex), { display: !!(opts && opts.display) });
    const err = findError(out);
    if (err) return { error: err };
    const svg = findSvg(out);
    if (!svg) return { error: "SVG が得られなかった" };
    const vb = String(adaptor.getAttribute(svg, "viewBox") || "").trim().split(/\s+/).map(Number);
    if (vb.length !== 4 || vb.some(n => !isFinite(n))) return { error: "viewBox を読めなかった" };
    const [, minY, W, H] = vb;
    const kids = adaptor.childNodes(svg).map(toTree);
    return {
      w: W / 1000, h: -minY / 1000, depth: (H + minY) / 1000, vb,
      tree: { tag: "g", attrs: {}, children: kids },
    };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
globalThis.UZMJ = { tex2tree };
