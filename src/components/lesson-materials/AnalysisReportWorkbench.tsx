"use client";

import { CloseSaveButton } from "@/components/lesson-materials/CloseSaveButton";
import { isPrinting } from "@/lib/print/is-printing";
import { useDocumentName } from "@/components/lesson-materials/useDocumentName";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import { Alert } from "@/components/ui/Alert";
import {
  generateAndSaveAnalysisReportAction,
  regenerateAnalysisSentenceAction,
  reportAnalysisErrorAction,
  saveAnalysisReportAction,
} from "@/lib/lesson-materials/analysis-report-actions";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import type {
  AnalysisGrammarPoint,
  AnalysisReportData,
  AnalysisSentence,
} from "@/lib/lesson-materials/generate-analysis-report";
import { LOGO_SRC } from "@/lib/branding";
import { postJson } from "@/lib/lesson-materials/post-json";
import { DocumentTitle } from "@/components/lesson-materials/DocumentTitle";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  useCreateDocumentFromUrl,
  DOCUMENT_NAME_EVENT,
} from "@/components/lesson-materials/open-new-document";
import { useScaledHeight } from "@/components/lesson-materials/use-scaled-height";
import { AnalysisMarkupSentence } from "@/components/lesson-materials/AnalysisMarkupSentence";
import { readAnalysisMarkup } from "@/lib/lesson-materials/analysis-markup";
import { applyMarkupEdit, plainSentenceText, type MarkupEdit } from "@/lib/lesson-materials/analysis-markup-edit";
import {
  AnalysisErrorReportDialog,
  AnalysisMarkupEditPopover,
  type MarkupEditTarget,
} from "@/components/lesson-materials/AnalysisMarkupEditPopover";
import { watchPageNumbersById } from "@/lib/lesson-materials/page-numbers";
import "./material-design.css";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import {
  ANALYSIS_BASE_STYLE,
  materialDesignClass,
  useMaterialDesign,
  type MaterialDesign,
} from "@/lib/lesson-materials/material-design";
import { SentenceNotes, sentenceNotesFor, type SentenceNote } from "@/components/lesson-materials/AnalysisSentenceNotes";
import type { OnePageContent } from "@/lib/lesson-materials/one-page";
import {
  DESIGN_FONTS_HREF,
  designClass,
  type AnalysisDesignStyle,
} from "@/lib/lesson-materials/analysis-design";

export type { AnalysisDesignStyle };

/** 분석서를 동시에 만드는 지문 수. 지문 하나가 모델 호출 하나라 8개도 부담이 작다. */
const ANALYSIS_REPORT_CONCURRENCY = 8;

export type AnalysisReportProjectInput = {
  id: string;
  title: string;
  titleEn: string | null;
  source: string | null;
  headerLabel: string;
  report: AnalysisReportData | null;
  /** 1장 자료 재료(있으면 문장 밑에 지칭·함축·바꿔 말하기 주석) */
  onePageContent?: OnePageContent | null;
};

const A4_WIDTH = "210mm";
const A4_HEIGHT = "297mm";
const A4_PAD_MM = 12;
const A4_PAD = `${A4_PAD_MM}mm`;
const A4_FOOTER_MM = 16;
/** 인쇄에서 쪽 아래 여백(globals.css의 .analysis-report-a4-sheet). 담을 높이는 이 값으로 잰다. */
const PRINT_FOOTER_MM = 15;
/**
 * 분석서가 아직 없을 때 쓰는 빈 배열. 렌더마다 새 []를 만들어 effect 의존성에
 * 넣으면 쪽 배치 effect가 매번 state를 바꿔 무한 렌더가 되고(React #185),
 * 화면이 "Application error"로 죽었다. 쪽 배치는 이제 projects에 걸려 있지만,
 * 빈 배열은 계속 이 상수 하나를 쓴다.
 */
const NO_SENTENCES: AnalysisReportData["sentences"] = [];

function joinChunks(texts: string[], sep = " / ") {
  return texts.map((t) => t.trim()).filter(Boolean).join(sep);
}

function GrammarPointItem({
  point,
  index,
}: {
  point: AnalysisGrammarPoint;
  index: number;
}) {
  const mark = ["①", "②", "③", "④", "⑤"][index] ?? `${index + 1}.`;
  const title = (point.title || point.category || "").replace(
    /^(최우선|핵심|중요\s*구문)\s*[·•\-–—:]\s*/u,
    ""
  );

  // 문법 설명: 새로 만든 분석서는 explanation, 옛 분석서는 짧은 판단 근거가 있으면 그것.
  const explanation = (point.explanation || point.decisionRule || "").trim();

  return (
    <li className="text-[13px] leading-relaxed text-slate-800">
      <span className="mr-1 font-bold text-rose-600">{mark}</span>
      <span className="font-bold text-slate-900">{title}</span>
      {point.example ? (
        <span className="text-violet-700"> ({point.example})</span>
      ) : null}
      {explanation ? (
        <p className="mt-0.5 pl-5 text-[12.5px] leading-relaxed text-slate-600">
          {explanation}
        </p>
      ) : null}
    </li>
  );
}

/** 한 쪽에 담긴 조각들을 문장별로 묶는다(테두리 + 그 쪽에 들어간 설명 범위). */
function groupUnits(units: AnalysisUnit[]): Array<{
  s: number;
  showHead: boolean;
  pointsFrom: number;
  pointsTo: number;
  /** 이 쪽에 문장 밑 주석을 찍는다 */
  showNotes: boolean;
  /** 이 쪽에는 주석만(설명은 앞 쪽에서 끝났다) */
  notesOnly: boolean;
}> {
  const out: Array<{ s: number; showHead: boolean; pointsFrom: number; pointsTo: number; showNotes: boolean; notesOnly: boolean }> = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (!last || last.s !== u.s) {
      out.push({
        s: u.s,
        showHead: u.kind === "head" || u.kind === "whole",
        pointsFrom: u.kind === "point" ? (u.p ?? 0) : 0,
        pointsTo: u.kind === "point" ? (u.p ?? 0) + 1 : u.kind === "whole" ? Number.MAX_SAFE_INTEGER : 0,
        showNotes: u.kind === "notes" || u.kind === "whole",
        notesOnly: u.kind === "notes",
      });
      continue;
    }
    if (u.kind === "point") last.pointsTo = (u.p ?? 0) + 1;
    if (u.kind === "notes") last.showNotes = true;
  }
  return out;
}

/** 쪽에 담는 조각. 표시 분석이 있는 문장은 테두리(head)와 설명 항목(point)으로 쪼갠다. */
type AnalysisUnit = {
  s: number;
  kind: "whole" | "head" | "point" | "notes";
  /** kind가 point일 때 설명 번호(0부터) */
  p?: number;
  /** 잰 높이(px) */
  h: number;
};

export type TranslationMode = "full" | "chunk";
const TRANSLATION_MODE_KEY = "analysis-report-translation-mode";

/*
 * 분석지 모양. 선생님이 시안 세 개(A 교재 세리프 · B 깔끔한 산세리프 · C 클래식 인쇄)를 모두
 * 마음에 들어 해서 고를 수 있게 했다. 예전 모양(빨간 둥근 테두리)은 선생님 요청으로 목록에서 뺐고,
 * 처음 여는 사람과 예전에 기본을 골라 둔 사람은 A로 본다.
 * 글꼴과 색만 바꾸고 표시(성분·괄호·이름표·번호 설명) 구성은 같다 — globals.css의 .ar-style-*.
 */
/** 쪽번호를 넣을지 (선생님이 자료마다 고른다) */
const PAGE_NUMBER_KEY = "analysis-report-page-numbers";
const NO_NOTES = new Map<number, SentenceNote[]>();

function SentenceBlock({
  sentence,
  index,
  accent,
  showHead,
  pointsFrom,
  pointsTo,
  translationMode,
  notes,
  showNotes = true,
}: {
  sentence: AnalysisSentence;
  index: number;
  accent: string;
  showHead?: boolean;
  pointsFrom?: number;
  pointsTo?: number;
  translationMode?: TranslationMode;
  notes?: SentenceNote[];
  showNotes?: boolean;
}) {
  const notesNode = notes?.length ? <SentenceNotes notes={notes} accent={accent} /> : undefined;
  const plainEn = sentence.enChunks.map((c) => c.text).join(" ").trim();
  // 새 분석서는 문장 표시 분석(성분·괄호·이름표·번호 설명·해석)을 그대로 찍는다.
  // 저장본을 다시 읽을 때도 같은 검사를 지나고, 원문이 바뀌었으면 표시를 버리고 옛 모양으로 돌아간다.
  const markup = readAnalysisMarkup(sentence.markup, plainEn);
  if (markup) {
    // 예전 분석서의 추가 설명(부연설명)도 그대로 싣는다 — 선생님 요청
    const extra =
      (sentence.contextNote ?? "").trim() || (sentence.easyUnderstanding ?? "").trim();
    return (
      <AnalysisMarkupSentence
        markup={markup}
        index={index}
        showHead={showHead}
        pointsFrom={pointsFrom}
        pointsTo={pointsTo}
        extraNote={extra || undefined}
        translationMode={translationMode}
        notes={notesNode}
        showNotes={showNotes}
      />
    );
  }

  const enText = joinChunks(sentence.enChunks.map((c) => c.text));
  const koText = joinChunks(sentence.koChunks);
  const contextNote =
    (sentence.contextNote ?? "").trim() ||
    (sentence.easyUnderstanding ?? "").trim();

  return (
    <section
      data-analysis-block={`s-${index}`}
      className="break-inside-avoid border-b border-slate-200 pb-5 pt-4 last:border-b-0"
    >
      <div className="mb-2 flex items-start gap-3">
        <span
          className="shrink-0 text-3xl font-black italic leading-none"
          style={{ color: accent }}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[13px] font-semibold leading-relaxed text-slate-800">
            {enText || "\u00a0"}
          </p>
          <p className="text-[13px] leading-relaxed text-slate-700">
            {koText || "\u00a0"}
          </p>
        </div>
      </div>

      {sentence.grammarPoints.length > 0 ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5 print:bg-sky-50">
          <p className="mb-1.5 text-[13px] font-bold text-sky-800">[문법 분석]</p>
          <ol className="space-y-2">
            {sentence.grammarPoints.map((g, gi) => (
              <GrammarPointItem key={gi} point={g} index={gi} />
            ))}
          </ol>
        </div>
      ) : null}

      {contextNote ? (
        <div
          className="analysis-context-note mt-2 rounded-r-md border-l-4 border-[#1e3a5f] bg-[#e8eef6] px-3.5 py-2.5 print:bg-[#e8eef6]"
          style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
        >
          <p className="text-[13px] leading-relaxed text-slate-800">
            {contextNote}
          </p>
        </div>
      ) : null}
      {notesNode && showNotes ? notesNode : null}
    </section>
  );
}

function A4Sheet({
  children,
  label,
  isLast,
  footerLogoSrc,
  screenHidden,
  printHidden,
}: {
  children: ReactNode;
  label: string;
  isLast?: boolean;
  footerLogoSrc?: string | null;
  /** 화면에서는 숨기고 인쇄에만 넣는다(고르지 않은 지문의 쪽). */
  screenHidden?: boolean;
  /** 인쇄에서 뺀다(분석서가 없는 지문). */
  printHidden?: boolean;
}) {
  const visibility = printHidden
    ? screenHidden
      ? "hidden"
      : "print:hidden"
    : screenHidden
      ? "hidden print:block"
      : "";
  return (
    <article
      className={`analysis-report-a4-sheet lesson-pack-a4-sheet relative box-border overflow-hidden bg-white shadow-xl print:shadow-none ${
        isLast ? "lesson-pack-a4-sheet--last" : ""
      } ${visibility}`}
      style={{
        width: A4_WIDTH,
        minHeight: A4_HEIGHT,
        height: A4_HEIGHT,
        padding: A4_PAD,
        paddingBottom: footerLogoSrc ? `${A4_FOOTER_MM}mm` : A4_PAD,
        boxSizing: "border-box",
      }}
    >
      {children}
      {footerLogoSrc ? (
        <div className="pointer-events-none absolute bottom-[6mm] left-[12mm] right-[12mm] flex items-center justify-center border-t border-slate-200 pt-2 print:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={footerLogoSrc}
            alt=""
            className="h-7 w-auto max-w-[32mm] object-contain opacity-90"
          />
        </div>
      ) : null}
      {/* 화면에서만 보이는 쪽 안내(2쪽짜리 지문의 1/2). 쪽번호를 켜면 숨긴다 — 두 번호가 겹쳐 보인다 */}
      <span className="sheet-preview-page-label pointer-events-none absolute bottom-2 right-3 text-[10px] text-slate-400 print:hidden">
        {label}
      </span>
    </article>
  );
}

function ReportHeader({
  headerLabel,
  source,
  title,
  titleEn,
  topicEn,
  topicKo,
  pageNo,
  accent,
}: {
  headerLabel: string;
  source?: string | null;
  title: string;
  /** 영어 제목·주제문(선생님 요청: 제목·주제가 영어로도 있으면 좋겠다) */
  titleEn?: string | null;
  topicEn?: string | null;
  topicKo?: string | null;
  pageNo: string;
  accent: string;
}) {
  return (
    <header className="ar-head mb-4" data-analysis-block="header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {source?.trim() ? (
            <p className="ar-head-source text-[11px] font-medium leading-snug text-slate-400">
              {source.trim()}
            </p>
          ) : null}
          <p
            className={`ar-head-label text-sm font-semibold ${source?.trim() ? "mt-1" : ""}`}
            style={{ color: accent }}
          >
            {headerLabel}
          </p>
          <h1 className="ar-head-title mt-1 text-[22px] font-black leading-snug text-slate-900">
            {title}
          </h1>
          {titleEn?.trim() ? (
            <p className="ar-head-title-en mt-0.5 text-[14px] font-bold leading-snug text-slate-600">{titleEn.trim()}</p>
          ) : null}
        </div>
        <div
          className="ar-head-no shrink-0 text-4xl font-black tabular-nums"
          style={{ color: accent }}
        >
          {pageNo}
        </div>
      </div>
      <div className="ar-head-rule mt-3 h-1 w-full" style={{ backgroundColor: accent }} />
      {topicEn?.trim() ? (
        <div className="ar-topic">
          <span className="ar-topic-key">Topic</span>
          <span className="ar-topic-en">{topicEn.trim()}</span>
          {topicKo?.trim() ? <span className="ar-topic-ko">{topicKo.trim()}</span> : null}
        </div>
      ) : null}
    </header>
  );
}

export function AnalysisReportWorkbench({
  role,
  projects: initialProjects,
  logoSrc = LOGO_SRC,
  regenerate = false,
  embedded = false,
  design,
}: {
  role: "admin" | "teacher";
  projects: AnalysisReportProjectInput[];
  logoSrc?: string;
  /** 제작 버튼으로 열었다: 이미 분석서가 있는 지문도 새로 만든다. */
  regenerate?: boolean;
  /** 최종통합자료 안에 쪽만 끼워 넣는다(모든 지문의 쪽을 보이고, 만들지 않는다). */
  embedded?: boolean;
  /** 최종통합자료가 고른 디자인(주면 이것을 쓴다) */
  design?: MaterialDesign;
}) {
  const base =
    role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  /** 이 분석서 파일(자료함). 새로 만들면 만든 뒤에 알게 된다. */
  const docIdRef = useRef<string | null>(null);
  /** PDF 저장 이름은 자료 이름으로(선생님 2026-11-06) */
  const docName = useDocumentName(role);
  useEffect(() => {
    docIdRef.current = new URLSearchParams(window.location.search).get("doc");
  }, []);
  useCreateDocumentFromUrl(
    role,
    "analysis_report",
    initialProjects.map((p) => p.id),
    (id) => {
      docIdRef.current = id;
    }
  );
  /** 새로 만들기는 첫 생성 한 번에만 적용한다(이후 다시 시도는 빠진 지문만). */
  const regenerateOnce = useRef(regenerate);
  const [projects, setProjects] = useState(initialProjects);
  const [active, setActive] = useState(0);
  /** PDF로 바로 저장(인쇄 창 없이) — 인쇄처럼 모든 지문의 분석서를 담는다 */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다
  /*
   * 분석지 직접 고치기(선생님 2026-10-22 시안 승인). 켜면 성분·이름표·해석·번호 설명을 눌러 고친다.
   * 켜 둔 동안에는 PDF를 미리 만들지 않는다(고치기 표시가 PDF에 찍히지 않게).
   */
  const [editMode, setEditMode] = useState(false);
  const [editTarget, setEditTarget] = useState<MarkupEditTarget | null>(null);
  const [reportFor, setReportFor] = useState<number | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  // 최종통합자료 안(embedded)에서는 통합자료가 한 번에 만든다 — 여기서도 돌면 가려진 채로 빈 PDF를 만들어 서버 일만 늘었다(2026-11-10)
  usePdfPrefetch("analysis-report-print-root", ".analysis-report-a4-sheet", { enabled: !editMode && !embedded });
  /*
   * 해석 방식. 선생님 요청: 전체 해석과 직독직해 중 고를 수 있게. 고른 값은 이 브라우저에 기억한다.
   * 직독직해 조각이 없는 예전 분석서는 전체 해석으로 나간다.
   */
  const [translationMode, setTranslationMode] = useState<TranslationMode>("full");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TRANSLATION_MODE_KEY);
      if (saved === "chunk" || saved === "full") setTranslationMode(saved);
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
  }, []);
  const chooseTranslationMode = (mode: TranslationMode) => {
    setTranslationMode(mode);
    try {
      window.localStorage.setItem(TRANSLATION_MODE_KEY, mode);
    } catch {
      /* 무시 */
    }
  };
  /** 디자인 — 모든 자료가 하나를 같이 쓴다(material-design.ts). 통합자료는 design으로 준다. */
  const [md, chooseMd] = useMaterialDesign(design);
  const designStyle = ANALYSIS_BASE_STYLE[md] as AnalysisDesignStyle;
  /** 쪽번호 — 인쇄물 오른쪽 아래에 1부터 찍는다. 최종통합자료에 끼울 때는 통합자료가 센다. */
  /**
   * 문장 밑 주석(지칭·함축의미) — 테스트 교재 분석 자료와 같은 것을 지문 분석서에도(선생님 2026-10-21).
   * 1장 자료 재료가 있는 지문은 늘 넣는다(켜고 끄는 칸은 선생님 말씀으로 뺐다).
   */
  const sentenceNotesOn = true;
  const notesCache = useMemo(() => new Map<string, Map<number, SentenceNote[]>>(), [projects, sentenceNotesOn]);
  const notesFor = (p: AnalysisReportProjectInput, sentences: AnalysisReportData["sentences"]) => {
    if (!sentenceNotesOn || !p.onePageContent) return NO_NOTES;
    let m = notesCache.get(p.id);
    if (!m) {
      m = sentenceNotesFor(sentences.map((s) => s.enChunks.map((c) => c.text).join(" ").trim()), p.onePageContent);
      notesCache.set(p.id, m);
    }
    return m;
  };
  const [pageNumbers, setPageNumbers] = useState(false);
  useEffect(() => {
    try {
      setPageNumbers(window.localStorage.getItem(PAGE_NUMBER_KEY) === "on");
    } catch {
      /* 저장소를 못 쓰면 끈 채로 */
    }
  }, []);
  const choosePageNumbers = (on: boolean) => {
    setPageNumbers(on);
    try {
      window.localStorage.setItem(PAGE_NUMBER_KEY, on ? "on" : "off");
    } catch {
      /* 무시 */
    }
  };
  useEffect(
    () => watchPageNumbersById("analysis-report-print-root", pageNumbers && !embedded),
    [pageNumbers, embedded]
  );

  /*
   * 모양을 바꾸면 글꼴이 늦게 들어와 글자 폭이 달라진다. 쪽 나눔은 잰 높이로 하므로
   * 글꼴이 다 들어온 뒤 한 번 더 잰다(안 그러면 쪽이 넘쳐 한 줄이 새어 나간다).
   */
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (designStyle === "base" || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && !isPrinting() && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [designStyle]);
  /** 상단 라벨 — 모든 지문에 같게(선생님 2026-10-21: 하나 정하면 다음 지문도 같게) */
  const [headerLabel, setHeaderLabel] = useState(
    () => initialProjects[0]?.headerLabel || "26년도 1학기 중간고사 대비"
  );
  /*
   * 상단 라벨을 고치면 자료함의 이 분석서 파일 이름도 같게(선생님 2026-10-21). 입력이 잠깐 멈춘 뒤 바꾼다.
   * 처음 열 때(고치지 않았을 때)는 이름을 건드리지 않는다.
   */
  const labelEdited = useRef(false);
  /** 파일 이름을 상단 라벨로 — 닫기(저장)는 기다리지 않고 바로 부른다 */
  const renameToLabel = useCallback(
    async (label: string) => {
      const id = docIdRef.current;
      const name = label.trim();
      if (embedded || !labelEdited.current || !id || !name) return;
      await postJson("/api/lesson-materials/documents/open", { op: "rename", role, id, name })
        .then(() => window.dispatchEvent(new CustomEvent(DOCUMENT_NAME_EVENT, { detail: { id, name } })))
        .catch(() => {});
    },
    [embedded, role]
  );
  useEffect(() => {
    const t = setTimeout(() => void renameToLabel(headerLabel), 800);
    return () => clearTimeout(t);
  }, [headerLabel, renameToLabel]);
  const [accent] = useState("#DC2626");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  /** 문장 하나만 다시 만들기: 고른 문장(itemId)과 만드는 중인지 */
  const [regenItemId, setRegenItemId] = useState("");
  const [regenSentenceBusy, setRegenSentenceBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prepLoading, setPrepLoading] = useState(
    () => !embedded && (regenerate || initialProjects.some((p) => !p.report?.sentences?.length))
  );
  const [zoom, setZoom] = useState(85);
  const scaled = useScaledHeight<HTMLDivElement>(zoom / 100);
  const [pageChunksById, setPageChunksById] = useState<Record<string, AnalysisUnit[][]>>({});
  const measureRef = useRef<HTMLDivElement>(null);
  /*
   * 분석지 쪽과 재기용 사본은 서버에서 그리지 않는다(2026-10-29 속도: 서버가 둘 다 그려 보내 HTML 423KB,
   * 브라우저는 받아 맞춘 뒤 어차피 다시 재고 나눴다). 브라우저에서 처음 그릴 때 재고 나눈다.
   */
  const [sheetsOn, setSheetsOn] = useState(false);
  useEffect(() => setSheetsOn(true), []);
  /** 아직 만드는 중인 지문. 보고 있는 지문이 먼저 끝나면 나머지를 기다리지 않고 화면을 연다. */
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [prepTotal, setPrepTotal] = useState(0);
  const activeIdRef = useRef<string | undefined>(initialProjects[0]?.id);
  activeIdRef.current = projects[active]?.id;

  const project = projects[active];
  const report = project?.report;
  const editedCount = report?.sentences?.filter((s) => s.teacherEdited).length ?? 0;

  function onSheetClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || embedded || !report) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-edit]");
    if (!el) return;
    const blk = el.closest<HTMLElement>("[data-analysis-block]");
    const s = Number(blk?.dataset.analysisBlock?.replace(/^s-/, ""));
    if (!Number.isFinite(s) || !report.sentences[s]) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    setEditTarget({
      kind: el.dataset.edit as MarkupEditTarget["kind"],
      s,
      i: Number(el.dataset.i ?? -1),
      x: r.left,
      y: r.bottom,
    });
  }

  async function applyEdit(s: number, edit: MarkupEdit) {
    if (!project?.report) return;
    const cur = project.report.sentences[s];
    const next = cur ? applyMarkupEdit(cur, edit) : null;
    setEditTarget(null);
    if (!next) {
      setEditNotice("이 자리는 고칠 수 없습니다.");
      return;
    }
    const nextReport: AnalysisReportData = {
      ...project.report,
      headerLabel,
      sentences: project.report.sentences.map((x, k) => (k === s ? next : x)),
    };
    setProjects((prev) => prev.map((row, idx) => (idx === active ? { ...row, report: nextReport } : row)));
    setEditNotice("저장하는 중…");
    const res = await saveAnalysisReportAction(role, { projectId: project.id, report: nextReport }).catch(() => ({
      ok: false as const,
      message: "저장하지 못했습니다. 잠시 뒤 다시 고쳐 주세요.",
    }));
    setEditNotice(res.ok ? (edit.kind === "reset" ? `${s + 1}번 문장을 원래대로 되돌렸습니다` : `${s + 1}번 문장을 고쳐 저장했습니다`) : res.message);
  }

  useEffect(() => {
    const id = "analysis-report-print-page-size-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
    }
    el.textContent = `
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  @page app-print-a4 { size: 210mm 297mm; margin: 0; }
  #analysis-report-print-root { transform: none !important; gap: 0 !important; }
}
`;
    document.body.appendChild(el);
    return () => {
      el?.remove();
    };
  }, []);

  useEffect(() => {
    // 최종통합자료에 끼워 넣을 때는 저장된 분석서만 보여 준다.
    if (embedded) return;
    let cancelled = false;
    const regenerateAll = regenerateOnce.current;
    const pending = projects
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => regenerateAll || !p.report?.sentences?.length);
    if (pending.length === 0) {
      setPrepLoading(false);
      return;
    }

    setPrepLoading(true);
    setGenerating(true);
    setPrepTotal(pending.length);
    setPendingIds(new Set(pending.map(({ p }) => p.id)));
    (async () => {
      // 지문끼리는 독립이라 함께 만든다. 서버 액션은 브라우저에서 한 번에 하나씩만
      // 돌기 때문에 API 라우트로 보낸다(post-json.ts).
      const failures = await runWithConcurrency(
        pending,
        ANALYSIS_REPORT_CONCURRENCY,
        async ({ p, i }) => {
          if (cancelled) return null;
          const done = () => {
            if (cancelled) return;
            setPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(p.id);
              return next;
            });
            // 보고 있는 지문이 끝나면 로딩 화면을 내린다. 나머지는 뒤에서 이어서 채운다.
            if (p.id === activeIdRef.current) setPrepLoading(false);
          };
          const res = await postJson<
            Awaited<ReturnType<typeof generateAndSaveAnalysisReportAction>>
          >("/api/lesson-materials/analysis-report", {
            role,
            projectId: p.id,
            headerLabel,
            // 원문이 그대로인 분석서는 다시 만들지 않는다(비용 절감). 지문별 "다시 만들기"는 강제로 만든다.
            onlyIfChanged: true,
          });
          if (!res.ok) {
            done();
            return `${String(i + 1).padStart(2, "0")}: ${res.message}`;
          }
          if (cancelled) return null;
          setProjects((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? {
                    ...row,
                    report: res.report,
                    headerLabel: res.report.headerLabel || row.headerLabel,
                  }
                : row
            )
          );
          done();
          return null;
        }
      );
      const failed = failures.filter((row): row is string => row !== null);
      if (!cancelled && failed.length > 0) {
        setError(`분석서 ${failed.length}개를 만들지 못했습니다. ${failed.join(" / ")}`);
      }
      // 실패해도 로딩 화면을 내린다. 오류 문구는 본 화면에만 있어서, 로딩을
      // 유지하면 스피너만 도는 채로 무엇이 잘못됐는지 보이지 않는다.
      if (!cancelled) {
        setPrepLoading(false);
        setPendingIds(new Set());
        regenerateOnce.current = false;
      }
      setGenerating(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).join(",")]);

  // Pack sentences onto A4 pages (header only on first page).
  // 인쇄는 선택한 지문 전부를 내보내므로 모든 지문을 배치한다. 화면에는 고른 지문만 보인다.
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    /*
     * 인쇄하는 동안에는 다시 재지 않는다(선생님 2026-11-09 「바로 인쇄 누르면 여백이 많이 생긴다」): 인쇄용 글꼴이
     * 들어오며 글꼴 신호가 다시 와서 인쇄 화면 크기로 잰 높이로 쪽을 다시 나눴다 — 18쪽이 52쪽(쪽마다 두세 문장)이 됐다.
     */
    if (typeof window !== "undefined" && window.matchMedia?.("print").matches) return;
    const widthPx = root.offsetWidth || 1;
    const pxPerMm = widthPx / 210;
    /*
     * 담을 수 있는 높이. 인쇄에서는 아래 여백이 15mm다. 재는 값과 실제로 찍히는
     * 높이가 조금 달라서(쪽이 넘치면 한 줄이 새어 나가 거의 빈 쪽이 생긴다)
     * 6mm를 여유로 뺀다.
     */
    /*
     * 담을 수 있는 높이. 재는 높이와 실제로 찍히는 높이가 7mm 남짓 달라서
     * (이어 붙는 설명 묶음이 여백을 한 번 더 쓴다) 그만큼 여유를 두고 잰다.
     * 여유를 줄이면 쪽이 넘쳐 한 줄이 새고 거의 빈 쪽이 생긴다 — 실제로 확인했다.
     */
    // 모양 A·B·C는 글꼴이 달라 잰 높이와 찍히는 높이가 조금 더 벌어진다. 마지막 줄이 로고에
    // 겹쳐 나온 일이 있어(선생님 지적 2026-09-18) 여유를 7mm에서 11mm로 넓혔다.
    const bodyMm = 297 - A4_PAD_MM - PRINT_FOOTER_MM - 11;
    const pageBodyPx = bodyMm * pxPerMm;
    // 쪽에 찍을 때 묶음 사이 여백(space-y-1). 넉넉히 잡으면 묶음 하나가 통째로 밀린다.
    const gapPx = 4;

    const next: Record<string, AnalysisUnit[][]> = {};
    for (const p of projects) {
      const count = p.report?.sentences?.length ?? 0;
      const box = root.querySelector(
        `[data-measure-project="${p.id}"]`
      ) as HTMLElement | null;
      if (!box || count === 0) {
        next[p.id] = [
          Array.from({ length: count }, (_, i) => ({ s: i, kind: "whole" as const, h: 0 })),
        ];
        continue;
      }

      const headerEl = box.querySelector(
        '[data-analysis-block="header"]'
      ) as HTMLElement | null;
      const headerH = headerEl?.offsetHeight ?? 0;

      /*
       * 문장 묶음을 통째로 붙여 두면 쪽 아래가 크게 비었다(설명이 긴 문장 하나가
       * 통째로 다음 쪽으로 넘어가서). 그래서 테두리 문장+해석을 한 조각으로,
       * 번호 설명을 항목마다 한 조각으로 쪼개 담는다. 실물 분석지도 설명은
       * 다음 쪽으로 이어진다. 옛 형식(표시 분석이 없는 분석서)은 예전처럼
       * 문장 하나가 한 조각이다.
       */
      const units: AnalysisUnit[] = [];
      for (let i = 0; i < count; i++) {
        const blockEl = box.querySelector(
          `[data-analysis-block="s-${i}"]`
        ) as HTMLElement | null;
        const blockH = blockEl?.offsetHeight ?? 120;
        const head = box.querySelector(
          `[data-analysis-part="s-${i}-head"]`
        ) as HTMLElement | null;
        if (!head) {
          units.push({ s: i, kind: "whole", h: blockH });
          continue;
        }
        const points: AnalysisUnit[] = [];
        for (let j = 0; ; j++) {
          const pt = box.querySelector(
            `[data-analysis-part="s-${i}-p-${j}"]`
          ) as HTMLElement | null;
          if (!pt) break;
          points.push({ s: i, kind: "point", p: j, h: pt.offsetHeight });
        }
        // 조각 높이를 더해도 묶음 높이에 모자란다(묶음 여백, 설명 목록 위 여백).
        // 그 차이를 첫 조각에 얹어야 쪽이 넘치지 않는다. 넘치면 인쇄에서 한 줄이
        // 다음 쪽으로 새어 나가 거의 빈 쪽이 생겼다.
        // 문장 밑 주석(지칭·함축·바꿔 말하기)은 설명 뒤 따로 한 조각 — 넘기면 다음 쪽에 주석만 간다
        const notesEl = box.querySelector(`[data-analysis-part="s-${i}-notes"]`) as HTMLElement | null;
        const notesH = notesEl?.offsetHeight ?? 0;
        const partsSum = head.offsetHeight + points.reduce((a, u) => a + u.h, 0) + notesH;
        const extra = Math.max(0, blockH - partsSum);
        units.push({ s: i, kind: "head", h: head.offsetHeight + extra });
        units.push(...points);
        if (notesH) units.push({ s: i, kind: "notes", h: notesH });
      }

      /*
       * 설명이 다음 쪽으로 이어지면 그 쪽에도 묶음 여백과 설명 목록 위 여백이
       * 한 번 더 붙는다. 이 몫을 빼먹어서 쪽이 2mm쯤 넘쳤고, 인쇄에서 한 줄이
       * 다음 쪽으로 새어 거의 빈 쪽이 생겼다.
       */
      const sampleBlock = box.querySelector(".ar-block") as HTMLElement | null;
      const samplePoints = box.querySelector(".ar-points") as HTMLElement | null;
      const contOverhead =
        sampleBlock && samplePoints
          ? parseFloat(getComputedStyle(sampleBlock).paddingBottom || "0") +
            parseFloat(getComputedStyle(samplePoints).marginTop || "0")
          : 24;

      const pages: AnalysisUnit[][] = [];
      let current: AnalysisUnit[] = [];
      let used = 0;

      for (const u of units) {
        // 문장이 바뀔 때만 문장 사이 간격이 붙는다
        const prev = current[current.length - 1];
        const gap = current.length === 0 ? 0 : prev && prev.s === u.s ? 0 : gapPx;
        const headerPad = pages.length === 0 && current.length === 0 ? headerH + gapPx : 0;
        if (current.length > 0 && used + gap + u.h > pageBodyPx) {
          pages.push(current);
          current = [];
          // 이어지는 설명으로 쪽을 시작하면 묶음 여백이 한 번 더 붙는다
          used = u.kind === "point" ? contOverhead + u.h : u.h;
          current.push(u);
          continue;
        }
        used += headerPad + gap + u.h;
        current.push(u);
      }
      if (current.length) pages.push(current);
      next[p.id] = pages.length ? pages : [[]];
    }
    setPageChunksById(next);
  }, [projects, headerLabel, active, translationMode, designStyle, fontsTick, sentenceNotesOn, sheetsOn]);

  /** 지문 하나의 쪽 배치. 배치 effect가 돌기 전 렌더에서는 없는 문장 번호를 뺀다. */
  function pagesFor(projectId: string, count: number): AnalysisUnit[][] {
    const live = (pageChunksById[projectId] ?? [])
      .map((c) => c.filter((u) => u.s < count))
      .filter((c) => c.length > 0);
    return live.length > 0
      ? live
      : [Array.from({ length: count }, (_, i) => ({ s: i, kind: "whole" as const, h: 0 }))];
  }

  /** 지문별 상단 라벨. 고른 지문은 편집 중인 값을 쓴다. */

  async function handleRegen() {
    if (!project) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateAndSaveAnalysisReportAction(role, {
        projectId: project.id,
        headerLabel,
      }).catch((e: unknown) => ({
        ok: false as const,
        message: e instanceof Error ? e.message : "분석서를 다시 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      }));
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setProjects((prev) =>
        prev.map((row, idx) =>
          idx === active
            ? {
                ...row,
                report: res.report,
                headerLabel: res.report.headerLabel || headerLabel,
              }
            : row
        )
      );
    } finally {
      setGenerating(false);
    }
  }

  /**
   * 문장 하나만 다시 만든다. 선생님 말씀(2026-10-21): 지문 전체를 다시 만들면 맞던 문장까지 바뀌어
   * 다른 오류가 또 생긴다. 고친 문장만 바꾸고 값도 문장마다 받는다(값을 먼저 묻는다).
   */
  async function handleRegenSentence() {
    if (!project?.report || !regenItemId || regenSentenceBusy) return;
    const no = project.report.sentences.findIndex((s) => s.itemId === regenItemId) + 1;
    const go = await askCreditConfirm({
      title: "문장 하나만 다시 만들기",
      description: "고른 문장의 문법 표시(성분·괄호·이름표·번호 설명)와 해석·부연을 새로 만듭니다. 다른 문장은 그대로 둡니다.",
      subject: `${no}번 문장`,
      contents: ["문장 표시 분석"],
      items: [{ feature: "lesson_analysis_sentence", quantity: 1 }],
    });
    if (!go) return;
    setRegenSentenceBusy(true);
    setError(null);
    try {
      const res = await regenerateAnalysisSentenceAction(role, { projectId: project.id, itemId: regenItemId }).catch(
        (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : "문장을 다시 만들지 못했습니다." })
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setProjects((prev) => prev.map((row, idx) => (idx === active ? { ...row, report: res.report } : row)));
    } finally {
      setRegenSentenceBusy(false);
    }
  }

  async function handleSave(): Promise<boolean> {
    if (!project?.report) return false;
    setSaving(true);
    setError(null);
    try {
      const next: AnalysisReportData = {
        ...project.report,
        headerLabel,
      };
      const res = await saveAnalysisReportAction(role, {
        projectId: project.id,
        report: next,
      });
      if (!res.ok) {
        setError(res.message);
        return false;
      }
      // 라벨은 모든 지문에 같게 — 라벨이 다른 다른 지문 분석서도 같은 라벨로 저장한다
      const others = projects.filter((row, idx) => idx !== active && row.report && row.report.headerLabel !== headerLabel);
      for (const row of others) {
        await saveAnalysisReportAction(role, { projectId: row.id, report: { ...row.report!, headerLabel } });
      }
      setProjects((prev) =>
        prev.map((row, idx) =>
          idx === active
            ? { ...row, report: next, headerLabel }
            : row.report
              ? { ...row, report: { ...row.report, headerLabel }, headerLabel }
              : { ...row, headerLabel }
        )
      );
      return true;
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * 닫기(저장): 분석서(상단 라벨 포함)를 저장하고, 파일 이름도 라벨로 바로 바꾼다. 만드는 중이면 서버가
   * 다 만든 뒤 스스로 저장한다. 저장이 실패하면 false — 닫지 않는다.
   */
  async function saveForClose(): Promise<boolean> {
    if (!generating && project?.report) {
      const ok = await handleSave();
      if (!ok) return false;
    }
    await renameToLabel(headerLabel);
    return true;
  }

  const previewStyle = useMemo(
    (): CSSProperties => ({
      transform: `scale(${zoom / 100})`,
      transformOrigin: "top center",
    }),
    [zoom]
  );

  if (!project) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Alert variant="error">선택된 자료가 없습니다.</Alert>
      </div>
    );
  }

  if (prepLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-slate-100">
        <div className="rounded-2xl bg-white px-8 py-6 text-center shadow">
          <p className="text-sm font-semibold text-slate-800">
            분석서를 만들고 있습니다…
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {prepTotal > 1
              ? `지문 ${prepTotal}개 중 ${prepTotal - pendingIds.size}개 완료 · 첫 지문이 끝나면 바로 보여 드립니다`
              : "문장 단위로 정리 중"}
          </p>
        </div>
      </div>
    );
  }

  /**
   * 인쇄할 쪽 전부. 선택한 지문을 순서대로 모두 넣고, 화면에는 고른 지문의 쪽만
   * 보인다(나머지는 print 때만 나타난다). 쪽을 지문별 묶음 없이 한 줄로 두는 이유:
   * 인쇄 CSS가 :last-child 쪽의 쪽 나눔을 끄므로, 묶으면 다음 지문이 앞 지문의 마지막
   * 쪽에 이어 붙는다. 분석서가 없는 지문(생성 실패)은 고른 지문일 때만 화면에 둔다.
   */
  const sheets = projects.flatMap((p, pi) => {
    const pSentences = p.report?.sentences ?? NO_SENTENCES;
    if (pSentences.length === 0 && pi !== active) return [];
    const pPages = pagesFor(p.id, pSentences.length);
    return pPages.map((chunk, pageI) => ({
      key: `${p.id}-${pageI}`,
      project: p,
      projectIndex: pi,
      sentences: pSentences,
      chunk,
      pageI,
      pageCount: pPages.length,
      screen: embedded || pi === active,
      printable: pSentences.length > 0,
    }));
  });
  const lastPrintable = sheets.map((s) => s.printable).lastIndexOf(true);

  /** 인쇄할 쪽들. 최종통합자료에 끼워 넣을 때(embedded)도 같은 모양을 쓴다. */
  const sheetPages = (
    <>
              {sheets.map((sheet, si) => (
                <A4Sheet
                  key={sheet.key}
                  label={`${sheet.pageI + 1} / ${sheet.pageCount}`}
                  isLast={si === lastPrintable}
                  footerLogoSrc={logoSrc}
                  screenHidden={!sheet.screen}
                  printHidden={!sheet.printable}
                >
                  {sheet.pageI === 0 ? (
                    <ReportHeader
                      headerLabel={headerLabel}
                      source={sheet.project.source}
                      title={sheet.project.title}
                      titleEn={sheet.project.titleEn || sheet.project.report?.titleEn}
                      topicEn={sheet.project.report?.topicEn}
                      topicKo={sheet.project.report?.topicKo}
                      pageNo={String(sheet.projectIndex + 1).padStart(2, "0")}
                      accent={accent}
                    />
                  ) : null}
                  <div className="space-y-1">
                    {groupUnits(sheet.chunk).map((g) => {
                      const notes = notesFor(sheet.project, sheet.sentences).get(g.s);
                      return g.notesOnly ? (
                        notes?.length ? (
                          <SentenceNotes key={`${sheet.sentences[g.s]?.itemId || g.s}-notes`} notes={notes} accent={accent} />
                        ) : null
                      ) : (
                        <SentenceBlock
                          key={`${sheet.sentences[g.s]?.itemId || g.s}-${g.pointsFrom}`}
                          sentence={sheet.sentences[g.s]!}
                          index={g.s}
                          accent={accent}
                          showHead={g.showHead}
                          pointsFrom={g.pointsFrom}
                          pointsTo={g.pointsTo}
                          translationMode={translationMode}
                          notes={notes}
                          showNotes={g.showNotes}
                        />
                      );
                    })}
                  </div>
                  {sheet.pageI === sheet.pageCount - 1 && sheet.project.report?.noPointMessage ? (
                    <p className="mt-5 break-inside-avoid rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
                      {sheet.project.report.noPointMessage}
                    </p>
                  ) : null}
                </A4Sheet>
              ))}

              {logoSrc && !embedded ? (
                <div className="lesson-pack-print-logo-fixed hidden print:flex">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoSrc}
                    alt=""
                    className="h-7 w-auto max-w-[32mm] object-contain opacity-90"
                  />
                </div>
              ) : null}
    </>
  );
  const measureTree = (
    <>
          {/* Off-screen measure sheet. 높이 0인 틀 안에 둬서 스크롤 길이에 잡히지 않게 한다. */}
          <div className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden print:hidden" aria-hidden>
          <div
            ref={measureRef}
            className={`font-print -z-10 w-[210mm] opacity-0 ${designClass(designStyle)} ${materialDesignClass(md)}`}
            style={{ padding: A4_PAD }}
          >
            {projects.map((p, pi) => (
              <div key={`m-${p.id}`} data-measure-project={p.id}>
                <ReportHeader
                  headerLabel={headerLabel}
                  source={p.source}
                  title={p.title}
                  titleEn={p.titleEn || p.report?.titleEn}
                  topicEn={p.report?.topicEn}
                  topicKo={p.report?.topicKo}
                  pageNo={String(pi + 1).padStart(2, "0")}
                  accent={accent}
                />
                {(p.report?.sentences ?? NO_SENTENCES).map((s, i) => (
                  <SentenceBlock
                    key={`m-${s.itemId || i}`}
                    sentence={s}
                    index={i}
                    accent={accent}
                    translationMode={translationMode}
                    notes={notesFor(p, p.report?.sentences ?? NO_SENTENCES).get(i)}
                  />
                ))}
              </div>
            ))}
          </div>
          </div>
    </>
  );

  if (embedded) {
    return (
      <div className="relative">
        {designStyle !== "base" ? <link rel="stylesheet" href={DESIGN_FONTS_HREF} /> : null}
        <div id="analysis-report-print-root" className={`flex flex-col gap-6 print:gap-0 ${designClass(designStyle)} ${materialDesignClass(md)}`}>
          {sheetsOn ? sheetPages : null}
        </div>
        {sheetsOn ? measureTree : null}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <CloseSaveButton base={base} save={saveForClose} className="text-left text-xs font-semibold text-violet-700" />
          <h1 className="flex min-w-0 text-base font-bold text-slate-900">
            <DocumentTitle role={role} fallback="분석서" />
          </h1>
          {projects.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {projects.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    i === active
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  } ${pendingIds.has(p.id) ? "animate-pulse opacity-60" : ""}`}
                  title={pendingIds.has(p.id) ? "만드는 중" : undefined}
                >
                  {String(i + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-slate-500">상단 라벨</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={headerLabel}
              onChange={(e) => {
                labelEdited.current = true;
                setHeaderLabel(e.target.value);
              }}
            />
            <span className="block text-[10.5px] text-slate-400">자료함의 파일 이름도 이 라벨로 바뀝니다.</span>
          </label>

          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-500">해석 방식</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              {(["full", "chunk"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => chooseTranslationMode(mode)}
                  className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${
                    translationMode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {mode === "full" ? "전체 해석" : "직독직해"}
                </button>
              ))}
            </div>
          </div>

          <MaterialDesignPicker value={md} onChange={chooseMd} />

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-[11px] font-bold text-slate-500">쪽번호 넣기</span>
            <input
              type="checkbox"
              checked={pageNumbers}
              onChange={(e) => choosePageNumbers(e.target.checked)}
              className="h-4 w-4 accent-violet-500"
            />
          </label>
          {designStyle !== "base" ? <link rel="stylesheet" href={DESIGN_FONTS_HREF} /> : null}

          <p className="text-xs text-slate-500">{project.title}</p>
          {project.source?.trim() ? (
            <p className="text-[11px] text-slate-400">{project.source}</p>
          ) : null}
          {error ? <Alert variant="error">{error}</Alert> : null}
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4">
          {!embedded && report?.sentences?.length ? (
            <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              <p className="text-[11px] font-bold text-slate-500">직접 고치기</p>
              <Button
                type="button"
                size="sm"
                variant={editMode ? "primary" : "secondary"}
                className="w-full"
                disabled={generating}
                onClick={() => {
                  setEditMode((v) => !v);
                  setEditTarget(null);
                }}
              >
                {editMode ? "다 고쳤어요" : "분석지 고치기"}
              </Button>
              <p className="text-[11px] leading-snug text-slate-400">
                {editMode
                  ? "분석지에서 성분·이름표·해석·번호 설명을 누르면 고칠 수 있습니다. 문장 번호를 누르면 오류 신고·원래대로가 있습니다. 고친 문장은 지문 전체를 다시 만들어도 그대로 둡니다."
                  : "틀린 곳을 직접 고치거나 오류를 알려 주세요(크레딧 없음)."}
              </p>
              {editedCount ? (
                <p className="text-[11px] font-semibold text-amber-700">선생님이 고친 문장 {editedCount}개</p>
              ) : null}
              {editNotice ? <p className="text-[11px] font-semibold text-slate-600">{editNotice}</p> : null}
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={generating || saving}
            onClick={() => void handleRegen()}
          >
            {generating ? "생성 중…" : "분석서 다시 만들기"}
          </Button>
          {report?.sentences?.length ? (
            <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              <p className="text-[11px] font-bold text-slate-500">문장 하나만 다시 만들기</p>
              <select
                value={regenItemId}
                onChange={(e) => setRegenItemId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
              >
                <option value="">고칠 문장을 고르세요</option>
                {report.sentences.map((s, i) => {
                  const text = s.enChunks.map((c) => c.text).join(" ");
                  return (
                    <option key={s.itemId} value={s.itemId}>
                      {i + 1}. {text.length > 46 ? `${text.slice(0, 46)}…` : text}
                    </option>
                  );
                })}
              </select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={!regenItemId || regenSentenceBusy || generating || saving}
                onClick={() => void handleRegenSentence()}
              >
                {regenSentenceBusy ? "그 문장을 다시 만드는 중…" : "이 문장만 다시 만들기"}
              </Button>
              <p className="text-[11px] leading-snug text-slate-400">
                다른 문장은 그대로 두고 고른 문장의 문법 표시·해석만 새로 만듭니다.
              </p>
            </div>
          ) : null}
          <CloseSaveButton
            base={base}
            save={saveForClose}
            label="닫기(저장)"
            disabled={generating || saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={generating}
            onClick={() => window.print()}
          >
            {generating && pendingIds.size > 0
              ? `나머지 지문 만드는 중 (${prepTotal - pendingIds.size}/${prepTotal})`
              : "인쇄"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={generating || !!pdf.busy}
            onClick={async () => {
              // 고치기 표시가 PDF에 찍히지 않게 먼저 끈다
              if (editMode) {
                setEditMode(false);
                setEditTarget(null);
                await new Promise((r) => setTimeout(r, 80));
              }
              void pdf.save(
                "분석서",
                collectPrintPages(document.getElementById("analysis-report-print-root"), ".analysis-report-a4-sheet"),
                [docName ?? (projects.length > 1 ? `${projects[0]?.title ?? ""} 외 ${projects.length - 1}개` : projects[0]?.title)]
              );
            }}
          >
            PDF로 저장
          </Button>
          {pdf.status ? (
            <p className={`text-[11px] font-semibold ${pdf.busy ? "text-violet-700" : "text-rose-600"}`}>{pdf.status}</p>
          ) : null}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom(100)}
          >
            100%
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom((z) => Math.max(40, z - 10))}
          >
            −
          </button>
          <span className="text-xs font-semibold text-slate-600">{zoom}%</span>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
            onClick={() => setZoom((z) => Math.min(120, z + 10))}
          >
            +
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 p-6 print:block print:p-0">
          {project && pendingIds.has(project.id) ? (
            <p className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm print:hidden">
              이 지문의 분석서를 만들고 있습니다… 끝나면 자동으로 채워집니다.
            </p>
          ) : null}
          <div style={scaled.frameStyle} className="print:!h-auto print:!overflow-visible">
          <div
            ref={scaled.ref}
            id="analysis-report-print-root"
            className={`flex origin-top flex-col gap-6 print:gap-0 print:!transform-none ${designClass(designStyle)} ${materialDesignClass(md)}${editMode ? " ar-edit-mode" : ""}`}
            style={previewStyle}
            onClickCapture={onSheetClick}
          >
            {sheetsOn ? sheetPages : null}
          </div>
          </div>
        </div>

        {sheetsOn ? measureTree : null}
        {editTarget && report?.sentences[editTarget.s] ? (
          <AnalysisMarkupEditPopover
            key={`${editTarget.s}-${editTarget.kind}-${editTarget.i}`}
            target={editTarget}
            sentence={report.sentences[editTarget.s]!}
            onApply={(edit) => void applyEdit(editTarget.s, edit)}
            onReport={() => {
              setReportFor(editTarget.s);
              setEditTarget(null);
            }}
            onClose={() => setEditTarget(null)}
          />
        ) : null}
        {reportFor !== null && project && report?.sentences[reportFor] ? (
          <AnalysisErrorReportDialog
            sentenceNo={reportFor + 1}
            sentenceText={plainSentenceText(report.sentences[reportFor]!)}
            onClose={() => setReportFor(null)}
            onSend={async (categories, memo) => {
              const res = await reportAnalysisErrorAction(role, {
                projectId: project.id,
                sentenceIndex: reportFor,
                itemId: report.sentences[reportFor]!.itemId,
                sentenceText: plainSentenceText(report.sentences[reportFor]!),
                categories,
                memo,
              }).catch(() => ({ ok: false as const, message: "신고를 보내지 못했습니다. 잠시 뒤 다시 눌러 주세요." }));
              if (!res.ok) return res.message;
              setEditNotice(`${reportFor + 1}번 문장 오류 신고를 보냈습니다. 확인하고 고쳐 드리겠습니다.`);
              return null;
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
