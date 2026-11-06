#!/usr/bin/env python3
"""ledger.py の検査（標準ライブラリだけ）。python3 test_ledger.py で回す。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "..", "ledger.py")
FIX = os.path.join(HERE, "ledger")


def run(*args):
    return subprocess.run([sys.executable, LEDGER, *args], capture_output=True, text=True)


class LedgerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.wd = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def ingest_r1(self):
        r = run("ingest", self.wd, "script", os.path.join(FIX, "r1.json"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_line_ids_scenes(self):
        sb = {"format": "ugoku-zukai/2", "scenes": [{"lines": [{"id": "l1"}, {"id": "l2"}]}]}
        json.dump(sb, open(os.path.join(self.wd, "storyboard.json"), "w", encoding="utf-8"))
        os.makedirs(os.path.join(self.wd, "review"))
        def it(lid):
            return {"status": "open", "severity": "must", "criterion": "S-W1", "line_id": lid,
                    "checker": "writing-reviewer", "reopen": 0, "rejected": 0, "history": []}
        led = {"phases": {"script": {"round": 1, "checks": {}, "items": {"l9:S-W1": it("l9"), "l1:S-W1": it("l1")}}}}
        json.dump(led, open(os.path.join(self.wd, "review", "ledger.json"), "w", encoding="utf-8"))
        r = run("status", self.wd, "script")
        self.assertIn("台本に無い行 ID", r.stdout)
        self.assertIn("l9:S-W1", r.stdout)
        self.assertIn("1 件", r.stdout)  # l1 は台本にあるので数えない

    def test_max_rounds_2(self):
        self.ingest_r1()  # c1-2:S-F1 が open のまま
        self.assertEqual(run("status", self.wd, "script", "--round", "2").returncode, 10)
        self.assertEqual(run("status", self.wd, "script", "--round", "2", "--max-rounds", "2").returncode, 20)
        r = run("status", self.wd, "script", "--max-rounds", "2")
        self.assertEqual(r.returncode, 10)
        self.assertIn("周 1/2", r.stdout)

    def test_residual_json(self):
        self.ingest_r1()
        r = run("residual", self.wd)
        self.assertEqual(r.returncode, 0, r.stderr)
        items = json.load(open(os.path.join(self.wd, "review", "residual.json"), encoding="utf-8"))["items"]
        md = open(os.path.join(self.wd, "review", "residual.md"), encoding="utf-8").read()
        rows = [l for l in md.splitlines() if l.startswith("| ") and "`" in l]
        self.assertEqual(len(items), len(rows))
        self.assertGreaterEqual(len(items), 1)
        for it in items:
            for k in ("phase", "key", "severity", "status", "problem", "response"):
                self.assertIn(k, it)

    def test_residual_json_empty(self):
        r = run("residual", self.wd)
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.load(open(os.path.join(self.wd, "review", "residual.json"), encoding="utf-8"))
        self.assertEqual(d["items"], [])


if __name__ == "__main__":
    unittest.main()
