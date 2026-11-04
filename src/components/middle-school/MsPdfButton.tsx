"use client";

import { useState } from "react";
import { collectPrintPages, downloadSheetsPdf } from "@/lib/pdf/download-sheets-pdf";

/** 중학교 쪽(테스트 교재 쪽 + 끼운 변형문제 쪽). 길이 재는 숨은 층은 뺀다 */
const MS_PDF_SELECTOR = ":is(.tb-sheet, .qg-print-page):not(.tb-measure *, .qg-print-measure *)";

/**
 * 「PDF로 저장」(선생님 2026-11-04 「인쇄 세션이 너무 오래 걸려 하나 인쇄 걸고 또 인쇄하려면 한참 기다려야 한다, 특히 중학 자료」):
 * 브라우저 인쇄창은 수십 쪽을 미리 그리고 프린터로 넘기는 동안 탭을 붙잡는다. 서버에서 글자 PDF를 만들어 바로 내려받게 해,
 * 받은 PDF를 뷰어에서 여러 개 이어서 인쇄할 수 있게 한다(고등 화면의 PDF 저장과 같은 부품).
 */
export function MsPdfButton({ fileName, className }: { fileName: string; className?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const pages = collectPrintPages(document.getElementById("tb-print-root"), MS_PDF_SELECTOR);
    if (!pages.length) return;
    setError(null);
    setBusy(`0/${pages.length}`);
    // 끼운 변형문제 쪽은 화면에서 여백 때문에 A4보다 조금 길게 그려져(1,183px > 1,123px) 서버가 「긴 쪽」으로 보고 두 장으로 나눈다.
    // 인쇄 모양에서는 한 장에 맞으므로, 보내는 동안만 A4 높이로 둔다.
    const qPages = pages.filter((p) => p.classList.contains("qg-print-page"));
    const saved = qPages.map((p) => p.style.height);
    qPages.forEach((p) => p.style.setProperty("height", "297mm"));
    try {
      await downloadSheetsPdf(pages, fileName, { onProgress: (done, total) => setBusy(`${done}/${total}`) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다.");
    } finally {
      qPages.forEach((p, i) => (saved[i] ? p.style.setProperty("height", saved[i]) : p.style.removeProperty("height")));
      setBusy(null);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={!!busy}
        onClick={() => void save()}
        className={className ?? "w-full rounded-lg border border-violet-300 bg-white py-2 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-60"}
      >
        {busy ? `PDF 만드는 중… ${busy}` : "⤓ PDF로 저장"}
      </button>
      {error ? <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p> : null}
    </>
  );
}
