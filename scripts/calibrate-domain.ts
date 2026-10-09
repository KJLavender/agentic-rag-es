/** 校準決策層的領域相似度門檻：看調整組的正常問題和範圍外陷阱題，跟語料最像的片段相似度各是多少。 */
import { esClient } from "../src/es/index.js";
import { search } from "../src/retrieval/search.js";
import { loadGolden, splitArg } from "./lib/golden.js";

const es = esClient("search");
const { questions, traps } = loadGolden(splitArg());
const sim = async (q: string, groups: string[] = []) => (await search(es, { mode: "vector", query: q, k: 1, groups }))[0]?.similarity ?? 0;
const inDomain = await Promise.all(questions.map(async (q) => ({ id: q.id, s: await sim(q.question, q.groups) })));
const outDomain = await Promise.all(traps.map(async (t) => ({ id: `${t.id}(${t.kind})`, s: await sim(t.question, t.groups) })));
const fmt = (xs: { id: string; s: number }[]) => xs.sort((a, b) => a.s - b.s).map((x) => `${x.id}=${x.s.toFixed(3)}`).join("  ");
console.log("正常問題（由低到高）：", fmt(inDomain));
console.log("\n陷阱題（由低到高）：", fmt(outDomain));
