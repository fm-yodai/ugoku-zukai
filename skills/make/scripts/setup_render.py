#!/usr/bin/env python3
"""コマを PNG にする道具（@resvg/resvg-js）を入れる。何度実行してもよい（入っていれば何もしない）。

使い方: python3 setup_render.py [--home DIR]
  --home 置き場。省くと UZ_RENDER_HOME → ${CLAUDE_PLUGIN_DATA}/render → ~/.cache/ugoku-zukai/render の順
npm の registry から入れる（native バイナリ込みで数 MB）。最後に置き場のパスを 1 行で出す。
失敗したら終了コード 4 と理由を標準エラーに出す（frames.cjs は PNG なしで SVG だけ書いて続けられる）。
"""
import argparse
import os
import shutil
import subprocess
import sys

PKG = "@resvg/resvg-js@2.6.2"


def default_home():
    if os.environ.get("UZ_RENDER_HOME"):
        return os.environ["UZ_RENDER_HOME"]
    if os.environ.get("CLAUDE_PLUGIN_DATA"):
        return os.path.join(os.environ["CLAUDE_PLUGIN_DATA"], "render")
    return os.path.join(os.path.expanduser("~"), ".cache", "ugoku-zukai", "render")


def importable(home):
    """置き場の resvg を node から読めて、小さな SVG を PNG にできるか"""
    js = ("const {Resvg}=require(require('path').join(process.argv[1],'node_modules','@resvg','resvg-js'));"
          "const p=new Resvg('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"/>').render().asPng();"
          "process.exit(p[1]===0x50?0:1)")
    try:
        r = subprocess.run(["node", "-e", js, home], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0


def fail(msg):
    print("setup_render: " + msg, file=sys.stderr)
    sys.exit(4)


def main():
    ap = argparse.ArgumentParser(description="コマを PNG にする道具（resvg）を入れる")
    ap.add_argument("--home", help="置き場（省くと UZ_RENDER_HOME → ${CLAUDE_PLUGIN_DATA}/render → ~/.cache/ugoku-zukai/render）")
    a = ap.parse_args()
    home = os.path.abspath(a.home or default_home())
    if not shutil.which("node"):
        fail("node が見つからない")
    if importable(home):
        print(home)
        return
    if not shutil.which("npm"):
        fail("npm が見つからない")
    try:
        os.makedirs(home, exist_ok=True)
    except OSError as e:
        fail(f"置き場 {home} を作れない（{e}）")
    try:
        r = subprocess.run(["npm", "install", "--prefix", home, "--no-audit", "--no-fund", "--no-save", PKG],
                           capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        fail(f"npm install {PKG} が 300 秒で終わらない")
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()[-3:]
        fail(f"npm install {PKG} に失敗: " + " / ".join(tail))
    if not importable(home):
        fail(f"{PKG} は入ったが読み込めない（この環境向けの native バイナリがない可能性）")
    print(home)


if __name__ == "__main__":
    main()
