#!/usr/bin/env python3
"""作業フォルダを作り、公開先を記録し、過去の作業フォルダを一覧する。作業フォルダは題材の外（ユーザーの作業ツリーの外）に置く。

使い方:
  python3 workdir.py new <題材の短い名前> [--home DIR]
  python3 workdir.py publish <作業フォルダ> --url <Artifact の URL> [--title <題>] [--theme <テーマ>] [--source <題材の場所>]
  python3 workdir.py list [--home DIR] [--json]

new: 作業フォルダを作る。
  --home 置き場。省くと UZ_RUNS_HOME → ${CLAUDE_PLUGIN_DATA}/runs → ~/.cache/ugoku-zukai/runs の順
作るフォルダは <置き場>/<YYYYMMDD-HHMM>-<短い名前>。英数字と - 以外は - にし、続く - は 1 つにまとめ、
頭と終わりの - は落とす。日本語だけで空になるときは run。同じ名前があれば -2 -3…を付ける。
作ったら sources/ と review/ を作り、フォルダのパスを 1 行で出す。

publish: 公開先を <作業フォルダ>/published.json に記録する（別のセッションから直すときに読む）。公開し直すたびに呼ぶ。
  { format, title, url, theme, source, first, last, count }。--title を省くと台本の題。--theme と --source は、
  省くと前の値を残す。呼ぶたびに count を 1 増やし、last を今にする。URL が前と違えば、書き換えて知らせる。

list: 過去の作業フォルダ（名前が <8 桁>-<4 桁>-… のフォルダ）を新しい順に出す。1 件 2 行（名前・題・公開の状態、パス・テーマ・題材）。
  --home を省くと、UZ_RUNS_HOME、${CLAUDE_PLUGIN_DATA}/runs、${CLAUDE_PLUGIN_DATA} の隣にある ugoku-zukai* の runs、
  ~/.claude/plugins/data/ugoku-zukai*/runs、~/.cache/ugoku-zukai/runs を合わせて探す（プラグインの入れ方が変わると置き場が変わるため）。--json は配列で出す。

終了コード: 0、2 = 使い方の誤り・作業フォルダや台本がない（何も書かない）、4 = 書けない

作業フォルダの中身（SKILL.md と各エージェントはこの名前で読み書きする）:
  brief.md         取材メモ（調べたことと、その出どころ。researcher か進行役が書く）
  sources/         取材で集めた一次資料の写し・要約
  outline.json     構成メモ（利用者と合意したことの記録。references/outline.md）
  storyboard.json  台本
  theme.json       デザインから作ったテーマ（デザインを渡されたときだけ）
  review/          評価役の出力（<連番>-<target>/）と、指摘の一覧 ledger.json、残論点 residual.md
  frames/          各行の落ち着いたコマ（SVG・PNG のシートと frames.json）
  sheet.html       利用者向けの絵コンテのページ（build_sheet.py）
  frames-part/・sheet-part.html  一部の場面だけのコマと絵コンテ（frames.cjs --scenes）
  preview.html     声なしの粗い再生ページ
  voice/           tts.py の出力（timeline.json・narration.mp3・readings.md）。voice/audition.html は声の試聴のページ
  voice_dict.json  この動画だけの読みの辞書（読みの指摘を直すときに足す）
  player.html      組み立てた再生ページ
  published.json   公開先の記録（workdir.py publish。Claude Code で、別のセッションから直すときに読む）
"""
import argparse
import datetime
import json
import os
import re
import sys


def default_home():
    if os.environ.get("UZ_RUNS_HOME"):
        return os.environ["UZ_RUNS_HOME"]
    if os.environ.get("CLAUDE_PLUGIN_DATA"):
        return os.path.join(os.environ["CLAUDE_PLUGIN_DATA"], "runs")
    return os.path.join(os.path.expanduser("~"), ".cache", "ugoku-zukai", "runs")


def slug(name):
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")[:40].rstrip("-")
    return s or "run"


def make(home, name, now=None):
    now = now or datetime.datetime.now()
    stamp = now if isinstance(now, str) else f"{now:%Y%m%d-%H%M}"
    base = f"{stamp}-{slug(name)}"
    os.makedirs(home, exist_ok=True)
    n = 1
    while True:
        path = os.path.join(home, base if n == 1 else f"{base}-{n}")
        try:
            os.mkdir(path)  # 既にあれば失敗する（競合しても上書きしない）
            break
        except FileExistsError:
            n += 1
    for sub in ("sources", "review"):
        os.mkdir(os.path.join(path, sub))
    return os.path.abspath(path)


FORMAT = "ugoku-zukai-published/1"
STAMP = re.compile(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-.+")


class Refuse(Exception):
    """使い方の誤り。何も書き換えずに終了コード 2 で止まる"""


def homes(explicit=None):
    """作業フォルダを探す置き場の候補（重複なし。ないものも含む）。explicit があればそこだけ"""
    if explicit:
        return [os.path.abspath(explicit)]
    cands = []
    if os.environ.get("UZ_RUNS_HOME"):
        cands.append(os.environ["UZ_RUNS_HOME"])
    data = os.environ.get("CLAUDE_PLUGIN_DATA")
    if data:
        cands.append(os.path.join(data, "runs"))
        # プラグインの入れ方が変わると ${CLAUDE_PLUGIN_DATA} の名前が変わるので、隣の ugoku-zukai* も見る
        parent = os.path.dirname(os.path.abspath(data).rstrip(os.sep))
        if os.path.isdir(parent):
            cands += [os.path.join(parent, n, "runs") for n in sorted(os.listdir(parent)) if n.startswith("ugoku-zukai")]
    # 環境変数のないセッション（プラグインを読み込んでいない）からも、プラグインの置き場で作ったものを探す
    plugin_data = os.path.join(os.path.expanduser("~"), ".claude", "plugins", "data")
    if os.path.isdir(plugin_data):
        cands += [os.path.join(plugin_data, n, "runs") for n in sorted(os.listdir(plugin_data)) if n.startswith("ugoku-zukai")]
    cands.append(os.path.join(os.path.expanduser("~"), ".cache", "ugoku-zukai", "runs"))
    out, seen = [], set()
    for c in cands:
        real = os.path.realpath(c)
        if real not in seen:
            seen.add(real)
            out.append(os.path.abspath(c))
    return out


def read_record(workdir):
    """published.json を読む。ない・読めない・形が違うときは None"""
    try:
        with open(os.path.join(workdir, "published.json"), encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict) or rec.get("format") != FORMAT or not isinstance(rec.get("url"), str):
        return None
    return rec


def _title(workdir):
    """台本の題。台本がなければ (None, False)、読めなければ (None, True)"""
    path = os.path.join(workdir, "storyboard.json")
    if not os.path.isfile(path):
        return None, False
    try:
        with open(path, encoding="utf-8") as f:
            sb = json.load(f)
    except (OSError, ValueError):
        return None, True
    if not isinstance(sb, dict):
        return None, True
    t = sb.get("title")
    return (t if isinstance(t, str) and t else None), False


def record(workdir, url, title=None, theme=None, source=None, now=None):
    """公開先を published.json に書いて、書いた中身を返す。作業フォルダや台本がない・URL がおかしいときは Refuse"""
    if not os.path.isdir(workdir):
        raise Refuse(f"作業フォルダがない: {workdir}")
    if not os.path.isfile(os.path.join(workdir, "storyboard.json")):
        raise Refuse(f"作業フォルダに台本（storyboard.json）がない: {workdir}")
    if not url or re.search(r"\s", url):
        raise Refuse("--url が空か、空白を含んでいる")
    old = read_record(workdir) or {}
    now = now or datetime.datetime.now().isoformat(timespec="seconds")
    count = old.get("count")
    rec = {
        "format": FORMAT,
        "title": title or _title(workdir)[0] or old.get("title") or "動く図解",
        "url": url,
        "theme": theme if theme is not None else old.get("theme"),
        "source": source if source is not None else old.get("source"),
        "first": old.get("first") or now,
        "last": now,
        "count": (count if isinstance(count, int) else 0) + 1,
    }
    with open(os.path.join(workdir, "published.json"), "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return rec


def runs(home_list):
    """置き場にある作業フォルダを新しい順に返す。壊れたファイルがあっても止まらず、unreadable に名前を入れる"""
    rows = []
    for home in home_list:
        if not os.path.isdir(home):
            continue
        for name in os.listdir(home):
            m = STAMP.match(name)
            path = os.path.join(home, name)
            if not m or not os.path.isdir(path):
                continue
            unreadable = []
            title, broken = _title(path)
            if broken:
                unreadable.append("storyboard.json")
            pub = read_record(path)
            if pub is None and os.path.exists(os.path.join(path, "published.json")):
                unreadable.append("published.json")
            has = {"outline": "outline.json", "storyboard": "storyboard.json", "voice": os.path.join("voice", "timeline.json"), "player": "player.html"}
            rows.append({
                "path": os.path.abspath(path), "name": name,
                "made": "{}-{}-{} {}:{}".format(*m.groups()),
                "title": title or (pub or {}).get("title"),
                "has": {k: os.path.isfile(os.path.join(path, v)) for k, v in has.items()},
                "published": pub, "unreadable": unreadable,
            })
    return sorted(rows, key=lambda r: (r["name"], r["path"]), reverse=True)


HAS_LABEL = (("outline", "構成メモ"), ("storyboard", "台本"), ("voice", "声"), ("player", "再生ページ"))


def show(rows):
    """一覧を文字で出す。1 件 2 行（名前・題・公開の状態、パス・テーマ・題材）"""
    out = []
    for r in rows:
        pub = r["published"]
        if pub:
            last = str(pub.get("last") or "").replace("T", " ")[:16]
            state = f"公開 {pub.get('count', 1)} 回（最後 {last}）　{pub['url']}"
        else:
            have = "・".join(label for k, label in HAS_LABEL if r["has"][k])
            state = f"未公開（{'あるもの: ' + have if have else 'まだ何もない'}）"
        out.append(f"{r['name']}　{r['title'] or '（題なし）'}　{state}")
        second = [r["path"]]
        if pub and pub.get("theme"):
            second.append(f"テーマ {pub['theme']}")
        if pub and pub.get("source"):
            second.append(f"題材 {pub['source']}")
        if r["unreadable"]:
            second.append(f"（読めないファイル: {'、'.join(r['unreadable'])}）")
        out.append("  " + "　".join(second))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="作業フォルダを作り、公開先を記録し、過去の作業フォルダを一覧する")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("new", help="作業フォルダを作ってパスを出す")
    p.add_argument("name", help="題材の短い名前")
    p.add_argument("--home", help="置き場（省くと UZ_RUNS_HOME → ${CLAUDE_PLUGIN_DATA}/runs → ~/.cache/ugoku-zukai/runs）")
    p.add_argument("--now", help=argparse.SUPPRESS)  # 試験用: 時刻の部分 YYYYMMDD-HHMM を固定する
    p = sp.add_parser("publish", help="公開先を作業フォルダに記録する")
    p.add_argument("workdir", help="作業フォルダ")
    p.add_argument("--url", required=True, help="公開した Artifact の URL")
    p.add_argument("--title", help="題（省くと台本の題）")
    p.add_argument("--theme", help="組み立てに使ったテーマ（省くと前の値を残す）")
    p.add_argument("--source", help="題材の場所（省くと前の値を残す）")
    p.add_argument("--now", help=argparse.SUPPRESS)  # 試験用: 記録する時刻（ISO）を固定する
    p = sp.add_parser("list", help="過去の作業フォルダを新しい順に出す")
    p.add_argument("--home", help="この置き場だけを探す")
    p.add_argument("--json", action="store_true", help="配列で出す")
    a = ap.parse_args()
    try:
        if a.cmd == "new":
            print(make(a.home or default_home(), a.name, a.now))
        elif a.cmd == "publish":
            old = read_record(a.workdir)
            rec = record(a.workdir, a.url, a.title, a.theme, a.source, a.now)
            if old and old["url"] != rec["url"]:
                print(f"公開先が変わった（前: {old['url']}）")
            print(f"記録した: {os.path.join(os.path.abspath(a.workdir), 'published.json')}（公開 {rec['count']} 回目）")
        else:
            places = homes(a.home)
            rows = runs(places)
            if a.json:
                print(json.dumps(rows, ensure_ascii=False, indent=1))
            elif rows:
                print(show(rows))
            else:
                print(f"作業フォルダがない（探した場所: {'、'.join(places)}）")
    except Refuse as e:
        print(f"workdir: {e}", file=sys.stderr)
        sys.exit(2)
    except OSError as e:
        print(f"workdir: 書けない（{e}）", file=sys.stderr)
        sys.exit(4)


if __name__ == "__main__":
    main()
