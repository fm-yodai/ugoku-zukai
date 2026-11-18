// ugoku-zukai プレーヤー: 3D の核 UZ.space*（平行投影・カメラ・式・プリミティブの生成と奥からの並べ替え・面の平らな明るさ）。
// DOM に触らない。SVG への描画は view_svg.js の側（宣言の部品 space は engine / view_svg が使う）。
// 座標は右手系・z が上。yaw 0・pitch 0 で x が右、y が奥、z が上。視点の座標は x 右・y 上・z 奥。
(function (UZ) {
  "use strict";
  const C = UZ.color, clamp = UZ.clamp;
  const SPACE = UZ.SPACE = { maxPrims: 6000, grid: 24, gridMax: 64, plateMaxAngle: 70, shadeMin: 0.75 };
  const RAD = Math.PI / 180;
  const KEYS = ["accent", "ink", "muted", "good", "bad", "warn", "line", "bg", "surface"];
  const finite = v => typeof v === "number" && Number.isFinite(v);

  // 色の名前: geo.js の col() と同じ約束（テーマのキー・s1〜・役割・#rrggbb）。geo の col は makeGeo の中にあり
  // 外から引けないので、ここに最小の写しを置く（2 か所を同じ約束に保つ）
  function colorOf(S, c, dflt) {
    if (c == null || c === "") return colorOf(S, dflt || "ink");
    if (KEYS.includes(c)) return S[c];
    const m = /^s([1-9]\d*)$/.exec(c);
    if (m) { const sr = S.series && S.series.length ? S.series : [S.accent, S.good, S.ink]; return sr[(+m[1] - 1) % sr.length]; }
    if (/^(#|rgb|hsl)/i.test(c)) return c;
    return S.role(c);
  }

  // ---- 式 ----
  // 数はそのまま、文字列は値の名前か式。使える関数は sin cos tan sqrt abs exp log pow min max と PI。
  // 同じ文字列と名前の組は 1 度だけコンパイルする。未知の名前はコンパイルのときに例外にする
  const MATH = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log,
    pow: Math.pow, min: Math.min, max: Math.max, PI: Math.PI };
  const MNAMES = Object.keys(MATH), MVALS = MNAMES.map(k => MATH[k]);
  const EXPR_CACHE = new Map();
  UZ.spaceExpr = function (src, names) {
    if (typeof src === "number") return () => src;
    if (typeof src !== "string") throw new Error(`式は数か文字列で書く: ${JSON.stringify(src)}`);
    names = names || [];
    const key = names.join(",") + "\u0000" + src;
    let fn = EXPR_CACHE.get(key);
    if (fn) return fn;
    if (/["'`\\]/.test(src)) throw new Error(`式に使えない文字がある: ${src}`);
    const ids = src.replace(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, " ").match(/[A-Za-z_$][\w$]*/g) || [];
    for (const id of ids) if (!names.includes(id) && !MNAMES.includes(id)) throw new Error(`式の中の名前「${id}」が分からない（${src}）`);
    const args = names.filter(n => !MNAMES.includes(n));
    const body = new Function(...MNAMES, ...args, `"use strict"; return (${src});`);
    fn = (v, extra) => {
      const vals = args.map(n => extra && n in extra ? extra[n] : v ? v[n] : undefined);
      return +body(...MVALS, ...vals);
    };
    EXPR_CACHE.set(key, fn);
    return fn;
  };

  // ---- 投影とカメラ ----
  // bounds = {min:[x,y,z], max:[x,y,z]}。戻り値の project は [sx, sy, depth]（depth は大きいほど奥）、
  // dir はワールドのベクトルを視点の座標 [右, 上, 奥] に写す（平行移動なし。法線に使う）
  UZ.spaceCamera = function (o, w, h, bounds) {
    o = o || {};
    const psi = (+o.yaw || 0) * RAD, phi = clamp(+o.pitch || 0, -90, 90) * RAD;
    const cp = Math.cos(psi), sp = Math.sin(psi), cf = Math.cos(phi), sf = Math.sin(phi);
    const view = (x, y, z) => {
      const x1 = x * cp + y * sp, y1 = -x * sp + y * cp;
      return [x1, z * cf + y1 * sf, y1 * cf - z * sf];
    };
    const b = bounds || { min: [0, 0, 0], max: [0, 0, 0] };
    const R = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    const t = Array.isArray(o.target) ? o.target : [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2);
    const tv = view(t[0], t[1], t[2]);
    const s = finite(+o.scale) && +o.scale > 0 ? +o.scale : (finite(R) && R > 0 ? 0.9 * Math.min(w, h) / (2 * R) : 1);
    return {
      s, R: finite(R) ? R : 0,
      project: p => { const q = view(p[0], p[1], p[2]); return [w / 2 + s * (q[0] - tv[0]), h / 2 - s * (q[1] - tv[1]), q[2]]; },
      dir: p => view(p[0], p[1], p[2]),
    };
  };

  // ---- 面の明るさ（平ら）----
  const LRAW = [-0.4, 0.5, -0.75], LN = Math.hypot(...LRAW), LIGHT = LRAW.map(v => v / LN);
  UZ.spaceShade = function (color, n, S) {
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (!(nl > 0)) return color;
    const d = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / nl);
    const k = SPACE.shadeMin + (1 - SPACE.shadeMin) * d;
    return C.mix(color, S.bg, 1 - k);
  };

  // ---- 宣言の読み取り ----
  // decl = { items: [...], axes?, bounds? }。数を書く所は数か式（値の名前を使える）
  const gridOf = o => Math.max(1, Math.min(SPACE.gridMax, Math.round(+o.grid || SPACE.grid)));
  function mk(v) {
    const names = Object.keys(v || {});
    const ev = (x, extraNames) => UZ.spaceExpr(x, extraNames ? names.concat(extraNames) : names);
    const num = x => ev(x)(v);
    const pt = p => {
      if (!Array.isArray(p) || p.length !== 3) throw new Error(`3 次元の点は [x, y, z] で書く: ${JSON.stringify(p)}`);
      return [num(p[0]), num(p[1]), num(p[2])];
    };
    const range = r => {
      if (!Array.isArray(r) || r.length !== 2) throw new Error(`範囲は [最小, 最大] で書く: ${JSON.stringify(r)}`);
      return [num(r[0]), num(r[1])];
    };
    return { names, ev, num, pt, range };
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // 曲面・曲線の標本を、要素ごとに 1 度だけ取る（bounds とプリミティブで共有）
  function surfaceGrid(o, K) {
    const [x0, x1] = K.range(o.x), [y0, y1] = K.range(o.y), g = gridOf(o), f = K.ev(o.f, ["x", "y"]), P = [];
    for (let i = 0; i <= g; i++) {
      const row = [];
      for (let j = 0; j <= g; j++) { const x = x0 + (x1 - x0) * i / g, y = y0 + (y1 - y0) * j / g; row.push([x, y, f(K.v, { x, y })]); }
      P.push(row);
    }
    return P;
  }
  function curvePts(o, K) {
    if (!Array.isArray(o.fn) || o.fn.length !== 3) throw new Error("curve の fn は [x(t), y(t), z(t)] で書く");
    const [a, b] = K.range(o.t), n = Math.max(1, Math.min(512, Math.round(+o.n || 64))), fs = o.fn.map(e => K.ev(e, ["t"])), out = [];
    for (let i = 0; i <= n; i++) { const t = a + (b - a) * i / n; out.push(fs.map(f => f(K.v, { t }))); }
    return out;
  }

  // 内容の外接箱。axes があればその範囲、なければ decl.bounds、なければ要素を今の値で評価した外接箱
  UZ.spaceBounds = function (decl, v) {
    const K = mk(v); K.v = v || {};
    const rng = (r, d) => r ? K.range(r) : d;
    if (decl.axes && (decl.axes.x || decl.axes.y || decl.axes.z)) {
      const a = decl.axes, x = rng(a.x, [0, 0]), y = rng(a.y, [0, 0]), z = rng(a.z, [0, 0]);
      return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
    }
    if (decl.bounds) {
      const b = decl.bounds, x = rng(b.x, [0, 0]), y = rng(b.y, [0, 0]), z = rng(b.z, [0, 0]);
      return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
    }
    const pts = [];
    for (const o of decl.items || []) {
      if (o.kind === "point" || o.kind === "text") pts.push(K.pt(o.at));
      else if (o.kind === "line") (o.points ? o.points.map(K.pt) : [K.pt(o.from), K.pt(o.to)]).forEach(p => pts.push(p));
      else if (o.kind === "arrow") pts.push(K.pt(o.from), K.pt(o.to));
      else if (o.kind === "polygon") o.points.forEach(p => pts.push(K.pt(p)));
      else if (o.kind === "box") pts.push(K.pt(o.min), K.pt(o.max));
      else if (o.kind === "surface") surfaceGrid(o, K).forEach(r => r.forEach(p => pts.push(p)));
      else if (o.kind === "curve") curvePts(o, K).forEach(p => pts.push(p));
    }
    const ok = pts.filter(p => p.every(finite));
    if (!ok.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    const min = [0, 1, 2].map(i => Math.min(...ok.map(p => p[i]))), max = [0, 1, 2].map(i => Math.max(...ok.map(p => p[i])));
    return { min, max };
  };

  // ---- プリミティブ ----
  const niceStep = range => {
    const raw = Math.abs(range) / 6 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), k = raw / mag;
    return (k < 1.5 ? 1 : k < 3 ? 2 : k < 7 ? 5 : 10) * mag;
  };
  const fmt = x => { const s = (+x).toFixed(2); return String(+s === 0 ? 0 : +s); };

  UZ.spacePrims = function (decl, v, cam, S) {
    v = v || {};
    const K = mk(v); K.v = v;
    const out = [], R = cam.R || 0, off = 0.01 * R;
    const push = p => { out.push(p); if (out.length > SPACE.maxPrims) throw new Error(`プリミティブが多すぎる（上限 ${SPACE.maxPrims}）`); };
    const xy = p => { const q = cam.project(p); return [q[0], q[1]]; };
    const ok3 = p => p.every(finite);
    const depthOf = ps => ps.reduce((a, p) => a + cam.project(p)[2], 0) / ps.length;
    const face = (el, id, ps, color, o, normal) => {
      if (!ps.every(ok3)) return;
      const n = normal || polyNormal(ps);
      push({ el, id, kind: "face", pts: ps.map(xy), depth: depthOf(ps), color: UZ.spaceShade(color, cam.dir(n), S), opacity: o.opacity });
    };
    const polyNormal = ps => {   // Newell の法
      let n = [0, 0, 0];
      for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length];
        n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
      return n;
    };
    const seg = (el, id, a, b, color, o) => {
      if (!ok3(a) || !ok3(b)) return;
      push({ el, id, kind: "seg", pts: [xy(a), xy(b)], depth: (cam.project(a)[2] + cam.project(b)[2]) / 2 - off, color, opacity: o.opacity, width: o.width });
    };
    const text = (el, id, at, str, color, o) => {
      if (!ok3(at)) return;
      push({ el, id, kind: "text", pts: [xy(at)], depth: cam.project(at)[2] - off, color, text: String(str), tex: !!o.tex, opacity: o.opacity });
    };
    const label = (o, at, color) => { if (o.label != null) text(o.id, o.id + ":label", at, o.label, colorOf(S, o.labelColor, "ink"), {}); };

    // 軸と目盛り
    const A = decl.axes;
    if (A) {
      const b = UZ.spaceBounds(decl, v), mutedC = colorOf(S, "muted"), inkC = colorOf(S, "ink");
      const base = [0, 1, 2].map(i => clamp(0, b.min[i], b.max[i]));
      ["x", "y", "z"].forEach((nm, i) => {
        if (!A[nm]) return;
        const lo = b.min[i], hi = b.max[i], a = base.slice(), c = base.slice();
        a[i] = lo; c[i] = hi;
        seg("axes", `axes:${nm}`, a, c, mutedC, {});
        const st = niceStep(hi - lo);
        for (let t = Math.ceil(lo / st - 1e-9) * st, k = 0; t <= hi + 1e-9 && k < 40; t += st, k++) {
          const p = base.slice(); p[i] = t;
          text("axes", `axes:${nm}:tick:${fmt(t)}`, p, fmt(t), mutedC, {});
        }
        const lab = A.labels && A.labels[nm];
        if (lab != null) text("axes", `axes:${nm}:label`, c, lab, inkC, {});
      });
    }

    for (const o of decl.items || []) {
      if (!o || !o.id) continue;
      const id = o.id, color = colorOf(S, o.color, o.kind === "box" || o.kind === "polygon" || o.kind === "surface" ? "accent" : "ink");
      if (o.kind === "point") {
        const p = K.pt(o.at);
        if (ok3(p)) push({ el: id, id, kind: "dot", pts: [xy(p)], depth: cam.project(p)[2] - off, color: colorOf(S, o.color, "accent"), opacity: o.opacity, r: o.r });
        label(o, p);
      } else if (o.kind === "line") {
        const ps = o.points ? o.points.map(K.pt) : [K.pt(o.from), K.pt(o.to)], c = colorOf(S, o.color, "ink");
        for (let i = 1; i < ps.length; i++) seg(id, `${id}:${i - 1}`, ps[i - 1], ps[i], c, o);
      } else if (o.kind === "curve") {
        const ps = curvePts(o, K), c = colorOf(S, o.color, "accent");
        for (let i = 1; i < ps.length; i++) seg(id, `${id}:${i - 1}`, ps[i - 1], ps[i], c, o);
      } else if (o.kind === "arrow") {
        const a = K.pt(o.from), b = K.pt(o.to), c = colorOf(S, o.color, "accent");
        seg(id, `${id}:shaft`, a, b, c, o);
        if (ok3(a) && ok3(b)) {   // 矢じりは画面上の 2D
          const pa = xy(a), pb = xy(b), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
          if (len > 1e-6) {
            const ux = dx / len, uy = dy / len, hl = Math.min(12, len * 0.6), hw = hl * 0.5;
            push({ el: id, id: `${id}:head`, kind: "face", pts: [pb, [pb[0] - ux * hl - uy * hw, pb[1] - uy * hl + ux * hw], [pb[0] - ux * hl + uy * hw, pb[1] - uy * hl - ux * hw]],
              depth: cam.project(b)[2] - off, color: c, opacity: o.opacity });
          }
        }
        label(o, b);
      } else if (o.kind === "polygon") {
        face(id, id, o.points.map(K.pt), color, o);
        label(o, K.pt(o.points[0]));
      } else if (o.kind === "box") {
        const lo = K.pt(o.min), hi = K.pt(o.max), V = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
        const F = [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
          [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, -1, 0]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1], [0, 1, 0]],
          [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [-1, 0, 0]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]]];
        F.forEach((f, i) => face(id, `${id}:f${i}`, f.slice(0, 4).map(q => V(...q)), color, o, f[4]));
        label(o, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2]]);
      } else if (o.kind === "surface") {
        const P = surfaceGrid(o, K), g = P.length - 1;
        const zs = [].concat(...P).map(p => p[2]).filter(finite), zmin = Math.min(...zs), zmax = Math.max(...zs);
        const c2 = o.color2 ? colorOf(S, o.color2) : null;
        for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
          const q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]];
          if (!q.every(ok3)) continue;
          const zm = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4, c = c2 && zmax > zmin ? C.mix(color, c2, (zm - zmin) / (zmax - zmin)) : color;
          face(id, `${id}:${i}:${j}`, q, c, o, cross(sub(q[2], q[0]), sub(q[3], q[1])));
        }
      } else if (o.kind === "text") {
        text(id, id, K.pt(o.at), o.text, colorOf(S, o.color, "ink"), o);
      }
      // plate は Task 10。未知の種類は無視する
    }
    // 奥 → 手前（depth の大きい順。同じ奥行きは宣言の順を保つ）
    out.forEach((p, i) => { p._i = i; });
    out.sort((a, b) => b.depth - a.depth || a._i - b._i);
    out.forEach(p => { delete p._i; });
    return out;
  };
})(globalThis.UZ = globalThis.UZ || {});
