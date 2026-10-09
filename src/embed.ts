import { config } from "./config.js";

const BATCH = 16;

/** Ollama /api/embed。批次送，避免一次塞太多把 8GB GPU 撐爆。 */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(`${config.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.embedModel, input: texts.slice(i, i + BATCH) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`embedding 失敗 ${res.status}: ${await res.text()}`);
    const { embeddings } = (await res.json()) as { embeddings: number[][] };
    for (const e of embeddings) {
      if (e.length !== config.embedDims) {
        throw new Error(`embedding 維度 ${e.length} 跟 EMBED_DIMS=${config.embedDims} 不同；換模型要重建索引`);
      }
      out.push(e);
    }
  }
  return out;
}

export const embedOne = async (text: string) => (await embed([text]))[0];

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
