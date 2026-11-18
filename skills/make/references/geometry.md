# 幾何の道具（geo）とリファレンス

`custom` の部品（`storyboard.md` の 6 章）の関数が使う道具 `geo` の一覧と、道具を組み合わせた見本（リファレンス）。座標・グラフ・接線・面積・ベクトル・数式を、名前付きの値（`values`）に連動して描く。writer は、題材に近いリファレンスを写して組み替える。

値に連動して動く図と数式の変形が、聴衆に何を起こし、何を代償にするかは `visual-grammar.md` の VG-13・VG-14 にある。ここに書くのは道具の使い方だけで、どこで使うかは書かない。台本の形（`values`・`set`・`custom` の部品）の正は `storyboard.md`。見本の台本は `examples/math-geometry.json`（対になる構成メモは `examples/outlines/math-geometry.json`。テーマは `kuro`）。

## 目次

1. 関数の書き方
2. 道具の一覧
3. 数式（TeX）
4. リファレンス（R1〜R6）

## 1. 関数の書き方

関数は毎コマ呼ばれ、渡された `g` に絵を描く。画面は時刻だけで決まるので、シークしても同じ絵になる。

| 引数 | 中身 |
|---|---|
| `g` | 描く先の SVG の `<g>`。毎コマ空にされる |
| `v` | 名前付きの値（`{ a: -1.2, n: 16 }`）。`set` で動いている途中は、その時点の値 |
| `t` | 動画の頭からの秒 |
| `el(tag, attrs, parent)` | SVG の要素を作る。`attrs` の値が `null` の属性は書かない |
| `S` | テーマの色と字体（`S.accent` `S.ink` `S.muted` `S.good` `S.bad` `S.warn` `S.line` `S.bg` `S.surface` `S.font`） |
| `geo` | この文書の道具 |
| `w`・`h` | 部品の区画の幅と高さ（px） |
| `UZ` | プレーヤーの関数（`UZ.clamp` `UZ.smooth` など） |

- 座標は部品のローカル座標で、左上が (0, 0)、右下が (`w`, `h`)、y は下向き。数の座標で描くときは `geo.axes` の戻り値（以下 `Ax`）を通す
- 描いたものは区画（0〜`w` × 0〜`h`）に収める。はみ出すと検査が警告する
- 動きは `v` から計算する。`set` は字幕の文中の印に結べるので、ナレーションの語と値の動きがそろう。`t` を直接使うと、声と関係なく動き続ける
- 色は、テーマのキー（`accent` など）か役割の名前（`process` など）で書く。テーマを替えても読める色になる。`#rrggbb` で直接書くと、テーマから外れる（`themes.md`）
- 関数は台本の最上位の `custom` に、名前を付けて**文字列**で書く。JSON の文字列なので、`\` は `\\`、`"` は `\"` と書く。TeX は `String.raw` で囲むと、JS の中で `\` を重ねずに済む（JSON に書くときは、それでも `\\` になる）
- スライドの完成形のコマは、そのスライドを使う最後の場面の終わりの値で描かれる。値を動かし終えた姿が、資料としての 1 枚になる
- 同じ部品を続くスライドで使い続けるなら、部品を台本の最上位の `figures` に宣言し、各スライドから `{ "figure": "<id>" }` で指す（スライドの中で宣言した部品の id は、ほかのスライドで繰り返せない）

検査（`check_storyboard.cjs`）は、各行の終わりと各 `set` の途中・終わりのコマで関数を実際に描く。誤り: 関数が例外を投げる、TeX の誤り、`draw` の名前が `custom` にない、`set` の名前が `values` にない。警告: 属性に `NaN`・`Infinity` が入る、描いたものが区画からはみ出す。

## 2. 道具の一覧

描く道具は、作った要素を返す。`o` は省ける引数のまとまり。色の引数（`color`）は、テーマのキー・役割の名前・`#rrggbb` のどれか。

### 座標とグラフ

| 道具 | 意味 |
|---|---|
| `geo.axes(g, { box, x, y, grid?, ticks?, labels?, show? })` | 座標軸。`box` は区画の中の `{x, y, w, h}`（px）、`x`・`y` は数の範囲 `[最小, 最大]`。`grid: true` で格子、`ticks: { x: 1, y: 0.5 }` で目盛りの間隔（省くと 8 つほどに割る）、`labels: { x: "$x$", y: "万円" }` で軸の名前、`show`（0〜1）で軸が伸びて現れる途中を描く。戻り値 `Ax` は `toPx([x, y])`（数 → px）、`toNum([px, py])`（px → 数）、`box`、`x`、`y`、`g` を持つ |
| `geo.plot(g, Ax, f, { color?, width?, from?, to?, upto?, samples? })` | `y = f(x)` の曲線（`width` の既定 3、`samples` は分割の数で既定 200）。`from`〜`to`（省くと x の範囲全体）を描き、`upto`（0〜1）でその途中まで描く。範囲の外と `NaN` の所は線を切る |

### 点と文字

| 道具 | 意味 |
|---|---|
| `geo.point(g, Ax, [x, y], { color?, r?, label?, size?, labelColor? })` | 点（`r` の既定 7）。`label` は点の右上に出る。`size`・`labelColor` はその文字の大きさと色 |
| `geo.label(g, [px, py], text, { size?, anchor?, color?, weight? })` | 文字（`size` の既定 22）。`[px, py]` は文字の縦の中心。`anchor` は `start`・`middle`（既定）・`end`。`$…$` で囲むと TeX で組む。地の色の縁取りが付き、格子の上でも読める |
| `geo.number(g, [px, py], value, { decimals?, prefix?, unit?, … })` | 数を文字にして出す（`decimals` の既定は 2。`-0.00` は `0.00` にする）。残りの引数は `geo.label` と同じ |

### 微分と面積

| 道具 | 意味 |
|---|---|
| `geo.deriv(f, x)` | `f` の `x` での傾き（数値微分） |
| `geo.tangent(g, Ax, f, x0, { df?, len?, color?, width?, dash? })` | `x0` での接線（`dash: true` で破線）。`df` で傾きを渡せる（省くと数値微分）。`len` は x の単位で測った線の長さ（傾きによらず画面の上で同じ長さ） |
| `geo.secant(g, Ax, f, x0, x1, { extend?, color?, width?, dash? })` | 2 点を通る割線。両側へ 2 点の間の `extend`（既定 0.25）ずつ延ばす |
| `geo.area(g, Ax, f, a, b, { color?, opacity? })` | `a`〜`b` で曲線と x 軸に挟まれた面を塗る（`opacity` の既定 0.35） |
| `geo.riemann(g, Ax, f, a, b, n, { rule?, color?, opacity? })` | `n` 本の長方形（リーマン和。`n` は丸める）。`rule` は `left`（既定）・`mid`・`right`。`opacity` は塗りの濃さ（既定 0.4） |

### ベクトルと図形

| 道具 | 意味 |
|---|---|
| `geo.vector(g, Ax, from, to, { color?, width?, label?, size?, labelColor? })` | 矢印。`from`・`to` は数の座標。`label` は矢の先に出る（`size`・`labelColor` で文字の大きさと色） |
| `geo.arc(g, [cx, cy], r, a0, a1, { fill?, fillOpacity?, color?, width? })` | 弧（px の中心と半径）。角はラジアンで、右が 0、反時計回り。`fill: true`（線の色）か色の名前で扇形を塗る。`fillOpacity` は塗りの濃さ（既定 0.25） |
| `geo.circle(g, [cx, cy], r, { fill?, fillOpacity?, color?, width? })` | 円（px）。`fill`・`fillOpacity` は `geo.arc` と同じ |
| `geo.polygon(g, pts, { closed?, fill?, fillOpacity?, color?, width? })` | 折れ線・多角形（px の点の列）。`closed: false` で閉じない。`fill`・`fillOpacity` は `geo.arc` と同じ |
| `geo.bar(g, Ax, x, value, { width?, color?, opacity? })` | 棒。`x` を中心に 0 から `value` まで。`width` は x の単位（既定 0.6） |

### 数式と補助

| 道具 | 意味 |
|---|---|
| `geo.tex(g, tex, { x, y, size?, anchor?, color?, display? })` | TeX の数式。`y` は数式の**上端**、`x` は `anchor` で決まる横の位置（`anchor` の既定は `start` = `x` が左端。`geo.label` の既定 `middle` と違う）。`size` は 1em の px（既定 32）。`display: true` で別行立ての組み方（`\sum` の添字が上下に付くなど）。戻り値は `{ w, h, el }`（幅と高さの px）。3 章 |
| `geo.texMorph(g, from, to, p, o)` | 数式 `from` から `to` への変形の途中（`p` は 0〜1）。`o` は `geo.tex` と同じ。3 章 |
| `geo.col(c)` | 色の名前を色の値にする |
| `geo.lerp(a, b, p)` | 数か配列の補間 |
| `geo.smooth(p)` | 0〜1 の、両端で緩やかになる補間 |
| `geo.mix(c1, c2, p)` | 2 つの色を混ぜる |
| `geo.errors` | TeX の誤りなどの知らせ（検査が誤りにする） |

透明度で出し入れするときは、`el("g", { opacity: v.x }, g)` を作ってそこに描く。

## 3. 数式（TeX）

数式は MathJax で組み、文字の形をパスにして描く。寸法は MathJax が出す値なので、node の検査とブラウザで同じ大きさになる。

- **値を埋める**: テンプレート文字列で書く（`` `f'(${a.toFixed(2)})=${m.toFixed(2)}` ``）。`(-0.001).toFixed(2)` は `-0.00` になるので、0 を挟んで動く値は直してから埋める（R1）
- **置き方**: `geo.tex` の `y` は上端。2 つの式を縦に並べるときは、戻り値の `h` を足して次の `y` にする。横に続けるときは `w` を足す
- **色**: 式全体の色は `color` で決まる。項ごとに色を付けるには `\textcolor{色}{…}` で囲む（`x^2+\textcolor{warn}{2x}+1`）。色はテーマのキー（`accent`・`warn`・`good` など。テーマの色に置き換わる）か `#rrggbb` で書く。図の同じものと同じ色にすると、式の項と図の部分が目で結びつく（R1 の傾きの数と接線、見本の展開の項と正方形の部分）。`\color{色}` は後ろ全体の色を切り替える命令なので、囲んだ所だけに効かせたいときは `\textcolor` を使う
- **文字の中の数式**: `geo.label` と `geo.point`・`geo.vector`・`geo.axes` の `label` は、`$…$` で囲むと TeX で組む
- **日本語**: MathJax には日本語の字形がない。`\text{速さ}` はテーマの字体の文字で代わりに出るが、式の中で幅が合わないことがある。日本語の説明は式の外に `geo.label` で置く
- **誤り**: 組めない TeX（閉じていない `{` など）は、その場所に TeX の文字列を赤で出し、検査が誤りにする

**変形（`geo.texMorph`）**: 両方の式で `\cssId{名前}{…}` で囲んだ部分は、同じ名前どうしが、位置と大きさを補間して動く。囲んでいない部分は、その場で薄くなって消え、新しい式の部分がその場で現れる。どこへ動くかを見せたい部分（項、指数、演算子）は、両方の式で同じ名前で囲む。

```js
geo.texMorph(g,
  String.raw`(\cssId{x}{x}\cssId{p}{+}\cssId{one}{1})^{\cssId{two}{2}}`,
  String.raw`\textcolor{accent}{\cssId{x}{x}^{\cssId{two}{2}}}\cssId{p}{+}\textcolor{warn}{2x}+\textcolor{good}{\cssId{one}{1}}`,
  v.e, { x: 400, y: 120, size: 64 })
```

この例では、`x`・`+`・`1`・指数の `2` が新しい場所へ動き、括弧が消え、`2x` と 2 つ目の `+` が現れる。前と後で色が違う部分（`x` は白から青へ）は、動きながら色が移る。`p` が 0 と 1 のときは、`geo.tex` で `from`・`to` を描いたのと同じ絵になる。

## 4. リファレンス（R1〜R6）

どれも、`custom` の関数の全文と、値と動作の例（1 行の `do` に書く `set`）を載せる。部品の宣言は `{ "id": "…", "type": "custom", "draw": "<関数の名前>" }`。関数の中の `w`・`h` に合わせて配置するので、区画を変えても崩れにくい。

### R1 微分の接線

点が曲線の上を滑り、接線の向きと傾きの数がついてくる。傾きが点ごとに決まる数だと見せ、記録をつけながらもう一度動かすと、傾きの記録が導関数の曲線として伸びる。

```json
{ "values": { "a": -2.4, "tl": 0, "tr": 0 },
  "do": [ { "set": "tl", "to": 1, "dur": 0.8 }, { "set": "a", "to": -1.1547, "dur": 2 },
          { "set": "tr", "to": 1, "dur": 0.4 }, { "set": "a", "to": 2.2, "dur": 3.6, "ease": "linear" } ] }
```

```js
({ g, v, el, S, geo, w, h }) => {
  // 曲線 f と、その導関数 df。点は x = a にあり、tl で接線が、tr で導関数の記録が現れる
  const f = x => x * x * x / 4 - x, df = x => 3 * x * x / 4 - 1;
  const num = x => { const s = x.toFixed(2); return s === "-0.00" ? "0.00" : s; };
  const Ax = geo.axes(g, { box: { x: 30, y: 10, w: w * 0.58, h: h - 30 }, x: [-3, 3], y: [-2.5, 2.5], grid: true, labels: { x: "$x$", y: "$y$" } });
  geo.plot(g, Ax, f, { color: "accent" });
  const a = v.a, m = df(a);
  if (v.tr > 0 && a > -2.4) geo.plot(el("g", { opacity: v.tr }, g), Ax, df, { from: -2.4, to: a, color: "good" });
  geo.tangent(el("g", { opacity: v.tl }, g), Ax, f, a, { df: m, color: "warn" });
  const [px, py] = Ax.toPx([a, f(a)]), py0 = Ax.toPx([a, 0])[1];
  el("path", { d: `M${px},${py0}V${py}`, stroke: S.muted, "stroke-width": 2, "stroke-dasharray": "6 6" }, g);
  geo.point(g, Ax, [a, f(a)], { color: "warn" });
  const X = w * 0.64;
  geo.tex(g, String.raw`f(x)=\tfrac{1}{4}x^3-x`, { x: X, y: 20, size: 34, color: "accent" });
  geo.tex(el("g", { opacity: v.tr }, g), String.raw`f'(x)=\tfrac{3}{4}x^2-1`, { x: X, y: 90, size: 34, color: "good" });
  // 傾きの数は、接線と同じ色にする
  geo.tex(el("g", { opacity: v.tl }, g), String.raw`f'(${num(a)})=\textcolor{warn}{${num(m)}}`, { x: X, y: 190, size: 44 });
}
```

### R2 リーマン和

長方形の本数 `n` を増やすと、長方形の面積の和が曲線の下の面積に近づく。和の数と、積分の値を並べて出すので、近づいていく様子を数でも追える。

```json
{ "values": { "n": 4 },
  "do": [ { "set": "n", "to": 64, "dur": 4, "ease": "linear" } ] }
```

```js
({ g, v, geo, w, h }) => {
  // f を 0〜2 で n 本の長方形に分け、左端の高さで足す。n が増えると、和が面積 4/3 に近づく
  const f = x => x * x / 2, n = Math.round(v.n);
  const Ax = geo.axes(g, { box: { x: 50, y: 10, w: w * 0.5, h: h - 50 }, x: [0, 2.2], y: [0, 2.2], ticks: { x: 0.5, y: 0.5 }, labels: { x: "$x$", y: "$y$" } });
  geo.riemann(g, Ax, f, 0, 2, n, { color: "accent" });
  geo.plot(g, Ax, f, { color: "warn", to: 2 });
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(2 * i / n) * (2 / n);
  const X = w * 0.58;
  geo.tex(g, `n=${n}`, { x: X, y: 20, size: 40, color: "accent" });
  geo.tex(g, String.raw`\textstyle\sum f(x_i)\,\Delta x \approx ${sum.toFixed(3)}`, { x: X, y: 100, size: 34, color: "accent" });
  geo.tex(g, String.raw`\int_0^2 \tfrac{1}{2}x^2\,dx=\tfrac{4}{3}\approx 1.333`, { x: X, y: 200, size: 34, color: "warn" });
}
```

### R3 単位円と三角関数

角が回ると、単位円の上の点の高さ（sin）と横の位置（cos）が線分で見え、高さが右のグラフに写って sin の波が描かれる。円の回転と波が同じものだと見せる。

```json
{ "values": { "th": 0 },
  "do": [ { "set": "th", "to": 6.2832, "dur": 6, "ease": "linear" } ] }
```

```js
({ g, v, el, S, geo, w, h }) => {
  // 角 th の点 P = (cos, sin)。P の高さを、右のグラフの (th, sin th) まで破線で写す
  const th = v.th, c = Math.cos(th), s = Math.sin(th), H = h - 40;
  const C = geo.axes(g, { box: { x: 20, y: 20, w: H, h: H }, x: [-1.3, 1.3], y: [-1.3, 1.3], ticks: { x: 1, y: 1 } });
  const O = C.toPx([0, 0]), r = C.toPx([1, 0])[0] - O[0], P = C.toPx([c, s]), F = C.toPx([c, 0]);
  geo.circle(g, O, r, { color: "muted", width: 2 });
  geo.arc(g, O, 34, 0, th, { color: "good", fill: true, width: 2 });
  geo.polygon(g, [O, P], { closed: false, color: "ink", width: 2 });
  geo.polygon(g, [O, F], { closed: false, color: "accent", width: 5 });
  geo.polygon(g, [F, P], { closed: false, color: "warn", width: 5 });
  const G = geo.axes(g, { box: { x: H + 70, y: 20, w: w - H - 90, h: H }, x: [0, 6.5], y: [-1.3, 1.3], ticks: { x: 1, y: 1 }, labels: { x: String.raw`$\theta$` } });
  geo.plot(g, G, Math.sin, { color: "warn", from: 0, to: Math.max(th, 1e-3) });
  const Q = G.toPx([th, s]);
  el("path", { d: `M${P[0]},${P[1]}H${Q[0]}`, stroke: S.muted, "stroke-width": 1.5, "stroke-dasharray": "6 6" }, g);
  geo.point(g, C, [c, s], { color: "warn" });
  geo.point(g, G, [th, s], { color: "warn" });
  geo.tex(g, String.raw`\sin\theta=${s.toFixed(2)}`, { x: w - 20, y: 24, size: 32, color: "warn", anchor: "end" });
  geo.tex(g, String.raw`\cos\theta=${c.toFixed(2)}`, { x: w - 20, y: 74, size: 32, color: "accent", anchor: "end" });
}
```

### R4 ベクトルの和

`b` を原点から `a` の先へ平行に運び、運び終えると、原点から `b` の先までの矢印 `a+b` が現れる。和が「つないだ先」だと見せる。

```json
{ "values": { "t": 0 },
  "do": [ { "set": "t", "to": 1, "dur": 2.4 } ] }
```

```js
({ g, v, el, geo, UZ, w, h }) => {
  // b の根元を、原点から a の先へ運ぶ（t: 0→1）。t が 0.7 を過ぎると a+b が現れる
  const a = [3, 1], b = [1, 2], t = v.t, from = geo.lerp([0, 0], a, t), H = h - 30;
  const Ax = geo.axes(g, { box: { x: 30, y: 10, w: H * 7 / 5, h: H }, x: [-1, 6], y: [-1, 4], grid: true, ticks: { x: 1, y: 1 } });
  if (t > 0) geo.vector(el("g", { opacity: 0.3 }, g), Ax, [0, 0], b, { color: "warn" });
  geo.vector(g, Ax, [0, 0], a, { color: "accent", label: String.raw`$\vec{a}$` });
  geo.vector(g, Ax, from, [from[0] + b[0], from[1] + b[1]], { color: "warn", label: String.raw`$\vec{b}$` });
  const k = UZ.clamp((t - 0.7) / 0.3);
  if (k > 0) {
    const kg = el("g", { opacity: k }, g);   // a+b の先は b の先と重なるので、名前は矢の中ほどの左上に置く
    geo.vector(kg, Ax, [0, 0], [a[0] + b[0], a[1] + b[1]], { color: "good" });
    geo.label(kg, Ax.toPx([2.1, 2.4]), String.raw`$\vec{a}+\vec{b}$`, { color: "good" });
    geo.tex(kg, String.raw`(3,1)+(1,2)=(4,3)`, { x: H * 7 / 5 + 70, y: 40, size: 36, color: "good" });
  }
}
```

### R5 損失曲線と勾配を下る点

左は損失 `L(w)` の谷で、点が勾配と逆の向きへ一歩ずつ下る。右は歩数ごとの損失（機械学習の損失曲線）で、左の点が下るたびに右の線が延びる。1 歩ごとの下がり幅が小さくなっていく理由が、左の接線の傾きで見える。

```json
{ "values": { "k": 0 },
  "do": [ { "set": "k", "to": 8, "dur": 6, "ease": "linear" } ] }
```

```js
({ g, v, el, S, geo, w, h }) => {
  // 損失 L(w) の谷を、学習率 eta で下る。k は歩数（小数のときは次の一歩の途中）
  const L = x => 0.5 * (x - 3) ** 2 + 0.5, dL = x => x - 3, eta = 0.35;
  const ws = [-0.5];
  for (let i = 0; i < 10; i++) ws.push(ws[i] - eta * dL(ws[i]));
  const K = Math.min(Math.floor(v.k), 9), cur = geo.lerp(ws[K], ws[K + 1], v.k - K);
  const A = geo.axes(g, { box: { x: 30, y: 10, w: w * 0.45, h: h - 50 }, x: [-1, 6], y: [0, 7.5], ticks: { x: 1, y: 1 }, labels: { x: "$w$", y: "$L$" } });
  geo.plot(g, A, L, { color: "accent" });
  for (let i = 0; i <= K; i++) geo.point(g, A, [ws[i], L(ws[i])], { color: "muted", r: 4 });
  geo.tangent(g, A, L, cur, { color: "warn", len: 2 });
  geo.point(g, A, [cur, L(cur)], { color: "warn" });
  geo.tex(g, String.raw`w \leftarrow w-\eta\,L'(w)`, { x: A.toPx([5.9, 0])[0], y: 16, size: 28, color: "ink", anchor: "end" });
  const B = geo.axes(g, { box: { x: w * 0.55, y: 10, w: w * 0.42, h: h - 50 }, x: [0, 8.5], y: [0, 7.5], ticks: { x: 1, y: 1 }, labels: { x: "歩数", y: "$L$" } });
  const pts = [];
  for (let i = 0; i <= K; i++) pts.push(B.toPx([i, L(ws[i])]));
  pts.push(B.toPx([v.k, L(cur)]));
  geo.polygon(g, pts, { closed: false, color: "warn" });
  geo.point(g, B, [v.k, L(cur)], { color: "warn" });
}
```

### R6 業務の数字の推移

月の伸び率という 1 つの値を動かすと、12 か月の棒と 12 月の売上の式が一緒に変わる。前の伸び率での高さを破線で残すので、後ろの月ほど差が開くことが見える。数学でない題材でも、値の連動はこの形で使える。

```json
{ "values": { "g": 0.02 },
  "do": [ { "set": "g", "to": 0.05, "dur": 3 } ] }
```

```js
({ g, v, el, S, geo, w, h }) => {
  // 月の売上 100 万円が、毎月 r ずつ伸びる。伸び率を上げたら、2% のときの高さを横線で残して比べる
  const r = v.g, sales = (rate, m) => 100 * Math.pow(1 + rate, m - 1);
  const Ax = geo.axes(g, { box: { x: 70, y: 20, w: w * 0.58, h: h - 50 }, x: [0.3, 12.7], y: [0, 200], ticks: { x: 1, y: 50 }, labels: { y: "万円" } });
  for (let m = 1; m <= 12; m++) {
    geo.bar(g, Ax, m, sales(r, m), { color: m === 12 ? "warn" : "accent", opacity: 0.85 });
    if (r > 0.0201) {
      const [x0, y] = Ax.toPx([m - 0.3, sales(0.02, m)]), x1 = Ax.toPx([m + 0.3, 0])[0];
      el("path", { d: `M${x0},${y}H${x1}`, stroke: S.ink, "stroke-width": 3, "stroke-dasharray": "5 4" }, g);
    }
  }
  const X = w * 0.66, last = sales(r, 12);
  geo.label(g, [X, 30], "月の伸び率", { anchor: "start", color: "muted", size: 24 });
  geo.number(g, [X, 80], r * 100, { decimals: 1, unit: "%", anchor: "start", color: "accent", size: 48 });
  geo.label(g, [X, 160], "12 月の売上（万円）", { anchor: "start", color: "muted", size: 24 });
  geo.tex(g, String.raw`100\times${(1 + r).toFixed(3)}^{11}\approx\textcolor{warn}{${Math.round(last)}}`, { x: X, y: 190, size: 36 });
}
```
