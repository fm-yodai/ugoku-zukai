# 成功基準（maker と checker が共有する物差し）

フェーズごとの合格の条件。**maker（researcher / writer / animator）は書く前と渡す前に、checker（fact-checker / writing-reviewer / director）は判定するときに、同じこのファイル群を読む**。基準の言い回しを変えると両方の振る舞いが変わるので、変えるときは較正の例も見直す。

| ファイル | フェーズ | 対象 |
|---|---|---|
| `contract.md`（C-） | 1 取材と契約 | `contract.json` と `brief.md` |
| `script.md`（S-） | 2 台本 | `storyboard.json` の字幕・読み・主張・ショット |
| `structure.md`（G-） | 2 台本・4 画面 | 図（`map` と、それを動かす ops） |
| `screen.md`（V-） | 4 描画と画面 | preview の静止画シート・変化点シート・`layout_report.json`・`occupancy.json` |

## 項目の読み方

各項目は「ID・合格の条件・検査（機械 / どの checker）・重さ（must / should）」を持つ。

- **合格の条件は合否で判定できる文**にしてある。点数は付けない
- **検査が「機械」の項目は checker が判定しない**。本体が lint / layout_report / check_contract.py の結果を台帳に入れる。checker は機械の結果を読んでよいが、重ねて指摘しない
- 情報が足りなくて判定できなければ **UNKNOWN** を返す（推測で PASS / FAIL にしない）。UNKNOWN は台帳で open として扱い、maker に「判定に要る情報」を足させる
- **根拠の無い判定は無効**。FAIL には場所と引用（`path:line`・URL と引用・字幕の文言・`sheet-02.png の 5 コマ目`・占有表の行）、PASS には確かめた範囲を書く

既存の規則は転記せず ID で参照する: 文章 `TW-n`（`${CLAUDE_PLUGIN_ROOT}/skills/make/references/writing/rules.md`）、演出 `VG-n`（`../visual-grammar.md`）。

## 衝突したとき

checker どうしの指摘が食い違ったら、**事実 > 構造 > 文章 > 演出** の順で上を採る（`../loop-protocol.md`）。

## 較正の例

各ファイルの末尾に、人の指摘や過去の画面レビューで実際に出た欠点を「較正の例」として置く。checker はこの例と同程度の欠点を見逃していないかで、自分の甘さを確かめる。新しい欠点を人が見つけたら、Phase 6 でここに足す（題材固有の名前は書かず、何が悪く、どの基準で止めるかを書く）。
