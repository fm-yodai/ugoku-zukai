# テーマ（画風）とデザインの入力

画面の色・文字・線はテーマ（JSON）で決まる。同じ台本をテーマだけ替えて描ける。

| テーマ | ファイル | 向く場面 |
|---|---|---|
| 3b1b 調 | `player/themes/3b1b.json` | 暗い背景・光る線。概念や仕組みの説明 |
| フラットな図解 | `player/themes/flat.json` | 明るい背景・塗りの箱。社内資料に馴染む |
| デザインから作る | `extract_design.py` で作る | 会社やプロダクトの色に合わせたいとき |

## インタビューでの聞き方

画風を聞くときは「3b1b 調 / フラットな図解 / 手持ちのデザインに合わせる」を出す。合わせる場合は、手元にあるものを何でも渡してもらう。デザインシステムである必要はない。

- トークンの JSON、CSS 変数、Tailwind の設定、claude.ai の Design System
- ブランドガイドの PDF、Web ページの URL、PowerPoint・Word のテンプレート
- スクリーンショットやスライドの画像、ロゴ
- 題材のリポジトリの CSS や UI 部品

## デザインからテーマを作る手順

1. 拾う: `python3 scripts/extract_design.py 入力… --report report.json --theme theme.json --name ブランド名`
   - claude.ai のサンドボックスでは URL を直接読めないことがある。そのときは web_fetch などで HTML を取り、ファイルに保存してから渡す
   - claude.ai の Design System は、その Artifact の tokens.json を保存して渡す
2. 確かめる: `report.json` の色の一覧（回数・名前・出どころ）と入力そのものを見比べ、下書きの役割が合っているか確かめる。とくに、名前の付いていない色だけの入力（画像・PDF・ブランドガイド）は推測なので、次を Claude が決め直す
   - `bg`（背景）・`ink`（本文）・`accent`（強調。ブランドの主色）
   - `roles` の 4 色（actor / process / store / external）。主色と、ブランドの補助色から選ぶ。足りなければ主色の色相を回した色でよい
   - `good` / `bad` / `warn` は意味の色。ブランドに赤や緑がなくても、見分けやすさを優先する
3. 検査する: `python3 scripts/check_theme.py theme.json`。不合格なら色の明るさを動かして直す（色相は保つ）
4. 見本で確かめる: 台本の検査（`check_storyboard.cjs --theme theme.json`）と下見で、箱の文字が読めるかを見る
5. 使ったテーマのファイルは成果物と一緒に残し、`derived_from` に入力を書く

## テーマの項目

```json
{
  "name": "kumo", "label": "くも運輸の Web ページから作る", "mode": "light",
  "colors": {
    "bg": "#fbf7f0", "surface": "#ece8e1", "ink": "#1f2a37", "muted": "#5b6573", "line": "#cfcac2",
    "accent": "#0e7c86", "good": "#2d9656", "bad": "#d64541", "warn": "#b26a00",
    "roles": { "actor": "…", "process": "…", "store": "…", "external": "…", "muted": "…", "added": "…", "removed": "…" }
  },
  "font": { "family": "\"Zen Kaku Gothic New\", \"Noto Sans JP\", sans-serif", "weight": 400, "bold": 700,
            "css": "https://fonts.googleapis.com/css2?family=…" },
  "shape": { "radius": 12, "stroke": 2.2, "fill": "solid", "fillMix": 0.12, "fillAlpha": 0.14, "edgeWidth": 2.1, "glow": false, "shadow": true },
  "subtitle": { "bg": "#fdfbf8f0", "ink": "#1f2a37" }
}
```

- `shape.fill`: `solid`（背景と役割の色を `fillMix` で混ぜた塗り）・`tint`（役割の色を `fillAlpha` で透かす。暗い背景向き）・`none`
- `glow`: 線と点を光らせる（暗い背景向き）。`shadow`: 箱に薄い影（明るい背景向き）
- `font.css` は Google Fonts の URL だけ読める（Artifact の制限）。ブランドのフォントが Google Fonts にないときは、`family` の先頭に書いておき（手元に入っていれば使われる）、日本語の Google Fonts を後ろに足す

## 検査の基準（check_theme.py）

- 本文・補足・強調と背景、箱の塗りの上の本文、字幕: コントラスト 4.5 以上
- 役割の色・good / bad / warn と背景: 3 以上（図形の線）
- 役割の 4 色どうし・good と bad: 色差 ΔE 20 以上
