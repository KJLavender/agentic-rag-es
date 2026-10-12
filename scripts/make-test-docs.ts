/**
 * 產生測試用的 PDF / PPTX（內容是虛構的「雲橋科技」文件），放在 corpus/files/。
 *   npx tsx scripts/make-test-docs.ts
 * PDF 用本機 Chrome 列印 HTML（字型會內嵌）；PPTX 用 pptxgenjs。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import pptxgenjs from "pptxgenjs";

// pptxgenjs 的型別宣告跟 NodeNext 的 default import 對不上，執行期取 default 再用
const PptxGenJS = ((pptxgenjs as any).default ?? pptxgenjs) as new () => any;
type Slide = any;

const OUT = "corpus/files";
mkdirSync(OUT, { recursive: true });

const css = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; font-size: 11pt; line-height: 1.65; color: #1f2328; }
  h1 { font-size: 19pt; margin: 0 0 4px; } h2 { font-size: 13.5pt; margin: 18px 0 6px; border-bottom: 2px solid #2f6fdf; padding-bottom: 2px; }
  .meta { color: #555; font-size: 9.5pt; margin-bottom: 10px; } table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 10pt; }
  th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; } th { background: #eef3fb; }
  code { font-family: Consolas, monospace; background: #f3f3f3; padding: 0 3px; } .warn { border-left: 4px solid #d9822b; background: #fff6ec; padding: 6px 10px; margin: 8px 0; }
  ol li { margin-bottom: 4px; } .pb { page-break-before: always; }`;
const footer = `<div style="font-size:8pt;color:#888;width:100%;text-align:center;font-family:'Microsoft JhengHei'">雲橋科技 — 測試用虛構文件 — 第 <span class="pageNumber"></span> / <span class="totalPages"></span> 頁</div>`;

const ES_SOP = `<h1>Elasticsearch 叢集備份與還原 SOP</h1>
<div class="meta">文件編號：IT-SOP-012　版本：v2.1　生效日期：2026-07-01　權責單位：平台維運部</div>
<h2>1. 目的與適用範圍</h2>
<p>規範正式環境 Elasticsearch 叢集（es-prod）的每日備份與資料還原流程，確保資料遺失時能在目標時間內復原。本 SOP 的復原時間目標（RTO）為 2 小時，復原點目標（RPO）為 24 小時。</p>
<h2>2. 角色與權限</h2>
<table><tr><th>角色</th><th>負責事項</th><th>所需權限</th></tr>
<tr><td>值班 SRE</td><td>執行備份、監看進度、執行還原</td><td>Elasticsearch 角色 <code>snapshot_user</code></td></tr>
<tr><td>DBA 主管</td><td>核准正式環境還原</td><td>事件單核准權限</td></tr>
<tr><td>資料擁有團隊</td><td>還原後驗證資料正確性</td><td>唯讀查詢</td></tr></table>
<h2>3. 前置條件</h2>
<ul><li>已註冊快照儲存庫 <code>nightly-s3</code>（S3 bucket：yq-es-snapshots）。</li><li>叢集健康狀態為 green。</li><li>每個資料節點磁碟剩餘空間大於 20%。</li></ul>
<h2>4. 每日備份步驟</h2>
<p>每日 02:00 由排程自動觸發；排程失敗時由值班 SRE 依下列步驟手動執行。</p>
<ol><li>確認叢集健康：執行 <code>GET _cluster/health</code>，status 必須為 green。若為 yellow 或 red，先停止並通報 DBA。</li>
<li>建立快照：執行 <code>PUT _snapshot/nightly-s3/snap-YYYYMMDD?wait_for_completion=false</code>。</li>
<li>監看進度：執行 <code>GET _snapshot/nightly-s3/snap-YYYYMMDD/_status</code>，直到 state 不再是 IN_PROGRESS。</li>
<li>驗證結果：state 必須為 SUCCESS，且 shards.failed 為 0。</li>
<li>在變更管理系統登記快照名稱與完成時間。</li>
<li>清理舊快照：快照保留 14 天，刪除超過 14 天的快照。</li></ol>
<div class="warn">注意：備份期間不可執行 force merge 或 index 刪除，以免快照不一致。</div>
<h2 class="pb">5. 資料還原步驟</h2>
<p>適用於誤刪 index、資料損毀或需要回到某個時間點的情況。</p>
<ol><li>開立事件單，並取得 DBA 主管核准；未經核准不得在正式環境還原。</li>
<li>關閉要被覆蓋的 index：執行 <code>POST &lt;index&gt;/_close</code>。若要保留現有資料，改用下一步的 rename 方式還原成新 index。</li>
<li>執行還原：<code>POST _snapshot/nightly-s3/&lt;快照名稱&gt;/_restore</code>，在 body 指定 indices，必要時用 rename_pattern / rename_replacement 還原成 restored-* 名稱。</li>
<li>監看還原進度：執行 <code>GET _recovery?active_only=true</code>，直到沒有進行中的復原。</li>
<li>驗證資料：比對文件數（<code>GET &lt;index&gt;/_count</code>）與備份當時的紀錄，並請資料擁有團隊做抽樣查詢。</li>
<li>切換 alias：確認無誤後，把應用程式使用的 alias 指向還原後的 index。</li>
<li>通知相關團隊並在事件單記錄結果後結案。</li></ol>
<div class="warn">注意：（1）正式環境還原必須在維護時段執行：每週三 22:00–24:00；緊急情況需技術長核准。（2）還原完成並驗證前，不可刪除舊 index。（3）還原期間叢集負載會升高，先通知客服。</div>
<h2>6. 異常處理</h2>
<table><tr><th>狀況</th><th>處理方式</th></tr>
<tr><td>快照失敗（state 為 FAILED 或 PARTIAL）</td><td>重試一次；仍失敗則以 PagerDuty 通知值班 DBA。</td></tr>
<tr><td>磁碟空間不足</td><td>先清除超過 14 天的快照，再擴充磁碟；不可刪除 7 天內的快照。</td></tr>
<tr><td>S3 儲存庫無法連線</td><td>確認 IAM 角色與網路政策，並通報雲端平台組。</td></tr></table>`;

const SEC_SOP = `<h1>資安事件通報與處理 SOP</h1>
<div class="meta">文件編號：SEC-SOP-003　版本：v1.4　生效日期：2026-05-15　權責單位：資訊安全中心</div>
<h2>1. 事件等級與通報時限</h2>
<table><tr><th>等級</th><th>範例</th><th>通報時限</th></tr>
<tr><td>P1 重大</td><td>個資外洩、勒索病毒、正式環境遭入侵</td><td>發現後 15 分鐘內</td></tr>
<tr><td>P2 高</td><td>員工帳號遭盜用、惡意程式感染單一電腦</td><td>發現後 1 小時內</td></tr>
<tr><td>P3 一般</td><td>收到釣魚郵件但未點擊、異常登入警示</td><td>1 個工作天內</td></tr></table>
<h2>2. 通報管道</h2>
<p>資安專線：分機 7110（24 小時）；電子郵件：security@yunqiao.example；夜間與假日請直接撥打資安值班手機 0900-000-711。</p>
<h2>3. 帳號遭盜用處理步驟</h2>
<ol><li>立即在 IAM 主控台停用該帳號，並撤銷所有登入工作階段與存取權杖（token）。</li>
<li>重設密碼，並要求使用者重新綁定多因素驗證（MFA）。</li>
<li>保留證據：匯出該帳號最近 7 天的登入紀錄；不可刪除可疑郵件或檔案。</li>
<li>於 1 小時內通報資訊安全中心（P2 事件）。</li>
<li>檢查該帳號期間內的權限異動、新增的 API 金鑰與郵件轉寄規則，發現異常一併撤銷。</li>
<li>事件處理完成後 3 個工作天內提交事件報告。</li></ol>
<h2 class="pb">4. 疑似勒索病毒處理步驟</h2>
<ol><li>立即拔除網路線或關閉 Wi-Fi，讓電腦離線。</li>
<li>不要關機，也不要重新開機，以保留記憶體中的證據。</li>
<li>拍照記錄螢幕上的勒索訊息。</li>
<li>15 分鐘內撥打資安專線分機 7110 通報（P1 事件）。</li>
<li>等待資安人員到場，期間不要插入任何隨身碟或外接硬碟。</li></ol>
<div class="warn">禁止事項：不要自行聯絡攻擊者或支付贖金；不要在社群媒體或對外管道討論事件；不要自行刪除可疑檔案。</div>
<h2>5. 事後檢討</h2>
<p>P1、P2 事件結案後 10 個工作天內召開事後檢討會議，產出根因分析與改善行動，並追蹤到完成。</p>`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome" });
const page = await browser.newPage();
for (const [name, body] of [["es-backup-sop", ES_SOP], ["security-incident-sop", SEC_SOP]] as const) {
  await page.setContent(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  await page.pdf({ path: `${OUT}/${name}.pdf`, format: "A4", displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" } });
  console.log(`${OUT}/${name}.pdf`);
}
await browser.close();

// ── PPTX ──
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
const FONT = "Microsoft JhengHei";
const title = (s: Slide, t: string) => s.addText(t, { x: 0.5, y: 0.35, w: 12.3, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: "1F3864" });
const bullets = (s: Slide, items: string[], y = 1.4) =>
  s.addText(items.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.7, y, w: 12, h: 5.2, fontFace: FONT, fontSize: 20, valign: "top", paraSpaceAfter: 10 });
const foot = (s: Slide) => s.addText("雲橋科技 — 測試用虛構文件", { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 10, color: "888888", align: "right" });

let s = pptx.addSlide();
s.addText("AIOps 平台 2026 Q3 進度報告", { x: 0.5, y: 2.3, w: 12.3, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: "1F3864", align: "center" });
s.addText("平台維運部｜2026 年 10 月 5 日", { x: 0.5, y: 3.6, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 20, align: "center", color: "555555" });
foot(s);

s = pptx.addSlide(); title(s, "議程");
bullets(s, ["Q3 重點成果", "架構更新：四個 Agent 拆分", "事件統計", "風險與待解決問題", "Q4 計畫與預算申請"]); foot(s);

s = pptx.addSlide(); title(s, "Q3 重點成果");
bullets(s, [
  "平均修復時間（MTTR）從 46 分鐘降到 11 分鐘",
  "自動修復率從 38% 提升到 64%",
  "Q3 誤修復（修壞後回滾）0 次",
  "每晚情境模擬評測：8 個故障情境全數通過",
]); foot(s);

s = pptx.addSlide(); title(s, "架構更新：四個 Agent 拆分");
bullets(s, [
  "monitor：偵測故障 Pod、遮罩祕密、建立 Incident",
  "diagnose：規則 → 知識庫 → 網路搜尋 → LLM，沒有任何叢集變更權限",
  "repair：依動作清單重建 patch，不能連外網",
  "validate：確認 rollout 完成且穩定，記錄 Lesson",
  "四個 Agent 透過 Kubernetes CRD 交接，彼此不直接呼叫",
]); foot(s);

s = pptx.addSlide(); title(s, "事件統計");
s.addTable(
  [
    [{ text: "月份", options: { bold: true, fill: { color: "EEF3FB" } } }, { text: "事件數", options: { bold: true, fill: { color: "EEF3FB" } } }, { text: "自動修復", options: { bold: true, fill: { color: "EEF3FB" } } }, { text: "人工處理", options: { bold: true, fill: { color: "EEF3FB" } } }],
    ["7 月", "52", "27", "25"],
    ["8 月", "47", "30", "17"],
    ["9 月", "39", "29", "10"],
  ],
  { x: 1.5, y: 1.6, w: 10, fontFace: FONT, fontSize: 18, border: { type: "solid", color: "999999", pt: 1 } },
);
s.addText("9 月人工處理的事件中，有 6 起是 ImagePullBackOff（映像檔不存在且沒有核准的備用映像檔）。", { x: 1.5, y: 4.4, w: 10, h: 0.8, fontFace: FONT, fontSize: 16, color: "444444" });
foot(s);

s = pptx.addSlide(); title(s, "風險與待解決問題");
bullets(s, [
  "LLM 評審延遲 P95 為 8 秒，尖峰時段排隊",
  "只有一張 GPU（8GB），評審與診斷搶同一張卡",
  "repair Agent 只有單一 replica，尚未做 leader election",
  "部分團隊的 Deployment 沒有設定 readiness probe，無法自動驗證",
]); foot(s);

s = pptx.addSlide(); title(s, "Q4 計畫");
bullets(s, [
  "新增人工核准階段：LLM 提出的修復透過 ntfy 推播，由值班人員簽核",
  "repair / validate 加入 leader election，支援多 replica",
  "導入 OpenTelemetry，追蹤整條交接流程",
  "目標：MTTR 降到 8 分鐘以下、自動修復率達 75%",
]); foot(s);

s = pptx.addSlide(); title(s, "預算申請");
bullets(s, [
  "GPU 擴充：RTX 4070 Ti SUPER（16GB）× 1，預估 NT$ 32,000",
  "用途：LLM 評審與診斷分開部署，解決排隊問題",
  "預期效益：評審延遲 P95 從 8 秒降到 3 秒以內",
  "申請人：平台維運部；需於 10 月 20 日前核准",
]); foot(s);

s = pptx.addSlide();
s.addText("Q&A", { x: 0.5, y: 2.8, w: 12.3, h: 1.2, fontFace: FONT, fontSize: 48, bold: true, color: "1F3864", align: "center" });
foot(s);

await pptx.writeFile({ fileName: `${OUT}/aiops-q3-review.pptx` });
console.log(`${OUT}/aiops-q3-review.pptx`);

writeFileSync(
  `${OUT}/_meta.json`,
  JSON.stringify(
    {
      "es-backup-sop.pdf": { title: "Elasticsearch 叢集備份與還原 SOP", acl: ["public"] },
      "security-incident-sop.pdf": { title: "資安事件通報與處理 SOP", acl: ["public"] },
      "aiops-q3-review.pptx": { title: "AIOps 平台 2026 Q3 進度報告", acl: ["team"] },
    },
    null,
    2,
  ) + "\n",
);
