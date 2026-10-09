import { existsSync } from "node:fs";

// .env 放手動設定，.env.local 放 npm run es:setup 產生的 API key。已經設定的環境變數優先。
// MCP 子程序設 RAG_NO_ENV_FILE=1：只拿 parent 給的唯讀 key，不會從檔案讀到 ingest key。
if (!process.env.RAG_NO_ENV_FILE) {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const config = {
  esUrl: env("ES_URL", "http://127.0.0.1:9200"),
  esIndex: env("ES_INDEX", "rag-chunks"),
  esIngestApiKey: process.env.ES_INGEST_API_KEY ?? "",
  esSearchApiKey: process.env.ES_SEARCH_API_KEY ?? "",

  ollamaUrl: env("OLLAMA_URL", "http://127.0.0.1:11434"),
  /** npm run setup:model 從 LLM_BASE_MODEL 建出來的 16k context 變體；決策、評審、生成共用，GPU 只載一份。 */
  llmModel: env("LLM_MODEL", "rag-qwen3.5-4b"),
  llmNumCtx: num("LLM_NUM_CTX", 16384),
  llmTimeoutMs: num("LLM_TIMEOUT_MS", 120_000),
  embedModel: env("EMBED_MODEL", "bge-m3"),
  embedDims: num("EMBED_DIMS", 1024),

  /** 切塊：每塊最多幾個字、相鄰兩塊重疊幾個字。 */
  chunkMaxChars: num("CHUNK_MAX_CHARS", 600),
  chunkOverlap: num("CHUNK_OVERLAP", 80),

  /** hybrid 的 RRF 裡 BM25 那一路的權重（向量那一路是 1）。 */
  hybridKeywordWeight: num("HYBRID_KEYWORD_WEIGHT", 0.3),
  /** rerank 時第一段撈幾筆候選。驗收組：20 筆比 10 筆 MRR 高約 0.02，多 0.8 秒。 */
  rerankCandidates: num("RERANK_CANDIDATES", 20),
  /** 決策層：問題跟語料最像的片段低於這個 cosine 相似度，視為範圍外。調整組實測：正常問題最低 0.61、範圍外最高 0.50。 */
  domainMinSimilarity: num("DOMAIN_MIN_SIMILARITY", 0.55),
  /** LLM 說範圍外、但相似度高於這個值：以檢索為準，還是去查（不適用 injection）。 */
  domainStrongSimilarity: num("DOMAIN_STRONG_SIMILARITY", 0.65),
  /** 決策層：LLM 信心低於這個值就請使用者澄清，不進 agent。 */
  decisionMinConfidence: num("DECISION_MIN_CONFIDENCE", 0.5),
  /** CRAG：context 不夠時最多重查幾次。 */
  maxRetrievalRounds: num("MAX_RETRIEVAL_ROUNDS", 2),
  /** 給 LLM 的片段數。 */
  contextK: num("CONTEXT_K", 6),

  port: num("PORT", 8787),
  dbPath: env("DB_PATH", "data/app.sqlite"),
  /** MCP retrieval server：設了就走 Streamable HTTP（docker compose），沒設就用 stdio 子程序。 */
  mcpUrl: process.env.MCP_URL ?? "",
};
