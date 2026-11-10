# 合意との照合の基準（A-）

台本（`storyboard.json`）が、利用者と合意した構成メモ（`outline.json`）のとおりに書かれているかを見る。台本の場面は `chapter` で構成メモの章を指す（`../storyboard.md` の 3 章）。台本の初稿ができたときと、章を書き直した後に判定する（`target` は `script`）。

「元」の列は、作り直す前の基準の ID。

| ID | 合格の条件 | 検査 | 重さ | 元 |
|---|---|---|---|---|
| A-M1 | `check_storyboard.cjs --outline <outline.json> --complete` の誤りが 0（すべての場面に `chapter` があり、構成メモの章にあり、場面のない章がない） | 機械（`node scripts/check_storyboard.cjs <storyboard.json> --theme <テーマ> --outline <outline.json> --complete`） | must | 新設 |
| A-1 | 各章の言うこと（`says`）が、その章の場面の字幕で言われている。言い回しは違ってよいが、意味が変わっていない | director | must | S-F3 |
| A-2 | 構成メモにない主張を、台本が足していない。つなぎの文と、言うことを説明するための具体例は主張に数えない（具体例が事実を述べているなら、S-F4 で見る） | director | must | S-F3 |
| A-3 | 各章の見せるもの（`shows`）と、その章の場面の図が合っている。図の種類が `shows.figure` と違うときは、見せたいことに照らして理由が立つ | director | must | G-D2 |
| A-4 | 章の順が構成メモと同じで、章ごとの長さが尺の目安から大きく外れていない（`check_storyboard.cjs --outline` の警告と章ごとの見積もりを読む） | director | should | 新設 |

指摘の場所（`where`）は、章の言うことなら言うことの id（`c3.1`）、見せるものなら `c3.shows`、台本の行なら行の id にする。

A-1〜A-3 の指摘は、直すと合意した内容が変わることが多い。直し方が 2 つあるとき（台本を構成メモに合わせる / 構成メモを台本に合わせる）は、`suggestion` に両方を書く。どちらにするかは利用者が決める。

## 較正の例

まだない。実際の通しで出た欠点を、人がここに足す。
