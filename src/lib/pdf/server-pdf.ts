"use client";

import type { PdfPaper } from "@/lib/pdf/download-sheets-pdf";

/**
 * 화면의 쪽들을 HTML로 떠서 서버(/api/pdf/render)의 Chrome으로 PDF를 만든다. 글자가 글자로 남는다.
 *
 * 선생님 말씀(2026-10-20): PDF 저장이 빨랐으면 좋겠고, 그림이 아니라 글자로 저장되게.
 *
 * 쪽만 떼어 보내면 조상에 걸린 모양(워크북 모양 A/B/C 같은 조상 클래스, #print-root 아래 규칙)이
 * 빠지므로, 쪽마다 조상 줄기를 껍데기만 복제해 감싼다. 조상의 여백·확대·변형은 지운다.
 * 쪽은 15쪽씩 나눠 동시에 만들고 pdf-lib로 한 파일로 합친다(요청·응답 크기 상한도 피한다).
 */

const CHUNK_PAGES = 15;
/** 서버 저장소 열쇠의 판 — /api/pdf/render 의 같은 값과 맞춘다 */
const PDF_CACHE_VERSION = "font2";
const CONCURRENCY = 16;

/** 조상 껍데기에서 지울 모양 — 쪽의 크기·위치를 바꾸지 않게 */
const NEUTRAL: Array<[string, string]> = [
  ["display", "block"],
  ["position", "static"],
  ["margin", "0"],
  ["padding", "0"],
  ["border", "0"],
  ["transform", "none"],
  ["zoom", "1"],
  ["width", "auto"],
  ["min-width", "0"],
  ["max-width", "none"],
  ["height", "auto"],
  ["min-height", "0"],
  ["max-height", "none"],
  ["overflow", "visible"],
  ["box-shadow", "none"],
  ["background", "transparent"],
  ["gap", "0"],
];

/** 쪽 하나를 복제한다. 그림판(canvas)은 그림으로, 입력 칸은 지금 값으로 박고, 화면 전용 표시는 뺀다. */
function clonePage(page: HTMLElement): HTMLElement {
  const clone = page.cloneNode(true) as HTMLElement;
  const oc = page.querySelectorAll("canvas");
  const cc = clone.querySelectorAll("canvas");
  oc.forEach((c, i) => {
    const img = document.createElement("img");
    try {
      img.src = c.toDataURL("image/png");
    } catch {
      return;
    }
    img.setAttribute("style", c.getAttribute("style") ?? "");
    img.className = c.className;
    img.width = c.width;
    img.height = c.height;
    img.style.width = `${c.offsetWidth}px`;
    img.style.height = `${c.offsetHeight}px`;
    cc[i]?.replaceWith(img);
  });
  const oi = page.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select");
  const ci = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select");
  oi.forEach((el, i) => {
    const c = ci[i];
    if (!c) return;
    if (el instanceof HTMLTextAreaElement) c.textContent = el.value;
    else if (el instanceof HTMLSelectElement) {
      Array.from((c as HTMLSelectElement).options).forEach((o, k) => {
        if (k === el.selectedIndex) o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      });
    } else if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked) c.setAttribute("checked", "");
      else c.removeAttribute("checked");
    } else c.setAttribute("value", el.value);
  });
  clone.querySelectorAll(".print\\:hidden, .no-print").forEach((n) => n.remove());
  // 미리보기 그림자·확대는 종이에 없다
  clone.style.setProperty("box-shadow", "none", "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("zoom", "1", "important");
  /*
   * 화면 밖 쪽 그리기 미루기(content-visibility:auto)는 서버 Chrome(화면용 CSS)에도 걸려, 워크북 쪽이 PDF에서 두 장으로
   * 쪼개졌다(2026-11-09 최종통합자료 115쪽 → 176쪽·22MB). 보낼 사본에서는 끈다.
   */
  if (getComputedStyle(page).contentVisibility === "auto") {
    clone.style.setProperty("content-visibility", "visible", "important");
    clone.style.setProperty("contain-intrinsic-size", "none", "important");
    // 미루기에 딸려 있던 「쪽 밖은 잘라 낸다」는 남긴다 — 빼면 워크북 옆 단 글자가 쪽 오른쪽에 비어져 나온다
    clone.style.setProperty("contain", "layout style paint", "important");
  }
  // 화면에서만 숨긴 쪽(정답지 탭 등)도 싣는다
  if (getComputedStyle(page).display === "none") clone.style.setProperty("display", "block", "important");
  return clone;
}

/** 쪽을 조상 껍데기로 감싼다. 바깥 껍데기를 돌려준다. */
function wrapWithAncestors(page: HTMLElement, clone: HTMLElement): HTMLElement {
  let node: HTMLElement = clone;
  for (let a = page.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const shell = a.cloneNode(false) as HTMLElement;
    for (const [k, v] of NEUTRAL) shell.style.setProperty(k, v, "important");
    shell.appendChild(node);
    node = shell;
  }
  // 조상이 없으면(쪽이 body 바로 아래) 쪽 나눔을 걸 껍데기를 하나 둔다
  if (node === clone) {
    const shell = document.createElement("div");
    shell.appendChild(node);
    node = shell;
  }
  return node;
}

function attrs(el: Element): string {
  const cls = el.getAttribute("class");
  const style = el.getAttribute("style");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `${cls ? ` class="${esc(cls)}"` : ""}${style ? ` style="${esc(style)}"` : ""}`;
}

/** 화면이 쓰는 CSS: 파일 CSS는 주소로(서버 Chrome이 받는다), 글 CSS는 내용으로 */
function collectCss(): string {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .filter((l) => l.href && !l.disabled)
    // 개발 서버는 CSS 주소에 여는 시각(?v=…)을 붙인다 — 그대로 두면 열 때마다 쪽 열쇠가 달라 저장해 둔 PDF를 못 쓴다
    .map((l) => {
      const href = l.href.replace(/([?&])v=\d+(&|$)/, (_m, a: string, b: string) => (b ? a : ""));
      return `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}"${l.media ? ` media="${l.media}"` : ""}>`;
    });
  const styles = Array.from(document.querySelectorAll("style")).map((s) => {
    try {
      const rules = s.sheet?.cssRules;
      if (rules) return Array.from(rules).map((r) => r.cssText).join("\n");
    } catch {
      /* 규칙을 못 읽으면 글 그대로 */
    }
    return s.textContent ?? "";
  });
  return `${links.join("")}<style>${styles.join("\n").replace(/<\/style/gi, "<\\/style")}</style>`;
}

/**
 * 쪽 하나를 보낼 HTML 조각(조상 껍데기로 감싼 쪽)과 긴 쪽인지.
 * 조각은 쪽 내용만으로 정해져 같은 쪽이면 늘 같다 — 쪽마다 만든 PDF를 기억해 두는 열쇠가 된다.
 */
type PagePiece = { html: string; tall: boolean };

/**
 * 쪽의 진짜 높이. 화면 밖이라 그리기를 미룬 쪽(content-visibility:auto)은 offsetHeight가 예전에 재 둔 크기를 그대로
 * 돌려준다 — 쪽을 나누는 도중의 긴 높이(워크북 1243px)가 남아 A4 쪽을 「긴 쪽」으로 보고 한 장씩 따로 보내 두 장으로
 * 쪼갰다(2026-11-09). 그런 쪽은 안의 내용 끝까지로 잰다(내용 위치는 물어보면 브라우저가 계산해 준다).
 */
function pageHeight(page: HTMLElement): number {
  const cs = getComputedStyle(page);
  if (cs.contentVisibility !== "auto") return page.offsetHeight;
  let bottom = 0;
  for (const c of Array.from(page.children) as HTMLElement[]) {
    const ccs = getComputedStyle(c);
    if (ccs.position === "absolute" || ccs.position === "fixed" || ccs.display === "none") continue;
    if (c.offsetParent !== page) return page.offsetHeight;
    bottom = Math.max(bottom, c.offsetTop + c.offsetHeight + (parseFloat(ccs.marginBottom) || 0));
  }
  const natural = bottom + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  return Math.max(natural, parseFloat(cs.minHeight) || 0);
}

function pieceOf(page: HTMLElement, paper: PdfPaper): PagePiece {
  const shell = wrapWithAncestors(page, clonePage(page));
  const pxPerMm = (page.offsetWidth || 1) / paper.w;
  const tall = pageHeight(page) > paper.h * pxPerMm * 1.02;
  // 종이 한 장짜리 쪽은 종이 크기로 자른다(소수점 차이로 빈 장이 끼지 않게). 긴 쪽은 이어지는 장으로 흘린다.
  if (!tall) {
    shell.style.setProperty("height", `${paper.h}mm`, "important");
    shell.style.setProperty("overflow", "hidden", "important");
  }
  return { html: shell.outerHTML, tall };
}

function documentHtml(head: string, pieces: string[], paper: PdfPaper): string {
  return `<!doctype html><html${attrs(document.documentElement)}><head><meta charset="utf-8"><base href="${location.href.replace(/"/g, "&quot;")}">${head}<style>@page{size:${paper.w}mm ${paper.h}mm;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important;height:auto!important;min-height:0!important}body>*:not(:last-child){break-after:page!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style></head><body${attrs(document.body)}>${pieces.join("")}</body></html>`;
}

export function buildHtml(pages: HTMLElement[], paper: PdfPaper): string {
  return documentHtml(collectCss(), pages.map((p) => pieceOf(p, paper).html), paper);
}

async function gzip(text: string): Promise<{ body: BodyInit; encoding: string }> {
  if (typeof CompressionStream === "undefined") return { body: text, encoding: "identity" };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).arrayBuffer(), encoding: "gzip" };
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/*
 * 브라우저 안 보관함(Cache Storage)에도 쪽 PDF를 둔다(선생님 2026-11-09 「화면에 들어가서 누르면 바로」). 서버 저장소에서
 * 찾아도 로그인 확인·저장소 받기로 한 번에 2초 남짓 걸렸다. 같은 컴퓨터에서 다시 열면 서버를 거치지 않고 바로 꺼낸다.
 */
const LOCAL_CACHE = "engcore-pdf-chunks-v1";
const LOCAL_LIMIT = 400;

async function localGet(key: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await (await caches.open(LOCAL_CACHE)).match(`/__pdf-chunk/${key}`);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function localPut(key: string, bytes: ArrayBuffer): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(LOCAL_CACHE);
    await cache.put(`/__pdf-chunk/${key}`, new Response(bytes.slice(0), { headers: { "Content-Type": "application/pdf" } }));
    // 오래된 것부터 지워 쌓이지 않게(keys는 넣은 차례)
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - LOCAL_LIMIT; i++) await cache.delete(keys[i]!);
  } catch {
    /* 보관함이 막혀 있으면(사생활 보호 창 등) 넘어간다 */
  }
}

/**
 * 서버 저장소에 같은 쪽 PDF가 있으면 그것만 받는다(선생님 2026-11-09 「PDF 저장 누르면 바로」): 예전엔 저장해 둔
 * 쪽이어도 묶음마다 쪽 HTML(수 MB)을 올려 보내 찾느라 121쪽에 25초가 걸렸다. 지문(해시)만 보내 묻는다.
 */
async function cachedChunk(key: string, paper: PdfPaper): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("/api/pdf/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, paper }),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function renderChunk(html: string, paper: PdfPaper): Promise<ArrayBuffer> {
  const key = await sha256Hex(`${PDF_CACHE_VERSION}|${paper.w}x${paper.h}|${html}`);
  if (key) {
    const local = await localGet(key);
    if (local) return local;
    const hit = await cachedChunk(key, paper);
    if (hit) {
      void localPut(key, hit);
      return hit;
    }
  }
  const { body, encoding } = await gzip(JSON.stringify({ html, paper }));
  const res = await fetch("/api/pdf/render", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-body-encoding": encoding },
    body,
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) {
    throw new Error((await res.text().catch(() => "")).slice(0, 200) || `PDF 서버 오류 (${res.status})`);
  }
  const bytes = await res.arrayBuffer();
  if (key) void localPut(key, bytes);
  return bytes;
}

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${text.length.toString(36)}`;
}

/*
 * 쪽마다 만든 PDF를 기억해 둔다(선생님 말씀 2026-10-20: 누르면 바로 받을 수 있게).
 * 화면을 열면 미리 만들어 두고(prefetchPagesPdf), 버튼을 누르면 기억해 둔 쪽을 합치기만 한다.
 * 문제지·정답지·전체는 같은 쪽을 나눠 쓰고, 고친 쪽만 다시 만든다.
 * 값: 그 쪽이 든 묶음 PDF와 그 안의 몇째 장부터 몇 장인지(긴 쪽은 여러 장).
 */
type PageResult = { bytes: ArrayBuffer; from: number; count: number };
const pageCache = new Map<string, Promise<PageResult>>();
const CACHE_LIMIT = 600;

let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** 다 합친 파일도 쪽 목록마다 기억해 둔다(버튼을 누르면 합치는 시간 없이 바로 받게) */
const mergedCache = new Map<string, Promise<Blob>>();

/** 쪽들의 PDF를 (기억해 둔 것은 그대로, 없는 것만 만들어) 쪽 차례대로 돌려준다. */
function ensurePages(pages: HTMLElement[], paper: PdfPaper): { entries: Array<Promise<PageResult>>; listKey: string } {
  const head = collectCss();
  return schedulePieces(head, pages.map((p) => pieceOf(p, paper)), paper);
}

/**
 * 미리 만들기용: 쪽 조각을 몇 쪽씩 나눠 만들며 사이사이 화면에 틈을 준다(2026-10-29 속도: 184쪽을 한 번에
 * 복사·글로 바꾸느라 무언가 고친 2.5초 뒤 화면이 1~3초 멈췄다).
 */
async function ensurePagesGently(
  pages: HTMLElement[],
  paper: PdfPaper,
  holdOpenTail = false
): Promise<{ entries: Array<Promise<PageResult>>; listKey: string }> {
  const head = collectCss();
  const pieces: PagePiece[] = [];
  for (let i = 0; i < pages.length; i++) {
    pieces.push(pieceOf(pages[i]!, paper));
    if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
  }
  return schedulePieces(head, pieces, paper, holdOpenTail);
}

/**
 * 쪽 차례를 묶음으로 나눈다. 경계는 쪽 내용(열쇠)으로만 정한다 — 쪽이 어떤 차례로 나타나든(화면이 18쪽 → 52쪽 →
 * 115쪽으로 늘려 가도) 같은 쪽들은 늘 같은 묶음이 되어, 서버 저장소·브라우저 보관함의 묶음 PDF를 다시 찾는다.
 * 예전엔 「아직 없는 쪽」을 15쪽씩 묶어 열 때마다 묶음이 달라졌고, 다시 열어도 저장해 둔 것을 못 찾아 전부 새로
 * 만들었다(선생님 2026-11-09 「PDF 저장 누르면 너무 오래 걸린다」, 최종통합자료 115쪽).
 * 긴 쪽은 장 수를 미리 알 수 없어 혼자 묶는다. open: 끝 묶음이 경계 없이 끝났는지(쪽이 더 붙을 수 있다).
 */
export function chunkPages(keys: string[], tall: boolean[]): { chunks: number[][]; open: boolean } {
  const chunks: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (tall[i]) {
      if (cur.length) chunks.push(cur);
      chunks.push([i]);
      cur = [];
      continue;
    }
    cur.push(i);
    // 평균 8쪽쯤에서 끊긴다(열쇠를 섞은 값으로), 많아도 15쪽
    const k = keys[i]!;
    let mix = 0;
    for (let j = 0; j < k.length; j++) mix = Math.imul(mix ^ k.charCodeAt(j), 0x5bd1e995) >>> 0;
    if ((mix >>> 13) % 8 === 0 || cur.length >= CHUNK_PAGES) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return { chunks, open: cur.length > 0 };
}

function schedulePieces(
  head: string,
  pieces: PagePiece[],
  paper: PdfPaper,
  /** 화면이 아직 쪽을 늘려 가는 중이면 끝 묶음(경계 없이 끝난 것)은 미룬다 — 쪽이 더 붙으면 묶음이 달라진다 */
  holdOpenTail = false
): { entries: Array<Promise<PageResult>>; listKey: string } {
  // 스타일(수백 KB)은 한 번만 센다 — 예전엔 쪽마다 스타일까지 붙여 다시 세어 184쪽이면 같은 글을 184번 읽었다
  const headKey = hash(head);
  const keys = pieces.map((p) => hash(`${paper.w}x${paper.h}|${headKey}|${p.html}`));
  const { chunks, open } = chunkPages(keys, pieces.map((p) => p.tall));
  const scheduled = new Set<string>();
  const batches: number[][] = [];
  chunks.forEach((chunk, ci) => {
    if (holdOpenTail && open && ci === chunks.length - 1) return;
    // 묶음의 쪽이 다 있으면 건너뛴다(같은 쪽이 앞에서 이미 잡혔어도)
    if (chunk.every((i) => pageCache.has(keys[i]!) || scheduled.has(keys[i]!))) return;
    chunk.forEach((i) => scheduled.add(keys[i]!));
    batches.push(chunk);
  });
  for (const batch of batches) {
    const html = documentHtml(head, batch.map((i) => pieces[i]!.html), paper);
    const job = limited(() => renderChunk(html, paper));
    batch.forEach((i, pos) => {
      const key = keys[i]!;
      const entry = job.then((bytes) =>
        pieces[i]!.tall ? { bytes, from: 0, count: -1 } : { bytes, from: pos, count: 1 }
      );
      // 실패한 쪽은 잊어 다음에 다시 만든다
      entry.catch(() => pageCache.delete(key));
      pageCache.set(key, entry);
    });
  }
  while (pageCache.size > CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value!);
  return { entries: keys.map((k) => pageCache.get(k)!), listKey: keys.join(",") };
}

/** 화면을 열거나 고친 뒤 미리 만들어(합쳐) 둔다. 실패해도 조용히 넘어간다(누를 때 다시 만든다). */
export async function prefetchPagesPdf(
  pages: HTMLElement[],
  paper: PdfPaper,
  /** merge:false — 화면이 아직 쪽을 늘려 가는 중이면 쪽 PDF만 만들고 합치기는 미룬다 */
  opts: { merge?: boolean } = {}
): Promise<void> {
  if (pages.length === 0) return;
  try {
    const { entries, listKey } = await ensurePagesGently(pages, paper, opts.merge === false);
    if (opts.merge === false) {
      // 미룬 끝 묶음의 쪽은 아직 없다(undefined) — 있는 것만 기다린다
      await Promise.allSettled(entries.filter(Boolean));
      return;
    }
    if (mergedCache.has(listKey)) return;
    const job = mergeEntries(entries, pages.length);
    mergedCache.set(listKey, job);
    job.catch(() => mergedCache.delete(listKey));
    while (mergedCache.size > 12) mergedCache.delete(mergedCache.keys().next().value!);
    await job.catch(() => undefined);
  } catch {
    /* 미리 만들기는 실패해도 조용히(누를 때 다시 만든다) */
  }
}

/** 쪽들을 서버에서 글자 PDF로 만들어 한 파일(Blob)로 돌려준다. 미리 만든 쪽은 바로 쓴다. */
export async function renderPagesToPdf(
  pages: HTMLElement[],
  paper: PdfPaper,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const { entries, listKey } = ensurePages(pages, paper);
  const ready = mergedCache.get(listKey);
  if (ready) {
    const blob = await ready.catch(() => null);
    if (blob) return blob;
  }
  const job = mergeEntries(entries, pages.length, onProgress);
  mergedCache.set(listKey, job);
  job.catch(() => mergedCache.delete(listKey));
  while (mergedCache.size > 12) mergedCache.delete(mergedCache.keys().next().value!);
  return job;
}

/** 「engcore-skip:3,7」 → {3, 7} (render-html-pdf.ts의 PDF_SKIP_PREFIX — 서버 모듈이라 여기서는 글로 맞춘다) */
function skipPagesOf(subject: string | undefined): Set<number> {
  const m = /engcore-skip:([\d,]+)/.exec(subject ?? "");
  return new Set(m ? m[1]!.split(",").map(Number).filter((n) => Number.isInteger(n)) : []);
}

async function mergeEntries(
  entries: Array<Promise<PageResult>>,
  total: number,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  let done = 0;
  entries.forEach((e) =>
    void e.then(
      () => onProgress?.(++done, total),
      () => undefined
    )
  );
  const results = await Promise.all(entries);
  // 쪽이 모두 한 묶음에서 차례대로 나왔으면 그 PDF를 그대로 준다(뺄 빈 쪽이 없을 때)
  const first = results[0]!;
  if (
    results.every((r, i) => r.bytes === first.bytes && r.count === 1 && r.from === i) &&
    first.count === 1
  ) {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(first.bytes);
    if (doc.getPageCount() === results.length && skipPagesOf(doc.getSubject()).size === 0) {
      return new Blob([first.bytes], { type: "application/pdf" });
    }
  }
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  const loaded = new Map<ArrayBuffer, Awaited<ReturnType<typeof PDFDocument.load>>>();
  /*
   * 같은 묶음에서 이어 나오는 쪽은 한 번에 옮긴다. 쪽마다 따로 옮기면 글꼴을 쪽마다 다시 복사해
   * 57쪽이 9MB·5초가 되었다(2026-10-20 잰 값).
   */
  const groups: Array<{ bytes: ArrayBuffer; indices: number[] }> = [];
  /** 서버가 빈 쪽으로 적어 둔 쪽(워크북 「(계속)」 마지막 쪽 — render-html-pdf.ts) */
  const skips = new Map<ArrayBuffer, Set<number>>();
  for (const r of results) {
    let doc = loaded.get(r.bytes);
    if (!doc) {
      doc = await PDFDocument.load(r.bytes);
      loaded.set(r.bytes, doc);
      skips.set(r.bytes, skipPagesOf(doc.getSubject()));
    }
    const skip = skips.get(r.bytes)!;
    const indices = (r.count < 0 ? doc.getPageIndices() : [r.from]).filter((i) => !skip.has(i));
    if (indices.length === 0) continue;
    const last = groups[groups.length - 1];
    if (last && last.bytes === r.bytes) last.indices.push(...indices);
    else groups.push({ bytes: r.bytes, indices });
  }
  for (const g of groups) {
    const copied = await merged.copyPages(loaded.get(g.bytes)!, g.indices);
    copied.forEach((p) => merged.addPage(p));
  }
  const bytes = await merged.save({ useObjectStreams: true });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
