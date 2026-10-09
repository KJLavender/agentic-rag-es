/** 把 corpus/（或指定資料夾）的 .md / .txt 全部灌進 ES。重跑只會重算有變的片段。 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument } from "../src/ingest/ingest.js";

const dir = process.argv[2] ?? "corpus";
const files = readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f)).sort();
let total = 0;
const started = Date.now();
for (const f of files) {
  const r = await ingestDocument(readFileSync(join(dir, f), "utf8"), f).catch((e) => {
    // ES 的錯誤物件很大，只印關鍵的那句
    const reason = e?.meta?.body?.error?.reason ?? e?.message;
    console.error(`${f} 失敗：${reason}`);
    process.exit(1);
  });
  total += r.chunks;
  console.log(`${r.docId.padEnd(28)} ${String(r.chunks).padStart(3)} 塊（新算 ${r.embedded}，刪除 ${r.removed}）  ${r.title}`);
}
console.log(`完成：${files.length} 份文件、${total} 塊，${((Date.now() - started) / 1000).toFixed(1)}s`);
