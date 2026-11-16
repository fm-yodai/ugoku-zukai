// ugoku-zukai プレーヤー: 提案資料の図（M1b）。スイムレーン・As-Is/To-Be・ロードマップ・ツリー・グラフ・KPI・2×2・ピラミッド/ファネル・サイクル・ベン図。
// figures.js と同じく、図の中の座標で部品を並べて { w, h, items, order } を返す。
(function (UZ) {
  "use strict";
  const C = UZ.color;
  const FIG = UZ.FIG;
  const T = UZ.mkText;

  // 箱（ノード）を 1 つ作る。label は 1〜2 行、sub は小さく下に
  function nodeBox(S, id, label, o = {}) {
    // o.k: 補足（sub）の文字の倍率（区画に合わせて組むとき）
    const size = o.size || 22, maxW = o.maxW || 220, k = o.k || 1, subSize = Math.round(16 * k), subLH = Math.round(21 * k);
    const lines = UZ.wrap(label, size, maxW, 500, 2);
    const subLines = o.sub ? UZ.wrap(o.sub, subSize, Math.max(maxW, 150 * k), 400, 2) : [];
    const w = Math.max(o.minW || 120, ...lines.map(s => UZ.textW(s, size, 500) + 40), ...subLines.map(s => UZ.textW(s, subSize) + 30));
    const h = Math.max(o.minH || 0, 26 * k + lines.length * (size + 8) + subLines.length * subLH);
    return { id, w: Math.round(w), h: Math.round(h), lines, subLines, size, subSize, subLH, role: o.role || "process", shape: o.shape || "box" };
  }
  function placeBox(S, nb, x, y, extra = {}) {
    const cx = x + nb.w / 2, lh = nb.size + 8, ss = nb.subSize || 16, sl = nb.subLH || 21;
    const blockH = nb.lines.length * lh + nb.subLines.length * sl;
    const top = y + nb.h / 2 - blockH / 2;
    const texts = [T(nb.lines, cx, top + nb.lines.length * lh / 2, nb.size, { weight: 500, color: S.label(nb.role), lineH: lh })];
    if (nb.subLines.length) texts.push(T(nb.subLines, cx, top + nb.lines.length * lh + nb.subLines.length * sl / 2, ss, { color: S.muted, lineH: sl }));
    const color = S.border(nb.role);
    return { id: nb.id, kind: "box", x, y, w: nb.w, h: nb.h, r: nb.shape === "round" ? nb.h / 2 : S.radius, shape: nb.shape,
      stroke: color, fill: S.fill(nb.role), texts, bbox: { x, y, w: nb.w, h: nb.h }, dotAt: [cx, y + nb.h - 12], ...extra };
  }
  function edgeItem(S, id, pts, o = {}) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { id, kind: "edge", pts, stroke: o.stroke || S.muted, width: o.width || S.edgeW, dashed: !!o.dashed, head: o.head !== false, label: o.label || null,
      from: o.from, to: o.to, bbox: { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: Math.max(...xs) - Math.min(...xs) + 6, h: Math.max(...ys) - Math.min(...ys) + 6 } };
  }
  // 折れ線の一番長い区間の中点にラベルを置く（横の区間なら上、縦なら右）
  function labelOn(S, pts, text, size = 18) {
    if (!text) return null;
    let best = 1, bl = -1;
    for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (L > bl) { bl = L; best = i; } }
    const a = pts[best - 1], b = pts[best], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    return horiz ? T(text, mx, my - size * 0.9, size, { color: S.ink }) : T(text, mx + 10, my, size, { anchor: "start", color: S.ink });
  }
  // 全部の部品が入るように原点を詰める
  function fit(items, pad = 6) {
    const bs = [];
    for (const it of items) {
      if (it.kind === "group") continue;
      if (it.bbox) bs.push(it.bbox);
      if (it.label) bs.push(it.label.bbox);
      for (const t of it.texts || []) bs.push(t.bbox);
    }
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
    const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    UZ.shiftItems(items, -x0 + pad, -y0 + pad);
    return { w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }
  // 辺の宣言から「宣言の順にノード → 両端が出た辺」の表示順を作る
  function revealOrder(nodeIds, edges, head = []) {
    const out = head.slice(), shown = new Set(), left = edges.slice();
    for (const id of nodeIds) {
      out.push(id); shown.add(id);
      for (let i = 0; i < left.length; i++) if (shown.has(left[i].from) && shown.has(left[i].to)) { out.push(left[i].id); left.splice(i, 1); i--; }
    }
    return out;
  }
  const niceStep = (span, n) => {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  };
  const fmtNum = (v, dec) => {
    const s = Number(v).toFixed(dec ?? (Math.abs(v) < 10 && v % 1 ? 1 : 0));
    const [i, d] = s.split(".");
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "");
  };
  UZ.fmtNum = fmtNum;

  // ======== スイムレーン（swimlane）========
  // 横の帯 = 担当（lane）、左から右へ手順が進む。列は辺から自動で決める（steps[].col で固定もできる）
  FIG.swimlane = {
    async layout(f, S) {
      const lanes = f.lanes, laneIdx = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
      const steps = f.steps, byId = Object.fromEntries(steps.map(s => [s.id, s]));
      const edges = (f.edges || []).map(e => ({ ...e, id: e.id || `${e.from}>${e.to}` }));
      // 列: 前の手順の列 + 1（同じ担当で列がぶつかれば右へずらす）
      const col = {};
      const preds = id => edges.filter(e => e.to === id && !e.back).map(e => e.from);
      const visit = (id, stack = new Set()) => {
        if (col[id] != null) return col[id];
        if (stack.has(id)) return 0;
        stack.add(id);
        const ps = preds(id);
        // 隣の担当からの受け渡しは同じ列に縦に置く（横に長くしない）。同じ担当か離れた担当なら右の列へ
        const step = p => (Math.abs(laneIdx[byId[p].lane] - laneIdx[byId[id].lane]) === 1 ? 0 : 1);
        col[id] = byId[id].col != null ? byId[id].col : ps.length ? Math.max(...ps.map(p => visit(p, stack) + step(p))) : 0;
        return col[id];
      };
      steps.forEach(s => visit(s.id));
      const used = new Set();
      for (const s of steps) { let c = col[s.id]; while (used.has(`${s.lane}:${c}`)) c++; col[s.id] = c; used.add(`${s.lane}:${c}`); }
      const nb = Object.fromEntries(steps.map(s => [s.id, nodeBox(S, s.id, s.label, { sub: s.sub, role: s.role || lanes[laneIdx[s.lane]].role || "process", maxW: 190, minW: 140, shape: s.shape })]));
      const ncol = Math.max(...Object.values(col)) + 1;
      const colW = Math.max(...Object.values(nb).map(b => b.w)) + 70;
      const laneLabelW = Math.max(110, ...lanes.map(l => Math.min(150, UZ.textW(l.label, 19, 500)) + 32));
      const laneH = lanes.map((l, i) => Math.max(110, ...steps.filter(s => s.lane === l.id).map(s => nb[s.id].h + 44)));
      const laneY = [0]; laneH.forEach(h => laneY.push(laneY[laneY.length - 1] + h));
      const W = laneLabelW + ncol * colW + 10, items = [], order = [];
      lanes.forEach((l, i) => {
        const bb = { x: 0, y: laneY[i], w: W, h: laneH[i] };
        const t = T(UZ.wrap(l.label, 19, laneLabelW - 24, 500, 3), 14, bb.y + bb.h / 2, 19, { anchor: "start", weight: 500, color: S.muted });
        items.push({ id: l.id, kind: "band", ...bb, r: 6, texts: [t], bbox: bb, members: steps.filter(s => s.lane === l.id).map(s => s.id), lane: true, labelW: laneLabelW });
        order.push(l.id);
      });
      const box = {};
      for (const s of steps) {
        const b = nb[s.id], li = laneIdx[s.lane];
        const x = laneLabelW + col[s.id] * colW + (colW - b.w) / 2, y = laneY[li] + (laneH[li] - b.h) / 2;
        box[s.id] = placeBox(S, b, x, y);
        items.push(box[s.id]);
      }
      for (const e of edges) {
        const a = box[e.from], b = box[e.to];
        if (!a || !b) continue;
        const ay = a.y + a.h / 2, by = b.y + b.h / 2;
        let pts;
        if (b.x > a.x + a.w - 1) {
          const x0 = a.x + a.w, x1 = b.x, mx = x1 - 26;
          pts = Math.abs(ay - by) < 1 ? [[x0, ay], [x1, by]] : [[x0, ay], [mx, ay], [mx, by], [x1, by]];
        } else if (Math.abs(a.x + a.w / 2 - b.x - b.w / 2) < 1) {
          pts = by > ay ? [[a.x + a.w / 2, a.y + a.h], [b.x + b.w / 2, b.y]] : [[a.x + a.w / 2, a.y], [b.x + b.w / 2, b.y + b.h]];
        } else {
          // 戻り: 下を回る
          const yb = Math.max(a.y + a.h, b.y + b.h) + 18;
          pts = [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, yb], [b.x + b.w / 2, yb], [b.x + b.w / 2, b.y + b.h]];
        }
        items.push(edgeItem(S, e.id, pts, { label: labelOn(S, pts, e.label), dashed: e.style === "dashed", from: e.from, to: e.to }));
      }
      const fin = revealOrder(steps.map(s => s.id), edges, order);
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order: fin };
    },
  };

  // ======== As-Is / To-Be（beforeafter）========
  // 左右 2 枚の板。各板は上から下へ進む手順（flow: false なら箇条）。間に大きな矢印
  FIG.beforeafter = {
    async layout(f, S) {
      const sides = [["before", f.before, f.before.role || "muted"], ["after", f.after, f.after.role || "added"]];
      const flow = f.flow !== false, items = [], order = [];
      const panelW = 430, gapMid = 150, headH = 58, pad = 26;
      const cols = sides.map(([key, side, role], si) => {
        const x0 = si * (panelW + gapMid);
        let y = headH + 22;
        const placed = side.steps.map((st, i) => {
          const o = typeof st === "string" ? { id: `${key}.${i + 1}`, text: st } : { id: st.id || `${key}.${i + 1}`, ...st };
          const b = nodeBox(S, o.id, o.text || o.label, { sub: o.sub, role: o.role || role, maxW: panelW - pad * 2 - 40, minW: panelW - pad * 2, size: 20 });
          const it = placeBox(S, b, x0 + pad, y, { parent: key });
          if (o.mark) it.staticMark = { kind: o.mark, x: it.x + it.w - 20, y: it.y + it.h / 2 };
          y += b.h + (flow ? 34 : 16);
          return it;
        });
        return { key, side, role, x0, placed, h: y - (flow ? 34 : 16) + pad };
      });
      const H = Math.max(...cols.map(c => c.h));
      for (const c of cols) {
        const color = S.role(c.role);
        const label = T(UZ.wrap(c.side.label || (c.key === "before" ? "As-Is" : "To-Be"), 25, panelW - 40, S.bold, 1), c.x0 + panelW / 2, headH / 2, 25, { weight: S.bold, color: S.ink });
        items.push({ id: c.key, kind: "box", x: c.x0, y: 0, w: panelW, h: H, r: S.radius + 2, stroke: color, fill: C.rgba(color, 0.05), header: { h: headH, fill: C.rgba(color, 0.2) },
          texts: [label], bbox: { x: c.x0, y: 0, w: panelW, h: H }, members: c.placed.flatMap((p, i) => (flow && i > 0 ? [`${c.placed[i - 1].id}>${p.id}`, p.id] : [p.id])), panel: true });
        order.push(c.key);
        c.placed.forEach((it, i) => {
          items.push(it); order.push(it.id);
          if (flow && i > 0) {
            const p = c.placed[i - 1], x = p.x + p.w / 2;
            const e = edgeItem(S, `${p.id}>${it.id}`, [[x, p.y + p.h + 3], [x, it.y - 3]], { from: p.id, to: it.id });
            items.push(e); order.push(e.id);
          }
        });
      }
      const ax0 = panelW + 20, ax1 = panelW + gapMid - 20, ay = H / 2;
      const arrowLab = f.arrow ? T(UZ.wrap(f.arrow, 19, gapMid + 40, 700, 3), (ax0 + ax1) / 2, ay - 46, 19, { weight: 700, color: S.accent }) : null;
      items.push({ id: "arrow", kind: "edge", pts: [[ax0, ay], [ax1, ay]], stroke: S.accent, width: 7, head: true, headScale: 2.2, label: arrowLab,
        bbox: { x: ax0, y: ay - 8, w: ax1 - ax0, h: 16 } });
      // 表示順: 左の板 → 矢印 → 右の板
      const leftIds = order.filter(id => id === "before" || cols[0].placed.some(p => id === p.id || id.startsWith(p.id + ">")));
      const rightIds = order.filter(id => !leftIds.includes(id));
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order: [...leftIds, "arrow", ...rightIds] };
    },
  };

  // ======== ロードマップ（roadmap）========
  // 横 = 期間（periods）、縦 = 流れ（tracks）。items は帯（from〜to）かマイルストーン（at）
  FIG.roadmap = {
    async layout(f, S) {
      const P = f.periods.map(p => (typeof p === "string" ? { id: p, label: p } : p));
      const pIdx = Object.fromEntries(P.map((p, i) => [p.id, i]));
      const tracks = f.tracks && f.tracks.length ? f.tracks : [{ id: "_", label: "" }];
      const trackLabelW = tracks.length > 1 || tracks[0].label ? Math.max(120, ...tracks.map(t => Math.min(170, UZ.textW(t.label, 19, 500)) + 30)) : 0;
      const colW = Math.max(150, Math.min(260, (1150 - trackLabelW) / P.length));
      const headH = 50, barH = 46, rowGap = 14, items = [], order = [];
      const X = i => trackLabelW + i * colW;
      // 期間の見出し
      P.forEach((p, i) => {
        const t = T(p.label, X(i) + colW / 2, headH / 2, 20, { weight: S.bold, color: S.ink });
        items.push({ id: p.id, kind: "text", texts: [t], bbox: { x: X(i), y: 0, w: colW, h: headH }, period: true });
      });
      // 帯の行割り: 同じ流れで期間が重なれば下の段へ
      let y = headH + 14;
      const bars = [];
      const trackRows = tracks.map(tr => {
        const its = f.items.filter(it => (it.track || "_") === tr.id);
        const rows = [];
        for (const it of its) {
          const a = pIdx[it.at ?? it.from], b = it.at != null ? a : pIdx[it.to ?? it.from];
          let r = 0;
          while ((rows[r] || []).some(([s, e]) => !(b < s || a > e))) r++;
          (rows[r] = rows[r] || []).push([a, b]);
          bars.push({ it, a, b, r, tr });
        }
        const n = Math.max(1, rows.length), h = n * barH + (n - 1) * rowGap + 30;
        const row = { tr, y, h };
        y += h + 8;
        return row;
      });
      const H = y - 8;
      // 期間の縦の区切り線
      for (let i = 0; i <= P.length; i++) items.push({ id: `grid${i}`, kind: "edge", pts: [[X(i), headH], [X(i), H]], stroke: S.line, width: 1.2, head: false, dashed: i > 0 && i < P.length, deco: true, bbox: { x: X(i), y: headH, w: 1, h: H - headH } });
      for (const row of trackRows) {
        const bb = { x: 0, y: row.y, w: X(P.length), h: row.h };
        const t = row.tr.label ? T(UZ.wrap(row.tr.label, 19, trackLabelW - 24, 500, 3), 14, bb.y + bb.h / 2, 19, { anchor: "start", weight: 500, color: S.muted }) : null;
        items.push({ id: row.tr.id, kind: "band", ...bb, r: 6, texts: t ? [t] : [], bbox: bb, members: bars.filter(b => b.tr === row.tr).map(b => b.it.id), lane: true });
        order.push(row.tr.id);
      }
      // 矢印（links）: 右の期間の項目へは横向き、期間が重なる項目へは縦向き。横向きの矢印が出入りする帯の端は、矢じりが入るぶん短くする
      const barOf = Object.fromEntries(bars.map(b => [b.it.id, b]));
      const links = (f.links || []).filter(l => barOf[l.from] && barOf[l.to] && l.from !== l.to).map(l => ({ ...l, A: barOf[l.from], B: barOf[l.to] }));
      for (const l of links) l.horiz = l.B.a > l.A.b;
      const cutR = new Set(links.filter(l => l.horiz).map(l => l.from)), cutL = new Set(links.filter(l => l.horiz).map(l => l.to));
      const CUT = 14, geo = {};
      for (const { it, a, b, r, tr } of bars) {
        const row = trackRows.find(x => x.tr === tr);
        const top = row.y + 15 + r * (barH + rowGap), color = S.border(it.at != null ? it.role || "accent" : it.role || "process");
        if (it.at != null) {
          const cx = X(a) + colW * (it.pos ?? 0.5), cy = top + barH / 2, d = 17;
          const lab = T(UZ.wrap(it.label, 18, colW - 10, 700, 2), cx + d + 8, cy, 18, { anchor: "start", weight: 700, color: S.ink });
          items.push({ id: it.id, kind: "box", shape: "diamond", x: cx - d, y: cy - d, w: d * 2, h: d * 2, r: 0, stroke: color, fill: S.fill(it.role || "accent"), texts: [], label: lab,
            bbox: { x: cx - d, y: cy - d, w: d * 2, h: d * 2 }, dotAt: [cx, cy] });
          geo[it.id] = { x0: cx - d, x1: cx + d, out: lab.bbox.x + lab.bbox.w + 6, y0: cy - d, y1: cy + d, cy };
        } else {
          const x = X(a) + 8 + (cutL.has(it.id) ? CUT : 0), w = X(b + 1) - 8 - (cutR.has(it.id) ? CUT : 0) - x;
          geo[it.id] = { x0: x, x1: x + w, out: x + w, y0: top, y1: top + barH, cy: top + barH / 2 };
          const lines = UZ.wrap(it.label, 19, w - 24, 500, 2);
          const fs = lines.length > 1 ? 17 : 19;
          const t = T(UZ.wrap(it.label, fs, w - 20, 500, 2), x + 14, top + barH / 2, fs, { anchor: "start", weight: 500, color: S.label(it.role || "process"), lineH: fs + 3 });
          items.push({ id: it.id, kind: "bar", x, y: top, w, h: barH, r: 8, grow: "right", stroke: color, fill: S.fill(it.role || "process"), texts: [t], bbox: { x, y: top, w, h: barH } });
        }
      }
      const linkIds = [];
      for (const l of links) {
        const A = geo[l.from], B = geo[l.to];
        let pts;
        if (l.horiz) {
          if (Math.abs(A.cy - B.cy) < 0.5) pts = [[A.out, A.cy], [B.x0, B.cy]];
          else { const mx = Math.max(A.out + 12, B.x0 - 22); pts = [[A.out, A.cy], [mx, A.cy], [mx, B.cy], [B.x0, B.cy]]; }
        } else {
          const x = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2, down = B.cy > A.cy;
          pts = [[x, down ? A.y1 : A.y0], [x, down ? B.y0 : B.y1]];
        }
        const id = `${l.from}>${l.to}`;
        items.push(edgeItem(S, id, pts, { label: labelOn(S, pts, l.label, 17), from: l.from, to: l.to }));
        linkIds.push(id);
      }
      order.push(...linkIds);
      // いま
      if (f.now != null) {
        const i = pIdx[f.now.period ?? f.now] ?? 0, x = X(i) + colW * (f.now.pos ?? 0.5);
        const t = T(f.now.label || "いま", x, headH + 2, 16, { weight: 700, color: S.accent });
        items.push({ id: "now", kind: "edge", pts: [[x, headH + 12], [x, H + 4]], stroke: S.accent, width: 2.4, head: false, label: t, bbox: { x: x - 2, y: headH + 12, w: 4, h: H - headH } });
      }
      const gridIds = [...P.map(p => p.id), ...items.filter(i => /^grid\d+$/.test(i.id)).map(i => i.id)];
      items.push({ id: "grid", kind: "group", members: [...gridIds, ...order], bbox: null });
      const head = [...gridIds, ...order];
      const rest = f.items.map(i => i.id);
      if (f.now != null) rest.push("now");
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order: [...head, ...rest] };
    },
  };

  // ======== ツリー（tree）========
  // root から children を入れ子で書く。direction: right（論点・ロジックツリー）/ down（組織図）。省くと大きく描ける方
  FIG.tree = {
    async layout(f, S, ctx) {
      const tries = f.direction ? [f.direction] : ["right", "down"];
      let best = null;
      for (const d of tries) {
        const r = layoutTree(f, S, d);
        r.score = Math.min(ctx.area.w / r.w, ctx.area.h / r.h, 1.3);
        if (!best || r.score > best.score * 1.05) best = r;
      }
      return best;
    },
  };
  function layoutTree(f, S, dir) {
    const nodes = [], edges = [];
    const walk = (n, depth, parent) => {
      const b = nodeBox(S, n.id, n.label, { sub: n.sub, role: n.role || (depth === 0 ? "accent" : "process"), maxW: dir === "right" ? 210 : 170, minW: dir === "right" ? 150 : 120, size: depth === 0 ? 23 : 20 });
      const node = { n, b, depth, kids: [] };
      nodes.push(node);
      if (parent) { parent.kids.push(node); edges.push({ id: `${parent.n.id}>${n.id}`, from: parent.n.id, to: n.id, label: n.edge }); }
      for (const c of n.children || []) walk(c, depth + 1, node);
      return node;
    };
    const root = walk(f.root, 0, null);
    const maxDepth = Math.max(...nodes.map(n => n.depth));
    // 深さごとの幅（right）か高さ（down）
    const depthSize = [];
    for (const n of nodes) depthSize[n.depth] = Math.max(depthSize[n.depth] || 0, dir === "right" ? n.b.w : n.b.h);
    const gapD = dir === "right" ? 64 : 56, gapS = dir === "right" ? 16 : 22;
    const depthPos = [0];
    for (let d = 1; d <= maxDepth; d++) depthPos[d] = depthPos[d - 1] + depthSize[d - 1] + gapD;
    // 葉を順に積み、親は子の中央へ
    let cursor = 0;
    const place = node => {
      const span = dir === "right" ? node.b.h : node.b.w;
      if (!node.kids.length) { node.c = cursor + span / 2; cursor += span + gapS; return; }
      node.kids.forEach(place);
      node.c = (node.kids[0].c + node.kids[node.kids.length - 1].c) / 2;
      // 親が子より大きいときは、子の範囲を広げる
      const need = node.c + span / 2 + gapS;
      if (cursor < need) cursor = need;
    };
    place(root);
    const items = [], box = {};
    for (const nd of nodes) {
      const x = dir === "right" ? depthPos[nd.depth] : nd.c - nd.b.w / 2;
      const y = dir === "right" ? nd.c - nd.b.h / 2 : depthPos[nd.depth];
      box[nd.n.id] = placeBox(S, nd.b, x, y);
      items.push(box[nd.n.id]);
    }
    for (const e of edges) {
      const a = box[e.from], b = box[e.to];
      let pts;
      if (dir === "right") { const x0 = a.x + a.w, x1 = b.x, mx = x0 + 26, ay = a.y + a.h / 2, by = b.y + b.h / 2; pts = Math.abs(ay - by) < 1 ? [[x0, ay], [x1, by]] : [[x0, ay], [mx, ay], [mx, by], [x1, by]]; }
      else { const y0 = a.y + a.h, y1 = b.y, my = y0 + 24, ax = a.x + a.w / 2, bx = b.x + b.w / 2; pts = Math.abs(ax - bx) < 1 ? [[ax, y0], [bx, y1]] : [[ax, y0], [ax, my], [bx, my], [bx, y1]]; }
      items.push(edgeItem(S, e.id, pts, { from: e.from, to: e.to, head: false, label: e.label ? labelOn(S, pts.slice(-2), e.label, 16) : null }));
    }
    // 枝 → 子の箱 の順に並べ直す（幅優先）
    const bfs = [root.n.id], q = [root];
    while (q.length) { const nd = q.shift(); for (const k of nd.kids) { bfs.push(`${nd.n.id}>${k.n.id}`, k.n.id); q.push(k); } }
    const sz = fit(items);
    return { w: sz.w, h: sz.h, items, order: bfs, dir };
  }

  // ======== グラフ（chart）: 棒・折れ線 ========
  FIG.chart = {
    async layout(f, S) {
      const cats = f.categories.map((c, i) => (typeof c === "object" ? c : { id: /^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー.]+$/.test(String(c)) ? String(c) : `c${i + 1}`, label: String(c) }));
      const series = f.series, kind = f.kind || "bar";
      const all = series.flatMap(s => s.values.filter(v => v != null));
      const vmax = f.max ?? Math.max(0, ...all), vmin = f.min ?? Math.min(0, ...all);
      const step = niceStep(vmax - vmin || 1, 4);
      const top = Math.ceil(vmax / step) * step, bot = Math.floor(vmin / step) * step;
      const plotH = 300, axisW = 74, legendH = series.length > 1 ? 40 : 0;
      const groupW = Math.max(110, Math.min(220, 920 / cats.length));
      const plotW = groupW * cats.length;
      const Y = v => legendH + 20 + plotH * (top - v) / (top - bot || 1);
      const items = [], order = [];
      // 目盛り
      for (let v = bot; v <= top + 1e-9; v += step) {
        const y = Y(v);
        const t = T(fmtNum(v, f.decimals) + (v === top && f.unit ? ` ${f.unit}` : ""), axisW - 12, y, 16, { anchor: "end", color: S.muted });
        items.push({ id: `tick${Math.round(v * 1000)}`, kind: "edge", pts: [[axisW, y], [axisW + plotW, y]], stroke: Math.abs(v) < 1e-9 ? S.muted : S.line, width: Math.abs(v) < 1e-9 ? 2 : 1, head: false, dashed: Math.abs(v) >= 1e-9, label: t, deco: true,
          bbox: { x: axisW, y: y - 1, w: plotW, h: 2 } });
        order.push(`tick${Math.round(v * 1000)}`);
      }
      items.push({ id: "axis", kind: "group", members: order.slice(), bbox: null });
      cats.forEach((c, ci) => {
        const t = T(UZ.wrap(c.label, 18, groupW - 8, 500, 2), axisW + groupW * (ci + 0.5), Y(bot) + 26, 18, { weight: 500, color: S.ink, lineH: 22 });
        items.push({ id: c.id, kind: "text", texts: [t], bbox: { x: axisW + groupW * ci, y: Y(bot) + 8, w: groupW, h: t.bbox.h + 14 }, members: series.map(s => `${s.id}.${c.id}`) });
        order.push(c.id);
      });
      const n = series.length;
      series.forEach((s, si) => {
        const srole = s.role || ["actor", "process", "store", "external"][si % 4];
        // 線は役割の色（背景の上で読める色）。棒と凡例は面なので、箱の枠と同じ色（テーマの boxes にあればデザインの色そのまま）
        const color = kind === "line" ? S.role(srole) : S.border(srole);
        const members = [];
        if (kind === "line") {
          const pts = [];
          s.values.forEach((v, ci) => { if (v != null) pts.push([axisW + groupW * (ci + 0.5), Y(v)]); });
          items.push({ id: `${s.id}.line`, kind: "edge", pts, stroke: color, width: 3.4, head: false, bbox: { x: pts[0][0], y: Math.min(...pts.map(p => p[1])), w: pts[pts.length - 1][0] - pts[0][0], h: Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1])) + 1 } });
          members.push(`${s.id}.line`);
        }
        s.values.forEach((v, ci) => {
          if (v == null) return;
          const id = `${s.id}.${cats[ci].id}`;
          const lab = f.values === false ? null : T(fmtNum(v, f.decimals), 0, 0, 17, { weight: 700, color: S.ink });
          if (kind === "line") {
            const cx = axisW + groupW * (ci + 0.5), cy = Y(v), r = 7;
            if (lab) Object.assign(lab, T(lab.lines, cx, cy - 22, 17, { weight: 700, color: S.ink }));
            items.push({ id, kind: "box", shape: "ellipse", x: cx - r, y: cy - r, w: r * 2, h: r * 2, r, stroke: color, fill: S.bg, texts: [], label: lab, bbox: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, dotAt: [cx, cy] });
          } else {
            const inner = groupW * 0.72, bw = inner / n, x = axisW + groupW * ci + (groupW - inner) / 2 + bw * si + 3;
            const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v));
            const lb = lab ? T(lab.lines, x + (bw - 6) / 2, v >= 0 ? y0 - 14 : y1 + 14, n > 2 ? 15 : 17, { weight: 700, color: S.ink }) : null;
            items.push({ id, kind: "bar", x, y: y0, w: bw - 6, h: Math.max(1, y1 - y0), r: 3, grow: v >= 0 ? "up" : "down", stroke: color, fill: C.mix(S.bg, color, 0.78), solid: true, texts: [], label: lb, bbox: { x, y: y0, w: bw - 6, h: Math.max(1, y1 - y0) } });
          }
          members.push(id);
        });
        items.push({ id: s.id, kind: "group", members, bbox: null });
        // 凡例
        if (n > 1) {
          const lx = axisW + si * 210, lt = T(s.label, lx + 26, 16, 18, { anchor: "start", weight: 500, color: S.ink });
          items.push({ id: `${s.id}.legend`, kind: "text", texts: [lt], legend: { x: lx, y: 16, color }, bbox: { x: lx, y: 4, w: 26 + lt.bbox.w, h: 24 } });
          order.push(`${s.id}.legend`);
        }
        order.push(...members);
      });
      items.push({ id: "categories", kind: "group", members: cats.map(c => c.id), bbox: null });
      if (n > 1) items.push({ id: "legend", kind: "group", members: series.map(s => `${s.id}.legend`), bbox: null });
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order };
    },
  };

  // ======== KPI（kpi）: 大きな数字のカード。出すときに数字が数え上がる ========
  FIG.kpi = {
    async layout(f, S) {
      const k = f.items.length, gap = 30, cw = Math.min(360, (1150 - gap * (k - 1)) / k), ch = 230, items = [], order = [];
      f.items.forEach((it, i) => {
        const x = i * (cw + gap), color = S.border(it.role || "accent");
        const lab = T(UZ.wrap(it.label, 21, cw - 40, 500, 2), x + cw / 2, 44, 21, { weight: 500, color: S.muted });
        const valStr = (it.prefix || "") + fmtNum(it.value, it.decimals);
        const vsize = Math.min(64, (cw - 40) / Math.max(1, UZ.textW(valStr + (it.unit || ""), 1, 700)) );
        const val = T(valStr, x + cw / 2 - (it.unit ? UZ.textW(it.unit, vsize * 0.45) / 2 : 0), 118, vsize, { weight: 700, color: S.ink });
        const texts = [lab, val];
        if (it.unit) texts.push(T(it.unit, val.bbox.x + val.bbox.w + 6, 118 + vsize * 0.18, vsize * 0.45, { anchor: "start", weight: 500, color: S.muted }));
        let dIt = null;
        if (it.delta != null) {
          const up = String(it.delta).trim().startsWith("-") ? false : true;
          const good = it.better ? (it.better === "down" ? !up : up) : null;
          const dc = good == null ? S.muted : good ? S.good : S.bad;
          const dt = T(`${up ? "▲" : "▼"} ${String(it.delta).replace(/^[+-]/, "")}`, x + cw / 2, 182, 20, { weight: 700, color: dc });
          dIt = { id: `${it.id}.delta`, kind: "text", texts: [dt], bbox: { ...dt.bbox }, parent: it.id };
        }
        items.push({ id: it.id, kind: "box", x, y: 0, w: cw, h: ch, r: S.radius + 2, stroke: color, fill: S.fill(it.role || "accent"), texts, bbox: { x, y: 0, w: cw, h: ch },
          count: { to: Number(it.value), decimals: it.decimals, prefix: it.prefix || "", index: 1 }, members: dIt ? [dIt.id] : [] });
        order.push(it.id);
        if (dIt) items.push(dIt);
      });
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order };
    },
  };

  // 象限の塗り。該当しない象限（off）はグレーで沈め、当てはまる象限は役割の色を薄く敷く
  UZ.QUAD_OFF = S => C.rgba(S.muted, 0.2);
  UZ.QUAD_ON = color => C.rgba(color, 0.16);
  // ======== 2×2 マトリクス（matrix）========
  // x / y の軸と 4 象限。items は 0〜1 の座標で置く点。move の to に {x, y} を書くと点が動く
  FIG.matrix = {
    async layout(f, S) {
      const W = 640, H = 400, ox = 110, oy = 10, items = [], order = [];
      const q = f.quadrants || {};
      const QP = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
      for (const k of ["tl", "tr", "bl", "br"]) {
        if (!q[k]) continue;
        const o = typeof q[k] === "string" ? { label: q[k] } : q[k];
        const id = o.id || k, [qx, qy] = QP[k];
        const x = ox + qx * W / 2, y = oy + qy * H / 2;
        // 塗り: 役割の色（role）か、該当しない象限のグレー（off）。どちらもなければ、ほぼ地の色
        const hl = o.off ? UZ.QUAD_OFF(S) : o.role ? UZ.QUAD_ON(S.role(o.role)) : C.rgba(S.ink, 0.025);
        const lx = qx ? x + W / 2 - 14 : x + 14;
        const tl = T(UZ.wrap(o.label, 21, W / 2 - 40, 700, 2), lx, y + 26, 21, { anchor: qx ? "end" : "start", weight: 700, color: o.role && !o.off ? S.role(o.role) : S.muted });
        const texts = [tl];
        if (o.sub) texts.push(T(UZ.wrap(o.sub, 15, W / 2 - 40, 400, 2), lx, tl.bbox.y + tl.bbox.h + 14, 15, { anchor: qx ? "end" : "start", color: S.muted }));
        items.push({ id, kind: "rect", x, y, w: W / 2, h: H / 2, r: 0, fill: hl, texts, bbox: { x, y, w: W / 2, h: H / 2 }, quad: true, off: !!o.off });
        order.push(id);
      }
      // 軸
      const ax = [[ox, oy + H], [ox + W + 14, oy + H]], ay = [[ox, oy + H], [ox, oy - 14]];
      items.push(edgeItem(S, "xaxis", ax, { stroke: S.ink, width: 2.2 }), edgeItem(S, "yaxis", ay, { stroke: S.ink, width: 2.2 }));
      items.push({ id: "mid", kind: "edge", pts: [[ox + W / 2, oy], [ox + W / 2, oy + H]], stroke: S.line, width: 1.4, dashed: true, head: false, deco: true, bbox: { x: ox + W / 2, y: oy, w: 1, h: H } });
      items.push({ id: "mid2", kind: "edge", pts: [[ox, oy + H / 2], [ox + W, oy + H / 2]], stroke: S.line, width: 1.4, dashed: true, head: false, deco: true, bbox: { x: ox, y: oy + H / 2, w: W, h: 1 } });
      const xl = T(f.x.label, ox + W / 2, oy + H + 30, 19, { weight: 700, color: S.ink });
      const xs = [T(f.x.low || "低", ox + 4, oy + H + 30, 16, { anchor: "start", color: S.muted }), T(f.x.high || "高", ox + W, oy + H + 30, 16, { anchor: "end", color: S.muted })];
      const yl = T(UZ.wrap(f.y.label, 19, 90, 700, 3), ox - 52, oy + H / 2, 19, { weight: 700, color: S.ink });
      const ys = [T(f.y.low || "低", ox - 12, oy + H - 12, 16, { anchor: "end", color: S.muted }), T(f.y.high || "高", ox - 12, oy + 12, 16, { anchor: "end", color: S.muted })];
      items.push({ id: "xlabel", kind: "text", texts: [xl, ...xs], bbox: { x: ox, y: oy + H + 16, w: W, h: 30 } });
      items.push({ id: "ylabel", kind: "text", texts: [yl, ...ys], bbox: { x: ox - 100, y: oy, w: 96, h: H } });
      order.push("xaxis", "yaxis", "mid", "mid2", "xlabel", "ylabel");
      items.push({ id: "axes", kind: "group", members: ["xaxis", "yaxis", "mid", "mid2", "xlabel", "ylabel"], bbox: null });
      items.push({ id: "quadrants", kind: "group", members: order.filter(id => items.find(i => i.id === id && i.quad)), bbox: null });
      const coord = (x, y) => [ox + x * W, oy + (1 - y) * H];
      const placedLabels = [];
      for (const p of f.items || []) {
        const [cx, cy] = coord(p.x, p.y), r = p.size ? 8 + p.size * 14 : 11, color = S.role(p.role || "accent");
        const tw = UZ.textW(p.label, 19, 700), th = 26;
        const cands = [[cx + r + 8, cy, "start"], [cx - r - 8, cy, "end"], [cx, cy - r - 16, "middle"], [cx, cy + r + 16, "middle"]];
        let best = cands[0], bs = Infinity;
        for (const c of cands) {
          const bx = c[2] === "start" ? c[0] : c[2] === "end" ? c[0] - tw : c[0] - tw / 2;
          const b = { x: bx, y: c[1] - th / 2, w: tw, h: th };
          let s = cands.indexOf(c);
          for (const o of placedLabels) s += UZ.rectOverlap(b, o) * 4;
          for (const o of f.items) if (o !== p) { const [px, py] = coord(o.x, o.y); s += UZ.rectOverlap(b, { x: px - 12, y: py - 12, w: 24, h: 24 }) * 4; }
          if (b.x < ox || b.x + b.w > ox + W + 10 || b.y < oy - 10 || b.y + b.h > oy + H) s += 200;
          if (s < bs) { bs = s; best = c; }
        }
        const lab = T(p.label, best[0], best[1], 19, { anchor: best[2], weight: 700, color: S.ink });
        placedLabels.push(lab.bbox);
        items.push({ id: p.id, kind: "box", shape: "ellipse", x: cx - r, y: cy - r, w: r * 2, h: r * 2, r, stroke: color, fill: C.rgba(color, 0.35), texts: [], label: lab, bbox: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, dotAt: [cx, cy] });
        order.push(p.id);
      }
      // 原点の位置を覚えておき、move の {x, y} を図の座標に直す
      const sz = fit(items, 6);
      const o0 = items.find(i => i.id === "xaxis").pts[0];
      return { w: sz.w, h: sz.h, items, order, coord: (x, y) => [o0[0] + x * W, o0[1] - y * H] };
    },
  };

  // ======== ピラミッド・ファネル（pyramid）========
  // levels は上から。kind: pyramid（上が細い）/ funnel（上が太い）。funnel で value があれば段の間に率を出す
  FIG.pyramid = {
    async layout(f, S) {
      const L = f.levels, n = L.length, funnel = f.kind === "funnel", items = [], order = [];
      const lh = n > 5 ? 62 : 74, gap = 8, size = 21;
      const need = L.map(l => Math.max(UZ.textW(l.label, size, 700), l.sub ? UZ.textW(l.sub, 16) : 0, l.value != null ? UZ.textW(fmtNum(l.value), 16) + 40 : 0) + 56);
      // 各段の上辺の幅。ピラミッドは下へ広がる、ファネルは下へ狭まる。どの段も文字が入る幅にする
      let maxW = 760, minTop = 0, slope;
      if (funnel) {
        maxW = Math.max(760, need[0] + 40);
        slope = Math.min((maxW - 220) / n, ...need.map((w, i) => (maxW - w) / (i + 1)));
        if (slope < 12) { slope = 12; maxW = Math.max(...need.map((w, i) => w + (i + 1) * 12)); }
      } else {
        minTop = need[0];
        slope = Math.max((760 - minTop) / n, ...need.map((w, i) => (i ? (w - minTop) / i : 0)));
      }
      const topW = i => funnel ? maxW - i * slope : minTop + i * slope;
      const botW = i => funnel ? maxW - (i + 1) * slope : minTop + (i + 1) * slope;
      maxW = Math.max(topW(0), botW(n - 1));
      const cx = maxW / 2;
      L.forEach((l, i) => {
        const y = i * (lh + gap), w0 = topW(i), w1 = botW(i);
        const poly = [[cx - w0 / 2, y], [cx + w0 / 2, y], [cx + w1 / 2, y + lh], [cx - w1 / 2, y + lh]];
        const role = l.role || ["actor", "process", "store", "external"][i % 4];
        const color = S.border(role);
        const texts = [T(l.label, cx, y + lh / 2 - (l.sub || l.value != null ? 10 : 0), size, { weight: 700, color: S.label(role) })];
        const subTxt = [l.value != null ? fmtNum(l.value) + (f.unit || "") : null, l.sub].filter(Boolean).join("  ");
        if (subTxt) texts.push(T(subTxt, cx, y + lh / 2 + 16, 16, { color: S.muted }));
        const bx = Math.min(...poly.map(p => p[0])), bw = Math.max(...poly.map(p => p[0])) - bx;
        items.push({ id: l.id, kind: "box", shape: "poly", poly, x: bx, y, w: bw, h: lh, r: 0, stroke: color, fill: S.fill(role), texts, bbox: { x: bx, y, w: bw, h: lh }, dotAt: [cx, y + lh / 2] });
        order.push(l.id);
        if (funnel && i > 0 && L[i - 1].value && l.value != null) {
          const rate = l.value / L[i - 1].value * 100;
          const rx = cx + Math.max(topW(i - 1), botW(i - 1)) / 2 + 26, ry = y - gap / 2;
          const t = T(`${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}%`, rx + 16, ry, 19, { anchor: "start", weight: 700, color: S.accent });
          items.push({ id: `${l.id}.rate`, kind: "text", texts: [t], glyph: { kind: "arrowdown", x: rx, y: ry, size: 16, color: S.accent }, bbox: { x: rx - 10, y: t.bbox.y, w: t.bbox.w + 26, h: t.bbox.h }, parent: l.id });
          order.push(`${l.id}.rate`);
        }
      });
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order };
    },
  };

  // ======== サイクル（cycle）========
  // steps を円周に時計回りで並べ、隣どうしを弧の矢印で結ぶ（最後 → 最初も）。trace で点を回せる
  FIG.cycle = {
    // ctx.fill: 文字を k 倍にし、輪を区画に合わせて広げる（横に広い区画では横長の輪。縦横の比は 0.55〜1）
    fill: true,
    async layout(f, S, ctx) {
      const F = ctx && ctx.fill, k = F ? F.k : 1;
      const st = f.steps, n = st.length, items = [], order = [];
      const nb = st.map(s => nodeBox(S, s.id, s.label, { sub: s.sub, role: s.role, maxW: 170 * k, minW: 130 * k, size: Math.round(21 * k), shape: "round", k }));
      let R = Math.max(150, Math.min(230, 70 + n * 30)) * k, Ry = R * 0.78;
      if (F) {
        const bw = Math.max(...nb.map(b => b.w)), bh = Math.max(...nb.map(b => b.h));
        const rx = (F.w - bw) / 2 - 8, ry = (F.h - bh) / 2 - 8;
        Ry = Math.min(ry, rx); R = Math.min(rx, Ry / 0.55);
        Ry = Math.min(Ry, R);
        if (R < 120 * k || Ry < 90 * k) return { w: Infinity, h: Infinity, items: [], order: [] };   // 区画が狭すぎる（k を下げる）
      }
      const ratio = Ry / R;
      const pos = st.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [Math.cos(a) * R, Math.sin(a) * Ry, a]; });
      const box = {};
      st.forEach((s, i) => { const b = nb[i]; box[s.id] = placeBox(S, b, pos[i][0] - b.w / 2, pos[i][1] - b.h / 2); });
      if (f.center) {
        const cs = Math.round(22 * k), t = T(UZ.wrap(f.center, cs, Math.min(R, Ry / 0.78) * 0.9, 700, 3), 0, 0, cs, { weight: 700, color: S.accent });
        items.push({ id: "center", kind: "text", texts: [t], bbox: { ...t.bbox }, over: [] });
      }
      // 弧: 楕円の上を、箱の外に出た所から次の箱に入る所まで
      const inBox = (p, b) => p[0] > b.x - 6 && p[0] < b.x + b.w + 6 && p[1] > b.y - 6 && p[1] < b.y + b.h + 6;
      const edges = [];
      st.forEach((s, i) => {
        if (n < 2 || (f.closed === false && i === n - 1)) return;
        const t = st[(i + 1) % n], a0 = pos[i][2], a1 = a0 + 2 * Math.PI / n;
        const pts = [];
        for (let k = 0; k <= 60; k++) { const a = a0 + (a1 - a0) * k / 60; const p = [Math.cos(a) * R, Math.sin(a) * Ry]; if (!inBox(p, box[s.id]) && !inBox(p, box[t.id])) pts.push(p); }
        if (pts.length < 2) return;
        const id = `${s.id}>${t.id}`;
        edges.push({ id, from: s.id, to: t.id });
        const lab = s.edge ? (() => { const m = pts[Math.floor(pts.length / 2)], d = Math.hypot(m[0], m[1] / ratio) || 1; return T(s.edge, m[0] * (1 + 34 / d), m[1] * (1 + 30 / d), Math.round(17 * k), { color: S.ink }); })() : null;
        items.push(edgeItem(S, id, pts, { from: s.id, to: t.id, stroke: S.muted, label: lab }));
      });
      st.forEach(s => items.push(box[s.id]));
      const fin = revealOrder(st.map(s => s.id), edges);
      if (f.center) fin.push("center");
      const sz = fit(items);
      const lineCount = nb.reduce((a, b) => a + b.lines.length + b.subLines.length, 0);
      return { w: sz.w, h: sz.h, items, order: fin, direct: true, lineCount };
    },
  };

  // ======== ベン図（venn）========
  // sets のうち inside のないものが、重なり合う円（1〜3 個）。overlaps で重なりに言葉を置く（of: 重なる集合の id）
  // inside: "<集合の id>" と書いた集合は、その円の内側に小さく描く（包含。1 つの円に 2 つまで、入れ子も書ける）
  FIG.venn = {
    async layout(f, S) {
      const sets = f.sets, byId = Object.fromEntries(sets.map(s => [s.id, s]));
      const tops = sets.filter(s => !s.inside || !byId[s.inside]), n = tops.length, items = [], order = [];
      const kidsOf = id => sets.filter(s => s.inside === id && byId[s.inside]);
      const R = n === 1 ? 210 : n === 2 ? 190 : 165;
      const d = n === 2 ? R * 1.05 : R * 1.1;
      const centers = n === 1 ? [[0, 0]] : n === 2 ? [[-d / 2, 0], [d / 2, 0]] : [[-d / 2, -d * 0.29], [d / 2, -d * 0.29], [0, d * 0.58]];
      const cOf = {}, done = new Set();
      const fs = r => (r >= 150 ? 23 : r >= 95 ? 21 : 19);
      // 集合 1 つ: 円と名前。away = 他の円から離れる向き（重なり合う円のときだけ）
      const put = (s, cx, cy, r, away) => {
        if (done.has(s.id)) return;   // 入れ子が輪になっているとき（検査が誤りにする）に止まるように
        done.add(s.id);
        const color = S.role(s.role || ["actor", "process", "store", "external", "accent"][sets.indexOf(s) % 5]);
        const kids = kidsOf(s.id).slice(0, 2);
        cOf[s.id] = [cx, cy];
        let lx, ly, maxW, kidAt;
        if (away) {
          // 上を向く垂線（他の円から遠い側）。含む集合があれば、名前は脇へ寄せ、離れる向きの側を内側の円に空ける
          let p = [away[1], -away[0]];
          if (p[1] > 0 || (p[1] === 0 && p[0] > 0)) p = [-p[0], -p[1]];
          if (kids.length) { lx = cx + away[0] * 0.17 * r + p[0] * 0.72 * r; ly = cy + away[1] * 0.17 * r + p[1] * 0.72 * r; maxW = r * 0.8; }
          else { lx = cx + away[0] * 0.5 * r; ly = cy + away[1] * 0.5 * r; maxW = r * 0.8; }
          kidAt = kids.length === 1 ? [{ x: cx + away[0] * 0.45 * r, y: cy + away[1] * 0.45 * r, r: r * 0.45 }]
            : kids.map((_, i) => ({ x: cx + away[0] * 0.5 * r + p[0] * 0.32 * r * (i ? -1 : 1), y: cy + away[1] * 0.5 * r + p[1] * 0.32 * r * (i ? -1 : 1), r: r * 0.3 }));
        } else if (kids.length) {
          // 名前は円の上、内側の円は下
          lx = cx; ly = cy - (kids.length === 1 ? 0.6 : 0.62) * r; maxW = r * 1.2;
          kidAt = kids.length === 1 ? [{ x: cx, y: cy + 0.34 * r, r: r * 0.58 }] : kids.map((_, i) => ({ x: cx + (i ? 0.46 : -0.46) * r, y: cy + 0.26 * r, r: r * 0.42 }));
        } else { lx = cx; ly = cy; maxW = r * 1.5; }
        const size = fs(r);
        const texts = [T(UZ.wrap(s.label, size, maxW, 700, 2), lx, ly - (s.sub ? 12 : 0), size, { weight: 700, color: S.ink })];
        if (s.sub) texts.push(T(UZ.wrap(s.sub, 16, maxW, 400, 2), lx, ly + 20, 16, { color: S.muted }));
        items.push({ id: s.id, kind: "box", shape: "ellipse", x: cx - r, y: cy - r, w: r * 2, h: r * 2, r, stroke: color, fill: C.rgba(color, 0.16), texts, bbox: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, dotAt: [lx, ly], parent: s.inside });
        order.push(s.id);
        kids.forEach((k, i) => put(k, kidAt[i].x, kidAt[i].y, kidAt[i].r, null));
      };
      tops.forEach((s, i) => {
        const [cx, cy] = centers[i] || [0, 0], L = Math.hypot(cx, cy) || 1;
        put(s, cx, cy, R, n === 1 ? null : n === 2 ? [Math.sign(cx), 0] : [cx / L, cy / L]);
      });
      for (const o of f.overlaps || []) {
        const cs = o.of.map(id => cOf[id]).filter(Boolean);
        if (!cs.length) continue;
        let mx = cs.reduce((a, c) => a + c[0], 0) / cs.length, my = cs.reduce((a, c) => a + c[1], 0) / cs.length;
        if (n === 3 && cs.length === 2) { const other = tops.find(s => !o.of.includes(s.id)); const oc = cOf[other.id]; const vx = mx - oc[0], vy = my - oc[1], L = Math.hypot(vx, vy) || 1; mx += vx / L * R * 0.12; my += vy / L * R * 0.12; }
        const size = 18, maxW = cs.length === 3 ? R * 0.55 : n === 2 ? R * 0.75 : R * 0.6;
        const t = T(UZ.wrap(o.label, size, maxW, 700, 3), mx, my, size, { weight: 700, color: S.ink });
        items.push({ id: o.id, kind: "text", texts: [t], bbox: { ...t.bbox }, over: sets.map(x => x.id) });
        order.push(o.id);
      }
      const sz = fit(items);
      return { w: sz.w, h: sz.h, items, order };
    },
  };
})(globalThis.UZ = globalThis.UZ || {});
