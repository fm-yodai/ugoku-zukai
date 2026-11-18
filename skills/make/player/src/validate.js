// ugoku-zukai プレーヤー: 台本の形の検査（配置の前にわかる誤り）。id の解決や経路の検査は engine.build が行う
(function (UZ) {
  "use strict";
  const ID_RE = /^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー.]+$/;
  const TYPES = {
    title: ["text"], toc: ["items"], list: ["items"], compare: ["items"], table: ["columns", "rows"],
    sequence: ["participants", "messages"], graph: ["nodes", "edges"], canvas: ["shapes"],
    swimlane: ["lanes", "steps"], beforeafter: ["before", "after"], roadmap: ["periods", "items"], tree: ["root"],
    chart: ["categories", "series"], kpi: ["items"], matrix: ["x", "y"], pyramid: ["levels"], cycle: ["steps"], venn: ["sets"],
    text: ["blocks"], image: ["src"], frame: [], custom: ["draw"], space: ["items"],
  };
  // 部品 space の要素の種類
  const S3_KINDS = ["point", "line", "arrow", "polygon", "box", "surface", "curve", "text", "plate"];
  const ROLES = ["actor", "process", "store", "external", "muted", "added", "removed", "good", "bad", "warn", "accent"];

  // 部品 space: 要素の種類・必須の項目・点の形・式（値の名前）を見る。式はコンパイルだけする（値で評価するのは描くとき）
  // figures = 台本の figures（板の figure が図の id を指すとき）
  function validateSpace(f, where, E, addId, names, figures) {
    const expr = (x, what, extra) => {
      if (typeof x === "number") { if (!Number.isFinite(x)) E(`${where}: ${what} が数でない`); return; }
      try { UZ.spaceExpr(x, extra ? names.concat(extra) : names); } catch (e) { E(`${where}: ${what}: ${e.message}`); }
    };
    const point = (p, what) => {
      if (!Array.isArray(p) || p.length !== 3) { E(`${where}: ${what} は 3 次元の点 [x, y, z] で書く（今は ${JSON.stringify(p)}）`); return; }
      p.forEach((x, i) => expr(x, `${what}[${i}]`));
    };
    const range = (r, what) => {
      if (!Array.isArray(r) || r.length !== 2) { E(`${where}: ${what} は範囲 [最小, 最大] で書く（今は ${JSON.stringify(r)}）`); return; }
      r.forEach((x, i) => expr(x, `${what}[${i}]`));
    };
    const cam = f.camera;
    if (cam != null) {
      if (typeof cam !== "object" || Array.isArray(cam)) E(`${where}: camera は { yaw, pitch, scale?, target? } で書く`);
      else {
        for (const k of ["yaw", "pitch", "scale"]) if (cam[k] != null) expr(cam[k], `camera の ${k}`);
        if (cam.target != null) point(cam.target, "camera の target");
      }
    }
    if (f.axes != null) {
      if (typeof f.axes !== "object" || Array.isArray(f.axes)) E(`${where}: axes は { x: [最小, 最大], y, z, labels? } で書く`);
      else for (const k of ["x", "y", "z"]) if (f.axes[k] != null) range(f.axes[k], `axes の ${k}`);
    }
    if (f.bounds != null) {
      if (!f.bounds || typeof f.bounds !== "object") E(`${where}: bounds は { min: [x, y, z], max: [x, y, z] } で書く`);
      else { point(f.bounds.min, "bounds の min"); point(f.bounds.max, "bounds の max"); }
    }
    if (f.items == null) return;
    if (!Array.isArray(f.items) || !f.items.length) { E(`${where}: items（要素の列）は 1 つ以上の要素の配列で書く`); return; }
    for (const o of f.items) {
      if (!o || typeof o !== "object") { E(`${where}: 要素はオブジェクトで書く`); continue; }
      if (o.id === "$axes") { E(`${where}: 要素の id「$axes」は軸のために取ってある。別の id にする`); continue; }
      addId(o.id, "要素");
      const w = `要素 ${o.id}`;
      if (!S3_KINDS.includes(o.kind)) { E(`${where}: ${w} の kind は ${S3_KINDS.join(" / ")} のどれか（今は ${o.kind}）`); continue; }
      const need = (...ks) => { for (const k of ks) if (o[k] == null) E(`${where}: ${w}（${o.kind}）に ${k} がない`); return ks.every(k => o[k] != null); };
      const pts = (k, min) => {
        if (!Array.isArray(o[k]) || o[k].length < min) { E(`${where}: ${w} の ${k} は ${min} つ以上の点 [[x, y, z], …] で書く`); return; }
        o[k].forEach((p, i) => point(p, `${w} の ${k}[${i}]`));
      };
      if (o.kind === "point" || o.kind === "text") { if (need("at")) point(o.at, `${w} の at`); if (o.kind === "text" && o.text == null) E(`${where}: ${w}（text）に text がない`); }
      else if (o.kind === "line") { if (o.points != null) pts("points", 2); else if (need("from", "to")) { point(o.from, `${w} の from`); point(o.to, `${w} の to`); } }
      else if (o.kind === "arrow") { if (need("from", "to")) { point(o.from, `${w} の from`); point(o.to, `${w} の to`); } }
      else if (o.kind === "polygon") { if (need("points")) pts("points", 3); }
      else if (o.kind === "box") { if (need("min", "max")) { point(o.min, `${w} の min`); point(o.max, `${w} の max`); } }
      else if (o.kind === "surface") {
        if (need("f", "x", "y")) { expr(o.f, `${w} の f`, ["x", "y"]); range(o.x, `${w} の x`); range(o.y, `${w} の y`); }
        if (o.grid != null && !(typeof o.grid === "number" && o.grid >= 1)) E(`${where}: ${w} の grid は 1 以上の数で書く`);
      } else if (o.kind === "curve") {
        if (need("fn", "t")) {
          if (!Array.isArray(o.fn) || o.fn.length !== 3) E(`${where}: ${w} の fn は [x(t), y(t), z(t)] で書く`);
          else o.fn.forEach((x, i) => expr(x, `${w} の fn[${i}]`, ["t"]));
          range(o.t, `${w} の t`);
        }
      } else if (o.kind === "plate") {
        // 板: figure = figures の図の id か、部品と同じ宣言（type を持つオブジェクト）。origin = 左上の角、size = [幅, 高さ]、tilt = 上辺を軸に手前へ倒す角度（度）
        if (need("figure", "origin", "size")) {
          point(o.origin, `${w} の origin`);
          if (!Array.isArray(o.size) || o.size.length !== 2) E(`${where}: ${w} の size は [幅, 高さ]（ワールドの単位。数か式）で書く（今は ${JSON.stringify(o.size)}）`);
          else o.size.forEach((x, i) => expr(x, `${w} の size[${i}]`));
          const fg = o.figure;
          if (typeof fg === "string") {
            if (!figures || !Object.prototype.hasOwnProperty.call(figures, fg)) E(`${where}: ${w} の figure「${fg}」が figures にない`);
            else if (figures[fg] && figures[fg].type === "space") E(`${where}: ${w} の figure に space は置けない（板の中は 2D の図）`);
          } else if (!fg || typeof fg !== "object" || Array.isArray(fg) || fg.type == null) E(`${where}: ${w} の figure は figures の図の id か、部品と同じ宣言（type を持つオブジェクト）で書く`);
          else if (fg.type === "space") E(`${where}: ${w} の figure に space は置けない（板の中は 2D の図）`);
        }
        if (o.tilt != null) expr(o.tilt, `${w} の tilt`);
      }
      if (o.opacity != null && !(typeof o.opacity === "number" && o.opacity >= 0 && o.opacity <= 1)) E(`${where}: ${w} の opacity は 0〜1 の数で書く`);
    }
  }

  UZ.validate = function (sb) {
    const errors = [], warnings = [];
    const E = m => errors.push(m), W = m => warnings.push(m);
    if (!sb || typeof sb !== "object") return { errors: ["台本が JSON のオブジェクトでない"], warnings };
    if (!UZ.FORMATS.includes(sb.format)) E(`format は "${UZ.FORMAT}" と書く（今は ${JSON.stringify(sb.format)}）`);
    if (sb.figures != null && typeof sb.figures !== "object") E("figures（図の宣言）はオブジェクトで書く");
    if (sb.figures == null && sb.slides == null) E("figures（図の宣言）がない");
    if (!Array.isArray(sb.scenes) || !sb.scenes.length) E("scenes（場面の列）がない");
    const allActs = (Array.isArray(sb.scenes) ? sb.scenes : []).flatMap(sc => sc && Array.isArray(sc.lines) ? sc.lines.flatMap(ln => ln && Array.isArray(ln.do) ? ln.do.map(a => [ln.id, a]) : []) : []);
    // /4 の機能（part の morph・動作の zoom・pan・show の draw）は、/3 以前の format では使えない。種類ごとに 1 件ずつ出す
    if (["ugoku-zukai/2", "ugoku-zukai/3"].includes(sb.format)) {
      const need = (what, where) => E(`${where}で ${what} を使っている。使うには format を "ugoku-zukai/4" と書く（今は ${JSON.stringify(sb.format)}）`);
      const parts = Object.entries(sb.slides && typeof sb.slides === "object" ? sb.slides : {}).flatMap(([sid, sl]) => sl && Array.isArray(sl.parts) ? sl.parts.map(p => [sid, p]) : []);
      const hit = parts.find(([, p]) => p && p.morph != null);
      if (hit) need("morph", `スライド「${hit[0]}」`);
      for (const [what, test] of [["zoom", a => a.zoom != null], ["pan", a => a.pan != null], ["draw", a => a.draw != null]]) {
        const h = allActs.find(([, a]) => a && typeof a === "object" && test(a));
        if (h) need(what, `行「${h[0]}」`);
      }
    }
    // /5 の機能（最上位の values・動作の set・custom の部品）は、/4 以前の format では使えない（/5 以上で使える）。種類ごとに 1 件ずつ出す
    if (UZ.FORMATS.includes(sb.format) && !["ugoku-zukai/5", "ugoku-zukai/6"].includes(sb.format)) {
      const need = (what, where) => E(`${where}で ${what} を使っている。使うには format を "ugoku-zukai/5" と書く（今は ${JSON.stringify(sb.format)}）`);
      if (sb.values != null) need("values", "台本の最上位");
      const h = allActs.find(([, a]) => a && typeof a === "object" && Object.prototype.hasOwnProperty.call(a, "set"));
      if (h) need("set", `行「${h[0]}」`);
      const figs = [...Object.entries(sb.figures && typeof sb.figures === "object" ? sb.figures : {}).map(([fid, f]) => [`図「${fid}」`, f]),
        ...Object.entries(sb.slides && typeof sb.slides === "object" ? sb.slides : {}).flatMap(([sid, sl]) => sl && Array.isArray(sl.parts) ? sl.parts.map(p => [`スライド「${sid}」`, p]) : [])];
      const c = figs.find(([, f]) => f && typeof f === "object" && f.type === "custom");
      if (c) need("custom の部品", c[0]);
    }
    // /6 の機能（space の部品）は、/5 以前の format では使えない。種類ごとに 1 件ずつ出す
    if (UZ.FORMATS.includes(sb.format) && sb.format !== "ugoku-zukai/6") {
      const need = (what, where) => E(`${where}で ${what} を使っている。使うには format を "ugoku-zukai/6" と書く（今は ${JSON.stringify(sb.format)}）`);
      const figs = [...Object.entries(sb.figures && typeof sb.figures === "object" ? sb.figures : {}).map(([fid, f]) => [`図「${fid}」`, f]),
        ...Object.entries(sb.slides && typeof sb.slides === "object" ? sb.slides : {}).flatMap(([sid, sl]) => sl && Array.isArray(sl.parts) ? sl.parts.map(p => [`スライド「${sid}」`, p]) : [])];
      const c = figs.find(([, f]) => f && typeof f === "object" && f.type === "space");
      if (c) need("space の部品", c[0]);
      const g = figs.find(([, f]) => f && typeof f === "object" && f.type === "graph" && Array.isArray(f.nodes) && f.nodes.some(n => n && n.inside != null));
      if (g) need("inside", g[0]);
    }
    // 名前付きの値: { 名前: 数 }
    const values = sb.values == null ? {} : sb.values;
    if (typeof values !== "object" || Array.isArray(values)) E("values（名前付きの値）は { 名前: 数 } のオブジェクトで書く");
    else for (const [k, v] of Object.entries(values)) {
      if (!ID_RE.test(k)) E(`values の「${k}」: 名前に使えない文字がある（/ : 空白は不可）`);
      if (typeof v !== "number" || !Number.isFinite(v)) E(`values の「${k}」は数で書く（今は ${JSON.stringify(v)}）`);
    }
    if (errors.length) return { errors, warnings };
    UZ.validateSlides(sb, E, W, ID_RE);
    if (errors.length) return { errors, warnings };
    const FIGS = UZ.figuresOf(sb);

    for (const [fid, f] of Object.entries(FIGS)) {
      const where = `図「${fid}」`;
      if (!ID_RE.test(fid)) E(`${where}: id に使えない文字がある（/ : 空白は不可）`);
      if (!TYPES[f.type]) { E(`${where}: type は ${Object.keys(TYPES).join(" / ")} のどれか（今は ${f.type}）`); continue; }
      for (const k of TYPES[f.type]) if (f[k] == null) E(`${where}: ${k} がない`);
      const ids = new Set();
      const addId = (id, what) => {
        if (id == null) { E(`${where}: ${what} に id がない`); return; }
        if (!ID_RE.test(id)) E(`${where}: ${what} の id「${id}」に使えない文字がある（/ : 空白は不可）`);
        if (ids.has(id)) E(`${where}: id「${id}」が重複している`);
        ids.add(id);
      };
      if (f.valign != null && !["top", "middle", "bottom"].includes(f.valign)) E(`${where}: valign は top / middle / bottom のどれか`);
      if (f.halign != null && !["start", "center", "end"].includes(f.halign)) E(`${where}: halign は start / center / end のどれか`);
      if (f.fit != null && !["fill", "content"].includes(f.fit)) E(`${where}: fit は fill か content`);
      if ((f.type === "title" || f.type === "toc") && f.tone != null && !["dark", "light"].includes(f.tone)) E(`${where}: tone は dark か light`);
      if (f.type === "toc" && Array.isArray(f.items)) {
        if (!f.items.length) E(`${where}: items（章）が空`);
        addId("heading", "見出し"); addId("rule", "見出しの線");   // 図が使う id（章の id には使えない）
        for (const it of f.items) { addId(it && it.id, "章"); if (!it || typeof it.text !== "string" || !it.text.trim()) E(`${where}: 章 ${it && it.id} に text がない`); }
        if (f.current != null && !f.items.some(it => it && it.id === f.current)) E(`${where}: current「${f.current}」が items の id にない`);
        if (f.heading != null && typeof f.heading !== "string") E(`${where}: heading は文字列で書く（見出しを出さないときは ""）`);
      }
      const role = (r, what) => { if (r != null && !ROLES.includes(r)) E(`${where}: ${what} の role「${r}」は ${ROLES.join(" / ")} のどれか`); };
      if (f.type === "graph") {
        for (const n of f.nodes || []) { addId(n.id, "ノード"); role(n.role, n.id); if (!n.label) E(`${where}: ノード ${n.id} に label がない`); }
        const nodeIds = new Set((f.nodes || []).map(n => n.id));
        for (const g of f.groups || []) {
          addId(g.id, "グループ");
          for (const m of g.members || []) if (!nodeIds.has(m) && !(f.groups || []).some(x => x.id === m)) E(`${where}: グループ ${g.id} の members「${m}」がノードにない`);
        }
        const inFrame = {};
        for (const g of (f.groups || []).filter(g => g.style !== "band")) for (const m of g.members || []) {
          if (inFrame[m]) E(`${where}: ノード ${m} が枠 ${inFrame[m]} と ${g.id} の両方に入っている`);
          inFrame[m] = g.id;
        }
        const seen = new Set();
        for (const e of f.edges || []) {
          const id = e.id || `${e.from}>${e.to}`;
          if (!nodeIds.has(e.from)) E(`${where}: 辺 ${id} の from「${e.from}」がノードにない`);
          if (!nodeIds.has(e.to)) E(`${where}: 辺 ${id} の to「${e.to}」がノードにない`);
          if (seen.has(id)) E(`${where}: 辺 ${id} が重複している（同じ向きの辺を 2 本引くときは id を書く）`);
          seen.add(id);
          if (!e.label) W(`${where}: 辺 ${id} に label がない（何をするかの動詞句を書く）`);
        }
        if (f.direction && !["right", "down"].includes(f.direction)) E(`${where}: direction は right か down`);
      }
      if (f.type === "sequence") {
        for (const p of f.participants || []) { addId(p.id, "参加者"); role(p.role, p.id); }
        for (const p of f.participants || []) if (p.sub) W(`${where}: 参加者 ${p.id} の sub は描かれない（シーケンス図の参加者は label だけ。補足は note で付ける）`);
        const pid = new Set((f.participants || []).map(p => p.id));
        (f.messages || []).forEach((m, i) => {
          addId(m.id || `m${i + 1}`, "メッセージ");
          if (!pid.has(m.from) || !pid.has(m.to)) E(`${where}: メッセージ ${m.id || "m" + (i + 1)} の from / to が参加者にない`);
          if (!m.label) E(`${where}: メッセージ ${m.id || "m" + (i + 1)} に label がない`);
        });
      }
      if (f.type === "table") {
        const cols = (f.columns || []).map(c => (typeof c === "string" ? { id: c, label: c } : c));
        cols.forEach(c => addId(c.id, "列"));
        for (const r of f.rows || []) {
          addId(r.id, "行");
          if (Array.isArray(r.cells) && r.cells.length !== cols.length) E(`${where}: 行 ${r.id} の cells の数（${r.cells.length}）が列の数（${cols.length}）と違う`);
          if (!r.cells) E(`${where}: 行 ${r.id} に cells がない`);
        }
      }
      if (f.type === "compare") {
        if ((f.items || []).length < 2 || f.items.length > 4) E(`${where}: 比べる項目は 2〜4 個`);
        for (const it of f.items || []) {
          addId(it.id, "項目"); role(it.role, it.id);
          (it.points || []).forEach((p, i) => { if (typeof p === "object") { addId(p.id || `${it.id}.${i + 1}`, "点"); if (p.kind && !["pro", "con", "plain"].includes(p.kind)) E(`${where}: ${it.id} の点の kind は pro / con / plain`); } else addId(`${it.id}.${i + 1}`, "点"); });
        }
      }
      if (f.type === "list") {
        for (const it of f.items || []) { addId(it.id, "項目"); if (!it.text) E(`${where}: 項目 ${it.id} に text がない`); }
        if ((f.items || []).length > 8) W(`${where}: 箇条が 8 個を超える（画面で読み切れない）`);
      }
      if (f.type === "swimlane") {
        const lane = new Set();
        for (const l of f.lanes || []) { addId(l.id, "担当（lane）"); role(l.role, l.id); lane.add(l.id); }
        for (const st of f.steps || []) { addId(st.id, "手順"); role(st.role, st.id); if (!lane.has(st.lane)) E(`${where}: 手順 ${st.id} の lane「${st.lane}」が lanes にない`); if (!st.label) E(`${where}: 手順 ${st.id} に label がない`); }
        const sid = new Set((f.steps || []).map(x => x.id));
        for (const e of f.edges || []) { if (!sid.has(e.from) || !sid.has(e.to)) E(`${where}: 辺 ${e.from}>${e.to} の両端が steps にない`); }
        if ((f.lanes || []).length > 5) W(`${where}: 担当が 5 本を超える（縦に詰まる）`);
      }
      if (f.type === "beforeafter") {
        for (const k of ["before", "after"]) {
          const side = f[k];
          if (!side || !Array.isArray(side.steps) || !side.steps.length) { E(`${where}: ${k}.steps がない`); continue; }
          side.steps.forEach((st, i) => { const id = typeof st === "string" ? `${k}.${i + 1}` : st.id || `${k}.${i + 1}`; addId(id, `${k} の手順`); if (typeof st === "object") role(st.role, id); });
          if (side.steps.length > 6) W(`${where}: ${k} の手順が 6 個を超える`);
        }
        addId("before", "板"); addId("after", "板"); addId("arrow", "矢印");
      }
      if (f.type === "roadmap") {
        const per = new Set((f.periods || []).map(p => (typeof p === "string" ? p : p.id)));
        per.forEach(id => addId(id, "期間"));
        const tr = new Set((f.tracks || []).map(t => t.id));
        for (const t of f.tracks || []) addId(t.id, "流れ（track）");
        for (const it of f.items || []) {
          addId(it.id, "項目"); role(it.role, it.id);
          if (it.track != null && !tr.has(it.track)) E(`${where}: 項目 ${it.id} の track「${it.track}」が tracks にない`);
          if (it.track == null && tr.size) E(`${where}: 項目 ${it.id} に track がない`);
          for (const k of ["from", "to", "at"]) if (it[k] != null && !per.has(it[k])) E(`${where}: 項目 ${it.id} の ${k}「${it[k]}」が periods にない`);
          if (it.at == null && it.from == null) E(`${where}: 項目 ${it.id} に from（帯）か at（マイルストーン）がない`);
        }
        // 矢印（links）: 項目から項目へ。右の期間か、期間が重なる項目へ引く（右から左へは引けない）
        const pi = Object.fromEntries((f.periods || []).map((p, i) => [typeof p === "string" ? p : p.id, i]));
        const span = it => { const a = pi[it.at ?? it.from], b = it.at != null ? a : pi[it.to ?? it.from]; return [a, b]; };
        const byId = Object.fromEntries((f.items || []).map(it => [it.id, it]));
        if (f.links != null && !Array.isArray(f.links)) E(`${where}: links は { from, to, label } の列で書く`);
        for (const l of Array.isArray(f.links) ? f.links : []) {
          if (!l || !byId[l.from] || !byId[l.to] || l.from === l.to) { E(`${where}: links の from・to は、別々の項目の id を書く（${JSON.stringify(l)}）`); continue; }
          if (ids.has(`${l.from}>${l.to}`)) E(`${where}: 矢印 ${l.from}>${l.to} が重複している`);
          ids.add(`${l.from}>${l.to}`);
          if (span(byId[l.to])[1] < span(byId[l.from])[0]) E(`${where}: 矢印 ${l.from}>${l.to} は右から左へ向かう（矢印は、右の期間か、期間が重なる項目へ引く）`);
        }
      }
      if (f.type === "tree") {
        const walk = (n, d) => { if (!n || typeof n !== "object") { E(`${where}: ノードがオブジェクトでない`); return; } addId(n.id, "ノード"); role(n.role, n.id); if (!n.label) E(`${where}: ノード ${n.id} に label がない`); if (d > 4) W(`${where}: 5 段より深い（読み切れない）`); for (const c of n.children || []) walk(c, d + 1); };
        walk(f.root, 0);
        if (f.direction && !["right", "down"].includes(f.direction)) E(`${where}: direction は right か down`);
      }
      if (f.type === "chart") {
        const nc = (f.categories || []).length;
        if (f.kind && !["bar", "line"].includes(f.kind)) E(`${where}: kind は bar か line`);
        for (const sr of f.series || []) {
          addId(sr.id, "系列"); role(sr.role, sr.id);
          if (!Array.isArray(sr.values) || sr.values.length !== nc) E(`${where}: 系列 ${sr.id} の values の数が categories の数（${nc}）と違う`);
        }
        if (nc > 12) W(`${where}: 区分が 12 個を超える`);
      }
      if (f.type === "kpi") {
        for (const it of f.items || []) { addId(it.id, "KPI"); role(it.role, it.id); if (typeof it.value !== "number") E(`${where}: KPI ${it.id} の value は数で書く`); if (!it.label) E(`${where}: KPI ${it.id} に label がない`); }
        if ((f.items || []).length > 4) W(`${where}: KPI が 4 枚を超える`);
      }
      if (f.type === "matrix") {
        if (!f.x || !f.x.label || !f.y || !f.y.label) E(`${where}: x.label と y.label が要る`);
        for (const k of Object.keys(f.quadrants || {})) { if (!["tl", "tr", "bl", "br"].includes(k)) E(`${where}: quadrants のキーは tl / tr / bl / br`); const q = f.quadrants[k]; addId(typeof q === "object" && q.id ? q.id : k, "象限");
          if (q && typeof q === "object") { role(q.role, q.id || k); if (q.off && q.role) E(`${where}: 象限 ${q.id || k} に off と role は同時に書けない（off = 該当しない象限のグレー）`); } }
        for (const it of f.items || []) { addId(it.id, "点"); role(it.role, it.id); if (!(it.x >= 0 && it.x <= 1 && it.y >= 0 && it.y <= 1)) E(`${where}: 点 ${it.id} の x / y は 0〜1`); }
      }
      if (f.type === "pyramid") {
        if (f.kind && !["pyramid", "funnel"].includes(f.kind)) E(`${where}: kind は pyramid か funnel`);
        for (const l of f.levels || []) { addId(l.id, "段"); role(l.role, l.id); if (!l.label) E(`${where}: 段 ${l.id} に label がない`); }
        if ((f.levels || []).length > 6) W(`${where}: 段が 6 つを超える`);
      }
      if (f.type === "cycle") {
        for (const st of f.steps || []) { addId(st.id, "段階"); role(st.role, st.id); if (!st.label) E(`${where}: 段階 ${st.id} に label がない`); }
        if ((f.steps || []).length < 3 || f.steps.length > 8) E(`${where}: 段階は 3〜8 個`);
      }
      if (f.type === "venn") {
        const all = f.sets || [], ss = new Set();
        for (const st of all) { addId(st.id, "集合"); role(st.role, st.id); ss.add(st.id); }
        // 包含（inside）: 相手は別の集合。輪にしない。1 つの集合に含めるのは 2 つまで
        const inner = new Set(), nKids = {};
        for (const st of all) {
          if (st.inside == null) continue;
          if (!ss.has(st.inside) || st.inside === st.id) { E(`${where}: 集合 ${st.id} の inside「${st.inside}」が sets にない（別の集合の id を書く）`); continue; }
          inner.add(st.id); nKids[st.inside] = (nKids[st.inside] || 0) + 1;
          const seen = new Set([st.id]);
          for (let c = st; c && c.inside != null; c = all.find(x => x.id === c.inside)) { if (seen.has(c.inside)) { E(`${where}: 集合 ${st.id} の inside が輪になっている`); break; } seen.add(c.inside); }
        }
        for (const [id, k] of Object.entries(nKids)) if (k > 2) E(`${where}: 集合 ${id} に含める集合（inside）は 2 つまで`);
        const nTop = all.length - inner.size;
        if (inner.size ? (nTop < 1 || nTop > 3) : (all.length < 2 || all.length > 3)) E(`${where}: 集合は 2 か 3 個（inside で含まれる集合は数えない。含む集合が 1 つだけでもよい）`);
        for (const o of f.overlaps || []) {
          addId(o.id, "重なり");
          if (!Array.isArray(o.of) || o.of.length < 2 || o.of.some(x => !ss.has(x))) E(`${where}: 重なり ${o.id} の of は sets の id を 2 つ以上`);
          else if (o.of.some(x => inner.has(x))) E(`${where}: 重なり ${o.id} の of に、含まれる集合（inside のある集合）は書けない`);
        }
      }
      if (f.type === "text") {
        if (!Array.isArray(f.blocks) || !f.blocks.length) E(`${where}: blocks（テキストのブロックの列）がない`);
        for (const b of Array.isArray(f.blocks) ? f.blocks : []) {
          if (!b || typeof b !== "object") { E(`${where}: ブロックはオブジェクトで書く`); continue; }
          addId(b.id, "ブロック");
          if (!UZ.TEXT_KINDS.includes(b.kind)) { E(`${where}: ブロック ${b.id} の kind は ${UZ.TEXT_KINDS.join(" / ")} のどれか（今は ${b.kind}）`); continue; }
          if (b.kind === "bullets") {
            if (!Array.isArray(b.items) || !b.items.length || b.items.some(x => typeof x !== "string" || !x)) E(`${where}: ブロック ${b.id}（bullets）の items は、文字列の配列で書く`);
            else b.items.forEach((x, i) => addId(`${b.id}.${i + 1}`, "箇条の項目"));
          } else if (typeof b.text !== "string" || !b.text) E(`${where}: ブロック ${b.id} に text がない`);
          if (b.size != null && !(typeof b.size === "number" && b.size >= 15 && b.size <= 60)) E(`${where}: ブロック ${b.id} の size は 15〜60 の数（px）で書く`);
          if (b.source != null && typeof b.source !== "string" && !(Array.isArray(b.source) && b.source.every(x => typeof x === "string")))
            W(`${where}: ブロック ${b.id} の source は文字列か文字列の配列で書く`);
        }
      }
      if (f.type === "frame") {
        if (f.title != null && typeof f.title !== "string") E(`${where}: title は文字列で書く`);
        addId("box", "枠"); addId("title", "枠の題");
      }
      if (f.type === "image") {
        if (f.src != null && typeof f.src !== "string") E(`${where}: src は、台本のあるフォルダからの相対パスを文字列で書く`);
        if (!f.source) W(`${where}: 画像の出どころ（source）がない（利用者から渡されたものなら、そう書く）`);
        addId("img", "画像");
      }
      if (f.type === "custom") {
        if (f.draw != null && (typeof f.draw !== "string" || !sb.custom || typeof sb.custom !== "object" || !Object.prototype.hasOwnProperty.call(sb.custom, f.draw)))
          E(`${where}: draw「${f.draw}」が台本の custom にない（台本の最上位の custom に、関数を文字列で書く）`);
        else if (f.draw != null && typeof sb.custom[f.draw] !== "string")
          E(`${where}: custom「${f.draw}」の値が文字列でない（関数は "({ g, v, geo, w, h }) => { … }" のように文字列で書く）`);
        addId("draw", "描き場");
      }
      if (f.type === "space") {
        addId("draw", "描き場");
        validateSpace(f, where, E, addId, Object.keys(sb.values && typeof sb.values === "object" ? sb.values : {}), sb.figures);
      }
      if (f.type === "canvas") {
        for (const s of f.shapes || []) {
          addId(s.id, "図形");
          if (!["rect", "ellipse", "line", "arrow", "text"].includes(s.shape)) E(`${where}: 図形 ${s.id} の shape は rect / ellipse / line / arrow / text`);
        }
      }
    }

    // 板（plate）の図は、その space の子の図になり、板の id で引く。板の id は台本全体で 1 つにする。
    // 板に置いた図は、同じスライドに部品としては置けない（同じ図を 2 か所に描くことになる）
    {
      const plates = UZ.platesOf(sb), seenP = new Set();
      for (const { space, plate } of plates) {
        const pid = plate.id;
        if (typeof pid !== "string") continue;
        if (seenP.has(pid)) E(`図「${space}」: 板の id「${pid}」が、別の space の板と重なる（板の id は台本全体で 1 つにする）`);
        seenP.add(pid);
        const inline = plate.figure && typeof plate.figure === "object" && FIGS[pid] === plate.figure;
        if (Object.prototype.hasOwnProperty.call(FIGS, pid) && !inline) E(`図「${space}」: 板の id「${pid}」が、図か部品の id と重なる（板の中の要素は「板の id/要素の id」で指すので、別の id にする）`);
      }
      for (const [sid, sl] of Object.entries(sb.slides && typeof sb.slides === "object" ? sb.slides : {})) {
        const ids = new Set((sl && Array.isArray(sl.parts) ? sl.parts : []).map(UZ.partId).filter(x => x != null));
        for (const { space, plate } of plates) if (ids.has(space) && typeof plate.figure === "string" && ids.has(plate.figure))
          E(`スライド「${sid}」: 板「${plate.id}」の図「${plate.figure}」は、同じスライドに部品としても置いている（板に置く図は、部品としては置かない）`);
      }
    }

    // 意味のズーム（inside）: graph の箱にだけ書ける。中身の図は figures か部品の図。1 つの図を中身にできる箱は 1 つ。
    // 入れ子は 3 段まで、循環しない。中身の図は部品や場面の図としては置かない（箱の中に描く）。板に置いた図のノードには効かない
    {
      const isObj = o => o && typeof o === "object" && !Array.isArray(o);
      for (const [fid, f] of Object.entries(FIGS)) {
        if (!isObj(f)) continue;
        if (f.type === "venn") continue;   // venn の集合の inside は別の意味（集合の包含）。venn の検査が見る
        if (f.type !== "graph") {
          // graph 以外の図の項目（items・rows など、配列の中のオブジェクト）に inside があれば誤り
          const hit = Object.values(f).some(v => Array.isArray(v) && v.some(o => isObj(o) && Object.prototype.hasOwnProperty.call(o, "inside")));
          if (hit) E(`図「${fid}」: inside は graph のノードにだけ書ける（${f.type} の項目には書けない）`);
          continue;
        }
        for (const n of Array.isArray(f.nodes) ? f.nodes : []) {
          if (!isObj(n) || n.inside == null) continue;
          if (typeof n.inside !== "string" || !Object.prototype.hasOwnProperty.call(FIGS, n.inside)) E(`図「${fid}」: ノード ${n.id} の inside「${n.inside}」が図にない（figures の図の id を書く）`);
          else if (["space", "custom", "title", "frame", "toc"].includes(FIGS[n.inside] && FIGS[n.inside].type)) E(`図「${fid}」: ノード ${n.id} の inside「${n.inside}」は ${FIGS[n.inside].type}。箱の中身にできない`);
        }
      }
      const ins = UZ.insidesOf(sb).filter(x => Object.prototype.hasOwnProperty.call(FIGS, x.inside));
      const owner = {};
      for (const x of ins) {
        if (owner[x.inside]) E(`図「${x.fig}」: 中身の図「${x.inside}」を、別の箱（${owner[x.inside].fig}/${owner[x.inside].node}）の inside にも使っている（中身の図は 1 つの箱にだけ置く）`);
        else owner[x.inside] = x;
      }
      // 循環と深さ: 中身の図から親をたどる
      const bad = new Set();
      for (const x of ins) {
        const seen = [x.inside];
        let cur = x.fig, depth = 1;
        while (owner[cur] && !seen.includes(cur)) { seen.push(cur); cur = owner[cur].fig; depth++; }
        if (owner[cur] && seen.includes(cur)) { if (!bad.has("cycle")) E(`図「${x.fig}」: inside が循環している（${seen.join(" → ")}）`); bad.add("cycle"); }
        else if (depth > 3 && !bad.has("depth")) { E(`図「${x.inside}」: inside の入れ子が 3 段を超える（${depth} 段。${[...seen].reverse().join(" → ")}）`); bad.add("depth"); }
      }
      // 中身の図を、部品や場面の図としても置く
      const used = new Set();
      for (const sl of Object.values(sb.slides && typeof sb.slides === "object" ? sb.slides : {})) for (const p of (sl && Array.isArray(sl.parts) ? sl.parts : [])) used.add(UZ.partId(p));
      for (const sc of sb.scenes) if (sc && sc.slide == null) for (const f of Array.isArray(sc.figure) ? sc.figure : [sc.figure]) used.add(f);
      for (const id of Object.keys(owner)) if (used.has(id)) E(`中身の図「${id}」は、部品や場面の図としては置けない（箱「${owner[id].fig}/${owner[id].node}」に寄ると現れる）`);
      // 板に置いた図
      for (const { plate } of UZ.platesOf(sb)) {
        const pf = typeof plate.figure === "string" ? FIGS[plate.figure] : plate.figure;
        if (isObj(pf) && pf.type === "graph" && Array.isArray(pf.nodes) && pf.nodes.some(n => isObj(n) && n.inside != null)) E(`板「${plate.id}」: 板に置いた図のノードには inside が効かない（inside は普通のスライドの graph の箱だけ）`);
      }
    }

    const lineIds = new Set(), sceneIds = new Set();
    for (const sc of sb.scenes) {
      const where = `場面「${sc.id}」`;
      if (!sc.id) E("場面に id がない");
      if (sceneIds.has(sc.id)) E(`${where}: id が重複している`);
      sceneIds.add(sc.id);
      if (sc.chapter != null && (typeof sc.chapter !== "string" || !ID_RE.test(sc.chapter))) E(`${where}: chapter は構成メモの章の id を文字列で書く`);
      if (sc.slide != null) {
        if (sc.figure != null) E(`${where}: slide か figure のどちらか 1 つを書く`);
        if (!sb.slides || !Object.prototype.hasOwnProperty.call(sb.slides, sc.slide)) E(`${where}: スライド「${sc.slide}」が slides にない`);
      } else {
        const figs = Array.isArray(sc.figure) ? sc.figure : [sc.figure];
        if (!figs.length || figs.length > 2) E(`${where}: figure は 1 つか 2 つ`);
        for (const f of figs) if (!Object.prototype.hasOwnProperty.call(FIGS, f)) E(`${where}: 図「${f}」が figures にない`);
      }
      if (!Array.isArray(sc.lines) || !sc.lines.length) { E(`${where}: lines がない`); continue; }
      for (const ln of sc.lines) {
        const lw = `行「${ln.id}」`;
        if (!ln.id) E(`${where}: 行に id がない`);
        if (lineIds.has(ln.id)) E(`${lw}: id が重複している`);
        lineIds.add(ln.id);
        if (!ln.text) { E(`${lw}: text がない`); continue; }
        const p = UZ.parseText(ln.text);
        if (/[{}]/.test(p.text)) E(`${lw}: 印は {英数字} で書く（閉じていない括弧がある）`);
        if (ln.read) {
          const r = UZ.parseText(ln.read);
          const a = Object.keys(p.marks).sort().join(","), b = Object.keys(r.marks).sort().join(",");
          if (a !== b) E(`${lw}: read（読み）にも text と同じ印を置く（text: ${a || "なし"} / read: ${b || "なし"}）`);
        }
        if (ln.source != null && typeof ln.source !== "string" && !(Array.isArray(ln.source) && ln.source.every(s => typeof s === "string")))
          W(`${lw}: source は文字列か文字列の配列で書く（根拠の一覧に出ない）`);
        if (UZ.splitBalanced(p.text, 27, UZ.AREA.sub.w - 40).length > 2) W(`${lw}: 字幕が 2 行に収まらない。文を分ける`);
        const used = new Set();
        (ln.do || []).forEach((a, ai) => {
          const verbs = UZ.VERBS.filter(v => Object.prototype.hasOwnProperty.call(a, v));
          if (verbs.length !== 1) E(`${lw} の do[${ai}]: 動詞（${UZ.VERBS.join(" / ")}）をちょうど 1 つ書く（今は ${verbs.join(", ") || "なし"}）`);
          if (a.zoom != null && typeof a.zoom !== "string" && !(Array.isArray(a.zoom) && a.zoom.length && a.zoom.every(z => typeof z === "string" && z !== "all"))) E(`${lw} の do[${ai}]: zoom の対象は文字列（図・部品・要素の id、全体に戻るなら "all"）か、id の配列で書く`);
          if (a.pan != null && typeof a.pan !== "string") E(`${lw} の do[${ai}]: pan の対象は文字列（要素の id）で書く`);
          if ((a.zoom != null || a.pan != null) && a.pad != null && !(typeof a.pad === "number" && Number.isFinite(a.pad) && a.pad >= 0)) E(`${lw} の do[${ai}]: pad は 0 以上の数で書く`);
          if (a.region != null) {
            // region: 対象の矩形の中の一部を、割合（0〜1）の { x: [始まり, 終わり], y: [始まり, 終わり] } で指す（片方は省ける = 0〜1）
            const rg = a.region, span = v => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) && v[0] < v[1];
            if (verbs[0] !== "zoom" && verbs[0] !== "pan") E(`${lw} の do[${ai}]: region は zoom と pan にだけ付けられる`);
            else if (a.zoom === "all") E(`${lw} の do[${ai}]: zoom: "all" には region を付けられない（全体に戻る）`);
            else if (!rg || typeof rg !== "object" || Array.isArray(rg) || Object.keys(rg).some(k => k !== "x" && k !== "y") || (rg.x == null && rg.y == null) || (rg.x != null && !span(rg.x)) || (rg.y != null && !span(rg.y)))
              E(`${lw} の do[${ai}]: region は { "x": [始まり, 終わり], "y": [始まり, 終わり] } で、対象の区画に対する割合（0〜1、始まり < 終わり）で書く`);
          }
          if (a.draw != null && typeof a.draw !== "boolean") E(`${lw} の do[${ai}]: draw は true か false で書く`);
          if (a.draw != null && verbs[0] !== "show") E(`${lw} の do[${ai}]: draw は show にだけ付けられる`);
          if (verbs[0] === "set") {
            if (typeof a.set !== "string" || !Object.prototype.hasOwnProperty.call(values, a.set)) E(`${lw} の do[${ai}]: set の「${a.set}」が values にない`);
            if (typeof a.to !== "number" || !Number.isFinite(a.to)) E(`${lw} の do[${ai}]: set の to は数で書く`);
            if (a.ease != null && !["smooth", "linear"].includes(a.ease)) E(`${lw} の do[${ai}]: ease は smooth か linear で書く`);
            if (a.dur != null && !(typeof a.dur === "number" && Number.isFinite(a.dur) && a.dur > 0)) E(`${lw} の do[${ai}]: dur は 0 より大きい数で書く`);
          }
          if (a.at != null) { used.add(a.at); if (p.marks[a.at] == null) E(`${lw} の do[${ai}]: 印 {${a.at}} が text にない`); }
        });
        for (const k of Object.keys(p.marks)) if (!used.has(k)) W(`${lw}: 印 {${k}} を使う動作がない`);
      }
    }
    // chapter（構成メモの章の id）は、書くなら全場面に書く
    const noChapter = sb.scenes.filter(sc => sc.chapter == null);
    if (noChapter.length && noChapter.length < sb.scenes.length) W(`chapter のない場面がある: ${noChapter.map(sc => `「${sc.id}」`).join("")}`);
    // 題の無い場面が 2 つ以上続くと、構成メモがないとき、チャプター一覧で 1 つの章にまとまって見出しにならない
    // （chapter のある場面は、構成メモがあれば構成メモの章でまとめるので見ない）。
    // 題があるとみなすのは engine の header と同じ: 場面の title か、図が 1 つでその図の title（title 型の図は札の文の 1 行目）
    const titled = sc => {
      if (sc.title || sc.slide != null) return true;
      const figs = Array.isArray(sc.figure) ? sc.figure : [sc.figure];
      const f = figs.length === 1 && FIGS[figs[0]];
      return !!(f && (f.type === "title" || f.title));
    };
    let run = [];
    const flush = () => { if (run.length >= 2) W(`場面${run.map(id => `「${id}」`).join("")}: 題の無い場面が続く（チャプターに出ない。場面の title か図の title を付ける）`); run = []; };
    for (const sc of sb.scenes) { if (sc.chapter != null || titled(sc)) flush(); else run.push(sc.id); }
    flush();
    return { errors, warnings };
  };
})(globalThis.UZ = globalThis.UZ || {});
