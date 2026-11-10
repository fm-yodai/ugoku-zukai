#!/usr/bin/env python3
"""構成メモ outline.json の形を機械で点検する（仕様は references/outline.md）。

  python3 check_outline.py <outline.json か作業フォルダ> [--ready] [--json]

  --ready  台本に進める状態かも見る（basics に audience・knows・takeaway がある、章が 1 つ以上ある、どの章にも says がある）
  --json   結果を JSON で出す: {"file", "errors", "warnings", "proposed"}

終了コード: 0 = 誤りなし（警告は出る）、1 = 誤りあり、2 = 使い方の誤りかファイルがない。
結果は標準出力に 1 件 1 行で書く（「誤り: …」「警告: …」。誤りがなければ最後に「OK」）。

構成メモの形:
{
  "format": "ugoku-zukai-outline/1",
  "title": "動画の題",
  "basics": {                       キーは自由。値は「項目」。台本に進む前に要るのは audience・knows・takeaway
    "audience": 項目, "knows": 項目, "takeaway": 項目,
    "length": 項目 + {"seconds": 300},          正の数（任意）
    "look":   項目 + {"theme": "flat"},         テーマの名前かパス（任意）
    "voice":  項目 + {"speaker": 8, "speed": 1.1}   整数・正の数（任意）
  },
  "chapters": [                     空でもよい
    {"id": "c3",                    台本の id と同じ規則。振り直さない
     "title": "章の題",
     "says":  [項目 + {"id": "c3.1"}, …],       id は構成メモの中で重複しない
     "shows": 項目 + {"figure": "venn"},        任意。figure は player/src/validate.js の TYPES のキー
     "seconds": 50}                 正の数（任意）
  ],
  "open": ["まだ決めていないこと", …]           任意
}
項目: {"text": "…", "by": "user" | "claude" | "source", "state": "proposed" | "agreed", "source": ["場所か引用", …]}
  by: source なら source が 1 つ以上要る。by: user で state: proposed は誤り（利用者が言ったことは合意済み）。

警告: 章の seconds の合計が basics.length.seconds から 15% を超えてずれている / 項目の text に禁止語がある（by: user の項目は見ない）。
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from check_text import banned, find_banned  # noqa: E402  禁止語は字幕の検査と同じ辞書・同じ探し方で見る

FORMAT = "ugoku-zukai-outline/1"
BY = ("user", "claude", "source")
STATE = ("proposed", "agreed")
READY_BASICS = ("audience", "knows", "takeaway")
ID_RE = re.compile(r"^[A-Za-z0-9_\-ぁ-んァ-ヶ一-龠ー.]+$")  # player/src/validate.js の ID_RE と同じ
LENGTH_TOLERANCE = 0.15
BASICS_LABEL = {
    "audience": "視聴者", "knows": "視聴者が知っている前提", "takeaway": "持ち帰ってほしいこと",
    "can_do": "見終わったらできること", "length": "長さ", "look": "見た目", "voice": "声", "tone": "口調",
}


def figure_types():
    """図の種類。player/src/validate.js の TYPES のキーから読む（一覧を二重に持たない。canvas も含む）"""
    with open(os.path.join(HERE, "..", "player", "src", "validate.js"), encoding="utf-8") as f:
        m = re.search(r"const TYPES = \{(.*?)\n\s*\};", f.read(), re.S)
    if not m:
        sys.exit("validate.js から TYPES を読めない")
    return set(re.findall(r"(\w+)\s*:\s*\[", m.group(1)))


def _text(v):
    return isinstance(v, str) and v.strip() != ""


def _positive(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def _check_item(item, where, errors):
    """項目の形を見る。項目として読めるときだけ True"""
    if not isinstance(item, dict):
        errors.append(f"{where}: 項目は text・by・state を持つオブジェクトで書く")
        return False
    if not _text(item.get("text")):
        errors.append(f"{where}: text がない")
    by, state = item.get("by"), item.get("state")
    if by not in BY:
        errors.append(f"{where}: by は {' / '.join(BY)} のどれか（今は {json.dumps(by, ensure_ascii=False)}）")
    if state not in STATE:
        errors.append(f"{where}: state は {' / '.join(STATE)} のどれか（今は {json.dumps(state, ensure_ascii=False)}）")
    src = item.get("source")
    if src is not None and not (isinstance(src, list) and all(_text(s) for s in src)):
        errors.append(f"{where}: source は文字列の配列で書く")
    elif by == "source" and not src:
        errors.append(f"{where}: by が source なのに source（場所か引用）がない")
    if by == "user" and state == "proposed":
        errors.append(f"{where}: by が user の項目は state を agreed にする（利用者が言ったことは合意済み）")
    return True


def _items(outline):
    """(場所, 人が読む名前, 項目) を、構成メモに書いてある順に返す。形が違うところは飛ばす"""
    out = []
    if not isinstance(outline, dict):
        return out
    basics = outline.get("basics")
    if isinstance(basics, dict):
        for k, v in basics.items():
            if isinstance(v, dict):
                out.append((f"basics.{k}", BASICS_LABEL.get(k, k), v))
    chapters = outline.get("chapters")
    for ch in chapters if isinstance(chapters, list) else []:
        if not isinstance(ch, dict):
            continue
        cid = ch.get("id")
        name = f"{cid} {ch.get('title')}" if _text(ch.get("title")) else str(cid)
        says = ch.get("says")
        for i, s in enumerate(says if isinstance(says, list) else []):
            if isinstance(s, dict):
                where = s["id"] if _text(s.get("id")) else f"{cid}.says[{i}]"
                out.append((where, f"{name} / 言うこと {where}", s))
        if isinstance(ch.get("shows"), dict):
            out.append((f"{cid}.shows", f"{name} / 見せるもの", ch["shows"]))
    return out


def proposed_items(outline):
    """Claude が決めて、利用者がまだ見ていないか答えていない項目（state: proposed）の一覧"""
    return [{"where": where, "label": label, "text": item.get("text") if isinstance(item.get("text"), str) else ""}
            for where, label, item in _items(outline) if item.get("state") == "proposed"]


def check(outline, ready=False):
    """構成メモを点検して (誤り, 警告) を返す"""
    errors, warnings = [], []
    if not isinstance(outline, dict):
        return ["構成メモが JSON のオブジェクトでない"], warnings
    if outline.get("format") != FORMAT:
        errors.append(f'format は "{FORMAT}" と書く（今は {json.dumps(outline.get("format"), ensure_ascii=False)}）')
    if not _text(outline.get("title")):
        errors.append("title（動画の題）がない")

    basics = outline.get("basics")
    if not isinstance(basics, dict):
        errors.append("basics はオブジェクトで書く（キーは audience・knows・takeaway など）")
        basics = {}
    for k, v in basics.items():
        _check_item(v, f"basics.{k}", errors)

    def extra(key, field, ok, shape):
        v = basics.get(key)
        if isinstance(v, dict) and field in v and not ok(v[field]):
            errors.append(f"basics.{key}.{field} は{shape}で書く")
    extra("length", "seconds", _positive, "正の数")
    extra("look", "theme", _text, "文字列（テーマの名前かパス）")
    extra("voice", "speaker", lambda x: isinstance(x, int) and not isinstance(x, bool), "整数")
    extra("voice", "speed", _positive, "正の数")

    chapters = outline.get("chapters")
    if not isinstance(chapters, list):
        errors.append("chapters は配列で書く（まだ章がなければ空の配列）")
        chapters = []
    types = figure_types()
    chapter_ids, say_ids, no_says = set(), set(), []
    for i, ch in enumerate(chapters):
        if not isinstance(ch, dict):
            errors.append(f"chapters[{i}]: 章はオブジェクトで書く")
            continue
        cid = ch.get("id")
        where = f"章「{cid}」" if _text(cid) else f"chapters[{i}]"
        if not _text(cid):
            errors.append(f"{where}: id がない")
        elif not ID_RE.match(cid):
            errors.append(f"{where}: id に使えない文字がある（/ : 空白は不可）")
        elif cid in chapter_ids:
            errors.append(f"{where}: id が重複している")
        else:
            chapter_ids.add(cid)
        if not _text(ch.get("title")):
            errors.append(f"{where}: title がない")
        says = ch.get("says", [])
        if not isinstance(says, list):
            errors.append(f"{where}: says は項目の配列で書く")
            says = []
        if not says:
            no_says.append(where)
        for j, s in enumerate(says):
            w = f"{where}の says[{j}]"
            if not _check_item(s, w, errors):
                continue
            sid = s.get("id")
            if not _text(sid):
                errors.append(f"{w}: id がない")
            elif sid in say_ids:
                errors.append(f"{w}: id「{sid}」が重複している")
            else:
                say_ids.add(sid)
        shows = ch.get("shows")
        if shows is not None and _check_item(shows, f"{where}の shows", errors):
            fig = shows.get("figure")
            if fig is not None and (not isinstance(fig, str) or fig not in types):
                errors.append(f"{where}の shows: figure は {' / '.join(sorted(types))} のどれか（今は {json.dumps(fig, ensure_ascii=False)}）")
        if "seconds" in ch and not _positive(ch["seconds"]):
            errors.append(f"{where}: seconds は正の数で書く")

    op = outline.get("open")
    if op is not None and not (isinstance(op, list) and all(isinstance(x, str) for x in op)):
        errors.append("open は文字列の配列で書く")

    if ready:
        for k in READY_BASICS:
            if k not in basics:
                errors.append(f"台本に進む前に basics.{k}（{BASICS_LABEL[k]}）が要る")
        if not chapters:
            errors.append("台本に進む前に、章（chapters）が 1 つ以上要る")
        for where in no_says:
            errors.append(f"台本に進む前に、{where}の says（言うこと）が要る")

    length = basics.get("length")
    total = length.get("seconds") if isinstance(length, dict) else None
    secs = [ch.get("seconds") for ch in chapters if isinstance(ch, dict)]
    if _positive(total) and secs and all(_positive(s) for s in secs):
        if abs(sum(secs) - total) > total * LENGTH_TOLERANCE:
            warnings.append(f"章の seconds の合計 {sum(secs):g} 秒が、長さ（basics.length.seconds）{total:g} 秒から 15% を超えてずれている")

    terms = banned()
    for where, _label, item in _items(outline):
        if item.get("by") == "user":   # 利用者の言葉はそのまま書く約束。字幕に出たら check_text.py が誤りにする
            continue
        if isinstance(item.get("text"), str):
            for w in find_banned(item["text"], terms):
                warnings.append(f"{where}: text に禁止語「{w}」")
    return errors, warnings


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}
    if len(args) != 1 or flags - {"--ready", "--json"}:
        print(__doc__, file=sys.stderr)
        return 2
    path = os.path.join(args[0], "outline.json") if os.path.isdir(args[0]) else args[0]
    if not os.path.isfile(path):
        print(f"構成メモがない: {path}", file=sys.stderr)
        return 2
    try:
        with open(path, encoding="utf-8") as f:
            outline = json.load(f)
    except ValueError as e:
        outline, errors, warnings = None, [f"JSON として読めない: {e}"], []
    else:
        errors, warnings = check(outline, ready="--ready" in flags)
    if "--json" in flags:
        print(json.dumps({"file": path, "errors": errors, "warnings": warnings,
                          "proposed": proposed_items(outline)}, ensure_ascii=False, indent=2))
    else:
        for e in errors:
            print("誤り:", e)
        for w in warnings:
            print("警告:", w)
        if not errors:
            print("OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
