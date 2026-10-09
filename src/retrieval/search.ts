import type { Client } from "@elastic/elasticsearch";
import type { estypes } from "@elastic/elasticsearch";
import { config } from "../config.js";
import { embedOne } from "../embed.js";
import type { ChunkDoc } from "../es/index.js";

export const MODES = ["keyword", "vector", "hybrid", "cascade"] as const;
export type Mode = (typeof MODES)[number];

export interface Hit {
  chunk_id: string;
  doc_id: string;
  title: string;
  source: string;
  heading_path: string;
  content: string;
  position: number;
  score: number;
  /** 這筆是哪一路找到的（hybrid / cascade 才有意義）。 */
  via: "keyword" | "vector" | "both";
  /** vector 才有：query 跟片段的 cosine 相似度，決策層用來判斷是不是範圍外。 */
  similarity?: number;
}

export interface SearchParams {
  mode: Mode;
  query: string;
  k?: number;
  /** 呼叫者的群組。由 server 端帶入，不是 LLM 給的。 */
  groups: string[];
  /** 第一段撈 RERANK_CANDIDATES 筆，再用 cross-encoder 重排。可以搭配任何模式。 */
  rerank?: boolean;
}

const SOURCE: (keyof ChunkDoc)[] = ["chunk_id", "doc_id", "title", "source", "heading_path", "content", "position"];

/** ACL 一律在查詢裡過濾；沒有群組就只有 public。 */
export function aclFilter(groups: string[]): estypes.QueryDslQueryContainer {
  const g = [...new Set(["public", ...groups.filter((x) => typeof x === "string" && x)])];
  return { terms: { acl: g } };
}

function toHits(res: estypes.SearchResponse<ChunkDoc>, via: Hit["via"]): Hit[] {
  return res.hits.hits.map((h) => ({
    ...(h._source as Omit<Hit, "score" | "via">),
    score: h._score ?? 0,
    via,
    // ES 的 cosine _score = (1 + cos) / 2
    ...(via === "vector" ? { similarity: 2 * (h._score ?? 0) - 1 } : {}),
  }));
}

async function keyword(es: Client, query: string, k: number, groups: string[], strict = false): Promise<Hit[]> {
  const res = await es.search<ChunkDoc>({
    index: config.esIndex,
    size: k,
    _source: SOURCE,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query,
              fields: ["content", "heading_path^1.5", "title^1.2"],
              type: "best_fields",
              tie_breaker: 0.3,
              // cascade 的第一段要「關鍵字真的對得上」，不然中文常見字幾乎什麼都 match
              ...(strict ? { minimum_should_match: "60%" } : {}),
            },
          },
        ],
        filter: [aclFilter(groups)],
      },
    },
  });
  return toHits(res, "keyword");
}

async function vector(es: Client, query: string, k: number, groups: string[]): Promise<Hit[]> {
  const res = await es.search<ChunkDoc>({
    index: config.esIndex,
    size: k,
    _source: SOURCE,
    knn: {
      field: "embedding",
      query_vector: await embedOne(query),
      k,
      num_candidates: Math.max(100, k * 10),
      filter: [aclFilter(groups)],
    },
  });
  return toHits(res, "vector");
}

/**
 * Reciprocal Rank Fusion：score = Σ 1 / (rankConstant + rank)。
 * ES 的 rrf retriever 在 Basic 授權會 403，所以在這裡自己算，也比較看得清楚融合邏輯。
 */
export function rrf(lists: Hit[][], k: number, rankConstant = 60, weights: number[] = []): Hit[] {
  const merged = new Map<string, Hit>();
  lists.forEach((list, li) => {
    const w = weights[li] ?? 1;
    list.forEach((h, i) => {
      const add = w / (rankConstant + i + 1);
      const prev = merged.get(h.chunk_id);
      if (prev) {
        prev.score += add;
        if (prev.via !== h.via) prev.via = "both";
        prev.similarity ??= h.similarity;
      } else {
        merged.set(h.chunk_id, { ...h, score: add });
      }
    });
  });
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export async function search(es: Client, p: SearchParams): Promise<Hit[]> {
  const k = Math.min(Math.max(p.k ?? 5, 1), 20);
  const q = p.query.trim().slice(0, 500);
  if (!q) return [];
  if (!p.rerank) return firstStage(es, p.mode, q, k, p.groups);
  // 兩段式：先用任一模式撈較多候選，再用 cross-encoder 重排取前 k。模型只在用到時才載入。
  const candidates = await firstStage(es, p.mode, q, Math.max(k, config.rerankCandidates), p.groups);
  const { rerank } = await import("./rerank.js");
  return rerank(q, candidates, k);
}

async function firstStage(es: Client, mode: Mode, q: string, k: number, groups: string[]): Promise<Hit[]> {
  const p = { mode, groups };
  switch (p.mode) {
    case "keyword":
      return keyword(es, q, k, p.groups);
    case "vector":
      return vector(es, q, k, p.groups);
    case "hybrid": {
      const depth = k * 4;
      const [kw, vec] = await Promise.all([keyword(es, q, depth, p.groups), vector(es, q, depth, p.groups)]);
      // 口語問題下 BM25 比較吵，調整組實測 keyword 權重 0.3 的 MRR 最好（見 README 評測）
      return rrf([kw, vec], k, 60, [config.hybridKeywordWeight, 1]);
    }
    case "cascade": {
      // IKEA 的做法：先用嚴格的關鍵字查，不夠 k 筆再用向量補
      const kw = await keyword(es, q, k, p.groups, true);
      if (kw.length >= k) return kw;
      const seen = new Set(kw.map((h) => h.chunk_id));
      const vec = (await vector(es, q, k, p.groups)).filter((h) => !seen.has(h.chunk_id));
      return [...kw, ...vec].slice(0, k);
    }
  }
}

/** 取片段本身＋前後各 window 塊；給 doc_id 就回整份文件（有長度上限）。 */
export async function getDocument(es: Client, id: string, groups: string[], window = 1): Promise<Hit[]> {
  const isChunk = id.includes("#");
  const docId = isChunk ? id.slice(0, id.indexOf("#")) : id;
  const pos = isChunk ? Number(id.slice(id.indexOf("#") + 1)) : NaN;
  const filter: estypes.QueryDslQueryContainer[] = [aclFilter(groups), { term: { doc_id: docId } }];
  if (isChunk && Number.isFinite(pos)) filter.push({ range: { position: { gte: pos - window, lte: pos + window } } });
  const res = await es.search<ChunkDoc>({
    index: config.esIndex,
    size: isChunk ? window * 2 + 1 : 40,
    _source: SOURCE,
    sort: [{ position: "asc" }],
    query: { bool: { filter } },
  });
  const hits = toHits(res, "keyword").map((h) => ({ ...h, score: 0 }));
  // 整份文件最多約 6000 字，避免把 context 撐爆
  let total = 0;
  return hits.filter((h) => (total += h.content.length) <= 6000 || h === hits[0]);
}
