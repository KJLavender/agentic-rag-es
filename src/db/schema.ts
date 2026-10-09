import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 對應 ES 片段的 acl。public 一律都有，不用存。 */
  groups: text("groups", { mode: "json" }).$type<string[]>().notNull(),
});

export const settings = sqliteTable("settings", {
  userId: text("user_id").primaryKey().references(() => users.id),
  mode: text("mode").notNull().default("auto"),
  rerank: integer("rerank", { mode: "boolean" }).notNull().default(false),
  showTrace: integer("show_trace", { mode: "boolean" }).notNull().default(true),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** 完整 trace：決策、每一輪檢索、評審、工具呼叫、查核、耗時。前端展開看、debug、👎 轉評測題都靠它。 */
  trace: text("trace", { mode: "json" }),
  sources: text("sources", { mode: "json" }),
  verifyStatus: text("verify_status"),
  latencyMs: integer("latency_ms"),
});

export const feedback = sqliteTable("feedback", {
  messageId: integer("message_id").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1 = 👍、-1 = 👎
  comment: text("comment"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** MCP server 的稽核紀錄：誰、查了什麼、拿到哪些片段。 */
export const toolAudit = sqliteTable("tool_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").references(() => messages.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  args: text("args", { mode: "json" }),
  groups: text("groups", { mode: "json" }),
  resultIds: text("result_ids", { mode: "json" }),
  at: text("at").notNull(),
});
