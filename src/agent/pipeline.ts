import { config } from "../config.js";
import type { Mode } from "../retrieval/search.js";
import { decide, type AnswerType, type DecisionResult, type Turn } from "./decision.js";
import { generate } from "./generate.js";
import { grade, type Grade } from "./grade.js";
import type { Passage, RetrievalClient } from "./retrieval-client.js";
import { NO_DATA, verifyCitations, type Verification } from "./verify.js";

export interface Settings {
  /** auto = 用決策層建議的模式。 */
  mode: Mode | "auto";
  rerank: boolean;
  /** 關掉決策層（評測消融用）：每個問題都直接進檢索。 */
  decision: boolean;
}

export const DEFAULT_SETTINGS: Settings = { mode: "auto", rerank: false, decision: true };

export interface RetrievalRound {
  round: number;
  mode: Mode;
  queries: string[];
  found: { id: string; title: string; section: string; score: number; via: string }[];
  grade?: Pick<Grade, "sufficient" | "relevant_ids" | "missing">;
}

export interface Trace {
  decision?: DecisionResult;
  rounds: RetrievalRound[];
  context: string[];
  tools: { name: string; args: unknown; result_ids: string[] }[];
  verify?: Verification;
  timings: Record<string, number>;
  error?: string;
}

export type PipelineEvent =
  | { type: "status"; text: string }
  | { type: "decision"; data: DecisionResult }
  | { type: "retrieval"; data: RetrievalRound }
  | { type: "sources"; data: Passage[] }
  | { type: "text"; delta: string }
  | { type: "tool"; data: Trace["tools"][number] }
  | { type: "verify"; data: Verification };

export interface PipelineResult {
  answer: string;
  sources: Passage[];
  trace: Trace;
}

/** 多個查詢變體的結果用 RRF 合併。 */
function fuse(lists: Passage[][]): Passage[] {
  const merged = new Map<string, Passage & { fused: number }>();
  for (const list of lists) {
    list.forEach((p, i) => {
      const add = 1 / (60 + i + 1);
      const prev = merged.get(p.id);
      if (prev) prev.fused += add;
      else merged.set(p.id, { ...p, fused: add });
    });
  }
  return [...merged.values()].sort((a, b) => b.fused - a.fused);
}

/**
 * 整條流程由程式的狀態機控制，LLM 只做窄任務：
 *   決策 → 檢索 → 評審夠不夠 →（不夠就換查詢/模式再查，最多 N 輪）→ 生成 → 引用查核
 * 小模型（4B）自己決定流程不穩，所以不交給它。
 */
export async function runPipeline(
  input: { question: string; history: Turn[]; groups: string[]; settings?: Partial<Settings> },
  retrieval: RetrievalClient,
  emit: (e: PipelineEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const trace: Trace = { rounds: [], context: [], tools: [], timings: {} };
  const t0 = Date.now();
  const lap = (name: string, since: number) => (trace.timings[name] = Date.now() - since);
  const say = (answer: string, sources: Passage[] = []) => {
    emit({ type: "text", delta: answer });
    trace.timings.total = Date.now() - t0;
    return { answer, sources, trace };
  };

  // ① 決策層
  emit({ type: "status", text: "判斷問題類型" });
  let t = Date.now();
  const question = input.question.trim();
  let standalone = question;
  let variants: string[] = [];
  let mode: Mode = settings.mode === "auto" ? "hybrid" : settings.mode;
  let answerType: AnswerType = "other";
  if (settings.decision) {
    const d = await decide(question, input.history, retrieval, input.groups);
    trace.decision = d;
    lap("decision", t);
    emit({ type: "decision", data: d });
    if (!d.proceed) return say(d.reply ?? NO_DATA);
    standalone = d.decision.standalone_query;
    variants = d.decision.query_variants;
    if (settings.mode === "auto") mode = d.decision.suggested_mode;
    answerType = d.decision.answer_type;
  }

  // ② 檢索 + ③ 評審（CRAG 迴圈）
  t = Date.now();
  let pool: Passage[] = [];
  let context: Passage[] = [];
  // rerank 在 MCP server 裡做（撈 20 筆候選再重排）。開 rerank 時只查主查詢：
  // 候選夠多、召回率已經夠（驗收組 Hit@5 100%），每個變體都 rerank 只會讓 CPU 時間翻倍
  let queries = settings.rerank ? [standalone] : [standalone, ...variants];
  const tried = new Set<string>();
  for (let round = 1; round <= config.maxRetrievalRounds + 1; round++) {
    emit({ type: "status", text: `第 ${round} 輪檢索（${mode}${settings.rerank ? " + rerank" : ""}）：${queries[0]}` });
    queries.forEach((q) => tried.add(`${mode}|${q}`));
    const k = settings.rerank ? config.contextK : config.contextK + 2;
    const lists = await Promise.all(queries.map((q) => retrieval.search(mode, q, k, input.groups, settings.rerank)));
    pool = fuse([pool, ...lists]);
    const candidates = pool.slice(0, config.contextK);
    const r: RetrievalRound = {
      round,
      mode,
      queries,
      found: candidates.map((p) => ({ id: p.id, title: p.title, section: p.section, score: p.score, via: p.via })),
    };

    emit({ type: "status", text: "檢查資料夠不夠回答" });
    const g = await grade(standalone, candidates);
    r.grade = { sufficient: g.sufficient, relevant_ids: g.relevant_ids, missing: g.missing };
    trace.rounds.push(r);
    emit({ type: "retrieval", data: r });

    // 只把評審認為相關的片段給生成模型；評審一個都沒挑時保留前幾名，讓生成端自己判斷
    const relevant = candidates.filter((p) => g.relevant_ids.includes(p.id));
    context = relevant.length ? relevant : candidates.slice(0, 3);
    if (g.sufficient || round > config.maxRetrievalRounds) break;
    // 下一輪：評審建議的查詢和模式；試過的組合不再重查，換一個還沒用過的模式
    const next = g.next_query?.trim() || standalone;
    const order: Mode[] = [g.next_mode, "vector", "hybrid", "keyword"];
    const fresh = order.find((m) => !tried.has(`${m}|${next}`));
    if (!fresh) break;
    queries = [next];
    mode = fresh;
  }
  lap("retrieval", t);

  // 一筆都查不到：fail-closed，不讓模型自由發揮
  if (!context.length) return say(`${NO_DATA}。知識庫裡找不到跟這個問題有關的內容。`);

  // SOP／流程題：步驟常被切在不同片段、甚至不同頁。把最相關兩個片段的前後片段補進來，
  // 依文件與原文順序排好，生成時才不會漏步驟或排錯順序。
  if (answerType === "procedure") {
    emit({ type: "status", text: "補齊流程的前後步驟" });
    const around = (await Promise.all(context.slice(0, 2).map((p) => retrieval.getDocument(p.id, input.groups)))).flat();
    const merged = new Map([...context, ...around].map((p) => [p.id, p]));
    const docOrder = [...new Set([...merged.values()].map((p) => p.id.split("#")[0]))];
    const pos = (p: Passage) => Number(p.id.split("#")[1]);
    context = [...merged.values()]
      .sort((a, b) => docOrder.indexOf(a.id.split("#")[0]) - docOrder.indexOf(b.id.split("#")[0]) || pos(a) - pos(b))
      .slice(0, 8);
  }
  trace.context = context.map((p) => p.id);
  emit({ type: "sources", data: context });

  // ④ 生成
  emit({ type: "status", text: "產生回答" });
  t = Date.now();
  const gen = await generate(
    standalone,
    context,
    retrieval,
    input.groups,
    {
      onText: (delta) => emit({ type: "text", delta }),
      onTool: (name, args, results) => {
        const call = { name, args, result_ids: results.map((p) => p.id) };
        trace.tools.push(call);
        emit({ type: "tool", data: call });
      },
    },
    signal,
    answerType,
  );
  lap("generate", t);
  if (gen.error) trace.error = gen.error;
  if (!gen.answer) {
    trace.timings.total = Date.now() - t0;
    return { answer: gen.error ? "抱歉，產生回答時發生錯誤，請再試一次。" : NO_DATA, sources: context, trace };
  }

  // ⑤ 引用查核
  const known = new Set([...context, ...gen.toolPassages].map((p) => p.id));
  const v = verifyCitations(gen.answer, known);
  trace.verify = v;
  emit({ type: "verify", data: v });
  const sources = [...context, ...gen.toolPassages.filter((p) => !context.some((c) => c.id === p.id))].filter((p) => v.cited.includes(p.id));
  trace.timings.total = Date.now() - t0;
  return { answer: v.answer, sources: sources.length ? sources : context, trace };
}
