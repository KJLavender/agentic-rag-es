/**
 * 檢索層評測：四種模式 × golden set 的 Hit@k、MRR。
 *
 *   npm run eval:retrieval                 # 調整組
 *   npm run eval:retrieval -- --split test # 驗收組（從不拿來調參數）
 *   npm run eval:retrieval -- --rerank     # 多跑一組「hybrid + cross-encoder rerank」
 *
 * 相關片段的定義：內容包含 golden.json 裡 evidence.text 的片段。切塊策略改了也能公平比較。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { esClient } from "../src/es/index.js";
import { MODES, search, type Hit, type Mode } from "../src/retrieval/search.js";
import { loadGolden, relevantIds, splitArg } from "./lib/golden.js";

const split = splitArg();
const withRerank = process.argv.includes("--rerank");
const K = 10;
const es = esClient("search");
const golden = loadGolden(split);
const relevant = await relevantIds(es, golden.questions);

type Variant = { name: string; run: (q: string, groups: string[]) => Promise<Hit[]> };
const variants: Variant[] = MODES.map((mode: Mode) => ({ name: mode, run: (q, groups) => search(es, { mode, query: q, k: K, groups }) }));
if (withRerank) {
  const { rerank } = await import("../src/retrieval/rerank.js");
  variants.push({
    name: "hybrid+rerank",
    run: async (q, groups) => rerank(q, await search(es, { mode: "hybrid", query: q, k: 20, groups }), K),
  });
}

interface Row { name: string; hit1: number; hit3: number; hit5: number; mrr: number; ms: number; misses: string[] }
const rows: Row[] = [];
for (const v of variants) {
  let hit1 = 0, hit3 = 0, hit5 = 0, mrr = 0, ms = 0;
  const misses: string[] = [];
  for (const q of golden.questions) {
    const started = Date.now();
    const hits = await v.run(q.question, q.groups ?? []);
    ms += Date.now() - started;
    const rel = relevant.get(q.id)!;
    const rank = hits.findIndex((h) => rel.has(h.chunk_id)) + 1; // 0 = 沒找到
    if (rank === 1) hit1++;
    if (rank && rank <= 3) hit3++;
    if (rank && rank <= 5) hit5++;
    if (rank) mrr += 1 / rank;
    if (!rank || rank > 5) misses.push(`${q.id}${rank ? `@${rank}` : ""}`);
  }
  const n = golden.questions.length;
  rows.push({ name: v.name, hit1: hit1 / n, hit3: hit3 / n, hit5: hit5 / n, mrr: mrr / n, ms: ms / n, misses });
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const table = [
  `檢索評測｜${split === "test" ? "驗收組" : split === "tune" ? "調整組" : "全部"} ${golden.questions.length} 題｜${config.embedModel}｜chunk ${config.chunkMaxChars}/${config.chunkOverlap}`,
  "",
  "| 模式 | Hit@1 | Hit@3 | Hit@5 | MRR@10 | 平均延遲 |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${pct(r.hit1)} | ${pct(r.hit3)} | ${pct(r.hit5)} | ${r.mrr.toFixed(3)} | ${r.ms.toFixed(0)} ms |`),
].join("\n");
console.log(table);
if (split !== "test") {
  console.log("\n前 5 名沒找到的題目（@n 表示第 n 名才出現）：");
  for (const r of rows) console.log(`  ${r.name.padEnd(14)} ${r.misses.join(" ") || "—"}`);
}
mkdirSync("results", { recursive: true });
const file = `results/retrieval-${split}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`;
writeFileSync(file, JSON.stringify({ split, k: K, embedModel: config.embedModel, rows }, null, 2));
console.log(`\n結果：${file}`);
