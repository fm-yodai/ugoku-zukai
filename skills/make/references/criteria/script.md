# 台本の基準（S-）

対象は `storyboard.json`（場面 `scenes` の各行の字幕 `text`・読み `read`・根拠 `source`・動作 `do`）。形式は `../storyboard.md` が正。台本の初稿ができたときに判定する（`target` は `script`）。図そのものの基準は `structure.md`（G-）、構成メモとの照合は `agreement.md`（A-）で、director はここの S-D と合わせて判定する。S-W8・S-W9 は合成の前に、読みの一覧で判定する（`target` は `voice`）。

| ID | 合格の条件 | 検査 | 重さ |
|---|---|---|---|
| S-M1 | `check_storyboard.cjs` の誤り（形・id の解決・印・点の経路）と配置の問題（はみ出し・小さい・重なり）と、警告「辺 … に label がない」（G-M2）が 0 | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ>`。時刻は見積もり） | must |
| S-M2 | 字幕と読みに禁止語（比喩・造語・スキル内部の用語。`../../assets/banned_terms.json`）が無い | 機械（`check_text.py`） | must |
| S-M3 | 口調の語尾が徹底している。ずんだもん（話者 1・3・5・7・22・38・75・76）では**全文の文末**が「〜のだ」「〜なのだ」（問いは「〜のだ？」「〜なのだ？」）。文は「。」「？」「！」で切り、「」の中の句点では切らない。句点の無い最後の文も数える。「〜よ」「〜んだ」「〜だね」で終わる文が無い | 機械（`check_text.py`） | must |
| S-M4 | 読む文（`read` があれば `read`、なければ `text`）に、`read` で読みを書いておらず、ユーザー辞書（`../../assets/voicevox_user_dict.json`）にもない英字の語が無い | 機械（`check_text.py`） | must |
| S-W1 | 各文が TW-1〜TW-9 に反していない | writing-reviewer | must（読んだ人が誤解する・意味が取れないもの）/ should（より正確にできるもの） |
| S-W2 | 用語を比喩や造語で置き換えていない。禁止語の辞書に無い新しい造語（例: 「目印」「試行印」「読み書き役」）も含む。見つけたら辞書に足す候補として `suggestion` に書く | writing-reviewer | must |
| S-W3 | 口調のために文の主体・相手が崩れていない（語尾を付けるための受け身化など） | writing-reviewer | must |
| S-W4 | 読みの分かれる単独の漢字（「方」「他」「行」など）を、意図した読みで読ませるよう `read` に書いている | writing-reviewer | should |
| S-W5 | 視聴者（構成メモの `basics.knows`）の前提で分からない語や内部の呼び名が、意味の説明なしに出ていない（SP-2・SP-3。`../writing/spoken.md`） | writing-reviewer | must |
| S-W6 | 冒頭の 1 行目と `title` 図の文で、何の説明かが分かる（SP-1。`../writing/spoken.md`） | writing-reviewer | must |
| S-W7 | 聞いて分かる文の規則 SP-4〜SP-9（`../writing/spoken.md`）に反していない。場面の題（`scenes[].title`。無ければその場面の図の `title`）にも SP-2〜SP-9 を当てる | writing-reviewer | must（意味が取れない・誤解する）/ should（もっと自然にできる） |
| S-W8 | 読みの一覧（`voice/readings.md`）で、意味が変わる読み違いが無い（例: 作り手→ツクリシュ） | writing-reviewer（読みモード） | must |
| S-W9 | 読みの一覧で、語の途中や助詞の前に不自然な間が無い | writing-reviewer（読みモード） | should |
| S-W10 | 口調が構成メモの `basics.tone` に合っている。`tone` がなければ対象外 | writing-reviewer | must（全体の口調が違う）/ should（一部の文だけ違う） |
| S-F1 | `source` のある行の主張が、その `source` から言える（FC-wrong / FC-overclaim / FC-nosource が無い） | fact-checker | must |
| S-F2 | 図の宣言（`figures` の辺・メッセージ・表やグラフの値）と動作（`trace`・`reply` の経路、`relabel` の値）が根拠と一致する。根拠は、その場面の行の `source` と、その章の言うことの `source`。利用者の考えを図にしたもの（その章の言うことと見せるものが `by: user`）は対象外 | fact-checker | must |
| S-F4 | 出どころのない事実の記述がない。`source` がなく、事実を述べていて、その章の言うこと（構成メモの `says`）が `by: user` でない行を挙げる | fact-checker | should |
| S-D1 | 流れを追う場面で、流れているデータ（トークン・リクエスト・レコード等）が画面の主役になっている（VG-1）。流れのない図（表・比較・ベン図など）の場面は対象外 | director | must |
| S-D2 | 1 行 1 つの画面変化で、字幕の主題と画面の主題が同じ（VG-3・VG-6） | director | must |
| S-D4 | その他の VG の約束（寄って戻る VG-4・具体的な 1 件を通す VG-5・応答は別の矢印 VG-7・残り物を消す VG-8 など） | director | should |

S-F3 と S-D3 は欠番（`README.md` の「欠番」）。S-F4 の指摘には、`suggestion` に「調べて出どころを付ける」か「利用者の考えとして言う」かを書く。

## 較正の例

- **事実の言い過ぎを should と付けた**（過去の台本レビュー）: 「書けなかったときの例外を 'already-exists' として返す」（実際は条件付き書き込みの失敗の例外だけ）、「API はトークンの無いリクエストを 401 で拒否する」（ヘルスチェックの経路は通る）。どちらも S-F1 の FAIL で must。should と付けたためループで止まらず、人が後から直した

- **内部の用語が字幕に出た**（過去の指摘「『地図』という言葉は比喩が過ぎる」）: 「地図だよ。」「1 つ目の目玉なのだ」。どちらも演出の文書の用語で、視聴者には意味が無い → S-M2
- **造語**（過去の指摘「不自然な言葉の使い方が目立つ」）: 「目印ハズセッション」「試行印」「読み書き役」「要なのだ」。hasSession は「ログイン済みかどうかを示す値」、試行印は「再試行を 1 回に限るための値」と仕組みの言葉で言う → S-W2
- **語尾が混ざった**（過去の指摘「ずんだもんの語尾が徹底しきれていない」）: 「〜取るよ。」「〜戻されるんだ。」「〜なのだ。」が混在 → S-M3
- **初めて見る人に分からない語から始めた**（過去の台本の冒頭）: 「題材を渡すと、何が起きて再生ページになるのでしょうか」。視聴者には「題材」「再生ページ」が何か分からない → S-W6
- **名詞の前に説明を重ねた**（過去の台本）: 「進行役がチャットでページを公開する仕組み Artifact に載せ」。内部の呼び名「進行役」が説明なしに出て、長い説明の後ろに名前が来て聞き取れない → S-W5（SP-2）
