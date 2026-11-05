"""画面の配置を機械で検査する（意図しない表示崩れの検出）。NarratedScene が play ごとに呼ぶ。

人や画像レビューに見つけさせていた崩れのうち、座標から判定できるものをここで拾う:
  E text_out      文字が安全域（字幕帯の上・画面の内側）からはみ出している
  E text_overlap  文字どうしが重なって読めない
  W line_on_text  矢印・線が文字の上を通っている
  W text_small    画面上の実寸が小さすぎて読みにくい
  W duplicate     同じ文字が同じ位置に 2 つ重なっている（変形の後の消し忘れ。見た目では分からない）
  W line_on_box   辺・線が、端点でない箱（node() の箱）の中を貫いている
あわせて占有表（occupancy）を作る: 見えている文字・箱・画像が画面の 6×6 区画のどれを占めるか（画面レビューの評価役に渡す）。
座標は「今のカメラ枠」に対する相対で判定するので、寄り（focus）の最中も同じ基準で見られる。
暗幕（画面を覆う backdrop）がある間は、その下（z_index が低い物）を検査しない。
"""
import numpy as np
from manim import Code, ImageMobject, Line, Mobject, Rectangle, Text, MarkupText, Paragraph, config

SAFE_X = 7.0                 # 既定の枠（幅 14.22）での左右の安全域（端から約 0.1）
SAFE_TOP, SAFE_BOTTOM = 3.9, -2.5    # 上端（端から 0.1）と、字幕帯の上端
MIN_FONT = 15.5              # これ未満は読みにくい（警告。720p で表の文字 15.4 が「小さめ」と指摘された）
BACKGROUND_FONT = 12         # これ未満は「縮めた全体図」などの背景として検査しない
VISIBLE = 0.35               # これ以下の不透明度は「薄くしたもの」として重なりを問わない
OVERLAP = 0.12               # 小さい方の面積に対する重なりの割合がこれを超えたら重なりとみなす

TEXTISH = (Text, MarkupText, Paragraph, Code)
GRID = 6
GRID_DOC = "画面全体（字幕帯も含む）を縦横 6 等分した区画。r1 が上端の段、c1 が左端の列（r1c1 = 左上、r6c6 = 右下。r6 は字幕帯）"


def _opacity(m):
    vals = [f.get_fill_opacity() for f in m.get_family() if f.has_points()] or [0]
    strokes = [f.get_stroke_opacity() for f in m.get_family() if f.has_points()] or [0]
    return max(max(vals), max(strokes))


def _box(m):
    (x0, y0, _), (x1, y1, _) = m.get_corner([-1, -1, 0]), m.get_corner([1, 1, 0])
    return x0, y0, x1, y1


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _inter(a, b):
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def _collect(mobjects):
    """画面に出ている物を、文字（Text・Code）・線・暗幕・箱に分けて集める。文字の中には潜らない。
    線は Line と、折れ線の辺（explainer_kit.PathArrow。is_route の印がある）。箱は node() の箱（is_box の印）。"""
    texts, lines, backdrops, boxes = [], [], [], []
    fw, fh = config.frame_width, config.frame_height

    def walk(m):
        if isinstance(m, TEXTISH):
            texts.append(m)
            return
        if (isinstance(m, Line) or getattr(m, "is_route", False)) and m.has_points():
            lines.append(m)
            return            # 点線（DashedLine）は自身に点が無いので、下の短い線を 1 本ずつ見る
        if getattr(m, "is_box", False):
            boxes.append(m)
        if isinstance(m, Rectangle) and m.width > fw * 1.5 and m.height > fh * 1.5 \
                and m.get_fill_opacity() > 0.85:
            backdrops.append(m)
            return
        for s in m.submobjects:
            walk(s)
    for m in mobjects:
        walk(m)
    return texts, lines, backdrops, boxes


def check(scene, where):
    """今の画面を検査して問題のリストを返す。where は報告に載せる位置（行 id など）。"""
    frame = scene.camera.frame
    scale = frame.width / config.frame_width          # 寄っているほど小さい
    cx, cy = frame.get_center()[0], frame.get_center()[1]
    safe = (cx - SAFE_X * scale, cy + SAFE_BOTTOM * scale, cx + SAFE_X * scale, cy + SAFE_TOP * scale)

    texts, lines, backdrops, boxes = _collect(scene.mobjects)
    floor = max((b.z_index for b in backdrops if _opacity(b) > 0.85), default=None)

    def shown(m):
        return _opacity(m) > VISIBLE and (floor is None or m.z_index > floor)

    texts = [t for t in texts if shown(t) and t.width > 0]
    lines = [l for l in lines if shown(l)]
    boxes = [b for b in boxes if shown(b) and b.width / scale > 0.5]   # 縮めた全体図（mini）の箱は数えない
    issues = []

    def label(m):
        s = getattr(m, "text", None) or getattr(m, "original_text", None) or type(m).__name__
        return str(s).replace("\n", " ")[:24]

    sized = []
    for t in texts:
        fs = getattr(t, "font_size", None)
        eff = fs / scale if isinstance(fs, (int, float)) else None
        if eff is not None and eff < BACKGROUND_FONT:
            continue                      # 縮めた全体図などの背景
        sized.append(t)
        b = _box(t)
        if b[0] < safe[0] - 1e-3 or b[2] > safe[2] + 1e-3 or b[1] < safe[1] - 1e-3 or b[3] > safe[3] + 1e-3:
            issues.append(("E", "text_out", f"「{label(t)}」が安全域の外"))
        if eff is not None and eff < MIN_FONT:
            issues.append(("W", "text_small", f"「{label(t)}」の実寸 {eff:.0f}（{MIN_FONT} 未満）"))

    for i, a in enumerate(sized):
        ba = _box(a)
        for b in sized[i + 1:]:
            bb = _box(b)
            inter = _area(_inter(ba, bb))
            ratio = inter / max(1e-6, min(_area(ba), _area(bb))) if inter else 0
            if ratio > 0.9 and label(a) == label(b):
                issues.append(("W", "duplicate", f"「{label(a)}」が同じ位置に 2 つある（変形の後の消し忘れ）"))
            elif ratio > OVERLAP:
                issues.append(("E", "text_overlap", f"「{label(a)}」と「{label(b)}」が重なる"))

    for l in lines:
        pts = [l.point_from_proportion(p) for p in np.linspace(0.05, 0.95, 19)]
        for t in sized:
            x0, y0, x1, y1 = _box(t)
            mx, my = (x1 - x0) * 0.12, (y1 - y0) * 0.2
            hits = sum(1 for p in pts if x0 + mx < p[0] < x1 - mx and y0 + my < p[1] < y1 - my)
            if hits >= 2:
                issues.append(("W", "line_on_text", f"線が「{label(t)}」の上を通る"))
        # 箱の内側（縁から 0.08 内側）に入る線は、その箱を端点にしていない（辺の端は箱の縁で止まる）
        for b in boxes:
            x0, y0, x1, y1 = _box(b)
            m = 0.08 * scale
            hits = sum(1 for p in pts if x0 + m < p[0] < x1 - m and y0 + m < p[1] < y1 - m)
            if hits >= 2:
                issues.append(("W", "line_on_box", f"線が箱「{getattr(b, 'ev_name', '?')}」を貫く"))
    return [{"where": where, "level": lv, "kind": k, "detail": d} for lv, k, d in issues]


def _cells(b):
    """外接矩形 b が重なる区画の名前（r1c1 …）。"""
    fw, fh = config.frame_width, config.frame_height
    cw, ch = fw / GRID, fh / GRID
    c0 = min(GRID - 1, max(0, int((b[0] + fw / 2) // cw)))
    c1 = min(GRID - 1, max(0, int((b[2] + fw / 2 - 1e-6) // cw)))
    r0 = min(GRID - 1, max(0, int((fh / 2 - b[3]) // ch)))
    r1 = min(GRID - 1, max(0, int((fh / 2 - b[1] - 1e-6) // ch)))
    return [f"r{r + 1}c{c + 1}" for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


def occupancy(scene, who=None):
    """今の画面で見えている文字・箱・画像が、画面の 6×6 区画のどれを占めるか。who(mob) は要素の id（登録簿）を返す。
    暗幕がある間は暗幕より上の物だけを載せる。寄り（カメラの移動）は考えない（解釈器はカメラを動かさない）。"""
    items = []
    backdrops = _collect(scene.mobjects)[2]
    floor = max((b.z_index for b in backdrops if _opacity(b) > 0.85), default=None)

    def walk(m, out):
        if m in backdrops:
            return
        if isinstance(m, TEXTISH):
            out.append(("text", m))
            return
        if isinstance(m, ImageMobject):
            out.append(("image", m))
            return
        if getattr(m, "is_box", False) or (isinstance(m, Rectangle) and m.width < 20 and m.has_points()):
            out.append(("box", m))
        for s in m.submobjects:
            walk(s, out)
    found = []
    for m in scene.mobjects:
        walk(m, found)
    for kind, m in found:
        if kind != "image" and _opacity(m) <= VISIBLE:
            continue
        if floor is not None and m.z_index <= floor:
            continue
        if m.width <= 0:
            continue
        b = _box(m)
        if kind == "text":
            s = getattr(m, "text", None) or getattr(m, "original_text", None) or "コード"
            lab = str(s).replace("\n", " ")[:24]
        else:
            lab = getattr(m, "ev_name", None) or ("画像" if kind == "image" else "")
        item = {"kind": kind, "label": lab, "cells": _cells(b)}
        if who is not None:
            eid = who(m)
            if eid:
                item["id"] = eid
        items.append(item)
    return items
