"""storyboard.json のショット DSL（各行の shot.ops）を直接読んで描く解釈器。render.sh が workdir にコピーする。

    from shot_scene import *

    class Explainer(ShotScene):
        pass

op の一覧・引数・自動で行う配置・既定の尺は references/shot-dsl.md が正（この OPS と DUR はその表と揃える。
scripts/tests/run_tests.sh が両者の一致を検査する）。ops の無い行と {"op": "custom"} は workdir の
custom.py の関数 fn(scene, reg) を呼ぶ。

配置の約束（座標は台本に書かせない）:
  - 全体図: layout_map.py が ELK で決めた <workdir>/layout.json の座標（箱の中心・辺の折れ点・層の帯・題・凡例）。
    カメラは動かさない
  - 舞台割り: full（全体図をそのまま）/ side（全体図を左へ寄せ、右列に表）/ mini（全体図を縮めて左上、モノは
    STAGE_TOP・STAGE_LEFT・STAGE_MAIN）＋ overlay（暗幕 z=10 の上に z=11 で重ねる）
  - 文字サイズは 6 段（TITLE 44 / QUESTION 38・32 / NAME 26 / BODY 24 / NOTE 20 / SMALL 18）
環境変数:
  LINES=c6-1..c6-6   この範囲の行だけ描き、それ以外は状態だけ進める（音声・字幕もこの範囲だけ）
  SHOT_LAYOUT_ONLY=1 すべての行を描かずに状態だけ進め、配置検査（layout_report.json）だけを出す
"""
import importlib
import json
import os
import re
import sys

from explainer_kit import *  # noqa: F401,F403
from explainer_kit import _cross, _facing_points, _opacity_to, _tick
import hashlib
import layout_check

TITLE, QUESTION, QUESTION_S, NAME, BODY, NOTE, SMALL = 44, 38, 32, 26, 24, 20, 18
SAFE = (-6.8, -2.5, 6.8, 3.75)          # 安全域（x0, y0, x1, y1）。下端は字幕帯の上
MINI = 0.36                              # mini で全体図を縮める倍率の上限（外接矩形が MINI_BOX に収まるまで縮める）
MINI_BOX = (4.6, 1.9)                    # mini の全体図の外接矩形の大きさの上限（幅, 高さ）
MINI_UL = np.array([-6.75, 3.72, 0])     # mini の全体図の左上
SIDE_W = 8.2                             # side で全体図に使う幅（左端 -6.8 から。残りの右の列に表を置く）
COLORS = {"ink": INK, "muted": MUTED, "actor": ACTOR, "process": PROCESS, "store": STORE,
          "external": EXTERNAL, "data": DATA, "added": ADDED, "removed": REMOVED}

# op → 既定の尺（秒）。数値でないものは _nominal() で引数から計算する。shot-dsl.md の表と揃える
DUR = {
    "title": 2.0, "title_add": 1.0, "title_shrink": 1.0, "list": 1.6, "credit": 3.0,
    "map_show": 1.5, "map_add": 1.0, "map_frame": 2.0, "map_insert": 1.5, "map_mode": 1.5, "edge_mark": 1.0,
    "edge_reset": 0.6, "msg": 1.0, "map_use": 0.6,
    "dot": 0.6, "travel": "区間数×1.0", "respond": "区間数×0.8+0.6", "dot_hide": 0.5,
    "token_show": 1.5, "caption": "対象数×0.6", "split": 1.8, "open": 1.5, "table_rows": 1.2,
    "focus": 1.0, "bracket": 0.8, "point": 0.6, "tick": 0.5, "cross": 0.5, "clear": 0.5,
    "what_if": 3.5, "halt": 1.0, "extract": 1.6, "morph": 1.2, "relabel": 0.8, "scan": "行数×0.3+2.0",
    "overlay": 1.0, "overlay_end": 0.8, "code": 1.6, "code_move": 0.8, "screen": "1.5+注記数×0.6",
    "note": 0.6, "hide": 0.5, "dim": 0.6, "undim": 0.6, "emphasize": 1.0, "mark": 0.8, "badge": 0.6,
    "wait": "sec の値", "custom": "関数が決める",
}
OPS = set(DUR)
STALE_KINDS = {"note", "extract", "mark"}  # 置き去り（参照されないまま見えている）を検査する物


def _fsize(m):
    """文字の見た目の大きさ。Text.font_size は今の高さから逆算するので、what_if で背の低い文字列
    （例: 引用符だけ）に変形した後に読むと小さく出る。変形の前に覚えた値（_eff_size）を優先する。"""
    return getattr(m, "_eff_size", None) or m.font_size


class ShotError(Exception):
    """台本の op が解釈できない（未知の op・未宣言の辺・参照先が無い）。行 id つきで止める。"""


def _cue(o):
    """op の開始時刻の指定（"at": "、2" = 2 つ目の読点）。dot・halt などの引数 at（場所・行）とは値の頭で見分ける。"""
    at = o.get("at")
    return at if isinstance(at, str) and at[:1] in ("、", "。") else None


def _ink(m):
    """表示されている文字の色。Text.get_color() はグループの色（黒）を返すので、最初の字形の塗りを読む。"""
    if isinstance(m, Text) and m.submobjects:
        return m.submobjects[0].get_fill_color()
    return m.get_color()


def C(name, default=INK):
    return COLORS.get(name, name) if name else default


class S:
    """op が 1 回の play で再生する 1 段。anims が空なら待つだけ。"""

    def __init__(self, anims=(), rt=0.6):
        self.anims, self.rt = [a for a in anims if a is not None], rt


class Entry:
    """登録簿の 1 件。id は階層（claims.exp.value、header.tok.p）で、親の id を前に付ける。"""

    def __init__(self, eid, mob, kind, layer="stage", name=None, aliases=(), temp=False, **meta):
        self.id, self.mob, self.kind, self.layer = eid, mob, kind, layer
        self.name, self.aliases, self.temp = name, list(aliases), temp
        self.meta = meta
        self.last = -1          # 最後に op から参照された行の番号
        self.dimmed = False
        self.stale_warned = False


class Registry:
    """id → Mobject とメタ情報。custom 関数にもこれを渡す（reg.mob("claims.exp.value") など）。"""

    def __init__(self, scene):
        self.scene, self.e = scene, {}

    def put(self, eid, mob, kind, **kw):
        e = Entry(eid, mob, kind, **kw)
        e.last = self.scene._idx
        self.e[eid] = e
        return e

    def get(self, eid):
        if eid not in self.e:
            raise ShotError(f"「{eid}」が登録簿に無い（宣言されていないか、まだ出していない）")
        return self.e[eid]

    def mob(self, eid):
        return self.get(eid).mob

    def has(self, eid):
        return eid in self.e

    def family_ids(self, eid):
        return [k for k in self.e if k == eid or k.startswith(eid + ".")]

    def drop(self, eid):
        for k in self.family_ids(eid):
            del self.e[k]


def frame_box(title, w, h, color, size=SMALL):
    """まとまりを表す枠（上に名前）。"""
    r = RoundedRectangle(corner_radius=0.18, width=w, height=h, stroke_color=color,
                         stroke_width=2.5, fill_color=color, fill_opacity=0.05)
    t = Text(title, font_size=size, color=color).next_to(r.get_top(), DOWN, buff=0.1)
    g = VGroup(r, t)
    g.box, g.color, g.title = r, color, t
    return g


def band_box(title, w, h, size=SMALL):
    """層の帯（薄い枠＋左上の名前）。中身を囲む矩形は ELK が決める。is_band の印で注記の置き場所の障害物から外す。"""
    r = RoundedRectangle(corner_radius=0.12, width=w, height=h, stroke_color=MUTED, stroke_width=1.5,
                         stroke_opacity=0.55, fill_color=MUTED, fill_opacity=0.05)
    r.is_band = True
    t = Text(title, font_size=size, color=MUTED)
    t.move_to(r.get_corner(UL) + np.array([0.12 + t.width / 2, -0.1 - t.height / 2, 0]))
    g = VGroup(r, t)
    g.box, g.color, g.title = r, MUTED, t
    return g


LEGEND = {"actor": ACTOR, "process": PROCESS, "store": STORE, "external": EXTERNAL,
          "added": ADDED, "removed": REMOVED, "muted": MUTED}


def legend_row(items, size=SMALL):
    """凡例（色の四角＋意味）を横 1 列に並べる。items = [{"kind", "text"}]（layout.json の legend.items）。"""
    row = VGroup()
    for it in items:
        c = LEGEND.get(it["kind"], MUTED)
        sq = Square(side_length=0.2, stroke_color=c, stroke_width=2, fill_color=c, fill_opacity=0.35)
        row.add(VGroup(sq, Text(it["text"], font_size=size, color=MUTED)).arrange(RIGHT, buff=0.1))
    if len(row):
        row.arrange(RIGHT, buff=0.35)
    return row


def backdrop(opacity=0.92):
    return Rectangle(width=40, height=24, stroke_width=0, fill_color=BG, fill_opacity=opacity).set_z_index(10)


def _bbox(mobs):
    pts = [m for m in mobs if m.has_points() or m.submobjects]
    if not pts:
        return None
    x0 = min(m.get_left()[0] for m in pts)
    x1 = max(m.get_right()[0] for m in pts)
    y0 = min(m.get_bottom()[1] for m in pts)
    y1 = max(m.get_top()[1] for m in pts)
    return (x0, y0, x1, y1)


def _hit(a, b, pad=0.06):
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad


def _inside(b, area=SAFE):
    return b[0] >= area[0] and b[2] <= area[2] and b[1] >= area[1] and b[3] <= area[3]


def _width_units(text):
    return sum(1 if ord(c) < 0x2E80 else 2 for c in text)


class ShotScene(NarratedScene):
    """storyboard.json を読み、章 → 行の順に shot.ops を実行する。"""

    # ------------------------------------------------------------ 準備
    def setup(self):
        super().setup()
        with open(os.path.join(self.workdir, "storyboard.json"), encoding="utf-8") as f:
            self.sb = json.load(f)
        self.reg = Registry(self)
        self._idx, self._lid, self._chapter_idx = -1, None, -1
        self.mode = "full"
        self.overlay_state = None
        self._temps, self._title_ids, self._screens = [], [], []
        self._skipping, self._skipped = False, 0.0
        self._only = self._parse_lines(os.environ.get("LINES", ""))
        self._layout_only = os.environ.get("SHOT_LAYOUT_ONLY") == "1"
        self._custom = None
        # 全体図は map（1 つ。id は main）か maps（id → 宣言）。最初の図は最初の章の map、なければ maps の最初の id
        if self.sb.get("maps"):
            self.maps = dict(self.sb["maps"])
        else:
            self.maps = {"main": self.sb["map"]} if self.sb.get("map") else {}
        first = (self.sb["chapters"][0].get("map") if self.sb.get("chapters") else None) or next(iter(self.maps), None)
        self.cur_map = first
        self._pending_map = None
        self._declare_map(self.maps.get(first) or {})
        self.objects = self.sb.get("objects") or {}
        for oid, o in self.objects.items():
            if o.get("type") not in ("token", "table"):
                raise ShotError(f"objects.{oid}: type は token か table")

    def _parse_lines(self, spec):
        if not spec:
            return None
        order = [l["id"] for c in self.sb["chapters"] for l in c["lines"]]
        keep = set()
        for part in spec.split(","):
            part = part.strip()
            if ".." in part:
                a, b = part.split("..")
                i, j = order.index(a), order.index(b)
                keep.update(order[i:j + 1])
            elif part:
                keep.add(part)
        return keep

    def _put_node(self, n):
        """宣言どおりのノードを layout.json の位置に作って登録する（hide で登録簿から消えたノードを map_add で戻すときにも
        使う。そのときは今の舞台割りの座標に置く）。"""
        L = self.lay["nodes"][n["id"]]
        mob = node(n["name"], C(n.get("kind", "process"), n.get("kind")), width=L["width"], sub=n.get("sub"))
        mob.scale(self.lay["scale"]).move_to([L["x"], L["y"], 0])
        if self.mode != "full":
            self._to_mode(None, "full", self.mode)(mob)
        self.reg.put(n["id"], mob, "node", layer="map", name=n["name"], aliases=n.get("aliases", ()))

    def _load_layout(self, m):
        path = os.path.join(self.workdir, "layout.json")
        if not os.path.exists(path):
            raise ShotError("layout.json が無い。layout_map.py <workdir> を先に実行する（render.sh は自動で呼ぶ）")
        with open(path, encoding="utf-8") as f:
            lay = (json.load(f).get("maps") or {}).get(self.cur_map)
        h = hashlib.sha256(json.dumps(m, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        if lay is None or lay.get("map_hash") != h:
            raise ShotError(f"layout.json の全体図「{self.cur_map}」が storyboard.json と合わない"
                            "（map / maps を直した後は layout_map.py を回し直す）")
        return lay

    def _declare_map(self, m):
        """全体図の宣言と layout.json を読み、ノード・枠・層の帯・題・凡例を作っておく（場面には出さない）。"""
        self.nodes, self.frames, self.edges, self.layers = {}, {}, {}, {}
        self.frame_of, self.layer_of = {}, {}
        self.map_kind = m.get("kind", "layered") if m else None
        self._seq_row = 0
        if not m:
            self.lay = None
            self.map_bbox = (-6.8, -2.0, 2.0, 2.5)
            self.mode_tf = {"full": (1.0, np.zeros(3)), "side": (1.0, np.zeros(3)), "mini": (MINI, np.zeros(3))}
            return
        if any("cell" in x for x in m.get("nodes", []) + m.get("frames", [])):
            raise ShotError("map の cell は廃止（配置は ELK が決める。references/shot-dsl.md の「map と objects の宣言」）")
        self.lay = lay = self._load_layout(m)
        s, ts = lay["scale"], lay["text_sizes"]
        mode, self.mode = self.mode, "full"       # 部品は full の座標で作り、最後に今の舞台割りへ写す
        for n in m.get("nodes", []):
            self.nodes[n["id"]] = n
            self._put_node(n)
        for fr in m.get("frames", []):
            L = lay["frames"][fr["id"]]
            mob = frame_box(fr["name"], L["nw"], L["nh"], C(fr.get("kind", "process")), ts["band"]).scale(s)
            mob.move_to([L["x"], L["y"], 0])
            self.frames[fr["id"]] = fr
            for mid in fr.get("members", []):
                self.frame_of[mid] = fr["id"]
            self.reg.put(fr["id"], mob, "frame", layer="map", name=fr["name"], aliases=fr.get("aliases", ()))
        for ly in m.get("layers", []):
            L = lay["layers"][ly["id"]]
            mob = band_box(ly["name"], L["nw"], L["nh"], ts["band"]).scale(s).move_to([L["x"], L["y"], 0])
            self.layers[ly["id"]] = ly
            for mid in ly.get("members", []):
                self.layer_of[mid] = ly["id"]
                for x in (self.frames.get(mid) or {}).get("members", []):
                    self.layer_of[x] = ly["id"]
            self.reg.put(ly["id"], mob, "layer", layer="map", name=ly["name"], aliases=ly.get("aliases", ()))
        for e in m.get("edges", []):
            self.edges[e["id"]] = e
        if self.map_kind == "sequence":
            for nid, ll in lay["lifelines"].items():
                line = DashedLine([ll["x"], ll["top"], 0], [ll["x"], ll["bottom"], 0], color=MUTED,
                                  stroke_width=1.5, dash_length=0.08)
                self.reg.put(nid + ".life", line, "lifeline", layer="map")
        t = lay["title"]
        title = Text(t["text"], font_size=ts["title"], color=INK).scale(s)
        title.move_to([t["x"] + title.width / 2, t["y"], 0])
        self.reg.put("map.title", title, "maptitle", layer="map")
        lg = legend_row(lay["legend"]["items"], ts["legend"])
        if len(lg):
            lg.scale(s).move_to([lay["legend"]["x"] - lg.width / 2, lay["legend"]["y"], 0])
            self.reg.put("map.legend", lg, "legend", layer="map")
        self.map_bbox = bb = tuple(lay["bbox"])
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        ul = np.array([bb[0], bb[3], 0])
        k_side = min(1.0, SIDE_W / w)
        k_mini = min(MINI, MINI_BOX[0] / w, MINI_BOX[1] / h)
        # 舞台割りの変換 p → k p + d（full は layout.json の座標そのもの）
        self.mode_tf = {"full": (1.0, np.zeros(3)),
                        "side": (k_side, np.array([-6.8, bb[3], 0]) - k_side * ul),
                        "mini": (k_mini, MINI_UL - k_mini * ul)}
        self.mode = mode
        if mode != "full":
            apply = self._to_mode(None, "full", mode)
            for e in self.reg.e.values():
                if e.layer == "map":
                    apply(e.mob)
        if lay.get("min_text", 99) < layout_check.MIN_FONT:
            self._issue("W", "map_small", f"全体図が {s:.2f} 倍に縮み、名前・ラベルの実寸が {lay['min_text']} まで小さくなった。"
                        "層・ノード・辺を減らすか、名前・ラベル・層の名前を短くする")

    # ------------------------------------------------------------ 本体
    def construct(self):
        self._load_custom()
        for ci, ch in enumerate(self.sb["chapters"]):
            self._chapter_idx = ci
            self.chapter(ch["title"])
            self._chapter_start(ch)
            # 章の map: 章の最初の行の頭で、その図へ切り替える（map_use と同じ）
            self._pending_map = ch.get("map") if ch.get("map") and ch.get("map") != self.cur_map else None
            for line in ch["lines"]:
                self._idx += 1
                self._lid = line["id"]
                self._set_skipping(self._layout_only or (self._only is not None and line["id"] not in self._only))
                with self.say(line["id"]) as t:
                    self._run_line(line, t)
                if self._skipping and self.cues and self.cues[-1]["id"] == line["id"]:
                    self.cues.pop()
                self._line_end_checks(line, ch)
        self._set_skipping(self._layout_only or (self._only is not None))
        if not getattr(self, "_credited", False) and self.sb.get("credit"):
            for s in self._op_credit():
                self._play_step(s, 1.0)
        self._set_skipping(False)

    def tear_down(self):
        # 配置検査だけの実行（SHOT_LAYOUT_ONLY）では、前の描画の timeline.json を上書きしない
        path = os.path.join(self.workdir, "timeline.json")
        keep = open(path, encoding="utf-8").read() if self._layout_only and os.path.exists(path) else None
        super().tear_down()
        if keep is not None:
            with open(path, "w", encoding="utf-8") as f:
                f.write(keep)

    def _set_skipping(self, on):
        self._skipping = on
        self.renderer._original_skipping_status = on

    def play(self, *args, **kwargs):
        t = self.renderer.time
        super().play(*args, **kwargs)
        if self._skipping:
            self._skipped += self.renderer.time - t

    def now(self):
        return self.renderer.time - getattr(self, "_skipped", 0.0)

    def add_mobjects_from_animations(self, animations):
        """AnimationGroup（dim・LaggedStart など）は中身の Mobject を束ねた Group を場面に足し、そのとき
        Scene.add が同じ部品を含む表の行などを分解してしまう（登録簿の行が場面から外れる）。束ねずに中身を足す。"""
        flat = []

        def walk(a):
            if isinstance(a, AnimationGroup):
                for x in a.animations:
                    walk(x)
            else:
                flat.append(a)
        for a in animations:
            walk(a)
        super().add_mobjects_from_animations(flat)

    def add_sound(self, path, time_offset=0, **kw):
        if self._skipping:
            return
        super().add_sound(path, time_offset=time_offset - self._skipped, **kw)

    def _load_custom(self):
        path = os.path.join(self.workdir, "custom.py")
        if os.path.exists(path):
            if self.workdir not in sys.path:
                sys.path.insert(0, self.workdir)
            self._custom = importlib.import_module("custom")

    def _call_custom(self, fn):
        if self._custom is None or not hasattr(self._custom, fn):
            # 配置の空回し（lint --layout）は、animator が描く前の Phase 2 でも回す。まだ無い関数は飛ばして警告だけ出す
            # （その行の画は検査されない。Phase 4 の preview では従来どおり止める）
            if os.environ.get("SHOT_LAYOUT_ONLY"):
                self._issue("W", "custom_missing", f"{self._lid}: custom.py に関数 {fn} がまだ無いので、この行の配置は検査していない")
                self._custom_skipped = True
                return
            raise ShotError(f"{self._lid}: custom.py に関数 {fn}(scene, reg) が無い")
        getattr(self._custom, fn)(self, self.reg)

    # ------------------------------------------------------------ 行の実行
    def _run_line(self, line, tracker):
        shot = line.get("shot") or {}
        ops = shot.get("ops")
        if self._pending_map:
            sw = {"op": "map_use", "map": self._pending_map}
            self._pending_map = None
            if ops:
                ops = [sw] + list(ops)
            else:
                for st in self._op_map_use(**{k: v for k, v in sw.items() if k != "op"}):
                    self._play_step(st, 1.0)
        fades = self._take_temps()
        if "ops" in shot and not ops:
            # "ops": [] は画面を変えない行（一時物を消すだけで、あとは話し終わるまで待つ）
            if fades:
                self.play(*fades, run_time=0.4)
            return
        if not ops:
            if fades:
                self.play(*fades, run_time=0.4)
            self._call_custom(shot.get("fn") or "line_" + line["id"].replace("-", "_"))
            return
        nominal = sum(self._nominal(o) for o in ops if not o.get("with_prev"))
        f = min(1.0, max(0.0, tracker.duration - 0.2) / nominal) if nominal > 0 else 1.0
        t0 = self.now()
        groups = []
        for o in ops:
            if o.get("with_prev") and groups:
                groups[-1].append(o)
            else:
                groups.append([o])
        for group in groups:
            if fades and any(o.get("op") == "custom" for o in group):
                self.play(*fades, run_time=0.4)
                fades = []
            at = _cue(group[0])
            if at:
                start = self._comma_time(line["id"], at)
                if start is not None and self.now() - t0 < start:
                    self.wait(start - (self.now() - t0))
            gens = [self._op(o) for o in group]
            while gens:
                anims, rt, alive = [], 0.0, []
                for g in gens:
                    try:
                        s = next(g)
                    except StopIteration:
                        continue
                    alive.append(g)
                    anims += s.anims
                    rt = max(rt, s.rt)
                gens = alive
                if not gens:
                    break
                if fades:
                    anims, fades = anims + fades, []
                self._play_step(S(anims, rt), f)
        if fades:
            self.play(*fades, run_time=0.4)
        over = self.now() - t0 - tracker.duration
        if over > 0.3:
            self._issue("W", "ops_long", f"ops が音声より {over:.1f} 秒長い（op を減らすか行を分ける。最短まで縮めても収まらない）")

    def _play_step(self, s, f):
        rt = max(0.2, s.rt * f) if s.rt else 0.2
        if s.anims:
            self.play(*s.anims, run_time=rt)
            self._after_play()
        else:
            self.wait(rt)

    def _after_play(self):
        if self.overlay_state:
            for m in self.overlay_state["front"]:
                m.set_z_index(11)

    def _comma_time(self, lid, at):
        m = re.fullmatch(r"[、。](\d+)", str(at))
        commas = self.manifest[lid].get("commas")
        if not m or not commas:
            self._issue("W", "at", f"at「{at}」: manifest に読点の時刻（commas）が無いので無視した")
            return None
        k = int(m.group(1))
        if k < 1 or k > len(commas):
            self._issue("W", "at", f"at「{at}」: 読点は {len(commas)} 個しかない")
            return None
        return commas[k - 1]

    def _nominal(self, o):
        op = o.get("op")
        d = DUR.get(op)
        if isinstance(d, (int, float)):
            if op == "title" and o.get("sub"):
                return d + 1.0
            if op == "title_shrink" and o.get("text"):
                return d + 1.0
            if op == "map_show" and o.get("edges") and o.get("nodes"):
                return d + 1.0
            if op in ("tick", "cross") and o.get("point", True) and "." in o.get("target", ""):
                return d + 0.6
            return d
        if op == "travel":
            return 1.0 * max(1, len(o.get("path", [])) - 0) + 0.3
        if op == "respond":
            return 0.8 * max(1, self._resp_segments(o)) + 0.6
        if op == "caption":
            return 0.6 * len(o.get("targets", []))
        if op == "scan":
            return 0.3 * 6 + 2.0
        if op == "screen":
            return 1.5 + 0.6 * len(o.get("notes") or [])
        if op == "wait":
            return float(o.get("sec", 1.0))
        return 0.0

    def _resp_segments(self, o):
        e = self.reg.e.get(o.get("from") or o.get("from_dot"))
        return len(e.meta.get("path", [])) - 1 if e else 1

    def _op(self, o):
        op = o.get("op")
        if op not in OPS:
            raise ShotError(f"{self._lid}: 未知の op「{op}」（references/shot-dsl.md の表にあるもの）")
        args = {k: v for k, v in o.items() if k not in ("op", "with_prev") and not (k == "at" and _cue(o))}
        self._touch(args)
        handler = getattr(self, "_op_" + op)
        try:
            gen = handler(**args)
        except TypeError as e:
            raise ShotError(f"{self._lid}: op「{op}」の引数が合わない: {e}") from e
        gen = gen if gen is not None else iter(())
        if getattr(self, "_custom_skipped", False):
            return self._tolerate_missing(gen, op)
        return gen

    def _tolerate_missing(self, gen, op):
        """配置の空回しで custom の行を飛ばした後は、その行が作るはずだった物への参照で止めず、その op だけ飛ばして警告する。"""
        try:
            yield from gen
        except ShotError as e:
            if "登録簿に無い" not in str(e):
                raise
            self._issue("W", "custom_missing", f"{self._lid}: op「{op}」を飛ばした（custom の行がまだ描かれていないため: {e}）")

    def _touch(self, args):
        """op の引数に出てくる id を「参照した」と記録する（置き去りの検査用）。"""
        def walk(v):
            if isinstance(v, str):
                for k in self.reg.family_ids(v.split(".")[0]) if v else []:
                    if k == v or v.startswith(k + ".") or k.startswith(v + "."):
                        self.reg.e[k].last = self._idx
            elif isinstance(v, list):
                for x in v:
                    walk(x)
            elif isinstance(v, dict):
                for x in v.values():
                    walk(x)
        walk(args)

    # ------------------------------------------------------------ 章・行の境目
    def _chapter_start(self, ch):
        # 薄くした物は、新しい章の最初の行の終わりまでに undim か hide する（_line_end_checks で見る）
        self._dim_watch = [e.id for e in self.reg.e.values() if e.dimmed and self._shown(e.id)]
        self._dim_watch_title = ch["title"]
        # 問い（title）と実際の画面（screen）は章をまたがない
        for tid in self._title_ids + self._screens:
            if self.reg.has(tid):
                self._temps.append(tid)
        self._title_ids, self._screens = [], []

    def _take_temps(self):
        anims = []
        for tid in self._temps:
            if self.reg.has(tid):
                anims += self._hide_anims(tid)
                self.reg.drop(tid)
        self._temps = []
        return anims

    def _line_end_checks(self, line, ch):
        for eid in getattr(self, "_dim_watch", []):
            e = self.reg.e.get(eid)
            if e is not None and e.dimmed and self._shown(eid):
                self._issue("W", "dim_across", f"「{eid}」が薄くしたまま章「{self._dim_watch_title}」をまたいだ（hide か undim を）")
        self._dim_watch = []
        # 字幕に出てくる名前の物が見えているか
        if ch.get("role") != "question":
            sub = line.get("sub", "")
            listed = [t for x in self.reg.e.values() if self._shown(x.id) for t in getattr(x.mob, "texts", [])]
            for e in self.reg.e.values():
                names = [n for n in [e.name] + e.aliases if n and len(n) >= 2]
                if e.kind in ("node", "frame", "token", "table") and any(n in sub for n in names):
                    if not self._shown(e.id, strong=True) and not any(n in t for n in names for t in listed):
                        self._issue("W", "name_hidden",
                                    f"字幕の「{next(n for n in names if n in sub)}」（{e.id}）が行の終わりで見えていない")
        # 置き去り: 最後に参照されてから 2 行以上、どの op にも使われずに見えたまま
        for e in self.reg.e.values():
            if e.kind not in STALE_KINDS or e.stale_warned or e.dimmed:
                continue
            if e.layer == "map" and self.mode == "mini":
                continue
            covered = self._floor() > 0 and all(m.z_index < self._floor() for m in self._shown_parts(e.id))
            if self._idx - e.last >= 2 and self._shown(e.id, strong=True) and not covered:
                e.stale_warned = True
                self._issue("W", "stale", f"「{e.id}」が {self._idx - e.last} 行のあいだ参照されずに見えたまま（hide を）")

    def who(self, mob):
        """占有表（occupancy.json）に載せる要素の id: mob を含む登録簿の項目のうち、いちばん内側のもの。"""
        if getattr(self, "_who_at", None) != self._plays:
            self._who_at, self._who = self._plays, {}
            for e in sorted(self.reg.e.values(), key=lambda e: len(e.id)):   # 内側（長い id）で上書きする
                for p in [e.mob] + list(e.meta.get("extras") or []):
                    if p is not None:
                        for f in p.get_family():
                            self._who[id(f)] = e.id
        return self._who.get(id(mob))

    def _issue(self, level, kind, detail):
        self.layout_issues.append({"where": self._lid or "(行の外)", "level": level, "kind": kind,
                                   "detail": detail, "t": round(self.now(), 2)})

    # ------------------------------------------------------------ 見えているか・部品の集め方
    def _fam(self):
        return set(self.get_mobject_family_members())

    def _parts(self, eid):
        """eid とその子孫（id が eid. で始まるもの）の Mobject。表は行の印も含める。"""
        out = []
        for k in self.reg.family_ids(eid):
            e = self.reg.e[k]
            out.append(e.mob)
            if e.kind == "table":
                out += [m for m in e.mob.marks if m is not None]
            if e.kind == "row":
                tbl = self.reg.e[e.meta["table"]].mob
                if tbl.marks[e.meta["index"]] is not None:
                    out.append(tbl.marks[e.meta["index"]])
            for extra in e.meta.get("extras", []):
                out.append(extra)
        return out

    def _shown_parts(self, eid):
        """eid の部品のうち場面に出ているもの（入れ子は外側だけ）。"""
        fam = self._fam()
        vis = []

        def take(m):
            if m in fam:
                if m not in vis:
                    vis.append(m)
                return
            for x in m.submobjects:
                take(x)
        for m in self._parts(eid):
            take(m)
        return [m for m in vis if not any(o is not m and m in o.get_family() for o in vis)]

    def _shown(self, eid, strong=False):
        parts = self._shown_parts(eid)
        if not strong:
            return bool(parts)
        return any(layout_check._opacity(m) > layout_check.VISIBLE for m in parts)

    def _hide_anims(self, eid):
        anims = []
        for m in self._shown_parts(eid):
            anims.append(FadeOut(m))
            self._detach(m)
        return anims

    def _detach(self, m):
        """消した物を、場面に残る親のグループから外す（親を後で動かしたときに消した物が戻るのを防ぐ）。"""
        for e in self.reg.e.values():
            for f in e.mob.get_family():
                if m in f.submobjects and f is not m:
                    f.remove(m)

    def _xform(self, mob, apply):
        """mob を apply で動かすアニメーションを返す。場面に出ている部分は animate、出ていない部分はその場で動かす。"""
        fam = self._fam()
        if mob in fam:
            return [apply(mob.animate)]
        if not any(f in fam for f in mob.get_family()):
            apply(mob)
            return []
        out = []
        for s in mob.submobjects:
            out += self._xform(s, apply)
        if mob.has_points():
            apply(mob)
        return out

    def _obstacles(self, exclude):
        """見えている文字・箱・枠の外接矩形（exclude の family は除く）。線と点は数えない。"""
        ex = set()
        for m in exclude:
            ex.update(m.get_family())
        floor = self._floor()
        out = []

        def walk(m):
            if m in ex:
                return
            if getattr(m, "is_band", False):
                return                      # 層の帯は背景（注記はその上に置いてよい）。帯の名前は下の Text で避ける
            if isinstance(m, (Text, Code)) or (isinstance(m, Rectangle) and m.width < 20):
                if layout_check._opacity(m) > layout_check.VISIBLE and m.z_index >= floor:
                    out.append(_bbox([m]))
                return
            for x in m.submobjects:
                walk(x)
        for m in self.mobjects:
            walk(m)
        # ✓ ✗ の印（線で描くので上の走査では拾えない）も避ける
        fam = self._fam()
        for e in self.reg.e.values():
            marks = list(getattr(e.mob, "marks", None) or []) if e.kind == "table" else [e.mob] if e.kind == "partmark" else []
            for mk in marks:
                if mk is not None and mk in fam and mk not in ex:
                    out.append(_bbox([mk]))
        return out

    def _line_points(self, exclude):
        """見えている線・矢印の上の点（注記を線の上に置かないための検査用）。"""
        ex = set()
        for m in exclude:
            ex.update(m.get_family())
        pts = []
        for m in self.get_mobject_family_members():
            if m in ex or not (isinstance(m, Line) or getattr(m, "is_route", False)) or not m.has_points():
                continue
            if layout_check._opacity(m) <= layout_check.VISIBLE or m.z_index < self._floor():
                continue
            n = max(15, int(m.get_arc_length() / 0.15))
            pts += [m.point_from_proportion(p) for p in np.linspace(0.05, 0.95, n)]
        return pts

    def _floor(self):
        return 11 if self.overlay_state or any(e.kind in ("code", "screen") for e in self.reg.e.values()) else -100

    def _place_near(self, mob, target, side="up", exclude=(), order=None, buff=0.15, quiet=False):
        """mob を target の脇に置く。指定 side → 上 → 右 → 下 → 左 → 右上 → 左上 → 右下 → 左下 の順に、
        安全域内で見えている物（文字・箱・線）と重ならない位置を探す。各方向では、中央揃え → 端揃え の順に試し、
        安全域からはみ出す分は内側へずらして試す。全滅なら重なりの最も少ない位置に置き、引き出し線を返す。"""
        dirs = {"up": UP, "down": DOWN, "left": LEFT, "right": RIGHT, "ur": UR, "ul": UL, "dr": DR, "dl": DL}
        cands = list(dict.fromkeys(order or [side, "up", "right", "down", "left", "ur", "ul", "dr", "dl"]))
        if side == "in" or cands[0] == "in":
            mob.move_to(target.get_center() + DOWN * 0.1)
            return None
        obs = self._obstacles([mob, *exclude])
        lpts = self._line_points([mob])
        best = None
        for s in cands:
            if s not in dirs:
                raise ShotError(f"{self._lid}: side「{s}」は up/down/left/right/ur/ul/dr/dl/in のどれか")
            aligns = [None, LEFT, RIGHT] if s in ("up", "down") else [None, UP, DOWN] if s in ("left", "right") else [None]
            for al in aligns:
                mob.next_to(target, dirs[s], buff=buff)
                if al is not None:
                    mob.align_to(target, al)
                self._clamp(mob)
                b = _bbox([mob])
                bad = sum(_hit(b, o) for o in obs) + (0 if _inside(b) else 100) + \
                    sum(1 for p in lpts if b[0] - 0.1 < p[0] < b[2] + 0.1 and b[1] - 0.1 < p[1] < b[3] + 0.1)
                if bad == 0:
                    return None
                if best is None or bad < best[0]:
                    best = (bad, mob.get_center().copy())
        # 脇が全部ふさがっていれば（全体図が画面いっぱいのとき）、全体図の外（下 → 右 → 左）に置いて引き出し線で結ぶ
        if self.lay and not quiet:
            mb = self._map_box()
            tx, ty = target.get_center()[0], target.get_center()[1]
            far = [np.array([tx, mb[1] - 0.25 - mob.height / 2, 0]),
                   np.array([mb[2] + 0.3 + mob.width / 2, ty, 0]),
                   np.array([mb[0] - 0.3 - mob.width / 2, ty, 0])]
            for c in far:
                mob.move_to(c)
                self._clamp(mob)
                b = _bbox([mob])
                if _inside(b) and not any(_hit(b, o) for o in obs) and \
                        not any(b[0] < p[0] < b[2] and b[1] < p[1] < b[3] for p in lpts):
                    p0, p1 = _facing_points(mob, target)
                    return DashedLine(p0, p1, color=MUTED, stroke_width=1.5, dash_length=0.06)
        mob.move_to(best[1])
        if quiet:
            return True
        self._issue("W", "note_fallback", f"「{getattr(mob, 'text', '')[:16]}」の置き場所が見つからず引き出し線で置いた")
        p0, p1 = _facing_points(mob, target)
        return DashedLine(p0, p1, color=MUTED, stroke_width=1.5, dash_length=0.06)

    def _vis(self, eid):
        """eid の今見えている姿。mini 中に map_add で舞台へ大きく出した物は、その舞台の姿を返す。"""
        e = self.reg.get(eid)
        return e.meta.get("stage_big") or e.mob

    def _clamp(self, mob, area=SAFE):
        b = _bbox([mob])
        dx = max(0, area[0] - b[0]) - max(0, b[2] - area[2])
        dy = max(0, area[1] - b[1]) - max(0, b[3] - area[3])
        mob.shift(RIGHT * dx + UP * dy)
        return mob

    # ------------------------------------------------------------ 舞台割り
    def _to_mode(self, mob, frm="full", to=None):
        to = to or self.mode
        s1, d1 = self.mode_tf[frm]
        s2, d2 = self.mode_tf[to]
        return lambda m: m.shift(-d1).scale(s2 / s1, about_point=ORIGIN).shift(d2)

    def _map_box(self, mode=None):
        """全体図（題・凡例を含む）の外接矩形の、舞台割り mode での座標。"""
        k, d = self.mode_tf[mode or self.mode]
        b = self.map_bbox
        return (k * b[0] + d[0], k * b[1] + d[1], k * b[2] + d[0], k * b[3] + d[1])

    def _mini_bottom(self):
        return self._map_box("mini")[1]

    def _mini_right(self):
        return self._map_box("mini")[2]

    def _left_slot(self, mob):
        """mini の左列（STAGE_LEFT）に上から積む。"""
        top = self._mini_bottom() - 0.45
        for e in self.reg.e.values():
            if e.layer != "stage" or e.kind in ("token", "table", "row", "cell") or e.temp:
                continue
            parts = self._shown_parts(e.id)
            b = _bbox(parts) if parts else None
            if b and b[2] < -2.6:
                top = min(top, b[1] - 0.4)
        mob.shift(np.array([-6.6, top, 0]) - mob.get_corner(UL))
        return mob

    def _table_target(self, tbl, mode):
        """表の置き場所（中心, 倍率）。mini は STAGE_MAIN、side は全体図の右の列、full は中央。"""
        vis = self._table_visible_rows(tbl) or list(tbl.mob.rows)
        b = _bbox(vis)
        w = b[2] - b[0] + 0.6
        if mode == "mini":
            k = min(1.0, 8.2 / w)
            cx = min(1.9, 6.7 - w * k / 2)
            return np.array([cx, -0.1, 0]), k
        if mode == "side":
            x0 = self._map_box("side")[2] + 0.5
            k = max(0.75, min(1.0, (6.8 - x0) / w))
            return np.array([(x0 + 6.8) / 2, 0.3, 0]), k
        return np.array([0, -0.1, 0]), min(1.0, 12 / w)

    def _table_visible_rows(self, tbl):
        fam = self._fam()
        return [r for r in tbl.mob.rows if r in fam or any(s in fam for s in r.submobjects)]

    def _move_table(self, tbl, center, k):
        """表（見えていない行も含めて）を、見えている行の中心が center、倍率 k になるよう動かす。"""
        vis = self._table_visible_rows(tbl) or list(tbl.mob.rows)
        b = _bbox(vis)
        about = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0])
        shift = center - about
        anims = self._xform(tbl.mob, lambda m: m.scale(k, about_point=about).shift(shift))
        return anims, (about, k, shift)

    # ================================================================ A 文字
    def _op_title(self, text, sub=None, id="title"):
        lines = VGroup(*[label(t, QUESTION) for t in text.split("\n")]).arrange(DOWN, buff=0.25)
        grp = VGroup(lines)
        s = None
        if sub:
            s = label(sub, QUESTION_S, color=DATA)
            grp.add(s)
        grp.arrange(DOWN, buff=0.6).move_to(UP * 0.8)
        self.reg.put(id, lines, "title", name=None)
        self._title_ids.append(id)
        yield S([Write(lines)], 2.0)
        if s is not None:
            self.reg.put(id + ".sub", s, "title")
            yield S([FadeIn(s, shift=UP * 0.2)], 1.0)

    def _op_title_add(self, text, id=None, title="title"):
        id = id or f"{title}.add{len(self.reg.family_ids(title))}"
        parts = self._shown_parts(title)
        grp = VGroup(*parts)
        new = label(text, QUESTION_S, color=DATA).next_to(grp, DOWN, buff=0.6)
        # 足したあとの全体（元の問い + 新しい行）の中心を y=0.8 に保つ
        shift = UP * (0.8 - (grp.get_top()[1] + new.get_bottom()[1]) / 2)
        new.shift(shift)
        self.reg.put(id, new, "title")
        yield S([*[m.animate.shift(shift) for m in parts], FadeIn(new, shift=UP * 0.2)], 1.0)

    def _op_title_shrink(self, text=None, note=None, title="title"):
        parts = self._shown_parts(title)
        grp = VGroup(*parts)
        b = _bbox(parts)
        about = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0])
        k = 0.6
        target_top = SAFE[3] - 0.25
        shift = np.array([-about[0], target_top - (about[1] + (b[3] - about[1]) * k), 0])
        yield S([m.animate.scale(k, about_point=about).shift(shift) for m in parts], 1.0)
        if text:
            t = VGroup(label(text, QUESTION_S, color=ADDED))
            if note:
                t.add(label(note, BODY, color=MUTED))
            t.arrange(DOWN, buff=0.2)
            t.next_to(grp, DOWN, buff=0.8)
            self.reg.put(title + ".shrink", t, "title")
            yield S([FadeIn(t, shift=UP * 0.2)], 1.0)

    def _op_list(self, id, items, title=None, color="added", highlight=()):
        # 全体図が見えていれば全体図の右の列に小さめに、見えていなければ中央に置く。highlight は目立たせる項目の番号（0 始まり）
        map_shown = any(e.layer == "map" and self._shown(e.id) for e in self.reg.e.values())
        side = map_shown and self.mode != "mini"
        rows = VGroup()
        if title:
            rows.add(label(title, BODY if side else NAME, color=C(color)))
        for i, it in enumerate(items):
            rows.add(label(it, NOTE if side else BODY, color=C("data") if i in highlight else INK))
        rows.arrange(DOWN, aligned_edge=LEFT, buff=0.22)
        x0 = min(self._map_box()[2] + 0.5, 3.3) if side else -6.0
        if rows.width > 6.8 - x0:
            rows.scale_to_fit_width(6.8 - x0)
        rows.move_to([(x0 + 6.8) / 2, 0.3, 0])
        rows.texts = [title or ""] + list(items)  # name_hidden の検査が「名前は一覧に出ている」と数えるため
        self.reg.put(id, rows, "list")
        yield S([LaggedStart(*[FadeIn(m, shift=LEFT * 0.1) for m in rows], lag_ratio=0.3)], 1.6)

    def _op_credit(self):
        self._credited = True
        out = [FadeOut(m) for m in self.mobjects]
        for k in list(self.reg.e):
            del self.reg.e[k]
        g = VGroup(label(self.sb.get("credit", ""), 30))
        if self.sb.get("source_label"):
            g.add(note(self.sb["source_label"], NOTE))
        g.arrange(DOWN, buff=0.3).move_to(UP * 0.6)
        if out:
            yield S(out, 0.6)
        yield S([FadeIn(g)], 0.8)
        yield S([], 1.6)

    # ================================================================ B 全体図
    def _edge_ends(self, eid):
        if eid not in self.edges:
            raise ShotError(f"{self._lid}: 辺「{eid}」は map.edges に宣言されていない")
        a, b = eid.split(">")
        return a, b

    def _route(self, eid, mode=None):
        """辺の折れ点列（layout.json の座標を今の舞台割りへ写したもの）。"""
        self._edge_ends(eid)
        k, d = self.mode_tf[mode or self.mode]
        return [np.array([x, y, 0.0]) * k + d for x, y in self.lay["edges"][eid]["points"]]

    def _edge_mob(self, eid):
        if self.map_kind == "sequence":
            raise ShotError(f"{self._lid}: sequence の図の辺は msg で引く（map_show の edges・map_insert は使えない）")
        self._edge_ends(eid)
        E = self.lay["edges"][eid]
        s = self.lay["scale"]
        lk = link_path([np.array([x, y, 0.0]) for x, y in E["points"]], E.get("text"), E.get("label"),
                       size=self.lay["label_size"], scale=s)
        if self.mode != "full":
            self._to_mode(None, "full", self.mode)(lk)
        return lk

    def _check_edge(self, eid, lk):
        """矢印が短すぎて見えないなら止める（ELK の間隔で通常は起きない）。"""
        n = lk.arrow.get_arc_length()
        if n < 0.3:
            self._issue("E", "edge_short", f"辺「{eid}」の矢印が {n:.2f} しかない（名前を短くするか辺を減らす）")

    def _node_show(self, nid):
        e = self.reg.get(nid)
        if e.meta.get("stage_big") is not None:
            return []
        m = e.mob
        if e.kind == "frame":
            return [Create(m.box), FadeIn(m.title)]
        out = [FadeIn(m)]
        if self.reg.has(nid + ".life"):
            out.append(Create(self.reg.mob(nid + ".life")))
        return out

    def _chrome(self, ids):
        """ノード ids を初めて出すときに一緒に出す物: 題・凡例（全体図で 1 回）と、ids が属する層の帯。"""
        fam = self._fam()
        out = []
        for k in ("map.title", "map.legend"):
            if self.reg.has(k) and self.reg.mob(k) not in fam and not self.reg.get(k).meta.get("shown"):
                self.reg.get(k).meta["shown"] = True
                out.append(FadeIn(self.reg.mob(k)))
        for lid in dict.fromkeys(self.layer_of.get(i) for i in ids):
            if lid and self.reg.has(lid) and not self._shown(lid):
                band = self.reg.mob(lid)
                out += [Create(band.box), FadeIn(band.title)]
        return out

    def _op_map_show(self, nodes=(), edges=()):
        if self.mode == "mini" and (nodes or edges):
            self._issue("E", "mini_text", "mini 中に全体図へ新しい物を出した（map_mode で戻してから）")
        if not self.lay and (nodes or edges):
            raise ShotError(f"{self._lid}: map_show の前に map（全体図）の宣言が要る")
        anims = []
        chrome = self._chrome(nodes)
        if chrome:
            anims.append(AnimationGroup(*chrome))
        for nid in nodes:
            anims.append(AnimationGroup(*self._node_show(nid)))
        if anims:
            yield S([LaggedStart(*anims, lag_ratio=0.4)], 1.5)
        eas = []
        for eid in edges:
            lk = self._edge_mob(eid)
            self._check_edge(eid, lk)
            self.reg.put(eid, lk, "edge", layer="map")
            eas += [Create(lk.arrow)] + [FadeIn(x) for x in lk[1:]]
        if eas:
            yield S(eas, 1.0)

    def _op_map_add(self, id, edges=()):
        if not self.reg.has(id) and id in self.nodes:
            if self.mode == "mini":
                raise ShotError(f"{self._lid}: hide したノード「{id}」は mini 中には戻せない（full か side で map_add する）")
            self._put_node(self.nodes[id])
        e = self.reg.get(id)
        if self.mode == "mini":
            # mini 中は舞台に読める大きさで出し、全体図に戻すときに全体図の位置へ変形する
            src = self.nodes.get(id) or self.frames.get(id)
            big = node(src["name"], C(src.get("kind", "process")), width=max(2.4, e.mob.width))
            self._left_slot(big)
            e.meta["stage_big"] = big
            e.meta["extras"] = [big]
            yield S([Create(big.box), Write(big[1])], 1.0)
            return
        m = e.mob
        chrome = self._chrome([id])
        yield S(chrome + [Create(m.box), Write(m[1] if e.kind == "node" else m.title)], 1.0)
        if edges:
            yield from self._op_map_show(edges=edges)

    def _op_map_frame(self, frame, members=None):
        """枠を出す。中身（members）は ELK が初めから枠の中に置いているので動かさない。"""
        fe = self.reg.get(frame)
        declared = self.frames[frame].get("members", [])
        members = members if members is not None else declared
        stray = [m for m in members if m not in declared]
        if stray:
            raise ShotError(f"{self._lid}: map_frame「{frame}」の members {stray} は map.frames の宣言に無い")
        fr = fe.mob
        anims = self._chrome([frame]) + [Create(fr.box), FadeIn(fr.title)]
        fam = self._fam()
        # 枠の中のノードへ向かう辺は、宣言があれば枠へ向け直す
        renames = []
        for eid in list(self.edges):
            a, b = eid.split(">")
            if b in members and self.reg.has(eid) and self.reg.mob(eid) in fam:
                new_id = f"{a}>{frame}"
                if new_id in self.edges:
                    lk = self._edge_mob(new_id)
                    anims.append(ReplacementTransform(self.reg.mob(eid), lk))
                    renames.append((eid, new_id, lk))
        yield S(anims, 2.0)
        for old_id, new_id, lk in renames:
            self.reg.drop(old_id)
            self.reg.put(new_id, lk, "edge", layer="map")

    def _op_map_insert(self, node, on_edge):
        """辺 a>b を a>node と node>b に割る。node の位置は ELK が初めから決めている（a>node・node>b の辺も含めて配置
        してある）ので、配置をやり直さず既出の物も動かさない。元の辺は 2 本の辺へ変形する。"""
        a, b = self._edge_ends(on_edge)
        e = self.reg.get(node)
        old = self.reg.get(on_edge)
        e1, e2 = f"{a}>{node}", f"{node}>{b}"
        for x in (e1, e2):
            if x not in self.edges:
                raise ShotError(f"{self._lid}: map_insert には辺「{x}」の宣言が要る")
        yield S(self._chrome([node]) + [Create(e.mob.box), Write(e.mob[1])], 0.7)
        l1, l2 = self._edge_mob(e1), self._edge_mob(e2)
        grp = VGroup(l1, l2)
        yield S([ReplacementTransform(old.mob, grp)], 0.8)
        self.remove(grp)
        self.add(l1, l2)
        self.reg.drop(on_edge)
        self.reg.put(e1, l1, "edge", layer="map")
        self.reg.put(e2, l2, "edge", layer="map")

    def _op_map_use(self, map, transition="fade"):
        """表示中の全体図を別の図（maps の id）に切り替える。前の図の物（ノード・辺・点・応答・図の上の注記・題・凡例）は
        消して登録簿からも外し、新しい図は空で用意する（map_show などで出す）。舞台割り（full / side / mini）は保つ。"""
        if map not in self.maps:
            raise ShotError(f"{self._lid}: map_use「{map}」は maps に無い（{sorted(self.maps)}）")
        if map == self.cur_map:
            return
        fades = []
        olds = [e.id for e in self.reg.e.values() if e.layer == "map" and "." not in e.id or e.id in ("map.title", "map.legend")]
        for eid in olds:
            if self.reg.has(eid):
                fades += self._hide_anims(eid)
        for eid in [e.id for e in self.reg.e.values() if e.layer == "map"]:
            if self.reg.has(eid):
                self.reg.drop(eid)
        self.cur_map = map
        self._declare_map(self.maps[map])
        if fades:
            yield S(fades, 0.6 if transition == "fade" else 0.2)

    def _op_map_mode(self, mode):
        if mode not in self.mode_tf:
            raise ShotError(f"{self._lid}: map_mode は full / side / mini")
        frm = self.mode
        if frm == mode:
            return
        if mode == "side" and self.lay:
            eff = NAME * self.lay["scale"] * self.mode_tf["side"][0]
            if eff < layout_check.MIN_FONT:
                self._issue("W", "side_small", f"side では全体図の名前が実寸 {eff:.0f} まで縮む（全体図が横に長い）。"
                            "表は overlay で見せるか、mini にする")
        apply = self._to_mode(None, frm, mode)
        anims, hides, post = [], [], []
        # 題と凡例は full でだけ見せる（side・mini では全体図が縮んで読めない大きさになる）。消す物は動かさずに消し、
        # 消した後で座標だけ写す（animate で動かすと、消した物が動きの終わりに戻ってくる）
        header_off = [self.reg.get(k) for k in ("map.title", "map.legend")
                      if self.reg.has(k) and mode != "full" and self._shown(k)]
        for e in header_off:
            hides.append(FadeOut(e.mob))
            self._detach(e.mob)
            e.meta["by_mode"] = True
        # 全体図の物は、見えていない物も含めて今の舞台割りの座標に置いておく（後で出すときにそのまま使える）
        map_es = [e for e in self.reg.e.values() if e.layer == "map"]
        mobs = [e.mob for e in map_es if e.meta.get("stage_big") is None and e not in header_off]
        tops = [m for m in mobs if not any(o is not m and m in o.get_family() for o in mobs)]
        for m in dict.fromkeys(tops):
            anims += self._xform(m, apply)
        back = []
        for e in map_es:
            big = e.meta.get("stage_big")
            if big is None:
                continue
            apply(e.mob)
            if mode != "mini":
                # mini 中に舞台へ出した物を、全体図の位置へ変形して戻す（属する層の帯がまだ無ければ一緒に出す）
                anims.append(ReplacementTransform(big, e.mob))
                e.meta.pop("stage_big")
                e.meta["extras"] = []
                back.append(e.id)
        for e in list(self.reg.e.values()):
            if e.layer != "stage" or "." in e.id:
                continue
            if e.kind == "table":
                if self.reg.has(e.id + ".link"):
                    hides += self._hide_anims(e.id + ".link")
                    post.append(e.id + ".link")
                if mode == "full":
                    hides += self._hide_anims(e.id)
                    post.append(e.id)
                else:
                    center, k = self._table_target(e, mode)
                    a, _ = self._move_table(e, center, k)
                    anims += a
            elif frm == "mini" and self._shown(e.id):
                # mini で舞台に出していた物（トークン・開いた箱・注記・バッジ）は全体図に戻るときに消す
                hides += self._hide_anims(e.id)
                post.append(e.id)
        self.mode = mode
        if back:
            anims += self._chrome(back)
        for k in ("map.title", "map.legend"):
            if mode == "full" and self.reg.has(k) and self.reg.get(k).meta.pop("by_mode", False):
                anims.append(FadeIn(self.reg.mob(k)))
        if hides:
            yield S(hides, 0.5)
        for e in header_off:
            apply(e.mob)
        yield S(anims, 1.5)
        for pid in post:
            self.reg.drop(pid)

    def _op_edge_mark(self, edge, mark="cross", color="removed", id=None):
        e = self.reg.get(edge)
        arrow = e.mob.arrow
        yield S([arrow.animate.set_color(C(color))], 0.5)
        if mark == "cross":
            k = self.mode_tf[self.mode][0] * self.lay["scale"]
            x = _cross(C(color)).scale(1.2 * max(k, MINI)).move_to(arrow.point_from_proportion(0.5))
            self.reg.put(id or edge + ".mark", x, "edgemark", layer="map")
            yield S([Create(x)], 0.5)

    def _op_edge_reset(self, edge):
        """edge_mark で変えた辺の色と印を元に戻す。"""
        e = self.reg.get(edge)
        anims = [e.mob.arrow.animate.set_color(MUTED)]
        for k in [k for k in self.reg.family_ids(edge) if k != edge and self.reg.e[k].kind == "edgemark"]:
            anims += self._hide_anims(k)
            self.reg.drop(k)
        yield S(anims, 0.6)

    def _op_msg(self, edge, label=None, id=None, reply=False):
        """シーケンス図: 宣言した辺 a>b のメッセージを次の段に引く（reply は破線の戻り。a>a は コの字）。"""
        if self.map_kind != "sequence":
            raise ShotError(f"{self._lid}: msg は map.kind が sequence の図で使う")
        a, b = self._edge_ends(edge)
        rows = self.lay["rows"]
        if self._seq_row >= len(rows):
            raise ShotError(f"{self._lid}: msg の段が layout.json の段（{len(rows)}）を超えた（layout_map.py を回し直す）")
        if self.mode == "mini":
            self._issue("E", "mini_text", f"mini 中にメッセージ「{edge}」を引いた")
        y = rows[self._seq_row]
        self._seq_row += 1
        s, ls = self.lay["scale"], self.lay["label_size"]
        life = self.lay["lifelines"]
        xa, xb = life[a]["x"], life[b]["x"]
        text = label or self.edges[edge].get("label", "")
        t = Text(text, font_size=ls, color=INK).scale(s)
        if a == b:
            # 段の線から右へ出て下へ折り返すコの字。ラベルは他のメッセージと同じく段の線の上（生存線の右）
            w, dn = 0.6 * s, 0.22 * s
            pts = [[xa, y, 0], [xa + w, y, 0], [xa + w, y - dn, 0], [xa + 0.03, y - dn, 0]]
            t.move_to([xa + 0.12 * s + t.width / 2, y + 0.06 * s + t.height / 2, 0])
        else:
            sign = 1 if xb > xa else -1
            pts = [[xa, y, 0], [xb - sign * 0.03, y, 0]]
            # ラベルは出発の生存線と、到着の向きに隣の生存線との間（段の上）に置く（他の生存線をまたがない）
            xs = sorted(v["x"] for v in life.values())
            nxt = min((x for x in xs if (x - xa) * sign > 1e-6), key=lambda x: abs(x - xa))
            t.move_to([(xa + nxt) / 2, y + 0.06 * s + t.height / 2, 0])
        arrow = PathArrow(pts, color=INK, stroke_width=3, dashed=reply, tip_length=0.2 * max(s, 0.5))
        g = VGroup(arrow, t)
        g.arrow, g.label = arrow, t
        if self.mode != "full":
            self._to_mode(None, "full", self.mode)(g)
        mid = id or f"msg{self._seq_row}"
        self.reg.put(mid, g, "msg", layer="map", edge=edge)
        self.reg.put(mid + ".label", t, "label", layer="map")
        yield S([Create(arrow), FadeIn(t)], 1.0)

    # ================================================================ C 点・経路
    def _box_of(self, nid):
        m = self.reg.mob(nid)
        return getattr(m, "box", m)

    def _stop_point(self, nid):
        """点が箱の中で止まる位置。箱の名前（と補足）に重ならない所: 名前の下 → 名前の右 → 箱の下の縁 の順に、
        点（半径 0.11 × 全体図の縮尺）が箱に収まる所を選ぶ。枠は名前（上端）の下。"""
        e = self.reg.get(nid)
        m = e.mob
        box = getattr(m, "box", m)
        k = self.mode_tf[self.mode][0] * (self.lay["scale"] if self.lay else 1.0)
        r = 0.11 * k
        if e.kind == "frame":
            members = [self.reg.mob(x) for x in self.frames[nid].get("members", []) if self.reg.has(x)]
            if members:
                low = min(getattr(x, "box", x).get_bottom()[1] for x in members)
                return np.array([box.get_x(), (low + box.get_bottom()[1]) / 2, 0])
            return np.array([box.get_x(), m.title.get_bottom()[1] - (box.get_top()[1] - m.title.get_bottom()[1]), 0])
        if e.kind != "node":
            return box.get_center()
        content = m[1]
        y = content.get_bottom()[1] - 0.04 * k - r
        if y - r >= box.get_bottom()[1] - 1e-3:
            return np.array([box.get_x(), y, 0])
        x = content.get_right()[0] + 0.06 * k + r
        if x + r <= box.get_right()[0] - 0.02 * k:
            return np.array([x, box.get_y(), 0])
        return np.array([box.get_x(), box.get_bottom()[1], 0])

    def _packet(self, color, tag):
        """点（packet）を全体図の縮尺で作る。札は縮めても SMALL の大きさで読めるように、縮める前に大きく作る。"""
        k = self.lay["scale"] if self.lay else 1.0
        pkt = packet(color, tag, tag_size=SMALL / k)
        if getattr(pkt, "tag", None) is not None:
            pkt.tag.next_to(pkt.core, UP, buff=0.12 / k)
        return pkt.scale(k, about_point=pkt.core.get_center())

    def _op_dot(self, id, at, tag=None, color="data", inside=False, **kw):
        if self.map_kind == "sequence":
            raise ShotError(f"{self._lid}: sequence の図では点を動かさない（msg でメッセージを引く）")
        frm = kw.get("from")
        pkt = self._packet(C(color), tag)
        on_edge = None
        if ">" in at:
            lk = self.reg.mob(at)
            self._dot_on_edge(pkt, lk)
            start, on_edge = at.split(">")[0], at
        else:
            nd = self.reg.mob(at)
            box = getattr(nd, "box", nd)
            if inside:
                # 箱の中（名前の下）から出る。札は名前と重なるので隠し、travel で箱を出るときに現れる
                pkt.shift(self._stop_point(at) - pkt.core.get_center())
                if getattr(pkt, "tag", None) is not None:
                    pkt.tag.set_opacity(0)
            else:
                pkt.shift(box.get_right() + RIGHT * 0.35 * self.lay["scale"] - pkt.core.get_center())
            start = at
        meta = dict(at=start, path=[start], on_edge=on_edge, legs=[])
        if frm:
            src = self.reg.mob(frm)
            pkt.shift(src.get_center() - pkt.core.get_center())
            if getattr(pkt, "tag", None) is not None:
                pkt.tag.set_opacity(0)  # 元の物の上では札を出さない（travel で箱を出るときに現れる）
            self.reg.put(id, pkt, "dot", layer="map", **meta)
            yield S([ReplacementTransform(src.copy(), pkt)], 0.6)
            return
        if self.mode == "mini":
            self._issue("E", "mini_text", f"mini 中に全体図へ点「{id}」を出した")
        self.reg.put(id, pkt, "dot", layer="map", **meta)
        yield S([FadeIn(pkt)], 0.6)

    def _dot_on_edge(self, pkt, lk):
        """点を辺の上に置く。辺に沿って中点から位置を変え、札（点の上か下）が辺のラベル・箱・文字と重ならない所を選ぶ。
        全部重なるなら重なりの最も少ない所（点そのものは線の上にあるので、線の脇のラベルとの重なりは問わない）。"""
        tag = getattr(pkt, "tag", None)
        k = self.lay["scale"] if self.lay else 1.0
        if tag is None:
            pkt.shift(lk.arrow.point_from_proportion(0.5) - pkt.core.get_center())
            return
        obs = self._obstacles([pkt])
        best = None
        for t in (0.5, 0.35, 0.65, 0.2, 0.8):
            for d in (UP, DOWN):
                pkt.shift(lk.arrow.point_from_proportion(t) - pkt.core.get_center())
                tag.next_to(pkt.core, d, buff=0.12 * k)
                bad = sum(_hit(_bbox([tag]), o, pad=0.04) for o in obs) + (0 if _inside(_bbox([tag])) else 10)
                if best is None or bad < best[0]:
                    best = (bad, t, d)
                if bad == 0:
                    return
        _, t, d = best
        pkt.shift(lk.arrow.point_from_proportion(t) - pkt.core.get_center())
        tag.next_to(pkt.core, d, buff=0.12 * k)

    def _step_edge(self, a, b):
        """a から b へ進むときに通る宣言済みの辺（a>b、b の枠へ a>枠、a の枠から 枠>b の順に探す）。"""
        fa, fb = self.frame_of.get(a), self.frame_of.get(b)
        for x in (f"{a}>{b}", f"{a}>{fb}", f"{fa}>{b}"):
            if x in self.edges:
                return x
        return None

    def _can_step(self, a, b):
        return self._step_edge(a, b) is not None

    @staticmethod
    def _after(route, p):
        """折れ線 route の上の点 p から先の点列（p を含む）。"""
        best, bi = None, 0
        for i, (a, b) in enumerate(zip(route, route[1:])):
            v = b - a
            t = 0.0 if not v.any() else max(0.0, min(1.0, np.dot(p - a, v) / np.dot(v, v)))
            dist = np.linalg.norm(a + v * t - p)
            if best is None or dist < best:
                best, bi = dist, i
        return [p] + route[bi + 1:]

    def _op_travel(self, dot, path, stop="below_name", pulse=("last",)):
        d = self.reg.get(dot)
        cur = d.meta["at"]
        full = list(path) if path and path[0] == cur else [cur] + list(path)
        steps = []
        for a, b in zip(full, full[1:]):
            eid = self._step_edge(a, b)
            if eid is None:
                raise ShotError(f"{self._lid}: travel「{dot}」: 辺「{a}>{b}」は map.edges に無い（VG-9: 宣言した辺の上だけ通れる）")
            steps.append(eid)
        # 点は辺の折れ点をたどり、途中の箱では名前の下を通って次の辺へ出る
        pts, here = [], d.mob.core.get_center()
        for i, eid in enumerate(steps):
            route = self._route(eid)
            if i == 0 and d.meta.get("on_edge") == eid:
                route = self._after(route, here)[1:]
            pts += route
            if i < len(steps) - 1:
                pts.append(self._stop_point(full[i + 1]))
        last = full[-1]
        if stop == "below_name":
            pts.append(self._stop_point(last))
        elif not steps:
            pts.append(self._box_of(last).get_center())
        boxes = [self._box_of(x) for x in full[1:]]
        pulses = []
        for p in pulse or []:
            nid = last if p == "last" else p
            pulses.append(globals()["pulse"](self.reg.mob(nid)))
        n = max(1, len(full) - 1)
        d.meta.update(at=last, path=full, on_edge=None, legs=steps)
        anims = [travel(d.mob, *pts, boxes=boxes), *pulses] if pts else pulses
        tag = getattr(d.mob, "tag", None)
        if tag is not None and stop == "below_name":
            # 箱の中で止まる点の札は、着く直前に消す（箱の名前と重ねない）。travel の後に並べて上書きする
            anims.append(UpdateFromAlphaFunc(tag, lambda m, a: m.set_opacity(
                m.get_fill_opacity() * (1 - min(1.0, max(0.0, (a - 0.7) / 0.3))))))
        yield S(anims, 1.0 * n)

    @staticmethod
    def _offset(route, off):
        """折れ線を進む向きの右手側へ off だけずらす（直角の折れ線なので、角は前後の線分の法線の和だけ動かす）。"""
        nrm = []
        for a, b in zip(route, route[1:]):
            v = (b - a) / max(1e-6, np.linalg.norm(b - a))
            nrm.append(np.array([v[1], -v[0], 0]))
        out = [route[0] + nrm[0] * off]
        for i in range(1, len(route) - 1):
            out.append(route[i] + (nrm[i - 1] + nrm[i]) * off)
        out.append(route[-1] + nrm[-1] * off)
        return out, nrm

    def _resp_side(self, eid):
        """応答の矢印を行きの辺のどちら側へずらすか。既定は右手側（1）。辺のラベルが右手側にあれば左手側（-1）。"""
        lab = self.reg.e.get(eid)
        lab = lab.mob[1] if lab is not None and len(lab.mob) > 1 else None
        if lab is None:
            return 1
        route = self._route(eid)
        c = lab.get_center()
        a, b = min(zip(route, route[1:]), key=lambda ab: np.linalg.norm((ab[0] + ab[1]) / 2 - c))
        v = b - a
        return -1 if v[0] * (c[1] - a[1]) - v[1] * (c[0] - a[0]) < 0 else 1

    def _op_respond(self, label, id, color="removed", **kw):
        frm = kw.get("from") or kw.get("from_dot")
        d = self.reg.get(frm)
        legs = d.meta.get("legs") or []
        if not legs:
            raise ShotError(f"{self._lid}: respond は直前に travel した点（from）が要る")
        col = C(color)
        k = self.mode_tf[self.mode][0] * self.lay["scale"]
        off = 0.27 * k
        arrows, first_n = [], None
        for eid in reversed(legs):                    # 応答は来た道を逆順に戻る（VG-9）
            side = self._resp_side(eid)
            fwd, nrm = self._offset(self._route(eid), off * side)
            back = list(reversed(fwd))
            if first_n is None:
                first_n = nrm[-1] * side
            arrows.append(PathArrow(back, color=col, stroke_width=4, tip_length=0.22 * max(k, 0.5)))
        lab = Text(label, font_size=NAME, color=col).scale(max(k, 0.75))
        side = {(1, 0): "right", (-1, 0): "left", (0, 1): "up", (0, -1): "down"}.get(
            (int(round(first_n[0])), int(round(first_n[1]))), "up")
        lead = self._place_near(lab, arrows[0], side, order=[side, "up", "down", "right", "left"], buff=0.12, quiet=True)
        if lead is not None:
            # 置き場所が無ければ、引き出し線は使わず矢印の外側に置く（応答の名前は矢印の脇が読みやすい）
            lab.next_to(arrows[0], {"right": RIGHT, "left": LEFT, "up": UP, "down": DOWN}[side], buff=0.12)
            self._clamp(lab)
        g = VGroup(*arrows, lab)
        g.arrows, g.label = VGroup(*arrows), lab
        self.reg.put(id, g, "response", layer="map", arrows=arrows)
        self.reg.put(id + ".label", lab, "label", layer="map")
        for a in arrows:
            yield S([Create(a)], 0.8)
        yield S([FadeIn(lab)], 0.6)

    def _op_dot_hide(self, dot):
        anims = self._hide_anims(dot)
        self.reg.drop(dot)
        yield S(anims, 0.5)

    # ================================================================ D モノ
    def _build_token(self, tid):
        o = self.objects[tid]
        parts = o["parts"]
        g = anatomy([(p["text"], C(p.get("color", "data")), p.get("caption")) for p in parts],
                    size=NAME, sep=o.get("sep"), gap=o.get("gap", 0.22), cap_size=SMALL)
        return g

    def _register_token(self, tid, g, layer="stage"):
        o = self.objects[tid]
        self.reg.put(tid, g[0], "token", layer=layer, name=o.get("name"), aliases=o.get("aliases", ()))
        for p, piece, cap in zip(o["parts"], g.pieces, g.captions):
            self.reg.put(f"{tid}.{p['id']}", piece, "part", caption=cap, spec=p)
            if len(cap):
                self.reg.put(f"{tid}.{p['id']}.cap", cap, "caption")

    def _op_token_show(self, token, **kw):
        frm = kw.get("from")
        g = self._build_token(token)
        row = g[0]
        if self.mode == "mini":
            row.move_to([0, 2.95, 0])
            row.shift(RIGHT * (self._mini_right() + 0.6 - row.get_left()[0]))
            if row.get_right()[0] > 6.6:
                row.shift(LEFT * (row.get_right()[0] - 6.6))
        else:
            row.move_to([0, 2.95, 0])
        for c, p in zip(g.captions, g.pieces):
            if len(c):
                c.next_to(p, DOWN, buff=0.04)
        self._register_token(token, g)
        if frm:
            src = self.reg.get(frm)
            yield S([ReplacementTransform(src.mob, row)], 1.5)
            self.reg.drop(frm)
        else:
            yield S([FadeIn(row, shift=UP * 0.1)], 1.5)

    def _op_caption(self, targets):
        for t in targets:
            e = self.reg.get(t)
            cap = e.meta.get("caption")
            if cap is None or not len(cap):
                raise ShotError(f"{self._lid}: caption「{t}」に caption（説明）が宣言されていない")
            yield S([FadeIn(cap)], 0.6)

    def _op_split(self, part):
        e = self.reg.get(part)
        spec = e.meta["spec"].get("split")
        if not spec:
            raise ShotError(f"{self._lid}: split「{part}」に split の宣言が無い")
        sub = anatomy([(p["text"], C(p.get("color", e.meta["spec"].get("color", "data"))), p.get("caption"))
                       for p in spec["parts"]], size=NAME, sep=spec.get("sep", "."), gap=spec.get("gap", 0.06),
                      cap_size=SMALL)
        sub[0].move_to(e.mob).align_to(e.mob, LEFT)
        for c, p in zip(sub.captions, sub.pieces):
            c.next_to(p, DOWN, buff=0.04)
        # 1 文字ずつ同じ文字へ動かす（文字列全体を変形すると、途中で崩れた形を経由して別の文字に描き直したように見える）。
        # 割った後の文字の並びが元と同じなら、元の文字を割った後の位置へ動かし、終わってから同じ見た目の部品と入れ替える
        old_g = [g for g in e.mob.family_members_with_points()]
        new_g = [g for g in sub[0].family_members_with_points()]
        same = len(old_g) == len(new_g)
        anims = [Transform(o, n.copy()) for o, n in zip(old_g, new_g)] if same else [ReplacementTransform(e.mob, sub[0])]
        cap = e.meta.get("caption")
        if cap is not None and len(cap) and cap in self._fam():
            anims.append(FadeOut(cap))
            self._detach(cap)
        yield S(anims, 1.0)
        if same:
            self.replace(e.mob, sub[0])
        self.reg.drop(part + ".cap")
        e.mob = sub[0]
        e.meta["caption"] = VGroup()
        for p, piece, c in zip(spec["parts"], sub.pieces, sub.captions):
            self.reg.put(f"{part}.{p['id']}", piece, "part", caption=c, spec=p)
            if len(c):
                self.reg.put(f"{part}.{p['id']}.cap", c, "caption")
        caps = [c for c in sub.captions if len(c)]
        if caps:
            yield S([FadeIn(c) for c in caps], 0.8)

    def _source_anchor(self, frm):
        """frm（トークンの部分など）から線を引き出す点。説明が見えていれば説明の下、なければ本体の下。"""
        e = self.reg.get(frm)
        cap = e.meta.get("caption")
        if cap is not None and len(cap) and cap in self._fam():
            return cap.get_bottom()
        return e.mob.get_bottom()

    def _build_table(self, tid, rows=None, size=BODY):
        o = self.objects[tid]
        spec = [r for r in o["rows"] if rows is None or r["id"] in rows]
        cl = checklist([(r["key"], r["value"]) for r in spec], size=size)
        for r in cl.rows:
            r[1].set_color(C(o.get("value_color", "data")))
        return cl, spec

    def _register_table(self, tid, cl, spec, layer="stage", name=None, aliases=()):
        o = self.objects.get(tid, {})
        self.reg.put(tid, cl, "table", layer=layer, name=name or o.get("name"),
                     aliases=aliases or o.get("aliases", ()), spec=spec)
        for i, (r, row) in enumerate(zip(spec, cl.rows)):
            self.reg.put(f"{tid}.{r['id']}", row, "row", table=tid, index=i)
            self.reg.put(f"{tid}.{r['id']}.key", row[0], "cell", table=tid, index=i)
            self.reg.put(f"{tid}.{r['id']}.value", row[1], "cell", table=tid, index=i)

    def _op_open(self, id, **kw):
        frm, kind = kw.get("from"), kw.get("as", "box")
        if kind == "table":
            yield from self._open_table(id, frm, kw.get("rows"))
            return
        items = kw.get("items") or []
        title = kw.get("title")
        src = self.reg.get(frm) if frm else None
        smob = self._vis(frm) if frm else None
        col = C(kw.get("color")) if kw.get("color") else (
            DATA if src is not None and src.kind == "part" else getattr(src.mob, "color", MUTED) if src else MUTED)
        texts = VGroup(*[label(it["text"] if isinstance(it, dict) else it, BODY) for it in items])
        if len(texts):
            texts.arrange(DOWN, aligned_edge=LEFT, buff=0.18)
        if title:
            w = max(2.8, (texts.width if len(texts) else 0) + 0.6, Text(title, font_size=SMALL).width + 0.5)
            h = 1.0 + (texts.height + 0.2 if len(texts) else 0)
            box = frame_box(title, w, h, col)
            if len(texts):
                texts.next_to(box.title, DOWN, buff=0.2)
            g = VGroup(box, texts)
        else:
            box = SurroundingRectangle(texts, color=col, buff=0.22, corner_radius=0.12, stroke_width=2)
            g = VGroup(box, texts)
        g.box = box.box if title else box
        g.title = box.title if title else None
        g.items = texts
        line = None
        if self.mode == "mini" or src is None:
            self._left_slot(g)
        elif src.layer == "map":
            line = self._place_near(g, smob, kw.get("side", "down"), order=None)
        else:
            g.next_to(smob, DOWN, buff=0.8)
            self._clamp(g)
        if src is not None and line is None:
            if src.kind == "part":
                line = DashedLine(self._source_anchor(frm), g.get_top(), color=col, stroke_width=2, dash_length=0.08)
            else:
                p0, p1 = _facing_points(g, getattr(smob, "box", smob))
                line = DashedLine(p0, p1, color=col, stroke_width=2, dash_length=0.08)
        self.reg.put(id, g, "box", layer="stage", name=title)
        for i, (it, t) in enumerate(zip(items, texts)):
            iid = it.get("id") if isinstance(it, dict) else str(i)
            self.reg.put(f"{id}.{iid}", t, "item")
        anims = [Create(g.box)] + ([FadeIn(g.title)] if title else []) + [FadeIn(t) for t in texts]
        if line is not None:
            self.reg.put(id + ".link", line, "link")
            anims.insert(0, Create(line))
        yield S(anims, 1.5)

    def _open_table(self, id, frm, rows):
        cl, spec = self._build_table(id)
        self._register_table(id, cl, spec)
        tbl = self.reg.get(id)
        show = [r for r in spec if rows is None or r["id"] in rows]
        idx = [spec.index(r) for r in show]
        center, k = self._table_target(tbl, self.mode)
        # 宣言した全行を基準に置く（後で table_rows で足す行の場所を空けておく）
        b = _bbox(list(cl.rows))
        about = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0])
        cl.scale(k, about_point=about).shift(center - about)
        if self.mode == "mini" or self.mode == "full":
            vb = _bbox([cl.rows[i] for i in idx])
            if vb[2] > 6.7:
                cl.shift(LEFT * (vb[2] - 6.7))
        if frm:
            first = cl.rows[idx[0]]
            line = DashedLine(self._source_anchor(frm), first.get_corner(UL) + UP * 0.1, color=DATA,
                              stroke_width=2, dash_length=0.08)
            self.reg.put(id + ".link", line, "link")
            yield S([Create(line)], 0.5)
        yield S([LaggedStart(*[FadeIn(cl.rows[i], shift=DOWN * 0.1) for i in idx], lag_ratio=0.3)], 1.5)

    def _row(self, rid):
        e = self.reg.get(rid)
        if e.kind not in ("row", "cell"):
            raise ShotError(f"{self._lid}: 「{rid}」は表の行ではない")
        tbl = self.reg.get(e.meta["table"])
        return tbl, e.meta["index"]

    def _op_table_rows(self, table, add, at=None):
        tbl = self.reg.get(table)
        idx = [self._row(f"{table}.{r}")[1] for r in add]
        yield S([LaggedStart(*[FadeIn(tbl.mob.rows[i], shift=DOWN * 0.1) for i in idx], lag_ratio=0.3)], 1.2)

    def _op_focus(self, table, rows):
        tbl = self.reg.get(table)
        keep = {self._row(f"{table}.{r}")[1] for r in rows}
        on, off = [], []
        fam = self._fam()
        for i, row in enumerate(tbl.mob.rows):
            parts = [row] + ([tbl.mob.marks[i]] if tbl.mob.marks[i] is not None else [])
            if row not in fam:
                continue
            (on if i in keep else off).extend(parts)
            self.reg.e[f"{table}.{tbl.meta['spec'][i]['id']}"].dimmed = i not in keep
        anims = []
        if on:
            anims.append(undim(*on))
        if off:
            anims.append(dim(*off))
        yield S(anims, 1.0)

    def _op_bracket(self, table, rows, label, id):
        tbl = self.reg.get(table)
        idx = [self._row(f"{table}.{r}")[1] for r in rows]
        grp = VGroup(*[tbl.mob.rows[i] for i in idx])
        br = Brace(grp, RIGHT, buff=0.15, color=PROCESS)
        lab = Text(label, font_size=NOTE, color=PROCESS).next_to(br, RIGHT, buff=0.1)
        g = VGroup(br, lab)
        g.label = lab
        self.reg.put(id, g, "bracket", table=table, rows=idx)
        self.reg.put(id + ".label", lab, "label")
        yield S([GrowFromCenter(br), FadeIn(lab)], 0.8)

    def _op_point(self, target):
        m = self._vis(target)
        yield S([Indicate(m, color=getattr(m, "color", DATA) if not isinstance(m, Text) else _ink(m),
                          scale_factor=1.1)], 0.6)

    def _mark_anim(self, target, kind):
        e = self.reg.get(target)
        if e.kind in ("row", "cell"):
            tbl, i = self._row(target)
            cl = tbl.mob
            if kind == "clear":
                return cl.clear(i) if cl.marks[i] is not None else None
            a = cl.tick(i) if kind == "tick" else cl.cross(i)
            if self.overlay_state:
                cl.marks[i].set_z_index(11)
            return a
        # トークンの部分: 部分の上に印を付ける
        old = self.reg.e.get(target + ".mark")
        if kind == "clear":
            if old is None:
                return None
            self.reg.drop(target + ".mark")
            return FadeOut(old.mob)
        m = (_tick() if kind == "tick" else _cross()).next_to(e.mob, UP, buff=0.12)
        self.reg.put(target + ".mark", m, "partmark")
        if old is not None and old.mob in self._fam():
            return ReplacementTransform(old.mob, m)
        return Create(m)

    def _has_mark(self, target):
        e = self.reg.get(target)
        if e.kind in ("row", "cell"):
            tbl, i = self._row(target)
            return tbl.mob.marks[i] is not None and tbl.mob.marks[i] in self._fam()
        m = self.reg.e.get(target + ".mark")
        return m is not None and m.mob in self._fam()

    def _mark_op(self, kind, target, point=True):
        e = self.reg.get(target)
        if point and kind != "clear" and e.kind in ("row", "cell"):
            tbl, i = self._row(target)
            v = tbl.mob.rows[i][1]
            yield S([Indicate(v, color=_ink(v), scale_factor=1.1)], 0.6)
        elif point and kind != "clear" and e.kind == "part":
            yield S([Indicate(e.mob, color=_ink(e.mob), scale_factor=1.1)], 0.6)
        yield S([self._mark_anim(target, kind)], 0.5)

    def _op_tick(self, target, point=True):
        yield from self._mark_op("tick", target, point)

    def _op_cross(self, target, point=True):
        yield from self._mark_op("cross", target, point)

    def _op_clear(self, target, point=False):
        yield from self._mark_op("clear", target, False)

    def _op_what_if(self, targets, value, result="401", restore=True):
        ents = [self.reg.get(t) for t in targets]
        first = ents[0]
        fm = first.mob if first.kind != "row" else first.mob[1]
        others = [e.mob for e in ents[1:]]
        saved = fm.copy()
        size = _fsize(fm) if isinstance(fm, Text) else BODY
        fm._eff_size = size  # Transform で中身が変わっても、次の書き換えはこの大きさで作る
        bad = Text(value, font_size=size, color=REMOVED)
        bad.move_to(fm).align_to(fm, LEFT)
        # 書き換える部分の説明・引き出し線は、書き換えている間だけ見えなくする
        veil = []
        fam = self._fam()
        for e in ents:
            area = [e.mob]
            for k in self.reg.family_ids(e.id):
                if k.endswith(".cap") and self.reg.e[k].mob in fam:
                    veil.append(self.reg.e[k].mob)
                    area.append(self.reg.e[k].mob)
            if e.kind != "part":
                continue
            b = _bbox(area)
            for k, x in self.reg.e.items():
                if k.endswith(".link") and x.mob in fam:
                    p = x.mob.get_start()
                    if b[0] - 0.15 < p[0] < b[2] + 0.15 and b[1] - 0.15 < p[1] < b[3] + 0.15:
                        veil.append(x.mob)
        mark_target = targets[0]
        if first.kind == "part":
            mark_target = next((t for t in targets if self.reg.has(t + ".mark")), targets[0])
        had_mark = self._has_mark(mark_target)
        # 書き換えと同時に、付いていた ✓ を外す（「新しい値 ✓」と一瞬でも読めないように）
        a1 = [Transform(fm, bad), self._mark_anim(mark_target, "clear")]
        if others or veil:
            a1.append(_opacity_to(others + veil, 0.0))
        yield S(a1, 0.8)
        cross = self._mark_anim(mark_target, "cross")
        yield S([cross], 0.4)
        res = Text(result, font_size=BODY, color=REMOVED)
        hidden_label = None
        if first.kind in ("row", "cell"):
            tbl, i = self._row(targets[0])
            row = tbl.mob.rows[i]
            vis = self._table_visible_rows(tbl)
            res.next_to(VGroup(*vis), RIGHT, buff=0.3).set_y(row.get_y())
            if res.get_right()[0] > SAFE[2]:
                # 右に入らなければ表の下に置く（画面内へ押し戻すと表の値に重なる）
                res.next_to(VGroup(*vis), DOWN, buff=0.3).align_to(VGroup(*vis), RIGHT)
            for e in self.reg.e.values():
                if e.kind == "bracket" and e.meta["table"] == tbl.id and i in e.meta["rows"] and e.mob in self._fam():
                    hidden_label = e.mob.label
                    res.move_to(hidden_label, aligned_edge=LEFT).set_y(row.get_y())
        else:
            res.next_to(bad, RIGHT, buff=0.5)
        self._clamp(res)
        if self.overlay_state:
            res.set_z_index(11)
        a3 = [FadeIn(res)]
        if hidden_label is not None:
            a3.append(_opacity_to([hidden_label], 0.0))
        yield S(a3, 0.5)
        if not restore:
            self.reg.put(f"{targets[0]}.result", res, "result", temp=True)
            self._temps.append(f"{targets[0]}.result")
            return
        yield S([], 0.6)
        # 元の値に戻すのと同時に ✗ を元の印に戻す（✓ があれば ✓、無かったなら外す。戻した値に ✗ が残って見えないように）
        back_mark = self._mark_anim(mark_target, "tick" if had_mark else "clear")
        a4 = [Transform(fm, saved), FadeOut(res)] + ([back_mark] if back_mark is not None else [])
        back = others + veil + ([hidden_label] if hidden_label is not None else [])
        if back:
            a4.append(_opacity_to(back, 1.0))
        yield S(a4, 0.8)

    def _op_halt(self, table, at, mark="?"):
        tbl = self.reg.get(table)
        order = self.objects.get(table, {}).get("order") or [r["id"] for r in tbl.meta["spec"]]
        if at not in order:
            raise ShotError(f"{self._lid}: halt「{at}」が objects.{table}.order に無い")
        _, i = self._row(f"{table}.{at}")
        cl = tbl.mob
        old = cl.marks[i]
        q = Text(mark, font_size=34, color=EXTERNAL)
        q.next_to(cl.rows[i], LEFT, buff=0.25)
        if self.overlay_state:
            q.set_z_index(11)
        # 「ここで止まり、その先は判定されない」を 1 つの変化として見せる: ✓ を ? に替えるのと同時に、
        # order で後ろの行の印を外す（間に「? なのに後ろは ✓」の状態を挟まない）
        anims = [ReplacementTransform(old, q) if old is not None else FadeIn(q, scale=1.3)]
        if old is not None:
            cl.remove(old)
        cl.marks[i] = q
        cl.add(q)
        for rid in order[order.index(at) + 1:]:
            _, j = self._row(f"{table}.{rid}")
            if cl.marks[j] is not None:
                anims.append(cl.clear(j))
        yield S(anims, 1.0)

    def _op_extract(self, id, to, keep=True, link=False, side="right", **kw):
        frm, as_text = kw.get("from"), kw.get("as")
        src = self.reg.get(frm)
        mob = src.mob.copy() if keep else src.mob
        tm = self._vis(to)
        tbox = getattr(tm, "box", tm)
        final = None
        if as_text:
            final = Text(as_text, font_size=NOTE, color=DATA)
            if getattr(tm, "title", None) is not None:
                final.scale_to_fit_width(min(final.width, tbox.width - 0.3))
                final.move_to(tbox.get_center() + DOWN * 0.14)
            else:
                self._place_near(final, tm, side)
        dest = mob.copy()
        if final is not None:
            dest.scale(1.15).move_to(final.get_right() + LEFT * dest.width * 0.6)
        else:
            dirs = {"right": RIGHT, "left": LEFT, "up": UP, "down": DOWN}
            dest.next_to(tbox, dirs.get(side, RIGHT), buff=0.35)
            self._clamp(dest)
        yield S([Transform(mob, dest)], 1.0)
        if final is not None:
            yield S([ReplacementTransform(mob, final)], 0.6)
            mob = final
        self.reg.put(id, mob, "extract")
        if link:
            ln = Line(mob.get_left() + LEFT * 0.05, tbox.get_right(), color=DATA, stroke_width=3)
            if side == "left":
                ln = Line(mob.get_right() + RIGHT * 0.05, tbox.get_left(), color=DATA, stroke_width=3)
            self.reg.put(id + ".link", ln, "link")
            yield S([Create(ln), Indicate(tbox, color=getattr(tm, "color", DATA), scale_factor=1.05)], 0.6)

    def _op_morph(self, to, **kw):
        frm = kw.get("from")
        src = self.reg.get(frm)
        if to in self.objects and self.objects[to]["type"] == "token":
            yield from self._op_token_show(to, **{"from": frm})
            return
        dst = self.reg.get(to)
        yield S([ReplacementTransform(src.mob, dst.mob)], 1.2)
        self.reg.drop(frm)

    def _text_of(self, e):
        m = e.mob
        if e.kind == "response":
            return m.label
        if e.kind == "node":
            return m[1][0]
        if isinstance(m, Text):
            return m
        texts = [t for t in m.get_family() if isinstance(t, Text)]
        if not texts:
            raise ShotError(f"{self._lid}: relabel「{e.id}」に文字が無い")
        return texts[0]

    def _op_relabel(self, target, text, color=None):
        e = self.reg.get(target)
        old = self._text_of(e)
        col = C(color) if color else _ink(old)
        new = Text(text, font_size=_fsize(old), color=col)
        new._eff_size = _fsize(old)
        if e.kind == "node":
            new.move_to(old)
        else:
            new.move_to(old).align_to(old, RIGHT if e.kind == "response" else LEFT)
        self._clamp(new)
        anims = [ReplacementTransform(old, new)]
        if e.kind == "response":
            e.mob.label = new
            if self.reg.has(target + ".label"):
                self.reg.e[target + ".label"].mob = new
            arrows = e.meta["arrows"]
            anims += [a.animate.set_color(col) for a in arrows]
            anims.append(_opacity_to(arrows, 1.0))
            e.dimmed = False
        elif isinstance(e.mob, Text):
            e.mob = new
        yield S(anims, 0.8)

    def _op_scan(self, probe, table, result="absent", at=None, text=None):
        tbl = self.reg.get(table)
        rows = self._table_visible_rows(tbl)
        z = 11 if self.overlay_state else 0
        size = rows[0][0].font_size if rows else BODY
        p = Text(probe, font_size=size, color=DATA).set_z_index(z)
        p.next_to(rows[0], LEFT, buff=1.0)
        self.reg.put(f"{table}.scan", p, "result", temp=True)
        self._temps.append(f"{table}.scan")
        yield S([FadeIn(p, shift=RIGHT * 0.2)], 0.5)
        stop = len(rows) if result == "absent" else [r for r in rows].index(self.reg.mob(f"{table}.{at}")) + 1
        for r in rows[1:stop]:
            yield S([p.animate.next_to(r, LEFT, buff=1.0)], 0.3)
        if result == "absent":
            yield S([p.animate.set_color(REMOVED)], 0.4)
            yield S([p.animate.next_to(rows[-1], DOWN, buff=0.5).align_to(rows[-1], LEFT)], 0.6)
            x = _cross().set_z_index(z).next_to(p, LEFT, buff=0.25)
            msg = Text(text or "入っていない", font_size=NOTE, color=REMOVED).set_z_index(z).next_to(p, RIGHT, buff=0.3)
            self.reg.put(f"{table}.scan.x", VGroup(x, msg), "result", temp=True)
            yield S([Create(x), FadeIn(msg)], 0.6)
        else:
            t = _tick().set_z_index(z).next_to(p, LEFT, buff=0.25)
            self.reg.put(f"{table}.scan.x", t, "result", temp=True)
            yield S([Create(t)], 0.6)

    # ================================================================ E 重ね
    def _op_overlay(self, target=None, table=None, rows=None, extra_rows=(), id=None):
        bd = backdrop()
        if target:
            e = self.reg.get(target)
            if e.kind != "table":
                raise ShotError(f"{self._lid}: overlay(target) は表だけ（それ以外は table/rows で写しを作る）")
            vis = self._table_visible_rows(e)
            b = _bbox(vis)
            w, h = b[2] - b[0] + 0.6, b[3] - b[1]
            k = min(1.6, 12.5 / w, 5.6 / max(h, 0.1))
            anims, undo = self._move_table(e, np.array([0.6, 0.6, 0]), k)
            e.mob.set_z_index(11)
            self.overlay_state = {"bd": bd, "target": e.id, "undo": undo, "front": [e.mob], "copy": None}
            yield S([FadeIn(bd), *anims], 1.0)
            return
        src = self.reg.get(table)
        spec = src.meta["spec"]
        chosen = [r for r in spec if rows is None or r["id"] in rows]
        merged = list(chosen)
        for x in extra_rows:
            pos = len(merged)
            if x.get("after"):
                pos = next((i + 1 for i, r in enumerate(merged) if r["id"] == x["after"]), pos)
            merged.insert(pos, x)
        cl = checklist([(r["key"], r["value"]) for r in merged], size=30)
        for r in cl.rows:
            r[1].set_color(DATA)
        if cl.width > 11:
            cl.scale_to_fit_width(11)
        cl.move_to([0.6, 0.7, 0]).set_z_index(11)
        nid = id or table + "_all"
        self.objects.setdefault(nid, {"type": "table", "rows": merged})
        self._register_table(nid, cl, merged, name=None)
        self.overlay_state = {"bd": bd, "target": None, "undo": None, "front": [cl], "copy": nid}
        yield S([FadeIn(bd)], 0.4)
        fam = self._fam()
        pairs = [(src.mob.rows[spec.index(r)], cl.rows[merged.index(r)]) for r in chosen
                 if src.mob.rows[spec.index(r)] in fam]
        yield S([TransformFromCopy(a, b) for a, b in pairs], 1.0)
        new = [cl.rows[i] for i, r in enumerate(merged) if not any(r is c for c in chosen)]
        if new:
            yield S([FadeIn(r, shift=DOWN * 0.1) for r in new], 0.5)

    def _op_overlay_end(self):
        st = self.overlay_state
        if not st:
            raise ShotError(f"{self._lid}: overlay_end の前に overlay が無い")
        anims = [FadeOut(st["bd"])]
        if st["copy"]:
            anims += self._hide_anims(st["copy"])
            self.reg.drop(st["copy"])
        if st["target"]:
            e = self.reg.get(st["target"])
            about, k, shift = st["undo"]
            anims += self._xform(e.mob, lambda m: m.shift(-shift).scale(1 / k, about_point=about))
        self.overlay_state = None
        yield S(anims, 0.8)
        if st["target"]:
            self.reg.get(st["target"]).mob.set_z_index(0)

    def _op_code(self, path, lines, highlight=(), caption=(), id="code"):
        if isinstance(lines, str):
            a, _, b = lines.partition("-")
            a, b = int(a), int(b or a)
        else:
            a, b = int(lines[0]), int(lines[-1])
        full = path if os.path.isabs(path) else os.path.join(self.workdir, path)
        panel = code_panel(full, a, b, highlight=list(highlight), clip=90)
        if isinstance(caption, (str, dict)):
            caption = [caption]  # 1 行の説明は文字列のままでも受け付ける（文字ごとに縦に並べない）
        caps = VGroup(*[label(c["text"], c.get("size", BODY), color=C(c.get("color", "ink")))
                        if isinstance(c, dict) else label(c, BODY) for c in caption])
        if len(caps):
            caps.arrange(DOWN, buff=0.15)
        room_h = 5.6 - (caps.height + 0.35 if len(caps) else 0)
        k = min(2.0, 12.0 / panel.width, room_h / panel.height)
        panel.scale(k)
        grp = VGroup(panel, caps) if len(caps) else VGroup(panel)
        if len(caps):
            caps.next_to(panel, DOWN, buff=0.35)
        grp.move_to([0, (SAFE[1] + SAFE[3]) / 2, 0])
        bd = backdrop(0.97)  # コードの裏の文字が透けないよう、表の重ねより濃くする
        grp.set_z_index(11)
        self.reg.put(id, panel, "code", temp=True, extras=[bd, caps])
        self._temps.append(id)
        # 暗幕を下ろし切ってからパネルを出す（同時に薄く重なると、背景の文字とコードが透けて重なって見える）
        yield S([FadeIn(bd)], 0.4)
        yield S([FadeIn(panel)], 0.6)
        if len(caps):
            yield S([FadeIn(caps, shift=UP * 0.1)], 0.6)

    def _op_code_move(self, lines, id="code"):
        panel = self.reg.mob(id)
        yield S([move_highlight(panel, *lines)], 0.8)

    def _op_screen(self, src, caption=None, id="screen", notes=()):
        """実際の画面（png）を暗幕の上に枠付きで出す。notes（画像上の相対位置 at と文字）は、画像の上に番号の丸を付け、
        右の列に同じ番号で並べる（文字を画像の上に重ねない）。hide するか、次の screen・次の章の頭で消える。"""
        path = os.path.join(self.workdir, src)
        if not os.path.exists(path):
            raise ShotError(f"{self._lid}: screen の src「{src}」が workdir に無い")
        for old in [e.id for e in self.reg.e.values() if e.kind == "screen"]:
            fades = self._hide_anims(old)
            self.reg.drop(old)
            if fades:
                yield S(fades, 0.4)
        img = ImageMobject(path)
        cap = label(caption, BODY) if caption else None
        room_h = (SAFE[3] - SAFE[1]) - 0.3 - (cap.height + 0.3 if cap else 0)
        room_w = 8.6 if notes else 12.6
        img.scale(min(room_w / img.width, room_h / img.height))
        top = SAFE[3] - 0.15
        img.move_to([(SAFE[0] + room_w / 2 + 0.1) if notes else 0, top - img.height / 2, 0])
        frame = SurroundingRectangle(img, buff=0.04, color=MUTED, stroke_width=2, corner_radius=0.04)
        if cap is not None:
            cap.next_to(frame, DOWN, buff=0.25)
        rings, rows = VGroup(), VGroup()
        ul = img.get_corner(UL)
        for i, nt in enumerate(notes or []):
            x, y = nt["at"]
            p = ul + np.array([x * img.width, -y * img.height, 0])
            ring = VGroup(Circle(radius=0.22, color=DATA, stroke_width=4).set_fill(BG, opacity=0.75).move_to(p),
                          Text(str(i + 1), font_size=SMALL, color=DATA).move_to(p))
            rings.add(ring)
            rows.add(VGroup(Text(str(i + 1), font_size=NOTE, color=DATA), Text(nt["text"], font_size=NOTE, color=INK))
                     .arrange(RIGHT, buff=0.2, aligned_edge=UP))
        if len(rows):
            rows.arrange(DOWN, aligned_edge=LEFT, buff=0.3)
            x0 = frame.get_right()[0] + 0.35
            if rows.width > SAFE[2] - x0:
                rows.scale_to_fit_width(SAFE[2] - x0)
            rows.move_to([x0 + rows.width / 2, img.get_y(), 0])
        bd = backdrop(0.97)
        for m in (img, frame, rings, rows) + ((cap,) if cap is not None else ()):
            m.set_z_index(11)
        self.reg.put(id, img, "screen", extras=[bd, frame] + ([cap] if cap is not None else []))
        for i, (ring, row) in enumerate(zip(rings, rows)):
            self.reg.put(f"{id}.n{i + 1}", VGroup(ring, row), "screennote")
        self._screens.append(id)
        yield S([FadeIn(bd)], 0.4)
        yield S([FadeIn(img), Create(frame)] + ([FadeIn(cap)] if cap is not None else []), 1.1)
        for ring, row in zip(rings, rows):
            yield S([Create(ring[0]), FadeIn(ring[1]), FadeIn(row, shift=LEFT * 0.1)], 0.6)

    # ================================================================ F 補助
    def _op_note(self, id, text, on, side="up", color="muted", link=False):
        tgt = self.reg.get(on)
        big = tgt.meta.get("stage_big")
        layer = "map" if tgt.layer == "map" and self.mode != "mini" else "stage"
        if tgt.layer == "map" and self.mode == "mini" and big is None:
            self._issue("E", "mini_text", f"mini 中に全体図の「{on}」へ注記「{text}」を出した")
        if _width_units(text) > 32:
            self._issue("W", "note_long", f"注記「{text}」が全角 16 字を超える")
        t = Text(text, font_size=NOTE, color=C(color, MUTED))
        if self.overlay_state:
            t.set_z_index(11)
        exclude = []
        fr = self.frame_of.get(on)
        if fr and self.reg.has(fr):
            exclude.append(self.reg.mob(fr).box)
        tm = big if big is not None else tgt.mob if tgt.kind != "response" else tgt.mob.label
        lead = self._place_near(t, tm, side, exclude=exclude, buff=0.55 if link else 0.15)
        if lead is None and link and side != "in":
            # 対象と点線で結ぶ（向かい合う辺の中点どうし）
            p0, p1 = _facing_points(t, getattr(tm, "box", tm))
            lead = DashedLine(p0, p1, color=C(color, MUTED), stroke_width=1.5, dash_length=0.06, buff=0.08)
        self.reg.put(id, t, "note", layer=layer, on=on, extras=[lead] if lead is not None else [])
        anims = [FadeIn(t, shift=DOWN * 0.1)]
        if lead is not None:
            anims.append(Create(lead))
        yield S(anims, 0.6)

    def _op_hide(self, ids):
        anims = []
        for i in ids:
            if self.overlay_state and self.overlay_state.get("target") == i:
                raise ShotError(f"{self._lid}: overlay 中の「{i}」は hide できない（overlay_end の後に）")
            anims += self._hide_anims(i)
        for i in ids:
            self.reg.drop(i)
        yield S(anims, 0.5)

    def _op_dim(self, ids):
        mobs = []
        for i in ids:
            mobs += self._shown_parts(i)
            self.reg.get(i).dimmed = True
        yield S([dim(*mobs)] if mobs else [], 0.6)

    def _op_undim(self, ids):
        mobs = []
        for i in ids:
            mobs += self._shown_parts(i)
            for k in self.reg.family_ids(i):
                self.reg.e[k].dimmed = False
        yield S([undim(*mobs)] if mobs else [], 0.6)

    def _op_emphasize(self, id, mark=True, color="ink"):
        e = self.reg.get(id)
        anims = [e.mob.animate.set_color(C(color))]
        yield S(anims, 0.4)
        if mark:
            yield from self._op_mark(id, color=color)

    def _op_mark(self, id, color="data"):
        e = self.reg.get(id)
        vm = self._vis(id)
        m = globals()["mark"](getattr(vm, "box", vm), color=C(color))
        self.reg.put(id + ".mark", m, "mark", layer=e.layer)
        yield S([Create(m)], 0.6)

    def _op_badge(self, text):
        new = label(text, BODY).to_corner(UR, buff=0.3)
        if self.reg.has("badge") and self._shown("badge"):
            old = self.reg.get("badge")
            yield S([ReplacementTransform(old.mob, new)], 0.6)
            old.mob = new
            return
        self.reg.put("badge", new, "badge")
        yield S([FadeIn(new)], 0.6)

    def _op_wait(self, sec=1.0):
        yield S([], float(sec))

    def _op_custom(self, fn, uses=()):
        self._call_custom(fn)
        return
        yield
