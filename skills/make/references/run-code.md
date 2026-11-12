# Claude Code での進め方

進行役（このセッション）が利用者と話し、調べる仕事・台本の初稿・評価をサブエージェントに任せる。進め方の原則と「必ず守る条件」は SKILL.md、評価役の約束と指摘の扱いは `review-protocol.md` が正。この文書には、道具ごとのコマンドと、エージェントの呼び方を書く。節の順番は道具の一覧の順で、進める順番ではない。

## パスの書き方

- スクリプトは `${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/…` で書く。SKILL.md の `scripts/…` はこれに読み替える
- シェルで `${CLAUDE_PLUGIN_ROOT}` が空になる（展開されない）ときは、この文書の絶対パスから `skills/make/references/run-code.md` を除いた部分がプラグインのフォルダなので、それを直接書く
- `<workdir>` は「作業フォルダ」の節で `workdir.py` が出した絶対パス。エージェントにも絶対パスで渡す
- シェルの変数や `cd` は次のコマンドに持ち越されない前提で、毎回フルパスで書く

## エージェントと渡すもの

呼び名は `ugoku-zukai:<名前>`。モデルは定義にある（作り手 opus、評価役 sonnet）。どのエージェントにも、作業フォルダの絶対パスを渡す。利用者との会話と、自分の推論は渡さない。animator は呼ばない。

| エージェント | 仕事 | 足して渡すもの | 出力 |
|---|---|---|---|
| `ugoku-zukai:researcher` | 調べる | 題材の場所（手元のファイル・フォルダ・リポジトリは絶対パス。リポジトリの URL なら URL と clone 先 `<workdir>/repo`。PR 番号、Web ページの URL）、**調べてほしいこと** | `<workdir>/brief.md`（出どころ付きの取材メモ）と `<workdir>/sources/` |
| `ugoku-zukai:writer` | 台本の初稿、章単位の書き直し、指摘の直し | テーマ（`koo`・`<workdir>/theme.json`）、書く範囲（「全部」か章の id）、直す指摘のキー（あれば） | `<workdir>/storyboard.json` |
| `ugoku-zukai:fact-checker` | 事実（`outline`・`script`） | `target`、題材の場所（researcher に渡したのと同じ絶対パス。資料のない題材なら「資料なし」）、出力先、再確認するキー、見る範囲。`brief.md` は渡さない | 出力先の JSON |
| `ugoku-zukai:director` | 構成メモ・合意との照合・演出・画面（`outline`・`script`・`screen`） | `target`、出力先、再確認するキー、見る範囲。`script` では `check_storyboard.cjs --outline` の出力。`screen` で一部の場面だけを見てもらうときは、コマの場所（`<workdir>/frames-part`） | 出力先の JSON |
| `ugoku-zukai:writing-reviewer` | 文章と読み（`script`・`voice`） | `target`、出力先、再確認するキー、見る範囲 | 出力先の JSON |

評価役の出力先は、呼ぶたびに連番を付けたフォルダにする: `<workdir>/review/<2 桁の連番>-<target>/<評価役の名前>.json`（例 `review/01-outline/director.json`、`review/03-script/fact-checker.json`）。再確認も新しい連番にする。評価役は、同じメッセージで複数呼んで並列にする。

**エージェントを呼べないとき**（`ugoku-zukai:<名前>` が見つからない。セッションの途中で使えなくなることがある）は、止まらずに次のどちらかで続ける。どちらで続けたかを報告に書く。

- general-purpose のエージェントに、`${CLAUDE_PLUGIN_ROOT}/agents/<名前>.md` を最初に Read させて、その役として働かせる（渡すものと出力先は上の表と同じ）
- それもできなければ、チャットと同じく、進行役が役を順に演じる（`run-chat.md` の「評価役の番」の宣言と、評価役の独立の約束を守る）

頼み方の例:

```text
（researcher に調べてもらう）
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux
題材の場所: なし（題目だけ）
調べてほしいこと: UX とユーザビリティの定義の違い。標準や原典を出どころにして。視聴者は自社の開発部
```

```text
（writer に章を書き直してもらう）
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux
テーマ: koo
書く範囲: c3
直す指摘のキー: c3.1:A-1 l14:S-W5
```

```text
（評価役に再確認してもらう）
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux
target: script
出力先: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux/review/04-script/director.json
再確認するキー: c3.1:A-1 l9:G-D3
見る範囲: 章 c3
```

機械検査の誤りを writer に戻すときは「機械検査の差し戻し」として呼ぶ。書く範囲と指摘のキーは渡さず、作業フォルダ・テーマ・検査の出力（そのまま）だけを渡す。

```text
機械検査の差し戻し
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux
テーマ: koo
検査の出力:
（check_storyboard.cjs・check_text.py の出力をそのまま貼る）
```

## 作業フォルダ

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/workdir.py new <題材の短い名前>
```

出た 1 行が `<workdir>`（`${CLAUDE_PLUGIN_DATA}/runs/<日時>-<名前>`。利用者の作業ツリーの外）。題材が手元にあるなら、その場所を絶対パスで確かめる。作り手にも評価役にも、同じ絶対パスを渡す（作業ツリーのまま読む。pull や checkout はしない）。URL を clone するなら `<workdir>/repo` に置く。

## 構成メモ

利用者と決めたことを、進行役が `<workdir>/outline.json` に書く（形は `outline.md`、見本は `${CLAUDE_PLUGIN_ROOT}/skills/make/examples/outlines/`）。書くたびに検査する。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_outline.py <workdir>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_outline.py <workdir> --ready
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_outline.py <workdir> --json
```

- `--ready` は、台本に進む前に付ける（`basics` に `audience`・`knows`・`takeaway` があり、どの章にも言うことがある）。利用者が言っていない項目は、案を `by: claude`・`state: proposed` で書く
- `--json` の `proposed` が、自分で決めて、利用者がまだ見ていない項目の一覧。利用者に見せるときに使う
- 利用者が「Claude が決めたこと」を全部見て通したら、`check_outline.py <workdir> --agree-all` で `proposed` をまとめて `agreed` にする。一部だけ通したときは、その項目を手で書き換える
- 聞くときは AskUserQuestion を使ってよい。決まった質問を並べるのではなく、その話題で聞きたいことだけを聞く

手持ちのデザインに合わせるなら、受け取った資料からテーマを作って検査する（直し方は `themes.md`）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/extract_design.py <資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_theme.py <workdir>/theme.json --design <workdir>/design-report.json
```

- `theme.json` は下書きを直して作る。同梱のテーマや文書の例から値を写さない。`--design` が、テーマがデザインから外れていないか（背景・本文・強調・字体・影）を見る
- 意味の色（良い・悪い）、字幕の帯、章扉の地も、デザインにある色から決める（`themes.md` の手順 2）。緑や赤がデザインになければ足さない。字幕の帯と章扉の色は、デザインの反転面の色（表紙や章扉に使う暗い色）があればそれを当て、決めた色と理由を、図の色の見本と一緒に利用者に伝える
- 見た目が決まったら、構成メモの `basics.look.theme` に書く（`koo`・`theme.json`）。検査・コマ・組み立ては、`--theme` を省くとこのテーマを使い、違うテーマを渡すと止まる。下のコマンドの `--theme <テーマ>` は省いてよい

## 調べる

- リポジトリや長い資料を読む、Web で材料を集める、といった仕事は researcher に任せる。「調べてほしいこと」を問いの形で書いて渡す。返ってくるのは出どころ付きの取材メモ `<workdir>/brief.md` で、何を構成メモに入れるかは進行役と利用者が決める（任されたときは進行役が決めて `proposed` で書く）
- 一言で分かる確認（ファイルが 1 つ、Web ページが 1 つ）は、進行役が自分で読んでよい
- Web 検索が使えなければ、利用者に資料を頼む。資料がないまま Claude の知識で書いた事実は、構成メモに `by: claude` で `source` なしのまま書く（評価役が「出どころのない記述」として挙げ、どう扱うかを利用者が選ぶ）

## 台本と機械検査

台本の初稿と章単位の書き直しは writer に任せる（書く範囲を「全部」か章の id で渡す）。writer に章や全体の書き直しを頼むときは、閉じた指摘（`ledger.py list <workdir> --state closed`）で直した言い回しを戻さないよう伝える（writer は `review/ledger.json` を読む）。一文の言い回しや動作 1 つの直しは、進行役が `<workdir>/storyboard.json` を直接直す。行の id と章の id は振り直さない。

台本を変えるたびに、機械検査を回す（時刻は見積もり）。

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_text.py <workdir>/storyboard.json
```

- 台本を書き終えたら `--complete` も付ける（場面のない章が誤りになり、全体の長さも構成メモと比べる）。章の一部だけを書いた段階では付けない
- `check_storyboard.cjs` は警告だけなら終了コード 0。出力に「辺 … に label がない」があれば、誤りと同じに直す。章ごとの見積もりの行（`章 c2: 見積もり 28.4 秒（目安 30 秒）`）を含む出力は、`script` の director に渡す（A-4）
- 誤りは、進行役が直すか、機械検査の差し戻しで writer に直させて、検査を回し直す（指摘の一覧には載せない）。答えが一つに決まる不具合は利用者に聞かずに直し、直したことを報告する

## 絵コンテと粗い再生ページ

各行の落ち着いたコマを書き、絵コンテのページにまとめる。初回に、コマを PNG にする道具を入れる（評価役がコマを目で見るため。2 回目からは何もしない）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_render.py
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames --outline <workdir>/outline.json -o <workdir>/sheet.html --artifact
```

- `setup_render.py` か `frames.cjs` の終了コード 4 は、PNG のシートを作れなかったという意味（SVG と `frames.json` は書けている）。絵コンテのページは SVG から作るので、そのまま `build_sheet.py` に進める
- **台本を直したら `frames.cjs` を回し直す。** コマが古いと、`build_sheet.py` は書かずに終了コード 2 で止まる
- 直した場面だけを見せるときは、`--scenes` で場面を選び、**別の出力先**に書く（同じ出力先に書くと、全体のコマが消える）

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes s2,s3
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames-part --outline <workdir>/outline.json -o <workdir>/sheet-part.html --artifact
```

- 絵コンテは Artifact ツールで見せる（`file_path` に `<workdir>/sheet.html`、`title` に「<台本の題> 絵コンテ」、`icon` に `storyboard`。書き写さない）。作業フォルダのファイルを受け付けないと言われたら、スクラッチパッドのフォルダに写してから公開する。利用者が手元のファイルで見たいと言ったら、`--artifact` を外して作り、パスを伝える
- 絵コンテのページの終わりに「Claude が決めたこと」（`proposed` の項目）と「まだ決めていないこと」（構成メモの `open`）が出る。会話でも同じ一覧を添える

動きと間を見たいときは、声なしの粗い再生ページを作って同じように見せる（時刻は見積もり）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> -o <workdir>/preview.html --artifact
```

## 評価役と指摘の一覧

呼ぶ場面と担当の基準は `criteria/README.md` の表のとおり。

| 場面 | `target` | 呼ぶ評価役 |
|---|---|---|
| 章立てが固まったとき | `outline` | director。資料のある題材か、`by` が `source` か `claude` の言うことがあれば fact-checker も |
| 台本の初稿ができたとき | `script` | fact-checker・director・writing-reviewer |
| 絵コンテを見せる前 | `screen` | director |
| 合成の前 | `voice` | writing-reviewer（読みモード） |
| 直した後 | 元と同じ | 指摘を出した評価役。直したキーと、変えた章・行を渡す |

機械検査を通してから呼び、出力を取り込んで、本文を読む。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py ingest <workdir> <workdir>/review/03-script/fact-checker.json <workdir>/review/03-script/director.json <workdir>/review/03-script/writing-reviewer.json
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py list <workdir> --full
```

`screen` で PNG がない（`frames.json` の `png` が false）ときは、director に「PNG がない」と添えて呼ぶ。目で見ないと決められない基準は UNKNOWN になる（最後の報告に「コマの画像なし」と書く）。

**台本の初稿に限り、1 回だけ先に直す。** 対象は、初稿の評価（`script`）と、その台本の最初の絵コンテの評価（`screen`）で出た指摘である。

1. 初稿の評価役の出力を `ingest` し、`list --full` で本文を読む
2. 合意した内容を変えない指摘（言い回し、読み、図の見やすさ、出どころを調べて付けること）を選び、記録してから直す（小さな直しは進行役、まとまった直しは writer にキーを渡す）。構成メモの言うこと（`says`）・見せるもの（`shows`）・章の順を変えることになる指摘は選ばない

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py decide <workdir> --by lead --fix l7:S-W1 l9:G-D3
```

3. 機械検査を通し、指摘を出した評価役に、直したキーの再確認を 1 回だけ頼んで `ingest` する。通らなかったものは `open` に戻るので、そのまま利用者に見せる
4. 利用者に見せるのは、残った指摘と、先に直した件数と中身

任されているときは、構成メモの評価（章立てが固まったとき）で出た指摘も同じに扱う。自分で決めた項目（`proposed`）の言い回しや出どころを直す指摘は先に直して再確認を 1 回頼み、言うことを足す・削る、章を変える指摘は直さずに、絵コンテと一緒に見せる。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py list <workdir>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py list <workdir> --by lead
```

利用者がどれを直すかを選んだら、記録してから直す。直したら、指摘を出した評価役に、直したキーと変えた章・行だけを渡して再確認を頼み、`ingest` する。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py decide <workdir> --by user --fix c3.1:A-1 --keep l12:S-D4
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py status <workdir>
```

- `list` の出力（must は全文、should は 1 件 1 行、nits は件数だけ）を、そのまま利用者に見せる。求められたら `--full` で開く
- 「同じ箇所に <キー>」と添えられた指摘は、直し方が食い違っていないかを見て、1 つにまとめてから見せる
- 再確認を頼まずに済ませた指摘（評価役の見落とし、利用者が自分の言葉で直した）は、理由を書いて閉じる。公開の前に `status` が「直し中 0」になっているようにする（must を閉じられるのは `--by user` だけ）

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py decide <workdir> --by lead --close l18:S-W4 --note "read は前から付いていた"
```
- どの評価役の指摘かは、`list --full` と `--json` の `reviewer` で分かる（`--reviewer director` で絞れる）
- `*` で始まるキー（場所の決まらない指摘）は、シェルに展開されないよう引用符で囲む（`--fix '*:V-1'`）
- 直しが合意に関わるなら、先に構成メモを直して検査し、それから台本を直す
- `status` が「今の台本にも構成メモにもない id を指す指摘」を警告したら、writer に「行の id を振り直さない約束」を伝えて戻させる

## 声

利用者が絵コンテを見た後に行う。VOICEVOX は `${CLAUDE_PLUGIN_DATA}/voicevox` に 1 回入れれば使い回す。利用規約への同意も、入れたときに置き場に記録されるので、先に記録を調べる。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_voice.py --status
```

- 終了コード 0: 入っていて、今の規約への同意の記録がある。**聞かずに進める**（下の `--agree` は実行しない）。報告に「前に同意した利用規約（出力にある日付）のもとで作った」と書く
- 終了コード 3: 出力の理由（入っていない・記録がない・規約か音声モデルの版が変わった）を伝えて、利用者に規約を示し、同意を取ってから次を実行する。もう入っているときは、記録するだけで取り直さない

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_voice.py --agree
```

このコマンドが許可されずに止まったら（利用者の同意を、進行役が代わりに渡すことになるため、自動の許可では通らないことがある）、利用者に、プロンプトで `! python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_voice.py --agree` と打って実行してもらう（`${CLAUDE_PLUGIN_ROOT}` は実際のパスに置き換えて伝える）。VOICEVOX がもう入っているとき（`tts.py --readings` が動く）は、実行しなくてよい。

最後に、入っている声の一覧が出る。名前だけでは声を選べないときは、候補の話者 2〜3 人に同じ 1 文を読ませた、声の試聴のページを作る。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py -o <workdir>/voice --audition 8,2,3 --sample "<聞き比べる 1 文>" --artifact
```

`--sample` は、台本があれば省ける（`tts.py <workdir>/storyboard.json -o <workdir>/voice --audition 8,2,3 --artifact` で、最初の行を読む）。できた `<workdir>/voice/audition.html` を Artifact ツールで見せ（`title` は「声の試聴」、`icon` は `audio`）、番号で選んでもらう。声の試聴も声を作るので、利用規約への同意の後に行う。

利用者が選んだ声の番号を一覧で確かめ、`<workdir>/storyboard.json` の `voice.speaker` がその番号になっているかを見て、違えば進行役が直す（番号のほかは変えない）。次に、合成せずに読みの一覧 `<workdir>/voice/readings.md`（行・字幕・読む文・VOICEVOX の読み）を書く。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
```

`tts.py` の終了コード 3 は時間で区切っただけ。0 になるまで同じコマンドを繰り返す。一覧ができたら、writing-reviewer を `target: voice`（読みモード）で呼び、出力を `ingest` する。一覧の「間」の列に「区切りが多い」と出た行は、1 桁ずつ読ませる区切りなら `read` の読点を中黒（・）に替える（中黒の間は短い）。

読みの指摘は合意した内容を変えないので、`decide --by lead --fix` で記録して、行の `read`（と `<workdir>/voice_dict.json`）だけを直す。字幕 `text` は変えない。直したら `--readings` を回し直し、writing-reviewer に直したキーの再確認を 1 回だけ頼む。通らなかった読みは、最後の報告に書く。

合成する。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
```

終了コード 3 は同じく、0 になるまで繰り返す（合成済みの行は作り直さない）。終わったら実際の声の長さで検査する。

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete --timeline <workdir>/voice/timeline.json
```

誤りか「辺 … に label がない」があれば、動作 `do` だけを直して検査し直す（進行役が直すか、機械検査の差し戻しで writer に `--timeline` の出力を渡す）。`text` か `read` が変わったら、`tts.py`（`--readings` なし）をもう一度実行してから検査し直す。

## 組み立てと公開

機械検査（`check_outline.py --ready`、`check_storyboard.cjs … --outline … --complete`、`check_text.py`）が通っていることを確かめてから組み立てる。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> --voice <workdir>/voice -o <workdir>/player.html --artifact
```

音声を作らなかったときは `--voice` を外す。「音声が古い」で止まったら（合成した後に、文を変えた・行を足した・行を消した）、`tts.py` をもう一度実行する。公開は Artifact ツールで、`file_path` に `<workdir>/player.html`、`title` に台本の題名、`icon` に `video` を渡す（書き写さない）。作業フォルダのファイルを受け付けないと言われたら、スクラッチパッドのフォルダに写してから公開する。

公開したら、公開先を作業フォルダに記録する（`<workdir>/published.json`。別のセッションから直すときに読む）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/workdir.py publish <workdir> --url <Artifact の URL> --theme <テーマ> --source <題材の場所。なければ「なし」>
```

## 公開した後の直し

直しの受け方、流れ、直すものごとの作り直すものと評価役は、SKILL.md の「公開した後の直し」のとおり。ここには、コマンドと、別のセッションから直すときの手順を書く。

**1. 作業フォルダを決める。** 公開したのと同じセッションなら、今の `<workdir>` を使う。別のセッションなら、過去の作業フォルダを一覧する。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/workdir.py list
```

1 件が 2 行で出る（名前・題・公開の回数と日時・URL、その下にパス・テーマ・題材の場所）。題と公開の日時から、利用者に選んでもらう。当てはまるものが 1 つなら、それでよいかを確かめて進む。選んだパスが `<workdir>` になる。`<workdir>/published.json` を読み、テーマ（`theme`）・題材の場所（`source`）・公開先（`url`）を得る。残っている指摘は `ledger.py status <workdir>` で見る。

- 一覧で「未公開」と出る作業フォルダ（公開先の記録がない。この記録の仕組みより前に作ったもの）を直すときは、Artifact の URL とテーマを利用者に聞き（`<workdir>/theme.json` があれば、テーマはそれ）、「組み立てと公開」の `workdir.py publish` で記録してから進める
- 構成メモのない作業フォルダ（`outline.json` がない。前の進め方で作ったもの）では、下のコマンドから `--outline <workdir>/outline.json` と `--complete` を外す。合意の記録がないので、言うことや章を変える直しは、変える前に利用者に確かめる

**2. 直す前に、機械検査を 1 回回す。** 直す前からある誤りを、直しで入った誤りと見分けるためである。コマンドは 4 と同じ（声があれば `--timeline` を付ける）。直す前からある誤り（頼まれた範囲の外）は、黙って直さず、利用者に伝えて、直すかを聞く。直さないと決まったら、そのまま進めて、報告に書く。

**3. 行を特定して直す。** 指された id を `<workdir>/storyboard.json` で確かめる。指された数行の言い回しや動作は、進行役が直す。章単位の書き直しは writer に、書く範囲（章の id）を渡して任せる。`read` のある行の字幕を変えるときは、`text` と `read` の両方を直す。直しが合意に関わるなら、先に `<workdir>/outline.json` を直して `check_outline.py --ready` を通す。

**4. 機械検査。** 文（`text`・`read`）を変えたか、行を足した・消したなら、合成した声が古くなるので、`--timeline` を付けずに回す（付けると「時刻表にない」「音声が古い」の誤りになる）。図や動作だけを変えたら、`--timeline` を付けて回す。

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete [--timeline <workdir>/voice/timeline.json]
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_text.py <workdir>/storyboard.json
```

**5. 変えた場面のコマを作る。** 全体とは別の出力先に書く。図や動作だけの直し（4 で `--timeline` を付けて回せたとき）なら、ここでも `--timeline <workdir>/voice/timeline.json` を付ける（時刻が再生ページと同じになる）。全体のコマ（`<workdir>/frames`）と絵コンテ（`sheet.html`）は、作り直さなくてよい。

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes <変えた場面の id をカンマ区切り> [--timeline <workdir>/voice/timeline.json]
```

直しが行の id で来たときは、`--scenes` の代わりに `--lines l8,l33` と書ける（その行のある場面のコマを書く）。

**6. 評価役。** SKILL.md の表の評価役を呼ぶ。渡すのは、`target`、出力先（新しい連番）、見る範囲（変えた行と場面の id）、前の指摘を直したのなら再確認するキー。出力を `ingest` し、指摘が出たら、いつものとおり `list` で利用者に見せて選んでもらう（先に直すのは初稿だけなので、ここでは先に直さない）。

- 図や動作を変えたときの director は、`script` と `screen` の 2 回呼ぶ。`screen` には、コマの場所として `<workdir>/frames-part` を渡す（`<workdir>/frames` は直す前のコマなので、見せない）
- 字幕を変えたときの writing-reviewer は、`script` で変えた行の文章を見る。読みは、7 で読みの一覧を書いてから `voice` で見る

```text
（図や動作を直した後、director に画面を見てもらう）
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux
target: screen
出力先: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux/review/09-screen/director.json
コマの場所: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261110-1530-ux/frames-part
見る範囲: 場面 s3 の行 l6・l7
```

**7. 変えた場面を見せる。** 5 のコマから絵コンテを作って見せる。再生ページとは別の Artifact でよい（`title` は「<台本の題> 絵コンテ（直した場面）」、`icon` は `storyboard`）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames-part --outline <workdir>/outline.json -o <workdir>/sheet-part.html --artifact
```

動きを見せたいときは、粗い再生ページを作る（`title` は「<台本の題> 下見」、`icon` は `video`）。図や動作だけの直しなら、`--voice <workdir>/voice` を付けて、今の声と時刻で動きを見せられる。文を変えたか、行を足した・消したときは、声なしで作る（時刻は見積もり）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> [--voice <workdir>/voice] -o <workdir>/preview.html --artifact
```

**8. 声。** 利用者が変えた場面を見てから合成する。文を変えた行があれば、先に `--readings` で読みの一覧を書き直し、writing-reviewer に `target: voice` で、変えた行だけを見てもらう。合成のコマンドは初回と同じで、変えていない行は作り直されない。出力の「新しく合成 N 行」を報告に書く。声だけを変える（話者・話速）ときは、台本の `voice` を直して同じコマンドを回す（全行が作り直される）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete --timeline <workdir>/voice/timeline.json
```

図や動作だけの直しでは、`tts.py` は「新しく合成 0 行」で終わる（時刻表を作り直すだけ）。別のセッションでも、VOICEVOX は `${CLAUDE_PLUGIN_DATA}/voicevox` に入っていれば入れ直さない（`tts.py` が「voicevox_core が入っていない」と止まったら、`setup_voice.py --agree` を実行する。同意の記録は `setup_voice.py --status` で分かる）。

**9. 組み立てて、同じ Artifact に公開し直す。** 組み立ては「組み立てと公開」と同じコマンド。同じセッションなら、同じ `file_path` で公開し直す（同じページが更新される）。別のセッションなら、Artifact ツールの `url` に `published.json` の `url` を渡す（`title` と `icon` は渡さない。前のままになる）。更新の前に今のページを読むよう求められたら、読んでから公開する（公開するのは、組み立て直した `<workdir>/player.html`）。再生ページは、新しいページを作らない。公開し直したら、記録を更新する（テーマを変えたら `--theme` も渡す）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/workdir.py publish <workdir> --url <同じ URL>
```

## 報告

SKILL.md の「報告」のとおり。残論点と、利用者がまだ見ていない Claude の決定は、次で出す。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py residual <workdir>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_outline.py <workdir> --json
```

「足すべき項目」は、指摘の `suggestion`（`ledger.py list <workdir> --state open,fixing,kept,closed --full` で全部読める）と、`read` を足した行の語から集める。スキルのファイル（`assets/`・`references/`）は書き換えない。
