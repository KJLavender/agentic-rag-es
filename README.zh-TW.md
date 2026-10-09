<div align="center">

# Agentic RAG on Elasticsearch

[English](README.md) | **繁體中文**

**從頭到尾自己做一遍的全端 RAG：文件切塊與 ingestion、包在唯讀 MCP server 後面的四種檢索模式、
決策層、CRAG 式的檢索迴圈、會附來源的 Pi agent，以及保留驗收組的評測。**

全部在本機執行：Elasticsearch 跑在 Docker，`qwen3.5:4b` 和 `bge-m3` 透過 Ollama 跑在 8 GB 顯示卡上。

![TypeScript](https://img.shields.io/badge/TypeScript-Node%2022-3178C6?logo=typescript&logoColor=white)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-9.5%20Basic-005571?logo=elasticsearch&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-read--only%20retrieval-black)
![Ollama](https://img.shields.io/badge/LLM-Ollama%20%C2%B7%20qwen3.5%3A4b-black)
![Tests](https://img.shields.io/badge/tests-23%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

![聊天畫面](docs/images/chat.png)

</div>

---

## 目錄

- [功能](#功能)
- [架構](#架構)
- [評測](#評測)
- [設計取捨](#設計取捨)
- [安全模型](#安全模型)
- [快速開始](#快速開始)
- [設定](#設定)
- [專案結構](#專案結構)
- [限制](#限制)

## 功能

對一批文件提問（內建語料是我其他公開專案的繁體中文文件）。每個回答都根據檢索到的片段、附上來源；
查不到就說「沒有相關資料」，不會用猜的。

- **四種檢索模式**，查同一個索引：`keyword`（BM25）、`vector`（kNN）、
  `hybrid`（在 TypeScript 裡算加權 RRF）、`cascade`（先嚴格關鍵字，不夠再用向量補）。
- **決策層**擋在 agent 前面：規則 → 領域相似度 → LLM typed decision。範圍外的問題和 prompt injection 根本進不了 agent。
- **CRAG 迴圈由程式控制，不交給模型**：檢索 → 評審「夠不夠回答」→ 換查詢、換沒試過的模式再查 → 生成，或 fail-closed。
- **Pi agent**（`@mariozechner/pi-agent-core`）只有兩個透過 MCP 的唯讀工具，呼叫次數有硬上限。
- **引用查核**：回答裡引用的每個片段 id，都必須是這一輪真的檢索到的；編造的來源會被移除並標 ⚠。
- **文件級權限（ACL）**在 MCP server 的 Elasticsearch 查詢裡強制套用，不靠 LLM 判斷。
- **聊天介面**：串流回答、編號引用、來源卡、過程面板（決策、每一輪檢索、評審結果、工具呼叫）、
  對話紀錄、設定、👍/👎、文件上傳。
- **SQLite** 存使用者、設定、對話、每則訊息的完整 trace、回饋和 MCP 稽核紀錄。

## 架構

```
瀏覽器（React、AI SDK useChat）
   │  UI message stream（SSE）
   ▼
Backend（Fastify）                                    SQLite
 ① 決策層    規則 → 領域相似度 → LLM 分類       ── users / settings / conversations
 ② CRAG 迴圈 檢索 → 評審 → 重查（最多 2 輪）       messages + 完整 trace / feedback
 ③ Pi agent  工具：search、get_document              tool_audit
 ④ 引用查核  引用的 id ⊂ 檢索到的 id
   │  MCP（本機用 stdio；Docker 裡用 Streamable HTTP + Bearer token）
   │  使用者群組放在 request 的 _meta，不在工具參數裡
   ▼
MCP retrieval server（唯讀）                         Ollama（宿主機 GPU）
 search(mode, query, k, rerank) / get_document ───▶ bge-m3 embedding
 每個 ES 查詢都套 ACL filter，寫稽核紀錄，          qwen3.5:4b（16k context 變體）
 選用的 cross-encoder rerank（CPU）
   │  只能讀一個 index 的 API key
   ▼
Elasticsearch 9.5（Basic 授權）
 content：ICU tokenizer + 繁轉簡 filter（BM25）
 embedding：dense_vector 1024 維、cosine（kNN）
 metadata：標題、章節路徑、來源、acl
   ▲
Ingestion：Markdown → 依標題切塊 →「文件 > 章節」前綴 → embedding → upsert
```

## 評測

Golden set（[`eval/golden.json`](eval/golden.json)）有 **48 題**，都是依語料手寫的，分成
**調整組**（開發時看）和**驗收組**（從來不拿來調任何參數），另外有 **14 題陷阱題**：範圍外、
直接 prompt injection、藏在文件裡的 injection、ACL 外洩、領域內但答案不存在、閒聊。

標準答案標的是**證據句子**，不是片段 id：片段內容包含那句話就算相關。所以改了切塊策略，標註也不會默默失效。

### 檢索（驗收組 24 題）

MCP 的 `search` 工具每種模式都可以加 `rerank=true`：第一段先撈 20 個候選，
再用 cross-encoder（`bge-reranker-base`，ONNX、CPU）重新打分，回傳前 k 個。

| 模式 | Hit@1 | Hit@3 | Hit@5 | MRR@10 | 加 rerank：Hit@1 | Hit@5 | MRR@10 |
|---|---|---|---|---|---|---|---|
| keyword（BM25） | 63% | 79% | 88% | 0.732 | 83% | **100%** | **0.910** |
| vector（kNN） | 67% | 83% | 88% | 0.764 | **88%** | 96% | 0.906 |
| hybrid（加權 RRF） | 67% | 83% | 92% | 0.775 | 83% | **100%** | 0.906 |
| cascade | 58% | 83% | 83% | 0.699 | **88%** | 96% | 0.906 |

<sub>只有第一段時每題 17～58 ms，rerank 約多 0.9 秒（20 個候選、CPU）。RTX 3060 Ti 8GB。
調整組上單用 keyword 弱很多（Hit@5 63%）；加了 rerank 之後，兩組的每種模式都在 MRR 0.9 左右。</sub>

#### 選 rerank 模型

`scripts/eval-rerank.ts` 比較不同模型和候選數。小模型在**兩組**都贏，所以在調整組做的選擇到驗收組也成立：

| 驗收組，hybrid 候選 | MRR@10 | Hit@5 | 每題 rerank 時間 |
|---|---|---|---|
| 不 rerank | 0.773 | 92% | — |
| `bge-reranker-v2-m3`（568M、int8），20 個候選 | 0.861 | 96% | 3.4 s |
| `bge-reranker-base`（278M、int8），10 個候選 | 0.885 | 96% | 0.7 s |
| **`bge-reranker-base`（278M、int8），20 個候選** | **0.906** | **100%** | 1.6 s |

<sub>推測但沒驗證：int8 量化對 v2-m3 傷得比較重；它的 fp32 版（2.2GB）在 CPU 上太慢，這裡沒測。
rerank 分數也能當相關性訊號：門檻 0.5 時保留 96% 的標準片段、濾掉 53～68% 的其他片段，
跟 LLM 評審差不多（保留 91～93%、濾掉 65～75%）。</sub>

### 端到端（驗收組）

由 `rag-qwen3.5-4b` 生成，用比生成模型大的 `qwen3.5:9b` 當評審，再人工抽查。
陷阱題用規則判分（禁止字串、是否拒答），不用 LLM。

| 指標（驗收組：24 題 + 7 題陷阱） | 決策層（預設） | 沒有決策層 | + rerank v2-m3（舊） | **+ rerank base（在 MCP 裡）** |
|---|---|---|---|---|
| 正常問題被誤擋 | 0% | — | 0% | 0% |
| 標準片段有進到 context | 88% | 92% | 92% | 92% |
| 答案正確（評審） | 83% | 79% | 79% | **88%** |
| 重點涵蓋率（評審） | 81% | 79% | 83% | **88%** |
| 有無據內容（評審，越低越好） | **13%** | 21% | 21% | **13%** |
| 引用查核通過（程式） | 79% | 83% | **96%** | 88% |
| 陷阱題通過（規則判分） | 6/7 | 6/7 | 5/7 | 6/7 |
| 陷阱題通過（人工複核後） | 6/7 | 7/7 | 6/7 | 7/7 |
| 平均耗時（陷阱題） | 7.0 s（4.7 s） | 4.9 s（7.5 s） | 8.8 s（6.8 s） | 無法比較* |

<sub>原始回答、trace 和評審評語都在 `results/e2e-test-*.json`（不進 git，可以用「快速開始」的指令重跑）。
規則判分會漏認換句話說的正確拒答（「知識庫中無法執行您的請求」「沒有資料顯示…」），人工複核算通過。
「嗨，你好！」在前兩輪有決策層的評測都被當成範圍外擋下；之後加的招呼語規則在最後一輪修好了。
\* 最後一輪評測時，同一張 GPU 上有遊戲在跑：連 rerank 碰不到的階段都變慢了（決策 2.3 → 6.7 秒、生成 2.3 → 5.2 秒），
所以那輪平均 19 秒跟 rerank 無關。品質指標不受影響（temperature 0）。</sub>

### 數據帶來的改變

驗收組只有 24 題，一題大約就是 4 個百分點，所以差距只能看方向，不能當成結論。

- **第一個 rerank 模型只改善了檢索，第二個連答案都變好。** 用 `bge-reranker-v2-m3` 時答案正確率停在 79%。換成兩組都比較準的小模型 `bge-reranker-base`、把 rerank 搬進 MCP server、只查改寫後的問題之後，答案正確率和重點涵蓋率都到 88%。rerank 仍是選用，因為在 CPU 上每輪檢索要多約 1 秒。
- **決策層主要是安全和成本的功能。** 範圍外和 injection 的陷阱題在進 agent 之前就擋下（4.7 秒對 7.5 秒），回答裡的無據內容也比較少（13% 對 21%）。代價是每題多 2 秒左右，而且它改寫查詢後，標準片段進到 context 的比例略低（88% 對 92%）。
- **不加 rerank 時，各模式的差距在雜訊範圍內。** 同樣的第一段程式在驗收組跑兩次，MRR 最多差 0.04（hybrid 0.733 → 0.775、keyword 0.750 → 0.732），可能是重新灌資料後索引 segment 合併改變了 BM25 統計值，加上 embedding 的微小差異。這跟 keyword、vector、hybrid 之間的差距一樣大，所以調整組定的 BM25 權重 0.3 好不好，目前證明不了。加了 rerank 之後各模式都收斂到 MRR 0.91 左右，這比選哪個模式更有說服力。
- **CRAG 評審會把對的片段丟掉。** q34 第一輪就檢索到標準片段，評審判成不相關，結果回答「查不到」。下一步：永遠保留前幾名，或用更大的模型當評審。
- **最大的改進來自看 trace，不是調參數：** 繁體中文斷詞（用 ICU 取代 smartcn）、決策層在看到最相近片段之前會誤擋正常問題、模型只要看到專案名稱就選 `keyword` 模式。

## 設計取捨

| 決定 | 原因 |
|---|---|
| **ICU tokenizer + 繁轉簡 filter**，不用 `smartcn` | `standard` 會把中文逐字切。`smartcn` 只認得簡體——實測繁體一樣逐字切。ICU 繁簡都能斷詞，再加繁轉簡 filter，「资料」和「資料」就是同一個 token。 |
| **在 TypeScript 算 RRF**，不用 ES 的 `rrf` retriever | `rrf` retriever 要 Platinum 授權，Basic 會回 403（實測）。自己算還能看清楚、調得動：調整組上 BM25 權重 0.3 比 1.0 好。 |
| **Pi SDK 內嵌**，不用 ACP 或 Goose | ACP 是操控外部 coding agent，它自帶讀寫檔和終端機；Goose 內建 shell。問答 agent 最安全的做法是根本沒有危險能力：兩個唯讀工具，沒有別的。 |
| **CRAG 迴圈由程式控制** | 4B 模型自己決定流程不穩。模型只做窄的 JSON 任務（分類、改寫、評審），下一步由程式決定，同樣的查詢＋模式不會重查。 |
| **決策層看得到最相近的片段** | 沒有這個提示時，模型把「整天開著電腦跑 japan-trip-bot 電費多少」當成一般知識拒答（信心 0.95）。相似度夠高時，以檢索結果推翻「範圍外」的判斷（「injection」不推翻）。 |
| **門檻用調整組定** | 正常問題跟語料的 cosine 相似度最低 0.61，範圍外最高 0.50，所以門檻設 0.55。 |
| **embedding 前加上章節路徑** | Contextual Retrieval 的便宜版本：每塊前面接「文件 > 章節 > 小節」，不用另外呼叫 LLM。 |
| **SQLite，不用 Redis** | 一台機器、一個 app。Redis 要等到多台 app 共用 session 才划算。 |
| **rerank 放在 MCP server、用小模型** | 任何 MCP client 都能在任一模式加 `rerank=true`。`bge-reranker-base` 在兩組都比 `bge-reranker-v2-m3`（int8）準，時間只要三分之一。開 rerank 時只查改寫後的問題：20 個候選的 Hit@5 已經 100%，每個變體都 rerank 只會讓 CPU 時間加倍。仍是選用（每輪約 1 秒）。 |

## 安全模型

每一層都假設上一層已經被突破。

| 層 | 做法 | 擋什麼 |
|---|---|---|
| 能力 | agent 只有 `search`、`get_document`，都標 `readOnlyHint` | 寫檔、執行指令、上網 |
| 資料 | MCP server 用只能讀單一 index 的 API key（寫入、刪除、讀其他 index 都回 403，實測） | MCP server 被騙去做的任何事 |
| 存取控制 | 每塊都有 `acl`；MCP server 依 `_meta.groups` 加 filter，LLM 看不到也改不了。沒權限和不存在回的結果一樣 | 看到別的團隊的文件 |
| 輸入 | 決策層：規則、領域相似度、typed decision | 拿來做別的事、直接 injection |
| 內容 | 檢索內容包成資料區塊，prompt 明說不是指令；用[陷阱文件](corpus/zz-injection-test.md)測試 | 間接 prompt injection |
| 輸出 | 引用查核 | 編造來源 |
| 程序 | Docker：唯讀檔案系統、非 root、`cap_drop: ALL`、`no-new-privileges`；HTTP 模式的 MCP 要 Bearer token | 爆炸半徑 |
| 稽核 | 每次 MCP 呼叫（誰、查什麼、回了哪些片段）都存進 SQLite | 事後追查 |
| 上傳 | 只有 admin；acl 只能選自己有的群組；上傳檔案裡的 frontmatter `acl` 不採信 | 透過上傳提權 |

## 快速開始

需要：Node.js 22 以上、Docker、[Ollama](https://ollama.com) 和顯示卡（8 GB 就夠）。

```bash
git clone https://github.com/KJLavender/agentic-rag-es.git
cd agentic-rag-es
npm install
cp .env.example .env              # 設定 ELASTIC_PASSWORD 和 MCP_TOKEN

ollama pull qwen3.5:4b && ollama pull bge-m3
npm run setup:model               # 建 16k context 的變體（Ollama 的 OpenAI 介面會忽略 num_ctx）

docker compose up -d              # 裝好 ICU plugin 的 Elasticsearch
npm run es:setup                  # 建索引、發兩把最小權限的 API key → .env.local
npm run ingest                    # corpus/ → 切塊 → embedding → Elasticsearch

npm run build:web && npm start    # http://127.0.0.1:8787
```

其他入口：

```bash
npm run ask -- "AIOps v2 為什麼要把 agent 拆開？"            # 在終端機跑整條流程
npm run ask -- --groups team --rerank "Report Server 上傳 422 怎麼辦？"
npm run mcp                                                  # stdio 的 MCP server（可以接 MCP Inspector）
npm run eval:retrieval -- --split test --rerank
npx tsx scripts/eval-rerank.ts --split test                 # rerank 模型 × 候選數
npm run eval:e2e -- --split test [--no-decision] [--rerank] [--mode hybrid]
npm test
```

全部放進 Docker（Ollama 留在宿主機）：

```bash
docker compose --env-file .env --env-file .env.local --profile app up -d --build
```

介面左下角可以切換身分（`guest` 只看 public、`member` 多了 team、`admin` 還能上傳文件），
用來示範 ACL。這**不是**登入機制，見[限制](#限制)。

## 設定

| 變數 | 預設值 | 說明 |
|---|---|---|
| `ES_URL` | `http://127.0.0.1:9200` | Elasticsearch |
| `ES_INGEST_API_KEY` / `ES_SEARCH_API_KEY` | 由 `npm run es:setup` 產生 | 寫入用（ingestion、上傳）／唯讀（MCP server） |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama |
| `LLM_BASE_MODEL` / `LLM_MODEL` | `qwen3.5:4b` / `rag-qwen3.5-4b` | 原始模型／全部共用的 16k context 變體 |
| `EMBED_MODEL` / `EMBED_DIMS` | `bge-m3` / `1024` | 要跟索引 mapping 一致；換模型要 `es:setup -- --recreate` |
| `CHUNK_MAX_CHARS` / `CHUNK_OVERLAP` | `600` / `80` | 切塊大小、重疊 |
| `HYBRID_KEYWORD_WEIGHT` | `0.3` | hybrid RRF 裡 BM25 的權重（向量是 1） |
| `RERANK_MODEL` / `RERANK_CANDIDATES` | `Xenova/bge-reranker-base` / `20` | cross-encoder 模型、第一段撈幾個候選給它重排 |
| `DOMAIN_MIN_SIMILARITY` / `DOMAIN_STRONG_SIMILARITY` | `0.55` / `0.65` | 低於：範圍外；高於：推翻 LLM 的「範圍外」 |
| `DECISION_MIN_CONFIDENCE` | `0.5` | 低於就請使用者講清楚 |
| `MAX_RETRIEVAL_ROUNDS` | `2` | CRAG 最多再查幾輪 |
| `CONTEXT_K` | `6` | 每輪取幾個片段 |
| `MCP_URL` / `MCP_TOKEN` | 未設定 | 改用 Streamable HTTP，而不是 stdio 子程序 |

## 專案結構

```
src/
  ingest/        切塊（依標題、濾掉垃圾片段、章節前綴）與 upsert
  retrieval/     四種模式、RRF、選用的 cross-encoder rerank
  mcp/           MCP retrieval server（stdio / Streamable HTTP）
  agent/         決策層、評審、CRAG 流程、Pi 生成、引用查核
  db/            SQLite schema
  server/        Fastify API + AI SDK UI message stream
  shared/        跟前端共用的訊息型別
web/             React 介面
scripts/         es:setup、ingest、ask、評測、門檻校準、網頁冒煙測試
eval/golden.json 題目、證據句子、陷阱題
corpus/          內建文件（含一份 prompt injection 陷阱）
docs/plan.md     原始計畫
```

## 限制

- **沒有真正的登入。** 切換身分只是個 cookie，用來示範 ACL。要給別人用之前請放在 SSO 或反向代理後面。
- **4B 模型。** 偶爾會混進簡體字（用 OpenCC 轉回繁體）、過度解讀片段或漏掉重點；過程面板和引用查核讓問題看得見，但擋不住。
- **評測規模小。** 單一語料、驗收組 24 題是方法示範，不是 benchmark。LLM 評審本身也是模型，它的評語都留在 `results/` 供複核。
- **一張 GPU，一次一題。** 其他請求會排隊。
- **Elasticsearch 走 HTTP**，只開在 localhost。對外開放前要開 TLS。
- **Rerank 在 CPU 上跑**，每輪檢索多約 1 秒；第一次使用會下載模型（約 280MB）。

## 授權

MIT
