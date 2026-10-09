/**
 * 命令列問答（不用開網頁就能試整條流程）：
 *   npm run ask -- "japan-trip-bot 怎麼分帳？"
 *   npm run ask -- --groups team --mode vector --rerank "Report Server 上傳 422 怎麼辦？"
 */
import { RetrievalClient } from "../src/agent/retrieval-client.js";
import { runPipeline, type Settings } from "../src/agent/pipeline.js";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const groups = opt("groups")?.split(",") ?? [];
const mode = (opt("mode") ?? "auto") as Settings["mode"];
const rerank = args.includes("--rerank") ? (args.splice(args.indexOf("--rerank"), 1), true) : false;
const question = args.join(" ");
if (!question) throw new Error('用法：npm run ask -- "你的問題"');

const retrieval = new RetrievalClient();
retrieval.onAudit(() => {});
const res = await runPipeline({ question, history: [], groups, settings: { mode, rerank } }, retrieval, (e) => {
  if (e.type === "status") console.error(`… ${e.text}`);
  if (e.type === "decision") console.error(`  決策：${e.data.stage} → ${e.data.reason}`);
  if (e.type === "retrieval") console.error(`  第 ${e.data.round} 輪 ${e.data.mode}：${e.data.found.map((f) => f.id).join(" ")}｜夠了？${e.data.grade?.sufficient}｜相關 ${e.data.grade?.relevant_ids.join(" ")}`);
  if (e.type === "tool") console.error(`  工具 ${e.data.name} ${JSON.stringify(e.data.args)} → ${e.data.result_ids.join(" ")}`);
  if (e.type === "text") process.stdout.write(e.delta);
});
console.log(`\n\n— 查核：${res.trace.verify?.status ?? "（未生成）"} ${res.trace.verify?.notes.join("；") ?? ""}`);
console.log(`— 來源：${res.sources.map((s) => `${s.id}（${s.title} > ${s.section}）`).join("、") || "無"}`);
console.log(`— 耗時：${JSON.stringify(res.trace.timings)}`);
await retrieval.close();
