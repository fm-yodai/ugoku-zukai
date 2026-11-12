# チャット（claude.ai / Claude Desktop）での進め方

サブエージェントがないので、1 つの会話で進行役・作り手・評価役を順に演じる。進め方の原則と「必ず守る条件」は SKILL.md、評価役の約束と指摘の扱いは `review-protocol.md`（「チャットでの回し方」）が正。この文書には、道具ごとのコマンドと、チャットの約束を書く。節の順番は道具の一覧の順で、進める順番ではない。

## パスの書き方

- SKILL.md とこの文書の `scripts/…` は、スキルのフォルダ（SKILL.md のある場所）からの相対パス。スキルのフォルダは書き込めないことがあるので、作業フォルダは会話の作業ディレクトリに作り、スクリプトはスキルのフォルダの絶対パスを頭に付けて呼ぶ
- 下のコマンドでは、スキルのフォルダを `<skill>`、作業フォルダの絶対パスを `<workdir>` と書く。どちらも「作業フォルダ」の節で調べた絶対パスに置き換えて、毎回そのまま書く（シェルの変数や `cd` は次のコマンドに持ち越されない前提）

## サンドボックスの約束

- シェルは sh。`time`、`${PIPESTATUS}`、`[[ ]]`、`<( )` など bash だけの書き方を使わない
- CPU 1 つ・メモリ 4GB、chromium はない。届く通信先は GitHub・PyPI・npm など（jsDelivr には届かない）
- 長いコマンドは止められる。1 回のコマンドを短くし、区切りのあるスクリプト（`tts.py`）は終了コード 3 の間、同じコマンドを繰り返す
- VOICEVOX とコマの描画の道具は、会話ごとに入れ直す（会話をまたいで残らない）
- 作業フォルダは会話が変わると消える。直しは、作ったのと同じ会話の中で受ける（「公開した後の直し」の節）

## 評価役の番の宣言

評価役を演じる番の始めに、必ず次を書いてから判定に入る。

> ここからは評価役として、作り手の推論と利用者との会話を使わず、基準のファイル・資料・構成メモ・台本だけで判定する。

取材メモ（`brief.md`）と、作り手として考えた理由は判定の根拠にしない。評価役の定義（スキルの zip には入っていない）の代わりに、`references/criteria/README.md` と、その場面の基準のファイル、`references/review-protocol.md`、`references/writing/review-format.md`（文章を見るときは `references/writing/rules.md`・`spoken.md` も）を読んでから判定する。同じ会話ですでに読んでいれば、読み直さなくてよい。

判定のしかたで、基準の表に書いていないこと:

- **事実（O-F1・S-F1・S-F2）は、出どころを開き直して確かめる。** `source` に書かれたファイルや URL を、評価役の番でもう一度開く（Web ページは取り直す）。作り手の番で `sources/` や `brief.md` に写した引用だけで PASS にしない。開き直せないときは UNKNOWN にする
- **漏れ（O-F2）は、構成メモの章を読み直す前に要点を書き出す。** 利用者が渡した資料から、視聴者が持ち帰るべき要点を 3〜7 項書き出して `evidence` に残し、それから構成メモと比べる
- **「視聴者が知らない語」（O-D3・S-W5）の直し方に、言い換えを書かない。** 規格・原典・業界で決まっている用語はそのまま残し、意味を説明する文を足す案を書く（SP-16）
- **図（G-D1）は、字幕を読む前に復元する。** 図の宣言と動作だけから流れ（か関係）を書き出して `evidence` に残し、それから構成メモの言うことと比べる

## 作業フォルダ

スキルのフォルダを探す。まず `/mnt/skills` の下で、`scripts/build_player.py` と `player/template.html` の両方があるフォルダを挙げる。

```sh
for d in /mnt/skills/*/make /mnt/skills/*/*/make; do [ -f "$d/scripts/build_player.py" ] && [ -f "$d/player/template.html" ] && echo "$d"; done
```

1 つも出なければ、ほかの場所を探す。見つけた `player/template.html` の 2 つ上のフォルダに `scripts/build_player.py` もあるものだけを候補にする。

```sh
find / -xdev -path "*/make/player/template.html" -not -path "*/uz-work/*" -not -path "/mnt/user-data/*" 2>/dev/null | while read f; do d="${f%/player/template.html}"; [ -f "$d/scripts/build_player.py" ] && echo "$d"; done
```

候補がちょうど 1 つならそれが `<skill>`。2 つ以上残ったら、先へ進まずに利用者にどれを使うか聞く。次に作業フォルダを、動画ごとに 1 つ作る（同じ会話で 2 本目を作るときに前の指摘の一覧を引き継がないよう、`<題材の短い名前>` は英数字とハイフンで、前と違う名前にする。すでにあれば `-2` を付ける）。

```sh
mkdir -p uz-work/<題材の短い名前>/sources uz-work/<題材の短い名前>/review
realpath uz-work/<題材の短い名前>
```

最後の出力が `<workdir>`。題材のファイルが添付されていれば `/mnt/user-data/uploads/` にある。zip なら作業フォルダに展開して資料にする（`unzip` がなくても動く）。以後、作り手としても評価役としても、資料は展開した `<workdir>/src` の下を読む（`git archive` の zip には `.git` が無いので、`git ls-files` などに頼らず、ファイルの一覧は `find <workdir>/src -type f` で取る）。

```sh
python3 -m zipfile -e /mnt/user-data/uploads/<添付>.zip <workdir>/src
```

## 構成メモ

利用者と決めたことを `<workdir>/outline.json` に書く（形は `outline.md`、見本は `<skill>/examples/outlines/`）。書くたびに検査する。

```sh
python3 <skill>/scripts/check_outline.py <workdir>
python3 <skill>/scripts/check_outline.py <workdir> --ready
python3 <skill>/scripts/check_outline.py <workdir> --json
```

- `--ready` は、台本に進む前に付ける（`basics` に `audience`・`knows`・`takeaway` があり、どの章にも言うことがある）。利用者が言っていない項目は、案を `by: claude`・`state: proposed` で書く
- `--json` の `proposed` が、自分で決めて、利用者がまだ見ていない項目の一覧。利用者に見せるときに使う
- 利用者が「Claude が決めたこと」を全部見て通したら、`check_outline.py <workdir> --agree-all` で `proposed` をまとめて `agreed` にする。一部だけ通したときは、その項目を手で書き換える
- 聞くときは、質問のフォーム（ask_user_input など）があれば使ってよい。フォームに決まった質問を並べるのではなく、その話題で聞きたいことだけを聞く

手持ちのデザインに合わせるなら、受け取った資料からテーマを作って検査する（直し方は `themes.md`）。

```sh
python3 <skill>/scripts/extract_design.py <資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 <skill>/scripts/check_theme.py <workdir>/theme.json --design <workdir>/design-report.json
```

- `theme.json` は下書きを直して作る。同梱のテーマや文書の例から値を写さない。`--design` が、テーマがデザインから外れていないか（背景・本文・強調・字体・影）を見る
- 意味の色（良い・悪い）、字幕の帯、章扉の地も、デザインにある色から決める（`themes.md` の手順 2）。緑や赤がデザインになければ足さない。字幕の帯と章扉の色は、デザインの反転面の色（表紙や章扉に使う暗い色）があればそれを当て、決めた色と理由を、図の色の見本と一緒に利用者に伝える
- 見た目が決まったら、構成メモの `basics.look.theme` に書く（`koo`・`theme.json`）。検査・コマ・組み立ては、`--theme` を省くとこのテーマを使い、違うテーマを渡すと止まる。下のコマンドの `--theme <テーマ>` は省いてよい

## 調べる

- 資料を渡されたら、自分で読む。分かったことは出どころ（`path:line`、URL と引用など）を付けて `<workdir>/brief.md` に書き、Web の資料は要点と引用を `<workdir>/sources/` に保存する
- 題目だけのときは、Web 検索の道具があれば使う（サンドボックスの通信とは別の道具）。一次資料（標準・原典・公式の説明）を優先する
- Web 検索が使えなければ、利用者に資料を頼む。資料がないまま Claude の知識で書いた事実は、構成メモに `by: claude` で `source` なしのまま書く（評価役が「出どころのない記述」として挙げ、どう扱うかを利用者が選ぶ）
- 調べた結果のうち何を動画に入れるかは、利用者と決める（任されたときは自分で決めて `proposed` で書く）

## 台本と機械検査

作り手として `<workdir>/storyboard.json` を書く（形式は `storyboard.md`、見本は `<skill>/examples/`）。物差しは構成メモ。各章の言うことをすべて字幕で言い、構成メモにない主張を足さない。すべての場面に `chapter`（章の id）を書く。口調は `basics.tone`、言葉は `basics.knows` の視聴者に合わせ、声は `basics.voice` を台本の `voice` に写す。書く前に `references/writing/spoken.md` を読み、書いた後に SP-1〜SP-15 で見直す（1 文ごとに誰が・何を・どうするを書く。言うことを 1 行ずつ並べず、語りとして書く。章が 3 つ以上あれば章扉を置く）。行の id と章の id は振り直さない。

台本を変えるたびに、機械検査を回す（時刻は見積もり）。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json
python3 <skill>/scripts/check_text.py <workdir>/storyboard.json
```

- 台本を書き終えたら `--complete` も付ける（場面のない章が誤りになり、全体の長さも構成メモと比べる）。章の一部だけを書いた段階では付けない
- `check_storyboard.cjs` は警告だけなら終了コード 0。出力に「辺 … に label がない」があれば、誤りと同じに直す。章ごとの見積もりの行（`章 c2: 見積もり 28.4 秒（目安 30 秒）`）は、評価役の番で A-4 の判定に使う
- 誤りは、出力に出たものだけを直して回し直す（機械検査の差し戻し。指摘の一覧には載せない）。答えが一つに決まる不具合は利用者に聞かずに直し、直したことを報告する

## 絵コンテと粗い再生ページ

各行の落ち着いたコマを書き、絵コンテのページにまとめる。先に、コマを PNG にする道具を入れる（npm から数 MB。評価役の番で、コマを目で見るために使う。会話ごとに 1 回）。

```sh
python3 <skill>/scripts/setup_render.py
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames --outline <workdir>/outline.json -o <workdir>/sheet.html --artifact
```

- `setup_render.py` か `frames.cjs` の終了コード 4 は、PNG のシートを作れなかったという意味（SVG と `frames.json` は書けている）。絵コンテのページは SVG から作るので、そのまま `build_sheet.py` に進める
- **台本を直したら `frames.cjs` を回し直す。** コマが古いと、`build_sheet.py` は書かずに終了コード 2 で止まる
- 直した場面だけを見せるときは、`--scenes` で場面を選び、**別の出力先**に書く（同じ出力先に書くと、全体のコマが消える）

```sh
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes s2,s3
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames-part --outline <workdir>/outline.json -o <workdir>/sheet-part.html --artifact
```

- `<workdir>/sheet.html` は、サンドボックスのファイルをそのまま Artifact として公開して見せる（中身を書き写さない）。`/mnt/user-data/outputs/` があれば、そこへ写してから公開する
- 絵コンテのページの終わりに「Claude が決めたこと」（`proposed` の項目）と「まだ決めていないこと」（構成メモの `open`）が出る。会話でも同じ一覧を添える

動きと間を見たいときは、声なしの粗い再生ページを作って Artifact として見せる（時刻は見積もり）。

```sh
python3 <skill>/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> -o <workdir>/preview.html --artifact
```

## 評価役と指摘の一覧

呼ぶ場面と担当の基準は `criteria/README.md` の表のとおり。チャットでは、その場面の評価役の担当を **1 回にまとめて**判定する。

| 場面 | `target` | まとめて判定する基準 |
|---|---|---|
| 章立てが固まったとき | `outline` | O-D1〜O-D5、O-F1〜O-F3（`criteria/outline.md`） |
| 台本の初稿ができたとき | `script` | S-F1・S-F2・S-F4、A-1〜A-4、S-D1・S-D2・S-D4、G-D1〜G-D7・G-D9・G-D10、S-W1〜S-W7・S-W10・S-W11（`criteria/agreement.md`・`script.md`・`structure.md`） |
| 絵コンテを見せる前 | `screen` | V-1〜V-5、G-D5、G-D8（`criteria/screen.md`・`structure.md`） |
| 合成の前 | `voice` | S-W8・S-W9（`criteria/script.md`） |
| 直した後 | 元と同じ | 直した項目の再確認（`rechecks`）と、変えた章と行だけ |

手順:

1. 機械検査を通しておく
2. 評価役の番を宣言し、基準のファイルを読み直す
3. 全基準の判定を 1 つのファイルに書く。出力先は、呼ぶたびに連番を付けたフォルダ `<workdir>/review/<2 桁の連番>-<target>/combined.json`（例 `review/01-outline/combined.json`、`review/02-script/combined.json`。再確認も新しい連番にする）。形は `review-format.md` のとおりで、`reviewer` は `combined`
4. 取り込んで、本文を読む

```sh
python3 <skill>/scripts/ledger.py ingest <workdir> <workdir>/review/02-script/combined.json
python3 <skill>/scripts/ledger.py list <workdir> --full
```

`screen` の判定では、`<workdir>/frames/frames.json` を読み、`png` が true なら `sheets` に載ったシートだけを目で見る。PNG がない（`png` が false）ときは、SVG と `frames.json` だけで判定できる基準を判定し、目で見ないと決められない基準は UNKNOWN にする（最後の報告に「コマの画像なし」と書く）。

**台本の初稿に限り、1 回だけ先に直す。** 対象は、初稿の評価（`script`）と、その台本の最初の絵コンテの評価（`screen`）で出た指摘である。

1. 初稿の評価役の出力を `ingest` し、`list --full` で本文を読む
2. 合意した内容を変えない指摘（言い回し、読み、図の見やすさ、出どころを調べて付けること）を選び、記録してから直す。構成メモの言うこと（`says`）・見せるもの（`shows`）・章の順を変えることになる指摘は選ばない

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by lead --fix l7:S-W1 l9:G-D3
```

3. 機械検査を通し、評価役の番を宣言して、直したキーの再確認を 1 回だけ行う（`rechecks` だけを書いた `combined.json` を新しい連番のフォルダに書いて `ingest`）。通らなかったものは `open` に戻るので、そのまま利用者に見せる
4. 利用者に見せるのは、残った指摘と、先に直した件数と中身

任されているときは、構成メモの評価（章立てが固まったとき）で出た指摘も同じに扱う。自分で決めた項目（`proposed`）の言い回しや出どころを直す指摘は先に直して再確認を 1 回頼み、言うことを足す・削る、章を変える指摘は直さずに、絵コンテと一緒に見せる。

```sh
python3 <skill>/scripts/ledger.py list <workdir>
python3 <skill>/scripts/ledger.py list <workdir> --by lead
```

利用者がどれを直すかを選んだら、記録してから直す。直したら、直したキーと変えた章・行だけを再確認して `ingest` する。

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by user --fix c3.1:A-1 --keep l12:S-D4
python3 <skill>/scripts/ledger.py status <workdir>
```

- `list` の出力（must は全文、should は 1 件 1 行、nits は件数だけ）を、そのまま利用者に見せる。求められたら `--full` で開く
- 「同じ箇所に <キー>」と添えられた指摘は、直し方が食い違っていないかを見て、1 つにまとめてから見せる
- 再確認を頼まずに済ませた指摘（評価役の見落とし、利用者が自分の言葉で直した）は、理由を書いて閉じる。公開の前に `status` が「直し中 0」になっているようにする（must を閉じられるのは `--by user` だけ）

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by lead --close l18:S-W4 --note "read は前から付いていた"
```
- 直しが合意に関わるなら、先に構成メモを直して検査し、それから台本を直す
- `*` で始まるキー（場所の決まらない指摘）は、シェルに展開されないよう引用符で囲む（`--fix '*:V-1'`）
- `status` が「今の台本にも構成メモにもない id を指す指摘」を警告したら、行や章の id を振り直していないかを確かめて戻す

## 声

利用者が絵コンテを見て、VOICEVOX の利用規約に同意した後に行う。VOICEVOX を入れる（約 94MB を GitHub から。会話ごとに要る）。同意の記録は置き場に残るが、チャットでは会話ごとに置き場が消えるので、会話ごとに同意を取る（同じ会話の中で 2 回目に合成するときは、`setup_voice.py --status` が終了コード 0 なら聞かない）。

```sh
python3 <skill>/scripts/setup_voice.py --agree
```

最後に、入っている声の一覧が出る。名前だけでは声を選べないときは、候補の話者 2〜3 人に同じ 1 文を読ませた、声の試聴のページを作る。

```sh
python3 <skill>/scripts/tts.py -o <workdir>/voice --audition 8,2,3 --sample "<聞き比べる 1 文>" --artifact
```

`--sample` は、台本があれば省ける（`tts.py <workdir>/storyboard.json -o <workdir>/voice --audition 8,2,3 --artifact` で、最初の行を読む）。できた `<workdir>/voice/audition.html` を、サンドボックスのファイルのまま Artifact として公開して見せ、番号で選んでもらう。声の試聴も声を作るので、利用規約への同意の後に行う。

利用者が選んだ声の番号を一覧で確かめ、`<workdir>/storyboard.json` の `voice.speaker` がその番号になっているかを見て、違えば直す（番号のほかは変えない）。次に、合成せずに読みの一覧を書く。

```sh
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
```

`tts.py` が終了コード 3 で終わったら、0 になるまで同じコマンドを繰り返す（100 秒ずつ区切って進む）。`<workdir>/voice/readings.md` ができたら、評価役の番を宣言して、読みの一覧を S-W8・S-W9 で判定し（`target` は `voice`）、`combined.json` に書いて `ingest` する。一覧の「間」の列に「区切りが多い」と出た行は、1 桁ずつ読ませる区切りなら `read` の読点を中黒（・）に替える（中黒の間は短い）。

読みの指摘は合意した内容を変えないので、`decide --by lead --fix` で記録して、行の `read`（と `<workdir>/voice_dict.json`）だけを直す。字幕 `text` は変えない。直したら `--readings` を回し直し、直したキーの再確認を 1 回だけ行う。通らなかった読みは、最後の報告に書く。

合成する。

```sh
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
```

終了コード 3 は同じく、0 になるまで繰り返す（合成済みの行は作り直さない）。終わったら実際の声の長さで検査する。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete --timeline <workdir>/voice/timeline.json
```

誤りか「辺 … に label がない」があれば、動作 `do` だけを直して検査し直す（機械検査の差し戻し）。`text` か `read` を変えたら、`tts.py`（`--readings` なし）をもう一度実行する。

## 組み立てと公開

機械検査（`check_outline.py --ready`、`check_storyboard.cjs … --outline … --complete`、`check_text.py`）が通っていることを確かめてから組み立てる。

```sh
python3 <skill>/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> --voice <workdir>/voice -o <workdir>/player.html --artifact
```

音声を作らなかったときは `--voice` を外す。「音声が古い」で止まったら（合成した後に、文を変えた・行を足した・行を消した）、`tts.py` をもう一度実行する。`<workdir>/player.html` は、サンドボックスのファイルをそのまま Artifact として公開する（中身を書き写さない。長いので写すと壊れる）。`/mnt/user-data/outputs/` があれば、そこへ写してから公開する。チャットのプレビューでは audio 要素が鳴らないが、プレーヤーは WebAudio で鳴らすので問題ない。

## 公開した後の直し

直しの受け方、流れ、直すものごとの作り直すものと評価役は、SKILL.md の「公開した後の直し」のとおり。チャットでは、公開したのと同じ会話の中だけで直しを受ける（会話が変わると作業フォルダが消える）。公開先の記録と作業フォルダの一覧（`workdir.py` の `publish`・`list`）は使わない。

**1. 箇所を受け取る。** 利用者が Artifact にコメントを付けたと言ったら、そのコメントを会話から読めるかを確かめる。読めなければ、再生ページの「直したい箇所を指定する」を開いてコピーした文字（`s2 / l2 @0:14` の形）を、会話に貼ってもらう。

**2. 直す前に、機械検査を 1 回回す。** 直す前からある誤りを、直しで入った誤りと見分けるためである。コマンドは 4 と同じ（声があれば `--timeline` を付ける）。直す前からある誤り（頼まれた範囲の外）は、黙って直さず、利用者に伝えて、直すかを聞く。直さないと決まったら、そのまま進めて、報告に書く。

**3. 行を特定して直す。** 指された id を `<workdir>/storyboard.json` で確かめて直す。`read` のある行の字幕を変えるときは、`text` と `read` の両方を直す。直しが合意に関わるなら、先に `<workdir>/outline.json` を直して `check_outline.py --ready` を通す。

**4. 機械検査。** 文（`text`・`read`）を変えたか、行を足した・消したなら、合成した声が古くなるので、`--timeline` を付けずに回す（付けると「時刻表にない」「音声が古い」の誤りになる）。図や動作だけを変えたら、`--timeline` を付けて回す。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete [--timeline <workdir>/voice/timeline.json]
python3 <skill>/scripts/check_text.py <workdir>/storyboard.json
```

**5. 変えた場面のコマを作る。** 全体とは別の出力先に書く。図や動作だけの直し（4 で `--timeline` を付けて回せたとき）なら、ここでも `--timeline <workdir>/voice/timeline.json` を付ける（時刻が再生ページと同じになる）。全体のコマ（`<workdir>/frames`）と絵コンテ（`sheet.html`）は、作り直さなくてよい。

```sh
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes <変えた場面の id をカンマ区切り> [--timeline <workdir>/voice/timeline.json]
```

直しが行の id で来たときは、`--scenes` の代わりに `--lines l8,l33` と書ける（その行のある場面のコマを書く）。

**6. 評価役。** 評価役の番を宣言して、SKILL.md の表の評価役の基準で、変えた行と場面だけを判定する。画面を見るときは、`<workdir>/frames-part` のコマを見る（`<workdir>/frames` は直す前のコマ）。出力は新しい連番の `combined.json` に書いて `ingest` し、指摘が出たら `list` で利用者に見せて選んでもらう（先に直すのは初稿だけなので、ここでは先に直さない）。

**7. 変えた場面を見せる。** 5 のコマから絵コンテを作り、Artifact として見せる（再生ページとは別のページでよい）。動きを見せたいときは、粗い再生ページ（`preview.html`）を作る。図や動作だけの直しなら、`build_player.py` に `--voice <workdir>/voice` を付けて、今の声と時刻で見せられる。

```sh
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames-part --outline <workdir>/outline.json -o <workdir>/sheet-part.html --artifact
```

**8. 声。** 利用者が変えた場面を見てから合成する。文を変えた行があれば、先に `--readings` で読みの一覧を書き直し、評価役の番を宣言して、変えた行の読みだけを判定する（`target` は `voice`）。合成のコマンドは初回と同じで、変えていない行は作り直されない。出力の「新しく合成 N 行」を報告に書く（図や動作だけの直しなら「新しく合成 0 行」）。

```sh
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete --timeline <workdir>/voice/timeline.json
```

**9. 組み立てて、同じ Artifact に公開し直す。** 組み立ては「組み立てと公開」と同じコマンド。前に公開した再生ページの Artifact を更新する。新しい Artifact を作らない。

## 報告

SKILL.md の「報告」のとおり。残論点と、利用者がまだ見ていない Claude の決定は、次で出す。

```sh
python3 <skill>/scripts/ledger.py residual <workdir>
python3 <skill>/scripts/check_outline.py <workdir> --json
```

claude.ai ではスキルのフォルダに書き込めないので、「足すべき項目」は報告に書くだけにする（指摘の `suggestion` と、`read` を足した語から集める。`ledger.py list <workdir> --state open,fixing,kept,closed --full` で全部読める）。
