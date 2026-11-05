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
  version: "0.1.0"
---

# 動く図解を作る

> **開発中（0.1.0）**: プレーヤーの芯（台本の形式・テーマ・箱と矢印/シーケンス/箇条・比較・表）までできた。音声（M2）と進行の手順（M3）はまだない。動画が必要なら、音声なしの下見までしか作れないことをユーザーに伝える。設計は `docs/design.md`（リポジトリの直下）が正。

## 役割

題材を「問い → 全体像 → 流れに沿った詳解 → まとめ」の順に、動く図とナレーションで見せる。判断の優先順位は **正確さ > 分かりやすさ > 見た目**。根拠のない処理・数値・分岐を絵のために足さない。

## 最初に環境を判定する

| 手がかり | 環境 | 進め方 |
|---|---|---|
| Agent ツールがあり、`ugoku-zukai:researcher` などのサブエージェントを呼べる | Claude Code | 作り手と評価役をサブエージェントに分ける（`references/loop-protocol.md`） |
| サブエージェントがない（claude.ai / Desktop のチャット） | チャット | 1 つの会話で役を順に演じる。評価役の番では、作り手の取材メモや推論を読み返さず、成功基準（`references/criteria/`）と一次資料だけで判定する |

どちらの環境でも、機械検査と組み立ては同じスクリプトを使う。

## 流れ

1. **インタビュー**: 読者・一番分かってほしいこと・範囲・構成の型（`references/structures.md`）・長さ・声・画風・描き方を聞く。AskUserQuestion、なければフォーム、なければ文章で聞く
   - 画風は「3b1b 調 / フラットな図解 / 手持ちのデザインに合わせる」から選んでもらう。合わせる場合は、デザインシステムでなくても手元の資料（Web ページ・画像・PowerPoint・CSS など）を何でも受け取り、`references/themes.md` の手順でテーマにして検査する
   - 描き方の既定は「標準（宣言型の台本＋SVG プレーヤー）」。数式・3D・手作りの絵が要る題材だけ manim-web を勧める
   - VOICEVOX の音声モデルの利用規約への同意も、ここで取る
2. **取材と契約**: 一次資料を読み、根拠つきの契約 `contract.json` を書く。検査には `scripts/check_contract.py` を使い、基準は `references/criteria/contract.md`
3. **台本**: `storyboard.json`（図の宣言・字幕と文中の印・根拠・動作）を書く。形式は `references/storyboard.md`、見本は `examples/`、文章の規則は `references/writing/rules.md`。書いたら `node scripts/check_storyboard.cjs` で検査する
4. **音声**: voicevox_core で 1 行ずつ合成して mp3 にまとめる（未実装）
5. **組み立て**: `python3 scripts/build_player.py storyboard.json --theme … [--timeline … --audio …] -o player.html [--artifact]` で、台本・テーマ・音声をプレーヤーの HTML 1 枚に埋め込む（音声と時刻表は M2）
6. **公開**: Artifact で公開する。閉じなかった指摘は残論点として、ページとチャットの両方に示す

## 不変条件

1. 契約と台本の主張には根拠を付ける（`path:line`、PR・issue 番号、URL と引用、`file:p.N`）
2. 各フェーズは、評価役の合格か、3 周での打ち切りを経てから次へ進む。閉じなかった指摘は残論点として必ず示す
3. GitHub への書き込み系のコマンドは実行しない。ユーザーの作業ツリーで pull や checkout もしない
4. ナレーションを外部サービスへ送らない（音声合成は VOICEVOX をその場で動かす）。VOICEVOX のクレジットを、動画と再生ページの両方に出す
5. 音声はプレーヤーの中で WebAudio で鳴らす（チャットのプレビューでは audio 要素が拒否されるため）
