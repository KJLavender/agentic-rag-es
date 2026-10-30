# 03 RAG Reranker：用 Jev 對檢索結果重新排序

> 這份是要併入你現有 RAG 專案（TypeScript + Elasticsearch + Ollama + MCP，4 種檢索模式）的子計畫。
> 下面的檔名與介面只是建議，請依你專案的實際結構調整。

## 1. 一句話
**檢索先撈多一點，再用 Jev 對每一段打「和問題的相關度」，只把最相關的幾段交給 LLM。**

## 2. 為什麼要加 reranker
- Elasticsearch 的 BM25 和向量檢索看的是「字面或語意像不像」，不是「能不能回答這個問題」
- 塞給 LLM 的段落越少越準，答案越好、token 越省
- 這個判斷剛好是 System 1 的強項：問題和段落都在輸入裡，不需要推論，只要判斷「這段有沒有回答到」

## 3. 放在哪裡
```
查詢 ─▶ 現有 4 種檢索模式 ─▶ 取前 N 段（例如 50）
                                   │
                                   ▼
                    Jev Score：每段和問題的相關度（平行呼叫）
                                   │
                                   ▼
                     依分數重排，取前 K 段（例如 5）─▶ LLM 生成答案
```

## 4. 判斷設計
```yaml
id: rag_relevance
role: ranking
kind: score
question: "這段文件是否包含回答以下問題所需的資訊？問題：{query}"
input: "{chunk}"
fallback: none            # 排序不設硬閾值
fail_mode: keep_original  # Jev 失敗就用原本的檢索排序
```

**可選的進階版**
- 加一個 bool：「這段是否**完全無關**？」用來提早丟掉雜訊
- 低於某個分數就不送給 LLM，就算湊不滿 K 段也一樣。這樣可以減少 LLM 被無關內容誤導

## 5. 介面建議（TypeScript）
```ts
interface Reranker {
  name: string;
  rerank(query: string, chunks: Chunk[], topK: number): Promise<ScoredChunk[]>;
}

// 實作
class NoopReranker      // 原本的排序（baseline）
class JevReranker       // 主角
class CrossEncoderReranker  // 對照：開源 reranker 模型（如 bge-reranker 系列）
class LLMReranker       // 對照：用 LLM 打分
```
- 平行呼叫要設並行上限，避免撞到速率限制
- 用 `(query, chunk_id)` 當 key 做快取，評估時重跑才不會重複花錢
- 在 MCP server 的檢索工具加一個 `rerank` 參數，讓 agent 自己決定要不要重排

## 6. 評估
**資料**：沿用你專案現有的評估集。每題需要標出「哪些段落是相關的」（qrels）。還沒有的話，先挑 50 題人工標註。

**問題分類**（對應 System 1 的限制）
| 類型 | 例子 | 預期 |
|---|---|---|
| 單一事實 | 「退貨期限是幾天？」 | Jev 應該很準 |
| 需要綜合多段 | 「A 方案和 B 方案哪個比較便宜？」 | 單看每一段，都只有一半答案，Jev 可能低估 |
| 換句話說 | 問題的用詞和文件完全不同 | 測語意理解能力 |

**指標**
| 類別 | 指標 |
|---|---|
| 檢索品質 | NDCG@5、NDCG@10、Recall@K、MRR |
| 最終答案 | 沿用現有的答案品質評估 |
| 成本 | 每次查詢的重排延遲（p50／p95）、成本；LLM 輸入 token 減少多少 |

**對照組**
| 組別 | 說明 |
|---|---|
| A | 不重排（各檢索模式原本的排序） |
| B | 開源 cross-encoder reranker |
| C | LLM 打分 |
| D | Jev 打分 |
| E | 不同 N（20／50／100）對品質和延遲的影響 |

**要回答的問題**：Jev 能不能用比 LLM 低很多的成本，做到接近 cross-encoder 或 LLM 的排序品質？在「需要綜合多段」的問題上會不會明顯變差？

## 7. 時程（2 週）
| 週 | 目標 | 完成標準 |
|---|---|---|
| 1 | 實作與資料 | Reranker 介面與 4 個實作；qrels 標註完成；快取 |
| 2 | 評估 | 對照組 A～E 跑完；依問題類型拆開分析；接進 MCP 工具；更新 README |

## 8. 風險
| 風險 | 對策 |
|---|---|
| N=50 時平行呼叫延遲太高 | 調整 N；先用 bool 快速丟掉明顯無關的段落，再打分 |
| 段落太長，超過輸入上限 | 沿用專案的切段設定；必要時只送段落前段 |
| 綜合型問題變差 | 依問題類型決定是否重排，或對這類問題保留較多段落 |

---

## 9. 實作狀態與調整（2026-10-29）

**和原計畫不同的地方**
- **Jev 換成開源的 decision model**：llama.cpp 在 2026-10-02 加了 `/v1/systemone`，格式跟 Jev 一樣，可以在本機跑 Julia-1、Laya、Kev。同一個 `systemOne()` 後端改網址就能接 Jev 雲端版；但不在本機的位址要設 `RERANK_ALLOW_REMOTE=1` 才能用，因為會把文件片段送出去（`corpus-local/` 的真實文件有個資）。
- **用 `noul`（P(yes)）打分，不用 `score`**：`score` 是給有順序的等級用的。問法有三種（`pair`／`doc`／`choice`），在調整組上選。
- **多了一組 Qwen3-Reranker-0.6B**：專門用檢索資料訓練的開源 reranker，判斷方式（yes/no 機率）跟 decision model 一樣，拿來分辨「是模型大小的問題，還是模型用途的問題」。
- **qrels 不另外標**：沿用 golden set 的證據句自動對到片段；只人工補了題型（`type`：fact／multi／paraphrase）。
- **快取 key 用片段內容雜湊，不用 chunk_id**：重新切塊後 id 會位移。
- **後端失敗就退回原本排序**（`fail_mode: keep_original`），MCP 稽核紀錄會標 `rerank_failed`。

**結果（調整組 + 驗收組共 48 題，hybrid 前 20 個候選；詳見 README）**

| 組別 | MRR | 跟 bge 比（95% CI） | 每題 |
|---|---|---|---|
| A 不重排 | 0.707 | −0.171（顯著） | — |
| B cross-encoder（bge-reranker-base） | **0.878** | — | 0.8 秒（CPU） |
| B' Qwen3-Reranker-0.6B | 0.788 | −0.090（顯著） | 14.6 秒（CPU） |
| C 本機 LLM（qwen3.5:4b） | 0.830 | −0.048（不顯著） | 10.7 秒（GPU） |
| D Kev-4B | 0.840 | −0.037（不顯著） | 1.9 秒（GPU） |
| D Julia-1／Laya | 0.16／0.24 | 差很多 | — |
| E bge、50 個候選 | 0.899 | 比 20 個 +0.021（雜訊範圍） | 2.0 秒 |

**回答計畫第 6 節的問題**
- 「decision model 能不能用很低的成本做到接近 cross-encoder 的排序品質？」：**Kev-4B 可以打平，但不更便宜**。它要 GPU、比 bge 慢一倍；在調整組領先、驗收組落後，平均下來跟 bge 差不多。小的 Julia-1、Laya 不行：Laya 對幾乎每段真實片段都給 0.6～0.9，Julia-1 換個問法排名就反過來。Jev 雲端版沒測（需要付費 key、會把資料送出去）。
- 「綜合多段的問題會不會變差」：沒有變差。bge 在綜合多段的題目上 0.698 → 0.844；Kev 0.938（8 題，樣本很小）。
- 「不同 N」：50 個候選只多 0.02 MRR、時間 2.4 倍，維持 20。

**決定**：預設維持 bge-reranker-base、20 個候選。其他後端都留著可以用環境變數切換。

**下一步**
- decision model 比較適合的位置可能是決策層的分類器（範圍內／外、意圖），另做實驗。
- rerank 最高分分得出有答案／沒答案（AUROC 0.98～1.00），但只有 6 題沒答案的題目；要設門檻之前得先多標一些。
