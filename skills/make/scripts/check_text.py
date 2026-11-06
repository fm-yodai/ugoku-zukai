#!/usr/bin/env python3
"""台本の字幕と読みの機械検査（criteria S-M2〜S-M4）。

使い方: check_text.py <storyboard.json> [--json]
  S-M2 text と read に禁止語（assets/banned_terms.json）がある
  S-M3 話者がずんだもんなのに、文末が「のだ」「なのだ」でない（文は「。」「？」「！」で切る。「」の中では切らない。句点の無い最後の文も見る）
  S-M4 読む文（read があれば read、なければ text）に、ユーザー辞書にない英字の語がある
終了コード: 0 = 誤りなし、1 = 誤りあり。--json は {"errors": [{line, rule, msg}], "warnings": []}
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from check_contract import banned, find_banned  # noqa: E402

ZUNDA = {1, 3, 5, 7, 22, 38, 75, 76}
DEFAULT_SPEAKER = 8
MARK = re.compile(r"\{[A-Za-z0-9_]+\}")
# 英字の連なり。数字・ピリオド・ハイフンが中に入るものは 1 語（JSON, tts.py, e-mail）
WORD = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[.\-][A-Za-z0-9]+)*")


def user_surfaces():
    p = os.path.join(HERE, "..", "assets", "voicevox_user_dict.json")
    return {w["surface"] for w in json.load(open(p, encoding="utf-8")).get("words", [])}


def sentences(text):
    """文に分ける。「。」「？」「！」で切り、「」『』の中の句点では切らない。句点の無い最後の文も 1 文に数える"""
    out, cur, depth = [], "", 0
    for ch in text:
        if ch in "「『":
            depth += 1
        elif ch in "」』":
            depth = max(0, depth - 1)
        if depth == 0 and ch in "。？！?!":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [t.strip() for t in out if t.strip()]


def check(sb):
    errors = []
    terms = banned()
    surfaces = user_surfaces()
    speaker = (sb.get("voice") or {}).get("speaker", DEFAULT_SPEAKER)
    for sc in sb.get("scenes", []):
        for ln in sc.get("lines", []):
            lid = ln.get("id", "?")
            text = MARK.sub("", ln.get("text", ""))
            read = MARK.sub("", ln["read"]) if ln.get("read") else None
            for label, s in (("text", text), ("read", read)):
                if s:
                    for w in find_banned(s, terms):
                        errors.append({"line": lid, "rule": "S-M2",
                                       "msg": f"行 {lid} の {label} に禁止語「{w}」がある"})
            if speaker in ZUNDA:
                for sent in sentences(text):
                    if not sent.endswith("のだ"):
                        errors.append({"line": lid, "rule": "S-M3",
                                       "msg": f"行 {lid} の文「{sent[-12:]}」の文末が「のだ」「なのだ」でない（ずんだもんの語尾）"})
            spoken = read if read is not None else text
            seen = set()
            for w in WORD.findall(spoken):
                if w not in surfaces and w not in seen:
                    seen.add(w)
                    errors.append({"line": lid, "rule": "S-M4",
                                   "msg": f"行 {lid} の `{w}` は read でカタカナにする（ユーザー辞書にもない）"})
    return errors


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    if len(args) != 1:
        sys.exit(__doc__)
    errors = check(json.load(open(args[0], encoding="utf-8")))
    if "--json" in sys.argv:
        print(json.dumps({"errors": errors, "warnings": []}, ensure_ascii=False, indent=2))
    else:
        for e in errors:
            print(f"{e['rule']}: {e['msg']}")
        print("check_text: " + (f"{len(errors)} 件の誤り" if errors else "OK"))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
