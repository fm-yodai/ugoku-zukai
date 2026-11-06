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

    def test_reset(self):
        # 人の確認で契約に戻ったら、周を 1 から数え直す。前の項目は archived に移し、判定の材料にしない
        self.ingest_r1()
        os.makedirs(os.path.join(self.wd, "review", "script", "r1"))
        r = run("reset", self.wd, "script")
        self.assertEqual(r.returncode, 0, r.stderr)
        led = json.load(open(os.path.join(self.wd, "review", "ledger.json"), encoding="utf-8"))
        self.assertNotIn("script", led["phases"])
        self.assertEqual(led["archived"][0]["phase"], "script")
        self.assertTrue(led["archived"][0]["items"])
        self.assertFalse(os.path.exists(os.path.join(self.wd, "review", "script")))
        self.assertTrue(os.path.isdir(os.path.join(self.wd, "review", "script-old1", "r1")))
        r = run("status", self.wd, "script")
        self.assertIn("周 0/3", r.stdout)
        run("residual", self.wd)
        self.assertEqual(json.load(open(os.path.join(self.wd, "review", "residual.json"), encoding="utf-8"))["items"], [])

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


    def _dispute_screen(self):
        # 画面の指摘を maker が disputed にした状態を作る
        r1 = {"reviewer": "director", "phase": "screen", "round": 1,
              "checks": [{"criterion": "V-D1", "verdict": "FAIL", "evidence": "sheet-01.png の行 l3"}],
              "findings": [{"key": "l3:V-D1", "line_id": "l3", "criterion": "V-D1", "severity": "must",
                            "problem": "…", "evidence": "sheet-01.png の行 l3"}], "rechecks": []}
        resp = {"phase": "screen", "round": 1, "responses": [
            {"key": "l3:V-D1", "action": "disputed", "note": "字幕を変える必要がある"}]}
        f1, f2 = os.path.join(self.wd, "r1.json"), os.path.join(self.wd, "resp.json")
        json.dump(r1, open(f1, "w", encoding="utf-8"))
        json.dump(resp, open(f2, "w", encoding="utf-8"))
        self.assertEqual(run("ingest", self.wd, "screen", f1).returncode, 0)
        self.assertEqual(run("respond", self.wd, "screen", f2).returncode, 0)

    def _recheck(self, rc):
        r2 = {"reviewer": "director", "phase": "screen", "round": 2,
              "checks": [{"criterion": "V-D1", "verdict": "PASS", "evidence": "sheet-01.png を見た"}],
              "findings": [], "rechecks": [rc]}
        f = os.path.join(self.wd, "r2.json")
        json.dump(r2, open(f, "w", encoding="utf-8"))
        self.assertEqual(run("ingest", self.wd, "screen", f).returncode, 0)
        led = json.load(open(os.path.join(self.wd, "review", "ledger.json"), encoding="utf-8"))
        return led["phases"]["screen"]["items"]["l3:V-D1"]

    def test_disputed_recheck_pass_closes(self):
        # disputed でも、checker が見直して PASS と判定したら閉じる（反論を認めたかどうかは問わない）
        self._dispute_screen()
        it = self._recheck({"key": "l3:V-D1", "verdict": "PASS", "evidence": "台本に戻って直り、l3 は読める"})
        self.assertEqual(it["status"], "closed")
        self.assertEqual(it["rejected"], 0)
        self.assertEqual(run("status", self.wd, "screen").returncode, 0)

    def test_disputed_recheck_fail_reopens(self):
        self._dispute_screen()
        it = self._recheck({"key": "l3:V-D1", "verdict": "FAIL", "evidence": "反論は基準と合わない"})
        self.assertEqual(it["status"], "open")
        self.assertEqual(it["rejected"], 1)

    def test_respond_missing_file(self):
        # 応答ファイルが無いときは、わかる文で知らせて何も変えない（トレースバックを出さない）
        self.ingest_r1()
        before = open(os.path.join(self.wd, "review", "ledger.json"), encoding="utf-8").read()
        r = run("respond", self.wd, "script", os.path.join(self.wd, "nai.json"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        self.assertIn("応答ファイルが無い", r.stdout)
        self.assertEqual(open(os.path.join(self.wd, "review", "ledger.json"), encoding="utf-8").read(), before)


if __name__ == "__main__":
    unittest.main()
