"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MsQuestion, MsUnit } from "@/lib/middle-school/queries";
import { useMaterialDesign } from "@/lib/lesson-materials/material-design";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import { OddPageStart, TestBookStudent } from "@/components/lesson-materials/test-book/TestBookSheets";
import {
  MS_DRAW_LIMITS,
  MS_DRAW_WORDS,
  MS_WB_TYPES,
  drawMsWorkbook,
  msWbCounts,
  type MsDrawLength,
  type MsWbGroup,
  type MsWbSheet,
  type MsWbTypeKey,
} from "@/lib/middle-school/workbook";
import { MsPrintFrame, MsWorkbookAnswerSheets, MsWorkbookSheets, msSource } from "./MsSheets";

const DEFAULT_TYPES: MsWbTypeKey[] = ["r_line", "r_en_blank", "r_grammar", "r_word_order", "r_writing", "d_line", "w_en_ko"];
const LENGTHS: { id: MsDrawLength; label: string }[] = [
  { id: "short", label: "짧게" },
  { id: "normal", label: "보통" },
  { id: "long", label: "길게" },
];
const GROUPS: MsWbGroup[] = ["단어", "대화문", "본문"];


/**
 * 중학교 테스트지 작업대(선생님 2026-11-04): 고등 단어 시험지·교재 화면처럼 왼쪽 설정 칸(따로 스크롤) + 오른쪽 쪽 미리보기.
 * 쪽 차례는 최종통합자료(학교별 교재)와 같다 — 단어 → 대화문 → 본문 워크북 → 정답지(족보닷컴 문제는 넣지 않는다 — 선생님 2026-11-04).
 * 시험지 제목·학생 이름은 왼쪽 칸에서 넣는다(학생 이름은 「이름」 칸에 찍힌다).
 */
export function MsTestWorkbench({
  unit,
  academyName,
  closeHref = null,
  onClose,
}: {
  unit: MsUnit;
  questions: MsQuestion[];
  academyName: string;
  base: string;
  /** 과 카드에서 바로 연 경우: 닫으면 과 목록으로 */
  closeHref?: string | null;
  onClose?: () => void;
}) {
  const [design, setDesign] = useMaterialDesign();
  const counts = useMemo(() => msWbCounts(unit, unit.workbook), [unit]);
  const [types, setTypes] = useState<MsWbTypeKey[]>(() => DEFAULT_TYPES.filter((t) => counts[t]));
  const [length, setLength] = useState<MsDrawLength>("normal");
  const [seed, setSeed] = useState(unit.id);
  const [title, setTitle] = useState("");
  const [student, setStudent] = useState("");
  const [answers, setAnswers] = useState(true);
  const [zoom, setZoom] = useState(70);
  /** 관리자 화면 틀(메뉴·머리줄) 위에 온전히 덮도록 body 에 바로 붙인다 */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  /** 양면 인쇄: 테스트마다 홀수 쪽에서 시작 */
  const [duplex, setDuplex] = useState(true);

  const sheetTitle = title.trim() || "테스트";
  const source = msSource(unit);

  /** 묶음마다 뽑은 워크북(교재와 같은 방식: 묶음별 seed) */
  const sheetsOf = useMemo(() => {
    const out: Record<MsWbGroup, MsWbSheet[]> = { 단어: [], 대화문: [], 본문: [] };
    for (const g of GROUPS) {
      const ts = types.filter((t) => MS_WB_TYPES.find((x) => x.key === t)?.group === g && counts[t]);
      out[g] = ts.length ? drawMsWorkbook(unit, unit.workbook, ts, length, `${seed}|${g}`) : [];
    }
    return out;
  }, [unit, types, counts, length, seed]);
  const allSheets = [...sheetsOf["단어"], ...sheetsOf["대화문"], ...sheetsOf["본문"]];
  /** 유형마다 따로 나눈 테스트(나눠 줄 종이 한 묶음 = 유형 하나, 지문 차례로) */
  const testsOf = useMemo(() => {
    const out: Record<MsWbGroup, Array<{ key: MsWbTypeKey; sheets: MsWbSheet[] }>> = { 단어: [], 대화문: [], 본문: [] };
    for (const g of GROUPS) {
      for (const t of MS_WB_TYPES.filter((x) => x.group === g && types.includes(x.key))) {
        const mine = (title: string) => title === t.label || title.startsWith(`${t.label} `);
        const sheets = sheetsOf[g]
          .map((s) => ({ ...s, key: `${s.key}-${t.key}`, sheet: { ...s.sheet, sections: s.sheet.sections.filter((sec) => mine(sec.title)) } }))
          .filter((s) => s.sheet.sections.length > 0);
        if (sheets.length) out[g].push({ key: t.key, sheets });
      }
    }
    return out;
  }, [sheetsOf, types]);

  const toggleType = (k: MsWbTypeKey, on: boolean) => setTypes((cur) => MS_WB_TYPES.map((t) => t.key).filter((x) => (x === k ? on : cur.includes(x))));
  const mk = `${unit.id}-${design}-${types.join(",")}-${seed}-${length}`;
  const empty = !allSheets.length;

  const closeCls = "-ml-2 inline-block rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100";
  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none";

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <style>{"@media print{.ms-test-zoom{zoom:1 !important}}"}</style>
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="space-y-1 border-b border-slate-100 px-4 py-3">
          {closeHref ? (
            <Link href={closeHref} className={closeCls}>
              ← 닫기
            </Link>
          ) : (
            <button type="button" onClick={onClose} className={closeCls}>
              ← 닫기
            </button>
          )}
          <p className="text-xs font-bold text-violet-700">테스트지</p>
          <p className="truncate text-sm font-bold text-slate-900">
            {source} · {unit.title}
          </p>
        </div>

        {/* 설정 칸은 따로 스크롤(쪽 미리보기와 상관없이) */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">시험지 제목</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="테스트" maxLength={40} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">학생 이름</span>
            <input type="text" value={student} onChange={(e) => setStudent(e.target.value)} placeholder="비우면 빈칸으로" maxLength={20} className={inputCls} />
            <span className="mt-1 block text-[11px] text-slate-400">출처: {source} · {unit.title}</span>
          </label>

          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="mb-2 flex gap-1">
              {LENGTHS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLength(l.id)}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold ${
                    length === l.id ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-violet-700">
              고른 유형에서 지문마다 유형당 {MS_DRAW_LIMITS[length]}문항(단어는 {MS_DRAW_WORDS[length]}개)을 무작위로 뽑습니다.
            </p>
            <button type="button" onClick={() => setSeed(`${Date.now()}`)} className="w-full rounded-lg bg-violet-600 py-1.5 text-sm font-semibold text-white hover:bg-violet-700">
              ↻ 다시 뽑기
            </button>
          </div>

          {GROUPS.map((g) => (
            <div key={g}>
              <div className="mb-1 text-xs font-bold text-slate-500">{g} 워크북</div>
              {MS_WB_TYPES.filter((t) => t.group === g).map((t) => (
                <label key={t.key} className={`flex items-center gap-2 py-0.5 ${counts[t.key] ? "" : "text-slate-300"}`} title={t.hint}>
                  <input type="checkbox" disabled={!counts[t.key]} checked={types.includes(t.key)} onChange={(e) => toggleType(t.key, e.target.checked)} />
                  <span className="flex-1">{t.label}</span>
                  <span className="text-[11px] text-slate-400">{counts[t.key]}</span>
                </label>
              ))}
            </div>
          ))}

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">
              양면 인쇄
              <span className="block text-[10.5px] font-normal text-slate-400">유형마다 새 종이(홀수 쪽)에서 시작 — 나눠 줄 수 있게</span>
            </span>
            <input type="checkbox" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          </label>

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">정답지 넣기</span>
            <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          </label>

          <MaterialDesignPicker value={design} onChange={setDesign} />
        </div>

        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            disabled={empty}
            onClick={() => window.print()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            인쇄 · PDF 저장
          </button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden">
          <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setZoom((z) => Math.max(30, z - 10))}>
            −
          </button>
          <span className="text-xs font-semibold text-slate-600">{zoom}%</span>
          <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setZoom((z) => Math.min(130, z + 10))}>
            +
          </button>
        </div>
        <div className="flex justify-center p-6 print:p-0">
          <div className="ms-test-zoom" style={{ zoom: zoom / 100 }}>
            {empty ? (
              <div className="flex h-[60mm] w-[210mm] items-center justify-center rounded bg-white/70 text-sm text-slate-500 shadow print:hidden">
                왼쪽에서 넣을 유형을 골라 주세요.
              </div>
            ) : null}
            <TestBookStudent.Provider value={student.trim()}>
              <MsPrintFrame design={design} academyName={academyName}>
                {[...testsOf["단어"], ...testsOf["대화문"]].map((t) => (
                  <Fragment key={t.key}>
                    <OddPageStart on={duplex} />
                    <MsWorkbookSheets sheets={t.sheets} answers={false} title={sheetTitle} measureKey={mk} />
                  </Fragment>
                ))}
                {testsOf["본문"].map((t) => (
                  <Fragment key={t.key}>
                    <OddPageStart on={duplex} />
                    <MsWorkbookSheets sheets={t.sheets} answers={false} title={sheetTitle} measureKey={mk} />
                  </Fragment>
                ))}
                {answers ? <OddPageStart on={duplex} /> : null}
                {answers && allSheets.length ? <MsWorkbookAnswerSheets sheets={allSheets} title={`${sheetTitle} 정답`} measureKey={`${mk}-ans`} /> : null}
              </MsPrintFrame>
            </TestBookStudent.Provider>
          </div>
        </div>
      </main>
    </div>,
    document.body,
  );
}
