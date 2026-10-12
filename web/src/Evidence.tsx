import { useState } from "react";
import type { Passage } from "../../src/shared/ui";

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", pptx: "PPT", docx: "Word", md: "Markdown", txt: "文字" };

/** 去掉引用 id、Markdown 符號和標點，只留下用來比對的字。 */
const plain = (s: string) => s.replace(/\[?[a-z0-9][a-z0-9-]*#\d+\]?/gi, "").replace(/[*`_#>|]/g, "").replace(/[\s\p{P}]/gu, "");

const bigrams = (s: string) => {
  const t = plain(s);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};

/** 回答裡引用了這個片段的句子。 */
function citingSentences(answer: string, id: string): string[] {
  return answer
    .split(/\n|(?<=[。！？])/)
    .filter((s) => s.toLowerCase().includes(id));
}

/**
 * 片段裡哪幾行是回答真正用到的：跟「引用這個片段的句子」字詞重疊最多的行。
 * 找不到明顯的就整塊都算（至少還有頁面上的位置可以看）。
 */
export function matchLines(answer: string, p: Passage): Set<number> {
  const lines = p.lines ?? [];
  const target = new Set(citingSentences(answer, p.id).flatMap((s) => [...bigrams(s)]));
  if (!lines.length || !target.size) return new Set(lines.map((_, i) => i));
  const scores = lines.map((l) => {
    const b = bigrams(l.t);
    let hit = 0;
    for (const x of b) if (target.has(x)) hit++;
    return b.size ? hit / b.size : 0;
  });
  const best = Math.max(...scores);
  if (best < 0.25) return new Set(lines.map((_, i) => i));
  return new Set(scores.map((s, i) => (s >= Math.max(0.25, best * 0.5) ? i : -1)).filter((i) => i >= 0));
}

function PageShot({ p, marked }: { p: Passage; marked: Set<number> }) {
  const [zoom, setZoom] = useState(false);
  const docId = p.id.split("#")[0];
  const src = `/api/docs/${docId}/pages/${p.page}`;
  const boxes = (p.lines ?? []).map((l, i) => ({ b: l.b, on: marked.has(i) }));
  const shot = (big: boolean) => (
    <div className={`shot ${big ? "big" : ""}`} onClick={() => setZoom(!big)} title={big ? "點一下關閉" : "點一下放大"}>
      <img src={src} alt={`${p.title} 第 ${p.page} 頁`} loading="lazy" />
      {boxes.map(({ b, on }, i) => (
        <span
          key={i}
          className={`hl ${on ? "on" : ""}`}
          style={{ left: `${b[0] * 100 - 0.6}%`, top: `${b[1] * 100 - 0.4}%`, width: `${(b[2] - b[0]) * 100 + 1.2}%`, height: `${(b[3] - b[1]) * 100 + 0.8}%` }}
        />
      ))}
    </div>
  );
  return (
    <>
      {shot(false)}
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(false)}>
          {shot(true)}
        </div>
      )}
    </>
  );
}

/** 一張證據卡：文件、頁碼、原文（標出用到的行）、頁面截圖（框出位置）。 */
export function EvidenceCard({ p, n, answer, open, onToggle }: { p: Passage; n: number; answer: string; open: boolean; onToggle: () => void }) {
  const docId = p.id.split("#")[0];
  const marked = matchLines(answer, p);
  const hasPage = Boolean(p.page && p.file_type && p.file_type !== "md" && p.file_type !== "txt");
  const where = !p.page ? p.section : p.file_type === "pptx" ? `第 ${p.page} 張投影片` : `第 ${p.page} 頁`;
  return (
    <div className={`evidence ${open ? "open" : ""}`} id={`ev-${p.id}`}>
      <button className="ev-head" onClick={onToggle}>
        <span className="num">{n}</span>
        <span className="ev-type">{TYPE_LABEL[p.file_type ?? "md"] ?? p.file_type}</span>
        <span className="source-title">{p.title}</span>
        <span className="muted">› {where}</span>
        <span className="muted id">{p.id}</span>
      </button>
      {open && (
        <div className="ev-body">
          <div className="ev-quote">
            {p.lines?.length
              ? p.lines.map((l, i) => (
                  <div key={i} className={marked.has(i) ? "q on" : "q"}>
                    {l.t}
                  </div>
                ))
              : <pre>{p.content}</pre>}
          </div>
          {hasPage && <PageShot p={p} marked={marked} />}
          <div className="ev-links">
            {hasPage && (
              <a href={`/api/docs/${docId}/file#page=${p.page}`} target="_blank" rel="noreferrer noopener">
                開啟原文第 {p.page} 頁 ↗
              </a>
            )}
            {hasPage && <a href={`/api/docs/${docId}/file?original=1`}>下載原始檔</a>}
            {/^https?:\/\//.test(p.source) && (
              <a href={p.source} target="_blank" rel="noreferrer noopener">
                來源 ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
