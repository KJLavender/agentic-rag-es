import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

// 表不多、只有一個 app 用，啟動時建表就好，不另外跑 migration 工具
const DDL = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, groups TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'auto',
  rerank INTEGER NOT NULL DEFAULT 0,
  show_trace INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  trace TEXT,
  sources TEXT,
  verify_status TEXT,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS feedback (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args TEXT,
  groups TEXT,
  result_ids TEXT,
  at TEXT NOT NULL
);
`;

/** 示範用的使用者：沒有真的登入，見 README「限制」。 */
const SEED_USERS = [
  { id: "guest", name: "訪客（public）", groups: [] },
  { id: "member", name: "團隊成員（team）", groups: ["team"] },
  { id: "admin", name: "管理者（team + admin，可上傳文件）", groups: ["team", "admin"] },
];

export function openDb(path = config.dbPath) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const insert = sqlite.prepare("INSERT OR IGNORE INTO users (id, name, groups) VALUES (?, ?, ?)");
  for (const u of SEED_USERS) insert.run(u.id, u.name, JSON.stringify(u.groups));
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof openDb>;
export { schema };
