// node で view_svg.js を動かすための最小の DOM。view_svg.js が使う範囲だけを持つ
// （createElementNS / setAttribute / appendChild / removeChild / firstChild / textContent / innerHTML = "" / style.opacity / style.display）
// serialize(el) は SVG の文字列にする。style は style="opacity:…;display:…" に書き、display:none と opacity 0 の要素は省く
"use strict";

class Style {
  constructor() { this.opacity = ""; this.display = ""; }
}

class Element {
  constructor(ns, tag) {
    this.namespaceURI = ns; this.tagName = tag;
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null;
    this._text = null; this.style = new Style();
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    this._text = null; this.childNodes.push(c); c.parentNode = this; return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error("removeChild: 子ではない");
    this.childNodes.splice(i, 1); c.parentNode = null; return c;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this._text != null ? this._text : this.childNodes.map(c => c.textContent).join(""); }
  set textContent(s) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this._text = s == null ? "" : String(s); }
  set innerHTML(s) {
    if (s !== "") throw new Error("innerHTML は空文字の代入だけ扱う");
    this.textContent = "";
  }
}

function makeDocument() {
  return { createElementNS: (ns, tag) => new Element(ns, tag) };
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function hidden(el) {
  const st = el.style;
  if (st.display === "none") return true;
  if (st.opacity !== "" && st.opacity != null && +st.opacity <= 0) return true;
  return false;
}

// el を SVG の文字列にする。root に足す属性（xmlns・width など）は extra で渡す
function serialize(el, extra) {
  if (hidden(el)) return "";
  const attrs = new Map(el.attrs);
  if (extra) for (const k in extra) attrs.set(k, String(extra[k]));
  const st = [];
  if (el.style.opacity !== "" && el.style.opacity != null && +el.style.opacity < 1) st.push(`opacity:${+el.style.opacity}`);
  if (el.style.display) st.push(`display:${el.style.display}`);
  if (st.length) attrs.set("style", st.join(";"));
  let s = "<" + el.tagName;
  for (const [k, v] of attrs) s += ` ${k}="${esc(v)}"`;
  const inner = el._text != null ? esc(el._text) : el.childNodes.map(c => serialize(c)).join("");
  return inner === "" ? s + "/>" : s + ">" + inner + "</" + el.tagName + ">";
}

module.exports = { makeDocument, serialize, Element };
