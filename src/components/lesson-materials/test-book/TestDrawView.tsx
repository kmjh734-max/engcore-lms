"use client";

import { CloseSaveButton } from "@/components/lesson-materials/CloseSaveButton";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { downloadSheetsPdf, pdfFileName } from "@/lib/pdf/download-sheets-pdf";
import type { TestBookProjectInput, TestSheet, VocabExam } from "@/lib/lesson-materials/test-book";
import { useMaterialDesign } from "@/lib/lesson-materials/material-design";
import {
  AnswerSheets,
  FlowTestSheets,
  OddPageStart,
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  TestBookBrand,
  TestBookStudent,
  VocabExamAnswerSheets,
  VocabExamSheets,
} from "@/components/lesson-materials/test-book/TestBookSheets";

/** 뽑은 테스트지 파일(lesson_material_documents kind test_draw)의 payload */
export type TestDrawPayload = {
  version: 1;
  createdAt: string;
  /** 지문마다 뽑힌 시험지(뽑은 그대로) */
  sheets: Array<{
    project: { id: string; index: number; title: string; titleEn: string | null; source: string | null };
    sheet: TestSheet;
  }>;
  vocabExam: VocabExam | null;
};

/**
 * 뽑은 테스트지 다시 보기(선생님 2026-10-20: 만들고 나면 어디에 저장돼야). 저장해 둔 그대로 그려
 * 인쇄·PDF로 저장한다. 재료를 다시 만들어도 이미 뽑은 시험지는 바뀌지 않는다. 값은 들지 않는다.
 */
export function TestDrawView({
  role,
  name,
  payload,
  logoSrc = null,
  academyName = "",
}: {
  role: "admin" | "teacher";
  name: string;
  payload: TestDrawPayload;
  logoSrc?: string | null;
  academyName?: string;
}) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const [answers, setAnswers] = useState(true);
  /** 시험지 제목·학생 이름(「이름」 칸) · 양면 인쇄면 정답지만 새 종이(홀수 쪽), 시험지는 쭉 이어서 — 선생님 2026-11-04·11-06 */
  const [sheetTitle, setSheetTitle] = useState("");
  const [student, setStudent] = useState("");
  const [duplex, setDuplex] = useState(true);
  const title = sheetTitle.trim() || "테스트";
  /** 디자인 — 모든 자료가 같이 쓰는 것(material-design.ts) */
  const [md] = useMaterialDesign();
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const brand = useMemo(() => ({ logoSrc: logoSrc || null, academy: academyName }), [logoSrc, academyName]);
  const sheets = useMemo(() => payload.sheets ?? [], [payload.sheets]);
  const asProject = (p: TestDrawPayload["sheets"][number]["project"]) =>
    ({ ...p, sentences: [], content: null, material: null }) as TestBookProjectInput;

  // 바닥줄 쪽 번호(교재 화면과 같다)
  useEffect(() => {
    const root = document.getElementById("tb-print-root");
    if (!root) return;
    const count = () => {
      const all = Array.from(root.querySelectorAll<HTMLElement>(".tb-sheet")).filter((el) => !el.closest(".tb-measure"));
      all.forEach((el, i) => {
        const no = el.querySelector<HTMLElement>(":scope > .tb-foot .tb-pgno");
        if (no && no.textContent !== `- ${i + 1} -`) no.textContent = `- ${i + 1} -`;
      });
    };
    count();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(count);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `@media print{@page{size:210mm 297mm;margin:0}#tb-print-root{transform:none !important;gap:0 !important}}`;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  async function savePdf() {
    const root = document.getElementById("tb-print-root");
    if (!root) return;
    const pages = Array.from(root.querySelectorAll<HTMLElement>(".tb-sheet")).filter((el) => !el.closest(".tb-measure"));
    setPdfBusy(`0/${pages.length}`);
    try {
      await downloadSheetsPdf(pages, pdfFileName(name || "테스트지", "테스트지"), {
        onProgress: (done, total) => setPdfBusy(`${done}/${total}`),
      });
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <aside className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-white p-4 print:hidden">
        {/* 뽑을 때 이미 파일로 저장됐다 */}
        <CloseSaveButton base={base} className="text-left text-xs font-semibold text-violet-700" />
        <h1 className="text-base font-bold text-slate-900">뽑은 테스트지</h1>
        <p className="text-[13px] font-semibold text-slate-800">{name}</p>
        <p className="text-[11px] leading-relaxed text-slate-500">
          뽑은 그대로 저장한 시험지입니다. 다시 인쇄해도 값이 들지 않고, 재료를 다시 만들어도 바뀌지 않습니다.
          {payload.createdAt ? ` · ${new Date(payload.createdAt).toLocaleString("ko-KR")}` : ""}
        </p>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} />
          정답지 함께
        </label>
        <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} />
          <span>
            양면 인쇄 · 정답지는 새 종이
            <span className="block text-[10.5px] font-normal text-slate-400">시험지는 쭉 이어 싣고, 정답지만 홀수 쪽에서 시작</span>
          </span>
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          시험지 제목
          <input
            type="text"
            value={sheetTitle}
            onChange={(e) => setSheetTitle(e.target.value)}
            placeholder="테스트"
            maxLength={40}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-normal focus:border-violet-500 focus:outline-none"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          학생 이름
          <input
            type="text"
            value={student}
            onChange={(e) => setStudent(e.target.value)}
            placeholder="비우면 빈칸으로"
            maxLength={20}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-normal focus:border-violet-500 focus:outline-none"
          />
        </label>
        <div className="mt-auto space-y-2">
          <Button type="button" variant="secondary" className="w-full" disabled={!!pdfBusy} onClick={() => void savePdf()}>
            {pdfBusy ? `PDF 만드는 중… ${pdfBusy}` : "PDF로 저장"}
          </Button>
          <Button type="button" className="w-full" onClick={() => window.print()}>
            인쇄
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto print:overflow-visible">
        <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
        <style>{TEST_BOOK_CSS}</style>
        <div className="flex flex-col items-center p-6 print:block print:p-0">
          <TestBookBrand.Provider value={brand}>
            <div id="tb-print-root" className={`tb-theme-${md} relative flex flex-col gap-6 print:gap-0 [&_.tb-sheet]:shadow`}>
              <TestBookStudent.Provider value={student.trim()}>
                {payload.vocabExam ? <VocabExamSheets exam={payload.vocabExam} measureKey="saved" title={sheetTitle.trim() || undefined} /> : null}
                {sheets.length ? (
                  <FlowTestSheets
                    entries={sheets.map((s) => ({ index: s.project.index, project: asProject(s.project), sheet: s.sheet }))}
                    title={title}
                    measureKey="saved"
                  />
                ) : null}
              </TestBookStudent.Provider>
              {answers ? <OddPageStart on={duplex} /> : null}
              {answers && payload.vocabExam ? <VocabExamAnswerSheets exam={payload.vocabExam} measureKey="saved" /> : null}
              {answers && sheets.length ? (
                <AnswerSheets
                  title={`${title} 정답`}
                  entries={sheets.map((s) => ({ index: s.project.index, project: asProject(s.project), sheet: s.sheet }))}
                  measureKey="saved"
                />
              ) : null}
            </div>
          </TestBookBrand.Provider>
        </div>
      </main>
    </div>
  );
}
