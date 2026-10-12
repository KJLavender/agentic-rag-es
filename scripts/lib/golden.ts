import { readFileSync } from "node:fs";
import type { Client } from "@elastic/elasticsearch";
import { config } from "../../src/config.js";
import type { ChunkDoc } from "../../src/es/index.js";

export type Split = "tune" | "test" | "all";

export interface Question {
  id: string;
  split: "tune" | "test";
  question: string;
  groups?: string[];
  points: string[];
  evidence: { doc: string; text: string }[];
  /** SOP 題：原文應有的步驟數。 */
  steps?: number;
}

export interface Trap {
  id: string;
  split: "tune" | "test";
  kind: "out_of_scope" | "injection" | "acl" | "indirect_injection" | "unanswerable" | "chitchat";
  question: string;
  expect: "refuse" | "no_leak" | "answer" | "no_answer" | "chitchat";
  forbid?: string[];
  groups?: string[];
}

export function splitArg(): Split {
  const i = process.argv.indexOf("--split");
  const s = i >= 0 ? process.argv[i + 1] : "tune";
  if (s !== "tune" && s !== "test" && s !== "all") throw new Error("--split 只能是 tune / test / all");
  return s;
}

/** --golden 指定題庫檔，預設 eval/golden.json。 */
export function goldenPath(): string {
  const i = process.argv.indexOf("--golden");
  return i >= 0 ? process.argv[i + 1] : "eval/golden.json";
}

export function loadGolden(split: Split, path = goldenPath()): { questions: Question[]; traps: Trap[] } {
  const g = JSON.parse(readFileSync(path, "utf8")) as { questions: Question[]; traps: Trap[] };
  const keep = <T extends { split: string }>(xs: T[]) => (split === "all" ? xs : xs.filter((x) => x.split === split));
  return { questions: keep(g.questions), traps: keep(g.traps) };
}

/** 比對前去掉 * 和 `、合併空白（跟 golden.json 的 evidence 一樣的正規化）。 */
export const normalize = (s: string) => s.replace(/[*`]/g, "").replace(/\s+/g, " ");

/** 每題的相關片段 = 內容包含任一 evidence.text 的片段。 */
export async function relevantIds(es: Client, questions: Question[]): Promise<Map<string, Set<string>>> {
  const res = await es.search<ChunkDoc>({
    index: config.esIndex,
    size: 5000,
    _source: ["chunk_id", "doc_id", "content"],
    query: { match_all: {} },
  });
  const chunks = res.hits.hits.map((h) => h._source!);
  const out = new Map<string, Set<string>>();
  for (const q of questions) {
    const ids = new Set<string>();
    for (const e of q.evidence) {
      for (const c of chunks) if (c.doc_id === e.doc && normalize(c.content).includes(e.text)) ids.add(c.chunk_id);
    }
    if (!ids.size) throw new Error(`${q.id} 的 evidence 在索引裡找不到，golden set 需要更新`);
    out.set(q.id, ids);
  }
  return out;
}
