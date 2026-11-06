#!/usr/bin/env python3
"""maker-checker の台帳（<workdir>/review/ledger.json）を扱う。約束は references/loop-protocol.md が正。

  python3 ledger.py ingest   <workdir> <phase> <checker の出力.json …>   checker の判定を取り込む（周は各ファイルの round）
  python3 ledger.py respond  <workdir> <phase> <responses.json>          maker の応答（fixed / disputed）を取り込む
  python3 ledger.py status   <workdir> <phase> [--round N] [--max-rounds N]
                                                                         件数の要約と判定を出す（最大周の既定は 3。チャットは 2 を渡す）
  python3 ledger.py residual <workdir>                                   閉じていない項目を review/residual.md と review/residual.json に書き出す
  python3 ledger.py reset    <workdir> <phase>                           そのフェーズの周を 1 から数え直す（人の確認で契約に戻ったとき）。
                                                                         前の項目は台帳の archived に、review/<phase>/ は review/<phase>-oldN/ に移す

status の判定と終了コード: PASS 0 / CONTINUE 10 / STOP_MAX 20 / STOP_OSC 21 / STOP_DISPUTE 22
本体（進行役）は status の出力だけを読み、指摘の本文は maker にファイルのパスで渡す。
"""
import json
import os
import re
import sys

MAX_ROUNDS = 3  # 既定。status の --max-rounds で変える（チャットは 2）
OPEN = ("open", "fixed", "disputed")
CRITERIA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "criteria")


def must_only():
    """criteria/*.md の表で、重さが must だけの基準 ID（checker が should と付けても must として扱う）。"""
    ids = set()
    for name in sorted(os.listdir(CRITERIA)):
        if not name.endswith(".md"):
            continue
        for line in open(os.path.join(CRITERIA, name), encoding="utf-8"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 4 and re.fullmatch(r"[A-Z]-[A-Z]?\d+", cells[0]) and cells[-1] == "must":
                ids.add(cells[0])
    return ids


def line_ids(workdir):
    p = os.path.join(workdir, "storyboard.json")
    if not os.path.exists(p):
        return None
    sb = json.load(open(p, encoding="utf-8"))
    return {l["id"] for c in sb.get("scenes", []) for l in c.get("lines", [])}


CODES = {"PASS": 0, "CONTINUE": 10, "STOP_MAX": 20, "STOP_OSC": 21, "STOP_DISPUTE": 22}


def path(workdir):
    return os.path.join(workdir, "review", "ledger.json")


def load(workdir):
    p = path(workdir)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"phases": {}}


def save(workdir, led):
    os.makedirs(os.path.dirname(path(workdir)), exist_ok=True)
    json.dump(led, open(path(workdir), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def phase_of(led, phase):
    return led["phases"].setdefault(phase, {"round": 0, "items": {}, "checks": {}})


def item(ph, key, f, reviewer, rnd):
    it = ph["items"].get(key)
    if it is None:
        it = ph["items"][key] = {"status": "open", "severity": f.get("severity", "must"),
                                 "criterion": f.get("criterion") or key.split(":")[-1],
                                 "line_id": f.get("line_id") or key.split(":")[0],
                                 "checker": reviewer, "reopen": 0, "rejected": 0, "history": []}
    return it


def log(it, rnd, event, note=""):
    it["history"].append([rnd, event, note[:300]])


def ingest(workdir, phase, files):
    led = load(workdir)
    ph = phase_of(led, phase)
    warns = []
    hard = must_only()
    for fp in files:
        d = json.load(open(fp, encoding="utf-8"))
        who, rnd = d.get("reviewer", os.path.basename(fp)), int(d.get("round", ph["round"] or 1))
        ph["round"] = max(ph["round"], rnd)
        for c in d.get("checks", []):
            v = c.get("verdict")
            if v == "PASS" and not c.get("evidence"):
                warns.append(f"{who}: {c.get('criterion')} の PASS に evidence が無い → UNKNOWN として扱う")
                v = "UNKNOWN"
            ph["checks"][c.get("criterion")] = {"verdict": v, "checker": who, "round": rnd, "evidence": c.get("evidence", "")}
            if v == "UNKNOWN" and not any(f.get("criterion") == c.get("criterion") for f in d.get("findings", [])):
                key = f"*:{c.get('criterion')}"
                it = item(ph, key, {"severity": "must", "criterion": c.get("criterion"), "line_id": "*"}, who, rnd)
                it["problem"] = "UNKNOWN（判定に要る情報が足りない）: " + c.get("evidence", "")
                _reopen_or_open(it, rnd, "unknown")
        for f in d.get("findings", []):
            key = f.get("key") or f"{f.get('line_id', '*')}:{f.get('criterion', '?')}"
            if not f.get("evidence"):
                warns.append(f"{who}: {key} に evidence が無いので捨てた（根拠の無い FAIL は無効）")
                continue
            crit = f.get("criterion") or key.split(":")[-1]
            if crit in hard and f.get("severity") != "must":
                warns.append(f"{who}: {key} は基準 {crit} が must だけなので、severity {f.get('severity')} を must に直した")
                f = {**f, "severity": "must"}
            it = item(ph, key, f, who, rnd)
            it.update({k: f[k] for k in ("problem", "suggestion", "evidence", "rule", "severity") if k in f})
            it["checker"] = who
            _reopen_or_open(it, rnd, "fail")
        for r in d.get("rechecks", []):
            it = ph["items"].get(r.get("key"))
            if it is None:
                warns.append(f"{who}: rechecks の {r.get('key')} は台帳に無い")
                continue
            if not r.get("evidence"):
                warns.append(f"{who}: rechecks の {r.get('key')} に evidence が無い → 判定を保留")
                continue
            if it["status"] == "disputed":
                if r.get("accept_dispute"):
                    it["status"] = "accepted"
                    log(it, rnd, "dispute_accepted", r["evidence"])
                else:
                    it["status"] = "open"
                    it["rejected"] += 1
                    log(it, rnd, "dispute_rejected", r["evidence"])
            elif r.get("verdict") == "PASS":
                if it["status"] in ("fixed", "open"):
                    it["status"] = "closed"
                    log(it, rnd, "closed", r["evidence"])
            elif r.get("verdict") == "FAIL":
                _reopen_or_open(it, rnd, "recheck_fail", r["evidence"])
    save(workdir, led)
    for w in warns:
        print("警告:", w)
    print(summary(ph, phase))


def _reopen_or_open(it, rnd, event, note=""):
    """FAIL を受けたときの遷移。直した・閉じた項目がまた FAIL → open に戻して reopen を 1 足す（同じ周に別の checker が
    同じキーで FAIL を出しても 1 回と数える）。disputed は rechecks で判定するのでここでは動かさない。"""
    if it["status"] in ("fixed", "closed", "accepted"):
        if not any(h[0] == rnd and h[1] == "reopen" for h in it["history"]):
            it["reopen"] += 1
            log(it, rnd, "reopen", note)
        it["status"] = "open"
    elif it["status"] == "open" and not any(h[0] == rnd for h in it["history"]):
        log(it, rnd, event, note)


def respond(workdir, phase, fp):
    led = load(workdir)
    ph = phase_of(led, phase)
    d = json.load(open(fp, encoding="utf-8"))
    rnd = int(d.get("round", ph["round"]))
    for r in d.get("responses", []):
        it = ph["items"].get(r.get("key"))
        if it is None:
            print(f"警告: 応答の {r.get('key')} は台帳に無い")
            continue
        if r.get("action") == "fixed":
            it["status"] = "fixed"
        elif r.get("action") == "disputed":
            if not r.get("note"):
                print(f"警告: {r['key']} の disputed に理由（note）が無い → open のまま")
                continue
            it["status"] = "disputed"
        it["response"] = r.get("note", "")
        log(it, rnd, r.get("action", "?"), r.get("note", ""))
    left = [k for k, it in ph["items"].items() if it["status"] == "open"]
    save(workdir, led)
    if left:
        print(f"警告: 応答の無い open が {len(left)} 件: {', '.join(left[:10])}")
    print(summary(ph, phase))


def decide(ph, round_override=None, max_rounds=MAX_ROUNDS):
    items = ph["items"].values()
    if any(it["reopen"] >= 2 and it["status"] in OPEN for it in items):
        return "STOP_OSC"
    if any(it["rejected"] >= 2 and it["status"] in OPEN for it in items):
        return "STOP_DISPUTE"
    if not any(it["status"] in OPEN for it in items):
        return "PASS"
    rnd = round_override if round_override is not None else ph["round"]
    return "STOP_MAX" if rnd >= max_rounds else "CONTINUE"


def summary(ph, phase, max_rounds=MAX_ROUNDS):
    cnt = {}
    for it in ph["items"].values():
        k = (it["status"], it["severity"])
        cnt[k] = cnt.get(k, 0) + 1
    def n(st, sev=None):
        return sum(v for (s, sv), v in cnt.items() if s == st and (sev is None or sv == sev))
    unk = sum(1 for c in ph["checks"].values() if c["verdict"] == "UNKNOWN")
    return (f"[{phase}] 周 {ph['round']}/{max_rounds}: open must {n('open', 'must')} / open should {n('open', 'should')}"
            f" / fixed {n('fixed')} / disputed {n('disputed')} / closed {n('closed')} / accepted {n('accepted')}"
            f" / UNKNOWN の基準 {unk} → {decide(ph, None, max_rounds)}")


def status(workdir, phase, rnd=None, max_rounds=MAX_ROUNDS):
    ph = phase_of(load(workdir), phase)
    ids = line_ids(workdir)
    if ids is not None and phase != "contract":
        gone = sorted(k for k, it in ph["items"].items()
                      if it["status"] in OPEN and it["line_id"] not in ("*", "contract") and it["line_id"] not in ids)
        if gone:
            print(f"警告: 台本に無い行 ID を指す未解決の項目が {len(gone)} 件: {', '.join(gone[:8])}"
                  "（maker が行 ID を振り直していないか。行 ID は欠番にして振り直さない約束）")
    v = decide(ph, rnd, max_rounds)
    print(summary(ph, phase, max_rounds))
    sys.exit(CODES[v])


def residual(workdir):
    led = load(workdir)
    rows = []
    items = []
    for phase, ph in led["phases"].items():
        for key, it in sorted(ph["items"].items()):
            if it["status"] in OPEN:
                items.append({"phase": phase, "key": key, "severity": it["severity"], "status": it["status"],
                              "problem": it.get("problem", ""), "response": it.get("response", "")})
                rows.append(f"| {phase} | `{key}` | {it['severity']} | {it['status']} | {it.get('problem', '')[:120]} | {it.get('response', '')[:120]} |")
    out = os.path.join(workdir, "review", "residual.md")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(os.path.join(os.path.dirname(out), "residual.json"), "w", encoding="utf-8") as fh:
        json.dump({"items": items}, fh, ensure_ascii=False, indent=1)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("# 残論点（ループを打ち切ったときに閉じていなかった項目）\n\n")
        if rows:
            fh.write("| フェーズ | キー | 重さ | 状態 | 指摘 | maker の応答 |\n|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n")
        else:
            fh.write("なし（すべてのフェーズが合格で閉じた）\n")
    print(f"{out}: {len(rows)} 件")


def reset(workdir, phase):
    led = load(workdir)
    ph = led["phases"].pop(phase, None)
    if ph is not None:
        led.setdefault("archived", []).append({"phase": phase, **ph})
    d = os.path.join(workdir, "review", phase)
    moved = ""
    if os.path.isdir(d):
        k = 1
        while os.path.exists(f"{d}-old{k}"):
            k += 1
        os.rename(d, f"{d}-old{k}")
        moved = f"、review/{phase}/ → review/{phase}-old{k}/"
    save(workdir, led)
    print(f"[{phase}] 周を数え直す（前の項目 {len(ph['items']) if ph else 0} 件を archived に移した{moved}）")


def main():
    a = [x for x in sys.argv[1:]]
    if len(a) < 2:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "ingest" and len(a) >= 4:
        ingest(a[1], a[2], a[3:])
    elif cmd == "respond" and len(a) == 4:
        respond(a[1], a[2], a[3])
    elif cmd == "status" and len(a) >= 3:
        rnd = int(a[a.index("--round") + 1]) if "--round" in a else None
        mx = int(a[a.index("--max-rounds") + 1]) if "--max-rounds" in a else MAX_ROUNDS
        status(a[1], a[2], rnd, mx)
    elif cmd == "residual":
        residual(a[1])
    elif cmd == "reset" and len(a) == 3:
        reset(a[1], a[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
