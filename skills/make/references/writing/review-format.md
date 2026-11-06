# レビュー指摘の共通形式

文章・事実・演出のレビュアー（`agents/` の `writing-reviewer` / `fact-checker` / `director`）が共通で使う。呼び出し元はこの形式だけを読めばよいので、レビュアーごとに解釈を変えない。

## 目次

指摘ファイル → severity の基準 → 応答ファイル（書き手が書く）→ maker-checker 形式（ugoku-zukai。checker の出力 / maker の応答）。単独のレビューは前の 3 つ、ugoku-zukai は最後の節を使う。

## 指摘ファイル

```json
{
  "reviewer": "writing-reviewer",
  "target": "<レビューしたファイルのパス>",
  "round": 1,
  "findings": [
    {
      "id": "W1",
      "line_id": "c3-2",
      "rule": "TW-2",
      "severity": "must",
      "problem": "client_id が何と一致するのかが書かれていない",
      "suggestion": "client_id が、この API に設定したアプリクライアント ID と一致するか",
      "evidence": "src/apps/api/src/middleware/auth.ts:82"
    }
  ],
  "summary": "1〜3 文の総評"
}
```

| キー | 内容 |
|------|------|
| `id` | レビュアー内で一意。文章 `W`、事実 `F`、演出 `D` で始める |
| `line_id` | 対象の行（台本なら `c3-2`、文書なら見出しや段落を特定できる文字列）。全体への指摘は `"*"` |
| `rule` | 規則の番号。文章 `TW-n`（references/writing/rules.md）、演出 `VG-n`（references/visual-grammar.md の約束番号）、事実は `FC-wrong`（誤り）/ `FC-overclaim`（言い過ぎ）/ `FC-nosource`（根拠が見つからない） |
| `severity` | `must` か `should`（下の基準） |
| `problem` | 何が起きているか。読んだ人がどう誤解するかまで書く |
| `suggestion` | 具体的な直し方。文なら書き換え後の文そのもの |
| `evidence` | 判断の根拠（`path:line`、規則の例、画面ならシートのファイル名と行 id（`sheet-02.png` の行 `l7`）） |

## severity の基準

- **must**: 放置すると、読んだ人が仕組みを誤解する・事実と違う・意味が取れない。または画面で文字が切れる・重なって読めない
- **should**: 正しく読めるが、より正確・明快にできる

迷ったら should にする。must は呼び出し元が必ず対応する前提なので、数を絞る。

## 応答ファイル（書き手が書く）

```json
{
  "round": 1,
  "responses": [
    {"finding": "writing-reviewer/r1/W1", "action": "fixed", "note": ""},
    {"finding": "fact-checker/r1/F2", "action": "rebutted", "note": "auth.ts:129 で sub だけを載せているので、指摘の email は該当しない"}
  ]
}
```

- `finding` は `<reviewer>/r<round>/<id>` で指す（`id` はラウンドごとに W1 から振り直されるので、ラウンドを省くと別の指摘と取り違える）
- `action` は `fixed`（直した）か `rebutted`（理由を付けて直さない）。黙って無視しない
- must を rebutted にした場合、その指摘は人の承認ゲートで「残った論点」として示す

## maker-checker 形式（ugoku-zukai）

ugoku-zukai の 2 取材と契約・4 台本・5 画面（フェーズ名 `contract`・`script`・`screen`）では、上の形式に「基準ごとの判定」と「前の周の再確認」を足した次の形式を使う。台帳 `review/ledger.json` に取り込むのは `${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py` で、ループの約束は `${CLAUDE_PLUGIN_ROOT}/skills/make/references/loop-protocol.md` が正。

### checker の出力（`<workdir>/review/<phase>/r<N>/<reviewer>.json`）

チャットで評価役を 1 回にまとめるときは、全基準の判定を `<workdir>/review/<phase>/r<N>/combined.json` に同じ形で書き、`reviewer` を `combined` にする（`../loop-protocol.md` の「チャットでの回し方」）。

```json
{
  "reviewer": "fact-checker",
  "phase": "script",
  "round": 2,
  "checks": [
    {"criterion": "S-F1", "verdict": "FAIL", "evidence": "全 30 行の source を読んだ。c3-2 だけ言えない"},
    {"criterion": "S-F2", "verdict": "PASS", "evidence": "図 flow の辺 9 本の source をすべて読み、向きが合っている"}
  ],
  "findings": [
    {"key": "c3-2:S-F1", "line_id": "c3-2", "criterion": "S-F1", "rule": "FC-overclaim", "severity": "must",
     "problem": "…", "suggestion": "…", "evidence": "src/apps/api/src/middleware/auth.ts:82"}
  ],
  "rechecks": [
    {"key": "c4-5:S-F1", "verdict": "PASS", "evidence": "直した字幕は post-confirmation.ts:30 から言える"},
    {"key": "c5-2:S-F3", "verdict": "FAIL", "accept_dispute": false, "evidence": "反論は契約 K2 と矛盾する"}
  ],
  "summary": "1〜3 文"
}
```

| キー | 内容 |
|---|---|
| `checks` | 担当の基準すべてについて `PASS` / `FAIL` / `UNKNOWN`。`evidence` には確かめた範囲（PASS）か、FAIL の要約を書く。**evidence の無い判定は無効** |
| `findings[].key` | `<line_id>:<criterion>`。同じ問題は周や checker が変わっても同じキーにする。全体への指摘は `*:<criterion>`、契約への指摘は `contract:<criterion>` |
| `findings[].criterion` | `criteria/` の基準 ID（`C-F1` など）。`rule` には従来どおり細かい規則（`TW-2`・`FC-wrong`・`VG-7`）を書いてよい |
| `findings[].severity` | 基準の重さに従う（基準が must / should を分けている場合はその定義どおり） |
| `rechecks` | 前の周の台帳で、自分の担当の fixed / disputed の項目すべて。`verdict` は PASS / FAIL。disputed には `accept_dispute`（true = 反論を認める） |

UNKNOWN の基準は `findings` にも `<line_id or *>:<criterion>` で載せ、`problem` に「判定に要る情報」を書く。

### maker の応答（`<workdir>/review/<phase>/r<N>/responses.json`）

```json
{"phase": "script", "round": 2, "responses": [
  {"key": "c3-2:S-F1", "action": "fixed", "note": "字幕を auth.ts:82 の条件に合わせた"},
  {"key": "c5-2:S-D4", "action": "disputed", "note": "S-F1 が優先（事実 > 演出）。値を書き換えると根拠の無い値になる"}
]}
```

`action` は `fixed` か `disputed`。open の項目すべてに応答する。
