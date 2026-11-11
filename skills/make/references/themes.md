# テーマ（画風）とデザインの入力

画面の色・文字・線はテーマ（JSON）で決まる。同じ台本をテーマだけ替えて描ける。

| テーマ | ファイル | 向く場面 |
|---|---|---|
| 3b1b 調 | `player/themes/3b1b.json` | 暗い背景・光る線。概念や仕組みの説明 |
| フラットな図解 | `player/themes/flat.json` | 明るい背景・塗りの箱。社内資料に馴染む |
| デザインから作る | `extract_design.py` で作る | 会社やプロダクトの色に合わせたいとき |

## 見た目の聞き方

見た目を決めるときは「3b1b 調 / フラットな図解 / 手持ちのデザインに合わせる」を候補に出す（利用者が別の希望を言える余地を残す）。合わせる場合は、手元にあるものを何でも渡してもらう。デザインシステムである必要はない。

- トークンの JSON、CSS 変数、Tailwind の設定、claude.ai の Design System
- ブランドガイドの PDF、Web ページの URL、PowerPoint・Word のテンプレート
- スクリーンショットやスライドの画像、ロゴ
- 題材のリポジトリの CSS や UI 部品

## 決めたテーマに従う

見た目が決まったら、構成メモの `basics.look.theme` にテーマの名前（`3b1b`・`flat`）か、作業フォルダの中のファイル名（`theme.json`）を書く。ここに書いたテーマが、その動画のテーマである。

- 検査（`check_storyboard.cjs`）・コマ（`frames.cjs`）・組み立て（`build_player.py`）は、台本と同じフォルダの構成メモを読み、`--theme` を省くとそのテーマを使う。**違うテーマを `--theme` で渡すと、何も書かずに止まる**（文書の例にある `--theme flat` を写しても、決めたテーマから外れない）
- 見た目を変えるときは、利用者と決めてから、構成メモを先に直す
- 利用者がデザインを渡したら、そのデザインがテーマの正である。同梱のテーマ（`3b1b`・`flat`）や見本のテーマの値で置き換えない

## デザインからテーマを作る手順

1. 拾う: `python3 scripts/extract_design.py 入力… --report <workdir>/design-report.json --theme <workdir>/theme.json --name ブランド名`
   - claude.ai のサンドボックスでは URL を直接読めないことがある。そのときは web_fetch などで HTML を取り、ファイルに保存してから渡す
   - claude.ai の Design System は、その Artifact の tokens.json を保存して渡す
2. **下書きから始める。** `theme.json` は `extract_design.py` が書いた下書きを直して作る。新しく書き起こさない。同梱のテーマや、この文書の「テーマの項目」の例から値を写さない（写すと、渡されたデザインから外れる）。直してよいのは次のときだけで、直したら理由を報告に書く
   - 役割の読み違い: `design-report.json` の色の一覧（回数・名前・出どころ）と入力そのものを見比べ、背景・本文・強調が違っていたら、**デザインにある色の中から**選び直す。名前の付いていない色だけの入力（画像・PDF・ブランドガイド）は推測なので、必ず見比べる
   - `roles` の 4 色（process / actor / store / external）は図の箱の色で、画面の印象をいちばん左右する。**デザインにある色だけで作る。** 何も書かない箱は `process` になるので、`process` にデザインの主色を当てる。残りは、デザインの補助色、次にデザインの無彩色（灰色や紺）から選ぶ。明るすぎる色は、デザインに同じ色相の暗い色があればそれを使う。色相を回して新しい色を作るのは、デザインの色が 4 つに足りないときだけで、作ったら利用者に伝える
   - `good` / `bad` / `warn` は意味の色。デザインに赤や緑がなくても、見分けやすさを優先する
   - コントラストの不合格: 色の明るさだけを動かす（色相は保つ）
3. 検査する: `python3 scripts/check_theme.py <workdir>/theme.json --design <workdir>/design-report.json`。読みやすさ（コントラスト）に加えて、テーマがデザインから外れていないかを見る。背景・本文はデザインの色そのまま、強調はデザインの色相、字体の先頭はデザインの字体、デザインが影を使わないなら影なし、が合格の条件。出力の「デザイン: bg … ← デザインの …」の行が、どの色がデザインのどの色から来たかの記録になる
4. 構成メモに書く: `basics.look.theme` に `theme.json` と書く。以後の道具は、このテーマを使う
5. **図の色の見本を、台本を書く前に利用者に見せる。** 見本の台本をそのテーマで絵コンテにして見せ（下のコマンド。4 つの役割の箱と印が出る）、3 の「デザイン:」の行を添える（どの色をどこに使ったか。デザインにない色を足したなら、その理由）。図の色が渡したデザインと違って見えたら、ここで直す

   ```sh
   node scripts/frames.cjs examples/graph-flow.json --theme <workdir>/theme.json -o <workdir>/frames-theme
   python3 scripts/build_sheet.py examples/graph-flow.json --frames <workdir>/frames-theme -o <workdir>/theme-sample.html --artifact
   ```
6. 台本ができたら、台本の検査（`check_storyboard.cjs`）と下見で、箱の文字が読めるかを見る
7. 使ったテーマのファイルは成果物と一緒に残す（`derived_from` に入力が入っている）

## テーマの項目

項目の形だけを示す。値は、同梱のテーマを選んだならそのファイル、デザインから作るなら `extract_design.py` の下書きにある。

| 項目 | 中身 |
|---|---|
| `name`・`label`・`mode` | テーマの名前、説明、`light` か `dark` |
| `colors.bg`・`surface`・`ink`・`muted`・`line`・`accent` | 背景、面、本文、補足、線、強調 |
| `colors.good`・`bad`・`warn` | 意味の色 |
| `colors.roles` | 役割の色: `actor`・`process`・`store`・`external`・`muted`・`added`・`removed` |
| `font.family`・`weight`・`bold`・`css` | 字体の並び、太さ、Google Fonts の URL |
| `shape.radius`・`stroke`・`fill`・`fillMix`・`fillAlpha`・`edgeWidth`・`glow`・`shadow` | 角丸、線の太さ、塗り方、光らせるか、影 |
| `subtitle.bg`・`ink` | 字幕の帯と文字 |

- `shape.fill`: `solid`（背景と役割の色を `fillMix` で混ぜた塗り）・`tint`（役割の色を `fillAlpha` で透かす。暗い背景向き）・`none`
- `glow`: 線と点を光らせる（暗い背景向き）。`shadow`: 箱に薄い影（明るい背景向き）
- `font.css` は Google Fonts の URL だけ読める（Artifact の制限）。ブランドのフォントが Google Fonts にないときは、`family` の先頭に書いておき（手元に入っていれば使われる）、日本語の Google Fonts を後ろに足す

## 検査の基準（check_theme.py）

- 本文・補足・強調と背景、箱の塗りの上の本文、字幕: コントラスト 4.5 以上
- 役割の色・good / bad / warn と背景: 3 以上（図形の線）
- 役割の 4 色どうし・good と bad: 色差 ΔE 20 以上
- `--design` を付けたとき: 背景・本文がデザインの色（色差 ΔE 2 以内）、強調がデザインの有彩色と同じ色相、字体の先頭がデザインの字体、デザインが影を使わないなら `shadow` が false。役割の色がデザインにないときは注意
