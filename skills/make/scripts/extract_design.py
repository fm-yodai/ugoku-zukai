#!/usr/bin/env python3
"""デザインの手がかり（色・文字・角丸）を、どんな入力からでも拾い、テーマの下書きを作る。

使い方:
  python3 extract_design.py 入力 [入力 ...] --report report.json [--theme theme.json] [--name brand]

入力に使えるもの（いくつでも混ぜてよい）:
  - トークンの JSON（W3C Design Tokens・Style Dictionary・Figma の変数の書き出し・claude.ai の Design System の tokens.json）
  - CSS / SCSS / HTML / SVG（CSS 変数・色の表記・font-family）
  - tailwind.config.js / ts（色の定義）
  - PowerPoint / Word / Excel（.pptx .potx .docx .dotx .xlsx。テーマの色とフォント）
  - 画像（.png .jpg .webp .gif。多い色を数える。Pillow が要る）
  - PDF（poppler の pdftoppm があれば 1 ページ目を画像にして数える）
  - Web ページの URL（HTML と、リンクされた CSS を 5 本まで読む）

出力:
  --report: 拾った色（出てきた回数・名前・出どころ）とフォントの一覧。Claude はこれを見て役割を決め直してよい
  --theme:  機械的に決めた下書きのテーマ。必ず check_theme.py で検査してから使う

画像やブランドガイドの PDF のように「名前の付いていない色」しかない入力では、下書きの役割の割り当ては推測になる。
Claude が入力を見て、背景・文字・強調の色を確かめて直すこと（references/themes.md）。
"""
import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uz_color as UC  # noqa: E402

JP_GOOGLE_FONTS = {
    "Noto Sans JP", "BIZ UDPGothic", "BIZ UDGothic", "M PLUS 1p", "M PLUS Rounded 1c", "Zen Kaku Gothic New",
    "Zen Maru Gothic", "Kosugi Maru", "Sawarabi Gothic", "IBM Plex Sans JP", "Murecho", "Noto Serif JP",
    "Shippori Mincho", "Zen Old Mincho", "Kiwi Maru", "M PLUS 2", "LINE Seed JP",
}
GENERIC = {"sans-serif", "serif", "monospace", "system-ui", "cursive", "inherit", "initial", "ui-sans-serif", "-apple-system", "blinkmacsystemfont"}
ROLE_HINTS = {
    "bg": ["page-background", "background", "bg", "surface-0", "canvas", "page", "base", "lt1", "paper"],
    "ink": ["body", "page-text", "foreground", "fg", "text", "ink", "on-background", "on-surface", "dk1", "content"],   # 本文（text-body）を見出し（text-heading）より先に採る
    "accent": ["primary", "brand", "accent", "main", "key", "accent1", "theme"],
    "muted": ["muted", "secondary-text", "subtle", "gray", "grey", "neutral", "dk2", "caption"],
    "good": ["success", "positive", "green", "ok"],
    "bad": ["danger", "error", "negative", "red", "critical", "destructive", "ng", "stop"],
    "warn": ["warning", "caution", "orange", "amber", "yellow"],
    "surface": ["surface-card", "card", "panel", "surface-1", "surface"],
}


class Bag:
    def __init__(self):
        self.colors = defaultdict(lambda: {"count": 0, "names": set(), "sources": set()})
        self.fonts = defaultdict(lambda: {"count": 0, "sources": set(), "role": set()})
        self.radii = []
        self.notes = []
        self.shadows = {"none": 0, "some": 0}   # 影のトークンの数（値が none か、それ以外か）

    def color(self, rgb, src, name=None, weight=1):
        c = self.colors[UC.hexs(rgb)]
        c["count"] += weight
        c["sources"].add(src)
        if name:
            c["names"].add(name)

    def font(self, family, src, role=None):
        for fam in split_families(family):
            f = self.fonts[fam]
            f["count"] += 1
            f["sources"].add(src)
            if role:
                f["role"].add(role)


def split_families(s):
    out = []
    for part in str(s).split(","):
        p = part.strip().strip("'\"").strip()
        if p and p.lower() not in GENERIC and not p.startswith("var(") and not p.startswith("$"):
            out.append(p)
    return out[:1]   # 先頭（第一候補）だけ


# ---------------- 入力ごとの読み取り ----------------
def read_json(data, src, bag):
    # 名前付きのトークン（{"name": "c-base", "value": "#edf0f5"}。claude.ai の Design System の tokens.json の形）は、
    # 配列の番号ではなく name で呼ぶ。別名（"{c-base}"）は、指している先の値に解く
    named = {}

    def collect(o):
        if isinstance(o, dict):
            if isinstance(o.get("name"), str) and ("value" in o or "$value" in o):
                named.setdefault(o["name"], o.get("$value", o.get("value")))
            for v in o.values():
                collect(v)
        elif isinstance(o, list):
            for v in o:
                collect(v)
    collect(data)

    def deref(v):
        for _ in range(8):
            m = re.fullmatch(r"\{([^{}]+)\}", v.strip()) if isinstance(v, str) else None
            if not m or m.group(1) not in named:
                break
            v = named[m.group(1)]
        return v

    def walk(o, path):
        if isinstance(o, dict):
            token = "$value" in o or "value" in o
            if token:
                v = deref(o.get("$value", o.get("value")))
                typ = o.get("$type", o.get("type", ""))
                own = isinstance(o.get("name"), str)
                handle(v, [o["name"]] if own else path, typ, path)
            for k, v in o.items():
                if k not in ("$value", "value") and not (token and k in ("name", "usage", "description", "$description")):
                    walk(v, path + [str(k)])
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, path + [str(i)])
        else:
            handle(o, path, "")

    def handle(v, path, typ, where=None):
        name = ".".join(path)
        full = ".".join(where or path).lower()   # 置かれている場所（type.families.jp、shadow.tokens.0 など）
        if isinstance(v, str):
            rgb = UC.parse(v)
            if "shadow" in full or "shadow" in name.lower():
                bag.shadows["none" if v.strip().lower() in ("none", "0", "") else "some"] += 1
            elif rgb:
                bag.color(rgb, src, name)
            elif typ == "fontFamily" or ("famil" in full and ("font" in full or full.startswith("type") or ".type" in full)):
                bag.font(v, src)
            elif "radius" in name.lower() or "rounded" in name.lower():
                m = re.match(r"([\d.]+)px", v)
                if m:
                    bag.radii.append(float(m.group(1)))
        elif isinstance(v, (int, float)) and ("radius" in name.lower()):
            bag.radii.append(float(v))
        elif isinstance(v, dict) and typ == "color":
            # Figma の {r,g,b,a}（0〜1）
            if all(k in v for k in "rgb"):
                bag.color(tuple(round(float(v[k]) * 255) for k in "rgb"), src, name)
        elif isinstance(v, list) and typ == "fontFamily":
            bag.font(",".join(map(str, v)), src)
    walk(data, [])


def read_css(text, src, bag):
    for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;}{]+)", text):
        for _, rgb in UC.find_all(m.group(2)):
            bag.color(rgb, src, m.group(1), weight=3)
        if "font" in m.group(1):
            bag.font(m.group(2), src)
        if "radius" in m.group(1):
            r = re.match(r"\s*([\d.]+)px", m.group(2))
            if r:
                bag.radii.append(float(r.group(1)))
    body = re.sub(r"--[\w-]+\s*:[^;}{]+", "", text)
    for rule in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
        sel = rule.group(1).strip().lower()
        page = bool(re.search(r"(^|[\s,])(html|body|:root|main)\b", sel))
        for m in re.finditer(r"(background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*([^;}{]+)", rule.group(2)):
            prop = m.group(1)
            if page:
                name = "page-background" if prop.startswith("background") else "page-text" if prop == "color" else None
            else:
                name = None   # 部品の色は名前を付けず、回数だけ数える（ヘッダーの背景を「背景」と取り違えないため）
            for _, rgb in UC.find_all(m.group(2)):
                bag.color(rgb, src, name, weight=4 if page else 1)
    for m in re.finditer(r"font-family\s*:\s*([^;}{]+)", text):
        bag.font(m.group(1), src)
    for m in re.finditer(r"border-radius\s*:\s*([\d.]+)px", text):
        bag.radii.append(float(m.group(1)))


def read_tailwind(text, src, bag):
    for m in re.finditer(r"['\"]?([\w-]+)['\"]?\s*:\s*['\"](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))['\"]", text):
        rgb = UC.parse(m.group(2))
        if rgb:
            bag.color(rgb, src, m.group(1), weight=2)
    for m in re.finditer(r"fontFamily\s*:\s*{([^}]*)}", text, re.S):
        for f in re.findall(r"\[\s*['\"]([^'\"]+)['\"]", m.group(1)):
            bag.font(f, src)


def read_office(path, src, bag):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if re.search(r"theme/theme\d*\.xml$", n)]
        if not names:
            bag.notes.append(f"{src}: テーマの XML が見つからない")
            return
        xml = z.read(sorted(names)[0]).decode("utf-8", "replace")
    for slot in ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]:
        m = re.search(rf"<a:{slot}>(.*?)</a:{slot}>", xml, re.S)
        if not m:
            continue
        c = re.search(r'srgbClr val="([0-9A-Fa-f]{6})"', m.group(1)) or re.search(r'lastClr="([0-9A-Fa-f]{6})"', m.group(1))
        if c:
            bag.color(UC.parse("#" + c.group(1)), src, slot, weight=4 if slot.startswith("accent1") or slot in ("dk1", "lt1") else 2)
    for kind in ("majorFont", "minorFont"):
        m = re.search(rf"<a:{kind}>(.*?)</a:{kind}>", xml, re.S)
        if m:
            ea = re.search(r'<a:ea typeface="([^"]+)"', m.group(1))
            la = re.search(r'<a:latin typeface="([^"]+)"', m.group(1))
            for f in (ea, la):
                if f and f.group(1):
                    bag.font(f.group(1), src, "heading" if kind == "majorFont" else "body")


def read_image(path_or_bytes, src, bag):
    try:
        from PIL import Image
    except ImportError:
        bag.notes.append(f"{src}: Pillow がないので画像の色を数えられない。Claude が画像を見て色を選ぶ")
        return
    im = Image.open(path_or_bytes if isinstance(path_or_bytes, str) else io.BytesIO(path_or_bytes)).convert("RGB")
    im.thumbnail((240, 240))
    q = im.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    total = im.width * im.height
    for count, idx in sorted(q.getcolors(), reverse=True):
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        bag.color(rgb, src, None, weight=max(1, round(count / total * 40)))


def read_pdf(path, src, bag):
    if not shutil.which("pdftoppm"):
        bag.notes.append(f"{src}: pdftoppm がないので PDF を画像にできない。Claude が PDF を読んで色とフォントを拾う")
        return
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-png", "-r", "50", "-f", "1", "-l", "3", path, os.path.join(d, "p")], check=False, capture_output=True)
        for f in sorted(os.listdir(d)):
            read_image(os.path.join(d, f), f"{src}#{f}", bag)


def fetch(url, limit=3_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": "ugoku-zukai-extract/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(limit), r.headers.get("Content-Type", "")


def read_url(url, bag):
    data, ctype = fetch(url)
    if "image" in ctype:
        return read_image(data, url, bag)
    if "json" in ctype:
        return read_json(json.loads(data.decode("utf-8", "replace")), url, bag)
    text = data.decode("utf-8", "replace")
    if "css" in ctype:
        return read_css(text, url, bag)
    read_html(text, url, bag)
    links = re.findall(r'<link[^>]+rel=["\']?stylesheet[^>]*>', text, re.I)
    hrefs = [re.search(r'href=["\']([^"\']+)', l) for l in links]
    for h in [h.group(1) for h in hrefs if h][:5]:
        u = urllib.parse.urljoin(url, h)
        if "fonts.googleapis.com" in u:
            for fam in re.findall(r"family=([^:&]+)", u):
                bag.font(urllib.parse.unquote_plus(fam), url)
            continue
        try:
            css, _ = fetch(u)
            read_css(css.decode("utf-8", "replace"), u, bag)
        except Exception as e:  # noqa: BLE001
            bag.notes.append(f"{u}: 読めなかった（{e}）")


def read_html(text, src, bag):
    for css in re.findall(r"<style[^>]*>(.*?)</style>", text, re.S | re.I):
        read_css(css, src, bag)
    for style in re.findall(r'style="([^"]+)"', text):
        read_css("x{" + style + "}", src, bag)
    m = re.search(r'<meta[^>]+name=["\']theme-color["\'][^>]+content=["\']([^"\']+)', text, re.I)
    if m and UC.parse(m.group(1)):
        bag.color(UC.parse(m.group(1)), src, "theme-color", weight=5)
    for fam in re.findall(r"fonts\.googleapis\.com/css2?\?family=([^:&\"']+)", text):
        bag.font(urllib.parse.unquote_plus(fam), src)


def read_input(inp, bag):
    if re.match(r"https?://", inp):
        return read_url(inp, bag)
    ext = os.path.splitext(inp)[1].lower()
    base = os.path.basename(inp).lower()
    if ext == ".json":
        return read_json(json.load(open(inp, encoding="utf-8")), inp, bag)
    if base.startswith("tailwind.config"):
        return read_tailwind(open(inp, encoding="utf-8").read(), inp, bag)
    if ext in (".css", ".scss", ".sass", ".less"):
        return read_css(open(inp, encoding="utf-8").read(), inp, bag)
    if ext in (".html", ".htm", ".svg"):
        return read_html(open(inp, encoding="utf-8").read(), inp, bag) if ext != ".svg" else read_css(open(inp, encoding="utf-8").read(), inp, bag)
    if ext in (".pptx", ".potx", ".docx", ".dotx", ".xlsx", ".xltx", ".thmx"):
        return read_office(inp, inp, bag)
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
        return read_image(inp, inp, bag)
    if ext == ".pdf":
        return read_pdf(inp, inp, bag)
    if ext in (".js", ".ts", ".mjs", ".cjs", ".vue", ".tsx", ".jsx"):
        text = open(inp, encoding="utf-8").read()
        read_tailwind(text, inp, bag)
        read_css(text, inp, bag)
        return
    bag.notes.append(f"{inp}: 種類がわからない（拡張子 {ext}）。テキストとして色を拾う")
    read_css(open(inp, encoding="utf-8", errors="replace").read(), inp, bag)


# ---------------- 下書きのテーマ ----------------
def hint_score(names, role):
    s = 0
    for n in names:
        ln = n.lower()
        for i, h in enumerate(ROLE_HINTS[role]):
            if ln == h:   # 名前そのものが手がかりの語（accent、background）。accent-warm のような派生より強い
                s = max(s, 20 - i * 0.5)
            elif re.search(rf"(^|[.\-_ /]){re.escape(h)}($|[.\-_ /\d])", ln):
                s = max(s, 10 - i * 0.5)
    return s


def draft_theme(bag, name):
    cols = [(UC.parse(h), v) for h, v in bag.colors.items()]
    if not cols:
        raise SystemExit("色が 1 つも拾えなかった。入力を確かめるか、Claude が色を決めてテーマを書く")
    neutral = [(c, v) for c, v in cols if UC.saturation(c) < 0.18]
    chroma = [(c, v) for c, v in cols if UC.saturation(c) >= 0.18]
    pick = lambda pool, role: max(pool, key=lambda cv: (hint_score(cv[1]["names"], role), cv[1]["count"]))[0] if pool else None  # noqa: E731

    bg_named = [cv for cv in cols if hint_score(cv[1]["names"], "bg") > 0 and (UC.saturation(cv[0]) < 0.3 or UC.lum(cv[0]) > 0.8 or UC.lum(cv[0]) < 0.03)]
    if bg_named:
        bg = pick(bg_named, "bg")
    else:
        # 名前がなければ、一番多い無彩色（極端に明るいか暗いもの）
        ext = [cv for cv in neutral if UC.lum(cv[0]) > 0.75 or UC.lum(cv[0]) < 0.04] or neutral or cols
        bg = max(ext, key=lambda cv: cv[1]["count"])[0]
    dark = UC.lum(bg) < 0.25
    ink_pool = [cv for cv in cols if UC.contrast(cv[0], bg) >= 7]
    ink_named = [cv for cv in ink_pool if hint_score(cv[1]["names"], "ink") > 0]
    ink = pick(ink_named, "ink") if ink_named else (max(ink_pool, key=lambda cv: (UC.saturation(cv[0]) < 0.2, cv[1]["count"]))[0] if ink_pool else ((236, 236, 234) if dark else (29, 36, 51)))
    muted_pool = [cv for cv in neutral if 4.5 <= UC.contrast(cv[0], bg) < 9]
    muted = pick(muted_pool, "muted") if muted_pool else UC.ensure_contrast(UC.mix(ink, bg, 0.4), bg, 4.6)
    acc_pool = [cv for cv in chroma if hint_score(cv[1]["names"], "accent") > 0] or chroma
    accent = pick(acc_pool, "accent") if acc_pool else ((88, 196, 221) if dark else (26, 95, 208))
    def fit(c, target=3.2):
        """背景とのコントラストが足りない色は、デザインにある同じ色相の色を先に探し、なければ色相を保って明るさを動かす"""
        if UC.contrast(c, bg) >= target:
            return c
        h = UC.hls(c)[0]
        made = UC.ensure_contrast(c, bg, target)
        # デザインの色を採るのは、計算で動かした色に近いときだけ（青の代わりに紺を採るような、別の色への置き換えはしない）
        alts = [d for d, _ in chroma if abs(((UC.hls(d)[0] - h + 0.5) % 1) - 0.5) <= 0.04 and UC.contrast(d, bg) >= target and UC.delta_e(d, made) <= 22]
        return min(alts, key=lambda d: UC.delta_e(d, made)) if alts else made
    accent = fit(accent, 4.6)   # 注記やラベルの文字に使うので、check_theme.py の 4.5 を満たすところまで寄せる

    def semantic(role, hue, default):
        named = [cv for cv in chroma if hint_score(cv[1]["names"], role) > 0]
        if named:
            return fit(pick(named, role))
        near = [cv for cv in chroma if abs(((UC.hls(cv[0])[0] - hue + 0.5) % 1) - 0.5) < 0.05]
        if near:
            return fit(max(near, key=lambda cv: cv[1]["count"])[0])
        return UC.ensure_contrast(default, bg, 3.2)
    good = semantic("good", 0.36, (30, 138, 76))
    bad = semantic("bad", 0.01, (201, 54, 43))
    warn = semantic("warn", 0.1, (230, 160, 0))
    # 役割の色（図の箱の色）は、デザインにある色だけで作る。強調色から始め、デザインの有彩色、次に無彩色を、色差の大きい順に足す。
    # それでも 4 色に足りないときだけ、色相を回して作る（check_theme.py --design が「デザインにない色」と知らせる）。
    # 何も書かない箱は process になるので、process にデザインの主色（強調色）を当てる
    roles_order = ["process", "actor", "store", "external"]
    chosen = [accent]
    semantic_names = lambda names: any(hint_score(names, r) > 0 for r in ("good", "bad", "warn"))  # noqa: E731

    def usable(c, v):
        return (not semantic_names(v["names"]) and UC.delta_e(c, bg) > 18 and UC.delta_e(fit(c), ink) > 8
                and min(UC.delta_e(c, x) for x in (good, bad)) > 20)
    for pool, gap in ((chroma, 28), (neutral, 20)):
        for c, v in sorted(pool, key=lambda cv: -cv[1]["count"]):
            if len(chosen) >= 4:
                break
            if not usable(c, v):
                continue
            c2 = fit(c)
            if UC.contrast(c2, bg) >= 3 and all(UC.delta_e(c2, x) > gap for x in chosen):
                chosen.append(c2)
    h, l, s = UC.hls(accent)
    for rot in (0.42, 0.11, 0.75, 0.25, 0.58):
        if len(chosen) >= 4:
            break
        c2 = UC.ensure_contrast(UC.from_hls(h + rot, l, max(s, 0.45)), bg, 3.2)
        if all(UC.delta_e(c2, x) > 28 for x in chosen):
            chosen.append(c2)
    roles = {r: UC.hexs(chosen[i % len(chosen)]) for i, r in enumerate(roles_order)}

    roles.update({"muted": UC.hexs(UC.ensure_contrast(UC.mix(muted, bg, 0.15), bg, 3)), "added": UC.hexs(good), "removed": UC.hexs(bad)})

    fonts = sorted(bag.fonts.items(), key=lambda kv: (-("body" in kv[1]["role"]), -kv[1]["count"]))
    fam = fonts[0][0] if fonts else None
    jp = next((f for f, _ in fonts if f in JP_GOOGLE_FONTS), None)
    stack = []
    if fam:
        stack.append(f'"{fam}"')
    if jp and jp != fam:
        stack.append(f'"{jp}"')
    stack += [f for f in ('"Noto Sans JP"', '"Hiragino Sans"', '"Yu Gothic"', "sans-serif") if f not in stack]
    css_fams = [jp or "Noto Sans JP"] + (["Noto Sans JP"] if jp and jp != "Noto Sans JP" else [])
    css = "https://fonts.googleapis.com/css2?" + "&".join("family=" + f.replace(" ", "+") + ":wght@400;500;700" for f in dict.fromkeys(css_fams)) + "&display=swap"
    radius = sorted(bag.radii)[len(bag.radii) // 2] if bag.radii else 8
    surface = UC.mix(bg, ink, 0.07)
    # 面の色（カードやパネル）が名前で分かれば、それを使う（背景と同じ色・背景から離れすぎた色は面にしない）
    surf_named = [cv for cv in cols if hint_score(cv[1]["names"], "surface") > 0 and cv[0] != bg and UC.contrast(cv[0], bg) < 1.6]
    if surf_named:
        surface = pick(surf_named, "surface")
    no_shadow = bag.shadows["none"] > 0 and bag.shadows["some"] == 0   # 影のトークンがどれも none
    theme = {
        "name": name, "label": f"{name} に合わせる", "mode": "dark" if dark else "light",
        "colors": {
            "bg": UC.hexs(bg), "surface": UC.hexs(surface), "ink": UC.hexs(ink), "muted": UC.hexs(muted),
            "line": UC.hexs(UC.mix(bg, ink, 0.22)), "accent": UC.hexs(accent),
            "good": UC.hexs(good), "bad": UC.hexs(bad), "warn": UC.hexs(warn), "roles": roles,
        },
        "font": {"family": ", ".join(stack), "weight": 400, "bold": 700, "css": css},
        "shape": {"radius": max(0, min(18, radius)), "stroke": 2.2 if not dark else 2.6, "fill": "tint" if dark else "solid",
                  "fillAlpha": 0.14, "fillMix": 0.12, "edgeWidth": 2.1, "glow": False, "shadow": not dark and not no_shadow},
        "subtitle": {"bg": "rgba(0,0,0,0.62)" if dark else UC.hexs(UC.mix(bg, (255, 255, 255), 0.6)) + "f0", "ink": UC.hexs(ink)},
        "derived_from": sorted({s for v in bag.colors.values() for s in v["sources"]}),
    }
    return theme


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--report", required=True)
    ap.add_argument("--theme")
    ap.add_argument("--name", default="brand")
    a = ap.parse_args()
    bag = Bag()
    for inp in a.inputs:
        try:
            read_input(inp, bag)
        except Exception as e:  # noqa: BLE001
            bag.notes.append(f"{inp}: 読めなかった（{e}）")
    report = {
        "colors": sorted(({"hex": h, "count": v["count"], "names": sorted(v["names"])[:8], "sources": sorted(v["sources"]),
                           "contrast_white": round(UC.contrast(UC.parse(h), (255, 255, 255)), 2),
                           "contrast_black": round(UC.contrast(UC.parse(h), (0, 0, 0)), 2)}
                          for h, v in bag.colors.items()), key=lambda x: -x["count"])[:40],
        "fonts": [{"family": f, "count": v["count"], "role": sorted(v["role"]), "sources": sorted(v["sources"])} for f, v in sorted(bag.fonts.items(), key=lambda kv: -kv[1]["count"])],
        "radius": sorted(bag.radii)[len(bag.radii) // 2] if bag.radii else None,
        # 影のトークン: none = どれも「影なし」、some = 影がある、None = 影のトークンがない（check_theme.py --design が見る）
        "shadow": "none" if bag.shadows["none"] and not bag.shadows["some"] else "some" if bag.shadows["some"] else None,
        "notes": bag.notes,
    }
    json.dump(report, open(a.report, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{a.report}: 色 {len(bag.colors)}・フォント {len(bag.fonts)}" + (f"・注意 {len(bag.notes)}" if bag.notes else ""))
    for n in bag.notes:
        print("  注意: " + n)
    if a.theme:
        th = draft_theme(bag, a.name)
        json.dump(th, open(a.theme, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"{a.theme}: 下書きのテーマ（{th['mode']}）。check_theme.py で検査してから使う")


if __name__ == "__main__":
    main()
