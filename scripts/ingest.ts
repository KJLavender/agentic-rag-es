/**
 * 把資料夾裡的文件全部灌進 ES。重跑只會重算有變的片段。
 *   npm run ingest                 # corpus/（Markdown）＋ corpus/files/（PDF、PPTX）
 *   npm run ingest -- some/dir     # 指定資料夾
 * PDF / PPTX 的標題與權限寫在同資料夾的 _meta.json：{ "檔名": { "title": "...", "acl": ["public"] } }，
 * 沒寫的檔案預設只有 admin 看得到。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument, ingestFile, type IngestResult } from "../src/ingest/ingest.js";

// corpus-local/ 是只在本機測試的文件（.gitignore 排除）
const dirs = process.argv[2] ? [process.argv[2]] : ["corpus", "corpus/files", "corpus-local"];
let total = 0;
let files = 0;
const started = Date.now();

const report = (r: IngestResult) =>
  console.log(`${r.docId.padEnd(30)} ${String(r.chunks).padStart(3)} 塊（新算 ${r.embedded}，刪除 ${r.removed}${r.pages ? `，${r.pages} 頁` : ""}）  ${r.title}`);

for (const dir of dirs.filter(existsSync)) {
  const metaPath = join(dir, "_meta.json");
  const meta: Record<string, { title?: string; acl?: string[]; source?: string }> = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  for (const f of readdirSync(dir).sort()) {
    const path = join(dir, f);
    if (!statSync(path).isFile()) continue;
    const ext = f.toLowerCase().split(".").pop();
    try {
      let r: IngestResult;
      if (ext === "md" || ext === "txt") r = await ingestDocument(readFileSync(path, "utf8"), f);
      else if (ext === "pdf" || ext === "pptx" || ext === "docx") {
        const m = meta[f] ?? {};
        r = await ingestFile(readFileSync(path), f, { title: m.title, acl: m.acl ?? ["admin"], source: m.source });
      } else continue;
      total += r.chunks;
      files++;
      report(r);
    } catch (e: any) {
      // ES 的錯誤物件很大，只印關鍵的那句
      console.error(`${f} 失敗：${e?.meta?.body?.error?.reason ?? e?.message}`);
      process.exit(1);
    }
  }
}
console.log(`完成：${files} 份文件、${total} 塊，${((Date.now() - started) / 1000).toFixed(1)}s`);
