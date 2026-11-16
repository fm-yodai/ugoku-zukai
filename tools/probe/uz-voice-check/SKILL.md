---
name: uz-voice-check
description: ugoku-zukai の M2（声）の検証用スキル。claude.ai / Claude Desktop のサンドボックスで VOICEVOX を入れ、見本の台本を 1 行ずつ合成して時刻表を作り、Claude Code で作った結果と同じになるかを比べる。音声つきの再生ページも Artifact で開いて、音と動きがそろうかを確かめる。「uz-voice-check」「ugoku-zukai の声の検証」で起動。
---

# uz-voice-check: claude.ai で同じ音声が作れるかの検証

ugoku-zukai の声の部分（`setup_voice.py` と `tts.py`）が、claude.ai のサンドボックスでも Claude Code と同じ結果になるかを確かめます。**目的は結果を正確に記録すること**です。失敗したら、別の方法を探さずにそのエラーを報告してください。

以下 `$SKILL` はこのスキルのフォルダです（分からなければ `find / -name SKILL.md -path "*uz-voice-check*" 2>/dev/null`）。作業場所 `$W` は `/tmp/uzv`、出力先 `$OUT` は `/mnt/user-data/outputs` があればそこ、無ければ `$W/outputs` です。

## 手順

### 1. 利用規約への同意

ダウンロードの前に、ユーザーに次をそのまま伝えて同意を得ます。同意がなければ、ここで終えて「未実施（同意なし）」と報告します。

> VOICEVOX の音声モデルと VOICEVOX ONNX Runtime を GitHub から約 94MB ダウンロードして試します。利用規約があります（https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt ）。声は春日部つむぎで、「VOICEVOX:春日部つむぎ」のクレジットを出して使います。同意して試してよいですか？

### 2. VOICEVOX を入れる

```bash
mkdir -p $W $OUT
time python3 $SKILL/make/scripts/setup_voice.py --agree --home $W/voicevox
```

### 3. 見本の台本を合成する

1 回のコマンドが長くならないよう、`tts.py` は 100 秒ごとに区切って終わります。終了コードが 3 の間は、同じコマンドを繰り返してください。

```bash
cd $W && time python3 $SKILL/make/scripts/tts.py $SKILL/make/examples/proposal-analysis.json -o $W/work --home $W/voicevox; echo "exit=$?"
```

### 4. 結果を比べる

```bash
python3 $SKILL/voice_report.py $W/work --expected $SKILL/expected.json --out $OUT/uz-voice-report.json
```

`compare.verdict` が「同じ」なら、各行の長さと印の時刻が Claude Code の結果と 0.02 秒以内で一致しています。

### 5. 配置の検査と、音声つきの再生ページ

```bash
node $SKILL/make/scripts/check_storyboard.cjs $SKILL/make/examples/proposal-analysis.json --theme koo --timeline $W/work/timeline.json
python3 $SKILL/make/scripts/build_player.py $SKILL/make/examples/proposal-analysis.json -o $OUT/uz-voice-player.html --theme koo --voice $W/work --artifact
```

`$OUT/uz-voice-player.html` を Artifact として公開し（書き写さずにファイルのまま）、ユーザーに「再生ボタンを押して、声と図の動きがそろっているか」を見てもらいます。

## 報告

次の形で返してください。ユーザーはこの報告を Claude Code に貼り付けます。

```
## uz-voice-check の結果
- 同意: あり / なし
- setup_voice.py: OK / NG（かかった秒数、NG ならエラーの最後の行）
- tts.py: OK / NG（繰り返した回数、合計の秒数）
- 比較: verdict / max_dur_diff_sec / max_mark_diff_sec / same_pcm_lines（行数）
- 配置の検査: OK / 指摘の内容
- 再生ページ: 公開できた / できなかった。ユーザーが聞いた結果（声が出た・動きとそろった など）
- uz-voice-report.json の中身（そのまま貼る）
```
