import { config } from "../config.js";

/**
 * 小模型只做窄任務（分類、改寫、判斷夠不夠），一律用 Ollama 的 JSON schema 結構化輸出。
 * 走原生 /api/chat：可以設 num_ctx、關掉 thinking，format 直接吃 JSON schema。
 */
export async function llmJson<T>(system: string, user: string, schema: object, opts: { numPredict?: number; model?: string; numCtx?: number } = {}): Promise<T> {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? config.llmModel,
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0, num_ctx: opts.numCtx ?? config.llmNumCtx, num_predict: opts.numPredict ?? 400 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { message: { content: string } };
  return JSON.parse(body.message.content) as T;
}

export async function llmUp(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
