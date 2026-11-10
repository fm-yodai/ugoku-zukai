# 構成メモの形式（ugoku-zukai-outline/1）

構成メモ `<workdir>/outline.json` は、動画について利用者と合意したことの記録である。視聴者、持ち帰ってほしいこと、長さ、見た目、声と、章ごとの「言うこと」「見せるもの」「尺の目安」を、独立に直せる項目の集まりとして持つ。台本はこれを元に書き、評価役はこれを物差しにして台本を見る。

書いたら検査する:

```bash
python3 scripts/check_outline.py <workdir>              # 形・id の重複・根拠の有無
python3 scripts/check_outline.py <workdir> --ready      # 台本に進める状態かも見る
python3 scripts/check_outline.py <workdir> --json       # 結果と、まだ確認していない項目の一覧を JSON で出す
```

## 例

```json
{
  "format": "ugoku-zukai-outline/1",
  "title": "UX とは結局何か",
  "basics": {
    "audience": { "text": "自社の開発部", "by": "user", "state": "agreed" },
    "knows":    { "text": "UI/UX という言葉は聞いたことがある。受託開発の工程は知っている", "by": "claude", "state": "proposed" },
    "takeaway": { "text": "UX は画面の話に限らず、受託開発では提案の前から要る", "by": "user", "state": "agreed" },
    "length":   { "text": "5 分くらい", "seconds": 300, "by": "user", "state": "agreed" },
    "look":     { "text": "フラットな図解", "theme": "flat", "by": "claude", "state": "proposed" },
    "voice":    { "text": "落ち着いた声", "speaker": 8, "speed": 1.1, "by": "claude", "state": "proposed" },
    "tone":     { "text": "です・ます。一般的なビジネスの語り口", "by": "user", "state": "agreed" }
  },
  "chapters": [
    { "id": "c3", "title": "ユーザビリティとの違い",
      "says": [ { "id": "c3.1", "text": "ユーザビリティは使いやすさで、UX の一部である", "by": "source",
                  "source": ["https://example.com/ux 「…」"], "state": "agreed" } ],
      "shows": { "text": "UX の円の内側にユーザビリティの円", "figure": "venn", "by": "claude", "state": "proposed" },
      "seconds": 50 }
  ],
  "open": [ "受託の工程の区切り方は、社内の呼び名に合わせるか" ]
}
```

通る見本は `examples/outlines/` にある（`ux.json` は題目と利用者の考えから作る動画、`keihi.json` は見本台本 `examples/table-compare.json` に合わせたもの）。

## 項目

`basics` の値、章の `says` の各要素、章の `shows` は、どれも同じ形の「項目」で書く。

```json
{ "text": "…", "by": "user", "state": "agreed", "source": ["場所か引用"] }
```

- `text`: 中身を 1 文か 2 文で書く。利用者の答えは、言い換えずに利用者の言葉のまま書く
- `by`: その項目の出どころ
  - `user`: 利用者が言った
  - `claude`: Claude が決めた
  - `source`: 資料や Web から取った。`source` に場所か引用を 1 つ以上書く（書き方は台本の `source` と同じ。`path:line`、`https://… 「引用」` など）
- `state`: 利用者がその項目を見たか
  - `proposed`: Claude が決めたが、利用者はまだ見ていないか、答えていない
  - `agreed`: 利用者が言ったか、見て通した
- `by` が `user` の項目は、必ず `agreed` にする
- `by` と `state` は別のことを表すので、ほかの組み合わせはどれも書ける。Claude が調べて決めた項目で、利用者がまだ見ていないものは、`by: source`・`state: proposed` になる
- 出どころのある項目をまとめ直した文（まとめの章など）も、`by: source` にして、元の出どころを `source` に写す

## 形

| 場所 | 形 | 検査 |
|---|---|---|
| `format` | `"ugoku-zukai-outline/1"` | 違えば誤り |
| `title` | 動画の題 | なければ誤り |
| `basics` | オブジェクト。キーは自由で、値は項目 | オブジェクトでなければ誤り |
| `basics.length.seconds` | 正の数（任意）。長さを秒で書く | 数でなければ誤り |
| `basics.look.theme` | 文字列（任意）。テーマの名前かパス | 文字列でなければ誤り |
| `basics.voice.speaker`・`speed` | 整数・正の数（任意）。台本の `voice` と同じ | 形が違えば誤り |
| `chapters` | 配列。まだ章がなければ空にする | 配列でなければ誤り |
| `chapters[].id` | 英数字・`_`・`-`・`.`・かな漢字。`/` `:` 空白は使えない（台本の id と同じ規則） | ない・重複は誤り |
| `chapters[].title` | 章の題 | なければ誤り |
| `chapters[].says` | 言うこと。項目の配列で、各項目に `id` を付ける。`id` は構成メモの中で重複させない | 配列でない・`id` がない・重複は誤り |
| `chapters[].shows` | 見せるもの（任意）。項目に、図の種類の目安 `figure` を足せる | `figure` が図の種類（`storyboard.md` の 2 章）でなければ誤り |
| `chapters[].seconds` | 正の数（任意）。尺の目安 | 数でなければ誤り |
| `open` | 文字列の配列（任意）。まだ決めていないこと | 形が違えば誤り |

`basics` の項目は固定の一覧ではなく、会話で出てきたものを書く。よく使うキーは次のとおり。

| キー | 中身 |
|---|---|
| `audience` | 視聴者 |
| `knows` | 視聴者が知っている前提。字幕が視聴者に分かる言葉で書かれているかの物差しになる |
| `takeaway` | 持ち帰ってほしいこと |
| `can_do` | 見終わったらできること（概念を伝える動画では、なくてよい） |
| `length` | 長さ |
| `look` | 見た目 |
| `voice` | 声 |
| `tone` | 口調 |

## 台本に進む前に要るもの（`--ready`）

`--ready` を付けると、次のどれかに当たるときも誤りにする。

- `basics` に `audience`・`knows`・`takeaway` のどれかがない。利用者が言わなければ、Claude が案を `proposed` で書く
- `chapters` が空
- `says` が空の章がある

## 警告

終了コードは変えない。

- すべての章に `seconds` があり `basics.length.seconds` もあるとき、章の合計が長さから 15% を超えてずれている
- 項目の `text` に禁止語（`assets/banned_terms.json`）がある。`by` が `user` の項目は見ない（利用者の言葉はそのまま書くため。字幕に出たときは `check_text.py` が誤りにする）

## 守ること

- 章の id は振り直さない。台本の場面は `chapter` で章の id を指し（`storyboard.md` の 3 章）、指摘や直しも章の id で指すため、途中で変えると結び付きが切れる。章を消したら、その番号は欠番にする
- 利用者が見て通した項目は、`by` を変えずに `state` だけを `agreed` にする。利用者が文を直したら、`text` を利用者の言葉に書き換えて `by` を `user` にする
- まだ決めていないことは、項目にせず `open` に書く

## まだ確認していない項目の一覧

`--json` の `proposed` に、`state` が `proposed` の項目が書いてある順に入る。利用者に「Claude が決めたこと」として見せるときに使う。

```json
{ "where": "c3.shows", "label": "c3 ユーザビリティとの違い / 見せるもの", "text": "UX の円の内側にユーザビリティの円" }
```

`where` は項目の場所（`basics.look`、`c3.shows`、言うことは項目の id の `c3.1`）、`label` は人が読む名前である。言うことの `label` は、`c3 ユーザビリティとの違い / 言うこと c3.1` のように末尾に id が付く。
