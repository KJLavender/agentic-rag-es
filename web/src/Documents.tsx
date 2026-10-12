import { useEffect, useState } from "react";
import type { UserView } from "../../src/shared/ui";
import { api, type DocumentView } from "./api";

/** 讀成 base64（不含 data: 前綴）。 */
const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** 上傳 Markdown / 文字 / PDF / PPTX / Word → 觸發 ingestion。acl 只能選自己有的群組。 */
export function Documents({ user }: { user: UserView }) {
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [acl, setAcl] = useState<string[]>(["admin"]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = ["public", ...user.groups];

  const load = () => api.documents().then(setDocs).catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
  }, []);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(/\.(pptx|docx)$/i.test(file.name) ? "轉成 PDF、擷取每頁截圖、切塊、計算 embedding 中…" : "切塊、計算 embedding 中…");
    try {
      const binary = /\.(pdf|pptx|docx)$/i.test(file.name);
      const r = await api.upload(file.name, binary ? { data: await toBase64(file) } : { content: await file.text() }, acl);
      setMsg(`已加入 ${r.docId}：${r.pages ? `${r.pages} 頁、` : ""}${r.chunks} 塊（新算 ${r.embedded} 個向量）`);
      setFile(null);
      load();
    } catch (e) {
      setMsg(`失敗：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="docs">
      <h2>文件</h2>
      <div className="upload">
        <input type="file" accept=".md,.txt,.pdf,.pptx,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span>誰看得到：</span>
        {groups.map((g) => (
          <label key={g} className="check inline">
            <input type="checkbox" checked={acl.includes(g)} onChange={(e) => setAcl(e.target.checked ? [...acl, g] : acl.filter((x) => x !== g))} />
            {g}
          </label>
        ))}
        <button className="primary" disabled={!file || !acl.length || busy} onClick={upload}>上傳並索引</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <table>
        <thead>
          <tr>
            <th>文件</th>
            <th>片段</th>
            <th>權限</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.docId}>
              <td>
                {d.title}
                <div className="muted small">{d.docId}</div>
              </td>
              <td>{d.chunks}</td>
              <td>{d.acl.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
