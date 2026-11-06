# ugoku-zukai（動く図解）設計

前身は個人用のスキル explain-video-anywhere（v1。Manim＋VOICEVOX の Docker）。

- 作成: 2026-11-05
- 状態: 下書き（画風・描き方・名前・公開先まで合意済み。未決事項は末尾）
- リポジトリ: github.com/fm-yodai/ugoku-zukai（非公開で作り、ライセンス表示が整ったら公開する）

## 1. 目的

題材を、ナレーション付きの解説動画にする。題材はコード・リポジトリ・PR・Web ページ・文書・題目だけ、のどれでもよい。claude.ai / Claude Desktop のチャットでも Claude Code でも同じ品質で作れるようにし、プラグインとして配る。

## 2. 要件（ユーザーと合意済み）

| 項目 | 内容 |
|---|---|
| 成果物の形 | 再生できれば形式は問わない。HTML の再生ページを基本にし、mp4 は必要なときに書き出す |
| 声 | 自然な日本語のナレーションが必須 |
| 動かす環境 | claude.ai / Desktop のチャットと Claude Code を最優先にする |
| 視聴者 | 主に社内の非開発者 |
| 題材の範囲 | すべての種類を扱う（文書や題目も NotebookLM に任せない） |
| 画風 | 柔軟に選べるようにする。インタビューで聞く。デザインシステムを受け取り、それに沿って描けるとよい |
| 描き方 | 標準は「決まった語彙の台本＋自動配置」。場面ごとに自由なコードで描く方式（manim-web）も選択肢として持つ |

## 3. 検証で確かめた事実（2026-11-05、claude.ai Team）

検証用スキル `tools/probe/evx-probe` を claude.ai で実行した結果。

- **サンドボックスの通信**: 許可したドメインにだけ届く方式。届くのは GitHub（release-assets を含む）、PyPI、npm、api.anthropic.com など。Google の API、ElevenLabs、Hugging Face、jsDelivr には届かない
- **サンドボックスの道具**: ffmpeg・node・npm・uv・日本語フォント（IPA、Noto Sans CJK）がある。chromium・docker・sudo はない。CPU 1 つ、メモリ 4GB
- **VOICEVOX**: voicevox_core 0.17.1 が `pip install --break-system-packages` で動いた。ダウンロードは計 23.5 秒（約 94MB）。合成は 222 文字（音声 41.9 秒）に 32.6 秒かかり、5 分の動画なら約 4 分になる
- **再生**:
  - WebAudio での再生は、すべての経路で成功した
  - チャット上のプレビューでは、audio 要素も Blob URL も「URL safety check」で拒否された
  - Artifact では audio 要素も鳴った
- **公開**: サンドボックスで作ったファイルを、書き写さずにそのまま Artifact として公開できた
- **ダウンロード**: Artifact の中から始めたダウンロードは止められた（downloads capability の宣言が要る）。チャット上のプレビューでは保存できた
- **mp4**: 視聴者のブラウザで H.264・AAC・Opus をエンコードでき、MediaRecorder も使える
- **Motion のひな形**: claude.ai の Motion はナレーションを入れられない（音は BGM と効果音だけで、長さは 300 秒まで）ので使わない

## 4. 全体の流れ

```
0 インタビュー ─ 読者・一番分かってほしいこと・範囲・構成の型・長さ・声・画風（とデザインシステム）・描き方
1 取材と契約   ─ brief.md と contract.json（根拠つき）        … v1 を引き継ぐ
2 台本         ─ storyboard.json（字幕・読み・根拠・ops）       … v1 を引き継ぎ、ops を新しいプレーヤーに合わせる
3 音声         ─ voicevox_core で 1 行ずつ合成し、mp3 にまとめる
4 組み立て     ─ 台本・画風・音声を HTML のプレーヤー 1 枚に埋め込み、配置を検査する
5 公開         ─ Artifact で公開する（mp4 はプレーヤーから書き出す）
```

### 環境ごとの違い

| | Claude Code | claude.ai / Desktop のチャット |
|---|---|---|
| 作り手と評価役 | サブエージェントで分ける（`ugoku-zukai:researcher` など。v1 の evx-* を移したもの。評価役は作り手と別のモデルにする） | サブエージェントがないので、1 つの会話で役を順番に演じる。評価役の番では、作り手の推論を読み返さずに基準ファイルだけで判定するよう指示する |
| 機械検査 | 同じスクリプトを使う | 同じ |
| VOICEVOX の導入 | `${CLAUDE_PLUGIN_DATA}` に 1 回だけ入れる | 会話のたびに入れる（約 25 秒） |
| 配置の検査 | node で行う（下の 6.3） | 同じ（サンドボックスにも node がある） |
| 公開 | Artifact | Artifact |
| インタビュー | AskUserQuestion | ask_user_input などのフォームがあれば使い、なければ文章で聞く |

## 5. 描画

### 5.1 3 つの描き方

| 描き方 | 中身 | 向いている題材 | 長所 | 短所 |
|---|---|---|---|---|
| **標準: 宣言型＋SVG プレーヤー** | Claude は ops（`map_show` / `travel` / `respond` など）だけを書き、決まったプレーヤーが描く。配置は ELK が決める | 処理の流れ・構成・変更前後・業務フロー（大半の題材） | 配置崩れが起きにくい。機械で検査できる。毎回同じ品質。軽い | 語彙にない見せ方はできない |
| **抜け道: 行ごとの自由描画** | 標準のプレーヤーの中で、`{"op": "custom"}` の行だけ、時刻 t を受け取って描く JS 関数を Claude が書く（補助の関数群を用意する） | 語彙で表せない演出が 1〜2 場面だけ要るとき | 標準の安定を保ったまま幅を足せる。よく使う形は語彙に格上げできる | その場面だけ検査が甘くなる |
| **manim-web モード** | 動画全体を manim-web（ブラウザ版 Manim）で、場面ごとのコードとして書く。時刻 t から画面を決める層は自前で持つ | 数式・図形の変形・3D、アイコンや斜めの線など手作りの絵が要る題材 | 表現の幅が一番広い。3b1b の質感に近い | 座標を手で置くので配置崩れが起きやすい。0.x 版で、ドキュメントにない不具合がある（0.41.0 で 3 つ確認）。本体の約 3.2MB を CDN から読む（claude.ai の Artifact で読めるかは未確認）。日本語の文字を書き順で描く演出は使えない |

- 描き方はインタビューで決める。既定は標準で、題材が数式・3D のときだけ manim-web を勧める
- manim-web のバージョンは固定する。見つけた不具合と回避方法は `references/manim-web.md` に書いて育てる

### 5.2 プレーヤー（標準と抜け道）

試作は `prototypes/compare/svg/player_template.html` にある。

- **HTML 1 枚**: 台本 JSON・画風・音声（mp3 の base64）を埋め込む。外部から読むのは elkjs と（手描き調なら）rough.js だけで、どちらも版を固定する。claude.ai で CDN から読めない場合に備え、同梱して直接埋め込む形も用意する（elkjs は約 1.5MB）
- **画面は時刻 t だけで決まる**: 毎フレーム「既定の状態 → 台本の動作を時刻順に重ねる → DOM に反映」で描く。どこへでも飛べ、mp4 にも同じコマが書き出せる
- **音声は WebAudio の時計に合わせる**: audio 要素は使わない（チャットのプレビューで拒否されるため）
- **字幕とクレジットは画面に描く**: mp4 にしても残る
- **v1 から移す語彙**: v1 の ops の数は 40 前後。最初に移すのは、全体図・点の移動・応答・強調・薄くする・札（試作で実装済み）と、表・トークン・コードの重ね表示・題・箇条・クレジット。次に、シーケンス図・状態遷移図、`what_if` / `scan` / `halt` などの演出を移す

### 5.3 mp4 の書き出し

- プレーヤーに「mp4 で保存」のボタンを付ける
  1. SVG のコマを順に canvas に描く
  2. WebCodecs でエンコードする
  3. mp4 にまとめる（Mediabunny などを使う。選定は未決）
- Artifact では downloads capability を宣言して保存させる
- Claude Code では、Playwright でプレーヤーを動かして書き出す方法も用意する

## 6. 画風とデザインシステム

### 6.1 画風はテーマ（色・文字・線の定義）で決める

描く処理は 1 つにし、画風は次の項目を持つテーマファイル（`theme.json`）で切り替える。

| 分類 | 項目 |
|---|---|
| 色 | 背景、文字、補助の文字、線、ノードの種類ごとの色（actor / process / store / external / added / removed / muted）、強調、データ（点・札）、字幕の地と文字 |
| 文字 | 見出し・本文・ラベルのフォント（Google Fonts の名前か、埋め込むフォントファイル）と太さ |
| 形 | 角の丸み、線の太さ、手描きにするか（rough.js の荒さ）、光のぼかし |
| 動き | イージング（3b1b の smooth / 弾む / 直線）と、出し方（線を引く / ふわっと出す） |

最初に用意する画風は、3b1b 調（暗い背景）、手描きのホワイトボード調、フラットな図解（明るい背景・社内資料向け）の 3 つ。

### 6.2 インタビューでの聞き方

画風の問いの選択肢は「3b1b 調」「手描き調」「フラットな図解」「デザインシステムに合わせる」の 4 つにする。AskUserQuestion のプレビューに、同じ場面の静止画（や ASCII の見本）を入れて見比べられるようにする。

「デザインシステムに合わせる」を選んだら、何を渡せるかを聞く。

- **claude.ai の Design System の Artifact**: `tokens.json`（色・文字・角の丸み）を読んでテーマに写す
- **CSS 変数やトークンの JSON ファイル**: 同じくテーマに写す
- **ブランドガイドの PDF や URL**: Claude が色とフォントを読み取ってテーマを作り、どの値をどこから取ったかを `theme.json` の注記に残す

写したあと、テーマを検査するスクリプト（`check_theme.py`）で次を確かめる。

- 字幕・ラベルと背景のコントラスト比が足りているか（WCAG AA）
- ノードの種類ごとの色が見分けられるか
- フォントが Google Fonts にあるか、埋め込めるか

足りないところは、近い色に寄せて直し、直したことを報告する。

### 6.3 配置の検査

v1 は Manim の中で、重なりやはみ出しを機械で検査していた。v2 では、プレーヤーの配置部分を node でも動く共通の JS モジュールにする。

- ELK は node でも同じ結果を返す
- 文字の幅は、テーマのフォントの字幅表を同梱して計算する（ブラウザの計測とずれるので、余白を見込む）
- 検査は claude.ai のサンドボックス（chromium なし）でも動く
- Claude Code では、Playwright でコマの画像も撮って目で確かめられる

## 7. 声

- voicevox_core を Python から直接使う。Docker のエンジンはやめる
  - 導入スクリプト（`setup_voice.py`）が、wheel・ONNX Runtime・辞書・音声モデルを GitHub から取り、`pip install --break-system-packages` で入れる
  - 利用規約への同意は、インタビューで先に取る
- 1 行ずつ合成して保存し、文が変わった行だけ作り直す。1 回のコマンドが長くならないよう、行をまとめて少しずつ回す
- 声と口調はインタビューで決める。非開発者向けの社内資料では「です・ます」の落ち着いた声を勧める。ずんだもんは語尾が「〜のだ」になる
- クレジット（例「VOICEVOX:ずんだもん」）は、画面と再生ページの両方に出す

## 8. プラグインの構成

```
ugoku-zukai/
├─ .claude-plugin/plugin.json       プラグインの定義
├─ .claude-plugin/marketplace.json  単体で入れるためのマーケットプレイス定義（claude plugin marketplace add fm-yodai/ugoku-zukai）
├─ skills/make/                     本体スキル（/ugoku-zukai:make、「動く図解にして」）
│   ├─ SKILL.md            進行役。環境の判定と、両環境の手順
│   ├─ references/         v1 の基準・構成の型・文章の規則（移植済み）。ショット DSL・manim-web.md は M1・M5 で書く
│   ├─ player/             プレーヤー本体（共通 JS）・テーマ（M1）
│   ├─ scripts/            ledger.py・check_contract.py（移植済み）。setup_voice.py・tts.py・lint・check_theme・layout_check・build_player.py（M1〜M3）
│   └─ assets/             禁止語・読みの辞書の初期値（移植済み）
├─ agents/                 researcher / writer / animator / fact-checker / writing-reviewer / director（v1 から移植。Manim 依存の記述は M3 で書き換える）
├─ prototypes/compare/     画風の見比べと SVG プレーヤーの試作
├─ tools/probe/            claude.ai の検証用スキル
├─ tools/build_claude_ai_zip.py   claude.ai 用の zip を作る（frontmatter を name と description だけにする。agents は入れない）
└─ docs/design.md          この文書
```

- **学びの記録**: 使うたびに学んだこと（禁止語・読み・op の提案・較正の例）は `${CLAUDE_PLUGIN_DATA}` に書き、配布する初期値と重ねて読む。claude.ai ではスキルのフォルダに書き込めないので、会話の最後に「足すべき項目」として報告するに留める
- **パス**: スクリプトのパスは `${CLAUDE_PLUGIN_ROOT}/skills/make/...` で書く。エージェントの `tools:` の中でこの変数が展開されるかはドキュメントに書かれていないので、M3 で確かめる。エージェント名には `ugoku-zukai:` の接頭辞が付く

## 9. v1 から引き継ぐもの・やめるもの

| 引き継ぐ | やめる |
|---|---|
| 成功基準（criteria/）、構成の型、文章の規則、契約と台帳（ledger.py）、check_contract.py、lint_storyboard.py の大半、禁止語、読みの辞書、評価役の作り | Manim（shot_scene.py・explainer_kit.py・render.sh・layout_check.py の Manim 依存部分）、Docker の VOICEVOX、ffmpeg での字幕焼き込み |

## 10. 決まったこと・未決事項

決まったこと（2026-11-05）:

- 名前は ugoku-zukai、スキル名は make
- このプラグイン単体で、fm-yodai のアカウントから公開する（最初は非公開）
- v1 は手元に残したまま別のリポジトリで作る

未決:

1. **リポジトリのライセンス**: 公開する前に決める
2. **mp4 の書き出しに使うライブラリ**: Mediabunny が第一候補。ライセンスは MPL-2.0
3. **既定の声**: 非開発者向けに、ずんだもん以外を既定にするか
4. **ライブラリの読み込み**: claude.ai の Artifact で、jsDelivr から elkjs と manim-web を読めるかは未確認。読めなければ同梱する
5. **v1 から乗り換える時期**: 同じ題材で v1 と同等以上の動画が作れたら乗り換える

## 11. 進め方（案）

| 段階 | 内容 | 終わりの条件 |
|---|---|---|
| M1a プレーヤーの芯 | 新しい台本の形式（12 章）、文中の印での時間合わせ、テーマ 3 種（3b1b 調・フラット・デザインから作る）、図: 箱と矢印・シーケンス・表/比較/箇条 | 図の種類ごとの見本台本が配置の検査を通り、全テーマで並べた一覧ページを Artifact で見て、ユーザーが形式を了承する |
| M1b 提案系の図 | スイムレーン・As-Is/To-Be・ロードマップ・ツリー・グラフ/KPI・2×2・ピラミッド/ファネル・サイクル/ベン図 | 同上（M1a の一覧ページに足す） |
| M2 声 | setup_voice.py・tts.py（両環境） | claude.ai と Claude Code で同じ台本から同じ音声が作れる |
| M3 進行役 | SKILL.md（チャット版の 1 会話で回す手順と、Claude Code 版のサブエージェント）、node での配置の検査 | claude.ai で 3 分の動画が最後まで作れる |
| M4 書き出し | mp4 ボタン、downloads capability | Artifact から mp4 を保存できる |
| M5 manim-web モード | 補助の関数群、references/manim-web.md | 数式の題材で 1 本作れる |
| M6 配布 | プラグイン化、claude.ai 用の zip、評価（skill-creator の evals） | 社内の 2〜3 人が自分の題材で作れる |

## 12. M1 の要件（2026-11-05 合意）

- **台本の形式はゼロから設計する**。v1 の op・座標・秒の既定値には縛られない。v1 のテスト台本は終わりの条件にしない
- **二層で書く**: 普段は意味（「この図を出す」「この経路をたどる」「ここを強調」）で書き、配置と動きはプレーヤーが決める。足りないところだけ、図形と動きを直接書く下の層を使う。評価役が台本だけで「何を見せるか」を照合できること
- **時間合わせは字幕の文中の印**（例:「{a}課長が承認すると{b}経理へ」）。VOICEVOX が返すモーラ単位の時刻で、印の語を話す瞬間に動きを結ぶ。音声のない M1 では文字数からの見積もりの時刻で動かす
- **図の種類（11）**: M1a = 箱と矢印（構成・業務の流れ・状態遷移、点が経路をたどる）、シーケンス図、表・比較・箇条。M1b = スイムレーン、As-Is / To-Be、ロードマップ、ツリー、グラフと KPI、2×2 マトリクス、ピラミッド・ファネル、サイクル・ベン図。コード・画面写真は M1 に入れない
- **テーマ**: 3b1b 調、フラットな図解、デザインから作る。手描き調は M1 に入れない
- **デザインの入力**: トークンの JSON / CSS 変数、claude.ai の Design System、ブランドガイド（PDF・URL）、Figma など他のツールの書き出し。**デザインシステムらしくない入力**（画像・Web ページ・PowerPoint/PDF/Word・題材のコードの CSS や Tailwind の設定）からも色・文字・形を抽出してテーマにする。抽出したテーマはコントラストなどを検査する
- **画面は 16:9 だけ**
- **字幕は画面の下に出し、再生ページで消せる**。mp4 には書き出すときの設定どおりに入る
- **確認は動くもので**: 仕様書（references/storyboard.md）は書くが、ユーザーの確認は M1a の一覧ページで、台本と絵を並べて行う

### M1a の実装（2026-11-05）

- プレーヤー: `skills/make/player/src/`（util・figures・validate・engine・check・view_svg）。DOM に触るのは view_svg.js だけで、残りは node でも動く。elkjs 0.9.3 は vendor/ に同梱して HTML に埋め込む（claude.ai で CDN を読めるか未確認のため）
- 文字の幅は実測せず、文字の種類から見積もる（フォントの読み込みに左右されず、node の検査と同じ値になる）
- 時刻表がないときは文字数から見積もる（ずんだもん・話速 1.1 で 1 文字 0.17 秒）。M2 の tts は `{ lines: [{ id, start, dur, marks: { 印: 秒 } }] }` を書く
- 検査: `scripts/check_storyboard.cjs`（形・解決・配置）、`scripts/check_theme.py`、`scripts/tests/run_m1.sh`
- デザインの抽出: `scripts/extract_design.py`（トークン JSON・CSS・HTML/URL・Tailwind・Office のテーマ・画像・PDF）。名前のない色だけの入力では役割の割り当てが推測になるので、Claude が確かめて直す
- 見本帳: `tools/build_gallery.py`（見本 5 本 × テーマ 3 種）

### M1b の実装（2026-11-06）

- 提案資料の図を 10 種足した（`player/src/figures2.js`）: `swimlane` `beforeafter` `roadmap` `tree` `chart`（棒・折れ線）`kpi` `matrix` `pyramid`（ピラミッド・ファネル）`cycle` `venn`。配置は ELK を使わず、図ごとに決まった並べ方で計算する（スイムレーンは辺から列を決め、隣の担当への受け渡しは同じ列で縦に置く）
- 新しい描き方: ひし形・多角形の箱、伸びる棒（`bar`）、数え上がる数字（KPI）、箱の外のラベル（2×2 の点）
- `trace` / `reply` は箱と辺のある図ならどれでも使える。`move` の `to: {x, y}` で 2×2 の点を動かせる
- まとめの id（`axis` `grid` `axes` `quadrants` `categories` `legend`）で、目盛りや枠を一度に出せる
- 見本: `examples/proposal-{process,analysis,numbers,concept}.json`（架空のくも運輸の配車改善の提案）。全テーマで検査を通る

### M2 の実装（2026-11-06）

- `setup_voice.py --agree`: voicevox_core 0.17.1・ONNX Runtime・辞書・0.vvm を GitHub から取って入れる。置き場は `UZ_VOICE_HOME` → `${CLAUDE_PLUGIN_DATA}/voicevox` → `~/.cache/ugoku-zukai/voicevox`。何度実行してもよい（Claude Code では初回だけ 11 秒ほど）
- `tts.py`: 1 行ずつ合成して `audio/<行>.<ハッシュ>.wav` に残す（文・読み・声・速さ・辞書・版が同じなら作り直さない）。`--budget` 秒で区切り、終了コード 3 で続きを知らせる（claude.ai の 1 回のコマンドの長さに合わせる）
- 印の時刻: 印までの文の AudioQuery のモーラ列を、全文のモーラ列と頭から照らし合わせ、印の直後のモーラの始まりを取る。音素の長さを話速で割ってフレーム（1/93.75 秒）に丸めて足すと、合成した wav の長さと一致する。見本 9 本の印をすべて目で確かめ、語の頭に乗っていた
- 時刻表の並べ方（最初 0.8 秒、行の間 0.45 秒、場面の間 +0.7 秒）は、音声なしの見積もりと同じにした。時刻表の各行に合成した文を入れ、台本の文と違えば組み立てを止める（音声が古い）
- 既定の声は春日部つむぎ（話者 8）。ずんだもんの見積もりに 0.78 を掛けると、つむぎの実測に合う（見本 9 本の全体で）
- 見本帳は音声つき（9 本で 5MB）。claude.ai で同じ結果になるかは、検証用スキル `tools/probe/uz-voice-check`（`tools/build_voice_check.py` で zip を作る）で確かめる。Claude Code の中で zip を展開して走らせると、PCM まで一致した
- **claude.ai での結果（2026-11-06）**: 導入 3.8 秒、合成 8 行（音声 40.9 秒）に 23.2 秒、1 回で終わった。各行の長さと印の時刻は Claude Code と完全に一致。音声の中身（PCM）は 8 行とも少し違う（CPU の違いによる浮動小数点の差。聞いて分かる差ではない）。Artifact の再生ページで、声と動きがそろうことをユーザーが聞いて確かめた。M2 の終わりの条件を満たした
- claude.ai のシェルは sh で、`time` や `${PIPESTATUS}` が使えない。M3 で SKILL.md に書くコマンドは sh で動く形にする
