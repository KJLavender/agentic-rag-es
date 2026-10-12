import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config.js";
import type { Mode } from "../retrieval/search.js";

/** MCP 回給 agent 的片段（跟 src/mcp/server.ts 的 view() 對應）。 */
export interface Passage {
  id: string;
  title: string;
  section: string;
  source: string;
  score: number;
  via: string;
  similarity?: number;
  /** md / pdf / pptx / docx */
  file_type?: string;
  /** PDF 頁碼、投影片編號。 */
  page?: number;
  /** 片段每一行的文字和位置（0～1），證據截圖框線用。 */
  lines?: { t: string; b: [number, number, number, number] }[];
  content: string;
}

/**
 * Backend 透過 MCP 碰資料，不直接連 ES。
 * 使用者群組放在 _meta，不在工具參數裡：LLM 看不到也改不了。
 */
export class RetrievalClient {
  private client = new Client({ name: "rag-backend", version: "0.1.0" });
  private ready: Promise<void> | null = null;

  connect(): Promise<void> {
    this.ready ??= (async () => {
      if (config.mcpUrl) {
        await this.client.connect(
          new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
            requestInit: { headers: { authorization: `Bearer ${process.env.MCP_TOKEN ?? ""}` } },
          }),
        );
        return;
      }
      // 子程序只拿得到它需要的變數：唯讀 key，沒有 ingest key、沒有 superuser 密碼
      const env: Record<string, string> = {
        ...getDefaultEnvironment(),
        RAG_NO_ENV_FILE: "1",
        ES_URL: config.esUrl,
        ES_INDEX: config.esIndex,
        ES_SEARCH_API_KEY: config.esSearchApiKey,
        OLLAMA_URL: config.ollamaUrl,
        EMBED_MODEL: config.embedModel,
        EMBED_DIMS: String(config.embedDims),
      };
      await this.client.connect(
        new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/main.ts"], env, stderr: "pipe" }),
      );
    })();
    return this.ready;
  }

  /** stderr 的稽核紀錄另外交給呼叫端（寫進 SQLite）。 */
  onAudit(cb: (line: string) => void) {
    const t = (this.client as unknown as { _transport?: { stderr?: NodeJS.ReadableStream | null } })._transport;
    t?.stderr?.on("data", (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(cb));
  }

  private async call(name: string, args: Record<string, unknown>, groups: string[]): Promise<Passage[]> {
    await this.connect();
    // layout：要每一行的座標（證據截圖框線用）
    const res = await this.client.callTool({ name, arguments: args, _meta: { groups, layout: true } });
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
    if (res.isError) throw new Error(`MCP ${name} 失敗：${text.slice(0, 300)}`);
    return (JSON.parse(text) as { results: Passage[] }).results;
  }

  search(mode: Mode, query: string, k: number, groups: string[], rerank = false) {
    return this.call("search", { mode, query, k, rerank }, groups);
  }

  getDocument(id: string, groups: string[]) {
    return this.call("get_document", { id }, groups);
  }

  async listTools() {
    await this.connect();
    return (await this.client.listTools()).tools;
  }

  async close() {
    await this.client.close();
  }
}
