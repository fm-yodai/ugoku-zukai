#!/usr/bin/env python3
"""指摘の一覧（ledger.py）の検査（標準ライブラリだけ）。python3 test_ledger.py で回す。"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
LEDGER = os.path.join(SCRIPTS, "ledger.py")
PAIR_SB = os.path.join(HERE, "outlines", "pair", "storyboard.json")
PAIR_OUTLINE = os.path.join(HERE, "outlines", "pair", "outline.json")

sys.path.insert(0, SCRIPTS)
import ledger  # noqa: E402


def F(key, level="must", **kw):
    """evidence の付いた指摘"""
    where, criterion = key.rsplit(":", 1)
    return {"key": key, "where": where, "criterion": criterion, "level": level,
            "problem": "問題がある", "suggestion": "こう直す", "evidence": "根拠", **kw}


class LedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wd = os.path.join(self.tmp.name, "wd")
        os.makedirs(self.wd)
        self.n = 0

    def tearDown(self):
        self.tmp.cleanup()

    def run(self, *args):   # unittest の run を上書きしないよう、引数が文字列のときだけ ledger.py を回す
        if args and not isinstance(args[0], str):
            return super().run(*args)
        r = subprocess.run([sys.executable, LEDGER, *args], capture_output=True, text=True)
        return r.returncode, r.stdout, r.stderr

    def out(self, reviewer, findings=(), rechecks=(), checks=()):
        """評価役の出力を一時ファイルに書き、パスを返す"""
        self.n += 1
        path = os.path.join(self.tmp.name, f"out{self.n}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"reviewer": reviewer, "target": "script", "checks": list(checks),
                       "findings": list(findings), "rechecks": list(rechecks)}, f, ensure_ascii=False)
        return path

    def items(self):
        p = os.path.join(self.wd, "review", "ledger.json")
        if not os.path.exists(p):
            return {}
        with open(p, encoding="utf-8") as f:
            return json.load(f)["items"]

    def test_ingest_opens(self):
        code, so, _ = self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("l2:G-D3", "should"), F("l3:G-D3", "nits")]))
        self.assertEqual(code, 0)
        self.assertEqual({k: v["state"] for k, v in self.items().items()}, {"l1:S-D2": "open", "l2:G-D3": "open", "l3:G-D3": "open"})
        self.assertIn("must 1 / should 1 / nits 1", so)

    def test_no_evidence_dropped(self):
        f = F("l1:S-D2")
        del f["evidence"]
        _, so, _ = self.run("ingest", self.wd, self.out("director", [f]))
        self.assertEqual(self.items(), {})
        self.assertIn("警告", so)

    def test_level_forced(self):          # S-F1 は must だけの基準。G-D3 は should の基準
        _, so, _ = self.run("ingest", self.wd, self.out("x", [F("l1:S-F1", "nits"), F("l2:G-D3", "minor")]))
        self.assertEqual(self.items()["l1:S-F1"]["level"], "must")
        self.assertEqual(self.items()["l2:G-D3"]["level"], "should")
        self.assertEqual(so.count("警告"), 2)

    def test_unknown_check_becomes_item(self):
        self.run("ingest", self.wd, self.out("director", checks=[{"criterion": "V-1", "verdict": "UNKNOWN", "evidence": "PNG がない"},
                                                                 {"criterion": "V-2", "verdict": "PASS"}]))   # evidence のない PASS
        self.assertEqual(sorted(self.items()), ["*:V-1", "*:V-2"])
        self.assertEqual(self.items()["*:V-1"]["level"], "must")

    def test_fix_by_lead_then_recheck(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("l2:S-D2")]))
        self.assertEqual(self.run("decide", self.wd, "--by", "lead", "--fix", "l1:S-D2", "l2:S-D2")[0], 0)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "fixing")
        self.run("ingest", self.wd, self.out("director", rechecks=[{"key": "l1:S-D2", "verdict": "PASS", "evidence": "直った"},
                                                                   {"key": "l2:S-D2", "verdict": "FAIL", "evidence": "まだ"}]))
        it = self.items()
        self.assertEqual((it["l1:S-D2"]["state"], it["l2:S-D2"]["state"]), ("closed", "open"))
        self.assertEqual(it["l2:S-D2"]["by"], "lead")               # 先に直したことは残る
        _, so, _ = self.run("list", self.wd, "--by", "lead")
        self.assertIn("l1:S-D2", so)
        self.assertIn("l2:S-D2", so)
        self.assertIn("閉じた・進行役", so)

    def test_recheck_without_evidence_is_ignored(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-D2")
        _, so, _ = self.run("ingest", self.wd, self.out("director", rechecks=[{"key": "l1:S-D2", "verdict": "PASS"}]))
        self.assertEqual(self.items()["l1:S-D2"]["state"], "fixing")
        self.assertIn("警告", so)

    def test_keep_only_by_user(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.assertEqual(self.run("decide", self.wd, "--by", "lead", "--keep", "l1:S-D2")[0], 2)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "open")
        self.assertEqual(self.run("decide", self.wd, "--by", "user", "--keep", "l1:S-D2")[0], 0)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "kept")
        self.assertEqual(self.items()["l1:S-D2"]["by"], "user")

    def test_kept_can_be_fixed_later(self):   # 利用者が考えを変えた
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l1:S-D2")
        self.assertEqual(self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-D2")[0], 0)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "fixing")

    def test_refound_while_fixing_reopens(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-D2")
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2", problem="まだ合っていない")]))
        self.assertEqual(self.items()["l1:S-D2"]["state"], "open")
        self.assertEqual(self.items()["l1:S-D2"]["problem"], "まだ合っていない")

    def test_kept_stays_kept(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l1:S-D2")
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")], rechecks=[{"key": "l1:S-D2", "verdict": "FAIL", "evidence": "同じ"}]))
        self.assertEqual(self.items()["l1:S-D2"]["state"], "kept")

    def test_closed_refound_reopens(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("ingest", self.wd, self.out("director", rechecks=[{"key": "l1:S-D2", "verdict": "PASS", "evidence": "ok"}]))
        self.assertEqual(self.items()["l1:S-D2"]["state"], "closed")
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.assertEqual(self.items()["l1:S-D2"]["state"], "open")

    def test_decide_unknown_key(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        code, _, se = self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-D2", "l9:S-D2")
        self.assertEqual(code, 2)
        self.assertIn("l9:S-D2", se)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "open")   # 何も変えない

    def test_old_ledger_rejected(self):
        os.makedirs(os.path.join(self.wd, "review"))
        p = os.path.join(self.wd, "review", "ledger.json")
        old = {"phases": {"script": {"round": 1, "items": {}, "checks": {}}}}
        with open(p, "w", encoding="utf-8") as f:
            json.dump(old, f)
        self.assertEqual(self.run("status", self.wd)[0], 2)
        self.assertEqual(self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))[0], 2)
        with open(p, encoding="utf-8") as f:
            self.assertEqual(json.load(f), old)

    def test_usage_errors(self):
        self.assertEqual(self.run()[0], 2)
        self.assertEqual(self.run("respond", self.wd, "x")[0], 2)        # なくしたコマンド
        self.assertEqual(self.run("decide", self.wd, "--fix", "l1:S-D2")[0], 2)   # --by がない
        self.assertEqual(self.run("ingest", self.wd, os.path.join(self.tmp.name, "none.json"))[0], 2)

    def test_list_levels(self):           # must は全文、should は 1 行、nits は件数だけ
        self.run("ingest", self.wd, self.out("director", [
            F("l1:S-D2", problem="字幕と画面の主題が違う", suggestion="focus を l1 に付ける"),
            F("l2:G-D3", "should", problem="ラベルが 1 語", suggestion="動詞句にする"),
            F("l3:G-D3", "nits", problem="言い回しの好み")]))
        _, so, _ = self.run("list", self.wd)
        self.assertIn("focus を l1 に付ける", so)
        self.assertIn("ラベルが 1 語", so)
        self.assertNotIn("動詞句にする", so)
        self.assertNotIn("言い回しの好み", so)
        self.assertIn("nits（1 件）", so)
        full = self.run("list", self.wd, "--full")[1]
        self.assertIn("言い回しの好み", full)
        self.assertIn("動詞句にする", full)

    def test_list_one_line(self):
        self.run("ingest", self.wd, self.out("director", [F("l2:G-D3", "should", problem="1 行目\n2 行目 | 縦棒")]))
        _, so, _ = self.run("list", self.wd)
        row = [ln for ln in so.splitlines() if "l2:G-D3" in ln][0]
        self.assertIn("1 行目 2 行目", row)
        self.assertNotIn("|", row)

    def test_list_default_is_open_only(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("l2:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l2:S-D2")
        _, so, _ = self.run("list", self.wd)
        self.assertIn("l1:S-D2", so)
        self.assertNotIn("l2:S-D2", so)
        self.assertIn("l2:S-D2", self.run("list", self.wd, "--state", "kept")[1])
        self.assertIn("直さない 1", so)

    def test_list_reviewer(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]), self.out("fact-checker", [F("l2:S-F1")]))
        _, so, _ = self.run("list", self.wd, "--reviewer", "fact-checker")
        self.assertIn("l2:S-F1", so)
        self.assertNotIn("l1:S-D2", so)

    def test_list_json(self):
        self.run("ingest", self.wd, self.out("director", [F("l2:G-D3", "should"), F("l1:S-D2")]))
        d = json.loads(self.run("list", self.wd, "--json")[1])
        self.assertEqual([i["key"] for i in d["items"]], ["l1:S-D2", "l2:G-D3"])      # レベル順
        self.assertEqual(d["counts"]["open"], {"must": 1, "should": 1, "nits": 0})
        self.assertEqual({"key", "where", "criterion", "level", "state", "by", "reviewer", "problem", "suggestion", "evidence"},
                         set(d["items"][0]))

    def test_residual(self):              # must で閉じていないものだけ
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("l2:S-D2"), F("l3:S-D2", problem="a | b\nc"), F("l4:G-D3", "should")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l1:S-D2")
        self.run("decide", self.wd, "--by", "user", "--fix", "l2:S-D2")
        self.run("ingest", self.wd, self.out("director", rechecks=[{"key": "l2:S-D2", "verdict": "PASS", "evidence": "ok"}]))
        code, so, _ = self.run("residual", self.wd)
        self.assertEqual(code, 0)
        self.assertIn("2 件", so)
        with open(os.path.join(self.wd, "review", "residual.json"), encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual(sorted(i["key"] for i in d["items"]), ["l1:S-D2", "l3:S-D2"])
        with open(os.path.join(self.wd, "review", "residual.md"), encoding="utf-8") as f:
            md = f.read()
        row = [ln for ln in md.splitlines() if "l3:S-D2" in ln][0]
        self.assertEqual(row.count("|"), 5)   # 4 列の表が崩れない

    def test_residual_empty(self):
        self.assertIn("0 件", self.run("residual", self.wd)[1])
        with open(os.path.join(self.wd, "review", "residual.md"), encoding="utf-8") as f:
            self.assertIn("なし", f.read())

    def test_status_warns_missing_id(self):   # 台本にも構成メモにもない where
        shutil.copy(PAIR_SB, os.path.join(self.wd, "storyboard.json"))
        shutil.copy(PAIR_OUTLINE, os.path.join(self.wd, "outline.json"))
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("c2.1:A-1"), F("basics.knows:O-D3"), F("c2.shows:O-D2"),
                                                           F("s2:G-D7"), F("plans:G-D3", "should"), F("*:S-D4", "should"), F("l99:S-D2")]))
        code, so, _ = self.run("status", self.wd)
        self.assertEqual(code, 0)
        warn = "\n".join(ln for ln in so.splitlines() if "警告" in ln)
        self.assertIn("l99:S-D2", warn)
        for ok in ("l1:S-D2", "c2.1:A-1", "basics.knows:O-D3", "c2.shows:O-D2", "s2:G-D7", "plans:G-D3", "*:S-D4"):
            self.assertNotIn(ok, warn)

    def test_status_without_files(self):      # 台本も構成メモもまだない
        self.run("ingest", self.wd, self.out("director", [F("c1:O-D2")]))
        code, so, _ = self.run("status", self.wd)
        self.assertEqual(code, 0)
        self.assertNotIn("警告", so)
        self.assertEqual(self.run("status", os.path.join(self.tmp.name, "empty"))[0], 0)   # 台帳がまだない

    def test_must_only_reads_new_criteria(self):
        ids = ledger.must_only()
        self.assertIn("S-F1", ids)
        self.assertNotIn("S-W1", ids)         # must / should を分ける基準
        for must in ("O-F1", "O-D2", "A-1", "A-M1", "G-D1", "V-1"):
            self.assertIn(must, ids)
        for other in ("O-F3", "O-D5", "A-4", "S-W10", "S-F4", "G-D3"):
            self.assertNotIn(other, ids)
        self.assertFalse([i for i in ids if i.startswith("C-")], "契約の基準が残っている")


if __name__ == "__main__":
    unittest.main()
