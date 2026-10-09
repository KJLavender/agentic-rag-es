export const NO_DATA = "沒有相關資料";

/** 模型不一定照抄「沒有相關資料」，常寫成「知識庫中沒有關於 X 的相關資料」「知識庫未提及」。 */
const NO_DATA_RE = /沒有相關資料|知識庫(?:中|裡)?(?:並)?(?:沒有|未|找不到)[^。\n]{0,40}(?:資料|內容|提到|提及|記載|說明)/;
// 先拿掉 Markdown 符號：「知識庫中**沒有**…」也要認得
export const saysNoData = (text: string) => NO_DATA_RE.test(text.replace(/[*`_]/g, ""));

export interface Verification {
  /** ok：引用都對得上；no_answer：誠實說查不到；warn：有問題，前端要標 ⚠。 */
  status: "ok" | "no_answer" | "warn";
  cited: string[];
  /** 引用了但這次根本沒檢索到的 id（編造的來源）。 */
  invalid: string[];
  /** 回答很長卻完全沒附來源。 */
  uncited: boolean;
  /** 已移除無效引用的回答。 */
  answer: string;
  notes: string[];
}

// 片段 id 都是小寫，但模型會寫成「PowerBI-mcp#1」；整個 token 抓下來再轉小寫比對，不要只截到後半段
const CITE = /(?<![\w-])[A-Za-z0-9][A-Za-z0-9-]*#\d+/g;

/**
 * 輸出查核（PowerBI MCP「數字必須出現在工具結果」的 RAG 版）：
 * 回答裡引用的每個片段 id，都必須是這次真的檢索到的；沒有就移除並標 ⚠。
 */
export function verifyCitations(answer: string, knownIds: Set<string>): Verification {
  const tokens = [...new Set(answer.match(CITE) ?? [])];
  const invalid = tokens.filter((t) => !knownIds.has(t.toLowerCase()));
  let cleaned = answer;
  for (const t of invalid) cleaned = cleaned.split(t).join("");
  // 大小寫寫錯但確實檢索到的，統一成正確的 id
  for (const t of tokens) if (t !== t.toLowerCase() && knownIds.has(t.toLowerCase())) cleaned = cleaned.split(t).join(t.toLowerCase());
  const cited = [...new Set(tokens.map((t) => t.toLowerCase()))];
  // 移除後留下的空括號，例如 [] 或 [來源: ]
  cleaned = cleaned.replace(/\[(?:來源[:：]?)?[\s,，、]*\]/g, "").replace(/[ \t]+\n/g, "\n");
  const valid = cited.filter((id) => knownIds.has(id));
  const noAnswer = saysNoData(cleaned) && !valid.length;
  const uncited = !noAnswer && !valid.length && cleaned.replace(/\s/g, "").length > 40;
  const notes: string[] = [];
  if (invalid.length) notes.push(`移除了 ${invalid.length} 個這次沒有檢索到的來源：${invalid.join("、")}`);
  if (uncited) notes.push("回答沒有附上任何來源，內容可能不是出自知識庫");
  return {
    status: noAnswer ? "no_answer" : invalid.length || uncited ? "warn" : "ok",
    cited: valid,
    invalid,
    uncited,
    answer: cleaned.trim(),
    notes,
  };
}
