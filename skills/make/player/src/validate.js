// ugoku-zukai プレーヤー: 台本の形の検査（配置の前にわかる誤り）。id の解決や経路の検査は engine.build が行う
(function (UZ) {
  "use strict";
  const ID_RE = /^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー.]+$/;
  const TYPES = {
    title: ["text"], list: ["items"], compare: ["items"], table: ["columns", "rows"],
    sequence: ["participants", "messages"], graph: ["nodes", "edges"], canvas: ["shapes"],
  };
  const ROLES = ["actor", "process", "store", "external", "muted", "added", "removed", "good", "bad", "warn", "accent"];

  UZ.validate = function (sb) {
    const errors = [], warnings = [];
    const E = m => errors.push(m), W = m => warnings.push(m);
    if (!sb || typeof sb !== "object") return { errors: ["台本が JSON のオブジェクトでない"], warnings };
    if (sb.format !== UZ.FORMAT) E(`format は "${UZ.FORMAT}" と書く（今は ${JSON.stringify(sb.format)}）`);
    if (!sb.figures || typeof sb.figures !== "object") E("figures（図の宣言）がない");
    if (!Array.isArray(sb.scenes) || !sb.scenes.length) E("scenes（場面の列）がない");
    if (errors.length) return { errors, warnings };

    for (const [fid, f] of Object.entries(sb.figures)) {
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
      const figs = Array.isArray(sc.figure) ? sc.figure : [sc.figure];
      if (!figs.length || figs.length > 2) E(`${where}: figure は 1 つか 2 つ`);
      for (const f of figs) if (!sb.figures[f]) E(`${where}: 図「${f}」が figures にない`);
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
    return { errors, warnings };
  };
})(globalThis.UZ = globalThis.UZ || {});
