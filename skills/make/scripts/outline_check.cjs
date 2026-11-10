// 台本と構成メモ（references/outline.md）の突き合わせ。check_storyboard.cjs --outline が呼ぶ。
// node 専用で、プレーヤーには埋め込まない（配置と時刻を計算済みの M = UZ.build() の戻り値を受け取る）。
const CHAPTER_TOLERANCE = 0.3;   // 章ごとの見積もりと尺の目安のずれ
const LENGTH_TOLERANCE = 0.15;   // 台本全体の長さと構成メモの長さのずれ
const positive = v => typeof v === "number" && v > 0;

// 戻り値: { errors, warnings, chapters: [{ id, planned, estimated }] }
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

  return {
    errors, warnings,
    chapters: chapters.map(c => ({ id: c.id, planned: positive(c.seconds) ? c.seconds : null, estimated: +est.get(c.id).toFixed(1) })),
  };
}

module.exports = { checkAgainstOutline };
