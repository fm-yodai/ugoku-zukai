#!/usr/bin/env python3
"""見本帳（全部の見本台本 × 全テーマを 1 ページで切り替えて見るページ）を作る。Artifact で公開する断片を書く。

使い方: python3 tools/build_gallery.py [-o dist/gallery.html]
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAKE = os.path.join(ROOT, "skills", "make")
sys.path.insert(0, os.path.join(MAKE, "scripts"))
import build_player as BP  # noqa: E402
import uz_assets  # noqa: E402

SAMPLES = [
    ("slide-forms", "スライド（言いたいこと・図と文章・定義の囲み・画像）"),
    ("graph-flow", "箱と矢印（業務の流れ）"),
    ("graph-state", "箱と矢印（状態遷移）"),
    ("sequence", "シーケンス図"),
    ("table-compare", "目次・箇条・比較・表"),
    ("mixed", "2 つの図・下の層"),
    ("proposal-process", "スイムレーン・As-Is/To-Be・ロードマップ"),
    ("proposal-analysis", "ツリー・2×2"),
    ("proposal-numbers", "KPI・棒グラフ・ファネル"),
    ("proposal-concept", "サイクル・ベン図・ピラミッド"),
    ("camera-morph", "Morph・カメラ・線の描画"),
]
THEMES = [
    ("koo", os.path.join(MAKE, "player", "themes", "koo.json")),
    ("kumo", os.path.join(MAKE, "examples", "themes", "kumo.json")),
]

PAGE = r"""<title>ugoku-zukai 見本帳</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=BIZ+UDPGothic:wght@400;700&family=Zen+Kaku+Gothic+New:wght@400;700&family=JetBrains+Mono:wght@400&display=swap">
<style>
  :root { --bg: #f3f1ec; --panel: #fbfaf7; --ink: #1e2329; --muted: #5f6670; --line: #dcd8cf; --accent: #0f6e78; --ok: #1e7a45; --ng: #b3261e; --code: #f0ede6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #15171a; --panel: #1c1f23; --ink: #e8e9ea; --muted: #9da3ab; --line: #2e3339; --accent: #6cc3cc; --ok: #7fd19b; --ng: #ff8a80; --code: #22262b; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #15171a; --panel: #1c1f23; --ink: #e8e9ea; --muted: #9da3ab; --line: #2e3339; --accent: #6cc3cc; --ok: #7fd19b; --ng: #ff8a80; --code: #22262b; color-scheme: dark; }
  body { background: var(--bg); color: var(--ink); font: 15px/1.7 "Noto Sans JP", system-ui, sans-serif;
         padding-block: 20px 40px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; }
  header h1 { font-size: 26px; margin: 0; text-wrap: balance; letter-spacing: .01em; }
  header p { margin: 4px 0 0; color: var(--muted); max-width: 70ch; }
  .pick { display: grid; gap: 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .row > span { font-size: 12px; letter-spacing: .08em; color: var(--muted); min-width: 4.5em; }
  .chip { font: inherit; font-size: 14px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px; cursor: pointer; }
  .chip[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent); font-weight: 700; }
  .stage { display: grid; gap: 8px; }
  svg#uz-stage { width: 100%; height: auto; aspect-ratio: 16 / 9; max-width: 100%; border-radius: 10px; display: block; box-shadow: 0 1px 0 var(--line), 0 8px 24px rgba(0,0,0,.08); }
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .bar button { font: inherit; font-weight: 700; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 16px; cursor: pointer; min-width: 100px; }
  .bar input[type=range] { flex: 1; min-width: 160px; accent-color: var(--accent); }
  .bar output { font-variant-numeric: tabular-nums; color: var(--muted); }
  .bar label { color: var(--muted); display: flex; gap: 6px; align-items: center; }
  .cols { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; }
  @media (max-width: 860px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
  .panel h2 { font-size: 13px; letter-spacing: .08em; color: var(--muted); margin: 0 0 8px; font-weight: 700; }
  pre { margin: 0; background: var(--code); border-radius: 8px; padding: 12px; overflow: auto; max-height: 520px; font: 12.5px/1.55 "JetBrains Mono", ui-monospace, monospace; }
  ul.res { margin: 0; padding-left: 1.2em; } ul.res li { margin: 2px 0; }
  .ok { color: var(--ok); font-weight: 700; } .ng { color: var(--ng); font-weight: 700; }
  .sw { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .sw i { display: inline-flex; align-items: center; gap: 6px; font-style: normal; font-size: 12px; color: var(--muted); }
  .sw b { width: 18px; height: 18px; border-radius: 4px; display: inline-block; border: 1px solid var(--line); }
  .lines { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .lines button { font: inherit; text-align: left; width: 100%; background: none; border: 0; border-left: 3px solid transparent; color: var(--ink); padding: 3px 8px; cursor: pointer; border-radius: 4px; }
  .lines button.cur { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .lines code { color: var(--muted); font-size: 12px; margin-right: 6px; }
  .err { color: var(--ng); white-space: pre-wrap; }
</style>
<div class="wrap">
  <header>
    <h1>ugoku-zukai 見本帳</h1>
    <p>台本の見本を、テーマを切り替えて再生できます。最初の見本は、スライド（見出し・言いたいこと・区画に並べた図とテキストと画像）の形です。ほかは、スライドに置く図の見本です。ナレーションは VOICEVOX（春日部つむぎ）で合成し、文中の印 <code>{a}</code> の語を話し始める瞬間に動きが始まります。音が出るのは再生ボタンを押してからです。</p>
  </header>
  <div class="pick">
    <div class="row" id="samples"><span>見本</span></div>
    <div class="row" id="themes"><span>テーマ</span></div>
  </div>
  <div class="stage">
    <svg id="uz-stage" role="img" aria-label="見本の再生画面"></svg>
    <div class="bar">
      <button id="play" type="button">▶ 再生</button>
      <input id="seek" type="range" min="0" max="1000" value="0" aria-label="再生位置">
      <output id="clock">0:00 / 0:00</output>
      <label><input id="subs" type="checkbox" checked> 字幕</label>
    </div>
    <div class="row" id="finals" hidden><span>完成形</span></div>
    <div class="err" id="err" hidden></div>
  </div>
  <section class="panel"><h2>行（押すとその行へ）</h2><ul class="lines" id="lines"></ul></section>
  <div class="cols">
    <section class="panel"><h2>台本（storyboard.json）</h2><pre id="json"></pre></section>
    <div style="display:grid;gap:18px;align-content:start;min-width:0">
      <section class="panel"><h2>検査（プレーヤーと同じ JS で計算）</h2><div id="check"></div></section>
      <section class="panel"><h2>テーマ</h2><div id="theme"></div></section>
    </div>
  </div>
</div>
<script>/*UZ:ELK*/</script>
<script>/*UZ:MATH*/</script>
<script>/*UZ:CORE*/</script>
<script>
const G = /*UZ:DATA*/null;
(function () {
  "use strict";
  UZ.ELK = window.ELK;
  const $ = id => document.getElementById(id);
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  let cur = { sample: G.samples[0].id, theme: G.themes[0].id }, M = null, view = null, playing = false, t0 = 0, pausedAt = 0, token = 0;
  try { const s = JSON.parse(localStorage.getItem("uz-gallery") || "null"); if (s && G.samples.some(x => x.id === s.sample) && G.themes.some(x => x.id === s.theme)) cur = s; } catch (e) {}
  // 時計: 音声があれば WebAudio の時計、なければ performance.now()
  let ctx = null, src = null, buffers = {};
  const S0 = () => G.samples.find(s => s.id === cur.sample);
  const hasAudio = () => !!S0().audio;
  const now = () => !playing ? pausedAt : (src ? ctx.currentTime - t0 : (performance.now() - t0) / 1000);
  async function audioBuf(S) {
    if (!S.audio) return null;
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!buffers[S.id]) { const bin = atob(S.audio), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); buffers[S.id] = await ctx.decodeAudioData(u.buffer); }
    return buffers[S.id];
  }
  function stopAudio() { if (src) { try { src.stop(); } catch (e) {} src.disconnect(); src = null; } }
  async function startAt(t) {
    stopAudio();
    const buf = await audioBuf(S0());
    if (buf && t < buf.duration) {
      if (ctx.state === "suspended") await ctx.resume();
      src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      t0 = ctx.currentTime - t; src.start(0, t);
    } else t0 = performance.now() - t * 1000;
  }
  function chips(box, list, key) {
    for (const it of list) {
      const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = it.label; b.dataset.id = it.id;
      b.onclick = () => { cur[key] = it.id; try { localStorage.setItem("uz-gallery", JSON.stringify(cur)); } catch (e) {} load(); };
      box.appendChild(b);
    }
  }
  chips($("samples"), G.samples, "sample"); chips($("themes"), G.themes, "theme");
  function tick() {
    if (!M) return;
    const D = M.duration, t = Math.min(now(), D);
    if (playing && now() >= D) { playing = false; pausedAt = D; stopAudio(); $("play").textContent = "▶ もう一度"; }
    view.render(t);
    $("seek").value = Math.round(t / D * 1000);
    $("clock").textContent = `${fmt(t)} / ${fmt(D)}`;
    const fr = view._lastLine;
    const ln = M.timeline.lines.filter(l => t >= l.start - 0.05).pop();
    for (const b of $("lines").querySelectorAll("button")) b.classList.toggle("cur", ln && b.dataset.id === ln.id);
    if (playing) requestAnimationFrame(tick);
  }
  async function seek(t) { pausedAt = t; if (playing) await startAt(t); tick(); }
  $("play").onclick = async () => {
    if (!M) return;
    if (playing) { pausedAt = now(); playing = false; stopAudio(); $("play").textContent = "▶ 再生"; }
    else { if (pausedAt >= M.duration - 0.05) pausedAt = 0; await startAt(pausedAt); playing = true; $("play").textContent = "❚❚ 一時停止"; requestAnimationFrame(tick); }
  };
  $("seek").oninput = () => M && seek($("seek").value / 1000 * M.duration);
  $("subs").onchange = () => { if (view) { view.subtitles = $("subs").checked; view._sub = null; tick(); } };
  async function load() {
    const my = ++token;
    playing = false; stopAudio(); $("play").textContent = "▶ 再生"; $("err").hidden = true;
    for (const b of document.querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(b.dataset.id === cur.sample || b.dataset.id === cur.theme));
    const S = G.samples.find(s => s.id === cur.sample), T = G.themes.find(t => t.id === cur.theme);
    $("json").textContent = JSON.stringify(S.storyboard, null, 2);
    try { if (document.fonts) await Promise.race([document.fonts.load(`500 24px ${T.theme.font.family}`), new Promise(r => setTimeout(r, 2000))]); } catch (e) {}
    const m = await UZ.build(S.storyboard, T.theme, S.timeline || null, { assets: S.assets || {} });
    if (my !== token) return;
    if (m.errors.length) { $("err").textContent = m.errors.join("\n"); $("err").hidden = false; return; }
    M = m; view = new UZ.View($("uz-stage"), M); view.subtitles = $("subs").checked;
    // スライドの完成形（部品がすべて出た状態）を見るボタン。スライドのない見本では出さない
    const fin = $("finals");
    for (const b of fin.querySelectorAll("button")) b.remove();
    fin.hidden = !Object.keys(M.slides || {}).length;
    for (const sl of Object.values(M.slides || {})) {
      const b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.textContent = S.storyboard.slides[sl.id].title;
      b.onclick = () => {
        if (playing) $("play").click();
        const orig = UZ.frame, fr = UZ.finalFrame(M, sl.id);
        UZ.frame = () => fr;   // この 1 回だけ、完成形のコマを描く
        try { view.render(fr.t); } finally { UZ.frame = orig; }
      };
      fin.appendChild(b);
    }
    // 行の一覧
    const ul = $("lines"); ul.innerHTML = "";
    for (const sc of S.storyboard.scenes) for (const l of sc.lines) {
      const tl = M.TL[l.id], li = document.createElement("li"), b = document.createElement("button");
      b.dataset.id = l.id; b.innerHTML = `<code>${esc(l.id)} ${fmt(tl.start)}</code>${esc(UZ.parseText(l.text).text)}`;
      b.onclick = () => seek(tl.start + tl.dur - 0.05); li.appendChild(b); ul.appendChild(li);
    }
    // 検査
    const issues = UZ.checkLayout(M);
    $("check").innerHTML = (issues.length ? `<span class="ng">配置の問題 ${issues.length} 件</span>` : `<span class="ok">配置の問題なし</span>`)
      + `（${M.acts.length} 個の動作、${fmt(M.duration)}、${S.audio ? "音声: " + esc(M.credit) + "。時刻は音声の実測" : "音声なし。時刻は文字数からの見積もり"}）`
      + (issues.length || M.warnings.length ? `<ul class="res">${issues.map(i => `<li>${esc(i.kind)}・${i.at}s: ${esc(i.msg)}</li>`).join("")}${M.warnings.map(w => `<li>警告: ${esc(w)}</li>`).join("")}</ul>` : "");
    // テーマ
    const c = T.theme.colors, sw = [["背景", c.bg], ["文字", c.ink], ["補足", c.muted], ["強調", c.accent], ["actor", c.roles.actor], ["process", c.roles.process], ["store", c.roles.store], ["external", c.roles.external], ["good", c.good], ["bad", c.bad]];
    $("theme").innerHTML = `<div><b>${esc(T.theme.label || T.theme.name)}</b></div>`
      + (T.note ? `<div style="color:var(--muted);font-size:13px">${esc(T.note)}</div>` : "")
      + `<div class="sw">${sw.map(([n, v]) => `<i><b style="background:${v}"></b>${esc(n)} ${esc(v)}</i>`).join("")}</div>`
      + `<div style="color:var(--muted);font-size:12px;margin-top:6px">文字: ${esc(T.theme.font.family.split(",")[0])}</div>`;
    const first = M.scenes.find(s => s.figs.some(f => !M.figs[f].autoShow)) || M.scenes[0];
    const ln = first.lines[0];
    seek(M.TL[ln.id].start + M.TL[ln.id].dur);
    pausedAt = M.TL[ln.id].start + M.TL[ln.id].dur;
  }
  load();
})();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(ROOT, "dist", "gallery.html"))
    ap.add_argument("--voice", help="見本ごとの tts.py の出力（DIR/<見本の id>/timeline.json と narration.mp3）。あれば音声つきにする")
    a = ap.parse_args()
    samples = []
    for sid, label in SAMPLES:
        path = os.path.join(MAKE, "examples", f"{sid}.json")
        sb = json.load(open(path, encoding="utf-8"))
        samples.append({"id": sid, "label": label, "storyboard": sb, "assets": uz_assets.load_assets(path, sb)})   # 画像の部品は埋め込む
    if a.voice:
        import base64
        for smp in samples:
            d = os.path.join(a.voice, smp["id"])
            if os.path.exists(os.path.join(d, "timeline.json")) and os.path.exists(os.path.join(d, "narration.mp3")):
                smp["timeline"] = json.load(open(os.path.join(d, "timeline.json"), encoding="utf-8"))
                smp["audio"] = base64.b64encode(open(os.path.join(d, "narration.mp3"), "rb").read()).decode()
            else:
                print(f"音声がない: {smp['id']}（{d}）", file=sys.stderr)
    themes = []
    for tid, path in THEMES:
        th = json.load(open(path, encoding="utf-8"))
        note = "架空の会社の Web ページ（デザインシステムではない入力）から、extract_design.py で色と文字を拾って作ったテーマ" if tid == "kumo" else ""
        themes.append({"id": tid, "label": th.get("label", tid), "theme": th, "note": note})
    elk, math, core = BP.engine_scripts()   # 再生ページと同じ束（ELK・数式の組版・プレーヤーのコード）
    html = PAGE.replace("/*UZ:ELK*/", "\n" + elk + "\n")
    html = html.replace("/*UZ:MATH*/", "\n" + math + "\n")
    html = html.replace("/*UZ:CORE*/", "\n" + core + "\n")
    html = html.replace("/*UZ:DATA*/null", BP.safe_json({"samples": samples, "themes": themes}))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    open(a.out, "w", encoding="utf-8").write(html)
    print(f"{a.out}（{len(html.encode()) / 1e6:.1f}MB）")


if __name__ == "__main__":
    main()
