#!/usr/bin/env python3
"""tts.py の整形（スペースを消す・印をずらす）と辞書の鍵の検査。voicevox_core は使わない。"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import tts  # noqa: E402


class TtsTextTest(unittest.TestCase):
    def test_normalize_table(self):
        for src, want in [("9 段で、5 つの", "9段で、5つの"), ("Claude Code では", "Claude Codeでは"),
                          ("build_player.py の status", "build_player.pyのstatus"), ("Claude 3 と M3 の", "Claude 3とM3の"),
                          ("レッジャー ドット パイ の", "レッジャードットパイの"), ("全角　スペース", "全角スペース")]:
            self.assertEqual(tts.normalize(src, {})[0], want)

    def test_normalize_keeps_comma(self):
        self.assertEqual(tts.normalize("手順は、9 段です", {})[0], "手順は、9段です")

    def test_normalize_shifts_marks(self):
        text, marks = tts.parse_marks("9 段で、{a}5 つの {b}担当")
        text, marks = tts.normalize(text, marks)
        self.assertEqual(text, "9段で、5つの担当")
        self.assertEqual(marks, {"a": 4, "b": 7})   # 元は a=5・b=10。印より前で消したスペースの数（1 つ・3 つ）だけ前へ

    def test_normalize_space_run(self):
        self.assertEqual(tts.normalize("Claude  Code", {})[0], "Claude Code")
        text, marks = tts.normalize(*tts.parse_marks("Claude {a} Code"))
        self.assertEqual(text, "Claude Code")
        self.assertEqual(marks, {"a": 7})
        self.assertEqual(text[marks["a"]], "C")

    def test_rows_keep_original_text(self):
        sb = {"scenes": [{"id": "s1", "lines": [{"id": "l1", "text": "{a}9 段で"}]}]}
        r = tts.collect(sb)[0]
        self.assertEqual(r["text"], "9 段で")
        self.assertEqual(r["spoken"], "9段で")
        self.assertEqual(r["marks"], {"a": 0})

    def test_dict_key_changes_with_extra(self):
        with tempfile.TemporaryDirectory() as d:
            extra = os.path.join(d, "voice_dict.json")
            with open(extra, "w", encoding="utf-8") as f:
                json.dump({"words": [{"surface": "各行", "pronunciation": "カクギョウ"}]}, f, ensure_ascii=False)
            self.assertNotEqual(tts.dict_key_of([tts.USER_DICT]), tts.dict_key_of([tts.USER_DICT, extra]))
        self.assertEqual(tts.dict_key_of(["/no/such/file"]), "none")


if __name__ == "__main__":
    unittest.main()
