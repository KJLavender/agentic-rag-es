/**
 * 原版 bge-m3 vs 微調後的 bge-m3-ft：同一批題目、同樣的語料，只換 embedding 模型和 index。
 *
 *   npx tsx scripts/finetune/compare.ts
 *   npx tsx scripts/finetune/compare.ts --golden eval/golden-files.json --split test
 *
 * 前提：兩個 index 都灌好同一份語料（rag-chunks 用 bge-m3、rag-chunks-ft 用 bge-m3-ft，見 scripts/finetune/to-ollama.sh）。
 * 每題記錄標準片段排第幾，算 MRR@10、Hit@1／5，並用配對 bootstrap 算 MRR 差的 95% 信賴區間。
 * keyword 模式不用 embedding，兩邊應該一樣，當作對照。
 */
import { config } from "../../src/config.js";
import { esClient } from "../../src/es/index.js";
import { search, type Mode } from "../../src/retrieval/search.js";
import { goldenPath, loadGolden, relevantIds, splitArg } from "../lib/golden.js";

const A = { name: "bge-m3", index: process.env.BASE_INDEX ?? "rag-chunks", model: process.env.BASE_MODEL ?? "bge-m3" };
const B = { name: "bge-m3-ft", index: process.env.FT_INDEX ?? "rag-chunks-ft", model: process.env.FT_MODEL ?? "bge-m3-ft" };
const MODES_TO_RUN: Mode[] = ["keyword", "vector", "hybrid"];
const split = splitArg();
const { questions } = loadGolden(split);
const es = esClient("search");

const use = (c: typeof A) => {
  // config 是一般物件：評測時直接切換 index 和 embedding 模型
  (config as { esIndex: string }).esIndex = c.index;
  (config as { embedModel: string }).embedModel = c.model;
};

async function ranks(c: typeof A, mode: Mode): Promise<number[]> {
  use(c);
  const rel = await relevantIds(es, questions);
  const out: number[] = [];
  for (const q of questions) {
    const hits = await search(es, { mode, query: q.question, k: 10, groups: q.groups ?? [] });
    out.push(hits.findIndex((h) => rel.get(q.id)!.has(h.chunk_id)) + 1);
  }
  return out;
}

const rr = (r: number) => (r > 0 ? 1 / r : 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function bootstrap(a: number[], b: number[], iters = 2000): [number, number] {
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const d: number[] = [];
  for (let t = 0; t < iters; t++) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(rand() * a.length);
      s += b[j] - a[j];
    }
    d.push(s / a.length);
  }
  d.sort((x, y) => x - y);
  return [d[Math.floor(0.025 * iters)], d[Math.floor(0.975 * iters)]];
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const lines = [
  `embedding 微調對照｜${goldenPath()}｜${split} ${questions.length} 題｜${A.name}（${A.index}） vs ${B.name}（${B.index}）`,
  "",
  `| 模式 | 模型 | Hit@1 | Hit@5 | MRR@10 | MRR 差（95% CI） | ${["fact", "multi", "paraphrase"].map((t) => `MRR ${t}`).join(" | ")} |`,
  "|---|---|---|---|---|---|---|---|---|",
];
const misses: string[] = [];
for (const mode of MODES_TO_RUN) {
  const ra = await ranks(A, mode);
  const rb = await ranks(B, mode);
  const [lo, hi] = bootstrap(ra.map(rr), rb.map(rr));
  for (const [c, r] of [[A, ra], [B, rb]] as const) {
    const byType = ["fact", "multi", "paraphrase"].map((t) => {
      const xs = questions.map((q, i) => ((q.type ?? "fact") === t ? rr(r[i]) : NaN)).filter((x) => !Number.isNaN(x));
      return xs.length ? mean(xs).toFixed(3) : "—";
    });
    const diff = c === B ? `${(mean(rb.map(rr)) - mean(ra.map(rr))).toFixed(3)}（${lo.toFixed(3)} ~ ${hi.toFixed(3)}）` : "—";
    lines.push(`| ${mode} | ${c.name} | ${pct(mean(r.map((x) => +(x === 1))))} | ${pct(mean(r.map((x) => +(x > 0 && x <= 5))))} | ${mean(r.map(rr)).toFixed(3)} | ${diff} | ${byType.join(" | ")} |`);
  }
  questions.forEach((q, i) => {
    if (ra[i] !== rb[i]) misses.push(`${mode} ${q.id} ${ra[i] || "—"} → ${rb[i] || "—"}  ${q.question}`);
  });
}
console.log(lines.join("\n"));
console.log("\n名次有變的題目（原版 → 微調，— = 前 10 名沒有）：");
for (const m of misses) console.log(`  ${m}`);
process.exit(0);
