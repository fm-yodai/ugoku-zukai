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

    # ---- レビューで見つかったこと ----
    def snapshot(self):
        out = {}
        for d, _, fs in os.walk(self.wd):
            for f in fs:
                out[os.path.relpath(os.path.join(d, f), self.wd)] = open(os.path.join(d, f), "rb").read()
        return out

    def test_cleanup_never_leaves_workdir(self):
        outside = tempfile.mkdtemp()
        try:
            victim = os.path.join(outside, "victim.json")
            dump({"keep": True}, victim)
            for change in (lambda g: g.update(id=".."),
                           lambda g: g["options"][1].update(storyboard=os.path.relpath(victim, self.wd)),
                           lambda g: g["options"][1].update(frames="../x"),
                           lambda g: g["options"][0].update(storyboard="./storyboard.json"),   # 今の台本を別の書き方で指す
                           lambda g: g["options"][1].update(key="../b")):
                alts = self.new_b()
                change(alts["groups"][0])
                dump(alts, self.p("alts.json"))
                before = self.snapshot()
                for args in (("drop", self.wd, alts["groups"][0]["id"]), ("pick", self.wd, alts["groups"][0]["id"], "案 B"), ("frames", self.wd)):
                    r = self.run_alts(*args)
                    self.assertEqual(r.returncode, 2, (args, r.stdout, r.stderr))
                    self.assertEqual(self.snapshot(), before, args)
                self.assertTrue(os.path.isfile(victim))
                os.remove(self.p("alts.json")); os.remove(self.p("storyboard.g1-b.json"))
        finally:
            shutil.rmtree(outside)

    def test_alts_json_shape_errors(self):
        for change, word in ((lambda o: o.update(slides=[{"intent": "x"}]), "id"),
                             (lambda o: o.update(slides=[{"id": "def-ux", "intent": {"text": "x", "by": "claude", "state": "agreed"}}]), "intent は文字列"),
                             (lambda o: o.update(slides="def-ux"), "slides")):
            alts = self.new_b()
            change(alts["groups"][0]["options"][1])
            dump(alts, self.p("alts.json"))
            for args in (("pick", self.wd, "g1", "b"), ("frames", self.wd)):
                r = self.run_alts(*args)
                self.assertEqual(r.returncode, 2, (args, r.stderr))
                self.assertIn(word, r.stderr)
                self.assertNotIn("Traceback", r.stderr)
            os.remove(self.p("alts.json")); os.remove(self.p("storyboard.g1-b.json"))

    def test_pick_rejects_unlisted_scene(self):   # 案の台本に、slides に書いていないスライドの場面がある → 黙って捨てない
        alts = self.new_b()
        alts["groups"][0]["options"][1]["slides"] = alt_fixture.OPTION_B_SLIDES[:1]
        dump(alts, self.p("alts.json"))
        before = self.snapshot()
        r = self.run_alts("pick", self.wd, "g1", "b")
        self.assertEqual(r.returncode, 1)
        self.assertIn("s3b", r.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_pick_rejects_shared_figure_change(self):   # 案が、範囲の外でも使う図を書き換えている → 止める
        alts = self.new_b()
        path = self.p(alts["groups"][0]["options"][1]["storyboard"])
        sb = load(path)
        sb["figures"]["rel"]["shapes"][1]["text"] = "CHANGED"
        sb["slides"]["def-ux"]["parts"].insert(0, {"figure": "rel", "area": {"col": [1, 4], "row": [1, 6]}})
        sb["slides"]["def-ux"]["parts"][1]["area"] = {"col": [5, 12], "row": [1, 6]}
        dump(sb, path)
        before = self.snapshot()
        r = self.run_alts("pick", self.wd, "g1", "b")
        self.assertEqual(r.returncode, 1)
        self.assertIn("図「rel」", r.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_pick_rejects_outside_slide_id(self):   # 案の slides に、範囲の外のスライドの id
        alts = self.new_b()
        alts["groups"][0]["options"][1]["slides"] = alt_fixture.OPTION_B_SLIDES + [{"id": "whose", "intent": "x"}]
        dump(alts, self.p("alts.json"))
        r = self.run_alts("pick", self.wd, "g1", "b")
        self.assertEqual(r.returncode, 1)
        self.assertIn("whose", r.stderr)

    def test_pick_checks_outline(self):   # 構成メモにまだ書いていなかったスライドを置き換える → 案の場面の章に足す
        ol = load(self.p("outline.json"))
        ol["chapters"][1]["slides"] = [x for x in ol["chapters"][1]["slides"] if x["id"] != "definitions"]
        dump(ol, self.p("outline.json"))
        self.new_b()
        r = self.run_alts("pick", self.wd, "g1", "b")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([x["id"] for x in load(self.p("outline.json"))["chapters"][1]["slides"]], ["def-usability", "def-ux", "ux-def"])
        r = subprocess.run(["node", os.path.join(SCRIPTS, "check_storyboard.cjs"), self.p("storyboard.json"), "--outline", self.p("outline.json"), "--complete"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_pick_across_chapters(self):   # 2 つの章にまたがる範囲: スライドは、案の場面の章に入る
        r = self.run_alts("new", self.wd, "g2", "--replaces", "relation,definitions", "--options", "a,b", "--keep-current")
        self.assertEqual(r.returncode, 0, r.stderr)
        alts = load(self.p("alts.json"))
        opt = alts["groups"][0]["options"][1]
        opt["slides"] = [{"id": "relation", "intent": "関係が分かる"}, {"id": "definitions", "intent": "定義を読める"}]
        dump(alts, self.p("alts.json"))
        self.assertEqual(self.run_alts("pick", self.wd, "g2", "b").returncode, 0)
        ol = load(self.p("outline.json"))
        self.assertEqual([x["id"] for x in ol["chapters"][0]["slides"]], ["relation"])
        self.assertEqual([x["id"] for x in ol["chapters"][1]["slides"]], ["definitions", "ux-def"])
        r = subprocess.run(["node", os.path.join(SCRIPTS, "check_storyboard.cjs"), self.p("storyboard.json"), "--outline", self.p("outline.json"), "--complete"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_two_groups(self):   # 2 つの組が同時にあっても、片方を選んで他方が壊れない
        self.new_b()
        self.assertEqual(self.run_alts("new", self.wd, "g2", "--replaces", "whose", "--options", "x,y", "--keep-current").returncode, 0)
        self.assertEqual(self.run_alts("pick", self.wd, "g1", "b").returncode, 0)
        alts = load(self.p("alts.json"))
        self.assertEqual([g["id"] for g in alts["groups"]], ["g2"])
        self.assertTrue(os.path.isfile(self.p("storyboard.g2-y.json")))
        self.assertEqual(self.run_alts("drop", self.wd, "g2").returncode, 0)
        self.assertFalse(os.path.exists(self.p("alts.json")))

    def test_name_matching(self):
        self.new_b()
        r = self.run_alts("pick", self.wd, "g1", "案Z")
        self.assertEqual(r.returncode, 2)
        self.assertIn("b", r.stderr)   # 誤りの文に、案の key も出る
        self.assertEqual(self.run_alts("pick", self.wd, "g1", "案B").returncode, 0)   # 空白の有無は気にしない

    def test_frames_reuses_only_fresh_and_complete(self):   # 今の台本のコマが一部だけ・古いなら、書き直す
        self.new_b()
        subprocess.run(["node", os.path.join(SCRIPTS, "frames.cjs"), self.p("storyboard.json"), "-o", self.p("frames"), "--scenes", "s1"], capture_output=True)
        self.assertEqual(self.run_alts("frames", self.wd).returncode, 0)
        self.assertIn("s3", {ln["scene"] for ln in load(self.p("frames", "frames.json"))["lines"]})


if __name__ == "__main__":
    unittest.main()
