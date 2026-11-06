#!/usr/bin/env python3
"""claude.ai（Customize > Skills）にアップロードする zip を作る。

使い方: python3 tools/build_claude_ai_zip.py [出力先ディレクトリ（既定 dist/）]
- skills/make をそのまま入れ、SKILL.md の frontmatter は name と description だけに絞る
  （claude.ai では Claude Code 専用の項目が警告やエラーになるため）
- サブエージェント（agents/）は claude.ai のチャットでは使われないので入れない
"""
import io
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, "skills", "make")
KEEP = ("name", "description")


def strip_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        raise SystemExit("SKILL.md に frontmatter がない")
    lines, keep = m.group(1).split("\n"), []
    current = None
    for line in lines:
        key = re.match(r"^([A-Za-z_-]+):", line)
        if key:
            current = key.group(1)
        if current in KEEP:
            keep.append(line)
    return "---\n" + "\n".join(keep) + "\n---\n" + text[m.end():]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, "ugoku-zukai-make.zip")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(SKILL):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "tests", "node_modules")]
            for f in files:
                path = os.path.join(base, f)
                arc = os.path.join("make", os.path.relpath(path, SKILL))
                if arc == os.path.join("make", "SKILL.md"):
                    z.writestr(arc, strip_frontmatter(open(path, encoding="utf-8").read()))
                else:
                    z.write(path, arc)
    print(f"{dest}（{os.path.getsize(dest) / 1e3:.0f}KB）")


if __name__ == "__main__":
    main()
