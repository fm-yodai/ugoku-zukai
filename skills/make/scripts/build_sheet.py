#!/usr/bin/env python3
"""利用者向けのスライドコンテのページ（HTML 1 枚）を作る。frames.cjs が書いたコマを、章ごと・スライドごと・行ごとに並べる。

  python3 build_sheet.py <storyboard.json> --frames <frames.cjs の出力先> -o <sheet.html> [--outline <outline.json>]
                         [--voice <tts.py の出力先>] [--theme koo] [--no-play] [--artifact]

ページに出すのは、スライド・原稿・それらの意図・位置の札だけ（進行役が決めたこと、検査の結果、時刻の出どころなどは出さない。会話で伝える）。
- 章の段: 章の題。構成メモ（--outline）が 3 段の意図の形（/2）なら、章の意図と、前の章からのつながり。最初の章の前に、章の順番の意図
  章の分け方は再生ページのチャプター一覧と同じ: 場面の chapter が構成メモ（--outline）にあれば、その章（題は構成メモの章の題）。
  それ以外の場面は場面の題（場面の title、スライドの title、図が 1 つならその図の title、title 型の図は札の文の 1 行目）でまとめる
- スライドの段: スライドを最初に使う場面の位置に 1 回だけ。完成形のコマ（frames.json の slides）、スライドの見出し、
  構成メモ（/2）にあればスライドの意図と、前のスライドからのつながり
- 行の段: 左にコマ、右に「s2 / l2 @0:14」（場面の id / 行の id @行の始まりの時刻）と字幕の全文
- frames.json にない行・スライド（frames.cjs --scenes で一部だけ書いたとき）は出さない。行が 1 つもない章は見出しごと出さない
- 前の形の構成メモ（/1）では、章の題とコマと原稿だけを出す
- --alts <alts.json>: スライドの複数案を、同じページの中に並べる。置き換える範囲（replaces のスライド）の最初の位置に案の段を出し、
  案ごとに、名前・違いの 1 行・案のスライド（完成形と意図）・その場面の行を出す。その範囲の今の台本の段は、案の段の外には出さない。
  案は 2〜4 つ。案の台本とコマは alts.py が作る（alts.json の形は references/run-code.md）
- --artifact: Artifact で公開する形（<html>・<head>・<body> を外した断片）で書く
- コマは SVG を data: の画像として埋め込む。外部のファイルは読まない。PNG（resvg）は要らない
- 章ごとの動きの再生: 章の段の頭に「この章を再生」のボタンを置く。再生領域はページに 1 つ（<svg> 1 つと UZ.View 1 つ）で、
  押した章の頭へ移り、その章の場面の時間（最初の場面の start から最後の場面の end まで）だけを流す。音声は鳴らさず、字幕は出す。
  プレーヤーと同じエンジン（ELK と CORE。build_player.py の engine_scripts）と、台本・テーマ・時刻表・画像を埋め込む。
  時刻は --voice の timeline.json があればそれ（台本が変わっていれば止まる）、なければ文字数からの見積もり。
  コマの時刻の出どころ（frames.json の timed）と食い違えば止まる（声の時刻のコマに時刻表がない、見積もりのコマに時刻表を渡した）。
  テーマは、コマを書いたテーマ（frames.json の theme）。--theme か構成メモの basics.look.theme がそれと違えば止まる。
  theme のない前の版の frames.json では、build_player.py と同じ決め方（構成メモ、なければ --theme か koo）。
  --no-play: 再生を付けない（JS を含まない軽いページ）

- コマが今の台本のものでない（台本を直した後に frames.cjs を回し直していない、別の台本のコマ）ときは、書かずに止まる

終了コード: 0 = 書けた、2 = 使い方の誤りか、frames.json・コマの SVG がないか、コマが今の台本のものでないか、構成メモの形に誤りがあるか、
  音声が古いか（--voice）、再生のテーマか時刻の出どころがコマと食い違うか、画像の部品を読めないか、ページが 15MB を超える。
"""
import argparse
import base64
import hashlib
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_player  # noqa: E402
import check_outline  # noqa: E402

STYLE = """
  :root { --page: #f4f5f7; --panel: #ffffff; --ink: #1d2433; --muted: #5d6676; --line: #d3d8e0; --accent: #1a5fd0; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #121418; --panel: #1a1d23; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; color-scheme: dark; } }
  :root[data-theme="dark"] { --page: #121418; --panel: #1a1d23; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; color-scheme: dark; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.7 "Noto Sans JP", system-ui, sans-serif;
         padding-block: 20px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .us-wrap { max-width: 1040px; margin: 0 auto; }
  .us-wrap h1 { font-size: 22px; line-height: 1.4; margin: 0 0 4px; overflow-wrap: anywhere; }
  .us-chapter { margin-top: 32px; }
  .us-chapter h2 { font-size: 17px; line-height: 1.5; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid var(--line); overflow-wrap: anywhere; }
  .us-flow, .us-intent, .us-link { margin: 0 0 6px; overflow-wrap: anywhere; }
  .us-flow, .us-link { color: var(--muted); font-size: 14px; }
  .us-slide { margin: 20px 0 4px; padding: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .us-slide img.us-final { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: 6px; margin: 0 0 10px; }
  .us-alts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 20px 0 4px; }
  .us-alt { padding: 12px; border: 2px solid var(--accent); border-radius: 8px; background: var(--panel); }
  .us-alt > h3 { font-size: 17px; margin: 0 0 2px; color: var(--accent); }
  .us-alt .us-diff { margin: 0 0 10px; overflow-wrap: anywhere; }
  .us-alt .us-slide { margin: 0 0 4px; padding: 0; border: 0; }
  .us-alt .us-slide h4 { font-size: 15px; line-height: 1.5; margin: 0 0 4px; overflow-wrap: anywhere; }
  .us-alt .us-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  @media (max-width: 900px) { .us-alts { grid-template-columns: minmax(0, 1fr); } }
  .us-slide h3 { font-size: 16px; line-height: 1.5; margin: 0 0 4px; overflow-wrap: anywhere; }
  .us-row { display: grid; grid-template-columns: minmax(0, 58%) minmax(0, 1fr); gap: 16px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .us-row img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
  .us-ref { margin: 0 0 4px; font: 13px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: var(--accent); font-variant-numeric: tabular-nums; }
  .us-sub { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 640px) { .us-row { grid-template-columns: minmax(0, 1fr); gap: 8px; } }
  .us-play { font: inherit; font-weight: 700; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 999px;
             padding: 4px 16px; margin: 4px 0 8px; cursor: pointer; }
  .us-play:hover, .us-play:focus-visible, .us-play[aria-pressed="true"] { border-color: var(--accent); outline: none; }
  .us-play[aria-pressed="true"] { color: var(--accent); }
  .us-player { margin: 0 0 12px; }
  .us-player svg { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border-radius: 6px; border: 1px solid var(--line); }
  .us-player p { margin: 4px 0 0; color: var(--muted); font-size: 13px; white-space: pre-wrap; }
"""

# 章ごとの再生。再生領域（#us-player）は 1 つで、押した章のボタンの直後へ移して流す
PLAY_JS = r"""
(function () {
  "use strict";
  const box = document.getElementById("us-player"), stage = document.getElementById("us-stage"), err = document.getElementById("us-play-err");
  const PLAY = "この章を再生", STOP = "止める";
  let M = null, view = null, ready = null, cur = null, raf = 0;
  UZ.ELK = window.ELK;
  function prepare() {
    if (!ready) ready = (async () => {
      const data = JSON.parse(document.getElementById("us-data").textContent);
      M = await UZ.build(data.storyboard, data.theme, data.timeline, { assets: data.assets || {} });
      if (M.errors.length) throw new Error(M.errors.join("\n"));
      view = new UZ.View(stage, M);
    })();
    return ready;
  }
  function stop() {
    cancelAnimationFrame(raf);
    if (cur) { cur.btn.textContent = PLAY; cur.btn.setAttribute("aria-pressed", "false"); }
    cur = null;
  }
  async function play(btn) {
    const again = cur && cur.btn === btn;
    stop();
    if (again) return;   // 流れている章のボタンは「止める」
    btn.after(box);
    box.hidden = false;
    btn.textContent = STOP; btn.setAttribute("aria-pressed", "true");
    const me = cur = { btn };
    try { await prepare(); } catch (e) { err.textContent = "再生できませんでした: " + e.message; err.hidden = false; stop(); console.error(e); return; }
    if (cur !== me) return;
    const from = M.scenes.find(s => s.id === btn.dataset.from), to = M.scenes.find(s => s.id === btn.dataset.to);
    if (!from || !to) { stop(); return; }
    const start = from.start, end = Math.max(start, to.end - 0.01), t0 = performance.now();
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const tick = () => {
      if (cur !== me) return;
      const t = Math.min(start + (performance.now() - t0) / 1000, end);
      view.render(t);
      if (t >= end) { stop(); return; }   // 止めた後も、章の最後の絵を残す
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  for (const btn of document.querySelectorAll(".us-play")) btn.addEventListener("click", () => play(btn));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && cur) stop(); });
})();
"""

esc = html.escape  # & < > " ' をすべて置き換える


def _scene_title(storyboard, sc):
    """場面の題。再生ページのチャプター一覧と同じ決め方（題がなければ空文字）"""
    if sc.get("title"):
        return sc["title"]
    if sc.get("slide") is not None:   # スライドを指す場面は、スライドの見出し
        sl = (storyboard.get("slides") or {}).get(sc["slide"]) or {}
        return sl.get("title") or ""
    figs = sc.get("figure")
    figs = figs if isinstance(figs, list) else [figs]
    if len(figs) != 1:
        return ""
    fig = (storyboard.get("figures") or {}).get(figs[0]) or {}
    if fig.get("type") == "title":   # 題の札（章扉）は、札の文の 1 行目
        return str(fig.get("text") or "").split("\n")[0].strip()
    return fig.get("title") or ""


def chapters(storyboard, outline=None):
    """場面を章にまとめる。戻り値: [{"id": 構成メモの章の id（なければ None）, "title": 章の見出し, "scenes": [場面の id…]}]

    再生ページ（template.html の chapterData）と同じ決め方。場面の chapter が構成メモにあれば構成メモの章、
    それ以外は場面や図の題（題の札は札の文の 1 行目）でまとめる。同じ章が続けば 1 つにまとめ、題のない場面は直前の章に入れる。"""
    by_id = {}
    for c in (outline or {}).get("chapters") or []:
        if isinstance(c, dict) and isinstance(c.get("id"), str):
            by_id[c["id"]] = c
    out, keys = [], []
    for sc in storyboard["scenes"]:
        och = by_id.get(sc["chapter"]) if isinstance(sc.get("chapter"), str) else None
        if och:
            key, title, cid = ("outline", och["id"]), och.get("title") or och["id"], och["id"]
        else:
            title, cid = _scene_title(storyboard, sc), None
            if not title and out:
                out[-1]["scenes"].append(sc["id"])
                continue
            title = title or "はじめに"
            key = ("scene", title)
        if keys and keys[-1] == key:
            out[-1]["scenes"].append(sc["id"])
        else:
            out.append({"id": cid, "title": title, "scenes": [sc["id"]]})
            keys.append(key)
    return out


MARK_RE = re.compile(r"\{[A-Za-z0-9_]+\}")  # 字幕の文中の印（player/src/engine.js の MARK_RE と同じ）


def _stale(storyboard, lines):
    """コマが今の台本のものでなければ、その理由を返す（合っていれば None）。

    frames.json に載っている場面ごとに、行の id の並びと字幕の文を台本と比べる。
    frames.cjs --scenes で書かなかった場面は見ない。"""
    want = {sc["id"]: [(ln.get("id"), MARK_RE.sub("", ln.get("text") or "")) for ln in sc.get("lines") or []]
            for sc in storyboard["scenes"]}
    got = {}
    for ln in lines:
        got.setdefault(ln.get("scene"), []).append((ln.get("id"), ln.get("text")))
    for sid, rows in got.items():
        if sid not in want:
            return f"場面「{sid}」が台本にない"
        if rows != want[sid]:
            ids = [i for i, _ in rows], [i for i, _ in want[sid]]
            if ids[0] != ids[1]:
                return f"場面「{sid}」の行が台本と違う（コマ: {'・'.join(map(str, ids[0]))} / 台本: {'・'.join(map(str, ids[1]))}）"
            changed = [a[0] for a, b in zip(rows, want[sid]) if a != b]
            return f"場面「{sid}」の行「{changed[0]}」の字幕が台本と違う"
    return None


def _clock(seconds):
    s = int(seconds)
    return f"{s // 60}:{s % 60:02d}"


def _data(frames_dir, rel):
    with open(os.path.join(frames_dir, rel), "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _item_text(v):
    return v["text"] if isinstance(v, dict) and isinstance(v.get("text"), str) and v["text"].strip() else None


def _slide_block(storyboard, frames_dir, slide, intents, tag="h3"):
    """スライドの段: 完成形のコマ、見出し、（構成メモにあれば）意図と前のスライドからのつながり"""
    sid = slide["id"]
    title = ((storyboard.get("slides") or {}).get(sid) or {}).get("title") or sid
    out = [f'<div class="us-slide"><img class="us-final" src="data:image/svg+xml;base64,{_data(frames_dir, slide["svg"])}" alt="{esc(title)} の完成形" loading="lazy">',
           f"<{tag}>{esc(title)}</{tag}>"]
    it = intents.get(sid) or {}
    if it.get("link"):
        out.append(f'<p class="us-link">前のスライドから: {esc(it["link"])}</p>')
    if it.get("intent"):
        out.append(f'<p class="us-intent">{esc(it["intent"])}</p>')
    out.append("</div>")
    return "".join(out)


def _load_frames(frames_dir, storyboard, sb_path=None):
    """frames.json を読み、コマが台本のものかを確かめて返す。なければ OSError、形が違う・古いなら ValueError。
    sb_path（台本のファイル）を渡すと、コマを書いた後に台本が変わっていないかも見る（字幕は同じでも、スライドの中身を変えたらコマは古い）"""
    with open(os.path.join(frames_dir, "frames.json"), encoding="utf-8") as f:
        frames = json.load(f)
    lines = frames.get("lines")
    if not isinstance(lines, list):
        raise ValueError("frames.json に lines がない")
    for ln in lines:
        if not isinstance(ln.get("start"), (int, float)):
            raise ValueError(f"frames.json の行「{ln.get('id')}」に start がない。frames.cjs を回し直す")
    if not lines:
        raise ValueError("frames.json にコマが 1 つもない。frames.cjs を回し直す")
    stale = _stale(storyboard, lines)
    if stale:
        raise ValueError(f"コマが今の台本のものでない（{stale}）。台本を直したら frames.cjs を回し直す")
    want = frames.get("storyboard_sha256")   # 前の版の frames.cjs が書いたコマにはない（そのときは行の id と字幕だけで見る）
    if sb_path and isinstance(want, str):
        with open(sb_path, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != want:
                raise ValueError("コマが今の台本のものでない（コマを書いた後に、台本が変わった）。台本を直したら frames.cjs を回し直す")
    return frames


def load_alts(path, storyboard):
    """案の一覧 alts.json を読んで確かめる。戻り値: 組の列。それぞれ
    {"id", "replaces": [今の台本のスライドの id…], "scenes": [置き換える場面の id…],
     "options": [{"name", "diff", "storyboard": 台本, "frames_dir", "frames": frames.json, "slides": [{"id", "intent", "link"}…]}…]}
    パスは alts.json のあるフォルダからの相対。読めなければ OSError、形が違えば ValueError"""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except OSError as e:
        raise OSError(f"案の一覧 alts.json を読めない: {path}（{e.strerror or e}）")
    base = os.path.dirname(os.path.abspath(path))
    groups = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        raise ValueError("alts.json に groups（案の組の列）がない")
    slides = storyboard.get("slides") or {}
    order = [sc.get("slide") for sc in storyboard["scenes"]]
    out, taken = [], set()
    for g in groups:
        gid = g.get("id") if isinstance(g, dict) else None
        where = f"案の組「{gid}」"
        reps = g.get("replaces") if isinstance(g, dict) else None
        if not isinstance(gid, str) or not isinstance(reps, list) or not reps:
            raise ValueError(f"{where}: id と replaces（置き換えるスライドの id の列）が要る")
        for sid in reps:
            if sid not in slides or sid not in order:
                raise ValueError(f"{where}: スライド「{sid}」が台本にない（場面が使っているスライドを書く）")
            if sid in taken:
                raise ValueError(f"{where}: スライド「{sid}」が、ほかの案の組にも入っている")
            taken.add(sid)
        idx = [i for i, sl in enumerate(order) if sl in reps]
        if idx[-1] - idx[0] + 1 != len(idx):
            raise ValueError(f"{where}: 置き換えるスライド（{'・'.join(reps)}）の場面が続いていない")
        opts = g.get("options")
        if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
            raise ValueError(f"{where}: 案は 2〜4 つ")
        names, options = set(), []
        for o in opts:
            name = o.get("name") if isinstance(o, dict) else None
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"{where}: 案に name がない")
            if name in names:
                raise ValueError(f"{where}: 案の名前「{name}」が重なっている")
            names.add(name)
            sb_path = os.path.join(base, str(o.get("storyboard")))
            if not os.path.isfile(sb_path):
                raise ValueError(f"{where}: 案「{name}」の台本がない（{o.get('storyboard')}）")
            with open(sb_path, encoding="utf-8") as f:
                osb = json.load(f)
            frames_dir = os.path.join(base, str(o.get("frames")))
            try:
                frames = _load_frames(frames_dir, osb, sb_path)
            except OSError:
                raise ValueError(f"{where}: 案「{name}」のコマがない（{o.get('frames')}/frames.json）。frames.cjs を回す")
            except ValueError as e:
                raise ValueError(f"{where}: 案「{name}」: {e}")
            osl = o.get("slides")
            if osl is None:
                osl = [{"id": sid} for sid in reps]
            if not isinstance(osl, list) or not osl or any(not isinstance(x, dict) or not isinstance(x.get("id"), str) for x in osl):
                raise ValueError(f"{where}: 案「{name}」の slides は、id を持つオブジェクトの列で書く")
            for x in osl:
                for k in ("intent", "link"):
                    if k in x and not isinstance(x[k], str):
                        raise ValueError(f"{where}: 案「{name}」のスライド「{x['id']}」の {k} は文字列で書く（構成メモの項目の形ではなく、文だけ）")
                if x["id"] not in (osb.get("slides") or {}):
                    raise ValueError(f"{where}: スライド「{x['id']}」が、案「{name}」の台本にない")
            # 案のスライドを使う場面のコマが、全部そろっていること（欠けたまま並べると、空の段になる）
            have = {ln.get("id") for ln in frames["lines"]}
            ids = [x["id"] for x in osl]
            for sc in osb.get("scenes") or []:
                if sc.get("slide") in ids and any(ln.get("id") not in have for ln in sc.get("lines") or []):
                    raise ValueError(f"{where}: 案「{name}」のコマがない（場面「{sc.get('id')}」）。alts.py frames を回す")
            options.append({"name": name, "diff": o.get("diff") if isinstance(o.get("diff"), str) else "", "storyboard": osb,
                            "frames_dir": frames_dir, "frames": frames, "slides": osl})
        out.append({"id": gid, "replaces": list(reps), "scenes": [storyboard["scenes"][i]["id"] for i in idx], "options": options})
    return out


def _alts_block(group, intents):
    """案の段: 案ごとに、名前・違いの 1 行・案のスライド（完成形と意図）・その場面の行"""
    out = ['<div class="us-alts">']
    for o in group["options"]:
        osb, fdir = o["storyboard"], o["frames_dir"]
        finals = {sl["id"]: sl for sl in o["frames"].get("slides") or [] if isinstance(sl, dict) and sl.get("id") and sl.get("svg")}
        own = {x["id"]: {"intent": x.get("intent") if "intent" in x else (intents.get(x["id"]) or {}).get("intent"),
                         "link": x.get("link") if ("intent" in x or "link" in x) else (intents.get(x["id"]) or {}).get("link")} for x in o["slides"]}
        out.append(f'<div class="us-alt"><h3>{esc(o["name"])}</h3>')
        if o["diff"]:
            out.append(f'<p class="us-diff">{esc(o["diff"])}</p>')
        ids, done = [x["id"] for x in o["slides"]], set()
        for sc in osb["scenes"]:
            if sc.get("slide") not in ids:
                continue
            if sc["slide"] not in done and sc["slide"] in finals:
                done.add(sc["slide"])
                out.append(_slide_block(osb, fdir, finals[sc["slide"]], own, tag="h4"))
            out.extend(_row(ln, fdir) for ln in o["frames"]["lines"] if ln.get("scene") == sc["id"])
        out.append("</div>")
    out.append("</div><!--/us-alts-->")
    return "".join(out)


def _row(line, frames_dir):
    data = _data(frames_dir, line["svg"])
    ref = f"{line['scene']} / {line['id']} @{_clock(line['start'])}"
    return (f'<div class="us-row"><img src="data:image/svg+xml;base64,{data}" alt="{esc(ref)} のコマ" loading="lazy">'
            f'<div><p class="us-ref">{esc(ref)}</p><p class="us-sub">{esc(line["text"])}</p></div></div>')


def play_data(storyboard, sb_path, theme, timeline=None):
    """再生に埋め込むデータ（台本・テーマ・時刻表・画像）。build_player.py と同じ約束で読む。
    時刻表が今の台本のものでなければ、画像を読めなければ ValueError"""
    stale = build_player.stale_voice(storyboard, timeline) if timeline else []
    if stale:
        raise ValueError("音声が古い（tts.py をもう一度実行する）: " + " / ".join(stale))
    import uz_assets
    try:
        assets = uz_assets.load_assets(sb_path, storyboard)
    except uz_assets.AssetError as e:
        raise ValueError(str(e))
    return {"storyboard": storyboard, "theme": theme, "timeline": timeline, "assets": assets or {}}


def _play_scripts(data):
    """再生領域を動かすスクリプト（ELK・CORE・データ・再生の順）"""
    elk, core = build_player.engine_scripts()
    return (f"<script>\n{elk}\n</script>\n<script>\n{core}\n</script>\n"
            f'<script type="application/json" id="us-data">{build_player.safe_json(data)}</script>\n'
            f"<script>{PLAY_JS}</script>")


def build(storyboard, frames_dir, outline=None, artifact=False, alts=None, sb_path=None, play=None):
    """スライドコンテのページの HTML を返す。frames.json やコマの SVG がなければ OSError、形が違えば ValueError。
    play（play_data の戻り値）を渡すと、章ごとに再生ボタンを置き、エンジンとデータを埋め込む"""
    frames = _load_frames(frames_dir, storyboard, sb_path)
    lines = frames["lines"]
    title = storyboard.get("title") or "動く図解"
    body = [f'<h1>{esc(title)}</h1>']
    # 意図（3 段の意図の形の構成メモだけ。前の形 /1 では、章の題とコマと原稿だけを出す）
    v2 = outline is not None and check_outline.version(outline) == 2
    intents = check_outline.slide_intents(outline) if v2 else {}
    och = {c["id"]: c for c in (outline or {}).get("chapters") or [] if isinstance(c, dict) and isinstance(c.get("id"), str)} if v2 else {}
    flow = _item_text(outline.get("flow")) if v2 else None
    finals = {sl["id"]: sl for sl in frames.get("slides") or [] if isinstance(sl, dict) and sl.get("id") and sl.get("svg")}
    scene_slide = {sc["id"]: sc.get("slide") for sc in storyboard["scenes"]}
    first_ch = next(iter(och), None)   # 構成メモで最初の章
    done, seen_ch = set(), set()
    # 案の組が置き換える場面: 最初の場面の位置に案の段を出し、今の台本の段（スライドの段と行の段）は出さない
    alt_at, alt_skip = {}, set()
    for g in alts or []:
        alt_at[g["scenes"][0]] = g
        alt_skip.update(g["scenes"])
    player_at = None   # 再生領域を最初に置く場所（最初の章の再生ボタンの直後。押すまで隠しておく）
    for ch in chapters(storyboard, outline):
        parts = []
        for sid in ch["scenes"]:
            if sid in alt_at:
                parts.append(_alts_block(alt_at[sid], intents))
            if sid in alt_skip:
                continue
            rows = [_row(ln, frames_dir) for ln in lines if ln.get("scene") == sid]
            if not rows:
                continue
            slide = scene_slide.get(sid)
            if slide is not None and slide not in done and slide in finals:   # 完成形と意図は、最初に使う場面の位置に 1 回だけ
                done.add(slide)
                parts.append(_slide_block(storyboard, frames_dir, finals[slide], intents))
            parts.extend(rows)
        if not parts:
            continue
        # 章の意図とつながりは、その章が最初に出るところに 1 回だけ（場面が離れた章は、2 回目から見出しだけ）。
        # 章の順番の意図は、構成メモで最初の章の前に出す（一部の場面だけのページで、最初の章が出ていなければ出さない）
        c = och.get(ch["id"]) if ch["id"] not in seen_ch else None
        seen_ch.add(ch["id"])
        if c and ch["id"] == first_ch and flow:
            body.append(f'<p class="us-flow">章の順番: {esc(flow)}</p>')
        body.append(f'<section class="us-chapter"><h2>{esc(ch["title"])}</h2>')
        if c and ch["id"] != first_ch and _item_text(c.get("link")):
            body.append(f'<p class="us-link">前の章から: {esc(_item_text(c["link"]))}</p>')
        if c and _item_text(c.get("intent")):
            body.append(f'<p class="us-intent">{esc(_item_text(c["intent"]))}</p>')
        if play is not None:
            body.append(f'<button type="button" class="us-play" data-from="{esc(ch["scenes"][0])}" data-to="{esc(ch["scenes"][-1])}" aria-pressed="false">この章を再生</button>')
            if player_at is None:
                player_at = len(body)
                body.append('<div class="us-player" id="us-player" hidden><svg id="us-stage" role="img" aria-label="再生"></svg>'
                            '<p id="us-play-err" hidden></p></div>')
        body.extend(parts)
        body.append("</section>")
    head = f"<title>{esc(title)} スライドコンテ</title>\n<style>{STYLE}</style>"
    main = '<div class="us-wrap">\n' + "\n".join(body) + "\n</div>"
    if play is not None and player_at is not None:
        main += "\n" + _play_scripts(play)
    if artifact:
        return head + "\n" + main + "\n"
    return ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f"{head}\n</head>\n<body>\n{main}\n</body>\n</html>\n")


def play_theme(sb_path, given, drawn):
    """再生のテーマ。コマを書いたテーマ（frames.json の theme）を既定にし、--theme か構成メモの見た目がそれと違えば ValueError。
    theme のない前の版の frames.json では、構成メモ → --theme → koo の順に決める"""
    if not isinstance(drawn, str) or not drawn:
        return build_player.pick_theme(sb_path, given, who="build_sheet")
    want = build_player.theme_id(drawn)
    if not want:
        raise ValueError(f"コマを書いたテーマ（frames.json の theme = {drawn}）が見つからない。テーマを置き直すか、frames.cjs を回し直す")
    if given and build_player.theme_id(given) != want:
        raise ValueError(f"--theme {given} が、コマを書いたテーマ（frames.json の theme = {drawn}）と違う。"
                         "--theme を外すか、そのテーマで frames.cjs を回し直す")
    dec = build_player.decided_theme(sb_path)
    if dec and build_player.theme_id(dec[1]) != want:
        raise ValueError(f"構成メモで決めた見た目（basics.look.theme = {dec[0]}）が、コマを書いたテーマ（frames.json の theme = {drawn}）と違う。"
                         "frames.cjs を回し直す")
    return drawn


def check_timed(timed, has_timeline):
    """コマの時刻の出どころ（frames.json の timed）と、再生に使う時刻表が食い違っていれば ValueError"""
    if timed == "voice" and not has_timeline:
        raise ValueError("コマは合成した声の時刻で書いてある（frames.json の timed = voice）のに、再生に使う時刻表がない。"
                         "--voice に timeline.json のある声の出力先を渡すか、--timeline を付けずに frames.cjs を回し直す")
    if timed == "estimate" and has_timeline:
        raise ValueError("コマは文字数からの見積もりの時刻で書いてある（frames.json の timed = estimate）のに、--voice の時刻表で再生しようとした。"
                         "frames.cjs を --timeline <声の出力先>/timeline.json で回し直すか、--voice を外す")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("storyboard")
    ap.add_argument("--frames", required=True, help="frames.cjs の出力先（frames.json と svg/ がある）")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--outline")
    ap.add_argument("--alts", help="案の一覧 alts.json。置き換えるスライドの位置に、案を並べて出す（alts.py が作る）")
    ap.add_argument("--voice", help="tts.py の出力先。timeline.json があれば、再生をその時刻で流す（なければ文字数からの見積もり）")
    ap.add_argument("--theme", help="再生のテーマ。省くと、コマを書いたテーマ（frames.json の theme）。違うテーマを渡すと止まる")
    ap.add_argument("--no-play", action="store_true", help="章ごとの再生を付けない（JS を含まない軽いページ）")
    ap.add_argument("--artifact", action="store_true")
    a = ap.parse_args()   # 使い方の誤りは argparse が終了コード 2 で止める
    try:
        with open(a.storyboard, encoding="utf-8") as f:
            sb = json.load(f)
        outline = None
        if a.outline:
            with open(a.outline, encoding="utf-8") as f:
                outline = json.load(f)
            errors, _ = check_outline.check(outline)
            if errors:
                print("構成メモに誤りがある:", file=sys.stderr)
                for e in errors:
                    print("  " + e, file=sys.stderr)
                return 2
        alts = load_alts(a.alts, sb) if a.alts else None
        play = None
        if not a.no_play:
            with open(os.path.join(a.frames, "frames.json"), encoding="utf-8") as f:
                drawn = json.load(f)
            theme = build_player.load_theme(play_theme(a.storyboard, a.theme, drawn.get("theme")))
            tl_path = os.path.join(a.voice, "timeline.json") if a.voice else None
            timeline = None
            if tl_path and os.path.exists(tl_path):
                with open(tl_path, encoding="utf-8") as f:
                    timeline = json.load(f)
            check_timed(drawn.get("timed"), timeline is not None)
            play = play_data(sb, a.storyboard, theme, timeline)
        page = build(sb, a.frames, outline, a.artifact, alts, a.storyboard, play)
    except (OSError, ValueError) as e:
        print(f"スライドコンテを作れない: {e}", file=sys.stderr)
        return 2
    size = len(page.encode())
    if size > build_player.PAGE_LIMIT:
        print(f"スライドコンテを作れない: ページが 15MB を超える（{size / 1e6:.1f}MB）。--no-play で再生を外すか、画像を小さくする", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"{page.count('<img ')} コマ → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
