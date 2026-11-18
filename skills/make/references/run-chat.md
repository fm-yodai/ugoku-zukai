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

- **意図に照らした判定には、意図のどの文に照らしたかを書く。** `evidence` に、意図の場所（章 `c2` の `intent`、スライド `ux-def` の `link`、`flow`、`basics.knows`）と、その文の引用を入れる。物差しにするのは、構成メモに書かれた意図の文だけである。作り手の番で考えた狙いは、構成メモに書いていなければ使わない
- **構成メモ（O-D）は、先に聴衆になってから読む。** `basics.audience` と `basics.knows` から、聴衆が何を知っていて何を知らないかを書き出し、その聴衆として、意図が聴衆の側から書いてあるか（O-D6）、章の意図をたどると持ち帰ってほしいことに届くか（O-D8）を見る
- **スライド（G-D1・G-D12・A-3）は、字幕を読む前に見る。** 先に、図の宣言と動作だけから流れ（か関係）を書き出す（G-D1）。次に、完成形（見出し・言いたいこと・部品。`<workdir>/frames/svg/slide-<スライドの id>.svg`）だけを見て、この 1 枚が何を言っているかを書き出す（G-D12）。どちらも `evidence` に残し、それから構成メモのスライドの意図と比べる（A-3）。作り手として書いた字幕を先に読むと、声と字幕がなくても読めるかを判定できない
- **原稿（S-W12・S-W13）は、場面ごとに、スライドと字幕を並べて読む。** 字幕が、スライドにも意図にもないことを足していないか、スライドと食い違っていないか（S-W12）、スライドの文字を読み上げるだけになっていないか（S-W13）を見る。スライドの見出しと字幕の言い回しが違うことは、指摘しない
- **スライドのテキストにかける文章の規則は、書き言葉の規則（TW-）だけである。** 話し言葉の規則（SP-）は、字幕と読みにかける
- **事実（O-F1・S-F1・S-F2・S-F5）は、出どころを開き直して照合する。** 行の `source` と、スライドのテキストのブロックの `source`（定義や引用の囲みの出どころ）に書かれたファイルや URL を、評価役の番でもう一度開く（Web ページは取り直す）。作り手の番で `sources/` や `brief.md` に写した引用だけで PASS にしない。開き直せないときは UNKNOWN にする。構成メモの意図は、照合の対象にしない
- **漏れ（O-F2）は、構成メモの章を読み直す前に要点を書き出す。** 利用者が渡した資料から、聴衆が持ち帰るべき要点を 3〜7 項書き出して `evidence` に残し、それから章の意図と比べる
- **「聴衆が知らない語」（O-D3・S-W5）の直し方に、言い換えを書かない。** 規格・原典・業界で決まっている用語はそのまま残し、意味を説明する文を足す案を書く（SP-16）
- **スライドへの指摘の `where` は、そのスライドを最初に使う場面の id にする。** スライドの id と部品の id は、`problem` の頭に書く（`review-format.md` の「`where` の書き方」）

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

- 会話で決めるのは、基本（`basics`）、章の順番の意図（`flow`）、章の意図（`intent`）と章のつながり（`link`）まで。意図は聴衆の側から書く（「ここで聴衆は〜が分かる」）。利用者が必ず入れたいと言った内容は、意図の文に書く
- `--ready` は、スライドを作る前に付ける（`basics` に `audience`・`knows`・`takeaway` があり、章の順番の意図と、どの章にも意図がある）。利用者が言っていない項目は、案を `by: claude`・`state: proposed` で書く
- スライドの意図（章の `slides`）は、台本のスライドと一緒に書く。`proposed` のままスライドコンテに出してよい。章の `seconds` は、章の意図と全体の長さから割り振る
- `--json` の `proposed` が、自分で決めて、利用者がまだ見ていない項目の一覧。スライドコンテを見せるときに、会話で伝える
- 利用者が、進行役の決めたことと意図を全部見て通したら、`check_outline.py <workdir> --agree-all` で `proposed` をまとめて `agreed` にする。一部だけ通したときは、その項目を手で書き換える
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
- Web 検索が使えなければ、利用者に資料を頼む。資料がないまま Claude の知識で書いた事実は、原稿の行とスライドのテキストに `source` なしのまま書く（評価役が「出どころのない記述」として挙げ、どう扱うかを利用者が選ぶ）
- 調べた結果のうち何を動画に入れるかは、利用者と決め、章かスライドの意図に書く（任されたときは自分で決めて `proposed` で書く）
- スライドに使う画像やイラストは、サンドボックスから Web の素材を取れないことがある（届く通信先が限られる）。取れないときは、利用者に画像を渡してもらう（添付は `/mnt/user-data/uploads/` に入る）。渡された画像は `<workdir>/assets/` に写し、台本の画像の `source` に「利用者から渡された」と書く

## 台本と機械検査

作り手として `<workdir>/storyboard.json` を書く（形式は `storyboard.md`。スライドは 8 章、見本は `<skill>/examples/slide-forms.json`）。物差しは構成メモの意図である。スライドを先に書き、原稿を後に書く。

- **スライド**: 章の意図から、その章に要るスライドを切り出す。1 枚ごとに、見出し（字幕の言い回しに合わせず、資料の見出しとして書く）、言いたいこと（この 1 枚で伝えたいことの 1 文）、部品（図・テキスト・画像・フレーム）を置いて、完成形を作る。声と字幕がなくても、資料として読める 1 枚にする。構成が段階的に育つ章や before / after を比べる章は、段階ごとに 1 枚にして、後のスライドの部品に `morph` を書いてつなぐかを、ここで決める（Morph はスライドの並びで決まる。VG-10。見本は `<skill>/examples/camera-morph.json`）
- **スライドの意図**: 台本のスライドと同じ id で、構成メモの章の `slides` に書く（`by: claude`・`state: proposed`）
- **動かし方**: 最初から完成形を見せて `focus` や `blur` で順に説明するか（`start: "complete"`）、行の動作で部品を出して組み上げるかを、スライドごとに選ぶ。密な図の 1〜数個の要素だけを話す行では `zoom` で寄せて、話が全体に戻ったら `{"zoom": "all"}` で戻す（VG-11）。経路や囲みの形を目で追ってほしい線は `show` に `"draw": true` を書く（VG-12）。どれも、意図に合う所でだけ使う
- **原稿**（字幕と読み）: スライドを説明する文にする。スライドの文字を読み上げるだけにしない。意図に書かれたことをスライドか原稿で伝え、意図にない主張を足さない。事実を言う行には `source` を付ける。スライドのテキストに書いた事実にも `source` を付ける
- すべての場面に `chapter`（章の id）を書く。口調は `basics.tone`、言葉は `basics.knows` の聴衆に合わせ、声は `basics.voice` を台本の `voice` に写す
- 原稿を書く前に `references/writing/spoken.md` を読み、書いた後に SP-1〜SP-15 で見直す（1 文ごとに誰が・何を・どうするを書く。語りとして書く。章の切り替わりを見せたいときは章扉を置く）。行の id と章の id は振り直さない

台本を変えるたびに、機械検査を回す（時刻は見積もり）。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json
python3 <skill>/scripts/check_text.py <workdir>/storyboard.json
```

- `--outline` は、場面の章と長さに加えて、構成メモのスライドと台本のスライドが同じ id でそろっているかも見る
- 台本を書き終えたら `--complete` も付ける（場面のない章と、構成メモか台本の片方にしかないスライドが誤りになり、全体の長さも構成メモと比べる）。章の一部だけを書いた段階では付けない
- `check_storyboard.cjs` は警告だけなら終了コード 0。出力に「辺 … に label がない」があれば、意図して省いた辺でなければ label を付ける（G-M2）。章ごとの見積もりの行（`章 c2: 見積もり 28.4 秒（目安 30 秒）`）は、評価役の番で A-4 の判定に使う
- 誤りは、出力に出たものだけを直して回し直す（機械検査の差し戻し。指摘の一覧には載せない）。答えが一つに決まる不具合は利用者に聞かずに直し、直したことを報告する

## スライドコンテと粗い再生ページ

各行の落ち着いたコマと、スライドごとの完成形のコマを書き、スライドコンテのページにまとめる。先に、コマを PNG にする道具を入れる（npm から数 MB。評価役の番で、コマを目で見るために使う。会話ごとに 1 回）。

```sh
python3 <skill>/scripts/setup_render.py
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames --outline <workdir>/outline.json [--voice <workdir>/voice] -o <workdir>/sheet.html --artifact
```

- `setup_render.py` か `frames.cjs` の終了コード 4 は、PNG のシートを作れなかったという意味（SVG と `frames.json` は書けている）。スライドコンテのページは SVG から作るので、そのまま `build_sheet.py` に進める
- **台本を直したら `frames.cjs` を回し直す。** コマが古いと、`build_sheet.py` は書かずに終了コード 2 で止まる
- 直した場面だけを見せるときは、`--scenes` で場面を選び、**別の出力先**に書く（同じ出力先に書くと、全体のコマが消える）

```sh
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes s2,s3
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames-part --outline <workdir>/outline.json -o <workdir>/sheet-part.html --artifact
```

- `<workdir>/sheet.html` は、サンドボックスのファイルをそのまま Artifact として公開して見せる（中身を書き写さない）。`/mnt/user-data/outputs/` があれば、そこへ写してから公開する
- **スライドコンテの Artifact は 1 つにする。** 見せ直すときは、前に公開したスライドコンテの Artifact を更新する。直すたびに新しい Artifact を作らない
- ページに出るのは、スライド・原稿・意図と、位置の札（`s2 / l2 @0:14`）だけである。章ごとに題・章の意図・前の章からのつながり、スライドごとに完成形のコマとスライドの意図、その下に各行のコマと字幕の全文が並ぶ
- 次のことはページに出ないので、見せるときに会話で伝える: 進行役が決めたこと（`check_outline.py --json` の `proposed`）、まだ利用者が見ていない意図があること、まだ決めていないこと（構成メモの `open`）、機械検査と評価役の結果
- スライドコンテは静止画なので、Morph・`zoom`・`draw` の動きは見えない。台本に `morph`（スライドの部品）・`zoom`・`pan`・`"draw": true`（行の動作）があれば、どのスライドが Morph でつながるか、どの行で寄って戻るかを、見せるときに会話で 1〜2 行添える。ページには書かない（メタな文章になるため）

### 案を並べる

進行役が迷ったスライドと、利用者が気に入らないと言ったスライドは、案を 2〜4 つ作って、スライドコンテの中に並べる。案の組に名前（`g1` など）を付け、置き換えるスライドの id（続いて出る 1 枚以上）と、案の名前を渡す。

```sh
python3 <skill>/scripts/alts.py new <workdir> g1 --replaces ux-def --options a,b,c
```

- 案ごとに、今の台本の写し `<workdir>/storyboard.g1-a.json`・`storyboard.g1-b.json`… ができ、`<workdir>/alts.json` に組が足される。ページには「案 A」「案 B」… の名前で出る
- `--keep-current` を付けると、最初の案は今の台本そのものになる（写しを作らない。今のスライドと新しい案を見比べるときに使う）

次に、案の台本を書き換える。変えるのは、置き換える範囲のスライドと、それを使う場面だけにする。1 枚を 2 枚に分ける案、2 枚を 1 枚にまとめる案も書ける。場面と行の id は、範囲の外と重ならないようにする。書いたら、案の台本を検査する（構成メモと合うのは選んだ後なので、`--outline` は付けない）。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.g1-b.json --theme <テーマ>
python3 <skill>/scripts/check_text.py <workdir>/storyboard.g1-b.json
```

`<workdir>/alts.json` の案に、違いが分かる 1 行（`diff`）を書く。スライドの id や枚数を変えた案には、`slides` にスライドの id・意図（`intent`）・つながり（`link`。任意）も書く。`slides` を省いた案は、`replaces` と同じ id のスライドを書き換えた案として扱われ、意図は構成メモのままになる。

```json
{"groups": [{"id": "g1", "replaces": ["ux-def"], "options": [
  {"key": "a", "name": "案 A", "diff": "定義の文を大きく出し、図は小さく添える", "storyboard": "storyboard.g1-a.json", "frames": "alts/g1/a/frames"},
  {"key": "b", "name": "案 B", "diff": "定義と図の 2 枚に分ける", "storyboard": "storyboard.g1-b.json", "frames": "alts/g1/b/frames",
   "slides": [{"id": "ux-def", "intent": "UX の定義の文そのものを読める"},
              {"id": "ux-range", "intent": "UX の範囲が、使う前から使った後までだと分かる", "link": "定義を読んだ後で、範囲を図で見る"}]}]}]}
```

案のコマを書き、スライドコンテを作り直して、前に公開したスライドコンテと**同じ Artifact を更新する**（Artifact を増やさない）。チャットにはローカルのサーバーがないので、見比べはこのページだけで行う。案は、置き換える範囲の位置に横に並んで出る。

```sh
python3 <skill>/scripts/alts.py frames <workdir> --theme <テーマ>
python3 <skill>/scripts/build_sheet.py <workdir>/storyboard.json --frames <workdir>/frames --outline <workdir>/outline.json --alts <workdir>/alts.json -o <workdir>/sheet.html --artifact
```

利用者が「案 B」のように選んだら、選ばれた案を台本と構成メモに入れる。入れたら、機械検査を回し、コマとスライドコンテを作り直して、同じ Artifact を更新する。

```sh
python3 <skill>/scripts/alts.py pick <workdir> g1 b
```

- `pick` は、選んだ案の場面とスライドを今の台本に入れ、構成メモのスライドと意図を合わせ、その組（案の台本とコマ）を片付ける。案の id が範囲の外と重なるか、入れた後の台本に誤りがあると、何も書かずに終了コード 1 で止まる
- どの案も選ばないと決まったら、`alts.py drop <workdir> g1` で片付ける
- 声を合成した後や公開した後の直しでも、案を並べてよい。原稿が違う案の声は、選んでから作る（`pick` は声に触らないので、選んだ後に `tts.py` を回し直す）

動きと間を見たいときは、声なしの粗い再生ページを作って Artifact として見せる（時刻は見積もり）。

```sh
python3 <skill>/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> -o <workdir>/preview.html --artifact
```

## 評価役と指摘の一覧

呼ぶ場面と担当の基準は `criteria/README.md` の表のとおり。チャットでは、その場面の評価役の担当を **1 回にまとめて**判定する。

| 場面 | `target` | まとめて判定する基準 |
|---|---|---|
| 章の意図が固まったとき | `outline` | O-D1〜O-D9、O-F1・O-F2（`criteria/outline.md`） |
| 最初のスライドコンテを見せる前（スライド） | `script` | A-1〜A-5、G-D1〜G-D7、G-D9・G-D10、G-D11〜G-D16、G-D17（Morph）・G-D18（カメラ）・G-D19（線の描画）、S-D1・S-D2・S-D4（`criteria/agreement.md`・`structure.md`・`script.md`） |
| 最初のスライドコンテを見せる前（コマ） | `screen` | V-1〜V-6、G-D5、G-D8（`criteria/screen.md`・`structure.md`） |
| スライドが固まったとき（原稿） | `script` | S-W1〜S-W7、S-W10・S-W11、S-W12・S-W13、S-F1・S-F2・S-F4・S-F5（`criteria/script.md`）。スライドを変えていたら、変えたスライドの A- と G- も |
| 合成の前 | `voice` | S-W8・S-W9（`criteria/script.md`） |
| 直した後 | 元と同じ | 直した項目の再確認（`rechecks`）と、変えた章・スライド・行だけ |

原稿を細かく見るのは、利用者がスライドコンテを見て、スライドが固まった後である。最初のスライドコンテを見せる前の番では、原稿は、意図に書かれたことの在りかを探すとき（A-1）と、動作を見るとき（S-D2）だけ読み、言い回しは見ない。

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

**台本の初稿に限り、1 回だけ先に直す。** 対象は、最初のスライドコンテを見せる前の評価と、スライドが固まった後の原稿の初稿の評価で出た指摘である。

1. 評価役の出力を `ingest` し、`list --full` で本文を読む
2. 合意した内容を変えない指摘（言い回し、読み、スライドの見やすさ、出どころを調べて付けること）を選び、記録してから直す。構成メモの意図（`flow`・`intent`・`link`）・章の順・利用者が見て決めたスライドの切り方を変えることになる指摘は選ばない

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by lead --fix l7:S-W1 s4:G-D14
```

3. 機械検査を通し、評価役の番を宣言して、直したキーの再確認を 1 回だけ行う（`rechecks` だけを書いた `combined.json` を新しい連番のフォルダに書いて `ingest`）。通らなかったものは `open` に戻るので、そのまま利用者に見せる
4. 利用者に見せるのは、残った指摘と、先に直した件数と中身

任されているときは、構成メモの評価（章の意図が固まったとき）で出た指摘も同じに扱う。自分で決めた項目（`proposed`）の言い回しを直す指摘は先に直して再確認を 1 回頼み、意図の中身を変える、章を変える指摘は直さずに、スライドコンテと一緒に見せる。

```sh
python3 <skill>/scripts/ledger.py list <workdir>
python3 <skill>/scripts/ledger.py list <workdir> --by lead
```

利用者がどれを直すかを選んだら、記録してから直す。直したら、直したキーと変えた章・行だけを再確認して `ingest` する。

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by user --fix s4:A-3 --keep l12:S-D4
python3 <skill>/scripts/ledger.py status <workdir>
```

- `list` の出力（must は全文、should は 1 件 1 行、nits は件数だけ）を、そのまま利用者に見せる。求められたら `--full` で開く
- 「同じ箇所に <キー>」と添えられた指摘は、直し方が食い違っていないかを見て、1 つにまとめてから見せる
- 再確認を頼まずに済ませた指摘（評価役の見落とし、利用者が自分の言葉で直した）は、理由を書いて閉じる。公開の前に `status` が「直し中 0」になっているようにする（must を閉じられるのは `--by user` だけ）

```sh
python3 <skill>/scripts/ledger.py decide <workdir> --by lead --close l18:S-W4 --note "read は前から付いていた"
python3 <skill>/scripts/ledger.py decide <workdir> --by user --close s9:V-6 --note "利用者が、説明枠を循環図の上下中央に揃える直し方を選んだ"   # 利用者が違う直し方を選んだときは、未対応のままでも閉じられる
```
- 直しが合意に関わるなら、先に構成メモを直して検査し、それから台本を直す
- `*` で始まるキー（場所の決まらない指摘）は、シェルに展開されないよう引用符で囲む（`--fix '*:V-1'`）
- `status` が「今の台本にも構成メモにもない id を指す指摘」を警告したら、行や章の id を振り直していないかを確かめて戻す

## 声

利用者がスライドコンテを見て、VOICEVOX の利用規約に同意した後に行う。VOICEVOX を入れる（約 94MB を GitHub から。会話ごとに要る）。同意の記録は置き場に残るが、チャットでは会話ごとに置き場が消えるので、会話ごとに同意を取る（同じ会話の中で 2 回目に合成するときは、`setup_voice.py --status` が終了コード 0 なら聞かない）。

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

**1. 箇所を受け取る。** 利用者が Artifact にコメントを付けたと言ったら、そのコメントを会話から読めるかを確認する。読めなければ、再生ページの「直したい箇所を指定する」を開いてコピーした文字（`s2 / l2 @0:14` の形）を、会話に貼ってもらう。

- **「直したい箇所を指定する」は、Artifact を編集できる人にだけ出る。** 見るだけの人には出ない。再生ページが、開いている人が編集できるかを判定できないとき（claude.ai のチャットのプレビューなど）にも出ない。手元で開いた HTML（`--artifact` を付けずに組み立てたページ）では出る
- 「直したい箇所を指定する」が出ないとき、作った本人は、動画の下のチャプターの行に出ている時刻と章で、直したい箇所を伝える（例「2 UX の定義 の 0:39 の行」）。進行役は、時刻と章から場面と行を引く。声を合成してあれば `<workdir>/voice/timeline.json` の `lines`（行の `id`・`scene`・始まりの時刻 `start`）、なければ `<workdir>/frames/frames.json` の `lines` で、その章の場面のうち、始まりの時刻がその時刻に当たる行を探す。引いた行を「s3 / l6 のことですか」と字幕の文と一緒に返して、合っていることを確認してから直す
- チャットのプレビューで、再生ページが編集できる人かどうかを判定できるかは、まだ確認できていない。利用者に「直したい箇所を指定する」を開くよう頼む前に、それがページに出ているかを聞く。出ていなければ、チャプターの行の時刻と章で伝えてもらう

**2. 直す前に、機械検査を 1 回回す。** 直す前からある誤りを、直しで入った誤りと見分けるためである。コマンドは 4 と同じ（声があれば `--timeline` を付ける）。直す前からある誤り（頼まれた範囲の外）は、黙って直さず、利用者に伝えて、直すかを聞く。直さないと決まったら、そのまま進めて、報告に書く。

**3. 行を特定して直す。** 指された id を `<workdir>/storyboard.json` で確かめて直す。`read` のある行の字幕を変えるときは、`text` と `read` の両方を直す。直しが合意に関わるなら、先に `<workdir>/outline.json` を直して `check_outline.py --ready` を通す。

**4. 機械検査。** 文（`text`・`read`）を変えたか、行を足した・消したなら、合成した声が古くなるので、`--timeline` を付けずに回す（付けると「時刻表にない」「音声が古い」の誤りになる）。図や動作だけを変えたら、`--timeline` を付けて回す。

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --outline <workdir>/outline.json --complete [--timeline <workdir>/voice/timeline.json]
python3 <skill>/scripts/check_text.py <workdir>/storyboard.json
```

**5. 変えた場面のコマを作る。** 全体とは別の出力先に書く。図や動作だけの直し（4 で `--timeline` を付けて回せたとき）なら、ここでも `--timeline <workdir>/voice/timeline.json` を付ける（時刻が再生ページと同じになる）。全体のコマ（`<workdir>/frames`）とスライドコンテ（`sheet.html`）は、作り直さなくてよい。

```sh
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames-part --scenes <変えた場面の id をカンマ区切り> [--timeline <workdir>/voice/timeline.json]
```

直しが行の id で来たときは、`--scenes` の代わりに `--lines l8,l33` と書ける（その行のある場面のコマを書く）。

**6. 評価役。** 評価役の番を宣言して、SKILL.md の表の評価役の基準で、変えた行と場面だけを判定する。画面を見るときは、`<workdir>/frames-part` のコマを見る（`<workdir>/frames` は直す前のコマ）。出力は新しい連番の `combined.json` に書いて `ingest` し、指摘が出たら `list` で利用者に見せて選んでもらう（先に直すのは初稿だけなので、ここでは先に直さない）。

**7. 変えた場面を見せる。** 5 のコマからスライドコンテを作り、前に公開したスライドコンテの Artifact を更新して見せる（再生ページの Artifact とは別のページである）。直し方に迷うときは、案を並べて選んでもらう（「案を並べる」）。動きを見せたいときは、粗い再生ページ（`preview.html`）を作る。図や動作だけの直しなら、`build_player.py` に `--voice <workdir>/voice` を付けて、今の声と時刻で見せられる。

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
