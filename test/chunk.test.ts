import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown, contextualText, meaningfulLength, parseDocument } from "../src/ingest/chunk.js";

test("frontmatter：title / source / acl", () => {
  const d = parseDocument("---\ntitle: 測試\nsource: https://x\nacl: public, team\n---\n\n# 標題\n內容", "My Doc.md");
  assert.equal(d.docId, "my-doc");
  assert.equal(d.title, "測試");
  assert.deepEqual(d.acl, ["public", "team"]);
});

test("沒標 acl 的文件預設只有 admin 看得到", () => {
  assert.deepEqual(parseDocument("# x\n內容", "a.md").acl, ["admin"]);
});

test("移除雙語 README 的語言切換列", () => {
  const d = parseDocument("# T\n\n[English](README.md) | **繁體中文**\n\n本文", "a.md");
  assert.ok(!d.body.includes("English"));
});

test("按標題切，heading path 不重複 H1 標題", () => {
  const body = "# 專案\n\n這個專案的開頭介紹文字，說明它是做什麼的\n\n## 安裝\n\n執行 npm install 安裝相依套件\n\n### Docker\n\n用 docker compose up 啟動服務";
  const chunks = chunkMarkdown(body, "專案");
  assert.deepEqual(
    chunks.map((c) => c.headingPath),
    ["", "安裝", "安裝 > Docker"],
  );
});

test("code fence 裡的 # 不算標題", () => {
  const body = "## 指令\n\n```bash\n# 這是註解不是標題\nnpm run build\n```\n";
  const chunks = chunkMarkdown(body, "T");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].headingPath, "指令");
  assert.ok(chunks[0].content.includes("# 這是註解"));
});

test("長段落切塊不超過上限，相鄰塊有重疊", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `第${i}段`.padEnd(100, "字"));
  const chunks = chunkMarkdown(`## 長\n\n${paras.join("\n\n")}`, "T", 300, 40);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.content.length <= 300 + 40 + 2, `太長：${c.content.length}`);
  assert.ok(chunks[1].content.startsWith(chunks[0].content.slice(-40).trim().slice(0, 10)));
});

test("只有徽章、圖片、HTML 的片段不索引；目錄章節略過", () => {
  const body = "<div align=\"center\">\n\n![badge](https://img.shields.io/x)\n\n</div>\n\n## 目錄\n\n- [安裝](#安裝)\n- [設定](#設定)\n\n## 安裝\n\n執行 npm install 安裝相依套件";
  const chunks = chunkMarkdown(body, "T");
  assert.deepEqual(chunks.map((c) => c.headingPath), ["安裝"]);
  assert.equal(meaningfulLength("![a](b) <img src=x>"), 0);
  assert.equal(meaningfulLength("[安裝](#安裝) 說明"), 4);
});

test("contextual 前綴：文件 > 章節", () => {
  assert.equal(contextualText("文件", "安裝 > Docker", "內容"), "文件 > 安裝 > Docker\n內容");
  assert.equal(contextualText("文件", "", "內容"), "文件\n內容");
});
