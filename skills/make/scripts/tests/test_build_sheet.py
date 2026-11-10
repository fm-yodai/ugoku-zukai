#!/usr/bin/env python3
"""利用者向けの絵コンテのページ（build_sheet.py）の検査（標準ライブラリだけ）。python3 test_build_sheet.py で回す。"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
BUILD = os.path.join(SCRIPTS, "build_sheet.py")
FRAMES = os.path.join(SCRIPTS, "frames.cjs")
SEQ = os.path.join(SCRIPTS, "..", "examples", "sequence.json")
PAIR_SB = os.path.join(HERE, "outlines", "pair", "storyboard.json")
PAIR_OUTLINE = os.path.join(HERE, "outlines", "pair", "outline.json")

sys.path.insert(0, SCRIPTS)
try:
    import build_sheet
except ImportError:  # まだ無いときは、各検査が失敗で知らせる
    build_sheet = None


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class BuildSheetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = cls.tmp.name
        cls.n = 0
        cls.sb_seq, cls.sb_pair = load(SEQ), load(PAIR_SB)
        cls.frames_seq = cls.frames(SEQ)
        cls.frames_pair = cls.frames(PAIR_SB)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    @classmethod
    def newdir(cls):
        cls.n += 1
        return os.path.join(cls.dir, f"d{cls.n}")

    @classmethod
    def frames(cls, sb, *extra):
        """frames.cjs を一時フォルダに回し、出力先を返す（resvg がない環境の終了コード 4 も許す）"""
        out = cls.newdir()
        r = subprocess.run(["node", FRAMES, sb, "--theme", "flat", "-o", out, *extra], capture_output=True, text=True)
        assert r.returncode in (0, 4), r.stderr
        return out

    def build(self, sb, frames_dir, *extra):
        out = os.path.join(self.newdir() + ".html")
        r = subprocess.run([sys.executable, BUILD, sb, "--frames", frames_dir, "-o", out, *extra], capture_output=True, text=True)
        html = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
        return r, html

    def build_variant(self, change):
        """sequence.json を書き換えた台本で、frames.cjs を回し直してから組み立てる"""
        sb = load(SEQ)
        change(sb)
        path = self.newdir() + ".json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(sb, f, ensure_ascii=False)
        return self.build(path, self.frames(path))

    def copy_frames(self, src):
        dst = self.newdir()
        shutil.copytree(src, dst)
        return dst

    def set_png_false(self, d):
        fr = load(os.path.join(d, "frames.json"))
        fr["png"] = False
        with open(os.path.join(d, "frames.json"), "w", encoding="utf-8") as f:
            json.dump(fr, f, ensure_ascii=False)
        for p in glob.glob(os.path.join(d, "sheet-*.png")):
            os.remove(p)

    def test_every_line(self):
        r, html = self.build(SEQ, self.frames_seq)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = [(sc["id"], ln) for sc in self.sb_seq["scenes"] for ln in sc["lines"]]
        self.assertEqual(html.count("<img "), len(lines))
        for sid, ln in lines:
            self.assertIn(f"{sid} / {ln['id']} @", html)
        self.assertRegex(html, r"s1 / l1 @0:0\d")
        self.assertIn("社員が出勤を打刻すると、アプリはその時刻を勤怠システムに送ります。", html)   # 全文。印は出ない
        self.assertNotIn("{a}", html)

    def test_no_external(self):
        _, html = self.build(SEQ, self.frames_seq)
        self.assertNotRegex(html, r'(src|href)="https?:')
        self.assertNotIn("<script", html)
        self.assertIn('src="data:image/svg+xml;base64,', html)

    def test_chapters_without_outline(self):   # 図の title が章の見出しになる
        _, html = self.build(SEQ, self.frames_seq)
        self.assertIn("打刻から給与計算まで", html)
        self.assertNotIn("Claude が決めたこと", html)

    def test_chapters_with_outline(self):
        _, html = self.build(PAIR_SB, self.frames_pair, "--outline", PAIR_OUTLINE)
        outline = load(PAIR_OUTLINE)
        self.assertIn(outline["chapters"][1]["title"], html)
        self.assertIn(outline["chapters"][1]["says"][0]["text"], html)
        self.assertNotIn(outline["chapters"][2]["title"], html)   # 場面のない章は出さない
        self.assertIn("Claude が決めたこと", html)
        self.assertIn(outline["basics"]["look"]["text"], html)    # proposed の項目
        self.assertNotIn(outline["basics"]["audience"]["text"], html)   # agreed の項目は一覧に出さない

    def test_no_proposed_section_when_all_agreed(self):
        outline = load(PAIR_OUTLINE)
        outline["basics"]["look"]["state"] = "agreed"
        outline["chapters"][1]["shows"]["state"] = "agreed"
        path = self.newdir() + ".json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(outline, f, ensure_ascii=False)
        r, html = self.build(PAIR_SB, self.frames_pair, "--outline", path)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Claude が決めたこと", html)

    def test_chapters_function(self):
        with_outline = build_sheet.chapters(self.sb_pair, load(PAIR_OUTLINE))
        self.assertEqual([(c["title"], c["scenes"]) for c in with_outline],
                         [("現状の課題", ["s1"]), ("案の比較", ["s2", "s3"])])
        self.assertEqual(len(with_outline[1]["says"]), 2)
        without = build_sheet.chapters(self.sb_pair, None)
        self.assertEqual([(c["title"], c["scenes"]) for c in without],
                         [("いまの困りごと", ["s1"]), ("二つの案", ["s2"]), ("困りごとへの効き方", ["s3"])])
        self.assertEqual(without[0]["says"], [])

    def test_escapes_text(self):
        # 台本の字幕と題に <b>&"x" を入れ、frames.cjs を回し直してから組み立てる
        def change(sb):
            sb["title"] = 'T<i>&"t"'
            sb["scenes"][0]["lines"][0].update(text='A<b>&"x"は{a}B')
            sb["scenes"][0]["lines"][0].pop("read", None)
        r, html = self.build_variant(change)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("A&lt;b&gt;&amp;", html)
        self.assertNotIn("A<b>", html)
        self.assertIn("T&lt;i&gt;&amp;", html)
        self.assertNotIn("T<i>", html)

    def test_works_without_png(self):
        # frames.json の png を false にし、sheet-*.png を消しても同じ HTML になる
        d = self.copy_frames(self.frames_seq)
        self.set_png_false(d)
        _, a = self.build(SEQ, self.frames_seq)
        r, b = self.build(SEQ, d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(a, b)

    def test_partial_frames(self):             # --scenes で 1 場面だけ書いた出力からは、その行だけ出る
        d = self.frames(PAIR_SB, "--scenes", "s2")
        _, html = self.build(PAIR_SB, d, "--outline", PAIR_OUTLINE)
        n = len(self.sb_pair["scenes"][1]["lines"])
        self.assertEqual(html.count("<img "), n)
        self.assertNotIn("s1 / ", html)
        self.assertNotIn("現状の課題", html)     # 行が 1 つもない章は見出しごと出さない

    def test_artifact(self):
        _, html = self.build(SEQ, self.frames_seq, "--artifact")
        self.assertNotIn("<html", html)
        self.assertNotIn("<body", html)
        self.assertIn("<title>", html)
        self.assertIn(" 絵コンテ</title>", html)
        _, full = self.build(SEQ, self.frames_seq)
        self.assertIn("<!doctype html>", full)
        self.assertIn("<body", full)

    def test_stale_frames(self):
        # 台本を直した後に frames.cjs を回し直していないと、古い字幕のまま書かずに止まる
        def stale(change):
            sb = load(PAIR_SB)
            change(sb)
            path = self.newdir() + ".json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(sb, f, ensure_ascii=False)
            return self.build(path, self.frames_pair)
        for change in (
            lambda sb: sb["scenes"][0]["lines"][0].update(text="書き直した{a}字幕です。"),              # 字幕を直した
            lambda sb: sb["scenes"][0]["lines"].append({"id": "l99", "text": "足した行です。"}),        # 行を足した
            lambda sb: sb["scenes"][1]["lines"].pop(),                                                  # 行を消した
        ):
            r, html = stale(change)
            self.assertEqual(r.returncode, 2)
            self.assertEqual(html, "")
            self.assertIn("frames.cjs", r.stderr)

    def test_frames_of_another_storyboard(self):   # 別の台本のコマ（0 コマになる）では書かずに止まる
        r, html = self.build(SEQ, self.frames(os.path.join(SCRIPTS, "..", "examples", "mixed.json"), "--scenes", "s2"))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(html, "")

    def test_long_word_in_says_wraps(self):        # says に長い英字の並びがあっても横スクロールを出さない
        self.assertRegex(build_sheet.STYLE, r"\.us-says \{[^}]*overflow-wrap: anywhere")

    def test_makes_output_folder(self):
        out = os.path.join(self.newdir(), "deep", "sheet.html")
        r = subprocess.run([sys.executable, BUILD, SEQ, "--frames", self.frames_seq, "-o", out], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(out))

    def test_broken_outline_is_rejected(self):
        for broken in ([], {"format": "ugoku-zukai-outline/1", "title": "t", "basics": {}, "chapters": [{"id": "c1", "title": 3}]}):
            path = self.newdir() + ".json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(broken, f)
            r, html = self.build(PAIR_SB, self.frames_pair, "--outline", path)
            self.assertEqual(r.returncode, 2)
            self.assertEqual(html, "")
            self.assertIn("構成メモ", r.stderr)

    def test_no_frames(self):
        r, _ = self.build(SEQ, os.path.join(self.dir, "none"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("frames.json", r.stderr)


if __name__ == "__main__":
    unittest.main()
