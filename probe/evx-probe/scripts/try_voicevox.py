#!/usr/bin/env python3
"""サンドボックスの中で VOICEVOX（voicevox_core）を動かせるか試す。

使い方: python3 try_voicevox.py --agree [--out DIR] [--work DIR]
  --agree は、ユーザーが VOICEVOX 音声モデルと VOICEVOX ONNX Runtime の利用規約に
  同意したときだけ付ける（規約: https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt ）。
  ダウンロードは合計で約 94MB（wheel 1.9MB / ONNX Runtime 8MB / 辞書 24MB / 0.vvm 60MB）。

出力: DIR/voicevox_sample.wav（ずんだもん）と DIR/try_voicevox.json（各段階の成否と所要秒数）
"""
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
ARCH = {"x86_64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine(), platform.machine())
ORT_ARCH = {"x86_64": "x64", "aarch64": "arm64"}.get(ARCH, ARCH)

URLS = {
    "wheel": f"https://github.com/VOICEVOX/voicevox_core/releases/download/{CORE_VER}/voicevox_core-{CORE_VER}-cp310-abi3-manylinux_2_34_{ARCH}.whl",
    "onnxruntime": f"https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-{ORT_VER}/voicevox_onnxruntime-linux-{ORT_ARCH}-{ORT_VER}.tgz",
    "dict": "https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz",
    "vvm": f"https://github.com/VOICEVOX/voicevox_vvm/releases/download/{VVM_VER}/0.vvm",
}

# 非開発者向けの解説を想定した 2 文。長さの割に合成に何秒かかるかを測る
TEXTS = [
    "このページでは、申請が届いてから承認されるまでの流れを、順番に見ていきます。",
    "まず全体の地図を見て、次に一件の申請を追いかけ、最後にもう一度全体に戻ります。",
    "申請が届くと、システムは最初に入力の抜けがないかを確かめます。抜けがあれば、その場で申請者に差し戻します。",
    "抜けがなければ、金額に応じて承認者が決まります。十万円までは課長、それを超えると部長の承認が必要です。",
    "承認者が内容を確認して承認すると、経理に通知が届き、支払いの予定に組み込まれます。",
]
ZUNDAMON_NORMAL = 3

log = {"arch": ARCH, "steps": []}


def step(name, fn):
    t0 = time.time()
    try:
        result = fn()
        log["steps"].append({"step": name, "ok": True, "sec": round(time.time() - t0, 1), "note": result})
        print(f"OK  {name}（{time.time() - t0:.1f} 秒）{result or ''}")
        return True
    except Exception as e:
        log["steps"].append({"step": name, "ok": False, "sec": round(time.time() - t0, 1), "error": f"{type(e).__name__}: {e}"[:400]})
        print(f"NG  {name}: {type(e).__name__}: {e}")
        return False


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "evx-probe/1"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return f"{os.path.getsize(dest) / 1e6:.1f}MB"


def main():
    if "--agree" not in sys.argv:
        print("利用規約への同意（--agree）がないので実行しない。ユーザーに規約を示し、同意を得てから --agree を付けて実行する。")
        sys.exit(2)
    out_dir = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "."
    work = sys.argv[sys.argv.index("--work") + 1] if "--work" in sys.argv else os.path.join(os.path.expanduser("~"), "vv")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(work, exist_ok=True)
    whl = os.path.join(work, os.path.basename(URLS["wheel"]))
    ort_tgz = os.path.join(work, "ort.tgz")
    dict_tgz = os.path.join(work, "dict.tgz")
    vvm = os.path.join(work, "0.vvm")

    ok = step("wheel のダウンロード", lambda: download(URLS["wheel"], whl))
    def pip_install():
        # claude.ai のサンドボックスは PEP 668（外部管理環境）で素の pip install を拒む。順に試し、通った方法を記録する
        tries = [[], ["--break-system-packages"], ["--user", "--break-system-packages"]]
        errors = []
        for extra in tries:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", *extra, whl],
                               capture_output=True, text=True, timeout=300)
            if r.returncode == 0:
                import site, importlib
                importlib.invalidate_caches()
                if "--user" in extra and site.getusersitepackages() not in sys.path:
                    sys.path.append(site.getusersitepackages())
                return f"方法: pip install {' '.join(extra) or '(オプションなし)'}"
            errors.append(f"{extra or '素'}: {(r.stderr or r.stdout).strip().splitlines()[-1][:160]}")
        raise RuntimeError(" / ".join(errors))
    ok = ok and step("pip install", pip_install)
    ok = ok and step("ONNX Runtime のダウンロード", lambda: download(URLS["onnxruntime"], ort_tgz))
    ok = ok and step("辞書のダウンロード", lambda: download(URLS["dict"], dict_tgz))
    ok = ok and step("音声モデル 0.vvm のダウンロード", lambda: download(URLS["vvm"], vvm))

    def extract():
        for t in (ort_tgz, dict_tgz):
            with tarfile.open(t) as tf:
                tf.extractall(work, filter="data")
        return ", ".join(sorted(os.listdir(work)))
    ok = ok and step("展開", extract)

    state = {}

    def load():
        from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
        ort_dir = next(d for d in os.listdir(work) if d.startswith("voicevox_onnxruntime") and os.path.isdir(os.path.join(work, d)))
        lib = os.path.join(work, ort_dir, "lib", Onnxruntime.LIB_RECOMMENDED_VERSIONED_FILENAME)
        ort = Onnxruntime.load_once(filename=lib)
        synth = Synthesizer(ort, OpenJtalk(os.path.join(work, "open_jtalk_dic_utf_8-1.11")))
        with VoiceModelFile.open(vvm) as model:
            synth.load_voice_model(model)
            names = [f"{s.name}:{[st.id for st in s.styles]}" for s in model.metas]
        state["synth"] = synth
        return " / ".join(names)
    ok = ok and step("読み込み（Synthesizer と音声モデル）", load)

    def tts():
        import io
        import wave
        synth = state["synth"]
        frames, params, chars = [], None, 0
        for text in TEXTS:
            wav = synth.tts(text, ZUNDAMON_NORMAL)
            chars += len(text)
            with wave.open(io.BytesIO(wav)) as w:
                params = w.getparams()
                frames.append(w.readframes(w.getnframes()))
        dest = os.path.join(out_dir, "voicevox_sample.wav")
        with wave.open(dest, "wb") as w:
            w.setparams(params)
            for fr in frames:
                w.writeframes(fr)
        with wave.open(dest) as w:
            dur = w.getnframes() / w.getframerate()
        log["sample"] = {"path": dest, "chars": chars, "audio_sec": round(dur, 1), "rate": params.framerate}
        return f"{chars} 文字 → 音声 {dur:.1f} 秒"
    ok = ok and step("音声合成（ずんだもん ノーマル）", tts)

    if ok:
        synth_sec = log["steps"][-1]["sec"]
        audio_sec = log["sample"]["audio_sec"]
        # 5 分（約 1500 文字）のナレーションにかかる時間の目安
        log["estimate_5min_sec"] = round(synth_sec / max(audio_sec, 0.1) * 300)
        print(f"目安: 5 分のナレーションの合成に約 {log['estimate_5min_sec']} 秒（ダウンロードと読み込みは別）")
    log["ok"] = bool(ok)
    with open(os.path.join(out_dir, "try_voicevox.json"), "w") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
