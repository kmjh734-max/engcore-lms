import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { flattenForPrint } from "@/lib/print/flatten-for-print";

/**
 * 쪽 HTML을 서버의 Chrome으로 PDF로 만든다(글자가 글자로 남는다). /api/pdf/render가 쓴다.
 * 받은 HTML은 스크립트를 끄고 그리며, origin·구글 글꼴·Supabase 말고는 접속하지 않는다.
 */
const WINDOWS_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
/*
 * 개발 서버는 코드가 다시 컴파일될 때마다 이 모듈을 새로 읽어 변수가 null로 돌아간다. 그러면 Chrome을 또 띄우고
 * 예전 Chrome은 꺼지지 않은 채 남았다(2026-11-09 개발 서버 밑에 Chrome 9개·수 GB). 그래서 globalThis에 둔다.
 */
const g = globalThis as typeof globalThis & { __pdfBrowserPromise?: Promise<Browser> | null };
let browserPromise: Promise<Browser> | null = g.__pdfBrowserPromise ?? null;
/** 한글 글꼴을 깔았는지(자가 시험에서 본다) */
let fontNote = "";
export function pdfServerDiagnostics() {
  return { fontNote, home: process.env.HOME, fontconfig: process.env.FONTCONFIG_PATH, ld: process.env.LD_LIBRARY_PATH };
}

async function getBrowser(origin: string): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
    browserPromise = null;
    g.__pdfBrowserPromise = null;
  }
  browserPromise = (async () => {
    const local = process.env.CHROME_PATH || (existsSync(WINDOWS_CHROME) ? WINDOWS_CHROME : "");
    if (process.platform === "linux" && !process.env.CHROME_PATH) {
      /*
       * @sparticuz/chromium은 실행 환경 이름이 Node 20·22일 때만 Chrome이 쓰는 시스템 라이브러리(al2023:
       * libnss3 등)를 풀어 놓는다. Vercel은 더 새 Node라 이름이 맞지 않아 「libnss3.so 없음」으로 Chrome이
       * 뜨지 않았다(2026-10-20, 그래서 늘 그림 PDF로 되돌아갔다). 불러오기 전에 Node 22로 알려 준다.
       */
      const env = process.env.AWS_EXECUTION_ENV ?? "";
      if (!/2[02]\.x/.test(env)) process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs22.x";
      const chromium = (await import("@sparticuz/chromium")).default;
      // executablePath가 글꼴 설정(/tmp/fonts/fonts.conf)을 풀어 놓는다. 그 뒤에 한글 글꼴을 넣는다.
      const executablePath = await chromium.executablePath();
      /*
       * 서버리스 Chrome에는 한글 시스템 글꼴이 없어, 웹 글꼴을 쓰지 않은 글자가 빈칸으로 나왔다.
       * chromium.font()는 $HOME/.fonts(/tmp/.fonts)에 받는데 글꼴 설정은 /tmp/fonts만 본다(2026-10-20 확인).
       * 그래서 /tmp/fonts에 직접 받는다.
       */
      fontNote = await installKoreanFont(origin);
      return puppeteer.launch({
        args: chromium.args,
        executablePath,
        headless: true,
        defaultViewport: { width: 1240, height: 1754 },
      });
    }
    return puppeteer.launch({ executablePath: local, headless: true, args: ["--no-sandbox"] });
  })();
  g.__pdfBrowserPromise = browserPromise;
  return browserPromise;
}

async function installKoreanFont(origin: string): Promise<string> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const target = "/tmp/fonts/NotoSansKR-Regular.otf";
  if (existsSync(target)) return "ok cached";
  try {
    const res = await fetch(`${origin}/fonts/NotoSansKR-Regular.otf`);
    if (!res.ok) return `fail ${res.status}`;
    mkdirSync("/tmp/fonts", { recursive: true });
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    return "ok";
  } catch (e) {
    return `fail ${String(e)}`;
  }
}

function allowed(url: string, origin: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return true;
  try {
    const u = new URL(url);
    if (u.origin === origin) return true;
    return (
      u.protocol === "https:" &&
      (u.hostname === "fonts.googleapis.com" ||
        u.hostname === "fonts.gstatic.com" ||
        u.hostname.endsWith(".supabase.co"))
    );
  } catch {
    return false;
  }
}

export async function renderHtmlToPdf(
  html: string,
  paper: { w: number; h: number },
  origin: string
): Promise<Uint8Array> {
  const browser = await getBrowser(origin);
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (allowed(req.url(), origin)) void req.continue();
      else void req.abort();
    });
    // 예전 그림 저장과 같은 모양이 나오게 화면용 CSS로 그린다(인쇄용 CSS는 화면 밖 요소를 숨긴다).
    await page.emulateMediaType("screen");
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 40_000 });
    // 스크립트를 꺼도 page.pdf는 글꼴이 다 들어오기를 기다린다. 혹시 몰라 한 번 더 기다린다.
    await page.evaluateHandle("document.fonts.ready").catch(() => undefined);
    /*
     * 반투명 효과를 불투명으로(받은 PDF를 인쇄할 때 스풀링이 느리지 않게 — 2026-11-06). 예전엔 「PDF로 저장」을 누를 때
     * 브라우저에서 화면 전체를 바꾼 뒤 떠 보냈는데, 그러면 미리 만들어 둔 쪽과 HTML이 달라 누를 때마다 전부 새로
     * 만들었다(선생님 2026-11-09 「PDF 저장이 너무 오래 걸린다」). 이제 서버 Chrome이 그리기 직전에 바꾼다.
     */
    await page
      // __name: 번들러(esbuild 등)가 함수 이름을 지키려고 끼워 넣는 도우미 — 서버 Chrome에는 없으니 빈 것으로 둔다
      .evaluate(`var __name = (f) => f; (${flattenForPrint.toString()})(document.body, { images: false }); void 0`)
      .catch((e) => console.warn("[pdf] 불투명 바꾸기 실패", e));
    return await page.pdf({
      width: `${paper.w}mm`,
      height: `${paper.h}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: 40_000,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}
