#!/usr/bin/env python3
"""契約 contract.json の形と尺の配分を機械で点検する（criteria/contract.md の C-M1・C-M2。禁止語は警告）。
型ごとの部の並びは references/structures.md が正。

  python3 check_contract.py <workdir>

contract.json の形（researcher が書く。台本の物差しになる）:
{
  "mode": "code" | "repo" | "pr" | "web" | "doc" | "output" | "topic",          題材の種類（SKILL.md Phase 0）
  "structure": "flow" | "diff" | "overview" | "concept" | "compare",            構成の型（references/structures.md）
  "audience": "読者",
  "takeaway": "一番分かってほしいこと（1 文）",
  "scope": "範囲と切り口（含めるもの・外すもの）",                              任意（interview.md から）
  "claims":  [{"id": "K1", "text": "言い切ること", "source": ["path:line" | "PR #n" | "#n" | "https://… 「引用」" | "file:p.N", …]}],   3〜5 項
  "paths":   [{"id": "P1", "text": "見せる経路を言葉で", "steps": ["部品 id", …], "source": [...]}],     1 項以上（diagram.type が none なら任意）
  "diagram": {"type": "layered" | "sequence" | "state" | "none", "reason": "選んだ理由",
              "compared": {"layered": "…", "sequence": "…", "state": "…"}, "alternative": null | "3 つより合う形の提案"},
                                                                            none（表・箇条だけで見せる）は concept / compare のみ
  "budget":  {"max_seconds": 300, "parts": [{"role": "question" | "overview" | "detail" | "recap" | …, "seconds": 10}]}
}
エラーは exit 1。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {"layered", "sequence", "state"}
MODES = {"code", "repo", "pr", "web", "doc", "output", "topic"}
STRUCTURES = {"flow", "diff", "overview", "concept", "compare"}
URL_MODES = {"web", "topic"}


def banned():
    d = json.load(open(os.path.join(HERE, "..", "assets", "banned_terms.json"), encoding="utf-8"))
    return d["terms"]


def find_banned(text, terms):
    hits = []
    for t in terms:
        s = text
        for a in t.get("allow", []):
            s = s.replace(a, "")
        if t["word"] in s:
            hits.append(t["word"])
    return hits


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    c = json.load(open(os.path.join(sys.argv[1], "contract.json"), encoding="utf-8"))
    errors, warns = [], []
    for k in ("mode", "structure", "audience", "takeaway", "claims", "diagram", "budget"):
        if not c.get(k):
            errors.append(f"C-M1: {k} が無い")
    claims = c.get("claims") or []
    if not 3 <= len(claims) <= 5:
        errors.append(f"C-M1: 言い切ること（claims）が {len(claims)} 項。3〜5 項にする")
    for cl in claims:
        if not cl.get("source"):
            errors.append(f"C-M1: {cl.get('id')} に根拠（source）が無い")
    if c.get("mode") and c["mode"] not in MODES:
        errors.append(f"C-M1: mode は {sorted(MODES)} のどれか（{c.get('mode')}）")
    st = c.get("structure")
    if st and st not in STRUCTURES:
        errors.append(f"C-M1: structure は {sorted(STRUCTURES)} のどれか（{st}）")
    if c.get("mode") in URL_MODES:
        for cl in claims:
            if not any(str(x).startswith(("http://", "https://")) for x in cl.get("source") or []):
                errors.append(f"C-M1: {cl.get('id')} の根拠に URL が無い（{c['mode']} の言い切りはページの URL と引用で支える）")
    d = c.get("diagram") or {}
    if d.get("type") == "none":
        if st not in ("concept", "compare"):
            errors.append(f"C-M1: diagram.type none（表・箇条だけ）は structure が concept / compare のときだけ（{st}）")
    else:
        if d.get("type") not in TYPES:
            errors.append(f"C-M1: diagram.type は {sorted(TYPES | {'none'})} のどれか（{d.get('type')}）")
        if not c.get("paths"):
            errors.append("C-M1: paths が無い（全体図を使うなら見せる経路を 1 項以上）")
    for p in c.get("paths") or []:
        if not p.get("steps") or not p.get("source"):
            errors.append(f"C-M1: 経路 {p.get('id')} に steps か source が無い")
    if not d.get("reason"):
        errors.append("C-M1: diagram.reason（図の型を選んだ理由）が無い")
    if set((d.get("compared") or {}).keys()) != TYPES:
        errors.append("C-M1: diagram.compared に 3 つの型すべての比較を書く")
    b = c.get("budget") or {}
    parts = b.get("parts") or []
    total = sum(p.get("seconds", 0) for p in parts)
    mx = b.get("max_seconds", 360)
    if total > mx:
        errors.append(f"C-M2: 尺の配分の合計 {total} 秒が上限 {mx} 秒を超える")
    terms = banned()
    def walk(v, where):
        if isinstance(v, str):
            for w in find_banned(v, terms):
                warns.append(f"C-D4: {where} に禁止語「{w}」")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{where}[{i}]")
        elif isinstance(v, dict):
            for k, x in v.items():
                if k not in ("source", "steps"):
                    walk(x, f"{where}.{k}")
    walk(c, "contract")
    for w in warns:
        print("警告:", w)
    for e in errors:
        print("エラー:", e)
    print(f"契約: 言い切り {len(claims)} 項 / 尺の配分 {total}/{mx} 秒 / エラー {len(errors)} / 警告 {len(warns)}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
