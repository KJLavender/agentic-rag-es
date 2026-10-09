export const NO_DATA = "沒有相關資料";

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

const CITE = /[a-z0-9][a-z0-9-]*#\d+/g;

/**
 * 輸出查核（PowerBI MCP「數字必須出現在工具結果」的 RAG 版）：
 * 回答裡引用的每個片段 id，都必須是這次真的檢索到的；沒有就移除並標 ⚠。
 */
export function verifyCitations(answer: string, knownIds: Set<string>): Verification {
  const cited = [...new Set(answer.match(CITE) ?? [])];
  const invalid = cited.filter((id) => !knownIds.has(id));
  let cleaned = answer;
  for (const id of invalid) cleaned = cleaned.split(id).join("");
  // 移除後留下的空括號，例如 [] 或 [來源: ]
  cleaned = cleaned.replace(/\[(?:來源[:：]?)?[\s,，、]*\]/g, "").replace(/[ \t]+\n/g, "\n");
  const valid = cited.filter((id) => knownIds.has(id));
  const noAnswer = cleaned.includes(NO_DATA) && !valid.length;
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
