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
| `ugoku-zukai:writer` | 台本の初稿、章単位の書き直し、指摘の直し | テーマ（`3b1b`・`flat`・`<workdir>/theme.json`）、書く範囲（「全部」か章の id）、直す指摘のキー（あれば） | `<workdir>/storyboard.json` |
| `ugoku-zukai:fact-checker` | 事実（`outline`・`script`） | `target`、題材の場所（researcher に渡したのと同じ絶対パス。資料のない題材なら「資料なし」）、出力先、再確認するキー、見る範囲。`brief.md` は渡さない | 出力先の JSON |
| `ugoku-zukai:director` | 構成メモ・合意との照合・演出・画面（`outline`・`script`・`screen`） | `target`、出力先、再確認するキー、見る範囲。`script` では `check_storyboard.cjs --outline` の出力 | 出力先の JSON |
| `ugoku-zukai:writing-reviewer` | 文章と読み（`script`・`voice`） | `target`、出力先、再確認するキー、見る範囲 | 出力先の JSON |

評価役の出力先は、呼ぶたびに連番を付けたフォルダにする: `<workdir>/review/<2 桁の連番>-<target>/<評価役の名前>.json`（例 `review/01-outline/director.json`、`review/03-script/fact-checker.json`）。再確認も新しい連番にする。評価役は、同じメッセージで複数呼んで並列にする。

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
テーマ: flat
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
テーマ: flat
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
- 聞くときは AskUserQuestion を使ってよい。決まった質問を並べるのではなく、その話題で聞きたいことだけを聞く

手持ちのデザインに合わせるなら、受け取った資料からテーマを作って検査する（直し方は `themes.md`）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/extract_design.py <資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_theme.py <workdir>/theme.json
```

## 調べる

- リポジトリや長い資料を読む、Web で材料を集める、といった仕事は researcher に任せる。「調べてほしいこと」を問いの形で書いて渡す。返ってくるのは出どころ付きの取材メモ `<workdir>/brief.md` で、何を構成メモに入れるかは進行役と利用者が決める（任されたときは進行役が決めて `proposed` で書く）
- 一言で分かる確認（ファイルが 1 つ、Web ページが 1 つ）は、進行役が自分で読んでよい
- Web 検索が使えなければ、利用者に資料を頼む。資料がないまま Claude の知識で書いた事実は、構成メモに `by: claude` で `source` なしのまま書く（評価役が「出どころのない記述」として挙げ、どう扱うかを利用者が選ぶ）

## 台本と機械検査

台本の初稿と章単位の書き直しは writer に任せる（書く範囲を「全部」か章の id で渡す）。一文の言い回しや動作 1 つの直しは、進行役が `<workdir>/storyboard.json` を直接直す。行の id と章の id は振り直さない。

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
- 絵コンテのページの終わりに「Claude が決めたこと」（`proposed` の項目）が出る。会話でも同じ一覧を添える

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

**台本の初稿に限り、1 回だけ先に直す。**

1. 初稿の評価役の出力を `ingest` し、`list --full` で本文を読む
2. 合意した内容を変えない指摘（言い回し、読み、図の見やすさ、出どころを調べて付けること）を選び、記録してから直す（小さな直しは進行役、まとまった直しは writer にキーを渡す）。構成メモの言うこと（`says`）・見せるもの（`shows`）・章の順を変えることになる指摘は選ばない

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py decide <workdir> --by lead --fix l7:S-W1 l9:G-D3
```

3. 機械検査を通し、指摘を出した評価役に、直したキーの再確認を 1 回だけ頼んで `ingest` する。通らなかったものは `open` に戻るので、そのまま利用者に見せる
4. 利用者に見せるのは、残った指摘と、先に直した件数と中身

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
- どの評価役の指摘かは、`list --full` と `--json` の `reviewer` で分かる（`--reviewer director` で絞れる）
- 直しが合意に関わるなら、先に構成メモを直して検査し、それから台本を直す
- `status` が「今の台本にも構成メモにもない id を指す指摘」を警告したら、writer に「行の id を振り直さない約束」を伝えて戻させる

## 声

利用者が絵コンテを見て、VOICEVOX の利用規約に同意した後に行う。VOICEVOX は `${CLAUDE_PLUGIN_DATA}/voicevox` に 1 回入れれば使い回す。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_voice.py --agree
```

最後に、入っている声の一覧が出る。利用者が選んだ声の番号を一覧で確かめ、`<workdir>/storyboard.json` の `voice.speaker` がその番号になっているかを見て、違えば進行役が直す（番号のほかは変えない）。次に、合成せずに読みの一覧 `<workdir>/voice/readings.md`（行・字幕・読む文・VOICEVOX の読み）を書く。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
```

`tts.py` の終了コード 3 は時間で区切っただけ。0 になるまで同じコマンドを繰り返す。一覧ができたら、writing-reviewer を `target: voice`（読みモード）で呼び、出力を `ingest` する。

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

音声を作らなかったときは `--voice` を外す。「音声が古い」で止まったら、`tts.py` をもう一度実行する。公開は Artifact ツールで、`file_path` に `<workdir>/player.html`、`title` に台本の題名、`icon` に `video` を渡す（書き写さない）。作業フォルダのファイルを受け付けないと言われたら、スクラッチパッドのフォルダに写してから公開する。

## 報告

SKILL.md の「報告」のとおり。残論点と、利用者がまだ見ていない Claude の決定は、次で出す。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py residual <workdir>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_outline.py <workdir> --json
```

「足すべき項目」は、指摘の `suggestion`（`ledger.py list <workdir> --state open,fixing,kept,closed --full` で全部読める）と、`read` を足した行の語から集める。スキルのファイル（`assets/`・`references/`）は書き換えない。
