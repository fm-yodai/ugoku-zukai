# 画面の基準（V-）— 5 画面・6 音声

5 画面は音声の合成の前に、見積もりの時刻で行う。対象は `frames.cjs` が書く `<workdir>/frames/`:

- `sheet-NN.png`: 各行の落ち着いたコマを 2 列 × 3 行に並べたシート。各コマの上の帯に「行 id ＋字幕の頭」が出る
- `svg/<行 id>.svg`: 各行のコマ（640×360 に縮める前の SVG）
- `frames.json`: 行ごとの `{id, scene, t, text, svg, sub_forced, settled}`。`settled: false` の行は、そのコマの時点でまだ動作が続いている（途中の画面）。`sub_forced: true` の行は、そのコマの時刻に再生ページでは字幕が消えている（動作が声より長いか、次の場面の始まりでコマの時刻を切った）ので、コマの字幕は補ったもの。どちらも、1 行の動作が声に対して多すぎないかを見る手がかりにする（S-D2・VG-3）

resvg を入れられず PNG が無いときは、`svg/` と `frames.json` だけで判定し、見えない基準は UNKNOWN にする。

VLM は「重なっているか」の判定が苦手（重なりの単純な課題で正答率 6 割程度、ACCV 2024「VLMs are blind」）。**重なり・はみ出し・大きさは機械（`check_storyboard.cjs` の配置）が判定し、checker は意味だけを見る**。checker は位置を言うとき、シートのファイル名と行 id（「`sheet-02.png` の行 `l7`」）を `evidence` に書く（maker が元の動作までたどれるように）。

画面の指摘は writer が図の宣言と動作だけを直す。字幕（`text`）は変えない（変える必要があれば 4 台本に戻る）。

| ID | 合格の条件 | 検査 | 重さ |
|---|---|---|---|
| V-M1 | 見積もりの時刻で、`check_storyboard.cjs` の誤りと配置の問題（はみ出し・小さい・重なり）が 0 | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ>`。5 画面） | must |
| V-M2 | 音声の時刻表を使って、`check_storyboard.cjs --timeline` の誤りと配置の問題が 0（音声が古い・印が文にない も含む） | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ> --timeline <timeline.json>`。6 音声の後） | must |
| V-1 | 字幕が言っている要素が、その行の落ち着いたコマに**読める大きさで**映っている（Mayer の temporal contiguity） | director（画面モード） | must |
| V-2 | 強調（`pulse`・`mark`・`focus`・`tint`）が字幕の主題と同じ要素に付いている（signaling・VG-6） | director（画面モード） | must |
| V-3 | 前の行の残り物（消し忘れの点・注記・印・札）が、今の字幕と違う意味に読めない（VG-8） | director（画面モード） | must |
| V-4 | 一時的な書き換え（`relabel` で値を書き換える、`hide` と `show` で部品を入れ替える）の結果が、字幕の結論の部分まで画面に残っている | director（画面モード） | must |
| V-5 | 本題と関係のない要素が画面に無い（coherence） | director（画面モード） | should |

## 較正の例（過去の画面レビューより）

- 一覧の箇条（`list`）が全体図の空きに注記ほどの大きさで押し込まれ、項目の番号が読めない → V-1
- 「ある項目を省く」の話の最中に、省く前の表が映っていた → V-4
- 書き換えた値の札がほぼ見えず、行の終わりに表が元へ戻った → V-4
- 前の場面の点が箱に残り続け、次の場面でも何かが流れているように見えた → V-3
- 字幕が 3 つ目・4 つ目の項目を話しているのに、強調が 1・2 項目目に残った → V-2
