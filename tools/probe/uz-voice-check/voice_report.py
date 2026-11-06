#!/usr/bin/env python3
"""tts.py の出力（時刻表と行ごとの wav）を、環境どうしで比べられる形の JSON にまとめる。

使い方: python3 voice_report.py WORKDIR [--expected expected.json] [--out report.json]
  各行の長さ・印の時刻・音声の中身のハッシュ（PCM の sha1）を出す。--expected があれば差を数える。
"""
import argparse
import glob
import hashlib
import io
import json
import os
import platform
import wave


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("--expected")
    ap.add_argument("--out")
    a = ap.parse_args()
    tl = json.load(open(os.path.join(a.work, "timeline.json"), encoding="utf-8"))
    lines = []
    for ln in tl["lines"]:
        wavs = glob.glob(os.path.join(a.work, "audio", ln["id"] + ".*.wav"))
        sha = None
        if wavs:
            with wave.open(io.BytesIO(open(wavs[0], "rb").read())) as w:
                sha = hashlib.sha1(w.readframes(w.getnframes())).hexdigest()[:12]
        lines.append({"id": ln["id"], "start": ln["start"], "dur": ln["dur"], "marks": ln["marks"], "pcm": sha})
    try:
        import voicevox_core
        core = getattr(voicevox_core, "__version__", "?")
    except Exception:
        core = None
    rep = {"env": {"python": platform.python_version(), "machine": platform.machine(), "system": platform.platform(), "voicevox_core": core},
           "speaker": tl.get("speaker"), "speed": tl.get("speed"), "credit": tl.get("credit"), "lines": lines}
    if a.expected and os.path.exists(a.expected):
        exp = {l["id"]: l for l in json.load(open(a.expected, encoding="utf-8"))["lines"]}
        dd, dm, same_pcm, n = 0.0, 0.0, 0, 0
        for l in lines:
            e = exp.get(l["id"])
            if not e:
                continue
            n += 1
            dd = max(dd, abs(l["dur"] - e["dur"]))
            for k, v in l["marks"].items():
                if k in e["marks"]:
                    dm = max(dm, abs(v - e["marks"][k]))
            same_pcm += l["pcm"] == e["pcm"]
        rep["compare"] = {"lines": n, "max_dur_diff_sec": round(dd, 3), "max_mark_diff_sec": round(dm, 3), "same_pcm_lines": same_pcm,
                          "verdict": "同じ" if dd <= 0.02 and dm <= 0.02 else "ずれあり"}
    s = json.dumps(rep, ensure_ascii=False, indent=1)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(s)
    print(s)


if __name__ == "__main__":
    main()
