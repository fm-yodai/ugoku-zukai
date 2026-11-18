#!/usr/bin/env python3
"""既定のテーマ（koo）と、デザインにある色だけでテーマを作る約束の検査。python3 test_theme_koo.py で回す。
(1) 同梱のテーマは koo（既定。色はテーマの tokens に書いたものだけ）と kuro（暗い地の数学動画調）の 2 つ
(2) check_theme.py が、章扉（chapter）と箱の色（colors.boxes）の読みやすさを見る
(3) extract_design.py は、デザインに緑・赤がなければ足さず、反転面の色があれば字幕の帯と章扉に当てる"""
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
SKILL = os.path.join(SCRIPTS, "..")
THEMES = os.path.join(SKILL, "player", "themes")
KOO = os.path.join(THEMES, "koo.json")
CHECK_THEME = os.path.join(SCRIPTS, "check_theme.py")
EXTRACT = os.path.join(SCRIPTS, "extract_design.py")


def run(*cmd):
    return subprocess.run(list(cmd), capture_output=True, text=True)


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class KooTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.th = load(KOO)

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, th):
        p = os.path.join(self.tmp.name, "t.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(th, f, ensure_ascii=False)
        return run(sys.executable, CHECK_THEME, p)

    def test_bundled_themes(self):
        self.assertEqual(sorted(os.listdir(THEMES)), ["koo.json", "kuro.json"])

    def test_passes(self):
        r = run(sys.executable, CHECK_THEME, KOO)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_every_color_is_a_token(self):       # テーマの色は、tokens に書いた色だけ（デザインにない色を足していない）
        tokens = {k.lower() for k in self.th["tokens"]}
        body = json.dumps({k: self.th[k] for k in ("colors", "subtitle", "chapter")})
        used = {c.lower() for c in re.findall(r"#[0-9a-fA-F]{6}", body)}
        self.assertEqual(used - tokens, set())

    def test_subtitle_and_chapter_are_navy(self):
        self.assertEqual(self.th["subtitle"]["bg"], "#0c1b32")
        self.assertEqual(self.th["chapter"]["bg"], "#0c1b32")

    def test_no_green_or_red(self):               # 良い・悪いは、Gold とグレーアウトで言い分ける
        self.assertEqual((self.th["colors"]["good"], self.th["colors"]["bad"]), ("#8c5e0a", "#4f5762"))
        self.assertEqual(self.th["colors"]["boxes"]["added"], {"fill": "#fbefd3", "border": "#f2b53c"})
        self.assertEqual(self.th["colors"]["boxes"]["removed"]["fill"], "#c9cfd9")

    def test_chapter_contrast(self):
        th = copy.deepcopy(self.th)
        th["chapter"]["ink"] = "#4f5762"
        r = self.check(th)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("章扉の文字", r.stdout)

    def test_box_label_contrast(self):
        th = copy.deepcopy(self.th)
        th["colors"]["boxes"]["muted"]["label"] = "#c9cfd9"
        r = self.check(th)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("muted の面", r.stdout)


def tokens(extra=()):
    base = [("c-base", "#edf0f5", "page background"), ("c-ink", "#1f1f1f", "body text"), ("c-blue", "#5090d9", "accent"),
            ("c-gold", "#f2b53c", "warm accent"), ("c-gold-deep", "#8c5e0a", "gold text"), ("c-gray-600", "#4f5762", "sub text")]
    return {"color": {"tokens": [{"name": n, "value": v, "usage": u} for n, v, u in list(base) + list(extra)]}}


class DraftTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def draft(self, tok):
        d = self.tmp.name
        with open(os.path.join(d, "tokens.json"), "w", encoding="utf-8") as f:
            json.dump(tok, f)
        r = run(sys.executable, EXTRACT, os.path.join(d, "tokens.json"), "--report", os.path.join(d, "r.json"), "--theme", os.path.join(d, "t.json"), "--name", "t")
        self.assertEqual(r.returncode, 0, r.stderr)
        return load(os.path.join(d, "t.json")), os.path.join(d, "t.json"), os.path.join(d, "r.json")

    def test_no_green_or_red_is_added(self):      # デザインに緑・赤がなければ、足さない。良い = デザインの別の有彩色、悪い = 補足の色
        th, tp, rp = self.draft(tokens())
        self.assertEqual(th["colors"]["good"], "#8c5e0a")
        self.assertEqual(th["colors"]["bad"], "#4f5762")
        r = run(sys.executable, CHECK_THEME, tp, "--design", rp)
        self.assertEqual(r.returncode, 0, r.stdout)
        notes = [ln for ln in r.stdout.splitlines() if "デザインにない色" in ln]
        self.assertFalse([ln for ln in notes if re.search(r"注意: (good|bad|warn) ", ln)], r.stdout)

    def test_designs_own_success_and_error(self):  # デザインが成功・失敗の色を持っていれば、それを使う
        th, _, _ = self.draft(tokens([("success", "#1e8a4c", "ok"), ("error", "#c9362b", "ng")]))
        self.assertEqual((th["colors"]["good"], th["colors"]["bad"]), ("#1e8a4c", "#c9362b"))

    def test_inverse_color_for_subtitle_and_chapter(self):
        th, _, _ = self.draft(tokens([("surface-inverse", "#0c1b32", "cover, chapter")]))
        self.assertEqual(th["subtitle"], {"bg": "#0c1b32", "ink": "#ffffff"})
        self.assertEqual(th["chapter"], {"bg": "#0c1b32", "ink": "#ffffff"})

    def test_no_inverse_no_chapter(self):
        th, _, _ = self.draft(tokens())
        self.assertNotIn("chapter", th)


if __name__ == "__main__":
    unittest.main()
