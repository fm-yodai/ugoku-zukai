---
name: evx-probe
description: claude.ai / Claude Desktop のチャットで、ナレーション付き解説動画（音声を埋め込んだ HTML の再生ページ）を作れるかを確かめる検証用スキル。サンドボックスの環境とネットワーク、サンドボックス内での VOICEVOX 音声合成、再生ページの見せ方（Artifact・ファイル表示・ダウンロード）を順に試し、決まった形の報告を返す。「evx-probe」「evx 検証」「解説動画の検証を実行」で起動。
---

# evx-probe v2: 解説動画スキルの実行環境の検証

explain-video-anywhere を claude.ai でも動かすための事前検証です。**目的は「できるか・できないか」を正確に記録すること**で、うまく動かないときに回避策を探して先へ進めることではありません。失敗はそのまま記録してください（失敗も大事な結果です）。

以下 `$SKILL` はこのスキルのフォルダです。場所が分からなければ `find / -name SKILL.md -path "*evx-probe*" 2>/dev/null` で探します。出力先 `$OUT` は `/mnt/user-data/outputs` があればそこ、無ければ作業ディレクトリの `outputs/` です。

## 手順

### 1. 環境とネットワーク

```bash
python3 $SKILL/scripts/probe_env.py --out $OUT
```

出力の表をそのまま報告に使います。

### 2. サンドボックス内の VOICEVOX（ユーザーの同意が要る）

ダウンロードの前に、ユーザーに次をそのまま伝えて同意を得てください。同意が得られなければこの手順は「未実施（同意なし）」と記録して飛ばします。

> VOICEVOX の音声モデル（ずんだもん等）と VOICEVOX ONNX Runtime を GitHub から約 94MB ダウンロードして試します。音声モデルには利用規約があります（https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt ）。ずんだもんの音声は「VOICEVOX:ずんだもん」のクレジット表記で商用・非商用に使えます。規約に同意して試してよいですか？

同意が得られたら:

```bash
python3 $SKILL/scripts/try_voicevox.py --agree --out $OUT
```

NG の段階があっても、別の取得方法を試さずに、そのエラーを記録してください（どの段階で止まるかが知りたいことです）。

### 3. 再生ページを作る（経路ごとに別のファイル）

どの経路で開いたページかが結果に残るよう、経路の名前を入れて別々に作ります。`$WAV` は手順 2 が成功していれば `$OUT/voicevox_sample.wav`、失敗していれば空にします（試験音になります）。

```bash
WAV=$OUT/voicevox_sample.wav   # 手順 2 が失敗なら WAV= にする
python3 $SKILL/scripts/make_probe_page.py --wav "$WAV" --mp3 --route "A ファイル" --name evx_probe_A.html --out $OUT
python3 $SKILL/scripts/make_probe_page.py --wav "$WAV" --mp3 --route "C Artifact（埋め込み版）" --name evx_probe_C.html --out $OUT
python3 $SKILL/scripts/make_probe_page.py --light --route "B Artifact（軽い版）" --name evx_probe_B.html --out $OUT
```

（`--mp3` は ffmpeg で圧縮して埋め込みます。ffmpeg が無ければ `--mp3` を外して WAV のまま埋め込みます）

### 4. 再生ページを見せる（3 つの経路を全部試す）

- **A. ファイルとして渡す**: `$OUT/evx_probe_A.html` と `$OUT/voicevox_sample.wav`（あれば）を、この環境でファイルを渡すいつもの方法でユーザーに渡す。ユーザーには「チャット上のプレビュー」と「ダウンロードしてブラウザで開く」の両方を試してもらう
- **B. Artifact（軽い版）**: `$OUT/evx_probe_B.html` を Artifact として公開する
- **C. Artifact（埋め込み版）**: `$OUT/evx_probe_C.html` を Artifact として公開する

各ページの見出しに経路の名前が出ます。

### 5. ユーザーに頼むこと

> 開けたページそれぞれで、ボタンを上から順に押し（1 番が本命の WebAudio 再生です）、「音が聞こえた／聞こえない」などのボタンで結果を入れてから、「結果をコピー」の内容をこのチャットに貼ってください。ページごとに 1 回ずつ貼ってください（見出しに経路の名前が出ています）。A はプレビューとダウンロードして開いた場合の両方をお願いします。

### 6. 報告

ユーザーの返事が来たら、次の形でまとめます。表の値は推測で埋めず、試していないものは「未実施」と書きます。

```
## evx-probe v2 報告（<日付> / <claude.ai か Desktop か> / <プラン>）

### サンドボックス
- Python / CPU / メモリ / ディスク:
- ffmpeg / node / chromium:
- 日本語フォント:
- 組織のネットワーク設定（分かれば）:
- 届いた宛先: （pypi, github, github-release-assets, huggingface, google-cloud-tts, gemini-api, elevenlabs, example.com ごとに ○×）

### VOICEVOX（サンドボックス内）
- 結果: 成功 / 失敗（止まった段階とエラー） / 未実施
- pip install が通った方法:
- 所要秒数: ダウンロード計 / 展開 / 読み込み / 合成（文字数→音声秒数）/ 5 分の目安
- 埋め込んだ音声の大きさ: WAV → mp3

### 再生ページ
| 経路 | 開けたか | WebAudio（本命） | audio 要素 | 読み上げ | ダウンロード | 図の動き |
|---|---|---|---|---|---|---|
| A プレビュー | | | | | | |
| A ダウンロードして開く | | | | | | |
| B Artifact（軽い版） | | | | | | |
| C Artifact（埋め込み版） | | | | | | |

- WebCodecs（H.264 / AAC / Opus）・MediaRecorder:
- 読み上げで使えた声:

### 気づいたこと
- （エラー文、制限の表示、想定外の挙動をそのまま）
```
