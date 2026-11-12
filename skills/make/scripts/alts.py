#!/usr/bin/env python3
"""スライドの複数案を作り、スライドコンテで見比べ、選んだ案を台本と構成メモに入れる。

  python3 alts.py new <workdir> <組の名前> --replaces <スライドの id,…> --options <案の名前,…> [--keep-current]
      案ごとに、今の台本の写し <workdir>/storyboard.<組>-<案>.json を作り、<workdir>/alts.json に組を足す。
      --replaces は、今の台本で続いて出るスライド（1 枚以上）。案は 2〜4 つ。ページには「案 A」「案 B」… の名前で出る。
      --keep-current を付けると、最初の案は今の台本そのもの（写しを作らない）。書いた台本のパスを 1 行ずつ出す。
      この後、案の台本を書き換え、alts.json の案に diff（違いの 1 行）と、スライドを変えたなら slides（id・intent・link）を書く。
  python3 alts.py frames <workdir> [--theme <名前|パス>]
      全部の案について、案のスライドを使う場面のコマを書く（frames.cjs --scenes）。今の台本の案は <workdir>/frames を使う（なければ書く）。
      この後、build_sheet.py --alts <workdir>/alts.json でスライドコンテに並べる。
  python3 alts.py pick <workdir> <組の名前> <案の名前（b か「案 B」）>
      選んだ案を、今の台本（置き換える範囲の場面とスライド）と構成メモ（その範囲のスライドと意図）に入れ、その組を片付ける。
      案の場面や行の id が範囲の外と重なる、入れた後の台本に誤りがある、ときは何も書かずに止まる。
      声には触らない（合成した後に選んだら、入れ替わった行のために tts.py を回し直す）。
  python3 alts.py drop <workdir> <組の名前>
      選ばずに、その組を片付ける。

alts.json（パスは作業フォルダからの相対）:
  {"groups": [{"id": "g1", "replaces": ["definitions"], "options": [
     {"key": "a", "name": "案 A", "diff": "…", "storyboard": "storyboard.json", "frames": "frames"},
     {"key": "b", "name": "案 B", "diff": "…", "storyboard": "storyboard.g1-b.json", "frames": "alts/g1/b/frames",
      "slides": [{"id": "def-usability", "intent": "…", "link": "…"}, …]}]}]}
  slides を省いた案は、replaces と同じ id のスライドを書き換えた案（意図は構成メモのまま）。

終了コード: 0 = できた、1 = 案を入れられない、2 = 使い方の誤りかファイルがない。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_sheet  # noqa: E402
import check_outline  # noqa: E402

NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


class Usage(Exception):
    pass


class Reject(Exception):
    pass


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _paths(wd):
    return os.path.join(wd, "storyboard.json"), os.path.join(wd, "alts.json")


def _storyboard(wd):
    sb_path, _ = _paths(wd)
    if not os.path.isfile(sb_path):
        raise Usage(f"台本がない: {sb_path}")
    return _load(sb_path)


def _alts(wd):
    _, path = _paths(wd)
    if not os.path.isfile(path):
        raise Usage(f"案の一覧がない: {path}（alts.py new で作る）")
    data = _load(path)
    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        raise Usage(f"{path} に groups がない")
    return data


def _group(data, gid):
    for g in data["groups"]:
        if isinstance(g, dict) and g.get("id") == gid:
            return g
    raise Usage(f"案の組「{gid}」が alts.json にない")


def _range(sb, reps, where):
    """置き換えるスライドを使う場面の添字（続いていること）"""
    order = [sc.get("slide") for sc in sb.get("scenes") or []]
    for sid in reps:
        if sid not in (sb.get("slides") or {}) or sid not in order:
            raise Usage(f"{where}: スライド「{sid}」が台本にない（場面が使っているスライドを書く）")
    idx = [i for i, sl in enumerate(order) if sl in reps]
    if idx[-1] - idx[0] + 1 != len(idx):
        raise Usage(f"{where}: 置き換えるスライド（{'・'.join(reps)}）の場面が続いていない")
    return idx


def _is_current(opt):
    return opt.get("storyboard") == "storyboard.json"


def _cleanup(wd, data, g):
    """組を片付ける: 案の台本、alts/<組>/、alts.json の組。組がなくなれば alts.json と alts/ も消す"""
    for o in g.get("options") or []:
        if not _is_current(o) and isinstance(o.get("storyboard"), str):
            p = os.path.join(wd, o["storyboard"])
            if os.path.isfile(p):
                os.remove(p)
    shutil.rmtree(os.path.join(wd, "alts", g["id"]), ignore_errors=True)
    data["groups"] = [x for x in data["groups"] if x is not g]
    _, path = _paths(wd)
    if data["groups"]:
        _dump(data, path)
    else:
        os.remove(path)
        if os.path.isdir(os.path.join(wd, "alts")) and not os.listdir(os.path.join(wd, "alts")):
            os.rmdir(os.path.join(wd, "alts"))


def cmd_new(a):
    sb = _storyboard(a.workdir)
    reps = [x for x in a.replaces.split(",") if x]
    keys = [x for x in a.options.split(",") if x]
    if not NAME_RE.match(a.group):
        raise Usage("組の名前は英数字・_・- で書く")
    if not reps:
        raise Usage("--replaces に、置き換えるスライドの id を書く")
    if not 2 <= len(keys) <= 4 or len(set(keys)) != len(keys) or any(not NAME_RE.match(k) for k in keys):
        raise Usage("案は 2〜4 つ。名前は英数字・_・- で、重ならないように書く")
    _range(sb, reps, f"案の組「{a.group}」")
    _, path = _paths(a.workdir)
    data = _load(path) if os.path.isfile(path) else {"groups": []}
    for g in data.get("groups") or []:
        if g.get("id") == a.group:
            raise Usage(f"案の組「{a.group}」は、もうある")
        if set(g.get("replaces") or []) & set(reps):
            raise Usage(f"スライド「{'・'.join(sorted(set(g['replaces']) & set(reps)))}」は、案の組「{g['id']}」にも入っている")
    options = []
    for i, k in enumerate(keys):
        name = f"案 {chr(ord('A') + i)}"
        if i == 0 and a.keep_current:
            options.append({"key": k, "name": name, "diff": "", "storyboard": "storyboard.json", "frames": "frames"})
            continue
        rel = f"storyboard.{a.group}-{k}.json"   # 今の台本と同じフォルダに置く（画像の相対パスと、構成メモが決めたテーマがそのまま効く）
        _dump(sb, os.path.join(a.workdir, rel))
        options.append({"key": k, "name": name, "diff": "", "storyboard": rel, "frames": f"alts/{a.group}/{k}/frames"})
        print(os.path.join(a.workdir, rel))
    data.setdefault("groups", []).append({"id": a.group, "replaces": reps, "options": options})
    _dump(data, path)
    return 0


def _option_slides(g, opt):
    sl = opt.get("slides")
    return [x["id"] for x in sl] if isinstance(sl, list) and sl else list(g["replaces"])


def cmd_frames(a):
    data = _alts(a.workdir)
    frames_cjs = os.path.join(HERE, "frames.cjs")
    theme = ["--theme", a.theme] if a.theme else []
    for g in data["groups"]:
        for o in g.get("options") or []:
            sb_path = os.path.join(a.workdir, o["storyboard"])
            out = os.path.join(a.workdir, o["frames"])
            if not os.path.isfile(sb_path):
                raise Usage(f"案「{o.get('name')}」の台本がない: {sb_path}")
            sb = _load(sb_path)
            if _is_current(o):
                try:   # 今の台本のコマが今のものなら、そのまま使う
                    build_sheet._load_frames(out, sb)
                    continue
                except (OSError, ValueError):
                    scenes = []
            else:
                ids = _option_slides(g, o)
                scenes = [sc["id"] for sc in sb.get("scenes") or [] if sc.get("slide") in ids]
                if not scenes:
                    raise Usage(f"案「{o.get('name')}」の台本に、スライド（{'・'.join(ids)}）を使う場面がない。alts.json の slides を、案の台本に合わせる")
            cmd = ["node", frames_cjs, sb_path, "-o", out, *theme] + (["--scenes", ",".join(scenes)] if scenes else [])
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode not in (0, 4):   # 4 = PNG なし（SVG と frames.json は書けている）
                print(f"案「{o.get('name')}」のコマを書けない（組「{g['id']}」）:\n{r.stdout}{r.stderr}", file=sys.stderr)
                return 1
            print(f"{g['id']} / {o.get('name')}: {out}")
    return 0


def _find_option(g, name):
    for o in g.get("options") or []:
        if name in (o.get("key"), o.get("name")):
            return o
    raise Usage(f"案「{name}」が、組「{g['id']}」にない（{'・'.join(str(o.get('name')) for o in g.get('options') or [])}）")


def _merge(sb, osb, g, opt):
    """今の台本 sb の、置き換える範囲（g の replaces）を、案の台本 osb のものに入れ替えた台本を返す"""
    reps = g["replaces"]
    idx = _range(sb, reps, f"案の組「{g['id']}」")
    ids = _option_slides(g, opt)
    for sid in ids:
        if sid not in (osb.get("slides") or {}):
            raise Reject(f"スライド「{sid}」が、案「{opt.get('name')}」の台本にない")
    new_scenes = [sc for sc in osb.get("scenes") or [] if sc.get("slide") in ids]
    if not new_scenes:
        raise Reject(f"案「{opt.get('name')}」の台本に、スライド（{'・'.join(ids)}）を使う場面がない")
    keep = [sc for i, sc in enumerate(sb["scenes"]) if i not in idx]
    scene_ids = {sc.get("id") for sc in keep}
    line_ids = {ln.get("id") for sc in keep for ln in sc.get("lines") or []}
    for sc in new_scenes:
        if sc.get("id") in scene_ids:
            raise Reject(f"案の場面の id「{sc.get('id')}」が、置き換える範囲の外の場面と重なる")
        for ln in sc.get("lines") or []:
            if ln.get("id") in line_ids:
                raise Reject(f"案の行の id「{ln.get('id')}」が、置き換える範囲の外の行と重なる")
    out = dict(sb)
    out["scenes"] = sb["scenes"][:idx[0]] + new_scenes + sb["scenes"][idx[-1] + 1:]
    slides, done = {}, False
    for sid, sl in (sb.get("slides") or {}).items():   # 置き換えるスライドの位置に、案のスライドを並べる
        if sid in reps:
            if not done:
                for nid in ids:
                    slides[nid] = osb["slides"][nid]
                done = True
        elif sid not in ids:
            slides[sid] = sl
    out["slides"] = slides
    figures = dict(sb.get("figures") or {})
    for nid in ids:   # 案のスライドが figure で指す図は、案の台本のものを写す
        for p in osb["slides"][nid].get("parts") or []:
            fid = p.get("figure") if isinstance(p, dict) else None
            if fid is not None and fid in (osb.get("figures") or {}):
                figures[fid] = osb["figures"][fid]
    if figures or "figures" in sb:
        out["figures"] = figures
    return out


def _merge_outline(outline, g, opt):
    """構成メモ（/2）の、置き換える範囲のスライドを、案のスライドと意図に入れ替える。変えなければ None"""
    sl = opt.get("slides")
    if check_outline.version(outline) != 2 or not (isinstance(sl, list) and sl):
        return None
    for x in sl:
        if not isinstance(x.get("intent"), str) or not x["intent"].strip():
            raise Reject(f"案「{opt.get('name')}」のスライド「{x.get('id')}」に intent がない（alts.json の slides に意図を書く）")
    item = lambda text: {"text": text, "by": "claude", "state": "agreed"}   # 利用者が案を選んだので、合意済み
    new = [{"id": x["id"], "intent": item(x["intent"]), **({"link": item(x["link"])} if isinstance(x.get("link"), str) and x["link"].strip() else {})} for x in sl]
    out = json.loads(json.dumps(outline))
    placed = False
    for ch in out.get("chapters") or []:
        cur = ch.get("slides") if isinstance(ch.get("slides"), list) else []
        if not any(isinstance(s, dict) and s.get("id") in g["replaces"] for s in cur):
            continue
        res = []
        for s in cur:
            if isinstance(s, dict) and s.get("id") in g["replaces"]:
                if not placed:
                    res.extend(new)
                    placed = True
            else:
                res.append(s)
        ch["slides"] = res
    if not placed:   # 構成メモにまだ書いていなかったスライド: 最初に使う場面の章に足す
        return None
    return out


def cmd_pick(a):
    data = _alts(a.workdir)
    g = _group(data, a.group)
    opt = _find_option(g, a.name)
    sb_path, _ = _paths(a.workdir)
    if _is_current(opt):
        _cleanup(a.workdir, data, g)
        print(f"今の台本のまま（{opt.get('name')}）。組「{g['id']}」を片付けた")
        return 0
    sb = _storyboard(a.workdir)
    opt_path = os.path.join(a.workdir, opt["storyboard"])
    if not os.path.isfile(opt_path):
        raise Usage(f"案「{opt.get('name')}」の台本がない: {opt_path}")
    try:
        merged = _merge(sb, _load(opt_path), g, opt)
        outline_path = os.path.join(a.workdir, "outline.json")
        new_outline = _merge_outline(_load(outline_path), g, opt) if os.path.isfile(outline_path) else None
    except Reject as e:
        print(f"案を入れられない: {e}", file=sys.stderr)
        return 1
    # 入れた後の台本の形を確かめてから書く（台本と同じフォルダに仮のファイルを置く。画像の相対パスのため）
    tmp = os.path.join(a.workdir, "storyboard.pick-check.json")
    _dump(merged, tmp)
    try:
        r = subprocess.run(["node", os.path.join(HERE, "check_storyboard.cjs"), tmp, "--json"], capture_output=True, text=True)
        try:
            errors = json.loads(r.stdout).get("errors")
        except ValueError:
            errors = [(r.stdout + r.stderr).strip() or "check_storyboard.cjs が結果を返さない"]
    finally:
        os.remove(tmp)
    if errors:
        print("案を入れられない: 入れた後の台本に誤りがある", file=sys.stderr)
        for e in errors:
            print("  " + str(e), file=sys.stderr)
        return 1
    _dump(merged, sb_path)
    if new_outline is not None:
        _dump(new_outline, outline_path)
    _cleanup(a.workdir, data, g)
    print(f"{opt.get('name')} を台本{'と構成メモ' if new_outline is not None else ''}に入れ、組「{g['id']}」を片付けた。frames.cjs を回し直す")
    return 0


def cmd_drop(a):
    data = _alts(a.workdir)
    g = _group(data, a.group)
    _cleanup(a.workdir, data, g)
    print(f"組「{g['id']}」を片付けた")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new")
    p.add_argument("workdir"); p.add_argument("group")
    p.add_argument("--replaces", required=True); p.add_argument("--options", required=True)
    p.add_argument("--keep-current", action="store_true")
    p.set_defaults(fn=cmd_new)
    p = sub.add_parser("frames")
    p.add_argument("workdir"); p.add_argument("--theme")
    p.set_defaults(fn=cmd_frames)
    p = sub.add_parser("pick")
    p.add_argument("workdir"); p.add_argument("group"); p.add_argument("name")
    p.set_defaults(fn=cmd_pick)
    p = sub.add_parser("drop")
    p.add_argument("workdir"); p.add_argument("group")
    p.set_defaults(fn=cmd_drop)
    a = ap.parse_args(argv)
    try:
        return a.fn(a)
    except Usage as e:
        print(f"alts.py: {e}", file=sys.stderr)
        return 2
    except (OSError, ValueError) as e:
        print(f"alts.py: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
