/** 前後端共用的串流訊息型別（AI SDK UIMessage）。web/ 也 import 這個檔。 */
import type { UIMessage } from "ai";
import type { DecisionResult } from "../agent/decision.js";
import type { RetrievalRound, Settings, Trace } from "../agent/pipeline.js";
import type { Passage } from "../agent/retrieval-client.js";
import type { Verification } from "../agent/verify.js";

export type { DecisionResult, Passage, RetrievalRound, Settings, Trace, Verification };

export interface RagMetadata {
  conversationId?: string;
  /** 存進 SQLite 後的 id，回饋（👍/👎）用。 */
  messageId?: number;
  latencyMs?: number;
  rating?: number;
}

export type RagData = {
  status: { text: string };
  decision: DecisionResult;
  retrieval: RetrievalRound;
  sources: Passage[];
  tool: Trace["tools"][number];
  verify: Verification;
};

export type RagUIMessage = UIMessage<RagMetadata, RagData>;

export interface UserView {
  id: string;
  name: string;
  groups: string[];
}

export interface ConversationView {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
}

export interface SettingsView {
  mode: Settings["mode"];
  rerank: boolean;
  showTrace: boolean;
}
