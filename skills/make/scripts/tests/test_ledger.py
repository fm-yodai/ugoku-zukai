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

    def test_list_should_shows_whole_problem(self):   # should は 1 行だが、文の途中で切らない（そのまま利用者に見せるため）
        long = "三つの目的を言葉で並べるだけで、具体的な 1 件が出てこない。新しく入った人には、自分が変更を出したときに何が起きるのかが浮かばない"
        self.run("ingest", self.wd, self.out("director", [F("c2:S-D4", "should", problem=long)]))
        _, so, _ = self.run("list", self.wd)
        row = [ln for ln in so.splitlines() if "c2:S-D4" in ln][0]
        self.assertIn(long, row)

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

    def test_residual_empty(self):        # 評価役が見て、must が残っていない
        self.run("ingest", self.wd, self.out("director", [F("l4:G-D3", "should")]))
        self.assertIn("0 件", self.run("residual", self.wd)[1])
        with open(os.path.join(self.wd, "review", "residual.md"), encoding="utf-8") as f:
            self.assertIn("なし", f.read())

    def test_no_ledger_yet(self):         # 評価役の出力をまだ取り込んでいない。「残論点なし」とは言わない
        for cmd in ("status", "list", "residual"):
            code, so, _ = self.run(cmd, self.wd)
            self.assertEqual(code, 0, cmd)
            self.assertIn("まだない", so, cmd)
        with open(os.path.join(self.wd, "review", "residual.md"), encoding="utf-8") as f:
            md = f.read()
        self.assertIn("まだない", md)
        self.assertNotIn("なし", md)

    def test_missing_workdir(self):       # 作業フォルダのパスを間違えたら、0 件と答えずに止まる
        gone = os.path.join(self.tmp.name, "typo")
        for args in (("status", gone), ("list", gone), ("residual", gone),
                     ("ingest", gone, self.out("director", [F("l1:S-D2")])), ("decide", gone, "--by", "user", "--fix", "l1:S-D2")):
            code, _, se = self.run(*args)
            self.assertEqual(code, 2, args[0])
            self.assertIn("作業フォルダ", se, args[0])
        self.assertFalse(os.path.exists(gone))

    def test_broken_output_rejected(self):   # 形の崩れた評価役の出力は、黙って落とさずに止める
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        before = self.items()
        ok = self.out("director", [F("l2:S-D2")])
        cases = {"JSON でない": "{not json", "最上位が配列": [],
                 "findings がオブジェクト": {"findings": {"l3:S-D2": F("l3:S-D2")}},
                 "findings の要素が文字列": {"findings": ["l3:S-D2"]},
                 "checks がオブジェクト": {"checks": {"S-D2": "FAIL"}},
                 "checks に criterion がない": {"checks": [{"verdict": "FAIL", "evidence": "x"}]},
                 "rechecks の要素が文字列": {"rechecks": ["l1:S-D2"]},
                 "where が配列": {"findings": [F("l3:S-D2", where=["l3"])]}}
        for name, body in cases.items():
            self.n += 1
            path = os.path.join(self.tmp.name, f"broken{self.n}.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write(body) if isinstance(body, str) else json.dump(body, f, ensure_ascii=False)
            code, _, se = self.run("ingest", self.wd, ok, path)
            self.assertEqual(code, 2, name)
            self.assertIn(os.path.basename(path), se, name)
            self.assertEqual(self.items(), before, name)      # 一緒に渡した正しい出力も取り込まない

    def test_fail_check_without_finding(self):   # FAIL と判定したのに指摘がない基準は、must の指摘にする
        self.run("ingest", self.wd, self.out("fact-checker", checks=[{"criterion": "S-F1", "verdict": "FAIL", "evidence": "l7 が言えない"}]))
        self.assertEqual(self.items()["*:S-F1"]["level"], "must")
        self.assertIn("l7 が言えない", self.items()["*:S-F1"]["problem"])

    def test_case_insensitive(self):
        self.run("ingest", self.wd, self.out("director", [F("l1:G-D3", "SHOULD"), F("l2:S-D2", "Must")],
                                             checks=[{"criterion": "V-1", "verdict": "unknown", "evidence": "PNG がない"}]))
        it = self.items()
        self.assertEqual((it["l1:G-D3"]["level"], it["l2:S-D2"]["level"]), ("should", "must"))
        self.assertIn("*:V-1", it)
        self.run("decide", self.wd, "--by", "user", "--fix", "l2:S-D2")
        self.run("ingest", self.wd, self.out("director", rechecks=[{"key": "l2:S-D2", "verdict": "pass", "evidence": "ok"}]))
        self.assertEqual(self.items()["l2:S-D2"]["state"], "closed")

    def test_duplicate_key_merged(self):   # 同じ行・同じ基準の指摘が 2 つあっても、片方を黙って消さない
        _, so, _ = self.run("ingest", self.wd, self.out("writing-reviewer", [
            F("l9:S-W1", "must", problem="主語が抜けている", suggestion="主語を足す"),
            F("l9:S-W1", "should", problem="一文が長い", suggestion="二つに分ける")]))
        it = self.items()["l9:S-W1"]
        self.assertEqual(it["level"], "must")
        self.assertIn("主語が抜けている", it["problem"])
        self.assertIn("一文が長い", it["problem"])
        self.assertIn("二つに分ける", it["suggestion"])
        self.assertIn("警告", so)

    def test_kept_reopens_when_level_rises(self):   # 利用者が見ていない must を、直さないと決めたことにしない
        self.run("ingest", self.wd, self.out("writing-reviewer", [F("l3:S-W1", "should")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l3:S-W1")
        _, so, _ = self.run("ingest", self.wd, self.out("writing-reviewer", [F("l3:S-W1", "must", problem="意味が取れない")]))
        it = self.items()["l3:S-W1"]
        self.assertEqual((it["state"], it["level"]), ("open", "must"))
        self.assertIn("警告", so)

    def test_lead_cannot_fix_kept(self):   # 利用者の「直さない」を、進行役は上書きできない
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "l1:S-D2")
        code, so, _ = self.run("decide", self.wd, "--by", "lead", "--fix", "l1:S-D2")
        self.assertEqual(code, 0)
        self.assertIn("警告", so)
        self.assertEqual(self.items()["l1:S-D2"]["state"], "kept")

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

    def test_must_only_reads_new_criteria(self):
        ids = ledger.must_only()
        self.assertIn("S-F1", ids)
        self.assertNotIn("S-W1", ids)         # must / should を分ける基準
        for must in ("O-F1", "O-D2", "A-1", "A-M1", "G-D1", "V-1"):
            self.assertIn(must, ids)
        for other in ("O-F3", "O-D5", "A-4", "S-W10", "S-F4", "G-D3"):
            self.assertNotIn(other, ids)
        self.assertFalse([i for i in ids if i.startswith("C-")], "契約の基準が残っている")

    # ---- 再確認を頼まずに閉じる（--close）。通しで、直したのに「直し中」のまま公開した指摘があった ----
    def test_close_fixing_by_lead(self):
        self.run("ingest", self.wd, self.out("writing-reviewer", [F("l1:S-W4", "should")]))
        self.run("decide", self.wd, "--by", "lead", "--fix", "l1:S-W4")
        rc, so, se = self.run("decide", self.wd, "--by", "lead", "--close", "l1:S-W4", "--note", "read は前から付いていた（評価役の見落とし）")
        self.assertEqual(rc, 0, se)
        it = self.items()["l1:S-W4"]
        self.assertEqual(it["state"], "closed")
        self.assertEqual(it["history"][-1], ["close:lead", "read は前から付いていた（評価役の見落とし）"])
        self.assertIn("閉じた 1", so)

    def test_close_needs_note(self):
        self.run("ingest", self.wd, self.out("writing-reviewer", [F("l1:S-W4", "should")]))
        self.run("decide", self.wd, "--by", "lead", "--fix", "l1:S-W4")
        for note in ([], ["--note", "  "]):
            rc, _, se = self.run("decide", self.wd, "--by", "lead", "--close", "l1:S-W4", *note)
            self.assertEqual(rc, 2)
            self.assertIn("--note", se)
        self.assertEqual(self.items()["l1:S-W4"]["state"], "fixing")

    def test_close_only_fixing(self):       # 直すと決めていない指摘は閉じられない（直さないなら --keep）
        self.run("ingest", self.wd, self.out("writing-reviewer", [F("l1:S-W4", "should")]))
        rc, _, se = self.run("decide", self.wd, "--by", "lead", "--close", "l1:S-W4", "--note", "直した")
        self.assertEqual(rc, 2)
        self.assertIn("直し中", se)
        self.assertEqual(self.items()["l1:S-W4"]["state"], "open")

    def test_close_open_by_user(self):      # 指摘と違う直し方を利用者が選んだときは、--fix を挟まずに閉じられる（通し 4）
        self.run("ingest", self.wd, self.out("director", [F("s9:V-6")]))
        rc, so, se = self.run("decide", self.wd, "--by", "user", "--close", "s9:V-6", "--note", "説明枠を循環図の上下中央に揃えた")
        self.assertEqual(rc, 0, se)
        it = self.items()["s9:V-6"]
        self.assertEqual((it["state"], it["by"]), ("closed", "user"))
        self.assertEqual(it["history"][-1], ["close:user", "説明枠を循環図の上下中央に揃えた"])
        # 直さないと決めた指摘（kept）は閉じない
        self.run("ingest", self.wd, self.out("director", [F("s10:V-6")]))
        self.run("decide", self.wd, "--by", "user", "--keep", "s10:V-6")
        rc, _, se = self.run("decide", self.wd, "--by", "user", "--close", "s10:V-6", "--note", "x")
        self.assertEqual(rc, 2)
        self.assertEqual(self.items()["s10:V-6"]["state"], "kept")

    def test_close_must_only_by_user(self):  # must を、評価役の再確認なしで進行役だけでは閉じない
        self.run("ingest", self.wd, self.out("fact-checker", [F("l1:S-F1")]))
        self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-F1")
        rc, _, se = self.run("decide", self.wd, "--by", "lead", "--close", "l1:S-F1", "--note", "直した")
        self.assertEqual(rc, 2)
        self.assertIn("must", se)
        self.assertEqual(self.items()["l1:S-F1"]["state"], "fixing")
        self.assertEqual(self.run("decide", self.wd, "--by", "user", "--close", "l1:S-F1", "--note", "利用者が見て通した")[0], 0)
        self.assertEqual(self.items()["l1:S-F1"]["state"], "closed")

    def test_list_marks_same_place(self):    # 同じ行に別の評価役の指摘があるときは、並べて見られるよう印を付ける
        self.run("ingest", self.wd, self.out("fact-checker", [F("l22:S-F1")]))
        self.run("ingest", self.wd, self.out("writing-reviewer", [F("l22:S-W1", "should"), F("l5:S-W1", "should")]))
        _, so, _ = self.run("list", self.wd)
        line = next(l for l in so.splitlines() if l.startswith("- `l22:S-W1`"))
        self.assertIn("同じ箇所に l22:S-F1", line)
        self.assertNotIn("同じ箇所", next(l for l in so.splitlines() if l.startswith("- `l5:S-W1`")))

    def test_decide_same_key_in_fix_and_keep(self):
        # 同じキーを --fix と --keep の両方に渡したら、何も書き換えずに終了コード 2
        self.run("ingest", self.wd, self.out("director", [F("l1:S-D2"), F("l2:S-D2")]))
        before = self.items()
        code, so, se = self.run("decide", self.wd, "--by", "user", "--fix", "l1:S-D2", "l2:S-D2", "--keep", "l1:S-D2")
        self.assertEqual(code, 2)
        self.assertIn("--fix と --keep の両方", so + se)
        self.assertIn("l1:S-D2", so + se)
        self.assertEqual(self.items(), before)


if __name__ == "__main__":
    unittest.main()
