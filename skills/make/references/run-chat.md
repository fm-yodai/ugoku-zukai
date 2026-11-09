# チャット（claude.ai / Claude Desktop）での進め方

サブエージェントがないので、1 つの会話で進行役・作り手・評価役を順に演じる。流れの番号と名前は SKILL.md と同じ。周回の約束の正は `loop-protocol.md`（「チャットでの回し方」）。

## パスの書き方

- SKILL.md とこの文書の `scripts/…` は、スキルのフォルダ（SKILL.md のある場所）からの相対パス。スキルのフォルダは書き込めないことがあるので、作業フォルダは会話の作業ディレクトリに作り、スクリプトはスキルのフォルダの絶対パスを頭に付けて呼ぶ
- 下のコマンドでは、スキルのフォルダを `<skill>`、作業フォルダの絶対パスを `<workdir>` と書く。どちらも 0 準備で調べた絶対パスに置き換えて、毎回そのまま書く（シェルの変数や `cd` は次のコマンドに持ち越されない前提）

## サンドボックスの約束

- シェルは sh。`time`、`${PIPESTATUS}`、`[[ ]]`、`<( )` など bash だけの書き方を使わない
- CPU 1 つ・メモリ 4GB、chromium はない。届く通信先は GitHub・PyPI・npm など（jsDelivr には届かない）
- 長いコマンドは止められる。1 回のコマンドを短くし、区切りのあるスクリプト（`tts.py`）は終了コード 3 の間、同じコマンドを繰り返す
- VOICEVOX とコマの描画の道具は、会話ごとに入れ直す（会話をまたいで残らない）

## 評価役の番の宣言

評価役を演じる番の始めに、必ず次を書いてから判定に入る。

> ここからは評価役として、作り手の推論を使わず、基準ファイル・一次資料・成果物だけで判定する。

取材メモ（`brief.md`）と、作り手として考えた理由は判定の根拠にしない。評価役の定義（スキルの zip には入っていない）の代わりに、基準ファイル `references/criteria/`・`references/writing/rules.md`・`references/writing/review-format.md` を読み直してから判定する。

## 1 周の回し方（2・4・5 で共通。6 の読みは 1 周だけで、下の 6 音声）

1. 作り手として作る（N≥2 は台帳 `review/ledger.json` の open の項目に応答して直し、`<workdir>/review/<phase>/r<N>/responses.json` を書いて取り込む）

```sh
python3 <skill>/scripts/ledger.py respond <workdir> <phase> <workdir>/review/<phase>/r<N>/responses.json
```

2. 機械検査（段ごとに下に書く）。誤りがあれば作り手に戻って、出力に出た誤りだけを直す（機械検査の差し戻し。応答 `responses.json` は書かない。同じ周で 5 回まで）
3. 宣言をしてから、評価役を **1 回にまとめて**演じる。その段の評価役の担当（下の表）をすべて判定し、全基準の判定を 1 つのファイル `<workdir>/review/<phase>/r<N>/combined.json` に書く。形は `review-format.md` の checker の出力と同じで、`reviewer` は `combined`
4. 取り込んで判定する。**判定には必ず `--max-rounds 2` を付ける**（6 の読みは `--max-rounds 1`）

```sh
python3 <skill>/scripts/ledger.py ingest <workdir> <phase> <workdir>/review/<phase>/r<N>/combined.json
python3 <skill>/scripts/ledger.py status <workdir> <phase> --max-rounds 2
```

5. status の終了コードで決める: 0（PASS）→ 次の段へ / 10（CONTINUE）→ N を 1 足して 1 に戻る / 20〜22（STOP_*）→ 打ち切って次の段へ。`ingest` と `respond` の要約は最大の周を見ていないので、判断に使わない

| 段 | フェーズ名 | まとめて演じる評価役 | 基準 |
|---|---|---|---|
| 2 取材と契約 | `contract` | fact-checker（契約モード）・director（構造モード） | `criteria/contract.md` |
| 4 台本 | `script` | writing-reviewer・fact-checker（台本モード）・director（計画モード） | `criteria/script.md`・`structure.md` |
| 5 画面 | `screen` | director（画面モード） | `criteria/screen.md`・`structure.md` |
| 6 音声 | `voice` | writing-reviewer（読みモード）だけ（判定は 1 回だけ。下の 6 音声） | `criteria/script.md` の S-W8・S-W9 |

## 0 準備

スキルのフォルダを探す。まず `/mnt/skills` の下で、`scripts/build_player.py` と `player/template.html` の両方があるフォルダを挙げる。

```sh
for d in /mnt/skills/*/make /mnt/skills/*/*/make; do [ -f "$d/scripts/build_player.py" ] && [ -f "$d/player/template.html" ] && echo "$d"; done
```

1 つも出なければ、ほかの場所を探す。見つけた `player/template.html` の 2 つ上のフォルダに `scripts/build_player.py` もあるものだけを候補にする。

```sh
find / -xdev -path "*/make/player/template.html" -not -path "*/uz-work/*" -not -path "/mnt/user-data/*" 2>/dev/null | while read f; do d="${f%/player/template.html}"; [ -f "$d/scripts/build_player.py" ] && echo "$d"; done
```

候補がちょうど 1 つならそれが `<skill>`。2 つ以上残ったら、先へ進まずにユーザーにどれを使うか聞く。次に作業フォルダを、動画ごとに 1 つ作る（同じ会話で 2 本目を作るときに前の台帳を引き継がないよう、`<題材の短い名前>` は英数字とハイフンで、前と違う名前にする。すでにあれば `-2` を付ける）。

```sh
mkdir -p uz-work/<題材の短い名前>/sources uz-work/<題材の短い名前>/review
realpath uz-work/<題材の短い名前>
```

最後の出力が `<workdir>`。題材のファイルが添付されていれば `/mnt/user-data/uploads/` にある。zip なら作業フォルダに展開して一次資料にする（`unzip` がなくても動く）。以後、作り手としても評価役としても、一次資料は展開した `<workdir>/src` の下を読む（`git archive` の zip には `.git` が無いので、`git ls-files` などに頼らず、ファイルの一覧は `find <workdir>/src -type f` で取る）:

```sh
python3 -m zipfile -e /mnt/user-data/uploads/<添付>.zip <workdir>/src
```

## 1 インタビュー

質問のフォーム（ask_user_input など）があれば使い、なければ文章でまとめて聞く。答えを `<workdir>/interview.md` に書く（読者・一番分かってほしいこと・**見終わったらできること**・**知っている前提**など。答えはユーザーの言葉のまま。題目だけのときは材料の方針も）。デザインに合わせるなら:

```sh
python3 <skill>/scripts/extract_design.py <資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 <skill>/scripts/check_theme.py <workdir>/theme.json
```

## 2 取材と契約

作り手として一次資料を読み、`<workdir>/brief.md` と `<workdir>/contract.json` を書く（researcher の役。基準は `criteria/contract.md`）。機械検査:

```sh
python3 <skill>/scripts/check_contract.py <workdir>
```

## 3 人の確認

契約の要約を見せて了承をもらう（SKILL.md の 3）。閉じなかった指摘は residual が書く `<workdir>/review/residual.md` の表を見せる。直すなら、要望を `interview.md` に書き足し、周を数え直してから 2 取材と契約に戻る。

```sh
python3 <skill>/scripts/ledger.py residual <workdir>
python3 <skill>/scripts/ledger.py reset <workdir> contract
```

## 4 台本

作り手として `<workdir>/storyboard.json` を書く（writer の役。形式は `storyboard.md`、見本は `<skill>/examples/`）。機械検査（時刻は見積もり）:

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ>
python3 <skill>/scripts/check_text.py <workdir>/storyboard.json
```

`check_storyboard.cjs` は警告だけなら終了コード 0。出力に「辺 … に label がない」があれば、誤りと同じに直す。

## 5 画面

コマを PNG にする道具を入れ（npm から数 MB）、各周でコマを書く（`--timeline` は付けない）。

```sh
python3 <skill>/scripts/setup_render.py
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ>
node <skill>/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames
```

- 評価役として `<workdir>/frames/frames.json` を読み、`png` が true なら `sheets` に載ったシートだけを目で見て、合わせて判定する
- 終了コード 4 は PNG を作れなかったという意味（resvg を読めない。`frames.json` の `png` が false）。SVG と `frames.json` だけで判定し、目で見ないと決められない基準は UNKNOWN にする。**画面の周は 1 回だけ**にし、status の判定にかかわらず 6 音声へ進む。8 報告に「コマの画像なし」と書く
- 直すときは図の宣言と動作だけ。字幕を変えないと直せない項目は disputed にし、4 台本の次の周として字幕を直してから、画面の次の周に戻る

## 6 音声

VOICEVOX を入れる（約 94MB を GitHub から。会話ごとに要る）。次に、合成せずに読みの一覧を書く。

```sh
python3 <skill>/scripts/setup_voice.py --agree
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings
```

`setup_voice.py` の一覧が出たら、`interview.md` の声が既定（春日部つむぎ、8）でないときだけ、一覧で番号を確かめて `<workdir>/storyboard.json` の `voice.speaker` を進行役として直してから（作り手の役に戻らずに進行役が台本を直す、ただ 1 つの例外。番号のほかは変えない） `--readings` を実行する（`text` は変えないので台本の周回には戻らない）。

`tts.py` が終了コード 3 で終わったら、0 になるまで同じコマンドを繰り返す（100 秒ずつ区切って進む）。`<workdir>/voice/readings.md` ができたら、評価役の宣言をしてから writing-reviewer の読みモードとして一覧を S-W8・S-W9 で**1 回だけ**判定し、`<workdir>/review/voice/r1/combined.json` に書く（形は checker の出力と同じ、`reviewer` は `combined`）。取り込んで判定する:

```sh
python3 <skill>/scripts/ledger.py ingest <workdir> voice <workdir>/review/voice/r1/combined.json
python3 <skill>/scripts/ledger.py status <workdir> voice --max-rounds 1
```

チャットでは評価役の判定を 1 回だけ行う。`ingest` → `status … --max-rounds 1` の判定にかかわらず、open の項目があれば作り手として行の `read`（と `<workdir>/voice_dict.json`）だけを 1 回直し、`responses.json` を書いて `ledger.py respond <workdir> voice …` で取り込み、`--readings` をもう一度回してから合成へ進む。再判定はしないので、直した項目は fixed のまま残論点（`residual.md`）に載る。8 報告に「読みは直したが再確認していない」と書く。字幕 `text` は変えない。PASS（open の項目なし）ならそのまま合成する。

```sh
python3 <skill>/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
```

終了コード 3 は同じく、0 になるまで繰り返す。終わったら実際の声の長さで検査する:

```sh
node <skill>/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --timeline <workdir>/voice/timeline.json
```

誤りか「辺 … に label がない」があれば、機械検査の差し戻しとして動作 `do` だけを直して検査し直す（台帳には載せない）。もし `text` か `read` を変えたら `tts.py`（`--readings` なし）をもう一度実行する。

## 7 組み立てと公開

```sh
python3 <skill>/scripts/ledger.py residual <workdir>
python3 <skill>/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> --voice <workdir>/voice -o <workdir>/player.html --artifact
```

音声を作らなかったときは `--voice` を外す。`<workdir>/player.html` は、サンドボックスのファイルをそのまま Artifact として公開する（中身を書き写さない。長いので写すと壊れる）。`/mnt/user-data/outputs/` があれば、そこへ写してから公開する。チャットのプレビューでは audio 要素が鳴らないが、プレーヤーは WebAudio で鳴らすので問題ない。

## 8 報告

SKILL.md の 8 のとおり。claude.ai ではスキルのフォルダに書き込めないので、「足すべき項目」は報告に書くだけにする（台帳の `suggestion` と、6 で `read` を足した語から集める）。
