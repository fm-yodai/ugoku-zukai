#!/usr/bin/env python3
"""指摘の一覧（<workdir>/review/ledger.json）を扱う。約束は references/review-protocol.md、評価役の出力の形は
references/writing/review-format.md が正。

  python3 ledger.py ingest   <workdir> <評価役の出力.json …>     評価役の判定（checks・findings・rechecks）を取り込む
  python3 ledger.py decide   <workdir> --by lead|user [--fix <key> …] [--keep <key> …]
                                                                直す（--fix）・直さない（--keep）を記録する。
                                                                lead = 進行役が先に直した、user = 利用者が選んだ。--keep は user だけ
  python3 ledger.py list     <workdir> [--state open,fixing,kept,closed] [--by lead|user] [--reviewer <名前>] [--full] [--json]
                                                                利用者に見せる形で出す。must は全文、should は 1 件 1 行、nits は件数だけ
                                                                （--full で全部開く）。既定は open だけ。--by を付けたら既定は全状態
  python3 ledger.py status   <workdir>                          件数の要約と、今の台本・構成メモにない id を指す指摘の警告
  python3 ledger.py residual <workdir>                          must で閉じていない指摘（残論点）を review/residual.md・residual.json に書く

終了コード: 0 = できた、2 = 使い方の誤り・台帳にないキー・古い形の台帳（何も書き換えない）。

指摘のキーは <where>:<基準 ID>（例 l7:S-F1、c3.1:A-1、basics.knows:O-D3、*:S-D4）。レベルは must / should / nits。

状態:
  open    見つかった。まだ扱いを決めていないか、直したが再確認で通らなかった
  fixing  直すと決めた（by が lead か user）。再確認を待っている
  kept    利用者が直さないと決めた
  closed  再確認で通った

遷移:
  findings に新しいキー            → open で足す
  findings に台帳にあるキー        → open は文面を更新。fixing と closed は open に戻す（by は消さない）。kept は kept のまま文面だけ更新
  rechecks の PASS                 → closed（どの状態からでも）
  rechecks の FAIL                 → fixing と closed は open に戻す。open と kept はそのまま
  decide --fix                     → open と kept を fixing にし、by を記録する。closed と fixing は警告して飛ばす
  decide --keep（--by user だけ）  → open と fixing を kept にし、by を user にする

取り込みの決まり:
  evidence のない指摘と再確認は捨てて警告する。evidence のない PASS は UNKNOWN として扱う
  重さが must だけの基準（criteria/*.md の表の最後の列が must）の指摘は、付いてきたレベルにかかわらず must にする
  レベルが must / should / nits のどれでもなければ should にする
  checks が UNKNOWN で、同じ基準の指摘がなければ、*:<基準 ID> の must の指摘を足す
"""
import argparse
import json
import os
import re
import sys

FORMAT = "ugoku-zukai-ledger/2"
LEVELS = ("must", "should", "nits")
STATES = ("open", "fixing", "kept", "closed")
STATE_LABEL = {"open": "未対応", "fixing": "直し中", "kept": "直さない", "closed": "閉じた"}
BY_LABEL = {"lead": "進行役", "user": "利用者"}
FIELDS = ("problem", "suggestion", "evidence", "rule")
CRITERIA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "criteria")


class Refuse(Exception):
    """何も書き換えずに終了コード 2 で止める"""


def must_only():
    """criteria/*.md の表で、重さが must だけの基準 ID（評価役が別のレベルを付けても must として扱う）"""
    ids = set()
    for name in sorted(os.listdir(CRITERIA)):
        if not name.endswith(".md"):
            continue
        with open(os.path.join(CRITERIA, name), encoding="utf-8") as f:
            for line in f:
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if len(cells) >= 4 and re.fullmatch(r"[A-Z]-[A-Z]?\d+", cells[0]) and _weight(cells) == "must":
                    ids.add(cells[0])
    return ids


def _weight(cells):
    """基準の表の「重さ」の列。列を足した表（outline.md の「元」など）でも読めるよう、must / should で始まる最後の列を採る"""
    for c in reversed(cells):
        if c.startswith(("must", "should")):
            return c
    return ""


def path(workdir):
    return os.path.join(workdir, "review", "ledger.json")


def load(workdir):
    p = path(workdir)
    if not os.path.exists(p):
        return {"format": FORMAT, "items": {}, "checks": {}}
    with open(p, encoding="utf-8") as f:
        led = json.load(f)
    if led.get("format") != FORMAT:
        raise Refuse(f"古い形の台帳は読めない: {p}（周回の台帳。新しい作業フォルダで始めるか、このファイルを別の名前にする）")
    return led


def save(workdir, led):
    os.makedirs(os.path.dirname(path(workdir)), exist_ok=True)
    with open(path(workdir), "w", encoding="utf-8") as f:
        json.dump(led, f, ensure_ascii=False, indent=1)


def one_line(text):
    return re.sub(r"\s+", " ", str(text or "").replace("|", " ")).strip()


def log(it, event, note=""):
    it["history"].append([event, one_line(note)[:300]])


def counts(led):
    c = {"open": {lv: 0 for lv in LEVELS}, "fixing": 0, "kept": 0, "closed": 0}
    for it in led["items"].values():
        if it["state"] == "open":
            c["open"][it["level"]] += 1
        else:
            c[it["state"]] += 1
    return c


def summary(led):
    c = counts(led)
    o = c["open"]
    return (f"指摘: open must {o['must']} / should {o['should']} / nits {o['nits']}、"
            f"直し中 {c['fixing']}、直さない {c['kept']}、閉じた {c['closed']}")


def ingest(workdir, files):
    led = load(workdir)
    outs = []
    for fp in files:
        if not os.path.isfile(fp):
            raise Refuse(f"評価役の出力がない: {fp}")
        with open(fp, encoding="utf-8") as f:
            outs.append((fp, json.load(f)))
    hard, warns = must_only(), []
    for fp, d in outs:
        who = d.get("reviewer") or os.path.basename(fp)
        findings = [f for f in d.get("findings") or [] if isinstance(f, dict)]
        for c in d.get("checks") or []:
            crit, v = c.get("criterion"), c.get("verdict")
            if v == "PASS" and not c.get("evidence"):
                warns.append(f"{who}: {crit} の PASS に evidence がない → UNKNOWN として扱う")
                v = "UNKNOWN"
            led["checks"][crit] = {"verdict": v, "reviewer": who, "evidence": c.get("evidence", "")}
            if v == "UNKNOWN" and not any(f.get("criterion") == crit for f in findings):
                findings.append({"key": f"*:{crit}", "where": "*", "criterion": crit, "level": "must",
                                 "problem": "UNKNOWN（判定に要る情報が足りない）: " + (c.get("evidence") or "evidence がない"),
                                 "evidence": c.get("evidence") or "判定の根拠が書かれていない"})
        for f in findings:
            key = f.get("key") or f"{f.get('where', '*')}:{f.get('criterion', '?')}"
            if not f.get("evidence"):
                warns.append(f"{who}: {key} に evidence がないので捨てた（根拠のない指摘は無効）")
                continue
            where, _, crit = key.rpartition(":")
            crit = f.get("criterion") or crit
            level = f.get("level")
            if level not in LEVELS:
                warns.append(f"{who}: {key} のレベル {json.dumps(level, ensure_ascii=False)} は must / should / nits のどれでもないので、should にした")
                level = "should"
            if crit in hard and level != "must":
                warns.append(f"{who}: {key} は基準 {crit} が must だけなので、レベル {level} を must に直した")
                level = "must"
            it = led["items"].get(key)
            if it is None:
                it = led["items"][key] = {"where": f.get("where") or where or "*", "criterion": crit, "level": level,
                                          "state": "open", "by": None, "reviewer": who, "history": []}
                log(it, "found")
            elif it["state"] in ("fixing", "closed"):
                log(it, "refound", f"{STATE_LABEL[it['state']]}の指摘がもう一度出た")
                it["state"] = "open"
            it.update({k: f[k] for k in FIELDS if k in f})
            it["level"], it["reviewer"] = level, who
        for r in d.get("rechecks") or []:
            key, v = r.get("key"), r.get("verdict")
            it = led["items"].get(key)
            if it is None:
                warns.append(f"{who}: rechecks の {key} は台帳にない")
                continue
            if not r.get("evidence"):
                warns.append(f"{who}: rechecks の {key} に evidence がない → 判定を使わない")
                continue
            if v == "PASS":
                it["state"] = "closed"
                log(it, "recheck:PASS", r["evidence"])
            elif v == "FAIL":
                if it["state"] in ("fixing", "closed"):
                    it["state"] = "open"
                log(it, "recheck:FAIL", r["evidence"])
            else:
                warns.append(f"{who}: rechecks の {key} の verdict は PASS か FAIL（今は {json.dumps(v, ensure_ascii=False)}）")
    save(workdir, led)
    for w in warns:
        print("警告:", w)
    print(summary(led))


def decide(workdir, by, fix, keep):
    led = load(workdir)
    if not fix and not keep:
        raise Refuse("--fix か --keep にキーを渡す")
    if keep and by != "user":
        raise Refuse("--keep（直さない）を決められるのは利用者だけ（--by user）")
    missing = [k for k in fix + keep if k not in led["items"]]
    if missing:
        raise Refuse("台帳にないキー: " + "、".join(missing))
    for k in fix:
        it = led["items"][k]
        if it["state"] in ("closed", "fixing"):
            print(f"警告: {k} は {STATE_LABEL[it['state']]} なので飛ばした")
            continue
        it["state"], it["by"] = "fixing", by
        log(it, f"fix:{by}")
    for k in keep:
        it = led["items"][k]
        if it["state"] == "closed":
            print(f"警告: {k} は閉じているので飛ばした")
            continue
        it["state"], it["by"] = "kept", "user"
        log(it, "keep:user")
    save(workdir, led)
    print(summary(led))


def select(led, states, by, reviewer):
    rows = []
    for key, it in led["items"].items():
        if it["state"] in states and (by is None or it["by"] == by) and (reviewer is None or it["reviewer"] == reviewer):
            rows.append((key, it))
    rows.sort(key=lambda r: LEVELS.index(r[1]["level"]))   # 安定な並べ替え。同じレベルの中は台帳に入った順
    return rows


def tag(it):
    if it["state"] == "open" and not it["by"]:
        return ""
    who = BY_LABEL.get(it["by"])
    label = STATE_LABEL[it["state"]] if it["state"] != "open" else "直したが通らなかった"
    return f"［{label}{'・' + who if who else ''}］"


def show(workdir, states, by, reviewer, full, as_json):
    led = load(workdir)
    if states is None:
        states = STATES if by else ("open",)
    rows = select(led, states, by, reviewer)
    if as_json:
        print(json.dumps({"counts": counts(led), "items": [
            {"key": k, "where": it["where"], "criterion": it["criterion"], "level": it["level"], "state": it["state"],
             "by": it["by"], "reviewer": it["reviewer"], "problem": it.get("problem", ""),
             "suggestion": it.get("suggestion", ""), "evidence": it.get("evidence", "")} for k, it in rows]},
            ensure_ascii=False, indent=1))
        return
    print(summary(led))
    for lv in LEVELS:
        group = [(k, it) for k, it in rows if it["level"] == lv]
        if not group:
            continue
        print(f"\n## {lv}（{len(group)} 件）")
        if lv == "nits" and not full:
            print("（--full で開く）")
            continue
        for k, it in group:
            if lv == "must" or full:
                print(f"- `{k}`{tag(it)}（{it['reviewer']}）{one_line(it.get('problem'))}")
                if it.get("suggestion"):
                    print(f"  直し方: {one_line(it['suggestion'])}")
                print(f"  根拠: {one_line(it.get('evidence'))}")
            else:
                print(f"- `{k}`{tag(it)} {one_line(it.get('problem'))[:60]}")


def known_ids(workdir):
    """今の台本と構成メモにある id。どちらのファイルもなければ None"""
    ids, found = {"*"}, False
    p = os.path.join(workdir, "storyboard.json")
    if os.path.exists(p):
        found = True
        with open(p, encoding="utf-8") as f:
            sb = json.load(f)
        ids.update((sb.get("figures") or {}).keys())
        for sc in sb.get("scenes") or []:
            ids.add(sc.get("id"))
            ids.update(ln.get("id") for ln in sc.get("lines") or [])
    p = os.path.join(workdir, "outline.json")
    if os.path.exists(p):
        found = True
        with open(p, encoding="utf-8") as f:
            ol = json.load(f)
        ids.add("basics")
        ids.update(f"basics.{k}" for k in (ol.get("basics") or {}))
        for ch in ol.get("chapters") or []:
            if isinstance(ch, dict):
                ids.update((ch.get("id"), f"{ch.get('id')}.shows"))
                ids.update(s.get("id") for s in ch.get("says") or [] if isinstance(s, dict))
    return ids if found else None


def status(workdir):
    led = load(workdir)
    print(summary(led))
    ids = known_ids(workdir)
    if ids is not None:
        gone = [k for k, it in led["items"].items() if it["state"] != "closed" and it["where"] not in ids]
        if gone:
            print(f"警告: 今の台本にも構成メモにもない id を指す指摘が {len(gone)} 件: {', '.join(gone[:8])}"
                  "（行や章の id を振り直していないか。id は欠番にして振り直さない約束）")


def residual(workdir):
    led = load(workdir)
    items = [{"key": k, "level": it["level"], "state": it["state"], "by": it["by"], "where": it["where"],
              "criterion": it["criterion"], "problem": it.get("problem", ""), "suggestion": it.get("suggestion", "")}
             for k, it in led["items"].items() if it["level"] == "must" and it["state"] != "closed"]
    d = os.path.join(workdir, "review")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "residual.json"), "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, indent=1)
    out = os.path.join(d, "residual.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# 残論点（must の指摘のうち、直っていないもの）\n\n")
        if items:
            f.write("| キー | 状態 | 指摘 | 決めた人 |\n|---|---|---|---|\n")
            for i in items:
                f.write(f"| `{i['key']}` | {STATE_LABEL[i['state']]} | {one_line(i['problem'])[:160]} | {BY_LABEL.get(i['by'], '')} |\n")
        else:
            f.write("なし\n")
    print(f"{out}: {len(items)} 件")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest")
    p.add_argument("workdir")
    p.add_argument("files", nargs="+")
    p = sub.add_parser("decide")
    p.add_argument("workdir")
    p.add_argument("--by", required=True, choices=("lead", "user"))
    p.add_argument("--fix", nargs="*", default=[])
    p.add_argument("--keep", nargs="*", default=[])
    p = sub.add_parser("list")
    p.add_argument("workdir")
    p.add_argument("--state")
    p.add_argument("--by", choices=("lead", "user"))
    p.add_argument("--reviewer")
    p.add_argument("--full", action="store_true")
    p.add_argument("--json", action="store_true")
    for name in ("status", "residual"):
        sub.add_parser(name).add_argument("workdir")
    a = ap.parse_args(argv)   # 使い方の誤りは argparse が終了コード 2 で止める
    try:
        if a.cmd == "ingest":
            ingest(a.workdir, a.files)
        elif a.cmd == "decide":
            decide(a.workdir, a.by, a.fix, a.keep)
        elif a.cmd == "list":
            states = None
            if a.state:
                states = tuple(s.strip() for s in a.state.split(",") if s.strip())
                bad = [s for s in states if s not in STATES]
                if bad:
                    raise Refuse(f"--state は {' / '.join(STATES)} をカンマで区切る（今は {'、'.join(bad)}）")
            show(a.workdir, states, a.by, a.reviewer, a.full, a.json)
        elif a.cmd == "status":
            status(a.workdir)
        else:
            residual(a.workdir)
    except Refuse as e:
        print(e, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
