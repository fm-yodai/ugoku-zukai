#!/usr/bin/env python3
"""再生ページのチャプター一覧の検査（標準ライブラリだけ）。python3 test_build_chapters.py で回す。"""
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
TEMPLATE = os.path.join(HERE, "..", "..", "player", "template.html")
CHECK = os.path.join(HERE, "..", "check_storyboard.cjs")


def embedded(html):
    """HTML に埋め込まれた UZ_DATA の JSON を取り出す"""
    m = re.search(r"const UZ_DATA = (.*?);\n", html, re.S)
    return json.loads(m.group(1))


class BuildChaptersTest(unittest.TestCase):
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

    def test_no_residual(self):
        r, html = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("residual", embedded(html))
        self.assertNotIn('id="uz-residual"', html)
        self.assertNotIn('id="uz-sources"', html)
        self.assertIn('id="uz-chapters"', html)
        self.assertIn("チャプター", html)

    def test_review_flag_removed(self):
        r, html = self.build("--review", self.dir)
        self.assertNotEqual(r.returncode, 0)

    def test_artifact_keeps_chapters(self):
        r, html = self.build("--artifact")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('id="uz-chapters"', html)
        self.assertNotIn("<html", html)

    def test_chapters_without_timeline(self):
        # 時刻表が無くても、台本の場面と行は UZ_DATA に入る（一覧は見積もりの時刻で作る）
        r, html = self.build()
        d = embedded(html)
        self.assertIsNone(d["timeline"])
        self.assertTrue(d["storyboard"]["scenes"])

    def test_untitled_scenes_warn(self):
        # 題の無い場面が 2 つ続くと check_storyboard.cjs が警告する（終了コードは 0）
        sb = json.load(open(SAMPLE, encoding="utf-8"))
        for sc in sb["scenes"]:
            sc.pop("title", None)
        for f in sb["figures"].values():
            f.pop("title", None)
        p = os.path.join(self.dir, "u.json")
        json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        r = subprocess.run(["node", CHECK, p, "--theme", "koo"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("題の無い場面が続く", r.stdout)

    def test_untitled_warning_text(self):
        # 続いた場面の id を全部並べ、続きごとに 1 回だけ警告する
        sb = json.load(open(SAMPLE, encoding="utf-8"))
        ids = [sc["id"] for sc in sb["scenes"]]
        for sc in sb["scenes"]:
            sc.pop("title", None)
        for f in sb["figures"].values():
            f.pop("title", None)
        p = os.path.join(self.dir, "u.json")
        json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        r = subprocess.run(["node", CHECK, p, "--json"], capture_output=True, text=True)
        warns = [w for w in json.loads(r.stdout)["warnings"] if "題の無い場面が続く" in w]
        self.assertEqual(len(warns), 1, warns)
        # title 型の図の場面は題があるものとして数える
        titled = {sc["id"] for sc in sb["scenes"]
                  if not isinstance(sc["figure"], list) and sb["figures"][sc["figure"]]["type"] == "title"}
        for i in ids:
            if i not in titled:
                self.assertIn(f"「{i}」", warns[0])

    def test_chapter_lists_contained(self):
        # 一覧の失敗で「準備に失敗」にしない（buildChapters の呼び出しを別の try で包む）
        html = open(TEMPLATE, encoding="utf-8").read()
        self.assertTrue(re.search(r"try \{ buildChapters\(\); \} catch \(e\) \{ console\.error", html))

    def test_validate_warns_bad_source(self):
        sb = json.load(open(SAMPLE, encoding="utf-8"))
        lines = [l for sc in sb["scenes"] for l in sc["lines"]]
        lines[0]["source"] = 5
        lines[1]["source"] = ["a.py:1", 3]
        lines[2]["source"] = "a.py:1"
        p = os.path.join(self.dir, "sb.json")
        json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        r = subprocess.run(["node", CHECK, p, "--json"], capture_output=True, text=True)
        warns = json.loads(r.stdout)["warnings"]
        bad = [w for w in warns if "source" in w]
        self.assertEqual(len(bad), 2, warns)
        self.assertIn(lines[0]["id"], bad[0])
        self.assertIn(lines[1]["id"], bad[1])


# template.html の chapterData を node で動かす（DOM は使わない）
CHAPTERS_JS = r"""
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const m = html.match(/  function chapterData\(\) \{[\s\S]*?\n  \}\n/);
if (!m) { console.log("NOFUNC"); process.exit(1); }
const UZ = { parseText: t => ({ text: t }) };
const M = JSON.parse(process.argv[2]);
eval(m[0]);
console.log(JSON.stringify(chapterData()));
"""


class ChapterDataTest(unittest.TestCase):
    def chapters(self, scenes, figs):
        lines, t = [], 0
        for sc in scenes:
            for ln in sc["lines"]:
                lines.append({"id": ln["id"], "start": t})
                t += 1
        model = {"scenes": scenes, "figs": figs, "timeline": {"lines": lines}}
        r = subprocess.run(["node", "-e", CHAPTERS_JS, TEMPLATE, json.dumps(model, ensure_ascii=False)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_grouping(self):
        figs = {"t": {"type": "title"}, "a": {"type": "flow"}, "b": {"type": "flow"}}
        scenes = [
            {"id": "s0", "header": "", "figs": ["t"], "start": 0, "lines": [{"id": "l0", "text": "x"}]},
            {"id": "s1", "header": "流れ", "figs": ["a"], "start": 1,
             "lines": [{"id": "l1", "text": "あ" * 30, "source": "a.py:1"}]},
            {"id": "s2", "header": "", "figs": ["b"], "start": 2,
             "lines": [{"id": "l2", "text": "b", "source": ["b.py:2", 3, "c.py:3"]}]},
            {"id": "s3", "header": "流れ", "figs": ["a"], "start": 3, "lines": [{"id": "l3", "text": "c"}]},
            {"id": "s4", "header": "まとめ", "figs": ["b"], "start": 4, "lines": [{"id": "l4", "text": "d"}]},
        ]
        ch = self.chapters(scenes, figs)
        self.assertEqual([c["title"] for c in ch], ["はじめに", "流れ", "まとめ"])
        self.assertEqual([c["start"] for c in ch], [0, 1, 4])
        self.assertEqual([l["id"] for l in ch[1]["lines"]], ["l1", "l2", "l3"])
        self.assertEqual(ch[1]["lines"][0]["text"], "あ" * 24 + "…")
        self.assertEqual(ch[1]["lines"][0]["sources"], ["a.py:1"])
        self.assertEqual(ch[1]["lines"][1]["sources"], ["b.py:2", "c.py:3"])
        self.assertEqual(ch[0]["lines"][0]["sources"], [])

    def test_untitled_first(self):
        figs = {"a": {"type": "flow"}}
        scenes = [{"id": "s0", "header": "", "figs": ["a"], "start": 0, "lines": [{"id": "l0", "text": "x"}]}]
        ch = self.chapters(scenes, figs)
        self.assertEqual([c["title"] for c in ch], ["はじめに"])


if __name__ == "__main__":
    unittest.main()
