"""3b1b 調の技術解説動画を Manim で作るための部品。scene.py と同じディレクトリにコピーして import する。

    from explainer_kit import *

    class Explainer(NarratedScene):
        def construct(self):
            self.chapter("全体像")
            with self.say("c1-1") as t:           # 音声を鳴らし、話し終わるまで待つ
                self.play(FadeIn(a), run_time=t.duration * 0.5)

字幕はここでは描かない。say() が記録した timeline.json から、render.sh が ffmpeg で焼き込む
（Manim 内で描くとカメラのズームと一緒に動いてしまうため）。
"""
import contextlib
import json
import os
import unicodedata

import manimpango
from manim import *  # noqa: F401,F403

import layout_check

# ---------------------------------------------------------------- 見た目の約束
# 色は「意味」に固定する。同じ概念は動画の最後まで同じ色で描く（3b1b の一貫性）。
BG = "#14161A"
INK = "#ECECEC"      # 本文
MUTED = "#8A8F98"    # 補助線・注記・今は主役でないもの
ACTOR = "#58C4DD"    # 人・ブラウザ・クライアント
PROCESS = "#5CD0B3"  # 処理（Lambda・関数・UseCase）
STORE = "#A98BD6"    # 保存先（DB・S3・キュー）
EXTERNAL = "#E8A15A" # 外部サービス（Google・Bedrock・SaaS）
DATA = "#F4D35E"     # 流れていくデータ（リクエスト・注文 1 件）
ADDED = "#83C167"    # PR で増えたもの
REMOVED = "#FC6255"  # PR で消えたもの・失敗・拒否

KIND_COLOR = {"actor": ACTOR, "process": PROCESS, "store": STORE,
              "external": EXTERNAL, "muted": MUTED}

config.background_color = BG
SUBTITLE_BAND = 1 / 6  # 画面下のこの割合には字幕が焼き込まれる。図を置かない

# Pango は日本語名（IPAゴシック）で返す環境があるので、両方の表記を候補に入れる
_FONT_PREFS = ["Noto Sans CJK JP", "Noto Sans JP", "BIZ UDPGothic", "IPAexGothic", "IPAexゴシック",
               "IPAPGothic", "IPA Pゴシック", "IPAGothic", "IPAゴシック"]
_installed = set(manimpango.list_fonts())
FONT = next((f for f in _FONT_PREFS if f in _installed), "sans-serif")
MONO = next((f for f in ["Noto Sans Mono CJK JP", "IPAGothic", "IPAゴシック", "DejaVu Sans Mono"]
             if f in _installed), "monospace")
Text.set_default(font=FONT, color=INK)


# ---------------------------------------------------------------- 部品
def label(text, size=26, color=INK, **kw):
    return Text(text, font_size=size, color=color, **kw)


def note(text, size=20):
    """図の脇に置く小さな注記（グレー）。"""
    return Text(text, font_size=size, color=MUTED)


def node(text, kind="process", width=None, height=0.9, sub=None):
    """角丸の箱 + 名前（+ 小さな補足）。kind で色が決まる。"""
    color = KIND_COLOR.get(kind, kind)
    name = label(text, size=26)
    content = VGroup(name)
    if sub:
        content.add(note(sub, size=18))
        content.arrange(DOWN, buff=0.08)
    w = width or max(2.2, content.width + 0.6)
    box = RoundedRectangle(corner_radius=0.15, width=w, height=max(height, content.height + 0.35),
                           stroke_color=color, stroke_width=3,
                           fill_color=color, fill_opacity=0.12)
    content.move_to(box)
    box.is_box = True       # layout_check の line_on_box（辺が無関係の箱を貫く）が箱として数える
    box.ev_name = text
    g = VGroup(box, content)
    g.box, g.color = box, color
    return g


def link(a, b, text=None, color=MUTED, buff=0.12, side=UP):
    """a → b の矢印。text を矢印の side 側に添える。"""
    start, end = _facing_points(a, b)
    arrow = Arrow(start, end, buff=buff, color=color, stroke_width=3,
                  max_tip_length_to_length_ratio=0.12)
    g = VGroup(arrow)
    if text:
        t = note(text, size=18)
        v = end - start
        if abs(v[0]) >= 2 * abs(v[1]):
            t.next_to(arrow, side, buff=0.08)
        else:
            # 斜め・縦の矢印は外接矩形の上に置くと隣の矢印に乗るので、中点から矢印に垂直な向きへ離して置く
            n = np.array([-v[1], v[0], 0]) / max(1e-6, np.linalg.norm(v))
            if n[0] < 0:
                n = -n
            d = abs(n[0]) * t.width / 2 + abs(n[1]) * t.height / 2 + 0.12
            t.move_to((start + end) / 2 + n * d)
        g.add(t)
    g.arrow = arrow
    return g


class PathArrow(VMobject):
    """折れ線の矢印（全体図の辺。ELK が返す直角の点列）。dashed なら破線で描く（シーケンス図の戻り）。
    先端は最後の線分の向きに置く（TipableVMobject.add_tip は端点を合わせるために線全体を回転・伸縮させるので、
    折れ線が歪む。使わない）。is_route は layout_check が「線」として検査するための印（Line ではないので）。"""
    is_route = True

    def __init__(self, points, color=MUTED, stroke_width=3, tip=True, dashed=False, tip_length=0.2, **kw):
        super().__init__(color=color, stroke_width=stroke_width, **kw)
        pts = [np.array(p, dtype=float) for p in points]
        self.tip = None
        if tip:
            d = pts[-1] - pts[-2]
            n = np.linalg.norm(d)
            tl = min(tip_length, n * 0.6)
            d = d / max(n, 1e-6)
            end = pts[-1]
            pts[-1] = end - d * tl * 0.9          # 線は先端の付け根まで（先端の三角と重ねて太く見せない）
            self.tip = ArrowTriangleFilledTip(length=tl, width=tl * 0.8, color=color, fill_opacity=1, stroke_width=0)
            v = self.tip.tip_point - self.tip.base           # 作った直後の先端の向き（版によって違うので測る）
            self.tip.rotate(np.arctan2(d[1], d[0]) - np.arctan2(v[1], v[0]))
            self.tip.shift(end - self.tip.tip_point)
        self.set_points_as_corners(pts)
        if dashed:
            body = DashedVMobject(VMobject().set_points_as_corners(pts).set_stroke(color, stroke_width),
                                  num_dashes=max(4, int(self.get_arc_length() / 0.14)), dashed_ratio=0.55)
            self.set_stroke(opacity=0)
            self.add(body)
        if self.tip is not None:
            self.add(self.tip)


def link_path(points, text=None, label_at=None, color=MUTED, size=18, scale=1.0, dashed=False):
    """折れ線の辺 points（Manim 座標の点列）の矢印。text を label_at（ラベルの中心。ELK が辺の脇の空いた所に決めた位置）
    に置く。label_at が無ければ、いちばん長い線分の中点から線分に垂直な向き（上か右）へ、文字が線に乗らない距離だけ離す。
    文字は size で作って scale 倍する（全体図の縮尺に合わせる）。"""
    arrow = PathArrow(points, color=color, stroke_width=3, dashed=dashed, tip_length=0.2 * max(scale, 0.5))
    g = VGroup(arrow)
    if text:
        t = Text(text, font_size=size, color=color, line_spacing=0.6).scale(scale)
        if label_at is not None:
            t.move_to([label_at[0], label_at[1], 0])
        else:
            pts = [np.array(p, dtype=float) for p in points]
            a, b = max(zip(pts, pts[1:]), key=lambda ab: np.linalg.norm(ab[1] - ab[0]))
            v = b - a
            if abs(v[0]) >= abs(v[1]):
                t.next_to((a + b) / 2, UP, buff=0.08)
            else:
                t.next_to((a + b) / 2, RIGHT, buff=0.1)
        g.add(t)
    g.arrow = arrow
    return g


def _facing_points(a, b):
    dx = b.get_center()[0] - a.get_center()[0]
    dy = b.get_center()[1] - a.get_center()[1]
    if abs(dx) >= abs(dy):
        return (a.get_right(), b.get_left()) if dx > 0 else (a.get_left(), b.get_right())
    return (a.get_top(), b.get_bottom()) if dy > 0 else (a.get_bottom(), b.get_top())


def packet(color=DATA, text=None, tag_size=16):
    """流れていくデータ 1 個。光る点（+ 点の上に付いていく小さな札）。g.core が点そのもの。"""
    core = Dot(radius=0.11, color=color)
    glow = VGroup(*[Dot(radius=0.11 + 0.06 * i, color=color, fill_opacity=0.18 / i)
                    for i in range(1, 4)])
    g = VGroup(glow, core)
    g.core = core
    if text:
        g.tag = Text(text, font_size=tag_size, color=color).next_to(core, UP, buff=0.12)
        g.add(g.tag)
    g.set_z_index(-1)  # 箱の後ろを通す（箱の名前を上に描く）
    return g


def travel(pkt, *stops, rate_func=smooth, boxes=None, **kw):
    """packet を「今いる位置」から stops を順に通して、1 本の滑らかな動きで運ぶ。
    stops は Mobject（その中心を通る）か座標。途中で止めたり、出発点へ瞬間移動させたりしない。
    点（core）が経路に乗り、札は点の上に付いていく。区間ごとに play を分けると、
    区間の境目で一度止まって見えるので、続けて流れるものは 1 回の travel にまとめる。
    boxes（箱の Mobject の並び）を渡すと、stops を座標で渡しても、その箱の中を通る間だけ点を薄くし札を消す。"""
    core = getattr(pkt, "core", pkt)
    pts = [core.get_center()] + [s.get_center() if isinstance(s, Mobject) else np.array(s)
                                 for s in stops]
    path = VMobject().set_points_as_corners(pts)
    offset = pkt.get_center() - core.get_center()
    boxes = list(boxes) if boxes is not None else [s for s in stops if isinstance(s, Mobject)]
    tag = getattr(pkt, "tag", None)

    def inside(p):
        # 箱の内側にどれだけ入っているか（0 = 外、1 = 縁から 0.3 以上内側）
        best = 0.0
        for b in boxes:
            dx = b.width / 2 - abs(p[0] - b.get_x())
            dy = b.height / 2 - abs(p[1] - b.get_y())
            best = max(best, min(1.0, max(0.0, min(dx, dy) / 0.3)))
        return best

    dots = [d for d in pkt.get_family() if isinstance(d, Dot)]
    base = [d.get_fill_opacity() for d in dots]

    def update(m, alpha):
        p = path.point_from_proportion(alpha)
        m.move_to(p + offset)
        k = inside(p)
        # 箱の中にいる間は点を薄く、札を消す。「箱に入って処理されている」ように見え、箱の名前も読める
        for d, o in zip(dots, base):
            d.set_fill(opacity=o * (1 - 0.75 * k))
        if tag is not None:
            tag.set_opacity(1 - k)
    return UpdateFromAlphaFunc(pkt, update, rate_func=rate_func, **kw)


def pulse(nd):
    """packet が箱を通るとき、その箱が「処理した」ことを示す軽い明滅。travel と同時に play する。"""
    return Indicate(nd.box if hasattr(nd, "box") else nd, scale_factor=1.06,
                    color=getattr(nd, "color", DATA))


def _opacity_to(mobs, factor):
    """mobs の各部品の不透明度を「元の値 × factor」へ動かす。位置や大きさには触れない。
    元の値は最初に dim したときに覚えるので、dim 中に動かしたり縮めたりしても undim で崩れない。"""
    fam = [f for m in mobs for f in m.get_family() if f.has_points()]
    for f in fam:
        if not hasattr(f, "_ev_base"):
            f._ev_base = (f.get_fill_opacity(), f.get_stroke_opacity())
    start = [(f.get_fill_opacity(), f.get_stroke_opacity()) for f in fam]

    def make(f, s0):
        def upd(m, a):
            bf, bs = f._ev_base
            f.set_fill(opacity=s0[0] + (bf * factor - s0[0]) * a, family=False)
            f.set_stroke(opacity=s0[1] + (bs * factor - s0[1]) * a, family=False)
        return UpdateFromAlphaFunc(f, upd)
    return AnimationGroup(*[make(f, s0) for f, s0 in zip(fam, start)])


def dim(*mobs, opacity=0.25):
    """主役でないものを薄くする（消さない）。元に戻すときは undim。透明度だけを変え、位置は記録しない。"""
    return _opacity_to(mobs, opacity)


def undim(*mobs):
    """dim したものを元の濃さに戻す。dim 中に動かしたものでも位置はそのまま。"""
    return _opacity_to(mobs, 1.0)


def anatomy(parts, size=26, sep=None, gap=0.08, cap_size=16):
    """1 つのデータ（トークン・URL・ヘッダー・ID 等）を、意味のある部分に分けて色分けで並べる。
    parts = [(文字, 色, 下に添える説明 or None), ...]。g.pieces[i] / g.captions[i] で各部分を指せる。
    部分どうしの間隔は gap（Text は前後の空白を描かないので、空白を見せたいときは gap で空ける）。
    3b1b 調の主役は「箱と矢印」ではなく、このデータそのもの。分けて、寄って、変形させる。"""
    pieces, row = VGroup(), VGroup()
    for i, (text, color, _) in enumerate(parts):
        if i and sep:
            row.add(Text(sep, font_size=size, color=MUTED))
        t = Text(text, font_size=size, color=color)
        pieces.add(t)
        row.add(t)
    row.arrange(RIGHT, buff=gap)  # 「Authorization: Bearer」のように語の間に空白が要るなら gap=0.2 前後
    captions = VGroup()
    for t, (_, color, cap) in zip(pieces, parts):
        if cap:
            b = Brace(t, DOWN, buff=0.08, color=color)
            c = Text(cap, font_size=cap_size, color=color).next_to(b, DOWN, buff=0.06)
            captions.add(VGroup(b, c))
        else:
            captions.add(VGroup())
    g = VGroup(row, captions)
    g.pieces, g.captions = pieces, captions
    return g


def _tick(color=ADDED):
    return VMobject(color=color, stroke_width=5).set_points_as_corners(
        [[-0.14, 0, 0], [-0.03, -0.12, 0], [0.16, 0.14, 0]])


def _cross(color=REMOVED):
    a = Line([-0.12, -0.12, 0], [0.12, 0.12, 0], color=color, stroke_width=5)
    b = Line([-0.12, 0.12, 0], [0.12, -0.12, 0], color=color, stroke_width=5)
    return VGroup(a, b)


def checklist(rows, size=22):
    """条件を 1 行ずつ確かめる様子を見せる表。rows = [(項目, 期待する値), ...]。
    g.tick(i) / g.cross(i) が ✓ / ✗ を付けるアニメーションを返す（既に印があれば差し替える）。
    g.clear(i) で印を消す。g.marks[i] で今の印を引ける。印は絵で描くのでフォントに依存しない。"""
    lines = VGroup()
    for key, val in rows:
        k = Text(key, font_size=size, color=INK)
        v = Text(val, font_size=size, color=MUTED)
        lines.add(VGroup(k, v))
    kw = max(r[0].width for r in lines)
    for r in lines:
        r[1].next_to(r[0], RIGHT, buff=0.5 + kw - r[0].width)
    lines.arrange(DOWN, aligned_edge=LEFT, buff=0.22)
    g = VGroup(lines)
    g.rows = lines
    g.marks = [None] * len(rows)  # 行 i に付いている印（✓ / ✗）。付いていなければ None

    def _mark(i, m):
        m.next_to(lines[i], LEFT, buff=0.25)
        old = g.marks[i]
        g.marks[i] = m
        g.add(m)
        if old is None:
            return Create(m)
        g.remove(old)  # 既に印があれば差し替える（✓ → ✗ など）
        return ReplacementTransform(old, m)
    g.tick = lambda i: _mark(i, _tick())
    g.cross = lambda i: _mark(i, _cross())

    def _clear(i):
        old, g.marks[i] = g.marks[i], None
        g.remove(old)
        return FadeOut(old)
    g.clear = _clear
    return g


def mark(mob, color=DATA):
    """「今ここ」の枠。全体図に戻ったとき現在地を示す。"""
    return SurroundingRectangle(mob, color=color, buff=0.12, corner_radius=0.12, stroke_width=4)


def _disp_width(text):
    """等幅フォントでの表示幅（全角 2・半角 1）。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)


def _clip_width(text, width):
    out, w = "", 0
    for ch in text:
        cw = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
        if w + cw > width - 1:
            return out + "…"
        out, w = out + ch, w + cw
    return out


def code_panel(path, start=1, end=None, highlight=(), language=None, width=None, clip=90):
    """ソースの一部を表示する。行番号は実ファイルの行番号に合わせる。highlight は実ファイルの行番号。
    表示幅 clip（全角 2・半角 1）を超える行は末尾を「…」にして表示する（長いコメント行 1 本でパネル全体が縮むのを防ぐ）。
    切った行があれば警告を出すので、切った部分が説明に要るなら範囲を分けること。clip=None で切らない。"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    end = end or len(lines)
    shown = lines[start - 1:end]
    # 共通の字下げを外す（深い字下げのぶんパネルが横に伸びて文字が小さくなるのを防ぐ）
    ind = min((len(l) - len(l.lstrip(" ")) for l in shown if l.strip()), default=0)
    shown = [l[ind:] for l in shown]
    clipped = [start + i for i, l in enumerate(shown) if clip and _disp_width(l) > clip]
    if clipped:
        shown = [_clip_width(l, clip) if clip and _disp_width(l) > clip else l for l in shown]
        print(f"[explainer_kit] {os.path.basename(path)} の {clipped} 行目を表示幅 {clip}（全角 2）で切って表示")
    src = "\n".join(shown)
    lang = language or os.path.splitext(path)[1].lstrip(".") or "text"
    code = Code(code_string=src, language=lang, formatter_style="monokai",
                add_line_numbers=True, line_numbers_from=start, background="rectangle",
                paragraph_config={"font": MONO},
                background_config={"fill_color": "#1E2127", "stroke_color": MUTED,
                                   "stroke_width": 1})
    if width:
        code.scale_to_fit_width(width)
    marks = VGroup()
    body = getattr(code, "code_lines", None)
    for n in highlight:
        i = n - start
        if body is not None and 0 <= i < len(body):
            marks.add(SurroundingRectangle(body[i], color=DATA, buff=0.04, stroke_width=2,
                                           fill_color=DATA, fill_opacity=0.08))
    g = VGroup(code, marks)
    g.code, g.marks, g.start = code, marks, start
    return g


def move_highlight(panel, *lines):
    """code_panel の枠を別の行へ動かすアニメーション（行番号は実ファイルの番号）。"""
    body = panel.code.code_lines
    new = VGroup(*[SurroundingRectangle(body[n - panel.start], color=DATA, buff=0.04, stroke_width=2,
                                        fill_color=DATA, fill_opacity=0.08) for n in lines])
    if len(panel.marks) == 0:
        panel.marks.add(*new)
        return Create(new)
    return Transform(panel.marks, new)


def title_block(title, question=None):
    t = Text(title, font_size=44, color=INK)
    if not question:
        return VGroup(t)
    q = Text(question, font_size=28, color=DATA)
    return VGroup(t, q).arrange(DOWN, buff=0.4)


# ---------------------------------------------------------------- ナレーションと同期するシーン
class _Tracker:
    def __init__(self, duration):
        self.duration = duration


ESTIMATE_CHARS_PER_SEC = 6.5  # lint_storyboard.py の CHARS_PER_SEC と同じ値（音声合成前の見積もり）


def _estimated_manifest(workdir):
    """音声が無いときの manifest。尺は say の字数 ÷ 6.5 字/秒、音のファイルは無し。"""
    with open(os.path.join(workdir, "storyboard.json"), encoding="utf-8") as f:
        sb = json.load(f)
    return {l["id"]: {"sub": l["sub"], "duration": max(1.0, len(l["say"]) / ESTIMATE_CHARS_PER_SEC), "path": None}
            for c in sb["chapters"] for l in c["lines"]}


class NarratedScene(MovingCameraScene):
    """say() でナレーションに尺を合わせる。chapter() で章を切る。終了時に timeline.json を書く。"""

    workdir = os.getcwd()

    def setup(self):
        super().setup()
        path = os.path.join(self.workdir, "audio", "manifest.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.manifest = json.load(f)
        elif os.environ.get("SHOT_LAYOUT_ONLY"):
            # 配置検査（lint --layout）は音声合成の前に回すので、尺は say の字数から見積もる（音は鳴らさない）
            self.manifest = _estimated_manifest(self.workdir)
        else:
            raise FileNotFoundError(f"{path} が無い。tts_voicevox.py を先に実行してください")
        self.cues, self.chapters, self.used = [], [], set()
        self.home_width = self.camera.frame.width
        self.layout_issues, self._line, self._plays = [], "(行の外)", 0
        self.occupancy = {}     # 行 id → その行の最後の play の後に見えている文字・箱の区画（occupancy.json）

    def play(self, *args, **kwargs):
        """各 play（wait も含む）の終わりに配置を検査する（layout_check.py）。同じ行の同じ問題は 1 回だけ記録する。
        時刻は「実際に書き出すコマ数 × 1 コマの長さ」にそろえる。Manim は描いた play ではコマ数ぶん、
        キャッシュを使った play・飛ばした play では run_time ぶん時刻を進めるので、そのままでは同じ台本でも
        キャッシュの有無で尺と字幕の時刻が変わる（2 回目の描画が 1 回目と一致しない）。"""
        t0 = self.renderer.time
        super().play(*args, **kwargs)
        dt = 1 / config.frame_rate
        if self.is_current_animation_frozen_frame():
            frames = int(self.duration / dt)                     # freeze_current_frame と同じ数え方
        else:
            frames = len(np.arange(0, self.duration, dt))        # get_time_progression と同じ数え方
        self.renderer.time = t0 + frames * dt
        self._plays += 1
        seen = {(i["where"], i["kind"], i["detail"]) for i in self.layout_issues}
        for i in layout_check.check(self, self._line):
            if (i["where"], i["kind"], i["detail"]) not in seen:
                i["t"] = round(self.now(), 2)
                if getattr(self, "_custom_skipped", False):
                    # 配置の空回しで custom の行を飛ばした後は、その行が出す・消すはずだった物が食い違うので当てにならない。
                    # 警告に下げ、本当の配置は Phase 4 の preview で検査する
                    i["level"] = "W"
                    i["detail"] += "（custom の行を飛ばした後なので警告に下げた）"
                self.layout_issues.append(i)
        if not self._line.startswith("("):
            self.occupancy[self._line] = layout_check.occupancy(self, self.who)

    def who(self, mob):
        """占有表に載せる要素の名前（id）。ShotScene は登録簿の id を返す。"""
        return None

    def now(self):
        return self.renderer.time

    def add_sound(self, sound_file, time_offset=0, gain=None, **kwargs):
        """Manim の add_sound は renderer.skip_animations が立っていると黙って音を捨てる。この印は直前の play が
        区間キャッシュを再利用したときにも立ったまま残るので、2 回目以降の描画でナレーションの行が抜ける。
        印を見ずに、今の時刻に音を置く（描かずに飛ばす行の音を省くのは呼び出し側が決める）。"""
        self.renderer.file_writer.add_sound(sound_file, self.renderer.time + time_offset, gain, **kwargs)

    def chapter(self, title):
        self.next_section(title)
        self.chapters.append({"title": title, "start": round(self.now(), 2)})

    @contextlib.contextmanager
    def say(self, line_id, gap=0.3):
        """音声を鳴らし、ブロック内のアニメーションが短ければ話し終わるまで待つ。
        ブロック内の run_time 合計が音声より長いと、次の行の頭が遅れるだけで音は重ならない。"""
        if line_id not in self.manifest:
            raise KeyError(f"manifest に {line_id} がありません。tts_voicevox.py を再実行してください")
        info = self.manifest[line_id]
        self._line = line_id
        t0 = self.now()
        if info.get("path"):
            self.add_sound(info["path"])
        yield _Tracker(info["duration"])
        settled = self.now()  # ブロック内のアニメーションが終わった時刻（点検用の静止画はここで切る）
        rest = info["duration"] - (settled - t0)
        if rest > 0:
            self.wait(rest)
        self.cues.append({"id": line_id, "start": round(t0, 2),
                          "end": round(t0 + info["duration"], 2), "text": info["sub"],
                          "settled": round(max(settled, t0 + info["duration"]), 2)})
        self.used.add(line_id)
        if gap:
            self.wait(gap)
        self._line = f"(after {line_id})"

    # カメラ: 全体図 → 部分へ寄る → 全体図へ戻る、が 3b1b 調の基本の動き
    def focus_anim(self, mob, margin=1.25):
        """mob に寄るカメラの動きを Animation で返す（ほかの動きと同じ play に入れたいとき用）。
        画面下 1/6 の字幕帯を避け、mob が上 5/6 の中央に収まるように寄せる。"""
        frame = self.camera.frame
        aspect = frame.width / frame.height
        h = max(mob.height * margin / (1 - SUBTITLE_BAND), mob.width * margin / aspect, 4 / aspect)
        center = mob.get_center() + DOWN * (h * SUBTITLE_BAND / 2)
        return frame.animate.move_to(center).set(width=h * aspect)

    def focus(self, mob, margin=1.25, run_time=1.2):
        """mob に寄る（focus_anim を単独で play する）。"""
        self.play(self.focus_anim(mob, margin), run_time=run_time)

    def home(self, run_time=1.2):
        self.play(self.camera.frame.animate.move_to(ORIGIN).set(width=self.home_width),
                  run_time=run_time)

    def tear_down(self):
        super().tear_down()
        unused = [k for k in self.manifest if k not in self.used]
        with open(os.path.join(self.workdir, "timeline.json"), "w", encoding="utf-8") as f:
            json.dump({"duration": round(self.now(), 2), "chapters": self.chapters,
                       "cues": self.cues, "unused_lines": unused},
                      f, ensure_ascii=False, indent=1)
        if unused:
            print(f"[explainer_kit] 台本にあるが使われなかった行: {unused}")
        errs = sum(i["level"] == "E" for i in self.layout_issues)
        with open(os.path.join(self.workdir, "layout_report.json"), "w", encoding="utf-8") as f:
            json.dump({"errors": errs, "warnings": len(self.layout_issues) - errs,
                       "issues": self.layout_issues}, f, ensure_ascii=False, indent=1)
        print(f"[explainer_kit] 配置検査: エラー {errs} / 警告 {len(self.layout_issues) - errs}（layout_report.json）")
        with open(os.path.join(self.workdir, "occupancy.json"), "w", encoding="utf-8") as f:
            json.dump({"grid": layout_check.GRID_DOC, "lines": self.occupancy}, f, ensure_ascii=False, indent=1)
