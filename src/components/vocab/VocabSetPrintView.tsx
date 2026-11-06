"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/layout/NavIcon";
import { VocabPrintCoverPage } from "@/components/vocab/VocabPrintCoverPage";
import { splitPrintTitle, VocabPrintDHeader } from "@/components/vocab/VocabPrintDHeader";
import { VocabPrintExamConfig } from "@/components/vocab/VocabPrintExamConfig";
import { VocabWorkbookPrintPages } from "@/components/vocab/VocabWorkbookPrintPages";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { A4, B5, collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import { ACADEMY_NAME, LOGO_SRC } from "@/lib/branding";
import { generatePrintExamQuestions } from "@/lib/vocab/generate-print-test-questions";
import { paginateAnswerKey } from "@/lib/vocab/paginate-answer-key";
import { highlightWordInSentence } from "@/lib/vocab/highlight-word-in-sentence";
import { vocabSetsRangeTitle } from "@/lib/vocab/print-title";
import {
  itemsPerVocabPrintPage,
  paginateVocabItems,
  parseVocabPrintMode,
  VOCAB_PRINT_MODE_LABELS,
  type VocabPrintMode,
} from "@/lib/vocab/paginate-vocab-print";
import { useVocabExamPagination } from "@/lib/vocab/use-vocab-exam-pagination";
import {
  EXAM_ROW_GAP_PX,
  examConfigTotal,
  examSettingsToSearchParams,
  parseExamPrintSettings,
  resolveExamRange,
  type ExamPrintSettings,
} from "@/lib/vocab/vocab-print-exam-config";
import {
  applyVocabPrintCoverToSearchParams,
  buildDefaultVocabPrintCover,
  mergeVocabPrintCoverFromSearchParams,
  VOCAB_COVER_FONT_LABELS,
  VOCAB_COVER_THEME_LABELS,
  VOCAB_COVER_LEVELS,
  resolveVocabCoverLevel,
  type VocabCoverColor,
  VOCAB_COVER_TITLE_SIZE_LABELS,
  type VocabCoverFont,
  type VocabCoverTheme,
  type VocabCoverTitleSize,
  type VocabPrintCoverSettings,
} from "@/lib/vocab/vocab-print-cover";
import {
  parseVocabPrintBinding,
  parseVocabPrintFontScale,
  parseVocabPrintLineSpacing,
  VOCAB_PRINT_FONT_LABELS,
  VOCAB_PRINT_SPACING_LABELS,
  type VocabPrintFontScale,
  type VocabPrintLineSpacing,
} from "@/lib/vocab/vocab-print-layout";
import {
  parseVocabPrintSize,
  VOCAB_PRINT_PAGE_DIMENSIONS,
  VOCAB_PRINT_SIZE_LABELS,
  type VocabPrintSize,
} from "@/lib/vocab/vocab-print-size";
import type {
  VocabPrintRow,
  VocabPrintSection,
} from "@/lib/vocab/vocab-print-types";
import type { PrintExamQuestion } from "@/lib/vocab/generate-print-test-questions";

/** 왼쪽 설정판에서 고른 칸 / 안 고른 칸 모양 */
function choiceClass(on: boolean): string {
  return on
    ? "border-brand-600 bg-brand-50 text-brand-700"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
}

/** 왼쪽 설정판의 접히는 묶음 */
function PanelSection({
  title,
  defaultOpen = false,
  aside,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-slate-200 bg-white [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3">
        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Icon
            name="chevron"
            size={15}
            strokeWidth={2}
            className="text-slate-400 transition group-open:rotate-90"
          />
          {title}
        </span>
        {aside}
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-3.5 pb-3.5 pt-3">
        {children}
      </div>
    </details>
  );
}

function PanelField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-slate-600">{label}</p>
      {children}
    </div>
  );
}

interface VocabSetPrintViewProps {
  sections: VocabPrintSection[];
  backHref: string;
  documentTitle?: string;
  academyName?: string;
  logoSrc?: string;
}

const CHOICE_MARKS = ["①", "②", "③", "④", "⑤", "⑥"];

/** 기본값이 바뀌었을 때, 사용자가 손대지 않은(옛 기본값 그대로인) 표지 문구만 새 기본값으로 */
function migrateCoverDefaults(
  cur: VocabPrintCoverSettings,
  prev: VocabPrintCoverSettings,
  next: VocabPrintCoverSettings
): VocabPrintCoverSettings {
  const fields = [
    "title",
    "subtitle",
    "seriesLabel",
    "academyName",
    "metaLine",
    "slogan",
    "footerText",
  ] as const;
  let out: VocabPrintCoverSettings | null = null;
  for (const f of fields) {
    if (cur[f] === prev[f] && cur[f] !== next[f]) {
      out = out ?? { ...cur };
      out[f] = next[f];
    }
  }
  return out ?? cur;
}

const EXAM_URL_KEYS = [
  "word_mc",
  "word_sa",
  "meaning_mc",
  "meaning_sa",
  "example_mc",
  "example_sa",
  "syn_mc",
  "syn_sa",
  "ant_mc",
  "ant_sa",
  "exam_cols",
  "exam_spacing",
  "exam_shuffle",
  "exam_seed",
  "exam_from",
  "exam_to",
] as const;

function formatNo(globalIndex: number) {
  return String(globalIndex + 1).padStart(4, "0");
}

/** "EngCore 중학필수 Day3 최빈출 단어 ★★★" → 큰 제목 "EngCore 중학필수 Day3" + 꼬리표 "최빈출 단어 ★★★" */
function PrintPageHeader({
  sectionTitle,
  scoreTotal,
  review,
  studentName,
}: {
  sectionTitle: string;
  /** 이름 칸에 미리 넣을 학생 이름 */
  studentName?: string;
  /** 시험지면 문항 수(점수 칸에 쓴다) */
  scoreTotal?: number;
  /** 여러 세트를 모은 누적 시험 */
  review?: boolean;
}) {
  const { main, tag } = splitPrintTitle(sectionTitle);
  return (
    <VocabPrintDHeader
      badge={review ? "REVIEW TEST" : "DAILY TEST"}
      title={main}
      tag={tag}
      scoreTotal={scoreTotal}
      studentName={studentName}
    />
  );
}

/** 문항 수를 정하지 않았으면 빈 시험지 대신: 세트 단어 전부, 뜻 쓰기 반 + 단어 쓰기 반 */
function withDefaultExamCounts(
  parsed: ExamPrintSettings,
  sections: VocabPrintSection[]
): ExamPrintSettings {
  if (examConfigTotal(parsed.counts) > 0) return parsed;
  const total = sections.reduce((sum, s) => sum + s.items.length, 0);
  const range = resolveExamRange(parsed, total);
  const n = Math.max(0, range.to - range.from + 1);
  return {
    ...parsed,
    counts: { ...parsed.counts, meaning_sa: Math.ceil(n / 2), word_sa: Math.floor(n / 2) },
  };
}

export function VocabSetPrintView({
  sections,
  backHref,
  documentTitle,
  academyName = ACADEMY_NAME,
  logoSrc = LOGO_SRC,
}: VocabSetPrintViewProps) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(() =>
    parseVocabPrintMode(searchParams.get("mode") ?? undefined)
  );
  const [size, setSize] = useState(() =>
    parseVocabPrintSize(searchParams.get("size") ?? undefined)
  );
  const [fontScale, setFontScale] = useState(() =>
    parseVocabPrintFontScale(searchParams.get("font"))
  );
  const [lineSpacing, setLineSpacing] = useState(() =>
    parseVocabPrintLineSpacing(searchParams.get("spacing"))
  );
  const [bindingMargin, setBindingMargin] = useState(() =>
    parseVocabPrintBinding(searchParams.get("bind"))
  );
  const [examSettings, setExamSettings] = useState<ExamPrintSettings>(() =>
    withDefaultExamCounts(parseExamPrintSettings(searchParams), sections)
  );
  const [printing, setPrinting] = useState(false);
  /** PDF로 바로 저장(인쇄 창 없이). 워크북은 화면에 보이는 쪽만 그리므로 저장하는 동안 모든 쪽을 그린다 */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다(지금 그려진 쪽만)
  usePdfPrefetch(
    "vocab-print-root",
    [".vocab-print-page", ".vocab-print-page:not(.vocab-print-page--answer-key)", ".vocab-print-page--answer-key"],
    { paper: size === "b5" ? B5 : A4 }
  );
  const [pdfRenderAll, setPdfRenderAll] = useState(false);
  const [printPreparing, setPrintPreparing] = useState(false);

  const pageDims = VOCAB_PRINT_PAGE_DIMENSIONS[size];
  const perPage = itemsPerVocabPrintPage(mode, size, fontScale, lineSpacing);
  const deferredPerPage = useDeferredValue(perPage);
  const deferredMode = useDeferredValue(mode);
  const examCols = examSettings.layout.columns;
  const examRowGapPx = EXAM_ROW_GAP_PX[examSettings.layout.lineSpacing];
  const layoutClass = `vocab-print-page--font-${fontScale} vocab-print-page--spacing-${lineSpacing} ${bindingMargin ? "vocab-print-page--bind" : "vocab-print-page--nobind"}`;

  const allItems = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections]
  );

  const totalItems = allItems.length;

  /** 출제 범위(단어 번호)에 든 단어만 시험에 낸다 */
  const examRange = resolveExamRange(examSettings, totalItems);
  const examItems = useMemo(
    () => allItems.slice(examRange.from - 1, examRange.to),
    [allItems, examRange.from, examRange.to]
  );
  /** 범위 안에서 동의어·반의어가 적힌 단어 수 — 그만큼만 낼 수 있다 */
  const relationCounts = useMemo(
    () => ({
      syn: examItems.filter((i) => i.synonyms?.trim()).length,
      ant: examItems.filter((i) => i.antonyms?.trim()).length,
    }),
    [examItems]
  );

  const examGenerated = useMemo(() => {
    if (mode !== "exam") {
      return {
        questions: [] as PrintExamQuestion[],
        skipped: 0,
        skippedNoExample: 0,
        skippedNoRelation: 0,
        capped: false,
      };
    }
    return generatePrintExamQuestions(examItems, examSettings.counts, {
      shuffle: examSettings.layout.shuffle,
      shuffleSeed: examSettings.shuffleSeed,
    });
  }, [
    mode,
    examItems,
    examSettings.counts,
    examSettings.layout.shuffle,
    examSettings.shuffleSeed,
  ]);

  const showAnswerKey =
    mode === "exam" && examGenerated.questions.length > 0;

  const flatPages = useMemo(() => {
    if (deferredMode === "exam") return [];
    const rows: {
      section: VocabPrintSection;
      pageItems: (VocabPrintRow | null)[];
      pageIndex: number;
      sectionPageTotal: number;
      globalPageNum: number;
      sectionStartIndex: number;
    }[] = [];
    let globalPageNum = 0;
    for (const section of sections) {
      const pages = paginateVocabItems(section.items, deferredPerPage);
      pages.forEach((pageItems, pageIndex) => {
        globalPageNum += 1;
        rows.push({
          section,
          pageItems,
          pageIndex,
          sectionPageTotal: pages.length,
          globalPageNum,
          sectionStartIndex: pageIndex * deferredPerPage,
        });
      });
    }
    return rows;
  }, [sections, deferredPerPage, deferredMode]);

  /*
   * 자료 이름. 선생님 요청(2026-10-21): 「2개 단어세트」가 아니라 단어장 이름과 범위가 나오게, 이름을 입력하는 칸도.
   * 기본은 단어장 이름과 범위(중1 Day 1~3), 선생님이 적으면 그 이름. 고른 단어장 묶음마다 이 브라우저에 기억한다.
   */
  const autoTitle =
    documentTitle && !/개\s*단어세트$/.test(documentTitle)
      ? documentTitle
      : vocabSetsRangeTitle(sections.map((s) => s.title));
  const titleKey = `vocab-print-title:${sections.map((s) => s.setId).join(",")}`;
  const [customTitle, setCustomTitle] = useState("");
  useEffect(() => {
    try {
      setCustomTitle(window.localStorage.getItem(titleKey) ?? "");
    } catch {
      /* 저장소를 못 쓰면 기본 이름 */
    }
  }, [titleKey]);
  const chooseTitle = (v: string) => {
    setCustomTitle(v);
    try {
      if (v.trim()) window.localStorage.setItem(titleKey, v);
      else window.localStorage.removeItem(titleKey);
    } catch {
      /* 무시 */
    }
  };
  const title = customTitle.trim() || autoTitle;
  /** 시험 범위가 지문 몇 개와 딱 맞으면 시험지 머리에 그 지문을 적는다(선생님 2026-11-06: 지문별 시험지) */
  const passageTag = useMemo(() => {
    const groups = sections.length === 1 ? (sections[0].passageGroups ?? []) : [];
    if (mode !== "exam" || groups.length < 2) return "";
    const a = groups.findIndex((g) => g.from === examRange.from);
    const b = groups.findIndex((g) => g.to === examRange.to);
    if (a < 0 || b < a || (a === 0 && b === groups.length - 1)) return "";
    const short = (label: string) => label.replace(/^\d{4}년\s*/, "").replace(/학력평가\s*/, "");
    return a === b ? short(groups[a].label) : `${short(groups[a].label)} ~ ${short(groups[b].label)}`;
  }, [sections, mode, examRange.from, examRange.to]);
  const headerTitle = passageTag ? `${title} · ${passageTag}` : title;
  /** 시험지 이름 칸에 미리 넣을 학생 이름(선생님 2026-10-26). 학생마다 달라서 기억하지 않는다. */
  const [studentName, setStudentName] = useState("");

  const coverDefaults = useMemo(
    () =>
      buildDefaultVocabPrintCover({
        sections,
        mode,
        academyName,
        documentTitle,
        totalItems,
      }),
    [sections, mode, academyName, documentTitle, totalItems]
  );

  const [cover, setCover] = useState<VocabPrintCoverSettings>(() =>
    mergeVocabPrintCoverFromSearchParams(
      buildDefaultVocabPrintCover({
        sections,
        mode: parseVocabPrintMode(searchParams.get("mode") ?? undefined),
        academyName,
        documentTitle,
        totalItems: sections.reduce((n, s) => n + s.items.length, 0),
      }),
      searchParams
    )
  );

  const measureRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLElement | null>(null);
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 주소창 동기화는 늦게(타이머) 돌기 때문에, 값은 늘 아래 ref에서 최신으로 읽는다.
  // ref는 렌더 중이 아니라 값을 바꾸는 곳(핸들러·주소 반영)에서만 갱신한다.
  const layoutRef = useRef({ mode, size, fontScale, lineSpacing, bindingMargin });
  const coverRef = useRef(cover);
  const examSettingsRef = useRef(examSettings);
  const coverInputRef = useRef({ sections, academyName, documentTitle, totalItems });
  coverInputRef.current = { sections, academyName, documentTitle, totalItems };
  /** 지금 주소창의 쿼리(다른 파라미터 보존용) */
  const urlParamsRef = useRef(searchParams.toString());
  /** 우리가 마지막으로 써 넣은 쿼리 — 되돌아온 같은 주소는 다시 반영하지 않는다 */
  const lastWrittenQueryRef = useRef<string | null>(null);

  const examPagination = useVocabExamPagination({
    enabled: mode === "exam",
    questions: examGenerated.questions,
    size,
    cols: examCols,
    rowGapPx: examRowGapPx,
    lineSpacing: examSettings.layout.lineSpacing,
    fontScale,
    bindingMargin,
    measureRef,
    probeRef,
  });

  const resolvedExamPages = examPagination.pages;
  const examBasicQuestions = examPagination.basic;
  const examExampleQuestions = examPagination.examples;

  const answerKeyPages = useMemo(() => {
    if (!showAnswerKey) return [];
    // 3단 밀집 배치 — 답 길이로 쪽을 채우고 세 단을 고르게
    return paginateAnswerKey(examGenerated.questions, size);
  }, [showAnswerKey, examGenerated.questions, size]);

  const bodyPageCount =
    mode === "exam"
      ? resolvedExamPages.length + answerKeyPages.length
      : flatPages.length;
  const pageCount = bodyPageCount + (cover.enabled ? 1 : 0);
  const examSheetCount = resolvedExamPages.length;

  useEffect(() => {
    return () => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const qs = searchParams.toString();
    urlParamsRef.current = qs;
    if (lastWrittenQueryRef.current !== null && qs === lastWrittenQueryRef.current) {
      return;
    }
    const nextLayout = {
      mode: parseVocabPrintMode(searchParams.get("mode") ?? undefined),
      size: parseVocabPrintSize(searchParams.get("size") ?? undefined),
      fontScale: parseVocabPrintFontScale(searchParams.get("font")),
      lineSpacing: parseVocabPrintLineSpacing(searchParams.get("spacing")),
      bindingMargin: parseVocabPrintBinding(searchParams.get("bind")),
    };
    layoutRef.current = nextLayout;
    setMode(nextLayout.mode);
    setSize(nextLayout.size);
    setFontScale(nextLayout.fontScale);
    setLineSpacing(nextLayout.lineSpacing);
    setBindingMargin(nextLayout.bindingMargin);
    const nextExam = withDefaultExamCounts(parseExamPrintSettings(searchParams), sections);
    examSettingsRef.current = nextExam;
    setExamSettings(nextExam);
    const defaults = buildDefaultVocabPrintCover({
      sections,
      mode: nextLayout.mode,
      academyName,
      documentTitle,
      totalItems,
    });
    const nextCover = mergeVocabPrintCoverFromSearchParams(defaults, searchParams);
    coverRef.current = nextCover;
    setCover(nextCover);
  }, [searchParams, sections, academyName, documentTitle, totalItems]);

  // 인쇄 종류를 바꾸면 표지 부제·슬로건 등 기본 문구도 따라 바꾼다(직접 고친 칸은 그대로).
  const prevCoverDefaultsRef = useRef(coverDefaults);
  useEffect(() => {
    const prev = prevCoverDefaultsRef.current;
    prevCoverDefaultsRef.current = coverDefaults;
    if (prev === coverDefaults) return;
    const next = migrateCoverDefaults(coverRef.current, prev, coverDefaults);
    if (next === coverRef.current) return;
    coverRef.current = next;
    setCover(next);
  }, [coverDefaults]);

  useEffect(() => {
    const id = "vocab-print-page-size-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
    }
    // Save as PDF has no paper picker — CSS @page size alone defines the PDF page.
    // Keep this stylesheet last in <body> so it wins over other @page rules.
    el.textContent =
      size === "b5"
        ? "@media print { @page { size: 182mm 257mm; margin: 0; } @page vocab-print-b5 { size: 182mm 257mm; margin: 0; } }"
        : "@media print { @page { size: 210mm 297mm; margin: 0; } @page vocab-print-a4 { size: 210mm 297mm; margin: 0; } }";
    document.body.appendChild(el);
    document.body.dataset.vocabPrintSize = size;
    return () => {
      el?.remove();
      delete document.body.dataset.vocabPrintSize;
    };
  }, [size]);

  /** 레이아웃·표지·시험 구성을 모두 최신 ref 값으로 주소창에 쓴다 */
  const writeUrlNow = useCallback(() => {
    if (urlTimerRef.current) {
      clearTimeout(urlTimerRef.current);
      urlTimerRef.current = null;
    }
    const cur = layoutRef.current;
    const params = new URLSearchParams(urlParamsRef.current);
    params.set("mode", cur.mode);
    params.set("size", cur.size);
    if (cur.fontScale === "md") params.delete("font");
    else params.set("font", cur.fontScale);
    if (cur.lineSpacing === "normal") params.delete("spacing");
    else params.set("spacing", cur.lineSpacing);
    if (cur.bindingMargin) params.set("bind", "1");
    else params.set("bind", "0");
    const coverDefaultsNow = buildDefaultVocabPrintCover({
      ...coverInputRef.current,
      mode: cur.mode,
    });
    applyVocabPrintCoverToSearchParams(params, coverRef.current, coverDefaultsNow);
    for (const key of EXAM_URL_KEYS) params.delete(key);
    for (const [k, v] of Object.entries(
      examSettingsToSearchParams(examSettingsRef.current)
    )) {
      params.set(k, v);
    }
    const qs = params.toString();
    if (qs === urlParamsRef.current) return;
    urlParamsRef.current = qs;
    lastWrittenQueryRef.current = qs;
    // 주소만 바꾼다 — router.replace는 서버에서 페이지를 통째로 다시 불러와 미리보기가 튄다
    window.history.replaceState(window.history.state, "", `?${qs}`);
  }, []);

  const queueUrlSync = useCallback(
    (delay = 400) => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
      urlTimerRef.current = setTimeout(() => {
        urlTimerRef.current = null;
        writeUrlNow();
      }, delay);
    },
    [writeUrlNow]
  );

  const queueLayoutUrlSync = useCallback(() => queueUrlSync(400), [queueUrlSync]);

  const updateCover = useCallback(
    (patch: Partial<VocabPrintCoverSettings>) => {
      const next = { ...coverRef.current, ...patch };
      coverRef.current = next;
      setCover(next);
      queueLayoutUrlSync();
    },
    [queueLayoutUrlSync]
  );

  const setQuery = useCallback(
    (key: "mode" | "size" | "font" | "spacing" | "bind", value: string) => {
      const next = { ...layoutRef.current };
      if (key === "mode") next.mode = parseVocabPrintMode(value);
      else if (key === "size") next.size = parseVocabPrintSize(value);
      else if (key === "font") next.fontScale = parseVocabPrintFontScale(value);
      else if (key === "spacing")
        next.lineSpacing = parseVocabPrintLineSpacing(value);
      else next.bindingMargin = value !== "0" && value !== "false";
      const prevMode = layoutRef.current.mode;
      layoutRef.current = next;
      if (next.mode !== prevMode) {
        // 주소창에 옛 기본 문구가 먼저 적히지 않도록 표지 기본 문구를 바로 바꿔 둔다
        const input = coverInputRef.current;
        const migrated = migrateCoverDefaults(
          coverRef.current,
          buildDefaultVocabPrintCover({ ...input, mode: prevMode }),
          buildDefaultVocabPrintCover({ ...input, mode: next.mode })
        );
        if (migrated !== coverRef.current) {
          coverRef.current = migrated;
          setCover(migrated);
        }
      }
      // bind는 URL echo와 경쟁하지 않도록 즉시 반영 (startTransition 제외)
      if (key === "bind") {
        setBindingMargin(next.bindingMargin);
      } else {
        startTransition(() => {
          setMode(next.mode);
          setSize(next.size);
          setFontScale(next.fontScale);
          setLineSpacing(next.lineSpacing);
        });
      }
      queueLayoutUrlSync();
    },
    [queueLayoutUrlSync]
  );

  const updateExamSettings = useCallback(
    (next: ExamPrintSettings) => {
      examSettingsRef.current = next;
      setExamSettings(next);
      queueUrlSync(350);
    },
    [queueUrlSync]
  );

  const reshuffleExam = useCallback(() => {
    const next = { ...examSettingsRef.current, shuffleSeed: Date.now() };
    examSettingsRef.current = next;
    setExamSettings(next);
    writeUrlNow();
  }, [writeUrlNow]);

  const ensurePrintPageStyle = useCallback(() => {
    const id = "vocab-print-page-size-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
    }
    el.textContent =
      size === "b5"
        ? "@media print { @page { size: 182mm 257mm; margin: 0; } @page vocab-print-b5 { size: 182mm 257mm; margin: 0; } }"
        : "@media print { @page { size: 210mm 297mm; margin: 0; } @page vocab-print-a4 { size: 210mm 297mm; margin: 0; } }";
    document.body.appendChild(el);
    document.body.dataset.vocabPrintSize = size;
  }, [size]);

  const runScopedPrint = useCallback(
    (scope: "exam" | "answers" | "all") => {
      ensurePrintPageStyle();
      if (scope === "all") delete document.body.dataset.vocabPrintScope;
      else document.body.dataset.vocabPrintScope = scope;
      window.print();
      window.setTimeout(() => {
        delete document.body.dataset.vocabPrintScope;
      }, 500);
    },
    [ensurePrintPageStyle]
  );

  const handlePrint = useCallback(() => {
    if (mode === "exam") {
      runScopedPrint("exam");
      return;
    }
    ensurePrintPageStyle();
    setPrintPreparing(true);
    setPrinting(true);
  }, [mode, runScopedPrint, ensurePrintPageStyle]);

  const handlePrintAnswerKey = useCallback(() => {
    if (examGenerated.questions.length === 0) return;
    runScopedPrint("answers");
  }, [examGenerated.questions.length, runScopedPrint]);

  const handlePrintExamWithAnswers = useCallback(() => {
    if (examGenerated.questions.length === 0) return;
    runScopedPrint("all");
  }, [examGenerated.questions.length, runScopedPrint]);

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const finish = () => {
      setPrinting(false);
      setPrintPreparing(false);
    };
    const run = () => {
      if (cancelled) return;
      ensurePrintPageStyle();
      setPrintPreparing(false);
      window.print();
    };
    // Wait for all pages to mount before opening the print dialog
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(run));
    }, flatPages.length > 80 ? 120 : 16);

    window.addEventListener("afterprint", finish);
    // Some browsers skip afterprint
    const fallback = window.setTimeout(finish, 120_000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearTimeout(fallback);
      window.removeEventListener("afterprint", finish);
    };
  }, [printing, flatPages.length, ensurePrintPageStyle]);

  /** PDF로 저장. part: 시험지(표지 포함)·정답지·전체 */
  async function savePdf(label: string, part: "exam" | "answers" | "all") {
    if (pdf.busy) return;
    const needAll = mode !== "exam";
    if (needAll) {
      setPdfRenderAll(true);
      // 모든 쪽이 그려질 때까지 기다린다
      await new Promise((r) => window.setTimeout(r, flatPages.length > 80 ? 250 : 80));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    try {
      const selector =
        part === "answers"
          ? ".vocab-print-page--answer-key"
          : part === "exam"
            ? ".vocab-print-page:not(.vocab-print-page--answer-key)"
            : ".vocab-print-page";
      await pdf.save(
        label,
        collectPrintPages(document.getElementById("vocab-print-root"), selector),
        [title],
        size === "b5" ? B5 : A4
      );
    } finally {
      if (needAll) setPdfRenderAll(false);
    }
  }

  const examPageStyle = {
    ["--vocab-exam-cols" as string]: examCols,
    ["--vocab-exam-row-gap" as string]: `${examRowGapPx}px`,
    ["--vocab-page-width" as string]: pageDims.width,
    ["--vocab-page-height" as string]: pageDims.height,
  } as React.CSSProperties;

  const accentColor = resolveVocabCoverLevel(cover.color, cover.title, cover.seriesLabel).level.deep;

  const workbookPageStyle = useMemo(
    () =>
      ({
        ["--vocab-rows-per-page" as string]: deferredPerPage,
        ["--vocab-page-width" as string]: pageDims.width,
        ["--vocab-page-height" as string]: pageDims.height,
      }) as React.CSSProperties,
    [deferredPerPage, pageDims.width, pageDims.height]
  );

  const renderWorkbookEntry = useCallback(
    (item: VocabPrintRow, globalIndex: number, entryMode: VocabPrintMode) => (
      <PrintEntry
        key={item.id}
        item={item}
        globalIndex={globalIndex}
        mode={entryMode}
      />
    ),
    []
  );

  if (totalItems === 0) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-slate-600">인쇄할 단어가 없습니다.</p>
        <Link href={backHref} className="mt-4 inline-block text-brand-600 hover:underline">
          돌아가기
        </Link>
      </div>
    );
  }

  const examTotal = examConfigTotal(examSettings.counts);

  const previewPages =
    mode === "exam" ? (
      <>
        {resolvedExamPages.map((pageSlice, pageIndex) => {
          const isLastExam = pageIndex === resolvedExamPages.length - 1;
          // 마지막 장에는 break-after 금지(Chrome 빈 페이지). 정답지는 break-before로 나눔.
          const examBreak = isLastExam ? "" : "vocab-print-page-break";
          return (
          <article
            key={`exam-${pageIndex}`}
            className={`vocab-print-page vocab-print-page--${size} vocab-print-page--exam vocab-print-page--exam-sheet vocab-exam-spacing-${examSettings.layout.lineSpacing} vocab-print-page--font-${fontScale} ${bindingMargin ? "vocab-print-page--bind" : "vocab-print-page--nobind"} ${examBreak}${isLastExam ? " vocab-print-page-last" : ""}`}
            data-size={size}
            style={examPageStyle}
          >
            <PrintPageHeader
              sectionTitle={headerTitle}
              scoreTotal={examGenerated.questions.length}
              review={sections.length > 1}
              studentName={studentName}
            />

            <div className="vocab-exam-body">
              {pageSlice.basic.length > 0 ? (
                <div
                  className={`vocab-exam-list vocab-exam-list--basic vocab-exam-list--${examCols}col vocab-exam-list--colflow`}
                  style={
                    {
                      "--vocab-exam-rows": Math.ceil(pageSlice.basic.length / examCols),
                    } as React.CSSProperties
                  }
                >
                  {pageSlice.basic.map((q) => (
                    <PrintExamEntry key={q.number} question={q} />
                  ))}
                </div>
              ) : null}
              {pageSlice.examples.length > 0 ? (
                <div className="vocab-exam-list vocab-exam-list--examples">
                  {pageSlice.examples.map((q) => (
                    <PrintExamEntry
                      key={q.number}
                      question={q}
                      variant="example"
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <footer className="vocab-print-footer">
              <span>{academyName}</span>
              <span>
                {pageIndex + 1} / {examSheetCount}
              </span>
            </footer>
          </article>
          );
        })}
        {answerKeyPages.map((cols, pageIndex) => {
          const isLast = pageIndex === answerKeyPages.length - 1;
          // 시험지 뒤에 붙일 때·정답지 2장째부터 페이지 나눔
          const answerBreakClass =
            pageIndex === 0
              ? resolvedExamPages.length > 0
                ? "vocab-print-page-break-before"
                : ""
              : "vocab-print-page-break-before";
          return (
            <article
              key={`answer-${pageIndex}`}
              className={`vocab-print-page vocab-print-page--${size} vocab-print-page--exam vocab-print-page--answer-key vocab-print-page--font-${fontScale} ${bindingMargin ? "vocab-print-page--bind" : "vocab-print-page--nobind"} ${answerBreakClass} ${isLast ? "vocab-print-page-last" : ""}`}
              data-size={size}
              style={examPageStyle}
            >
              <VocabPrintDHeader
                badge="ANSWER KEY"
                dark
                title={`${splitPrintTitle(headerTitle).main} · 정답`}
                aside={`선생님용 · ${academyName}`}
              />
              <div className="vocab-answer-key-body">
                {cols.map((col, colIndex) => (
                  <div key={colIndex} className="vocab-answer-key-col">
                    {col.map((q) => (
                      <div key={q.number} className="vocab-answer-key-row">
                        <span className="vocab-answer-key-no">{q.number}.</span>
                        <span className="vocab-answer-key-ans">{q.answer}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <footer className="vocab-print-footer">
                <span>교사용 정답지</span>
                <span>
                  {pageIndex + 1} / {answerKeyPages.length}
                </span>
              </footer>
            </article>
          );
        })}
      </>
    ) : (
      <VocabWorkbookPrintPages
        pages={flatPages}
        mode={deferredMode === "exam" ? "workbook" : deferredMode}
        size={size}
        layoutClass={layoutClass}
        pageStyle={workbookPageStyle}
        academyName={academyName}
        logoSrc={logoSrc}
        multiSection={sections.length > 1}
        printing={printing || pdfRenderAll}
        scrollParentRef={previewScrollRef}
        renderEntry={renderWorkbookEntry}
      />
    );

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      {mode === "exam" && examGenerated.questions.length > 0 ? (
        <>
          <div
            ref={measureRef}
            className="font-print pointer-events-none fixed -left-[200vw] top-0 opacity-0"
            aria-hidden
          >
            <article
              className={`vocab-print-page vocab-print-page--${size} vocab-print-page--exam vocab-exam-spacing-${examSettings.layout.lineSpacing} vocab-print-page--font-${fontScale} ${bindingMargin ? "vocab-print-page--bind" : "vocab-print-page--nobind"}`}
              style={examPageStyle}
            >
              <div
                className={`vocab-exam-list vocab-exam-list--basic vocab-exam-list--${examCols}col`}
              >
                {examBasicQuestions.map((q) => (
                  <div key={q.number} data-measure-basic={q.number}>
                    <PrintExamEntry question={q} />
                  </div>
                ))}
              </div>
              <div className="vocab-exam-list vocab-exam-list--examples">
                {examExampleQuestions.map((q) => (
                  <div key={q.number} data-measure-example={q.number}>
                    <PrintExamEntry question={q} variant="example" />
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div
            ref={probeRef}
            className="pointer-events-none fixed -left-[200vw] top-0 opacity-0"
            aria-hidden
          >
            <article
              className={`vocab-print-page vocab-print-page--${size} vocab-print-page--exam vocab-print-page--font-${fontScale} ${bindingMargin ? "vocab-print-page--bind" : "vocab-print-page--nobind"}`}
              style={examPageStyle}
            >
              <PrintPageHeader
                sectionTitle={headerTitle}
                scoreTotal={examGenerated.questions.length}
                review={sections.length > 1}
                studentName={studentName}
              />
              <div data-exam-body-zone className="min-h-0 flex-1" />
              <footer className="vocab-print-footer">
                <span>{academyName}</span>
                <span>1 / 1</span>
              </footer>
            </article>
          </div>
        </>
      ) : null}
      <div className="flex min-h-screen print:block">
        <aside className="no-print w-[min(100%,340px)] shrink-0 border-r border-slate-200 bg-white">
          <div className="sticky top-0 flex max-h-screen flex-col gap-3 overflow-y-auto p-4">
            <div className="px-1">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900"
              >
                <Icon name="left" size={16} />
                돌아가기
              </Link>
              <h1 className="mt-2 text-base font-bold leading-snug text-slate-900">
                {title}
              </h1>
              <p className="mt-1 text-[13px] text-slate-500">
                {totalItems}단어 · {pageCount}페이지
                {cover.enabled ? " (표지 포함)" : ""} ·{" "}
                {VOCAB_PRINT_SIZE_LABELS[size]}
                {mode !== "exam"
                  ? ` · ${VOCAB_PRINT_FONT_LABELS[fontScale]} · ${VOCAB_PRINT_SPACING_LABELS[lineSpacing]}`
                  : ""}
                {mode === "exam" && examGenerated.questions.length > 0
                  ? ` · 문항 ${examGenerated.questions.length}개`
                  : ""}
              </p>
            </div>

            <label className="flex flex-col gap-1 px-1">
              <span className="text-xs font-semibold text-slate-600">자료 이름</span>
              <input
                value={customTitle}
                onChange={(e) => chooseTitle(e.target.value)}
                placeholder={autoTitle}
                maxLength={60}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
              <span className="text-[11px] text-slate-400">
                비워 두면 단어장 이름과 범위로 나와요{sections.length > 1 ? ` (${sections.length}개 단어장)` : ""}.
              </span>
            </label>

            {mode === "exam" ? (
              <label className="flex flex-col gap-1 px-1">
                <span className="text-xs font-semibold text-slate-600">학생 이름</span>
                <input
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="비워 두면 빈칸으로 나와요"
                  maxLength={20}
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                />
                <span className="text-[11px] text-slate-400">시험지 이름 칸에 미리 적혀 나와요.</span>
              </label>
            ) : null}

            <PanelSection title="인쇄 종류" defaultOpen>
              <div className="flex flex-col gap-1.5">
                {(Object.keys(VOCAB_PRINT_MODE_LABELS) as VocabPrintMode[]).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQuery("mode", key)}
                      aria-pressed={mode === key}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-[13px] font-semibold transition ${choiceClass(
                        mode === key
                      )}`}
                    >
                      {VOCAB_PRINT_MODE_LABELS[key]}
                      {mode === key ? (
                        <Icon name="check" size={15} strokeWidth={2.4} />
                      ) : null}
                    </button>
                  )
                )}
              </div>

              <PanelField label="용지">
                <div className="flex gap-1.5">
                  {(["a4", "b5"] as VocabPrintSize[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQuery("size", key)}
                      aria-pressed={size === key}
                      className={`flex-1 rounded-md border px-3 py-2 text-[13px] font-semibold transition ${choiceClass(
                        size === key
                      )}`}
                    >
                      {VOCAB_PRINT_SIZE_LABELS[key]}
                    </button>
                  ))}
                </div>
              </PanelField>

              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2.5">
                <span className="text-[13px] font-medium text-slate-700">
                  제본 여백 (왼쪽 넓게)
                </span>
                <input
                  type="checkbox"
                  checked={bindingMargin}
                  onChange={(e) => {
                    const on = e.target.checked;
                    layoutRef.current = {
                      ...layoutRef.current,
                      bindingMargin: on,
                    };
                    setBindingMargin(on);
                    queueLayoutUrlSync();
                  }}
                  className="h-4 w-4 accent-brand-600"
                />
              </label>

              <PanelField label="글자 크기">
                <div className="flex gap-1.5">
                  {(["sm", "md", "lg"] as VocabPrintFontScale[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQuery("font", key)}
                      aria-pressed={fontScale === key}
                      className={`flex-1 rounded-md border px-2 py-2 text-[13px] font-semibold transition ${choiceClass(
                        fontScale === key
                      )}`}
                    >
                      {VOCAB_PRINT_FONT_LABELS[key]}
                    </button>
                  ))}
                </div>
              </PanelField>

              {mode !== "exam" ? (
                <PanelField label="줄간격">
                  <div className="flex gap-1.5">
                    {(["tight", "normal", "relaxed"] as VocabPrintLineSpacing[]).map(
                      (key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setQuery("spacing", key)}
                          aria-pressed={lineSpacing === key}
                          className={`flex-1 rounded-md border px-2 py-2 text-[13px] font-semibold transition ${choiceClass(
                            lineSpacing === key
                          )}`}
                        >
                          {VOCAB_PRINT_SPACING_LABELS[key]}
                        </button>
                      )
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-snug text-slate-500">
                    작게·좁게 할수록 한 쪽에 단어가 많이 들어가요. (지금 한 쪽에{" "}
                    {perPage}개)
                  </p>
                </PanelField>
              ) : null}
            </PanelSection>

            {mode === "exam" ? (
              <PanelSection title="시험 구성" defaultOpen>
                <VocabPrintExamConfig
                  settings={examSettings}
                  onChange={updateExamSettings}
                  onReshuffle={reshuffleExam}
                  wordCount={totalItems}
                  relationCounts={relationCounts}
                  passageGroups={sections.length === 1 ? sections[0].passageGroups : undefined}
                />
                {examTotal === 0 ? (
                  <p className="text-[13px] text-amber-700">
                    문항 수를 넣으면 시험지가 만들어져요.
                  </p>
                ) : null}
                {examTotal > 0 && examGenerated.questions.length === 0 ? (
                  <p className="text-[13px] text-rose-700">
                    문항을 만들 수 없어요. 객관식은 단어가 2개 이상, 예문 문항은
                    예문에 그 단어가 들어 있어야 해요.
                  </p>
                ) : null}
                {examGenerated.capped ? (
                  <p className="text-[13px] text-amber-700">
                    범위 단어 {examItems.length}개까지만 낼 수 있어요. (요청 {examTotal}문항 →
                    실제 {examGenerated.questions.length}문항)
                  </p>
                ) : null}
                {examGenerated.skippedNoExample > 0 ? (
                  <p className="text-[13px] text-amber-700">
                    예문이 있는 단어가 부족해 {examGenerated.skippedNoExample}
                    문항을 뺐어요. (예문에 그 단어가 들어 있어야 문제로 낼 수 있어요)
                  </p>
                ) : null}
                {examGenerated.skippedNoRelation > 0 ? (
                  <p className="text-[13px] text-amber-700">
                    동의어·반의어가 적힌 단어가 부족해 {examGenerated.skippedNoRelation}
                    문항을 뺐어요. (객관식은 헷갈리지 않는 오답 보기가 3개 있어야 내요)
                  </p>
                ) : null}
                {examGenerated.skipped > 0 ? (
                  <p className="text-[13px] text-amber-700">
                    {examGenerated.skipped}문항은 문제를 만들 수 없어 뺐어요. (뜻이
                    비어 있거나 보기로 쓸 단어가 모자라요)
                  </p>
                ) : null}
              </PanelSection>
            ) : null}

            <PanelSection
              title="표지"
              defaultOpen={cover.enabled}
              aside={
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-slate-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={cover.enabled}
                    onChange={(e) => updateCover({ enabled: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                  넣기
                </label>
              }
            >
              {cover.enabled ? (
                <div className="space-y-3">
                  <PanelField label="디자인">
                    <div className="grid grid-cols-3 gap-1.5">
                      {(Object.keys(VOCAB_COVER_THEME_LABELS) as VocabCoverTheme[]).map(
                        (key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => updateCover({ theme: key })}
                            aria-pressed={cover.theme === key}
                            className={`rounded-md border px-1 py-1.5 text-[12.5px] font-semibold transition ${choiceClass(
                              cover.theme === key
                            )}`}
                          >
                            {VOCAB_COVER_THEME_LABELS[key]}
                          </button>
                        )
                      )}
                    </div>
                  </PanelField>

                  {cover.theme === "hybrid" || cover.theme === "block" || cover.theme === "neon" ? (
                    <PanelField label="색">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateCover({ color: "auto" })}
                          aria-pressed={cover.color === "auto"}
                          className={`rounded-md border px-2 py-1 text-[12.5px] font-semibold transition ${choiceClass(
                            cover.color === "auto"
                          )}`}
                        >
                          레벨에 맞게
                        </button>
                        {VOCAB_COVER_LEVELS.map((l) => (
                          <button
                            key={l.key}
                            type="button"
                            title={l.name}
                            aria-label={l.name}
                            aria-pressed={cover.color === l.key}
                            onClick={() => updateCover({ color: l.key as VocabCoverColor })}
                            className={`h-7 w-7 rounded-full border-2 transition ${
                              cover.color === l.key ? "border-slate-900" : "border-white shadow-[0_0_0_1px_rgb(203_213_225)]"
                            }`}
                            style={{ background: l.deep }}
                          />
                        ))}
                      </div>
                    </PanelField>
                  ) : null}

                  <PanelField label="글꼴">
                    <div className="flex gap-1.5">
                      {(Object.keys(VOCAB_COVER_FONT_LABELS) as VocabCoverFont[]).map(
                        (key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => updateCover({ fontFamily: key })}
                            aria-pressed={cover.fontFamily === key}
                            className={`flex-1 rounded-md border px-2 py-1.5 text-[13px] font-semibold transition ${choiceClass(
                              cover.fontFamily === key
                            )}`}
                          >
                            {VOCAB_COVER_FONT_LABELS[key]}
                          </button>
                        )
                      )}
                    </div>
                  </PanelField>

                  <PanelField label="제목 크기">
                    <div className="flex gap-1.5">
                      {(
                        Object.keys(
                          VOCAB_COVER_TITLE_SIZE_LABELS
                        ) as VocabCoverTitleSize[]
                      ).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => updateCover({ titleSize: key })}
                          aria-pressed={cover.titleSize === key}
                          className={`flex-1 rounded-md border px-2 py-1.5 text-[13px] font-semibold transition ${choiceClass(
                            cover.titleSize === key
                          )}`}
                        >
                          {VOCAB_COVER_TITLE_SIZE_LABELS[key]}
                        </button>
                      ))}
                    </div>
                  </PanelField>

                  <PanelField label="슬로건">
                    <input
                      type="text"
                      value={cover.slogan}
                      onChange={(e) => updateCover({ slogan: e.target.value })}
                      className="ui-input h-9 py-1.5 text-[13px]"
                      placeholder="시험에 나오는 것만 공부한다!"
                    />
                  </PanelField>
                  <PanelField label="메인 제목">
                    <input
                      type="text"
                      value={cover.title}
                      onChange={(e) => updateCover({ title: e.target.value })}
                      className="ui-input h-9 py-1.5 text-[13px]"
                    />
                  </PanelField>
                  <PanelField label="부제">
                    <input
                      type="text"
                      value={cover.subtitle}
                      onChange={(e) => updateCover({ subtitle: e.target.value })}
                      className="ui-input h-9 py-1.5 text-[13px]"
                    />
                  </PanelField>
                  <PanelField label="시리즈 / 단계">
                    <input
                      type="text"
                      value={cover.seriesLabel}
                      onChange={(e) =>
                        updateCover({ seriesLabel: e.target.value })
                      }
                      className="ui-input h-9 py-1.5 text-[13px]"
                      placeholder="비우면 숨겨요"
                    />
                  </PanelField>
                  <PanelField label="학원명">
                    <input
                      type="text"
                      value={cover.academyName}
                      onChange={(e) =>
                        updateCover({ academyName: e.target.value })
                      }
                      className="ui-input h-9 py-1.5 text-[13px]"
                    />
                  </PanelField>
                  <PanelField label="부가 문구">
                    <input
                      type="text"
                      value={cover.metaLine}
                      onChange={(e) => updateCover({ metaLine: e.target.value })}
                      className="ui-input h-9 py-1.5 text-[13px]"
                    />
                  </PanelField>
                  <PanelField label="꼬리말">
                    <input
                      type="text"
                      value={cover.footerText}
                      onChange={(e) =>
                        updateCover({ footerText: e.target.value })
                      }
                      className="ui-input h-9 py-1.5 text-[13px]"
                      placeholder="학원 · Vocabulary Workbook"
                    />
                  </PanelField>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={cover.showNameFields}
                      onChange={(e) =>
                        updateCover({ showNameFields: e.target.checked })
                      }
                      className="h-4 w-4 accent-brand-600"
                    />
                    이름 / 반 적는 칸
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const defaults = { ...coverDefaults, enabled: cover.enabled };
                      coverRef.current = defaults;
                      setCover(defaults);
                      queueLayoutUrlSync();
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Icon name="rotate" size={14} />
                    처음 값으로 되돌리기
                  </button>
                </div>
              ) : (
                <p className="text-[13px] text-slate-500">
                  ‘넣기’를 켜면 맨 앞에 표지가 들어가요.
                </p>
              )}
            </PanelSection>

            <div className="mt-auto flex flex-col gap-2 border-t border-slate-100 pt-4">
              {mode === "exam" ? (
                <>
                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={
                      printPreparing || examGenerated.questions.length === 0
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Icon name="print" size={16} strokeWidth={2} />
                    시험지 인쇄
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handlePrintAnswerKey}
                      disabled={
                        printPreparing || examGenerated.questions.length === 0
                      }
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      정답지만
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintExamWithAnswers}
                      disabled={
                        printPreparing || examGenerated.questions.length === 0
                      }
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      시험지+정답지
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printPreparing}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  <Icon name="print" size={16} strokeWidth={2} />
                  {printPreparing ? "인쇄 준비 중…" : "인쇄"}
                </button>
              )}
              <p className="text-xs font-semibold text-slate-600">PDF로 저장</p>
              {mode === "exam" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["시험지", "exam"],
                      ["정답지", "answers"],
                      ["전체", "all"],
                    ] as const
                  ).map(([label, part]) => (
                    <button
                      key={part}
                      type="button"
                      onClick={() => void savePdf(label, part)}
                      disabled={!!pdf.busy || printPreparing || examGenerated.questions.length === 0}
                      className="rounded-md border border-brand-300 bg-white px-2 py-2 text-[13px] font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void savePdf("단어장", "all")}
                  disabled={!!pdf.busy || printPreparing}
                  className="w-full rounded-md border border-brand-300 bg-white px-3 py-2.5 text-[13px] font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50"
                >
                  PDF로 저장
                </button>
              )}
              {pdf.status ? (
                <p className={`text-xs font-semibold ${pdf.busy ? "text-brand-700" : "text-rose-600"}`}>{pdf.status}</p>
              ) : null}
              <p className="text-xs leading-snug text-slate-500">
                PDF로 저장할 때는 용지를 따로 고르지 않아요. 위에서 고른{" "}
                <strong className="font-semibold text-slate-700">
                  {size === "b5" ? "B5 (JIS) 182×257mm" : "A4 210×297mm"}
                </strong>
                크기로 저장돼요. 여백은{" "}
                <strong className="font-semibold text-slate-700">없음</strong>,
                배율은{" "}
                <strong className="font-semibold text-slate-700">기본/100%</strong>
                로 두세요.
              </p>
            </div>
          </div>
        </aside>

        <main
          ref={(node) => {
            previewScrollRef.current = node;
          }}
          className="min-w-0 flex-1 overflow-auto bg-slate-300/40 print:overflow-visible print:bg-white"
        >
          <div className="no-print border-b border-slate-300/60 bg-slate-200/80 px-5 py-2.5 backdrop-blur-sm">
            <p className="text-sm font-semibold text-slate-700">미리보기</p>
            <p className="text-xs text-slate-500">
              {pageCount}페이지 · 스크롤하여 전체 확인
              {pageCount > 16 && mode !== "exam"
                ? " · 화면에 보이는 페이지만 불러와 빠르게 표시"
                : ""}
            </p>
          </div>

          <div className="flex justify-center p-5 pb-12 print:p-0">
            <div
              id="vocab-print-root"
              data-size={size}
              style={{ ["--vd" as string]: accentColor } as React.CSSProperties}
              className="flex w-full max-w-[920px] flex-col items-center gap-8 print:max-w-none print:gap-0"
            >
              {cover.enabled ? (
                <VocabPrintCoverPage
                  cover={cover}
                  size={size}
                  logoSrc={logoSrc}
                  bindingMargin={bindingMargin}
                  pageBreakAfter={bodyPageCount > 0}
                  stats={{ days: sections.length, words: totalItems }}
                />
              ) : null}
              {previewPages}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

const PrintExamEntry = memo(function PrintExamEntry({
  question,
  variant = "basic",
}: {
  question: PrintExamQuestion;
  variant?: "basic" | "example";
}) {
  return (
    <section
      className={`vocab-exam-row${variant === "example" ? " vocab-exam-row--example" : ""}${
        !question.choices && variant !== "example" ? " vocab-exam-row--inline" : ""
      }`}
    >
      <div className="vocab-exam-q-head">
        <span className="vocab-exam-q-no">{question.number}.</span>
        <div className="vocab-exam-q-main">
          <p className="vocab-exam-prompt">
            {question.tag ? (
              <span className={/\s/.test(question.prompt.trim()) ? undefined : "vocab-exam-tagged"}>
                <span className={`vocab-exam-tag vocab-exam-tag--${question.tag}`}>
                  {question.tag === "syn" ? "동" : "반"}
                </span>
                {question.prompt}
              </span>
            ) : (
              question.prompt
            )}
          </p>
        </div>
      </div>
      {question.choices ? (
        <ul className="vocab-exam-choices">
          {question.choices.map((choice, i) => (
            <li key={i}>
              <span className="vocab-exam-choice-mark">
                {CHOICE_MARKS[i] ?? `${i + 1}.`}
              </span>
              {choice}
            </li>
          ))}
        </ul>
      ) : (
        <div className="vocab-exam-answer-line" />
      )}
    </section>
  );
});

/** 긴 단어·예문만 해당 칸 폰트를 살짝 줄임 (기본 크기는 유지) */
function printDensityClass(
  kind: "word" | "meaning" | "body",
  text: string
): string {
  const t = text.trim();
  if (!t) return "";
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).length;
  const len = t.length;

  if (kind === "word") {
    if (len >= 15) return "vocab-print-density--xs";
    if (len >= 12) return "vocab-print-density--sm";
    return "";
  }
  if (kind === "meaning") {
    if (len >= 36) return "vocab-print-density--xs";
    if (len >= 22) return "vocab-print-density--sm";
    return "";
  }
  // example / translation
  if (len >= 200 || lines >= 3) return "vocab-print-density--xs";
  if (len >= 110 || lines >= 2) return "vocab-print-density--sm";
  return "";
}

const PrintEntry = memo(function PrintEntry({
  item,
  globalIndex,
  mode,
}: {
  item: VocabPrintRow;
  globalIndex: number;
  mode: VocabPrintMode;
}) {
  const exampleSentence = item.example_sentence?.trim() ?? "";
  const exampleMeaning = item.example_meaning?.trim() ?? "";
  const synonyms = item.synonyms?.trim() ?? "";
  const antonyms = item.antonyms?.trim() ?? "";
  const showFull = mode === "full";
  const pos = item.part_of_speech?.trim();
  const wordDensity = printDensityClass("word", item.word);
  const meaningDensity = printDensityClass("meaning", item.meaning);
  const exampleDensity = printDensityClass("body", exampleSentence);
  const translationDensity = printDensityClass(
    "body",
    exampleMeaning || exampleSentence
  );

  if (!showFull) {
    return (
      <section className="vocab-print-row vd-row">
        <span className="vd-no">{globalIndex + 1}</span>
        <span className="vd-word-cell">
          <span className={`vd-word ${wordDensity}`.trim()}>{item.word}</span>
          {pos ? <span className="vd-pos">{pos}</span> : null}
        </span>
        <span className="vd-checks" aria-hidden>
          ☐☐☐
        </span>
        <span className="vd-fold" aria-hidden />
        <span className={`vd-meaning ${meaningDensity}`.trim()}>{item.meaning}</span>
      </section>
    );
  }

  return (
    <section className="vocab-print-row vd-row-full">
      <div className="vd-full-left">
        <span className="vd-no">{globalIndex + 1}</span>
        <span className={`vd-word vd-word--lg ${wordDensity}`.trim()}>{item.word}</span>
        <span className="vd-checks" aria-hidden>
          ☐☐☐
        </span>
      </div>
      <div className="vd-full-right">
        {/* 뜻을 예문 바로 위에 굵게 둔다 — 예문을 읽기 전에 먼저 눈에 들어와야 한다 */}
        <p className={`vd-meaning vd-meaning--top ${meaningDensity}`.trim()}>
          {item.meaning}
          {pos ? <span className="vd-pos"> {pos}</span> : null}
        </p>
        {exampleSentence ? (
          <p className={`vd-example ${exampleDensity}`.trim()}>
            {highlightWordInSentence(exampleSentence, item.word)}
          </p>
        ) : null}
        {exampleMeaning ? (
          <p className={`vd-translation ${translationDensity}`.trim()}>{exampleMeaning}</p>
        ) : null}
        {synonyms || antonyms ? (
          <div className="vd-chips">
            {synonyms ? <span className="vd-chip vd-chip--syn">= {synonyms}</span> : null}
            {antonyms ? <span className="vd-chip vd-chip--ant">↔ {antonyms}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
});
