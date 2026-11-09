---
name: make
description: >
  This skill should be used when the user wants a topic explained as a narrated, animated
  diagram video in Japanese — 「動く図解にして」「動画で説明して」「動画で解説」「アニメーションで見せて」
  「このリポジトリを動画で紹介して」「この PR を動画で」「〜を動画で教えて」「ugoku-zukai」.
  Any source works: code files or directories, a repository URL, a PR or issue, a web page,
  a local document (md / PDF / design doc), the previous CLI output, or just a subject.
  It interviews the user (audience, goal, scope, structure, length, voice, visual style or
  design system), researches the source with citations, writes a storyboard, synthesizes
  natural Japanese narration with VOICEVOX, and publishes a self-contained player page.
  Works in claude.ai / Claude Desktop chat and in Claude Code. Not for static one-page
  decision documents where a still diagram is enough.
metadata:
  version: "0.2.0"
---

# 動く図解を作る

題材を「問い → 全体像 → 流れに沿った詳解 → まとめ」の順に、動く図と日本語のナレーションで見せる再生ページ（HTML 1 枚）を作る。判断の優先順位は **正確さ > 分かりやすさ > 見た目**。根拠のない処理・数値・分岐を絵のために足さない。

あなたはこの流れの**進行役**です。成果物（契約・台本）は作り手（researcher・writer）が書き、評価役（fact-checker・writing-reviewer・director）が成功基準 `references/criteria/` で判定します。進行役は機械検査を回し、台帳の判定に従って次へ進めます。

## 最初に環境を判定する

| 手がかり | 環境 | 手順の詳細 |
|---|---|---|
| Agent ツールがあり、`ugoku-zukai:researcher` などのサブエージェントを呼べる | Claude Code | `references/run-code.md` |
| サブエージェントがない（claude.ai / Claude Desktop のチャット） | チャット | `references/run-chat.md` |

判定したら、その環境の文書を**最初に全部読む**。下の流れの番号と名前は両方の環境で同じで、各段の具体的なコマンド・渡すもの・分岐は run-*.md に書いてある。

- 下の `scripts/…` は、スキルのフォルダ（この SKILL.md のある場所）からの相対パス。環境ごとの書き方は run-*.md の「パスの書き方」に従う
- 作業フォルダ（以下 `<workdir>`）の中のファイル名は、`scripts/workdir.py` の説明にある名前を使う（`interview.md`・`contract.json`・`storyboard.json`・`review/`・`frames/`・`voice/`・`player.html` など）

## 周回の約束（2 取材と契約・4 台本・5 画面・6 音声の読み）

約束の正は `references/loop-protocol.md`。要点だけ書く。

1. 作り手が作る（2 周目からは、台帳の open の項目に応答して直し、`review/<phase>/r<N>/responses.json` を書く。進行役が `scripts/ledger.py respond` で取り込む）
2. 進行役が機械検査を回す。誤りがあれば「**機械検査の差し戻し**」として、検査の出力だけを作り手に渡して直させる（作り手は応答 `responses.json` を書かない。周には数えない。同じ周で 5 回を超えたら打ち切って評価役へ進む）
   - `check_storyboard.cjs` は警告だけなら終了コード 0 で終わる。**出力に「辺 … に label がない」があれば、誤りと同じに writer へ戻す**（must の基準 S-M1・G-M2）
3. 評価役が判定する（Claude Code は役ごとに並列、チャットは 1 回にまとめる）。作り手の推論と取材メモ `brief.md` は評価役に渡さない
4. 進行役が `scripts/ledger.py ingest` で台帳に取り込む
5. **次へ進むかは `scripts/ledger.py status` の判定（終了コード）だけで決める**: PASS（0）→ 次の段へ / CONTINUE（10）→ 次の周 / STOP_MAX・STOP_OSC・STOP_DISPUTE（20〜22）→ 打ち切って次の段へ（閉じていない項目は残論点として持ち越す）
   - `ingest` と `respond` も件数の要約を出すが、最大の周（`--max-rounds`）を見ていないので、判断に使わない
   - 最大の周は Claude Code が 3、チャットが 2（チャットでは必ず `--max-rounds 2` を付ける）。6 音声の読み（フェーズ `voice`）は Claude Code が 2（`--max-rounds 2`）。チャットは判定 1 回で、判定にかかわらず `read` を 1 回直してから合成へ進む（run-chat.md）

## 流れ

### 0 準備

- 環境を判定し、run-*.md を読む
- 作業フォルダを作る。Claude Code は `scripts/workdir.py new <題材の短い名前>`（題材の外、`${CLAUDE_PLUGIN_DATA}/runs/` の下にできる。ユーザーの作業ツリーには書かない）。チャットは会話の作業ディレクトリに `./uz-work/<題材の短い名前>`（動画ごとに 1 つ。同じ会話の 2 本目が前の台帳を引き継がないように）
- 題材の種類（コード・リポジトリ・PR / issue・Web ページ・文書ファイル・直前の出力・題目だけ）と、一次資料の場所を確かめる。手元の題材は絶対パスにし、researcher と fact-checker の両方に同じものを明示して渡す（Claude Code は手元のリポジトリ・フォルダをそのまま、URL を clone するなら `<workdir>/repo`。チャットは zip を展開した `<workdir>/src`）

### 1 インタビュー

AskUserQuestion、なければ質問のフォーム、なければ文章でまとめて聞く。聞くこと:

- **読者**と**一番分かってほしいこと**（1 文）
- **見終わったらできること**（1 文）と、読者が**知っている前提**（すでに知っている用語・道具）。答えはユーザーの言葉のまま `interview.md` に書く（言い換えて広げない）。researcher が契約の `can_do`・`knows` に写し、writer と writing-reviewer は `knows` の人が聞いて分かるかで書き・判定する
- **範囲**（含めるもの・外すもの）と**構成の型**（処理の流れ / 変更前後 / 全体紹介 / 概念 / 比較。`references/structures.md`）
- **長さ**: 既定は 3 分
- **声**: 既定は春日部つむぎ（話者 8、話速 1.1）。ほかに四国めたん（2）、ずんだもん（3。文末が「〜のだ」になる）など。選んだ声の名前（分かれば番号も）を `interview.md` に書く。writer は 4 台本でそれを台本の `voice` に書き（分からなければ既定の 8・1.1）、番号は 6 音声で確かめる
- **画風**: 3b1b 調（`3b1b`）/ フラットな図解（`flat`）/ 手持ちのデザインに合わせる。合わせる場合は、Web ページ・画像・PowerPoint・CSS・トークンなど何でも受け取り、`references/themes.md` の手順で `<workdir>/theme.json` を作り、`scripts/check_theme.py` を通す
- **VOICEVOX の音声モデルの利用規約への同意**（https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt ）。音声モデルなど約 94MB を GitHub から取ること、再生ページに「VOICEVOX:<声の名前>」のクレジットを出すことも伝える。同意がなければ音声は作らない（6 音声を飛ばし、音声なしの再生ページにする）

描き方（標準 / manim-web）は聞かない。今は標準（宣言型の台本＋SVG のプレーヤー）だけで作る。数式の変形や 3D が主役の題材なら、今は向かないと先に伝える。

答えを `<workdir>/interview.md` に書く（題材と一次資料の場所・読者・一番分かってほしいこと・見終わったらできること・知っている前提・範囲・構成の型・長さ・声・テーマ・規約への同意）。題目だけが渡されたときは、**材料の方針**（Web で集めてよいか、優先する資料の種類、避けたい資料）も聞いて書く（researcher が読む）。

### 2 取材と契約

researcher が一次資料を読み、取材メモ `brief.md` と契約 `contract.json` を書く → 進行役が `scripts/check_contract.py <workdir>` → 評価役（fact-checker 契約モード・director 構造モード）→ 台帳（フェーズ名 `contract`）。基準は `references/criteria/contract.md`。

### 3 人の確認

周回が終わったら、契約の要約をユーザーに見せて了承をもらう。人に確かめるのは**ここの 1 回だけ**（台本の周回は手間がかかるので、その前に物差しを合わせる）。見せるもの:

- 一番分かってほしいこと（`takeaway`）
- 言い切ること（`claims`。根拠の場所も添える）
- 構成の型と尺の配分（`structure`・`budget`）
- 主な図の種類（`diagram.type` と選んだ理由）
- 契約の周回で閉じなかった指摘があれば、その件数と要点。`scripts/ledger.py residual <workdir>` を回し、出た `review/residual.md` の表をそのまま見せる（進行役が指摘の本文を読む例外。ほかに 8 報告がある）

直しを求められたら、要望を `interview.md` に書き足して **2 取材と契約に戻る**。台帳の `contract` の周は `scripts/ledger.py reset <workdir> contract` で 1 から数え直す。

### 4 台本

writer が台本 `storyboard.json` を書く → 進行役が `scripts/check_storyboard.cjs`（テーマを付ける。時刻は見積もり）と `scripts/check_text.py` → 評価役（writing-reviewer・fact-checker 台本モード・director 計画モード）→ 台帳（フェーズ名 `script`）。台本の形式は `references/storyboard.md`、基準は `references/criteria/script.md`・`structure.md`。

### 5 画面

合成の前に、見積もりの時刻で画面を確かめる。

1. 初回だけ `scripts/setup_render.py` でコマを PNG にする道具を入れる
2. 進行役が `scripts/frames.cjs` で各行の落ち着いたコマを `<workdir>/frames/` に書く（`--timeline` は付けない）
3. 評価役（director 画面モード）が判定 → 台帳（フェーズ名 `screen`）
4. CONTINUE なら writer が台帳に応答し、**図の宣言と動作（`do`）だけ**を直す。字幕（`text`）は変えない。字幕を変えないと直せない項目は writer が disputed にする。その理由が「字幕を変える必要がある」なら、**4 台本に戻る**（`script` の台帳で次の周として直し、画面をやり直す）
5. 直したら `check_storyboard.cjs` を通してから（誤りは機械検査の差し戻し）、手順 2（`frames.cjs`）に戻ってコマを書き直す

`frames.cjs` や `setup_render.py` が終了コード 4 で終わったら、PNG を作れない環境（resvg を読めない）。止まらずに SVG と `frames.json` だけで進める（`frames.json` の `png` が false）。このときは**画面の周を 1 回だけ**回す: director は SVG と `frames.json` で判定できる基準だけを判定し、目で見ないと決められない基準を UNKNOWN にする。`ledger.py status` の判定にかかわらず 6 音声へ進み（閉じない項目は残論点）、8 報告に「コマの画像なし」と書く。

### 6 音声

1. `scripts/setup_voice.py --agree` で VOICEVOX を入れる（1 で同意を得たときだけ。最後に入っている声の一覧が出る）。`interview.md` の声が既定（春日部つむぎ）でなければ、進行役がこの一覧で話者の番号を確かめ、台本の `voice.speaker` をその番号にする。進行役が成果物に手を入れる**ただ 1 つの例外**で、番号のほかは変えない（字幕 `text` は変わらないので台本の周回には戻らない）。番号を直してから手順 2 へ進む
2. `scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice --readings` で、合成せずに読みの一覧 `<workdir>/voice/readings.md` を書く（終了コード 3 は時間で区切っただけ。0 になるまで同じコマンドを繰り返す）
3. 評価役（writing-reviewer 読みモード）が一覧を S-W8・S-W9 で判定 → 台帳（フェーズ名 `voice`。`ledger.py ingest`・`status`。周の上限は Claude Code 2。チャットは判定 1 回、判定にかかわらず 1 回だけ直して合成へ）
4. CONTINUE なら writer が台帳に応答し、**行の `read`（と作業フォルダの辞書 `<workdir>/voice_dict.json`）だけ**を直す。字幕 `text` は変えない。直したら手順 2 に戻る
5. PASS か STOP なら、`scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice`（`--readings` なし）で 1 行ずつ合成する。**終了コード 3 は「時間で区切った。続きがある」**なので、0 になるまで同じコマンドを繰り返す（合成済みの行は作り直さない）。閉じなかった読みの指摘は残論点になる
6. `scripts/check_storyboard.cjs … --timeline <workdir>/voice/timeline.json` で、実際の声の長さで検査し直す。誤り（と「辺 … に label がない」）があれば、機械検査の差し戻しとして writer が**動作 `do` だけ**を直す（台帳には載せない）。字幕 `text` や読み `read` を変えたときは、手順 5（`tts.py`）をもう一度実行する

### 7 組み立てと公開

1. `scripts/ledger.py residual <workdir>` で残論点を `review/residual.json` に書き出す（件数が出る）
2. `scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> --voice <workdir>/voice -o <workdir>/player.html --artifact` で組み立てる。プレーヤーの右（狭い画面では下）にチャプター一覧が付き、行の根拠は吹き出しで出る。VOICEVOX のクレジットはプレーヤーが出す
   - 「音声が古い」で止まったら、台本の文が合成の後に変わっている。6 の `tts.py` をもう一度実行する
3. `player.html` を Artifact として公開する（ファイルのまま。書き写さない。やり方は run-*.md）

### 8 報告

ユーザーに次を返す。

- 公開したページ（Artifact の URL かリンク）
- 残論点の件数と中身（must の項目の要点。0 件なら「なし」。再生ページには出ないので、ここだけに書く）。PNG を作れなかったときは「コマの画像なし」
- **足すべき項目**（人がスキルに足すかを決める。進行役はスキルのファイルを書き換えない）
  - 禁止語の候補: 台帳の指摘の `suggestion` から（`assets/banned_terms.json` 向け）
  - 読み: 6 音声で `read` を足して直した語（`assets/voicevox_user_dict.json` 向け）
  - 語彙・型の提案: 図の種類・動作・構成の型で表せなかったこと（`references/storyboard.md`・`structures.md` 向け）と、新しい較正の例（`references/criteria/` 向け）

## 不変条件

1. 契約と台本の主張には根拠を付ける（`path:line`、PR・issue 番号、URL と引用、`file:p.N`）
2. 各周回は `ledger.py status` の判定で進める。閉じなかった指摘は残論点として、8 報告に必ず出す（再生ページには出ない）。黙って公開しない
3. GitHub への書き込み系のコマンドは実行しない。ユーザーの作業ツリーで pull や checkout もしない。作業フォルダは題材の外に作る
4. ナレーションを外部サービスへ送らない（VOICEVOX をその場で動かす）。VOICEVOX のクレジットを再生ページに出す
5. 音声はプレーヤーの中で WebAudio で鳴らす（チャットのプレビューでは audio 要素が拒否されるため）
6. animator は呼ばない（保留中。M3 では writer が字幕と動作の両方を書く）
