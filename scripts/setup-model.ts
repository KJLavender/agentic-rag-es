/**
 * 建一個 context 16k 的模型變體（japan-trip-bot 踩過的坑）：
 * Ollama 的 OpenAI 相容介面會忽略 num_ctx，預設 context 太小，片段一多就被默默截掉。
 * 決策層、評審、生成都用同一個變體，GPU 上只載入一份。
 */
import { config } from "../src/config.js";

const base = process.env.LLM_BASE_MODEL ?? "qwen3.5:4b";
const res = await fetch(`${config.ollamaUrl}/api/create`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: config.llmModel, from: base, parameters: { num_ctx: config.llmNumCtx }, stream: false }),
});
console.log(res.ok ? `已建立 ${config.llmModel}（from ${base}，num_ctx=${config.llmNumCtx}）` : `失敗 ${res.status}: ${await res.text()}`);
if (!res.ok) process.exit(1);
