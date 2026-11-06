#!/usr/bin/env python3
"""作業フォルダを作る。題材の外（ユーザーの作業ツリーの外）に置く。

使い方: python3 workdir.py new <題材の短い名前> [--home DIR]
  --home 置き場。省くと UZ_RUNS_HOME → ${CLAUDE_PLUGIN_DATA}/runs → ~/.cache/ugoku-zukai/runs の順
作るフォルダは <置き場>/<YYYYMMDD-HHMM>-<短い名前>。英数字と - 以外は - にし、続く - は 1 つにまとめ、
頭と終わりの - は落とす。日本語だけで空になるときは run。同じ名前があれば -2 -3…を付ける。
作ったら sources/ と review/ を作り、フォルダのパスを 1 行で出す。

作業フォルダの中身（SKILL.md と各エージェントはこの名前で読み書きする）:
  interview.md     インタビューの結果（題材・読者・長さ・構成の型）
  brief.md         取材メモ（researcher）
  sources/         取材で集めた一次資料の写し・要約
  contract.json    契約（言い切ること・経路・図の型・尺の配分）
  storyboard.json  台本
  theme.json       デザインから作ったテーマ（デザインを渡されたときだけ）
  review/          評価役の指摘（台帳 ledger と各役の判定）
  frames/          各行の落ち着いたコマ（SVG・PNG のシートと frames.json）
  voice/           tts.py の出力（timeline.json・narration.mp3）
  player.html      組み立てた再生ページ
"""
import argparse
import datetime
import os
import re
import sys


def default_home():
    if os.environ.get("UZ_RUNS_HOME"):
        return os.environ["UZ_RUNS_HOME"]
    if os.environ.get("CLAUDE_PLUGIN_DATA"):
        return os.path.join(os.environ["CLAUDE_PLUGIN_DATA"], "runs")
    return os.path.join(os.path.expanduser("~"), ".cache", "ugoku-zukai", "runs")


def slug(name):
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")[:40].rstrip("-")
    return s or "run"


def make(home, name, now=None):
    now = now or datetime.datetime.now()
    stamp = now if isinstance(now, str) else f"{now:%Y%m%d-%H%M}"
    base = f"{stamp}-{slug(name)}"
    os.makedirs(home, exist_ok=True)
    n = 1
    while True:
        path = os.path.join(home, base if n == 1 else f"{base}-{n}")
        try:
            os.mkdir(path)  # 既にあれば失敗する（競合しても上書きしない）
            break
        except FileExistsError:
            n += 1
    for sub in ("sources", "review"):
        os.mkdir(os.path.join(path, sub))
    return os.path.abspath(path)


def main():
    ap = argparse.ArgumentParser(description="作業フォルダを作る")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("new", help="作業フォルダを作ってパスを出す")
    p.add_argument("name", help="題材の短い名前")
    p.add_argument("--home", help="置き場（省くと UZ_RUNS_HOME → ${CLAUDE_PLUGIN_DATA}/runs → ~/.cache/ugoku-zukai/runs）")
    p.add_argument("--now", help=argparse.SUPPRESS)  # 試験用: 時刻の部分 YYYYMMDD-HHMM を固定する
    a = ap.parse_args()
    try:
        print(make(a.home or default_home(), a.name, a.now))
    except OSError as e:
        print(f"workdir: 作業フォルダを作れない（{e}）", file=sys.stderr)
        sys.exit(4)


if __name__ == "__main__":
    main()
