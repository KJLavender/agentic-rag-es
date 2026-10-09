---
title: 🗾 japan-trip-bot：日本旅遊群組小幫手
source: https://github.com/KJLavender/japan-trip-bot/blob/main/README.zh-TW.md
acl: public
---

# 🗾 japan-trip-bot：日本旅遊群組小幫手

[English](README.md) | **繁體中文**

一個住在 LINE 旅遊群組裡的 bot。出發前把它拉進群組，旅途中可以用它分帳、查救急日文、記行程，也能拍照解說菜單、藥品和告示。

- 🧠 使用 [Pi agent](https://github.com/badlogic/pi-mono)（`@mariozechner/pi-agent-core`），搭配本地 [Ollama](https://ollama.com) 模型，不需要付費的 AI API
- 🧮 **事實交給程式，AI 只負責理解和解說**：算錢、過敏原、酒精、藥品用法都由程式判斷，不讓小模型猜
- 🔒 預設全部在本機（Ollama + 本機 OCR）；想要更準可以改用 Gemini，要送出哪些資料由設定決定，見「資安設計」

[![CI](https://github.com/KJLavender/japan-trip-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/KJLavender/japan-trip-bot/actions/workflows/ci.yml)


---

## ✨ 功能

### 1. 💴 日圓分帳與即時匯率（核心功能）

用平常說話的方式記帳，旅程結束時一鍵結算，算出最少的轉帳次數。

```
小明：@小幫手 一蘭 ¥5,200 我付，四人分
小幫手：已記帳 #1：一蘭 ¥5,200（≈ NT$1,053），小明付，四人平分，每人約 ¥1,300（≈ NT$263）

小華：@小幫手 唐吉訶德 3,300 日圓，我跟阿凱分
阿珍：@小幫手 結算
小幫手：💴 結算（共 3 筆，總計 ¥26,500 ≈ NT$5,368）
        阿凱 → 阿珍：¥7,450 ≈ NT$1,509
        小華 → 阿珍：¥4,150 ≈ NT$841
        小明 → 阿珍：¥600 ≈ NT$122
```

- 常見說法（金額、誰付、怎麼分都講清楚）**由程式直接解析**，不經過 AI，又快又不會記錯；說法比較口語的（例如「一萬八」「跟小華對分」）才交給 AI
- 「我」會自動對應到發話者，也支援「我跟小華分」這種指定分攤者的說法
- AI 如果回答「已記帳」卻沒有真的記下來，bot 會攔下來並請你換個說法，不會讓你誤以為記好了
- 有人改 LINE 名稱也不會影響帳目（內部用 LINE userId 對應）
- 可以記台幣花費（例如機票），會依當下匯率換算成日圓入帳
- 匯率來自 [open.er-api.com](https://open.er-api.com)（免費、不需要 API key），快取 1 小時
- 分攤金額以整數日圓計算，餘數分給前幾位，總額不會差 1 円

### 2. 🗣 救急日文

```
@小幫手 怎麼說「可以刷卡嗎」

🇯🇵 カードは使えますか？
🔤 カードは つかえますか？
🗣 Kādo wa tsukaemasu ka?
💬 可以刷卡嗎？
```

- 內建 46 句**人工校對**的旅遊常用句，涵蓋付款、餐廳、交通、住宿與緊急狀況。命中句庫就直接回覆，不經過 AI
- 句庫沒有的句子才交給 AI 翻譯，並自動附上「⚠️ AI 翻譯，可能不準確」的提醒

### 3. 📒 行程記事

```
@小幫手 記一下：明天 9:00 新宿站南口集合，飯店 APA 新宿歌舞伎町，訂房代號 HX4821
@小幫手 明天幾點在哪裡集合？
小幫手：根據 #1：明天 9 點在新宿站南口集合！
```

- 群組共用的記事本，每個群組各自獨立
- 問行程問題時，bot 會根據記事回答並標出來源；記事裡沒有的資訊，會直接說沒有，不會亂編

### 4. 📷 拍照解說：不只翻譯，還告訴你是什麼

翻譯 App 會把「期間限定」翻成「期間限定」，把「お通し」翻成「小菜」；你看得懂字，卻不知道這代表「季節商品賣完就沒了」、「這碟小菜要收錢」。這個 bot 做的是**解說**：

```
🍽 菜單
⚠️ 過敏原：蝦（海老）
⚠️ 通常也含：小麥（天ぷら）、蛋（天ぷら）
🍺 含酒精：ビール、サワー、梅酒

生ビール 580円（≈ NT$117）→ 生啤酒
海老天ぷら 1,200円（≈ NT$243）→ 蝦天婦羅，裹粉油炸
...
```

處理流程：

```
照片 → OCR（本機 PP-OCRv5，可讀直書）→ 分類（菜單／藥品／告示／神社／商品）
     → 程式偵測安全資訊 + 查旅遊知識庫 → 依類型套用專用 prompt → AI 整理成解說
```

- **安全資訊由程式偵測，不靠 AI**：日本法定的 8 項過敏原（蝦、蟹、小麥、蕎麥、蛋、乳、花生、核桃）、料理「通常會含」的過敏原、酒精（會排除無酒精飲品）、生食、藥品分類、用法用量、嗜睡／年齡／哺乳等警語
- **三層字典**：① 人工校對的旅遊知識庫 → ② [Wikidata](https://www.wikidata.org) 匯入的約 5,000 項料理、飲料、魚類（CC0，`npm run build:dict` 重新產生）→ ③ 都查不到的詞才問 Gemini（選用，見下方）
- **人工整理的旅遊知識庫**：菜單用語（お通し、替え玉、食券…）、車站告示（運転見合わせ、振替輸送…）、約 60 種料理、神社籤詩與御守
- 藥品會特別提醒容易誤會的地方，例如「食間」是兩餐之間，不是吃飯時
- AI 離線時，仍會回覆程式辨識出的安全資訊和用語解釋

**怎麼用**：在群組傳照片後 `@小幫手`，問什麼都可以（「這啥」「可以吃嗎」「這藥是啥」）；兩分鐘內傳的照片會自動對應。也可以回覆（引用）較早的照片再 @小幫手。一對一聊天直接傳照片就好。

---

## 📋 指令一覽

在群組裡，訊息要 **@小幫手** 或以「小幫手」開頭，bot 才會回應；一對一聊天則不需要。

| 指令 | 說明 | 經過 AI? |
|---|---|---|
| `一蘭 ¥5,200 我付，四人分` | 記帳（句型明確時由程式解析） | 有時 |
| `成員 小明 小華 阿珍 阿凱` | 登記旅伴（「四人分」時會用到） | ❌ |
| `帳目` | 列出所有帳目 | ❌ |
| `結算` | 算出誰該轉給誰 | ❌ |
| `刪除 #3` | 刪除記錯的帳 | ❌ |
| `匯率`／`匯率 3000` | 日圓台幣換算 | ❌ |
| `怎麼說「可以刷卡嗎」` | 救急日文（命中句庫時不經 AI） | 有時 |
| `記一下：飯店是 xxx` | 新增記事 | ❌ |
| `記事`／`刪除記事 #2` | 列出或刪除記事 | ❌ |
| `明天幾點集合？` | 根據記事回答行程問題 | ✅ |
| 傳照片後 `@小幫手 這啥` | 拍照解說（安全資訊由程式判斷） | ✅ |
| `新旅程` | 封存本趟的帳目、記事和對話，重新開始 | ❌ |
| `說明` | 顯示指令列表 | ❌ |

不經過 AI 的指令會在 1 秒內回覆。

---

## 🚀 安裝與啟動

### 需要準備

- [Node.js](https://nodejs.org) 20 以上
- [Ollama](https://ollama.com)
- [Python](https://www.python.org) 3.10 以上（拍照解說用的 OCR；不想裝的話可以用 Docker，見「部署」）
- 一個 [LINE Developers](https://developers.line.biz) 帳號
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)（讓 LINE 連到你家的電腦）

### 步驟 1：下載專案並安裝

```bash
git clone https://github.com/KJLavender/japan-trip-bot.git
cd japan-trip-bot
npm install
```

### 步驟 2：下載模型

```bash
ollama pull qwen3.5:4b
npm run setup:model      # 建立 context 16k 的 japan-trip-bot 模型變體
```

> 為什麼要 `setup:model`？Ollama 的 OpenAI 相容介面會忽略 context 設定，預設只有 4096 token，對話一長 system prompt（規則和記事）就會被默默截掉。bot 啟動時會檢查，沒設定好會警告。想換模型請先看「🧪 模型選擇（實測）」。

### 步驟 2.5：啟動 OCR（拍照解說用）

```bash
python -m venv ocr/.venv
ocr/.venv/bin/pip install -r ocr/requirements.txt        # Windows：ocr\.venv\Scripts\pip ...
ocr/.venv/bin/python ocr/server.py                        # 另外開一個終端機，第一次會下載約 20 MB 的模型
```

OCR 只監聽 `127.0.0.1:8001`，用 CPU 跑，一張照片約 0.2 秒。沒有啟動 OCR 的話，照片會改由視覺模型直接看圖，速度較慢、也比較不準。

先不打開 LINE，在本機試玩看看（可以順便確認 Ollama 正常）：

```bash
npm run chat -- 小明
> 成員 小明 小華 阿珍 阿凱
> 一蘭 ¥5,200 我付，四人分
> 結算
```

### 步驟 3：建立 LINE Messaging API channel

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立一個 Provider，再建立 **Messaging API** channel
2. 在 **Basic settings** 複製 **Channel secret**
3. 在 **Messaging API** 分頁最下方發行 **Channel access token (long-lived)**
4. 到 [LINE Official Account Manager](https://manager.line.biz/) 調整回應設定：
   - **Allow bot to join group chats**：打開
   - **Auto-reply messages**：關閉
   - **Webhooks**：打開

### 步驟 4：設定 `.env`

```bash
cp .env.example .env
```

填入剛才取得的兩個值：

```ini
LINE_CHANNEL_SECRET=你的 channel secret
LINE_CHANNEL_ACCESS_TOKEN=你的 access token
```

> ⚠️ `.env` 已經被 `.gitignore` 排除，**不要把它 commit 或貼到任何地方**。

### 步驟 5：啟動 bot 並開通外部連線

```bash
npm start                                         # 或 npm run dev（修改程式時會自動重啟）
cloudflared tunnel --url http://localhost:3000    # 另外開一個終端機
```

cloudflared 會給你一個 `https://xxxx.trycloudflare.com` 網址。到 LINE Developers 的 **Messaging API → Webhook URL** 填入：

```
https://xxxx.trycloudflare.com/webhook
```

按 **Verify** 看到 Success 後，打開 **Use webhook**。

> 💡 quick tunnel 的網址每次重啟都會改變。長期使用的話，建議設定 [Cloudflare named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) 搭配固定網域。

### 步驟 6：把 bot 拉進旅遊群組

用 LINE 加 bot 好友（LINE Developers 頁面上有 QR code），再邀請它進群組，輸入 `@小幫手 說明` 試試看。

---

## ⚙️ 設定

所有設定都在 `.env`，完整列表請看 [`.env.example`](.env.example)。

| 變數 | 預設值 | 說明 |
|---|---|---|
| `OLLAMA_BASE_MODEL` | `qwen3.5:4b` | 基底模型 |
| `OLLAMA_MODEL` | `japan-trip-bot` | bot 實際呼叫的模型（由 `setup:model` 建立） |
| `OLLAMA_NUM_CTX` | `16384` | context 長度 |
| `LLM_TIMEOUT_SECONDS` | `90` | AI 回應逾時 |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama 的 OpenAI 相容端點 |
| `BOT_NAME` | `小幫手` | bot 的名字（判斷有沒有被叫到時會用） |
| `LLM_PROVIDER` | `ollama` | 聊天大腦：`ollama`（全部在本機）或 `gemini`（聊天內容送 Google，本機 Ollama 自動備援）；照片一律在本機處理 |
| `PHOTO_USE_CLOUD` | `false` | `true` = 照片也交給 Gemini 解說（照片會送到 Google；失敗時改用本機） |
| `GEMINI_CHAT_MODEL` | `gemini-3.1-flash-lite` | `LLM_PROVIDER=gemini` 時用的模型（見「聊天大腦比較」）。免費方案的 gemini-3.5-flash 實測每天只有 20 次 |
| `GEMINI_API_KEY` | （空） | 選用：字典查不到的詞改問 Gemini；留空就關閉 |
| `GEMINI_DAILY_LIMIT` | `300` | Gemini 每天最多呼叫次數 |
| `OCR_URL` | `http://127.0.0.1:8001` | OCR 服務位址；留空就不使用 OCR |
| `VISION_ENABLED` | `true` | OCR 讀不到字時，是否改用視覺模型看圖（模型不支援時會自動關閉） |
| `IMAGE_WINDOW_MINUTES` | `15` | 群組照片在幾分鐘內可以被解說 |
| `ALLOW_PUSH_FALLBACK` | `false` | 回覆太慢導致 reply token 過期時，是否改用 push 補送（會用到免費推播額度） |
| `DATA_DIR` | `data` | 資料存放位置 |

想修改 bot 的個性或規則，直接編輯 [`AGENTS.md`](AGENTS.md)（它就是 system prompt），每則訊息都會重新讀取，不需要重啟。

---

## 🧪 模型選擇（實測）

不同模型的差異很大，**新模型不一定比較好**。下表是用 `npm run eval` 實測的結果。測試題目是這個 bot 的實際任務，不是一般的考試題：

- **記帳**：只有規則解析器處理不了的口語說法（例如「一萬八」「跟小華對分」「X 請大家」），所以考的是模型本身
- **記事問答**：從記事找出日期、代號、時間；記事裡沒有的資訊要說沒有；記事裡夾帶的提示詞注入不能照做
- **照片解說**：給 OCR 文字，檢查解說內容（不含程式產生的安全資訊）

測試日期：2026-10-02｜RTX 3060 Ti 8GB｜每個模型跑 3 次取平均｜context 16k

| 模型 | 記帳 | 記事問答 | 照片解說 | 總分 | 平均回應 | 評價 |
|---|---|---|---|---|---|---|
| **qwen3.5:4b**（預設） | 93% | 100% | 100% | **97%** | 1.5s | ⭐⭐⭐⭐ 推薦。支援看圖，VRAM 約 3.6 GB |
| qwen3:4b | 87% | 50% | 100% | 79% | 14.9s | ⭐⭐ 會把思考過程寫進回覆，而且常逾時 |
| qwen2.5:7b | 27% | 92% | 75% | 62% | 2.6s | ⭐⭐ 會把工具呼叫寫成文字，幾乎無法口語記帳 |
| llama3.2:1b | 13% | 33% | 8% | 18% | 1.0s | ⭐ 不建議 |

- 要注意的是，表格裡「記帳」只測口語說法。實際使用時，明確的說法（「燒肉 18000 円 阿凱付，大家分」）由程式處理，任何模型都是 100%
- 題目數量不多（13 題 × 3 次），只能當作參考。有更大的顯示卡的話，歡迎用 `npm run eval -- <模型>` 測試並分享結果
- 換模型的方法：在 `.env` 設定 `OLLAMA_BASE_MODEL=<模型>`，再執行 `npm run setup:model`

### 聊天大腦比較（`npm run eval:models`，測資來自網路）

測資用 `npm run fetch:eval-data` 從網路下載並放在 `test/data/`：[Tatoeba](https://tatoeba.org) 的中日旅遊例句（CC BY 2.0 FR，58 句，含多種人工翻譯）、[Wikidata](https://www.wikidata.org) 的日本景點資料（CC0，所在縣市 12 題、建築高度 8 題；有爭議的創建年份刻意不出題）。評測時關閉自動備援，模型失敗就算錯。

測試日期：2026-10-03｜每個模型跑 1 次

| 模型 | 記帳 | 記事問答 | 日文翻譯（chrF） | 景點知識 答對／**亂編**／不知道 | 照片解說* | 平均回應 |
|---|---|---|---|---|---|---|
| qwen3.5:4b（本機） | 60% | 100% | 40 | 11／**9**／0 | 63% | 4.5s |
| gemini-3.5-flash-lite | 100% | 100% | 43 | 13／**7**／0 | 44% | 2.8s |
| **gemini-3.1-flash-lite**（目前使用） | **100%** | **100%** | **60** | **20／0／0** | **88%** | 4.9s |
| gemma-4-26b | 100% | 75% | 37 | 13／**7**／0 | 44% | 4.5s |
| gemma-4-31b | 60% | 100% | 41 | 11／**9**／0 | 69% | 3.8s |

*照片解說：雲端模型的分數是讓它們看照片量到的。正式 bot 預設照片只在本機處理；設定 `PHOTO_USE_CLOUD=true` 才會讓 Gemini 看照片。

- 景點知識的差距最大：qwen 說靖國神社在北海道、首里城在島根縣；3.1 Flash Lite 20 題全對、沒有亂編
- 較新的 3.5 Flash Lite 反而比 3.1 差，**換模型前一定要實測**
- 知識題的分數經過人工複核（評分程式原本把「203.65 公尺」讀成 65，已修正）

### 真實照片評測（`npm run eval:photos`）

用 9 張網路上 CC 授權的真實照片（手寫菜單、反光菜單、直書招牌、壽司點餐單、食券機、藥妝店、車站停駛告示、兩張沒有文字的照片）測試拍照解說。照片不放進 repo，評測時才從原始出處下載（出處與授權見 [`test/photo-cases.json`](test/photo-cases.json)）。

照片分成兩組：**調整組**（9 張，開發時一邊看一邊修辭典和 prompt）和**驗收組**（7 張，從來不拿來調整）。**驗收組的分數才是真實水準。**

測試日期：2026-10-03｜RTX 3060 Ti 8GB｜每張照片跑 3 次

| 做法 | 驗收組正確率 | 平均時間 | 結論 |
|---|---|---|---|
| **目前的做法**：OCR + 程式判斷安全資訊 + 三層字典（手寫 → Wikidata → Gemini）+ qwen3.5:4b 同時看照片，照片解說使用專用 prompt、不帶入聊天紀錄 | **57%** | **3.2s** | ✅ 採用 |
| 同上，但帶入聊天紀錄 | 67～71% | 21～25s | ❌ 太慢；而且分數是灌水的（同一張照片重複作答時，模型看得到自己前一次的答案） |
| 早期版本：OCR + qwen3.5:4b 只看文字，共用聊天的 system prompt | 39%（調整組） | — | 聊天規則干擾照片解說，例如把壽司店說成「一蘭拉麵」 |
| qwen3.5:4b 直接看圖（不用 OCR） | 56%（調整組） | — | 安全資訊沒辦法由程式把關 |
| gemma3:4b 直接看圖 | 6%（調整組） | — | 會編造內容（把羽田空港說成「天國寺機場」） |
| qwen2.5vl:7b、qwen3-vl:8b | — | >3 分鐘 | 8GB 顯示卡實際只剩約 5.5GB 可用，模型放不下，一部分得用 CPU 跑 |

Gemini 字典備援在同條件下讓驗收組從 67% 提升到 71%（帶入聊天紀錄的設定），幫助有限但有效。

學到的事：

- **OCR 的信心分數不可靠**：直書和手寫字常常「很有信心地讀錯」，所以不能用信心分數決定要不要看圖，現在一律讓模型同時看照片
- **安全資訊仍然只由程式從 OCR 文字判斷**；模型看圖可能會編造照片上沒有的字
- **模型會編造價格**：沒有標價的招牌也寫出「580円」。現在只要回覆裡的價格在 OCR 文字中找不到，就會附上警語
- **模型會無視長度限制**：prompt 寫「最多 12 行」，實際寫 18～72 行。現在由程式限制輸出長度
- **照片解說不需要聊天紀錄**：帶入紀錄會讓 prompt 膨脹到上萬 token，回覆從 3 秒拖到 20 秒以上
- 驗收組常錯的例子：把「鯛焼」（鯛魚燒）讀成「鰻焼」、把「活平目」（比目魚）說成鯛魚，這些是 4b 模型的能力上限

---

## 🏗 架構

設計原則：**能用規則處理的就不交給 AI**。AI 只負責「理解口語」和「把查證過的事實講成白話」。

```
文字 ─▶ handler：固定指令 / 記帳規則解析 / 日文句庫 ──命中──▶ 直接回覆（不經 AI）
              │ 沒命中
              ▼
        agent（Pi Agent + Ollama）──▶ 工具（記帳、記事…），工具結果就是最終回覆
              │
              ▼
        防呆：沒呼叫工具卻說「已記帳」→ 攔下；台幣金額由程式重算；移除 Markdown

照片 ─▶ OCR（ocr/server.py）─▶ 分類 ─▶ 程式偵測過敏原/酒精/藥品 + 查知識庫 ─▶ 專用 prompt ─▶ agent
```

| 檔案 | 用途 |
|---|---|
| `src/index.ts` | LINE webhook：簽章驗證、@mention 判斷、加入/離開群組、照片對應 |
| `src/handler.ts` | 固定指令的 fast path、發話者對應（含改名追蹤） |
| `src/expense-parser.ts` | 記帳句子的規則解析器（說法不明確時交給 AI） |
| `src/agent.ts` | 每個群組一個 Pi Agent session；記事注入、逾時、防呆與回覆後處理 |
| `src/tools.ts` | Agent 工具：`add_expense`、`settle_up`、`fx_rate`、`japanese_phrase`、`memo_add` 等 |
| `src/photo.ts` | 拍照解說：照片對應、分類、組合安全資訊與知識庫、專用 prompt |
| `src/knowledge/` | 人工整理的知識庫：`safety.ts`（過敏原、酒精、藥品）、`glossary.ts`（用語、料理、神社） |
| `src/ocr.ts`、`ocr/server.py` | OCR 用戶端與服務（RapidOCR + PP-OCRv5） |
| `src/ledger.ts` | 帳本與結算演算法（貪婪法，最多 n−1 次轉帳） |
| `src/phrases.ts` | 人工校對的旅遊日文句庫 |
| `src/memo.ts` | 行程記事 |
| `src/fx.ts` | 匯率查詢，以及把回覆中的台幣金額改成程式計算的結果 |
| `src/llm-health.ts` | Ollama 健康檢查、模型能力與 context 長度檢查 |
| `src/store.ts` | JSON 檔案儲存（原子寫入、路徑安全處理） |
| `AGENTS.md` | System prompt |

資料以 JSON 存在 `data/`，分成 `ledgers/`、`memos/`、`sessions/` 和 `archive/`。

---

## ☁️ 部署

上面「安裝與啟動」的做法（家裡電腦加 Cloudflare quick tunnel）適合**開發、測試和朋友試用**。如果想讓 bot 全天候運作，建議依需求選擇下面的架構。

### 架構 A：家裡一台機器全包（Docker Compose）

```bash
cp .env.example .env              # 填入 LINE 的兩個值
docker compose up -d              # bot 連到宿主機上的 Ollama
docker compose --profile ollama up -d   # 或：Ollama 也放進容器（需要 NVIDIA Container Toolkit）
```

- 容器以非 root 使用者執行，根目錄唯讀、移除所有 Linux capabilities，只有 `data/` 可以寫入
- port 只綁 `127.0.0.1`，對外請透過 Cloudflare Tunnel（建議用 named tunnel，網址才不會變）

### 架構 B（推薦正式使用）：bot 放雲端、模型放家裡

```
LINE ──▶ 雲端 VM（bot + data）──Tailscale 私有網路──▶ 家裡電腦（Ollama + GPU）
```

- 雲端 VM 可以用 Oracle Cloud Always Free 這類免費或低價方案，只跑 bot，不需要 GPU
- **家裡電腦關機時，bot 仍然在線**：結算、帳目、記事、匯率、日文句庫都不經過 AI，照常可以用；AI 功能會回覆「暫時離線」
- 兩邊都安裝 [Tailscale](https://tailscale.com)，在 VM 的 `.env` 設定 `OLLAMA_BASE_URL=http://<家裡電腦的 Tailscale IP>:11434/v1`

> ⚠️ **Ollama 沒有任何驗證機制，絕對不要把 11434 port 開放到公網或路由器的 port forwarding。** 任何人連得到就能使用你的 GPU、下載或刪除模型。請只透過 Tailscale 這類私有網路連線，並讓 Ollama 只監聽 `127.0.0.1` 或 Tailscale 介面，不要用 `0.0.0.0`。

### 架構 A'：家裡一台機器 + Tailscale Funnel（固定網址、免費、不用網域）

Cloudflare quick tunnel 每次重啟網址都會變。[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) 會給一個固定的 `https://<主機名>.<tailnet>.ts.net` 網址，免費、不用買網域：

```bash
# 在跑 Docker 的 Linux／WSL 裡
docker build -t japan-trip-bot . && docker build -t japan-trip-bot-ocr ocr
docker network create jtb-net
docker run -d --name jtb-ocr --restart unless-stopped --network jtb-net -p 127.0.0.1:8001:8001   --read-only --tmpfs /tmp --cap-drop ALL japan-trip-bot-ocr
docker run -d --name jtb-bot --restart unless-stopped --network host --env-file .env   -e HOST=127.0.0.1 -e OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 -e OCR_URL=http://127.0.0.1:8001 -e DATA_DIR=/app/data   -v /var/lib/japan-trip-bot:/app/data --read-only --tmpfs /tmp --cap-drop ALL japan-trip-bot
tailscale funnel --bg 3000      # 第一次會給一個網址，到 Tailscale 後台按 Enable
```

把 `https://<主機名>.<tailnet>.ts.net/webhook` 貼到 LINE 的 Webhook 網址。容器設定了 `--restart unless-stopped`，只要 Docker 開機自動啟動，bot 就會自己起來。Funnel 只公開 bot 的 3000 port；OCR 與 Ollama 都不對外。

> 為什麼 bot 用 `--network host`？在 WSL 的 mirrored 網路模式下，Docker 橋接網路對外連線時好時壞（實測連 `api.line.me` 逾時，bot 就沒辦法回覆訊息），共用主機網路才穩定。也因為共用主機網路，一定要設定 `HOST=127.0.0.1`，否則區網裡的其他裝置也連得到 bot。

### 架構 C：長期（Homelab）

如果你本來就有 K3s 或 Kubernetes，可以把 bot、Ollama、監控（Grafana、Loki）放在同一套基礎設施上。單純跑這個 bot 的話，Docker Compose 就夠用了。

### 費用與維護

- 家裡電腦全天候開機（以 RTX 3060 Ti 等級的桌機估算），一個月大約 50～70 度電、NT$150～250。建議只在旅行期間開 AI
- 定期備份：`npm run backup` 會把 `data/` 複製到 `backups/<時間>/`
- Render、Railway 這類平台的免費方案通常**沒有永久硬碟**，重啟後資料會消失，不適合直接放這個 bot

---

## 🔒 資安設計

- **Webhook 簽章驗證**：每個請求都會用 Channel secret 驗證 `x-line-signature`，失敗回 401，不會洩漏錯誤細節
- **機密不進版控**：token 只從環境變數或 `.env` 讀取；`.env` 和 `data/`（含群組 ID、成員名字、帳目）都在 `.gitignore` 裡
- **路徑安全**：寫檔用的 chatId 只接受英數字，其他一律雜湊，避免路徑穿越
- **工具權限最小化**：agent 只能讀寫自己群組的帳本和記事，沒有執行指令、讀任意檔案或上網的工具
- **提示詞注入防護**：記事內容和照片上的 OCR 文字都會標示為「資料而不是指令」；算錢和安全資訊的判斷不經過 AI，就算被注入也改不了
- **照片隱私**：OCR 一律在本機執行；照片不會存檔，對話紀錄裡的圖片也會移除。預設照片不會送到外部服務；設定 `LLM_PROVIDER=gemini` 且 `PHOTO_USE_CLOUD=true` 時，**照片會送給 Gemini 解說**（評測正確率 63% → 88%），過敏原、酒精、藥品等安全資訊仍只由本機程式判斷
- **Gemini 聊天大腦（選用、預設關閉）**：設定 `LLM_PROVIDER=gemini` 後，**群組裡對 bot 說的話（含成員名字、金額、記事內容）會送到 Google**；照片仍只在本機處理。Gemini 失敗或額度用完時自動改用本機模型
- **Gemini 字典（選用、預設關閉）**：只送出「照片上讀到、而且本機字典查不到的日文片段」（例如「もつ鍋」），不送照片、聊天內容或成員名字；查過的詞存在本機，不會重複送出。藥品照片不使用 Gemini。⚠️ Gemini 免費方案的內容可能被 Google 用來改進產品並由人工審閱，介意的話請不要設定 `GEMINI_API_KEY`。API key 放在 HTTP header，不會出現在網址或紀錄裡
- **資源限制**：訊息上限 1,000 字、照片上限 8 MB、每個群組最多排隊 3 則、全部群組合計最多 8 則、記事上限 100 則、AI 回應逾時 90 秒
- **容器強化**：bot 和 OCR 都以非 root 執行、唯讀根目錄、移除所有 capabilities、`no-new-privileges`；bot 的 port 只綁 127.0.0.1，OCR 不對外開 port；OCR 模型在建置時下載，執行時不需要連網
- **資料完整性**：寫檔採用「先寫暫存檔再改名」的原子寫入，當機也不會留下寫到一半的帳本
- **依賴套件**：CI 每次都會跑 `npm audit`，並已開啟 Dependabot 警示。transitive 依賴 `basic-ftp` 的已知漏洞已透過 `overrides` 升級修補

發現資安問題時，請透過 GitHub 的 [Security Advisories](https://github.com/KJLavender/japan-trip-bot/security/advisories/new) 私下回報，不要開公開 issue。

---

## ⚠️ 已知限制

請在使用前了解以下限制。依影響程度排序：

### 1. AI 仍然可能出錯（幻覺）

- **醫療、藥品與過敏資訊僅供參考，請以包裝原文與藥師、店員的說明為準。** 程式只能偵測知識庫裡列出的寫法；換一種寫法、或照片上沒寫的成分，就偵測不到。偵測不到不代表沒有
- 照片的解說內容由 AI 撰寫，可能翻錯料理名稱、漏掉資訊，甚至編造照片上沒有的價格（沒看過的真實照片實測正確率約 57%）。每則照片回覆都會附上提醒；價格對不上 OCR 時會額外警告
- 句庫以外的日文由 AI 翻譯，可能不正確，回覆會附上警語
- 口語化的記帳（例如「一萬八」「跟小華對分」）要靠 AI 理解，可能記錯人或記錯金額，記完請看一下確認訊息；AI 如果沒有真的記帳卻說「已記帳」，bot 會攔下來

### 2. 模型品質決定體驗

- 預設的 `qwen3.5:4b` 是在 8GB 顯示卡上能流暢執行的折衷選擇，實測總分 97%，但測試題目不多，實際使用仍可能出錯（見「模型選擇（實測）」）
- 換模型前請先跑 `npm run eval` 比較；新模型不一定比較好，例如有些模型會把工具呼叫寫成文字，導致完全無法記帳

### 3. 知識庫的範圍有限

- 料理辭典約 60 項、用語約 80 項，遇到地方料理或少見的用語，解說品質會下降
- 歡迎發 PR 補充 `src/knowledge/`（請附上來源或確認方式）

### 4. 多人同時使用要排隊

- 所有群組共用同一個 Ollama，一次處理一則 AI 請求。一則約 1～10 秒，大家同時拍照時，後面的人要等
- 每個群組最多排隊 3 則、全部合計 8 則，超過時會請大家稍等
- 不經 AI 的指令（結算、記事、句庫、明確的記帳）不受影響

### 5. 照片

- OCR 常讀錯手寫、直書、反光的字，模型會同時看照片補正，但直書招牌、食券機這類照片仍然容易出錯
- 8GB 顯示卡跑不動 7B 以上的看圖模型（見「真實照片評測」），本機能用的模型知識有限，例如不認得魚翅、會把神籤認成注連繩
- 菜單上只有圖片沒有文字的品項，無法解說

### 6. 記事變多時

- 所有記事都會放進 AI 的 context（上限 100 則）。記事很多時，小模型可能找不到正確的那一則。之後會改成結構化行程（第幾天、時間、地點），讓「第三天住哪」這類問題直接查資料

### 7. LINE 平台限制

- LINE 未認證的帳號無法取得群組成員名單，所以要用「成員 …」登記，或讓每個人至少跟 bot 講過一次話
- 有人改 LINE 名稱時，bot 要在他下次講話時才會更新帳本上的名字
- bot 被踢出群組後資料會保留；重新邀請進同一個群組會接續原本的帳本
- 回覆有時效（reply token），AI 太慢時可能回覆失敗，可以視需要開啟 `ALLOW_PUSH_FALLBACK`（會用到每月免費推播額度）

### 8. 運作成本

- 「免費」的前提是你自己有電腦、電費和網路。全天候開機的電費和備份方式請見「部署」章節
- 只放家裡電腦的話，電腦關機時 bot 就完全無法使用；建議改用「架構 B」

### 9. 尚未提供

- 交通轉乘查詢：日本的電車資料受授權限制，Google Maps API 查不到大眾運輸路線。之後會用人工整理的常見路線加上 Google Maps 連結

---

## 🧪 開發

```bash
npm test            # 單元測試（分帳、記帳解析、照片分類與安全偵測、句庫、記事、改名、路徑安全…）
npm run typecheck   # TypeScript 型別檢查
npm run eval -- qwen3.5:4b gemma3:4b   # 模型評測（需要 Ollama）
npm run setup:model # 建立 context 加大的模型變體
npm run chat -- 小明 # 本機 REPL，不需要 LINE
npm run dev         # 開發模式（自動重啟）
npm run backup      # 備份 data/
npm run build       # 編譯到 dist/（Docker 會用到）
```

## 📄 授權

[MIT](LICENSE)
