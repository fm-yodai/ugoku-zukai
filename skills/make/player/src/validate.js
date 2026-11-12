// ugoku-zukai プレーヤー: 台本の形の検査（配置の前にわかる誤り）。id の解決や経路の検査は engine.build が行う
(function (UZ) {
  "use strict";
  const ID_RE = /^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー.]+$/;
  const TYPES = {
    title: ["text"], toc: ["items"], list: ["items"], compare: ["items"], table: ["columns", "rows"],
    sequence: ["participants", "messages"], graph: ["nodes", "edges"], canvas: ["shapes"],
    swimlane: ["lanes", "steps"], beforeafter: ["before", "after"], roadmap: ["periods", "items"], tree: ["root"],
    chart: ["categories", "series"], kpi: ["items"], matrix: ["x", "y"], pyramid: ["levels"], cycle: ["steps"], venn: ["sets"],
    text: ["blocks"], image: ["src"], frame: [],
  };
  const ROLES = ["actor", "process", "store", "external", "muted", "added", "removed", "good", "bad", "warn", "accent"];

  UZ.validate = function (sb) {
    const errors = [], warnings = [];
    const E = m => errors.push(m), W = m => warnings.push(m);
    if (!sb || typeof sb !== "object") return { errors: ["台本が JSON のオブジェクトでない"], warnings };
    if (!UZ.FORMATS.includes(sb.format)) E(`format は "${UZ.FORMAT}" と書く（今は ${JSON.stringify(sb.format)}）`);
    if (sb.figures != null && typeof sb.figures !== "object") E("figures（図の宣言）はオブジェクトで書く");
    if (sb.figures == null && sb.slides == null) E("figures（図の宣言）がない");
    if (!Array.isArray(sb.scenes) || !sb.scenes.length) E("scenes（場面の列）がない");
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
      if (f.type === "canvas") {
        for (const s of f.shapes || []) {
          addId(s.id, "図形");
          if (!["rect", "ellipse", "line", "arrow", "text"].includes(s.shape)) E(`${where}: 図形 ${s.id} の shape は rect / ellipse / line / arrow / text`);
        }
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
