import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { embed } from "../embed.js";
import { esClient, type ChunkDoc } from "../es/index.js";
import { chunkMarkdown, contextualText, docIdFrom, hash, parseDocument } from "./chunk.js";
import { chunkPages, type PageChunk } from "./page-chunk.js";
import { officeToPdf } from "./office.js";
import { openPdf, readPdfPages, renderPdfPages } from "./pdf.js";

export interface IngestResult {
  docId: string;
  title: string;
  chunks: number;
  embedded: number;
  removed: number;
  pages?: number;
}

export const FILE_TYPES = ["md", "txt", "pdf", "pptx", "docx"] as const;

type ChunkInput = Omit<ChunkDoc, "embedding" | "content_hash" | "ingested_at" | "chunk_id" | "doc_id" | "title" | "source" | "acl" | "file_type">;

interface DocMeta {
  docId: string;
  title: string;
  source: string;
  acl: string[];
  fileType: string;
}

/**
 * 切好的片段 → embedding → upsert。
 * chunk_id 當 _id，重跑不會重複；內容沒變的片段沿用舊向量；文件變短時刪掉多出來的舊片段。
 */
async function upsert(meta: DocMeta, chunks: ChunkInput[]): Promise<IngestResult> {
  const es = esClient("ingest");
  const docs: Omit<ChunkDoc, "embedding">[] = chunks.map((c) => {
    const text = contextualText(meta.title, c.heading_path, c.content);
    return {
      ...c,
      chunk_id: `${meta.docId}#${c.position}`,
      doc_id: meta.docId,
      title: meta.title,
      source: meta.source,
      acl: meta.acl,
      file_type: meta.fileType,
      content_hash: hash(text + config.embedModel),
      ingested_at: new Date().toISOString(),
    };
  });

  // 沿用沒變的向量：同一個 chunk_id、同樣的 hash 就不用再算
  const existing = new Map<string, { hash: string; embedding: number[] }>();
  if (docs.length) {
    const prev = await es.mget<ChunkDoc>({ index: config.esIndex, ids: docs.map((d) => d.chunk_id), _source_includes: ["content_hash", "embedding"] });
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
    query: { bool: { filter: [{ term: { doc_id: meta.docId } }], must_not: [{ terms: { chunk_id: docs.map((d) => d.chunk_id) } }] } },
  });
  return { docId: meta.docId, title: meta.title, chunks: docs.length, embedded: todo.length, removed: removed.deleted ?? 0 };
}

/** Markdown / 純文字。frontmatter 可以帶 title / source / acl。 */
export async function ingestDocument(raw: string, fileName: string, aclOverride?: string[]): Promise<IngestResult> {
  const doc = parseDocument(raw, fileName);
  if (aclOverride?.length) doc.acl = aclOverride;
  const chunks = chunkMarkdown(doc.body, doc.title, config.chunkMaxChars, config.chunkOverlap);
  return upsert(
    { docId: doc.docId, title: doc.title, source: doc.source, acl: doc.acl, fileType: fileName.toLowerCase().endsWith(".txt") ? "txt" : "md" },
    chunks.map((c) => ({ heading_path: c.headingPath, content: c.content, position: c.position })),
  );
}

export interface FileMeta {
  title?: string;
  acl: string[];
  source?: string;
}

/**
 * PDF / PPTX / DOCX：Office 檔先用 LibreOffice 轉 PDF，再逐頁抽文字（含位置）、渲染每頁截圖。
 * 原檔、轉出的 PDF、每頁截圖存在 DOCS_DIR/<doc_id>/，前端顯示證據截圖時由 backend 檢查權限後提供。
 */
export async function ingestFile(data: Buffer, fileName: string, meta: FileMeta): Promise<IngestResult> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!["pdf", "pptx", "docx"].includes(ext)) throw new Error(`不支援的檔案類型：${ext}`);
  const docId = docIdFrom(fileName);
  const pdf = ext === "pdf" ? data : await officeToPdf(data, ext);
  const doc = await openPdf(new Uint8Array(pdf));
  try {
    const pages = await readPdfPages(doc);
    const title = meta.title || (await doc.getMetadata().catch(() => null))?.info?.["Title" as never] || fileName.replace(/\.[^.]+$/, "");

    const dir = join(config.docsDir, docId);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `original.${ext}`), data);
    writeFileSync(join(dir, "source.pdf"), pdf);
    await renderPdfPages(doc, dir);
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ docId, title, fileName, fileType: ext, pages: pages.length }, null, 2));

    const chunks: PageChunk[] = chunkPages(pages, ext === "pdf" ? "page" : "slide", config.chunkMaxChars);
    const res = await upsert(
      { docId, title: String(title), source: meta.source ?? fileName, acl: meta.acl, fileType: ext },
      chunks.map((c, i) => ({
        heading_path: c.headingPath,
        content: c.content,
        position: i,
        page: c.page,
        layout: { lines: c.lines.map((l) => ({ t: l.text, b: l.box })) },
      })),
    );
    return { ...res, pages: pages.length };
  } finally {
    await doc.loadingTask.destroy();
  }
}

