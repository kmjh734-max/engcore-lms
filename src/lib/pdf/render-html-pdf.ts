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

/*
 * 워크북 「(계속)」 마지막 쪽이 PDF에서 비는 것(선생님 2026-11-10): 워크북은 한 유형을 단으로 길게 흘려 쪽마다 한 단씩
 * 보여 준다. 화면에서 마지막 단에 두세 줄만 넘어간 유형은, 인쇄(PDF) 글자 폭이 화면과 아주 조금 달라 그 줄이 앞 단에 다
 * 들어가고 마지막 쪽에 머리글만 남았다(내용은 빠지지 않는다). 화면 배치로는 알 수 없어, 만든 PDF의 글자로 확인한다.
 * 빈 쪽은 PDF의 Subject에 「engcore-skip:쪽,쪽」으로 적어 두고 합칠 때 뺀다(저장소에 둔 PDF에도 남는다).
 */
/** box: 본문 칸의 자리(쪽 왼쪽 위 기준 CSS px) */
type TailCandidate = { index: number; box: { left: number; top: number; right: number; bottom: number } };
export const PDF_SKIP_PREFIX = "engcore-skip:";

/** 서버 Chrome 안에서 돈다: 여러 쪽으로 이어지는 유형의 마지막 쪽 중 글이 몇 줄 안 되는 쪽(쪽 차례·머리글 글자 수) */
function findTailWindowCandidates(): TailCandidate[] {
  const out: TailCandidate[] = [];
  Array.from(document.body.children).forEach((piece, index) => {
    const body = piece.querySelector<HTMLElement>("[data-wb-window]");
    const m = /^(\d+)\/(\d+)$/.exec(body?.dataset.wbWindow ?? "");
    if (!body || !m || m[1] !== m[2] || m[2] === "1") return;
    const br = body.getBoundingClientRect();
    let lines = 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && lines <= 12; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of Array.from(range.getClientRects())) {
        if (q.width > 0 && q.right > br.left && q.left < br.right && q.bottom > br.top && q.top < br.bottom) lines++;
      }
    }
    if (lines > 12) return;
    const pr = piece.getBoundingClientRect();
    out.push({ index, box: { left: br.left - pr.left, top: br.top - pr.top, right: br.right - pr.left, bottom: br.bottom - pr.top } });
  });
  return out;
}

/** 만든 PDF에서 후보 쪽의 글자를 읽어, 머리글·쪽 번호 말고 글자가 없으면 빈 쪽으로 적는다 */
async function markEmptyTailPages(pdf: Uint8Array, candidates: TailCandidate[]): Promise<Uint8Array> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true }).promise;
  const empty: number[] = [];
  try {
    for (const c of candidates) {
      if (c.index >= doc.numPages) continue;
      const pg = await doc.getPage(c.index + 1);
      const pageH = pg.getViewport({ scale: 1 }).height;
      const content = await pg.getTextContent();
      /*
       * 본문 칸 안에 놓인 글자만 센다 — 옆 단 글자도 PDF 안에는 그려져 있고(잘려서 안 보일 뿐) 글자 읽기에는 잡힌다.
       * PDF 단위(pt, 아래가 0)를 CSS px(위가 0)로: px = pt / 0.75.
       */
      let inside = 0;
      for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
        const text = String(it.str ?? "").replace(/\s+/g, "");
        if (!text || !it.transform) continue;
        const x = it.transform[4]! / 0.75;
        const y = (pageH - it.transform[5]!) / 0.75;
        if (x >= c.box.left - 2 && x < c.box.right - 2 && y > c.box.top && y < c.box.bottom + 6) inside += text.length;
      }
      if (inside === 0) empty.push(c.index);
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  if (empty.length === 0) return pdf;
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.load(pdf);
  out.setSubject(`${PDF_SKIP_PREFIX}${empty.join(",")}`);
  return await out.save({ useObjectStreams: true });
}

/*
 * CSS·글꼴·그림을 서버 안에 기억해 두고 쪽 묶음마다 다시 받지 않는다(선생님 2026-11-10 「속도만 빠르게」). 운영에서
 * 묶음 하나 9초 중 쪽을 넣고 CSS·글꼴을 받는 데 평균 4.8초(최대 16.6초)였다 — 묶음마다 새 탭이 같은 파일을 인터넷으로
 * 다시 받았다. 한 서버가 여러 묶음을 동시에 맡으므로(유동 실행) 한 번 받은 파일은 다른 묶음도 바로 쓴다.
 */
type Asset = { status: number; headers: Record<string, string>; body: Buffer };
const ga = globalThis as typeof globalThis & { __pdfAssets?: Map<string, Promise<Asset | null>>; __pdfAssetBytes?: number };
const assets: Map<string, Promise<Asset | null>> = (ga.__pdfAssets ??= new Map());
const ASSET_BYTES_LIMIT = 120 * 1024 * 1024;
const ASSET_TYPES = new Set(["stylesheet", "font", "image"]);

async function fetchAsset(url: string, headers: Record<string, string>): Promise<Asset | null> {
  const res = await fetch(url, { headers: { "user-agent": headers["user-agent"] ?? "", accept: headers.accept ?? "*/*" } });
  if (!res.ok) return null;
  const body = Buffer.from(await res.arrayBuffer());
  return {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      // 사이트 주소에서 그리지만, 다른 곳(구글 글꼴·Supabase)의 글꼴도 막히지 않게
      "access-control-allow-origin": "*",
    },
    body,
  };
}

async function serveAsset(req: import("puppeteer-core").HTTPRequest): Promise<void> {
  const url = req.url();
  if (req.method() !== "GET" || !ASSET_TYPES.has(req.resourceType()) || url.startsWith("data:") || url.startsWith("blob:")) {
    await req.continue().catch(() => undefined);
    return;
  }
  let job = assets.get(url);
  if (!job) {
    job = fetchAsset(url, req.headers()).catch(() => null);
    assets.set(url, job);
    void job.then((a) => {
      if (!a) {
        assets.delete(url);
        return;
      }
      ga.__pdfAssetBytes = (ga.__pdfAssetBytes ?? 0) + a.body.length;
      // 넘치면 오래된 것부터 버린다
      while ((ga.__pdfAssetBytes ?? 0) > ASSET_BYTES_LIMIT && assets.size > 1) {
        const oldest = assets.keys().next().value!;
        const old = assets.get(oldest);
        assets.delete(oldest);
        void old?.then((o) => (ga.__pdfAssetBytes = (ga.__pdfAssetBytes ?? 0) - (o?.body.length ?? 0)));
      }
    });
  }
  const asset = await job;
  if (asset) await req.respond(asset).catch(() => undefined);
  else await req.continue().catch(() => undefined);
}

export async function renderHtmlToPdf(
  html: string,
  paper: { w: number; h: number },
  origin: string,
  /** 단계마다 걸린 시간(ms)을 적어 준다 — 응답 머리(Server-Timing)로 내보내 어디가 느린지 본다 */
  timing?: Record<string, number>
): Promise<Uint8Array> {
  let t = Date.now();
  const lap = (name: string) => {
    if (timing) timing[name] = Date.now() - t;
    t = Date.now();
  };
  const browser = await getBrowser(origin);
  lap("browser");
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    /*
     * 쪽 HTML을 빈 문서(about:blank, 주소 없음)에 넣으면 우리 사이트의 /fonts/print 글꼴이 「다른 사이트 글꼴」로 막혀(CORS)
     * PDF가 Source Serif 4·IBM Plex Sans KR 대신 기본 글꼴(Times 등)로 나왔다 — 2026-11-06 인쇄 글꼴을 그 폴더로 옮긴 뒤.
     * 줄바꿈이 달라져 워크북 「(계속)」 쪽이 비기도 했다(선생님 2026-11-10). 사이트 주소의 빈 쪽을 열어 두고(요청은 여기서
     * 바로 답한다) 그 위에 넣으면 같은 사이트 글꼴이 된다.
     */
    const blankUrl = `${origin}/__pdf-render-blank`;
    page.on("request", (req) => {
      if (req.url() === blankUrl) {
        void req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title></title>" });
        return;
      }
      if (!allowed(req.url(), origin)) {
        void req.abort();
        return;
      }
      void serveAsset(req);
    });
    await page.goto(blankUrl, { waitUntil: "load", timeout: 10_000 });
    // 예전 그림 저장과 같은 모양이 나오게 화면용 CSS로 그린다(인쇄용 CSS는 화면 밖 요소를 숨긴다).
    await page.emulateMediaType("screen");
    /*
     * networkidle0은 요청이 끝나고도 0.5초를 더 쉬었다 — 묶음마다 0.5초(2026-11-10 속도). CSS·그림이 들어오는 load까지만
     * 기다리고, 배치를 한 번 시켜 글꼴 받기를 시작하게 한 뒤 글꼴을 기다린다.
     */
    await page.setContent(html, { waitUntil: "load", timeout: 40_000 });
    lap("content");
    await page.evaluate("void document.body.offsetHeight; document.fonts.ready.then(() => 1)").catch(() => undefined);
    lap("fonts");
    /*
     * 반투명 효과를 불투명으로(받은 PDF를 인쇄할 때 스풀링이 느리지 않게 — 2026-11-06). 예전엔 「PDF로 저장」을 누를 때
     * 브라우저에서 화면 전체를 바꾼 뒤 떠 보냈는데, 그러면 미리 만들어 둔 쪽과 HTML이 달라 누를 때마다 전부 새로
     * 만들었다(선생님 2026-11-09 「PDF 저장이 너무 오래 걸린다」). 이제 서버 Chrome이 그리기 직전에 바꾼다.
     */
    await page
      // __name: 번들러(esbuild 등)가 함수 이름을 지키려고 끼워 넣는 도우미 — 서버 Chrome에는 없으니 빈 것으로 둔다
      .evaluate(`var __name = (f) => f; (${flattenForPrint.toString()})(document.body, { images: false }); void 0`)
      .catch((e) => console.warn("[pdf] 불투명 바꾸기 실패", e));
    lap("flatten");
    const candidates = await page
      .evaluate(`var __name = (f) => f; (${findTailWindowCandidates.toString()})()`)
      .then((v) => v as TailCandidate[])
      .catch(() => [] as TailCandidate[]);
    const pdf = await page.pdf({
      width: `${paper.w}mm`,
      height: `${paper.h}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: 40_000,
    });
    lap("pdf");
    if (candidates.length === 0) return pdf;
    const marked = await markEmptyTailPages(pdf, candidates).catch((e) => {
      console.warn("[pdf] 빈 쪽 찾기 실패", e);
      return pdf;
    });
    lap("tail");
    return marked;
  } finally {
    await page.close().catch(() => undefined);
  }
}
