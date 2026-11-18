// ugoku-zukai プレーヤー: スライド（見出し・言いたいこと・区画に並べた部品）。
// 部品は図（M.figs の 1 件）としてそのまま扱う。ここでは、スライドを指す場面を
// 「図の id の列・区画ごとの矩形・見出し・言いたいこと」に直し、スライドの形を検査する。
(function (UZ) {
  "use strict";
  UZ.GRID = { cols: 12, rows: 6, gap: 24 };
  UZ.FRAME_PAD = 20; UZ.FRAME_TITLE = 30;   // フレームの内側の余白と、題のぶんの高さ
  const ST = { size: 24, weight: 500, maxW: 1120, lineH: 34, pad: 14 };   // 言いたいことの文字
  UZ.STATEMENT = ST;
  const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // 言いたいことを折り返す。2 行まで（3 行になったら over）
  UZ.statementLines = function (text) {
    if (!text) return { lines: [], over: false };
    const all = UZ.wrap(String(text), ST.size, ST.maxW, ST.weight, 3);
    return { lines: all.slice(0, 2), over: all.length > 2 };
  };
  // スライドの本文の領域。言いたいことの行数ぶん、上を下げる
  UZ.slideBody = function (statementLines) {
    const B = UZ.AREA.body, d = statementLines ? ST.lineH * statementLines + ST.pad : 0;
    return { x: B.x, y: B.y + d, w: B.w, h: B.h - d };
  };
  // 区画（12 列 × 6 行。col・row は 1 始まりで両端を含む）の矩形。area を省くと全面
  UZ.cellRect = function (body, area) {
    if (!area) return { ...body };
    const G = UZ.GRID, cw = (body.w - G.gap * (G.cols - 1)) / G.cols, rh = (body.h - G.gap * (G.rows - 1)) / G.rows;
    const [c0, c1] = area.col, [r0, r1] = area.row;
    return { x: body.x + (cw + G.gap) * (c0 - 1), y: body.y + (rh + G.gap) * (r0 - 1), w: cw * (c1 - c0 + 1) + G.gap * (c1 - c0), h: rh * (r1 - r0 + 1) + G.gap * (r1 - r0) };
  };
  const partId = p => (p && (p.figure != null ? p.figure : p.id));
  UZ.partId = partId;

  // 図の表: figures に、スライドの中で宣言した部品（id と type を持つもの）と、space の板（plate）にその場で宣言した図（板の id で引く）を足す
  const figCache = new WeakMap();
  UZ.figuresOf = function (sb) {
    let m = figCache.get(sb);
    if (m) return m;
    m = { ...(sb.figures || {}) };
    for (const sl of Object.values(sb.slides || {})) for (const p of asList(sl && sl.parts)) {
      if (p && p.figure == null && p.id != null && p.type != null && !Object.prototype.hasOwnProperty.call(m, p.id)) m[p.id] = p;
    }
    for (const { plate } of platesIn(m)) {
      const f = plate.figure;
      if (f && typeof f === "object" && !Array.isArray(f) && typeof plate.id === "string" && !Object.prototype.hasOwnProperty.call(m, plate.id)) m[plate.id] = f;
    }
    figCache.set(sb, m);
    return m;
  };
  // space の部品の板（plate）の列 [{ space: 部品の id, plate: 板の宣言 }]。板の図は、その space の子の図になる（engine.js）
  function platesIn(figs) {
    const out = [];
    for (const [fid, f] of Object.entries(figs)) if (f && typeof f === "object" && f.type === "space" && Array.isArray(f.items))
      for (const o of f.items) if (o && typeof o === "object" && o.kind === "plate") out.push({ space: fid, plate: o });
    return out;
  }
  UZ.platesOf = sb => platesIn(UZ.figuresOf(sb));

  // 場面の図の列と区画。figure を指す場面は今までと同じ（図 1 つは全面、2 つは左右）
  UZ.sceneParts = function (sb, sc) {
    const FIGS = UZ.figuresOf(sb);
    if (sc.slide == null) {
      const figs = asList(sc.figure);
      const header = sc.title || (figs.length === 1 && FIGS[figs[0]].type !== "title" ? FIGS[figs[0]].title : "") || "";
      const B = UZ.AREA.body, ratio = sc.split || 0.56, gap = 40;
      const areas = figs.length === 1 ? [{ ...B }]
        : [{ x: B.x, y: B.y, w: (B.w - gap) * ratio, h: B.h }, { x: B.x + (B.w - gap) * ratio + gap, y: B.y, w: (B.w - gap) * (1 - ratio), h: B.h }];
      return { slide: null, figs, areas, header, statement: [], parts: figs.map(id => ({ id, transient: false, frame: false })) };
    }
    const sl = sb.slides[sc.slide];
    const statement = UZ.statementLines(sl.statement).lines;
    const body = UZ.slideBody(statement.length);
    const parts = sl.parts.map(p => ({ id: partId(p), transient: !!p.transient, frame: FIGS[partId(p)].type === "frame", area: p.area,
      // 部品に書いた fit・valign・halign は、図の宣言の値より優先する
      over: Object.fromEntries(["fit", "valign", "halign"].filter(k => p[k] != null).map(k => [k, p[k]])) }));
    // フレームの区画の中に入る部品は、枠の内側に余白を取る（枠に題があれば、その下から）
    const frames = parts.filter(p => p.frame);
    const within = (a, b) => !a || !b ? !b : a.col[0] >= b.col[0] && a.col[1] <= b.col[1] && a.row[0] >= b.row[0] && a.row[1] <= b.row[1];
    const areas = parts.map(p => {
      const r = UZ.cellRect(body, p.area);
      const fr = !p.frame && frames.find(q => within(p.area, q.area));
      if (!fr) return r;
      const pad = UZ.FRAME_PAD, top = pad + (FIGS[fr.id].title ? UZ.FRAME_TITLE : 0);
      return { x: r.x + pad, y: r.y + top, w: r.w - pad * 2, h: r.h - top - pad };
    });
    return { slide: sc.slide, figs: parts.map(p => p.id), areas, header: sc.title || sl.title || "", statement, parts };
  };

  // ---- 形の検査（validate から呼ぶ）----
  const pair = (v, max) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] >= 1 && v[1] <= max && v[0] <= v[1];
  const cross = (a, b) => a.col[0] <= b.col[1] && b.col[0] <= a.col[1] && a.row[0] <= b.row[1] && b.row[0] <= a.row[1];
  UZ.validateSlides = function (sb, E, W, ID_RE) {
    const G = UZ.GRID, slides = sb.slides;
    const usesSlide = (sb.scenes || []).some(sc => sc && sc.slide != null);
    if (sb.format === "ugoku-zukai/2") { if (slides != null || usesSlide) E(`slides を使うには format を "ugoku-zukai/3" と書く`); return; }
    if (slides == null) return;
    if (typeof slides !== "object" || Array.isArray(slides)) { E("slides は、スライドの id をキーにしたオブジェクトで書く"); return; }
    const typeOfId = {};   // morph の指す先を引く: 図の id と、スライドの中で宣言した部品の id → type
    for (const [fid, f] of Object.entries(sb.figures || {})) if (f && typeof f === "object") typeOfId[fid] = f.type;
    for (const sl of Object.values(slides)) for (const p of (sl && Array.isArray(sl.parts) ? sl.parts : [])) if (p && p.figure == null && p.id != null && p.type != null) typeOfId[p.id] = p.type;
    const declared = new Set();   // スライドの中で宣言した部品の id（台本全体で 1 つ）
    for (const [sid, sl] of Object.entries(slides)) {
      const where = `スライド「${sid}」`;
      if (!ID_RE.test(sid)) E(`${where}: id に使えない文字がある（/ : 空白は不可）`);
      if (!sl || typeof sl !== "object") { E(`${where}: オブジェクトで書く`); continue; }
      if (!sl.title || typeof sl.title !== "string") E(`${where}: title がない（スライドの見出し）`);
      if (sl.statement != null && typeof sl.statement !== "string") E(`${where}: statement は文字列で書く`);
      if (typeof sl.statement === "string" && UZ.statementLines(sl.statement).over) E(`${where}: 言いたいことが 2 行に収まらない（1 文を短くする。3 行目からは画面に出ない）`);
      if (sl.tone != null && !["dark", "light"].includes(sl.tone)) E(`${where}: tone は dark か light（dark で章扉の地。テーマに chapter がなければ通常の地）`);
      if (sl.start != null && sl.start !== "complete") E(`${where}: start は "complete" だけ（最初から完成形で出す。省くと、行の動作で出していく）`);
      if (!Array.isArray(sl.parts) || !sl.parts.length) { E(`${where}: parts（部品の列）がない`); continue; }
      const seen = new Set(), placed = [];
      for (const p of sl.parts) {
        if (!p || typeof p !== "object") { E(`${where}: 部品はオブジェクトで書く`); continue; }
        const id = partId(p), pw = `${where}の部品「${id}」`;
        if (id == null) { E(`${where}: 部品に id（その場で宣言する）か figure（figures の図を指す）がない`); continue; }
        if (p.figure != null) {
          if (p.type != null) E(`${pw}: figure と type は一緒に書けない`);
          if (!sb.figures || !Object.prototype.hasOwnProperty.call(sb.figures, p.figure)) { E(`${pw}: 図「${p.figure}」が figures にない`); continue; }
        } else {
          if (p.type == null) { E(`${pw}: type がない`); continue; }
          if (declared.has(id) || (sb.figures && Object.prototype.hasOwnProperty.call(sb.figures, id))) { E(`${pw}: id が重複している（図や、他のスライドの部品と同じ id は使えない）`); continue; }
          declared.add(id);
        }
        if (seen.has(id)) { E(`${pw}: 同じスライドに 2 度置いている`); continue; }
        seen.add(id);
        if (p.morph != null) {
          const mt = typeof p.morph === "string" && Object.prototype.hasOwnProperty.call(typeOfId, p.morph) ? typeOfId[p.morph] : undefined;
          const own = p.figure != null ? sb.figures[p.figure].type : p.type;
          if (typeof p.morph !== "string" || mt === undefined) E(`${pw}: morph「${p.morph}」が台本にない（図の id か、他のスライドで宣言した部品の id を書く）`);
          else if (mt !== own) E(`${pw}: morph は同じ type の部品どうしでだけ使える（${p.morph} は ${mt}、この部品は ${own}）`);
          else if (sl.parts.some(q => q && partId(q) === p.morph)) E(`${pw}: morph「${p.morph}」と同じスライドには一緒に置けない（前のスライドの部品を指す）`);
        }
        if (p.transient != null && typeof p.transient !== "boolean") E(`${pw}: transient は true か false`);
        if (p.area == null) {
          if (sl.parts.length > 1) E(`${pw}: area が要る（部品が 2 つ以上のスライドでは、全部の部品に区画を書く）`);
          continue;
        }
        if (typeof p.area !== "object" || !pair(p.area.col, G.cols) || !pair(p.area.row, G.rows)) { E(`${pw}: area は { "col": [1〜${G.cols}, 1〜${G.cols}], "row": [1〜${G.rows}, 1〜${G.rows}] }（始まり ≦ 終わり）で書く`); continue; }
        const type = p.figure != null ? sb.figures[p.figure].type : p.type;
        if (!p.transient && type !== "frame") {
          for (const q of placed) if (cross(q.area, p.area)) E(`${where}: 部品「${q.id}」と「${id}」の区画が完成形で重なる（入れ替えて使うなら、途中で消すほうに transient: true と書く）`);
          placed.push({ id, area: p.area });
        }
      }
    }
  };
})(globalThis.UZ = globalThis.UZ || {});
