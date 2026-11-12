#!/usr/bin/env python3
"""画像の部品の読み込み（uz_assets.py と assets.cjs）と、再生ページへの埋め込みの検査"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)
import uz_assets  # noqa: E402


def png(w, h):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def deck(srcs):
    parts = [{"id": f"im{i}", "type": "image", "src": s, "source": "検査用", "area": {"col": [i * 3 + 1, i * 3 + 3], "row": [1, 6]}} for i, s in enumerate(srcs)]
    return {"format": "ugoku-zukai/3", "title": "検査", "slides": {"p1": {"title": "画像", "parts": parts}},
            "scenes": [{"id": "s1", "slide": "p1", "lines": [{"id": "l1", "text": "画像を出します。", "do": [{"show": f"im{i}"} for i in range(len(srcs))]}]}]}


class AssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "assets"))
        for f in ("dot.svg", "px.jpg"):
            shutil.copy(os.path.join(HERE, "assets", f), os.path.join(self.tmp, "assets", f))
        with open(os.path.join(self.tmp, "assets", "p.png"), "wb") as f:
            f.write(png(4, 3))
        with open(os.path.join(self.tmp, "assets", "x.webp"), "wb") as f:
            f.write(b"RIFF....WEBP")
        self.sb_path = os.path.join(self.tmp, "storyboard.json")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, sb):
        with open(self.sb_path, "w", encoding="utf-8") as f:
            json.dump(sb, f, ensure_ascii=False)

    def node_assets(self, sb):
        code = ("const {loadAssets}=require(process.argv[1]);const fs=require('fs');"
                "try{const a=loadAssets(process.argv[2],JSON.parse(fs.readFileSync(process.argv[2],'utf8')));"
                "console.log(JSON.stringify(Object.fromEntries(Object.entries(a).map(([k,v])=>[k,[v.w,v.h,v.mime,v.data.slice(0,5)]]))))}"
                "catch(e){console.log(JSON.stringify({error:e.message,code:e.code}))}")
        self.write(sb)
        r = subprocess.run(["node", "-e", code, os.path.join(SCRIPTS, "assets.cjs"), self.sb_path], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_dims_agree(self):
        sb = deck(["assets/p.png", "assets/px.jpg", "assets/dot.svg"])
        self.write(sb)
        py = uz_assets.load_assets(self.sb_path, sb)
        want = {"assets/p.png": (4, 3, "image/png"), "assets/px.jpg": (3, 2, "image/jpeg"), "assets/dot.svg": (200, 100, "image/svg+xml")}
        js = self.node_assets(sb)
        for src, (w, h, mime) in want.items():
            self.assertEqual((py[src]["w"], py[src]["h"], py[src]["mime"]), (w, h, mime), src)
            self.assertTrue(py[src]["data"].startswith(f"data:{mime};base64,"))
            self.assertEqual(js[src][:3], [w, h, mime], src)
            self.assertEqual(js[src][3], "data:")

    def test_no_images(self):
        sb = {"format": "ugoku-zukai/2", "figures": {"t": {"type": "title", "text": "題"}}, "scenes": []}
        self.assertEqual(uz_assets.load_assets(self.sb_path, sb), {})
        self.assertEqual(self.node_assets(sb), {})

    def test_missing_and_unsupported(self):
        outside = os.path.join(os.path.dirname(self.tmp), "uz-outside.png")
        for src in ("assets/nai.png", "assets/x.webp", "../" + os.path.basename(outside), "/etc/hostname"):
            sb = deck([src])
            with self.assertRaises(uz_assets.AssetError) as cm:
                uz_assets.load_assets(self.sb_path, sb)
            self.assertIn(f"画像「{src}」が読めない", str(cm.exception))
            js = self.node_assets(sb)
            self.assertEqual(js.get("code"), "ASSET", src)
            self.assertIn(f"画像「{src}」が読めない", js["error"])

    def build(self, env=None):
        out = os.path.join(self.tmp, "player.html")
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "build_player.py"), self.sb_path, "--theme", "koo", "-o", out],
                           capture_output=True, text=True, env={**os.environ, **(env or {})})
        return r, out

    def test_build_embeds_and_limits(self):
        self.write(deck(["assets/dot.svg"]))
        r, out = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        html = open(out, encoding="utf-8").read()
        self.assertIn("data:image/svg+xml;base64,", html)
        self.assertIn("UZ_DATA.assets", html)
        os.remove(out)
        r, out = self.build({"UZ_PAGE_LIMIT": "2000"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("15MB を超える", r.stderr)
        self.assertFalse(os.path.exists(out))

    def test_build_missing_image(self):
        self.write(deck(["assets/nai.png"]))
        r, out = self.build()
        self.assertEqual(r.returncode, 1)
        self.assertIn("画像「assets/nai.png」が読めない", r.stderr)

    def test_check_and_frames_report(self):
        self.write(deck(["assets/nai.png"]))
        for cmd in (["node", os.path.join(SCRIPTS, "check_storyboard.cjs"), self.sb_path, "--theme", "koo"],
                    ["node", os.path.join(SCRIPTS, "frames.cjs"), self.sb_path, "--theme", "koo", "-o", os.path.join(self.tmp, "fr")]):
            r = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, cmd[1])
            self.assertIn("画像「assets/nai.png」が読めない", r.stdout + r.stderr)
        self.write(deck(["assets/dot.svg"]))
        r = subprocess.run(["node", os.path.join(SCRIPTS, "check_storyboard.cjs"), self.sb_path, "--theme", "koo"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
