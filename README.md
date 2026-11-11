# ugoku-zukai（動く図解）

題材を、自然な日本語ナレーション付きの「動く図解」にする Claude のプラグインです。題材は、コード・リポジトリ・PR・Web ページ・手元の文書・題目だけ、のどれでも構いません。claude.ai / Claude Desktop のチャットでも、Claude Code でも動くことを目指しています。

> **開発中（0.1.0）**: プレーヤー（M1）、声（M2: VOICEVOX での合成と時刻表）、進行の手順（M3）と、会話で構成を固める進め方への作り直し（R1・R2）、公開した後の直しと声の試聴（R3 の道具）までできました。両方の環境での通しの確認はこれからです。設計は [docs/design.md](docs/design.md) を見てください。

## できること（目標）

- **会話で構成を固める**: 視聴者・持ち帰ってほしいこと・章立て・長さ・声・見た目を、話しながら決めます。Claude は話題ごとに、聞くか、案を出すか、調べるかを選び、案を出すときは他の選択肢を残します。「あとは任せる」と言えば、絵コンテまで Claude が決めてから見せます
- **絵コンテで確かめる**: 声を合成する前に、各行の画面と字幕を並べたページで確かめられます。行を指して直しを頼めます
- **公開した後も直せる**: 再生ページの「直したい箇所を指定する」を開くと、止めた位置が `s2 / l2 @0:14` の形で出ます。これを伝えると、その行だけを直します。変えていない行の声は作り直しません
- **根拠と検査**: 資料から言うことには場所（`path:line`、URL と引用など）を持たせ、評価役が照合します。指摘には must / should / nits のレベルが付き、どれを直すかは利用者が選びます
- **画風を選べる**: 3b1b 調、フラットな図解から選べます。手持ちのデザイン（トークン・CSS・Web ページ・PowerPoint・画像など。デザインシステムでなくてよい）を渡せば、色と文字を拾ってテーマにします
- **描き方を選べる**: 標準は「決まった語彙の台本＋自動配置の SVG プレーヤー」です。数式や手作りの絵が要る題材では manim-web で描きます
- **声**: VOICEVOX をその場で動かすので、ナレーションの文は外部の音声サービスに送りません
- **出力**: HTML 1 枚の再生ページ（音声込み）を Artifact で公開します。mp4 はプレーヤーから書き出す予定です

## 構成

| 部品 | 場所 | 役割 |
|---|---|---|
| スキル `make` | `skills/make/` | 本体。会話で構成を固めるところから公開までを進める。`/ugoku-zukai:make`、または「動く図解にして」で起動 |
| サブエージェント 6 つ | `agents/` | Claude Code で使う作り手（researcher / writer / animator）と評価役（fact-checker / writing-reviewer / director）。claude.ai のチャットでは使われず、スキルが 1 つの会話で役を順番に演じる |
| プレーヤー | `skills/make/player/` | 台本を描く JS（配置・描画・テーマ）。node の検査と同じコードを使う |
| 見本 | `skills/make/examples/` | 図の種類ごとの見本台本と、デザインから作ったテーマの例。`python3 tools/build_gallery.py` で見本帳を作る |
| 試作 | `prototypes/compare/` | 画風の見比べ（Manim / SVG 3b1b 調 / SVG 手描き調 / manim-web）。新しいプレーヤーの試作 `svg/player_template.html` を含む |
| 検証用スキル | `tools/probe/` | claude.ai のサンドボックスで、VOICEVOX と再生方法が使えるか（evx-probe）、同じ音声が作れるか（uz-voice-check）を確かめる |
| zip の作成 | `tools/build_claude_ai_zip.py` | claude.ai にアップロードするスキルの zip を作る |

## 入れ方（予定）

**Claude Code**

```bash
claude plugin marketplace add fm-yodai/ugoku-zukai
claude plugin install ugoku-zukai@ugoku-zukai
```

**claude.ai / Claude Desktop のチャット**

```bash
python3 tools/build_claude_ai_zip.py   # dist/ugoku-zukai-make.zip ができる
```

できた zip を「Customize > Skills」からアップロードします。コード実行を有効にし、ネットワークは少なくとも GitHub と PyPI に届く設定にしてください。

## クレジットとライセンス

- このリポジトリのライセンスは未定です（公開する前に決めます）
- **VOICEVOX**: 音声モデルには利用規約があります（[VOICEVOX 音声モデル 利用規約](https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt)）。キャラクターごとの規約にも従ってください。例えば、既定の春日部つむぎの音声には「VOICEVOX:春日部つむぎ」のクレジットが必要です。作った動画と再生ページには、クレジットを自動で表示します
- **使う予定のライブラリ**: elkjs（EPL-2.0）、rough.js（MIT）、manim-web（MIT）、voicevox_core（MIT）、Mediabunny（MPL-2.0、検討中）
