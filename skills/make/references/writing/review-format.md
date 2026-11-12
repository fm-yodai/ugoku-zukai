# 評価役の出力の形

事実・文章・演出の評価役（fact-checker・writing-reviewer・director。チャットでは進行役が順に演じる）が共通で使う。進行役はこの形の JSON を `scripts/ledger.py ingest` で指摘の一覧に取り込む。評価役の約束と指摘の扱いは `../review-protocol.md`、基準は `../criteria/` が正。

## 出力

出力先は進行役が渡す（`<workdir>/review/<連番>-<target>/<評価役の名前>.json`）。

```json
{
  "reviewer": "fact-checker",
  "target": "script",
  "checks": [
    {"criterion": "S-F1", "verdict": "FAIL", "evidence": "全 30 行の source を読んだ。l7 だけ言えない"},
    {"criterion": "S-F2", "verdict": "PASS", "evidence": "図 flow の辺 9 本の source を読み、向きが合っている"}
  ],
  "findings": [
    {"key": "l7:S-F1", "where": "l7", "criterion": "S-F1", "level": "must", "rule": "FC-overclaim",
     "problem": "client_id が何と一致するのかが書かれておらず、どのアプリのトークンでも通るように読める",
     "suggestion": "「client_id が、この API に設定したアプリクライアント ID と一致するかを確かめます。」",
     "evidence": "src/apps/api/src/middleware/auth.ts:82"}
  ],
  "rechecks": [
    {"key": "l9:S-F1", "verdict": "PASS", "evidence": "直した字幕は post-confirmation.ts:30 から言える"}
  ],
  "summary": "1〜3 文の総評"
}
```

| キー | 中身 |
|---|---|
| `reviewer` | 評価役の名前。チャットで評価役を 1 回にまとめるときは `combined` |
| `target` | 何を見たか。`outline`（構成メモ）・`script`（台本。スライドと原稿）・`screen`（行ごとのコマ）・`voice`（読みの一覧） |
| `checks` | 担当の基準すべてについて `PASS`・`FAIL`・`UNKNOWN`。`evidence` には、PASS なら確かめた範囲、FAIL なら要約、UNKNOWN なら判定に要る情報を書く。`evidence` のない PASS は UNKNOWN として扱われる |
| `findings` | 基準を満たしていない箇所。1 つの問題を 1 件にする。同じ場所・同じ基準の問題が 2 つ以上あるときは、キーが同じになるので 1 件にまとめ、`problem` と `suggestion` に両方を書く（レベルは高いほう） |
| `rechecks` | 進行役から渡されたキーだけを見直した結果。`verdict` は `PASS` か `FAIL`。渡されていなければ空の配列。再確認だけを頼まれた回は、`checks` と `findings` は空でよい（見る範囲も渡されたら、その範囲で判定した基準だけを `checks` に書く） |

## 指摘（`findings` の 1 件）

| キー | 中身 |
|---|---|
| `where` | 指摘の場所（下の表）。全体への指摘は `*` |
| `criterion` | `../criteria/` の基準 ID（`S-F1`・`A-3`・`O-D6`・`G-D12` など） |
| `key` | `<where>:<基準 ID>`。同じ問題は、評価役や回が変わっても同じキーにする |
| `level` | `must`・`should`・`nits`（下の「レベル」） |
| `rule` | 任意。細かい規則の番号。文章 `TW-n`・`SP-n`、演出 `VG-n`、事実は `FC-wrong`（誤り）・`FC-overclaim`（言い過ぎ）・`FC-nosource`（根拠が見つからない） |
| `problem` | 何が起きているか。聴衆がどう誤解するかまで書く。スライドやその部品への指摘では、頭にスライドの id（部品への指摘なら部品の id も）を書く（「スライド `ux-def` の囲み `q`: …」） |
| `suggestion` | 具体的な直し方。文なら書き換え後の文そのもの。禁止語に足す候補があれば、ここに書く |
| `evidence` | 判断の根拠（`path:line`、URL と引用、字幕やスライドの文言、規則の例、画面ならシートのファイル名と行 id）。意図に照らした指摘では、**意図のどの文に照らしたか**（意図の場所と、その文の引用）を必ず入れる。**`evidence` のない指摘は捨てられる** |

`where` の書き方:

| 対象 | 書き方 | 例 |
|---|---|---|
| 原稿の行 | 行の id | `l7` |
| 場面 | 場面の id | `s2` |
| スライドと、その部品（テキストのブロック、スライドの中で宣言した図） | そのスライドを最初に使う場面の id。スライドの id と部品の id は `problem` の頭に書く | `s3` |
| `figures` に宣言した図 | 図の id（場面の id でもよい） | `flow` |
| 構成メモの章の意図・章のつながり | 章の id | `c3` |
| 構成メモのスライドの意図・スライドのつながり | そのスライドを最初に使う場面の id | `s3` |
| 構成メモの `basics` | `basics.<キー>` | `basics.knows` |
| 章の順番の意図（`flow`）と、全体 | `*` | `*` |

`where` に書けるのは、台本の行・場面・`figures` の図の id と、構成メモの章の id・`basics.<キー>`、それに `*` である。指摘の一覧（`ledger.py status`）は、これ以外の `where` を「今の台本にも構成メモにもない id」として警告する。スライドの id と部品の id は、まだ `where` に書けない。そのため、スライドへの指摘は場面の id で指し、どのスライドのどの部品かは `problem` に書く。同じ場面に、同じ基準の指摘が 2 つあるときは、1 件にまとめる。

FAIL と判定した基準には、必ず `findings` を書く（書かないと、場所の分からない must の指摘として取り込まれる）。UNKNOWN と判定した基準は、`findings` にも `*:<基準 ID>`（場所が決まるならその場所）で載せ、`problem` に判定に要る情報を書く。

## レベル

- **must**: 放置すると聴衆が誤解する、または聴衆に伝わらない。事実の誤り、利用者と合意した意図からの逸脱、聴衆の側から書かれていない意図、声と字幕なしでは読めないスライド、意味が取れない文、画面で読めない・原稿が説明しているものが出ていない
- **should**: 正しく伝わるが、直すともっと伝わりやすくなる
- **nits**: 直さなくても伝わり方が変わらない、好みの範囲

基準の表（`../criteria/`）の重さに従う。重さが must だけの基準の指摘は must にする（ほかのレベルを付けても、取り込むときに must に直される）。must と should を分けている基準では、その定義どおりに付ける。迷ったら低いほうにする。must は利用者に全文を見せるので、数を絞る。

## チャットで評価役を 1 回にまとめるとき

サブエージェントのない環境では、その場面の評価役の担当をすべて 1 回で判定し、全基準の判定を 1 つのファイル `combined.json` に同じ形で書く。`reviewer` は `combined` にする（`../review-protocol.md` の「チャットでの回し方」）。
