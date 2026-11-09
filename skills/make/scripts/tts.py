#!/usr/bin/env python3
"""台本のナレーションを VOICEVOX で 1 行ずつ合成し、時刻表（timeline.json）とまとめた音声（narration.mp3）を書く。

使い方: python3 tts.py storyboard.json -o WORKDIR [--speaker 8] [--speed 1.1] [--budget 100] [--home DIR] [--readings]
  WORKDIR/audio/   行ごとの wav と、モーラの時刻（*.json）。文・読み・声・速さ・辞書が同じ行は作り直さない
  WORKDIR/timeline.json  { source, speaker, speed, credit, lines: [{ id, scene, start, dur, marks: { 印: 秒 }, text }] }
  WORKDIR/narration.mp3  全行を時刻表どおりに並べた 1 本（ffmpeg がなければ narration.wav）

--budget 秒を超えたら、残りの行を残して終わる（終了コード 3。もう一度同じコマンドを実行すると続きから）。
claude.ai では 1 回のコマンドが長いと止められるので、終了コード 3 の間は繰り返す。

印の時刻: 字幕（または read）の {印} の位置までの文を別に解析し、全文のモーラ列と頭から照らし合わせて、
印の直後のモーラが鳴り始める時刻（行の頭からの秒）を出す。player は印の時刻に動作を始める。

合成の前に、半角スペースと全角スペース（U+3000）を消す（スペースがあると 0.3〜0.7 秒の間が空くため）。
ただし半角スペースの左右が両方とも英数字（[A-Za-z0-9]）なら残す。印の位置は消した分だけ前へずらす。
間を入れたいときは、台本の read に読点（、）を書く。時刻表の text は整える前の文のまま（player の「音声が古い」検査と合わせる）。

--dict PATH: スキルの辞書（assets/voicevox_user_dict.json）に重ねる辞書。形は同じ { words: [...] }。
既定は WORKDIR の親の voice_dict.json（あれば）。同じ surface は --dict の方を採る。

--readings: 合成はせず、各行の VOICEVOX の読み（かな）を WORKDIR/readings.md に表で書く（誤読を音にする前に見つけるため）。
  行ごとの結果は WORKDIR/readings/<id>.<鍵>.json に残す。--budget を超えたら終了コード 3（同じコマンドで続きから）。
  audio/・timeline.json・narration は作らない。

声・速さは、引数 → 台本の voice → 既定（春日部つむぎ 8・1.1）の順に決まる。
合成の前に assets/voicevox_user_dict.json の語をユーザー辞書として使う（読みの誤りはそこに足す）。
"""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import setup_voice  # noqa: E402

USER_DICT = os.path.join(HERE, "..", "assets", "voicevox_user_dict.json")
MARK_RE = re.compile(r"\{([A-Za-z0-9_]+)\}")
DEFAULT_SPEAKER, DEFAULT_SPEED = 8, 1.1
# 行と行の間（engine.js の estimateTimeline と同じ値。時刻表の作り方をそろえる）
LEAD, GAP, SCENE_GAP = 0.8, 0.45, 0.7
SPEAKER_NAMES = {0: "四国めたん", 2: "四国めたん", 4: "四国めたん", 6: "四国めたん", 1: "ずんだもん", 3: "ずんだもん", 5: "ずんだもん", 7: "ずんだもん", 8: "春日部つむぎ", 10: "雨晴はう"}


def parse_marks(text):
    """{印} を取り除いた文と、印の位置（文字の位置）を返す"""
    marks, out, last = {}, [], 0
    for m in MARK_RE.finditer(text):
        out.append(text[last:m.start()])
        marks[m.group(1)] = len("".join(out))
        last = m.end()
    out.append(text[last:])
    return "".join(out), marks


def normalize(text, marks):
    """合成用に文を整える。全角スペースと、英数字に挟まれない半角スペースを消し、印の位置を消した分だけ前へずらす。
    返すのは (整えた文, 新しい印の位置)。"""
    alnum = re.compile(r"[A-Za-z0-9]")
    out, dropped = [], []
    for i, c in enumerate(text):
        drop = c == "\u3000" or (c == " " and not (i > 0 and i + 1 < len(text) and alnum.fullmatch(text[i - 1]) and alnum.fullmatch(text[i + 1])))
        if drop:
            dropped.append(i)
        else:
            out.append(c)
    new = {k: pos - sum(1 for d in dropped if d < pos) for k, pos in marks.items()}
    return "".join(out), new


def dict_key_of(paths):
    """存在する辞書ファイルの中身をつないだ sha1 の頭 8 桁。1 つも無ければ "none"。"""
    raw = b""
    found = False
    for p in paths:
        if p and os.path.exists(p):
            raw += open(p, "rb").read()
            found = True
    return hashlib.sha1(raw).hexdigest()[:8] if found else "none"


def g(o, k):
    v = o.get(k) if isinstance(o, dict) else getattr(o, k, None)
    return v or 0


class Voice:
    def __init__(self, home, extra_dict=None):
        try:
            from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile, UserDict
        except ImportError:
            sys.exit("voicevox_core が入っていない。先に python3 setup_voice.py --agree を実行する（利用規約への同意が要る）")
        import voicevox_core as vc
        self.vc = vc
        if not os.path.isdir(os.path.join(home, setup_voice.DICT_DIR)):
            sys.exit(f"VOICEVOX の置き場 {home} に辞書がない。先に python3 setup_voice.py --agree を実行する")
        ort = Onnxruntime.load_once(filename=setup_voice.ort_lib(home))
        self.oj = OpenJtalk(os.path.join(home, setup_voice.DICT_DIR))
        self.dict_key = self._user_dict(UserDict, extra_dict)
        self.synth = Synthesizer(ort, self.oj)
        self.home, self.loaded = home, set()
        self.VoiceModelFile = VoiceModelFile

    def _user_dict(self, UserDict, extra_dict=None):
        paths = [p for p in (USER_DICT, extra_dict) if p and os.path.exists(p)]
        if not paths:
            return "none"
        words = {}
        for p in paths:   # 同じ surface は後の辞書を採る
            for w in json.load(open(p, encoding="utf-8")).get("words", []):
                words[w["surface"]] = w
        ud = UserDict()
        for w in words.values():
            ud.add_word(self.vc.UserDictWord(surface=w["surface"], pronunciation=w["pronunciation"], accent_type=int(w.get("accent_type", 0)),
                                             word_type=w.get("word_type", "COMMON_NOUN"), priority=int(w.get("priority", 5))))
        self.oj.use_user_dict(ud)
        return dict_key_of(paths)

    def ensure(self, speaker):
        if speaker in self.loaded:
            return
        for f in sorted(os.listdir(self.home)):
            if not f.endswith(".vvm"):
                continue
            with self.VoiceModelFile.open(os.path.join(self.home, f)) as m:
                ids = {st.id for s in m.metas for st in s.styles}
                if speaker in ids:
                    if not self.synth.is_loaded_voice_model(m.id):
                        self.synth.load_voice_model(m)
                    self.loaded |= ids
                    return
        sys.exit(f"話者 {speaker} の音声モデルが入っていない（setup_voice.py の一覧にある id を使う。別の vvm なら --models で入れる）")

    def line(self, text, speaker, speed):
        """1 行を合成し、(wav のバイト列, 長さ秒, モーラの列 [(かな, 始まり秒)]) を返す"""
        self.ensure(speaker)
        q = self.synth.create_audio_query(text, speaker)
        q.speed_scale = speed
        wav = self.synth.synthesis(q, speaker)
        with wave.open(io.BytesIO(wav)) as w:
            dur = w.getnframes() / w.getframerate()
        return wav, dur, self.mora_times(q, speed)

    def mora_times(self, q, speed):
        # 音素の長さは、話速で割ってからフレーム（1/93.75 秒）に丸めて並べる（VOICEVOX の合成と同じ数え方）
        fr = self.vc.FRAME_RATE
        frames = lambda sec: round(sec / speed * fr)
        t = frames(q.pre_phoneme_length)
        out = []
        for ap in q.accent_phrases:
            for mo in ap.moras:
                out.append((g(mo, "text"), t / fr))
                t += frames(g(mo, "consonant_length")) + frames(g(mo, "vowel_length"))
            if ap.pause_mora:
                out.append(("、", t / fr))
                t += frames(g(ap.pause_mora, "vowel_length"))
        out.append(("", t / fr))
        return out

    def kana(self, text, speaker):
        """文のモーラのかなの列（印の位置を探すため。合成はしない）"""
        if not text.strip():
            return []
        q = self.synth.create_audio_query(text, speaker)
        out = []
        for ap in q.accent_phrases:
            out += [g(m, "text") for m in ap.moras]
            if ap.pause_mora:
                out.append("、")
        return out


def mark_times(voice, text, marks, moras, speaker):
    """印の位置までの文を解析し、全文のモーラ列と頭から照らし合わせて、印の直後のモーラの始まりの秒を返す"""
    full = [k for k, _ in moras[:-1]]
    res = {}
    for name, pos in marks.items():
        pre = voice.kana(text[:pos], speaker)
        # 前の文が「、」で終わらないのに解析で区切りが付くことがあるので、末尾の区切りは数えない
        while pre and pre[-1] == "、":
            pre.pop()
        n = 0
        while n < len(pre) and n < len(full) and pre[n] == full[n]:
            n += 1
        if n < len(pre):  # 境目で読みが変わった（「最初に」を途中で切ったなど）。数だけ合わせる
            n = min(len(pre), len(full))
        while n < len(full) and full[n] == "、":   # 区切りの無音の後、次の語の頭へ
            n += 1
        res[name] = round(moras[n][1], 3)
    return res


def collect(sb):
    rows = []
    for sc in sb["scenes"]:
        for i, ln in enumerate(sc["lines"]):
            raw = ln.get("read") or ln["text"]
            text, marks = parse_marks(raw)
            spoken, smarks = normalize(text, marks)
            rows.append({"id": ln["id"], "scene": sc["id"], "first": i == 0, "text": text, "spoken": spoken, "marks": smarks})
    return rows


def to_pcm(wav):
    with wave.open(io.BytesIO(wav)) as w:
        return w.getparams(), w.readframes(w.getnframes())


def md_cell(s):
    """表の 1 マスに入れる文。| は \| にし、改行は空白にする"""
    return s.replace("|", "\\|").replace("\n", " ")


def write_readings(voice, rows, out, speaker, speed, ver, t0, budget):
    """各行の読み（かな）を readings/<id>.<鍵>.json に残し、全行そろったら readings.md を書く。budget 超過は終了コード 3"""
    rdir = os.path.join(out, "readings")
    os.makedirs(rdir, exist_ok=True)
    voice.ensure(speaker)   # kana() は声のモデルが読み込まれていないと失敗する
    got, made = {}, 0
    for r in rows:
        key = hashlib.sha1(json.dumps([r["spoken"], speaker, voice.dict_key, ver], ensure_ascii=False).encode()).hexdigest()[:12]
        path = os.path.join(rdir, f"{r['id']}.{key}.json")
        if os.path.exists(path):
            got[r["id"]] = json.load(open(path, encoding="utf-8"))
            continue
        if time.time() - t0 > budget:
            continue
        info = {"id": r["id"], "text": r["text"], "spoken": r["spoken"], "kana": voice.kana(r["spoken"], speaker)}
        for old in os.listdir(rdir):   # 同じ行の古い版を消す
            if old.startswith(r["id"] + ".") and old != os.path.basename(path):
                os.remove(os.path.join(rdir, old))
        with open(path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False)
        got[r["id"]] = info
        made += 1
    left = [r["id"] for r in rows if r["id"] not in got]
    if left:
        print(f"{made} 行の読みを出した。残り {len(left)} 行（{', '.join(left[:6])}{' …' if len(left) > 6 else ''}）。同じコマンドをもう一度実行する")
        sys.exit(3)
    md = [f"# 読みの一覧（話者 {speaker}、話速 {speed}）", "", "| 行 | 字幕 | 読む文 | VOICEVOX の読み |", "|---|---|---|---|"]
    for r in rows:
        i = got[r["id"]]
        md.append(f"| {r['id']} | {md_cell(i['text'])} | {md_cell(i['spoken'])} | {md_cell('/'.join(i['kana']))} |")
    path = os.path.join(out, "readings.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print("読みの一覧:", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--speaker", type=int)
    ap.add_argument("--speed", type=float)
    ap.add_argument("--budget", type=float, default=100)
    ap.add_argument("--home", default=setup_voice.default_home())
    ap.add_argument("--dict", help="スキルの辞書に重ねる辞書（既定は WORKDIR の親の voice_dict.json）")
    ap.add_argument("--readings", action="store_true", help="合成せず、読みの一覧 readings.md だけを書く")
    ap.add_argument("--no-mix", action="store_true", help="時刻表だけ書き、まとめた音声は作らない")
    a = ap.parse_args()
    sb = json.load(open(a.storyboard, encoding="utf-8"))
    vo = sb.get("voice") or {}
    speaker = a.speaker if a.speaker is not None else int(vo.get("speaker", DEFAULT_SPEAKER))
    speed = a.speed if a.speed is not None else float(vo.get("speed", DEFAULT_SPEED))
    adir = os.path.join(a.out, "audio")
    if not a.readings:
        os.makedirs(adir, exist_ok=True)
    t0 = time.time()
    extra = a.dict or os.path.join(os.path.dirname(os.path.abspath(a.out)), "voice_dict.json")
    voice = Voice(a.home, extra if os.path.exists(extra) else None)
    import voicevox_core
    ver = getattr(voicevox_core, "__version__", setup_voice.CORE_VER)
    rows = collect(sb)
    if a.readings:
        write_readings(voice, rows, a.out, speaker, speed, ver, t0, a.budget)
        return
    done, made = {}, 0
    for r in rows:
        key = hashlib.sha1(json.dumps([r["spoken"], sorted(r["marks"].items()), speaker, speed, voice.dict_key, ver], ensure_ascii=False).encode()).hexdigest()[:12]
        base = os.path.join(adir, f"{r['id']}.{key}")
        if os.path.exists(base + ".json") and os.path.exists(base + ".wav"):
            done[r["id"]] = (base, json.load(open(base + ".json", encoding="utf-8")))
            continue
        if time.time() - t0 > a.budget:
            continue
        wav, dur, moras = voice.line(r["spoken"], speaker, speed)
        info = {"id": r["id"], "text": r["text"], "dur": round(dur, 3), "marks": mark_times(voice, r["spoken"], r["marks"], moras, speaker), "moras": [[k, round(t, 3)] for k, t in moras]}
        for old in os.listdir(adir):   # 同じ行の古い版を消す
            if old.startswith(r["id"] + ".") and not old.startswith(os.path.basename(base)):
                os.remove(os.path.join(adir, old))
        with open(base + ".wav", "wb") as f:
            f.write(wav)
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False)
        done[r["id"]] = (base, info)
        made += 1
    left = [r["id"] for r in rows if r["id"] not in done]
    if left:
        print(f"{made} 行を合成した。残り {len(left)} 行（{', '.join(left[:6])}{' …' if len(left) > 6 else ''}）。同じコマンドをもう一度実行する")
        sys.exit(3)
    # 時刻表と、全体の音声
    lines, t, prev_scene = [], LEAD, None
    for r in rows:
        if prev_scene is not None and r["scene"] != prev_scene:
            t += SCENE_GAP
        info = done[r["id"]][1]
        lines.append({"id": r["id"], "scene": r["scene"], "start": round(t, 3), "dur": info["dur"], "marks": info["marks"], "text": r["text"]})
        t += info["dur"] + GAP
        prev_scene = r["scene"]
    name = SPEAKER_NAMES.get(speaker) or next((v["name"] for v in setup_voice.list_voices(a.home) if v["id"] == speaker), f"話者 {speaker}")
    tl = {"source": "voicevox", "speaker": speaker, "speed": speed, "credit": f"VOICEVOX:{name}", "lines": lines}
    with open(os.path.join(a.out, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)
    total = t - GAP + 1.0
    out_path = None
    if not a.no_mix:
        params, rate = None, 24000
        pcm = bytearray()
        for ln in lines:
            p, fr = to_pcm(open(done[ln["id"]][0] + ".wav", "rb").read())
            params = p
            rate, width = p.framerate, p.sampwidth * p.nchannels
            pos = int(round(ln["start"] * rate)) * width
            if len(pcm) < pos:
                pcm += b"\0" * (pos - len(pcm))
            pcm[pos:pos + len(fr)] = fr
        pcm += b"\0" * int(rate * 1.0) * params.sampwidth * params.nchannels
        wav_path = os.path.join(a.out, "narration.wav")
        with wave.open(wav_path, "wb") as w:
            w.setparams(params)
            w.writeframes(bytes(pcm))
        out_path = wav_path
        if shutil.which("ffmpeg"):
            mp3 = os.path.join(a.out, "narration.mp3")
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", mp3], capture_output=True, text=True)
            if r.returncode == 0:
                os.remove(wav_path)
                out_path = mp3
            else:
                print("mp3 にできなかったので wav のまま:", r.stderr.strip()[:200])
    print(f"{len(lines)} 行（新しく合成 {made} 行）、{total:.1f} 秒、{tl['credit']}、{time.time() - t0:.1f} 秒かかった")
    print("時刻表:", os.path.join(a.out, "timeline.json"))
    if out_path:
        print("音声:", out_path, f"（{os.path.getsize(out_path) / 1e6:.2f}MB）")


if __name__ == "__main__":
    main()
