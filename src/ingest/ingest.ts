import { config } from "../config.js";
import { embed } from "../embed.js";
import { esClient, type ChunkDoc } from "../es/index.js";
import { chunkMarkdown, contextualText, hash, parseDocument } from "./chunk.js";

export interface IngestResult {
  docId: string;
  title: string;
  chunks: number;
  embedded: number;
  removed: number;
}

/**
 * 一份文件 → 切塊 → embedding → upsert。
 * chunk_id 當 _id，重跑不會重複；內容沒變的片段沿用舊向量；文件變短時刪掉多出來的舊片段。
 */
export async function ingestDocument(raw: string, fileName: string, aclOverride?: string[]): Promise<IngestResult> {
  const es = esClient("ingest");
  const doc = parseDocument(raw, fileName);
  if (aclOverride?.length) doc.acl = aclOverride;
  const chunks = chunkMarkdown(doc.body, doc.title, config.chunkMaxChars, config.chunkOverlap);

  const docs: Omit<ChunkDoc, "embedding">[] = chunks.map((c) => {
    const text = contextualText(doc.title, c.headingPath, c.content);
    return {
      chunk_id: `${doc.docId}#${c.position}`,
      doc_id: doc.docId,
      title: doc.title,
      source: doc.source,
      heading_path: c.headingPath,
      content: c.content,
      position: c.position,
      acl: doc.acl,
      content_hash: hash(text + config.embedModel),
      ingested_at: new Date().toISOString(),
    };
  });

  // 沿用沒變的向量：同一個 chunk_id、同樣的 hash 就不用再算
  const existing = new Map<string, { hash: string; embedding: number[] }>();
  if (docs.length) {
    const prev = await es.mget<ChunkDoc>({
      index: config.esIndex,
      ids: docs.map((d) => d.chunk_id),
      _source_includes: ["content_hash", "embedding"],
    });
    for (const d of prev.docs) {
      if ("found" in d && d.found && d._source) existing.set(d._id, { hash: d._source.content_hash, embedding: d._source.embedding });
    }
  }
  const todo = docs.filter((d) => existing.get(d.chunk_id)?.hash !== d.content_hash);
  const vectors = await embed(todo.map((d) => contextualText(d.title, d.heading_path, d.content)));
  const fresh = new Map(todo.map((d, i) => [d.chunk_id, vectors[i]]));

  if (docs.length) {
    const ops = docs.flatMap((d) => [
      { index: { _index: config.esIndex, _id: d.chunk_id } },
      { ...d, embedding: fresh.get(d.chunk_id) ?? existing.get(d.chunk_id)!.embedding },
    ]);
    const res = await es.bulk({ operations: ops, refresh: "wait_for" });
    if (res.errors) {
      const first = res.items.find((i) => i.index?.error)?.index?.error;
      throw new Error(`bulk 寫入失敗：${JSON.stringify(first)}`);
    }
  }

  const removed = await es.deleteByQuery({
    index: config.esIndex,
    refresh: true,
    query: {
      bool: {
        filter: [{ term: { doc_id: doc.docId } }],
        must_not: [{ terms: { chunk_id: docs.map((d) => d.chunk_id) } }],
      },
    },
  });

  return { docId: doc.docId, title: doc.title, chunks: docs.length, embedded: todo.length, removed: removed.deleted ?? 0 };
}
