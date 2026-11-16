/**
 * 把「調整組」的題目、相關片段 id 和全部片段匯出成 JSON，給 train.py 直接在 Python 裡算向量檢索的 MRR，
 * 不用每試一組參數就轉 GGUF、重建 index。只匯出調整組：驗收組留到最後才跑一次。
 *
 *   npx tsx scripts/finetune/export-eval.ts      # → .cache/ft/tune-eval.json
 */
import { writeFileSync } from "node:fs";
import { config } from "../../src/config.js";
import { esClient, type ChunkDoc } from "../../src/es/index.js";
import { contextualText } from "../../src/ingest/chunk.js";
import { loadGolden, relevantIds } from "../lib/golden.js";

const es = esClient("search");
const { questions } = loadGolden("tune");
const rel = await relevantIds(es, questions);
const res = await es.search<ChunkDoc>({ index: config.esIndex, size: 5000, _source: ["chunk_id", "title", "heading_path", "content", "acl"], query: { match_all: {} } });
writeFileSync(
  ".cache/ft/tune-eval.json",
  JSON.stringify({
    questions: questions.map((q) => ({ id: q.id, query: q.question, groups: q.groups ?? [], relevant: [...rel.get(q.id)!] })),
    chunks: res.hits.hits.map((h) => ({ id: h._source!.chunk_id, text: contextualText(h._source!.title, h._source!.heading_path, h._source!.content), acl: h._source!.acl })),
  }),
);
console.log(`調整組 ${questions.length} 題、片段 ${res.hits.hits.length} 個`);
process.exit(0);
