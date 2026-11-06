# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリ

題材（コード・リポジトリ・PR・Web ページ・文書・題目）を、日本語ナレーション付きの「動く図解」（HTML 1 枚の再生ページ）にする Claude プラグイン `ugoku-zukai`。本体はスキル `skills/make/`。claude.ai / Claude Desktop のチャットと Claude Code の両方で動かすことが前提。

- 設計の正は `docs/design.md`。マイルストーン（M1a / M1b / M2 済み、M3 進行役は手順まで書いて両環境での通しが残り、M4 以降は未着手）、合意済みの要件、claude.ai のサンドボックスで確かめた事実（通信先・道具・制約）はここにある。仕様を変えたら、ここの「Mn の実装」節に追記する
- 文書・コメント・コミットメッセージは日本語。コミットは `M2: 〜` のようにマイルストーンを頭に付ける
- 前身は個人用スキル explain-video-anywhere（v1、Manim＋Docker の VOICEVOX）。`agents/` と `references/criteria/` などは v1 からの移植で、M3 で新しいプレーヤー向けに書き換えた（保留中の `agents/animator.md` だけ v1 の Manim 用のまま）

## コマンド

依存のインストール手順はない（python3 と node をそのまま使う。elkjs は `player/vendor/` に同梱）。

```bash
# まとめての検査（見本台本 × テーマ 3 種の配置検査・テーマの検査・デザイン抽出）。run_m3.sh は M1 に続けて台帳・字幕・コマ・進行役の文書を検査する
bash skills/make/scripts/tests/run_m1.sh
bash skills/make/scripts/tests/run_m3.sh

# 台本 1 本の検査（形・id の解決・配置）。--timeline で実際の声の長さでも検査する
node skills/make/scripts/check_storyboard.cjs skills/make/examples/sequence.json --theme flat [--timeline work/timeline.json] [--json]

# テーマの検査（コントラストなど）
python3 skills/make/scripts/check_theme.py skills/make/player/themes/3b1b.json

# 契約の検査（<workdir>/contract.json を読む。テスト用の例は scripts/tests/contracts/）
python3 skills/make/scripts/check_contract.py skills/make/scripts/tests/contracts/ok_repo

# 字幕と読みの検査（禁止語・ずんだもんの語尾・辞書にない英字の語）
python3 skills/make/scripts/check_text.py skills/make/examples/sequence.json

# 作業フォルダを題材の外に作る（${CLAUDE_PLUGIN_DATA}/runs/<日時>-<名前>。パスを 1 行で出す）
python3 skills/make/scripts/workdir.py new this-repo

# 各行の落ち着いたコマ（SVG と PNG のシート）。PNG には初回だけ resvg を入れる。終了コード 4 = PNG なし（SVG と frames.json だけ）
python3 skills/make/scripts/setup_render.py
node skills/make/scripts/frames.cjs skills/make/examples/sequence.json --theme flat -o work/frames

# 声: 初回だけ VOICEVOX を入れ（約 94MB）、1 行ずつ合成して timeline.json と narration.mp3 を作る
python3 skills/make/scripts/setup_voice.py --agree
python3 skills/make/scripts/tts.py <storyboard.json> -o work      # 終了コード 3 = 時間切れで続きあり。同じコマンドを繰り返す

# 組み立て（--artifact は Artifact 用に <html>/<head>/<body> を外した断片を書く）
python3 skills/make/scripts/build_player.py <storyboard.json> --theme 3b1b --voice work -o player.html [--artifact]

# 見本帳（全見本 × 全テーマ）、claude.ai 用 zip、claude.ai での声の検証用 zip（出力は dist/）
python3 tools/build_gallery.py
python3 tools/build_claude_ai_zip.py
python3 tools/build_voice_check.py
```

## 全体の構造

**流れ**: 0 準備 → 1 インタビュー → 2 取材と契約（`contract.json`）→ 3 人の確認（1 回だけ）→ 4 台本（`storyboard.json`）→ 5 画面（`frames.cjs`、見積もりの時刻）→ 6 音声（`tts.py`）→ 7 組み立て（`build_player.py`）と Artifact での公開 → 8 報告。手順は `skills/make/SKILL.md`、環境ごとのコマンドは `references/run-code.md`（Claude Code）と `references/run-chat.md`（チャット）。

**プレーヤー（`skills/make/player/src/`）は、ブラウザと node で同じコードを動かす**のが要。
- `util → figures → figures2 → validate → engine → check` は DOM に触らない。グローバルの `UZ` に生えていく（`UZ.build(storyboard, theme, timeline)` が配置と時刻を計算する）。DOM に触るのは `view_svg.js` だけ
- node 側は `scripts/uz_node.cjs` が `vm.runInThisContext` で同じファイルを読み込み、`check_storyboard.cjs` が配置を検査する。ブラウザ側は `build_player.py` が `template.html` の `/*UZ:ELK*/` `/*UZ:CORE*/` `/*UZ:DATA*/null` を置き換えて 1 枚に埋め込む
- ファイルの読み込み順は `uz_node.cjs` の `SRC` と `build_player.py` の `CORE` の 2 か所に書いてある。ソースファイルを足したら両方に足す（`tools/build_voice_check.py` の同梱リストも確認）
- 文字の幅はフォントを実測せず文字の種類から見積もる（node の検査とブラウザで同じ値にするため）。この前提を崩さない
- 図の種類: `figures.js`（箱と矢印＝ELK で自動配置、シーケンス、表・比較・箇条）、`figures2.js`（提案資料系 10 種。ELK を使わず図ごとの固定配置）

**台本の形式**（`ugoku-zukai/2`、仕様は `references/storyboard.md`、見本は `examples/`）: 意味で書く層（図の宣言・`show` `trace` `focus` などの動作）が基本で、足りないところだけ下の層で直接書く。動作は字幕の文中の印（`{a}`）に結ぶ。時刻表がなければ文字数から見積もり、あれば `tts.py` がモーラ単位で出した印の時刻を使う。台本の文が合成後に変わると、組み立てが「音声が古い」で止まる。

**テーマ**（`player/themes/*.json`、`references/themes.md`）: 色・文字・線の定義。`extract_design.py` が手持ちのデザイン（トークン・CSS・HTML・Tailwind・Office・画像・PDF）からテーマを作り、`check_theme.py` で検査する。

**maker-checker**: Claude Code では `agents/` のサブエージェント（作り手 researcher / writer、評価役 fact-checker / writing-reviewer / director。animator は保留中で呼ばない）で回し、チャットでは 1 会話で役を順に演じる。成功基準は `references/criteria/`、周回の約束は `references/loop-protocol.md`、台帳は `scripts/ledger.py`（判定は終了コード: PASS 0 / CONTINUE 10 / STOP_* 20〜22）。

## 守ること

- claude.ai のサンドボックスでも動くようにする: シェルは sh（`time` や `${PIPESTATUS}` を使わない）、CPU 1 つ・メモリ 4GB、chromium なし、通信は GitHub・PyPI・npm などだけ（jsDelivr には届かないので JS は同梱する）、長いコマンドは止められる（だから `tts.py` は `--budget` で区切る）
- 音声はプレーヤー内で WebAudio で鳴らす（チャットのプレビューでは audio 要素が拒否される）
- ナレーションを外部サービスへ送らない（VOICEVOX をその場で動かす）。VOICEVOX のクレジットを再生ページに出す
- GitHub への書き込み系のコマンドを、スキルの手順として実行させない
- `prototypes/compare/` は画風の見比べ用の試作で、本体からは使わない
