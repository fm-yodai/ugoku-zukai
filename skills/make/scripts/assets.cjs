// 台本の画像の部品（type: "image"）のファイルを読み、大きさと data URI を返す（node 側。python 側は uz_assets.py。2 つを同じ約束に保つ）
// 読めるのは PNG・JPEG・SVG。src は台本のあるフォルダからの相対パスで、その外には出られない
const fs = require("fs"), path = require("path");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function imageSrcs(sb) {
  const out = [];
  const add = f => { if (f && typeof f === "object" && f.type === "image" && typeof f.src === "string" && !out.includes(f.src)) out.push(f.src); };
  for (const f of Object.values((sb && sb.figures) || {})) add(f);
  for (const sl of Object.values((sb && sb.slides) || {})) for (const p of (sl && Array.isArray(sl.parts) ? sl.parts : [])) add(p);
  return out;
}
function fail(src, why) {
  const e = new Error(`画像「${src}」が読めない（${why}）。PNG・JPEG・SVG を、台本と同じフォルダの下に置く`);
  e.code = "ASSET";
  return e;
}
function size(buf, mime) {
  if (mime === "image/png") {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }
  if (mime === "image/jpeg") {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  const head = buf.toString("utf8").match(/<svg\b[^>]*>/);
  if (!head) return null;
  const vb = head[0].match(/\bviewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)\s*["']/);
  if (vb) return [parseFloat(vb[1]), parseFloat(vb[2])];
  const w = head[0].match(/\bwidth\s*=\s*["']([\d.]+)(px)?["']/), h = head[0].match(/\bheight\s*=\s*["']([\d.]+)(px)?["']/);
  return w && h ? [parseFloat(w[1]), parseFloat(h[1])] : null;
}
function loadAssets(storyboardPath, sb) {
  const dir = path.dirname(path.resolve(storyboardPath)), out = {};
  for (const src of imageSrcs(sb)) {
    const mime = MIME[path.extname(src).toLowerCase()];
    if (path.isAbsolute(src) || src.split(/[\\/]/).includes("..")) throw fail(src, "台本のフォルダの外を指している");
    if (!mime) throw fail(src, "PNG・JPEG・SVG ではない");
    let buf;
    let real;
    try { real = fs.realpathSync(path.join(dir, src)); } catch (e) { throw fail(src, "ファイルがない"); }
    // シンボリックリンクをたどった先も、台本のフォルダの下でなければ読まない
    if (path.relative(fs.realpathSync(dir), real).split(path.sep)[0] === ".." || path.isAbsolute(path.relative(fs.realpathSync(dir), real))) throw fail(src, "台本のフォルダの外を指している");
    try { buf = fs.readFileSync(real); } catch (e) { throw fail(src, "ファイルがない"); }
    const wh = size(buf, mime);
    if (!wh || !(wh[0] > 0) || !(wh[1] > 0)) throw fail(src, "大きさを読み取れない");
    out[src] = { w: wh[0], h: wh[1], mime, data: `data:${mime};base64,${buf.toString("base64")}` };
  }
  return out;
}
module.exports = { loadAssets, imageSrcs };
