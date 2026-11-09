# 契約の基準（C-）— 2 取材と契約

契約（`contract.json`）は、台本を書く前に「この動画が言い切ること・どう見せるか」を固定する物差しである。3 人の確認では、この契約の要約を見せて了承をもらう（人が台本を確かめる代わり）。以後のフェーズの checker は、台本と画面がこの契約を満たすかで判定する。

`contract.json` の形は `../../scripts/check_contract.py` の docstring が正。

| ID | 合格の条件 | 検査 | 重さ |
|---|---|---|---|
| C-M1 | contract.json が形どおりで（`mode`・`structure`・`can_do`・`knows` を含む）、言い切ることが 3〜5 項、各項に根拠（`path:line` / PR / issue / URL ＋引用 / `file:p.N`）がある。`web`・`topic` の言い切りは URL を持つ。`diagram.type` がプレーヤーの図の種類（`canvas` を除く 16 種）のどれかで、`diagram.compared` にほかの種類が 2 つ以上ある。`diagram.type` が `graph`・`sequence`・`swimlane` なら `paths` が 1 項以上ある | 機械（check_contract.py） | must |
| C-M2 | 尺の配分の合計が `max_seconds` 以内 | 機械 | must |
| C-F1 | 各言い切りが根拠から言える。未実装・設計のみを実装済みのように言っていない。Web の資料では、出典が言っていないことや、見解の分かれる点を言い切っていない（TW-7） | fact-checker（契約モード） | must |
| C-F2 | 一次資料から独立に組み立てた要点のうち、読者（`interview.md`）にとって重要なものが契約から漏れていない。範囲（`scope`）の外のものは漏れに数えない | fact-checker（契約モード） | must |
| C-F3 | 見せる経路（`paths`）の各区間が、根拠のある呼び出し・データの受け渡しである | fact-checker（契約モード） | must |
| C-D1 | 読者と「一番分かってほしいこと」が 1 文で書かれ、言い切ることのどれかと結びついている | director（構造モード） | must |
| C-D2 | 図の種類（`diagram.type`）の選択に理由がある。`diagram.compared` に挙げたほかの種類（たとえば `graph`＝部品がどこにあり何が何に渡るか / `sequence`＝誰が誰に何をどの順で渡すか / `swimlane`＝担当ごとの手順と受け渡し / `table`・`compare`＝軸ごとの違い）と比べて、見せたいことに一番合う種類を選んでいて、選ばなかった理由が見せたいことに照らして筋が通っている | director（構造モード） | must |
| C-D3 | 構成の型（`structure`）が題材と読者の問いに合い、`../structures.md` のその型の「契約の追加条件」を満たしている。主に使う図が全体図（`graph`・`swimlane` など部品と矢印の図）でないなら、全体を一覧する図（`table`・`list`・`compare` など）で代わりになる理由が `diagram.reason` にある | director（構造モード） | must |
| C-D4 | 契約の言葉に、比喩・造語・スキル内部の用語（`../../assets/banned_terms.json`）が無い | director（構造モード） | should |
| C-D5 | 言い切り（`claims`）と `takeaway` が、`knows` の視聴者に分かる言葉で書かれている。言い切りの中のファイル名・関数名・状態の名前は、`can_do` のために視聴者が自分で打つか画面で探すものだけ | director（構造モード） | must |
| C-D6 | 言い切りが `can_do` に結びつき、それに要らない内部の仕組みを言い切りにしていない | director（構造モード） | must |

## 較正の例

- **型の目的とずれた配分**（過去の指摘）: 成果を伝えるのが目的の動画で、35 行のうち成果が 3 行しかなく、残りの大半を仕組みの詳解に使った。型の目的（読者が持ち帰るもの）に尺を寄せる（C-D3）
- **図の型を選ばずに全部を 1 枚の箱と矢印に詰めた**（過去の指摘）: ログインの往復（誰が誰に何を渡すか）を構成図（`graph`）の上の点の移動だけで見せ、順序が追えなかった。往復が主題なら `sequence` を選ぶ（C-D2）
