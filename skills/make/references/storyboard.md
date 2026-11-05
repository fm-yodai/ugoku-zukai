# 台本の形式（ugoku-zukai/2）

台本 `storyboard.json` は「どの図を出し、ナレーションのどの語でどう動かすか」を書く。座標や秒は書かない。配置はプレーヤーが ELK などで決め、時刻は字幕の文中の印と音声の時刻表で決まる。評価役は台本だけを読んで「何を見せるか」を照合できる。

見本は `examples/`（業務の流れ・状態遷移・シーケンス図・箇条/比較/表・2 つの図と下の層）。書いたら必ず検査する:

```bash
node scripts/check_storyboard.cjs storyboard.json --theme 3b1b     # 形・id・経路・配置
python3 scripts/build_player.py storyboard.json -o preview.html     # 音声なしの下見
```

## 目次

1. 全体の形
2. 図（figures）の種類
3. 場面と行（scenes / lines）
4. 文中の印と時刻
5. 動作（do）の一覧
6. 下の層（canvas・move・custom）
7. 検査が見ること

## 1. 全体の形

```json
{
  "format": "ugoku-zukai/2",
  "title": "経費精算の承認ルート",
  "voice": { "speaker": 3, "speed": 1.1 },
  "credit": "VOICEVOX:ずんだもん",
  "figures": { "flow": { "type": "graph", ... } },
  "scenes": [ { "id": "s1", "figure": "flow", "lines": [ ... ] } ],
  "custom": { "ring": "({ g, p, el, S, area }) => { ... }" }
}
```

- `credit` を省くと「VOICEVOX:ずんだもん」。画面の右下と終わりの札に出る
- id には英数字・`_`・`-`・`.`・かな漢字が使える。`/` `:` 空白は使えない（`図/id` の区切りに使うため）

## 2. 図（figures）の種類

図は `figures` に名前を付けて宣言し、場面から参照する。同じ図を続く場面で使うと、出した部品はそのまま残る。

| type | 用途 | 部品の id（動作の対象） |
|---|---|---|
| `title` | 問い・章の扉。場面の頭で自動で出る | `text` `sub` |
| `list` | 箇条（困りごと・要点） | 各項目の `id` |
| `compare` | 2〜4 案の比較カード | カードの `id`、点は `カード.1` `カード.2`…（または点の `id`） |
| `table` | 表 | 行の `id`（行の全セル）、列の `id`（列の全セル）、セル `行.列`、見出し `header` |
| `sequence` | シーケンス図 | 参加者の `id`、メッセージの `id`（省くと `m1` `m2`…） |
| `graph` | 箱と矢印（構成・業務の流れ・状態遷移） | ノードの `id`、辺 `出発>到着`（または辺の `id`）、グループの `id` |
| `canvas` | 下の層。座標で図形を置く（6 章） | 図形の `id` |

図の `title` は章の題（画面の左上）になる。場面に `title` があればそちらが章の題になり、図の題は図の上に小さく出る。

### title

```json
{ "type": "title", "text": "経費の申請は、誰の手を通って\n経理に届くのでしょうか", "sub": "金額で変わる承認ルート" }
```

### list

```json
{ "type": "list", "title": "いまの困りごと", "numbered": true,
  "items": [ { "id": "i1", "text": "紙の領収書を毎月まとめて提出している", "sub": "月末に経理の作業が集中する" } ] }
```

8 個までにする（多いと読み切れない）。

### compare

```json
{ "type": "compare", "title": "二つの案", "items": [
  { "id": "a", "label": "A案 クラウドの精算サービス", "role": "actor",
    "points": [ { "text": "スマホで撮って申請", "kind": "pro" }, { "text": "月額の費用", "kind": "con" } ] } ] }
```

`kind` は `pro`（✓）・`con`（✗）・`plain`（・）。

### table

```json
{ "type": "table", "title": "困りごとへの効き方",
  "columns": [ { "id": "issue", "label": "困りごと" }, { "id": "a", "label": "A案" } ],
  "rows": [ { "id": "r1", "cells": ["紙の提出", { "text": "なくなる", "mark": "check" }] } ] }
```

セルは文字か `{ "text", "mark": "check" | "cross" | "question" }`。`mark` は行が出るときに一緒に出る。後から付けるなら動作の `mark` を使う。`cells` は列の順の配列か、`{ 列id: 値 }`。

### sequence

```json
{ "type": "sequence", "participants": [ { "id": "staff", "label": "社員", "role": "actor" } ],
  "messages": [ { "id": "m1", "from": "staff", "to": "app", "label": "出勤を打刻" },
                { "id": "m4", "from": "kintai", "to": "app", "label": "受け付けた", "reply": true } ] }
```

メッセージは宣言の順に上から 1 段ずつ並ぶ。`from` と `to` が同じなら自分への矢印。`reply: true` は破線の戻り。

### graph

```json
{ "type": "graph", "direction": "right",
  "nodes": [ { "id": "sys", "label": "入力チェック", "role": "process", "sub": "金額・領収書", "shape": "box" } ],
  "groups": [ { "id": "approvers", "label": "承認者", "members": ["kacho", "bucho"], "style": "frame" } ],
  "edges": [ { "from": "app", "to": "sys", "label": "申請を送る", "style": "solid" } ] }
```

- `role`（色）: `actor` `process` `store` `external` `muted` `added` `removed`（と `good` `bad` `warn` `accent`）
- `shape`: `box`（既定）・`round`（状態遷移の角丸）・`store`（円筒。`role: "store"` の既定）
- `groups.style`: `frame`（囲む枠。既定）か `band`（層の帯。ブラウザ / API / データ のような区分）
- `direction`: `right`（既定）か `down`。省くと両方を試し、大きく描ける方を選ぶ
- 辺の `label` は具体的な動詞句（「公開鍵を取得」）。同じ向きの辺を 2 本引くときだけ `id` を書く
- 点は宣言した辺の上だけを通れる（`trace`）

## 3. 場面と行（scenes / lines）

```json
{ "id": "s1", "figure": "flow", "title": "（任意）章の題", "lines": [
  { "id": "l2", "text": "{a}申請者が送った申請は、{b}最初に入力チェックを通ります。",
    "read": "（任意）読み。印も同じ位置に置く",
    "source": ["src/expense/check.ts:42"],
    "do": [ { "at": "a", "trace": ["app", "sys"], "label": "申請書" }, { "at": "b", "pulse": "sys" } ] } ] }
```

- `figure` は図 1 つか、2 つの配列（左右に並べる。`split` で左の幅の割合、既定 0.56）
- 場面が変わると、次の場面で使わない図は消え、使い続ける図は新しい区画へ動く
- `text` は字幕。2 行（1 行およそ全角 38 字）に収まらなければ文を分ける
- `source` は根拠（契約と同じ書き方）。評価役が照合する

## 4. 文中の印と時刻

`text` の中の `{名前}`（英数字と `_`）が印。字幕には出ない。動作の `at` に印の名前を書くと、**その位置の語を話し始める瞬間**に動作が始まる。

- `at` を省いた動作は、同じ行の直前の動作が終わってから始まる（最初の動作は行の頭）
- `after: 0.3` で印から少し遅らせる。`dur` で長さを変える
- 時刻は音声の時刻表（M2 の tts が作る `timeline.json`）から決まる。時刻表がなければ文字数から見積もる
- 動作が行の終わりを 1.2 秒以上はみ出すと警告（次の行の声に重なる）

## 5. 動作（do）の一覧

1 つの動作には動詞をちょうど 1 つ書く。値が主な対象で、ほかのキーは引数。対象は部品の id。場面に図が 2 つあって同じ id があるときは `図/id` と書く。図の id を書くと図全体になる。

| 動詞 | 例 | 意味 | 既定の長さ |
|---|---|---|---|
| `show` | `{"show": "flow"}` / `{"show": ["app", "app>sys"]}` | 出す。図全体なら宣言の順（ノード → 両端が出た辺）に。行・カード・枠は中身ごと | 0.7 秒＋0.22 秒ずつずらす |
| `hide` | `{"hide": ["dot:dot"]}` | 消す | 0.5 |
| `focus` | `{"focus": ["sys", "kacho", "sys>kacho"]}` | 対象以外を薄くする（同じ図の中）。注記・点・戻りの矢印は薄くしない | 0.6 |
| `unfocus` | `{"unfocus": true}` | 薄くしたのを戻す | 0.6 |
| `pulse` | `{"pulse": "sys"}` | 一瞬強調する | 0.8 |
| `mark` | `{"mark": "keiri", "as": "check"}` | 印を付ける。`as` は `check` `cross` `question`。付け直すと差し替わる | 0.5 |
| `unmark` | `{"unmark": "keiri"}` | 印を外す | 0.4 |
| `trace` | `{"trace": ["app", "sys", "kacho"], "label": "申請書", "dot": "dot"}` | 点が経路をたどる（graph だけ）。1 つ目は点のいる所。初めてなら 1 つ目に現れる。`label` は点の札（箱の外を動く間だけ出る） | 区間数 × 1.0 |
| `reply` | `{"reply": ["kacho", "sys", "app"], "label": "差し戻し", "as": "bad"}` | 戻りの矢印を、行きの辺のラベルと反対の側に引く。区間ごとに逆向きの辺の宣言が要る | 区間数 × 0.8＋0.4 |
| `note` | `{"note": "kacho", "text": "多くはここで終わる", "link": false}` | 対象の脇に注記を置く（重ならない所を自動で選ぶ） | 0.6 |
| `badge` | `{"badge": "2 / 3"}` | 右上の札。`""` で消す | 0.5 |
| `relabel` | `{"relabel": "k2.after", "text": "半日"}` | 文字を書き換える | 0.6 |
| `tint` | `{"tint": "sys>bucho", "as": "warn"}` | 線や行の色を役割の色に変える | 0.6 |
| `move` | `{"move": "box1", "by": [0, -90]}` / `{"to": [x, y]}` / `{"to": "別のid"}` | 部品を動かす（図のローカル座標） | 1.0 |
| `custom` | `{"custom": "ring", "dur": 1.6}` | 台本の `custom` の関数で描く（6 章） | 2.0 |

共通の引数: `at`（印）・`after`（秒）・`dur`（秒）。

## 6. 下の層（canvas・move・custom）

語彙で表せない絵だけに使う。使ったら、評価役が意図を読めるよう行の `source` か `note` で何を描いたかを書く。

**canvas**: 1184 × 470 のローカル座標に図形を置く（`width` `height` で変えられる）。

```json
{ "type": "canvas", "shapes": [
  { "id": "box1", "shape": "rect", "x": 160, "y": 170, "w": 220, "h": 110, "role": "actor", "text": "紙の領収書" },
  { "id": "e1", "shape": "ellipse", "x": 800, "y": 160, "w": 240, "h": 130, "role": "added", "text": "写真のデータ" },
  { "id": "arr", "shape": "arrow", "points": [[390, 225], [790, 225]], "text": "スマホで撮る", "dashed": false },
  { "id": "cap", "shape": "text", "x": 592, "y": 380, "text": "説明", "size": 22, "anchor": "middle", "bold": false } ] }
```

`shape` は `rect` `ellipse` `line` `arrow` `text`。ほかの動詞（show / focus / move …）はそのまま使える。

**custom**: 毎コマ呼ばれる関数を文字列で書く。引数は `{ g, p, t, el, S, UZ, area }`（`g` は毎コマ空にされる SVG の g、`p` は 0〜1 の進み、`el(tag, attrs, parent)` で要素を作る、`S` はテーマの色、`area` は図の区画）。その場面の間だけ表示される。配置の検査は custom の中を見ないので、画面で確かめる。

## 7. 検査が見ること

`check_storyboard.cjs` はプレーヤーと同じ JS で配置を計算し、各行の終わりと各動作の終わりのコマを調べる。

- 形: 必須の項目、id の重複・使えない文字、図の種類ごとの宣言（辺の両端がノードにあるか、セルの数など）
- 解決: 動作の対象が場面の図にあるか、印が文にあるか、点の経路が宣言した辺か、点がいまいる所から書いているか
- 配置: 区画からのはみ出し、文字が 15px 未満に縮んでいないか、文字どうしの重なり、ラベルや注記が別の箱や枠の縁に重なっていないか
- 警告: 使っていない印、字幕が 2 行に収まらない、show していない図、行の終わりをはみ出す動き
