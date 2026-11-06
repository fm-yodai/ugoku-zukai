#!/usr/bin/env python3
"""VOICEVOX（voicevox_core）を入れる。1 回入れれば、同じ置き場を使い回す（何度実行してもよい）。

使い方: python3 setup_voice.py --agree [--home DIR] [--models 0,1] [--json]
  --agree は、ユーザーが VOICEVOX 音声モデルと VOICEVOX ONNX Runtime の利用規約に同意したときだけ付ける。
    規約: https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt
  --home   置き場。省くと UZ_VOICE_HOME → ${CLAUDE_PLUGIN_DATA}/voicevox → ~/.cache/ugoku-zukai/voicevox の順
  --models 入れる音声モデル（vvm の番号）。省くと 0（四国めたん・ずんだもん・春日部つむぎ など）

ダウンロードは約 94MB（wheel 2MB / ONNX Runtime 8MB / 辞書 24MB / 0.vvm 60MB）。すべて GitHub から取る。
最後に「入っている声」の一覧（話者 id・名前・スタイル）を出す。tts.py の --speaker にはこの id を書く。
"""
import argparse
import json
import os
import platform
import subprocess
import sys
import tarfile
import time
import urllib.request

CORE_VER = "0.17.1"
ORT_VER = "1.23.2"
VVM_VER = "0.17.0"
ARCH = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine().lower(), platform.machine())
ORT_ARCH = {"x86_64": "x64", "aarch64": "arm64"}.get(ARCH, ARCH)
URLS = {
    "wheel": f"https://github.com/VOICEVOX/voicevox_core/releases/download/{CORE_VER}/voicevox_core-{CORE_VER}-cp310-abi3-manylinux_2_34_{ARCH}.whl",
    "onnxruntime": f"https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-{ORT_VER}/voicevox_onnxruntime-linux-{ORT_ARCH}-{ORT_VER}.tgz",
    "dict": "https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz",
}
VVM_URL = "https://github.com/VOICEVOX/voicevox_vvm/releases/download/{ver}/{n}.vvm"
DICT_DIR = "open_jtalk_dic_utf_8-1.11"


def default_home():
    if os.environ.get("UZ_VOICE_HOME"):
        return os.environ["UZ_VOICE_HOME"]
    if os.environ.get("CLAUDE_PLUGIN_DATA"):
        return os.path.join(os.environ["CLAUDE_PLUGIN_DATA"], "voicevox")
    return os.path.join(os.path.expanduser("~"), ".cache", "ugoku-zukai", "voicevox")


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return False
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "ugoku-zukai/0.1"})
    with urllib.request.urlopen(req, timeout=180) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(tmp, dest)
    return True


def pip_install(whl):
    try:
        import voicevox_core  # noqa: F401
        return "入っている"
    except ImportError:
        pass
    # claude.ai のサンドボックスは PEP 668 で素の pip install を拒むので、順に試す
    errors = []
    for extra in ([], ["--break-system-packages"], ["--user", "--break-system-packages"]):
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", *extra, whl], capture_output=True, text=True, timeout=300)
        if r.returncode == 0:
            return "pip install " + (" ".join(extra) or "")
        errors.append((r.stderr or r.stdout).strip().splitlines()[-1][:160] if (r.stderr or r.stdout).strip() else "?")
    raise RuntimeError("pip install に失敗: " + " / ".join(errors))


def ort_lib(home):
    from voicevox_core.blocking import Onnxruntime
    d = next(x for x in sorted(os.listdir(home)) if x.startswith("voicevox_onnxruntime") and os.path.isdir(os.path.join(home, x)))
    return os.path.join(home, d, "lib", Onnxruntime.LIB_RECOMMENDED_VERSIONED_FILENAME)


def list_voices(home):
    from voicevox_core.blocking import VoiceModelFile
    voices = []
    for f in sorted(os.listdir(home)):
        if not f.endswith(".vvm"):
            continue
        with VoiceModelFile.open(os.path.join(home, f)) as m:
            for s in m.metas:
                for st in s.styles:
                    voices.append({"id": st.id, "name": s.name, "style": st.name, "vvm": f})
    return sorted(voices, key=lambda v: v["id"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agree", action="store_true")
    ap.add_argument("--home", default=default_home())
    ap.add_argument("--models", default="0")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not a.agree:
        print("利用規約への同意（--agree）がないので入れない。ユーザーに規約（https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt）を示し、同意を得てから --agree を付けて実行する。")
        sys.exit(2)
    home = a.home
    os.makedirs(home, exist_ok=True)
    t0 = time.time()
    steps = []
    whl = os.path.join(home, os.path.basename(URLS["wheel"]))
    got = download(URLS["wheel"], whl)
    steps.append(f"wheel {'取得' if got else '取得済み'}")
    steps.append(pip_install(whl))
    if not any(x.startswith("voicevox_onnxruntime") and os.path.isdir(os.path.join(home, x)) for x in os.listdir(home)):
        tgz = os.path.join(home, "ort.tgz")
        download(URLS["onnxruntime"], tgz)
        with tarfile.open(tgz) as tf:
            tf.extractall(home, filter="data")
        os.remove(tgz)
        steps.append("ONNX Runtime 取得")
    if not os.path.isdir(os.path.join(home, DICT_DIR)):
        tgz = os.path.join(home, "dict.tgz")
        download(URLS["dict"], tgz)
        with tarfile.open(tgz) as tf:
            tf.extractall(home, filter="data")
        os.remove(tgz)
        steps.append("辞書 取得")
    for n in [x.strip() for x in a.models.split(",") if x.strip()]:
        if download(VVM_URL.format(ver=VVM_VER, n=n), os.path.join(home, f"{n}.vvm")):
            steps.append(f"{n}.vvm 取得")
    import importlib
    import site
    importlib.invalidate_caches()
    if site.getusersitepackages() not in sys.path:
        sys.path.append(site.getusersitepackages())
    voices = list_voices(home)
    info = {"home": home, "core": CORE_VER, "sec": round(time.time() - t0, 1), "steps": steps, "voices": voices}
    with open(os.path.join(home, "installed.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    if a.json:
        print(json.dumps(info, ensure_ascii=False))
        return
    print(f"VOICEVOX を {home} に用意した（{info['sec']} 秒: {'、'.join(steps)}）")
    print("入っている声（tts.py の --speaker に id を書く）:")
    for v in voices:
        print(f"  {v['id']:>3}  {v['name']}（{v['style']}）")


if __name__ == "__main__":
    main()
