# ugoku-zukai（動く図解）

題材を、自然な日本語ナレーション付きの「動く図解」にする Claude のプラグインです。題材は、コード・リポジトリ・PR・Web ページ・手元の文書・題目だけ、のどれでも構いません。claude.ai / Claude Desktop のチャットでも、Claude Code でも動くことを目指しています。

> **開発中（0.1.0）**: プレーヤー（M1）、声（M2: VOICEVOX での合成と時刻表）、進行の手順（M3）と、会話で構成を固める進め方への作り直し（R1・R2）、公開した後の直しと声の試聴（R3 の道具）までできました。スライドを先に作る進め方への作り直し（R4）と、Claude Code と claude.ai の両方での通しの確認も済んでいます。設計は [docs/design.md](docs/design.md) を見てください。

## できること（目標）

- **会話で意図を固める**: 聴衆・持ち帰ってほしいこと・章の順番とその意図・各章の意図・長さ・声・見た目を、話しながら決めます。Claude は話題ごとに、聞くか、案を出すか、調べるかを選び、案を出すときは他の選択肢を残します。「あとは任せる」と言えば、スライドコンテまで Claude が決めてから見せます
- **スライドを先に作る**: 意図 → スライド → 原稿の順に作ります。スライドは、見出し・言いたいこと・部品（図・テキスト・画像）でできた、声がなくても資料として読める 1 枚です。原稿は、そのスライドを説明する文として書きます
- **スライドコンテで確認する**: 声を合成する前に、スライドの完成形と意図、各行の画面と字幕を並べたページで確認できます。行を指して直しを頼めます。迷ったスライドは、同じページの中に案を並べて選べます
- **公開した後も直せる**: 再生ページの「直したい箇所を指定する」を開くと、止めた位置が `s2 / l2 @0:14` の形で出ます。これを伝えると、その行だけを直します。変えていない行の声は作り直しません
- **根拠と検査**: 原稿とスライドに書いた事実には出どころ（`path:line`、URL と引用など）を持たせ、評価役が照合します。評価役は、スライドと原稿が意図どおりか、意図が聴衆の側から書いてあるかも見ます。指摘には must / should / nits のレベルが付き、どれを直すかは利用者が選びます
- **見た目**: 既定は「空 提案書デザインシステム」に沿ったテーマです（Base の地、章扉と字幕の帯は Navy、強調は Gold）。手持ちのデザイン（トークン・CSS・Web ページ・PowerPoint・画像など。デザインシステムでなくてよい）を渡せば、色と文字を拾ってテーマにします
- **描き方を選べる**: 標準は「決まった語彙の台本＋自動配置の SVG プレーヤー」です。数式の変形や 3D が主役の題材には、今は向きません（manim-web で描く層は予定で、まだありません）
- **声**: VOICEVOX をその場で動かすので、ナレーションの文は外部の音声サービスに送りません
- **出力**: HTML 1 枚の再生ページ（音声込み）を Artifact で公開します。mp4 の書き出しは今はありません

## 構成

| 部品 | 場所 | 役割 |
|---|---|---|
| スキル `make` | `skills/make/` | 本体。会話で構成を固めるところから公開までを進める。`/ugoku-zukai:make`、または「〜を動画で説明して」のように頼むと起動 |
| サブエージェント 6 つ | `agents/` | Claude Code で使う作り手（researcher / writer / animator）と評価役（fact-checker / writing-reviewer / director）。claude.ai のチャットでは使われず、スキルが 1 つの会話で役を順番に演じる |
| プレーヤー | `skills/make/player/` | 台本を描く JS（配置・描画・テーマ）。node の検査と同じコードを使う |
| 見本 | `skills/make/examples/` | 図の種類ごとの見本台本と、デザインから作ったテーマの例。`python3 tools/build_gallery.py` で見本帳を作る |
| 試作 | `prototypes/compare/` | 画風の見比べ（Manim / SVG 3b1b 調 / SVG 手描き調 / manim-web）。新しいプレーヤーの試作 `svg/player_template.html` を含む |
| 検証用スキル | `tools/probe/` | claude.ai のサンドボックスで、VOICEVOX と再生方法が使えるか（evx-probe）、同じ音声が作れるか（uz-voice-check）を確かめる |
| zip の作成 | `tools/build_claude_ai_zip.py` | claude.ai にアップロードするスキルの zip を作る |

## 入れ方

どの環境でも、このリポジトリをマーケットプレイスとして追加し、プラグイン `ugoku-zukai` を入れます。

**Claude Code**

```bash
claude plugin marketplace add fm-yodai/ugoku-zukai
claude plugin install ugoku-zukai@ugoku-zukai
```

**claude.ai / Claude Desktop のチャット**

1. 「Customize > Plugins」を開き、「Add > Add marketplace」で `fm-yodai/ugoku-zukai` を入力します
2. 一覧に出た `ugoku-zukai` を入れます
3. 設定でコード実行を有効にし、ネットワークは少なくとも GitHub と PyPI と npm に届くようにしてください（VOICEVOX と、コマを描く道具を初回に入れるため）

チャットでは、スキル `make` だけが使われます（`agents/` のサブエージェントは使われず、1 つの会話で役を順に演じます）。同じアカウントの Claude Code にも、入れたプラグインが同期されます。組織のプランでは、管理者が利用者によるプラグインの追加を止めていると入れられません。

マーケットプレイスを追加できないときは、[Releases](https://github.com/fm-yodai/ugoku-zukai/releases) にある `ugoku-zukai-make.zip` を「Customize > Skills」からアップロードしても使えます。zip は次のコマンドでも作れます。

```bash
python3 tools/build_claude_ai_zip.py   # dist/ugoku-zukai-make.zip ができる
```

**使い方**: 「〜を動画にして」「〜を動画で説明して」「このリポジトリを動画で紹介して」のように頼むか、`/ugoku-zukai:make` で始めます。

## クレジットとライセンス

- このリポジトリは [MIT License](LICENSE) です
- **VOICEVOX**: 音声モデルには利用規約があります（[VOICEVOX 音声モデル 利用規約](https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt)）。キャラクターごとの規約にも従ってください。例えば、既定の春日部つむぎの音声には「VOICEVOX:春日部つむぎ」のクレジットが必要です。作った動画と再生ページには、クレジットを自動で表示します。VOICEVOX はこのリポジトリに含めず、初めて声を作るときに、規約への同意を得てから入れます
- **同梱しているライブラリ**: elkjs 0.9.3（EPL-2.0。`skills/make/player/vendor/` にライセンス文と一緒に置いています）
- **使うときに入れるライブラリ**: voicevox_core（MIT）、@resvg/resvg-js（MPL-2.0）
