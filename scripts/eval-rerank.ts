/**
 * Rerank 實驗：候選數、模型大小對準度和速度的影響，以及 rerank 分數能不能拿來判斷「相關／不相關」。
 *
 *   npx tsx scripts/eval-rerank.ts --split tune
 *   RERANK_MODEL=Xenova/bge-reranker-base npx tsx scripts/eval-rerank.ts --split tune
 */
import { config } from "../src/config.js";
import { esClient } from "../src/es/index.js";
import { search, type Hit, type Mode } from "../src/retrieval/search.js";
import { rerank } from "../src/retrieval/rerank.js";
import { loadGolden, relevantIds, splitArg } from "./lib/golden.js";

const split = splitArg();
const es = esClient("search");
const { questions } = loadGolden(split);
const relevant = await relevantIds(es, questions);
const K = 10;

// 先把各題的候選抓好，只量 rerank 本身
const bases: Mode[] = ["hybrid", "vector"];
const pools = new Map<string, Hit[]>();
for (const mode of bases) for (const q of questions) pools.set(`${mode}|${q.id}`, await search(es, { mode, query: q.question, k: 30, groups: q.groups ?? [] }));

await rerank("暖機", [pools.values().next().value![0], pools.values().next().value![1]], 1); // 載入模型，不計時

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`Rerank 實驗｜${split === "test" ? "驗收組" : "調整組"} ${questions.length} 題｜${process.env.RERANK_MODEL ?? "bge-reranker-v2-m3"}\n`);
console.log("| 候選來源 | 候選數 | Hit@1 | Hit@3 | Hit@5 | MRR@10 | 每題 rerank 時間 |");
console.log("|---|---|---|---|---|---|---|");

const scored: { rel: boolean; score: number }[] = [];
for (const mode of bases) {
  for (const n of [0, 10, 20, 30]) {
    let h1 = 0, h3 = 0, h5 = 0, mrr = 0, ms = 0;
    for (const q of questions) {
      const pool = pools.get(`${mode}|${q.id}`)!.slice(0, n || K);
      const t = Date.now();
      const ranked = n ? await rerank(q.question, pool, K) : pool;
      ms += Date.now() - t;
      const rel = relevant.get(q.id)!;
      const rank = ranked.findIndex((h) => rel.has(h.chunk_id)) + 1;
      if (rank === 1) h1++;
      if (rank && rank <= 3) h3++;
      if (rank && rank <= 5) h5++;
      if (rank) mrr += 1 / rank;
      if (mode === "hybrid" && n === 20) for (const h of ranked) scored.push({ rel: rel.has(h.chunk_id), score: h.score });
    }
    const m = questions.length;
    console.log(`| ${mode} | ${n || "不 rerank"} | ${pct(h1 / m)} | ${pct(h3 / m)} | ${pct(h5 / m)} | ${(mrr / m).toFixed(3)} | ${n ? `${(ms / m / 1000).toFixed(2)} s` : "—"} |`);
  }
}

// rerank 分數當「相關性」訊號：不同門檻下，標準片段留下多少、其他片段擋掉多少
const relS = scored.filter((s) => s.rel).map((s) => s.score);
const irrS = scored.filter((s) => !s.rel).map((s) => s.score);
console.log(`\nrerank 分數（hybrid 前 20 → 前 10）：標準片段 ${relS.length} 個、其他 ${irrS.length} 個`);
console.log("| 門檻 | 標準片段保留 | 其他片段濾掉 |");
console.log("|---|---|---|");
for (const th of [0.01, 0.05, 0.1, 0.2, 0.3, 0.5]) {
  console.log(`| ${th} | ${pct(relS.filter((s) => s >= th).length / relS.length)} | ${pct(irrS.filter((s) => s < th).length / irrS.length)} |`);
}
console.log(`\n（${config.embedModel}；候選數 0 = 原本的排序）`);
process.exit(0);
