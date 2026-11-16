// ugoku-zukai プレーヤー: 共通の小道具（ブラウザと node の両方で動く。DOM に触らない）
(function (UZ) {
  "use strict";

  UZ.STAGE = { w: 1280, h: 720 };
  // 画面の区画。header = 章の題、body = 図、sub = 字幕帯（字幕を消しても空けておく）
  // スライドの部品を区画に合わせて組むときの、文字の倍率の候補（大きい順。上限は図だけの場面の拡大の上限 1.3 と同じ）
  UZ.FILL_K = [1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1];
  UZ.AREA = {
    header: { x: 56, y: 28, w: 1168, h: 56 },
    body: { x: 48, y: 104, w: 1184, h: 470 },
    sub: { x: 90, y: 592, w: 1100, h: 104 },
  };
  UZ.MIN_FONT = 15;   // 縮めても読める下限（配置の検査で使う）

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const mix = (a, b, p) => a + (b - a) * p;
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const ease = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const outBack = x => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  Object.assign(UZ, { clamp, mix, smooth, ease, outBack });

  // ---- 文字の幅 ----
  // フォントが読めたかどうかで結果が変わらないよう、実測ではなく文字の種類から決める（node の検査と同じ値になる）。
  // 日本語のフォントの実寸より少し広めに見積もる。
  function charW(c) {
    const code = c.codePointAt(0);
    if (c === " ") return 0.3;
    if (code < 0x80) {
      if (/[A-Z0-9]/.test(c)) return 0.64;
      if (/[a-z]/.test(c)) return 0.56;
      if (/[il.,:;'!|]/.test(c)) return 0.3;
      return 0.5;
    }
    if (code >= 0xff61 && code <= 0xff9f) return 0.55;  // 半角カナ
    return 1.0;
  }
  UZ.textW = function (s, size, weight = 400) {
    let w = 0;
    for (const c of String(s)) w += charW(c);
    return w * size * (weight >= 600 ? 1.03 : 1);
  };

  // 幅 maxW に収まるよう折り返す。句読点・助詞の後ろを優先して切る。
  const BREAK_AFTER = "、。・）」』）,.!?！？ ";
  const PARTICLES = "はがをにでとへものや";
  UZ.wrap = function (s, size, maxW, weight = 400, maxLines = 3) {
    s = String(s);
    if (s.includes("\n")) return s.split("\n").flatMap(part => UZ.wrap(part, size, maxW, weight, maxLines));
    if (UZ.textW(s, size, weight) <= maxW) return [s];
    const chars = [...s], lines = [];
    let start = 0;
    while (start < chars.length && lines.length < maxLines - 1) {
      let w = 0, end = start, lastGood = -1;
      while (end < chars.length) {
        const cw = charW(chars[end]) * size * (weight >= 600 ? 1.03 : 1);
        if (w + cw > maxW) break;
        w += cw;
        if (BREAK_AFTER.includes(chars[end]) || (PARTICLES.includes(chars[end]) && end - start >= 3)) lastGood = end;
        end++;
      }
      if (end >= chars.length) break;
      const cut = lastGood > start + 2 && lastGood - start >= (end - start) * 0.45 ? lastGood + 1 : end;
      lines.push(chars.slice(start, cut).join(""));
      start = cut;
    }
    if (start < chars.length) lines.push(chars.slice(start).join(""));
    return lines;
  };
  // 2 行の字幕を、行の長さが釣り合う位置（句読点を優先）で割る
  UZ.splitBalanced = function (s, size, maxW) {
    if (UZ.textW(s, size) <= maxW) return [s];
    const chars = [...s];
    let best = -1, bestScore = Infinity;
    for (let i = 1; i < chars.length - 1; i++) {
      const a = chars.slice(0, i + 1).join(""), b = chars.slice(i + 1).join("");
      const wa = UZ.textW(a, size), wb = UZ.textW(b, size);
      if (wa > maxW || wb > maxW) continue;
      const bonus = "、。".includes(chars[i]) ? -400 : PARTICLES.includes(chars[i]) ? -120 : 0;
      const score = Math.abs(wa - wb) + bonus;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return UZ.wrap(s, size, maxW, 400, 2);
    return [chars.slice(0, best + 1).join(""), chars.slice(best + 1).join("")];
  };

  // ---- 色 ----
  function parseColor(c) {
    c = String(c).trim();
    let m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map(x => x + x).join("");
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
      return [n >> 16, (n >> 8) & 255, n & 255, a];
    }
    m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    return [128, 128, 128, 1];
  }
  const hex2 = n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  UZ.color = {
    parse: parseColor,
    rgba(c, a) { const [r, g, b] = parseColor(c); return `rgba(${r},${g},${b},${a})`; },
    mix(c1, c2, p) {  // p=0 で c1、p=1 で c2
      const a = parseColor(c1), b = parseColor(c2);
      return "#" + [0, 1, 2].map(i => hex2(mix(a[i], b[i], p))).join("");
    },
    luminance(c) {
      const [r, g, b] = parseColor(c).map((v, i) => i < 3 ? v / 255 : v);
      const f = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    },
    contrast(a, b) {
      const la = UZ.color.luminance(a), lb = UZ.color.luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    },
  };

  // ---- 幾何 ----
  UZ.polyLen = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };
  UZ.withLengths = function (pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, L, total: L[L.length - 1] };
  };
  UZ.along = function (poly, p) {
    const d = poly.total * clamp(p);
    let i = poly.L.findIndex(x => x >= d);
    if (i <= 0) return poly.pts[0].slice();
    const a = poly.pts[i - 1], b = poly.pts[i], k = (d - poly.L[i - 1]) / ((poly.L[i] - poly.L[i - 1]) || 1);
    return [mix(a[0], b[0], k), mix(a[1], b[1], k)];
  };
  // 折れ線を左手側へ d だけずらす（直角の折れ線向け。角は交点で結ぶ）
  UZ.offsetPoly = function (pts, d) {
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (y2 - y1) / L * d, ny = -(x2 - x1) / L * d;
      segs.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny]]);
    }
    const out = [segs[0][0]];
    for (let i = 1; i < segs.length; i++) {
      const p = intersect(segs[i - 1], segs[i]);
      out.push(p || segs[i][0]);
    }
    out.push(segs[segs.length - 1][1]);
    return out;
  };
  function intersect([a, b], [c, d]) {
    const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
    if (Math.abs(den) < 1e-6) return null;
    const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  // 折れ線の両端を r だけ縮める（箱の縁から少し離す）
  UZ.trimPoly = function (pts, r0, r1) {
    const poly = UZ.withLengths(pts), out = [];
    const a = r0 / poly.total, b = 1 - r1 / poly.total;
    out.push(UZ.along(poly, a));
    for (let i = 1; i < pts.length - 1; i++) if (poly.L[i] / poly.total > a && poly.L[i] / poly.total < b) out.push(pts[i]);
    out.push(UZ.along(poly, b));
    return out;
  };
  UZ.rectOverlap = function (a, b, pad = 0) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + pad;
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + pad;
    return w > 0 && h > 0 ? w * h : 0;
  };
  UZ.inside = (p, r, m = 0) => p[0] >= r.x - m && p[0] <= r.x + r.w + m && p[1] >= r.y - m && p[1] <= r.y + r.h + m;
})(globalThis.UZ = globalThis.UZ || {});
