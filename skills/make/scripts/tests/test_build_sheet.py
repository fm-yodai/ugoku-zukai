#!/usr/bin/env python3
"""利用者向けの絵コンテのページ（build_sheet.py）の検査（標準ライブラリだけ）。python3 test_build_sheet.py で回す。"""
import glob
import json
import os
import re
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
SLIDE_SB = os.path.join(SCRIPTS, "..", "examples", "slide-forms.json")
SLIDE_OUTLINE = os.path.join(SCRIPTS, "..", "examples", "outlines", "slide-forms.json")

sys.path.insert(0, SCRIPTS)
sys.path.insert(0, HERE)
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
        r = subprocess.run(["node", FRAMES, sb, "--theme", "koo", "-o", out, *extra], capture_output=True, text=True)
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
        self.assertNotIn(outline["chapters"][2]["title"], html)   # 場面のない章は出さない
        # 前の形（/1）の構成メモ: 章の題とコマと原稿だけ。「言うこと」と、進行役が決めたことの一覧は出さない
        self.assertNotIn(outline["chapters"][1]["says"][0]["text"], html)
        self.assertNotIn("Claude が決めたこと", html)
        self.assertNotIn(outline["basics"]["look"]["text"], html)
        for cls in ("us-says", "us-decided", "us-open", "us-intent", "us-slide"):
            self.assertNotIn(f'class="{cls}', html)

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
        self.assertEqual([c["id"] for c in with_outline], [load(PAIR_OUTLINE)["chapters"][i]["id"] for i in (0, 1)])
        self.assertNotIn("says", with_outline[1])
        without = build_sheet.chapters(self.sb_pair, None)
        self.assertEqual([(c["title"], c["scenes"]) for c in without],
                         [("いまの困りごと", ["s1"]), ("二つの案", ["s2"]), ("困りごとへの効き方", ["s3"])])
        self.assertIsNone(without[0]["id"])

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
        self.assertIn(" スライドコンテ</title>", html)
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

    def test_long_word_in_intent_wraps(self):      # 意図に長い英字の並びがあっても横スクロールを出さない
        self.assertRegex(build_sheet.STYLE, r"\.us-intent[^{]*\{[^}]*overflow-wrap: anywhere")

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

    # ---- スライドの段（完成形のコマと意図）----
    def slide_setup(self):
        if not hasattr(BuildSheetTest, "frames_slide"):
            BuildSheetTest.frames_slide = self.frames(SLIDE_SB)
        return BuildSheetTest.frames_slide

    def test_slide_block(self):
        r, html = self.build(SLIDE_SB, self.slide_setup(), "--outline", SLIDE_OUTLINE)
        self.assertEqual(r.returncode, 0, r.stderr)
        ol, sb = load(SLIDE_OUTLINE), load(SLIDE_SB)
        self.assertEqual(html.count('class="us-slide"'), 4)
        self.assertEqual(html.count('class="us-final"'), 4)
        for ch in ol["chapters"]:
            self.assertIn(ch["intent"]["text"], html)
            for sl in ch["slides"]:
                self.assertIn(sl["intent"]["text"], html)
                self.assertIn(f"<h3>{sb['slides'][sl['id']]['title']}</h3>", html)
        self.assertIn("章の順番: " + ol["flow"]["text"], html)
        self.assertIn("前の章から: " + ol["chapters"][1]["link"]["text"], html)
        self.assertIn("前のスライドから: " + ol["chapters"][1]["slides"][1]["link"]["text"], html)
        self.assertEqual(html.count("章の順番: "), 1)
        # 並び: 章の題 → 章の意図 → 完成形 → スライドの意図 → その場面の行
        order = [html.index(x) for x in ("<h2>二つの言葉の定義</h2>", ol["chapters"][1]["intent"]["text"], "<h3>二つの言葉の定義</h3>",
                                         ol["chapters"][1]["slides"][0]["intent"]["text"], "s3 / l4 @")]
        self.assertEqual(order, sorted(order))
        self.assertEqual(html.count("<img "), 4 + sum(len(sc["lines"]) for sc in sb["scenes"]))

    def test_no_meta(self):
        _, html = self.build(SLIDE_SB, self.slide_setup(), "--outline", SLIDE_OUTLINE)
        for word in ("Claude が決めたこと", "まだ決めていないこと", "見積もり", "合成した声", "proposed", "agreed", "検査"):
            self.assertNotIn(word, html)
        self.assertRegex(html, r"<title>[^<]* スライドコンテ</title>")

    def test_slide_reused_once(self):
        sb = load(SLIDE_SB)   # whose（s5・s6）の間に、relation の場面を挟む
        s6 = sb["scenes"].pop()
        sb["scenes"] += [{"id": "s9", "chapter": "c3", "slide": "relation", "lines": [{"id": "l90", "text": "関係の図に戻ります。"}]}, s6]
        path = os.path.join(os.path.dirname(SLIDE_SB), "_tmp_reuse.json")   # 画像の相対パスのため、見本と同じフォルダに置く
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(sb, f, ensure_ascii=False)
            r, html = self.build(path, self.frames(path))
        finally:
            os.remove(path)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(html.count('class="us-final"'), 4)   # relation も whose も 1 回だけ
        self.assertEqual(html.count("<h3>誰の体験か</h3>"), 1)
        for ref in ("s9 / l90 @", "s6 / l12 @"):
            self.assertIn(ref, html)

    def test_partial_frames_slides(self):
        r, html = self.build(SLIDE_SB, self.frames(SLIDE_SB, "--scenes", "s3"), "--outline", SLIDE_OUTLINE)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(html.count('class="us-slide"'), 1)
        self.assertIn("<h3>二つの言葉の定義</h3>", html)
        self.assertNotIn("<h3>UX の定義</h3>", html)

    def test_scene_title_from_slide(self):   # 構成メモなし: 章の見出しはスライドの title。意図は出ない
        _, html = self.build(SLIDE_SB, self.slide_setup())
        for title in ("二つの言葉の関係", "UX の定義", "誰の体験か"):
            self.assertIn(f"<h2>{title}</h2>", html)
        self.assertNotIn('class="us-intent"', html)
        self.assertEqual(html.count('class="us-final"'), 4)

    # ---- 複数案（--alts）----
    def alts_setup(self, options=None, replaces=None):
        """作業フォルダ（見本と同じ画像を持つ）に、今の台本と案 B の台本・コマ・alts.json を作る。戻り値: (作業フォルダ, alts.json のパス)"""
        import alt_fixture
        wd = self.newdir()
        os.makedirs(os.path.join(wd, "alts", "g1", "b"))
        shutil.copytree(os.path.join(os.path.dirname(SLIDE_SB), "assets"), os.path.join(wd, "assets"))
        shutil.copytree(os.path.join(wd, "assets"), os.path.join(wd, "alts", "g1", "b", "assets"))
        shutil.copy(SLIDE_SB, os.path.join(wd, "storyboard.json"))
        with open(os.path.join(wd, "alts", "g1", "b", "storyboard.json"), "w", encoding="utf-8") as f:
            json.dump(alt_fixture.variant_b(load(SLIDE_SB)), f, ensure_ascii=False)
        for sb, out in ((os.path.join(wd, "storyboard.json"), "frames"), (os.path.join(wd, "alts", "g1", "b", "storyboard.json"), "alts/g1/b/frames")):
            r = subprocess.run(["node", FRAMES, sb, "--theme", "koo", "-o", os.path.join(wd, out)], capture_output=True, text=True)
            assert r.returncode in (0, 4), r.stderr
        opts = options or [
            {"name": "案 A", "diff": "図を左、定義を右に置く", "storyboard": "storyboard.json", "frames": "frames"},
            {"name": "案 B", "diff": "定義を 2 枚に分け、図をなくす", "storyboard": "alts/g1/b/storyboard.json", "frames": "alts/g1/b/frames",
             "slides": alt_fixture.OPTION_B_SLIDES}]
        path = os.path.join(wd, "alts.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"groups": [{"id": "g1", "replaces": replaces or ["definitions"], "options": opts}]}, f, ensure_ascii=False)
        return wd, path

    def build_alts(self, wd, path):
        return self.build(os.path.join(wd, "storyboard.json"), os.path.join(wd, "frames"), "--outline", SLIDE_OUTLINE, "--alts", path)

    def test_alts_block(self):
        wd, path = self.alts_setup()
        r, html = self.build_alts(wd, path)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(html.count('class="us-alts"'), 1)
        self.assertEqual(html.count('class="us-alt"'), 2)
        a, b = html.split('class="us-alt"')[1:]
        b = b.split("<!--/us-alts-->")[0]
        self.assertIn("<h3>案 A</h3>", a)
        self.assertIn("図を左、定義を右に置く", a)
        self.assertEqual(a.count('class="us-final"'), 1)
        self.assertIn(load(SLIDE_OUTLINE)["chapters"][1]["slides"][0]["intent"]["text"], a)   # 案 A の意図は構成メモのもの
        self.assertIn("s3 / l4 @", a)
        self.assertIn("<h3>案 B</h3>", b)
        self.assertEqual(b.count('class="us-final"'), 2)
        for word in ("定義を 2 枚に分け、図をなくす", "ユーザビリティの定義だけを、落ち着いて読める", "前のスライドから: 同じ形で、広いほうの語に進む", "s3a / l4a @", "s3b / l4b @"):
            self.assertIn(word, b)
        # 案の段の外には、置き換える範囲のスライドの段も行も出ない。ほかのスライドは今までどおり
        outside = html.split('class="us-alts"')[0] + html.split('class="us-alts"')[1].split("</div><!--/us-alts-->")[1]
        self.assertNotIn("s3 / l4 @", outside)
        self.assertEqual(outside.count('class="us-final"'), 3)
        self.assertIn("s4 / l8 @", outside)
        self.assertNotIn("<script", html)

    def test_alts_errors(self):
        wd, path = self.alts_setup()
        good = load(path)

        def run(change):
            d = json.loads(json.dumps(good))
            change(d)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False)
            r, html = self.build_alts(wd, path)
            self.assertEqual(r.returncode, 2)
            self.assertEqual(html, "")
            return r.stderr
        g = lambda d: d["groups"][0]
        self.assertIn("スライド「nai」が台本にない", run(lambda d: g(d).update(replaces=["nai"])))
        self.assertIn("続いていない", run(lambda d: g(d).update(replaces=["relation", "ux-def"])))
        self.assertIn("案は 2〜4 つ", run(lambda d: g(d).update(options=g(d)["options"][:1])))
        self.assertIn("案の名前「案 A」が重なっている", run(lambda d: g(d)["options"][1].update(name="案 A")))
        self.assertIn("台本がない", run(lambda d: g(d)["options"][1].update(storyboard="alts/g1/x/storyboard.json")))
        self.assertIn("frames.json", run(lambda d: g(d)["options"][1].update(frames="alts/g1/x/frames")))
        self.assertIn("スライド「nai」が、案「案 B」の台本にない", run(lambda d: g(d)["options"][1].update(slides=[{"id": "nai", "intent": "x"}])))
        r, html = self.build(os.path.join(wd, "storyboard.json"), os.path.join(wd, "frames"), "--alts", os.path.join(wd, "none.json"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("alts.json", r.stderr)

    # ---- まだ決めていないこと（構成メモの open）と、時刻の出どころ ----
    def outline_with_open(self, items):
        ol = load(PAIR_OUTLINE)
        if items is None:
            ol.pop("open", None)
        else:
            ol["open"] = items
        path = self.newdir() + ".json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ol, f, ensure_ascii=False)
        return path

    def voice_timeline(self):
        """PAIR_SB の時刻表を作る（3 秒おき。印はすべて行の頭から 0.5 秒）"""
        lines, t = [], 1.0
        for sc in self.sb_pair["scenes"]:
            for ln in sc["lines"]:
                marks = {m: 0.5 for m in re.findall(r"\{([A-Za-z0-9_]+)\}", ln.get("read") or ln["text"])}
                lines.append({"id": ln["id"], "scene": sc["id"], "start": t, "dur": 2.5, "marks": marks})
                t += 3.0
        path = self.newdir() + ".json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"source": "voicevox", "speaker": 8, "speed": 1.1, "credit": "VOICEVOX:春日部つむぎ", "lines": lines}, f, ensure_ascii=False)
        return path

    def test_open_listed(self):
        r, html = self.build(PAIR_SB, self.frames_pair, "--outline", self.outline_with_open(["呼び名を <社内> に合わせるか"]))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("まだ決めていないこと", html)   # ページには出さない（進行役が会話で伝える）
        self.assertNotIn("呼び名を", html)

    def test_open_absent(self):
        for items in ([], None):
            r, html = self.build(PAIR_SB, self.frames_pair, "--outline", self.outline_with_open(items))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn("まだ決めていないこと", html)

    def test_note_estimate(self):
        self.assertEqual(load(os.path.join(self.frames_pair, "frames.json")).get("timed"), "estimate")
        r, html = self.build(PAIR_SB, self.frames_pair)
        self.assertNotIn("見積もり", html)   # 時刻の出どころの注記は出さない
        self.assertRegex(html, r"<title>[^<]* スライドコンテ</title>")
        self.assertNotIn("絵コンテ", html)

    def test_note_voice(self):
        d = self.frames(PAIR_SB, "--timeline", self.voice_timeline())
        self.assertEqual(load(os.path.join(d, "frames.json")).get("timed"), "voice")
        r, html = self.build(PAIR_SB, d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("合成した声", html)
        self.assertRegex(html, r"s1 / l1 @0:01")   # 時刻は、渡した時刻表のもの

    def test_note_old_frames(self):
        # timed のない古い frames.json でも止まらず、見積もりとして出す
        d = self.copy_frames(self.frames_pair)
        fr = load(os.path.join(d, "frames.json"))
        fr.pop("timed", None)
        with open(os.path.join(d, "frames.json"), "w", encoding="utf-8") as f:
            json.dump(fr, f, ensure_ascii=False)
        r, html = self.build(PAIR_SB, d)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
