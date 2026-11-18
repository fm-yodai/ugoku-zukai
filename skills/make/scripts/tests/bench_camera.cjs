#!/usr/bin/env node
// カメラの当てはめ（fitCamera）の時間を測る。検査には使わない（run_m9.sh から呼ばない）。
// 使い方: taskset -c 0 node skills/make/scripts/tests/bench_camera.cjs [ノード数]
"use strict";
const { load, theme } = require("../uz_node.cjs");
const UZ = load(), TH = theme("koo");
const N = Number(process.argv[2]) || 60;
const nodes = [], edges = [];
for (let i = 0; i < N; i++) { nodes.push({ id: "n" + i, label: "ノード" + i }); if (i > 0) edges.push({ from: "n" + Math.floor((i - 1) / 3), to: "n" + i, label: "呼ぶ" }); }
const lines = [{ id: "l0", text: "{a}全体を出します。", do: [{ show: "g", at: "a" }] }];
const targets = ["n" + (N - 1), "n" + Math.floor(N / 2), "n1", "n" + (N - 2), "n" + Math.floor(N / 3), "n" + Math.floor(N / 5)];
for (let k = 0; k < 6; k++) {   // zoom → all を 6 往復
  lines.push({ id: "z" + k, text: "{a}寄ります。", do: [{ zoom: targets[k], at: "a" }] });
  lines.push({ id: "a" + k, text: "{a}戻ります。", do: [{ zoom: "all", at: "a" }] });
}
const sb = { format: "ugoku-zukai/6", title: "bench", voice: { speaker: 8, speed: 1.1 }, figures: { g: { type: "graph", nodes, edges } },
  slides: { a: { title: "A", parts: [{ figure: "g" }] } }, scenes: [{ id: "s1", slide: "a", lines }] };
(async () => {
  const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000;
  const t0 = ms();
  const M = await UZ.build(sb, TH, null);
  const t1 = ms();
  const iss = UZ.checkLayout(M);
  const t2 = ms();
  console.log(`ノード ${N}、zoom ${M.acts.filter(a => a.verb === "zoom").length} 回（all を含む）`);
  console.log(`UZ.build ${(t1 - t0).toFixed(0)} ms（ELK の配置を含む）`);
  console.log(`checkLayout ${(t2 - t1).toFixed(0)} ms（指摘 ${iss.length} 件）`);
  if (t1 - t0 > 1000) console.log("build が 1 秒を超えた: fitCamera の候補（axis の位置の数）を間引く");
})();
