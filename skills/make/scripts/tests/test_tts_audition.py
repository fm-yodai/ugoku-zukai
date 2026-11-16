#!/usr/bin/env python3
"""声の試聴（tts.py --audition）の検査。VOICEVOX が無くても回る（合成はしない）。python3 test_tts_audition.py で回す。"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import tts  # noqa: E402

TTS = os.path.join(HERE, "..", "tts.py")
VOICES = [{"id": 8, "name": "春日部つむぎ", "style": "ノーマル", "wav": b"RIFFxxxx"},
          {"id": 2, "name": "四国めたん", "style": "ノーマル", "wav": b"RIFFyyyy"},
          {"id": 0, "name": "四国めたん", "style": "あまあま", "wav": b"RIFFzzzz"}]


class AuditionTest(unittest.TestCase):
    def test_parse_speakers(self):
        self.assertEqual(tts.parse_speakers("8,2,3"), [8, 2, 3])
        self.assertEqual(tts.parse_speakers(" 8 , 2 "), [8, 2])
        for bad in ("", "a", "8,,2", "8,8", "1,2,3,4,5,6,7", "-1"):
            with self.assertRaises(ValueError, msg=bad):
                tts.parse_speakers(bad)

    def test_sample_of_first_line(self):
        sb = {"scenes": [{"id": "s1", "lines": [{"id": "l1", "text": "まず{a}全体を 見ます。", "read": "まず{a}ぜんたいを 見ます。"}]}]}
        self.assertEqual(tts.sample_of(sb), "まずぜんたいを見ます。")

    def test_sample_of_empty_storyboard(self):
        self.assertEqual(tts.sample_of({"scenes": []}), "")

    def test_html_lists_voices_and_credit(self):
        html = tts.audition_html("聞き比べる文です。", VOICES, 1.1)
        for w in ("春日部つむぎ（ノーマル）", "四国めたん（あまあま）", "話者 8", "話者 0", "聞き比べる文です。", "AudioContext", "声の試聴"):
            self.assertIn(w, html)
        self.assertEqual(html.count("VOICEVOX:四国めたん"), 1)   # 同じ名前のクレジットは 1 回
        self.assertIn("VOICEVOX:春日部つむぎ", html)
        self.assertNotIn("<audio", html)

    def test_html_escapes_sample(self):
        html = tts.audition_html('a<b>&"c', VOICES[:1], 1.1)
        self.assertIn("a&lt;b&gt;&amp;", html)
        self.assertNotIn("a<b>", html)

    def test_html_escapes_voice_name(self):
        html = tts.audition_html("文。", [{"id": 1, "name": "<i>x</i>", "style": "s", "wav": b"RIFF"}], 1.1)
        self.assertNotIn("<i>x</i>", html)

    def test_html_artifact_and_theme(self):
        full, frag = tts.audition_html("文。", VOICES[:1], 1.1), tts.audition_html("文。", VOICES[:1], 1.1, artifact=True)
        self.assertIn("<html", full)
        self.assertNotIn("<html", frag)
        self.assertNotIn("<body", frag)
        for h in (full, frag):
            self.assertIn("<title>", h)
            self.assertIn("prefers-color-scheme: dark", h)
            self.assertIn('[data-theme="dark"]', h)

    def test_html_no_external(self):
        # 外の JS やスタイルを読まない（1 枚で動く）
        html = tts.audition_html("文。", VOICES, 1.1)
        self.assertNotIn("src=", html)
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)

    def test_usage_errors(self):
        # どれも終了コード 2 で、出力先に何も作らない（VOICEVOX がなくても同じ）
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "voice")
            for args in (["--audition", "8,2"],                      # 文も台本もない
                         ["--audition", "abc", "--sample", "文。"],   # 話者が整数でない
                         ["--audition", "8", "--sample", "  "],       # 文が空白だけ
                         []):                                         # 台本も --audition もない
                r = subprocess.run([sys.executable, TTS, "-o", out, *args], capture_output=True, text=True)
                self.assertEqual(r.returncode, 2, (args, r.stdout, r.stderr))
                self.assertFalse(os.path.exists(out), args)


if __name__ == "__main__":
    unittest.main()
