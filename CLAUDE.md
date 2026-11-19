# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリ

題材（コード・リポジトリ・PR・Web ページ・文書・題目）を、日本語ナレーション付きの「動く図解」（HTML 1 枚の再生ページ）にする Claude プラグイン `ugoku-zukai`。本体はスキル `skills/make/`。claude.ai / Claude Desktop のチャットと Claude Code の両方で動かすことが前提。

- 設計の正は `docs/design.md`。マイルストーン（M1a / M1b / M2 / M3 済み。進め方の作り直し R1〜R4 と、両環境での通しも 2026-11-16 に済んだ。M4 の mp4 書き出しは 2026-11-16 に保留にした。M6 配布は 2026-11-17 に公開まで済んだ（感想集めは続く）。M7 カメラと連続性（Morph・zoom・pan・draw。§18）は 2026-11-18 に済んだ（意味のズームと 2.5D は M9 へ）。M5 は 2026-11-18 に取り下げ、数式と 3D を標準のプレーヤーの延長で作ることにした。R5 プロンプトの宣言的な書き直し（§19）は 2026-11-18 に済んだ（評価役の定義まで書き換え、振る舞いのチューニングも利用者が試していったん済みとした）。表現を足す M8 数式と座標（値の連動・幾何の道具・数式・暗いテーマ kuro）は 2026-11-18 に済んだ。M9 立体と奥行き（3D の部品 space・意味のズーム inside と、M7 の制限 1〜8 の直し）は 2026-11-19 に済んだ。writer の初稿を利用者が見て、2.5D の板 plate は見せ方の一覧から外して保留にした（コードとテストは残す）。次は M10 コードと画面操作 → M11 分かりやすさの知識（§20））、合意済みの要件、claude.ai のサンドボックスで確かめた事実（通信先・道具・制約）はここにある。仕様を変えたら、ここの「Mn の実装」節に追記する
- 文書・コメント・コミットメッセージは日本語。コミットは `M2: 〜` のようにマイルストーンを頭に付ける（進め方の作り直しは `R3: 〜`、スライドを先に作る作り直しは `R4: 〜`、プロンプトの宣言的な書き直しは `R5: 〜`）
- 前身は個人用スキル explain-video-anywhere（v1、Manim＋Docker の VOICEVOX）。`agents/` と `references/criteria/` などは v1 からの移植で、M3 で新しいプレーヤー向けに、R2 で構成メモを物差しにする形に書き換えた（保留中の `agents/animator.md` だけ v1 の Manim 用のまま）

## コマンド

依存のインストール手順はない（python3 と node をそのまま使う。elkjs と数式の組版の束 `mathjax-uz.js` は `player/vendor/` に同梱。束は `tools/build_mathjax.sh` で作り直す）。

```bash
# まとめての検査。ふだんは run_m9.sh だけ回せば全部走る（m9 → m8 → m7 → r4 → r3 → r2 → r1 → m3 → m1 の順に呼ぶ）
#   run_m9.sh: 立体と奥行き（test_m9.cjs。space・inside・geo.space と M7 の制限の直し。保留中の板 plate も）、見本 depth（kuro）、「奥行き」の文書と G-D22
#   run_m8.sh: 値・set・custom の部品・幾何の道具 geo・数式（test_m8.cjs。geometry.md のリファレンスが写せば描けるかも見る）、見本 math-geometry（kuro。完成形のコマに数式の字形）、「値と数式」の文書と G-D20・G-D21
#   run_m1.sh: 見本台本 × テーマ 3 種の配置検査・テーマの検査・デザイン抽出
#   run_m3.sh: 字幕と読み・コマ・再生ページ・作業フォルダと、文書とスクリプトの食い違い
#   run_r1.sh: 構成メモ・台本の章・スライドコンテのページ
#   run_r2.sh: 指摘の一覧・成功基準・エージェントの定義・進行役の文書
#   run_r3.sh: 再生ページの位置の表示・公開先の記録と作業フォルダの一覧・声の試聴・直しの文書（VOICEVOX があれば、試聴と声の使い回しも）
#   run_m7.sh: 台本の形式 /4 と、morph・zoom・pan・draw の検証、見本 camera-morph（Morph・カメラ・線の描画）のコマ、「キャンバスとカメラ」の文書
#   run_r4.sh: スライド（区画・テキスト・画像・フレーム・完成形のコマ・blur）、図と動作の追加（包含のベン図・ロードマップの矢印・象限の塗り分け・resize）、スライドの文字の検査、構成メモと台本のスライドの照合、案の見比べ（alts.py）、進行役の文書、評価役と基準の文書（物差しが意図になっているか。前の進め方の言葉が残っていないか）
bash skills/make/scripts/tests/run_m9.sh

# 台本 1 本の検査（形・id の解決・配置）。--timeline で実際の声の長さでも検査する
node skills/make/scripts/check_storyboard.cjs skills/make/examples/sequence.json --theme koo [--timeline work/voice/timeline.json] [--json]

# 構成メモの検査（<workdir>/outline.json か、ファイルを直接渡す。形式は references/outline.md の ugoku-zukai-outline/2 = 3 段の意図。見本は examples/outlines/）。--ready は台本に進める状態か（基本・章の順番の意図・章の意図）も見る。前の形式 /1（says・shows）も読める
python3 skills/make/scripts/check_outline.py skills/make/examples/outlines/ux.json [--ready] [--json]
python3 skills/make/scripts/check_outline.py <workdir> --agree-all   # 利用者が全部を見て通したとき、proposed をまとめて agreed にする

# 台本と構成メモの突き合わせ（場面の chapter と構成メモの章、章ごとの見積もりの長さ、構成メモのスライドと台本のスライドの id）。--complete は台本を書き終えたものとして見る
node skills/make/scripts/check_storyboard.cjs skills/make/scripts/tests/outlines/pair/storyboard.json --outline skills/make/scripts/tests/outlines/pair/outline.json [--complete]

# テーマの検査（コントラストなど）。--design で、取り込んだデザイン（extract_design.py の報告）から外れていないかも見る
python3 skills/make/scripts/check_theme.py skills/make/player/themes/koo.json
python3 skills/make/scripts/extract_design.py <デザインの資料…> --report <workdir>/design-report.json --theme <workdir>/theme.json --name <名前>
python3 skills/make/scripts/check_theme.py <workdir>/theme.json --design <workdir>/design-report.json

# 字幕と読みの検査（禁止語・ずんだもんの語尾・辞書にない英字の語）
python3 skills/make/scripts/check_text.py skills/make/examples/sequence.json

# 指摘の一覧（<workdir>/review/ledger.json）。評価役の出力を取り込み、利用者に見せる形で出し、直す・直さないの選択を記録する
python3 skills/make/scripts/ledger.py ingest <workdir> <評価役の出力.json …>
python3 skills/make/scripts/ledger.py list <workdir> [--full] [--by lead|user] [--state open,fixing,kept,closed] [--json]   # must は全文、should は 1 件 1 行、nits は件数だけ
python3 skills/make/scripts/ledger.py decide <workdir> --by lead|user [--fix <key> …] [--keep <key> …]   # lead = 進行役が先に直した、user = 利用者が選んだ。--keep は user だけ
python3 skills/make/scripts/ledger.py decide <workdir> --by lead|user --close <key> … --note <理由>   # 直し中の指摘を、再確認なしで閉じる（must は user だけ。user は未対応の指摘も閉じられる）
python3 skills/make/scripts/ledger.py status <workdir>     # 件数の要約
python3 skills/make/scripts/ledger.py residual <workdir>   # must で直っていない指摘（残論点）を review/residual.md に書く

# 作業フォルダを題材の外に作る（${CLAUDE_PLUGIN_DATA}/runs/<日時>-<名前>。パスを 1 行で出す）
python3 skills/make/scripts/workdir.py new this-repo
# 公開先を作業フォルダに記録する（published.json）。過去の作業フォルダを新しい順に出す（別のセッションから直すときに使う）
python3 skills/make/scripts/workdir.py publish <workdir> --url <Artifact の URL> [--theme koo] [--source <題材の場所>]
python3 skills/make/scripts/workdir.py list [--json]

# 各行の落ち着いたコマ（SVG と PNG のシート）と、スライドごとの完成形（svg/slide-<id>.svg と slide-<id>.png）。PNG には初回だけ resvg を入れる。終了コード 4 = PNG なし（SVG と frames.json だけ）
python3 skills/make/scripts/setup_render.py
node skills/make/scripts/frames.cjs skills/make/examples/sequence.json --theme koo -o work/frames
node skills/make/scripts/frames.cjs skills/make/examples/mixed.json --theme koo -o work/frames-s2 --scenes s2   # 一部の場面のコマだけ書く（カンマ区切り。出力先の前の回のコマは消えるので、全体とは分ける。--lines l8,l33 なら、その行のある場面）

# 利用者向けのスライドコンテのページ（スライドごとに完成形のコマ、行ごとにコマと「s2 / l2 @0:14」と字幕の全文。PNG は要らない。--outline で章の題と、章・スライドの意図とつながりが付く。出すのはスライド・原稿・意図だけ。台本を直したら frames.cjs を回し直す。コマが古いと終了コード 2 で止まる）
python3 skills/make/scripts/build_sheet.py skills/make/examples/slide-forms.json --frames work/frames -o work/sheet.html [--outline skills/make/examples/outlines/slide-forms.json] [--alts <workdir>/alts.json] [--voice work/voice] [--no-play] [--artifact]   # 既定で章ごとに「この章を再生」（音声なし・字幕あり。テーマはコマを書いたときのもの。--voice の timeline.json があればその時刻で、そのときはコマも frames.cjs --timeline で書く。食い違うと終了コード 2）。--no-play で JS なしの軽いページ

# スライドの複数案（2〜4 つ）を作り、スライドコンテの中に並べ、選んだ案を台本と構成メモに入れる。案の台本は <workdir>/storyboard.<組>-<案>.json、コマは <workdir>/alts/<組>/<案>/frames、一覧は <workdir>/alts.json
python3 skills/make/scripts/alts.py new <workdir> g1 --replaces <スライドの id,…> --options a,b [--keep-current]
python3 skills/make/scripts/alts.py frames <workdir> [--theme koo]   # この後、build_sheet.py --alts <workdir>/alts.json で並べる
python3 skills/make/scripts/alts.py pick <workdir> g1 b               # 選ばないときは drop <workdir> g1

# 声: 初回だけ VOICEVOX を入れ（約 94MB）、1 行ずつ合成して timeline.json と narration.mp3 を作る
python3 skills/make/scripts/setup_voice.py --status   # 入っているかと、利用規約への同意の記録があるか（終了コード 0 = 聞かずに使える、3 = 利用者に聞く）
python3 skills/make/scripts/setup_voice.py --agree    # 利用者が同意したときだけ。同意の日時と規約の場所を、置き場の consent.json に記録する
python3 skills/make/scripts/tts.py <storyboard.json> -o work/voice --readings   # 合成せずに読みの一覧 work/voice/readings.md を書く（合成の前の確認。辞書は既定で work/voice_dict.json を重ねる）
python3 skills/make/scripts/tts.py <storyboard.json> -o work/voice   # 終了コード 3 = 時間切れで続きあり。同じコマンドを繰り返す
python3 skills/make/scripts/tts.py -o work/voice --audition 8,2,3 --sample "聞き比べる文です。" [--artifact]   # 声の試聴。同じ 1 文を話者ごとに読ませたページ work/voice/audition.html を書く（--sample を省くと台本の最初の行）

# 組み立て（--artifact は Artifact 用に <html>/<head>/<body> を外した断片を書く）
python3 skills/make/scripts/build_player.py <storyboard.json> --theme koo --voice work/voice -o player.html [--artifact]

# 見本帳（全見本 × 全テーマ）、claude.ai 用 zip、claude.ai での声の検証用 zip（出力は dist/）
python3 tools/build_gallery.py
python3 tools/build_claude_ai_zip.py
python3 tools/build_voice_check.py
```

## 全体の構造

**進め方**: 意図 → スライド → 原稿の順に作る。細かく決まった手順はない。進行役（`SKILL.md` を実行しているセッション）が利用者と話して、基本（聴衆・持ち帰ってほしいこと・長さなど）、章の順番の意図、章の意図を固め、構成メモ（`outline.json`。`ugoku-zukai-outline/2`。`by` = 誰が言ったか、`state` = 利用者が見たか）に書く。意図は聴衆の側から書く。話題ごとに「聞く・案を出す・調べる」を選び、案を出すときは他の選択肢を残す。次に、進行役か writer が章ごとにスライドの案（完成形、1 枚ごとの意図、動かし方、原稿の初稿）を台本（`storyboard.json`。場面の `chapter` で構成メモの章を指し、スライドの id で構成メモのスライドと結ぶ）に書き、スライドコンテ（`frames.cjs`・`build_sheet.py`）で利用者に見せる。スライドコンテのページに出すのは、スライド・原稿・意図だけで、進行役が決めたことや検査の結果は会話で伝える。迷ったスライドは、案を 2〜4 つ作ってスライドコンテの中に並べ、利用者に選んでもらう（`alts.py`。Artifact は増やさず、同じページを更新する）。任されたら、スライドコンテまで自分で決めてから見せる。スライドが固まってから評価役に原稿を見せ、声（`tts.py --readings` で読みを確かめてから合成）→ 組み立て（`build_player.py`）と Artifact での公開、と進む。順番として守るのは 3 つだけ: 声を合成する前に利用者がスライドコンテを見ている、公開する前に機械検査が通っている、must を直さずに公開するときは報告に残論点として書く。公開した後は、利用者が再生ページの「直したい箇所を指定する」で出る `s2 / l2 @0:14`（場面 / 行 @時刻）を伝えて直しを頼む。直すのは指された行だけで、変えていない行の声は作り直さない。Claude Code では、`workdir.py list` で作業フォルダを探して、別のセッションからも直せる。原則と道具の一覧は `skills/make/SKILL.md`、環境ごとのコマンドは `references/run-code.md`（Claude Code）と `references/run-chat.md`（チャット）。

**プレーヤー（`skills/make/player/src/`）は、ブラウザと node で同じコードを動かす**のが要。
- `util → figures → figures2 → figures3 → validate → slides → geo → space → engine → check` は DOM に触らない。グローバルの `UZ` に生えていく（`UZ.build(storyboard, theme, timeline)` が配置と時刻を計算する）。DOM に触るのは `view_svg.js` だけ
- node 側は `scripts/uz_node.cjs` が `vm.runInThisContext` で同じファイルを読み込み、`check_storyboard.cjs` が配置を検査する。ブラウザ側は `build_player.py` が `template.html` の `/*UZ:ELK*/` `/*UZ:CORE*/` `/*UZ:DATA*/null` を置き換えて 1 枚に埋め込む
- ファイルの読み込み順は `uz_node.cjs` の `SRC` と `build_player.py` の `CORE` の 2 か所に書いてある。ソースファイルを足したら両方に足す（`tools/build_voice_check.py` の同梱リストも確認）
- 数式は MathJax の束（`player/vendor/mathjax-uz.js`。グローバル `UZMJ` の `tex2tree` が TeX を SVG の木にする）で組む。node は `uz_node.cjs` が先に読み、ブラウザは `template.html` の `/*UZ:MATH*/` に埋め込む（`build_player.py` の `engine_scripts`。`build_sheet.py`・`tools/build_gallery.py` も同じ関数を使う）。数式の寸法は MathJax が出す値を使う
- 幾何の道具 `geo.js`（`UZ.makeGeo`。座標・グラフ・接線・面積・ベクトル・数式と変形）は、`custom` の部品の関数に `geo` として渡る。要素は受け取った `el` で作り、自分では DOM に触らない。検査（`check.js` の `UZ.checkCustoms`）は `svg_dom.cjs` の最小の DOM で関数を実際に描き、例外・TeX の誤り・NaN・はみ出しを見る
- 文字の幅はフォントを実測せず文字の種類から見積もる（node の検査とブラウザで同じ値にするため）。この前提を崩さない
- 図の種類: `figures.js`（箱と矢印＝ELK で自動配置、シーケンス、表・比較・箇条）、`figures2.js`（提案資料系 10 種。ELK を使わず図ごとの固定配置）、`figures3.js`（スライドの部品のうち図でないもの = テキスト・画像・フレーム）
- スライド（`slides.js`）: 場面は、図の代わりにスライド（見出し・言いたいこと・12 列 × 6 行の区画に並べた部品）を指せる。部品は図と同じもの（`M.figs` の 1 件）として扱うので、動作と id の解決は図のときと同じ。画像は、道具が先に読んで渡す（node は `scripts/assets.cjs`、組み立ては `scripts/uz_assets.py`。2 つを同じ約束に保つ）
- Morph とカメラ（M7）も engine が「時刻 → 2D の変換」として計算し、DOM は `view_svg.js` が本文の区画に transform と clip を掛けるだけ。Morph でつながる graph の系列は、和集合を 1 回だけ ELK にかけた 1 枚のキャンバスで、各スライドは自分の部分を写す（framing）。カメラの値は `UZ.CAMERA`（`engine.js`）
- 立体（M9）は `space.js`（`UZ.SPACE`）が平行投影と奥から順に塗る並べ替え（画家のアルゴリズム）を受け持ち、部品 `space` と `geo.space` が同じ核を使う。描き方は custom の部品と同じく毎コマ描き直す。`inside` の中身と、保留中の板 `plate` の図は「子の図」（`UZ.childDecls`・`UZ.childFigs`）として場面に加わり、中身は箱に寄った倍率でクロスフェードし、板は行列 1 つで空間に写す

**台本の形式**（`ugoku-zukai/6`。前の `/5`・`/4`・`/3` と、`/2` = 場面が図だけを指す形も読める。`/6` で足したのは、3D の空間の部品 `space`（`"type": "space"`。点・線・矢印・面・箱・曲面・曲線・文字を置き、カメラの `yaw`・`pitch` も値で動かす）と、`graph` の箱の `inside`（寄ると中身の図が現れる。入れ子は 3 段まで）。`space` の要素の板 `plate`（2D の図を空間の長方形に置き、`tilt` で起こす）も足したが、保留中で、書くと検査が警告する。見本は `examples/depth.json`。`/5` で足したのは、最上位の名前付きの値 `values`、値を動かす動作 `set`（場面をまたいで続き、時刻だけで決まる）、値に連動して関数で描く `custom` の部品（`"type": "custom"`。関数は `{ g, v, t, el, S, UZ, geo, w, h }` を受け取る。道具とリファレンス R1〜R6 は `references/geometry.md`、見本は `examples/math-geometry.json`）。`/4` で足したのは、部品の `morph`（前のスライドの同じ type の図から、要素の id でつないで変形する）、動作の `zoom`・`pan`（本文の区画だけを寄せる。スライドが変わると戻る）、`show` の `draw`（線が伸びてから塗りと文字が出る）。仕様は `references/storyboard.md`、見本は `examples/`）: 意味で書く層（図の宣言・`show` `trace` `focus` などの動作）が基本で、足りないところだけ下の層（`canvas`・`move`・動作の `custom`）で直接書く。値に連動して描く `custom` の部品は下の層ではなく、スライドの部品の 1 つ（`storyboard.md` の 8 章）。動作は字幕の文中の印（`{a}`）に結ぶ。時刻表がなければ文字数から見積もり、あれば `tts.py` がモーラ単位で出した印の時刻を使う。合成した後に台本の文を変えたり、行を足したり消したりすると、組み立て（`build_player.py`）と検査（`check_storyboard.cjs --timeline`）が「音声が古い」「時刻表にない」で止まる。

**テーマ**（`player/themes/*.json`、`references/themes.md`）: 色・文字・線の定義。同梱は `koo`（既定）と `kuro`（数式・グラフ向けの暗い地。青・黄・緑・赤の強調を持ち、koo の色の約束は当てはめない）の 2 つ。`koo` は「空 提案書デザインシステム」（テーマの `derived_from` の Artifact）のトークンから作ってある。そこにない色を足さない（例外は、線と文字に使う暗くした Blue だけ。テーマの `tokens` に対応がある）。緑と赤はなく、良い・悪いは Gold とグレーアウトで言い分ける。テーマは動画全体で 1 つ（場面ごとには選ばない）。`colors.boxes` が役割ごとの箱の面・枠・文字、`chapter` が章扉（`title` 図だけの場面）の地と文字を決める。字幕の帯と章扉は Navy。別のデザインを渡されたときは、進行役がそのデザインの色から決める。決めたテーマは構成メモの `basics.look.theme` に書く。台本と同じフォルダに構成メモがあれば、`check_storyboard.cjs`・`frames.cjs`・`build_player.py` は `--theme` を省くとそのテーマを使い、違うテーマを渡すと終了コード 2 で止まる（`uz_node.cjs` の `pickTheme` と `build_player.py` の `pick_theme`。2 か所を同じ約束に保つ）。`extract_design.py` が手持ちのデザイン（トークン・CSS・HTML・Tailwind・Office・画像・PDF）からテーマを作り、`check_theme.py` で検査する。

**作り手と評価役**: Claude Code では `agents/` のサブエージェントを使う（作り手は researcher = 調べる、writer = 台本の初稿と章単位の書き直し。評価役は fact-checker / writing-reviewer / director。animator は保留中で呼ばない）。チャットでは 1 会話で役を順に演じる。作り手も評価役も、物差しは構成メモの意図である。writer は、章ごとにスライド → 1 枚ごとの意図（構成メモの `slides` に `proposed` で書く）→ 原稿の順に書き、迷ったスライドは、案を並べてほしいことを進行役に返す。researcher が調べた事実は取材メモ（`brief.md`）に置き、構成メモには書かない。評価役は「意図どおりのスライド・原稿になっているか」と、意図そのものが聴衆の側から書いてあるかを見る。director はスライド（完成形のコマ `svg/slide-<id>.svg` と行ごとのコマ）、writing-reviewer は原稿（スライドを説明しているか。字幕には TW- と SP-、スライドのテキストには TW- だけ）、fact-checker は出どころ（原稿の行の `source` と、スライドのテキストの事実。意図は照合しない）を受け持つ。評価役は決まった関門ではなく、章の意図が固まったとき・最初のスライドコンテを見せる前（スライド）・スライドが固まった後（原稿）・直した後・合成の前に呼ぶ。プロンプトは規則を並べず、扱える概念を「聴衆に起こること／できること／代償」で宣言し、どこで使うかは LLM が意図から判断する（R5）。見せ方は `references/visual-grammar.md`（VG-1〜9 と、Morph・カメラ・線の描画を「キャンバスの上を動くカメラ」と捉える VG-10〜12、値に連動して動く図と数式の変形を扱う「値と数式」VG-13・14）にあり、director は効いているかを見る。判断の文は 1 か所に置き、ほかはそこを指す（環境ごとの文書はコマンドと道具の振る舞い、評価役を呼ぶ場面と指摘の扱いは `review-protocol.md`）。成功基準は `references/criteria/`（構成メモ O-、意図との照合 A-、スライドと図 G-、原稿 S-、画面 V-。文章の規則は `references/writing/` の TW- と SP-。SP-11〜SP-14 は行と章のつながり）。意図に照らす基準は数で決まらず、判定がぶれることは受け入れる（利用者が決めた）。その代わり、評価役は、意図のどの文に照らしたかを指摘の `evidence` に書く。評価役の約束・判定のしかた（読む順）と指摘の扱いは `references/review-protocol.md`、評価役の出力の形は `references/writing/review-format.md`。指摘にはレベル（must / should / nits）が付き、`scripts/ledger.py` の指摘の一覧に入る。スライドへの指摘の場所（`where`）は、そのスライドを最初に使う場面の id で書く（`ledger.py` がスライドの id をまだ知らないため）。どれを直すかは利用者が選ぶ（スライドと原稿の初稿に限り、意図を変えない指摘は進行役が 1 回だけ先に直す）。自動で合格まで回すことはしない。

## 守ること

- claude.ai のサンドボックスでも動くようにする: シェルは sh（`time` や `${PIPESTATUS}` を使わない）、CPU 1 つ・メモリ 4GB、chromium なし、通信は GitHub・PyPI・npm などだけ（jsDelivr には届かないので JS は同梱する）、長いコマンドは止められる（だから `tts.py` は `--budget` で区切る）
- 音声はプレーヤー内で WebAudio で鳴らす（チャットのプレビューでは audio 要素が拒否される）
- ナレーションを外部サービスへ送らない（VOICEVOX をその場で動かす）。VOICEVOX のクレジットを再生ページに出す
- VOICEVOX の利用規約への同意なしに声を作らない。同意は置き場の `consent.json` に記録し、記録があって規約と音声モデルの版が同じなら、次からは聞かない（2026-11-11 に利用者が決めた）
- GitHub への書き込み系のコマンドを、スキルの手順として実行させない
- `prototypes/compare/` は画風の見比べ用の試作で、本体からは使わない
