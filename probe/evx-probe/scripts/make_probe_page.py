#!/usr/bin/env python3
"""再生ページの検証用 HTML を 1 枚作る（音声を data URI で埋め込む）。

使い方: python3 make_probe_page.py [--wav PATH] [--pad-mb N] [--out DIR]
  --wav    埋め込む音声（try_voicevox.py の出力など）。無ければ 440Hz の音を作って埋め込む
  --pad-mb 大きなページでも開けるか試すために、指定 MB の詰め物を足す（既定 0）
  --route  ページに表示する経路の名前（例: "A ファイル" "C Artifact"）。結果のテキストにも入る
  --name   出力ファイル名（既定 evx_probe.html / evx_probe_light.html）
  --mp3    ffmpeg で mp3（48kbps）に圧縮してから埋め込む（長い動画の音声を 16MiB 以内に収められるかの確認用）
  --light  音声を埋め込まない軽い版（ページの中で試験音を作る）。Artifact に書き写す用。出力名は evx_probe_light.html
出力: DIR/evx_probe.html
"""
import base64
import io
import math
import os
import struct
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))


def tone_wav(sec=2.0, rate=24000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(sec * rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate) * min(1, (n - i) / 2000))) for i in range(n)))
    return buf.getvalue()


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    out_dir = arg("--out", ".")
    os.makedirs(out_dir, exist_ok=True)
    wav_path = arg("--wav")
    light = "--light" in sys.argv
    mime = "audio/wav"
    if light:
        wav, label = b"", "ページの中で作った 440Hz の試験音（軽い版）"
    elif wav_path and os.path.exists(wav_path):
        wav = open(wav_path, "rb").read()
        label = f"VOICEVOX の合成音声（{os.path.basename(wav_path)}、WAV {len(wav) / 1e6:.2f}MB）"
        if "--mp3" in sys.argv:
            import subprocess
            mp3 = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", wav_path, "-ac", "1", "-b:a", "48k", "-f", "mp3", "-"],
                                 capture_output=True, check=True).stdout
            label = f"VOICEVOX の合成音声（mp3 48kbps {len(mp3) / 1e6:.2f}MB ← WAV {len(wav) / 1e6:.2f}MB）"
            wav = mp3
            mime = "audio/mpeg"
    else:
        wav = tone_wav()
        label = "440Hz の試験音（VOICEVOX の音声が無いため）"
    pad_mb = float(arg("--pad-mb", "0"))
    pad = "x" * int(pad_mb * 1024 * 1024)

    html = open(os.path.join(HERE, "..", "assets", "probe_template.html"), encoding="utf-8").read()
    html = (html.replace("__AUDIO_B64__", base64.b64encode(wav).decode() if wav else "")
                .replace("data:audio/wav;base64,", f"data:{mime};base64,", 1)
                .replace("__AUDIO_LABEL__", label)
                .replace("__PAD__", pad)
                .replace("__PAD_MB__", str(pad_mb))
                .replace("__ROUTE__", arg("--route", "（未指定）")))
    name = arg("--name", "evx_probe_light.html" if light else "evx_probe.html")
    dest = os.path.join(out_dir, name)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{dest}（{os.path.getsize(dest) / 1e6:.2f}MB、音声: {label}）")


if __name__ == "__main__":
    main()
