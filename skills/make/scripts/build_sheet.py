#!/usr/bin/env python3
"""利用者向けの絵コンテのページ（HTML 1 枚）を作る。frames.cjs が書いたコマを、章ごと・行ごとに字幕と並べる。

  python3 build_sheet.py <storyboard.json> --frames <frames.cjs の出力先> -o <sheet.html> [--outline <outline.json>] [--artifact]

- 行ごとに 1 段。左にコマ、右に「s2 / l2 @0:14」（場面の id / 行の id @行の始まりの時刻）と字幕の全文
- 章の見出し: --outline があり場面に chapter があれば構成メモの章の題（下に、その章の「言うこと」）。
  なければ再生ページのチャプター一覧と同じ（場面の title、図が 1 つならその図の title、title 型の図は「はじめに」）
- frames.json にない行（frames.cjs --scenes で一部だけ書いたとき）は出さない。行が 1 つもない章は見出しごと出さない
- --outline があれば、終わりに「Claude が決めたこと」（構成メモの state: proposed の項目）を一覧にする
- --artifact: Artifact で公開する形（<html>・<head>・<body> を外した断片）で書く
- コマは SVG を data: の画像として埋め込む。外部のファイルは読まず、JS も使わない。PNG（resvg）は要らない

- コマが今の台本のものでない（台本を直した後に frames.cjs を回し直していない、別の台本のコマ）ときは、書かずに止まる

終了コード: 0 = 書けた、2 = 使い方の誤りか、frames.json・コマの SVG がないか、コマが今の台本のものでない。
"""
import argparse
import base64
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_outline  # noqa: E402

STYLE = """
  :root { --page: #f4f5f7; --panel: #ffffff; --ink: #1d2433; --muted: #5d6676; --line: #d3d8e0; --accent: #1a5fd0; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #121418; --panel: #1a1d23; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; color-scheme: dark; } }
  :root[data-theme="dark"] { --page: #121418; --panel: #1a1d23; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; color-scheme: dark; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.7 "Noto Sans JP", system-ui, sans-serif;
         padding-block: 20px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .us-wrap { max-width: 1040px; margin: 0 auto; }
  .us-wrap h1 { font-size: 22px; line-height: 1.4; margin: 0 0 4px; overflow-wrap: anywhere; }
  .us-note { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .us-chapter { margin-top: 32px; }
  .us-chapter h2, .us-decided h2 { font-size: 17px; line-height: 1.5; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid var(--line); overflow-wrap: anywhere; }
  .us-says { margin: 0 0 12px; padding-left: 1.4em; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
  .us-row { display: grid; grid-template-columns: minmax(0, 58%) minmax(0, 1fr); gap: 16px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .us-row img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
  .us-ref { margin: 0 0 4px; font: 13px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: var(--accent); font-variant-numeric: tabular-nums; }
  .us-sub { margin: 0; overflow-wrap: anywhere; }
  .us-decided { margin-top: 40px; }
  .us-decided dl { margin: 0; }
  .us-decided dt { font-weight: 700; font-size: 14px; margin-top: 10px; overflow-wrap: anywhere; }
  .us-decided dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 640px) { .us-row { grid-template-columns: minmax(0, 1fr); gap: 8px; } }
"""

esc = html.escape  # & < > " ' をすべて置き換える


def _scene_title(storyboard, sc):
    """場面の題。再生ページのチャプター一覧と同じ決め方（題がなければ空文字）"""
    if sc.get("title"):
        return sc["title"]
    figs = sc.get("figure")
    figs = figs if isinstance(figs, list) else [figs]
    if len(figs) != 1:
        return ""
    fig = (storyboard.get("figures") or {}).get(figs[0]) or {}
    return "はじめに" if fig.get("type") == "title" else (fig.get("title") or "")


def chapters(storyboard, outline=None):
    """場面を章にまとめる。戻り値: [{"title": 章の見出し, "says": [その章で言うこと…], "scenes": [場面の id…]}]

    構成メモがあり場面に chapter があれば構成メモの章、それ以外は場面や図の題でまとめる。
    同じ章が続けば 1 つにまとめ、題のない場面は直前の章に入れる。"""
    by_id = {}
    for c in (outline or {}).get("chapters") or []:
        if isinstance(c, dict) and isinstance(c.get("id"), str):
            by_id[c["id"]] = c
    out, keys = [], []
    for sc in storyboard["scenes"]:
        och = by_id.get(sc["chapter"]) if isinstance(sc.get("chapter"), str) else None
        if och:
            key, title = ("outline", och["id"]), och.get("title") or och["id"]
            says = [s["text"] for s in och.get("says") or [] if isinstance(s, dict) and isinstance(s.get("text"), str)]
        else:
            title, says = _scene_title(storyboard, sc), []
            if not title and out:
                out[-1]["scenes"].append(sc["id"])
                continue
            title = title or "はじめに"
            key = ("scene", title)
        if keys and keys[-1] == key:
            out[-1]["scenes"].append(sc["id"])
        else:
            out.append({"title": title, "says": says, "scenes": [sc["id"]]})
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


def _row(line, frames_dir):
    with open(os.path.join(frames_dir, line["svg"]), "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    ref = f"{line['scene']} / {line['id']} @{_clock(line['start'])}"
    return (f'<div class="us-row"><img src="data:image/svg+xml;base64,{data}" alt="{esc(ref)} のコマ" loading="lazy">'
            f'<div><p class="us-ref">{esc(ref)}</p><p class="us-sub">{esc(line["text"])}</p></div></div>')


def build(storyboard, frames_dir, outline=None, artifact=False):
    """絵コンテのページの HTML を返す。frames.json やコマの SVG がなければ OSError、形が違えば ValueError"""
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
    title = storyboard.get("title") or "動く図解"
    body = [f'<h1>{esc(title)}</h1>', '<p class="us-note">絵コンテ（声なし。時刻は見積もり）</p>']
    for ch in chapters(storyboard, outline):
        rows = [_row(ln, frames_dir) for ln in lines if ln.get("scene") in ch["scenes"]]
        if not rows:
            continue
        body.append(f'<section class="us-chapter"><h2>{esc(ch["title"])}</h2>')
        if ch["says"]:
            body.append('<ul class="us-says">' + "".join(f"<li>{esc(s)}</li>" for s in ch["says"]) + "</ul>")
        body.extend(rows)
        body.append("</section>")
    proposed = check_outline.proposed_items(outline) if outline else []
    if proposed:
        body.append('<section class="us-decided"><h2>Claude が決めたこと</h2>'
                    '<p class="us-note">まだ確認していただいていない項目です。直したいものがあれば、項目の名前で教えてください。</p><dl>')
        body.extend(f'<dt>{esc(p["label"])}</dt><dd>{esc(p["text"])}</dd>' for p in proposed)
        body.append("</dl></section>")
    head = f"<title>{esc(title)} 絵コンテ</title>\n<style>{STYLE}</style>"
    main = '<div class="us-wrap">\n' + "\n".join(body) + "\n</div>"
    if artifact:
        return head + "\n" + main + "\n"
    return ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f"{head}\n</head>\n<body>\n{main}\n</body>\n</html>\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("storyboard")
    ap.add_argument("--frames", required=True, help="frames.cjs の出力先（frames.json と svg/ がある）")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--outline")
    ap.add_argument("--artifact", action="store_true")
    a = ap.parse_args()   # 使い方の誤りは argparse が終了コード 2 で止める
    try:
        with open(a.storyboard, encoding="utf-8") as f:
            sb = json.load(f)
        outline = None
        if a.outline:
            with open(a.outline, encoding="utf-8") as f:
                outline = json.load(f)
        page = build(sb, a.frames, outline, a.artifact)
    except (OSError, ValueError) as e:
        print(f"絵コンテを作れない: {e}", file=sys.stderr)
        return 2
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"{page.count('<img ')} コマ → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
