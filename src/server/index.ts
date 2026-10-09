import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { config } from "../config.js";
import { openDb, schema } from "../db/index.js";
import { esClient } from "../es/index.js";
import { ingestDocument } from "../ingest/ingest.js";
import { llmUp } from "../agent/llm.js";
import { runPipeline, type Trace } from "../agent/pipeline.js";
import { RetrievalClient, type Passage } from "../agent/retrieval-client.js";
import { MODES } from "../retrieval/search.js";
import type { ConversationView, RagUIMessage, SettingsView, UserView } from "../shared/ui.js";

const db = openDb();
const retrieval = new RetrievalClient();
await retrieval.connect();

// MCP server 的稽核紀錄（stderr）：目前這一輪的先收起來，回答存好後跟 message id 一起寫進 SQLite
let auditBuffer: Record<string, unknown>[] | null = null;
retrieval.onAudit((line) => {
  try {
    const j = JSON.parse(line);
    if (j.audit) return void auditBuffer?.push(j);
  } catch {}
  console.error(`[mcp] ${line}`);
});

// 只有一張 GPU：同一時間只跑一個問題，其他排隊
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

const app = Fastify({ logger: { level: "info" }, bodyLimit: 1_000_000 });

// ── 使用者（示範用：用 cookie 選身分，群組一律從資料庫查，不信任前端）──
function currentUser(req: FastifyRequest): UserView {
  const uid = /(?:^|;\s*)uid=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "guest";
  const u = db.select().from(schema.users).where(eq(schema.users.id, uid)).get() ?? db.select().from(schema.users).where(eq(schema.users.id, "guest")).get()!;
  return { id: u.id, name: u.name, groups: u.groups };
}

function getSettings(userId: string): SettingsView {
  const s = db.select().from(schema.settings).where(eq(schema.settings.userId, userId)).get();
  return { mode: (s?.mode ?? "auto") as SettingsView["mode"], rerank: s?.rerank ?? false, showTrace: s?.showTrace ?? true };
}

app.get("/api/health", async () => ({ ok: true, llm: await llmUp() }));
app.get("/api/users", async () => db.select().from(schema.users).all() satisfies UserView[]);
app.get("/api/me", async (req) => ({ user: currentUser(req), settings: getSettings(currentUser(req).id) }));
app.post<{ Body: { userId: string } }>("/api/login", async (req, reply) => {
  const u = db.select().from(schema.users).where(eq(schema.users.id, String(req.body?.userId))).get();
  if (!u) return reply.code(404).send({ error: "沒有這個使用者" });
  reply.header("set-cookie", `uid=${u.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return { ok: true };
});

app.put<{ Body: Partial<SettingsView> }>("/api/settings", async (req, reply) => {
  const user = currentUser(req);
  const cur = getSettings(user.id);
  const mode = req.body?.mode ?? cur.mode;
  if (mode !== "auto" && !MODES.includes(mode)) return reply.code(400).send({ error: "mode 不正確" });
  const next = { userId: user.id, mode, rerank: Boolean(req.body?.rerank ?? cur.rerank), showTrace: Boolean(req.body?.showTrace ?? cur.showTrace) };
  db.insert(schema.settings).values(next).onConflictDoUpdate({ target: schema.settings.userId, set: next }).run();
  return getSettings(user.id);
});

// ── 對話紀錄 ──
app.get("/api/conversations", async (req) => {
  const user = currentUser(req);
  return db
    .select({
      id: schema.conversations.id,
      title: schema.conversations.title,
      updatedAt: sql<number>`${schema.conversations.updatedAt}`,
      turns: sql<number>`(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = ${schema.conversations.id} AND m.role = 'user')`,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.userId, user.id))
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(100)
    .all() satisfies ConversationView[];
});

function ownConversation(userId: string, id: string) {
  return db.select().from(schema.conversations).where(and(eq(schema.conversations.id, id), eq(schema.conversations.userId, userId))).get();
}

/** SQLite 的訊息還原成前端用的 UIMessage（含 trace、來源、查核結果、回饋）。 */
function toUiMessages(conversationId: string): RagUIMessage[] {
  const rows = db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId)).orderBy(asc(schema.messages.id)).all();
  const ratings = new Map(
    db
      .select()
      .from(schema.feedback)
      .where(sql`${schema.feedback.messageId} IN (SELECT id FROM messages WHERE conversation_id = ${conversationId})`)
      .all()
      .map((f) => [f.messageId, f.rating]),
  );
  return rows.map((m) => {
    if (m.role === "user") return { id: `m${m.id}`, role: "user", parts: [{ type: "text", text: m.content }] };
    const trace = (m.trace ?? {}) as Trace;
    const parts: RagUIMessage["parts"] = [];
    if (trace.decision) parts.push({ type: "data-decision", data: trace.decision });
    for (const r of trace.rounds ?? []) parts.push({ type: "data-retrieval", id: `round-${r.round}`, data: r });
    for (const t of trace.tools ?? []) parts.push({ type: "data-tool", data: t });
    if (m.sources) parts.push({ type: "data-sources", id: "sources", data: m.sources as Passage[] });
    parts.push({ type: "text", text: m.content });
    if (trace.verify) parts.push({ type: "data-verify", id: "verify", data: trace.verify });
    return { id: `m${m.id}`, role: "assistant", parts, metadata: { messageId: m.id, latencyMs: m.latencyMs ?? undefined, rating: ratings.get(m.id) } };
  });
}

app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
  const c = ownConversation(currentUser(req).id, req.params.id);
  if (!c) return reply.code(404).send({ error: "找不到對話" });
  return { id: c.id, title: c.title, messages: toUiMessages(c.id) };
});

app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
  const c = ownConversation(currentUser(req).id, req.params.id);
  if (!c) return reply.code(404).send({ error: "找不到對話" });
  db.delete(schema.conversations).where(eq(schema.conversations.id, c.id)).run();
  return { ok: true };
});

app.post<{ Body: { messageId: number; rating: number; comment?: string } }>("/api/feedback", async (req, reply) => {
  const user = currentUser(req);
  const m = db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
    .where(and(eq(schema.messages.id, Number(req.body?.messageId)), eq(schema.conversations.userId, user.id), eq(schema.messages.role, "assistant")))
    .get();
  if (!m) return reply.code(404).send({ error: "找不到訊息" });
  const row = { messageId: m.id, rating: req.body.rating > 0 ? 1 : -1, comment: req.body.comment?.slice(0, 1000) ?? null, createdAt: new Date() };
  db.insert(schema.feedback).values(row).onConflictDoUpdate({ target: schema.feedback.messageId, set: row }).run();
  return { ok: true };
});

// ── 問答（AI SDK UI message stream）──
app.post<{ Body: { conversationId?: string; text: string } }>("/api/chat", async (req, reply: FastifyReply) => {
  const user = currentUser(req);
  const text = String(req.body?.text ?? "").trim();
  if (!text) return reply.code(400).send({ error: "問題是空的" });
  let conversationId = req.body?.conversationId;
  if (conversationId && !ownConversation(user.id, conversationId)) return reply.code(404).send({ error: "找不到對話" });
  const now = new Date();
  if (!conversationId) {
    conversationId = randomUUID();
    db.insert(schema.conversations).values({ id: conversationId, userId: user.id, title: text.slice(0, 40), createdAt: now, updatedAt: now }).run();
  }
  // 追問要用的上文：最近 3 輪（伺服器重啟也能從 DB 還原）
  const history = db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.id))
    .limit(6)
    .all()
    .reverse();
  db.insert(schema.messages).values({ conversationId, role: "user", content: text, createdAt: now }).run();
  const settings = getSettings(user.id);
  const abort = new AbortController();
  reply.raw.on("close", () => abort.abort());

  const stream = createUIMessageStream<RagUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { conversationId } });
      const textId = "answer";
      writer.write({ type: "text-start", id: textId });
      if (waiting++ > 0) writer.write({ type: "data-status", data: { text: "排隊中，前面還有人在問" }, transient: true });
      const run = queue.then(async () => {
        auditBuffer = [];
        const started = Date.now();
        const res = await runPipeline(
          { question: text, history, groups: user.groups, settings: { mode: settings.mode, rerank: settings.rerank } },
          retrieval,
          (e) => {
            if (e.type === "text") writer.write({ type: "text-delta", id: textId, delta: e.delta });
            else if (e.type === "status") writer.write({ type: "data-status", data: { text: e.text }, transient: true });
            else if (e.type === "retrieval") writer.write({ type: "data-retrieval", id: `round-${e.data.round}`, data: e.data });
            else if (e.type === "sources") writer.write({ type: "data-sources", id: "sources", data: e.data });
            else if (e.type === "verify") writer.write({ type: "data-verify", id: "verify", data: e.data });
            else writer.write({ type: `data-${e.type}`, data: e.data } as never);
          },
          abort.signal,
        );
        const latencyMs = Date.now() - started;
        const saved = db
          .insert(schema.messages)
          .values({
            conversationId: conversationId!,
            role: "assistant",
            content: res.answer,
            createdAt: new Date(),
            trace: res.trace,
            sources: res.sources,
            verifyStatus: res.trace.verify?.status ?? null,
            latencyMs,
          })
          .returning({ id: schema.messages.id })
          .get();
        for (const a of auditBuffer ?? []) {
          db.insert(schema.toolAudit).values({ messageId: saved.id, tool: String(a.tool), args: a.args, groups: a.groups, resultIds: a.result_ids, at: String(a.at) }).run();
        }
        auditBuffer = null;
        db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId!)).run();
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish", messageMetadata: { conversationId, messageId: saved.id, latencyMs } });
      });
      queue = run.catch(() => {}).finally(() => waiting--);
      await run;
    },
    onError: (e) => {
      req.log.error(e);
      return "抱歉，處理問題時發生錯誤，請再試一次。";
    },
  });
  reply.hijack();
  pipeUIMessageStreamToResponse({ response: reply.raw, stream });
});

// ── 文件（只有 admin 群組可以上傳；acl 只能設成自己有的群組）──
function requireAdmin(req: FastifyRequest, reply: FastifyReply): UserView | null {
  const user = currentUser(req);
  if (!user.groups.includes("admin")) {
    reply.code(403).send({ error: "只有 admin 可以管理文件" });
    return null;
  }
  return user;
}

app.get("/api/documents", async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const res = await esClient("ingest").search({
    index: config.esIndex,
    size: 0,
    aggs: { docs: { terms: { field: "doc_id", size: 500 }, aggs: { top: { top_hits: { size: 1, _source: ["title", "acl", "source"] } } } } },
  });
  const buckets = (res.aggregations?.docs as { buckets: { key: string; doc_count: number; top: { hits: { hits: { _source: { title: string; acl: string[]; source: string } }[] } } }[] }).buckets;
  return buckets.map((b) => ({ docId: b.key, chunks: b.doc_count, ...b.top.hits.hits[0]._source }));
});

app.post<{ Body: { filename: string; content: string; acl?: string[] } }>("/api/documents", async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  const filename = String(req.body?.filename ?? "").replace(/[^\w.\-一-鿿]/g, "_").slice(0, 100);
  const content = String(req.body?.content ?? "");
  if (!/\.(md|txt)$/i.test(filename)) return reply.code(400).send({ error: "只接受 .md 或 .txt" });
  if (!content.trim() || content.length > 500_000) return reply.code(400).send({ error: "內容是空的或超過 500KB" });
  const allowed = new Set(["public", ...user.groups]);
  const acl = (req.body.acl?.length ? req.body.acl : ["admin"]).map(String);
  if (acl.some((g) => !allowed.has(g))) return reply.code(403).send({ error: `acl 只能是你有的群組：${[...allowed].join(", ")}` });
  // 上傳檔案裡的 frontmatter acl 不採信，一律用表單選的
  return ingestDocument(content, filename, acl);
});

// ── 前端（npm run build:web 之後由這裡提供；開發時用 vite dev server）──
const webDist = resolve("web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html")));
}

await app.listen({ port: config.port, host: process.env.HOST ?? "127.0.0.1" });
