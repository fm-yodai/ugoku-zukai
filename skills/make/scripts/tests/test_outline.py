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
CHECK_SB = os.path.join(SCRIPTS, "check_storyboard.cjs")
EXAMPLES = os.path.join(SCRIPTS, "..", "examples")
PAIR_SB = os.path.join(DIR, "pair", "storyboard.json")
PAIR_OUTLINE = os.path.join(DIR, "pair", "outline.json")

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

    def test_figure_must_be_string(self):   # 図の種類を配列で書いても、例外でなく誤りの文で知らせる
        for bad in (["venn", "matrix"], {"type": "venn"}, 3):
            d = load(os.path.join(DIR, "ok_ux.json"))
            d["chapters"][2]["shows"]["figure"] = bad
            errors, _ = check_outline.check(d)
            self.assertTrue(any("figure" in e for e in errors), bad)

    def test_banned_skips_user_words(self):   # 利用者の言葉（by: user）には禁止語の警告を出さない
        d = load(os.path.join(DIR, "ok_ux.json"))
        d["basics"]["audience"]["text"] = "地図を作る部署"          # by: user
        d["basics"]["look"]["text"] = "地図のような図解"            # by: claude
        _, warnings = check_outline.check(d)
        self.assertFalse(any("basics.audience" in w for w in warnings))
        self.assertTrue(any("basics.look" in w and "地図" in w for w in warnings))

    def test_says_label_has_id(self):
        items = check_outline.proposed_items(load(os.path.join(DIR, "ok_ux.json")))
        says = [i for i in items if i["where"] == "c4.2"][0]
        self.assertTrue(says["label"].endswith("言うこと c4.2"), says["label"])

    def test_no_check_contract_import(self):
        for name in ("check_outline.py", "check_text.py"):
            with open(os.path.join(SCRIPTS, name), encoding="utf-8") as f:
                self.assertNotIn("check_contract", f.read(), name)

    def test_examples_are_ready(self):         # 通る見本は examples/outlines/（claude.ai 用 zip にも入る）
        ex = os.path.join(EXAMPLES, "outlines")
        names = sorted(os.listdir(ex))
        self.assertEqual(names, ["keihi.json", "ux.json"])
        for n in names:
            self.assertEqual(subprocess.run([sys.executable, CHECK, os.path.join(ex, n), "--ready"],
                                            capture_output=True).returncode, 0, n)

    def test_proposed_items(self):
        d = load(os.path.join(DIR, "ok_ux.json"))
        items = check_outline.proposed_items(d)
        self.assertTrue(items)
        self.assertEqual({"where", "label", "text"}, set(items[0]))
        self.assertIn("basics.look", [i["where"] for i in items])
        self.assertNotIn("basics.audience", [i["where"] for i in items])   # agreed は出ない
        out = json.loads(self.run_check("ok_ux.json", "--json").stdout)
        self.assertEqual(out["proposed"], items)


class ChapterTest(unittest.TestCase):
    """台本の場面の chapter と、構成メモとの突き合わせ（check_storyboard.cjs --outline）"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, *args):
        r = subprocess.run(["node", CHECK_SB, *args, "--json"], capture_output=True, text=True)
        return r.returncode, json.loads(r.stdout)

    def variant(self, change):
        """pair/storyboard.json を書き換えたものを一時フォルダに書き、そのパスを返す"""
        sb = load(PAIR_SB)
        change(sb)
        path = os.path.join(self.tmp.name, "storyboard.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(sb, f, ensure_ascii=False)
        return path

    def test_pair_outline_is_ready(self):
        r = subprocess.run([sys.executable, CHECK, PAIR_OUTLINE, "--ready"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_chapter_shape(self):          # chapter: 3 や "a/b" は誤り
        for bad in (3, "a/b", ""):
            code, out = self.check(self.variant(lambda sb: sb["scenes"][0].update(chapter=bad)))
            self.assertEqual(code, 1, bad)
            self.assertTrue(any("chapter" in e for e in out["errors"]), bad)

    def test_mixed_chapter_warns(self):    # --outline なしで、1 場面だけ chapter を外すと警告
        code, out = self.check(self.variant(lambda sb: sb["scenes"][2].pop("chapter")))
        self.assertEqual(code, 0)
        self.assertTrue(any("chapter のない場面" in w for w in out["warnings"]))

    def test_missing_chapter_is_warning(self):
        code, out = self.check(PAIR_SB, "--outline", PAIR_OUTLINE)
        self.assertEqual(code, 0)
        self.assertTrue(any("c3" in w and "まだない" in w for w in out["warnings"]))
        self.assertEqual([c["id"] for c in out["chapters"]], ["c1", "c2", "c3"])
        self.assertEqual(out["chapters"][2]["estimated"], 0)
        self.assertGreater(out["chapters"][1]["estimated"], 0)
        self.assertEqual([c["planned"] for c in out["chapters"]], [10, 30, 20])

    def test_missing_chapter_is_error_when_complete(self):
        code, out = self.check(PAIR_SB, "--outline", PAIR_OUTLINE, "--complete")
        self.assertEqual(code, 1)
        self.assertTrue(any("c3" in e for e in out["errors"]))

    def test_unknown_chapter(self):        # 場面の chapter が構成メモにない
        code, out = self.check(self.variant(lambda sb: sb["scenes"][1].update(chapter="c9")), "--outline", PAIR_OUTLINE)
        self.assertEqual(code, 1)
        self.assertTrue(any("c9" in e for e in out["errors"]))

    def test_scene_without_chapter_with_outline(self):
        code, out = self.check(self.variant(lambda sb: sb["scenes"][2].pop("chapter")), "--outline", PAIR_OUTLINE)
        self.assertEqual(code, 1)
        self.assertTrue(any("s3" in e and "chapter" in e for e in out["errors"]))

    def test_order_warning(self):          # c2 の場面を c1 の前に置く
        code, out = self.check(self.variant(lambda sb: sb["scenes"].insert(0, sb["scenes"].pop(1))), "--outline", PAIR_OUTLINE)
        self.assertEqual(code, 0)
        self.assertTrue(any("順" in w for w in out["warnings"]))
        code, out = self.check(PAIR_SB, "--outline", PAIR_OUTLINE)
        self.assertFalse(any("順" in w for w in out["warnings"]))

    def test_estimated_sums_to_duration(self):
        code, out = self.check(PAIR_SB, "--outline", PAIR_OUTLINE)
        total = sum(c["estimated"] for c in out["chapters"])
        gap = out["duration"] - total      # 頭の 0.8 秒＋終わりの札までの 0.8 秒＋札の 3.2 秒（＋動作のはみ出し）
        self.assertGreater(gap, 4.0)
        self.assertLess(gap, 8.0)

    def test_chapter_length_warning(self):  # 章の見積もりが目安から 30% を超えてずれると警告
        outline = load(PAIR_OUTLINE)
        outline["chapters"][1]["seconds"] = 300
        path = os.path.join(self.tmp.name, "outline.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(outline, f, ensure_ascii=False)
        code, out = self.check(PAIR_SB, "--outline", path)
        self.assertEqual(code, 0)
        self.assertTrue(any("c2" in w and "目安" in w for w in out["warnings"]))

    def test_outline_file_missing(self):
        r = subprocess.run(["node", CHECK_SB, PAIR_SB, "--outline", os.path.join(self.tmp.name, "none.json")],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)

    def test_text_output_lists_chapters(self):
        r = subprocess.run(["node", CHECK_SB, PAIR_SB, "--outline", PAIR_OUTLINE], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"章 c2: 見積もり [0-9.]+ 秒（目安 30 秒）")

    def test_split_chapter_warns(self):     # s1(c1) s2(c2) s3(c1)
        code, out = self.check(self.variant(lambda sb: sb["scenes"][2].update(chapter="c1")), "--outline", PAIR_OUTLINE)
        self.assertEqual(code, 0)
        self.assertTrue(any("c1" in w and "離れて" in w for w in out["warnings"]))
        code, out = self.check(PAIR_SB, "--outline", PAIR_OUTLINE)
        self.assertFalse(any("離れて" in w for w in out["warnings"]))

    def test_complete_needs_outline(self):
        r = subprocess.run(["node", CHECK_SB, PAIR_SB, "--complete"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("--outline", r.stderr)

    def test_examples_still_pass(self):    # chapter のない今の見本は、警告も増えない
        code, out = self.check(os.path.join(EXAMPLES, "sequence.json"))
        self.assertEqual(code, 0)
        self.assertFalse(any("chapter" in w for w in out["warnings"]))
        self.assertNotIn("chapters", out)


if __name__ == "__main__":
    unittest.main()
