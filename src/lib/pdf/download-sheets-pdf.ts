"use client";

/**
 * 화면의 A4 쪽들을 그대로 찍어 PDF 파일로 내려받는다(선생님 말씀 2026-10-05: 인쇄 말고도
 * 문제지·정답지를 바로 저장할 수 있게). 인쇄 창 없이 파일이 받아진다.
 *
 * 2026-10-20부터는 서버 Chrome으로 글자 PDF를 만든다(server-pdf.ts). 그림으로 찍어 붙이는 아래 방식은
 * 서버가 실패했을 때만 쓴다 — 그림 PDF는 글자를 고르거나 찾을 수 없고 인쇄가 흐리다.
 * 쪽 요소는 실제 종이 크기(210mm 폭 등)로 그려져 있어야 한다.
 *
 * 화면마다 다른 점을 여기서 맞춘다(2026-10-05 일곱 화면 조사):
 *  - 화면에서는 숨겨 두고 인쇄 때만 나오는 쪽(정답지, 다른 지문 탭)은 찍는 동안만 보이게 한다.
 *  - 미리보기 확대·축소(조상의 CSS zoom)는 찍는 동안 1로 둔다. transform은 쪽 크기에 영향이 없다.
 *  - 화면 전용 표시(print:hidden, no-print)는 빼고 찍는다.
 *  - 내용이 길어 종이보다 긴 쪽은 여러 장으로 나눠 싣는다.
 */
export type PdfPaper = { w: number; h: number };
export const A4: PdfPaper = { w: 210, h: 297 };
export const B5: PdfPaper = { w: 182, h: 257 };

export async function downloadSheetsPdf(
  pages: HTMLElement[],
  fileName: string,
  opts: { onProgress?: (done: number, total: number) => void; pixelRatio?: number; paper?: PdfPaper } = {}
): Promise<void> {
  if (pages.length === 0) throw new Error("저장할 쪽이 없습니다.");
  const name = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  /*
   * 먼저 서버 Chrome으로 글자 PDF를 만든다(server-pdf.ts, 2026-10-20 선생님: 빠르게, 그림 말고 글자로).
   * 서버가 실패하면 아래의 그림 방식으로 만든다 — 저장이 아예 안 되는 일은 없게.
   */
  try {
    if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
    const { renderPagesToPdf } = await import("@/lib/pdf/server-pdf");
    /*
     * 반투명 → 불투명 바꾸기(스풀링, 2026-11-06)는 서버 Chrome이 한다(render-html-pdf.ts). 여기서 화면을 바꿔 떠 보내면
     * 미리 만들어 둔 쪽과 HTML이 달라져 누를 때마다 전부 새로 만들었다(2026-11-09 「PDF 저장이 너무 오래 걸린다」).
     */
    const blob = await renderPagesToPdf(pages, opts.paper ?? A4, opts.onProgress);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  } catch (e) {
    console.warn("글자 PDF를 만들지 못해 그림 PDF로 저장합니다.", e);
  }
  await downloadSheetsPdfAsImages(pages, name, opts);
}

/** 예전 방식: 쪽마다 그림(JPEG)으로 찍어 붙인다. 서버 PDF가 실패했을 때만 쓴다. */
async function downloadSheetsPdfAsImages(
  pages: HTMLElement[],
  fileName: string,
  opts: { onProgress?: (done: number, total: number) => void; pixelRatio?: number; paper?: PdfPaper }
): Promise<void> {
  const [{ toJpeg, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;

  const paper = opts.paper ?? A4;
  const pdf = new jsPDF({ unit: "mm", format: [paper.w, paper.h], orientation: "portrait", compress: true });
  let firstPage = true;
  const restore = revealForCapture(pages);
  try {
    // 글꼴은 한 번만 읽어 모든 쪽에 쓴다(쪽마다 다시 받으면 느리다)
    let fontEmbedCSS: string | undefined;
    try {
      fontEmbedCSS = (await usedFontEmbedCSS()) || (await getFontEmbedCSS(pages[0]!));
    } catch {
      fontEmbedCSS = undefined;
    }
    for (let i = 0; i < pages.length; i++) {
      const el = pages[i]!;
      const url = await toJpeg(el, {
        quality: 0.92,
        pixelRatio: opts.pixelRatio ?? 2,
        backgroundColor: "#ffffff",
        cacheBust: false,
        fontEmbedCSS,
        // 미리보기 그림자는 종이에 없다
        style: { boxShadow: "none", margin: "0", zoom: "1" },
        filter: (node) => !(node instanceof HTMLElement && isScreenOnly(node)),
      });
      // 폭을 종이에 맞추고, 종이보다 길면 이어지는 장에 나눠 싣는다
      const imgH = paper.w * (el.offsetHeight / Math.max(1, el.offsetWidth));
      const sheets = Math.max(1, Math.ceil(imgH / paper.h - 0.02));
      for (let k = 0; k < sheets; k++) {
        if (!firstPage) pdf.addPage([paper.w, paper.h], "portrait");
        firstPage = false;
        pdf.addImage(url, "JPEG", 0, -k * paper.h, paper.w, imgH);
      }
      opts.onProgress?.(i + 1, pages.length);
    }
  } finally {
    restore();
  }
  pdf.save(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}

/** 화면에만 보이는 표시(인쇄 때 숨는 것) */
function isScreenOnly(el: HTMLElement): boolean {
  return el.classList.contains("print:hidden") || el.classList.contains("no-print");
}

/**
 * 인쇄할 쪽을 고른다. 인쇄 때 숨는 쪽(자신이나 root 안의 조상에 print:hidden·no-print)은 뺀다.
 * 화면에서만 숨긴 쪽(hidden print:block 등)은 넣는다 — 찍을 때 잠시 보이게 한다.
 */
export function collectPrintPages(root: Element | null, selector: string): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) if (isScreenOnly(n)) return false;
    return true;
  });
}

/** 숨은 쪽과 그 조상을 잠시 보이게 하고, 조상의 확대·축소(zoom)를 1로 둔다. 되돌리는 함수를 준다. */
function revealForCapture(pages: HTMLElement[]): () => void {
  const touched = new Map<HTMLElement, { display: string; zoom: string }>();
  const touch = (n: HTMLElement) => {
    if (!touched.has(n)) touched.set(n, { display: n.style.display, zoom: n.style.getPropertyValue("zoom") });
  };
  for (const el of pages) {
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none") {
        touch(n);
        n.style.display = "block";
      }
      const z = cs.getPropertyValue("zoom");
      if (z && z !== "1" && z !== "normal") {
        touch(n);
        n.style.setProperty("zoom", "1");
      }
    }
  }
  return () => {
    for (const [n, v] of touched) {
      n.style.display = v.display;
      if (v.zoom) n.style.setProperty("zoom", v.zoom);
      else n.style.removeProperty("zoom");
    }
  };
}

/*
 * 화면이 실제로 쓴 글꼴 조각만 담는다(2026-10-05, 선생님: PDF가 너무 오래 걸린다).
 * html-to-image 기본값은 연결된 글꼴 CSS의 @font-face를 전부 받아 넣는다. 한글 웹글꼴은 글자 범위별로
 * 수백 조각이라 5쪽에 20MB·21초가 걸렸다. 브라우저가 이미 내려받은(status=loaded) 조각만 고르면
 * 324KB·0.8초였다(같은 글꼴 다섯 벌로 잰 값). 고른 조각은 브라우저 캐시에서 바로 읽힌다.
 */
let fontCssCache: { key: string; css: string } | null = null;

async function usedFontEmbedCSS(): Promise<string> {
  if (typeof document === "undefined" || !document.fonts) return "";
  const norm = (s: string | null | undefined) => String(s ?? "").replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();
  const faceKey = (family: string, weight?: string, style?: string, range?: string) =>
    [norm(family), norm(weight || "400"), norm(style || "normal"), norm(range || "u+0-10ffff")].join("|");
  const loaded = Array.from(document.fonts).filter((f) => f.status === "loaded");
  const want = new Set(loaded.map((f) => faceKey(f.family, f.weight, f.style, f.unicodeRange)));
  const cacheKey = [...want].sort().join(";");
  if (fontCssCache?.key === cacheKey) return fontCssCache.css;

  // @font-face 덩어리와 그 CSS의 주소(상대 경로 풀이용)를 모은다
  const blocks: Array<{ text: string; base: string }> = [];
  const fromRules = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) blocks.push({ text: rule.cssText, base });
      else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) fromRules((rule as CSSGroupingRule).cssRules, base);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    const base = sheet.href || location.href;
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null; // 다른 출처(구글 글꼴 등) CSS는 규칙을 못 읽는다 — 글로 받아 나눈다
    }
    if (rules) fromRules(rules, base);
    else if (sheet.href) {
      try {
        const text = await (await fetch(sheet.href)).text();
        for (const m of text.match(/@font-face\s*{[^}]*}/g) ?? []) blocks.push({ text: m, base: sheet.href });
      } catch {
        /* 못 받은 CSS는 건너뛴다 */
      }
    }
  }

  const pick = (block: string, re: RegExp) => (block.match(re) ?? [])[1];
  const chosen = blocks.filter((b) =>
    want.has(
      faceKey(
        pick(b.text, /font-family:\s*([^;]+);/) ?? "",
        pick(b.text, /font-weight:\s*([^;]+);/),
        pick(b.text, /font-style:\s*([^;]+);/),
        pick(b.text, /unicode-range:\s*([^;]+);/)
      )
    )
  );
  const parts = await Promise.all(
    chosen.map(async (b) => {
      const raw = pick(b.text, /url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (!raw) return "";
      try {
        const url = new URL(raw, b.base).href;
        const blob = await (await fetch(url)).blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        return b.text.replace(/src:[^;]+;/, `src: url(${dataUrl});`);
      } catch {
        return "";
      }
    })
  );
  const css = parts.filter(Boolean).join("\n");
  fontCssCache = { key: cacheKey, css };
  return css;
}

/** 파일 이름에 쓸 수 없는 글자를 뺀다 */
export function pdfFileName(...parts: Array<string | null | undefined>): string {
  return (
    parts
      .map((p) => String(p ?? "").trim())
      .filter(Boolean)
      .join("_")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120) || "자료"
  );
}
