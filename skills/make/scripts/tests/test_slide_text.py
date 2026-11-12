#!/usr/bin/env python3
"""スライドの文字（見出し・言いたいこと・テキストの部品）にかける検査。禁止語だけを見て、話し言葉の規則はかけない"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)
import check_text  # noqa: E402

BAD = check_text.banned()[0]["word"]


def deck(statement="言いたいこと。", para="段落の文。", items=None, title="見出し"):
    return {"format": "ugoku-zukai/3", "title": "検査", "voice": {"speaker": 8},
            "slides": {"p1": {"title": title, "statement": statement, "parts": [
                {"id": "defs", "type": "text", "blocks": [{"id": "u1", "kind": "para", "text": para},
                                                          {"id": "b", "kind": "bullets", "items": items or ["一つ目"]}]}]}},
            "scenes": [{"id": "s1", "slide": "p1", "lines": [{"id": "l1", "text": "説明します。"}]}]}


def run(sb):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(sb, f, ensure_ascii=False)
    try:
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "check_text.py"), f.name, "--json"], capture_output=True, text=True)
        return r.returncode, json.loads(r.stdout)
    finally:
        os.remove(f.name)


class SlideTextTest(unittest.TestCase):
    def test_slide_text_banned_word(self):
        code, out = run(deck(statement=f"ここに{BAD}がある。", para=f"段落にも{BAD}がある。", items=["よい項目", f"{BAD}の項目"], title=f"{BAD}の見出し"))
        self.assertEqual(code, 1)
        msgs = [e["msg"] for e in out["errors"]]
        for where in ("スライド「p1」の title", "スライド「p1」の statement", "スライド「p1」の defs/u1", "スライド「p1」の defs/b.2"):
            self.assertTrue(any(where in m and BAD in m for m in msgs), f"{where} がない: {msgs}")
        self.assertTrue(all(e["rule"] == "S-M2" for e in out["errors"]))
        self.assertFalse(any("defs/b.1" in m for m in msgs))

    def test_slide_text_skips_spoken_rules(self):
        long_no = "利用者の目的の達成の度合いのことを、" + "長い文を続けて" * 8 + "書いたものなのだ"
        code, out = run(deck(statement="Kubernetes を使う。", para=long_no))
        self.assertEqual(code, 0, out)
        self.assertEqual(out["errors"], [])
        self.assertEqual(out["warnings"], [])

    def test_em_markers_removed(self):
        half = len(BAD) // 2 or 1
        code, out = run(deck(para=f"強調の中の**{BAD}**と、またいだ{BAD[:half]}**{BAD[half:]}**。"))
        self.assertEqual(code, 1)
        self.assertEqual(len([e for e in out["errors"] if "defs/u1" in e["msg"]]), 1)

    def test_text_figure_in_figures(self):
        sb = deck()
        sb["figures"] = {"memo": {"type": "text", "blocks": [{"id": "m1", "kind": "para", "text": f"{BAD}の文。"}]}}
        code, out = run(sb)
        self.assertEqual(code, 1)
        self.assertTrue(any("図「memo」の m1" in e["msg"] for e in out["errors"]), out)

    def test_legacy_storyboard_unchanged(self):
        sb = json.load(open(os.path.join(SCRIPTS, "..", "examples", "sequence.json"), encoding="utf-8"))
        self.assertEqual(run(sb)[0], 0)


if __name__ == "__main__":
    unittest.main()
