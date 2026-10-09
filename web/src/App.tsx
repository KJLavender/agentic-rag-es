import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationView, RagUIMessage, SettingsView, UserView } from "../../src/shared/ui";
import { api } from "./api";
import { AssistantMessage } from "./Message";
import { Documents } from "./Documents";

const MODES: { value: SettingsView["mode"]; label: string }[] = [
  { value: "auto", label: "自動（決策層選）" },
  { value: "hybrid", label: "hybrid（BM25 + 向量）" },
  { value: "vector", label: "vector（語意）" },
  { value: "keyword", label: "keyword（BM25）" },
  { value: "cascade", label: "cascade（先關鍵字再補語意）" },
];

const EXAMPLES = ["AIOps v2 為什麼要把 agent 拆開？", "整天開著電腦跑 japan-trip-bot，電費大概多少？", "acp-pet 哪些動作要我按准？"];

export function App() {
  const [user, setUser] = useState<UserView | null>(null);
  const [users, setUsers] = useState<UserView[]>([]);
  const [settings, setSettings] = useState<SettingsView>({ mode: "auto", rerank: false, showTrace: true });
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [status, setStatus] = useState("");
  const [input, setInput] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const convRef = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  convRef.current = conversationId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<RagUIMessage>({
        api: "/api/chat",
        // 歷史由伺服器從 SQLite 讀，前端只送這一題
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1];
          const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          return { body: { conversationId: convRef.current, text } };
        },
      }),
    [],
  );

  const refreshConversations = useCallback(() => api.conversations().then(setConversations), []);

  const { messages, sendMessage, setMessages, status: chatStatus, stop, error } = useChat<RagUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === "data-status") setStatus(part.data.text);
    },
    onFinish: ({ message }) => {
      setStatus("");
      if (message.metadata?.conversationId) setConversationId(message.metadata.conversationId);
      refreshConversations();
    },
    onError: () => setStatus(""),
  });
  const busy = chatStatus === "submitted" || chatStatus === "streaming";

  const loadMe = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setSettings(me.settings);
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    loadMe();
    api.users().then(setUsers);
  }, [loadMe]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const newChat = () => {
    setConversationId(undefined);
    setMessages([]);
  };
  const openChat = async (id: string) => {
    const c = await api.conversation(id);
    setConversationId(c.id);
    setMessages(c.messages);
  };
  const removeChat = async (id: string) => {
    await api.deleteConversation(id);
    if (id === conversationId) newChat();
    refreshConversations();
  };
  const switchUser = async (id: string) => {
    await api.login(id);
    newChat();
    setShowDocs(false);
    loadMe();
  };
  const updateSettings = async (patch: Partial<SettingsView>) => setSettings(await api.saveSettings(patch));
  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text: text.trim() });
    setInput("");
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Agentic RAG</h1>
        <button className="primary" onClick={newChat}>＋ 新對話</button>

        <div className="conversations">
          {conversations.map((c) => (
            <div key={c.id} className={`conv ${c.id === conversationId ? "active" : ""}`}>
              <button className="conv-title" onClick={() => openChat(c.id)} title={new Date(c.updatedAt).toLocaleString("zh-TW")}>
                {c.title}
                <span className="muted"> · {c.turns}</span>
              </button>
              <button className="icon" onClick={() => removeChat(c.id)} title="刪除">×</button>
            </div>
          ))}
          {!conversations.length && <p className="muted small">還沒有對話</p>}
        </div>

        <div className="panel">
          <label>
            身分（示範用，決定看得到哪些文件）
            <select value={user?.id ?? ""} onChange={(e) => switchUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label>
            檢索模式
            <select value={settings.mode} onChange={(e) => updateSettings({ mode: e.target.value as SettingsView["mode"] })}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.rerank} onChange={(e) => updateSettings({ rerank: e.target.checked })} />
            Cross-encoder rerank（較準，每題多 1～2 秒）
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showTrace} onChange={(e) => updateSettings({ showTrace: e.target.checked })} />
            顯示過程（決策、每輪檢索、工具）
          </label>
          {user?.groups.includes("admin") && (
            <button onClick={() => setShowDocs(!showDocs)}>{showDocs ? "回到對話" : "管理文件"}</button>
          )}
        </div>
      </aside>

      <main className="main">
        {showDocs && user ? (
          <Documents user={user} />
        ) : (
          <>
            <div className="messages">
              {!messages.length && (
                <div className="empty">
                  <p>問知識庫裡的文件內容，回答會附上來源，查不到就會說查不到。</p>
                  <div className="examples">
                    {EXAMPLES.map((q) => (
                      <button key={q} onClick={() => submit(q)}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id} className="msg user">
                    {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                  </div>
                ) : (
                  <AssistantMessage key={m.id} message={m} showTrace={settings.showTrace} streaming={busy && i === messages.length - 1} />
                ),
              )}
              {busy && status && <div className="status">⏳ {status}</div>}
              {error && <div className="status warn-text">⚠ {error.message || "發生錯誤"}</div>}
              <div ref={bottom} />
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
            >
              <textarea
                value={input}
                placeholder="問知識庫…（Enter 送出，Shift+Enter 換行）"
                maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
              />
              {busy ? (
                <button type="button" onClick={stop}>停止</button>
              ) : (
                <button type="submit" className="primary" disabled={!input.trim()}>送出</button>
              )}
            </form>
          </>
        )}
      </main>
    </div>
  );
}
