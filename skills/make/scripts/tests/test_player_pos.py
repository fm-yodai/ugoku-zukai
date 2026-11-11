#!/usr/bin/env python3
"""再生ページの「直したい箇所を指定する」の検査（標準ライブラリだけ）。python3 test_player_pos.py で回す。"""
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

# template.html の posAt と posText を node で動かす（DOM は使わない。fmt は template.html と同じ定義）
POS_JS = r"""
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const grab = name => {
  const m = html.match(new RegExp("  function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n"));
  if (!m) { console.log("NOFUNC " + name); process.exit(1); }
  return m[0];
};
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const M = JSON.parse(process.argv[2]);
eval(grab("posAt") + grab("posText"));
const q = JSON.parse(process.argv[3]);
console.log(JSON.stringify(q.map(x => x.length === 1 ? posText(posAt(x[0])) : posText(posAt(x[0]), posAt(x[1])))));
"""

MODEL = {"scenes": [{"id": "s1", "start": 0.45, "lines": [{"id": "l1"}, {"id": "l2"}]},
                    {"id": "s2", "start": 9.0, "lines": [{"id": "l3"}, {"id": "l4"}]}],
         "timeline": {"lines": [{"id": "l1", "scene": "s1", "start": 0.8}, {"id": "l2", "scene": "s1", "start": 4.0},
                                {"id": "l3", "scene": "s2", "start": 9.35}, {"id": "l4", "scene": "s2", "start": 14.0}]}}


class PlayerPosTest(unittest.TestCase):
    def run_pos(self, queries):
        r = subprocess.run(["node", "-e", POS_JS, TEMPLATE, json.dumps(MODEL), json.dumps(queries)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def build(self, *extra):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "p.html")
            r = subprocess.run([sys.executable, BUILD, SAMPLE, "-o", out, *extra], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            return open(out, encoding="utf-8").read()

    def test_pos_cases(self):
        cases = [([0], "s1 / l1 @0:00"),                        # 最初の行より前
                 ([5], "s1 / l2 @0:05"),
                 ([9.1], "s2 / l3 @0:09"),                      # 場面は変わったが、行はまだ始まっていない
                 ([14.5], "s2 / l4 @0:14"),
                 ([999], "s2 / l4 @16:39"),                     # 終わりより後
                 ([5, 14.5], "s1 / l2 @0:05 〜 s2 / l4 @0:14"),
                 ([14.5, 5], "s1 / l2 @0:05 〜 s2 / l4 @0:14"),  # 終わりを先に指した
                 ([5, 5.2], "s1 / l2 @0:05")]                   # 同じ表記になる 2 点
        self.assertEqual(self.run_pos([c[0] for c in cases]), [c[1] for c in cases])

    def test_elements_in_both_builds(self):
        # build_player.py の出力（--artifact あり・なし）に 5 つの id と <details がある
        for extra in ([], ["--artifact"]):
            html = self.build(*extra)
            for i in ("uz-point", "uz-pos", "uz-pos-copy", "uz-pos-from", "uz-pos-note"):
                self.assertIn(f'id="{i}"', html)
            self.assertIn("<details", html)

    def test_copy_has_fallbacks(self):
        # クリップボードの API、execCommand、選択だけ残す、の 3 段がある。<audio> は足していない
        html = open(TEMPLATE, encoding="utf-8").read()
        for w in ("navigator.clipboard", 'execCommand("copy")', "getSelection"):
            self.assertIn(w, html)
        self.assertNotIn("<audio", html)

    def test_wording(self):
        # 利用者の指摘: ボタンは「範囲指定」「範囲指定解除」、見出しは「直したい箇所を指定する」（「指す」を目的語なしで使わない）
        html = open(TEMPLATE, encoding="utf-8").read()
        for w in ("<summary>直したい箇所を指定する</summary>", ">範囲指定</button>", '"範囲指定解除" : "範囲指定"', "「範囲指定」を押し"):
            self.assertIn(w, html)
        for w in ("箇所を指す", "範囲をやめる", "範囲の始まりにする"):
            self.assertNotIn(w, html)

    def test_copy_failure_pauses(self):
        # コピーできなかったら一時停止する（再生中は位置の文字が書き換わり、選択が消えるため）
        html = open(TEMPLATE, encoding="utf-8").read()
        self.assertTrue(re.search(r'if \(playing\) \{ pause\(\); tick\(\); \}\s*select\(\);\s*say\("コピーできませんでした', html))

    def test_pos_failure_does_not_stop_player(self):
        # 位置の表示の準備は、チャプター一覧と同じく別の try で包む
        html = open(TEMPLATE, encoding="utf-8").read()
        self.assertTrue(re.search(r"try \{ buildPoint\(\); \} catch \(e\) \{ console\.error", html))


if __name__ == "__main__":
    unittest.main()
