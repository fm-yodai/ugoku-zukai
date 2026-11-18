// ugoku-zukai プレーヤー: コマ（UZ.frame の結果）を SVG に写す。DOM に触るのはこのファイルだけ
(function (UZ) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const { clamp, smooth, ease, outBack } = UZ;
  // 箱の出方の区間（show を 0→1 として [始まり, 長さ]）。既定と、draw（線が先に伸びる）
  const D0 = { line: 0.75, fill: [0.35, 0.55], text: [0.45, 0.5], label: [0.5, 0.5], smark: [0.6, 0.4] };
  const D = { line: 0.7, fill: [0.65, 0.35], text: [0.7, 0.3], label: [0.7, 0.3], smark: [0.7, 0.3] };
  const C = UZ.color;

  const polyLen = P => P.reduce((a, q, i) => i ? a + Math.hypot(q[0] - P[i - 1][0], q[1] - P[i - 1][1]) : 0, 0);

  const ellLen = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));   // 楕円の周長（Ramanujan の近似）
  // 箱の枠の長さ（形ごと。R は大きさを変えた箱の矩形）
  function boxLen(it, R) {
    const w = R.w, h = R.h;
    if (it.shape === "ellipse") return ellLen(w / 2, h / 2);
    if (it.shape === "diamond") return 4 * Math.hypot(w / 2, h / 2);
    if (it.shape === "poly") return polyLen([...it.poly, it.poly[0]]);
    if (it.shape === "store") return 1.5 * ellLen(w / 2, 9) + 2 * (h - 18);
    return 2 * (w + h) - (8 - 2 * Math.PI) * it.r;
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const ptsD = pts => "M" + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L");
  // 矢じり（折れ線の最後の区間の向き）
  function headD(pts, k) {
    const n = pts.length, tip = pts[n - 1], from = pts[n - 2];
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]), Lh = 12 * k, Wh = 6 * k;
    const a = [tip[0] - Lh * Math.cos(ang) + Wh * Math.sin(ang), tip[1] - Lh * Math.sin(ang) - Wh * Math.cos(ang)];
    const b = [tip[0] - Lh * Math.cos(ang) - Wh * Math.sin(ang), tip[1] - Lh * Math.sin(ang) + Wh * Math.cos(ang)];
    return `M${a}L${tip}L${b}Z`;
  }
  // 面の色の補間（Morph で role が変わったとき）。透明度も補間する。"none" は透明として扱う
  function mixFill(c1, c2, p) {
    if (c1 === "none" && c2 === "none") return "none";
    const a = C.parse(c1 === "none" ? c2 : c1), b = C.parse(c2 === "none" ? c1 : c2);
    const aa = c1 === "none" ? 0 : a[3], ba = c2 === "none" ? 0 : b[3], m = (x, y) => x + (y - x) * p;
    return `rgba(${[0, 1, 2].map(i => Math.round(m(a[i], b[i]))).join(",")},${+m(aa, ba).toFixed(3)})`;
  }
  const GLYPH = {
    check: "M-7,0 L-2,5 L8,-6",
    cross: "M-6,-6 L6,6 M6,-6 L-6,6",
    question: "M-4,-5 C-4,-10 6,-10 6,-4 C6,0 1,0 1,4 M1,8.5 L1,9",
    dot: "M0,0 L0,0",
    arrowdown: "M0,-8 L0,7 M-6,1 L0,7 L6,1",
  };

  class View {
    constructor(svg, M) {
      this.svg = svg; this.M = M; this.S = M.S; this.subtitles = true;
      this.els = {};
      svg.setAttribute("viewBox", "0 0 1280 720");
      svg.innerHTML = "";
      const S = this.S, th = M.theme;
      this.font = S.font;
      el("rect", { x: 0, y: 0, width: 1280, height: 720, fill: S.bg }, svg);
      // 章扉の地（テーマの chapter）。題の札だけの場面で重ねる
      this.chap = th.chapter || null;
      this.bgDark = this.chap ? el("rect", { x: 0, y: 0, width: 1280, height: 720, fill: this.chap.bg }, svg) : null;
      if (this.bgDark) this.bgDark.style.opacity = 0;
      const defs = el("defs", null, svg);
      if (th.shape.glow) {
        const f = el("filter", { id: "uz-glow", x: "-40%", y: "-40%", width: "180%", height: "180%" }, defs);
        el("feGaussianBlur", { stdDeviation: 5, result: "b" }, f);
        const mg = el("feMerge", null, f); el("feMergeNode", { in: "b" }, mg); el("feMergeNode", { in: "SourceGraphic" }, mg);
      }
      // ぼかしのフィルタの id は、View ごとに分ける（コマのシートは、いくつもの View の SVG を 1 枚に並べる。id が重なると範囲が入れ替わる）
      this.defs = defs; this.blurN = 0; this.viewN = UZ._viewSeq = (UZ._viewSeq || 0) + 1;
      if (th.shape.shadow) {
        const f = el("filter", { id: "uz-shadow", x: "-20%", y: "-20%", width: "140%", height: "160%" }, defs);
        el("feDropShadow", { dx: 0, dy: 2, stdDeviation: 3, "flood-color": "#1d2433", "flood-opacity": 0.12 }, f);
      }
      // 章の題
      const H = UZ.AREA.header;
      this.header = el("g", null, svg);
      this.headerBar = el("rect", { x: H.x, y: H.y + 12, width: 5, height: 32, rx: 2, fill: S.accent }, this.header);
      this.headerT = this.text(this.header, [""], H.x + 20, H.y + H.h / 2, 30, { weight: S.bold, color: S.ink, anchor: "start" });
      this.headerT2 = this.text(this.header, [""], H.x + 20, H.y + H.h / 2, 30, { weight: S.bold, color: S.ink, anchor: "start" });
      // 言いたいこと（スライドの見出しの下の 1 文。頭に ▶）
      const ST = UZ.STATEMENT, SB = UZ.AREA.body;
      this.stG = el("g", null, svg);
      this.stMark = this.text(this.stG, ["▶"], H.x + 2, SB.y + ST.lineH / 2, 16, { color: S.accent, anchor: "start" });
      const stText = () => this.text(this.stG, [""], H.x + 26, SB.y, ST.size, { weight: ST.weight, color: S.ink, anchor: "start", lineH: ST.lineH });
      this.stT = stText(); this.stT2 = stText();
      // 図: 1 つのレイヤーにまとめ、カメラで寄せている間だけ body の clipPath をかける（見出し・言いたいこと・字幕・札・クレジットはレイヤーの外）。
      // clipPath は矩形ごとに初めて使うときに作り、id は矩形の値から決める（コマのシートで View を並べても、同じ id は同じ中身。
      // 作った順の番号にすると、--scenes で書いたコマと全体のコマで中身が変わる）
      this.clips = {};
      this.figLayer = el("g", null, svg);
      this.figG = {};
      for (const F of Object.values(M.figs)) this.buildFig(F);
      this.capG = el("g", null, svg);
      this.capEls = {};
      for (const sc of M.scenes) for (const c of sc.captions) {
        const k = sc.id + c.fig;
        this.capEls[k] = this.text(this.capG, [c.text], c.x, c.y, 21, { weight: 500, color: S.muted });
      }
      this.customG = el("g", null, svg);
      this.customs = (M.customs || []);
      // 右上の札
      this.badge = el("g", null, svg);
      this.badgeR = el("rect", { y: 36, height: 38, rx: 19, fill: C.rgba(S.accent, 0.14), stroke: S.accent, "stroke-width": 1.5 }, this.badge);
      this.badgeT = this.text(this.badge, [""], 0, 55, 19, { weight: S.bold, color: S.ink });
      // 字幕
      const sub = th.subtitle || {};
      this.sub = el("g", null, svg);
      this.subR = el("rect", { rx: 10, fill: sub.bg || "rgba(0,0,0,0.6)" }, this.sub);
      this.subT = this.text(this.sub, [""], 640, 0, 27, { color: sub.ink || S.ink, weight: 500 });
      // クレジット（常に出す）
      this.creditT = this.text(svg, [M.credit], 1262, 711, 13, { color: S.muted, anchor: "end" });
      // 終わりの札
      this.endG = el("g", null, svg);
      this.text(this.endG, UZ.wrap(M.title, 40, 1000, S.bold, 2), 640, 320, 40, { weight: S.bold, color: S.ink });
      this.text(this.endG, ["音声: " + M.credit], 640, 410, 22, { color: S.muted });
      (M.credits || []).forEach((c, i) => this.text(this.endG, [c], 640, 446 + i * 26, 18, { color: S.muted }));   // 画像のクレジット
    }

    text(parent, lines, x, y, size, o = {}) {
      const lineH = o.lineH || Math.round(size * 1.38);
      const t = el("text", { x, "font-size": size, "font-family": this.font, "font-weight": o.weight || 400, fill: o.color || this.S.ink,
        "text-anchor": o.anchor || "middle", "dominant-baseline": "central" }, parent);
      if (o.halo) { t.setAttribute("stroke", this.S.bg); t.setAttribute("stroke-width", 6); t.setAttribute("stroke-linejoin", "round"); t.setAttribute("paint-order", "stroke"); }
      t._lineH = lineH; t._x = x; t._y = y;
      this.setLines(t, lines);
      return t;
    }
    setLines(t, lines) {
      while (t.firstChild) t.removeChild(t.firstChild);
      const n = lines.length;
      lines.forEach((s, i) => { const sp = el("tspan", { x: t._x, y: t._y - (n - 1) * t._lineH / 2 + i * t._lineH }, t); sp.textContent = s; });
    }
    textSpec(parent, T, o = {}) {
      const t = this.text(parent, T.lines, T.x, T.y, T.size, { weight: T.weight, color: o.color || T.color, anchor: T.anchor, lineH: T.lineH, halo: o.halo });
      if (T.spans) this.setSpans(t, T.spans, T.emColor);
      return t;
    }
    // 強調の語のある文: 行ごとの tspan の中に、区切りごとの tspan を入れる（強調は太字と強調色）
    setSpans(t, spans, emColor) {
      while (t.firstChild) t.removeChild(t.firstChild);
      const n = spans.length;
      spans.forEach((row, i) => {
        const line = el("tspan", { x: t._x, y: t._y - (n - 1) * t._lineH / 2 + i * t._lineH }, t);
        for (const seg of row) { const sp = el("tspan", seg.em ? { "font-weight": this.S.bold, fill: emColor || this.S.accent } : null, line); sp.textContent = seg.t; }
      });
    }

    buildFig(F) {
      const S = F.dark ? (this.SD || (this.SD = UZ.darkStyleOf(this.S))) : this.S, g = el("g", null, this.figLayer);   // 暗い地のスライドで組んだ部品は、暗い地の色
      const L = { back: el("g", null, g), edge: el("g", null, g), box: el("g", null, g), fx: el("g", null, g) };
      this.figG[F.id] = g;
      const glow = this.M.theme.shape.glow, shadow = this.M.theme.shape.shadow;
      for (const it of Object.values(F.items)) {
        const E = { it };
        if (it.kind === "box") {
          E.g = el("g", null, L.box);
          // 点がいる箱の強調（trace）: 外側に、点の色の薄い輪（四角と楕円。ひし形などは枠だけ）
          if (it.dotAt && !["diamond", "poly", "store"].includes(it.shape)) {
            E.hereR = it.shape === "ellipse" ? el("ellipse", { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2 + 6, ry: it.h / 2 + 6, fill: "none", "stroke-width": 5, opacity: 0 }, E.g)
              : el("rect", { x: it.x - 6, y: it.y - 6, width: it.w + 12, height: it.h + 12, rx: it.r + 6, fill: "none", "stroke-width": 5, opacity: 0 }, E.g);
          }
          const sw = S.stroke;
          const mk = (fill, stroke, extra) => {
            if (it.shape === "diamond") return el("path", { d: `M${it.x + it.w / 2},${it.y} L${it.x + it.w},${it.y + it.h / 2} L${it.x + it.w / 2},${it.y + it.h} L${it.x},${it.y + it.h / 2} Z`, fill, stroke, "stroke-width": sw, "stroke-linejoin": "round", ...extra }, E.g);
            if (it.shape === "poly") return el("path", { d: ptsD(it.poly) + "Z", fill, stroke, "stroke-width": sw, "stroke-linejoin": "round", ...extra }, E.g);
            if (it.shape === "ellipse") return el("ellipse", { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, fill, stroke, "stroke-width": sw, ...extra }, E.g);
            if (it.shape === "store") {
              const ry = 9, x = it.x, y = it.y, w = it.w, h = it.h;
              const d = `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} L${x + w},${y + h - ry} A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`;
              return el("path", { d, fill, stroke, "stroke-width": sw, ...extra }, E.g);
            }
            return el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill, stroke, "stroke-width": sw, ...extra }, E.g);
          };
          E.fill = mk(it.fill, "none", shadow ? { filter: "url(#uz-shadow)" } : {});
          if (it.header) E.head = el("path", { d: `M${it.x},${it.y + it.header.h} V${it.y + it.r} Q${it.x},${it.y} ${it.x + it.r},${it.y} H${it.x + it.w - it.r} Q${it.x + it.w},${it.y} ${it.x + it.w},${it.y + it.r} V${it.y + it.header.h} Z`, fill: it.header.fill }, E.g);
          E.stroke = mk("none", it.stroke, {});
          if (glow) E.stroke.setAttribute("filter", "url(#uz-glow)");
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
          if (it.label) E.label = this.textSpec(E.g, it.label, { halo: true });
          if (it.staticMark) E.smark = this.glyph(E.g, it.staticMark.kind, it.staticMark.x, it.staticMark.y, it.staticMark.kind === "cross" ? S.bad : it.staticMark.kind === "question" ? S.warn : S.good, 1);
          if (it.life) E.life = el("path", { d: ptsD(it.life.pts), stroke: S.line, "stroke-width": 2, "stroke-dasharray": "6 6", fill: "none" }, L.back);
        } else if (it.kind === "edge") {
          E.g = el("g", null, it.isReply ? L.fx : L.edge);
          E._elen = polyLen(it.pts);
          E.line = el("path", { d: ptsD(it.pts), fill: "none", stroke: it.stroke, "stroke-width": it.width, "stroke-linejoin": "round", "stroke-linecap": "round",
            ...(it.dashed ? { "stroke-dasharray": "7 6" } : {}) }, E.g);
          if (it.head) E.head = el("path", { d: headD(it.pts, it.headScale || 1), fill: it.stroke, stroke: it.stroke, "stroke-width": 1, "stroke-linejoin": "round" }, E.g);
          if (it.label) E.label = this.textSpec(it.isReply ? E.g : L.fx, it.label, { halo: true });
        } else if (it.kind === "text") {
          E.g = el("g", null, L.box);
          if (it.panel) el("rect", { x: it.panel.x, y: it.panel.y, width: it.panel.w, height: it.panel.h, rx: it.panel.r, fill: it.panel.fill, stroke: it.panel.stroke, "stroke-width": 1.2 }, E.g);
          if (it.rowBox) E.hl = el("rect", { x: it.rowBox.x, y: it.rowBox.y, width: it.rowBox.w, height: it.rowBox.h, rx: 8, fill: C.rgba(S.accent, 0.12), opacity: 0 }, E.g);
          if (it.bullet) {
            if (it.bullet.kind === "num") {
              el("circle", { cx: it.bullet.x, cy: it.bullet.y, r: it.bullet.r, fill: C.rgba(S.accent, 0.16), stroke: S.accent, "stroke-width": 2 }, E.g);
              this.text(E.g, [String(it.bullet.n)], it.bullet.x, it.bullet.y, 19, { weight: S.bold, color: S.ink });
            } else el("circle", { cx: it.bullet.x, cy: it.bullet.y, r: it.bullet.r, fill: S.accent }, E.g);
          }
          if (it.legend) el("rect", { x: it.legend.x, y: it.legend.y - 8, width: 18, height: 16, rx: 3, fill: it.legend.color }, E.g);
          if (it.glyph) this.glyph(E.g, it.glyph.kind, it.glyph.x, it.glyph.y, it.glyph.color, 0.85);
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
          if (it.staticMark) this.glyph(E.g, it.staticMark.kind, it.staticMark.x, it.staticMark.y, it.staticMark.kind === "cross" ? S.bad : it.staticMark.kind === "question" ? S.warn : S.good, 1);
        } else if (it.kind === "image") {
          E.g = el("g", null, L.box);
          el("image", { x: it.x, y: it.y, width: it.w, height: it.h, href: this.M.assets[it.src].data, preserveAspectRatio: "xMidYMid meet" }, E.g);
        } else if (it.kind === "bar") {
          E.g = el("g", null, L.box);
          E.rect = el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill: it.fill, stroke: it.stroke, "stroke-width": it.solid ? 0 : S.stroke }, E.g);
          if (it.solid) E.rect.setAttribute("fill", it.stroke);
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
          if (it.label) E.label = this.textSpec(E.g, it.label, { halo: true });
        } else if (it.kind === "rect") {
          E.g = el("g", null, L.back);
          E.bg = el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill: it.fill === "none" ? C.rgba(S.accent, 0) : it.fill }, E.g);
          if (it.quad) E.tintR = el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, opacity: 0 }, E.g);   // 象限を途中で塗る（tint）ための面
          if (it.rule) E.rule = el("path", { d: `M${it.x},${it.y + it.h} H${it.x + it.w}`, stroke: S.line, "stroke-width": 1.2 }, E.g);
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
        } else if (it.kind === "band") {
          E.g = el("g", null, L.back);
          el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill: C.rgba(S.ink, 0.03), stroke: S.line, "stroke-width": 1.2 }, E.g);
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
        } else if (it.kind === "frame") {
          E.g = el("g", null, L.back);
          E.fill = el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill: C.rgba(it.stroke, 0.04) }, E.g);
          E.stroke = el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, fill: "none", stroke: C.rgba(it.stroke, 0.7), "stroke-width": 1.6, "stroke-dasharray": "8 6" }, E.g);
          E.texts = (it.texts || []).map(T => this.textSpec(E.g, T));
        } else if (it.kind === "custom") {
          // 自由描画の部品: 外側の g に出し方・薄くするを掛け、内側の g（部品のローカル座標）を毎コマ空にして関数に渡す
          E.g = el("g", null, L.box);
          E.inner = el("g", null, E.g);
          E.S = S;
          E.geo = UZ.makeGeo(el, S);   // 部品ごとに 1 つ（地の色ごとの S を持つ）。geo.errors は描くたびに空にする
          try { E.fn = new Function("return (" + this.M.sb.custom[it.fn] + ")")(); } catch (e) { E.fn = null; console.error("custom の読み込みに失敗", it.fn, e); }
        } else if (it.kind === "mark") {
          E.g = el("g", null, L.fx);
          E.bgc = el("circle", { cx: 0, cy: 0, r: 15, fill: S.bg, stroke: S.good, "stroke-width": 2.4 }, E.g);
          E.path = el("path", { d: GLYPH.check, fill: "none", stroke: S.good, "stroke-width": 3.4, "stroke-linecap": "round", "stroke-linejoin": "round" }, E.g);
        } else if (it.kind === "note") {
          E.g = el("g", null, L.fx);
          if (it.link) E.link = el("path", { d: ptsD(it.link), stroke: S.accent, "stroke-width": 1.5, "stroke-dasharray": "3 4", fill: "none" }, E.g);
          E.texts = it.texts.map(T => this.textSpec(E.g, T, { halo: true }));
        } else if (it.kind === "dot") {
          E.g = el("g", null, L.fx);
          E.dotC = el("circle", { r: it.r, fill: it.color, filter: glow ? "url(#uz-glow)" : null, stroke: glow ? null : S.bg, "stroke-width": glow ? null : 2 }, E.g);
          E.pill = el("g", { transform: "translate(0,30)" }, E.g);
          E.pillR = el("rect", { y: -15, height: 30, rx: 15, fill: S.bg, stroke: it.color, "stroke-width": 1.6 }, E.pill);
          E.pillT = this.text(E.pill, [""], 0, 0, 17, { weight: S.bold, color: S.ink });
        } else {
          continue;
        }
        this.els[it.key] = E;
      }
    }
    // 破線を「伸びて描かれる」ように見せる: 実線のダッシュで描く線を mask にして破線に被せる
    // （破線の stroke-dasharray と、描画の stroke-dashoffset は両立しない）。mask の id は部品のキーと進み具合から決める
    // （View ごとの連番にすると、--scenes で書いたコマが全体のときと変わる）。on = false で外す
    dashMask(E, key, it, p, on, pts) {
      const line = E.stroke && it.kind === "frame" ? E.stroke : E.line;
      if (!on) { if (E.dm) line.removeAttribute("mask"); return; }
      if (!E.dm) {
        const b = it.bbox || { x: it.x, y: it.y, w: it.w, h: it.h };
        const m = el("mask", { maskUnits: "userSpaceOnUse", x: b.x - 20, y: b.y - 20, width: b.w + 40, height: b.h + 40 }, this.defs);
        const w = (it.width || 1.6) + 6;
        // resvg は pathLength を見ないので、mask の線は実際の長さで伸ばす（dasharray と dashoffset を長さ倍する）
        const len = it.kind === "frame" ? 2 * (it.w + it.h) - (8 - 2 * Math.PI) * it.r : polyLen(pts || it.pts);
        E.dmLen = len;
        const base = { fill: "none", stroke: "#fff", "stroke-width": w, "stroke-dasharray": `${len.toFixed(2)} ${(len + 10).toFixed(2)}` };
        E.dmPath = it.kind === "frame" ? el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.r, ...base }, m) : el("path", { d: ptsD(pts || it.pts), "stroke-linejoin": "round", ...base }, m);
        E.dm = m;
      }
      if (it.kind === "edge" && pts && E._dmPts !== pts) { E._dmPts = pts; E.dmPath.setAttribute("d", ptsD(pts)); E.dmLen = polyLen(pts); const l = E.dmLen.toFixed(2); E.dmPath.setAttribute("stroke-dasharray", `${l} ${(E.dmLen + 10).toFixed(2)}`); }   // Morph で経路が変わったとき
      const off = ((1 - p) * E.dmLen).toFixed(2);
      E.dmPath.setAttribute("stroke-dashoffset", off);
      const id = `uz-dm-${key.replace(/[^A-Za-z0-9_-]/g, "_")}-${Math.round((1 - p) * 1000)}`;
      E.dm.setAttribute("id", id);
      line.setAttribute("mask", `url(#${id})`);
    }
    // 線を p（0〜1）まで伸ばす。p が 1 なら dasharray を外す
    strokeDraw(e, L, p) {
      if (p >= 0.9999) { if (e._dashed) { e._dashed = false; e.removeAttribute("stroke-dasharray"); e.removeAttribute("stroke-dashoffset"); } return; }
      e._dashed = true;
      const l = L.toFixed(2);
      e.setAttribute("stroke-dasharray", `${l} ${l}`);
      e.setAttribute("stroke-dashoffset", ((1 - p) * L).toFixed(2));
    }
    glyph(parent, kind, x, y, color, scale) {
      const g = el("g", { transform: `translate(${x},${y}) scale(${scale})` }, parent);
      if (kind === "dot") el("circle", { r: 4, fill: color }, g);
      else el("path", { d: GLYPH[kind] || GLYPH.check, fill: "none", stroke: color, "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
      return g;
    }

    render(t) {
      const M = this.M, S = this.S, fr = UZ.frame(M, t);
      // カメラの clip（図の place には、カメラが合成済み）
      const cam = fr.camera, c = cam && cam.on ? cam.clip : null;
      const cid = c ? `uz-body-${[c.x, c.y, c.w, c.h].map(v => Math.round(v * 10) / 10).join("-").replace(/\./g, "_")}` : "";
      if (c && !this.clips[cid]) this.clips[cid] = el("rect", { x: c.x, y: c.y, width: c.w, height: c.h }, el("clipPath", { id: cid }, this.defs));
      if (this._clip !== cid) { this._clip = cid; if (cid) this.figLayer.setAttribute("clip-path", `url(#${cid})`); else this.figLayer.removeAttribute("clip-path"); }
      for (const [fid, g] of Object.entries(this.figG)) {
        const f = fr.figs[fid];
        g.style.opacity = f.opacity;
        g.style.display = f.opacity < 0.002 ? "none" : "";
        if (f.place) g.setAttribute("transform", `translate(${f.place.ox.toFixed(2)},${f.place.oy.toFixed(2)}) scale(${f.place.s.toFixed(4)})`);
      }
      for (const [key, E] of Object.entries(this.els)) {
        const it = E.it, s = fr.st[key] || { show: 0, dim: 1, pulse: 0, off: [0, 0] };
        const show = s.show, blur = s.blur || 0, dim = s.dim * (1 - 0.35 * blur);
        // ぼかし（blur）: 部品ごとのフィルタを、初めてぼかすときに作る。範囲は部品の外枠から座標で決める
        // （外枠の割合で取ると、水平な線は高さ 0 で消える。広く取りすぎると PNG にするのが遅い）
        const bl = blur > 0.02 && E.g && it.bbox ? +(blur * 4).toFixed(2) : 0;
        if (E.g && E._bl !== bl) {
          E._bl = bl;
          const blurEls = E.label && E.label.parentNode !== E.g ? [E.g, E.label] : [E.g];   // 辺のラベルは別の層にある
          if (bl) {
            if (!E.blurF) {
              let x0 = it.bbox.x, y0 = it.bbox.y, x1 = x0 + it.bbox.w, y1 = y0 + it.bbox.h;
              for (const b of [it.label && it.label.bbox, ...(it.texts || []).map(T => T.bbox)]) if (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
              const f = el("filter", { id: `uz-bl-${this.viewN}-${++this.blurN}`, filterUnits: "userSpaceOnUse", x: x0 - 28, y: y0 - 28, width: x1 - x0 + 56, height: y1 - y0 + 56 }, this.defs);
              E.blurF = el("feGaussianBlur", { stdDeviation: bl }, f);
              E.blurId = f.getAttribute("id"); E.blurBox = f;
            }
            E.blurF.setAttribute("stdDeviation", bl);
            for (const g of blurEls) g.setAttribute("filter", `url(#${E.blurId})`);
          } else for (const g of blurEls) g.removeAttribute("filter");
        }
        // custom の部品は、描き場の大きさが場面ごとに変わるので、ぼかす範囲もそのコマの区画にする
        const bfo = bl && it.kind === "custom" && E.blurBox && fr.figs[it.fig] && fr.figs[it.fig].place;
        if (bfo && bfo.w != null) for (const [k, v] of [["x", -28], ["y", -28], ["width", bfo.w + 56], ["height", bfo.h + 56]]) E.blurBox.setAttribute(k, v.toFixed(1));
        const op = (x) => (x * dim).toFixed(3);
        const off = s.off || [0, 0];
        if (it.kind === "box") {
          // draw（show の draw: true）: 線が先に伸び（0〜0.7）、塗り（0.65〜）と文字（0.7〜）が後から出る
          const dr = s.draw ? D : D0;
          const draw = smooth(clamp(show / dr.line));
          E.stroke.style.opacity = op(show > 0 ? 1 : 0);
          const fillO = smooth((show - dr.fill[0]) / dr.fill[1]);
          E.fill.style.opacity = op(fillO); if (E.head) E.head.style.opacity = op(fillO);
          for (const tx of E.texts) tx.style.opacity = op(smooth((show - dr.text[0]) / dr.text[1]));
          if (E.label) E.label.style.opacity = op(smooth((show - dr.label[0]) / dr.label[1]));
          if (E.smark) E.smark.style.opacity = op(smooth((show - dr.smark[0]) / dr.smark[1]));
          if (it.count && E.texts[it.count.index]) {
            const c = it.count, v = c.to * ease(clamp((show - 0.3) / 0.7));
            const str = c.prefix + UZ.fmtNum(show >= 1 ? c.to : v, c.decimals ?? (c.to % 1 ? 1 : 0));
            if (E._count !== str) { E._count = str; this.setLines(E.texts[it.count.index], [str]); }
          }
          if (E.life) E.life.style.opacity = op(smooth((show - 0.5) / 0.5) * 0.9);
          const sc = 1 + 0.07 * (s.pulse || 0);
          // 大きさを変えた箱（resize）: 面と枠の形を書き換え、文字は箱に付いていく
          const R = s.rect || it, geo = s.rect ? [R.x, R.y, R.w, R.h].map(v => v.toFixed(2)).join(",") : "";
          if ((E._geo || "") !== geo) {
            E._geo = geo;
            for (const e of [E.fill, E.stroke]) {
              if (it.shape === "ellipse") { e.setAttribute("cx", R.x + R.w / 2); e.setAttribute("cy", R.y + R.h / 2); e.setAttribute("rx", R.w / 2); e.setAttribute("ry", R.h / 2); }
              else { e.setAttribute("x", R.x); e.setAttribute("y", R.y); e.setAttribute("width", R.w); e.setAttribute("height", R.h); }
            }
            const to = s.rect && s.textOff ? `translate(${s.textOff[0].toFixed(2)},${s.textOff[1].toFixed(2)})` : null;
            for (const tx of [...E.texts, E.smark].filter(Boolean)) { if (to) tx.setAttribute("transform", to); else tx.removeAttribute("transform"); }
            // 見出しの帯（compare のカード）は、箱の形に合わせて伸び縮みする
            if (E.head) { if (s.rect) E.head.setAttribute("transform", `translate(${R.x},${R.y}) scale(${R.w / it.w},${R.h / it.h}) translate(${-it.x},${-it.y})`); else E.head.removeAttribute("transform"); }
          }
          // 枠の描画: 実際の長さで伸ばす（resvg は pathLength を見ない）。描き終えたら dasharray を外して、どの描画系でも実線にする
          if (E._lenGeo !== geo || E._len == null) { E._lenGeo = geo; E._len = boxLen(it, R); }
          this.strokeDraw(E.stroke, E._len, draw);
          // 面の色（Morph で role が変わったとき）
          const fillC = s.fillFrom != null ? mixFill(s.fillFrom, it.fill, s.tintP) : it.fill;
          if (E._fillC !== fillC && (E._fillC != null || fillC !== it.fill)) { E._fillC = fillC; E.fill.setAttribute("fill", fillC); }
          const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
          E.g.setAttribute("transform", `translate(${off[0]},${off[1]}) translate(${cx},${cy}) scale(${sc}) translate(${-cx},${-cy})`);
          const col = s.tint ? C.mix(s.tintFrom || it.stroke, s.tint, s.tintP) : (s.pulse > 0.01 ? C.mix(it.stroke, S.accent, s.pulse) : it.stroke);
          // 点がいる箱（here）: 枠を点の色で太くする
          const here = s.here || 0;
          E.stroke.setAttribute("stroke", here > 0.01 ? C.mix(col, s.hereColor || S.warn, here) : col);
          E.stroke.setAttribute("stroke-width", S.stroke + 1.6 * (s.pulse || 0) + 2.4 * here);
          if (E.hereR) { E.hereR.setAttribute("stroke", s.hereColor || S.warn); E.hereR.setAttribute("opacity", (0.3 * here).toFixed(3)); }
          if (s.text != null && E.texts[0]) this.relabel(E.texts[0], it.texts[0], s); else if (E.texts[0]) this.unlabel(E.texts[0], it.texts[0]);
        } else if (it.kind === "edge") {
          // 経路の書き換え（Morph で両端が動くとき）。矢じりも描き直す
          const pk = s.pts ? s.pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") : "";
          if ((E._pts || "") !== pk) {
            E._pts = pk;
            const P = s.pts || it.pts;
            E.line.setAttribute("d", ptsD(P)); E._elen = polyLen(P);
            if (E.head) E.head.setAttribute("d", headD(P, it.headScale || 1));
          }
          if (s.draw) {
            const p = smooth(clamp(show / 0.7));
            if (it.dashed) { this.dashMask(E, key, it, p, show < 1, s.pts || it.pts); E.line.style.opacity = op(show > 0 ? 1 : 0); }
            else { this.strokeDraw(E.line, E._elen, p); E.line.style.opacity = op(show > 0 ? 1 : 0); }
          } else {
            if (E.dm) this.dashMask(E, key, it, 1, false);
            if (it.dashed) E.line.style.opacity = op(smooth(show));
            else { this.strokeDraw(E.line, E._elen, smooth(clamp(show / 0.9))); E.line.style.opacity = op(show > 0 ? 1 : 0); }
          }
          if (E.head) E.head.style.opacity = op(smooth((show - 0.85) / 0.15));
          if (E.label) E.label.style.opacity = op(smooth((show - 0.7) / 0.3));
          let col = s.tint ? C.mix(s.tintFrom || it.stroke, s.tint, s.tintP) : it.stroke;
          if (s.pulse > 0.01) col = C.mix(col, S.accent, s.pulse);
          E.line.setAttribute("stroke", col); if (E.head) { E.head.setAttribute("fill", col); E.head.setAttribute("stroke", col); }
          E.line.setAttribute("stroke-width", it.width + (s.tint && !s.morph ? 1 * s.tintP : 0) + 1.5 * (s.pulse || 0));   // Morph の色の補間では太くしない
          if (s.text != null && E.label) this.relabel(E.label, it.label, s); else if (E.label) this.unlabel(E.label, it.label);
        } else if (it.kind === "text") {
          E.g.style.opacity = op(smooth(show));
          const dy = (1 - ease(show)) * 10;
          const sc = 1 + 0.04 * (s.pulse || 0);
          const b = it.bbox, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          E.g.setAttribute("transform", `translate(${off[0]},${off[1] + dy}) translate(${cx},${cy}) scale(${sc}) translate(${-cx},${-cy})`);
          if (E.hl) E.hl.setAttribute("opacity", (s.pulse || 0).toFixed(3));
          if (s.text != null && E.texts[0]) this.relabel(E.texts[0], it.texts[0], s); else if (E.texts[0] && this.unlabel(E.texts[0], it.texts[0])) E.texts[0].style.opacity = "";
          if (s.tint && E.texts[0]) E.texts[0].setAttribute("fill", C.mix(it.texts[0].color || S.ink, s.tint, s.tintP));
        } else if (it.kind === "bar") {
          const g = ease(clamp(show / 0.85));
          if (it.grow === "right") { E.rect.setAttribute("width", Math.max(0.01, it.w * g)); }
          else if (it.grow === "down") { E.rect.setAttribute("height", Math.max(0.01, it.h * g)); }
          else { E.rect.setAttribute("y", it.y + it.h * (1 - g)); E.rect.setAttribute("height", Math.max(0.01, it.h * g)); }
          E.rect.style.opacity = op(show > 0 ? 1 : 0);
          for (const tx of E.texts) tx.style.opacity = op(smooth((show - 0.6) / 0.4));
          if (E.label) E.label.style.opacity = op(smooth((show - 0.75) / 0.25));
          let col = s.tint ? C.mix(s.tintFrom || it.stroke, s.tint, s.tintP) : it.stroke;
          if (s.pulse > 0.01) col = C.mix(col, S.accent, s.pulse);
          if (it.solid) E.rect.setAttribute("fill", col); else { E.rect.setAttribute("stroke", col); E.rect.setAttribute("stroke-width", S.stroke + 1.6 * (s.pulse || 0)); }
          E.g.setAttribute("transform", `translate(${off[0]},${off[1]})`);
          if (s.text != null && E.texts[0]) this.relabel(E.texts[0], it.texts[0], s);
        } else if (it.kind === "rect") {
          E.g.style.opacity = op(smooth(show));
          this.offset(E.g, off);
          if (it.fill === "none") E.bg.setAttribute("fill", C.rgba(s.tint || S.accent, 0.16 * Math.max(s.pulse || 0, s.tint ? s.tintP : 0)));
          if (E.tintR) {
            // 塗り替えは、元の面を消しながら新しい面を重ねる。題の色も、塗りに合わせる
            const p = s.tint ? s.tintP : 0;
            E.bg.style.opacity = (1 - p).toFixed(3);
            E.tintR.setAttribute("opacity", p.toFixed(3));
            if (s.tint) E.tintR.setAttribute("fill", s.tintOff ? UZ.QUAD_OFF(S) : UZ.QUAD_ON(s.tint));
            if (E.texts[0]) E.texts[0].setAttribute("fill", C.mix(it.texts[0].color || S.ink, s.tint ? (s.tintOff ? S.muted : s.tint) : it.texts[0].color || S.ink, p));
          }
        } else if (it.kind === "frame" && s.draw) {
          // 破線の枠: 線が伸び（0〜0.7）、面と文字は後から。破線は mask で隠して伸ばす
          E.g.style.opacity = op(show > 0 ? 1 : 0);
          this.dashMask(E, key, it, smooth(clamp(show / 0.7)), show < 1);
          // 暗さ（dim）は E.g に 1 回だけ掛ける。子に掛けると 2 回掛かる
          E.fill.style.opacity = smooth((show - 0.65) / 0.35).toFixed(3);
          for (const tx of E.texts) tx.style.opacity = smooth((show - 0.7) / 0.3).toFixed(3);
          this.offset(E.g, off);
        } else if (it.kind === "band" || it.kind === "frame" || it.kind === "image") {
          if (E.dm) this.dashMask(E, key, it, 1, false);
          if (it.kind === "frame") { E.fill.style.opacity = ""; for (const tx of E.texts) tx.style.opacity = ""; }
          E.g.style.opacity = op(smooth(show));
          this.offset(E.g, off);
        } else if (it.kind === "custom") {
          const o = smooth(show);
          E.g.style.opacity = op(o);
          this.offset(E.g, off);
          // 見えている間だけ描く。例外はその部品だけ描かずに知らせる（プレーヤーは止めない。同じ誤りは 1 回だけ出す）
          while (E.inner.firstChild) E.inner.removeChild(E.inner.firstChild);
          const fo = fr.figs[it.fig];
          if (o > 0.002 && fo && fo.opacity > 0.002 && E.fn) {
            E.geo.errors.length = 0;
            // 描き場の大きさは、そのコマの区画の大きさ（engine が場面ごとに決め、区画が動く間は補間する）
            const pw = fo.place && fo.place.w != null ? fo.place.w : it.w, ph = fo.place && fo.place.w != null ? fo.place.h : it.h;
            try {
              E.fn({ g: E.inner, v: fr.values || {}, t: fr.t, el, S: E.S, UZ, geo: E.geo, w: pw, h: ph });
              if (E.geo.errors.length) {   // TeX の誤りは描いたまま（赤い文字）知らせる。同じ誤りは 1 回だけ
                const msg = E.geo.errors.join(" / ");
                if (E._err !== msg) { E._err = msg; console.error("custom の部品の数式に誤り", it.key, msg); }
              }
            } catch (e) {
              while (E.inner.firstChild) E.inner.removeChild(E.inner.firstChild);
              const msg = String(e && e.message || e);
              if (E._err !== msg) { E._err = msg; console.error("custom の部品の描画に失敗", it.key, e); }
            }
          }
        } else if (it.kind === "mark") {
          const kind = s.mark || "check", col = kind === "cross" ? S.bad : kind === "question" ? S.warn : S.good;
          E.path.setAttribute("d", GLYPH[kind]); E.path.setAttribute("stroke", col); E.bgc.setAttribute("stroke", col);
          const sc = outBack(show) * (1 + 0.15 * (s.markPop || 0));
          E.g.setAttribute("transform", `translate(${it.x},${it.y}) scale(${Math.max(0, sc).toFixed(3)})`);
          E.g.style.opacity = op(clamp(show * 2));
        } else if (it.kind === "note") {
          E.g.style.opacity = op(smooth(show));
        } else if (it.kind === "dot") {
          E.g.style.opacity = op(show);
          E.dotC.style.opacity = s.dotVis == null ? 1 : s.dotVis.toFixed(3);
          if (s.pos) E.g.setAttribute("transform", `translate(${s.pos[0].toFixed(1)},${s.pos[1].toFixed(1)})`);
          const label = s.labelText || "";
          if (E._label !== label) { E._label = label; this.setLines(E.pillT, [label]); const w = UZ.textW(label, 17, 700) + 22; E.pillR.setAttribute("x", -w / 2); E.pillR.setAttribute("width", w); }
          // 札は、点が何を表すかを最初に 1 回だけ見せる（engine.js の labelShow。点が箱で止まっている間だけ出る。箱の文字に重ならないよう、点の位置の下に出す）
          E.pill.style.opacity = label ? op(s.labelShow || 0) : 0;
          E.pill.setAttribute("transform", `translate(0,30) scale(${(1 + 0.14 * (s.labelPop || 0)).toFixed(3)})`);
        }
      }
      // 地（章扉は暗い地）。暗い地の上に残る文字（章の題・クレジット）と字幕の帯の枠は、章扉の色に替える
      if (this.bgDark) {
        const d = fr.dark || 0, on = d > 0.5, ch = this.chap;
        this.bgDark.style.opacity = d.toFixed(3);
        if (this._dark !== on) {
          this._dark = on;
          this.creditT.setAttribute("fill", on ? (ch.muted || ch.ink) : S.muted);
          for (const tx of [this.headerT, this.headerT2, this.stT, this.stT2]) tx.setAttribute("fill", on ? ch.ink : S.ink);
          this.headerBar.setAttribute("fill", on ? (ch.accent || S.accent) : S.accent);
          this.stMark.setAttribute("fill", on ? (ch.accent || S.accent) : S.accent);
          if (on && ch.line) { this.subR.setAttribute("stroke", ch.line); this.subR.setAttribute("stroke-width", 1); } else this.subR.setAttribute("stroke", "none");
        }
      }
      // 章の題
      const h = fr.header;
      this.setLines(this.headerT, [h.text]); this.headerT.style.opacity = h.opacity;
      this.headerBar.style.opacity = h.text ? Math.max(h.opacity, h.prev ? h.prev.opacity : 0) : (h.prev && h.prev.text ? h.prev.opacity : 0);
      if (h.prev) { this.setLines(this.headerT2, [h.prev.text]); this.headerT2.style.opacity = h.prev.opacity; } else this.headerT2.style.opacity = 0;
      // 言いたいこと
      const stt = fr.statement || { lines: [], opacity: 0, prev: null };
      const putSt = (tx, lines, o) => {
        const key = lines.join("\n");
        if (tx._key !== key) { tx._key = key; tx._y = UZ.AREA.body.y + lines.length * UZ.STATEMENT.lineH / 2; this.setLines(tx, lines); }
        tx.style.opacity = lines.length ? o : 0;
      };
      putSt(this.stT, stt.lines, stt.opacity);
      putSt(this.stT2, stt.prev ? stt.prev.lines : [], stt.prev ? stt.prev.opacity : 0);
      this.stMark.style.opacity = Math.max(stt.lines.length ? stt.opacity : 0, stt.prev && stt.prev.lines.length ? stt.prev.opacity : 0);
      // 図の題（2 つ並べるとき）
      for (const k in this.capEls) this.capEls[k].style.opacity = 0;
      for (const c of fr.captions) { const e = this.capEls[fr.scene.id + c.fig]; if (e) e.style.opacity = c.opacity; }
      // 札
      const bd = fr.badge;
      if (bd.text) {
        if (this._badge !== bd.text) { this._badge = bd.text; const w = UZ.textW(bd.text, 19, 700) + 36; this.badgeR.setAttribute("x", 1224 - w); this.badgeR.setAttribute("width", w); this.badgeT._x = 1224 - w / 2; this.setLines(this.badgeT, [bd.text]); }
        this.badge.style.opacity = bd.show;
      } else this.badge.style.opacity = 0;
      // 字幕
      if (fr.sub && this.subtitles) {
        if (this._sub !== fr.sub.id) {
          this._sub = fr.sub.id;
          const lines = UZ.splitBalanced(fr.sub.text, 27, UZ.AREA.sub.w - 40);
          const lh = 40, hgt = lines.length * lh + 20, y0 = 700 - hgt - 6;
          this.subT._y = y0 + hgt / 2; this.setLines(this.subT, lines);
          const w = Math.max(...lines.map(s2 => UZ.textW(s2, 27, 500))) + 48;
          this.subR.setAttribute("x", 640 - w / 2); this.subR.setAttribute("y", y0); this.subR.setAttribute("width", w); this.subR.setAttribute("height", hgt);
        }
        this.sub.style.opacity = fr.sub.opacity;
      } else this.sub.style.opacity = 0;
      // 終わりの札
      this.endG.style.opacity = fr.end;
      // custom（台本の下の層: 毎コマ呼ぶ）
      this.renderCustoms(fr);
      return fr;
    }
    // 文の入れ替え（relabel と、Morph で文が違うとき）。改行（\n）で行を分ける
    relabel(tEl, spec, s) {
      const want = s.textP < 0.5 ? (s.textFrom != null ? s.textFrom : spec.lines.join("\n")) : s.text;
      if (tEl._cur !== want) { tEl._cur = want; this.setLines(tEl, String(want).split("\n")); }
      tEl.style.opacity = (Math.abs(s.textP - 0.5) * 2).toFixed(3);
    }
    // 入れ替えた文を元に戻す（入れ替えより前へ戻ったときと、Morph が終わったとき）。戻したら true
    unlabel(tEl, spec) {
      if (tEl._cur == null) return false;
      tEl._cur = null;
      if (spec.spans) this.setSpans(tEl, spec.spans, spec.emColor); else this.setLines(tEl, spec.lines);
      return true;
    }
    // 部品の位置のずれ（Morph の要素ごとの補間）
    offset(g, off) {
      const tr = off[0] || off[1] ? `translate(${off[0].toFixed(2)},${off[1].toFixed(2)})` : "";
      if ((g._off || "") !== tr) { g._off = tr; if (tr) g.setAttribute("transform", tr); else g.removeAttribute("transform"); }
    }
    renderCustoms(fr) {
      const M = this.M;
      if (!this._customs) {
        this._customs = {};
        for (const a of M.acts) if (a.verb === "custom") {
          const c = { g: el("g", null, this.customG), fn: null };
          try { c.fn = new Function("return (" + M.sb.custom[a.a.custom] + ")")(); } catch (e) { console.error("custom の読み込みに失敗", a.a.custom, e); }
          this._customs[a.key] = c;
        }
      }
      for (const [key, c] of Object.entries(this._customs)) {
        const p = fr.customs[key];
        c.g.style.display = p == null ? "none" : "";
        if (p == null || !c.fn) continue;
        while (c.g.firstChild) c.g.removeChild(c.g.firstChild);
        try { c.fn({ g: c.g, p, t: fr.t, el, S: this.S, UZ, area: UZ.AREA.body }); } catch (e) { console.error("custom の実行に失敗", e); }
      }
    }
  }
  UZ.View = View;
})(globalThis.UZ = globalThis.UZ || {});
