import { test } from "node:test";
import assert from "node:assert/strict";
import { rerank, systemOne, type Reranker } from "../src/retrieval/rerank.js";

const hit = (id: string, content: string, score = 0) => ({ chunk_id: id, title: "t", heading_path: "", content, score });

const fake = (name: string, f: (docs: string[]) => number[] | Promise<number[]>): Reranker & { calls: number } => {
  const r = { name, calls: 0, score: async (_q: string, docs: string[]) => (r.calls++, f(docs)) };
  return r;
};

test("rerank：依後端分數排序、取前 k，score 換成後端分數", async () => {
  const r = fake("t1", (docs) => docs.map((d) => (d.includes("對") ? 0.9 : 0.1)));
  const out = await rerank("q", [hit("a", "錯"), hit("b", "對"), hit("c", "錯")], 2, { reranker: r });
  assert.deepEqual(out.map((h) => h.chunk_id), ["b", "a"]);
  assert.equal(out[0].score, 0.9);
});

test("rerank：後端出錯或逾時，退回原本的排序並標記", async () => {
  const boom = fake("t2", () => {
    throw new Error("down");
  });
  const out = await rerank("q", [hit("a", "1"), hit("b", "2"), hit("c", "3")], 2, { reranker: boom });
  assert.deepEqual(out.map((h) => h.chunk_id), ["a", "b"]);
  assert.ok(out.every((h) => h.rerank_failed));

  const slow = fake("t3", () => new Promise((res) => setTimeout(() => res([1, 2]), 200)));
  const out2 = await rerank("q", [hit("a", "1"), hit("b", "2")], 2, { reranker: slow, timeoutMs: 20 });
  assert.deepEqual(out2.map((h) => h.chunk_id), ["a", "b"]);
  assert.ok(out2[0].rerank_failed);
});

test("rerank：同一個問題和片段內容只打一次分（快取不看 chunk id）", async () => {
  const r = fake("t4", (docs) => docs.map((_, i) => i));
  await rerank("q", [hit("a", "x"), hit("b", "y")], 2, { reranker: r });
  await rerank("q", [hit("a2", "x"), hit("b2", "y")], 2, { reranker: r });
  assert.equal(r.calls, 1);
});

test("System One 後端：不在本機的位址要明確允許才能用（文件內容會送出去）", () => {
  const prev = process.env.RERANK_ALLOW_REMOTE;
  delete process.env.RERANK_ALLOW_REMOTE;
  assert.throws(() => systemOne("https://example.com/api/v1/decide"), /RERANK_ALLOW_REMOTE/);
  assert.doesNotThrow(() => systemOne("http://127.0.0.1:8091/v1/systemone"));
  process.env.RERANK_ALLOW_REMOTE = "1";
  assert.doesNotThrow(() => systemOne("https://example.com/api/v1/decide"));
  if (prev === undefined) delete process.env.RERANK_ALLOW_REMOTE;
  else process.env.RERANK_ALLOW_REMOTE = prev;
});
