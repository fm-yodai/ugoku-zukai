// ugoku-zukai プレーヤー: 3D の核 UZ.space*（平行投影・カメラ・式・プリミティブの生成と奥からの並べ替え・面の平らな明るさ）。
// DOM に触らない。SVG への描画は view_svg.js の側（宣言の部品 space は engine / view_svg が使う）。
// 座標は右手系・z が上。yaw 0・pitch 0 で x が右、y が奥、z が上。視点の座標は x 右・y 上・z 奥。
(function (UZ) {
  "use strict";
  const C = UZ.color, clamp = UZ.clamp;
  const SPACE = UZ.SPACE = { maxPrims: 6000, grid: 24, gridMax: 64, plateMaxAngle: 70, shadeMin: 0.75 };
  const RAD = Math.PI / 180;
    const finite = v => typeof v === "number" && Number.isFinite(v);

  const colorOf = UZ.colorOf;   // geo.js と共有（色の名前の解決）

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
    const ids = src.replace(/(?<![\w$])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, " ").match(/[A-Za-z_$][\w$]*/g) || [];
    for (const id of ids) if (!names.includes(id) && !MNAMES.includes(id)) throw new Error(`式の中の名前「${id}」が分からない（${src}）`);
    const clash = names.find(n => MNAMES.includes(n));
    if (clash) throw new Error(`値の名前「${clash}」は式の関数・定数の名前と同じで使えない`);
    names = names.filter((n, i) => names.indexOf(n) === i);
    const args = names;
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
    const ev = (x, extraNames) => UZ.spaceExpr(x, extraNames ? names.concat(extraNames.filter(n => !names.includes(n))) : names);
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
      const b = decl.bounds;
      if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) throw new Error("bounds は { min: [x, y, z], max: [x, y, z] } で書く");
      return { min: K.pt(b.min), max: K.pt(b.max) };
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
      push({ id: el, key: id, kind: "face", pts: ps.map(xy), depth: depthOf(ps), color: UZ.spaceShade(color, cam.dir(n), S), opacity: o.opacity });
    };
    const polyNormal = ps => {   // Newell の法
      let n = [0, 0, 0];
      for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length];
        n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
      return n;
    };
    const seg = (el, id, a, b, color, o) => {
      if (!ok3(a) || !ok3(b)) return;
      push({ id: el, key: id, kind: "seg", pts: [xy(a), xy(b)], depth: (cam.project(a)[2] + cam.project(b)[2]) / 2 - off, color, opacity: o.opacity, width: o.width });
    };
    const text = (el, id, at, str, color, o) => {
      if (!ok3(at)) return;
      push({ id: el, key: id, kind: "text", pts: [xy(at)], depth: cam.project(at)[2] - off, color, text: String(str), tex: !!o.tex, opacity: o.opacity });
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
        seg("$axes", `axes:${nm}`, a, c, mutedC, {});
        const st = niceStep(hi - lo);
        for (let t = Math.ceil(lo / st - 1e-9) * st, k = 0; t <= hi + 1e-9 && k < 40; t += st, k++) {
          const p = base.slice(); p[i] = t;
          text("$axes", `axes:${nm}:tick:${fmt(t)}`, p, fmt(t), mutedC, {});
        }
        const lab = A.labels && A.labels[nm];
        if (lab != null) text("$axes", `axes:${nm}:label`, c, lab, inkC, {});
      });
    }

    for (const o of decl.items || []) {
      if (!o || !o.id) continue;
      const id = o.id, color = colorOf(S, o.color, o.kind === "box" || o.kind === "polygon" || o.kind === "surface" ? "accent" : "ink");
      if (o.kind === "point") {
        const p = K.pt(o.at);
        if (ok3(p)) push({ id, key: id, kind: "dot", pts: [xy(p)], depth: cam.project(p)[2] - off, color: colorOf(S, o.color, "accent"), opacity: o.opacity, r: o.r });
        label(o, p);
      } else if (o.kind === "line") {
        const ps = o.points ? o.points.map(K.pt) : [K.pt(o.from), K.pt(o.to)], c = colorOf(S, o.color, "ink");
        for (let i = 1; i < ps.length; i++) seg(id, `${id}:${i - 1}`, ps[i - 1], ps[i], c, o);
      } else if (o.kind === "curve") {
        const ps = curvePts(o, K), c = colorOf(S, o.color, "accent");
        for (let i = 1; i < ps.length; i++) seg(id, `${id}:${i - 1}`, ps[i - 1], ps[i], c, o);
      } else if (o.kind === "arrow") {
        const a = K.pt(o.from), b = K.pt(o.to), c = colorOf(S, o.color, "accent");
        if (ok3(a) && ok3(b)) {   // 矢じりは画面上の 2D。軸は矢じりの根元まで
          const pa = xy(a), pb = xy(b), dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
          if (len > 1e-6) {
            const ux = dx / len, uy = dy / len, hl = Math.min(12, len * 0.6), hw = hl * 0.5, f = (len - hl) / len;
            push({ id, key: `${id}:shaft`, kind: "seg", pts: [pa, [pa[0] + dx * f, pa[1] + dy * f]], depth: (cam.project(a)[2] + cam.project(b)[2]) / 2 - off, color: c, opacity: o.opacity, width: o.width });
            push({ id, key: `${id}:head`, kind: "face", pts: [pb, [pb[0] - ux * hl - uy * hw, pb[1] - uy * hl + ux * hw], [pb[0] - ux * hl + uy * hw, pb[1] - uy * hl - ux * hw]],
              depth: cam.project(b)[2] - off, color: c, opacity: o.opacity });
          } else seg(id, `${id}:shaft`, a, b, c, o);
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

  // ---- 部品のカメラ ----
  // 宣言の camera（数か式）を今の値で読み、区画 w × h のカメラを作る。外接箱は axes か bounds があればそれ（今の値で読む）。
  // どちらもなければ、初めの値 v0 で要素を評価した外接箱を 1 度だけ求めて使う（set で要素が動いても、全体が寄ったり縮んだりしない）。
  // v0 を省くと今の値で求める
  const B0 = new WeakMap();   // decl → { v0, b }
  UZ.spaceView = function (decl, v, w, h, v0) {
    v = v || {};
    const names = Object.keys(v), ev = x => UZ.spaceExpr(x, names)(v), c = decl.camera || {};
    const camO = { yaw: c.yaw != null ? ev(c.yaw) : 0, pitch: c.pitch != null ? ev(c.pitch) : 0 };
    if (c.scale != null) camO.scale = ev(c.scale);
    if (c.target != null) camO.target = c.target.map(ev);
    const fixed = (decl.axes && (decl.axes.x || decl.axes.y || decl.axes.z)) || decl.bounds;
    let b;
    if (fixed || !v0) b = UZ.spaceBounds(decl, v);
    else {
      const hit = B0.get(decl);
      if (hit && hit.v0 === v0) b = hit.b;
      else { b = UZ.spaceBounds(decl, v0); B0.set(decl, { v0, b }); }
    }
    return UZ.spaceCamera(camO, w, h, b);
  };

  // 文字のプリミティブの置き方（spaceRender と spacePrimBox が共有）: 目盛りは 13px、ほかは 18px。:label は右上にずらして左揃え
  const TEXT = { size: 18, tick: 13, labelDx: 10, labelDy: -14 };
  const textPlace = p => {
    const tick = /:tick:/.test(p.key), lab = /:label$/.test(p.key);
    return { tick, lab, size: tick ? TEXT.tick : TEXT.size, x: p.pts[0][0] + (lab ? TEXT.labelDx : 0), y: p.pts[0][1] + (lab ? TEXT.labelDy : 0), anchor: lab ? "start" : "middle" };
  };

  // プリミティブの画面上の矩形（spaceRender と同じ大きさ・ずらし。文字の幅は見積もり。TeX は元の文字列で見積もる）
  UZ.spacePrimBox = function (p) {
    const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (p.kind === "seg") { const r = (p.width || 2.5) / 2; x0 -= r; x1 += r; y0 -= r; y1 += r; }
    else if (p.kind === "dot") { const r = (p.r || 6) + 0.75; x0 -= r; x1 += r; y0 -= r; y1 += r; }
    else if (p.kind === "text") {
      const { size, x, y, anchor } = textPlace(p);
      const tw = UZ.textW(p.tex ? p.text.replace(/\\[A-Za-z]+|[{}^_]/g, "") || p.text : p.text, size);
      x0 = anchor === "start" ? x : x - tw / 2; x1 = x0 + tw; y0 = y - size / 2; y1 = y + size / 2;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const unionBox = bs => {
    if (!bs.length) return null;
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  UZ.spaceUnionBox = unionBox;
  // 色を使わないときの仮のテーマ（外接矩形だけを求めるとき）
  const NOS = new Proxy({}, { get: (o, k) => (k === "role" ? () => "#000000" : k === "series" ? null : "#000000") });

  // 要素 id の、値 v で投影した外接矩形（部品のローカル座標 = 区画の左上が原点）。F = engine の図（F.spec = 宣言、F.v0 = 初めの値）。
  // 描くものがなければ null（値が数にならないなど）。S は省ける（色は使わない）
  UZ.spaceBBox = function (F, id, v, w, h, S) {
    const decl = F.spec, cam = UZ.spaceView(decl, v, w, h, F.v0);
    return unionBox(UZ.spacePrims(decl, v, cam, S || NOS).filter(p => p.id === id).map(UZ.spacePrimBox));
  };

  // ---- 交差する面 ----
  // surface 以外の面（polygon と box の面）のうち、3D で交差する要素の組 [[idA, idB], …]（宣言の順）。
  // 縁や角で触れるだけ・同じ平面に重なるだけは数えない（触れるだけなら奥から塗る順で破綻しない）。plate は Task 10 で足す
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  UZ.spaceIntersections = function (decl, v) {
    const K = mk(v); K.v = v || {};
    const els = [];
    for (const o of decl.items || []) {
      if (!o || !o.id) continue;
      let faces = [];
      if (o.kind === "polygon") faces = [o.points.map(K.pt)];
      else if (o.kind === "box") {
        const lo = K.pt(o.min), hi = K.pt(o.max), V = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
        faces = [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
          [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]].map(f => f.map(q => V(...q)));
      } else continue;
      faces = faces.filter(ps => ps.length >= 3 && ps.every(p => p.every(finite)));
      if (faces.length) els.push({ id: o.id, faces });
    }
    if (els.length < 2) return [];
    const all = [].concat(...els.map(e => [].concat(...e.faces)));
    const L = Math.hypot(...[0, 1, 2].map(i => Math.max(...all.map(p => p[i])) - Math.min(...all.map(p => p[i])))) || 1;
    const ePlane = 1e-7 * L, eIn = 1e-5 * L;
    // 面の下ごしらえ: 単位法線・平面の距離・2D に落とす軸・外接箱
    const prep = ps => {
      let n = [0, 0, 0];
      for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length];
        n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
      const nl = Math.hypot(...n);
      if (!(nl > 1e-12 * L * L)) return null;
      n = n.map(x => x / nl);
      const ax = [0, 1, 2].reduce((m, i) => Math.abs(n[i]) > Math.abs(n[m]) ? i : m, 0), u = (ax + 1) % 3, w = (ax + 2) % 3;
      return { ps, n, d: dot3(n, ps[0]), p2: ps.map(p => [p[u], p[w]]), u, w,
        min: [0, 1, 2].map(i => Math.min(...ps.map(p => p[i]))), max: [0, 1, 2].map(i => Math.max(...ps.map(p => p[i]))) };
    };
    // 点が多角形の内側にあり、どの辺からも eIn より離れている
    const inside = (q, P) => {
      const x = q[P.u], y = q[P.w], r = P.p2;
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy, t = l2 > 0 ? clamp(((x - xi) * dx + (y - yi) * dy) / l2) : 0;
        if (Math.hypot(x - xi - t * dx, y - yi - t * dy) <= eIn) return false;   // 2D に落とすと距離は縮むだけ（縁の近くは数えない）
      }
      return c;
    };
    // 線分 a-b が面 P の内側を横切る（両端が平面の反対側にある）
    const crosses = (a, b, P) => {
      const da = dot3(P.n, a) - P.d, db = dot3(P.n, b) - P.d;
      if (!((da > ePlane && db < -ePlane) || (da < -ePlane && db > ePlane))) return false;
      const t = da / (da - db);
      return inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], P);
    };
    const edgesHit = (A, B) => A.ps.some((a, i) => crosses(a, A.ps[(i + 1) % A.ps.length], B));
    // 面 P が平面 Q と交わる所（辺が平面を横切る点と、平面の上にある頂点）
    const cutPts = (P, Q) => {
      const out = [];
      P.ps.forEach((a, i) => {
        const b = P.ps[(i + 1) % P.ps.length], da = dot3(Q.n, a) - Q.d, db = dot3(Q.n, b) - Q.d;
        if (Math.abs(da) <= ePlane) out.push(a);
        else if ((da > ePlane && db < -ePlane) || (da < -ePlane && db > ePlane)) { const t = da / (da - db); out.push([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t)); }
      });
      return out;
    };
    // 2 枚の面が、互いの平面と交わる線分の重なり（共通の直線の上）を持ち、その真ん中が両方の面の内側にある。
    // 同じ大きさの 2 枚が十字に貫き合うとき（どの辺も相手の縁で交わる）も拾う。縁で触れるだけなら真ん中が縁にあるので数えない
    const midHit = (A, B) => {
      const d = cross(A.n, B.n), dl = Math.hypot(...d);
      if (!(dl > 1e-9)) return false;   // 平行（同じ平面を含む）
      const u = d.map(x => x / dl), pa = cutPts(A, B), pb = cutPts(B, A);
      if (pa.length < 2 || pb.length < 2) return false;
      const ta = pa.map(p => dot3(u, p)), tb = pb.map(p => dot3(u, p));
      const lo = Math.max(Math.min(...ta), Math.min(...tb)), hi = Math.min(Math.max(...ta), Math.max(...tb));
      if (!(hi - lo > eIn)) return false;
      const tm = (lo + hi) / 2, p0 = pa[0], k = tm - ta[0], m = [0, 1, 2].map(i => p0[i] + u[i] * k);
      return inside(m, A) && inside(m, B);
    };
    const boxOver = (A, B) => [0, 1, 2].every(i => A.min[i] <= B.max[i] + ePlane && B.min[i] <= A.max[i] + ePlane);
    const P = els.map(e => e.faces.map(prep).filter(Boolean)), out = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const hit = P[i].some(A => P[j].some(B => boxOver(A, B) && (edgesHit(A, B) || edgesHit(B, A) || midHit(A, B))));
      if (hit) out.push([els[i].id, els[j].id]);
    }
    return out;
  };

  // ---- 宣言の部品 space の描画 ----
  // 要素の既定の色（spacePrims と同じ。tint で混ぜる元の色を決めるのに使う）
  UZ.spaceDefaultColor = kind => (kind === "line" || kind === "text" ? "ink" : "accent");
  const DRAW = { line: 0.7, fill: [0.65, 0.35] };   // draw の区間（view_svg の箱と同じ: 線が 0〜0.7 で伸び、面と文字は 0.65 から）
  const smooth = UZ.smooth, n2 = x => (Math.round(x * 100) / 100).toFixed(2);
  // コマの状態（UZ.frame の st）から、要素ごとの見え方を作る。F = engine の図（items に s3 と draw）。
  // 返す形: { [要素の id]: { opacity（面・点・文字）, line（線）, draw（線の伸び 0〜1）, dim, pulse, tint, tintP, tintFrom } }。
  // 軸（$axes）は描き場（draw）の状態に従い、要素がどれか出ていれば一緒に出る
  UZ.spaceStates = function (F, st) {
    const out = {}, one = s => {
      const show = s ? s.show || 0 : 0, drawing = !!(s && s.draw) && show < 1;
      return { opacity: drawing ? smooth((show - DRAW.fill[0]) / DRAW.fill[1]) : smooth(show), line: drawing ? (show > 0 ? 1 : 0) : smooth(show),
        draw: drawing ? smooth(clamp(show / DRAW.line)) : 1, dim: s && s.dim != null ? s.dim : 1, pulse: s && s.pulse || 0,
        tint: s && s.tint || null, tintP: s && s.tint ? (s.tintP ?? 1) : 0, tintFrom: s && s.tintFrom || null, show };
    };
    let maxShow = 0;
    for (const it of Object.values(F.items)) if (it.kind === "s3") { const o = out[it.id] = one(st[it.key || `${F.id}/${it.id}`]); maxShow = Math.max(maxShow, o.show); }
    const d = st[`${F.id}/draw`];
    out.$axes = one({ ...(d || {}), show: Math.max(d ? d.show || 0 : 0, maxShow) });
    return out;
  };

  // 部品を、描き場 g（部品のローカル座標。w × h は区画の px）に描く。el は要素を作る関数（ブラウザは view_svg の el、node は svg_dom）。
  // decl = 部品の宣言、v = 今の値、states = UZ.spaceStates の結果（なければ全部出ている）。式の誤りは例外。TeX の誤りは { errors } で返す
  // v0 = 台本の初めの値（engine の図の F.v0）。axes も bounds もないとき、自動の大きさと中心はこの値で決める
  UZ.spaceRender = function (el, g, decl, v, w, h, states, S, v0) {
    v = v || {};
    const cam = UZ.spaceView(decl, v, w, h, v0);
    const ALL = { opacity: 1, line: 1, draw: 1, dim: 1, pulse: 0, tint: null, tintP: 0 };
    const stOf = id => (states && states[id]) || (states ? null : ALL);
    // tint: 宣言の色を、混ぜた色に置き換えてから投影する（面の明るさは混ぜた色に掛かる）
    const items = (decl.items || []).map(o => {
      const s = stOf(o.id);
      if (!s || !s.tint || !(s.tintP > 0)) return o;
      const from = s.tintFrom || colorOf(S, o.color, UZ.spaceDefaultColor(o.kind));
      const o2 = { ...o, color: C.mix(from, s.tint, clamp(s.tintP)) };
      if (o.color2) o2.color2 = C.mix(s.tintFrom || colorOf(S, o.color2), s.tint, clamp(s.tintP));
      return o2;
    });
    const prims = UZ.spacePrims({ ...decl, items }, v, cam, S);
    // 線の伸び（draw）は要素の線分を順に伸ばす。要素ごとの線分の数
    const segN = {};
    for (const p of prims) if (p.kind === "seg") segN[p.id] = (segN[p.id] || 0) + 1;
    let geo = null;
    const errors = [];
    for (const p of prims) {
      const s = stOf(p.id);
      if (!s) continue;
      const k = p.opacity != null ? p.opacity : 1, dim = s.dim, pulse = s.pulse || 0;
      const fillO = s.opacity * dim * k, lineO = s.line * dim * k;
      const tag = { "data-s3": p.id };
      if (p.kind === "seg") {
        if (!(lineO > 0.002)) continue;
        // 点列の線分（key が「id:番号」）は番号の順に伸ばし、軸や矢の軸のような 1 本の線分はそのまま伸ばす
        const m = /:(\d+)$/.exec(p.key), n = segN[p.id] || 1;
        const q = s.draw >= 1 ? 1 : m ? clamp(s.draw * n - Math.min(+m[1], n - 1)) : s.draw;
        if (!(q > 0)) continue;
        const [a, b] = p.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const attrs = { ...tag, d: `M${n2(a[0])},${n2(a[1])}L${n2(b[0])},${n2(b[1])}`, fill: "none", stroke: p.color, "stroke-width": n2((p.width || 2.5) * (1 + 0.6 * pulse)),
          "stroke-linecap": "round", opacity: n2(lineO) };
        if (q < 1) { attrs["stroke-dasharray"] = `${n2(L)} ${n2(L)}`; attrs["stroke-dashoffset"] = n2((1 - q) * L); }
        el("path", attrs, g);
      } else if (p.kind === "face") {
        const drawing = s.draw < 1 || s.line > s.opacity + 1e-6;
        if (!(fillO > 0.002) && !(drawing && lineO > 0.002 && s.draw > 0)) continue;
        const d = "M" + p.pts.map(q => `${n2(q[0])},${n2(q[1])}`).join("L") + "Z";
        const attrs = { ...tag, d, fill: p.color, "fill-opacity": n2(fillO), "stroke-linejoin": "round" };
        if (drawing) {
          const L = p.pts.reduce((a, q, i) => a + Math.hypot(q[0] - p.pts[(i + 1) % p.pts.length][0], q[1] - p.pts[(i + 1) % p.pts.length][1]), 0);
          Object.assign(attrs, { stroke: p.color, "stroke-width": "1.50", "stroke-opacity": n2(lineO) });
          if (s.draw < 1) { attrs["stroke-dasharray"] = `${n2(L)} ${n2(L)}`; attrs["stroke-dashoffset"] = n2((1 - s.draw) * L); }
        } else if (pulse > 0) Object.assign(attrs, { stroke: p.color, "stroke-width": n2(0.6 + 3 * pulse), "stroke-opacity": n2(fillO) });
        else if (k >= 1) Object.assign(attrs, { stroke: p.color, "stroke-width": "0.60", "stroke-opacity": n2(fillO) });   // 曲面の網目の継ぎ目を隠す
        el("path", attrs, g);
      } else if (p.kind === "dot") {
        if (!(fillO > 0.002)) continue;
        el("circle", { ...tag, cx: n2(p.pts[0][0]), cy: n2(p.pts[0][1]), r: n2((p.r || 6) * (1 + 0.4 * pulse)), fill: p.color, stroke: S.bg, "stroke-width": "1.50", opacity: n2(fillO) }, g);
      } else if (p.kind === "text") {
        if (!(fillO > 0.002)) continue;
        const { tick, size, x, y, anchor } = textPlace(p);
        if (p.tex) {
          geo = geo || UZ.makeGeo(el, S);
          const wrap = el("g", { ...tag, opacity: n2(fillO) }, g);
          const r = geo.tex(wrap, p.text, { x, y, size, color: p.color, anchor });
          wrap.setAttribute("transform", `translate(0,${n2(-r.h / 2)})`);
          errors.push(...geo.errors); geo.errors.length = 0;
        } else {
          const t = el("text", { ...tag, x: n2(x), y: n2(y), "font-size": size, "font-family": S.font, "font-weight": tick ? 400 : 500, fill: p.color,
            "text-anchor": anchor, "dominant-baseline": "central", stroke: S.bg, "stroke-width": 4, "stroke-linejoin": "round", "paint-order": "stroke", opacity: n2(fillO) }, g);
          t.textContent = p.text;
        }
      }
    }
    return { errors };
  };
})(globalThis.UZ = globalThis.UZ || {});
