/**
 *   npm run mcp                                    # stdio（backend 用子程序啟動；也可以接 MCP Inspector）
 *   MCP_HTTP_PORT=8788 MCP_TOKEN=... npm run mcp   # Streamable HTTP（docker compose 裡的獨立容器）
 */
import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRetrievalServer } from "./server.js";

function tokenOk(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function main() {
  const port = Number(process.env.MCP_HTTP_PORT ?? 0);
  if (!port) {
    await createRetrievalServer().connect(new StdioServerTransport());
    return;
  }
  const token = process.env.MCP_TOKEN ?? "";
  if (token.length < 16) throw new Error("HTTP 模式需要 MCP_TOKEN（至少 16 字元）");
  createHttpServer(async (req, res) => {
    if (req.url !== "/mcp") return void res.writeHead(404).end();
    if (!tokenOk(req.headers.authorization, token)) return void res.writeHead(401).end();
    // stateless：每個請求一個 server + transport
    const server = createRetrievalServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }).listen(port, "0.0.0.0", () => console.error(`MCP retrieval server (HTTP) on :${port}/mcp`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
