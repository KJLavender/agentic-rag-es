/**
 * Cross-encoder rerank：query 和每個片段一起送進模型打分，比 embedding 的「各算各的向量」準，但比較慢。
 * 用 transformers.js 在 Node 裡跑 ONNX（CPU），不佔 Ollama 的 GPU。第一次會下載模型（int8 約 570MB）。
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env } from "@huggingface/transformers";
import type { Hit } from "./search.js";

const MODEL = process.env.RERANK_MODEL ?? "onnx-community/bge-reranker-v2-m3-ONNX";
env.cacheDir = process.env.RERANK_CACHE ?? ".cache/models";

let loaded: Promise<{ tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>; model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>> }> | null = null;

function load() {
  loaded ??= (async () => ({
    tokenizer: await AutoTokenizer.from_pretrained(MODEL),
    model: await AutoModelForSequenceClassification.from_pretrained(MODEL, { dtype: "q8" }),
  }))();
  return loaded;
}

const BATCH = 8;

/** 回傳依 rerank 分數排序的前 k 筆；score 換成 0~1 的相關度。 */
export async function rerank<T extends Pick<Hit, "content" | "heading_path" | "title" | "score">>(query: string, hits: T[], k: number): Promise<T[]> {
  if (hits.length <= 1) return hits.slice(0, k);
  const { tokenizer, model } = await load();
  const scored: T[] = [];
  for (let i = 0; i < hits.length; i += BATCH) {
    const batch = hits.slice(i, i + BATCH);
    const inputs = tokenizer(new Array(batch.length).fill(query), {
      text_pair: batch.map((h) => `${[h.title, h.heading_path].filter(Boolean).join(" > ")}\n${h.content}`),
      padding: true,
      truncation: true,
      max_length: 512,
    });
    const { logits } = await model(inputs);
    const raw = logits.data as Float32Array;
    batch.forEach((h, j) => scored.push({ ...h, score: 1 / (1 + Math.exp(-raw[j])) }));
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
