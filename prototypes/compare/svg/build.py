#!/usr/bin/env python3
"""見比べ用の SVG プレーヤーを画風ごとに 1 枚ずつ書き出す。

使い方: python3 build.py
入力: scene.json（台本）、../shared/timeline.json と ../shared/narration.mp3（音声）、player_template.html
出力: out/svg-3b1b.html、out/svg-board.html
"""
import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(HERE, "..", "shared")


def main():
    tpl = open(os.path.join(HERE, "player_template.html"), encoding="utf-8").read()
    scene = json.load(open(os.path.join(HERE, "scene.json"), encoding="utf-8"))
    timeline = json.load(open(os.path.join(SHARED, "timeline.json"), encoding="utf-8"))
    audio = base64.b64encode(open(os.path.join(SHARED, "narration.mp3"), "rb").read()).decode()
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    for theme, title in [("3b1b", "SVG プレーヤー 3b1b 調"), ("board", "SVG プレーヤー 手描き調")]:
        html = (tpl.replace("__PAGE_TITLE__", title)
                   .replace("__THEME__", theme)
                   .replace("__SCENE__", json.dumps(scene, ensure_ascii=False))
                   .replace("__TIMELINE__", json.dumps(timeline, ensure_ascii=False))
                   .replace("__AUDIO__", audio))
        dest = os.path.join(HERE, "out", f"svg-{theme}.html")
        open(dest, "w", encoding="utf-8").write(html)
        print(f"{dest}（{os.path.getsize(dest) / 1e6:.2f}MB）")


if __name__ == "__main__":
    main()
