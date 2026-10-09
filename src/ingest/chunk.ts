import { createHash } from "node:crypto";

export interface ParsedDoc {
  docId: string;
  title: string;
  source: string;
  acl: string[];
  body: string;
}

export interface Chunk {
  headingPath: string;
  content: string;
  position: number;
}

/** 讀 frontmatter（title / source / acl）。 */
export function parseDocument(raw: string, fileName: string): ParsedDoc {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};
  let body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = text.slice(fm[0].length);
  }
  // 雙語 README 的語言切換列，對檢索沒有用
  body = body.replace(/^\[English\]\(README\.md\)\s*\|.*$/gm, "");
  const docId = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "");
  const h1 = body.match(/^# (.+)$/m)?.[1].trim();
  return {
    docId,
    title: meta.title || h1 || fileName,
    source: meta.source || fileName,
    // 沒標 acl 就當成私有（只有 admin 群組看得到），寧可查不到也不要外洩
    acl: (meta.acl || "admin").split(",").map((s) => s.trim()).filter(Boolean),
    body,
  };
}

interface Section {
  headings: string[];
  lines: string[];
}

/** 按 Markdown 標題切段；code fence 裡的 # 不算標題。 */
function sections(body: string, title: string): Section[] {
  const out: Section[] = [];
  let stack: string[] = [];
  let cur: Section = { headings: [], lines: [] };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      out.push(cur);
      const level = h[1].length;
      stack = stack.slice(0, level - 1);
      stack[level - 1] = h[2];
      // H1 通常就是文件標題，前綴已經有了，不重複
      cur = { headings: stack.filter((s, i) => s && !(i === 0 && s === title)), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  out.push(cur);
  return out;
}

/** 段落區塊：空行分隔，但 code fence 和表格整塊不拆。 */
function blocks(lines: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (buf.length) out.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}

function hardSplit(text: string, max: number, overlap: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max - overlap) {
    out.push(text.slice(i, i + max));
    if (i + max >= text.length) break;
  }
  return out;
}

/** 去掉圖片、HTML、連結網址之後還剩多少字：只有徽章、截圖、<div> 的片段不值得索引。 */
export function meaningfulLength(text: string): number {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[^\p{L}\p{N}]/gu, "").length;
}

const SKIP_HEADINGS = /^(目錄|table of contents|contents)$/i;

export function chunkMarkdown(body: string, title: string, maxChars = 600, overlap = 80): Chunk[] {
  const chunks: Chunk[] = [];
  for (const sec of sections(body, title)) {
    if (SKIP_HEADINGS.test(sec.headings.at(-1) ?? "")) continue;
    const headingPath = sec.headings.join(" > ");
    const parts: string[] = [];
    let buf = "";
    for (const b of blocks(sec.lines)) {
      if (b.length > maxChars) {
        if (buf) parts.push(buf);
        buf = "";
        parts.push(...hardSplit(b, maxChars, overlap));
        continue;
      }
      if (buf && buf.length + b.length + 2 > maxChars) {
        parts.push(buf);
        // 重疊：下一塊開頭帶上一塊的尾巴，避免一句話被切在兩塊中間就找不到
        const tail = buf.slice(-overlap);
        buf = tail.length < b.length ? `${tail}\n\n${b}` : b;
      } else {
        buf = buf ? `${buf}\n\n${b}` : b;
      }
    }
    if (buf) parts.push(buf);
    for (const content of parts) {
      if (meaningfulLength(content) < 15) continue; // 只有分隔線、徽章、圖片、HTML 的段落
      chunks.push({ headingPath, content: content.trim(), position: chunks.length });
    }
  }
  return chunks;
}

/** Contextual Retrieval 的簡化版：把「文件 > 章節」接在片段前面再 embedding，不用另外呼叫 LLM。 */
export function contextualText(title: string, headingPath: string, content: string): string {
  return `${[title, headingPath].filter(Boolean).join(" > ")}\n${content}`;
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
