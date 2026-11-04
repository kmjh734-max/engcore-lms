"use client";

import { MsPdfButton } from "./MsPdfButton";
import { useEffect, useMemo, useState } from "react";
import type { MsQuestion, MsUnit } from "@/lib/middle-school/queries";
import type { MaterialDesign } from "@/lib/lesson-materials/material-design";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import {
  MS_WB_TYPES,
  buildMsWorkbook,
  drawMsWorkbook,
  msWbCounts,
  seeded,
  shuffle,
  type MsDrawLength,
  type MsWbGroup,
  type MsWbSheet,
  type MsWbTypeKey,
} from "@/lib/middle-school/workbook";
import { sortMsQuestions, sortMsSources } from "@/lib/middle-school/exam-print";
import { COVER_PRESETS, DEFAULT_INTEGRATED_COVER, type IntegratedCover } from "@/lib/lesson-materials/integrated";
import { CoverForm } from "@/components/lesson-materials/book-cover/CoverForm";
import { EMPTY_BOOK_COVER_SPEC, suggestedExam, type BookCoverSpec } from "@/lib/lesson-materials/book-cover";
import { DESIGN_STYLES } from "@/lib/lesson-materials/analysis-design";
import { ContentsSheet, CoverSheet, DividerSheet, partStyle, type BookPart } from "@/components/lesson-materials/test-book/TestBookSheets";
import {
  MsAnalysisSheets,
  MsDialogueSheets,
  MsGrammarSheets,
  MsPrintFrame,
  MsReadingSheets,
  MsWordSheets,
  MsWorkbookAnswerSheets,
  MsWorkbookSheets,
  msAnalyzed,
  type MsAnalysisOptions,
} from "./MsSheets";
import { MsExamBySource } from "./MsExamViews";

/*
 * 최종통합자료(중학교) — 선생님 2026-10-31·11-01:
 *   표지 → 목차 → 단어(단어장) → 대화문(대화문 → 본문학습 STEP2 문제) → 문법(문법 설명 → 본문학습 STEP3 문제)
 *   → 본문(수업용 자료 → 분석지 → 본문 워크북) → 변형문제(대표유형 풀어보기 → 예상문제 PRE-STEP·1회·2회) → 정답지.
 * 문제는 출처별로 따로 찍는다. 단어·대화문 워크북은 기본으로 끔(켤 수 있음).
 * 고등 최종통합자료·테스트 교재와 같은 부품(표지·목차·간지·쪽 번호). 크레딧 없음(정수학원만).
 */

const DEFAULT_WB: MsWbTypeKey[] = ["r_line", "r_en_blank", "r_grammar", "r_word_order", "r_writing", "d_line", "w_en_ko"];
const COUNTS = [0, 10, 20, 30] as const;
const LENGTHS: { id: MsDrawLength; label: string }[] = [
  { id: "short", label: "짧게" },
  { id: "normal", label: "보통" },
  { id: "long", label: "길게" },
];

type PartId = "words" | "dialogue" | "grammar" | "reading" | "exam" | "answers";
/** 묶음 ↔ 문제 영역 · 워크북 묶음 */
/** 문항이 들어갈 묶음: 본문학습 STEP2는 대화문, STEP3은 문법, 대표유형·예상문제는 영역과 상관없이 변형문제. 그 밖의 출처는 켰을 때 영역대로 */
function partOfQuestion(q: MsQuestion): Exclude<PartId, "answers"> {
  if (/^본문학습 STEP2/.test(q.source)) return "dialogue";
  if (/^본문학습 STEP3/.test(q.source)) return "grammar";
  if (/^(대표유형|예상문제)/.test(q.source)) return "exam";
  return q.area === "의사소통" ? "dialogue" : q.area === "어법" ? "grammar" : "exam";
}
const DEFAULT_SOURCE = /^(본문학습|대표유형|예상문제)/;
const PART_WB: Partial<Record<PartId, MsWbGroup>> = { words: "단어", dialogue: "대화문", reading: "본문" };
const PART_KO: Record<Exclude<PartId, "answers">, string> = { words: "단어", dialogue: "대화문", grammar: "문법", reading: "본문", exam: "변형문제" };
const qLabel = (k: Exclude<PartId, "answers">) => (k === "exam" ? "변형문제" : `${PART_KO[k]} 문제`);

function Section({ title, on, onToggle, children }: { title: string; on?: boolean; onToggle?: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <label className="flex items-center gap-2 font-bold text-slate-800">
        {onToggle ? <input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} /> : null}
        {title}
      </label>
      {on !== false && children ? <div className="mt-2 space-y-1.5 pl-1 text-[12px]">{children}</div> : null}
    </div>
  );
}

function Toggle({ label, on, onChange, dim, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; dim?: boolean; hint?: string }) {
  return (
    <label className={`flex items-center gap-2 py-0.5 ${dim ? "text-slate-300" : ""}`}>
      <input type="checkbox" checked={on} disabled={dim} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">{label}</span>
      {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

function Radio<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      {options.map(([v, label]) => (
        <label key={v} className="flex items-center gap-1.5">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}

type PartOpts = { on: boolean; workbook: boolean; questions: boolean };

export function MsFinalTab({
  unit,
  questions,
  design,
  setDesign,
  academyName,
  base,
  printOnly = null,
}: {
  unit: MsUnit;
  questions: MsQuestion[];
  design: MaterialDesign;
  setDesign: (d: MaterialDesign) => void;
  academyName: string;
  base: string;
  /** 과 카드 「본교재 출력」(정답지 빼고) · 「정답지 출력」(표지 + 정답지만) — 선생님 2026-11-04 */
  printOnly?: "book" | "answers" | null;
}) {
  const answersOnly = printOnly === "answers";
  const analyzedCount = msAnalyzed(unit).length;
  const sources = useMemo(() => sortMsSources(questions.filter((q) => !q.review).map((q) => q.source)), [questions]);

  // ---------------------------------------------------------------- 표지
  const [presetId, setPresetId] = useState(DEFAULT_INTEGRATED_COVER.presetId);
  const [spec, setSpec] = useState<BookCoverSpec>(() => {
    const s = suggestedExam();
    return {
      ...EMPTY_BOOK_COVER_SPEC,
      grade: unit.grade,
      year: String(new Date().getFullYear()),
      semester: s.semester,
      exam: s.exam,
      material: answersOnly ? "최종통합자료 정답지" : "최종통합자료",
      textbook: "영어",
      publisher: unit.publisher,
      range: `${unit.lessonNo}과 ${unit.title}`,
      brand: academyName,
    };
  });
  const [coverOpen, setCoverOpen] = useState(false);
  const cover: IntegratedCover = useMemo(
    () => ({ ...DEFAULT_INTEGRATED_COVER, presetId, academy: academyName, title: spec.material, exam: spec }),
    [presetId, academyName, spec],
  );
  const range = `${unit.grade} ${unit.publisher} ${unit.lessonNo}과`;
  const bookTitle = `${unit.grade} ${unit.lessonNo}과 ${spec.material || "최종통합자료"}`;

  // ---------------------------------------------------------------- 묶음 설정
  const [toc, setToc] = useState(!answersOnly);
  const [dividers, setDividers] = useState(true);
  const [parts, setParts] = useState<Record<Exclude<PartId, "answers">, PartOpts>>({
    words: { on: unit.words.length > 0, workbook: false, questions: false },
    dialogue: { on: unit.dialogues.length > 0, workbook: false, questions: true },
    grammar: { on: unit.grammar.length > 0, workbook: false, questions: true },
    reading: { on: unit.passages.length > 0, workbook: true, questions: false },
    exam: { on: true, workbook: false, questions: true },
  });
  const setPart = (k: Exclude<PartId, "answers">, patch: Partial<PartOpts>) => setParts((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
  const [answersOn, setAnswersOn] = useState(printOnly !== "book");
  const [wordExamples, setWordExamples] = useState(true);
  const [dialogueTr, setDialogueTr] = useState<"show" | "hide">("show");
  const [readingTr, setReadingTr] = useState<"show" | "hide">("show");
  const [withAnalysis, setWithAnalysis] = useState(analyzedCount > 0);
  const [analysis, setAnalysis] = useState<MsAnalysisOptions>({ style: "a", translation: "full" });
  // 워크북(모든 묶음 공통): 유형 · 전체/뽑기
  const [types, setTypes] = useState<MsWbTypeKey[]>(DEFAULT_WB);
  const [wbMode, setWbMode] = useState<"all" | MsDrawLength>("all");
  const [wbSeed, setWbSeed] = useState(`${Date.now()}`);
  // 변형문제(모든 묶음 공통): 출처 · 객관식/서술형 · 출처당 문항 수
  // 기본은 본문학습·대표유형·예상문제 — 선생님 2026-11-01. 최다빈출·최상위·최다오답·Grammar Build Up은 켜면 들어감
  const [src, setSrc] = useState<string[]>(() => sources.filter((s) => DEFAULT_SOURCE.test(s)));
  const [kinds, setKinds] = useState<("mc" | "sa")[]>(["mc", "sa"]);
  const [qCount, setQCount] = useState<number>(0);
  const [qSeed, setQSeed] = useState(`${Date.now()}`);

  const counts = useMemo(() => msWbCounts(unit, unit.workbook), [unit]);
  /** 묶음마다 그 묶음 유형의 워크북(전체 또는 뽑기) */
  const sheetsOf = useMemo(() => {
    const out: Partial<Record<MsWbGroup, MsWbSheet[]>> = {};
    for (const g of ["단어", "대화문", "본문"] as MsWbGroup[]) {
      const ts = types.filter((t) => MS_WB_TYPES.find((x) => x.key === t)?.group === g && counts[t]);
      out[g] = ts.length ? (wbMode === "all" ? buildMsWorkbook(unit, unit.workbook, ts) : drawMsWorkbook(unit, unit.workbook, ts, wbMode, `${wbSeed}|${g}`)) : [];
    }
    return out;
  }, [unit, types, counts, wbMode, wbSeed]);
  /** 묶음마다 그 영역의 족보닷컴 문항(출처 차례 → 자료 안 차례; 출처당 N이면 출처마다 무작위) */
  const questionsOf = useMemo(() => {
    const pool = questions.filter((q) => src.includes(q.source) && kinds.includes(q.kind) && !q.review);
    const rand = seeded(qSeed);
    const out: Record<string, MsQuestion[]> = {};
    for (const part of ["words", "dialogue", "grammar", "reading", "exam"] as const) {
      const mine = pool.filter((q) => partOfQuestion(q) === part);
      if (!qCount) {
        out[part] = sortMsQuestions(mine);
        continue;
      }
      const keep = new Set<number>();
      for (const s of sortMsSources(mine.map((q) => q.source))) {
        shuffle(mine.filter((q) => q.source === s).map((q) => q.id), rand).slice(0, qCount).forEach((id) => keep.add(id));
      }
      out[part] = sortMsQuestions(mine.filter((q) => keep.has(q.id)));
    }
    return out;
  }, [questions, src, kinds, qCount, qSeed]);

  const toggle = <T,>(list: T[], v: T, onIt: boolean): T[] => (onIt ? [...list, v] : list.filter((x) => x !== v));

  /** 묶음이 실제로 실리는지와 그 안에 드는 것 */
  const plan = (k: Exclude<PartId, "answers">) => {
    const p = parts[k];
    const wbGroup = PART_WB[k];
    const sheets = p.on && p.workbook && wbGroup ? (sheetsOf[wbGroup] ?? []) : [];
    const qs = p.on && p.questions ? (questionsOf[k] ?? []) : [];
    const body = k === "words" ? unit.words.length > 0 : k === "dialogue" ? unit.dialogues.length > 0 : k === "grammar" ? unit.grammar.length > 0 : k === "reading" ? unit.passages.length > 0 : false;
    return { on: p.on && (body || sheets.length > 0 || qs.length > 0), body, sheets, qs };
  };
  const P = { words: plan("words"), dialogue: plan("dialogue"), grammar: plan("grammar"), reading: plan("reading"), exam: plan("exam") };
  const analysisOn = P.reading.on && withAnalysis && analyzedCount > 0;
  const allSheets = [...P.words.sheets, ...P.dialogue.sheets, ...P.reading.sheets];
  const anyQuestions = Object.values(P).some((x) => x.qs.length > 0);
  const answersShown = answersOn && (allSheets.length > 0 || anyQuestions);

  const subOf = (k: Exclude<PartId, "answers">, body: string) => {
    const x = P[k];
    const n = qCount ? "" : ` ${x.qs.length}문항`;
    return [body, x.sheets.length ? (wbMode === "all" ? "워크북" : "테스트지") : "", x.qs.length ? `${qLabel(k)}${n}` : ""].filter(Boolean).join(" · ");
  };
  /** 교재 묶음(목차·간지·쪽 색) — 켠 것만 차례로 번호 */
  const bookParts: BookPart[] = (
    [
      P.words.on ? { id: "words", en: "Words", ko: "단어", sub: subOf("words", `${unit.words.length}단어${wordExamples ? " · 예문" : ""}`), color: "#1d2a8f" } : null,
      P.dialogue.on ? { id: "dialogue", en: "Dialogue", ko: "대화문", sub: subOf("dialogue", dialogueTr === "show" ? "말차례별 해석" : "해석 쓰기"), color: "#0f8a7e" } : null,
      P.grammar.on ? { id: "grammar", en: "Grammar", ko: "문법", sub: subOf("grammar", unit.grammar.map((g) => g.title).join(" · ")), color: "#b4610a" } : null,
      P.reading.on
        ? { id: "reading", en: "Reading", ko: "본문", sub: subOf("reading", `${readingTr === "show" ? "문장별 해석" : "해석 쓰기"}${analysisOn ? " · 분석지" : ""}`), color: "#6a4bd8" }
        : null,
      P.exam.on ? { id: "exam", en: "Questions", ko: "변형문제", sub: subOf("exam", `출처 ${sortMsSources(P.exam.qs.map((q) => q.source)).length}종`), color: "#be123c" } : null,
      answersShown
        ? { id: "answers", en: "Answer Key", ko: "정답지", sub: [allSheets.length ? "워크북 정답" : "", anyQuestions ? "문제 해설" : ""].filter(Boolean).join(" · "), color: "#475066" }
        : null,
    ] as Array<Omit<BookPart, "no"> | null>
  )
    .filter((x): x is Omit<BookPart, "no"> => !!x)
    .map((x, i) => ({ ...x, no: String(i + 1).padStart(2, "0") }));
  const partOf = (id: PartId) => bookParts.find((x) => x.id === id);

  /** 목차 쪽 번호: 그린 쪽(테스트 교재 쪽·변형문제 쪽)을 차례로 세어 묶음의 첫 쪽을 찾는다 */
  const [tocPages, setTocPages] = useState<Record<string, number>>({});
  useEffect(() => {
    const root = document.getElementById("tb-print-root");
    if (!root) return;
    const count = () => {
      const all = Array.from(root.querySelectorAll<HTMLElement>(".tb-sheet, .qg-print-page")).filter((el) => !el.closest(".tb-measure"));
      const next: Record<string, number> = {};
      root.querySelectorAll<HTMLElement>("[data-toc]").forEach((w) => {
        const first = Array.from(w.querySelectorAll<HTMLElement>(".tb-sheet, .qg-print-page")).find((el) => !el.closest(".tb-measure"));
        if (first && w.dataset.toc) next[w.dataset.toc] = all.indexOf(first) + 1;
      });
      next.__total = all.length;
      setTocPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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

  const divider = (id: PartId, items: Array<{ id: string; title: string; source?: string | null }>) => {
    const part = partOf(id);
    if (!part || !toc || !dividers) return null;
    return <DividerSheet part={part} title={bookTitle} items={items.map((x, i) => ({ id: x.id, index: i, title: x.title, source: x.source ?? null }))} />;
  };
  /** 간지 목록: 설명 항목 → 워크북 → 문제 출처 */
  const itemsOf = (k: Exclude<PartId, "answers">, body: Array<{ id: string; title: string }>) => {
    const x = P[k];
    return [
      ...body,
      ...(x.sheets.length ? [{ id: "wb", title: `${PART_KO[k]} ${wbMode === "all" ? "워크북" : "테스트지"}` }] : []),
      ...sortMsSources(x.qs.map((q) => q.source)).map((s) => ({ id: `q-${s}`, title: `${qLabel(k)} · ${s}`, source: `${x.qs.filter((q) => q.source === s).length}문항` })),
    ];
  };
  const mk = `${unit.id}-${design}-${wordExamples}-${dialogueTr}-${readingTr}-${types.join(",")}-${wbMode}-${wbSeed}`;
  const TR = [
    ["show", "해석 함께"],
    ["hide", "해석 쓰는 줄"],
  ] as const;
  const wbTitle = wbMode === "all" ? "워크북" : "테스트";
  const exam = (k: Exclude<PartId, "answers">, mode: "exam" | "answers") =>
    P[k].qs.length ? <MsExamBySource unit={unit} questions={P[k].qs} mode={mode} design={design} academyName={academyName} base={base} label={qLabel(k)} /> : null;
  const wbCountOf = (g: MsWbGroup) => MS_WB_TYPES.filter((t) => t.group === g && types.includes(t.key) && counts[t.key]).length;
  const qCountOf = (k: Exclude<PartId, "answers">) => (questionsOf[k] ?? []).length;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <aside className="no-print w-full shrink-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden lg:sticky lg:top-4 lg:w-72 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <MaterialDesignPicker value={design} onChange={setDesign} compact />

        <Section title="표지 · 목차">
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-slate-500">표지</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-[12px]">
              {COVER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => setCoverOpen((v) => !v)} className="text-[12px] text-violet-700 underline">
            {coverOpen ? "표지 칸 닫기" : "표지 칸 고치기 (학교·시험·범위)"}
          </button>
          {coverOpen ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <CoverForm spec={spec} onPatch={(patch) => setSpec((s) => ({ ...s, ...patch }))} />
            </div>
          ) : null}
          <Toggle label="목차" on={toc} onChange={setToc} />
          <Toggle label="묶음마다 간지" on={dividers} onChange={setDividers} dim={!toc} />
        </Section>

        <Section title="단어" on={parts.words.on} onToggle={(v) => setPart("words", { on: v })}>
          <Toggle label="단어장에 예문" on={wordExamples} onChange={setWordExamples} />
          <Toggle label="단어 워크북" on={parts.words.workbook} onChange={(v) => setPart("words", { workbook: v })} hint={`유형 ${wbCountOf("단어")}`} />
        </Section>

        <Section title={`대화문${unit.dialogues.length ? "" : " (없음)"}`} on={parts.dialogue.on} onToggle={(v) => setPart("dialogue", { on: v })}>
          <Radio name="ms-fin-dtr" value={dialogueTr} options={TR} onChange={setDialogueTr} />
          <Toggle label="대화문 워크북" on={parts.dialogue.workbook} onChange={(v) => setPart("dialogue", { workbook: v })} hint={`유형 ${wbCountOf("대화문")}`} />
          <Toggle label="대화문 문제 (의사소통)" on={parts.dialogue.questions} onChange={(v) => setPart("dialogue", { questions: v })} hint={`${qCountOf("dialogue")}문항`} />
        </Section>

        <Section title={`문법${unit.grammar.length ? "" : " (없음)"}`} on={parts.grammar.on} onToggle={(v) => setPart("grammar", { on: v })}>
          <p className="text-[11px] text-slate-500">{unit.grammar.map((g) => g.title).join(" · ")}</p>
          <Toggle label="문법 문제 (어법)" on={parts.grammar.questions} onChange={(v) => setPart("grammar", { questions: v })} hint={`${qCountOf("grammar")}문항`} />
        </Section>

        <Section title="본문" on={parts.reading.on} onToggle={(v) => setPart("reading", { on: v })}>
          <Radio name="ms-fin-rtr" value={readingTr} options={TR} onChange={setReadingTr} />
          <Toggle label={`분석지${analyzedCount ? "" : " (준비 중)"}`} on={withAnalysis && analyzedCount > 0} onChange={setWithAnalysis} dim={!analyzedCount} />
          {withAnalysis && analyzedCount ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-slate-500">모양</span>
                <div className="flex flex-1 gap-1">
                  {DESIGN_STYLES.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      title={d.hint}
                      onClick={() => setAnalysis({ ...analysis, style: d.id })}
                      className={`flex-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                        analysis.style === d.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <Radio
                name="ms-fin-an"
                value={analysis.translation}
                options={[
                  ["full", "전체 해석"],
                  ["chunk", "직독직해"],
                ]}
                onChange={(v) => setAnalysis({ ...analysis, translation: v })}
              />
            </>
          ) : null}
          <Toggle label="본문 워크북" on={parts.reading.workbook} onChange={(v) => setPart("reading", { workbook: v })} hint={`유형 ${wbCountOf("본문")}`} />
        </Section>

        <Section title="변형문제 (족보닷컴)" on={parts.exam.on} onToggle={(v) => setPart("exam", { on: v })}>
          <p className="text-[11px] text-slate-500">대표유형 풀어보기 · 예상문제 {qCountOf("exam")}문항을 출처별로 묶습니다.</p>
        </Section>

        <Section title="워크북 설정">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setWbMode("all")}
              className={`flex-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${wbMode === "all" ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700"}`}
            >
              전체
            </button>
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setWbMode(l.id);
                  setWbSeed(`${Date.now()}`);
                }}
                className={`flex-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${wbMode === l.id ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">전체 = 워크북 문항 모두. 짧게·보통·길게 = 무작위로 뽑은 테스트지(누를 때마다 새로). 유형은 단어·대화문·본문 묶음에 각각 들어갑니다.</p>
          {(["본문", "대화문", "단어"] as MsWbGroup[]).map((g) => (
            <div key={g}>
              <div className="mb-0.5 text-[11px] font-bold text-slate-500">{g}</div>
              <div className="columns-2 gap-2">
                {MS_WB_TYPES.filter((t) => t.group === g).map((t) => (
                  <label key={t.key} className={`flex items-center gap-1.5 py-0.5 ${counts[t.key] ? "" : "text-slate-300"}`} title={t.hint}>
                    <input
                      type="checkbox"
                      disabled={!counts[t.key]}
                      checked={types.includes(t.key)}
                      onChange={(e) => setTypes(MS_WB_TYPES.map((x) => x.key).filter((x) => (x === t.key ? e.target.checked : types.includes(x))))}
                    />
                    <span className="truncate">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section title={`문제 설정 (족보닷컴)${sources.length ? "" : " · 문항 없음"}`}>
          <p className="text-[11px] text-slate-500">본문학습 커뮤니케이션은 대화문 뒤, 교과서 속 문법은 문법 뒤, 대표유형 · 예상문제는 변형문제 묶음에 들어갑니다. 출처마다 따로 묶어 1번부터.</p>
          {sources.map((s) => (
            <label key={s} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={src.includes(s)} onChange={(e) => setSrc(toggle(src, s, e.target.checked))} />
              <span className="flex-1">{s}</span>
              <span className="text-[11px] text-slate-400">{questions.filter((q) => q.source === s && !q.review).length}</span>
            </label>
          ))}
          <div className="flex gap-3">
            {(
              [
                ["mc", "객관식"],
                ["sa", "서술형"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(toggle(kinds, k, e.target.checked))} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex gap-1">
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setQCount(n);
                  setQSeed(`${Date.now()}`);
                }}
                className={`flex-1 rounded-md border px-1 py-0.5 text-xs font-semibold ${qCount === n ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700"}`}
              >
                {n ? `출처당 ${n}` : "전체"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">「출처당 N」은 영역·출처마다 N문항을 무작위로(누를 때마다 새로).</p>
        </Section>

        <Section title="정답지" on={answersOn} onToggle={setAnswersOn}>
          <p className="text-[11px] text-slate-500">워크북·테스트지 정답과 문제 해설을 맨 뒤에 묶음 차례로 모읍니다.</p>
        </Section>

        <button type="button" onClick={() => window.print()} className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800">
          인쇄
        </button>
        <MsPdfButton fileName={answersOnly ? `${bookTitle}` : printOnly === "book" ? `${bookTitle} 본교재` : bookTitle} />
      </aside>

      <div className="min-w-0 flex-1 overflow-x-auto bg-slate-100 py-4 print:overflow-visible print:bg-white print:p-0">
        <MsPrintFrame design={design} academyName={academyName}>
          <CoverSheet cover={cover} range={range} logoSrc={null} />
          {toc ? <ContentsSheet parts={bookParts} pages={tocPages} total={tocPages.__total ?? 0} title={bookTitle} range={range} /> : null}

          {!answersOnly && P.words.on ? (
            <div data-toc="words" className="contents" style={partStyle(partOf("words"))}>
              {divider("words", itemsOf("words", [{ id: "list", title: "단어장" }]))}
              {P.words.body ? <MsWordSheets unit={unit} examples={wordExamples} measureKey={mk} /> : null}
              <MsWorkbookSheets sheets={P.words.sheets} answers={false} title={`단어 ${wbTitle}`} measureKey={mk} />
              {exam("words", "exam")}
            </div>
          ) : null}

          {!answersOnly && P.dialogue.on ? (
            <div data-toc="dialogue" className="contents" style={partStyle(partOf("dialogue"))}>
              {divider("dialogue", itemsOf("dialogue", unit.dialogues.map((t) => ({ id: t.id, title: t.title ?? t.part }))))}
              {P.dialogue.body ? <MsDialogueSheets unit={unit} translation={dialogueTr} measureKey={mk} /> : null}
              <MsWorkbookSheets sheets={P.dialogue.sheets} answers={false} title={`대화문 ${wbTitle}`} measureKey={mk} />
              {exam("dialogue", "exam")}
            </div>
          ) : null}

          {!answersOnly && P.grammar.on ? (
            <div data-toc="grammar" className="contents" style={partStyle(partOf("grammar"))}>
              {divider("grammar", itemsOf("grammar", unit.grammar.map((g, i) => ({ id: `g${i}`, title: g.title }))))}
              {P.grammar.body ? <MsGrammarSheets unit={unit} measureKey={mk} /> : null}
              {exam("grammar", "exam")}
            </div>
          ) : null}

          {!answersOnly && P.reading.on ? (
            <div data-toc="reading" className="contents" style={partStyle(partOf("reading"))}>
              {divider("reading", itemsOf("reading", unit.passages.map((t) => ({ id: t.id, title: `${t.part} ${t.title ?? ""}`.trim() }))))}
              {P.reading.body ? <MsReadingSheets unit={unit} translation={readingTr} measureKey={mk} /> : null}
              {analysisOn ? <MsAnalysisSheets unit={unit} options={analysis} measureKey={mk} /> : null}
              <MsWorkbookSheets sheets={P.reading.sheets} answers={false} title={`본문 ${wbTitle}`} measureKey={mk} />
            </div>
          ) : null}

          {!answersOnly && P.exam.on ? (
            <div data-toc="exam" className="contents" style={partStyle(partOf("exam"))}>
              {divider("exam", itemsOf("exam", []))}
              {exam("exam", "exam")}
            </div>
          ) : null}

          {answersShown ? (
            <div data-toc="answers" className="contents" style={partStyle(partOf("answers"))}>
              {divider("answers", [
                ...(allSheets.length ? [{ id: "wb", title: `${wbTitle} 정답` }] : []),
                ...(["dialogue", "grammar", "exam"] as const).filter((k) => P[k].qs.length).map((k) => ({ id: `q-${k}`, title: `${qLabel(k)} 해설` })),
              ])}
              {allSheets.length ? <MsWorkbookAnswerSheets sheets={allSheets} title={`${wbTitle} 정답`} measureKey={mk} /> : null}
              {exam("dialogue", "answers")}
              {exam("grammar", "answers")}
              {exam("exam", "answers")}
            </div>
          ) : null}
        </MsPrintFrame>
      </div>
    </div>
  );
}
