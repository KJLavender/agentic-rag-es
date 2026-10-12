import { meaningfulLength } from "./chunk.js";
import type { PageLine, PdfPage } from "./pdf.js";

export interface PageChunk {
  page: number;
  headingPath: string;
  content: string;
  /** 片段裡的每一行（含位置），前端在截圖上框證據用。 */
  lines: PageLine[];
}

/** 比對頁首頁尾時忽略數字和空白（「第 3 / 5 頁」每頁不同）。 */
const norm = (t: string) => t.replace(/\d+/g, "#").replace(/\s+/g, "");

/** 同一行文字出現在一半以上的頁面、而且在頁面最上或最下 12%：當成頁首／頁尾，不索引。 */
export function boilerplateLines(pages: PdfPage[]): Set<string> {
  if (pages.length < 2) return new Set();
  const count = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set(p.lines.filter((l) => l.box[1] < 0.12 || l.box[3] > 0.88).map((l) => norm(l.text)));
    for (const k of seen) count.set(k, (count.get(k) ?? 0) + 1);
  }
  // 兩頁的文件要兩頁都出現才算；三頁以上出現在一半以上的頁面就算
  const min = pages.length === 2 ? 2 : Math.max(3, Math.ceil(pages.length / 2));
  return new Set([...count].filter(([, n]) => n >= min).map(([k]) => k));
}

/**
 * PDF 的自動換行會把詞切斷（「抽\n樣」），BM25 就斷不出「抽樣」。依情況接回去：
 * 上一行是句尾標點、或下一行是條列編號／新段落 → 保留換行；兩邊都是英數 → 補空白；其他（中文接續）→ 直接接。
 */
export function joinLines(lines: { text: string; size?: number }[]): string {
  let out = "";
  lines.forEach((l, i) => {
    if (i === 0) return void (out = l.text);
    const prev = out.slice(-1);
    const next = l.text[0] ?? "";
    // 字體大小差很多（標題接內文）也保留換行
    const a = lines[i - 1].size ?? 0;
    const b = l.size ?? 0;
    const sizeJump = a && b && Math.max(a, b) / Math.min(a, b) > 1.15;
    // 只看全形句尾標點：半形的 ? : ; 常出現在網址和指令裡（snap?wait_for_completion）
    if (sizeJump || /[。：；！？）」』]/.test(prev) || /^(\d+[.、)]|[•\-*‧●○■□]|注意|禁止|[（(]\d)/.test(l.text)) out += "\n";
    else if (/[A-Za-z0-9,]/.test(prev) && /[A-Za-z0-9]/.test(next)) out += " ";
    out += l.text;
  });
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * PDF：依頁面切塊；字明顯比內文大的短行當成章節標題，跨頁延續（「5. 資料還原步驟（第 2 頁）」）。
 * 投影片：一張就是一塊，標題用該頁字最大的那一行（「投影片 3｜Q3 重點成果」）。
 * 不做重疊：每一行只屬於一塊，證據框線才不會重複。
 */
export function chunkPages(pages: PdfPage[], kind: "page" | "slide", maxChars = 600): PageChunk[] {
  const bp = boilerplateLines(pages);
  const clean = pages.map((p) => ({ page: p.page, lines: p.lines.filter((l) => !bp.has(norm(l.text))) }));
  const bodySize = median(clean.flatMap((p) => p.lines.map((l) => l.size)));
  const isHeading = (l: PageLine) => l.size >= bodySize * 1.2 && l.text.length <= 40;

  const out: PageChunk[] = [];
  let heading = "";
  for (const p of clean) {
    if (!p.lines.length) continue;
    if (kind === "slide") {
      const title = p.lines.reduce((a, b) => (b.size > a.size ? b : a)).text;
      const limit = Math.round(maxChars * 1.5);
      for (let i = 0; i < p.lines.length; ) {
        const lines: PageLine[] = [];
        let len = 0;
        while (i < p.lines.length && (len === 0 || len + p.lines[i].text.length <= limit)) {
          lines.push(p.lines[i]);
          len += p.lines[i].text.length + 1;
          i++;
        }
        out.push({ page: p.page, headingPath: `投影片 ${p.page}｜${title}`, content: joinLines(lines), lines });
      }
      continue;
    }

    let cur: PageLine[] = [];
    let curHeading = heading;
    const flush = () => {
      if (cur.length) out.push({ page: p.page, headingPath: `${curHeading ? `${curHeading}` : "（無標題）"}（第 ${p.page} 頁）`, content: joinLines(cur), lines: cur });
      cur = [];
    };
    for (const l of p.lines) {
      const len = cur.reduce((n, x) => n + x.text.length + 1, 0);
      // 遇到新標題：前面累積夠多就先切開，讓一個章節盡量在同一塊
      if (isHeading(l) && len > 150) flush();
      if (len + l.text.length > maxChars && cur.length) flush();
      if (isHeading(l)) heading = l.text;
      if (!cur.length) curHeading = heading;
      cur.push(l);
    }
    flush();
  }
  return out.filter((c) => meaningfulLength(c.content) >= 15);
}
