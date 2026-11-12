#!/usr/bin/env python3
"""合成した後に台本を変えた（文を変えた・行を消した・行を足した）とき、古い時刻表のままでは進めないことの検査。
VOICEVOX は使わない（時刻表は検査の中で作る）。python3 test_stale_voice.py で回す。"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
CHECK = os.path.join(SCRIPTS, "check_storyboard.cjs")
FRAMES = os.path.join(SCRIPTS, "frames.cjs")
BUILD = os.path.join(SCRIPTS, "build_player.py")
PAIR_SB = os.path.join(HERE, "outlines", "pair", "storyboard.json")
MARK = re.compile(r"\{([A-Za-z0-9_]+)\}")


def timeline_of(sb, with_text=True):
    """tts.py が書くのと同じ形の時刻表（3 秒おき。印はすべて行の頭から 0.5 秒）"""
    lines, t = [], 1.0
    for sc in sb["scenes"]:
        for ln in sc["lines"]:
            raw = ln.get("read") or ln["text"]
            row = {"id": ln["id"], "scene": sc["id"], "start": t, "dur": 2.5, "marks": {m: 0.5 for m in MARK.findall(raw)}}
            if with_text:
                row["text"] = MARK.sub("", raw)
            lines.append(row)
            t += 3.0
    return {"source": "voicevox", "speaker": 8, "speed": 1.1, "credit": "VOICEVOX:春日部つむぎ", "lines": lines}


class StaleVoiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        with open(PAIR_SB, encoding="utf-8") as f:
            self.sb = json.load(f)
        self.tl = self.write("timeline.json", timeline_of(self.sb))

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, obj):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
        return path

    def changed(self, change):
        sb = json.loads(json.dumps(self.sb))
        change(sb)
        return self.write("sb.json", sb)

    @staticmethod
    def drop_last(sb):      # 最後の行 l7 を消す
        sb["scenes"][-1]["lines"].pop()

    @staticmethod
    def reword(sb):         # l3 の文を変える（read のない行）
        ln = sb["scenes"][1]["lines"][0]
        ln["text"] = ln["text"].replace("二つ", "ふたつ")

    @staticmethod
    def add_line(sb):       # 行 l8 を足す
        sb["scenes"][-1]["lines"].append({"id": "l8", "text": "足した行です。"})

    def build(self, sb_path, tl_path):
        out = os.path.join(self.dir, "p.html")
        r = subprocess.run([sys.executable, BUILD, sb_path, "--theme", "koo", "--timeline", tl_path, "-o", out], capture_output=True, text=True)
        return r, os.path.exists(out)

    # ---- 検査とコマ: 例外ではなく、誤りとして知らせる ----
    def test_check_reports_removed_line(self):
        r = subprocess.run(["node", CHECK, self.changed(self.drop_last), "--theme", "koo", "--timeline", self.tl], capture_output=True, text=True)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, out)
        self.assertIn("l7", out)
        self.assertIn("時刻表にあるが台本にない", out)
        self.assertNotIn("TypeError", out)

    def test_check_reports_line_added_at_scene_head(self):
        # 場面の頭に行を足したときも、例外ではなく誤りとして知らせる
        def change(sb):
            sb["scenes"][-1]["lines"].insert(0, {"id": "l8", "text": "足した行です。"})
        r = subprocess.run(["node", CHECK, self.changed(change), "--theme", "koo", "--timeline", self.tl], capture_output=True, text=True)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, out)
        self.assertIn("l8", out)
        self.assertIn("時刻表にない", out)
        self.assertNotIn("TypeError", out)

    def test_frames_reports_removed_line(self):
        d = os.path.join(self.dir, "frames")
        r = subprocess.run(["node", FRAMES, self.changed(self.drop_last), "--theme", "koo", "-o", d, "--timeline", self.tl], capture_output=True, text=True)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, out)
        self.assertIn("時刻表にあるが台本にない", out)
        self.assertNotIn("TypeError", out)

    # ---- 組み立て: 古い声のままでは、ページを書かずに止まる ----
    def test_build_stops_on_removed_line(self):
        r, wrote = self.build(self.changed(self.drop_last), self.tl)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("音声が古い", r.stderr)
        self.assertIn("l7", r.stderr)
        self.assertFalse(wrote)

    def test_build_stops_on_changed_text(self):
        r, wrote = self.build(self.changed(self.reword), self.tl)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("音声が古い", r.stderr)
        self.assertIn("l3", r.stderr)
        self.assertIn("tts.py", r.stderr)
        self.assertFalse(wrote)

    def test_build_stops_on_added_line(self):
        r, wrote = self.build(self.changed(self.add_line), self.tl)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("音声が古い", r.stderr)
        self.assertIn("l8", r.stderr)
        self.assertFalse(wrote)

    def test_build_ok_when_fresh(self):
        r, wrote = self.build(PAIR_SB, self.tl)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(wrote)

    def test_build_ok_when_only_actions_changed(self):
        # 動作だけを変えた（文は同じ）なら、声は古くない
        def change(sb):
            sb["scenes"][0]["lines"][1]["do"] = [{"at": "a", "focus": "i3"}]
        r, wrote = self.build(self.changed(change), self.tl)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(wrote)

    def test_build_ok_with_timeline_without_text(self):
        # text のない時刻表（手で書いたもの）は、行の id だけを比べる
        r, wrote = self.build(self.changed(self.reword), self.write("tl2.json", timeline_of(self.sb, with_text=False)))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(wrote)


if __name__ == "__main__":
    unittest.main()
