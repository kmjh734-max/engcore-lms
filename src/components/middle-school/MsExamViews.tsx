"use client";

import Link from "next/link";
import type { MsQuestion, MsUnit } from "@/lib/middle-school/queries";
import type { MaterialDesign } from "@/lib/lesson-materials/material-design";
import { useMaterialDesign } from "@/lib/lesson-materials/material-design";
import { QuestionPrintView } from "@/components/question-generator/QuestionPrintView";
import { encodeQuestionIds, msExamPreloaded, sortMsSources } from "@/lib/middle-school/exam-print";
import { MsPrintFrame } from "./MsSheets";

type UnitHead = Pick<MsUnit, "id" | "grade" | "publisher" | "lessonNo" | "title">;

/**
 * 변형문제를 출처별로 따로 찍는다(선생님 2026-10-30 「변형문제 자료가 많은데 정리가 덜 됐다」):
 * 출처마다 머리글 제목(「중1 1과 변형문제 · 예상문제 1회」)과 1번부터 시작하는 번호, 문항 위에는 영역(단어·의사소통·어법·본문)만.
 * 출처 차례는 예상문제 PRE-STEP → 1회 → 2회 → Grammar Build Up → 최다빈출 → 최상위 → 최다오답.
 * 변형문제 인쇄 부품(QuestionPrintView)을 끼워 넣는다 — 쪽 번호는 MsPrintFrame이 이어서 센다.
 */
export function MsExamBySource({
  unit,
  questions,
  mode,
  design,
  academyName,
  base,
  label = "변형문제",
}: {
  unit: UnitHead;
  questions: MsQuestion[];
  mode: "exam" | "answers";
  design: MaterialDesign;
  academyName: string;
  base: string;
  /** 머리글 이름(통합자료에서는 「문법 문제」처럼 영역 이름) */
  label?: string;
}) {
  const sources = sortMsSources(questions.map((q) => q.source));
  const all = encodeQuestionIds(questions.map((q) => q.id));
  return (
    <>
      {sources.map((src) => {
        const qs = questions.filter((q) => q.source === src);
        return (
          <QuestionPrintView
            key={`${mode}-${src}-${qs.map((q) => q.id).join(".")}-${design}`}
            // 머리말·꼬리말 설정은 작업 id마다 브라우저에 저장된다 — 문제지·해설지가 같은 id면 「… · 정답」 꼬리말이 문제지에 옮겨 붙는다
            jobId={`ms-${unit.id}-${label}-${src}-${mode}`}
            backHref={`${base}/${unit.id}`}
            printBaseHref={`${base}/${unit.id}/exam/${all}`}
            mode={mode}
            layout="bySet"
            academyName={academyName}
            embedded
            design={design}
            preloaded={msExamPreloaded(unit, qs, `${unit.grade} ${unit.lessonNo}과 ${label} · ${src}`)}
          />
        );
      })}
    </>
  );
}

/**
 * 테스트지에 뽑아 넣은 대화문·문법 문제: 출처로 나누지 않고 한 묶음으로 1번부터 찍는다.
 */
export function MsExamBlock({
  unit,
  questions,
  mode,
  design,
  academyName,
  base,
  title,
}: {
  unit: UnitHead;
  questions: MsQuestion[];
  mode: "exam" | "answers";
  design: MaterialDesign;
  academyName: string;
  base: string;
  /** 머리글 제목(「3월 2주 테스트 · 문법 문제」) */
  title: string;
}) {
  if (!questions.length) return null;
  const all = encodeQuestionIds(questions.map((q) => q.id));
  return (
    <QuestionPrintView
      key={`${mode}-${title}-${questions.map((q) => q.id).join(".")}-${design}`}
      jobId={`ms-${unit.id}-test-${title}-${mode}`}
      backHref={`${base}/${unit.id}`}
      printBaseHref={`${base}/${unit.id}/exam/${all}`}
      mode={mode}
      layout="bySet"
      academyName={academyName}
      embedded
      design={design}
      preloaded={msExamPreloaded(unit, questions, title)}
    />
  );
}

/** 인쇄 화면(새 탭): 문제지·해설지 전환 · 인쇄. 디자인은 자료 디자인(localStorage)을 그대로 쓴다. */
export function MsExamPrintView({
  unit,
  questions,
  mode,
  academyName,
  base,
  sel,
}: {
  unit: UnitHead;
  questions: MsQuestion[];
  mode: "exam" | "answers";
  academyName: string;
  base: string;
  sel: string;
}) {
  const [design] = useMaterialDesign();
  const sources = sortMsSources(questions.map((q) => q.source));
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-sm print:hidden">
        <Link href={`${base}/${unit.id}`} className="text-violet-700">
          ← {unit.grade} {unit.lessonNo}과
        </Link>
        <span className="font-semibold text-slate-800">
          변형문제 · {questions.length}문항 · {sources.join(" · ")}
        </span>
        <span className="flex-1" />
        {(
          [
            ["exam", "문제지"],
            ["answers", "해설지"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={`${base}/${unit.id}/exam/${sel}/print?mode=${k}`}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              mode === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {label}
          </Link>
        ))}
        <button type="button" onClick={() => window.print()} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
          인쇄 · PDF 저장
        </button>
      </div>
      <div className="py-4 print:p-0">
        <MsPrintFrame design={design} academyName={academyName}>
          <MsExamBySource unit={unit} questions={questions} mode={mode} design={design} academyName={academyName} base={base} />
        </MsPrintFrame>
      </div>
    </div>
  );
}
