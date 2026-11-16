#!/usr/bin/env python3
"""台本の画像の部品（type: "image"）のファイルを読み、大きさと data URI を返す。
python 側（build_player.py が使う）。node 側は assets.cjs。2 つを同じ約束に保つ。
読めるのは PNG・JPEG・SVG。src は台本のあるフォルダからの相対パスで、その外には出られない"""
import base64
import os
import re
import struct

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


class AssetError(Exception):
    pass


def image_srcs(sb):
    out = []

    def add(f):
        if isinstance(f, dict) and f.get("type") == "image" and isinstance(f.get("src"), str) and f["src"] not in out:
            out.append(f["src"])
    for f in ((sb or {}).get("figures") or {}).values():
        add(f)
    for sl in ((sb or {}).get("slides") or {}).values():
        for p in (sl.get("parts") if isinstance(sl, dict) and isinstance(sl.get("parts"), list) else []):
            add(p)
    return out


def _fail(src, why):
    return AssetError(f"画像「{src}」が読めない（{why}）。PNG・JPEG・SVG を、台本と同じフォルダの下に置く")


def _size(buf, mime):
    if mime == "image/png":
        if len(buf) < 24 or buf[:4] != b"\x89PNG":
            return None
        return struct.unpack(">II", buf[16:24])
    if mime == "image/jpeg":
        if len(buf) < 4 or buf[:2] != b"\xff\xd8":
            return None
        i = 2
        while i + 9 < len(buf):
            if buf[i] != 0xff:
                return None
            m = buf[i + 1]
            if m == 0xff:
                i += 1
                continue
            if 0xc0 <= m <= 0xcf and m not in (0xc4, 0xc8, 0xcc):
                h, w = struct.unpack(">HH", buf[i + 5:i + 9])
                return (w, h)
            i += 2 + struct.unpack(">H", buf[i + 2:i + 4])[0]
        return None
    head = re.search(r"<svg\b[^>]*>", buf.decode("utf-8", "replace"))
    if not head:
        return None
    vb = re.search(r"""\bviewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)\s*["']""", head.group(0), re.ASCII)
    if vb:
        try:   # assets.cjs の parseFloat と同じく、読めなければ「大きさを読み取れない」
            return (float(vb.group(1)), float(vb.group(2)))
        except ValueError:
            return None
    w = re.search(r"""\bwidth\s*=\s*["']([\d.]+)(px)?["']""", head.group(0))
    h = re.search(r"""\bheight\s*=\s*["']([\d.]+)(px)?["']""", head.group(0))
    return (float(w.group(1)), float(h.group(1))) if w and h else None


def _num(x):
    return int(x) if float(x) == int(x) else float(x)


def load_assets(storyboard_path, sb):
    base = os.path.dirname(os.path.abspath(storyboard_path))
    out = {}
    for src in image_srcs(sb):
        mime = MIME.get(os.path.splitext(src)[1].lower())
        if os.path.isabs(src) or ".." in re.split(r"[\\/]", src):
            raise _fail(src, "台本のフォルダの外を指している")
        if not mime:
            raise _fail(src, "PNG・JPEG・SVG ではない")
        real = os.path.realpath(os.path.join(base, src))
        if not os.path.isfile(real):
            raise _fail(src, "ファイルがない")
        # シンボリックリンクをたどった先も、台本のフォルダの下でなければ読まない
        if os.path.commonpath([os.path.realpath(base), real]) != os.path.realpath(base):
            raise _fail(src, "台本のフォルダの外を指している")
        try:
            with open(real, "rb") as f:
                buf = f.read()
        except OSError:
            raise _fail(src, "ファイルがない")
        wh = _size(buf, mime)
        if not wh or not wh[0] > 0 or not wh[1] > 0:
            raise _fail(src, "大きさを読み取れない")
        out[src] = {"w": _num(wh[0]), "h": _num(wh[1]), "mime": mime, "data": f"data:{mime};base64,{base64.b64encode(buf).decode()}"}
    return out
