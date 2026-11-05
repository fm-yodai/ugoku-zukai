"""色の小道具（extract_design.py と check_theme.py で共有）。WCAG のコントラスト比と CIE76 の色差。"""
import colorsys
import math
import re

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
RGB_RE = re.compile(r"rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)")
HSL_RE = re.compile(r"hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)")


def parse(c):
    """'#abc' / '#aabbcc' / 'rgb()' / 'hsl()' → (r, g, b) 0-255。読めなければ None。透明に近い色も None"""
    c = str(c).strip()
    m = HEX_RE.fullmatch(c)
    if m:
        h = c[1:]
        if len(h) in (3, 4):
            h = "".join(x * 2 for x in h)
        if len(h) == 8 and int(h[6:], 16) < 128:
            return None
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = RGB_RE.fullmatch(c)
    if m:
        if m.group(4):
            a = m.group(4)
            a = float(a[:-1]) / 100 if a.endswith("%") else float(a)
            if a < 0.5:
                return None
        return tuple(min(255, int(m.group(i))) for i in (1, 2, 3))
    m = HSL_RE.fullmatch(c)
    if m:
        h, s, l = float(m.group(1)) / 360, float(m.group(2)) / 100, float(m.group(3)) / 100
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return (round(r * 255), round(g * 255), round(b * 255))
    return None


def find_all(text):
    """文中の色の表記をすべて拾う → [(表記, (r,g,b))]"""
    out = []
    for rx in (HEX_RE, RGB_RE, HSL_RE):
        for m in rx.finditer(text):
            rgb = parse(m.group(0))
            if rgb:
                out.append((m.group(0), rgb))
    return out


def hexs(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in rgb)


def lum(rgb):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def hls(rgb):
    return colorsys.rgb_to_hls(*(v / 255 for v in rgb))


def from_hls(h, l, s):
    return tuple(round(v * 255) for v in colorsys.hls_to_rgb(h % 1, max(0, min(1, l)), max(0, min(1, s))))


def saturation(rgb):
    return hls(rgb)[2] if 0.06 < hls(rgb)[1] < 0.94 else 0


def mix(a, b, p):
    return tuple(a[i] + (b[i] - a[i]) * p for i in range(3))


def lab(rgb):
    def f(v):
        v /= 255
        return ((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92
    r, g, b = (f(v) for v in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722)
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def g_(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = g_(x), g_(y), g_(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    return math.dist(lab(a), lab(b))


def ensure_contrast(c, bg, target):
    """c の色相を保ったまま、bg とのコントラストが target 以上になるまで明るさを動かす"""
    if contrast(c, bg) >= target:
        return c
    h, l, s = hls(c)
    step = -0.02 if lum(bg) > 0.4 else 0.02
    for _ in range(60):
        l += step
        c2 = from_hls(h, l, s)
        if contrast(c2, bg) >= target:
            return c2
    return (0, 0, 0) if lum(bg) > 0.4 else (255, 255, 255)
