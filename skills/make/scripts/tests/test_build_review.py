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


TEMPLATE = os.path.join(HERE, "..", "..", "player", "template.html")
CHECK = os.path.join(HERE, "..", "check_storyboard.cjs")

# template.html の buildLists を、DOM の代わりの小さな部品で node で動かす
LISTS_JS = r"""
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const m = html.match(/  function buildLists\(\) \{[\s\S]*?\n  \}\n/);
if (!m) { console.log("NOFUNC"); process.exit(1); }
function el() {
  return { hidden: true, children: [], textContent: "", className: "", type: "",
    append(...xs) { this.children.push(...xs); }, querySelector() { return this._q || (this._q = el()); } };
}
const els = { "uz-residual": el(), "uz-sources": el() };
const $ = id => els[id];
const document = { createElement: () => el() };
const fmt = t => String(t);
const UZ = { parseText: t => ({ text: t }), player: { seek() {} } };
const M = { timeline: { lines: [{ id: "l1", start: 0 }, { id: "l2", start: 1 }, { id: "l3", start: 2 }] } };
const UZ_DATA = JSON.parse(process.argv[2]);
eval(m[0]);
buildLists();
const ul = els["uz-sources"].querySelector("ul");
console.log(JSON.stringify({ hidden: els["uz-sources"].hidden,
  rows: ul.children.map(li => li.children.slice(1).map(c => c.textContent)) }));
"""


class ListsTest(unittest.TestCase):
    def lists(self, lines):
        data = {"residual": None, "storyboard": {"scenes": [{"lines": lines}]}}
        r = subprocess.run(["node", "-e", LISTS_JS, TEMPLATE, json.dumps(data, ensure_ascii=False)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_source_string_and_array(self):
        out = self.lists([{"id": "l1", "text": "a", "source": "a.py:1"},
                          {"id": "l2", "text": "b", "source": ["b.py:2", "c.py:3"]},
                          {"id": "l3", "text": "c"}])
        self.assertFalse(out["hidden"])
        self.assertEqual(out["rows"], [["a.py:1"], ["b.py:2", "c.py:3"]])

    def test_lists_failure_is_contained(self):
        # 一覧の失敗で「準備に失敗」にしない（buildLists の呼び出しを別の try で包む）
        html = open(TEMPLATE, encoding="utf-8").read()
        self.assertTrue(re.search(r"try \{ buildLists\(\); \} catch \(e\) \{ console\.error", html), "buildLists() の呼び出しが別の try で包まれていない")

    def test_validate_warns_bad_source(self):
        sb = json.load(open(SAMPLE, encoding="utf-8"))
        lines = [l for sc in sb["scenes"] for l in sc["lines"]]
        lines[0]["source"] = 5
        lines[1]["source"] = ["a.py:1", 3]
        lines[2]["source"] = "a.py:1"
        p = os.path.join(tempfile.mkdtemp(), "sb.json")
        json.dump(sb, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        r = subprocess.run(["node", CHECK, p, "--json"], capture_output=True, text=True)
        warns = json.loads(r.stdout)["warnings"]
        bad = [w for w in warns if "source" in w]
        self.assertEqual(len(bad), 2, warns)
        self.assertIn(lines[0]["id"], bad[0])
        self.assertIn(lines[1]["id"], bad[1])


if __name__ == "__main__":
    unittest.main()
