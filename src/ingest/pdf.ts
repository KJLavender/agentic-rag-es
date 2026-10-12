/**
 * PDF → 逐頁的文字行（含在頁面上的位置）＋ 每頁截圖。
 * 位置用 0～1 的比例（左上角為原點），前端可以直接在截圖上框出證據，不管圖片縮放多少。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

/** [x0, y0, x1, y1]，0～1，左上角為原點。 */
export type Box = [number, number, number, number];

export interface PageLine {
  text: string;
  box: Box;
  /** 字的高度（比例），拿來猜標題：通常是這一頁字最大的那行。 */
  size: number;
}

export interface PdfPage {
  page: number;
  lines: PageLine[];
}

interface Item {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data,
    cMapUrl: join(pdfjsRoot, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
    verbosity: 0,
  }).promise;
}

/**
 * 有些 PDF（例如 Chrome 用微軟正黑體列印的）會把漢字抽成康熙部首字元：「執⾏」的「⾏」是 U+2F8F 不是「行」，
 * 搜尋「執行」就對不到。只把部首區（U+2E80–U+2FDF）用 NFKC 轉回標準漢字，全形標點不動。
 */
// 部首補充區（U+2E80–U+2EFF）沒有 NFKC 對應，常見的手動對照；語料是繁體，所以對到繁體字
const RADICAL_SUPPLEMENT: Record<string, string> = {
  "⺌": "小", "⺍": "小", "⺕": "彐", "⺠": "民", "⺧": "牛", "⺪": "疋", "⺮": "竹", "⺳": "网",
  "⺷": "羊", "⺼": "肉", "⻄": "西", "⻅": "見", "⻆": "角", "⻈": "言", "⻉": "貝", "⻋": "車",
  "⻑": "長", "⻒": "長", "⻔": "門", "⻗": "雨", "⻘": "青", "⻚": "頁", "⻛": "風", "⻜": "飛",
  "⻝": "食", "⻟": "食", "⻢": "馬", "⻤": "鬼", "⻥": "魚", "⻦": "鳥", "⻩": "黃", "⻬": "齊",
  "⻮": "齒", "⻰": "龍", "⻳": "龜",
};
export const fixRadicals = (s: string) =>
  s.replace(/[⺀-⿟]/g, (c) => RADICAL_SUPPLEMENT[c] ?? c.normalize("NFKC"));

/** 把 pdfjs 的文字片段依 y 座標合成一行一行。 */
function toLines(items: Item[], width: number, height: number): PageLine[] {
  const pieces = items
    .filter((it) => it.str.trim())
    .map((it) => {
      const x = it.transform[4];
      const y = it.transform[5];
      const h = it.height || Math.abs(it.transform[3]) || 10;
      return { str: it.str, x0: x, x1: x + it.width, top: height - y - h, bottom: height - y, h };
    })
    .sort((a, b) => a.top - b.top || a.x0 - b.x0);

  const lines: (typeof pieces)[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l[0].top - p.top) < Math.max(l[0].h, p.h) * 0.5);
    if (line) line.push(p);
    else lines.push([p]);
  }
  return lines
    .map((l) => l.sort((a, b) => a.x0 - b.x0))
    .map((l) => {
      // 同一行相鄰片段之間有明顯空隙就補空白（英文單字、表格欄位）
      let text = "";
      l.forEach((p, i) => {
        if (i && p.x0 - l[i - 1].x1 > p.h * 0.3 && !/\s$/.test(text)) text += " ";
        text += p.str;
      });
      const x0 = Math.min(...l.map((p) => p.x0));
      const x1 = Math.max(...l.map((p) => p.x1));
      const top = Math.min(...l.map((p) => p.top));
      const bottom = Math.max(...l.map((p) => p.bottom));
      const r = (n: number) => Math.round(n * 10000) / 10000;
      return {
        text: fixRadicals(text).replace(/\s+/g, " ").trim(),
        box: [r(x0 / width), r(top / height), r(x1 / width), r(bottom / height)] as Box,
        size: r(Math.max(...l.map((p) => p.h)) / height),
      };
    })
    .filter((l) => l.text)
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

export async function readPdfPages(doc: PDFDocumentProxy): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ page: n, lines: toLines(content.items as Item[], width, height) });
    page.cleanup();
  }
  return pages;
}

/** 每頁存成 JPEG（寬約 1200px），給證據截圖用。 */
export async function renderPdfPages(doc: PDFDocumentProxy, outDir: string, targetWidth = 1200): Promise<number> {
  mkdirSync(outDir, { recursive: true });
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const scale = targetWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const factory = doc.canvasFactory as { create(w: number, h: number): { canvas: any; context: any } };
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    // 透明背景的 PDF 轉成 JPEG 會變黑底，先塗白
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    writeFileSync(join(outDir, `p${n}.jpg`), canvas.toBuffer("image/jpeg", 82));
    page.cleanup();
  }
  return doc.numPages;
}
