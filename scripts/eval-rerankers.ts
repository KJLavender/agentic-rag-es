/**
 * Reranker 對照實驗（docs/rerank-plan.md）：同一批候選，換不同後端重排，比排序品質、延遲、依題型拆開的表現。
 *
 *   npx tsx scripts/eval-rerankers.ts --split tune --rerankers none,bge,qwen3,julia:pair,julia:doc,laya:pair --n 20,50
 *   npx tsx scripts/eval-rerankers.ts --split test --golden eval/golden-files.json --rerankers none,bge,laya:pair
 *
 * 後端要先跑起來（llama.cpp，見 README）：
 *   llama-server -m Julia-1-Q8_0.gguf --port 8091            # julia
 *   llama-server -m Laya-Q8_0.gguf --port 8092               # laya
 *   llama-server -m qwen3-reranker-0.6b-q8_0.gguf --reranking --port 8093   # qwen3
 *   llama-server -m Kev-4B-Q4_K_M.gguf -ngl 99 --port 8094   # kev（GPU）
 *
 * 分數依 (後端, 問題, 片段內容) 快取在 .cache/rerank-eval/，重跑不會重算；延遲取第一次實際跑的時間。
 * 標準答案沿用 golden set 的證據句（不是 chunk id），所以重新切塊也不用重標。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { esClient } from "../src/es/index.js";
import { firstStage, type Hit, type Mode } from "../src/retrieval/search.js";
import { crossEncoder, docText, llmReranker, rerankApi, systemOne, type Reranker, type SystemOneFormat } from "../src/retrieval/rerank.js";
import { goldenPath, loadGolden, relevantIds, splitArg } from "./lib/golden.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const split = splitArg();
const mode = opt("mode", "hybrid") as Mode;
const ns = opt("n", "20").split(",").map(Number);
const names = opt("rerankers", "none,bge").split(",");

const DECISION_PORTS: Record<string, number> = { julia: 8091, laya: 8092, kev: 8094 };
function preset(name: string): Reranker | null {
  if (name === "none") return null;
  if (name === "bge") return crossEncoder("Xenova/bge-reranker-base");
  if (name === "qwen3") return rerankApi("http://127.0.0.1:8093/v1/rerank", "qwen3-reranker-0.6b");
  if (name === "llm") return llmReranker();
  const [model, format = "pair"] = name.split(":");
  if (model in DECISION_PORTS) return systemOne(`http://127.0.0.1:${DECISION_PORTS[model]}/v1/systemone`, { name: model, format: format as SystemOneFormat });
  if (model === "jev") {
    if (!process.env.JEV_API_KEY) throw new Error("jev 需要 JEV_API_KEY（放在 .env.local）");
    return systemOne(process.env.JEV_URL ?? "https://jevtypesafeai.com/api/v1/decide", { name: "jev", format: format as SystemOneFormat, apiKey: process.env.JEV_API_KEY });
  }
  throw new Error(`不認得的 reranker：${name}`);
}

const es = esClient("search");
const golden = loadGolden(split);
const questions = golden.questions;
const relevant = await relevantIds(es, questions);
// 查不到答案的題目：拿來看「最高分」能不能分辨有答案／沒答案（之後要不要用門檻擋）
const noAnswer = golden.traps.filter((t) => t.kind === "unanswerable" || t.kind === "out_of_scope");
const maxN = Math.max(...ns);

const pools = new Map<string, Hit[]>();
for (const q of [...questions, ...noAnswer]) pools.set(q.id, await firstStage(es, mode, q.question.trim(), maxN, q.groups ?? []));

// ── 快取 ──
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
mkdirSync(".cache/rerank-eval", { recursive: true });
type Store = { scores: Record<string, number>; ms: Record<string, number> };
const loadStore = (name: string): Store => {
  const f = `.cache/rerank-eval/${name.replace(/[^\w.-]/g, "_")}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { scores: {}, ms: {} };
};
const saveStore = (name: string, s: Store) => writeFileSync(`.cache/rerank-eval/${name.replace(/[^\w.-]/g, "_")}.json`, JSON.stringify(s));

/** 回傳這題前 n 個候選的分數和這次重排花的時間。 */
async function scoreQuery(r: Reranker, store: Store, query: string, pool: Hit[]): Promise<{ scores: number[]; ms: number }> {
  const docs = pool.map((h) => docText(h));
  const keys = docs.map((d) => `${sha(query)}|${sha(d)}`);
  const msKey = `${sha(query)}|${sha(keys.join())}`;
  if (keys.every((k) => k in store.scores) && msKey in store.ms) return { scores: keys.map((k) => store.scores[k]), ms: store.ms[msKey] };
  const t = performance.now();
  const scores = await r.score(query, docs);
  const ms = performance.now() - t;
  keys.forEach((k, i) => (store.scores[k] = scores[i]));
  store.ms[msKey] = ms;
  return { scores, ms };
}

// ── 指標 ──
const dcg = (rels: boolean[], k: number) => rels.slice(0, k).reduce((s, r, i) => s + (r ? 1 / Math.log2(i + 2) : 0), 0);
const ndcg = (rels: boolean[], nRel: number, k: number) => {
  const ideal = dcg(new Array(Math.min(nRel, k)).fill(true), k);
  return ideal ? dcg(rels, k) / ideal : 0;
};
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
/** 配對 bootstrap：兩組逐題 MRR 差的 95% 信賴區間。 */
function bootstrap(a: number[], b: number[], iters = 2000): [number, number] {
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const diffs: number[] = [];
  for (let t = 0; t < iters; t++) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(rand() * a.length);
      s += a[j] - b[j];
    }
    diffs.push(s / a.length);
  }
  return [quantile(diffs, 0.025), quantile(diffs, 0.975)];
}
/** AUROC：有答案的題目最高分 > 沒答案的題目最高分 的機率。 */
function auroc(pos: number[], neg: number[]): number {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? s / (pos.length * neg.length) : NaN;
}

interface Row {
  name: string;
  n: number;
  perQ: { id: string; type: string; rr: number; hit1: boolean; hit5: boolean; ndcg5: number; ndcg10: number }[];
  ms: number[];
  auroc: number;
  failed: number;
}
const rows: Row[] = [];

for (const name of names) {
  const r = preset(name);
  const store = r ? loadStore(r.name) : { scores: {}, ms: {} };
  if (r) await r.score("暖機", ["暖機"]).catch((e) => console.error(`${name} 暖機失敗：${e.message}`)); // 載入模型，不計時
  for (const n of ns) {
    const row: Row = { name, n, perQ: [], ms: [], auroc: NaN, failed: 0 };
    const top1 = new Map<string, number>();
    for (const q of [...questions, ...noAnswer]) {
      const pool = pools.get(q.id)!.slice(0, n);
      let ranked = pool;
      if (r && pool.length > 1) {
        try {
          const { scores, ms } = await scoreQuery(r, store, q.question.trim(), pool);
          ranked = pool.map((h, i) => ({ h, s: scores[i], i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.h);
          top1.set(q.id, Math.max(...scores));
          if ("points" in q) row.ms.push(ms);
        } catch (err) {
          row.failed++;
          console.error(`${name} ${q.id} 失敗：${(err as Error).message}`);
        }
      } else top1.set(q.id, pool[0]?.score ?? 0);
      if (!("points" in q)) continue;
      const rel = relevant.get(q.id)!;
      const rels = ranked.map((h) => rel.has(h.chunk_id));
      const rank = rels.indexOf(true) + 1;
      row.perQ.push({
        id: q.id,
        type: q.type ?? "fact",
        rr: rank && rank <= 10 ? 1 / rank : 0,
        hit1: rank === 1,
        hit5: rank > 0 && rank <= 5,
        ndcg5: ndcg(rels, rel.size, 5),
        ndcg10: ndcg(rels, rel.size, 10),
      });
    }
    row.auroc = auroc(questions.map((q) => top1.get(q.id) ?? 0), noAnswer.map((t) => top1.get(t.id) ?? 0));
    rows.push(row);
    process.stderr.write(`${name} N=${n} 完成\n`);
  }
  if (r) saveStore(r.name, store);
}

// ── 報表 ──
const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const types = ["fact", "multi", "paraphrase"].filter((t) => questions.some((q) => (q.type ?? "fact") === t));
const recallAt = (n: number) => m(questions.map((q) => (pools.get(q.id)!.slice(0, n).some((h) => relevant.get(q.id)!.has(h.chunk_id)) ? 1 : 0)));
const base = (n: number) => rows.find((r) => r.name === "none" && r.n === n) ?? rows.find((r) => r.name === "none");

const lines = [
  `Reranker 對照｜${goldenPath()}｜${split === "test" ? "驗收組" : split === "tune" ? "調整組" : "全部"} ${questions.length} 題（${types.map((t) => `${t} ${questions.filter((q) => (q.type ?? "fact") === t).length}`).join("、")}）＋ 沒答案 ${noAnswer.length} 題｜候選來源 ${mode}｜${config.embedModel}`,
  "",
  `第一段的上限（標準片段有進前 N 個候選）：${ns.map((n) => `N=${n} ${pct(recallAt(n))}`).join("、")}`,
  "",
  `| 後端 | N | Hit@1 | Hit@5 | MRR@10 | NDCG@5 | NDCG@10 | MRR 差（vs 不重排，95% CI） | ${types.map((t) => `MRR ${t}`).join(" | ")} | 延遲 p50 / p95 | 有答案 vs 沒答案 AUROC |`,
  `|---|---|---|---|---|---|---|---|${types.map(() => "---|").join("")}---|---|`,
  ...rows.map((r) => {
    const b = base(r.n);
    const rr = r.perQ.map((x) => x.rr);
    const diff = b && b !== r ? (() => {
      const [lo, hi] = bootstrap(rr, b.perQ.map((x) => x.rr));
      return `${(m(rr) - m(b.perQ.map((x) => x.rr))).toFixed(3)}（${lo.toFixed(3)} ~ ${hi.toFixed(3)}）`;
    })() : "—";
    const byType = types.map((t) => m(r.perQ.filter((x) => x.type === t).map((x) => x.rr)).toFixed(3));
    const lat = r.ms.length ? `${quantile(r.ms, 0.5).toFixed(0)} / ${quantile(r.ms, 0.95).toFixed(0)} ms` : "—";
    return `| ${r.name}${r.failed ? `（${r.failed} 題失敗）` : ""} | ${r.n} | ${pct(m(r.perQ.map((x) => +x.hit1)))} | ${pct(m(r.perQ.map((x) => +x.hit5)))} | ${m(rr).toFixed(3)} | ${m(r.perQ.map((x) => x.ndcg5)).toFixed(3)} | ${m(r.perQ.map((x) => x.ndcg10)).toFixed(3)} | ${diff} | ${byType.join(" | ")} | ${lat} | ${Number.isNaN(r.auroc) ? "—" : r.auroc.toFixed(2)} |`;
  }),
  "",
  "（CI 不含 0 才算有顯著差異；AUROC 0.5 = 分不出來，1 = 完全分得開。延遲是每題重排 N 段的時間，CPU 後端會受同時執行的程式影響。）",
];
console.log(lines.join("\n"));
mkdirSync("results", { recursive: true });
const file = `results/rerankers-${goldenPath().replace(/^.*[\\/]/, "").replace(/\.json$/, "")}-${split}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`;
writeFileSync(file, JSON.stringify({ report: lines.join("\n"), rows }, null, 2));
console.log(`\n逐題結果：${file}`);
process.exit(0);
