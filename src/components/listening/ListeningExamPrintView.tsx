"use client";

import Link from "next/link";
import { Icon } from "@/components/layout/NavIcon";
import { ACADEMY_NAME, LOGO_SRC } from "@/lib/branding";
import { Button } from "@/components/ui/Button";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ListeningQuestionData } from "@/components/listening/ListeningQuestionEditor";
import { shouldHideTextChoicesForFigure } from "@/lib/listening/figure-choice-display";
import { ListeningPrintQrCode } from "@/components/listening/ListeningPrintQrCode";
import { displayQuestionText } from "@/lib/listening/question-display";
import { isLabelOnlyChoiceSet } from "@/lib/listening/balance-correct-answer";
import { splitTableColumns } from "@/components/listening/ListeningTableDisplay";
import { buildStudentListeningHubUrl } from "@/lib/listening/listen-url";
import {
  moveLastOverflowItem,
  paginateExamQuestions,
  paginateStandardTwentyExam,
  isStandardTwentyQuestionExam,
  type ExamPageLayout,
} from "@/lib/listening/paginate-exam-questions";
import { normalizeTableData } from "@/lib/listening/table-data";
import type { ListeningTableData } from "@/lib/listening/types";
import "./listening-print-styles.css";

const CIRCLED = ["①", "②", "③", "④", "⑤"] as const;

/*
 * 시험지 모양. 변형문제·분석지와 같은 시안 셋(A 교재 세리프 · B 깔끔한 산세리프 · C 클래식 인쇄)을
 * 고를 수 있게 했다. 예전 모양(파란 머리 상자)은 다른 자료처럼 목록에서 빼고 처음엔 A로 연다. 문항 구성은 같고 글꼴·색·테두리만
 * 바꾼다 — listening-print-styles.css의 .ls-style-*.
 */
type ListeningDesignStyle = "base" | "a" | "b" | "c";
const DESIGN_STYLE_KEY = "listening-print-design-style";
const DESIGN_STYLES: Array<{ id: ListeningDesignStyle; label: string; hint: string }> = [
  { id: "a", label: "A", hint: "교재 세리프" },
  { id: "b", label: "B", hint: "깔끔한 산세리프" },
  { id: "c", label: "C", hint: "클래식 인쇄" },
];
/** A·B·C가 쓰는 글꼴. 기본 모양에서는 불러오지 않는다. */
const DESIGN_FONTS_HREF =
  "/fonts/print/fonts.css";

function designClass(style: ListeningDesignStyle): string {
  return style === "base" ? "" : `ls-style ls-style-${style}`;
}

/** 첫 쪽 머리의 학생 기록 칸 (이름 칸에는 출력 설정에 적은 이름을 채운다) */
const HEADER_FIELDS = ["학년", "반", "번호", "이름", "점수"] as const;

/*
 * 짧은 선택지는 한 줄에 늘어놓는다(5개·3개·2개씩). 글자 수만 세면 한글과 영어 폭이 달라
 * 단(약 80mm, 10pt) 밖으로 넘치므로 글자마다 대략의 폭(em)을 더해 판단한다.
 * 한 칸에서 번호(①)·간격을 빼고 남는 폭: 5개 ≈ 2.3em · 3개 ≈ 5.3em · 2개 ≈ 9.1em.
 * (한글 한 글자 ≈ 0.95em, 영어 한 글자 ≈ 0.5em — 영어는 같은 폭에 약 1.6~1.8배 들어간다.)
 */
type ChoiceRowLayout = "row5" | "row3" | "row2";
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힣]/;

function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch)) em += 0.3;
    else if (ch.charCodeAt(0) > 0x2e7f) em += 0.95;
    else if (/[il.,:;'!|]/.test(ch)) em += 0.28;
    else if (/[MWmw@%&]/.test(ch)) em += 0.8;
    else if (/[A-Z]/.test(ch)) em += 0.65;
    else if (/[0-9$]/.test(ch)) em += 0.56;
    else em += 0.52;
  }
  return em;
}

function shortChoiceLayout(choices: string[]): ChoiceRowLayout | null {
  const texts = choices.map((c) => String(c ?? "").trim());
  if (texts.length !== 5 || texts.some((t) => !t)) return null;
  const widest = Math.max(...texts.map(estimateTextEm));
  if (widest <= 2.3) return "row5";
  if (widest <= 4.9) return "row3";
  if (widest <= 8.6) return "row2";
  return null;
}
/** 실제 인쇄 열보다 약간 좁게 재어 줄바꿈 여유를 둠 */
const COLUMN_WIDTH_CLASS = "w-[84mm]";
/** 문항 간격 */
const QUESTION_GAP_MM = 5;
const QUESTION_GAP_MM_WITH_SCRIPT = 3;
/** 정답지 항목 간격 — 항목마다 정답 줄 + 대본 칸이라 카드가 떨어져 보이게 */
const ANSWER_GAP_MM = 2.2;
/** 표준 20문항 시험에서 5+5가 들어갈 때까지 줄여 보는 문항 글자 크기 */
const QUESTION_SIZES_PT: number[] = [10, 9.7, 9.4, 9.1, 8.8, 8.5];

/**
 * 20문항을 두 쪽에 담기 위한 단계. 글자만 줄이면 그림 문항이 있는 중등 시험지는 세 쪽이 됐다.
 * 줄간격·문항 간격·그림 높이까지 같이 줄여 가며 5+5가 들어가는 첫 단계를 쓴다.
 */
type TightStep = { sizePt: number; lineHeight: number; gapMm: number; figureMaxMm: number };
const TIGHT_STEPS: TightStep[] = [
  { sizePt: 10, lineHeight: 1.36, gapMm: 5, figureMaxMm: 64 },
  { sizePt: 9.7, lineHeight: 1.33, gapMm: 4.4, figureMaxMm: 60 },
  { sizePt: 9.4, lineHeight: 1.3, gapMm: 3.8, figureMaxMm: 55 },
  { sizePt: 9.1, lineHeight: 1.28, gapMm: 3.2, figureMaxMm: 50 },
  { sizePt: 8.8, lineHeight: 1.26, gapMm: 2.8, figureMaxMm: 46 },
  { sizePt: 8.5, lineHeight: 1.24, gapMm: 2.4, figureMaxMm: 42 },
  { sizePt: 8.2, lineHeight: 1.22, gapMm: 2, figureMaxMm: 38 },
];

function tightVars(step: TightStep): CSSProperties {
  return {
    "--lx-q-size": `${step.sizePt}pt`,
    "--lx-q-lh": `${step.lineHeight}`,
    "--lx-fig-max": `${step.figureMaxMm}mm`,
  } as CSSProperties;
}
const COLUMN_SAFETY_PX = 16;
const COLUMN_SAFETY_PX_WITH_SCRIPT = 28;
const COLUMN_SAFETY_PX_WITH_FIGURE = 28;
const MAX_OVERFLOW_FIXES = 24;
const A4_HEIGHT_PX = Math.round((297 * 96) / 25.4);

function getExamLayoutConfig(
  showScript: boolean,
  hasFigureQuestions: boolean
) {
  const gapMm = showScript ? QUESTION_GAP_MM_WITH_SCRIPT : QUESTION_GAP_MM;
  const safety = showScript
    ? COLUMN_SAFETY_PX_WITH_SCRIPT
    : hasFigureQuestions
      ? COLUMN_SAFETY_PX_WITH_FIGURE
      : COLUMN_SAFETY_PX;
  return {
    gapMm,
    gapPx: Math.round((gapMm * 96) / 25.4),
    gapStyle: { gap: `${gapMm}mm` } as const,
    columnSafetyPx: safety,
  };
}

function questionsHaveFigures(questions: ListeningQuestionData[]): boolean {
  return questions.some((q) =>
    (q.choice_image_urls ?? []).some((u) => String(u).trim())
  );
}

/** 인쇄 측정 전에 그림 로드 완료 대기 (미로드 높이로 단 배치되면 잘림) */
function waitForImages(root: HTMLElement, timeoutMs = 12000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
      )
    ),
    new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), timeoutMs);
    }),
  ]).then(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      })
  );
}

function columnUsedHeight(indices: number[], heights: number[], gapPx: number) {
  let used = 0;
  for (let i = 0; i < indices.length; i++) {
    used += heights[indices[i]!]! + (i > 0 ? gapPx : 0);
  }
  return used;
}

/**
 * 정답지 배치 — 실제 잰 높이대로 왼쪽 단을 채우고 넘치면 오른쪽 단, 그다음 쪽으로 넘긴다.
 * (예전에는 두 단 몫을 모은 뒤 "개수"로 반을 갈라서, 대본이 긴 항목이 몰리면 단 아래가 잘렸다.)
 */
function paginateAnswerKey(
  heights: number[],
  opts: {
    firstColumnMaxPx: number;
    nextColumnMaxPx: number;
    questionGapPx: number;
    columnSafetyPx?: number;
  }
): ExamPageLayout[] {
  if (heights.length === 0) return [];
  const safety = opts.columnSafetyPx ?? 0;
  const pages: ExamPageLayout[] = [];
  let idx = 0;
  let pageIndex = 0;

  while (idx < heights.length) {
    const max =
      (pageIndex === 0 ? opts.firstColumnMaxPx : opts.nextColumnMaxPx) - safety;
    const page: ExamPageLayout = { left: [], right: [] };

    for (const side of ["left", "right"] as const) {
      const col = page[side];
      let used = 0;
      while (idx < heights.length) {
        const need = heights[idx]! + (col.length > 0 ? opts.questionGapPx : 0);
        if (col.length > 0 && used + need > max) break;
        // 한 항목이 단보다 길면 어쩔 수 없이 그 단에 혼자 담는다 (무한 루프 방지)
        col.push(idx);
        used += need;
        idx++;
        if (used > max) break;
      }
    }

    if (page.left.length === 0 && page.right.length === 0) {
      page.left.push(idx);
      idx++;
    }
    // 왼쪽만 차고 오른쪽이 비면 보기 나쁘다 — 두 단 다 들어갈 때만 뒤쪽을 옮긴다
    if (page.right.length === 0 && page.left.length > 1) {
      balanceAnswerColumns(page, heights, opts.questionGapPx, max);
    }
    pages.push(page);
    pageIndex++;
  }
  return pages;
}

/** 한 쪽 안에서 두 단 높이 차를 줄인다 (두 단 모두 들어갈 때만 옮긴다) */
function balanceAnswerColumns(
  page: ExamPageLayout,
  heights: number[],
  gapPx: number,
  maxPx: number
) {
  while (page.left.length > 1) {
    const candidate: ExamPageLayout = {
      left: page.left.slice(0, -1),
      right: [page.left[page.left.length - 1]!, ...page.right],
    };
    const leftH = columnUsedHeight(candidate.left, heights, gapPx);
    const rightH = columnUsedHeight(candidate.right, heights, gapPx);
    if (rightH > maxPx) break;
    const before = Math.abs(
      columnUsedHeight(page.left, heights, gapPx) -
        columnUsedHeight(page.right, heights, gapPx)
    );
    if (Math.abs(leftH - rightH) >= before) break;
    page.left = candidate.left;
    page.right = candidate.right;
  }
}

/** 고정 5+5 배치가 실제로 단 안에 들어가는지 (안 들어가면 높이대로 다시 채운다) */
function layoutFits(
  layouts: ExamPageLayout[],
  heights: number[],
  opts: {
    firstColumnMaxPx: number;
    nextColumnMaxPx: number;
    questionGapPx: number;
    columnSafetyPx?: number;
  }
): boolean {
  const safety = opts.columnSafetyPx ?? 0;
  return layouts.every((layout, pageIndex) => {
    const max =
      (pageIndex === 0 ? opts.firstColumnMaxPx : opts.nextColumnMaxPx) - safety;
    return (
      columnUsedHeight(layout.left, heights, opts.questionGapPx) <= max &&
      columnUsedHeight(layout.right, heights, opts.questionGapPx) <= max
    );
  });
}

/** off-screen flex 측정이 0으로 나오는 경우 대비 */
function resolveColumnMaxPx(bodyZone: HTMLElement): number {
  const measured = bodyZone.clientHeight;
  if (measured >= 420) return measured;
  const sheet = bodyZone.closest(".listening-exam-sheet");
  const header = sheet?.querySelector("header");
  const footer = sheet?.querySelector("footer");
  const headerH = header?.getBoundingClientRect().height ?? 200;
  const footerH = footer?.getBoundingClientRect().height ?? 36;
  return Math.max(420, A4_HEIGHT_PX - Math.ceil(headerH) - Math.ceil(footerH) - 48);
}

type PrintScope = "exam" | "answers" | "all";

interface ListeningExamPrintViewProps {
  title: string;
  gradeLabel?: string;
  questions: ListeningQuestionData[];
  backHref: string;
  showScript?: boolean;
  setId: string;
}

interface PrintMeta {
  examTitle: string;
  gradeLabel: string;
  studentName: string;
}

function answerLabel(correctAnswer: number): string {
  const idx = correctAnswer - 1;
  return CIRCLED[idx] ?? String(correctAnswer);
}

/** 머리 띠의 회차 — 제목의 "N회"를 쓰고, 없으면 띠에서 뺀다 */
function examEditionLabel(examTitle: string): string | null {
  const hit = examTitle.match(/(\d{1,3})\s*회/);
  if (!hit) return null;
  return hit[1]!.padStart(2, "0");
}

function speakerLabel(type: string): string {
  const t = type.toUpperCase();
  if (t === "M" || t === "MAN") return "M";
  if (t === "W" || t === "WOMAN") return "W";
  if (t === "A" || t === "ANN") return "A";
  return type;
}

function renderScriptWithBlanks(text: string, blankOffset: { n: number }) {
  const parts = text.split(/(_{4,}|\[blank\])/gi);
  return parts.map((part, i) => {
    if (/_{4,}|\[blank\]/i.test(part)) {
      const no = blankOffset.n++;
      return (
        <span key={i} className="listening-exam-blank-marker">
          {no}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function PrintScriptPanel({
  segments,
  compact = false,
}: {
  segments: ListeningQuestionData["segments"];
  compact?: boolean;
}) {
  const blankOffset = { n: 1 };

  return (
    <div
      className={`listening-exam-script-col${compact ? " listening-exam-script-col--compact" : ""}`}
    >
      <p className="listening-exam-script-title">MINI SCRIPT</p>
      {segments.map((seg) => (
        <p key={seg.id} className="leading-snug">
          <span className="listening-exam-speaker">
            {speakerLabel(seg.speaker_type)}:
          </span>{" "}
          {renderScriptWithBlanks(seg.text, blankOffset)}
        </p>
      ))}
    </div>
  );
}

export function ListeningExamPrintView({
  title,
  gradeLabel = "중학교 1학년",
  questions,
  backHref,
  showScript = false,
  setId,
}: ListeningExamPrintViewProps) {
  const [examTitle, setExamTitle] = useState(title);
  const [studentName, setStudentName] = useState("");
  /** PDF로 바로 저장(인쇄 창 없이) */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다
  usePdfPrefetch("listening-print-root", [
    ":is(.exam-print-exam, .exam-print-answers) .listening-exam-sheet",
    ".exam-print-exam .listening-exam-sheet",
    ".exam-print-answers .listening-exam-sheet",
  ]);
  // 제목은 글자 수에 따라 머리글 높이가 바뀔 수 있어, 입력이 멈춘 뒤에만 쪽을 다시 나눈다
  const [layoutTitle, setLayoutTitle] = useState(title);
  useEffect(() => {
    const t = setTimeout(() => setLayoutTitle(examTitle), 400);
    return () => clearTimeout(t);
  }, [examTitle]);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);
  const [pages, setPages] = useState<ExamPageLayout[] | null>(null);
  const [answerPages, setAnswerPages] = useState<ExamPageLayout[] | null>(
    null
  );
  const [pagesVerified, setPagesVerified] = useState(false);
  const [questionSizePt, setQuestionSizePt] = useState<number>(
    QUESTION_SIZES_PT[0]!
  );

  const measureRef = useRef<HTMLDivElement>(null);
  const probeFirstRef = useRef<HTMLDivElement>(null);
  const probeNextRef = useRef<HTMLDivElement>(null);
  const overflowFixAttempts = useRef(0);
  /** 고정 5+5 배치를 그대로 썼는지 — 그럴 땐 시험지 쪽은 옮기지 않는다 */
  const fixedLayoutUsed = useRef(false);
  const [tightStep, setTightStep] = useState<TightStep>(TIGHT_STEPS[0]!);
  const listenUrl = buildStudentListeningHubUrl(setId);

  const [designStyle, setDesignStyle] = useState<ListeningDesignStyle>("a");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DESIGN_STYLE_KEY);
      if (saved === "a" || saved === "b" || saved === "c") setDesignStyle(saved);
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
  }, []);
  const chooseDesignStyle = (style: ListeningDesignStyle) => {
    setDesignStyle(style);
    try {
      window.localStorage.setItem(DESIGN_STYLE_KEY, style);
    } catch {
      /* 무시 */
    }
  };
  /*
   * 모양을 바꾸면 글꼴이 늦게 들어와 글자 폭이 달라진다. 쪽 나눔은 잰 높이로 하므로
   * 글꼴이 다 들어온 뒤 한 번 더 잰다(안 그러면 단이 넘쳐 아래가 잘린다).
   */
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (designStyle === "base" || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [designStyle]);
  /** 측정 틀·빈 쪽 틀·인쇄 루트에 똑같이 건다 (잰 높이와 찍힌 높이가 같아야 한다) */
  const styleClass = designClass(designStyle);

  const meta: PrintMeta = {
    examTitle: examTitle.trim() || title,
    gradeLabel,
    studentName,
  };

  const resolvedPages = pages;
  const hasFigures = questionsHaveFigures(questions);
  const layoutConfig = getExamLayoutConfig(showScript, hasFigures);
  // 문항 간격도 고른 단계를 따른다(대본 모드는 기존 간격 그대로).
  const examGapStyle = showScript
    ? layoutConfig.gapStyle
    : ({ gap: `${tightStep.gapMm}mm` } as const);
  /**
   * 20문항 시험지는 그림이 있어도 두 쪽(쪽마다 5+5)을 먼저 노린다 — 선생님 요청.
   * 가장 촘촘한 단계에서도 안 들어갈 때만 높이 기반으로 넘어간다.
   */
  const useFixedTwentyLayout =
    !showScript && isStandardTwentyQuestionExam(questions.length);

  useLayoutEffect(() => {
    if (questions.length === 0) {
      setPages([]);
      setAnswerPages([]);
      setPagesVerified(true);
      return;
    }

    const measureRoot = measureRef.current;
    const probeFirst = probeFirstRef.current;
    const probeNext = probeNextRef.current;
    if (!measureRoot || !probeFirst || !probeNext) return;

    let cancelled = false;

    const measureAndPaginate = () => {
      if (cancelled) return;
      const firstBody = probeFirst.querySelector<HTMLElement>("[data-body-zone]");
      const nextBody = probeNext.querySelector<HTMLElement>("[data-body-zone]");
      if (!firstBody || !nextBody) return;

      /** 문항 글자 크기를 바꿔 가며 높이를 다시 잰다 (쪽 맞추기용) */
      const measureAt = (sizePt: number, step?: TightStep) => {
        measureRoot.style.setProperty("--lx-q-size", `${sizePt}pt`);
        if (step) {
          measureRoot.style.setProperty("--lx-q-lh", `${step.lineHeight}`);
          measureRoot.style.setProperty("--lx-fig-max", `${step.figureMaxMm}mm`);
        }
        void measureRoot.offsetHeight;
        const exam: number[] = [];
        const answer: number[] = [];
        for (const q of questions) {
          const examEl = measureRoot.querySelector<HTMLElement>(
            `[data-measure-q="${q.id}"]`
          );
          const answerEl = measureRoot.querySelector<HTMLElement>(
            `[data-measure-answer-q="${q.id}"]`
          );
          const hasFig = Boolean(
            examEl?.querySelector(".listening-exam-figure-img")
          );
          // 그림 문항은 측정 오차·여백을 조금 더 줌 → 단 끝에 끼워 넣다 잘리는 것 방지
          const pad = hasFig ? 12 : 0;
          const examH = Math.ceil(examEl?.offsetHeight ?? 96) + pad;
          const answerH = Math.ceil(answerEl?.offsetHeight ?? examH) + pad;
          exam.push(examH);
          answer.push(answerH);
        }
        return { exam, answer };
      };

      const packOpts = {
        firstColumnMaxPx: resolveColumnMaxPx(firstBody),
        nextColumnMaxPx: resolveColumnMaxPx(nextBody),
        questionGapPx: layoutConfig.gapPx,
        columnSafetyPx: layoutConfig.columnSafetyPx,
      };

      let sizePt = QUESTION_SIZES_PT[0]!;
      let step: TightStep = TIGHT_STEPS[0]!;
      let heights = measureAt(sizePt);
      let examLayouts: ExamPageLayout[];

      if (useFixedTwentyLayout) {
        // 표준 20문항: 쪽마다 5+5가 들어갈 때까지 글자·줄간격·그림 높이를 한 단계씩 줄여 본다
        const fixed = paginateStandardTwentyExam();
        let fits = false;
        for (let i = 0; i < TIGHT_STEPS.length; i++) {
          step = TIGHT_STEPS[i]!;
          sizePt = step.sizePt;
          heights = measureAt(sizePt, step);
          const stepOpts = {
            ...packOpts,
            questionGapPx: Math.round((step.gapMm * 96) / 25.4),
          };
          if (layoutFits(fixed, heights.exam, stepOpts)) {
            fits = true;
            break;
          }
        }
        if (fits) {
          examLayouts = fixed;
        } else {
          step = TIGHT_STEPS[0]!;
          // 가장 촘촘한 단계에서도 안 들어가면 원래 크기로 높이대로 채운다 (잘림 방지)
          sizePt = QUESTION_SIZES_PT[0]!;
          heights = measureAt(sizePt, step);
          examLayouts = paginateExamQuestions(heights.exam, packOpts);
        }
        fixedLayoutUsed.current = examLayouts === fixed;
      } else {
        examLayouts = paginateExamQuestions(heights.exam, packOpts);
        fixedLayoutUsed.current = false;
      }

      measureRoot.style.removeProperty("--lx-q-size");
      measureRoot.style.removeProperty("--lx-q-lh");
      measureRoot.style.removeProperty("--lx-fig-max");

      overflowFixAttempts.current = 0;
      setPagesVerified(false);
      setQuestionSizePt(sizePt);
      setTightStep(step);
      setPages(examLayouts);
      // 정답지는 한 줄짜리 항목이라 두 단에 고르게 나눠 담는다
      setAnswerPages(
        paginateAnswerKey(heights.answer, {
          ...packOpts,
          questionGapPx: Math.round((ANSWER_GAP_MM * 96) / 25.4),
        })
      );
    };

    const run = async () => {
      await document.fonts?.ready?.catch(() => undefined);
      await waitForImages(measureRoot);
      if (cancelled) return;
      measureAndPaginate();
    };

    void run();

    // 늦게 뜨는 그림이 있으면 다시 측정 → 큰 그림 문항이 다음 단으로 이동
    const onImg = () => {
      void waitForImages(measureRoot, 2000).then(() => {
        if (!cancelled) measureAndPaginate();
      });
    };
    measureRoot.addEventListener("load", onImg, true);
    measureRoot.addEventListener("error", onImg, true);

    return () => {
      cancelled = true;
      measureRoot.removeEventListener("load", onImg, true);
      measureRoot.removeEventListener("error", onImg, true);
    };
  }, [
    questions,
    showScript,
    layoutTitle,
    gradeLabel,
    title,
    setId,
    layoutConfig.gapPx,
    layoutConfig.columnSafetyPx,
    useFixedTwentyLayout,
    hasFigures,
    designStyle,
    fontsTick,
  ]);

  useLayoutEffect(() => {
    if (!pages || questions.length === 0) return;

    const root = document.getElementById("listening-print-root");
    if (!root) return;

    // 시험지·정답지 각각 검사 (합치면 정답 오버플로가 시험지 배치를 깨뜨림)
    const scopes: Array<{
      sel: string;
      layouts: ExamPageLayout[] | null;
      setLayouts: typeof setPages;
    }> = [
      ...(fixedLayoutUsed.current
        ? []
        : [
            {
              sel: ".exam-print-exam",
              layouts: pages,
              setLayouts: setPages,
            },
          ]),
      {
        sel: ".exam-print-answers",
        layouts: answerPages,
        setLayouts: setAnswerPages,
      },
    ];

    let fixed = false;
    for (const scope of scopes) {
      if (fixed || !scope.layouts) continue;
      const scopeRoot = root.querySelector(scope.sel);
      if (!scopeRoot) continue;

      let overflow: { page: number; side: "left" | "right" } | null = null;
      for (const col of scopeRoot.querySelectorAll<HTMLElement>(
        "[data-exam-column]"
      )) {
        const bodyZone = col.closest<HTMLElement>("[data-body-zone]");
        const maxH = bodyZone?.clientHeight ?? 0;
        if (!bodyZone || maxH <= 0) continue;

        // 1~2px 오차는 무시 (밀도가 4문제로 붕괴되는 연쇄 보정 방지)
        const columnOverflow = col.scrollHeight > maxH + 8;
        const bodyBottom = bodyZone.getBoundingClientRect().bottom;
        const questionOverflow = Array.from(
          col.querySelectorAll<HTMLElement>("[data-exam-question]")
        ).some((qEl) => qEl.getBoundingClientRect().bottom > bodyBottom + 4);

        if (!columnOverflow && !questionOverflow) continue;
        const page = Number(col.dataset.page);
        const side = col.dataset.side;
        if (!Number.isFinite(page) || (side !== "left" && side !== "right")) {
          continue;
        }
        overflow = { page, side };
        break;
      }

      if (!overflow) continue;

      if (overflowFixAttempts.current >= MAX_OVERFLOW_FIXES) {
        setPagesVerified(true);
        return;
      }

      overflowFixAttempts.current += 1;
      setPagesVerified(false);
      const hit = overflow;
      const nextLayouts =
        moveLastOverflowItem(scope.layouts, hit.page, hit.side) ??
        scope.layouts;
      scope.setLayouts(nextLayouts);
      fixed = true;
    }

    if (!fixed) {
      overflowFixAttempts.current = 0;
      setPagesVerified(true);
    }
  }, [
    pages,
    answerPages,
    questions,
    showScript,
    layoutTitle,
    gradeLabel,
    includeAnswerKey,
  ]);

  function runPrint(scope: PrintScope) {
    const prevTitle = document.title;
    const safeName = studentName.trim() || "학생";
    const suffix =
      scope === "answers" ? "_정답지" : scope === "exam" ? "" : "_전체";
    document.title = `${safeName}_${meta.examTitle}${suffix}`;

    const body = document.body;
    body.classList.remove(
      "listening-print-exam-only",
      "listening-print-answers-only"
    );
    if (scope === "exam") body.classList.add("listening-print-exam-only");
    if (scope === "answers") body.classList.add("listening-print-answers-only");

    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => {
        document.title = prevTitle;
        body.classList.remove(
          "listening-print-exam-only",
          "listening-print-answers-only"
        );
      }, 500);
    }, 80);
  }

  const totalPages = resolvedPages?.length ?? 0;
  const layoutReady =
    pages !== null &&
    pagesVerified &&
    (!includeAnswerKey || answerPages !== null);

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white shadow-card">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <Icon name="left" size={16} />
              세트로 돌아가기
            </Link>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => runPrint("exam")}
                disabled={!layoutReady && questions.length > 0}
              >
                <Icon name="print" size={16} />
                시험지 인쇄
              </Button>
              <Button
                variant="secondary"
                onClick={() => runPrint("answers")}
                disabled={questions.length === 0}
              >
                답지 인쇄
              </Button>
              <Button
                variant="secondary"
                onClick={() => runPrint("all")}
                disabled={!layoutReady && questions.length > 0}
              >
                시험지+답지
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">PDF로 저장</span>
            {(
              [
                ["시험지", ".exam-print-exam .listening-exam-sheet"],
                ["답지", ".exam-print-answers .listening-exam-sheet"],
                ["시험지+답지", ":is(.exam-print-exam, .exam-print-answers) .listening-exam-sheet"],
              ] as const
            ).map(([label, selector]) => (
              <Button
                key={label}
                variant="secondary"
                disabled={!!pdf.busy || (!layoutReady && questions.length > 0)}
                onClick={() =>
                  void pdf.save(
                    label,
                    collectPrintPages(document.getElementById("listening-print-root"), selector),
                    [studentName.trim() || null, meta.examTitle]
                  )
                }
              >
                {label}
              </Button>
            ))}
            {pdf.status ? (
              <span className={`text-xs font-semibold ${pdf.busy ? "text-brand-700" : "text-rose-600"}`}>{pdf.status}</span>
            ) : null}
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold text-slate-700">출력 설정</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="ui-label">시험지 제목</span>
                <input
                  className="ui-input"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="ui-label">이름</span>
                <input
                  className="ui-input"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="인쇄 파일 이름에 써요 (선택)"
                />
              </label>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="ui-label">시험지 모양</span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="grid w-full max-w-xs grid-cols-3 gap-1 rounded-lg bg-slate-200/70 p-1">
                    {DESIGN_STYLES.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        title={d.hint}
                        onClick={() => chooseDesignStyle(d.id)}
                        className={`rounded-md px-1 py-1.5 text-xs font-bold transition ${
                          designStyle === d.id
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-500"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-500">
                    {DESIGN_STYLES.find((d) => d.id === designStyle)?.hint}
                  </span>
                </div>
              </div>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={includeAnswerKey}
                  onChange={(e) => setIncludeAnswerKey(e.target.checked)}
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="text-sm text-slate-700">
                  미리보기에 정답지 페이지 보이기
                </span>
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              A4 한 장씩 나뉘어 보여요 · 2단 · 문항 높이에 맞춰 배치 · 그림이 크면 다음
              단으로 넘겨요
              {resolvedPages && ` · 시험지 ${totalPages}쪽`}
              {answerPages && ` · 답지 ${answerPages.length}쪽`}
            </p>
          </div>
        </div>
      </div>

      {designStyle !== "base" ? <link rel="stylesheet" href={DESIGN_FONTS_HREF} /> : null}
      <div
        ref={measureRef}
        className={`listening-exam-measure font-print pointer-events-none fixed -left-[200vw] top-0 opacity-0 ${styleClass}`}
        aria-hidden
      >
        <div className={COLUMN_WIDTH_CLASS}>
          {questions.map((q) => (
            <div key={q.id}>
              <div data-measure-q={q.id}>
                <ExamQuestionBlock question={q} showScript={showScript} setHeader={setHeaderFor(questions, q)} />
              </div>
              <div data-measure-answer-q={q.id}>
                <AnswerKeyItem question={q} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        ref={probeFirstRef}
        className={`pointer-events-none fixed -left-[200vw] top-0 opacity-0 ${styleClass}`}
        aria-hidden
      >
        <ExamSheetPage
          meta={meta}
          listenUrl={listenUrl}
          pageIndex={0}
          totalPages={1}
          left={[]}
          right={[]}
          questions={questions}
          showScript={showScript}
          measureOnly
          questionGapStyle={examGapStyle}
        />
      </div>
      <div
        ref={probeNextRef}
        className={`pointer-events-none fixed -left-[200vw] top-0 opacity-0 ${styleClass}`}
        aria-hidden
      >
        <ExamSheetPage
          meta={meta}
          listenUrl={listenUrl}
          pageIndex={1}
          totalPages={2}
          left={[]}
          right={[]}
          questions={questions}
          showScript={showScript}
          measureOnly
          questionGapStyle={examGapStyle}
        />
      </div>

      <div className="mx-auto w-full max-w-[210mm] py-8 print:py-0">
        <div
          id="listening-print-root"
          className={styleClass || undefined}
          style={tightVars({ ...tightStep, sizePt: questionSizePt })}
        >
          <div className="exam-print-exam">
            {questions.length === 0 ? (
              <ExamSheetPage
                meta={meta}
                listenUrl={listenUrl}
                pageIndex={0}
                totalPages={1}
                left={[]}
                right={[]}
                questions={questions}
                showScript={showScript}
                questionGapStyle={examGapStyle}
              />
            ) : !pages ? (
              <div className="listening-exam-page listening-exam-sheet mx-auto flex h-[297mm] items-center justify-center text-sm text-slate-500">
                시험지 레이아웃 계산 중…
              </div>
            ) : (
              <>
                {!layoutReady && (
                  <div className="listening-exam-page listening-exam-sheet mx-auto flex h-[297mm] items-center justify-center text-sm text-slate-500">
                    시험지 레이아웃 계산 중…
                  </div>
                )}
                <div
                  className={
                    layoutReady
                      ? undefined
                      : "pointer-events-none fixed -left-[200vw] top-0 opacity-0"
                  }
                  aria-hidden={!layoutReady}
                >
                  {resolvedPages!.map((layout, pageIndex) => (
                    <ExamSheetPage
                      key={pageIndex}
                      meta={meta}
                      listenUrl={listenUrl}
                      pageIndex={pageIndex}
                      totalPages={resolvedPages!.length}
                      left={layout.left}
                      right={layout.right}
                      questions={questions}
                      showScript={showScript}
                      questionGapStyle={examGapStyle}
                      isLastPage={pageIndex === resolvedPages!.length - 1}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {questions.length > 0 && layoutReady && answerPages && (
            <div
              className={
                includeAnswerKey
                  ? "exam-print-answers"
                  : "exam-print-answers hidden print:block"
              }
            >
              <ExamAnswerKeyPages
                meta={meta}
                questions={questions}
                pageLayouts={answerPages}
                questionGapStyle={{ gap: `${ANSWER_GAP_MM}mm` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExamSheetPage({
  meta,
  listenUrl,
  pageIndex,
  totalPages,
  left,
  right,
  questions,
  showScript,
  isLastPage,
  measureOnly,
  questionGapStyle,
}: {
  meta: PrintMeta;
  listenUrl: string;
  pageIndex: number;
  totalPages: number;
  left: number[];
  right: number[];
  questions: ListeningQuestionData[];
  showScript: boolean;
  isLastPage?: boolean;
  measureOnly?: boolean;
  questionGapStyle: { gap: string };
}) {
  const isFirst = pageIndex === 0;
  const editionNo = examEditionLabel(meta.examTitle);

  return (
    <PrintSheetFrame
      label={`시험지 ${pageIndex + 1} / ${totalPages}`}
      hideLabel={measureOnly}
      className={`${!isLastPage && !measureOnly ? "listening-exam-page-break" : ""} ${
        isLastPage && !measureOnly ? "listening-exam-scope-end" : ""
      }`}
    >
      {isFirst ? (
        <header className="shrink-0">
          <div className="listening-exam-head">
            {editionNo ? (
              <div className="listening-exam-head-no">
                <b>{editionNo}</b>
                <span>회</span>
              </div>
            ) : null}
            <div className="listening-exam-head-main">
              <p className="listening-exam-kicker">LISTENING · 듣기평가</p>
              <h1 className="listening-exam-head-title">{meta.examTitle}</h1>
              <p className="listening-exam-head-sub">
                {meta.gradeLabel}
                {questions.length > 0 ? ` · ${questions.length}문항` : ""}
              </p>
            </div>
            <div className="listening-exam-head-qr">
              <ListeningPrintQrCode url={listenUrl} sizePx={62} />
              <p className="listening-exam-head-qr-label">듣기 QR</p>
            </div>
            {LOGO_SRC ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={LOGO_SRC}
                alt={ACADEMY_NAME}
                className="listening-exam-head-logo"
              />
            ) : null}
          </div>

          <div className="listening-exam-meta">
            <div className="listening-exam-fields">
              {HEADER_FIELDS.map((label) => (
                <span
                  key={label}
                  className={`listening-exam-field${label === "이름" ? " listening-exam-field--name" : ""}`}
                >
                  <i className="listening-exam-field-label">{label}</i>
                  <i className="listening-exam-field-box">
                    {label === "이름" ? meta.studentName.trim() : ""}
                  </i>
                </span>
              ))}
            </div>
            <span className="listening-exam-meta-tip">
              QR로 음원을 듣고 알맞은 답을 고르세요.
            </span>
          </div>
        </header>
      ) : (
        <header className="listening-exam-subheader shrink-0">
          <span className="listening-exam-subheader-title">
            {meta.examTitle}
          </span>
          <span className="listening-exam-subheader-page">
            {pageIndex + 1} / {totalPages}
          </span>
        </header>
      )}

      <div data-body-zone className="listening-exam-body-zone">
        <div className="listening-exam-body-cols">
          <QuestionColumn
            indices={left}
            questions={questions}
            showScript={showScript}
            pageIndex={pageIndex}
            side="left"
            questionGapStyle={questionGapStyle}
          />
          <QuestionColumn
            indices={right}
            questions={questions}
            showScript={showScript}
            divided
            pageIndex={pageIndex}
            side="right"
            questionGapStyle={questionGapStyle}
          />
        </div>
      </div>

      <ExamSheetFooter
        pageIndex={pageIndex}
        totalPages={totalPages}
        right={
          isLastPage && !measureOnly
            ? `${meta.examTitle} · 끝`
            : `${meta.examTitle} · 듣기 시험지`
        }
      />
    </PrintSheetFrame>
  );
}

/**
 * A4 한 장 틀 — 화면에서는 쪽마다 이름표·그림자·테두리로 또렷이 나뉘고,
 * 인쇄에서는 여백 없이 용지 한 장과 1:1로 맞는다 (1장 요약직보자료 인쇄와 같은 결).
 */
function PrintSheetFrame({
  label,
  hideLabel,
  className,
  children,
}: {
  label: string;
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="listening-exam-sheet-wrap">
      {hideLabel ? null : (
        <p className="listening-exam-sheet-caption no-print">{label}</p>
      )}
      <article
        className={`listening-exam-page listening-exam-sheet relative mx-auto flex h-[297mm] max-h-[297mm] min-h-[297mm] flex-col overflow-hidden bg-white shadow-xl print:shadow-none ${className ?? ""}`}
      >
        {children}
      </article>
    </div>
  );
}

/** 꼬리말 — 변형문제·워크북 인쇄와 같은 3칸(학원 · 쪽 번호 · 자료 이름) */
function ExamSheetFooter({
  pageIndex,
  totalPages,
  right,
}: {
  pageIndex: number;
  totalPages: number;
  right: string;
}) {
  return (
    <footer className="listening-exam-footer shrink-0">
      <span className="listening-exam-footer-left">
        {LOGO_SRC ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={LOGO_SRC} alt="" className="listening-exam-footer-logo" />
        ) : null}
        <span>{ACADEMY_NAME}</span>
      </span>
      <span className="listening-exam-footer-page">
        - {pageIndex + 1} / {totalPages} -
      </span>
      <span className="listening-exam-footer-right">{right}</span>
    </footer>
  );
}

function QuestionColumn({
  indices,
  questions,
  showScript,
  divided,
  pageIndex,
  side,
  questionGapStyle,
}: {
  indices: number[];
  questions: ListeningQuestionData[];
  showScript: boolean;
  divided?: boolean;
  pageIndex: number;
  side: "left" | "right";
  questionGapStyle: { gap: string };
}) {
  const borderClass = divided ? "listening-exam-col-divider" : "pr-[0.5mm]";

  return (
    <div
      data-exam-column
      data-page={pageIndex}
      data-side={side}
      className={`listening-exam-col-stack ${borderClass}`}
      style={questionGapStyle}
    >
      {indices.map((qi) => (
        <ExamQuestionBlock
          key={questions[qi].id}
          question={questions[qi]}
          showScript={showScript}
          setHeader={setHeaderFor(questions, questions[qi])}
        />
      ))}
    </div>
  );
}

/**
 * 같은 담화를 듣고 두 문항을 푸는 묶음(고1 16~17번 등) 앞의 머리글.
 * 외부 검토 지적(2026-09-18): 16·17번 대본이 같은데 문제지에 공통 지문 표시가 없었다.
 * 다음 문항과 대본이 같고 앞 문항과는 다를 때, 묶음 첫 문항 위에 단다.
 */
function setHeaderFor(questions: ListeningQuestionData[], q: ListeningQuestionData): string | undefined {
  const script = (x: ListeningQuestionData | undefined) =>
    (x?.segments ?? []).map((seg) => seg.text).join(" ").replace(/s+/g, " ").trim();
  const mine = script(q);
  if (!mine) return undefined;
  const idx = questions.findIndex((x) => x.id === q.id);
  if (idx < 0 || script(questions[idx - 1]) === mine) return undefined;
  let end = idx;
  while (end + 1 < questions.length && script(questions[end + 1]) === mine) end++;
  if (end === idx) return undefined;
  const from = String(q.order_index).padStart(2, "0");
  const to = String(questions[end]!.order_index).padStart(2, "0");
  return `[${from}~${to}] 다음을 듣고, 물음에 답하시오.`;
}

function ExamQuestionBlock({
  question: q,
  showScript,
  setHeader,
}: {
  question: ListeningQuestionData;
  showScript: boolean;
  setHeader?: string;
}) {
  // 응답 빈칸 줄은 번호가 아니라 이름·지시문으로 (중3 17번 응답, 20번 상황에 맞는 말)
  const passageText = displayQuestionText(
    {
      order_index: q.order_index,
      question_type: q.question_type,
      instruction: q.instruction,
      question_text: q.question_text,
      blank_speaker: q.blank_speaker,
      table_data: q.table_data,
      segments: q.segments.map((s) => ({ speaker: s.speaker_type })),
    },
    { forStudent: true }
  );
  const figureUrls = (q.choice_image_urls ?? []).filter((u) => String(u).trim());
  // 선택지가 ①~⑤ 번호뿐이면(그림 상황에 맞는 대화·짧은 대화 5개·표 행) 번호만 한 줄로.
  // 그림이 한 장 있어도 답을 표시할 줄은 있어야 하므로 줄을 지우지 않는다.
  // 선택지마다 그림이 따로 있으면(그림판 여러 장) 그림 칸에 이미 번호가 있어 줄을 빼 준다.
  const labelOnlyChoices = isLabelOnlyChoiceSet(q.choices);
  const showChoiceMarkRow = labelOnlyChoices && figureUrls.length <= 1;
  const instruction = q.instruction?.trim();
  const numLabel = String(q.order_index).padStart(2, "0");
  const table = normalizeTableData(q.table_data);
  const hasScript = showScript && q.segments.length > 0;
  // 짧은 선택지는 한 줄에 늘어놓는다 — 그림·표 문항에는 쓰지 않는다.
  // (문항마다 붙던 "유형 N · 유형 이름" 표시는 모의평가처럼 인쇄물에서 뺐다.)
  const choiceRow =
    figureUrls.length === 0 && !table ? shortChoiceLayout(q.choices) : null;
  const choicesEnglish = q.choices.every((c) => !HANGUL_RE.test(String(c ?? "")));

  const questionBody = (
    <>
      {instruction && (
        <p className="listening-exam-q-instruction">{instruction}</p>
      )}

      {passageText && passageText !== instruction && (
        <p className="listening-exam-q-passage">{passageText}</p>
      )}

      {!instruction && !passageText && (
        <p className="listening-exam-q-instruction">듣기 문항</p>
      )}

      {table ? table.kind === "flyer" ? <ExamPrintFlyer table={table} /> : <ExamPrintTable table={table} /> : null}

      {(() => {
        const urls = figureUrls;
        if (urls.length === 0) return null;
        // 고1 그림 불일치 등: 합성 장면 1장 (보기 ①–⑤는 그림 안)
        if (urls.length === 1) {
          return (
            <div className="listening-exam-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={urls[0]}
                alt="듣기 문항 그림"
                className="listening-exam-figure-img"
              />
            </div>
          );
        }
        // 중등 등: 선택지별 그림
        return (
          <div className="listening-exam-figure-grid">
            {urls.slice(0, 5).map((url, i) => (
              <div key={url} className="listening-exam-figure-cell">
                <span className="listening-exam-figure-label">
                  {CIRCLED[i] ?? `${i + 1}`}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`선택지 ${CIRCLED[i] ?? i + 1}`}
                  className="listening-exam-figure-img"
                />
              </div>
            ))}
          </div>
        );
      })()}

      {showChoiceMarkRow ? (
        <p className="listening-exam-choice-row">
          {q.choices.map((_, i) => (
            <span key={i} className="listening-exam-choice-mark">
              {CIRCLED[i] ?? `${i + 1}.`}
            </span>
          ))}
        </p>
      ) : null}

      {!labelOnlyChoices && !shouldHideTextChoicesForFigure({
        choiceImageUrls: q.choice_image_urls,
        choices: q.choices,
        needsImageChoices: q.needs_image_choices,
      }) && (
        <ul
          className={`listening-exam-choices mt-[1mm] list-none pl-0${
            choicesEnglish ? " listening-exam-choices--en" : ""
          }${choiceRow ? ` listening-exam-choices--${choiceRow}` : ""}`}
        >
          {q.choices.map((choice, i) => {
            const urls = figureUrls;
            const showInline =
              urls.length > 1 && Boolean(urls[i]?.trim());
            return (
              <li key={i} className="flex gap-[2mm] leading-snug">
                <span className="listening-exam-choice-mark">
                  {CIRCLED[i] ?? `${i + 1}.`}
                </span>
                <span className="listening-exam-choice-text min-w-0 flex-1 break-words">
                  {showInline ? (
                    <span className="listening-exam-choice-with-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urls[i]}
                        alt=""
                        className="listening-exam-choice-thumb"
                      />
                      {choice && !/^[①②③④⑤]$/.test(choice.trim()) ? (
                        <span>{choice}</span>
                      ) : null}
                    </span>
                  ) : (
                    choice
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <section className="listening-exam-q-block" data-exam-question>
      {setHeader ? <p className="listening-exam-set-head">{setHeader}</p> : null}
      {hasScript ? (
        <div className="grid grid-cols-2 gap-[2.5mm]">
          <div className="flex items-start gap-[2mm]">
            <span className="listening-exam-q-num">{numLabel}</span>
            <div className="min-w-0 flex-1">{questionBody}</div>
          </div>
          <PrintScriptPanel segments={q.segments} compact={showScript} />
        </div>
      ) : (
        <div className="flex items-start gap-[2mm]">
          <span className="listening-exam-q-num">{numLabel}</span>
          <div className="min-w-0 flex-1">{questionBody}</div>
        </div>
      )}
    </section>
  );
}

/** 인쇄 양식(전단·티켓) — 빈칸 (A)(B)는 네모 칸 */
function ExamPrintFlyer({ table }: { table: ListeningTableData }) {
  return (
    <div className="listening-exam-flyer">
      <p className="listening-exam-flyer-title">{table.title}</p>
      <table className="w-full border-collapse leading-tight">
        <tbody>
          {table.rows.map((row) => {
            const blank = row.value.trim().match(/^\(\s*([AB])\s*\)$/i)?.[1]?.toUpperCase();
            return (
              <tr key={row.no}>
                <td className="col-label py-[0.6mm]">{row.label}</td>
                <td className="py-[0.6mm]">
                  {blank ? <span className="listening-exam-flyer-blank">({blank})</span> : row.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExamPrintTable({ table }: { table: ListeningTableData }) {
  // 표 보고 고르기: "품목 (열1 / 열2)" 제목이면 열마다 칸을 나눈다
  const grid = splitTableColumns(table);
  if (grid) {
    return (
      <div className="listening-exam-print-table">
        <p className="listening-exam-print-table-title">{grid.title}</p>
        <table className="w-full border-collapse leading-tight">
          <thead>
            <tr>
              <td className="col-no py-[0.7mm]" />
              {grid.columns.map((c) => (
                <td key={c} className="py-[0.7mm] font-bold">
                  {c}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={row.no}>
                <td className="col-no py-[0.7mm]">{CIRCLED[row.no - 1] ?? row.no}</td>
                {grid.cells[ri]!.map((v, ci) => (
                  <td key={ci} className="py-[0.7mm]">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="listening-exam-print-table">
      <p className="listening-exam-print-table-title">{table.title}</p>
      <table className="w-full border-collapse leading-tight">
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.no}>
              <td className="col-no py-[0.7mm]">
                {CIRCLED[row.no - 1] ?? row.no}
              </td>
              <td className="col-label py-[0.7mm]">{row.label}</td>
              <td className="py-[0.7mm]">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExamAnswerKeyPages({
  meta,
  questions,
  pageLayouts,
  questionGapStyle,
}: {
  meta: PrintMeta;
  questions: ListeningQuestionData[];
  pageLayouts: ExamPageLayout[];
  questionGapStyle: { gap: string };
}) {
  return (
    <>
      {pageLayouts.map((layout, pageIndex) => (
        <ExamAnswerKeyPage
          key={pageIndex}
          meta={meta}
          questions={questions}
          left={layout.left}
          right={layout.right}
          pageIndex={pageIndex}
          totalPages={pageLayouts.length}
          isLastPage={pageIndex === pageLayouts.length - 1}
          questionGapStyle={questionGapStyle}
        />
      ))}
    </>
  );
}

function ExamAnswerKeyPage({
  meta,
  questions,
  left,
  right,
  pageIndex,
  totalPages,
  isLastPage,
  questionGapStyle,
}: {
  meta: PrintMeta;
  questions: ListeningQuestionData[];
  left: number[];
  right: number[];
  pageIndex: number;
  totalPages: number;
  isLastPage: boolean;
  questionGapStyle: { gap: string };
}) {
  const isFirst = pageIndex === 0;
  const editionNo = examEditionLabel(meta.examTitle);

  return (
    <PrintSheetFrame
      label={`정답지 ${pageIndex + 1} / ${totalPages}`}
      className={!isLastPage ? "listening-exam-page-break" : ""}
    >
      <header className="shrink-0">
        {isFirst ? (
          <div className="listening-exam-head listening-exam-head--answer">
            {editionNo ? (
              <div className="listening-exam-head-no">
                <b>{editionNo}</b>
                <span>회</span>
              </div>
            ) : null}
            <div className="listening-exam-head-main">
              <p className="listening-exam-kicker">ANSWER · 정답지</p>
              <h1 className="listening-exam-head-title">{meta.examTitle}</h1>
              <p className="listening-exam-head-sub">
                {meta.gradeLabel}
                {questions.length > 0 ? ` · ${questions.length}문항` : ""}
              </p>
            </div>
            {LOGO_SRC ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={LOGO_SRC}
                alt={ACADEMY_NAME}
                className="listening-exam-head-logo"
              />
            ) : null}
          </div>
        ) : (
          <div className="listening-exam-subheader">
            <span className="listening-exam-subheader-title">
              {meta.examTitle} · 정답지
            </span>
            <span className="listening-exam-subheader-page">
              {pageIndex + 1} / {totalPages}
            </span>
          </div>
        )}
      </header>

      <div data-body-zone className="listening-exam-body-zone">
        <div className="listening-exam-body-cols">
          <AnswerKeyColumn
            indices={left}
            questions={questions}
            pageIndex={pageIndex}
            side="left"
            questionGapStyle={questionGapStyle}
          />
          <AnswerKeyColumn
            indices={right}
            questions={questions}
            divided
            pageIndex={pageIndex}
            side="right"
            questionGapStyle={questionGapStyle}
          />
        </div>
      </div>

      <ExamSheetFooter
        pageIndex={pageIndex}
        totalPages={totalPages}
        right={
          isLastPage
            ? `${meta.examTitle} · 정답지 끝`
            : `${meta.examTitle} · 정답지`
        }
      />
    </PrintSheetFrame>
  );
}

function AnswerKeyColumn({
  indices,
  questions,
  divided,
  pageIndex,
  side,
  questionGapStyle,
}: {
  indices: number[];
  questions: ListeningQuestionData[];
  divided?: boolean;
  pageIndex: number;
  side: "left" | "right";
  questionGapStyle: { gap: string };
}) {
  const borderClass = divided ? "listening-exam-col-divider" : "pr-[0.5mm]";

  return (
    <div
      data-exam-column
      data-page={pageIndex}
      data-side={side}
      className={`listening-exam-col-stack ${borderClass}`}
      style={questionGapStyle}
    >
      {indices.map((qi) => (
        <AnswerKeyItem key={questions[qi].id} question={questions[qi]} />
      ))}
    </div>
  );
}

/** 정답지 항목 — 번호 · 정답(①~⑤) · 정답 선택지 글, 그 아래 대본 칸.
    해설·근거는 싣지 않는다 (선생님 요청: 정답지에는 정답과 대본만). */
function AnswerKeyItem({
  question: q,
}: {
  question: ListeningQuestionData;
}) {
  const idx = q.correct_answer - 1;
  // 선택지가 ①~⑤ 번호뿐이면(그림 라벨·표 행·짧은 대화 5개) 번호를 두 번 쓰지 않는다
  const rawChoice = q.choices[idx] ?? "";
  const choice = /^\s*(?:[①②③④⑤]|[1-5])\s*$/.test(rawChoice) ? "" : rawChoice;
  const blankOffset = { n: 1 };

  return (
    <div className="listening-exam-answer-item" data-exam-question>
      <div className="listening-exam-answer-head">
        <span className="listening-exam-answer-no">
          {String(q.order_index).padStart(2, "0")}
        </span>
        <span className="listening-exam-answer-mark">
          {answerLabel(q.correct_answer)}
        </span>
        <span className="listening-exam-answer-text">{choice}</span>
      </div>
      {q.segments.length > 0 ? (
        <div className="listening-exam-answer-script">
          {q.segments.map((seg) => (
            <p key={seg.id}>
              <span className="listening-exam-answer-speaker">
                {speakerLabel(seg.speaker_type)}
              </span>
              {renderScriptWithBlanks(seg.text, blankOffset)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
