#!/usr/bin/env python3
"""claude.ai のコード実行環境を調べる（標準ライブラリのみ）。

使い方: python3 probe_env.py [--out DIR]
出力: DIR/probe_env.json と、標準出力の要約（Markdown の表）
"""
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

# 届くかどうかを確かめる宛先（用途つき）
TARGETS = [
    ("pypi", "https://pypi.org/simple/pip/"),
    ("npm", "https://registry.npmjs.org/elkjs"),
    ("github", "https://github.com/VOICEVOX/voicevox_core/releases"),
    ("github-api", "https://api.github.com/repos/VOICEVOX/voicevox_core/releases/latest"),
    # GitHub Releases のファイルの実体はここから配られる
    ("github-release-assets", "https://release-assets.githubusercontent.com/"),
    ("github-objects", "https://objects.githubusercontent.com/"),
    ("raw-github", "https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/README.md"),
    ("huggingface", "https://huggingface.co/api/models/hexgrad/Kokoro-82M"),
    ("jsdelivr", "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/package.json"),
    ("google-cloud-tts", "https://texttospeech.googleapis.com/"),
    ("gemini-api", "https://generativelanguage.googleapis.com/"),
    ("elevenlabs", "https://api.elevenlabs.io/"),
    ("anthropic-api", "https://api.anthropic.com/"),
    ("example.com", "https://example.com/"),
]


def reach(url, timeout=8):
    """HTTP の応答が返れば届いたとみなす（401/403/404 も「届いた」）。"""
    t0 = time.time()
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "evx-probe/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"ok": True, "status": r.status, "ms": int((time.time() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        # プロキシが返す 403 は「遮断」の可能性がある。本文の先頭を残して判断材料にする
        body = ""
        try:
            body = e.read(200).decode("utf-8", "replace")
        except Exception:
            pass
        return {"ok": True, "status": e.code, "ms": int((time.time() - t0) * 1000), "body_head": body}
    except Exception as e:  # DNS 失敗・接続拒否・タイムアウト
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200], "ms": int((time.time() - t0) * 1000)}


def cmd_version(cmd, args=("--version",)):
    path = shutil.which(cmd)
    if not path:
        return None
    try:
        out = subprocess.run([path, *args], capture_output=True, text=True, timeout=10)
        return (out.stdout or out.stderr).strip().splitlines()[0][:120]
    except Exception as e:
        return f"(実行失敗: {e})"


def mem_total_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    return int(line.split()[1]) // 1024
    except Exception:
        return None


def py_modules():
    names = ["numpy", "PIL", "matplotlib", "pandas", "scipy", "pydub", "soundfile", "playwright", "cairo", "manim"]
    found = {}
    for n in names:
        try:
            m = __import__(n)
            found[n] = getattr(m, "__version__", "ok")
        except Exception:
            found[n] = None
    return found


def main():
    out_dir = "."
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(out_dir, exist_ok=True)

    du = shutil.disk_usage(out_dir)
    info = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "glibc": " ".join(platform.libc_ver()),
        "cpu_count": os.cpu_count(),
        "mem_total_mb": mem_total_mb(),
        "disk_free_mb": du.free // (1024 * 1024),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER") or os.environ.get("LOGNAME"),
        "proxy_env": {k: v for k, v in os.environ.items() if "proxy" in k.lower()},
        "tools": {c: cmd_version(c, a) for c, a in [
            ("ffmpeg", ("-version",)), ("node", ("--version",)), ("npm", ("--version",)),
            ("uv", ("--version",)), ("pip", ("--version",)), ("apt-get", ("--version",)),
            ("docker", ("--version",)), ("chromium", ("--version",)), ("google-chrome", ("--version",)),
            ("sudo", ("--version",)), ("fc-list", ("--version",)),
        ]},
        "japanese_fonts": None,
        "py_modules": py_modules(),
        "dirs": {d: os.path.isdir(d) for d in ["/mnt/user-data/outputs", "/mnt/user-data/uploads", "/mnt/skills", "/tmp/outputs"]},
    }
    if shutil.which("fc-list"):
        try:
            out = subprocess.run(["fc-list", ":lang=ja", "family"], capture_output=True, text=True, timeout=10)
            info["japanese_fonts"] = sorted(set(out.stdout.split("\n")))[:8]
        except Exception:
            pass
    try:
        socket.gethostbyname("pypi.org")
        info["dns"] = True
    except Exception as e:
        info["dns"] = f"失敗: {e}"

    info["network"] = {name: {"url": url, **reach(url)} for name, url in TARGETS}

    path = os.path.join(out_dir, "probe_env.json")
    with open(path, "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    print(f"# 環境の調査結果（詳細: {path}）\n")
    print(f"- Python {info['python']} / {info['machine']} / {info['glibc']} / CPU {info['cpu_count']} / メモリ {info['mem_total_mb']}MB / 空きディスク {info['disk_free_mb']}MB")
    print("- コマンド: " + ", ".join(f"{k}={'あり' if v else 'なし'}" for k, v in info["tools"].items()))
    print(f"- 日本語フォント: {info['japanese_fonts']}")
    print("- Python ライブラリ: " + ", ".join(f"{k}={v or 'なし'}" for k, v in info["py_modules"].items()))
    print(f"- プロキシの環境変数: {list(info['proxy_env']) or 'なし'}")
    print("\n| 宛先 | 届いたか | 状態 |\n|---|---|---|")
    for name, r in info["network"].items():
        state = r.get("status", r.get("error", ""))
        print(f"| {name} | {'○' if r['ok'] else '×'} | {state} |")


if __name__ == "__main__":
    main()
