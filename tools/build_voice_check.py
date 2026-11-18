#!/usr/bin/env python3
"""claude.ai で M2（声）を検証するスキル uz-voice-check の zip を作る。make の必要な部分を写して同梱する。

使い方: python3 tools/build_voice_check.py [-o dist/uz-voice-check.zip]
"""
import argparse
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAKE = os.path.join(ROOT, "skills", "make")
PROBE = os.path.join(ROOT, "tools", "probe", "uz-voice-check")
FILES = ["scripts/setup_voice.py", "scripts/tts.py", "scripts/build_player.py", "scripts/check_storyboard.cjs", "scripts/uz_node.cjs",
         "scripts/uz_assets.py", "scripts/assets.cjs", "scripts/outline_check.cjs", "scripts/svg_dom.cjs",
         "assets/voicevox_user_dict.json", "examples/proposal-analysis.json", "player/template.html"]
DIRS = ["player/src", "player/themes", "player/vendor"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(ROOT, "dist", "uz-voice-check.zip"))
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ("SKILL.md", "voice_report.py", "expected.json"):
            z.write(os.path.join(PROBE, f), f"uz-voice-check/{f}")
        for f in FILES:
            z.write(os.path.join(MAKE, f), f"uz-voice-check/make/{f}")
        for d in DIRS:
            for name in sorted(os.listdir(os.path.join(MAKE, d))):
                z.write(os.path.join(MAKE, d, name), f"uz-voice-check/make/{d}/{name}")
    print(f"{a.out}（{os.path.getsize(a.out) / 1e6:.2f}MB）")


if __name__ == "__main__":
    main()
