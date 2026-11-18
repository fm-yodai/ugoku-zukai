// ugoku-zukai プレーヤー: 幾何の道具 UZ.geo（custom の部品の関数が使う。座標・グラフ・接線・面積・ベクトル・数式と変形）。
// DOM に触らない。要素は受け取った el(tag, attrs, parent) で作る（ブラウザでも node の最小の DOM でも同じ絵になる）。
// 描く関数は作った要素を返す。座標は px（部品のローカル座標）か、Ax（geo.axes の戻り値）を通した数の座標。
(function (UZ) {
  "use strict";
  const C = UZ.color, clamp = UZ.clamp;
  const ERR_COLOR = "#d32f2f";   // TeX の誤りの印。台本の書き手に向けた知らせで、テーマの色ではない（geo.errors に積んで知らせる）
  const KEYS = ["accent", "ink", "muted", "good", "bad", "warn", "line", "bg", "surface"];

  const n2 = v => { const s = (+v).toFixed(2); return s === "-0.00" ? "0" : String(+s); };   // 属性に書く数
  const n4 = v => String(+(+v).toFixed(4));
  const ptsD = pts => "M" + pts.map(p => n2(p[0]) + "," + n2(p[1])).join("L");

  // ---- 数式の木（UZMJ.tex2tree）の写しと、木の transform の計算 ----
  // 同じ TeX は 1 回だけ組む。値を埋めた TeX はコマごとに文字列が変わるので、古いものから捨てる
  const TEX_CACHE = new Map(), TEX_MAX = 500;
  function texTree(tex, display) {
    const key = (display ? "D:" : "I:") + tex;
    let r = TEX_CACHE.get(key);
    if (!r) {
      const MJ = globalThis.UZMJ;
      r = MJ ? MJ.tex2tree(String(tex), { display: !!display }) : { error: "数式の組版（UZMJ）が読み込まれていない" };
      if (TEX_CACHE.size >= TEX_MAX) TEX_CACHE.delete(TEX_CACHE.keys().next().value);
      TEX_CACHE.set(key, r);
    }
    return r;
  }
  // 2D の変換 [a, b, c, d, e, f]（x' = a x + c y + e, y' = b x + d y + f）
  const ID = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  function parseTr(s) {
    let m = ID;
    for (const [, fn, args] of String(s || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
      const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
      let t = ID;
      if (fn === "translate") t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
      else if (fn === "scale") t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
      else if (fn === "matrix" && a.length === 6) t = a;
      else if (fn === "rotate") {
        const r = (a[0] || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0;
        t = mul(mul([1, 0, 0, 1, cx, cy], [cs, sn, -sn, cs, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
      }
      m = mul(m, t);
    }
    return m;
  }
  const matStr = m => `matrix(${m.map(n4).join(",")})`;
  // 写すときに外す属性（MathJax の内部の印と id。id はページの中で重なりうるので書かない）
  const skipAttr = k => k === "id" || k.startsWith("data-");

  UZ.makeGeo = function (el, S) {
    const geo = { errors: [], S };

    // 色: テーマのキー（accent・ink・muted・good・bad・warn・line・bg・surface）、役割の名前、#rrggbb などの色
    const col = (c, dflt) => {
      if (c == null || c === "") return dflt == null ? S.ink : col(dflt);
      if (KEYS.includes(c)) return S[c];
      if (/^(#|rgb|hsl)/i.test(c) || c === "none") return c;
      return S.role(c);
    };
    // 面の色: fill が true なら線の色、色の名前ならその色、なければ塗らない
    const fillOf = (o, stroke) => o.fill === true ? stroke : o.fill ? col(o.fill) : "none";
    geo.col = c => col(c);
    geo.lerp = (a, b, p) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * p) : a + (b - a) * p;
    geo.smooth = UZ.smooth;
    geo.mix = (c1, c2, p) => C.mix(col(c1), col(c2), clamp(p));

    // ---- 座標 ----
    // 目盛りの間隔: 範囲を 8 つほどに割る、1・2・5 × 10^n の数
    function niceStep(range) {
      const raw = Math.abs(range) / 8 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), k = raw / mag;
      return (k < 1.5 ? 1 : k < 3 ? 2 : k < 7 ? 5 : 10) * mag;
    }
    // 間隔 step は絶対値で使う。0 以下・数でない・細かすぎて目盛りが MAX_TICKS を超えるときは、自動の間隔に戻す
    const MAX_TICKS = 100;
    function ticksOf(lo, hi, step) {
      step = Math.abs(Number(step));
      if (!Number.isFinite(step) || step <= 0 || (hi - lo) / step > MAX_TICKS) step = niceStep(hi - lo);
      const out = [], dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
      for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) out.push(+(i * step).toFixed(dec + 1));
      return { vals: out, dec };
    }
    const fmt = (v, dec) => { const s = (+v).toFixed(dec); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; };

    geo.axes = function (g, o) {
      const box = o.box;
      let [x0, x1] = o.x, [y0, y1] = o.y;
      // 範囲が潰れている（数でない・両端が同じ）と 0 で割るので、知らせて幅 1 に広げる
      const fix = (a, b, name) => {
        if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return [a, b];
        geo.errors.push(`axes の ${name} の範囲が潰れている（${a}, ${b}）`);
        a = Number.isFinite(a) ? a : 0;
        return [a, a + 1];
      };
      [x0, x1] = fix(x0, x1, "x"); [y0, y1] = fix(y0, y1, "y");
      const toPx = ([x, y]) => [box.x + (x - x0) / (x1 - x0) * box.w, box.y + box.h - (y - y0) / (y1 - y0) * box.h];
      const toNum = ([px, py]) => [x0 + (px - box.x) / box.w * (x1 - x0), y0 + (box.y + box.h - py) / box.h * (y1 - y0)];
      const Ax = { toPx, toNum, box, x: [x0, x1], y: [y0, y1] };
      const show = clamp(o.show ?? 1), out = el("g", null, g);
      Ax.g = out;
      if (show <= 0) return Ax;
      // 軸は 0 を通る（0 が範囲の外なら端）
      const ox = clamp(0, Math.min(x0, x1), Math.max(x0, x1)), oy = clamp(0, Math.min(y0, y1), Math.max(y0, y1));
      const [ax, ay] = toPx([ox, oy]);
      const tk = o.ticks || {}, TX = ticksOf(Math.min(x0, x1), Math.max(x0, x1), tk.x), TY = ticksOf(Math.min(y0, y1), Math.max(y0, y1), tk.y);
      if (o.grid) {
        const gg = el("g", { stroke: S.line, "stroke-width": 1, opacity: n2(0.7 * show) }, out);
        for (const v of TX.vals) { const px = toPx([v, oy])[0]; el("path", { d: `M${n2(px)},${n2(box.y)}V${n2(box.y + box.h)}` }, gg); }
        for (const v of TY.vals) { const py = toPx([ox, v])[1]; el("path", { d: `M${n2(box.x)},${n2(py)}H${n2(box.x + box.w)}` }, gg); }
      }
      // 軸の線は左（下）から伸びる。先に矢じり
      const xEnd = box.x + box.w * show, yEnd = box.y + box.h - box.h * show;
      const line = { stroke: S.muted, "stroke-width": 2, "stroke-linecap": "round", fill: "none" };
      el("path", { d: `M${n2(box.x)},${n2(ay)}H${n2(xEnd)}`, ...line }, out);
      el("path", { d: `M${n2(ax)},${n2(box.y + box.h)}V${n2(yEnd)}`, ...line }, out);
      el("path", { d: `M${n2(xEnd + 2)},${n2(ay)}L${n2(xEnd - 10)},${n2(ay - 5)}L${n2(xEnd - 10)},${n2(ay + 5)}Z`, fill: S.muted }, out);
      el("path", { d: `M${n2(ax)},${n2(yEnd - 2)}L${n2(ax - 5)},${n2(yEnd + 10)}L${n2(ax + 5)},${n2(yEnd + 10)}Z`, fill: S.muted }, out);
      // 目盛りと数（線が届いたところまで。軸が交わる 0 は書かない）
      const tg = el("g", null, out), small = { "font-size": 17, "font-family": S.font, fill: S.muted, "dominant-baseline": "central" };
      for (const v of TX.vals) {
        const px = toPx([v, oy])[0];
        if (px > xEnd + 0.5 || (v === ox && ax > box.x + 1 && ax < box.x + box.w - 1)) continue;
        el("path", { d: `M${n2(px)},${n2(ay - 5)}V${n2(ay + 5)}`, stroke: S.muted, "stroke-width": 2 }, tg);
        el("text", { x: n2(px), y: n2(ay + 22), "text-anchor": "middle", ...small }, tg).textContent = fmt(v, TX.dec);
      }
      for (const v of TY.vals) {
        const py = toPx([ox, v])[1];
        if (py < yEnd - 0.5 || (v === oy && ay > box.y + 1 && ay < box.y + box.h - 1)) continue;
        el("path", { d: `M${n2(ax - 5)},${n2(py)}H${n2(ax + 5)}`, stroke: S.muted, "stroke-width": 2 }, tg);
        el("text", { x: n2(ax - 12), y: n2(py), "text-anchor": "end", ...small }, tg).textContent = fmt(v, TY.dec);
      }
      // 軸の名前は、線が伸び切るころに出る
      const lb = o.labels || {}, lop = clamp((show - 0.7) / 0.3);
      if (lop > 0 && (lb.x || lb.y)) {
        const lg = el("g", lop < 1 ? { opacity: n2(lop) } : null, out);
        if (lb.x) geo.label(lg, [box.x + box.w - 4, ay - 22], lb.x, { anchor: "end", color: "ink" });
        if (lb.y) geo.label(lg, [ax + 16, box.y + 10], lb.y, { anchor: "start", color: "ink" });
      }
      return Ax;
    };

    // ---- グラフ ----
    // f を from〜to（の upto の割合まで）で描く。値が NaN・Infinity・枠外の区間は線を切り、枠をまたぐところは枠の上で止める
    geo.plot = function (g, Ax, f, o = {}) {
      const a = o.from ?? Ax.x[0], b = o.to ?? Ax.x[1], N = Math.max(2, Math.round(o.samples || 200)), up = clamp(o.upto ?? 1);
      const out = el("g", { fill: "none", stroke: col(o.color, "accent"), "stroke-width": o.width || 3, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
      if (up <= 0) return out;
      const lo = Math.min(...Ax.y), hi = Math.max(...Ax.y), inside = y => Number.isFinite(y) && y >= lo && y <= hi;
      const us = [];
      for (let i = 0; i <= N && i / N < up; i++) us.push(i / N);
      us.push(up);
      const segs = [];
      let cur = [], prev = null;
      const cross = (p, q) => { const yb = (p[1] > hi || q[1] > hi) ? hi : lo; return [p[0] + (yb - p[1]) / (q[1] - p[1]) * (q[0] - p[0]), yb]; };
      for (const u of us) {
        const x = a + (b - a) * u, y = Number(f(x)), q = [x, y];
        if (inside(y)) {
          if (!cur.length && prev && Number.isFinite(prev[1])) cur.push(cross(prev, q));
          cur.push(q);
        } else if (cur.length) {
          if (Number.isFinite(y)) cur.push(cross(prev, q));
          segs.push(cur); cur = [];
        }
        prev = q;
      }
      if (cur.length) segs.push(cur);
      for (const s of segs) if (s.length >= 2) el("path", { d: ptsD(s.map(Ax.toPx)) }, out);
      return out;
    };

    // ---- 点と文字 ----
    geo.point = function (g, Ax, [x, y], o = {}) {
      const [px, py] = Ax.toPx([x, y]), r = o.r ?? 7, out = el("g", null, g);
      el("circle", { cx: n2(px), cy: n2(py), r, fill: col(o.color, "accent"), stroke: S.bg, "stroke-width": 2.5 }, out);
      if (o.label != null) geo.label(out, [px + r + 6, py - r - 12], o.label, { anchor: "start", size: o.size, color: o.labelColor });
      return out;
    };
    // 文字。$…$ で囲めば TeX で組む。[px, py] は文字の縦の中心。地の色の縁取りで、格子の上でも読める
    geo.label = function (g, [px, py], text, o = {}) {
      const size = o.size || 22, anchor = o.anchor || "middle", s = String(text);
      const m = s.match(/^\$([\s\S]+)\$$/);
      if (m) {
        const r = texTree(m[1], false);
        const h = r.error ? size : r.vb[3] * size / 1000;
        const out = el("g", null, g);
        geo.tex(out, m[1], { x: px, y: py - h / 2, size, color: o.color, anchor });
        return out;
      }
      const t = el("text", { x: n2(px), y: n2(py), "font-size": size, "font-family": S.font, "font-weight": o.weight || S.weight, fill: col(o.color),
        "text-anchor": anchor, "dominant-baseline": "central", stroke: S.bg, "stroke-width": 5, "stroke-linejoin": "round", "paint-order": "stroke" }, g);
      t.textContent = s;
      return t;
    };
    geo.number = function (g, at, value, o = {}) {
      const v = Number(value), s = Number.isFinite(v) ? fmt(v, o.decimals ?? 2) : "—";
      return geo.label(g, at, (o.prefix || "") + s + (o.unit || ""), o);
    };

    // ---- 微分 ----
    geo.deriv = (f, x, h = 1e-4) => (f(x + h) - f(x - h)) / (2 * h);
    // 線分を枠に収める（Liang–Barsky）。収まらなければ null
    function clipSeg(p, q, b) {
      let t0 = 0, t1 = 1;
      const dx = q[0] - p[0], dy = q[1] - p[1];
      for (const [pp, qq] of [[-dx, p[0] - b.x], [dx, b.x + b.w - p[0]], [-dy, p[1] - b.y], [dy, b.y + b.h - p[1]]]) {
        if (pp === 0) { if (qq < 0) return null; continue; }
        const r = qq / pp;
        if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
      return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
    }
    // 点 p0（数）を通る傾き m の直線を、画面の上の長さ Lpx で描く
    function slopeLine(g, Ax, p0, m, Lpx, o, dflt) {
      const c = Ax.toPx(p0), d = Ax.toPx([p0[0] + 1, p0[1] + m]);
      const dx = d[0] - c[0], dy = d[1] - c[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const seg = clipSeg([c[0] - ux * Lpx / 2, c[1] - uy * Lpx / 2], [c[0] + ux * Lpx / 2, c[1] + uy * Lpx / 2], Ax.box);
      return el("path", { d: seg ? ptsD(seg) : "M0,0", fill: "none", stroke: col(o.color, dflt), "stroke-width": o.width || 3, "stroke-linecap": "round",
        "stroke-dasharray": o.dash ? "10 8" : null }, g);
    }
    const pxPerX = Ax => Math.abs(Ax.box.w / (Ax.x[1] - Ax.x[0]));
    // 接線。len は x の数の単位で測った線の長さ（傾きによらず画面の上で同じ長さ。既定は x の範囲の 4 割）
    geo.tangent = function (g, Ax, f, x0, o = {}) {
      const m = o.df ?? geo.deriv(f, x0), len = o.len ?? Math.abs(Ax.x[1] - Ax.x[0]) * 0.4, y0 = Number(f(x0));
      if (!Number.isFinite(y0)) return el("path", { d: "M0,0", fill: "none" }, g);   // 接点がない
      return slopeLine(g, Ax, [x0, y0], Number.isFinite(m) ? m : 0, len * pxPerX(Ax), o, "good");
    };
    // 割線。2 点を通り、両側へ 2 点の間の 1/4 ずつ延ばす（extend で変える）
    geo.secant = function (g, Ax, f, x0, x1, o = {}) {
      const p = [x0, f(x0)], q = [x1, f(x1)], P = Ax.toPx(p), Q = Ax.toPx(q), k = o.extend ?? 0.25;
      const dx = Q[0] - P[0], dy = Q[1] - P[1];
      const seg = clipSeg([P[0] - dx * k, P[1] - dy * k], [Q[0] + dx * k, Q[1] + dy * k], Ax.box);
      return el("path", { d: seg && Number.isFinite(dx + dy) ? ptsD(seg) : "M0,0", fill: "none", stroke: col(o.color, "good"), "stroke-width": o.width || 3,
        "stroke-linecap": "round", "stroke-dasharray": o.dash ? "10 8" : null }, g);
    };

    // ---- 面積 ----
    const yRange = Ax => [Math.min(...Ax.y), Math.max(...Ax.y)];
    const clampY = (Ax, y) => { const [lo, hi] = yRange(Ax); return Number.isFinite(y) ? clamp(y, lo, hi) : clamp(0, lo, hi); };
    geo.area = function (g, Ax, f, a, b, o = {}) {
      const base = clampY(Ax, 0), N = 120, pts = [Ax.toPx([a, base])];
      for (let i = 0; i <= N; i++) { const x = a + (b - a) * i / N; pts.push(Ax.toPx([x, clampY(Ax, Number(f(x)))])); }
      pts.push(Ax.toPx([b, base]));
      return el("path", { d: ptsD(pts) + "Z", fill: col(o.color, "accent"), "fill-opacity": o.opacity ?? 0.35, stroke: "none" }, g);
    };
    geo.riemann = function (g, Ax, f, a, b, n, o = {}) {
      const N = Math.max(1, Math.round(n)), dx = (b - a) / N, base = clampY(Ax, 0), c = col(o.color, "accent");
      const at = o.rule === "mid" ? 0.5 : o.rule === "right" ? 1 : 0;
      const out = el("g", { fill: c, "fill-opacity": o.opacity ?? 0.4, stroke: c, "stroke-width": N > 40 ? 0.8 : 1.5, "stroke-opacity": 0.9 }, g);
      for (let i = 0; i < N; i++) {
        const xl = a + i * dx, y = clampY(Ax, Number(f(xl + dx * at)));
        const [px0, py0] = Ax.toPx([xl, base]), [px1, py1] = Ax.toPx([xl + dx, y]);
        el("rect", { x: n2(Math.min(px0, px1)), y: n2(Math.min(py0, py1)), width: n2(Math.abs(px1 - px0)), height: n2(Math.abs(py1 - py0)) }, out);
      }
      return out;
    };

    // ---- ベクトルと図形 ----
    geo.vector = function (g, Ax, from, to, o = {}) {
      const p = Ax.toPx(from), q = Ax.toPx(to), c = col(o.color, "accent"), w = o.width || 4, out = el("g", null, g);
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
      if (L < 0.5) return out;
      const ux = dx / L, uy = dy / L, hl = Math.min(18, L * 0.5), hw = hl * 0.5;
      const bx = q[0] - ux * hl, by = q[1] - uy * hl;
      el("path", { d: ptsD([p, [q[0] - ux * hl * 0.8, q[1] - uy * hl * 0.8]]), stroke: c, "stroke-width": w, "stroke-linecap": "round", fill: "none" }, out);
      el("path", { d: ptsD([q, [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]]) + "Z", fill: c, stroke: c, "stroke-width": 1, "stroke-linejoin": "round" }, out);
      if (o.label != null) geo.label(out, [q[0] + ux * 24, q[1] + uy * 24], o.label, { color: o.labelColor || o.color || "accent", size: o.size });
      return out;
    };
    // 弧。角度はラジアンで、数学と同じ向き（右が 0、反時計回り）。fill を書くと扇形を塗る
    geo.arc = function (g, [cx, cy], r, a0, a1, o = {}) {
      const c = col(o.color, "good"), span = clamp(a1 - a0, -2 * Math.PI + 1e-4, 2 * Math.PI - 1e-4), e = a0 + span;
      const s = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)], t = [cx + r * Math.cos(e), cy - r * Math.sin(e)];
      const arc = `A${n2(r)},${n2(r)} 0 ${Math.abs(span) > Math.PI ? 1 : 0} ${span > 0 ? 0 : 1} ${n2(t[0])},${n2(t[1])}`;
      const fill = fillOf(o, c);
      const d = fill === "none" ? `M${n2(s[0])},${n2(s[1])}${arc}` : `M${n2(cx)},${n2(cy)}L${n2(s[0])},${n2(s[1])}${arc}Z`;
      return el("path", { d, fill, "fill-opacity": fill === "none" ? null : o.fillOpacity ?? 0.25, stroke: c, "stroke-width": o.width || 3, "stroke-linecap": "round" }, g);
    };
    geo.circle = function (g, [cx, cy], r, o = {}) {
      const c = col(o.color, "ink"), fill = fillOf(o, c);
      return el("circle", { cx: n2(cx), cy: n2(cy), r: n2(Math.max(0, r)), fill, "fill-opacity": fill === "none" ? null : o.fillOpacity ?? 0.25, stroke: c, "stroke-width": o.width || 3 }, g);
    };
    geo.polygon = function (g, pts, o = {}) {
      const c = col(o.color, "ink"), fill = fillOf(o, c);
      return el("path", { d: ptsD(pts) + (o.closed === false ? "" : "Z"), fill, "fill-opacity": fill === "none" ? null : o.fillOpacity ?? 0.25,
        stroke: c, "stroke-width": o.width || 3, "stroke-linejoin": "round" }, g);
    };
    // 棒。x を中心に、0（範囲の外なら端）から value まで。width は x の数の単位
    geo.bar = function (g, Ax, x, value, o = {}) {
      const w = o.width ?? 0.6, base = clampY(Ax, 0), [px0, py0] = Ax.toPx([x - w / 2, base]), [px1, py1] = Ax.toPx([x + w / 2, clampY(Ax, Number(value))]);
      return el("rect", { x: n2(Math.min(px0, px1)), y: n2(Math.min(py0, py1)), width: n2(Math.abs(px1 - px0)), height: n2(Math.abs(py1 - py0)), rx: 2,
        fill: col(o.color, "accent"), "fill-opacity": o.opacity ?? null }, g);
    };

    // ---- 数式 ----
    // 置き方: y は数式の上端、x は anchor（start・middle・end）で決まる横の位置。size は 1em の px。
    // MathJax の木は中に scale(1,-1) を持つ（y が下向きになり、ベースラインが 0、上端が vb[1]）ので、外側は正の倍率と、
    // viewBox の左上（vb[0], vb[1]）を打ち消す平行移動だけを掛ける
    function place(r, o) {
      const k = (o.size || 32) / 1000, w = r.vb[2] * k, h = r.vb[3] * k, anchor = o.anchor || "start";
      const left = (o.x || 0) - (anchor === "middle" ? w / 2 : anchor === "end" ? w : 0);
      return { k, w, h, tx: left - r.vb[0] * k, ty: (o.y || 0) - r.vb[1] * k };
    }
    const placeStr = P => `translate(${n2(P.tx)},${n2(P.ty)}) scale(${n4(P.k)})`;
    // 木の子を el で写す。currentColor は色に置き換える（resvg と同じ絵にするため）。
    // 数式の中の日本語（\text{…}）は、MathJax の serif をやめてテーマの文字で出す（幅は MathJax が 1 文字 1em で見積もっている）
    function copyAttrs(attrs, color) {
      const a = {};
      for (const k in attrs) if (!skipAttr(k) && k !== "transform") a[k] = attrs[k] === "currentColor" ? color : attrs[k];
      return a;
    }
    function copyNode(node, parent, color, skip) {
      if (node.text != null || (skip && skip.has(node))) return;
      const a = copyAttrs(node.attrs || {}, color);
      if (node.attrs && node.attrs.transform) a.transform = node.attrs.transform;
      if (node.tag === "text") {
        const s = (node.children || []).map(c => c.text || "").join("");
        if (!s) return;
        a["font-family"] = S.font;
        el("text", a, parent).textContent = s;
        return;
      }
      const e = el(node.tag, a, parent);
      for (const c of node.children || []) copyNode(c, e, color, skip);
    }
    const copyKids = (node, parent, color, skip) => { for (const c of node.children || []) copyNode(c, parent, color, skip); };
    function texError(g, tex, msg, o) {
      const size = (o.size || 32) * 0.7, w = UZ.textW(tex, size), anchor = o.anchor || "start";
      geo.errors.push(`TeX の誤り（${msg}）: ${tex}`);
      const t = el("text", { x: n2(o.x || 0), y: n2((o.y || 0) + size * 0.7), "font-size": n2(size), "font-family": S.font, fill: ERR_COLOR, "text-anchor": anchor, "dominant-baseline": "central" }, g);
      t.textContent = tex;
      return { w, h: size * 1.4, el: t };
    }
    geo.tex = function (g, tex, o = {}) {
      const r = texTree(tex, o.display);
      if (r.error) return texError(g, tex, r.error, o);
      const P = place(r, o), w = el("g", { transform: placeStr(P) }, g);
      copyKids(r.tree, w, col(o.color));
      return { w: P.w, h: P.h, el: w };
    };
    // id（\cssId{…}{…}）の付いた <g> と、そこまでの変換・引き継ぐ属性（入れ子の id は外側だけ）
    function idParts(root) {
      const out = new Map();
      (function walk(node, acc, inh) {
        if (node.text != null) return;
        const a = node.attrs || {}, T = mul(acc, parseTr(a.transform));
        if (a.id && node !== root) { if (!out.has(a.id)) out.set(a.id, { node, M: T, inh }); return; }
        const next = { ...inh };
        for (const k in a) if (!skipAttr(k) && k !== "transform") next[k] = a[k];
        for (const c of node.children || []) walk(c, T, next);
      })(root, ID, {});
      return out;
    }
    const sameKids = (a, b) => JSON.stringify(a.children) === JSON.stringify(b.children);
    // 数式の変形: 両方にある id の部分は位置と大きさを補間して動き、片方にしかない部分は薄くなって消える／現れる。
    // p = 0 と 1 では geo.tex と同じ絵を描く
    geo.texMorph = function (g, from, to, p, o = {}) {
      if (!(p > 0)) return geo.tex(g, from, o);
      if (p >= 1) return geo.tex(g, to, o);
      const A = texTree(from, o.display), B = texTree(to, o.display);
      if (A.error || B.error) {
        const r = geo.tex(g, p < 0.5 ? from : to, o), other = p < 0.5 ? B : A;
        if (other.error) geo.errors.push(`TeX の誤り（${other.error}）: ${p < 0.5 ? to : from}`);
        return r;
      }
      const color = col(o.color), PA = place(A, o), PB = place(B, o);
      const OA = [PA.k, 0, 0, PA.k, PA.tx, PA.ty], OB = [PB.k, 0, 0, PB.k, PB.tx, PB.ty];
      const ia = idParts(A.tree), ib = idParts(B.tree), skipA = new Set(), skipB = new Set(), shared = [];
      for (const [id, a] of ia) { const b = ib.get(id); if (b) { skipA.add(a.node); skipB.add(b.node); shared.push([a, b]); } }
      const root = el("g", null, g), op = v => String(+v.toFixed(3));
      copyKids(A.tree, el("g", { transform: placeStr(PA), opacity: op(1 - p) }, root), color, skipA);
      copyKids(B.tree, el("g", { transform: placeStr(PB), opacity: op(p) }, root), color, skipB);
      const part = (x, M, opacity) => {
        const w = el("g", { ...copyAttrs(x.inh, color), ...copyAttrs(x.node.attrs, color), transform: matStr(M), opacity: opacity < 1 ? op(opacity) : null }, root);
        copyKids(x.node, w, color);
      };
      for (const [a, b] of shared) {
        const M = geo.lerp(mul(OA, a.M), mul(OB, b.M), p);
        if (sameKids(a.node, b.node)) part(a, M, 1);
        else { part(a, M, 1 - p); part(b, M, p); }
      }
      return { w: geo.lerp(PA.w, PB.w, p), h: geo.lerp(PA.h, PB.h, p), el: root };
    };
    return geo;
  };
})(globalThis.UZ = globalThis.UZ || {});
