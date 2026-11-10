#!/usr/bin/env python3
"""台本の字幕と読みの機械検査（criteria S-M2〜S-M4）。

使い方: check_text.py <storyboard.json> [--json]
  S-M2 text と read に禁止語（assets/banned_terms.json）がある
  S-M3 話者がずんだもんなのに、文末が「のだ」「なのだ」でない（文は「。」「？」「！」で切る。「」の中では切らない。句点の無い最後の文も見る）
  S-M4 読む文（read があれば read、なければ text）に、ユーザー辞書にない英字の語がある
  警告（終了コードに響かない。聞いて分かる文の規則 references/writing/spoken.md）
  SP-4 1 文が 50 字を超える。または 1 文に「・」が 3 つ以上（項目 4 つ以上）並ぶ
  SP-6 1 文に助詞の「の」が 3 つ以上ある（「のだ」「のです」「のか」と、この・その・あの・どの・ものの「の」は数えない）
終了コード: 0 = 誤りなし（警告があっても 0）、1 = 誤りあり。--json は {"errors": [{line, rule, msg}], "warnings": [{line, rule, msg}]}
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def banned():
    """禁止語の一覧（assets/banned_terms.json の terms）"""
    with open(os.path.join(HERE, "..", "assets", "banned_terms.json"), encoding="utf-8") as f:
        return json.load(f)["terms"]


def find_banned(text, terms):
    """text に入っている禁止語を返す。allow に挙げた熟語（「名札」など）の中の語は数えない"""
    hits = []
    for t in terms:
        s = text
        for a in t.get("allow", []):
            s = s.replace(a, "")
        if t["word"] in s:
            hits.append(t["word"])
    return hits


ZUNDA = {1, 3, 5, 7, 22, 38, 75, 76}
DEFAULT_SPEAKER = 8
MARK = re.compile(r"\{[A-Za-z0-9_]+\}")
# 英字の連なり。数字・ピリオド・ハイフンが中に入るものは 1 語（JSON, tts.py, e-mail）
# 警告の閾値
MAX_LEN = 50
MAX_ITEMS = 3
MAX_NO = 3
# 助詞の「の」（「のだ」「のです」「のか」は文末の言い回しなので数えない）
NO = re.compile(r"(?<![こそあども])の(?![だでか])")
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
    errors, warnings = [], []
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
            for sent in sentences(text):
                if len(sent) > MAX_LEN:
                    warnings.append({"line": lid, "rule": "SP-4",
                                     "msg": f"行 {lid} の文が {len(sent)} 字（{MAX_LEN} 字以内に分ける）"})
                items = sent.count("・") + 1
                if items - 1 >= MAX_ITEMS:
                    warnings.append({"line": lid, "rule": "SP-4",
                                     "msg": f"行 {lid} の文に項目が {items} つ並ぶ（{MAX_ITEMS} つまで）"})
                n_no = len(NO.findall(sent))
                if n_no >= MAX_NO:
                    warnings.append({"line": lid, "rule": "SP-6",
                                     "msg": f"行 {lid} の文に「の」が {n_no} つある（{MAX_NO - 1} つまで）"})
            spoken = read if read is not None else text
            seen = set()
            for w in WORD.findall(spoken):
                if w not in surfaces and w not in seen:
                    seen.add(w)
                    errors.append({"line": lid, "rule": "S-M4",
                                   "msg": f"行 {lid} の `{w}` は read でカタカナにする（ユーザー辞書にもない）"})
    return errors, warnings


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    if len(args) != 1:
        sys.exit(__doc__)
    errors, warnings = check(json.load(open(args[0], encoding="utf-8")))
    if "--json" in sys.argv:
        print(json.dumps({"errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2))
    else:
        for e in errors:
            print(f"{e['rule']}: {e['msg']}")
        for w in warnings:
            print(f"警告 {w['rule']}: {w['msg']}")
        print("check_text: " + (f"{len(errors)} 件の誤り" if errors else f"OK（警告 {len(warnings)} 件）"))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
