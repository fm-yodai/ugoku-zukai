# M3 進行役 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** インタビューから公開までを、claude.ai のチャット（1 会話で役を演じる）と Claude Code（サブエージェント）の両方で最後まで回せるようにし、このリポジトリを題材に 3 分の動画を作る。

**Architecture:** 機械検査（契約・文章・配置・コマの画像）と組み立てはスクリプトにし、両環境で同じものを使う。進行の手順は SKILL.md に、環境ごとの違いは `references/run-chat.md` と `references/run-code.md` に分ける。評価役が見るコマの画像は、プレーヤーの `view_svg.js` を node の小さな DOM の代わりで動かして SVG を作り、resvg で PNG にする。

**Tech Stack:** python3（標準ライブラリだけ）、node（vm で共通 JS を読む）、`@resvg/resvg-js@2.6.2`（npm からその場で入れる）、既存の ledger.py / check_storyboard.cjs / tts.py / build_player.py。

**Spec:** `docs/design.md` の「13. M3 の要件」（と 4・8・11 章）。

## Global Constraints

- シェルは sh で動く形にする（`time`・`${PIPESTATUS}`・bash 専用の構文を SKILL.md と参照文書のコマンドに書かない）。CPU 1 つ・メモリ 4GB、chromium なし
- 通信は GitHub・PyPI・npm だけを前提にする。jsDelivr は使わない
- 作業フォルダは Claude Code では `${CLAUDE_PLUGIN_DATA}/runs/<YYYYMMDD-HHMM>-<題材の短い名前>`。ユーザーの作業ツリーに書かない
- 人の確認は契約の後・台本の前の 1 回だけ。インタビューでは描き方を聞かず、長さの既定は 3 分
- 画面の検査は合成の前（見積もりの時刻）。合成の後は `check_storyboard.cjs --timeline` だけ
- 周回: Claude Code は評価役を役ごとに並列・最大 3 周。チャットは評価役を 1 回にまとめ・最大 2 周
- モデル: 作り手（researcher・writer）は opus、評価役（fact-checker・writing-reviewer・director）は sonnet
- 画面の指摘は writer が直す。字幕（`text`）は変えず、図の宣言と動作だけを直す
- animator は進行から呼ばない（定義は残し、冒頭に保留の理由を書く）
- 再生ページ: プレーヤーの下に、たたんだ「未解決の指摘 N 件」と「根拠」の一覧。mp4 に入れるものではない（M4 で書き出すのは SVG の画面だけ）
- 学びの記録は、最後に「足すべき項目」を報告するだけ
- GitHub への書き込み系のコマンドを手順に入れない。ナレーションを外部へ送らない
- 文書・コメント・コミットメッセージは日本語。コミットは `M3: 〜`
- ソースファイルを足したら、`uz_node.cjs` の `SRC`・`build_player.py` の `CORE`・`tools/build_voice_check.py` の同梱リストを確かめる

## Review Focus

1. **resvg の native バイナリが claude.ai で入らない・日本語フォントが見つからない** → `setup_render.py` が失敗を終了コード 4 と理由で知らせ、`frames.cjs` は SVG だけ書いて PNG なしで続けられる（進行は機械検査だけで画面の周回を進め、残論点に「コマの画像なし」と書く）。Task 4 のテストで、resvg を読めないときの動きを確かめる
2. **台本の行 ID が変わった・行を消した後の台帳** → `ledger.py status` が `scenes` の行 ID で照合し、消えた行の項目を警告する（今は `chapters` を見ていて、常に空集合になる）。Task 1 のテストで確かめる
3. **字幕・根拠に `<` や `&` が入る** → 再生ページの一覧は textContent で入れ、HTML として解釈しない。Task 5 のテストで `<script>` を含む根拠が文字のまま出ることを確かめる
4. **残論点が 0 件・review フォルダがない** → `build_player.py --review` は一覧を「なし」で出す（落ちない）。Task 5 で確かめる
5. **英字だけの字幕の語（`JSON` `VOICEVOX`）** → `check_text.py` は `read` がなく、ユーザー辞書にもない英字の語を誤りにし、どの行のどの語かを示す。Task 3 で確かめる

---

### Task 1: 台帳を新しい台本の形式とチャットの周回に合わせる

**Files:**
- Modify: `skills/make/scripts/ledger.py`
- Create: `skills/make/scripts/tests/test_ledger.py`、`skills/make/scripts/tests/run_m3.sh`

**Interfaces:**
- Produces:
  - `line_ids(workdir) -> set[str] | None` が `storyboard.json` の `scenes[].lines[].id` を返す
  - `status <workdir> <phase> [--round N] [--max-rounds N]`。`--max-rounds` の既定は 3。チャットは 2 を渡す。判定と終了コードは今と同じ（PASS 0 / CONTINUE 10 / STOP_MAX 20 / STOP_OSC 21 / STOP_DISPUTE 22）
  - `residual <workdir>` が `review/residual.md` に加えて `review/residual.json` を書く: `{"items": [{"phase", "key", "severity", "status", "problem", "response"}]}`（0 件なら `items: []`）
  - `scripts/tests/run_m3.sh`: M3 の検査をまとめて回す sh スクリプト（`set -u`、失敗があれば exit 1）。以後の Task がここに 1 行ずつ足す

- [ ] **Step 1: 落ちるテストを書く**（`test_ledger.py`。`tempfile` に workdir を作り、`subprocess` で ledger.py を呼ぶ。既存の `tests/ledger/r1.json` `r2.json` `responses.json` を使う）
  - `test_line_ids_scenes`: `scenes: [{lines: [{id: "l1"}, {id: "l2"}]}]` の台本で、台帳に `l9:S-W1` が open のとき、`status` の出力に「台本に無い行 ID」が出る
  - `test_max_rounds_2`: r1・r2 を取り込み open が残る状態で、`status … --max-rounds 2` の終了コードが 20、`--max-rounds` なしは 10
  - `test_residual_json`: 取り込み後に `residual` を実行すると `review/residual.json` の `items` の件数が residual.md の行数と一致し、各項目に `phase` `key` `severity` `status` `problem` がある。台帳が空なら `items == []`
- [ ] **Step 2: 実行して落ちることを確かめる** — `python3 skills/make/scripts/tests/test_ledger.py` → 3 件 FAIL
- [ ] **Step 3: ledger.py を直す**（`MAX_ROUNDS` を `decide(ph, rnd, max_rounds)` の引数にし、summary の「周 n/3」も同じ値で出す）
- [ ] **Step 4: 通ることを確かめる** — 同じコマンドで 3 件 OK
- [ ] **Step 5: `run_m3.sh` を作る**（`run_m1.sh` を呼び、続けて `test_ledger.py` を回す）。`bash skills/make/scripts/tests/run_m3.sh` → 「M3 の検査: すべて OK」
- [ ] **Step 6: コミット** — `M3: 台帳を scenes の行 ID とチャットの周回（--max-rounds）に合わせ、残論点を JSON でも書く`

### Task 2: 契約の図の型をプレーヤーの図の種類に合わせる

**Files:**
- Modify: `skills/make/scripts/check_contract.py`、`skills/make/scripts/tests/contracts/*/contract.json`
- Create: `skills/make/scripts/tests/contracts/bad_type/contract.json`

**Interfaces:**
- Produces: 契約の `diagram` の新しい形（researcher・director・SKILL.md が使う）:
  ```
  "diagram": {"type": "<主に使う図の種類>", "reason": "選んだ理由",
              "compared": {"<ほかの図の種類>": "選ばなかった理由", …},   2 つ以上
              "others": ["<ほかに使う図の種類>", …]}                       任意
  ```
  図の種類は `player/src/validate.js` の `TYPES` のキー（`canvas` を除く 16 種）。`check_contract.py` は validate.js から正規表現でキーを読み、同じ一覧を二重に持たない。`none` と `alternative` は廃止
- `paths` は `type` が `graph` `sequence` `swimlane` のときだけ必須（それ以外は任意）

- [ ] **Step 1: テストの契約を直し、落ちる例を足す** — `ok_repo` `ok_concept` を新しい形に書き換える。`bad_type`（`type: "layered"`）を足す。`bad_none` は `type: "none"` が誤りになる例として残す
- [ ] **Step 2: 実行して落ちることを確かめる** — `python3 skills/make/scripts/check_contract.py skills/make/scripts/tests/contracts/ok_repo` が誤りを出す（今のコードは `layered` しか知らない）
- [ ] **Step 3: check_contract.py を直す**（docstring の形の説明も新しい形にする。`compared` が 2 つ未満なら誤り、`compared` のキーも図の種類であること）
- [ ] **Step 4: 通ることを確かめる** — `ok_*` は exit 0、`bad_*` はすべて exit 1。この確認を `run_m3.sh` に足す
- [ ] **Step 5: コミット** — `M3: 契約の図の型をプレーヤーの図の種類（16 種）に合わせる`

### Task 3: 字幕と読みの機械検査（S-M2〜S-M4）

**Files:**
- Create: `skills/make/scripts/check_text.py`、`skills/make/scripts/tests/text/ok.json`、`skills/make/scripts/tests/text/bad.json`

**Interfaces:**
- Produces: `python3 check_text.py <storyboard.json> [--json]`。終了コード 0 = 誤りなし、1 = 誤りあり。`--json` は `{"errors": [{"line", "rule", "msg"}], "warnings": [...]}`。`rule` は基準 ID（`S-M2` `S-M3` `S-M4`）
  - S-M2: 各行の `text` と `read`（印 `{x}` を除いた文）に `assets/banned_terms.json` の語がある（`allow` を除く。`check_contract.py` の `find_banned` を import して使う）
  - S-M3: 台本の `voice.speaker` がずんだもん（話者 id 1・3・5・7・22・38・75・76）のとき、すべての文末（「。」「？」の直前）が「のだ」「なのだ」で終わる。それ以外の話者では検査しない
  - S-M4: 読む文（`read` があればそれ、なければ `text`）に英字の連なりがあり、その語が `assets/voicevox_user_dict.json` の `surface` にない → 誤り（「行 l3 の `JSON` は read でカタカナにする」）

- [ ] **Step 1: 落ちるテストの台本を書く** — `bad.json` に、禁止語を含む行・ずんだもんで「〜です。」の行・`read` なしの「JSON を返す」行を 1 つずつ。`ok.json` は同じ内容を直したもの（英字の語は `read` でカタカナ）。両方とも `check_storyboard.cjs` を通る形にする
- [ ] **Step 2: 実行して落ちることを確かめる** — スクリプトがないので失敗
- [ ] **Step 3: `check_text.py` を書く**
- [ ] **Step 4: 通ることを確かめる** — `bad.json` は exit 1 で 3 つの `rule` がそろう、`ok.json` は exit 0。`examples/*.json` もすべて exit 0（見本が誤りになるなら、見本を直すか規則を見直す）。この確認を `run_m3.sh` に足す
- [ ] **Step 5: コミット** — `M3: 字幕と読みの機械検査（禁止語・ずんだもんの語尾・英字の読み）`

### Task 4: 各行の落ち着いたコマを SVG と PNG にする

**Files:**
- Modify: `skills/make/player/src/engine.js`（動作に行 id を持たせる）
- Create: `skills/make/scripts/svg_dom.cjs`、`skills/make/scripts/frames.cjs`、`skills/make/scripts/setup_render.py`、`skills/make/scripts/tests/test_frames.sh`

**Interfaces:**
- Consumes: `uz_node.cjs` の `load()` `theme()`、`UZ.build`、`UZ.View`（`view_svg.js`）
- Produces:
  - engine.js: 行から作った動作に `line: <行 id>` を足す（`acts.push(act)` の手前。場面の自動表示の動作には付けない）
  - `svg_dom.cjs`: `makeDocument() -> { createElementNS, … }` と `serialize(el) -> string`。view_svg.js が使う範囲だけ（`setAttribute` `appendChild` `removeChild` `firstChild` `textContent` `innerHTML = ""` `style.opacity` `style.display`）。`style` は `style="opacity:…;display:…"` に書き出し、`display:none` と opacity 0 の要素は出力から省く
  - `setup_render.py`: `@resvg/resvg-js@2.6.2` を `npm install --prefix <置き場>` で入れる。置き場は `UZ_RENDER_HOME` → `${CLAUDE_PLUGIN_DATA}/render` → `~/.cache/ugoku-zukai/render`（`setup_voice.py` と同じ選び方）。何度実行してもよい。最後に置き場のパスを 1 行で出す。失敗したら終了コード 4 と理由
  - `node frames.cjs <storyboard.json> --theme <名前|パス> -o <出力先> [--timeline timeline.json]` が書くもの:
    - `<出力先>/svg/<行 id>.svg`: 各行の落ち着いたコマ。時刻は `max(行の終わり, その行の動作の終わりの最大) + 0.05` で、次の行の始まりを超えない
    - `<出力先>/sheet-NN.png`: 6 コマずつ 2 列 × 3 行（1 コマ 640×360、コマの上に「行 id ＋字幕の頭 20 字」の帯）を並べた PNG
    - `<出力先>/frames.json`: `{"png": true|false, "sheets": [{"file", "lines": ["l1", …]}], "lines": [{"id", "scene", "t", "text", "svg"}]}`
    - resvg は `UZ_RENDER_HOME` などの置き場から `require` する。読めなければ SVG と frames.json（`png: false`）だけを書き、標準エラーに「setup_render.py を実行する」と出して終了コード 4。フォントは `loadSystemFonts: true`、`defaultFontFamily` は Noto Sans CJK JP（なければ IPAGothic）にする
    - シートはコマの SVG を `<g transform>` で 1 枚の SVG に並べてから、1 回だけ PNG にする

- [ ] **Step 1: 落ちるテストを書く**（`test_frames.sh`）
  - `examples/sequence.json` を flat で出すと、`frames.json` の `lines` の件数が台本の行数と一致し、すべての `svg` ファイルがある
  - 各 SVG に、その行の字幕の文（印を除く）が含まれる（字幕が描かれたコマである）
  - `png: true` のとき `sheet-01.png` が PNG の頭（`\x89PNG`）で始まり、幅 1280・高さ 1080（2 列 × 3 行）
  - `UZ_RENDER_HOME` を空のフォルダにすると終了コード 4 で、`frames.json` の `png` が false、SVG はそろっている
- [ ] **Step 2: 実行して落ちることを確かめる**
- [ ] **Step 3: engine.js に `line` を足し、`run_m1.sh` が今までどおり通ることを確かめる**
- [ ] **Step 4: `svg_dom.cjs`・`setup_render.py`・`frames.cjs` を書く**
- [ ] **Step 5: 通ることを確かめる** — `python3 skills/make/scripts/setup_render.py` の後に `sh skills/make/scripts/tests/test_frames.sh`。シートの PNG を 1 枚 Read で開き、日本語が豆腐（□）になっていないことを目で確かめる。`run_m3.sh` に足す（resvg がない環境では PNG の検査を飛ばし、そう表示する）
- [ ] **Step 6: コミット** — `M3: 各行の落ち着いたコマを SVG と PNG のシートにする（resvg）`

### Task 5: 再生ページに残論点と根拠の一覧を置く

**Files:**
- Modify: `skills/make/scripts/build_player.py`、`skills/make/player/template.html`
- Create: `skills/make/scripts/tests/test_build_review.py`

**Interfaces:**
- Consumes: Task 1 の `review/residual.json`、台本の行の `source`、`UZ.player.seek(t)`、`M.timeline.lines`（`{id, start, dur}`）
- Produces:
  - `build_player.py … [--review <workdir>]`: `<workdir>/review/residual.json` を読み（なければ 0 件）、`UZ_DATA.residual = items` に入れる。`--review` がなければ `residual` は `null` で、一覧を出さない
  - template.html: プレーヤーの下に `<details id="uz-residual">`（`<summary>` は「未解決の指摘 N 件」。0 件なら「未解決の指摘なし」）と `<details id="uz-sources">`（`<summary>` は「根拠」）。根拠の一覧は行ごとに「時刻 字幕（印を除く）」と `source` の各項目。行を押すと `UZ.player.seek(その行の start)`。すべて `textContent` で入れる。`source` が 1 つもない台本では根拠の一覧を出さない

- [ ] **Step 1: 落ちるテストを書く**（`test_build_review.py`。HTML の文字列を調べる）
  - `--review` に残論点 2 件の workdir を渡すと、出力に `"residual":[` と「未解決の指摘」が含まれる
  - 残論点の `problem` に `<script>alert(1)</script>` を入れても、出力の HTML に生の `<script>alert` が現れない（JSON の中は `<` になる）
  - `review/` がない workdir を渡しても exit 0 で、`"residual":[]`
  - `--review` なしでは `"residual":null`
- [ ] **Step 2: 実行して落ちることを確かめる**
- [ ] **Step 3: build_player.py と template.html を直す**（一覧の見た目は既存の `.uz-note` の色と文字の大きさに合わせる）
- [ ] **Step 4: 通ることを確かめる** — テスト 4 件 OK。`examples/mixed.json` に `--review` を付けて組み立てたページをブラウザ（Playwright）で開き、根拠の行を押すと再生位置がその行へ飛ぶことを確かめる。`run_m3.sh` に足す
- [ ] **Step 5: コミット** — `M3: 再生ページに残論点と根拠の一覧（たたむ）を置く`

### Task 6: 作業フォルダを作る

**Files:**
- Create: `skills/make/scripts/workdir.py`

**Interfaces:**
- Produces: `python3 workdir.py new <題材の短い名前>` が作業フォルダを作ってパスを 1 行で出す。置き場は `UZ_RUNS_HOME` → `${CLAUDE_PLUGIN_DATA}/runs` → `~/.cache/ugoku-zukai/runs`。名前は `<YYYYMMDD-HHMM>-<短い名前>`（英数字と `-` 以外は `-` にし、同じ名前があれば `-2` `-3`…）。中に `sources/` と `review/` を作る
- 作業フォルダの中身（SKILL.md と各エージェントが使う。ここで決める）: `interview.md` `brief.md` `sources/` `contract.json` `storyboard.json` `theme.json`（デザインから作ったときだけ） `review/` `frames/` `voice/`（tts.py の出力） `player.html`

- [ ] **Step 1: テストを `run_m3.sh` に書く** — `UZ_RUNS_HOME` を一時フォルダにして 2 回 `new "this repo"` を呼ぶと、2 つ目が `-2` で終わり、どちらにも `sources/` `review/` がある
- [ ] **Step 2: 落ちることを確かめ、`workdir.py` を書き、通ることを確かめる**
- [ ] **Step 3: コミット** — `M3: 作業フォルダを題材の外に作る（workdir.py）`

### Task 7: 成功基準と演出の約束を新しいプレーヤー向けに書き換える

**Files:**
- Modify: `skills/make/references/criteria/{README,contract,script,structure,screen}.md`、`skills/make/references/loop-protocol.md`、`skills/make/references/writing/review-format.md`、`skills/make/references/structures.md`、`skills/make/references/storyboard.md`
- Create: `skills/make/references/visual-grammar.md`

**決めたこと**（書き換えの中身）:
- 対象の名前を新しい形式にそろえる: `sub` → `text`、`say` → `read`、`map`・`objects`・ops・`shot` → `figures`（図の宣言）と `do`（動作）、章 → 場面（`scenes`）。`lint_storyboard.py` → `check_storyboard.cjs` と `check_text.py`、`layout_report` / `occupancy.json` / `render.sh` / preview → `check_storyboard.cjs` の出力と `frames/`（Task 4）
- 機械の基準: S-M1 = `check_storyboard.cjs` の誤りと配置の問題が 0、S-M2〜M4 = `check_text.py`、C-M1/M2 = `check_contract.py`、V-M1 = 見積もりの時刻での `check_storyboard.cjs` の配置が 0、V-M2 = 時刻表を使った `check_storyboard.cjs --timeline` が 0（音声の後）。v1 の V-M2（`line_on_text` など）と V-M3（render.sh の音声検査）は消す
- G-M1〜M4 は今の validate.js が誤りにする項目に言い直すか、validate.js が見ないもの（図の題・辺の label）を S-M1 の一部として書く。G-D1〜D6 の「層」「`map.kind`」は、図の種類ごとの言い方（graph の `groups`、sequence の参加者など）に直す
- V-4（what_if）は `relabel` と `replace` の結果に、V-6（実際の画面）は消す（M3 は画面写真を扱わない）。画面の checker の位置の書き方は「シートのファイル名と行 id」
- `visual-grammar.md`（VG-1〜）: v1 の演出の約束のうち、新しい動詞で言えるものだけを書く（データが主役、1 行 1 つの画面変化、寄って戻る（`focus` → `unfocus`）、強調は字幕の主題に、色の役割は図をまたいで同じ、応答は別の矢印、残り物を `hide` する）。各項目は「約束・使う動詞・悪い例」の 3 行。基準ファイルが参照する VG の番号と一致させる
- `loop-protocol.md`: 「チャットでの回し方」の節を足す（評価役を 1 回にまとめ、全基準の判定を `review/<phase>/r<N>/combined.json` に書く。`ledger.py status … --max-rounds 2`。評価役の番の始めに、作り手の推論を使わず基準ファイルと一次資料と成果物だけで判定すると宣言する）。フェーズ名は `contract` `script` `screen`。Phase 番号の言い方を SKILL.md の流れ（後述）とそろえる
- `storyboard.md`: `source` が再生ページの根拠の一覧に出ること、根拠の書き方の例を 1 行足す

- [ ] **Step 1: 古い語が残っていないかの検査を `run_m3.sh` に足す** — `grep -rnE "lint_storyboard|render\.sh|shot_scene|custom\.py|occupancy|layout_report|map\.kind|\bops\b|Manim" skills/make/references` が 0 件
- [ ] **Step 2: 実行して落ちることを確かめる**
- [ ] **Step 3: 上の決めたことに沿って書き換える**（較正の例は、意味が変わらない範囲で新しい語に直して残す）
- [ ] **Step 4: 通ることを確かめる** — grep が 0 件。`python3 -c "import sys; sys.path.insert(0,'skills/make/scripts'); import ledger; print(sorted(ledger.must_only()))"` が新しい must の基準 ID の一覧を出し、消した ID（v1 の V-M3・V-6）を含まない
- [ ] **Step 5: コミット** — `M3: 成功基準と演出の約束を新しいプレーヤー向けに書き換える`

### Task 8: エージェントの定義を書き換える

**Files:**
- Modify: `agents/{researcher,writer,fact-checker,writing-reviewer,director,animator}.md`

**決めたこと**:
- 冒頭の「移植中」の注記を消す。animator だけ「M3 では進行から呼ばない。抜け道（custom）か manim-web（M5）を入れるときに、自由描画の担当として書き直す。字幕と動作は文中の印で結びついているので、M3 では writer が両方を書く」に差し替える（本文は v1 のまま残す）
- `model`: researcher・writer は `opus`、fact-checker・writing-reviewer・director は `sonnet`
- `tools:` の Bash の許可を新しいスクリプトにする:
  - researcher: `check_contract.py`、`workdir.py` は使わない（作業フォルダは進行役が作って渡す）、既存の git / gh の読み取り系
  - writer: `node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_storyboard.cjs *`、`python3 ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/check_text.py *`、`node ${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/frames.cjs *`
  - director: Read・Glob・Write（コマの PNG は Read で見る）
- 本文の手順: 準備で読むファイルを Task 7 の名前に直す。writer は「台本の書き方」（図の宣言 → 場面 → 字幕と印 → 動作）と「画面の指摘を直すときは `text` を変えない。変える必要があれば disputed にして理由を書く（台本の周回に戻る）」を持つ。director の画面モードは `frames/frames.json` と `sheet-*.png` を読み、位置は「シートのファイル名と行 id」で書く
- 呼び出し元から受け取るもの（全員共通）: 作業フォルダの絶対パス、フェーズ、周の番号、出力先のパス

- [ ] **Step 1: 古い語の検査を `run_m3.sh` に足す** — Task 7 の grep を `agents/` にもかける（animator.md は除く）。加えて、各エージェントの `tools:` に書いたスクリプトのパスが実在することを確かめる（`${CLAUDE_PLUGIN_ROOT}` をリポジトリの直下に置き換えて `test -f`）
- [ ] **Step 2: 実行して落ちることを確かめる**
- [ ] **Step 3: 上の決めたことに沿って書き換える**
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: コミット** — `M3: エージェントを新しいプレーヤー向けに書き換える（animator は保留）`

### Task 9: 進行役（SKILL.md と環境ごとの手順）

**Files:**
- Modify: `skills/make/SKILL.md`、`CLAUDE.md`（コマンドの節）、`tools/build_claude_ai_zip.py`（必要なら）
- Create: `skills/make/references/run-chat.md`、`skills/make/references/run-code.md`

**決めたこと**:
- SKILL.md の流れ（両環境で同じ番号を使う）:
  0. 準備 — 環境の判定、作業フォルダ（Claude Code は `workdir.py new`、チャットは `./uz-work`）
  1. インタビュー — 読者・一番分かってほしいこと・範囲・構成の型・長さ（既定 3 分）・声・画風と VOICEVOX の規約への同意。描き方は聞かない（数式・3D の題材なら、今は向かないと伝える）。結果を `interview.md` に書く
  2. 取材と契約 — researcher → `check_contract.py` → 評価役（fact-checker 契約モード・director 構造モード）→ 台帳
  3. **人の確認** — 契約の要約（一番分かってほしいこと・言い切ること・構成と尺の配分・主な図の種類）を見せ、了承をもらう。直しを求められたら 2 に戻る（周の数は数え直す）
  4. 台本 — writer → `check_storyboard.cjs`・`check_text.py` → 評価役（writing-reviewer・fact-checker 台本モード・director 計画モード）→ 台帳
  5. 画面 — `frames.cjs`（見積もりの時刻）→ director 画面モード → writer が動作と図の宣言を直す → 台帳
  6. 音声 — `setup_voice.py --agree`、`tts.py`（終了コード 3 を繰り返す）、`check_storyboard.cjs --timeline`（誤りがあれば writer が動作だけを直し、文を変えたら tts を再実行）
  7. 組み立てと公開 — `ledger.py residual` → `build_player.py … --voice voice --review <workdir> --artifact` → Artifact で公開
  8. 報告 — 公開したページ、残論点の件数、「足すべき項目」（禁止語・読み・語彙の提案。台帳の `suggestion` と、合成で読みを直した語から集める）
- 進行役は成果物の中身を書かず、台帳の要約（`ledger.py status` の出力）だけで次を決める（Claude Code）。チャットでは役を順に演じるが、評価役の番の始めに run-chat.md の宣言をする
- `run-code.md`: 各フェーズでどのエージェントを、何を渡して呼ぶか（`ugoku-zukai:<名前>`、並列にするもの）、状態の判定（`ledger.py status` の終了コード）による分岐、機械検査の誤りを maker に戻す上限（同じ周で 5 回）
- `run-chat.md`: 評価役をまとめた 1 回の判定の仕方（全基準を 1 つの `combined.json` に）、`--max-rounds 2`、claude.ai のシェルは sh、長いコマンドは区切る、VOICEVOX は会話ごとに入れる、Artifact の公開の仕方
- コマンドはすべて `${CLAUDE_PLUGIN_ROOT}/skills/make/scripts/…`（Claude Code）か、スキルのフォルダからの相対パス（チャット）で書き、その違いを run-*.md に 1 か所だけ書く
- CLAUDE.md のコマンドの節に `check_text.py` `frames.cjs` `setup_render.py` `workdir.py` `run_m3.sh` を足す

- [ ] **Step 1: 検査を `run_m3.sh` に足す** — SKILL.md・run-chat.md・run-code.md に出てくる `scripts/` のファイル名がすべて実在する。bash 専用の書き方（`${PIPESTATUS}`・`time `・`[[`・`<(`）がコードの塊にない
- [ ] **Step 2: 実行して落ちることを確かめる**（run-*.md がない）
- [ ] **Step 3: 上の決めたことに沿って書く**。SKILL.md は 200 行以内に収め、詳細は references へ
- [ ] **Step 4: 通ることを確かめる** — `bash skills/make/scripts/tests/run_m3.sh` がすべて OK。`python3 tools/build_claude_ai_zip.py` の zip に run-chat.md と新しいスクリプトが入り、`node_modules` が入っていない
- [ ] **Step 5: コミット** — `M3: 進行役の手順（SKILL.md・チャット版・Claude Code 版）`

### Task 10: Claude Code で通す

**Files:**
- Modify: `docs/design.md`（「M3 の実装」の節）、通しで見つかった不具合の修正先

- [ ] **Step 1: プラグインを読み込んだ Claude Code を起動する**（ユーザーに `claude --plugin-dir ~/ugoku-zukai` を頼む）。`/agents` に `ugoku-zukai:writer` などが出ることを確かめる
- [ ] **Step 2: 題材「このリポジトリ」、長さ 3 分で `/ugoku-zukai:make` を最後まで回す**。人の確認でユーザーに契約を見てもらう
- [ ] **Step 3: 確かめることを記録する** — `${CLAUDE_PLUGIN_ROOT}` がエージェントの `tools:` で展開されたか（許可の確認が出ずに check_storyboard.cjs が走ったか）、各フェーズの周の数と判定、tts の時間、公開したページで声と動きがそろうか
- [ ] **Step 4: 見つかった不具合を直す**（直すたびに `run_m3.sh` を回し、別のコミットにする）
- [ ] **Step 5: `docs/design.md` に「M3 の実装」を書き、コミット** — `M3: Claude Code での通しの結果を記録`

### Task 11: claude.ai で通す

**Files:**
- Modify: `docs/design.md`、通しで見つかった不具合の修正先

- [ ] **Step 1: zip を 2 つ作る** — `python3 tools/build_claude_ai_zip.py`（スキル）と `git archive --format=zip -o dist/ugoku-zukai-src.zip HEAD`（題材）
- [ ] **Step 2: ユーザーに、スキルの zip を claude.ai に入れ、新しい会話に題材の zip を添付して「このリポジトリを動く図解にして（3 分）」と頼んでもらう**
- [ ] **Step 3: 結果を聞き取って記録する** — 最後まで行けたか、`setup_render.py` が入ったか（入らなければ同梱を検討して計画を足す）、会話の長さが足りたか、周の数、公開したページ
- [ ] **Step 4: 見つかった不具合を直し、もう一度通す**
- [ ] **Step 5: `docs/design.md` に結果を書き、M3 の終わりの条件を満たしたと記録してコミット** — `M3: claude.ai での通しの結果を記録`
