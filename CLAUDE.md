# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリ

題材（コード・リポジトリ・PR・Web ページ・文書・題目）を、日本語ナレーション付きの「動く図解」（HTML 1 枚の再生ページ）にする Claude プラグイン `ugoku-zukai`。本体はスキル `skills/make/`。claude.ai / Claude Desktop のチャットと Claude Code の両方で動かすことが前提。

- 設計の正は `docs/design.md`。マイルストーン（M1a / M1b / M2 / M3 済み。進め方の作り直しは R1・R2 と、R3 の道具 = 完成後の直し・声の試聴まで済み。R3 の両環境での通しが残る。M4 以降は未着手）、合意済みの要件、claude.ai のサンドボックスで確かめた事実（通信先・道具・制約）はここにある。仕様を変えたら、ここの「Mn の実装」節に追記する
- 文書・コメント・コミットメッセージは日本語。コミットは `M2: 〜` のようにマイルストーンを頭に付ける（進め方の作り直しは `R3: 〜`）
- 前身は個人用スキル explain-video-anywhere（v1、Manim＋Docker の VOICEVOX）。`agents/` と `references/criteria/` などは v1 からの移植で、M3 で新しいプレーヤー向けに、R2 で構成メモを物差しにする形に書き換えた（保留中の `agents/animator.md` だけ v1 の Manim 用のまま）

## コマンド

依存のインストール手順はない（python3 と node をそのまま使う。elkjs は `player/vendor/` に同梱）。

```bash
# まとめての検査。ふだんは run_r3.sh だけ回せば全部走る（r3 → r2 → r1 → m3 → m1 の順に呼ぶ）
#   run_m1.sh: 見本台本 × テーマ 3 種の配置検査・テーマの検査・デザイン抽出
#   run_m3.sh: 字幕と読み・コマ・再生ページ・作業フォルダと、文書とスクリプトの食い違い
#   run_r1.sh: 構成メモ・台本の章・絵コンテのページ
#   run_r2.sh: 指摘の一覧・成功基準・エージェントの定義・進行役の文書
#   run_r3.sh: 再生ページの位置の表示・公開先の記録と作業フォルダの一覧・声の試聴・直しの文書（VOICEVOX があれば、試聴と声の使い回しも）
bash skills/make/scripts/tests/run_r3.sh

# 台本 1 本の検査（形・id の解決・配置）。--timeline で実際の声の長さでも検査する
node skills/make/scripts/check_storyboard.cjs skills/make/examples/sequence.json --theme flat [--timeline work/voice/timeline.json] [--json]

# 構成メモの検査（<workdir>/outline.json か、ファイルを直接渡す。形式は references/outline.md、見本は examples/outlines/）。--ready は台本に進める状態かも見る
python3 skills/make/scripts/check_outline.py skills/make/examples/outlines/ux.json [--ready] [--json]
python3 skills/make/scripts/check_outline.py <workdir> --agree-all   # 利用者が全部を見て通したとき、proposed をまとめて agreed にする

# 台本と構成メモの突き合わせ（場面の chapter と構成メモの章、章ごとの見積もりの長さ）。--complete は台本を書き終えたものとして見る
node skills/make/scripts/check_storyboard.cjs skills/make/scripts/tests/outlines/pair/storyboard.json --outline skills/make/scripts/tests/outlines/pair/outline.json [--complete]

# テーマの検査（コントラストなど）。--design で、取り込んだデザイン（extract_design.py の報告）から外れていないかも見る
python3 skills/make/scripts/check_theme.py skills/make/player/themes/3b1b.json
python3 skills/make/scripts/extract_design.py <デザインの資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 skills/make/scripts/check_theme.py <workdir>/theme.json --design <workdir>/design-report.json

# 字幕と読みの検査（禁止語・ずんだもんの語尾・辞書にない英字の語）
python3 skills/make/scripts/check_text.py skills/make/examples/sequence.json

# 指摘の一覧（<workdir>/review/ledger.json）。評価役の出力を取り込み、利用者に見せる形で出し、直す・直さないの選択を記録する
python3 skills/make/scripts/ledger.py ingest <workdir> <評価役の出力.json …>
python3 skills/make/scripts/ledger.py list <workdir> [--full] [--by lead|user] [--state open,fixing,kept,closed] [--json]   # must は全文、should は 1 件 1 行、nits は件数だけ
python3 skills/make/scripts/ledger.py decide <workdir> --by lead|user [--fix <key> …] [--keep <key> …]   # lead = 進行役が先に直した、user = 利用者が選んだ。--keep は user だけ
python3 skills/make/scripts/ledger.py decide <workdir> --by lead|user --close <key> … --note <理由>   # 直し中の指摘を、再確認なしで閉じる（must は user だけ）
python3 skills/make/scripts/ledger.py status <workdir>     # 件数の要約
python3 skills/make/scripts/ledger.py residual <workdir>   # must で直っていない指摘（残論点）を review/residual.md に書く

# 作業フォルダを題材の外に作る（${CLAUDE_PLUGIN_DATA}/runs/<日時>-<名前>。パスを 1 行で出す）
python3 skills/make/scripts/workdir.py new this-repo
# 公開先を作業フォルダに記録する（published.json）。過去の作業フォルダを新しい順に出す（別のセッションから直すときに使う）
python3 skills/make/scripts/workdir.py publish <workdir> --url <Artifact の URL> [--theme flat] [--source <題材の場所>]
python3 skills/make/scripts/workdir.py list [--json]

# 各行の落ち着いたコマ（SVG と PNG のシート）。PNG には初回だけ resvg を入れる。終了コード 4 = PNG なし（SVG と frames.json だけ）
python3 skills/make/scripts/setup_render.py
node skills/make/scripts/frames.cjs skills/make/examples/sequence.json --theme flat -o work/frames
node skills/make/scripts/frames.cjs skills/make/examples/mixed.json --theme flat -o work/frames-s2 --scenes s2   # 一部の場面のコマだけ書く（カンマ区切り。出力先の前の回のコマは消えるので、全体とは分ける。--lines l8,l33 なら、その行のある場面）

# 利用者向けの絵コンテのページ（コマの横に「s2 / l2 @0:14」と字幕の全文。PNG は要らない。--outline で章の見出しと「Claude が決めたこと」が付く。台本を直したら frames.cjs を回し直す。コマが古いと終了コード 2 で止まる）
python3 skills/make/scripts/build_sheet.py skills/make/examples/sequence.json --frames work/frames -o work/sheet.html [--outline outline.json] [--artifact]

# 声: 初回だけ VOICEVOX を入れ（約 94MB）、1 行ずつ合成して timeline.json と narration.mp3 を作る
python3 skills/make/scripts/setup_voice.py --agree
python3 skills/make/scripts/tts.py <storyboard.json> -o work/voice --readings   # 合成せずに読みの一覧 work/voice/readings.md を書く（合成の前の確認。辞書は既定で work/voice_dict.json を重ねる）
python3 skills/make/scripts/tts.py <storyboard.json> -o work/voice   # 終了コード 3 = 時間切れで続きあり。同じコマンドを繰り返す
python3 skills/make/scripts/tts.py -o work/voice --audition 8,2,3 --sample "聞き比べる文です。" [--artifact]   # 声の試聴。同じ 1 文を話者ごとに読ませたページ work/voice/audition.html を書く（--sample を省くと台本の最初の行）

# 組み立て（--artifact は Artifact 用に <html>/<head>/<body> を外した断片を書く）
python3 skills/make/scripts/build_player.py <storyboard.json> --theme 3b1b --voice work/voice -o player.html [--artifact]

# 見本帳（全見本 × 全テーマ）、claude.ai 用 zip、claude.ai での声の検証用 zip（出力は dist/）
python3 tools/build_gallery.py
python3 tools/build_claude_ai_zip.py
python3 tools/build_voice_check.py
```

## 全体の構造

**進め方**: 番号の付いた決まった手順はない。進行役（`SKILL.md` を実行しているセッション）が利用者と話して構成を固め、決まったことを構成メモ（`outline.json`。`by` = 誰が言ったか、`state` = 利用者が見たか）に書く。話題ごとに「聞く・案を出す・調べる」を選び、案を出すときは他の選択肢を残す。任されたら、絵コンテまで自分で決めてから見せる。そこから台本（`storyboard.json`。場面の `chapter` で構成メモの章を指す）→ 絵コンテ（`frames.cjs`・`build_sheet.py`）→ 声（`tts.py --readings` で読みを確かめてから合成）→ 組み立て（`build_player.py`）と Artifact での公開、と進む。順番として守るのは 3 つだけ: 声を合成する前に利用者が絵コンテを見ている、公開する前に機械検査が通っている、must を直さずに公開するときは報告に残論点として書く。公開した後は、利用者が再生ページの「直したい箇所を指定する」で出る `s2 / l2 @0:14`（場面 / 行 @時刻）を伝えて直しを頼む。直すのは指された行だけで、変えていない行の声は作り直さない。Claude Code では、`workdir.py list` で作業フォルダを探して、別のセッションからも直せる。原則と道具の一覧は `skills/make/SKILL.md`、環境ごとのコマンドは `references/run-code.md`（Claude Code）と `references/run-chat.md`（チャット）。

**プレーヤー（`skills/make/player/src/`）は、ブラウザと node で同じコードを動かす**のが要。
- `util → figures → figures2 → validate → engine → check` は DOM に触らない。グローバルの `UZ` に生えていく（`UZ.build(storyboard, theme, timeline)` が配置と時刻を計算する）。DOM に触るのは `view_svg.js` だけ
- node 側は `scripts/uz_node.cjs` が `vm.runInThisContext` で同じファイルを読み込み、`check_storyboard.cjs` が配置を検査する。ブラウザ側は `build_player.py` が `template.html` の `/*UZ:ELK*/` `/*UZ:CORE*/` `/*UZ:DATA*/null` を置き換えて 1 枚に埋め込む
- ファイルの読み込み順は `uz_node.cjs` の `SRC` と `build_player.py` の `CORE` の 2 か所に書いてある。ソースファイルを足したら両方に足す（`tools/build_voice_check.py` の同梱リストも確認）
- 文字の幅はフォントを実測せず文字の種類から見積もる（node の検査とブラウザで同じ値にするため）。この前提を崩さない
- 図の種類: `figures.js`（箱と矢印＝ELK で自動配置、シーケンス、表・比較・箇条）、`figures2.js`（提案資料系 10 種。ELK を使わず図ごとの固定配置）

**台本の形式**（`ugoku-zukai/2`、仕様は `references/storyboard.md`、見本は `examples/`）: 意味で書く層（図の宣言・`show` `trace` `focus` などの動作）が基本で、足りないところだけ下の層で直接書く。動作は字幕の文中の印（`{a}`）に結ぶ。時刻表がなければ文字数から見積もり、あれば `tts.py` がモーラ単位で出した印の時刻を使う。合成した後に台本の文を変えたり、行を足したり消したりすると、組み立て（`build_player.py`）と検査（`check_storyboard.cjs --timeline`）が「音声が古い」「時刻表にない」で止まる。

**テーマ**（`player/themes/*.json`、`references/themes.md`）: 色・文字・線の定義。決めたテーマは構成メモの `basics.look.theme` に書く。台本と同じフォルダに構成メモがあれば、`check_storyboard.cjs`・`frames.cjs`・`build_player.py` は `--theme` を省くとそのテーマを使い、違うテーマを渡すと終了コード 2 で止まる（`uz_node.cjs` の `pickTheme` と `build_player.py` の `pick_theme`。2 か所を同じ約束に保つ）。`extract_design.py` が手持ちのデザイン（トークン・CSS・HTML・Tailwind・Office・画像・PDF）からテーマを作り、`check_theme.py` で検査する。

**作り手と評価役**: Claude Code では `agents/` のサブエージェントを使う（作り手は researcher = 調べる、writer = 台本の初稿と章単位の書き直し。評価役は fact-checker / writing-reviewer / director。animator は保留中で呼ばない）。チャットでは 1 会話で役を順に演じる。評価役は決まった関門ではなく、章立てが固まったとき・台本の初稿・絵コンテを見せる前・直した後・合成の前に呼ぶ。成功基準は `references/criteria/`（構成メモ O-、合意との照合 A-、台本 S-、図 G-、画面 V-。文章の規則は `references/writing/` の TW- と SP-。SP-11〜SP-14 は行と章のつながり）、評価役の約束と指摘の扱いは `references/review-protocol.md`、評価役の出力の形は `references/writing/review-format.md`。指摘にはレベル（must / should / nits）が付き、`scripts/ledger.py` の指摘の一覧に入る。どれを直すかは利用者が選ぶ（台本の初稿に限り、合意した内容を変えない指摘は進行役が 1 回だけ先に直す）。自動で合格まで回すことはしない。

## 守ること

- claude.ai のサンドボックスでも動くようにする: シェルは sh（`time` や `${PIPESTATUS}` を使わない）、CPU 1 つ・メモリ 4GB、chromium なし、通信は GitHub・PyPI・npm などだけ（jsDelivr には届かないので JS は同梱する）、長いコマンドは止められる（だから `tts.py` は `--budget` で区切る）
- 音声はプレーヤー内で WebAudio で鳴らす（チャットのプレビューでは audio 要素が拒否される）
- ナレーションを外部サービスへ送らない（VOICEVOX をその場で動かす）。VOICEVOX のクレジットを再生ページに出す
- GitHub への書き込み系のコマンドを、スキルの手順として実行させない
- `prototypes/compare/` は画風の見比べ用の試作で、本体からは使わない
