"use client";

import { useMemo, useState } from "react";
import type { MsQuestion, MsUnit } from "@/lib/middle-school/queries";
import { useMaterialDesign } from "@/lib/lesson-materials/material-design";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import {
  MS_WB_TYPES,
  MS_DRAW_QUESTIONS,
  buildMsWorkbook,
  drawMsQuestions,
  drawMsWorkbook,
  msWbCounts,
  type MsDrawLength,
  type MsWbGroup,
  type MsWbTypeKey,
} from "@/lib/middle-school/workbook";
import {
  MsAnalysisSheets,
  MsLessonSheets,
  MsPrintFrame,
  MsWorkbookAnswerSheets,
  MsWorkbookSheets,
  msAnalyzed,
  msSource,
  type MsAnalysisOptions,
  type MsLessonOptions,
} from "./MsSheets";
import { MsQuestionTab } from "./MsQuestionTab";
import { MsFinalTab } from "./MsFinalTab";
import { MsExamBlock } from "./MsExamViews";
import { sortMsQuestions } from "@/lib/middle-school/exam-print";
import { DESIGN_STYLES } from "@/lib/lesson-materials/analysis-design";

const TABS = [
  { id: "lesson", label: "수업용 자료", ready: true },
  { id: "workbook", label: "워크북", ready: true },
  { id: "questions", label: "변형문제", ready: true },
  { id: "analysis", label: "분석서", ready: true },
  { id: "final", label: "최종통합자료", ready: true },
] as const;
type TabId = (typeof TABS)[number]["id"];

const LESSON_SECTIONS: {
  key: keyof MsLessonOptions["sections"];
  label: string;
}[] = [
  { key: "words", label: "단어" },
  { key: "dialogue", label: "대화문" },
  { key: "grammar", label: "문법" },
  { key: "reading", label: "본문" },
];

const DEFAULT_WB: MsWbTypeKey[] = [
  "r_line",
  "r_en_blank",
  "r_grammar",
  "r_word_order",
  "r_writing",
  "d_line",
  "w_en_ko",
];
const LENGTHS: { id: MsDrawLength; label: string }[] = [
  { id: "short", label: "짧게" },
  { id: "normal", label: "보통" },
  { id: "long", label: "길게" },
];

export function MiddleSchoolUnitWorkspace({
  unit,
  questions,
  academyName,
  base,
  startTest = false,
}: {
  unit: MsUnit;
  questions: MsQuestion[];
  academyName: string;
  base: string;
  /** 과 카드 「테스트지 출력」: 워크북 탭에서 바로 뽑아 연다 */
  startTest?: boolean;
}) {
  const [tab, setTab] = useState<TabId>(startTest ? "workbook" : "lesson");
  const [design, setDesign] = useMaterialDesign();
  const [lesson, setLesson] = useState<MsLessonOptions>({
    sections: { words: true, grammar: true, dialogue: true, reading: true },
    translation: "show",
    wordExamples: true,
  });
  const [types, setTypes] = useState<MsWbTypeKey[]>(DEFAULT_WB);
  const [answers, setAnswers] = useState(true);
  const [length, setLength] = useState<MsDrawLength>("normal");
  /** 뽑은 테스트지(뽑을 때마다 새 seed) — null이면 워크북 전체 */
  const [drawSeed, setDrawSeed] = useState<string | null>(startTest ? unit.id : null);
  /** 워크북·테스트지 제목(비우면 「워크북」/「테스트」) */
  const [wbTitle, setWbTitle] = useState("");
  /** 테스트지에 족보닷컴 대화문(의사소통)·문법(어법) 문제도 뽑아 넣는다(선생님 2026-11-02) */
  const [testQ, setTestQ] = useState({ dialogue: true, grammar: true });
  /** 분석서: 모양 A·B·C(고등 분석서와 같다) · 전체 해석/직독직해 */
  const [analysis, setAnalysis] = useState<MsAnalysisOptions>({ style: "a", translation: "full" });
  const analyzed = msAnalyzed(unit).length;

  const counts = useMemo(() => msWbCounts(unit, unit.workbook), [unit]);
  const sheets = useMemo(
    () =>
      drawSeed
        ? drawMsWorkbook(unit, unit.workbook, types, length, drawSeed)
        : buildMsWorkbook(unit, unit.workbook, types),
    [unit, types, length, drawSeed],
  );

  const qPool = useMemo(
    () => ({
      dialogue: questions.filter((q) => q.area === "의사소통" && !q.review).length,
      grammar: questions.filter((q) => q.area === "어법" && !q.review).length,
    }),
    [questions],
  );
  const testQuestions = useMemo(() => {
    if (!drawSeed) return { dialogue: [], grammar: [] };
    const n = MS_DRAW_QUESTIONS[length];
    return {
      dialogue: testQ.dialogue ? sortMsQuestions(drawMsQuestions(questions, "의사소통", n, drawSeed)) : [],
      grammar: testQ.grammar ? sortMsQuestions(drawMsQuestions(questions, "어법", n, drawSeed)) : [],
    };
  }, [questions, drawSeed, length, testQ]);
  const sheetTitle = wbTitle.trim() || (drawSeed ? "테스트" : "워크북");

  const toggleType = (k: MsWbTypeKey, on: boolean) =>
    setTypes((cur) =>
      MS_WB_TYPES.map((t) => t.key).filter((x) =>
        x === k ? on : cur.includes(x),
      ),
    );

  return (
    <div className="space-y-4">
      <nav className="no-print flex flex-wrap gap-1 border-b border-slate-200 print:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.ready}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.id
                ? "border-violet-600 text-violet-700"
                : t.ready
                  ? "border-transparent text-slate-600 hover:text-slate-900"
                  : "cursor-not-allowed border-transparent text-slate-300"
            }`}
          >
            {t.label}
            {!t.ready && (
              <span className="ml-1 text-[10px] font-normal">준비 중</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "final" ? (
        <MsFinalTab unit={unit} questions={questions} design={design} setDesign={setDesign} academyName={academyName} base={base} />
      ) : tab === "questions" ? (
        <MsQuestionTab
          unit={unit}
          questions={questions}
          design={design}
          setDesign={setDesign}
          academyName={academyName} base={base}
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <aside className="no-print w-full shrink-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden lg:sticky lg:top-4 lg:w-64">
            <MaterialDesignPicker value={design} onChange={setDesign} compact />

            {tab === "lesson" ? (
              <>
                <div>
                  <div className="mb-2 font-bold text-slate-800">넣을 자료</div>
                  {LESSON_SECTIONS.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={lesson.sections[s.key]}
                        onChange={(e) =>
                          setLesson({
                            ...lesson,
                            sections: {
                              ...lesson.sections,
                              [s.key]: e.target.checked,
                            },
                          })
                        }
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
                <div>
                  <div className="mb-2 font-bold text-slate-800">
                    대화문·본문 해석
                  </div>
                  {(
                    [
                      ["show", "해석 함께"],
                      ["hide", "해석 지우고 쓰는 줄"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2 py-0.5">
                      <input
                        type="radio"
                        name="ms-tr"
                        checked={lesson.translation === v}
                        onChange={() =>
                          setLesson({ ...lesson, translation: v })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lesson.wordExamples}
                    onChange={(e) =>
                      setLesson({ ...lesson, wordExamples: e.target.checked })
                    }
                  />
                  단어장에 예문
                </label>
              </>
            ) : tab === "analysis" ? (
              <>
                <div>
                  <div className="mb-2 font-bold text-slate-800">분석서 모양</div>
                  <div className="flex gap-1">
                    {DESIGN_STYLES.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        title={d.hint}
                        onClick={() => setAnalysis({ ...analysis, style: d.id })}
                        className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold ${
                          analysis.style === d.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-bold text-slate-800">해석</div>
                  {(
                    [
                      ["full", "전체 해석"],
                      ["chunk", "직독직해"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2 py-0.5">
                      <input type="radio" name="ms-an-tr" checked={analysis.translation === v} onChange={() => setAnalysis({ ...analysis, translation: v })} />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  본문 {analyzed}개의 문장 분석(성분·구문 설명·시험 자리)을 싣습니다.
                </p>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block font-bold text-slate-800">시험지 제목</span>
                  <input
                    type="text"
                    value={wbTitle}
                    onChange={(e) => setWbTitle(e.target.value)}
                    placeholder={drawSeed ? "테스트" : "워크북"}
                    maxLength={40}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">
                    출처: {msSource(unit)} · {unit.title}
                  </span>
                </label>
                {(["본문", "대화문", "단어"] as MsWbGroup[]).map((g) => (
                  <div key={g}>
                    <div className="mb-1 font-bold text-slate-800">{g}</div>
                    {MS_WB_TYPES.filter((t) => t.group === g).map((t) => (
                      <label
                        key={t.key}
                        className={`flex items-center gap-2 py-0.5 ${counts[t.key] ? "" : "text-slate-300"}`}
                        title={t.hint}
                      >
                        <input
                          type="checkbox"
                          disabled={!counts[t.key]}
                          checked={types.includes(t.key)}
                          onChange={(e) => toggleType(t.key, e.target.checked)}
                        />
                        <span className="flex-1">{t.label}</span>
                        <span className="text-[11px] text-slate-400">
                          {counts[t.key]}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={answers}
                    onChange={(e) => setAnswers(e.target.checked)}
                  />
                  정답지 함께
                </label>
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <div className="mb-2 font-bold text-violet-800">
                    테스트지 뽑기
                  </div>
                  <div className="mb-2 flex gap-1">
                    {LENGTHS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setLength(l.id)}
                        className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold ${
                          length === l.id
                            ? "border-violet-600 bg-violet-600 text-white"
                            : "border-violet-200 bg-white text-violet-700"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 text-[11px] leading-relaxed text-violet-700">
                    고른 유형에서 지문마다 유형당{" "}
                    {length === "short" ? 3 : length === "normal" ? 5 : 8}
                    문항(단어는{" "}
                    {length === "short" ? 10 : length === "normal" ? 15 : 25}
                    개)을 무작위로 뽑습니다. 누를 때마다 새로 뽑힙니다.
                  </p>
                  <div className="mb-2 space-y-0.5 rounded-md bg-white/70 px-2 py-1.5">
                    {(
                      [
                        ["dialogue", "대화문 문제"],
                        ["grammar", "문법 문제"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className={`flex items-center gap-2 py-0.5 text-[13px] ${qPool[k] ? "text-violet-900" : "text-slate-300"}`}>
                        <input
                          type="checkbox"
                          disabled={!qPool[k]}
                          checked={testQ[k] && qPool[k] > 0}
                          onChange={(e) => setTestQ({ ...testQ, [k]: e.target.checked })}
                        />
                        <span className="flex-1">
                          {label} {Math.min(MS_DRAW_QUESTIONS[length], qPool[k])}문항
                        </span>
                        <span className="text-[11px] text-slate-400">{qPool[k]}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawSeed(`${Date.now()}`)}
                    className="w-full rounded-lg bg-violet-600 py-1.5 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    {drawSeed ? "다시 뽑기" : "뽑기"}
                  </button>
                  {drawSeed ? (
                    <button
                      type="button"
                      onClick={() => setDrawSeed(null)}
                      className="mt-1 w-full text-xs text-violet-700 underline"
                    >
                      워크북 전체로 돌아가기
                    </button>
                  ) : null}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
            >
              인쇄 · PDF 저장
            </button>
          </aside>

          <div className="min-w-0 flex-1 overflow-x-auto bg-slate-100 py-4 print:overflow-visible print:bg-white print:p-0">
            <MsPrintFrame design={design} academyName={academyName}>
              {tab === "lesson" ? (
                <MsLessonSheets unit={unit} options={lesson} />
              ) : tab === "analysis" ? (
                analyzed ? (
                  <MsAnalysisSheets unit={unit} options={analysis} measureKey={`${unit.id}-${design}`} />
                ) : (
                  <div className="flex h-[60mm] w-[210mm] items-center justify-center rounded bg-white text-sm text-slate-500 shadow">
                    이 과의 분석서는 아직 준비 중입니다.
                  </div>
                )
              ) : (
                <>
                  <MsWorkbookSheets
                    sheets={sheets}
                    answers={false}
                    title={sheetTitle}
                    measureKey={`${unit.id}-${design}-${types.join(",")}-${drawSeed ?? "all"}-${length}-${answers}`}
                  />
                  {(["dialogue", "grammar"] as const).map((k) => (
                    <MsExamBlock
                      key={k}
                      unit={unit}
                      questions={testQuestions[k]}
                      mode="exam"
                      design={design}
                      academyName={academyName}
                      base={base}
                      title={`${msSource(unit)} ${sheetTitle} · ${k === "dialogue" ? "대화문 문제" : "문법 문제"}`}
                    />
                  ))}
                  {answers && sheets.length ? (
                    <MsWorkbookAnswerSheets
                      sheets={sheets}
                      title={`${sheetTitle} 정답`}
                      measureKey={`${unit.id}-${design}-${types.join(",")}-${drawSeed ?? "all"}-${length}-ans`}
                    />
                  ) : null}
                  {answers
                    ? (["dialogue", "grammar"] as const).map((k) => (
                        <MsExamBlock
                          key={`a-${k}`}
                          unit={unit}
                          questions={testQuestions[k]}
                          mode="answers"
                          design={design}
                          academyName={academyName}
                          base={base}
                          title={`${msSource(unit)} ${sheetTitle} · ${k === "dialogue" ? "대화문 문제" : "문법 문제"}`}
                        />
                      ))
                    : null}
                </>
              )}
            </MsPrintFrame>
          </div>
        </div>
      )}
    </div>
  );
}
