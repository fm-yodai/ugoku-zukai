#!/usr/bin/env python3
"""構成メモ（outline.json）の検査と、台本との突き合わせの検査（標準ライブラリだけ）。python3 test_outline.py で回す。"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
CHECK = os.path.join(SCRIPTS, "check_outline.py")
DIR = os.path.join(HERE, "outlines")

sys.path.insert(0, SCRIPTS)
try:
    import check_outline
except ImportError:  # まだ無いときは、各検査が失敗で知らせる
    check_outline = None


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class CheckOutlineTest(unittest.TestCase):
    def run_check(self, name, *extra):
        return subprocess.run([sys.executable, CHECK, os.path.join(DIR, name), *extra], capture_output=True, text=True)

    def test_ok(self):
        for name in ("ok_ux.json", "ok_draft.json"):
            self.assertEqual(self.run_check(name).returncode, 0, name)
        self.assertEqual(self.run_check("ok_ux.json", "--ready").returncode, 0)

    def test_bad(self):
        for name in ("bad_format.json", "bad_by.json", "bad_nosource.json",
                     "bad_user_proposed.json", "bad_dup_id.json", "bad_figure.json"):
            self.assertEqual(self.run_check(name).returncode, 1, name)

    def test_ready(self):
        self.assertEqual(self.run_check("bad_not_ready.json").returncode, 0)
        r = self.run_check("bad_not_ready.json", "--ready")
        self.assertEqual(r.returncode, 1)
        self.assertIn("knows", r.stdout)
        self.assertEqual(self.run_check("ok_draft.json", "--ready").returncode, 1)

    def test_workdir_path(self):
        with tempfile.TemporaryDirectory() as d:
            shutil.copy(os.path.join(DIR, "ok_ux.json"), os.path.join(d, "outline.json"))
            self.assertEqual(subprocess.run([sys.executable, CHECK, d], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run([sys.executable, CHECK, os.path.join(d, "none")],
                                            capture_output=True).returncode, 2)

    def test_length_warning(self):
        d = load(os.path.join(DIR, "ok_ux.json"))
        d["chapters"][0]["seconds"] += 120
        errors, warnings = check_outline.check(d)
        self.assertEqual(errors, [])
        self.assertTrue(any("長さ" in w for w in warnings))

    def test_proposed_items(self):
        d = load(os.path.join(DIR, "ok_ux.json"))
        items = check_outline.proposed_items(d)
        self.assertTrue(items)
        self.assertEqual({"where", "label", "text"}, set(items[0]))
        self.assertIn("basics.look", [i["where"] for i in items])
        self.assertNotIn("basics.audience", [i["where"] for i in items])   # agreed は出ない
        out = json.loads(self.run_check("ok_ux.json", "--json").stdout)
        self.assertEqual(out["proposed"], items)


if __name__ == "__main__":
    unittest.main()
