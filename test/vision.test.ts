import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDescription, dropKnownLines, needsVision } from "../src/ingest/vision.js";

test("needsVision：有點陣圖，或幾乎沒有文字（掃描頁、只有圖表）才看圖", () => {
  assert.equal(needsVision(1, "這一頁有很多可以選取的文字，但也貼了一張截圖，所以還是要看圖。"), true);
  assert.equal(needsVision(0, "3. 巡檢簽核表（掃描）"), true);
  assert.equal(needsVision(0, "這一頁全部都是可以選取的文字內容，有好幾段說明，沒有任何圖片，所以不需要交給看圖模型處理。"), false);
});

test("cleanDescription：模型說 NONE、只有思考標籤或程式碼框時當成沒有內容", () => {
  assert.equal(cleanDescription("NONE"), "");
  assert.equal(cleanDescription(" none。"), "");
  assert.equal(cleanDescription("<think>想一下</think>\nNONE"), "");
  assert.equal(cleanDescription("```\n- es-node-2 91%\n```"), "- es-node-2 91%");
});

test("dropKnownLines：去掉頁面上本來就選得到的字，剩下太短就不建片段", () => {
  const pageText = "Q&A\n雲橋科技 — 測試用虛構文件";
  assert.equal(dropKnownLines("圖片裡\n- Q&A\n- 雲橋科技 — 測試用虛構文件", pageText), "");
  const kept = dropKnownLines("*   ES 節點磁碟使用率\n*   es-node-2 91%\n*   Q&A", pageText);
  assert.equal(kept, "- ES 節點磁碟使用率\n- es-node-2 91%");
});
