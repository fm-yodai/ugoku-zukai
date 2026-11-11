#!/usr/bin/env python3
"""台本・テーマ・（あれば）時刻表と音声を、再生ページの HTML 1 枚にまとめる。

使い方:
  python3 build_player.py storyboard.json -o out.html [--theme 3b1b|flat|theme.json]
                          [--timeline timeline.json] [--audio narration.mp3] [--voice WORKDIR] [--artifact]

- 時刻表がなければ、プレーヤーが文字数から時刻を見積もる（音声なしの下見）
- 時刻表が今の台本のものでなければ（合成した後に、文を変えた・行を足した・行を消した）、「音声が古い」と出して
  ページを書かずに終了コード 1 で止まる。tts.py をもう一度実行する
- 再生ページには図の下（広い画面では右）にチャプター一覧を出す。題は場面の title か図の title
- --artifact: Artifact で公開する形（<html>・<head>・<body> を外した断片）で書く
- elkjs とプレーヤーの JS は HTML に埋め込む（CDN を読めない環境でも動くように）
"""
import argparse
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLAYER = os.path.join(os.path.dirname(HERE), "player")
CORE = ["util.js", "figures.js", "figures2.js", "validate.js", "engine.js", "check.js", "view_svg.js"]


def load_theme(name):
    path = name if os.path.exists(name) else os.path.join(PLAYER, "themes", f"{name}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def core_js():
    return "\n".join(open(os.path.join(PLAYER, "src", f), encoding="utf-8").read() for f in CORE)


def elk_js():
    return open(os.path.join(PLAYER, "vendor", "elk.bundled.js"), encoding="utf-8").read()


def safe_json(obj):
    # </script> を閉じないよう < をエスケープする
    return json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c")


def stale_voice(storyboard, timeline):
    """合成した後に台本が変わっていれば、その説明の列を返す（文を変えた・行を足した・行を消した）。変わっていなければ空"""
    sys.path.insert(0, HERE)
    from tts import parse_marks   # 時刻表の text は、tts.py が印を外して書いた文。同じ関数で比べる
    want = {}
    for sc in storyboard.get("scenes") or []:
        for ln in sc.get("lines") or []:
            want[ln.get("id")] = parse_marks(ln.get("read") or ln.get("text") or "")[0]
    have = {ln.get("id"): ln for ln in timeline.get("lines") or []}
    out = []
    for i, text in want.items():
        if i not in have:
            out.append(f"行 {i}: 時刻表にない（合成した後に足した行）")
        elif have[i].get("text") is not None and have[i]["text"] != text:   # text のない時刻表（手で書いたもの）は id だけを比べる
            out.append(f"行 {i}: 合成した後に文が変わった")
    out += [f"行 {i}: 時刻表にあるが台本にない（合成した後に消した行）" for i in have if i not in want]
    return out


def theme_id(p):
    """同梱のテーマは名前、それ以外は実体のパスで比べる"""
    builtin = os.path.join(PLAYER, "themes", f"{p}.json")
    if not os.path.exists(p):
        return f"同梱:{p}" if os.path.exists(builtin) else None
    real = os.path.realpath(p)
    if os.path.dirname(real) == os.path.realpath(os.path.join(PLAYER, "themes")):
        return "同梱:" + os.path.splitext(os.path.basename(real))[0]
    return real


def pick_theme(storyboard_path, given):
    """台本と同じフォルダの構成メモが見た目を決めていたら（basics.look.theme）、そのテーマを返す。
    違うテーマを渡されたら止まる（uz_node.cjs の pickTheme と同じ約束）"""
    wd = os.path.dirname(os.path.abspath(storyboard_path))
    try:
        with open(os.path.join(wd, "outline.json"), encoding="utf-8") as f:
            look = json.load(f)["basics"]["look"]["theme"]
    except (OSError, ValueError, KeyError, TypeError):
        look = None
    if not isinstance(look, str) or not look.strip():
        return given or "3b1b"
    path = os.path.join(wd, look) if os.path.exists(os.path.join(wd, look)) else look
    want = theme_id(path)
    msg = None
    if not want:
        msg = f"構成メモの見た目（basics.look.theme = {look}）のテーマが見つからない。テーマを作るか、構成メモを直す"
    elif given and theme_id(given) != want:
        msg = (f"--theme {given} が、構成メモで決めた見た目（basics.look.theme = {look}）と違う。"
               "--theme を外すか合わせる。見た目を変えるなら、利用者と決めて構成メモを先に直す")
    if msg:
        print("build_player: " + msg, file=sys.stderr)
        sys.exit(2)
    return path


def build(storyboard, theme, timeline=None, audio_b64=None, artifact=False):
    tpl = open(os.path.join(PLAYER, "template.html"), encoding="utf-8").read()
    title = storyboard.get("title", "動く図解")
    font_link = f'<link rel="stylesheet" href="{theme["font"]["css"]}">' if theme.get("font", {}).get("css") else ""
    data = {"storyboard": storyboard, "theme": theme, "timeline": timeline, "audio": audio_b64}
    esc = title.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    html = tpl.replace("__TITLE__", esc).replace("__FONT_LINK__", font_link)
    # 置換文字列にバックスラッシュが含まれても壊れないよう、関数で置き換える
    html = html.replace("/*UZ:ELK*/", "\n" + elk_js().replace("</script", "<\\/script") + "\n")
    html = html.replace("/*UZ:CORE*/", "\n" + core_js() + "\n")
    html = html.replace("/*UZ:DATA*/null", safe_json(data))
    if artifact:
        head = html[html.index("<!--UZ:HEAD-->") + len("<!--UZ:HEAD-->"):html.index("<!--UZ:HEAD_END-->")]
        body = html[html.index("<!--UZ:BODY-->") + len("<!--UZ:BODY-->"):html.index("<!--UZ:BODY_END-->")]
        html = head.strip() + "\n" + body.strip() + "\n"
    return html


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("storyboard")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--theme", help="省くと、構成メモが決めたテーマ（なければ 3b1b）")
    ap.add_argument("--timeline")
    ap.add_argument("--audio")
    ap.add_argument("--voice", help="tts.py の出力先。timeline.json と narration.mp3（か .wav）をまとめて読む")
    ap.add_argument("--artifact", action="store_true")
    a = ap.parse_args()
    sb = json.load(open(a.storyboard, encoding="utf-8"))
    a.theme = pick_theme(a.storyboard, a.theme)
    if a.voice:
        a.timeline = a.timeline or os.path.join(a.voice, "timeline.json")
        a.audio = a.audio or next((p for p in (os.path.join(a.voice, "narration.mp3"), os.path.join(a.voice, "narration.wav")) if os.path.exists(p)), None)
    tl = json.load(open(a.timeline, encoding="utf-8")) if a.timeline else None
    stale = stale_voice(sb, tl) if tl else []
    if stale:
        print("build_player: 音声が古い。tts.py をもう一度実行してから組み立てる\n  " + "\n  ".join(stale), file=sys.stderr)
        sys.exit(1)
    au = base64.b64encode(open(a.audio, "rb").read()).decode() if a.audio else None
    html = build(sb, load_theme(a.theme), tl, au, a.artifact)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{a.out}（{len(html.encode()) / 1e6:.1f}MB）")


if __name__ == "__main__":
    sys.exit(main())
