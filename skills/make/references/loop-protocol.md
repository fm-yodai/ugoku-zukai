# maker-checker のループの約束

2 取材と契約・4 台本・5 画面（台帳のフェーズ名は `contract`・`script`・`screen`）は、maker が作り、checker が `criteria/` の基準で判定し、合格するまで回す。本体（SKILL.md を実行しているセッション）は**進行役**で、成果物の中身を書かない・指摘の本文を読まない。読むのは `scripts/ledger.py status` が出す件数の要約だけ（チャットで 1 人が役を順に演じるときの約束は下の「チャットでの回し方」）。

設計の根拠: Anthropic「Harness design for long-running application development」（独立した懐疑的な評価役・基準ごとの合否・作る前の契約）、「Demystifying evals for AI agents」（次元ごとのルーブリック・Unknown を許す）、Huang ら ICLR 2024（自己修正は外部の信号があるときに効く → 機械検査を先に回す）。

## 1 周の流れ

1. **maker** が `criteria/` の該当ファイルを読んで作る（2 周目以降は台帳 `review/ledger.json` の open / regressed の項目を直し、項目ごとの応答 `review/<phase>/r<N>/responses.json` を書く）
2. **機械検査**を本体が回す。契約は `check_contract.py`、台本は `check_storyboard.cjs` と `check_text.py`、画面は `frames.cjs`（見積もりの時刻でコマを書く）と `check_storyboard.cjs`。誤りがあれば maker に戻す。`check_storyboard.cjs` の警告のうち must の基準に当たるもの（少なくとも「辺 … に label がない」。S-M1・G-M2）も、誤りと同じに maker に戻す（終了コードは 0 のままなので、本体が出力の警告を読んで判断する）（機械の直しは周回に数えないが、同じ周で 5 回を超えたら打ち切り）
3. **checker** を本体が起動する（Claude Code では役ごとに並列。チャットでは 1 回にまとめる）。渡すのは成果物のパス・基準ファイル・前の周の台帳・出力先だけで、maker の推論や取材メモ（brief.md）は渡さない（fact-checker は契約モードでも brief.md を読まない）
4. `python3 scripts/ledger.py ingest <workdir> <phase> <checker の出力 …>` で台帳に取り込む
5. `python3 scripts/ledger.py status <workdir> <phase>` の判定に従う: `PASS` → 次のフェーズへ / `CONTINUE` → 次の周 / `STOP_*` → 打ち切って次のフェーズへ（残論点として持ち越す）

## 台帳の状態

指摘のキーは `<行 ID または contract または *>:<基準 ID>`（例 `l7:S-W2`）。checker が変わっても、同じ問題は同じキーになる。

| 状態 | 意味 | 次に起きること |
|---|---|---|
| open | checker が FAIL / UNKNOWN と判定した | maker が直して fixed にするか、理由を付けて disputed にする |
| fixed | maker が直したと応答した | 次の周で同じ checker が再確認する。PASS → closed、まだ FAIL → open に戻し `reopen` を 1 足す |
| disputed | maker が理由を付けて直さなかった | 次の周で checker が反論を読み、認めれば accepted、認めなければ open（`rejected` を 1 足す） |
| closed / accepted | 解決した | closed の項目が後の周で再び FAIL になったら open に戻し `reopen` を 1 足す（回帰） |

## 合格と打ち切り

- **合格（PASS）**: 機械検査のエラーが 0 で、台帳に open / fixed / disputed が 1 つも無い（should も含む。should を閉じる方法は「直す」か「反論を checker に認めてもらう」だけ）
- **打ち切り**: 次のどれか
  - `STOP_MAX`: 最大の周（Claude Code は 3、チャットは 2。`ledger.py status … --max-rounds 2`）を終えても合格しない
  - `STOP_OSC`: 同じキーの `reopen` が 2 に達した（直す → 壊れる の振動）。最大の周を待たない
  - `STOP_DISPUTE`: 同じキーの反論が 2 回認められなかった（maker と checker の意見が割れたまま）
- 打ち切ったら、閉じていない項目は**残論点**になる。`ledger.py residual` で一覧を作り、7 組み立てと公開の再生ページ（たたんだ「未解決の指摘 N 件」）と 8 報告に必ず出す。黙って公開しない

## checker の約束

- **基準 ID ごとに判定する**（`checks`）。担当の基準をすべて PASS / FAIL / UNKNOWN のどれかにする。判定しない基準を残さない
- **重さは基準の表に従う**。重さが must だけの基準（S-F1 など）の FAIL を should にしない。`ledger.py` は must だけの基準の指摘を must に直して取り込む（過去に、事実の言い過ぎが should で付き、ループで止まらなかった）
- **根拠が無い判定は無効**（`ledger.py` が捨てて警告する）。FAIL は場所と引用、PASS は確かめた範囲
- **前の周の台帳を読み、自分の担当の fixed / disputed の項目をすべて再確認する**（`rechecks`）。closed の項目が壊れていないかも見る（回帰）
- **担当外の基準は判定しない**。重複した指摘は台帳の上で 1 つのキーにまとまるが、判定は担当の checker のものだけを使う
- 衝突したときは **事実 > 構造 > 文章 > 演出** の順で上を採る。下の checker の指摘が上の基準と矛盾するなら、maker は disputed にして理由に上の基準 ID を書く

## maker の約束

- 基準ファイルを読んでから作る。渡す前に自分で基準を 1 つずつ点検する（自己点検は checker の代わりにはならない。漏れを減らすため）
- open / regressed の項目にはすべて応答する（`fixed` か `disputed`）。黙って無視しない
- 直すときに、閉じた項目を壊していないかを確かめる
- 画面（`screen`）の指摘は、図の宣言と動作だけで直す。字幕（`text`）は変えない。字幕を変えないと直せないなら disputed にして理由を書く（4 台本に戻る）
- **行 ID を振り直さない**。行を消したら欠番のままにし、足すときは場面の末尾の番号を使う。台帳のキーは行 ID なので、振り直すと前の周の指摘と今の行が食い違う（`ledger.py status` が台本に無い行 ID を指す項目を警告する。2026-10-28 iteration4-review-v2 で起きた）

## チャットでの回し方

claude.ai のチャットではサブエージェントを起動できないので、1 つの会話で maker と checker を順に演じる。台帳と状態の判定は Claude Code と同じ `ledger.py` を使い、次の点だけを変える。

- **評価役は 1 回にまとめる**。そのフェーズの checker の担当（fact-checker・writing-reviewer・director）をすべて 1 回で判定し、全基準の判定を 1 つのファイル `review/<phase>/r<N>/combined.json` に書く。形は checker の出力と同じで、`reviewer` は `combined`。取り込みは `python3 scripts/ledger.py ingest <workdir> <phase> <workdir>/review/<phase>/r<N>/combined.json`
- **最大 2 周**。状態は `python3 scripts/ledger.py status <workdir> <phase> --max-rounds 2` で判定する
- **評価役の番の始めに宣言する**。「ここからは評価役として、作り手の推論を使わず、基準ファイル・一次資料・成果物だけで判定する」と書いてから判定に入る。取材メモ（`brief.md`）と、作り手として考えた理由は判定の根拠にしない
- 機械検査、台帳の状態、残論点の扱いは Claude Code と同じ

## 出力の形

checker の出力・maker の応答の JSON は `${CLAUDE_PLUGIN_ROOT}/skills/make/references/writing/review-format.md` の「maker-checker 形式」が正。
