#!/usr/bin/env python3
"""workdir.py の publish（公開先の記録）と list（作業フォルダの一覧）の検査（標準ライブラリだけ）。python3 test_workdir.py で回す。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WORKDIR = os.path.join(HERE, "..", "workdir.py")
URL = "https://claude.ai/code/artifact/abc"


class WorkdirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "runs")
        # 置き場を探す環境変数は、検査ごとに決める（手元の作業フォルダを拾わないように HOME も一時フォルダにする）
        self.env = {k: v for k, v in os.environ.items() if k not in ("UZ_RUNS_HOME", "CLAUDE_PLUGIN_DATA")}
        self.env["HOME"] = os.path.join(self.tmp.name, "home")

    def tearDown(self):
        self.tmp.cleanup()

    def run_wd(self, *args, env=None):
        return subprocess.run([sys.executable, WORKDIR, *args], capture_output=True, text=True, env=env or self.env)

    def new(self, name, stamp="20260101-0000", home=None, title="題"):
        r = self.run_wd("new", name, "--home", home or self.home, "--now", stamp)
        self.assertEqual(r.returncode, 0, r.stderr)
        wd = r.stdout.strip()
        if title is not None:
            with open(os.path.join(wd, "storyboard.json"), "w", encoding="utf-8") as f:
                json.dump({"title": title, "scenes": []}, f, ensure_ascii=False)
        return wd

    def record(self, wd):
        with open(os.path.join(wd, "published.json"), encoding="utf-8") as f:
            return json.load(f)

    # ---- publish ----
    def test_publish_writes_record(self):
        wd = self.new("a")
        r = self.run_wd("publish", wd, "--url", URL, "--theme", "flat", "--source", "なし", "--now", "2026-11-10T16:02:00")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.record(wd), {
            "format": "ugoku-zukai-published/1", "title": "題", "url": URL, "theme": "flat", "source": "なし",
            "first": "2026-11-10T16:02:00", "last": "2026-11-10T16:02:00", "count": 1})

    def test_publish_again_keeps_theme(self):
        wd = self.new("a")
        self.run_wd("publish", wd, "--url", URL, "--theme", "flat", "--source", "なし", "--now", "2026-11-10T16:02:00")
        r = self.run_wd("publish", wd, "--url", URL, "--now", "2026-11-10T17:40:00")
        self.assertEqual(r.returncode, 0, r.stderr)
        rec = self.record(wd)
        self.assertEqual((rec["theme"], rec["source"], rec["count"]), ("flat", "なし", 2))
        self.assertEqual((rec["first"], rec["last"]), ("2026-11-10T16:02:00", "2026-11-10T17:40:00"))

    def test_publish_first_time_without_theme(self):
        wd = self.new("a")
        self.run_wd("publish", wd, "--url", URL)
        rec = self.record(wd)
        self.assertIsNone(rec["theme"])
        self.assertIsNone(rec["source"])

    def test_publish_title_option(self):
        wd = self.new("a")
        self.run_wd("publish", wd, "--url", URL, "--title", "別の題")
        self.assertEqual(self.record(wd)["title"], "別の題")

    def test_publish_url_changed(self):
        wd = self.new("a")
        self.run_wd("publish", wd, "--url", URL)
        r = self.run_wd("publish", wd, "--url", URL + "2")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("公開先が変わった", r.stdout)
        self.assertEqual(self.record(wd)["url"], URL + "2")

    def test_publish_needs_storyboard(self):
        wd = self.new("a", title=None)
        r = self.run_wd("publish", wd, "--url", URL)
        self.assertEqual(r.returncode, 2)
        self.assertFalse(os.path.exists(os.path.join(wd, "published.json")))

    def test_publish_missing_workdir(self):
        r = self.run_wd("publish", os.path.join(self.tmp.name, "nai"), "--url", URL)
        self.assertEqual(r.returncode, 2)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "nai")))

    def test_publish_bad_url(self):
        wd = self.new("a")
        for bad in ("a b", ""):
            r = self.run_wd("publish", wd, "--url", bad)
            self.assertEqual(r.returncode, 2, bad)
        self.assertFalse(os.path.exists(os.path.join(wd, "published.json")))

    # ---- list ----
    def two(self):
        a = self.new("a", "20260101-0000", title="A の題")
        b = self.new("b", "20260102-0000", title="B の題")
        os.makedirs(os.path.join(b, "voice"))
        for f in ("outline.json", "player.html", os.path.join("voice", "timeline.json")):
            open(os.path.join(b, f), "w").close()
        self.run_wd("publish", b, "--url", URL, "--theme", "flat", "--source", "/src/x", "--now", "2026-11-10T16:02:00")
        return a, b

    def test_list_json(self):
        a, b = self.two()
        r = self.run_wd("list", "--home", self.home, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = json.loads(r.stdout)
        self.assertEqual([x["path"] for x in rows], [b, a])       # 新しい順
        rb, ra = rows
        self.assertEqual(rb["published"]["url"], URL)
        self.assertIsNone(ra["published"])
        self.assertEqual(rb["has"], {"outline": True, "storyboard": True, "voice": True, "player": True})
        self.assertEqual(ra["has"], {"outline": False, "storyboard": True, "voice": False, "player": False})
        self.assertEqual((ra["name"], ra["title"], ra["made"]), ("20260101-0000-a", "A の題", "2026-01-01 00:00"))
        self.assertEqual(ra["unreadable"], [])

    def test_list_text(self):
        a, b = self.two()
        r = self.run_wd("list", "--home", self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        la = next(l for l in r.stdout.splitlines() if l.startswith("20260101-0000-a"))
        lb = next(l for l in r.stdout.splitlines() if l.startswith("20260102-0000-b"))
        self.assertIn("未公開", la)
        self.assertIn("A の題", la)
        self.assertIn(URL, lb)
        self.assertIn("公開 1 回", lb)
        self.assertIn("2026-11-10 16:02", lb)
        for p in (a, b):
            self.assertIn(p, r.stdout)
        self.assertIn("flat", r.stdout)
        self.assertIn("/src/x", r.stdout)

    def test_list_broken_files(self):
        wd = self.new("a")
        for f in ("published.json", "storyboard.json"):
            with open(os.path.join(wd, f), "w") as fh:
                fh.write("{")
        r = self.run_wd("list", "--home", self.home, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        row = json.loads(r.stdout)[0]
        self.assertIsNone(row["title"])
        self.assertIsNone(row["published"])
        self.assertEqual(sorted(row["unreadable"]), ["published.json", "storyboard.json"])
        r = self.run_wd("list", "--home", self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("読めないファイル", r.stdout)

    def test_list_record_of_wrong_shape(self):
        # JSON としては読めても、公開先の記録の形でなければ読めないファイルとして扱う
        wd = self.new("a")
        with open(os.path.join(wd, "published.json"), "w") as fh:
            fh.write("[1, 2]")
        row = json.loads(self.run_wd("list", "--home", self.home, "--json").stdout)[0]
        self.assertIsNone(row["published"])
        self.assertEqual(row["unreadable"], ["published.json"])

    def test_list_ignores_other_dirs(self):
        self.new("a")
        os.makedirs(os.path.join(self.home, "notes"))
        open(os.path.join(self.home, "20260101-0000-file"), "w").close()   # フォルダでないもの
        rows = json.loads(self.run_wd("list", "--home", self.home, "--json").stdout)
        self.assertEqual([x["name"] for x in rows], ["20260101-0000-a"])

    def test_list_searches_all_homes(self):
        t = self.tmp.name
        h1 = os.path.join(t, "h1")
        data = os.path.join(t, "data")
        homes = [h1, os.path.join(data, "ugoku-zukai-inline", "runs"), os.path.join(data, "ugoku-zukai-market", "runs"),
                 os.path.join(self.env["HOME"], ".cache", "ugoku-zukai", "runs")]
        want = [self.new(f"r{i}", f"2026010{i + 1}-0000", home=h) for i, h in enumerate(homes)]
        self.new("other", "20260109-0000", home=os.path.join(data, "other", "runs"))
        env = dict(self.env, UZ_RUNS_HOME=h1, CLAUDE_PLUGIN_DATA=os.path.join(data, "ugoku-zukai-inline"))
        r = self.run_wd("list", "--json", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(x["path"] for x in json.loads(r.stdout)), sorted(want))   # 4 つだけ。重複なし

    def test_list_finds_plugin_data_without_env(self):
        # CLAUDE_PLUGIN_DATA のないセッションでも、プラグインの置き場（~/.claude/plugins/data/ugoku-zukai*/runs）で作ったものが見つかる
        data = os.path.join(self.env["HOME"], ".claude", "plugins", "data")
        a = self.new("a", "20260101-0000", home=os.path.join(data, "ugoku-zukai-inline", "runs"))
        b = self.new("b", "20260102-0000", home=os.path.join(data, "ugoku-zukai-market", "runs"))
        self.new("other", "20260103-0000", home=os.path.join(data, "other", "runs"))
        r = self.run_wd("list", "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([x["path"] for x in json.loads(r.stdout)], [b, a])

    def test_list_same_home_twice(self):
        # UZ_RUNS_HOME と ${CLAUDE_PLUGIN_DATA}/runs が同じ場所でも、1 回だけ出る
        data = os.path.join(self.tmp.name, "data", "ugoku-zukai-inline")
        wd = self.new("a", home=os.path.join(data, "runs"))
        env = dict(self.env, UZ_RUNS_HOME=os.path.join(data, "runs"), CLAUDE_PLUGIN_DATA=data)
        rows = json.loads(self.run_wd("list", "--json", env=env).stdout)
        self.assertEqual([x["path"] for x in rows], [wd])

    def test_list_empty(self):
        r = self.run_wd("list", "--home", self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("作業フォルダがない", r.stdout)
        self.assertIn(self.home, r.stdout)
        self.assertEqual(json.loads(self.run_wd("list", "--home", self.home, "--json").stdout), [])


if __name__ == "__main__":
    unittest.main()
