import { useState } from "react";
import type { DecisionResult, Passage, RagUIMessage, RetrievalRound, Trace, Verification } from "../../src/shared/ui";
import { api } from "./api";
import { Markdown } from "./Markdown";

const STAGE = { rules: "規則", domain: "領域相似度", llm: "LLM 分類" } as const;
const INTENT: Record<string, string> = {
  rag_question: "知識庫問題",
  follow_up: "追問",
  chitchat: "閒聊",
  out_of_scope: "範圍外",
  injection: "疑似 injection",
  unclear: "不明確",
};

function collect(message: RagUIMessage) {
  let text = "";
  let decision: DecisionResult | undefined;
  let sources: Passage[] = [];
  let verify: Verification | undefined;
  const rounds: RetrievalRound[] = [];
  const tools: Trace["tools"] = [];
  for (const p of message.parts) {
    if (p.type === "text") text += p.text;
    else if (p.type === "data-decision") decision = p.data;
    else if (p.type === "data-sources") sources = p.data;
    else if (p.type === "data-verify") verify = p.data;
    else if (p.type === "data-retrieval") rounds.push(p.data);
    else if (p.type === "data-tool") tools.push(p.data);
  }
  // 查核移除了編造的來源時，顯示清理過的版本
  if (verify?.invalid.length) text = verify.answer;
  return { text, decision, sources, verify, rounds, tools };
}

function VerifyBadge({ v }: { v?: Verification }) {
  if (!v) return null;
  if (v.status === "ok") return <span className="badge ok">✓ 引用已查核</span>;
  if (v.status === "no_answer") return <span className="badge info">ℹ 知識庫查無資料</span>;
  return <span className="badge warn" title={v.notes.join("\n")}>⚠ {v.notes[0] ?? "有無法查證的內容"}</span>;
}

export function AssistantMessage({ message, showTrace, streaming }: { message: RagUIMessage; showTrace: boolean; streaming: boolean }) {
  const { text, decision, sources, verify, rounds, tools } = collect(message);
  const [open, setOpen] = useState<string | null>(null);
  const [rating, setRating] = useState(message.metadata?.rating ?? 0);
  // 引用編號依來源順序：[1]、[2]…
  const order = sources.map((s) => s.id);
  const cite = (id: string) => {
    const n = order.indexOf(id) + 1;
    if (!n) return <sup className="cite missing" title="不在這次的來源裡">{id}</sup>;
    return (
      <sup className={`cite ${open === id ? "active" : ""}`} title={id} onClick={() => setOpen(open === id ? null : id)}>
        {n}
      </sup>
    );
  };
  const rate = async (r: number) => {
    if (!message.metadata?.messageId) return;
    await api.feedback(message.metadata.messageId, r);
    setRating(r);
  };

  return (
    <div className="msg assistant">
      {text ? <Markdown text={text} cite={cite} /> : streaming ? <p className="muted">…</p> : null}

      {sources.length > 0 && (
        <div className="sources">
          {sources.map((s, i) => (
            <div key={s.id} className={`source ${open === s.id ? "open" : ""}`}>
              <button className="source-head" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="num">{i + 1}</span>
                <span className="source-title">{s.title}</span>
                {s.section && <span className="muted"> › {s.section}</span>}
                <span className="muted id">{s.id}</span>
              </button>
              {open === s.id && (
                <div className="source-body">
                  <pre>{s.content}</pre>
                  {/^https?:\/\//.test(s.source) && (
                    <a href={s.source} target="_blank" rel="noreferrer noopener">
                      原文 ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!streaming && (
        <div className="msg-foot">
          <VerifyBadge v={verify} />
          {message.metadata?.latencyMs !== undefined && <span className="muted">{(message.metadata.latencyMs / 1000).toFixed(1)}s</span>}
          {message.metadata?.messageId && (
            <span className="rate">
              <button className={rating > 0 ? "on" : ""} onClick={() => rate(1)} title="有幫助">👍</button>
              <button className={rating < 0 ? "on" : ""} onClick={() => rate(-1)} title="沒幫助（會變成評測候選題）">👎</button>
            </span>
          )}
        </div>
      )}

      {showTrace && (decision || rounds.length > 0) && (
        <details className="trace">
          <summary>
            過程：{decision ? `${STAGE[decision.stage]} → ${INTENT[decision.decision.intent] ?? decision.decision.intent}` : "略過決策層"}
            {rounds.length > 0 && `｜檢索 ${rounds.length} 輪（${[...new Set(rounds.map((r) => r.mode))].join(" → ")}）`}
            {tools.length > 0 && `｜工具 ${tools.length} 次`}
          </summary>
          {decision && (
            <div className="trace-block">
              <b>決策層</b>：{decision.reason}
              {decision.similarity !== undefined && `（最相近片段相似度 ${decision.similarity.toFixed(2)}）`}
              {decision.proceed && (
                <div className="muted">
                  改寫：{decision.decision.standalone_query}
                  {decision.decision.query_variants.length > 0 && `｜變體：${decision.decision.query_variants.join("、")}`}
                </div>
              )}
            </div>
          )}
          {rounds.map((r) => (
            <div key={r.round} className="trace-block">
              <b>第 {r.round} 輪</b> <code>{r.mode}</code>：{r.queries.join("｜")}
              <div className="muted">
                找到 {r.found.map((f) => f.id).join("、") || "（無）"}
                {r.grade && `｜評審：${r.grade.sufficient ? "夠了" : `不夠（${r.grade.missing || "—"}）`}｜相關 ${r.grade.relevant_ids.join("、") || "無"}`}
              </div>
            </div>
          ))}
          {tools.map((t, i) => (
            <div key={i} className="trace-block">
              <b>工具</b> <code>{t.name}</code> {JSON.stringify(t.args)} → {t.result_ids.join("、") || "（無）"}
            </div>
          ))}
          {verify && verify.notes.length > 0 && <div className="trace-block warn-text">查核：{verify.notes.join("；")}</div>}
        </details>
      )}
    </div>
  );
}
