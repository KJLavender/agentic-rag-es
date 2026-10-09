/** 下載 rerank 模型到 RERANK_CACHE（Docker build 時跑，執行時就不需要外網）。 */
import { preloadReranker } from "../src/retrieval/rerank.js";

await preloadReranker();
console.log(`rerank 模型已下載到 ${process.env.RERANK_CACHE ?? ".cache/models"}`);
