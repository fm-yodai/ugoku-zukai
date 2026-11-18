#!/usr/bin/env python3
"""テーマの検査。読めるか（WCAG のコントラスト）・役割の色が見分けられるか・必要な項目がそろっているか。

使い方: python3 check_theme.py theme.json [--json] [--design design-report.json]
  --design  extract_design.py の報告を渡すと、テーマがそのデザインから外れていないかも見る。
            背景・本文はデザインの色そのまま、強調はデザインの色相（明るさは動かしてよい）、字体の先頭はデザインの字体、
            デザインが影を使わないなら影なし、が不合格の条件。役割の色・意味の色（good / bad / warn）・箱の面と枠（colors.boxes）・
            字幕の帯・章扉の地がデザインにないときは注意に留める
終了コード: 0 = 合格（注意は出る）、1 = 不合格、2 = 使い方の誤りかファイルを読めない
基準:
  - 本文の色（ink）と背景: 4.5 以上（WCAG 1.4.3）。字幕の文字と字幕の帯も同じ
  - 補足の色（muted）・強調（accent）と背景: 4.5 以上（ラベルや注記の文字に使うため）
  - 役割の色・good / bad / warn と背景: 3 以上（図形の線。WCAG 1.4.11）
  - 箱の塗りの上の本文: 4.5 以上（colors.boxes に面と文字の色を書いた役割は、その面とその文字で見る）
  - 章扉（chapter）の文字・添え字・強調（accent）と章扉の地: 4.5 以上
  - 役割の色どうし（actor / process / store / external）、good と bad: 色差 ΔE 20 以上
  - 線の色の並び（colors.series）: 2 色以上、同じ色がない、どの 2 色も色差 ΔE 20 以上（12 未満は不合格）、
    背景とのコントラスト 3 以上（グラフの線。WCAG 1.4.11）。書いていないテーマは、既定の並びの色差が 20 未満なら注意
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
    boxes = col.get("boxes") or {}
    for r in ("actor", "process", "store", "external"):
        if r not in roles or (boxes.get(r) or {}).get("fill"):
            continue
        rc = UC.parse(roles[r])
        if sh.get("fill") == "solid":
            fill = UC.mix(bg, rc, sh.get("fillMix", 0.16))
        elif sh.get("fill") == "none":
            fill = bg
        else:
            fill = UC.mix(bg, rc, sh.get("fillAlpha", 0.14))
        need(f"ink / {r} の塗り", UC.parse(col["ink"]), fill, 4.5, "箱の中の文字")
    for r, b in boxes.items():   # 面と文字の色を役割ごとに書いたテーマ（デザインの色をそのまま当てる）
        if not isinstance(b, dict) or not b.get("fill"):
            continue
        fill = rgba_over(b["fill"], bg)
        if not fill:
            fails.append(f"colors.boxes.{r}.fill を色として読めない")
            continue
        need(f"{'label' if b.get('label') else 'ink'} / {r} の面", UC.parse(b.get("label") or col["ink"]), fill, 4.5, "箱の中の文字")
    chap = th.get("chapter")
    if chap:
        cbg = UC.parse(chap.get("bg", ""))
        if not cbg or not chap.get("ink"):
            fails.append("chapter には bg と ink が要る")
        else:
            need("章扉の文字 / 章扉の地", rgba_over(chap["ink"], cbg), cbg, 4.5, "題の札")
            if chap.get("sub"):
                need("章扉の添え字 / 章扉の地", rgba_over(chap["sub"], cbg), cbg, 4.5, "題の札の sub")
            if chap.get("accent"):
                need("暗い地の強調 / 章扉の地", rgba_over(chap["accent"], cbg), cbg, 4.5, "暗い地のスライドの強調の語")
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
    check_series(col, bg, need, fails, notes)
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


def series_of(col):
    """線の色の並び。プレーヤーの UZ.seriesOf（figures.js）と同じ約束: colors.series があればそれ（同じ色は除く）、
    なければ accent・good・warn・bad・ink・muted から同じ色を除いて 4 つまで"""
    explicit = isinstance(col.get("series"), list) and col["series"]
    src = col["series"] if explicit else [col.get(k) for k in ("accent", "good", "warn", "bad", "ink", "muted")]
    out = []
    for c in src:
        if c and str(c).lower() not in [str(x).lower() for x in out]:
            out.append(c)
    return out if explicit else out[:4]


def check_series(col, bg, need, fails, notes):
    """線の色の並び（colors.series）。custom の部品で、区別が目的の線（曲線と接線など）に s1〜 で使う"""
    explicit = isinstance(col.get("series"), list) and col["series"]
    if "series" in col and not explicit:
        fails.append("colors.series は色の配列で書く（2〜4 色）")
        return
    if explicit and len(col["series"]) != len({str(c).lower() for c in col["series"]}):
        fails.append("colors.series に同じ色がある（並びの色は互いに区別できる色にする）")
    ser = series_of(col)
    where = "colors.series" if explicit else "線の色の並び（colors.series がないので、意味の色と本文の色から作った既定）"
    if len(ser) < 2:
        fails.append(f"{where} が 2 色に満たない")
        return
    parsed = []
    for c in ser:
        p = UC.parse(str(c))
        if not p:
            fails.append(f"{where} の {c} を色として読めない")
            return
        parsed.append(p)
    for i, c in enumerate(parsed):
        if explicit:
            need(f"series[{i}] / bg", c, bg, 3, "グラフの線")
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            d = UC.delta_e(parsed[i], parsed[j])
            if d < 20:
                # 書いた並びは不合格にする。書いていない（既定の）並びは、colors.series を書くよう注意に留める
                (fails if d < 12 and explicit else notes).append(f"{where} の {ser[i]} と {ser[j]} の色差 ΔE {d:.0f}（20 以上が望ましい"
                                                                 + ("" if explicit else "。見分けられる色を colors.series に書く") + "）")


def check_design(th, report):
    """テーマが、取り込んだデザイン（extract_design.py の報告）から外れていないか。返すもの: (不合格, 注意, 対応の行)"""
    fails, notes, lines = [], [], []
    design = [(UC.parse(c["hex"]), c.get("names") or []) for c in report.get("colors", []) if UC.parse(c.get("hex", ""))]
    col = th.get("colors", {})

    def origin(c):
        """c がデザインのどの色から来たか。(色, 名前, 関係) か None"""
        near = min(design, key=lambda d: UC.delta_e(c, d[0]), default=None)
        if near and UC.delta_e(c, near[0]) <= 2:
            return near[0], near[1], "同じ色"
        if UC.saturation(c) >= 0.18:
            hue = lambda x: UC.hls(x)[0]  # noqa: E731
            same = [d for d in design if UC.saturation(d[0]) >= 0.18 and abs(((hue(d[0]) - hue(c) + 0.5) % 1) - 0.5) <= 0.04]
            if same:
                d = min(same, key=lambda d: UC.delta_e(c, d[0]))
                return d[0], d[1], "色相を保って明るさを動かした色"
        return None

    def one(key, value, must, why):
        c = UC.parse(value or "")
        if not c:
            return
        o = origin(c)
        if o:
            names = "・".join(o[1][:3])
            lines.append(f"{key} {value} ← デザインの {UC.hexs(o[0])}{'（' + names + '）' if names else ''}。{o[2]}")
        elif must:
            fails.append(f"{key} {value} はデザインにない色（{why}）")
        else:
            notes.append(f"{key} {value} はデザインにない色（{why}）")
    one("bg", col.get("bg"), True, "背景は、デザインの地の色をそのまま使う")
    one("ink", col.get("ink"), True, "本文は、デザインの本文の色をそのまま使う")
    one("accent", col.get("accent"), True, "強調は、デザインの主色の色相を保つ。コントラストが足りなければ明るさだけを動かす")
    for r in ("actor", "process", "store", "external"):
        one(f"roles.{r}", (col.get("roles") or {}).get(r), False, "デザインの有彩色が足りずに、色相を回して作った色なら、このままでよい")
    for k in ("good", "bad", "warn"):
        one(k, col.get(k), False, "意味の色も、デザインにある色で作る。赤や緑がないデザインなら、強調の色とグレーアウトで言い分ける")
    for r, b in (col.get("boxes") or {}).items():
        for k in ("fill", "border", "label"):
            if isinstance(b, dict) and b.get(k):
                one(f"boxes.{r}.{k}", b[k], False, "箱の面・枠・文字は、デザインの色をそのまま当てる")
    one("subtitle.bg", (th.get("subtitle") or {}).get("bg"), False, "字幕の帯は、デザインの色から決める")
    one("chapter.bg", (th.get("chapter") or {}).get("bg"), False, "章扉の地は、デザインの色から決める")
    fonts = [f["family"].lower() for f in report.get("fonts", [])]
    first = (th.get("font", {}).get("family") or "").split(",")[0].strip().strip("'\"")
    if fonts and first.lower() not in fonts:
        fails.append(f"字体の先頭「{first}」がデザインにない（デザインの字体: {'、'.join(f['family'] for f in report['fonts'][:4])}）")
    elif fonts:
        lines.append(f"字体 {first} ← デザインの字体")
    if report.get("shadow") == "none" and th.get("shape", {}).get("shadow"):
        fails.append("shape.shadow が true だが、デザインは影を使わない（影のトークンがどれも none）")
    rad, mine = report.get("radius"), th.get("shape", {}).get("radius")
    if rad is not None and mine is not None and abs(rad - mine) > 4:
        notes.append(f"shape.radius {mine} が、デザインの角丸（中央の値 {rad:g}）から離れている")
    return fails, notes, lines


def main():
    argv = sys.argv[1:]
    design_path = None
    if "--design" in argv:
        i = argv.index("--design")
        if i + 1 >= len(argv):
            print("--design には extract_design.py の報告（design-report.json）を渡す", file=sys.stderr)
            return 2
        design_path = argv[i + 1]
        del argv[i:i + 2]
    files = [a for a in argv if not a.startswith("--")]
    if len(files) != 1:
        print(__doc__)
        return 2
    try:
        th = json.load(open(files[0], encoding="utf-8"))
        report = json.load(open(design_path, encoding="utf-8")) if design_path else None
    except (OSError, ValueError) as e:
        print(f"読めない: {e}", file=sys.stderr)
        return 2
    sys.argv[1] = files[0]
    fails, notes, rows = check(th)
    d_lines = []
    if report is not None:
        d_fails, d_notes, d_lines = check_design(th, report)
        fails, notes = fails + d_fails, notes + d_notes
        if not d_fails:
            d_lines.append("デザインに沿っている")
    if "--json" in sys.argv:
        print(json.dumps({"ok": not fails, "fails": fails, "notes": notes, "checks": rows}, ensure_ascii=False, indent=2))
    else:
        print(f"{sys.argv[1]}（{th.get('name')}）: {'合格' if not fails else '不合格'}")
        for f in fails:
            print("  不合格: " + f)
        for n in notes:
            print("  注意: " + n)
        for ln in d_lines:
            print("  デザイン: " + ln)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
