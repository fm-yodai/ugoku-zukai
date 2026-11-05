# 画面の基準（V-）— Phase 4 描画と画面

対象は preview の静止画シート（`out/sheets/`、各行の落ち着いたコマ）・変化点シート（`out/changes/`）・`layout_report.json`・`occupancy.json`（見えている要素が画面の 6×6 区画のどこを占めるか）。

VLM は「重なっているか」の判定が苦手（重なりの単純な課題で正答率 6 割程度、ACCV 2024「VLMs are blind」）。**重なり・はみ出し・大きさは機械が判定し、checker は意味だけを見る**。checker は位置を言うとき、占有表の区画と行 ID を `evidence` に書く（maker が元の op までたどれるように）。

| ID | 合格の条件 | 検査 | 重さ |
|---|---|---|---|
| V-M1 | layout_report の E が 0 | 機械 | must |
| V-M2 | layout_report の W（`line_on_text`・`line_on_box`・`text_small`）が 0、または残す理由が台帳にある | 機械 | should |
| V-M3 | 音声検査（欠落・画と字幕のずれ）が OK | 機械（render.sh） | must |
| V-1 | 字幕が言っている要素が、その行の落ち着いたコマに**読める大きさで**映っている（Mayer の temporal contiguity・VG-7） | director（画面モード） | must |
| V-2 | 強調（黄・点・✓・枠）が字幕の主題と同じ要素に付いている（signaling） | director（画面モード） | must |
| V-3 | 前の行の残り物（消し忘れの点・表・札）が、今の字幕と違う意味に読めない | director（画面モード） | must |
| V-4 | 一時的な書き換え（what_if・omit）の結果が、字幕の結論の部分まで画面に残っている | director（画面モード） | must |
| V-5 | 本題と関係のない要素が画面に無い（coherence） | director（画面モード） | should |
| V-6 | 実際の画面（`screen`）の注記が、字幕が指す画面上の場所を指している | director（画面モード） | must |

## 較正の例（過去の画面レビューより）

- 一覧の list が全体図の空きに注記ほどの大きさで押し込まれ、項目の番号が読めない → V-1
- 「ある項目を省く」の話の最中に、省く前の表が映っていた → V-4
- what_if の結果の札がほぼ見えず、行の終わりに表が元へ戻った → V-4
- 前の章のイベントの点が箱に残り続け、次の章でも何かが流れているように見えた → V-3
- 字幕が 3 つ目・4 つ目の項目を話しているのに、強調が 1・2 項目目に残った → V-2
