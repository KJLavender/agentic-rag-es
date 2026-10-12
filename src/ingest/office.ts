/**
 * PPTX / DOCX → PDF（LibreOffice headless），之後跟 PDF 走同一條路：一頁 = 一張投影片，可以截圖、框證據。
 * Linux / Docker 直接呼叫 soffice；Windows 本機開發時透過 WSL 裡的 soffice。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const useWsl = process.platform === "win32" && !process.env.SOFFICE_PATH;

/** C:\Users\x → /mnt/c/Users/x */
const toWslPath = (p: string) => resolve(p).replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, "/");

export async function officeToPdf(data: Buffer, ext: string): Promise<Buffer> {
  // WSL 讀得到 Windows 的檔案，但 %TEMP% 有時被防毒鎖；放在專案的 .cache 底下比較穩
  const base = useWsl ? resolve(".cache/convert") : tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "office-"));
  try {
    const input = join(dir, `input.${ext}`);
    writeFileSync(input, data);
    // 每次轉檔用獨立的 profile，避免同時執行時互相鎖住
    const profile = `file://${useWsl ? toWslPath(dir) : dir}/profile`;
    const args = ["--headless", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir"];
    if (useWsl) await run("wsl", ["--", "soffice", ...args, toWslPath(dir), toWslPath(input)], { timeout: 180_000 });
    else await run(process.env.SOFFICE_PATH ?? "soffice", [...args, dir, input], { timeout: 180_000 });
    const out = join(dir, `${basename(input, `.${ext}`)}.pdf`);
    if (!existsSync(out)) throw new Error(`LibreOffice 沒有產生 PDF（${ext}）`);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
