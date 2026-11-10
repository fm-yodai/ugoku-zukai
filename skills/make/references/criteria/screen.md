# 画面の基準（V-）

絵コンテを利用者に見せる前に、見積もりの時刻のコマで判定する（`target` は `screen`）。対象は `frames.cjs` が書く `<workdir>/frames/`:

- `sheet-NN.png`: 各行の落ち着いたコマを 2 列 × 3 行に並べたシート。各コマの上の帯に「行 id ＋字幕の頭」が出る
- `svg/<行 id>.svg`: 各行のコマ（640×360 に縮める前の SVG）
- `frames.json`: `png`（PNG のシートを書けたか）、`sheets`（シートのファイル名と載せた行 id）、`lines`（行ごとの `{id, scene, start, t, text, svg, sub_forced, settled}`）。`start` は行の始まりの時刻、`t` はコマを取った時刻。`settled: false` の行は、そのコマの時点でまだ動作が続いている（途中の画面）。`sub_forced: true` の行は、そのコマの時刻に再生ページでは字幕が消えている（動作が声より長いか、次の場面の始まりでコマの時刻を切った）ので、コマの字幕は補ったもの。どちらも、1 行の動作が声に対して多すぎないかを見る手がかりにする（S-D2・VG-3）

見るシートは `frames.json` の `sheets` に載ったものだけ（`frames.cjs` は始めに前の回のシートを消すが、ほかの手で置いたものは残りうる）。PNG があるかは `frames.json` の `png` で分かる。resvg を入れられず PNG が無い（`png: false`）ときは、`svg/` と `frames.json` だけで判定し、見えない基準は UNKNOWN にする。

VLM は「重なっているか」の判定が苦手（重なりの単純な課題で正答率 6 割程度、ACCV 2024「VLMs are blind」）。**重なり・はみ出し・大きさは機械（`check_storyboard.cjs` の配置）が判定し、評価役は意味だけを見る**。評価役は位置を言うとき、シートのファイル名と行 id（「`sheet-02.png` の行 `l7`」）を `evidence` に書く（直す人が元の動作までたどれるように）。

`pulse`（一瞬の強調）は、落ち着いたコマには残らない。`pulse` だけの行は、前の行と同じコマになる。コマで強調を見せたい行は `focus`・`mark`・`tint` を使う。`pulse` の行の V-2 は、台本の `do` を読んで判定する。

画面の指摘は、図の宣言と動作で直す。字幕（`text`）を変えないと直せないときは、その直しが合意した内容（構成メモの言うこと）を変えるかを進行役が見る。

| ID | 合格の条件 | 検査 | 重さ |
|---|---|---|---|
| V-M1 | 見積もりの時刻で、`check_storyboard.cjs` の誤りと配置の問題（はみ出し・小さい・重なり）が 0 | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ>`。台本を変えるたび） | must |
| V-M2 | 音声の時刻表を使って、`check_storyboard.cjs --timeline` の誤りと配置の問題が 0（音声が古い・印が文にない も含む） | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ> --timeline <timeline.json>`。合成の後） | must |
| V-1 | 字幕が言っている要素が、その行の落ち着いたコマに**読める大きさで**映っている（Mayer の temporal contiguity） | director | must |
| V-2 | 強調（`pulse`・`mark`・`focus`・`tint`）が字幕の主題と同じ要素に付いている（signaling・VG-6） | director | must |
| V-3 | 前の行の残り物（消し忘れの点・注記・印・札）が、今の字幕と違う意味に読めない（VG-8） | director | must |
| V-4 | 一時的な書き換え（`relabel` で値を書き換える、`hide` と `show` で部品を入れ替える）の結果が、字幕の結論の部分まで画面に残っている | director | must |
| V-5 | 本題と関係のない要素が画面に無い（coherence） | director | should |

## 較正の例（過去の画面レビューより）

- 一覧の箇条（`list`）が全体図の空きに注記ほどの大きさで押し込まれ、項目の番号が読めない → V-1
- 「ある項目を省く」の話の最中に、省く前の表が映っていた → V-4
- 書き換えた値の札がほぼ見えず、行の終わりに表が元へ戻った → V-4
- 前の場面の点が箱に残り続け、次の場面でも何かが流れているように見えた → V-3
- 字幕が 3 つ目・4 つ目の項目を話しているのに、強調が 1・2 項目目に残った → V-2
