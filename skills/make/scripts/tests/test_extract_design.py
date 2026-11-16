#!/usr/bin/env python3
"""デザインの取り込み（extract_design.py）の検査。名前付きのトークンと別名（claude.ai の Design System の tokens.json の形）から、
役割を読み違えないこと。python3 test_extract_design.py で回す。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
EXTRACT = os.path.join(SCRIPTS, "extract_design.py")
CHECK = os.path.join(SCRIPTS, "check_theme.py")
sys.path.insert(0, SCRIPTS)
import uz_color as UC  # noqa: E402


class NamedTokensTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.report_path = os.path.join(cls.tmp.name, "r.json")
        cls.theme_path = os.path.join(cls.tmp.name, "t.json")
        r = subprocess.run([sys.executable, EXTRACT, os.path.join(HERE, "design", "named-tokens.json"),
                            "--report", cls.report_path, "--theme", cls.theme_path, "--name", "t"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        with open(cls.theme_path, encoding="utf-8") as f:
            cls.theme = json.load(f)
        with open(cls.report_path, encoding="utf-8") as f:
            cls.report = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_bg_is_the_page_surface(self):      # 背景は、いちばん白い色ではなく、ページの地（surface-page = c-paper）
        self.assertEqual(self.theme["colors"]["bg"], "#f1efe9")

    def test_ink_is_body_text(self):
        self.assertEqual(self.theme["colors"]["ink"], "#222222")

    def test_accent_keeps_hue_of_accent_token(self):   # 強調は accent = c-teal の色相。見出しの紺（c-deep）や暖色ではない
        acc, teal = UC.parse(self.theme["colors"]["accent"]), UC.parse("#3aa6a0")
        dh = abs(((UC.hls(acc)[0] - UC.hls(teal)[0] + 0.5) % 1) - 0.5)
        self.assertLess(dh, 0.03, self.theme["colors"]["accent"])
        self.assertGreaterEqual(UC.contrast(acc, UC.parse(self.theme["colors"]["bg"])), 4.5)   # 文字に使えるところまで暗くしてある

    def test_surface_is_the_card_surface(self):
        self.assertEqual(self.theme["colors"]["surface"], "#ffffff")

    def test_no_shadow_when_tokens_say_none(self):
        self.assertIs(self.theme["shape"]["shadow"], False)

    def test_fonts_from_type_families(self):
        self.assertTrue(self.theme["font"]["family"].startswith('"Zen Kaku Gothic New"'), self.theme["font"]["family"])
        self.assertIn("Zen Kaku Gothic New", [f["family"] for f in self.report["fonts"]])

    def test_roles_use_design_colors(self):     # 役割の色に、デザインの有彩色（暖色の c-sun）が入る。色相を回した色だけにならない
        sun = UC.hls(UC.parse("#f2b53c"))[0]
        hues = [UC.hls(UC.parse(self.theme["colors"]["roles"][r]))[0] for r in ("actor", "process", "store", "external")]
        self.assertTrue(any(abs(((h - sun + 0.5) % 1) - 0.5) < 0.04 for h in hues), self.theme["colors"]["roles"])

    # ---- 図の色（役割の色）がデザインからぶれない。利用者の指摘「テーマのブレを感じたのは、主に図の色」 ----
    def hue(self, hx):
        return UC.hls(UC.parse(hx))[0]

    def near(self, a, b, tol=0.04):
        return abs(((self.hue(a) - self.hue(b) + 0.5) % 1) - 0.5) < tol

    def test_default_box_gets_the_main_color(self):   # 既定の箱（process）は、デザインの主色（accent = c-teal）
        self.assertTrue(self.near(self.theme["colors"]["roles"]["process"], "#3aa6a0"), self.theme["colors"]["roles"])

    def test_roles_are_all_from_design(self):   # デザインに色が足りるなら、色相を回した色を作らない
        r = subprocess.run([sys.executable, CHECK, self.theme_path, "--design", self.report_path], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("roles.", "".join(l for l in r.stdout.splitlines() if "注意" in l), r.stdout)

    def test_uses_designs_own_darker_color(self):   # 明るすぎる色は、計算で暗くする前に、デザインにある同じ色相の暗い色を使う
        roles = self.theme["colors"]["roles"]
        self.assertIn("#8a5a08", [roles[r] for r in ("actor", "process", "store", "external")], roles)

    def test_font_stack_has_no_duplicates(self):
        fams = [f.strip() for f in self.theme["font"]["family"].split(",")]
        self.assertEqual(len(fams), len(set(fams)), fams)

    def test_report_uses_token_names(self):     # 報告の色の名前は、配列の番号（color.tokens.0）ではなくトークンの名前
        names = {n for c in self.report["colors"] for n in c["names"]}
        self.assertIn("surface-page", names)
        self.assertIn("c-teal", names)
        self.assertIn("link", names)             # 別名の別名も解ける
        self.assertFalse([n for n in names if n.startswith("color.tokens.")], names)

    def test_draft_passes_check_theme(self):
        r = subprocess.run([sys.executable, CHECK, self.theme_path], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
