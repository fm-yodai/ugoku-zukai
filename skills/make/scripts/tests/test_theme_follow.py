#!/usr/bin/env python3
"""決めたテーマに従う仕組みの検査。python3 test_theme_follow.py で回す。
(1) 台本と同じフォルダの構成メモが見た目（basics.look.theme）を決めていたら、検査・コマ・組み立てはそのテーマを使い、違うテーマを渡すと止まる
(2) デザインから作ったテーマが、取り込みの報告（design-report.json）の色・字体・影から外れていないかを check_theme.py --design が見る"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
SKILL = os.path.join(SCRIPTS, "..")
CHECK = os.path.join(SCRIPTS, "check_storyboard.cjs")
FRAMES = os.path.join(SCRIPTS, "frames.cjs")
BUILD = os.path.join(SCRIPTS, "build_player.py")
CHECK_THEME = os.path.join(SCRIPTS, "check_theme.py")
EXTRACT = os.path.join(SCRIPTS, "extract_design.py")
KUMO = os.path.join(SKILL, "examples", "themes", "kumo.json")


def run(*cmd):
    return subprocess.run(list(cmd), capture_output=True, text=True)


class FollowOutlineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wd = self.tmp.name
        self.sb = os.path.join(self.wd, "storyboard.json")
        shutil.copy(os.path.join(SKILL, "examples", "graph-flow.json"), self.sb)

    def tearDown(self):
        self.tmp.cleanup()

    def look(self, theme):
        with open(os.path.join(self.wd, "outline.json"), "w", encoding="utf-8") as f:
            json.dump({"basics": {"look": {"text": "見た目", "theme": theme, "by": "user", "state": "agreed"}}}, f, ensure_ascii=False)

    def check(self, *extra):
        return run("node", CHECK, self.sb, "--json", *extra)

    def test_no_outline_keeps_default(self):
        self.assertEqual(json.loads(self.check().stdout)["theme"], "3b1b")
        self.assertEqual(json.loads(self.check("--theme", "flat").stdout)["theme"], "flat")

    def test_uses_decided_theme_when_omitted(self):
        self.look("flat")
        self.assertEqual(json.loads(self.check().stdout)["theme"], "flat")

    def test_refuses_other_theme(self):
        self.look("flat")
        r = self.check("--theme", "3b1b")
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("構成メモ", r.stderr)
        self.assertIn("flat", r.stderr)
        self.assertEqual(self.check("--theme", "flat").returncode, 0)

    def test_decided_theme_file_in_workdir(self):
        shutil.copy(KUMO, os.path.join(self.wd, "theme.json"))
        self.look("theme.json")
        self.assertEqual(json.loads(self.check().stdout)["theme"], "kumo")
        self.assertEqual(self.check("--theme", os.path.join(self.wd, "theme.json")).returncode, 0)
        r = self.check("--theme", "flat")     # 見本のコマンドの --theme flat を写しても、決めたテーマから外れない
        self.assertEqual(r.returncode, 2)
        self.assertIn("theme.json", r.stderr)

    def test_decided_theme_missing(self):
        self.look("theme.json")                # 構成メモは theme.json と言うが、ファイルがない
        r = self.check()
        self.assertEqual(r.returncode, 2)
        self.assertIn("theme.json", r.stderr)

    def test_frames_follow(self):
        self.look("flat")
        out = os.path.join(self.wd, "frames")
        r = run("node", FRAMES, self.sb, "--theme", "3b1b", "-o", out)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("構成メモ", r.stderr)
        self.assertFalse(os.path.exists(out))
        r = run("node", FRAMES, self.sb, "-o", out)
        self.assertIn(r.returncode, (0, 4), r.stderr)
        with open(os.path.join(out, "svg", "l1.svg"), encoding="utf-8") as f:
            svg = f.read()
        with open(os.path.join(SKILL, "player", "themes", "flat.json"), encoding="utf-8") as f:
            self.assertIn(json.load(f)["colors"]["bg"], svg)

    def test_build_follows(self):
        self.look("flat")
        out = os.path.join(self.wd, "p.html")
        r = run(sys.executable, BUILD, self.sb, "--theme", "3b1b", "-o", out)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("構成メモ", r.stderr)
        self.assertFalse(os.path.exists(out))
        r = run(sys.executable, BUILD, self.sb, "-o", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as f:
            self.assertIn('"name": "flat"', f.read())


class FollowDesignTest(unittest.TestCase):
    """check_theme.py --design: テーマが、取り込んだデザインから外れていない"""
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.report = os.path.join(cls.tmp.name, "design-report.json")
        cls.draft = os.path.join(cls.tmp.name, "draft.json")
        r = run(sys.executable, EXTRACT, os.path.join(HERE, "design", "named-tokens.json"), "--report", cls.report, "--theme", cls.draft, "--name", "t")
        assert r.returncode == 0, r.stderr

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def theme(self, change=None):
        with open(self.draft, encoding="utf-8") as f:
            th = json.load(f)
        if change:
            change(th)
        p = os.path.join(self.tmp.name, "t.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(th, f, ensure_ascii=False)
        return p

    def design(self, change=None):
        return run(sys.executable, CHECK_THEME, self.theme(change), "--design", self.report)

    def test_draft_follows_design(self):
        r = self.design()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("デザインに沿っている", r.stdout)

    def test_bg_from_elsewhere(self):          # 見本のテーマの背景を写した
        r = self.design(lambda th: th["colors"].update(bg="#fbf7f0"))
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("bg", r.stdout)
        self.assertIn("デザインにない", r.stdout)

    def test_accent_other_hue(self):           # 強調色を、デザインにない色相にした
        r = self.design(lambda th: th["colors"].update(accent="#b02a8f"))
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("accent", r.stdout)

    def test_accent_darkened_is_ok(self):      # 色相を保って明るさを動かすのは、沿っている
        self.assertEqual(self.design(lambda th: th["colors"].update(accent="#1f6f6b")).returncode, 0)

    def test_font_from_elsewhere(self):
        r = self.design(lambda th: th["font"].update(family='"Inter", sans-serif'))
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("字体", r.stdout)

    def test_shadow_against_design(self):
        r = self.design(lambda th: th["shape"].update(shadow=True))
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("影", r.stdout)

    def test_role_not_in_design_is_note(self):  # 役割の色は、足りなければ色相を回して作ってよい（注意に留める）
        r = self.design(lambda th: th["colors"]["roles"].update(external="#7a3fb0"))
        self.assertIn("roles.external", r.stdout)
        self.assertIn("注意", r.stdout)

    def test_without_design_unchanged(self):
        r = run(sys.executable, CHECK_THEME, self.theme())
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("デザイン", r.stdout)

    def test_report_missing(self):
        r = run(sys.executable, CHECK_THEME, self.theme(), "--design", os.path.join(self.tmp.name, "nai.json"))
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
