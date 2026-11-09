"use client";

import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { isPrinting } from "@/lib/print/is-printing";
import { PASSAGE_PREP_CONCURRENCY } from "@/lib/lesson-materials/test-book";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LessonBookWorkbench } from "@/components/lesson-materials/LessonBookWorkbench";
import type { LessonBookOptions } from "@/lib/lesson-materials/lesson-book-options";
import {
  AnalysisReportWorkbench,
  type AnalysisReportProjectInput,
} from "@/components/lesson-materials/AnalysisReportWorkbench";
import { WorkbookWorkbench } from "@/components/lesson-materials/WorkbookWorkbench";
import { QuestionPrintView } from "@/components/question-generator/QuestionPrintView";
import { closeTabOrGo } from "@/components/lesson-materials/open-new-document";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import { saveIntegratedDocument } from "@/lib/lesson-materials/document-actions";
import {
  COVER_PRESETS,
  INTEGRATED_EXTRA_KINDS,
  INTEGRATED_SECTION_ORDER,
  TEST_BOOK_PART_ORDER,
  coverPreset,
  integratedPartMeta,
  type IntegratedExtraKind,
  type IntegratedPartKind,
  type IntegratedPayload,
  type IntegratedSectionKind,
} from "@/lib/lesson-materials/integrated";
import {
  BackCover,
  ContentsPage,
  CoverThumb,
  DividerPage,
  FrontCover,
  type ContentsEntry,
} from "@/components/lesson-materials/integrated/BundleSheets";
import { watchPageNumbers } from "@/lib/lesson-materials/page-numbers";
import { legacyCoverSpec, mergeCoverSpec } from "@/lib/lesson-materials/book-cover";
import { CoverForm } from "@/components/lesson-materials/book-cover/CoverForm";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { postJson } from "@/lib/lesson-materials/post-json";
import { fetchWorkbookDoc } from "@/lib/lesson-materials/workbook-doc-client";
import { DocumentTitle } from "@/components/lesson-materials/DocumentTitle";
import type { prepareWorkbookExtrasAction } from "@/lib/lesson-materials/test-book-actions";
import {
  DEFAULT_TEST_BOOK_OPTIONS,
  buildTestSheet,
  buildVocabExam,
  buildWordTest,
  isTestBookProjectReady,
  type TestBookProjectInput,
} from "@/lib/lesson-materials/test-book";
import {
  AllVocabSheets,
  AnswerSheets,
  TYPE_SHORT,
  BlankNoteSheets,
  LessonSheets,
  PlanSheets,
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  TestBookBrand,
  TestSheets,
  TranslationBackSheets,
  VocabExamAnswerSheets,
  VocabExamSheets,
  VocabSheets,
  WordTestSheets,
  partStyle,
} from "@/components/lesson-materials/test-book/TestBookSheets";
import {
  TRANSLATION_MODES,
} from "@/components/lesson-materials/test-book/TestBookControls";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import { writeMaterialDesign } from "@/lib/lesson-materials/material-design";
import { WORKBOOK_TYPE_SHORT, type WorkbookTypeId } from "@/lib/lesson-materials/workbook-types";
import { RegenMaterials, type RegenPart } from "@/components/lesson-materials/test-book/LessonPackExtras";

export type FinalBundleMaterials = {
  lessonPacks: Array<{ docId: string; name: string; options: Partial<LessonBookOptions> | null; projects: TestBookProjectInput[] }>;
  analyses: Array<{ docId: string; name: string; projects: AnalysisReportProjectInput[] }>;
  /** 고른 워크북(유형은 학습 계획표 이수 칸에 쓴다) */
  workbooks: Array<{ docId: string; name: string; types: WorkbookTypeId[] }>;
  questions: Array<{ jobId: string; title: string }>;
  /** 고른 파일들의 지문(계획표·전체 단어장·백지노트) */
  extraProjects: TestBookProjectInput[];
};

/** 쪽으로 세는 요소(각 자료의 A4 쪽). 테스트 교재 쪽은 쪽 나눔 측정 틀 안의 것을 뺀다. */
const PAGE_SELECTOR = ".lesson-pack-a4-sheet, .qg-print-page, .tb-sheet:not(.tb-measure .tb-sheet)";
const PDF_PAGE_SELECTOR =
  ":is(.final-bundle-sheet, .lesson-pack-a4-sheet, .qg-print-page, .tb-sheet:not(.tb-measure .tb-sheet))";

/** 테스트 교재 묶음의 색(목차 번호·쪽 꼬리표) — 테스트 교재와 같다 */
const EXTRA_COLOR: Record<IntegratedExtraKind, string> = {
  plan: "#2b2f38",
  vocab: "#1d2a8f",
  word_note: "#1d2a8f",
  blank_note: "#0f8a7e",
  tests: "#e8552e",
  tb_answers: "#475066",
};
/** 테스트지 자료는 교재 견본처럼 늘 같은 열쇠(새로 섞은 것은 「테스트지 뽑기」) */
const BOOK_SEED = "book";
const isExtra = (k: string): k is IntegratedExtraKind => (INTEGRATED_EXTRA_KINDS as string[]).includes(k);
/** 파일 묶음(수업용 자료·분석서·변형문제·워크북) */
const isDocKind = (k: IntegratedPartKind): k is IntegratedSectionKind => (INTEGRATED_SECTION_ORDER as string[]).includes(k);
/** 목록에 보이는 묶음: 파일 묶음 + 켠 테스트 교재 묶음(계획표는 표지 뒤라 목록에 없다) */
const listed = (k: IntegratedPartKind, extras: Record<IntegratedExtraKind, boolean>) =>
  k !== "plan" && (isDocKind(k) || (isExtra(k) && extras[k]));
type PrepareResult = Awaited<ReturnType<typeof prepareWorkbookExtrasAction>>;

const PRINT_CSS = `
/* 미리보기 배율은 화면에서만 건다. 인쇄 계산에 섞이면 쪽이 더 생긴다. */
@media screen {
  #final-bundle-print-root { zoom: var(--bundle-zoom, 1); }
  /*
   * 화면에 안 보이는 쪽은 배치·그리기를 미룬다(2026-10-29 속도: 700쪽 가까운 묶음을 한 번에 배치했다).
   * 쪽 높이는 A4로 잡아 두어 스크롤 막대가 흔들리지 않게. 인쇄·PDF에는 걸리지 않는다(화면에서만).
   */
  #final-bundle-print-root :is(.final-bundle-sheet, .lesson-pack-a4-sheet, .qg-print-page, .tb-sheet):not(.tb-measure .tb-sheet) {
    content-visibility: auto;
    contain-intrinsic-size: auto 210mm auto 297mm;
  }
}
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  #final-bundle-print-root, #final-bundle-print-root * { visibility: visible; }
  #final-bundle-print-root {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 210mm !important; zoom: 1 !important; gap: 0 !important;
  }
  /* 자료마다 자기 인쇄 틀을 맨 위 왼쪽에 고정하는데, 여기서는 차례로 흐르게 한다. */
  #final-bundle-print-root #lesson-pack-print-root,
  #final-bundle-print-root #analysis-report-print-root,
  #final-bundle-print-root #workbook-print-root,
  #final-bundle-print-root #qg-print-root {
    position: static !important; width: 210mm !important; transform: none !important;
    zoom: 1 !important; gap: 0 !important; padding: 0 !important; margin: 0 !important;
    /* 전역 CSS가 붙인 이름 붙은 쪽(app-print-a4)이 바뀌는 곳마다 빈 쪽이 끼어 끈다. */
    page: auto !important;
  }
  #final-bundle-print-root .final-bundle-sheet {
    height: 296.5mm !important; box-shadow: none !important;
    break-after: page; page-break-after: always;
  }
  #final-bundle-print-root .final-bundle-sheet--last { break-after: auto; page-break-after: auto; }
  /* 자료의 마지막 쪽 뒤에서도 쪽을 넘겨 다음 간지가 같은 쪽에 붙지 않게 한다. */
  #final-bundle-print-root .lesson-pack-a4-sheet--last,
  #final-bundle-print-root .qg-print-page-last {
    break-after: page !important; page-break-after: always !important;
  }
  #final-bundle-print-root .bundle-screen-only { display: none !important; }
  #final-bundle-print-root .tb-sheet { box-shadow: none !important; }
  /* 겹친 flex 상자는 인쇄에서 쪽 나눔이 어긋나 빈 쪽이 생긴다. 인쇄에서는 블록으로 흐르게 한다. */
  #final-bundle-print-root,
  #final-bundle-print-root .bundle-section,
  #final-bundle-print-root [data-bundle-section],
  #final-bundle-print-root #lesson-pack-print-root,
  #final-bundle-print-root #analysis-report-print-root,
  #final-bundle-print-root #workbook-print-root { display: block !important; }
}
`;

type SectionPlan = {
  key: string;
  kind: IntegratedPartKind | "answers";
  en: string;
  title: string;
  sub: string;
};

export function FinalBundleClient({
  role,
  docId,
  name,
  initialPayload,
  materials,
  logoSrc,
  academyName,
}: {
  role: "admin" | "teacher";
  docId: string;
  name: string;
  initialPayload: IntegratedPayload;
  materials: FinalBundleMaterials;
  logoSrc: string;
  academyName: string;
}) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const qgBase = role === "admin" ? "/admin/question-generator" : "/teacher/question-generator";
  const [payload, setPayload] = useState<IntegratedPayload>(() => ({
    ...initialPayload,
    cover: {
      ...initialPayload.cover,
      title: initialPayload.cover.title || name,
      academy: initialPayload.cover.academy || academyName,
    },
  }));
  const [zoom, setZoom] = useState(60);
  /*
   * 묶음 본문(수업용 자료·분석서·워크북 등)은 서버에서 그리지 않고 브라우저에서 한 번 그린다(2026-10-29 속도:
   * 서버가 184쪽을 그려 보낸 HTML 588KB를 브라우저가 받아 맞춘 뒤 어차피 쪽을 다시 나눴다). 표지·목차는 서버에서.
   */
  const [bodiesOn, setBodiesOn] = useState(false);
  useEffect(() => setBodiesOn(true), []);
  // 안에 든 워크북 내용을 화면을 그리기 시작할 때 미리 부른다(워크북 부분은 같은 요청을 받아 쓴다)
  useState(() => {
    if (typeof window !== "undefined") for (const w of materials.workbooks) void fetchWorkbookDoc(role, w.docId).catch(() => undefined);
    return null;
  });
  /** PDF로 바로 저장(인쇄 창 없이) */
  const pdf = usePdfSave();
  // 미리 PDF를 만들어 두어 「PDF로 저장」을 누르면 바로 받아진다
  usePdfPrefetch("final-bundle-print-root", PDF_PAGE_SELECTOR);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  /** 묶음 안 세부 항목(워크북 유형·수업용 자료 지문)마다 쪽 수 — 이어진 쪽끼리 한 줄 */
  const [subCounts, setSubCounts] = useState<Record<string, Array<{ label: string; note?: string; n: number }>>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 아직 보내지 않은 마지막 설정과, 보내는 중인 저장 — 「닫기(저장)」가 이 둘을 끝내고 닫는다 */
  const pendingPayload = useRef<IntegratedPayload | null>(null);
  const inflightSave = useRef<Promise<void>>(Promise.resolve());
  const [closing, setClosing] = useState(false);
  const preset = coverPreset(payload.cover.presetId);
  // 표지 칸: 자료 이름 · 예전 칸에서 읽은 값 위에 고친 칸(cover.exam)을 얹는다. 학원명은 cover.academy.
  const examSpec = mergeCoverSpec(legacyCoverSpec(payload.cover), payload.cover.exam);

  const extraProjects = materials.extraProjects;
  const ready = useMemo(() => extraProjects.filter(isTestBookProjectReady), [extraProjects]);
  const vocabReady = extraProjects.filter((p) => (p.material?.vocab?.length ?? 0) > 0);
  /** 재료(1장 자료·단어 정리)가 없는 지문 — 단어장·단어 정리·테스트지에서 빠진다 */
  const vocabMissing = extraProjects.filter((p) => !isTestBookProjectReady(p));
  const tOpt = payload.tests;
  /** 파일 묶음은 고른 자료가 있을 때, 테스트 교재 묶음은 켰고 지문이 있을 때 */
  const has: Record<IntegratedPartKind, boolean> = {
    lesson_pack: materials.lessonPacks.length > 0,
    analysis_report: materials.analyses.length > 0,
    questions: materials.questions.length > 0,
    workbook: materials.workbooks.length > 0,
    plan: payload.extras.plan && extraProjects.length > 0,
    // 전체 단어장·단어 정리는 수업용 자료 안으로 들어갔다(통합자료 묶음으로는 싣지 않는다)
    vocab: false,
    word_note: false,
    blank_note: payload.extras.blank_note && extraProjects.length > 0,
    // 테스트지는 자료함에서 뽑는다(선생님 2026-10-21: 통합자료·워크북 미리보기에는 안 나오게)
    tests: false,
    tb_answers: false,
  };

  /** 테스트지 자료(지문마다 동반의어·품사 TEST + 유형별 테스트, 앞에 단어 시험지) */
  const book = useMemo(
    () =>
      ready.map((p) => ({
        project: p,
        word: buildWordTest(p, BOOK_SEED),
        sheet: buildTestSheet(p, tOpt.types, {
          seed: BOOK_SEED,
          blankMode: "same",
          writing: tOpt.writing,
          lineMode: tOpt.lineMode,
          level: tOpt.level,
        }),
      })),
    [ready, tOpt.types, tOpt.writing, tOpt.lineMode, tOpt.level]
  );
  const vocabExam = useMemo(
    () =>
      buildVocabExam(
        ready.map((p) => ({ passage: extraProjects.indexOf(p) + 1, vocab: p.material.vocab })),
        { ...tOpt.vocabExam, seed: `${BOOK_SEED}|vocab` }
      ),
    [ready, extraProjects, tOpt.vocabExam]
  );
  const updateTests = (patch: Partial<IntegratedPayload["tests"]>) => update({ tests: { ...payload.tests, ...patch } });

  /** PDF 이름은 자료함 파일 이름 그대로(선생님 2026-10-26) — 화면에서 이름을 바꿨을 수 있어 누를 때 다시 읽는다 */
  async function savePdf() {
    const pages = collectPrintPages(document.getElementById("final-bundle-print-root"), PDF_PAGE_SELECTOR);
    const res = await postJson<{ ok: true; name: string } | { ok: false; message: string }>("/api/lesson-materials/documents/open", {
      op: "getName",
      role,
      id: docId,
    }).catch(() => null);
    const fileName = (res && res.ok ? res.name : name) || payload.cover.title.replace(/\s+/g, " ") || "통합자료";
    await pdf.save("통합자료", pages, [fileName], undefined, true);
  }
  // 글꼴이 늦게 들어오면 테스트 교재 쪽 나눔을 다시 잰다(먼저 잰 높이로 나누면 쪽이 넘친다)
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && !isPrinting() && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);

  // 목차·본문 순서. 고른 자료가 없는 유형은 뺀다. 변형문제 정답은 맨 뒤에 모은다.
  const sections: SectionPlan[] = useMemo(() => {
    const out: SectionPlan[] = payload.parts
      .filter((k) => has[k] && k !== "plan")
      .map((k) => ({ key: k, kind: k, ...integratedPartMeta(k) }));
    if (payload.answerKey && has.questions) {
      out.push({ key: "answers", kind: "answers", en: "ANSWER KEY", title: "정답", sub: "변형문제 정답" });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.parts, payload.extras, payload.answerKey, materials]);

  // 인쇄 CSS
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "final-bundle-print-style";
    el.textContent = PRINT_CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  // 자료마다 쪽 수를 세어 목차 쪽 번호를 채운다(각 자료가 쪽 나눔을 마친 뒤 바뀌므로 계속 본다).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const count = () => {
      const next: Record<string, number> = {};
      const subs: Record<string, Array<{ label: string; note?: string; n: number }>> = {};
      root.querySelectorAll<HTMLElement>("[data-bundle-section]").forEach((sec) => {
        const pages = Array.from(sec.querySelectorAll<HTMLElement>(PAGE_SELECTOR)).filter((el) => el.offsetParent !== null);
        const key = sec.dataset.bundleSection!;
        next[key] = (next[key] ?? 0) + pages.length;
        const list = (subs[key] ??= []);
        for (const el of pages) {
          const tag = el.closest<HTMLElement>("[data-toc-sub]");
          const label = tag?.dataset.tocSub?.trim() ?? "";
          const note = tag?.dataset.tocNote?.trim() || undefined;
          const last = list[list.length - 1];
          if (last && last.label === label) last.n += 1;
          else list.push({ label, ...(note ? { note } : {}), n: 1 });
        }
      });
      // 꼬리표 없는 쪽만 있는 묶음(분석서·변형문제 등)은 세부 항목을 싣지 않는다
      for (const k of Object.keys(subs)) if (!subs[k]!.some((x) => x.label)) delete subs[k];
      setPageCounts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setSubCounts((prev) => (JSON.stringify(prev) === JSON.stringify(subs) ? prev : subs));
    };
    count();
    const observer = new MutationObserver(() => count());
    observer.observe(root, { childList: true, subtree: true });
    const timer = setInterval(count, 1500);
    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, []);

  /*
   * 쪽번호를 장마다 찍는다. 목차의 쪽 번호와 같은 셈법(앞표지 1, 목차 2, …)이라
   * 목차에 적힌 번호로 그 쪽을 찾을 수 있다. 표지와 뒤표지에는 번호를 적지 않는다.
   */
  useEffect(() => {
    return watchPageNumbers(rootRef.current, true, {
      skip: (el, i) => i === 0 || el.classList.contains("final-bundle-sheet--last"),
    });
  }, []);

  // 쪽 번호: 앞표지 1, (학습 계획표), 목차, 그다음 간지와 자료 쪽을 차례로 센다.
  const contents: ContentsEntry[] = [];
  let page = 3 + (has.plan ? (pageCounts.plan ?? 0) : 0);
  sections.forEach((s, i) => {
    if (payload.dividers) page += 1;
    const n = pageCounts[s.key] ?? 0;
    let at = page;
    const children = (subCounts[s.key] ?? [])
      .map((x) => {
        const from = at;
        at += x.n;
        return { label: x.label, note: x.note, from, to: from + x.n - 1 };
      })
      .filter((x) => x.label);
    contents.push({
      number: String(i + 1).padStart(2, "0"),
      en: s.en,
      sub: s.sub,
      from: n > 0 ? page : null,
      to: n > 0 ? page + n - 1 : null,
      children,
    });
    page += n;
  });
  const totalPages = page; // 뒤표지 포함(page는 다음 쪽 번호이므로 뒤표지 번호와 같다)

  /** 설정을 바꾸면 화면에 바로 반영하고, 입력이 잠깐 멈춘 뒤 파일에 저장한다. */
  function update(patch: Partial<IntegratedPayload>) {
    const next = { ...payload, ...patch };
    setPayload(next);
    pendingPayload.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void savePayload(next);
    }, 800);
  }

  function savePayload(next: IntegratedPayload): Promise<void> {
    pendingPayload.current = null;
    const run = inflightSave.current.then(async () => {
      try {
        const res = await saveIntegratedDocument(role, { id: docId, payload: next });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    });
    inflightSave.current = run;
    return run;
  }

  /**
   * 닫기(저장): 기다리던 저장(0.8초)을 바로 보내고, 보내는 중인 저장까지 끝난 뒤 닫는다
   * (선생님 2026-10-22 — 바꾸고 곧바로 닫으면 마지막 설정이 사라지던 것).
   */
  async function saveAndClose() {
    setClosing(true);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingPayload.current) void savePayload(pendingPayload.current);
    await inflightSave.current;
    closeTabOrGo(base);
  }
  const updateCover = (patch: Partial<IntegratedPayload["cover"]>) =>
    update({ cover: { ...payload.cover, ...patch } });

  /** 보이는 묶음끼리 자리를 바꾼다(꺼 둔 묶음은 건너뛴다). 파일 묶음 순서(order)도 맞춰 둔다. */
  function move(kind: IntegratedPartKind, dir: -1 | 1) {
    const parts = [...payload.parts];
    const shown = parts.filter((k) => listed(k, payload.extras));
    const a = shown.indexOf(kind);
    const b = a + dir;
    if (a < 0 || b < 0 || b >= shown.length) return;
    const i = parts.indexOf(shown[a]!);
    const j = parts.indexOf(shown[b]!);
    [parts[i], parts[j]] = [parts[j]!, parts[i]!];
    update({ parts, order: parts.filter(isDocKind) });
  }

  /** 「테스트 교재 구성」: 계획표·단어장·백지노트를 켜고 테스트 교재 차례로 놓는다 */
  function applyTestBookPreset() {
    const parts = [...TEST_BOOK_PART_ORDER];
    update({
      parts,
      order: parts.filter(isDocKind),
      extras: { plan: true, vocab: false, word_note: false, blank_note: true, tests: false, tb_answers: false },
      dividers: true,
    });
  }

  /** 단어장 재료가 없는 지문: 지문당 한 번 값을 받고 만든 뒤 다시 불러온다(워크북 새 유형과 같은 재료·같은 값) */
  const [preparing, setPreparing] = useState<string | null>(null);
  async function prepareVocab() {
    if (preparing || vocabMissing.length === 0) return;
    const go = await askCreditConfirm({
      title: "전체 단어장",
      description: "지문마다 단어 정리(품사·지문 속 뜻·파생어·동반의어)를 만듭니다. 워크북 새 유형과 같은 재료라, 이미 값을 낸 지문은 다시 받지 않습니다.",
      subject: `단어장 재료가 없는 지문 ${vocabMissing.length}개`,
      contents: vocabMissing.map((p) => p.title),
      items: [{ feature: "lesson_workbook_extras", quantity: vocabMissing.length }],
    });
    if (!go) return;
    const failed: string[] = [];
    let done = 0;
    setPreparing(`단어장 재료를 만들고 있습니다… (0/${vocabMissing.length})`);
    await runWithConcurrency(vocabMissing, PASSAGE_PREP_CONCURRENCY, async (p) => {
      try {
        const res = await postJson<PrepareResult>("/api/lesson-materials/test-book", {
          role,
          op: "prepareWorkbook",
          projectId: p.id,
        });
        if (!res.ok) failed.push(`「${p.title}」 ${res.message}`);
      } catch (e) {
        failed.push(`「${p.title}」 ${e instanceof Error ? e.message : "만들지 못했습니다."}`);
      }
      setPreparing(`단어장 재료를 만들고 있습니다… (${++done}/${vocabMissing.length})`);
    });
    if (failed.length) {
      setPreparing(failed.join(" · "));
      return;
    }
    window.location.reload();
  }

  /** 기능마다 다시 만들기(단어 정리·직독직해·1장 자료 재료 — 값 없음) 뒤 다시 불러온다 */
  async function regenerateMaterials(ids: string[], parts: RegenPart[]) {
    if (preparing || !ids.length || !parts.length) return;
    const failed: string[] = [];
    let done = 0;
    setPreparing(`다시 만들고 있습니다… (0/${ids.length})`);
    await runWithConcurrency(ids, PASSAGE_PREP_CONCURRENCY, async (id) => {
      try {
        const res = await postJson<PrepareResult>("/api/lesson-materials/test-book", {
          role,
          op: "prepareWorkbook",
          projectId: id,
          regenerate: parts,
        });
        if (!res.ok) failed.push(res.message);
      } catch (e) {
        failed.push(e instanceof Error ? e.message : "다시 만들지 못했습니다.");
      }
      setPreparing(`다시 만들고 있습니다… (${++done}/${ids.length})`);
    });
    if (failed.length) {
      setPreparing(failed.join(" · "));
      return;
    }
    window.location.reload();
  }

  /*
   * 표지 글자를 한 자 칠 때마다 본문 122쪽이 통째로 다시 그려져 입력이 버벅였다
   * (선생님 지적 2026-09-18). 본문은 고른 자료·순서에만 달렸으므로 따로 기억해 두고,
   * 표지 글자가 바뀌어도 다시 만들지 않는다.
   */
  const renderSection = (s: SectionPlan) => {
    if (s.kind !== "answers" && isExtra(s.kind)) {
      const no = String(sections.findIndex((x) => x.key === s.key) + 1).padStart(2, "0");
      const style = partStyle({ id: s.kind, no, en: s.en, ko: s.title, color: EXTRA_COLOR[s.kind] });
      const indexOf = (id: string) => extraProjects.findIndex((p) => p.id === id);
      const mk = `bundle-${s.kind}|${fontsTick}`;
      return (
        <div className="contents" style={style}>
          {s.kind === "vocab" ? (
            <AllVocabSheets projects={vocabReady} indexOf={indexOf} measureKey={mk} />
          ) : s.kind === "word_note" ? (
            <>
              {ready.map((p) => (
                <div key={p.id} className="contents">
                  <VocabSheets index={indexOf(p.id)} project={p} measureKey={mk} />
                  <LessonSheets index={indexOf(p.id)} project={p} translation={tOpt.translation} measureKey={`${mk}|${tOpt.translation}`} />
                </div>
              ))}
              {tOpt.translation === "back" ? <TranslationBackSheets projects={ready} measureKey={mk} /> : null}
            </>
          ) : s.kind === "blank_note" ? (
            extraProjects.map((p, i) => <BlankNoteSheets key={p.id} index={i} project={p} />)
          ) : s.kind === "tests" ? (
            <>
              {tOpt.allWordTest ? <VocabExamSheets exam={vocabExam} measureKey={mk} /> : null}
              {book.map((b) => (
                <div key={b.project.id} className="contents">
                  {tOpt.wordTest ? <WordTestSheets index={indexOf(b.project.id)} project={b.project} test={b.word} measureKey={mk} /> : null}
                  {tOpt.types.length ? (
                    <TestSheets index={indexOf(b.project.id)} project={b.project} sheet={b.sheet} title="테스트" measureKey={mk} />
                  ) : null}
                </div>
              ))}
            </>
          ) : s.kind === "tb_answers" ? (
            <>
              {tOpt.allWordTest ? <VocabExamAnswerSheets exam={vocabExam} measureKey={mk} /> : null}
              {tOpt.wordTest || tOpt.types.length ? (
                <AnswerSheets
                  title="테스트지 정답"
                  entries={book.map((b) => ({
                    index: indexOf(b.project.id),
                    project: b.project,
                    word: tOpt.wordTest ? b.word : undefined,
                    sheet: tOpt.types.length ? b.sheet : { ...b.sheet, sections: [] },
                  }))}
                  measureKey={mk}
                />
              ) : null}
            </>
          ) : null}
        </div>
      );
    }
    if (s.kind === "lesson_pack") {
      return materials.lessonPacks.map((m) => (
        <LessonBookWorkbench key={m.docId} role={role} projects={m.projects} savedOptions={m.options} logoSrc={logoSrc} academyName={payload.cover.academy || academyName} design={payload.theme} embedded />
      ));
    }
    if (s.kind === "analysis_report") {
      return materials.analyses.map((m) => (
        <AnalysisReportWorkbench key={m.docId} role={role} projects={m.projects} logoSrc={logoSrc} design={payload.theme} embedded />
      ));
    }
    if (s.kind === "workbook") {
      return materials.workbooks.map((m) => <WorkbookWorkbench key={m.docId} role={role} embeddedDocId={m.docId} design={payload.theme} />);
    }
    const mode = s.kind === "answers" ? "answers" : "exam";
    return materials.questions.map((q) => (
      <QuestionPrintView
        key={`${q.jobId}-${mode}`}
        jobId={q.jobId}
        backHref={base}
        printBaseHref={`${qgBase}/generations/${q.jobId}`}
        mode={mode}
        academyName={academyName}
        logoSrc={logoSrc}
        design={payload.theme}
        embedded
      />
    ));
  };

  const sectionBodies = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    for (const s of sections) out[s.key] = renderSection(s);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, materials, role, logoSrc, academyName, base, qgBase, book, vocabExam, tOpt.translation, tOpt.wordTest, tOpt.allWordTest, fontsTick, payload.theme]);

  /**
   * 이수표 칸 — 고른 워크북의 유형(원래 테스트 교재처럼 워크북을 보고, 선생님 2026-10-21) + 켠 테스트지 자료의 유형.
   * 같은 이름은 한 번만.
   */
  const planColumns = [
    ...new Set([
      ...(has.workbook ? materials.workbooks.flatMap((w) => w.types.map((t) => WORKBOOK_TYPE_SHORT[t] ?? t)) : []),
      ...(has.tests ? [...(tOpt.wordTest ? ["동반의어"] : []), ...tOpt.types.map((t) => TYPE_SHORT[t])] : []),
    ]),
  ];
  /** 학습 계획표 — 목차보다 앞, 앞표지 바로 뒤(선생님 2026-10-21) */
  const planBody = useMemo(
    () =>
      has.plan ? (
        <div
          data-bundle-section="plan"
          className="contents"
          style={{ ["--tb-accent" as string]: EXTRA_COLOR.plan, ["--tb-part" as string]: '"STUDY PLAN"' } as CSSProperties}
        >
          <PlanSheets
            projects={extraProjects}
            measureKey={`bundle-plan|${fontsTick}`}
            options={{
              ...DEFAULT_TEST_BOOK_OPTIONS,
              ...tOpt,
              types: [],
              tests: has.tests,
              lesson: has.lesson_pack || has.word_note,
              blankNote: has.blank_note,
              analysis: has.analysis_report,
            }}
            columns={planColumns}
            extraTodo={[...(has.workbook ? ["워크북"] : []), ...(has.tests ? ["테스트지"] : [])]}
          />
        </div>
      ) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [has.plan, has.tests, has.lesson_pack, has.word_note, has.blank_note, has.analysis_report, has.workbook, extraProjects, tOpt, fontsTick, planColumns.join("|")]
  );

  /** 단어학습 단어장 등록(테스트 교재와 같다 — 다시 누르면 같은 단어장을 고친다) */
  const [vocabReg, setVocabReg] = useState<{ busy: boolean; msg: string | null; error: boolean; href: string | null }>({
    busy: false,
    msg: null,
    error: false,
    href: null,
  });
  async function registerVocab() {
    if (vocabReg.busy) return;
    setVocabReg({ busy: true, msg: null, error: false, href: null });
    try {
      const res = await postJson<{ ok: true; setId: string; count: number; created: boolean } | { ok: false; message: string }>(
        "/api/lesson-materials/test-book",
        {
          op: "registerVocab",
          role,
          id: docId,
          title: payload.cover.title.replace(/\s+/g, " ").trim() || name,
          projectIds: extraProjects.map((p) => p.id),
        }
      );
      if (!res.ok) {
        setVocabReg({ busy: false, msg: res.message, error: true, href: null });
        return;
      }
      // 파일에 남긴 단어장 id를 화면 설정에도 둔다(설정을 저장할 때 지워지지 않게)
      setPayload((p) => ({ ...p, vocabSetId: res.setId }));
      setVocabReg({
        busy: false,
        msg: `${res.created ? "단어장을 만들었습니다" : "단어장을 고쳤습니다"} · ${res.count}단어`,
        error: false,
        href: `/${role}/vocab/set/${res.setId}`,
      });
    } catch (e) {
      setVocabReg({ busy: false, msg: e instanceof Error ? e.message : "등록하지 못했습니다.", error: true, href: null });
    }
  }
  const brand = useMemo(() => ({ logoSrc: logoSrc || null, academy: payload.cover.academy || academyName }), [
    logoSrc,
    payload.cover.academy,
    academyName,
  ]);


  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:block print:bg-white">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={() => void saveAndClose()}
            disabled={closing}
            className="text-sm font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-60"
          >
            {closing ? "저장 중…" : "‹ 닫기(저장)"}
          </button>
          <p className="flex items-center gap-2 text-base font-black text-slate-900">
            <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-violet-700">🗂</span>
            <DocumentTitle role={role} fallback={name || "통합 자료"} />
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <section className="space-y-2">
            <p className="text-xs font-bold text-slate-600">표지</p>
            <div className="grid grid-cols-2 gap-2.5">
              {COVER_PRESETS.map((p) => {
                const on = preset.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => updateCover({ presetId: p.id })}
                    aria-pressed={on}
                    className={`overflow-hidden rounded-lg border-2 bg-white text-left transition ${
                      on ? "border-violet-600 shadow-md" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <CoverThumb preset={p} cover={payload.cover} widthPx={144} logoSrc={logoSrc} />
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[12px] font-bold text-slate-800">{p.name}</p>
                      <p className="truncate text-[10.5px] text-slate-500">{p.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 디자인 하나로 — 안에 든 수업용 자료·분석서·워크북·테스트지가 모두 이것을 쓴다(선생님 2026-10-21) */}
          <MaterialDesignPicker
            title="디자인 (모든 자료)"
            value={payload.theme}
            onChange={(theme) => {
              update({ theme });
              writeMaterialDesign(theme);
            }}
          />

          <section className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-600">표지에 들어갈 말</p>
            <CoverForm
              spec={examSpec}
              onPatch={({ brand, ...rest }) =>
                updateCover({
                  ...(brand !== undefined ? { academy: brand } : {}),
                  ...(Object.keys(rest).length ? { exam: { ...(payload.cover.exam ?? {}), ...rest } } : {}),
                })
              }
            />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-600">구성</p>
              <button
                type="button"
                onClick={applyTestBookPreset}
                title="계획표 → 전체 단어장 → 수업용 자료 → 백지노트 → 분석서 → 워크북 → 변형문제"
                className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
              >
                테스트 교재 구성
              </button>
            </div>
            <div className="space-y-1 rounded-xl bg-slate-50 p-2.5">
              {INTEGRATED_EXTRA_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={payload.extras[k]}
                    onChange={(e) => update({ extras: { ...payload.extras, [k]: e.target.checked } })}
                  />
                  {integratedPartMeta(k).title}
                  <span className="text-[11px] text-slate-400">{integratedPartMeta(k).sub}</span>
                </label>
              ))}
              {(payload.extras.vocab || payload.extras.word_note || payload.extras.tests) && vocabMissing.length > 0 ? (
                <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  재료가 없는 지문 {vocabMissing.length}개는 단어장·단어 정리·테스트지에서 빠집니다.
                  <button
                    type="button"
                    disabled={!!preparing && preparing.endsWith(")")}
                    onClick={() => void prepareVocab()}
                    className="mt-1.5 block w-full rounded-md bg-amber-500 py-1 font-bold text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    재료 만들기 (지문 {vocabMissing.length}개)
                  </button>
                  {preparing ? <p className="mt-1">{preparing}</p> : null}
                </div>
              ) : null}
              {payload.extras.word_note ? (
                <div className="space-y-1 pt-1">
                  <p className="text-[11px] font-bold text-slate-500">문장별 해석</p>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                    {TRANSLATION_MODES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => updateTests({ translation: t.id })}
                        className={`rounded-md px-1 py-1 text-[11px] font-bold ${tOpt.translation === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {extraProjects.length ? (
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={vocabReg.busy || !vocabReady.length}
                    onClick={() => void registerVocab()}
                    title="전체 단어(뜻·품사·동의어·반의어·지문 예문)를 단어학습 「테스트 교재」 폴더에 단어장으로 넣습니다"
                    className="w-full rounded-lg border border-emerald-300 bg-white py-1.5 text-[12px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {vocabReg.busy ? "등록 중…" : "단어학습에 등록"}
                  </button>
                </div>
              ) : null}
              {INTEGRATED_EXTRA_KINDS.some((k) => payload.extras[k]) && ready.length ? (
                <RegenMaterials
                  passages={ready.map((p) => ({ id: p.id, label: `${String(extraProjects.indexOf(p) + 1).padStart(2, "0")} · ${p.title}` }))}
                  busy={!!preparing && preparing.endsWith(")")}
                  onRun={(ids, parts) => void regenerateMaterials(ids, parts)}
                />
              ) : null}
              {preparing && !vocabMissing.length ? <p className="text-[11px] text-violet-700">{preparing}</p> : null}
              {vocabReg.msg ? (
                <p className={`text-[11px] font-semibold ${vocabReg.error ? "text-rose-600" : "text-emerald-700"}`}>
                  {vocabReg.msg}
                  {vocabReg.href ? (
                    <>
                      {" · "}
                      <a href={vocabReg.href} target="_blank" rel="noreferrer" className="underline">
                        단어장 열기
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={payload.dividers} onChange={(e) => update({ dividers: e.target.checked })} />
              자료 사이에 간지 넣기
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={payload.answerKey} onChange={(e) => update({ answerKey: e.target.checked })} />
              변형문제 정답을 맨 뒤에 모으기
            </label>
            <ol className="space-y-1">
              {payload.parts
                .filter((k) => listed(k, payload.extras))
                .map((k, i, shown) => (
                <li
                  key={k}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm ${
                    has[k] ? "border-slate-200 bg-white text-slate-800" : "border-dashed border-slate-200 text-slate-400"
                  }`}
                >
                  <span>
                    <span className="mr-1.5 font-bold text-violet-600">{i + 1}</span>
                    {integratedPartMeta(k).title}
                    {!has[k] ? (isExtra(k) ? " (지문 재료 없음)" : " (고른 자료 없음)") : ""}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" disabled={i === 0} onClick={() => move(k, -1)} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                      ‹
                    </button>
                    <button type="button" disabled={i === shown.length - 1} onClick={() => move(k, 1)} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                      ›
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {saveState !== "idle" ? (
            <p className={`text-[11px] ${saveState === "error" ? "text-rose-600" : "text-slate-400"}`}>
              {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "설정을 저장했습니다." : "저장하지 못했습니다."}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700"
          >
            인쇄 ({totalPages}쪽)
          </button>
          <button
            type="button"
            disabled={!!pdf.busy}
            onClick={() => void savePdf()}
            className="mt-2 w-full rounded-xl border border-violet-300 bg-white py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
          >
            ⤓ PDF로 저장
          </button>
          {pdf.status ? (
            <p className={`mt-1 text-[11px] font-semibold ${pdf.busy ? "text-violet-700" : "text-rose-600"}`}>{pdf.status}</p>
          ) : null}
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            쪽 번호는 자료를 모두 불러온 뒤 맞춰집니다. 모두 불러온 뒤 저장하세요.
          </p>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden">
          <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setZoom((z) => Math.max(30, z - 10))}>
            −
          </button>
          <span className="text-xs font-semibold text-slate-600">{zoom}%</span>
          <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setZoom((z) => Math.min(120, z + 10))}>
            +
          </button>
        </div>
        {sections.some((s) => isExtra(s.kind)) ? (
          <>
            <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
            <style>{TEST_BOOK_CSS}</style>
          </>
        ) : null}
        <TestBookBrand.Provider value={brand}>
        <div className="flex justify-center p-6 print:p-0">
          <div
            ref={rootRef}
            id="final-bundle-print-root"
            className={`tb-theme-${payload.theme} flex flex-col items-center gap-6 print:gap-0 [&_.tb-sheet]:shadow-xl`}
            style={{ ["--bundle-zoom" as string]: String(zoom / 100) }}
          >
            <FrontCover preset={preset} cover={payload.cover} logoSrc={logoSrc} />
            {planBody}
            <ContentsPage entries={contents} cover={payload.cover} accent={preset.accent} />
            {sections.map((s, i) => (
              <div key={s.key} className="bundle-section flex flex-col items-center gap-6 print:gap-0">
                {payload.dividers ? (
                  <DividerPage
                    number={String(i + 1).padStart(2, "0")}
                    en={s.en}
                    title={s.title}
                    sub={s.sub}
                    preset={preset}
                    cover={payload.cover}
                  />
                ) : null}
                <div data-bundle-section={s.key} className="flex flex-col items-center gap-6 print:gap-0">
                  {bodiesOn ? sectionBodies[s.key] : null}
                </div>
              </div>
            ))}
            <BackCover preset={preset} cover={payload.cover} logoSrc={logoSrc} entries={contents} />
          </div>
        </div>
        </TestBookBrand.Provider>
      </main>
    </div>
  );
}

