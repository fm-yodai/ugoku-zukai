// ugoku-zukai プレーヤー: 図の種類ごとの配置。
// 各 layout は図の中だけの座標（ローカル座標）で部品（item）を並べ、{ w, h, items, order } を返す。
// 画面のどこにどの大きさで置くかは engine が場面ごとに決める（図をまるごと拡大縮小する）。
(function (UZ) {
  "use strict";
  const C = UZ.color;

  // ---- テーマから色を引く ----
  UZ.styleOf = function (theme) {
    const col = theme.colors, sh = theme.shape;
    const role = r => (col.roles && col.roles[r]) || (r && col[r]) || col.accent;
    // 箱の面・枠・中の文字は、テーマの colors.boxes に役割ごとに書ければそれを使う（デザインにある色をそのまま当てる）。
    // 書いていない役割は、役割の色を背景に混ぜた面・役割の色の枠・本文の色の文字になる
    const boxes = col.boxes || {};
    const border = r => (boxes[r] && boxes[r].border) || role(r);
    const label = r => (boxes[r] && boxes[r].label) || col.ink;
    const fill = r => {
      const c = role(r);
      if (boxes[r] && boxes[r].fill) return boxes[r].fill;
      if (sh.fill === "none") return "none";
      if (sh.fill === "solid") return C.mix(col.bg, c, sh.fillMix ?? 0.16);
      return C.rgba(c, sh.fillAlpha ?? 0.14);
    };
    return {
      role, fill, border, label, theme, chapter: theme.chapter || null,
      ink: col.ink, muted: col.muted, line: col.line, bg: col.bg, surface: col.surface || C.mix(col.bg, col.ink, 0.06),
      accent: col.accent, good: col.good, bad: col.bad, warn: col.warn,
      font: theme.font.family, weight: theme.font.weight || 400, bold: theme.font.bold || 700,
      radius: sh.radius ?? 10, stroke: sh.stroke ?? 2.4, edgeW: sh.edgeWidth ?? 2.2,
    };
  };

  // 文字の塊。y は塊の縦の中心。
  UZ.mkText = function (lines, x, y, size, o = {}) {
    if (!Array.isArray(lines)) lines = [String(lines)];
    const lineH = o.lineH || Math.round(size * 1.38);
    const weight = o.weight || 400, anchor = o.anchor || "middle";
    const w = Math.max(0, ...lines.map(s => UZ.textW(s, size, weight)));
    const h = lines.length * lineH;
    const bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return { lines, x, y, size, weight, anchor, lineH, color: o.color, bbox: { x: bx, y: y - h / 2, w, h } };
  };

  const FIG = UZ.FIG = {};

  // 題の札の地: テーマに chapter があれば "dark"（章扉の色）。図に tone: "light" と書けば通常の地
  UZ.titleTone = (f, theme) => (f && f.type === "title" && theme && theme.chapter && f.tone !== "light" ? "dark" : "light");

  // ======== 題の札（title）========
  FIG.title = {
    async layout(f, S) {
      const W = 1184, H = 470;
      // 題の札は、テーマに chapter（章扉の色）があれば暗い地に出す。tone: "light" で通常の地に戻せる
      const dark = UZ.titleTone(f, S.theme) === "dark" ? S.chapter : null;
      const main = UZ.wrap(f.text, 46, 1000, S.bold, 3);
      const t = UZ.mkText(main, W / 2, H / 2 - (f.sub ? 30 : 0), 46, { weight: S.bold, color: dark ? dark.ink : S.ink, lineH: 64 });
      const items = [{ id: "text", kind: "text", texts: [t], bbox: { ...t.bbox } }];
      if (f.sub) {
        const s = UZ.mkText(UZ.wrap(f.sub, 28, 1000), W / 2, t.bbox.y + t.bbox.h + 40, 28, { color: dark ? (dark.sub || dark.ink) : S.accent });
        items.push({ id: "sub", kind: "text", texts: [s], bbox: { ...s.bbox } });
      }
      return { w: W, h: H, items, order: items.map(i => i.id), autoShow: true };
    },
  };

  // ======== 箇条（list）========
  FIG.list = {
    async layout(f, S) {
      const n = f.items.length, size = n > 6 ? 22 : 26, gap = n > 6 ? 50 : 66;
      const maxW = 980, items = [], order = [];
      let y = 0, w = 0;
      f.items.forEach((it, i) => {
        const lines = UZ.wrap(it.text, size, maxW, 500, 2);
        const t = UZ.mkText(lines, 64, 0, size, { anchor: "start", weight: 500, color: S.ink });
        const subT = it.sub ? UZ.mkText(UZ.wrap(it.sub, 18, maxW), 64, 0, 18, { anchor: "start", color: S.muted }) : null;
        const blockH = t.bbox.h + (subT ? subT.bbox.h + 4 : 0);
        const cy = y + blockH / 2;
        // 文字の位置を確定し直す
        const tt = UZ.mkText(lines, 64, y + t.bbox.h / 2, size, { anchor: "start", weight: 500, color: S.ink });
        const texts = [tt];
        if (subT) texts.push(UZ.mkText(subT.lines, 64, y + t.bbox.h + 4 + subT.bbox.h / 2, 18, { anchor: "start", color: S.muted }));
        const bullet = f.numbered ? { kind: "num", n: i + 1, x: 22, y: y + tt.lineH / 2, r: 18 } : { kind: "dot", x: 22, y: y + tt.lineH / 2, r: 6 };
        const bw = Math.max(...texts.map(x => x.bbox.x + x.bbox.w));
        const bbox = { x: 0, y, w: bw, h: blockH };
        items.push({ id: it.id, kind: "text", texts, bullet, bbox, rowBox: { x: -12, y: y - 8, w: bw + 24, h: blockH + 16 } });
        order.push(it.id);
        w = Math.max(w, bw);
        y += blockH + (gap - size);
        void cy;
      });
      return { w: Math.max(w, 600), h: y - (gap - size), items, order };
    },
  };

  // ======== 比較（compare）========
  FIG.compare = {
    async layout(f, S) {
      const k = f.items.length, gap = 36, W = 1184;
      const cw = Math.min(460, (W - gap * (k - 1)) / k), items = [], order = [];
      const headH = 64, ptSize = 21, pad = 26;
      let maxH = 0;
      const cards = f.items.map((it, ci) => {
        const x = ci * (cw + gap);
        const pts = (it.points || []).map((p, pi) => {
          const o = typeof p === "string" ? { text: p } : p;
          return { id: o.id || `${it.id}.${pi + 1}`, text: o.text, kind: o.kind || "plain", lines: UZ.wrap(o.text, ptSize, cw - pad * 2 - 34, 400, 3) };
        });
        let y = headH + 24;
        const placed = pts.map(p => {
          const t = UZ.mkText(p.lines, x + pad + 34, 0, ptSize, { anchor: "start", color: S.ink });
          const tt = UZ.mkText(p.lines, x + pad + 34, y + t.bbox.h / 2, ptSize, { anchor: "start", color: S.ink });
          const r = { ...p, t: tt, gy: y + tt.lineH / 2 };
          y += t.bbox.h + 18;
          return r;
        });
        maxH = Math.max(maxH, y + 8);
        return { it, x, placed };
      });
      for (const { it, x, placed } of cards) {
        const color = S.role(it.role || "process");
        const label = UZ.mkText(UZ.wrap(it.label, 26, cw - 40, S.bold, 1), x + cw / 2, headH / 2, 26, { weight: S.bold, color: S.ink });
        items.push({ id: it.id, kind: "box", x, y: 0, w: cw, h: maxH, r: S.radius, stroke: S.border(it.role || "process"), fill: S.fill(it.role || "process"),
          header: { h: headH, fill: C.rgba(color, 0.22) }, texts: [label], bbox: { x, y: 0, w: cw, h: maxH }, members: placed.map(p => p.id) });
        order.push(it.id);
        for (const p of placed) {
          const glyph = p.kind === "pro" ? "check" : p.kind === "con" ? "cross" : "dot";
          const gcol = p.kind === "pro" ? S.good : p.kind === "con" ? S.bad : S.muted;
          items.push({ id: p.id, kind: "text", texts: [p.t], glyph: { kind: glyph, x: x + pad + 12, y: p.gy, size: 18, color: gcol }, bbox: { x: x + pad, y: p.t.bbox.y, w: p.t.bbox.x + p.t.bbox.w - x - pad, h: p.t.bbox.h }, parent: it.id });
          order.push(p.id);
        }
      }
      return { w: k * cw + (k - 1) * gap, h: maxH, items, order };
    },
  };

  // ======== 表（table）========
  FIG.table = {
    async layout(f, S) {
      const cols = f.columns.map(c => (typeof c === "string" ? { id: c, label: c } : c));
      const size = 20, hsize = 19, padX = 18, markW = 30, rowMarkW = 48;
      const cellText = (row, ci) => {
        const v = Array.isArray(row.cells) ? row.cells[ci] : row.cells[cols[ci].id];
        return v == null ? { text: "" } : typeof v === "object" ? v : { text: String(v) };
      };
      const colW = cols.map((c, ci) => {
        let w = UZ.textW(c.label, hsize, S.bold);
        for (const r of f.rows) w = Math.max(w, UZ.textW(cellText(r, ci).text, size));
        return Math.min(380, Math.max(90, w)) + padX * 2 + markW;
      });
      const total = colW.reduce((a, b) => a + b, 0);
      const xs = [0]; colW.forEach(w => xs.push(xs[xs.length - 1] + w));
      const items = [], order = [];
      const headH = 50;
      // 見出し
      const headTexts = cols.map((c, ci) => UZ.mkText(UZ.wrap(c.label, hsize, colW[ci] - padX * 2, S.bold, 2), xs[ci] + padX, headH / 2, hsize, { anchor: "start", weight: S.bold, color: S.ink }));
      items.push({ id: "header", kind: "rect", x: 0, y: 0, w: total, h: headH, r: 6, fill: S.surface, texts: headTexts, bbox: { x: 0, y: 0, w: total, h: headH } });
      order.push("header");
      let y = headH;
      for (const r of f.rows) {
        const cells = cols.map((c, ci) => {
          const v = cellText(r, ci);
          return { ...v, col: c.id, lines: UZ.wrap(v.text, size, colW[ci] - padX * 2 - markW, ci === 0 ? 500 : 400, 2) };
        });
        const nl = Math.max(1, ...cells.map(c => c.lines.length));
        const rh = 26 + nl * 28;
        const rowItem = { id: r.id, kind: "rect", x: 0, y, w: total, h: rh, r: 4, fill: "none", rule: true, bbox: { x: 0, y, w: total, h: rh }, members: [] };
        items.push(rowItem);
        order.push(r.id);
        cells.forEach((c, ci) => {
          const cid = `${r.id}.${c.col}`;
          const t = UZ.mkText(c.lines, xs[ci] + padX, y + rh / 2, size, { anchor: "start", weight: ci === 0 ? 500 : 400, color: S.ink });
          const it = { id: cid, kind: "text", texts: [t], bbox: { x: xs[ci], y, w: colW[ci], h: rh }, parent: r.id, col: c.col, textBox: t.bbox };
          if (c.mark) it.staticMark = { kind: c.mark, x: xs[ci] + colW[ci] - padX - 6, y: y + rh / 2 };
          items.push(it);
          rowItem.members.push(cid);
        });
        y += rh;
      }
      // 列（focus で列ごと選べるように、列の id は見出しの文字と列の cell をまとめる）
      cols.forEach((c, ci) => {
        items.push({ id: c.id, kind: "group", members: f.rows.map(r => `${r.id}.${c.id}`), bbox: { x: xs[ci], y: 0, w: colW[ci], h: y }, headerIndex: ci });
      });
      return { w: total + rowMarkW, h: y, items, order, rowMarkX: total + 24 };
    },
  };

  // ======== シーケンス図（sequence）========
  FIG.sequence = {
    async layout(f, S) {
      const P = f.participants, size = 23, lsize = 19, boxH = 56;
      const boxW = P.map(p => Math.max(150, UZ.textW(p.label, size, 500) + 44));
      const msgs = f.messages.map((m, i) => ({ ...m, id: m.id || `m${i + 1}` }));
      // 隣り合う生存線の間隔: そこを通るメッセージのラベルが収まる幅
      const idx = Object.fromEntries(P.map((p, i) => [p.id, i]));
      const gaps = P.slice(1).map((_, i) => Math.max(200, (boxW[i] + boxW[i + 1]) / 2 + 30));
      for (const m of msgs) {
        const a = idx[m.from], b = idx[m.to];
        if (a == null || b == null || a === b) continue;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const need = UZ.textW(m.label, lsize) + 40;
        const have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
        if (have < need) for (let k = lo; k < hi; k++) gaps[k] += (need - have) / (hi - lo);
      }
      // 横に余白があれば、生存線の間隔を広げて画面の幅を使う
      const span = gaps.reduce((a, b) => a + b, 0), want = 1060 - (boxW[0] + boxW[boxW.length - 1]) / 2;
      if (gaps.length && span < want) for (let k = 0; k < gaps.length; k++) gaps[k] *= want / span;
      const xs = [boxW[0] / 2]; gaps.forEach(g => xs.push(xs[xs.length - 1] + g));
      const rowH = 58, top = boxH + 46;
      let row = 0;
      const items = [], order = [];
      const rows = msgs.map(m => { const r = row; row += m.from === m.to ? 1.6 : 1; return r; });
      const bottom = top + row * rowH + 10;
      P.forEach((p, i) => {
        const color = S.border(p.role || "process");
        const t = UZ.mkText(p.label, xs[i], boxH / 2, size, { weight: 500, color: S.label(p.role || "process") });
        items.push({ id: p.id, kind: "box", x: xs[i] - boxW[i] / 2, y: 0, w: boxW[i], h: boxH, r: S.radius, stroke: color, fill: S.fill(p.role || "process"), texts: [t], bbox: { x: xs[i] - boxW[i] / 2, y: 0, w: boxW[i], h: boxH },
          life: { pts: [[xs[i], boxH], [xs[i], bottom]] } });
        order.push(p.id);
      });
      msgs.forEach((m, k) => {
        const a = idx[m.from], b = idx[m.to], y = top + rows[k] * rowH;
        let pts, lab;
        if (a === b) {
          const x = xs[a];
          pts = [[x, y - 8], [x + 46, y - 8], [x + 46, y + 26], [x + 4, y + 26]];
          lab = UZ.mkText(m.label, x + 56, y + 9, lsize, { anchor: "start", color: S.ink });
        } else {
          const dir = Math.sign(xs[b] - xs[a]);
          pts = [[xs[a] + dir * 4, y], [xs[b] - dir * 6, y]];
          lab = UZ.mkText(m.label, (xs[a] + xs[b]) / 2, y - 16, lsize, { color: S.ink });
        }
        const xsMin = Math.min(...pts.map(p => p[0])), xsMax = Math.max(...pts.map(p => p[0]));
        items.push({ id: m.id, kind: "edge", pts, stroke: m.reply ? S.muted : S.ink, width: S.edgeW, dashed: !!m.reply, head: true, label: lab,
          bbox: { x: xsMin, y: Math.min(...pts.map(p => p[1])) - 4, w: xsMax - xsMin, h: Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1])) + 8 } });
        order.push(m.id);
      });
      const w = xs[xs.length - 1] + boxW[boxW.length - 1] / 2;
      // ローカル座標の原点を左端の箱の左に合わせる
      const shift = 0;
      void shift;
      return { w: Math.max(w, xs[P.length - 1] + 120), h: bottom, items, order };
    },
  };

  // ======== 箱と矢印（graph）========
  FIG.graph = {
    async layout(f, S, ctx) {
      const dir = (f.direction || "right").toLowerCase();
      const tries = [dir, dir === "right" ? "down" : "right"];
      let best = null;
      for (const d of tries) {
        const r = await layoutGraph(f, S, d, ctx);
        const s = Math.min(ctx.area.w / r.w, ctx.area.h / r.h, 1.3);
        r.score = s;
        if (!best || s > best.score * 1.12) best = r;   // 指定の向きを少し優先する
        if (!ctx.tryBoth) break;
        if (s >= 0.95) break;
      }
      return best;
    },
  };

  async function layoutGraph(f, S, dir, ctx) {
    const nsize = 25, lsize = 19, gsize = 19;
    const groups = f.groups || [];
    const bands = groups.filter(g => g.style === "band");
    const frames = groups.filter(g => g.style !== "band");
    const nodeSpec = {};
    for (const n of f.nodes) {
      const lines = UZ.wrap(n.label, nsize, 250, 500, 2);
      const w = Math.max(132, Math.max(...lines.map(s => UZ.textW(s, nsize, 500))) + 50);
      const subLines = n.sub ? UZ.wrap(n.sub, 17, Math.max(w - 30, 140), 400, 2) : [];
      const w2 = Math.max(w, ...subLines.map(s => UZ.textW(s, 17) + 34));
      const h = 72 + (lines.length - 1) * 32 + subLines.length * 22;
      nodeSpec[n.id] = { w: Math.round(w2), h, lines, subLines };
    }
    const edges = f.edges.map(e => ({ ...e, id: e.id || `${e.from}>${e.to}` }));
    const elkNode = id => {
      const s = nodeSpec[id];
      const o = { id, width: s.w, height: s.h };
      if (bands.length) {
        const bi = bands.findIndex(b => b.members.includes(id));
        o.layoutOptions = { "elk.partitioning.partition": String(Math.max(0, bi)) };
      }
      return o;
    };
    const inFrame = {};
    for (const g of frames) for (const m of g.members) inFrame[m] = g.id;
    const root = {
      id: "__root",
      layoutOptions: {
        "elk.algorithm": "layered", "elk.direction": dir === "down" ? "DOWN" : "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL", "elk.randomSeed": "1",
        "elk.layered.spacing.nodeNodeBetweenLayers": "44", "elk.spacing.nodeNode": "46",
        "elk.layered.spacing.edgeNodeBetweenLayers": "22", "elk.spacing.edgeLabel": "6", "elk.spacing.edgeEdge": "18",
        "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.partitioning.activate": bands.length ? "true" : "false",
      },
      children: [], edges: [],
    };
    for (const g of frames) {
      root.children.push({ id: g.id, layoutOptions: { "elk.padding": "[top=46,left=22,bottom=22,right=22]",
        ...(bands.length ? { "elk.partitioning.partition": String(Math.max(0, bands.findIndex(b => b.members.includes(g.id)))) } : {}) },
        children: g.members.filter(m => nodeSpec[m]).map(elkNode) });
    }
    for (const n of f.nodes) if (!inFrame[n.id]) root.children.push(elkNode(n.id));
    for (const e of edges) {
      root.edges.push({ id: e.id, sources: [e.from], targets: [e.to],
        labels: e.label ? [{ text: e.label, width: UZ.textW(e.label, lsize) + 10, height: lsize + 8 }] : [] });
    }
    const elk = new UZ.ELK();
    const r = await elk.layout(root);
    // 枠の中のノードの座標を絶対座標に直す
    const abs = {};
    const walk = (node, ox, oy) => {
      for (const c of node.children || []) {
        abs[c.id] = { x: ox + c.x, y: oy + c.y, w: c.width, h: c.height };
        walk(c, ox + c.x, oy + c.y);
      }
    };
    walk(r, 0, 0);
    // 辺: elkjs は INCLUDE_CHILDREN のとき、辺の座標を辺の container（共通の親）基準で返す
    const edgeGeom = {};
    const collectEdges = (node, ox, oy) => {
      for (const e of node.edges || []) {
        const cont = e.container && e.container !== node.id && abs[e.container] ? abs[e.container] : { x: ox, y: oy };
        const sec = (e.sections || [])[0];
        if (!sec) continue;
        const pts = [[sec.startPoint.x, sec.startPoint.y], ...(sec.bendPoints || []).map(b => [b.x, b.y]), [sec.endPoint.x, sec.endPoint.y]]
          .map(p => [p[0] + cont.x, p[1] + cont.y]);
        const lb = (e.labels || [])[0];
        edgeGeom[e.id] = { pts, label: lb ? { x: lb.x + cont.x, y: lb.y + cont.y, w: lb.width, h: lb.height } : null };
      }
      for (const c of node.children || []) collectEdges(c, ox + c.x, oy + c.y);
    };
    collectEdges(r, 0, 0);

    const items = [], order = [];
    let topPad = 0;
    // 層の帯
    if (bands.length) {
      topPad = 44;
      bands.forEach((b, bi) => {
        const mem = b.members.map(m => abs[m]).filter(Boolean);
        if (!mem.length) return;
        let bb;
        if (dir === "down") {
          const y0 = Math.min(...mem.map(m => m.y)) - 18, y1 = Math.max(...mem.map(m => m.y + m.h)) + 18;
          bb = { x: -150, y: y0, w: r.width + 170, h: y1 - y0 };
        } else {
          const x0 = Math.min(...mem.map(m => m.x)) - 24, x1 = Math.max(...mem.map(m => m.x + m.w)) + 24;
          bb = { x: x0, y: -topPad, w: x1 - x0, h: r.height + topPad + 14 };
        }
        const t = dir === "down"
          ? UZ.mkText(UZ.wrap(b.label, gsize, 120, 500, 2), bb.x + 14, bb.y + bb.h / 2, gsize, { anchor: "start", weight: 500, color: S.muted })
          : UZ.mkText(b.label, bb.x + bb.w / 2, bb.y + 22, gsize, { weight: 500, color: S.muted });
        items.push({ id: b.id, kind: "band", ...bb, r: 10, texts: [t], bbox: bb, members: b.members, order: bi });
      });
    }
    for (const g of frames) {
      const a = abs[g.id];
      if (!a) continue;
      const color = g.role ? S.role(g.role) : S.muted;
      const t = UZ.mkText(g.label || "", a.x + 16, a.y + 22, gsize, { anchor: "start", weight: 500, color: g.role ? color : S.muted });
      items.push({ id: g.id, kind: "frame", x: a.x, y: a.y, w: a.w, h: a.h, r: S.radius + 4, stroke: color, texts: [t], bbox: { x: a.x, y: a.y, w: a.w, h: a.h }, members: g.members });
    }
    for (const n of f.nodes) {
      const a = abs[n.id], sp = nodeSpec[n.id];
      const color = S.border(n.role || "process");
      const cx = a.x + a.w / 2;
      const labelCy = a.y + 32 + (sp.lines.length - 1) * 16 - 2;
      const texts = [UZ.mkText(sp.lines, cx, labelCy, nsize, { weight: 500, color: S.label(n.role || "process"), lineH: 32 })];
      if (sp.subLines.length) texts.push(UZ.mkText(sp.subLines, cx, labelCy + sp.lines.length * 16 + 4 + sp.subLines.length * 11, 17, { color: S.muted, lineH: 22 }));
      const shape = n.shape || (n.role === "store" ? "store" : "box");
      items.push({ id: n.id, kind: "box", x: a.x, y: a.y, w: a.w, h: a.h, r: shape === "round" ? a.h / 2 : S.radius, shape,
        stroke: color, fill: S.fill(n.role || "process"), texts, bbox: { x: a.x, y: a.y, w: a.w, h: a.h },
        dotAt: [cx, a.y + a.h - 12] });
      order.push(n.id);
    }
    for (const e of edges) {
      const g = edgeGeom[e.id];
      if (!g) continue;
      let pts = g.pts;
      let label = null;
      if (g.label && e.label) label = UZ.mkText(e.label, g.label.x + g.label.w / 2, g.label.y + g.label.h / 2, lsize, { color: S.ink });
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      items.push({ id: e.id, kind: "edge", pts, stroke: S.muted, width: S.edgeW, dashed: e.style === "dashed", head: true, label,
        from: e.from, to: e.to, bbox: { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: Math.max(...xs) - Math.min(...xs) + 6, h: Math.max(...ys) - Math.min(...ys) + 6 } });
    }
    // 表示の順: ノードを宣言の順に出し、両端が出そろった辺をその直後に引く
    const shown = new Set(), edgeLeft = edges.slice();
    for (const it of items) if (it.kind === "band" || it.kind === "frame") order.unshift(it.id);
    const nodeOrder = order.filter(id => nodeSpec[id]);
    const finalOrder = order.filter(id => !nodeSpec[id]);
    for (const id of nodeOrder) {
      finalOrder.push(id); shown.add(id);
      for (let i = 0; i < edgeLeft.length; i++) {
        const e = edgeLeft[i];
        if (shown.has(e.from) && shown.has(e.to)) { finalOrder.push(e.id); edgeLeft.splice(i, 1); i--; }
      }
    }
    // 全体の外接矩形でローカル座標を詰める
    const all = items.map(i => i.bbox).concat(items.filter(i => i.label).map(i => i.label.bbox));
    const minX = Math.min(...all.map(b => b.x)), minY = Math.min(...all.map(b => b.y));
    const maxX = Math.max(...all.map(b => b.x + b.w)), maxY = Math.max(...all.map(b => b.y + b.h));
    const pad = 6;
    UZ.shiftItems(items, -minX + pad, -minY + pad);
    return { w: maxX - minX + pad * 2, h: maxY - minY + pad * 2, items, order: finalOrder, dir };
  }

  // ======== 下の層: 図形を直接書く（canvas）========
  FIG.canvas = {
    async layout(f, S) {
      const W = f.width || 1184, H = f.height || 470, items = [], order = [];
      for (const s of f.shapes) {
        const color = s.color || S.border(s.role || "process");
        if (s.shape === "rect" || s.shape === "ellipse") {
          const texts = s.text ? [UZ.mkText(UZ.wrap(s.text, s.size || 22, s.w - 16, 500, 3), s.x + s.w / 2, s.y + s.h / 2, s.size || 22, { weight: 500, color: s.fill === "none" ? S.ink : S.label(s.role || "process") })] : [];
          items.push({ id: s.id, kind: "box", shape: s.shape === "ellipse" ? "ellipse" : "box", x: s.x, y: s.y, w: s.w, h: s.h, r: s.r ?? S.radius,
            stroke: color, fill: s.fill === "none" ? "none" : S.fill(s.role || "process"), texts, bbox: { x: s.x, y: s.y, w: s.w, h: s.h } });
        } else if (s.shape === "line" || s.shape === "arrow") {
          const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
          const label = s.text ? UZ.mkText(s.text, s.labelAt ? s.labelAt[0] : (xs[0] + xs[xs.length - 1]) / 2, s.labelAt ? s.labelAt[1] : Math.min(...ys) - 16, 19, { color: S.ink }) : null;
          items.push({ id: s.id, kind: "edge", pts: s.points, stroke: s.color || S.muted, width: s.width || S.edgeW, dashed: !!s.dashed, head: s.shape === "arrow", label,
            bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) || 1, h: Math.max(...ys) - Math.min(...ys) || 1 } });
        } else if (s.shape === "text") {
          const t = UZ.mkText(UZ.wrap(s.text, s.size || 22, s.maxW || 600, s.bold ? S.bold : 400, 4), s.x, s.y, s.size || 22, { anchor: s.anchor || "middle", weight: s.bold ? S.bold : 400, color: s.color || S.ink });
          // over = この文字を上に重ねてよい図形の id（円の中に置く名前など。配置の検査が「箱に重なる」と言わない）
          items.push({ id: s.id, kind: "text", texts: [t], bbox: { ...t.bbox }, over: s.over ? [].concat(s.over) : undefined });
        }
        order.push(s.id);
      }
      return { w: W, h: H, items, order, fixed: true };
    },
  };

  UZ.shiftItems = function (items, dx, dy) {
    const sb = b => { if (b) { b.x += dx; b.y += dy; } };
    const st = t => { t.x += dx; t.y += dy; sb(t.bbox); };
    for (const it of items) {
      if (it.x != null) { it.x += dx; it.y += dy; }
      if (it.bbox && it.bbox !== it) sb(it.bbox);
      if (it.pts) it.pts = it.pts.map(p => [p[0] + dx, p[1] + dy]);
      if (it.texts) it.texts.forEach(st);
      if (it.label) st(it.label);
      if (it.dotAt) it.dotAt = [it.dotAt[0] + dx, it.dotAt[1] + dy];
      if (it.life) it.life.pts = it.life.pts.map(p => [p[0] + dx, p[1] + dy]);
      if (it.glyph) { it.glyph.x += dx; it.glyph.y += dy; }
      if (it.bullet) { it.bullet.x += dx; it.bullet.y += dy; }
      if (it.rowBox) sb(it.rowBox);
      if (it.textBox) sb(it.textBox);
      if (it.staticMark) { it.staticMark.x += dx; it.staticMark.y += dy; }
      if (it.legend) { it.legend.x += dx; it.legend.y += dy; }
      if (it.poly) it.poly = it.poly.map(p => [p[0] + dx, p[1] + dy]);
    }
  };
})(globalThis.UZ = globalThis.UZ || {});
