import type { ReactNode } from "react";

/**
 * 很小的 Markdown 子集（粗體、行內程式碼、條列、標題、引用 id），直接產生 React 節點。
 * 不用 dangerouslySetInnerHTML：回答的內容來自模型和文件，都當成不可信。
 */
const CITE_ID = /^[a-z0-9][a-z0-9-]*#\d+$/i;

function inline(text: string, cite: (id: string) => ReactNode, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[?(?<![\w-])[a-z0-9][a-z0-9-]*#\d+\]?)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) {
      // `aiops#12` 這種包在 code 裡的引用也當引用
      const inner = tok.slice(1, -1);
      out.push(CITE_ID.test(inner) ? <span key={k}>{cite(inner.toLowerCase())}</span> : <code key={k}>{inner}</code>);
    } else out.push(<span key={k}>{cite(tok.replace(/^\[|\]$/g, "").toLowerCase())}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, cite }: { text: string; cite: (id: string) => ReactNode }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (k: string) => {
    if (list.length) blocks.push(<ul key={`ul-${k}`}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw, n) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[*\-•]|\d+\.)\s+(.*)$/);
    if (bullet) return void list.push(<li key={n}>{inline(bullet[1], cite, `l${n}`)}</li>);
    flush(String(n));
    if (!line.trim()) return;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) return void blocks.push(<p key={n} className="md-h">{inline(h[1], cite, `h${n}`)}</p>);
    blocks.push(<p key={n}>{inline(line, cite, `p${n}`)}</p>);
  });
  flush("end");
  return <div className="md">{blocks}</div>;
}
