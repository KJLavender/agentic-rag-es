/**
 * 網頁冒煙測試：用本機的 Chrome / Edge 真的開網頁問問題，截圖存到 .cache/ui-*.png。
 *   npm start   # 先開 server（並 npm run build:web）
 *   npx tsx scripts/smoke-ui.ts
 */
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:8787";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const shot = (name: string) => page.screenshot({ path: `.cache/ui-${name}.png` });
const waitAnswer = async (n: number) => {
  await page.locator(".msg.assistant .msg-foot").nth(n - 1).waitFor({ timeout: 180_000 });
};

await page.goto(url);
await page.selectOption(".panel select >> nth=0", "guest");
await page.locator(".sidebar button.primary").click();
await shot("1-empty");

await page.getByRole("button", { name: "AIOps v2 為什麼要把 agent 拆開？" }).click();
await page.locator(".status").waitFor({ timeout: 30_000 }).catch(() => {});
await shot("2-streaming");
await waitAnswer(1);
await page.locator(".source-head").first().click();
await page.locator(".trace summary").first().click();
await shot("3-answer");

await page.fill(".composer textarea", "那 v1 的 LLM 能做哪些修復動作？");
await page.keyboard.press("Enter");
await waitAnswer(2);
await shot("4-follow-up");

await page.fill(".composer textarea", "今天台北天氣怎麼樣？");
await page.keyboard.press("Enter");
await waitAnswer(3);
await shot("5-out-of-scope");

await page.selectOption(".panel select >> nth=0", "admin");
await page.getByRole("button", { name: "管理文件" }).click();
await page.locator(".docs table tbody tr").first().waitFor();
await shot("6-documents");

const verify = await page.locator(".badge").allInnerTexts();
console.log("查核標籤：", verify);
await browser.close();
