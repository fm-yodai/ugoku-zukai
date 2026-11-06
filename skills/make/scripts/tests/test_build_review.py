#!/usr/bin/env python3
"""build_player.py --review の検査（標準ライブラリだけ）。python3 test_build_review.py で回す。"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "..", "build_player.py")
SAMPLE = os.path.join(HERE, "..", "..", "examples", "mixed.json")


def embedded(html):
    """HTML に埋め込まれた UZ_DATA の JSON を取り出す"""
    m = re.search(r"const UZ_DATA = (.*?);\n", html, re.S)
    return json.loads(m.group(1))


class BuildReviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, *extra):
        out = os.path.join(self.dir, "p.html")
        r = subprocess.run([sys.executable, BUILD, SAMPLE, "-o", out, *extra], capture_output=True, text=True)
        html = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
        return r, html

    def workdir(self, items):
        wd = os.path.join(self.dir, "wd")
        os.makedirs(os.path.join(wd, "review"))
        json.dump({"items": items}, open(os.path.join(wd, "review", "residual.json"), "w", encoding="utf-8"), ensure_ascii=False)
        return wd

    def item(self, problem, key="S-1"):
        return {"phase": "script", "key": key, "severity": "major", "status": "open", "problem": problem, "response": ""}

    def test_two_items(self):
        wd = self.workdir([self.item("一つ目"), self.item("二つ目", "S-2")])
        r, html = self.build("--review", wd)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = embedded(html)["residual"]
        self.assertEqual([i["problem"] for i in res], ["一つ目", "二つ目"])
        self.assertIn("未解決の指摘", html)
        self.assertIn('id="uz-residual"', html)
        self.assertIn('id="uz-sources"', html)

    def test_script_not_literal(self):
        wd = self.workdir([self.item("<script>alert(1)</script>")])
        r, html = self.build("--review", wd)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("<script>alert", html)
        self.assertEqual(embedded(html)["residual"][0]["problem"], "<script>alert(1)</script>")

    def test_no_review_dir(self):
        r, html = self.build("--review", self.dir)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(embedded(html)["residual"], [])

    def test_without_flag(self):
        r, html = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIsNone(embedded(html)["residual"])

    def test_artifact_keeps_lists(self):
        wd = self.workdir([])
        r, html = self.build("--review", wd, "--artifact")
        self.assertIn('id="uz-residual"', html)
        self.assertNotIn("<html", html)


if __name__ == "__main__":
    unittest.main()
