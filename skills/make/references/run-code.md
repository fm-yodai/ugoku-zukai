# Claude Code での進め方

SKILL.md の流れ（0 準備〜8 報告）を、Claude Code のサブエージェントで回すときの手順。周回の約束の正は `loop-protocol.md`。

## パスの書き方

- スクリプトは `${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/…` で書く。SKILL.md の `scripts/…` はこれに読み替える
- シェルで `${CLAUDE_PLUGIN_ROOT}` が空になる（展開されない）ときは、この文書の 3 つ上のフォルダ（`…/skills/make/references/run-code.md` の `skills` の 1 つ上）がプラグインのフォルダなので、その絶対パスを直接書く
- `<workdir>` は 0 準備で `workdir.py` が出した絶対パス。エージェントにも絶対パスで渡す
- シェルの変数や `cd` は次のコマンドに持ち越されない前提で、毎回フルパスで書く

## 進行役の約束

- 成果物（`brief.md`・`contract.json`・`storyboard.json`・応答）を自分で書かない。直すのは作り手のエージェント
- 指摘の本文は読まない。読むのは機械検査の出力、`ledger.py status` の要約、エージェントが最後に返す 1 行だけ。指摘の中身は作り手にファイルのパスで渡す
- 周回を続けるかは `ledger.py status` の終了コードだけで決める（`ingest`・`respond` の要約は最大の周を見ていないので使わない）
- animator は呼ばない

## エージェントと渡すもの

呼び名は `ugoku-zukai:<名前>`。モデルは定義にある（作り手 opus、評価役 sonnet）。どのエージェントにも「作業フォルダの絶対パス・フェーズ・周の番号 N・出力先のパス」を渡す。

| エージェント | 呼ぶ段 | 足して渡すもの | 出力先 |
|---|---|---|---|
| `ugoku-zukai:researcher` | 2 | 題材の場所（ref・PR 番号・URL・ファイルのパス） | N=1 は `<workdir>/contract.json` と `<workdir>/brief.md`、N≥2 は `<workdir>/review/contract/r<N>/responses.json` |
| `ugoku-zukai:fact-checker` | 2・4 | 題材の場所（一次資料）。`brief.md` は渡さない | `<workdir>/review/<phase>/r<N>/fact-checker.json` |
| `ugoku-zukai:director` | 2・4・5 | なし | `<workdir>/review/<phase>/r<N>/director.json` |
| `ugoku-zukai:writing-reviewer` | 4 | なし | `<workdir>/review/script/r<N>/writing-reviewer.json` |
| `ugoku-zukai:writer` | 4・5・6 | テーマ（`3b1b`・`flat`・`<workdir>/theme.json`） | `<workdir>/storyboard.json`、N≥2 と画面の直しは `<workdir>/review/<phase>/r<N>/responses.json` |

頼み方の例（評価役は同じメッセージで複数呼んで並列にする）:

```text
作業フォルダ: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261106-1530-this-repo
フェーズ: script（周 2）
出力先: /home/u/.claude/plugins/data/ugoku-zukai/runs/20261106-1530-this-repo/review/script/r2/director.json
```

機械検査の誤りを作り手に戻すときは、同じフェーズ・同じ周で呼び、検査の出力をそのまま添える。戻すのは同じ周で 5 回まで。超えたら打ち切って評価役へ進む（残った誤りは評価役が FAIL にし、台帳に載る）。

## 1 周の回し方（2・4・5 で共通）

周の番号 N は 1 から始める。

1. 作り手を呼ぶ。N≥2 なら、書かれた応答を取り込む

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py respond <workdir> <phase> <workdir>/review/<phase>/r<N>/responses.json
```

2. 機械検査（段ごとに下に書く）。誤りがあれば作り手に戻す
3. 評価役を並列に呼ぶ
4. 取り込む（その周の評価役の出力をすべて並べる。下は 2 取材と契約の例）

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py ingest <workdir> <phase> <workdir>/review/<phase>/r<N>/fact-checker.json <workdir>/review/<phase>/r<N>/director.json
```

5. 判定する（最大 3 周は既定なので `--max-rounds` は付けない）

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py status <workdir> <phase>
```

| 終了コード | 判定 | 次 |
|---|---|---|
| 0 | PASS | 次の段へ |
| 10 | CONTINUE | N を 1 足して 1 に戻る |
| 20・21・22 | STOP_MAX・STOP_OSC・STOP_DISPUTE | 打ち切って次の段へ（閉じていない項目は残論点） |

status が「台本に無い行 ID を指す未解決の項目」を警告したら、writer に「行 ID を振り直さない約束」を伝えて直させる。

## 0 準備

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/workdir.py new <題材の短い名前>
```

出た 1 行が `<workdir>`（`${CLAUDE_PLUGIN_DATA}/runs/<日時>-<名前>`。ユーザーの作業ツリーの外）。

## 1 インタビュー

AskUserQuestion でまとめて聞き、`<workdir>/interview.md` に書く。デザインに合わせるなら、受け取った資料からテーマを作って検査する（直し方は `themes.md`）。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/extract_design.py <資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_theme.py <workdir>/theme.json
```

## 2 取材と契約

作り手は researcher、評価役は fact-checker（契約モード）と director（構造モード）。フェーズ名は `contract`。機械検査:

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_contract.py <workdir>
```

## 3 人の確認

`contract.json` を読んで要約を見せ（SKILL.md の 3）、AskUserQuestion で「このまま台本へ / 直す」を聞く。直すなら、要望を `interview.md` に書き足し、周を数え直してから 2 に戻る。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py reset <workdir> contract
```

## 4 台本

作り手は writer、評価役は writing-reviewer・fact-checker（台本モード）・director（計画モード）の 3 つを並列に。フェーズ名は `script`。機械検査（時刻は見積もり）:

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_text.py <workdir>/storyboard.json
```

`check_storyboard.cjs` は警告だけなら終了コード 0。出力に「辺 … に label がない」があれば、誤りと同じに writer へ戻す。

## 5 画面

フェーズ名は `screen`。評価役は director（画面モード）だけ。初回に道具を入れる（2 回目からは何もしない）:

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_render.py
```

各周の機械検査とコマの書き出し（`--timeline` は付けない）:

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ>
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/frames.cjs <workdir>/storyboard.json --theme <テーマ> -o <workdir>/frames
```

- `setup_render.py` か `frames.cjs` が終了コード 4 で終わったら、PNG なしで続ける（SVG と `frames.json` は書けている）。director には「PNG が無い」と添えて呼ぶ。8 報告の残論点に「コマの画像なし」と書く
- N≥2 では writer を phase `screen` で呼ぶ。writer は図の宣言と動作だけを直し、字幕は変えない
- writer が最後に返す 1 行の disputed が 1 以上なら、`responses.json` の disputed の `note` だけを読む。「字幕を変える必要がある」なら、writer を phase `script`・`script` の最後の周 +1 で呼び、画面の台帳のその項目のキーを添えて直させる。4 の機械検査と評価役をその周で回してから、画面の次の周に戻る

## 6 音声

1 で同意を得ているときだけ。VOICEVOX は `${CLAUDE_PLUGIN_DATA}/voicevox` に 1 回入れれば使い回す。

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/setup_voice.py --agree
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/tts.py <workdir>/storyboard.json -o <workdir>/voice
```

`tts.py` の終了コード 3 は時間で区切っただけ。0 になるまで同じコマンドを繰り返す。終わったら実際の声の長さで検査する:

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs <workdir>/storyboard.json --theme <テーマ> --timeline <workdir>/voice/timeline.json
```

誤りか「辺 … に label がない」があれば、writer を phase `screen`・画面の最後の周の番号で呼び、検査の出力を添えて「動作 `do` だけを直す」と頼む（台帳には取り込まない。戻すのは 5 回まで）。writer が `text` か `read` を変えたら、`tts.py` をもう一度実行してから検査し直す。

## 7 組み立てと公開

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/ledger.py residual <workdir>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/build_player.py <workdir>/storyboard.json --theme <テーマ> --voice <workdir>/voice --review <workdir> -o <workdir>/player.html --artifact
```

音声を作らなかったときは `--voice` を外す。公開は Artifact ツールで、`file_path` に `<workdir>/player.html`、`title` に台本の題名、`icon` に `video` を渡す（書き写さない）。作業フォルダのファイルを受け付けないと言われたら、スクラッチパッドのフォルダに写してから公開する。

## 8 報告

SKILL.md の 8 のとおり。「足すべき項目」を集めるときだけは `review/ledger.json` の各項目の `suggestion` を読んでよい（禁止語・語彙の提案を拾う）。読みは 6 で `read` を足した行の語を挙げる。スキルのファイル（`assets/`・`references/`）は書き換えない。
