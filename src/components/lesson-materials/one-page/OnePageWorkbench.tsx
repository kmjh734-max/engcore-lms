"use client";

import { CloseSaveButton } from "@/components/lesson-materials/CloseSaveButton";
import { DocumentTitle } from "@/components/lesson-materials/DocumentTitle";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { postJson } from "@/lib/lesson-materials/post-json";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import type { renameLessonMaterialDocument } from "@/lib/lesson-materials/document-actions";
import { defaultDocumentName } from "@/lib/lesson-materials/documents";
import type {
  prepareOnePageContentAction,
  saveOnePageTestAction,
} from "@/lib/lesson-materials/one-page-actions";
import type {
  generateGrammarChoicePassageAction,
  generateVocabChoicePassageAction,
} from "@/lib/lesson-materials/workbook-actions";
import {
  ALL_ONE_PAGE_TEST_TYPES,
  ONE_PAGE_TEST_TYPES,
  buildOnePageTestPassage,
  countOnePageTestTypes,
  filterOnePageTestPassage,
  type OnePageTestTypeKey,
  type OnePageChoiceSource,
  type OnePageContent,
  type OnePageProjectInput,
  type OnePageTestPassage,
  type OnePageTestPayload,
} from "@/lib/lesson-materials/one-page";
import {
  useCreateDocumentFromUrl,
} from "@/components/lesson-materials/open-new-document";
import { useScaledHeight } from "@/components/lesson-materials/use-scaled-height";
import { downloadSheetsPdf, pdfFileName } from "@/lib/pdf/download-sheets-pdf";
import {
  ONE_PAGE_CSS,
  OnePageAnswerSheets,
  OnePageSummarySheet,
  OnePageTestSheet,
  type OnePageSummaryLayout,
} from "@/components/lesson-materials/one-page/OnePageSheets";

/** 고른 문항 유형을 기억해 두는 자리 */
const TEST_TYPES_KEY = "one-page-test-types";
const INCLUDE_ANSWERS_KEY = "one-page-include-answers";

/** 동시에 준비하는 지문 수. 테스트는 지문마다 어법·어휘 선택까지 불러 조금 낮춘다. */
const CONCURRENCY = { summary: 6, test: 4 } as const;

type Mode = "summary" | "test";

const MODE_LABEL: Record<Mode, string> = { summary: "1장 요약직보자료", test: "1장 테스트" };

/*
 * 자료 모양. 분석지·변형문제·워크북과 같은 시안 셋(A 교재 세리프 · B 깔끔한 산세리프 · C 클래식 인쇄)
 * 가운데 하나를 고른다(기본은 A). 요약자료와 테스트지는 따로 기억한다 —
 * one-page-print-styles.css의 .op-style-*.
 */
type OnePageDesignStyle = "a" | "b" | "c";
const DESIGN_STYLE_KEY: Record<Mode, string> = {
  summary: "one-page-summary-design-style",
  test: "one-page-test-design-style",
};
const DESIGN_STYLES: Array<{ id: OnePageDesignStyle; label: string; hint: string }> = [
  { id: "a", label: "A", hint: "교재 세리프" },
  { id: "b", label: "B", hint: "깔끔한 산세리프" },
  { id: "c", label: "C", hint: "클래식 인쇄" },
];
/** A·B·C가 쓰는 글꼴. */
const DESIGN_FONTS_HREF =
  "/fonts/print/fonts.css";

/** 요약자료 버전(A 포괄형 / B 문장별). 모든 학원에서 고른다(선생님 결정 2026-10-05). */
const SUMMARY_LAYOUT_KEY = "one-page-summary-layout";
const SUMMARY_LAYOUTS: Array<{ id: OnePageSummaryLayout; label: string; hint: string }> = [
  { id: "classic", label: "A (포괄형)", hint: "원문을 한 덩어리로 싣고 어법·표현·지칭은 아래에 모읍니다." },
  { id: "sentence", label: "B (문장별)", hint: "문장마다 바로 아래에 어법·표현·지칭을 적고, 도식화는 오른쪽에 둡니다. 길면 다음 쪽으로 이어집니다." },
];

function designClass(style: OnePageDesignStyle): string {
  return `op-style op-style-${style}`;
}

type PrepareResult = Awaited<ReturnType<typeof prepareOnePageContentAction>>;
type GrammarResult = Awaited<ReturnType<typeof generateGrammarChoicePassageAction>>;
type VocabResult = Awaited<ReturnType<typeof generateVocabChoicePassageAction>>;

function choiceSource(
  res: GrammarResult | VocabResult | { ok: false; message: string }
): OnePageChoiceSource | null {
  if (!res.ok || !res.section || !res.section.items?.length) return null;
  return { sourcePassage: res.section.sourcePassage, items: res.section.items };
}

/** 저장된 시험지 중 지금 원문으로 만든 것만 쓴다. */
function initialTests(
  projects: OnePageProjectInput[],
  saved: OnePageTestPayload | null
): Record<string, OnePageTestPassage> {
  const out: Record<string, OnePageTestPassage> = {};
  for (const p of saved?.passages ?? []) {
    const project = projects.find((x) => x.id === p.projectId);
    if (project && p.sourceHash === project.sourceHash) out[p.projectId] = p;
  }
  return out;
}

/** 인쇄할 쪽들. 최종통합자료에 끼워 넣을 때(embedded)도 같은 모양을 쓴다. */
export function OnePageSheetList({
  mode,
  projects,
  tests: testsIn,
  logoSrc,
  includeAnswers,
  designKey: designKeyIn = "",
  placeholder,
  testTypes,
  summaryLayout = "classic",
}: {
  mode: Mode;
  projects: OnePageProjectInput[];
  tests: Record<string, OnePageTestPassage>;
  logoSrc?: string | null;
  includeAnswers: boolean;
  /** 모양·글꼴 상태. 바뀌면 쪽 맞추기를 다시 한다. */
  designKey?: string;
  /** 아직 준비 중이거나 실패한 지문 자리에 넣을 것(화면 전용) */
  placeholder?: (project: OnePageProjectInput, index: number) => ReactNode;
  /** 시험지에 실을 문항 유형(없으면 전부). 고르지 않은 유형은 시험지·정답지에서 뺀다. */
  testTypes?: OnePageTestTypeKey[];
  /** 요약자료 짜임(기존 / 문장별) */
  summaryLayout?: OnePageSummaryLayout;
}) {
  const typesOn = new Set(testTypes ?? ALL_ONE_PAGE_TEST_TYPES);
  const tests: Record<string, OnePageTestPassage> = {};
  for (const [id, t] of Object.entries(testsIn)) tests[id] = filterOnePageTestPassage(t, typesOn);
  // 유형을 바꾸면 한 쪽 맞추기·정답 쪽 나눔을 다시 잰다
  const designKey = mode === "test" ? `${designKeyIn}|${[...typesOn].sort().join(",")}` : designKeyIn;
  const ready = projects.filter((p) => (mode === "summary" ? !!p.content : !!tests[p.id]));
  const lastReadyId = ready[ready.length - 1]?.id;
  const testPassages = ready.map((p) => tests[p.id]!).filter(Boolean);
  const indexOf = (id: string) => projects.findIndex((p) => p.id === id);
  return (
    <>
      <style>{ONE_PAGE_CSS}</style>
      {projects.map((p, i) => {
        const isReady = mode === "summary" ? !!p.content : !!tests[p.id];
        if (!isReady) {
          return placeholder ? (
            <div key={p.id} id={`op-p-${p.id}`} className="print:hidden">
              {placeholder(p, i)}
            </div>
          ) : null;
        }
        const isLast = p.id === lastReadyId && !(mode === "test" && includeAnswers);
        return (
          <div key={p.id} id={`op-p-${p.id}`} className="scroll-mt-16">
            {mode === "summary" ? (
              <OnePageSummarySheet
                index={i}
                project={{ ...p, content: p.content as OnePageContent }}
                logoSrc={logoSrc}
                isLast={isLast}
                designKey={designKey}
                layout={summaryLayout}
              />
            ) : (
              <OnePageTestSheet index={i} passage={tests[p.id]!} isLast={isLast} designKey={designKey} />
            )}
          </div>
        );
      })}
      {mode === "test" && testPassages.length > 0 ? (
        <div id="op-answers" className={`contents ${includeAnswers ? "" : "print:hidden"}`}>
          <OnePageAnswerSheets
            passages={testPassages}
            indexOf={indexOf}
            isLastGroup={includeAnswers}
            designKey={designKey}
          />
        </div>
      ) : null}
    </>
  );
}

export function OnePageWorkbench({
  role,
  mode,
  projects: initialProjects,
  logoSrc,
  docId,
  docName = null,
  savedTest = null,
}: {
  role: "admin" | "teacher";
  mode: Mode;
  projects: OnePageProjectInput[];
  logoSrc?: string | null;
  /** 열린 파일 id(?doc=). 제작 버튼으로 연 경우 파일을 만든 뒤 채워진다. */
  docId: string | null;
  /** 열린 파일의 이름(제목). 자료함 목록·PDF 이름에 쓴다. */
  docName?: string | null;
  /** 1장 테스트 파일에 저장된 시험지 */
  savedTest?: OnePageTestPayload | null;
}) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const docIdRef = useRef<string | null>(docId);
  const docKind = mode === "summary" ? "one_page_summary" : "one_page_test";
  /** 자료 제목(= 파일 이름). 제작 창에서 적은 이름으로 시작하고, 여기서 고치면 파일 이름도 바뀐다. */
  const [title, setTitleValue] = useState(docName ?? "");
  /** 파일을 만든 뒤 부르는 콜백이 첫 렌더 것이라, 지금 제목은 ref로 읽는다. */
  const titleRef = useRef(docName ?? "");
  const setTitle = (v: string) => {
    titleRef.current = v;
    setTitleValue(v);
  };
  const savedTitle = useRef(docName ?? "");
  /** 제작 창에서 적은(또는 기본) 이름. 파일을 만든 뒤 고쳤는지 가르는 데 쓴다. */
  const startTitle = useRef(docName ?? "");
  const [titleState, setTitleState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (docName) return;
    const fromUrl = new URLSearchParams(window.location.search).get("docName")?.trim();
    startTitle.current = fromUrl || defaultDocumentName(docKind);
    setTitle(startTitle.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function commitTitle() {
    const id = docIdRef.current;
    const name = titleRef.current.replace(/\s+/g, " ").trim();
    if (!name) {
      setTitle(savedTitle.current);
      return;
    }
    if (!id || name === savedTitle.current) return;
    setTitleState("saving");
    const res = await postJson<Awaited<ReturnType<typeof renameLessonMaterialDocument>>>(
      "/api/lesson-materials/documents/open",
      { op: "rename", role, id, name }
    );
    if (res.ok) {
      savedTitle.current = res.name;
      setTitle(res.name);
    }
    setTitleState(res.ok ? "saved" : "error");
  }
  const [projects, setProjects] = useState(initialProjects);
  const [tests, setTests] = useState<Record<string, OnePageTestPassage>>(() =>
    initialTests(initialProjects, savedTest)
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(initialProjects[0]?.id ?? null);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  // 정답지 넣기도 다른 설정처럼 다음에 열 때 그대로(선생님 2026-10-22: 닫으면 설정한 대로 저장)
  const answersLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INCLUDE_ANSWERS_KEY);
      if (raw === "0" || raw === "1") setIncludeAnswers(raw === "1");
    } catch {}
    answersLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!answersLoaded.current) return;
    try {
      window.localStorage.setItem(INCLUDE_ANSWERS_KEY, includeAnswers ? "1" : "0");
    } catch {}
  }, [includeAnswers]);
  /** 시험지에 실을 문항 유형(왼쪽에서 고른다). 다음에 열어도 같은 유형으로 시작한다. */
  const [testTypes, setTestTypes] = useState<OnePageTestTypeKey[]>(ALL_ONE_PAGE_TEST_TYPES);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TEST_TYPES_KEY);
      if (!raw) return;
      const keys = (JSON.parse(raw) as string[]).filter((k): k is OnePageTestTypeKey =>
        (ALL_ONE_PAGE_TEST_TYPES as string[]).includes(k)
      );
      setTestTypes(keys);
    } catch {
      /* 저장소를 못 쓰면 전부 */
    }
  }, []);
  const chooseTestTypes = (keys: OnePageTestTypeKey[]) => {
    setTestTypes(keys);
    try {
      window.localStorage.setItem(TEST_TYPES_KEY, JSON.stringify(keys));
    } catch {
      /* 무시 */
    }
  };
  /** PDF로 저장하는 중이면 그 이름(문제지·정답지…) */
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(85);
  const [started, setStarted] = useState(false);
  const scaled = useScaledHeight<HTMLDivElement>(zoom / 100);
  /** 자료 모양(A·B·C). 저장값이 없거나 옛 값("base" 등)이면 A. */
  const [designStyle, setDesignStyle] = useState<OnePageDesignStyle>("a");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DESIGN_STYLE_KEY[mode]);
      if (saved === "a" || saved === "b" || saved === "c") setDesignStyle(saved);
    } catch {
      /* 저장소를 못 쓰면 A */
    }
  }, [mode]);
  const chooseDesignStyle = (style: OnePageDesignStyle) => {
    setDesignStyle(style);
    try {
      window.localStorage.setItem(DESIGN_STYLE_KEY[mode], style);
    } catch {
      /* 무시 */
    }
  };
  const [layoutPick, setLayoutPick] = useState<OnePageSummaryLayout>("classic");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SUMMARY_LAYOUT_KEY);
      if (saved === "classic" || saved === "sentence") setLayoutPick(saved);
    } catch {
      /* 저장소를 못 쓰면 기존 */
    }
  }, []);
  const chooseLayout = (layout: OnePageSummaryLayout) => {
    setLayoutPick(layout);
    try {
      window.localStorage.setItem(SUMMARY_LAYOUT_KEY, layout);
    } catch {
      /* 무시 */
    }
  };
  const summaryLayout = layoutPick;
  /*
   * 모양 글꼴은 늦게 들어와 글자 폭이 달라진다. 한 쪽 맞추기는 잰 높이로 하므로 글꼴이 들어온 뒤
   * 한 번 더 잰다(안 그러면 쪽이 넘치거나 아래가 빈다).
   */
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => alive && setFontsTick((t) => t + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [designStyle]);
  /** 새로 조립한 시험지가 있어 파일에 저장해야 한다. */
  const needSave = useRef(false);
  /** 저장할 시험지. 상태는 렌더 뒤에야 바뀌므로, 조립하는 즉시 여기에도 넣는다. */
  const testsRef = useRef(tests);

  const saveTests = useCallback(async () => {
    const id = docIdRef.current;
    if (mode !== "test" || !id || !needSave.current) return;
    const passages = initialProjects
      .map((p) => testsRef.current[p.id])
      .filter((t): t is OnePageTestPassage => !!t);
    if (passages.length === 0) return;
    needSave.current = false;
    const payload: OnePageTestPayload = { version: 1, createdAt: new Date().toISOString(), passages };
    const res = await postJson<Awaited<ReturnType<typeof saveOnePageTestAction>>>("/api/lesson-materials/one-page", {
      op: "saveTest",
      role,
      id,
      payload,
    });
    if (!res.ok) needSave.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, role]);

  useCreateDocumentFromUrl(
    role,
    mode === "summary" ? "one_page_summary" : "one_page_test",
    initialProjects.map((p) => p.id),
    (id, name) => {
      docIdRef.current = id;
      savedTitle.current = name;
      // 겹치는 이름이면 -2가 붙는다. 만드는 사이에 제목을 고쳤으면 고친 이름으로 바꿔 둔다.
      const typed = titleRef.current.trim();
      if (!typed || typed === startTitle.current) setTitle(name);
      else void commitTitle();
      void saveTests();
    }
  );

  useEffect(() => {
    const id = "one-page-print-page-size-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
    }
    el.textContent = `
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  #one-page-print-root { transform: none !important; gap: 0 !important; }
}
`;
    document.body.appendChild(el);
    return () => {
      el?.remove();
    };
  }, []);

  /** 지문 하나를 준비한다: 재료(없을 때만 만든다), 테스트면 어법·어휘 선택을 불러 시험지를 조립한다. */
  const preparePassage = useCallback(
    async (project: OnePageProjectInput, forceRegenerate: boolean): Promise<string | null> => {
      let content = forceRegenerate ? null : project.content;
      if (!content) {
        const res = await postJson<PrepareResult>("/api/lesson-materials/one-page", {
          role,
          projectId: project.id,
          forceRegenerate,
          kind: mode,
        });
        if (!res.ok) return res.message;
        content = res.content;
        const fresh = content;
        setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, content: fresh } : p)));
      }
      if (mode === "test") {
        // 워크북 어법 선택·어휘 선택: 저장된 문항을 쓰고(차감 없음), 없으면 만든다(각 기능 가격).
        const [grammar, vocab] = await Promise.all([
          // 크레딧 내역에 「1장 테스트지」로 찍히게 어디서 부른 것인지 같이 보낸다
          postJson<GrammarResult>("/api/lesson-materials/grammar-choice", {
            role,
            projectId: project.id,
            usedIn: "one_page_test",
          }),
          postJson<VocabResult>("/api/lesson-materials/vocab-choice", {
            role,
            projectId: project.id,
            usedIn: "one_page_test",
          }),
        ]);
        const passage = buildOnePageTestPassage({
          projectId: project.id,
          title: project.title,
          titleEn: project.titleEn,
          source: project.source,
          sentences: project.sentences,
          content,
          grammarSection: choiceSource(grammar),
          vocabSection: choiceSource(vocab),
        });
        testsRef.current = { ...testsRef.current, [project.id]: passage };
        needSave.current = true;
        setTests((prev) => ({ ...prev, [project.id]: passage }));
      }
      return null;
    },
    [mode, role]
  );

  const runPrepare = useCallback(
    async (targets: OnePageProjectInput[], forceRegenerate: boolean) => {
      if (targets.length === 0) return;
      setPendingIds((prev) => new Set([...prev, ...targets.map((p) => p.id)]));
      setErrors((prev) => {
        const next = { ...prev };
        for (const p of targets) delete next[p.id];
        return next;
      });
      await runWithConcurrency(targets, CONCURRENCY[mode], async (p) => {
        let message: string | null;
        try {
          message = await preparePassage(p, forceRegenerate);
        } catch (e) {
          message = e instanceof Error ? e.message : "만들지 못했습니다.";
        }
        if (message) setErrors((prev) => ({ ...prev, [p.id]: message }));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      });
      await saveTests();
    },
    [mode, preparePassage, saveTests]
  );

  useEffect(() => {
    if (started) return;
    setStarted(true);
    const targets = initialProjects.filter((p) =>
      mode === "summary" ? !p.content : !initialTests(initialProjects, savedTest)[p.id]
    );
    void runPrepare(targets, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewStyle = useMemo(
    (): CSSProperties => ({ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }),
    [zoom]
  );

  const readyCount = projects.filter((p) => (mode === "summary" ? !!p.content : !!tests[p.id])).length;
  const total = projects.length;
  const busy = pendingIds.size > 0;
  const activeProject = projects.find((p) => p.id === active) ?? projects[0];
  const errorList = projects.filter((p) => errors[p.id]);
  /** 지금 만드는 중이 아닌 지문(전체 다시 만들기 대상) */
  const idleProjects = projects.filter((p) => !pendingIds.has(p.id));

  if (projects.length === 0) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Alert variant="error">선택된 자료가 없습니다.</Alert>
      </div>
    );
  }

  if (readyCount === 0 && (busy || !started)) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-slate-100">
        <div className="rounded-2xl bg-white px-8 py-6 text-center shadow">
          <p className="text-sm font-semibold text-slate-800">{MODE_LABEL[mode]}를 만들고 있습니다…</p>
          <p className="mt-1 text-xs text-slate-500">
            {total > 1
              ? `지문 ${total}개 중 ${total - pendingIds.size}개 완료 · 첫 지문이 끝나면 바로 보여 드립니다`
              : mode === "test"
                ? "요약문·T/F·어법·어휘 문항을 준비 중"
                : "요약문·어법 포인트·동의어를 정리 중"}
          </p>
        </div>
      </div>
    );
  }

  function scrollTo(id: string) {
    setActive(id);
    document.getElementById(`op-p-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 화면의 쪽들을 PDF로 내려받는다. part: 문제지(요약자료)·정답지·둘 다 */
  async function savePdf(part: "sheets" | "answers" | "both") {
    const root = document.getElementById("one-page-print-root");
    if (!root) return;
    const sheets = Array.from(root.querySelectorAll<HTMLElement>('[id^="op-p-"] .one-page-a4-sheet'));
    const answers = Array.from(root.querySelectorAll<HTMLElement>("#op-answers .one-page-a4-sheet"));
    const pages = part === "sheets" ? sheets : part === "answers" ? answers : [...sheets, ...answers];
    const partLabel =
      mode === "summary" ? "요약자료" : part === "sheets" ? "문제지" : part === "answers" ? "정답지" : "문제지+정답지";
    const first = projects[0]?.title ?? "";
    const name = title.trim()
      ? pdfFileName(title, partLabel)
      : pdfFileName(MODE_LABEL[mode], projects.length > 1 ? `${first} 외 ${projects.length - 1}개` : first, partLabel);
    setPdfError(null);
    setPdfBusy(`${partLabel} 0/${pages.length}`);
    try {
      await downloadSheetsPdf(pages, name, {
        onProgress: (done, total) => setPdfBusy(`${partLabel} ${done}/${total}`),
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다.");
    } finally {
      setPdfBusy(null);
    }
  }
  const typeCounts: Record<OnePageTestTypeKey, number> = {
    choice: 0, ref: 0, expr: 0, imp: 0, writing: 0, summary: 0, tf: 0,
  };
  for (const t of Object.values(tests)) {
    const c = countOnePageTestTypes(t);
    for (const k of ALL_ONE_PAGE_TEST_TYPES) typeCounts[k] += c[k];
  }
  const typesOn = new Set(testTypes);

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="space-y-2.5 border-b border-slate-100 p-4">
          <CloseSaveButton
            base={base}
            save={async () => {
              // 제목 · 새로 조립한 시험지를 바로 보내고 끝날 때까지 기다린다
              await commitTitle();
              await saveTests();
            }}
            className="text-left text-xs font-semibold text-violet-700"
          />
          <h1 className="flex min-w-0 text-base font-bold text-slate-900">
            <DocumentTitle role={role} fallback={MODE_LABEL[mode]} />
          </h1>
          <label className="block space-y-1">
            <span className="flex items-center justify-between text-[11px] font-bold text-slate-500">
              자료 제목
              {titleState === "saving" ? (
                <span className="font-semibold text-slate-400">저장 중…</span>
              ) : titleState === "saved" ? (
                <span className="font-semibold text-emerald-600">저장됨</span>
              ) : titleState === "error" ? (
                <span className="font-semibold text-rose-600">저장 못 함</span>
              ) : null}
            </span>
            <input
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              value={title}
              maxLength={80}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleState("idle");
              }}
              onBlur={() => void commitTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="자료 제목"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            지문 {total}개 · {busy ? `${readyCount}/${total} 준비됨` : "지문마다 A4 한 쪽"}
          </p>
          {projects.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {projects.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => scrollTo(p.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    p.id === activeProject?.id ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"
                  } ${pendingIds.has(p.id) ? "animate-pulse opacity-60" : ""} ${
                    errors[p.id] ? "ring-1 ring-rose-400" : ""
                  }`}
                  title={pendingIds.has(p.id) ? "만드는 중" : p.title}
                >
                  {String(i + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          {activeProject ? (
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-slate-700">{activeProject.title}</p>
              {activeProject.source?.trim() ? (
                <p className="text-[11px] text-slate-400">{activeProject.source}</p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-500">자료 모양</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {DESIGN_STYLES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={d.hint}
                  onClick={() => chooseDesignStyle(d.id)}
                  className={`rounded-md px-1 py-1.5 text-xs font-bold transition ${
                    designStyle === d.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">{DESIGN_STYLES.find((d) => d.id === designStyle)?.hint}</p>
          </div>
          {mode === "summary" ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-500">버전</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                {SUMMARY_LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => chooseLayout(l.id)}
                    className={`rounded-md px-1 py-1.5 text-xs font-bold transition ${
                      summaryLayout === l.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">{SUMMARY_LAYOUTS.find((l) => l.id === summaryLayout)?.hint}</p>
            </div>
          ) : null}
          {mode === "test" ? (
            <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-violet-900">시험지에 실을 문항</p>
                <span className="text-[11px] font-semibold text-violet-700">
                  {testTypes.length}/{ONE_PAGE_TEST_TYPES.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {ONE_PAGE_TEST_TYPES.map((t) => (
                  <label key={t.key} className="flex min-h-[28px] cursor-pointer items-center gap-2 text-[13px] text-slate-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-violet-600"
                      checked={typesOn.has(t.key)}
                      onChange={() =>
                        chooseTestTypes(
                          ALL_ONE_PAGE_TEST_TYPES.filter((k) => (k === t.key ? !typesOn.has(k) : typesOn.has(k)))
                        )
                      }
                    />
                    <span className="flex-1">{t.label}</span>
                    <span className="text-[11px] text-slate-400">{typeCounts[t.key]}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => chooseTestTypes(ALL_ONE_PAGE_TEST_TYPES)}
                  className="h-8 flex-1 rounded-md border border-violet-300 bg-white text-xs font-semibold text-violet-800"
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  onClick={() => chooseTestTypes([])}
                  className="h-8 flex-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-600"
                >
                  전체 해제
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                문항은 모두 만들어 두었어요. 고른 것만 시험지·정답지에 실립니다(다시 만들지 않아 크레딧이 들지 않아요).
              </p>
              <label className="flex items-center gap-2 border-t border-violet-100 pt-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={includeAnswers}
                  onChange={(e) => setIncludeAnswers(e.target.checked)}
                />
                정답지 함께 인쇄
              </label>
            </div>
          ) : null}
          {errorList.length > 0 ? (
            <Alert variant="error">
              {errorList.map((p) => (
                <span key={p.id} className="block">
                  {String(projects.indexOf(p) + 1).padStart(2, "0")}: {errors[p.id]}
                </span>
              ))}
            </Alert>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4">
          {activeProject ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={pendingIds.has(activeProject.id)}
              onClick={() => {
                if (!window.confirm(`${activeProject.title}\n이 지문의 1장 자료를 새로 만들까요? 크레딧이 차감됩니다.`)) return;
                void runPrepare([activeProject], true);
              }}
            >
              {pendingIds.has(activeProject.id) ? "만드는 중…" : "이 지문 다시 만들기"}
            </Button>
          ) : null}
          {total > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={idleProjects.length === 0}
              onClick={() => {
                // 이미 만드는 중인 지문은 그대로 두고 나머지만 새로 만든다(같은 지문을 두 번 만들어 크레딧이 두 번 나가지 않게).
                const what = busy ? `만드는 중인 지문을 뺀 ${idleProjects.length}개` : `지문 ${total}개 전체`;
                if (!window.confirm(`${what}의 1장 자료를 새로 만들까요?
지문마다 크레딧이 차감됩니다.`)) return;
                void runPrepare(idleProjects, true);
              }}
            >
              전체 다시 만들기 ({idleProjects.length})
            </Button>
          ) : null}
          {errorList.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => void runPrepare(errorList.filter((p) => !pendingIds.has(p.id)), false)}
            >
              못 만든 지문 다시 시도 ({errorList.length})
            </Button>
          ) : null}
          <p className="text-[11px] font-bold text-slate-500">PDF로 저장</p>
          {mode === "test" ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" size="sm" variant="secondary" disabled={busy || !!pdfBusy || readyCount === 0} onClick={() => void savePdf("sheets")}>
                  문제지
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy || !!pdfBusy || readyCount === 0} onClick={() => void savePdf("answers")}>
                  정답지
                </Button>
              </div>
              <Button type="button" size="sm" variant="secondary" className="w-full" disabled={busy || !!pdfBusy || readyCount === 0} onClick={() => void savePdf("both")}>
                문제지 + 정답지 (한 파일)
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="secondary" className="w-full" disabled={busy || !!pdfBusy || readyCount === 0} onClick={() => void savePdf("sheets")}>
              요약자료 PDF
            </Button>
          )}
          {pdfBusy ? <p className="text-[11px] font-semibold text-violet-700">PDF 만드는 중… {pdfBusy}</p> : null}
          {pdfError ? <p className="text-[11px] font-semibold text-rose-600">{pdfError}</p> : null}
          <Button type="button" size="sm" className="w-full" disabled={busy} onClick={() => window.print()}>
            {busy ? `나머지 지문 만드는 중 (${readyCount}/${total})` : "인쇄"}
          </Button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden">
          <span className="mr-2 text-xs font-semibold text-slate-500">A4</span>
          <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setZoom(100)}>
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

        <link rel="stylesheet" href={DESIGN_FONTS_HREF} />
        <div className="flex flex-col items-center p-6 print:block print:p-0">
          <div style={scaled.frameStyle} className="print:!h-auto print:!overflow-visible">
            <div
              ref={scaled.ref}
              id="one-page-print-root"
              className={`flex origin-top flex-col gap-6 print:gap-0 print:!transform-none ${designClass(designStyle)}`}
              style={previewStyle}
            >
              <OnePageSheetList
                mode={mode}
                projects={projects}
                tests={tests}
                logoSrc={logoSrc}
                includeAnswers={includeAnswers}
                designKey={`${designStyle}:${fontsTick}`}
                testTypes={testTypes}
                summaryLayout={summaryLayout}
                placeholder={(p, i) => (
                  <div className="flex h-[60mm] w-[210mm] flex-col items-center justify-center rounded bg-white/70 text-sm text-slate-500 shadow">
                    <span className="font-bold text-slate-700">
                      {String(i + 1).padStart(2, "0")} · {p.title}
                    </span>
                    <span className="mt-1 text-xs">
                      {pendingIds.has(p.id) ? "만들고 있습니다… 끝나면 자동으로 채워집니다." : (errors[p.id] ?? "준비되지 않았습니다.")}
                    </span>
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
