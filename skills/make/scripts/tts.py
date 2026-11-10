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
  読みはアクセント句ごとのかなを「/」でつなぎ、間は前後の「/」なしの「、」で出す（例: テジュンワ/ゼロジュンビカラ、キュウダンデ）。
  audio/・timeline.json・narration は作らない。

--audition 8,2,3: 声の試聴。合成はせず（audio/・timeline.json・narration は作らない）、同じ 1 文を話者ごとに読ませて、
  聞き比べるページ WORKDIR/audition.html を書く（名前だけでは声を選べないときに使う）。話者は 6 人まで。
  文は --sample "…"、なければ台本の最初の行。--sample があれば台本は要らない（声は台本を書く前に選ぶことがある）。
    python3 tts.py [storyboard.json] -o WORKDIR --audition 8,2,3 [--sample "聞き比べる文"] [--speed 1.1] [--artifact]
  --artifact は Artifact で公開する形（<html>・<head>・<body> を外した断片）で書く。ページは WebAudio で鳴らし、VOICEVOX のクレジットを出す。

声・速さは、引数 → 台本の voice → 既定（春日部つむぎ 8・1.1）の順に決まる。
合成の前に assets/voicevox_user_dict.json の語をユーザー辞書として使う（読みの誤りはそこに足す）。
"""
import argparse
import base64
import hashlib
import html
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
    続いたスペース（印を外した跡の「Claude  Code」など）は 1 かたまりとして、前後の文字で残すかを決め、残すなら半角 1 つにする。
    返すのは (整えた文, 新しい印の位置)。"""
    alnum = re.compile(r"[A-Za-z0-9]")
    out, dropped = [], []
    i = 0
    while i < len(text):
        if text[i] not in " \u3000":
            out.append(text[i])
            i += 1
            continue
        j = i
        while j < len(text) and text[j] in " \u3000":
            j += 1
        keep = " " in text[i:j] and i > 0 and j < len(text) and alnum.fullmatch(text[i - 1]) and alnum.fullmatch(text[j])
        if keep:
            out.append(" ")
            dropped.extend(range(i + 1, j))
        else:
            dropped.extend(range(i, j))
        i = j
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

    def phrases(self, text, speaker):
        """文をアクセント句ごとのかな文字列の列にする。句の後ろに間があれば「、」を 1 要素として入れる（読みの一覧用。合成はしない）"""
        if not text.strip():
            return []
        self.ensure(speaker)
        q = self.synth.create_audio_query(text, speaker)
        out = []
        for ap in q.accent_phrases:
            out.append("".join(g(m, "text") for m in ap.moras))
            if ap.pause_mora:
                out.append("、")
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
            # text = 合成する文のもと（read があれば read）。caption = 字幕（読みの一覧で、読みと見比べるために出す）
            rows.append({"id": ln["id"], "scene": sc["id"], "first": i == 0, "text": text, "spoken": spoken, "marks": smarks,
                         "caption": parse_marks(ln["text"])[0]})
    return rows


def to_pcm(wav):
    with wave.open(io.BytesIO(wav)) as w:
        return w.getparams(), w.readframes(w.getnframes())


def md_cell(s):
    r"""表の 1 マスに入れる文。| は \| にし、改行は空白にする"""
    return s.replace("|", "\\|").replace("\n", " ")


def readings_md(rows, got, speaker, speed):
    """読みの一覧（表）。字幕の列には read ではなく字幕を出す。got は行の id → { spoken, kana }"""
    md = [f"# 読みの一覧（話者 {speaker}、話速 {speed}）", "", "| 行 | 字幕 | 読む文 | VOICEVOX の読み |", "|---|---|---|---|"]
    for r in rows:
        i = got[r["id"]]
        md.append(f"| {r['id']} | {md_cell(r['caption'])} | {md_cell(i['spoken'])} | {md_cell('/'.join(i['kana']).replace('/、/', '、').replace('/、', '、'))} |")
    return "\n".join(md) + "\n"


def write_readings(voice, rows, out, speaker, speed, ver, t0, budget):
    """各行の読み（かな）を readings/<id>.<鍵>.json に残し、全行そろったら readings.md を書く。budget 超過は終了コード 3"""
    rdir = os.path.join(out, "readings")
    os.makedirs(rdir, exist_ok=True)
    got, made = {}, 0
    for r in rows:
        key = hashlib.sha1(json.dumps(["phrases", r["spoken"], speaker, voice.dict_key, ver], ensure_ascii=False).encode()).hexdigest()[:12]
        path = os.path.join(rdir, f"{r['id']}.{key}.json")
        if os.path.exists(path):
            got[r["id"]] = json.load(open(path, encoding="utf-8"))
            continue
        if time.time() - t0 > budget:
            continue
        info = {"id": r["id"], "text": r["text"], "spoken": r["spoken"], "kana": voice.phrases(r["spoken"], speaker)}
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
    path = os.path.join(out, "readings.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(readings_md(rows, got, speaker, speed))
    print("読みの一覧:", path)


def parse_speakers(s):
    """--audition の値（カンマ区切りの話者の番号）を整数の列にする。空・整数でない・重複・7 人以上は ValueError"""
    parts = [p.strip() for p in s.split(",")]
    if not s.strip() or any(not re.fullmatch(r"\d+", p) for p in parts):
        raise ValueError("話者はカンマ区切りの番号で書く（例 8,2,3）")
    ids = [int(p) for p in parts]
    if len(set(ids)) != len(ids):
        raise ValueError("同じ話者が 2 回ある")
    if len(ids) > 6:
        raise ValueError("話者は 6 人まで")
    return ids


def spoken_of(raw):
    """字幕か read の文を、合成する文にする（印を外し、スペースを整える）"""
    text, marks = parse_marks(raw)
    return normalize(text, marks)[0]


def sample_of(sb):
    """台本の最初の行の、合成する文。行がなければ空の文字列"""
    for sc in sb.get("scenes") or []:
        for ln in sc.get("lines") or []:
            return spoken_of(ln.get("read") or ln.get("text") or "")
    return ""


AUDITION_STYLE = """
  :root { --page: #f4f5f7; --ink: #1d2433; --muted: #5d6676; --line: #d3d8e0; --accent: #1a5fd0; --err: #b3261e; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #121418; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; --err: #ff8a80; color-scheme: dark; } }
  :root[data-theme="dark"] { --page: #121418; --ink: #e9eaec; --muted: #9aa1ab; --line: #2c3139; --accent: #7fb0ff; --err: #ff8a80; color-scheme: dark; }
  body { background: var(--page); color: var(--ink); font: 15px/1.7 "Noto Sans JP", system-ui, sans-serif;
         padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .ua-wrap { max-width: 640px; margin: 0 auto; }
  .ua-wrap h1 { font-size: 20px; margin: 0 0 12px; }
  .ua-sample { font-size: 17px; margin: 0 0 6px; padding: 10px 14px; border-left: 3px solid var(--accent); overflow-wrap: anywhere; }
  .ua-note, .ua-credit { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
  .ua-list { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 8px; }
  .ua-list button { font: inherit; font-weight: 700; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 10px;
                    width: 100%; padding: 10px 14px; text-align: left; cursor: pointer; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .ua-list button:hover, .ua-list button:focus-visible, .ua-list button[aria-pressed="true"] { border-color: var(--accent); outline: none; }
  .ua-list button[aria-pressed="true"] { color: var(--accent); }
  .ua-list span { font-weight: 400; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ua-err { color: var(--err); }
"""

# 押したときに WebAudio で復号して鳴らす（チャットのプレビューでは audio 要素が使えないため）。別のボタンを押したら前の音を止める
AUDITION_JS = """
(function () {
  "use strict";
  const DATA = /*UA:DATA*/[];
  let ctx = null, cur = null, curBtn = null;
  const bufs = {};
  const stop = () => {
    if (cur) { cur.onended = null; try { cur.stop(); } catch (e) {} }
    if (curBtn) curBtn.setAttribute("aria-pressed", "false");
    cur = curBtn = null;
  };
  async function play(i, btn) {
    const err = document.getElementById("ua-err");
    try {
      err.hidden = true;
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") await ctx.resume();
      const same = curBtn === btn;
      stop();
      if (same) return;
      if (!bufs[i]) {
        const bin = atob(DATA[i]), u = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        bufs[i] = await ctx.decodeAudioData(u.buffer);
      }
      const src = ctx.createBufferSource();
      src.buffer = bufs[i]; src.connect(ctx.destination);
      src.onended = () => { if (cur === src) stop(); };
      src.start();
      cur = src; curBtn = btn; btn.setAttribute("aria-pressed", "true");
    } catch (e) { err.textContent = "音声を再生できませんでした: " + e.message; err.hidden = false; }
  }
  document.querySelectorAll(".ua-list button").forEach((b, i) => { b.onclick = () => play(i, b); });
})();
"""


def audition_html(sample, voices, speed, artifact=False):
    """声の試聴のページ。voices は [{"id", "name", "style", "wav"（バイト列）}]。外のファイルを読まない 1 枚の HTML を返す"""
    esc = html.escape
    items, credits = [], []
    for v in voices:
        label = f"{v['name']}（{v['style']}）" if v.get("style") else v["name"]
        items.append(f'<li><button type="button" aria-pressed="false">▶ {esc(label)}<span>話者 {int(v["id"])}</span></button></li>')
        if v["name"] not in credits:
            credits.append(v["name"])
    data = json.dumps([base64.b64encode(v["wav"]).decode() for v in voices])
    head = f"<title>声の試聴</title>\n<style>{AUDITION_STYLE}</style>"
    body = "\n".join([
        '<div class="ua-wrap">',
        "<h1>声の試聴</h1>",
        f'<p class="ua-sample">{esc(sample)}</p>',
        f'<p class="ua-note">同じ文を、話速 {speed:g} で読んでいます。名前を押すと鳴ります。気に入った声の番号を Claude に伝えてください。</p>',
        '<ul class="ua-list">', *items, "</ul>",
        f'<p class="ua-credit">{esc("、".join("VOICEVOX:" + n for n in credits))}</p>',
        '<p class="ua-err" id="ua-err" hidden></p>',
        "</div>",
        "<script>" + AUDITION_JS.replace("/*UA:DATA*/[]", data) + "</script>",
    ])
    if artifact:
        return head + "\n" + body + "\n"
    return ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f"{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n")


def write_audition(voice, speakers, sample, speed, out, home, artifact):
    """話者ごとに sample を合成して、WORKDIR/audition.html を書く"""
    known = {v["id"]: v for v in setup_voice.list_voices(home)}
    voices = []
    for sp in speakers:
        wav, _, _ = voice.line(sample, sp, speed)   # 入っていない話者は、ここで止まる（何も書かない）
        meta = known.get(sp) or {"name": SPEAKER_NAMES.get(sp, f"話者 {sp}"), "style": ""}
        voices.append({"id": sp, "name": meta["name"], "style": meta["style"], "wav": wav})
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "audition.html")
    page = audition_html(sample, voices, speed, artifact)
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"声の試聴: {path}（{len(page.encode()) / 1e6:.1f}MB、{len(voices)} 人）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard", nargs="?", help="台本。--audition に --sample を付けるときは省ける")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--speaker", type=int)
    ap.add_argument("--speed", type=float)
    ap.add_argument("--budget", type=float, default=100)
    ap.add_argument("--home", default=setup_voice.default_home())
    ap.add_argument("--dict", help="スキルの辞書に重ねる辞書（既定は WORKDIR の親の voice_dict.json）")
    ap.add_argument("--readings", action="store_true", help="合成せず、読みの一覧 readings.md だけを書く")
    ap.add_argument("--no-mix", action="store_true", help="時刻表だけ書き、まとめた音声は作らない")
    ap.add_argument("--audition", help="声の試聴。話者の番号をカンマ区切りで渡す（例 8,2,3）。audition.html だけを書く")
    ap.add_argument("--sample", help="--audition で読ませる文（省くと台本の最初の行）")
    ap.add_argument("--artifact", action="store_true", help="--audition のページを、Artifact で公開する形で書く")
    a = ap.parse_args()
    # 使い方の誤りは、VOICEVOX を読み込む前に終了コード 2 で止める（何も書かない）
    if a.audition is None and (a.sample is not None or a.artifact):
        ap.error("--sample と --artifact は --audition と一緒に使う")
    if a.audition is None and not a.storyboard:
        ap.error("台本（storyboard.json）が要る")
    sb = json.load(open(a.storyboard, encoding="utf-8")) if a.storyboard else {}
    speakers = sample = None
    if a.audition is not None:
        try:
            speakers = parse_speakers(a.audition)
        except ValueError as e:
            ap.error(f"--audition: {e}")
        sample = spoken_of(a.sample) if a.sample is not None else sample_of(sb)
        if not sample.strip():
            ap.error("--audition には、--sample の文か、行のある台本が要る")
    vo = sb.get("voice") or {}
    speaker = a.speaker if a.speaker is not None else int(vo.get("speaker", DEFAULT_SPEAKER))
    speed = a.speed if a.speed is not None else float(vo.get("speed", DEFAULT_SPEED))
    adir = os.path.join(a.out, "audio")
    if not a.readings and speakers is None:
        os.makedirs(adir, exist_ok=True)
    t0 = time.time()
    if a.dict and not os.path.exists(a.dict):
        sys.exit(f"--dict で指定した辞書がない: {a.dict}")
    extra = a.dict or os.path.join(os.path.dirname(os.path.abspath(a.out)), "voice_dict.json")
    voice = Voice(a.home, extra if os.path.exists(extra) else None)
    import voicevox_core
    ver = getattr(voicevox_core, "__version__", setup_voice.CORE_VER)
    if speakers is not None:
        write_audition(voice, speakers, sample, speed, a.out, a.home, a.artifact)
        return
    rows = collect(sb)
    if a.readings:
        stale = os.path.join(a.out, "readings.md")
        if os.path.exists(stale):   # 途中で止まった回（終了コード 3）に古い一覧を残さない
            os.remove(stale)
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
