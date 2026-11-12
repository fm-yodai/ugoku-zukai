#!/usr/bin/env python3
"""スライドの案を作る・コマを書く・選ぶ道具（alts.py）の検査。python3 test_alts.py で回す"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
EX = os.path.join(SCRIPTS, "..", "examples")
ALTS = os.path.join(SCRIPTS, "alts.py")
sys.path.insert(0, HERE)
import alt_fixture  # noqa: E402


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(o, p):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False, indent=2)


class AltsTest(unittest.TestCase):
    def setUp(self):
        self.wd = tempfile.mkdtemp()
        shutil.copy(os.path.join(EX, "slide-forms.json"), os.path.join(self.wd, "storyboard.json"))
        shutil.copy(os.path.join(EX, "outlines", "slide-forms.json"), os.path.join(self.wd, "outline.json"))
        shutil.copytree(os.path.join(EX, "assets"), os.path.join(self.wd, "assets"))

    def tearDown(self):
        shutil.rmtree(self.wd)

    def p(self, *a):
        return os.path.join(self.wd, *a)

    def run_alts(self, *args):
        return subprocess.run([sys.executable, ALTS, *args], capture_output=True, text=True)

    def new_b(self):
        """案 a = 今の台本、案 b = definitions を 2 枚に分けた台本。alts.json に案 b のスライドと意図も書く"""
        r = self.run_alts("new", self.wd, "g1", "--replaces", "definitions", "--options", "a,b", "--keep-current")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        alts = load(self.p("alts.json"))
        opt = alts["groups"][0]["options"][1]
        dump(alt_fixture.variant_b(load(self.p("storyboard.json"))), self.p(opt["storyboard"]))
        opt["slides"], opt["diff"] = alt_fixture.OPTION_B_SLIDES, "定義を 2 枚に分ける"
        dump(alts, self.p("alts.json"))
        return alts

    def test_new_and_frames(self):
        alts = self.new_b()
        g = alts["groups"][0]
        self.assertEqual(g["replaces"], ["definitions"])
        self.assertEqual([(o["key"], o["name"], o["storyboard"]) for o in g["options"]],
                         [("a", "案 A", "storyboard.json"), ("b", "案 B", "storyboard.g1-b.json")])
        self.assertTrue(os.path.isfile(self.p("storyboard.g1-b.json")))   # 台本と同じフォルダ（画像の相対パスと、構成メモのテーマがそのまま効く）
        r = self.run_alts("frames", self.wd)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        fb = load(self.p(g["options"][1]["frames"], "frames.json"))
        self.assertEqual(sorted({ln["scene"] for ln in fb["lines"]}), ["s3a", "s3b"])   # 案のスライドを使う場面だけ
        self.assertTrue(os.path.isfile(self.p("frames", "frames.json")))
        out = self.p("sheet.html")
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "build_sheet.py"), self.p("storyboard.json"), "--frames", self.p("frames"),
                            "--outline", self.p("outline.json"), "--alts", self.p("alts.json"), "-o", out], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(out, encoding="utf-8").read().count('class="us-alt"'), 2)

    def test_pick_merges(self):
        self.new_b()
        r = self.run_alts("pick", self.wd, "g1", "案 B")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        sb = load(self.p("storyboard.json"))
        self.assertNotIn("definitions", sb["slides"])
        self.assertEqual(list(sb["slides"]), ["relation", "def-usability", "def-ux", "ux-def", "whose"])
        self.assertEqual([sc["id"] for sc in sb["scenes"]], ["s1", "s2", "s3a", "s3b", "s4", "s5", "s6"])
        r = subprocess.run(["node", os.path.join(SCRIPTS, "check_storyboard.cjs"), self.p("storyboard.json"), "--outline", self.p("outline.json")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        ol = load(self.p("outline.json"))
        c2 = ol["chapters"][1]["slides"]
        self.assertEqual([s["id"] for s in c2], ["def-usability", "def-ux", "ux-def"])
        self.assertEqual(c2[0]["intent"], {"text": "ユーザビリティの定義だけを、落ち着いて読める", "by": "claude", "state": "agreed"})
        self.assertEqual(c2[1]["link"]["text"], "同じ形で、広いほうの語に進む")
        self.assertEqual(subprocess.run([sys.executable, os.path.join(SCRIPTS, "check_outline.py"), self.p("outline.json"), "--ready"], capture_output=True).returncode, 0)
        for gone in ("alts.json", "alts", "storyboard.g1-b.json"):
            self.assertFalse(os.path.exists(self.p(gone)), gone)

    def test_pick_by_key(self):
        self.new_b()
        self.assertEqual(self.run_alts("pick", self.wd, "g1", "b").returncode, 0)
        self.assertIn("def-ux", load(self.p("storyboard.json"))["slides"])

    def test_pick_current(self):
        self.new_b()
        before = [open(self.p(f), "rb").read() for f in ("storyboard.json", "outline.json")]
        r = self.run_alts("pick", self.wd, "g1", "案 A")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([open(self.p(f), "rb").read() for f in ("storyboard.json", "outline.json")], before)
        self.assertFalse(os.path.exists(self.p("alts.json")))
        self.assertFalse(os.path.exists(self.p("storyboard.g1-b.json")))

    def test_pick_rejects_collision(self):
        alts = self.new_b()
        path = self.p(alts["groups"][0]["options"][1]["storyboard"])
        sb = load(path)
        next(sc for sc in sb["scenes"] if sc["id"] == "s3a")["lines"][0]["id"] = "l2"   # 範囲の外の行と同じ id
        dump(sb, path)
        before = open(self.p("storyboard.json"), "rb").read()
        r = self.run_alts("pick", self.wd, "g1", "案 B")
        self.assertEqual(r.returncode, 1)
        self.assertIn("l2", r.stdout + r.stderr)
        self.assertEqual(open(self.p("storyboard.json"), "rb").read(), before)
        self.assertTrue(os.path.exists(self.p("alts.json")))

    def test_pick_rejects_broken_option(self):
        alts = self.new_b()
        path = self.p(alts["groups"][0]["options"][1]["storyboard"])
        sb = load(path)
        sb["slides"]["def-ux"]["parts"][0]["blocks"][0]["kind"] = "memo"   # 台本の形の誤り
        dump(sb, path)
        before = open(self.p("storyboard.json"), "rb").read()
        r = self.run_alts("pick", self.wd, "g1", "案 B")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(open(self.p("storyboard.json"), "rb").read(), before)

    def test_drop(self):
        self.new_b()
        self.assertEqual(self.run_alts("drop", self.wd, "g1").returncode, 0)
        for gone in ("alts.json", "alts", "storyboard.g1-b.json"):
            self.assertFalse(os.path.exists(self.p(gone)), gone)
        self.assertIn("definitions", load(self.p("storyboard.json"))["slides"])

    def test_usage_errors(self):
        for args in (("new", self.wd, "g1", "--replaces", "nai", "--options", "a,b"),
                     ("new", self.wd, "g1", "--replaces", "relation,ux-def", "--options", "a,b"),
                     ("new", self.wd, "g1", "--replaces", "definitions", "--options", "a"),
                     ("new", self.wd, "g1", "--replaces", "definitions", "--options", "a,b,c,d,e"),
                     ("new", self.wd, "g1", "--replaces", "definitions", "--options", "a,a"),
                     ("new", self.wd, "g/1", "--replaces", "definitions", "--options", "a,b"),
                     ("pick", self.wd, "g1", "案 B"), ("drop", self.wd, "g9"), ("frames", self.wd)):
            r = self.run_alts(*args)
            self.assertEqual(r.returncode, 2, args)
            self.assertFalse(os.path.exists(self.p("alts.json")), args)
        self.new_b()
        self.assertEqual(self.run_alts("new", self.wd, "g1", "--replaces", "ux-def", "--options", "a,b").returncode, 2)   # 同じ名前の組
        self.assertEqual(self.run_alts("new", self.wd, "g2", "--replaces", "definitions", "--options", "a,b").returncode, 2)   # 同じスライドを 2 つの組に
        self.assertEqual(self.run_alts("pick", self.wd, "g1", "案 Z").returncode, 2)


if __name__ == "__main__":
    unittest.main()
