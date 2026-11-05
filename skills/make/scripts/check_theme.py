#!/usr/bin/env python3
"""テーマの検査。読めるか（WCAG のコントラスト）・役割の色が見分けられるか・必要な項目がそろっているか。

使い方: python3 check_theme.py theme.json [--json]
終了コード: 0 = 合格（注意は出る）、1 = 不合格
基準:
  - 本文の色（ink）と背景: 4.5 以上（WCAG 1.4.3）。字幕の文字と字幕の帯も同じ
  - 補足の色（muted）・強調（accent）と背景: 4.5 以上（ラベルや注記の文字に使うため）
  - 役割の色・good / bad / warn と背景: 3 以上（図形の線。WCAG 1.4.11）
  - 箱の塗りの上の本文: 4.5 以上
  - 役割の色どうし（actor / process / store / external）、good と bad: 色差 ΔE 20 以上
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uz_color as UC  # noqa: E402

REQ = ["bg", "ink", "muted", "accent", "good", "bad", "warn"]
ROLES = ["actor", "process", "store", "external", "muted", "added", "removed"]


def rgba_over(c, bg):
    c = str(c).strip()
    if c.startswith("rgba"):
        parts = c[c.index("(") + 1:c.index(")")].replace("/", ",").split(",")
        r, g, b = (float(x) for x in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1
        return UC.mix(bg, (r, g, b), a)
    if c.startswith("#") and len(c) == 9:
        a = int(c[7:], 16) / 255
        return UC.mix(bg, UC.parse(c[:7]), a)
    return UC.parse(c)


def check(th):
    fails, notes = [], []
    col = th.get("colors", {})
    for k in REQ:
        if k not in col:
            fails.append(f"colors.{k} がない")
    if fails:
        return fails, notes, []
    roles = col.get("roles", {})
    for r in ROLES:
        if r not in roles:
            fails.append(f"colors.roles.{r} がない")
    bg = UC.parse(col["bg"])
    rows = []

    def need(name, fg, back, target, kind):
        c = UC.contrast(fg, back)
        ok = c >= target
        rows.append({"check": name, "contrast": round(c, 2), "need": target, "ok": ok})
        if not ok:
            fails.append(f"{name}: コントラスト {c:.2f}（{target} 以上が要る。{kind}）")

    need("ink / bg", UC.parse(col["ink"]), bg, 4.5, "本文")
    need("muted / bg", UC.parse(col["muted"]), bg, 4.5, "補足の文字")
    need("accent / bg", UC.parse(col["accent"]), bg, 4.5, "注記と戻りの矢印のラベル")
    for k in ("good", "bad", "warn"):
        need(f"{k} / bg", UC.parse(col[k]), bg, 3, "印と線")
    for r in ROLES:
        if r in roles:
            need(f"roles.{r} / bg", UC.parse(roles[r]), bg, 3, "箱の線")
    sh = th.get("shape", {})
    for r in ("actor", "process", "store", "external"):
        if r not in roles:
            continue
        rc = UC.parse(roles[r])
        if sh.get("fill") == "solid":
            fill = UC.mix(bg, rc, sh.get("fillMix", 0.16))
        elif sh.get("fill") == "none":
            fill = bg
        else:
            fill = UC.mix(bg, rc, sh.get("fillAlpha", 0.14))
        need(f"ink / {r} の塗り", UC.parse(col["ink"]), fill, 4.5, "箱の中の文字")
    sub = th.get("subtitle", {})
    if sub:
        need("字幕の文字 / 字幕の帯", UC.parse(sub.get("ink", col["ink"])), rgba_over(sub.get("bg", col["bg"]), bg), 4.5, "字幕")
    main4 = [r for r in ("actor", "process", "store", "external") if r in roles]
    for i in range(len(main4)):
        for j in range(i + 1, len(main4)):
            d = UC.delta_e(UC.parse(roles[main4[i]]), UC.parse(roles[main4[j]]))
            if d < 20:
                (fails if d < 12 else notes).append(f"roles.{main4[i]} と roles.{main4[j]} の色差 ΔE {d:.0f}（20 以上が望ましい）")
    d = UC.delta_e(UC.parse(col["good"]), UC.parse(col["bad"]))
    if d < 20:
        fails.append(f"good と bad の色差 ΔE {d:.0f}（20 以上が要る）")
    font = th.get("font", {})
    if not font.get("family"):
        fails.append("font.family がない")
    elif "sans-serif" not in font["family"] and "serif" not in font["family"]:
        notes.append("font.family の最後に sans-serif などの総称を付ける")
    if font.get("css") and "fonts.googleapis.com" not in font["css"]:
        notes.append("font.css は Google Fonts の URL だけ読める（Artifact の制限）。他は読まれない")
    if not any(j in font.get("family", "") for j in ("JP", "Gothic", "ゴシック", "Hiragino", "Mincho", "明朝", "Maru", "UD")):
        notes.append("日本語を持つフォントが font.family にないかもしれない（Noto Sans JP などを候補に足す）")
    return fails, notes, rows


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    th = json.load(open(sys.argv[1], encoding="utf-8"))
    fails, notes, rows = check(th)
    if "--json" in sys.argv:
        print(json.dumps({"ok": not fails, "fails": fails, "notes": notes, "checks": rows}, ensure_ascii=False, indent=2))
    else:
        print(f"{sys.argv[1]}（{th.get('name')}）: {'合格' if not fails else '不合格'}")
        for f in fails:
            print("  不合格: " + f)
        for n in notes:
            print("  注意: " + n)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
