import { Client, type estypes } from "@elastic/elasticsearch";
import { config } from "../config.js";

export type EsRole = "ingest" | "search";

/** 每個角色用自己的 API key：retrieval 只拿得到唯讀 key，寫不進去也讀不到別的 index。 */
export function esClient(role: EsRole): Client {
  const apiKey = role === "ingest" ? config.esIngestApiKey : config.esSearchApiKey;
  if (!apiKey) throw new Error(`缺少 ES_${role.toUpperCase()}_API_KEY，請先執行 npm run es:setup`);
  return new Client({ node: config.esUrl, auth: { apiKey } });
}

export interface ChunkDoc {
  chunk_id: string;
  doc_id: string;
  title: string;
  source: string;
  heading_path: string;
  content: string;
  position: number;
  acl: string[];
  embedding: number[];
  content_hash: string;
  ingested_at: string;
  /** md / pdf / pptx / docx */
  file_type: string;
  /** PDF 頁碼／投影片編號（從 1 開始）；Markdown 沒有。 */
  page?: number;
  /** 片段裡每一行的文字和在頁面上的位置（0～1），給證據截圖框線用；不建索引。 */
  layout?: { lines: { t: string; b: [number, number, number, number] }[] };
}

export function indexDefinition(dims: number): Omit<estypes.IndicesCreateRequest, "index"> {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      analysis: {
        filter: {
          // 繁轉簡：「資料」跟「资料」變成同一個 token
          zh_t2s: { type: "icu_transform", id: "Traditional-Simplified" },
        },
        analyzer: {
          zh: { type: "custom", tokenizer: "icu_tokenizer", filter: ["icu_normalizer", "zh_t2s", "lowercase"] },
        },
      },
    },
    mappings: {
      dynamic: "strict",
      properties: {
        chunk_id: { type: "keyword" },
        doc_id: { type: "keyword" },
        title: { type: "text", analyzer: "zh", fields: { raw: { type: "keyword" } } },
        source: { type: "keyword" },
        heading_path: { type: "text", analyzer: "zh" },
        content: { type: "text", analyzer: "zh" },
        position: { type: "integer" },
        acl: { type: "keyword" },
        embedding: { type: "dense_vector", dims, index: true, similarity: "cosine" },
        content_hash: { type: "keyword" },
        ingested_at: { type: "date" },
        file_type: { type: "keyword" },
        page: { type: "integer" },
        layout: { type: "object", enabled: false },
      },
    },
  };
}
