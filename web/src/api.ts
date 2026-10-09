import type { ConversationView, RagUIMessage, SettingsView, UserView } from "../../src/shared/ui";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface DocumentView {
  docId: string;
  title: string;
  acl: string[];
  source: string;
  chunks: number;
}

export const api = {
  me: () => call<{ user: UserView; settings: SettingsView }>("/api/me"),
  users: () => call<UserView[]>("/api/users"),
  login: (userId: string) => call("/api/login", { method: "POST", body: JSON.stringify({ userId }) }),
  saveSettings: (s: Partial<SettingsView>) => call<SettingsView>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  conversations: () => call<ConversationView[]>("/api/conversations"),
  conversation: (id: string) => call<{ id: string; title: string; messages: RagUIMessage[] }>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => call(`/api/conversations/${id}`, { method: "DELETE" }),
  feedback: (messageId: number, rating: number) => call("/api/feedback", { method: "POST", body: JSON.stringify({ messageId, rating }) }),
  documents: () => call<DocumentView[]>("/api/documents"),
  upload: (filename: string, content: string, acl: string[]) =>
    call<{ docId: string; chunks: number; embedded: number }>("/api/documents", { method: "POST", body: JSON.stringify({ filename, content, acl }) }),
};
