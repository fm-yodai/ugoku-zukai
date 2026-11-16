// 台本と構成メモ（references/outline.md）の突き合わせ。check_storyboard.cjs --outline が呼ぶ。
// node 専用で、プレーヤーには埋め込まない（配置と時刻を計算済みの M = UZ.build() の戻り値を受け取る）。
const CHAPTER_TOLERANCE = 0.3;   // 章ごとの見積もりと尺の目安のずれ
const LENGTH_TOLERANCE = 0.15;   // 台本全体の長さと構成メモの長さのずれ
const positive = v => typeof v === "number" && v > 0;

// 戻り値: { errors, warnings, chapters: [{ id, planned, estimated }], slides: [{ id, chapter, in_storyboard }] }
//   slides は、構成メモ（/2）に書いたスライド（書いた順）。/1 の構成メモでは空
//   planned は構成メモの seconds（なければ null）、estimated はその章の行の長さの合計（秒、小数 1 桁。場面がなければ 0）
function checkAgainstOutline(sb, M, outline, opts) {
  const complete = !!(opts && opts.complete);
  const errors = [], warnings = [];
  const chapters = Array.isArray(outline && outline.chapters) ? outline.chapters.filter(c => c && typeof c.id === "string") : [];
  const est = new Map(chapters.map(c => [c.id, 0]));
  if (!chapters.length) errors.push("構成メモに章（chapters）がない");

  // 場面 → 章。台本に初めて出てくる順も控える
  const chapterOf = new Map(), lineScene = new Map(), seen = [];
  for (const sc of sb.scenes) {
    for (const ln of sc.lines || []) lineScene.set(ln.id, sc.id);
    if (sc.chapter == null) { errors.push(`場面「${sc.id}」: chapter がない（構成メモと突き合わせるときは全場面に要る）`); continue; }
    if (!est.has(sc.chapter)) { errors.push(`場面「${sc.id}」: chapter「${sc.chapter}」が構成メモの章にない`); continue; }
    chapterOf.set(sc.id, sc.chapter);
    if (!seen.includes(sc.chapter)) seen.push(sc.chapter);
  }

  // 章の見積もり: 行ごとに「次の行の始まりまで」を足す（章の場面が離れていても数えられる）
  const lines = M.timeline.lines;
  lines.forEach((l, i) => {
    const ch = chapterOf.get(lineScene.get(l.id));
    if (ch != null) est.set(ch, est.get(ch) + (i + 1 < lines.length ? lines[i + 1].start - l.start : l.dur));
  });

  for (const c of chapters) {
    if (seen.includes(c.id)) continue;
    (complete ? errors : warnings).push(`章「${c.id}」の場面がまだない`);
  }
  // 同じ章の場面は続けて置く（離れていると、絵コンテとチャプター一覧で同じ章が 2 回出る）
  for (const id of seen) {
    const idx = sb.scenes.map((sc, i) => (chapterOf.get(sc.id) === id ? i : -1)).filter(i => i >= 0);
    if (idx[idx.length - 1] - idx[0] + 1 !== idx.length)
      warnings.push(`章「${id}」の場面が離れている（${idx.map(i => sb.scenes[i].id).join("・")}）`);
  }
  const planned = chapters.map(c => c.id).filter(id => seen.includes(id));
  if (planned.join("\n") !== seen.join("\n"))
    warnings.push(`章の順が構成メモと違う（台本: ${seen.join(" → ")}、構成メモ: ${planned.join(" → ")}）`);
  for (const c of chapters) {
    if (!seen.includes(c.id) || !positive(c.seconds)) continue;
    const e = est.get(c.id);
    if (Math.abs(e - c.seconds) > c.seconds * CHAPTER_TOLERANCE)
      warnings.push(`章「${c.id}」: 見積もり ${e.toFixed(1)} 秒が、尺の目安 ${c.seconds} 秒から 30% を超えてずれている`);
  }
  const length = outline && outline.basics && outline.basics.length && outline.basics.length.seconds;
  if (complete && positive(length) && Math.abs(M.endCard - length) > length * LENGTH_TOLERANCE)
    warnings.push(`台本の長さ ${M.endCard.toFixed(1)} 秒が、構成メモの長さ ${length} 秒から 15% を超えてずれている`);

  // スライド（構成メモが /2 のとき）: 構成メモのスライドと台本のスライドを、同じ id で照らす
  const slides = [];
  if (outline && outline.format === "ugoku-zukai-outline/2") {
    const used = M.slides || {};   // 場面が使っているスライド（id → { scenes }）
    const some = complete ? errors : warnings;
    const inOutline = new Map();
    for (const c of chapters) for (const sl of Array.isArray(c.slides) ? c.slides : []) {
      if (!sl || typeof sl.id !== "string" || inOutline.has(sl.id)) continue;
      inOutline.set(sl.id, c.id);
      const has = !!(sb.slides && sb.slides[sl.id]);
      slides.push({ id: sl.id, chapter: c.id, in_storyboard: has });
      if (!has) { some.push(`スライド「${sl.id}」が台本にない`); continue; }
      const first = used[sl.id] && used[sl.id].scenes[0];
      const ch = first != null ? chapterOf.get(first) : null;
      if (ch != null && ch !== c.id) errors.push(`スライド「${sl.id}」: 構成メモでは章「${c.id}」だが、台本で最初に使う場面「${first}」は章「${ch}」`);
    }
    for (const id of Object.keys(used)) if (!inOutline.has(id)) some.push(`スライド「${id}」が構成メモにない（意図を書く）`);
    // 章の中のスライドの順: 台本で最初に出る順と比べる
    const firstAt = id => sb.scenes.findIndex(sc => sc.id === (used[id] && used[id].scenes[0]));
    for (const c of chapters) {
      const ids = (Array.isArray(c.slides) ? c.slides : []).map(sl => sl && sl.id).filter(id => used[id] && inOutline.get(id) === c.id);
      const sorted = ids.slice().sort((a, b) => firstAt(a) - firstAt(b));
      if (ids.join("\n") !== sorted.join("\n")) warnings.push(`章「${c.id}」: スライドの順が台本と違う（台本: ${sorted.join(" → ")}、構成メモ: ${ids.join(" → ")}）`);
    }
  }

  // 目次（toc 図）: 章の id・題・順が構成メモの章と同じか
  const byId = new Map(chapters.map(c => [c.id, c]));
  for (const [fid, F] of Object.entries(M.figs || {})) {
    if (!F || F.type !== "toc") continue;
    const its = (F.spec.items || []).filter(it => it && typeof it.id === "string");
    for (const it of its) {
      const c = byId.get(it.id);
      if (!c) warnings.push(`目次「${fid}」: 章「${it.id}」が構成メモの章にない（項目の id は構成メモの章の id にする）`);
      else if (typeof c.title === "string" && String(it.text).trim() !== c.title.trim()) warnings.push(`目次「${fid}」: 章「${it.id}」の題「${it.text}」が構成メモの題「${c.title}」と違う`);
    }
    const want = chapters.map(c => c.id), got = its.map(it => it.id);
    const missing = want.filter(id => !got.includes(id));
    if (missing.length) warnings.push(`目次「${fid}」: 構成メモの章 ${missing.map(id => `「${id}」`).join("")} がない`);
    const known = got.filter(id => byId.has(id));
    if (known.join("\n") !== want.filter(id => known.includes(id)).join("\n")) warnings.push(`目次「${fid}」: 章の順が構成メモと違う（目次: ${known.join(" → ")}、構成メモ: ${want.join(" → ")}）`);
  }

  return {
    errors, warnings, slides,
    chapters: chapters.map(c => ({ id: c.id, planned: positive(c.seconds) ? c.seconds : null, estimated: +est.get(c.id).toFixed(1) })),
  };
}

module.exports = { checkAgainstOutline };
