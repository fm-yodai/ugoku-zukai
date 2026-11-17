# ugoku-zukai（動く図解）

日本語のナレーションと字幕が付いた動画を作成できる Claude のプラグインです。claude.ai・Claude Desktop・Claude Code で使えます。

https://github.com/user-attachments/assets/9ed4e95e-8be0-4580-8e0b-047645785e70

## できること

- コード、Web ページ、手元の資料、題目だけ、のどれからでも作れます
- Claude と話しながら中身を決め、声を付ける前にスライドを見て直せます
- 動画が再生できる Artifact を作成します
- 作成した後も、直したい箇所を指定して直せます

## インストール

**claude.ai / Claude Desktop**

「Customize > Plugins」の「Add > Add marketplace」で `fm-yodai/ugoku-zukai` を入力し、`ugoku-zukai` を入れます

うまく入らないときは、[Releases](https://github.com/fm-yodai/ugoku-zukai/releases/latest) の `ugoku-zukai-make.zip` を「Customize > Skills」からアップロードしてください

**Claude Code**

```bash
claude plugin marketplace add fm-yodai/ugoku-zukai
claude plugin install ugoku-zukai@ugoku-zukai
```

「〜を動画で説明して」のように頼むと make スキルが発火します。

## クレジットとライセンス

- このリポジトリは [MIT License](LICENSE) です
- 声には [VOICEVOX](https://voicevox.hiroshiba.jp/) を使います。初めて声を作るときに、[音声モデルの利用規約](https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt)への同意を求めてから入れます。キャラクターごとの規約にも従ってください。再生ページには「VOICEVOX:春日部つむぎ」などのクレジットを自動で出します
- 同梱しているライブラリ: elkjs 0.9.3（EPL-2.0。ライセンス文は `skills/make/player/vendor/` にあります）
