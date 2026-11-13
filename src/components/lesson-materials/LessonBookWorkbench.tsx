"use client";

import { CloseSaveButton } from "@/components/lesson-materials/CloseSaveButton";
import { isPrinting } from "@/lib/print/is-printing";
import { useDocumentName } from "@/components/lesson-materials/useDocumentName";
import { useEffect, useMemo, useRef, useState } from "react";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { postJson } from "@/lib/lesson-materials/post-json";
import { DocumentTitle } from "@/components/lesson-materials/DocumentTitle";
import { useCreateDocumentFromUrl } from "@/components/lesson-materials/open-new-document";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import { watchPageNumbersById } from "@/lib/lesson-materials/page-numbers";
import type {
  loadDrawProjectsAction,
  prepareWorkbookExtrasAction,
} from "@/lib/lesson-materials/test-book-actions";
import { PASSAGE_PREP_CONCURRENCY, buildVocabExam, isTestBookProjectReady, vocabExamRange, type TestBookProjectInput } from "@/lib/lesson-materials/test-book";
import { vocabExamCaps } from "@/components/lesson-materials/test-book/useVocabExamCaps";
import { DEFAULT_LESSON_BOOK_OPTIONS, type LessonBookOptions } from "@/lib/lesson-materials/lesson-book-options";
import { saveLessonPackOptions } from "@/lib/lesson-materials/document-actions";
import {
  AllVocabSheets,
  allVocabRows,
  BlankNoteSheets,
  LessonSheets,
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  TestBookBrand,
  TranslationBackSheets,
  VocabExamAnswerSheets,
  VocabExamSheets,
  VocabSheets,
  partStyle,
} from "@/components/lesson-materials/test-book/TestBookSheets";
import { TRANSLATION_MODES, VocabExamControls, VocabExamRangeControls } from "@/components/lesson-materials/test-book/TestBookControls";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import { useMaterialDesign, type MaterialDesign } from "@/lib/lesson-materials/material-design";
import { RegenMaterials, type RegenPart } from "@/components/lesson-materials/test-book/LessonPackExtras";
import { LessonClassView } from "@/components/lesson-materials/LessonClassView";

type LoadResult = Awaited<ReturnType<typeof loadDrawProjectsAction>>;
type PrepareResult = Awaited<ReturnType<typeof prepareWorkbookExtrasAction>>;

/**
 * 수업용 자료 — 테스트 교재의 「수업용 자료」와 같은 모양으로 새로 만든다(선생님 2026-10-21: 덧붙이지 말고
 * 테스트 교재에서 만들던 수업용 자료 그대로). 전체 단어장 → 지문마다 단어 정리 · 문장별 해석, 백지노트는 골라서.
 * 쪽 틀은 예전 수업용 자료와 같은 #lesson-pack-print-root(전역 인쇄 규칙·최종통합자료가 이 이름을 안다).
 */
const DEFAULT_OPTIONS = DEFAULT_LESSON_BOOK_OPTIONS;
const OPTIONS_KEY = "lesson-book-options";
const PAGE_NUMBER_KEY = "lesson-book-page-numbers";
const PDF_SELECTOR = ":is(.tb-sheet:not(.tb-measure .tb-sheet))";
const CONCURRENCY = PASSAGE_PREP_CONCURRENCY;
const PRINT_CSS = `
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  @page app-print-a4 { size: 210mm 297mm; margin: 0; }
  #lesson-pack-print-root { page: app-print-a4; gap: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; }
  #lesson-pack-print-root .tb-sheet { box-shadow: none !important; }
  .lb-zoom { zoom: 1 !important; }
}
`;

export function LessonBookWorkbench({
  role,
  projects: initialProjects,
  logoSrc = null,
  academyName = "",
  embedded = false,
  design,
  savedOptions = null,
  classView = false,
}: {
  role: "admin" | "teacher";
  projects: TestBookProjectInput[];
  logoSrc?: string | null;
  academyName?: string;
  /** 최종통합자료 안에 쪽만 끼워 넣는다(설정 창·재료 만들기 없이) */
  embedded?: boolean;
  /** 최종통합자료가 고른 디자인(주면 이것을 쓴다) */
  design?: MaterialDesign;
  /** 파일에 저장된 설정(있으면 브라우저 기억보다 먼저) */
  savedOptions?: Partial<LessonBookOptions> | null;
  /** 교사용·학생용 수업 화면을 켠 학원(lesson_class_view) */
  classView?: boolean;
}) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const ids = initialProjects.map((p) => p.id);
  const docIdRef = useRef<string | null>(null);
  /** PDF 저장 이름은 자료 이름으로(선생님 2026-11-06) */
  const docName = useDocumentName(role);
  useEffect(() => {
    docIdRef.current = new URLSearchParams(window.location.search).get("doc");
  }, []);
  useCreateDocumentFromUrl(role, "lesson_pack", ids, (id) => {
    docIdRef.current = id;
    // 새 파일에도 지금 설정을 적어 둔다(통합자료가 파일 설정을 읽는다)
    if (!embedded) void saveLessonPackOptions(role, { id, options: optsRef.current }).catch(() => {});
  });

  const [projects, setProjects] = useState(initialProjects);
  /** 디자인 — 모든 자료가 하나를 같이 쓴다(material-design.ts) */
  const [md, chooseMd] = useMaterialDesign(design);
  const ready = useMemo(() => projects.filter(isTestBookProjectReady), [projects]);
  const missing = projects.filter((p) => !isTestBookProjectReady(p));
  const indexOf = (id: string) => projects.findIndex((p) => p.id === id);

  // ---------------------------------------------------------------- 설정(파일에 저장 — 통합자료도 파일 설정을 읽는다. 저장 전 파일은 이 브라우저 기억)
  const [opts, setOpts] = useState<LessonBookOptions>({ ...DEFAULT_OPTIONS, ...savedOptions });
  const optsRef = useRef(opts);
  const persist = (next: LessonBookOptions) => {
    if (!embedded && docIdRef.current) void saveLessonPackOptions(role, { id: docIdRef.current, options: next }).catch(() => {});
  };
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPTIONS_KEY);
      const local = raw ? (JSON.parse(raw) as Partial<LessonBookOptions>) : {};
      // 파일에 저장된 값이 먼저, 빠진 것은 이 브라우저 기억
      const next = { ...DEFAULT_OPTIONS, ...local, ...savedOptions };
      optsRef.current = next;
      setOpts(next);
      // 파일에 빠진 값이 있으면(옛 파일) 지금 보이는 설정을 파일에 옮겨 둔다
      if (Object.keys(savedOptions ?? {}).length < Object.keys(DEFAULT_OPTIONS).length) persist(next);
    } catch {
      /* 저장소를 못 쓰면 기본 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = (patch: Partial<LessonBookOptions>) => {
    const next = { ...optsRef.current, ...patch };
    optsRef.current = next;
    setOpts(next);
    try {
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
    persist(next);
  };
  const [pageNumbers, setPageNumbers] = useState(true);
  useEffect(() => {
    try {
      setPageNumbers(window.localStorage.getItem(PAGE_NUMBER_KEY) !== "off");
    } catch {
      /* 켠 채로 */
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
  useEffect(() => watchPageNumbersById("lesson-pack-print-root", pageNumbers && !embedded), [pageNumbers, embedded]);

  // 글꼴이 늦게 들어오면 쪽 나눔을 다시 잰다
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

  // ---------------------------------------------------------------- 재료(단어 정리 · 해석) 만들기
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    const res = await postJson<LoadResult>("/api/lesson-materials/test-book", { role, op: "loadDraw", projectIds: ids });
    if (res.ok) setProjects(res.projects);
  };
  async function runPrepare(targets: TestBookProjectInput[], regenerate?: RegenPart[]) {
    if (!targets.length) return;
    let done = 0;
    const failed: string[] = [];
    setError(null);
    setBusy(`${regenerate ? "다시 만들고" : "만들고"} 있습니다… (0/${targets.length})`);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= targets.length) return;
        const p = targets[i]!;
        try {
          const res = await postJson<PrepareResult>("/api/lesson-materials/test-book", {
            role,
            op: "prepareWorkbook",
            projectId: p.id,
            ...(regenerate ? { regenerate } : {}),
          });
          if (!res.ok) failed.push(`「${p.title}」 ${res.message}`);
        } catch (e) {
          failed.push(`「${p.title}」 ${e instanceof Error ? e.message : "만들지 못했습니다."}`);
        }
        done += 1;
        setBusy(`${regenerate ? "다시 만들고" : "만들고"} 있습니다… (${done}/${targets.length})`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setBusy(null);
    if (failed.length) setError(failed.join(" · "));
    await reload();
  }
  async function prepareMissing() {
    if (busy || !missing.length) return;
    const go = await askCreditConfirm({
      title: "수업용 자료",
      description:
        "지문마다 단어 정리(★핵심어 · 품사 · 지문 속 뜻 · 동의어 · 반의어 · 파생어 뜻)와 문장별 해석을 만듭니다. 값은 이것 한 번뿐이고, 한 번 만든 지문은 다시 받지 않습니다. 워크북 새 유형·테스트지·최종통합자료도 같은 재료를 씁니다.",
      subject: `고른 지문 ${missing.length}개`,
      contents: ["전체 단어장", "단어 정리", "문장별 해석", "백지노트"],
      items: [{ feature: "lesson_workbook_extras", quantity: missing.length }],
    });
    if (!go) return;
    await runPrepare(missing);
  }
  // 처음 열면 재료가 없는 지문을 바로 만든다(확인 창을 한 번 띄운다)
  const askedRef = useRef(false);
  useEffect(() => {
    // 새 수업용 자료(classView)는 그 화면이 재료·해설을 함께 묻는다(값 500 하나)
    if (embedded || classView || askedRef.current || !missing.length) return;
    askedRef.current = true;
    void prepareMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- 단어학습 등록
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
        { op: "registerVocab", role, id: docIdRef.current, title: ready[0]?.title ?? "수업용 자료", projectIds: ids }
      );
      if (!res.ok) {
        setVocabReg({ busy: false, msg: res.message, error: true, href: null });
        return;
      }
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

  // ---------------------------------------------------------------- 단어 시험지(맨 뒤, 정답 포함 — 선생님 2026-10-27 「단어장·시험지·구성을 한 탭에서」)
  const [vocabRound, setVocabRound] = useState(0);
  const vocabWordCount = useMemo(() => allVocabRows(ready, () => 0).at(-1)?.no ?? 0, [ready]);
  const vocabRange = useMemo(() => vocabExamRange(opts.vocabFrom, opts.vocabTo, vocabWordCount), [opts.vocabFrom, opts.vocabTo, vocabWordCount]);
  const vocabCaps = useMemo(() => vocabExamCaps(projects, vocabRange), [projects, vocabRange]);
  const vocabExam = useMemo(
    () =>
      opts.vocabTest && !embedded
        ? buildVocabExam(
            ready.map((p) => ({ passage: indexOf(p.id) + 1, vocab: p.material.vocab })),
            { ...opts.vocabExam, seed: `lesson-pack|vocab|${vocabRound}`, range: vocabRange, inOrder: opts.vocabInOrder }
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.vocabTest, opts.vocabExam, opts.vocabInOrder, vocabRange, ready, vocabRound, embedded]
  );

  // ---------------------------------------------------------------- 인쇄 쪽
  const brand = useMemo(() => ({ logoSrc: logoSrc || null, academy: academyName }), [logoSrc, academyName]);
  const mk = `lesson-book|${fontsTick}`;
  const sheets = (
    <TestBookBrand.Provider value={brand}>
      <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
      <style>{TEST_BOOK_CSS}</style>
      {/* A4 용지(없으면 브라우저가 레터로 잡아 한 쪽이 두 장으로 나뉜다) */}
      <style>{PRINT_CSS}</style>
      <div
        id="lesson-pack-print-root"
        className={`tb-theme-${md} flex flex-col items-center gap-6 print:gap-0 [&_.tb-sheet]:shadow-xl print:[&_.tb-sheet]:shadow-none`}
        style={partStyle({ id: "lesson", no: "", en: "LESSON MATERIALS", ko: "수업용 자료", color: "#1d2a8f" })}
      >
        {/* data-toc-sub: 최종통합자료 목차의 세부 항목(지문별 쪽 범위) */}
        {opts.allVocab && ready.length ? (
          <div className="contents" data-toc-sub="전체 단어장">
            <AllVocabSheets projects={ready} indexOf={indexOf} measureKey={mk} />
          </div>
        ) : null}
        {projects.map((p) => (
          <div
            key={p.id}
            className="contents"
            data-toc-sub={`${String(indexOf(p.id) + 1).padStart(2, "0")} ${p.title}`}
            data-toc-note={p.source?.trim() || undefined}
          >
            {isTestBookProjectReady(p) ? (
              <>
                <VocabSheets index={indexOf(p.id)} project={p} measureKey={mk} />
                <LessonSheets index={indexOf(p.id)} project={p} translation={opts.translation} measureKey={`${mk}|${opts.translation}`} />
              </>
            ) : null}
            {opts.blankNote ? <BlankNoteSheets index={indexOf(p.id)} project={p} /> : null}
          </div>
        ))}
        {opts.translation === "back" && ready.length ? (
          <div className="contents" data-toc-sub="해석 모음">
            <TranslationBackSheets projects={ready} measureKey={mk} />
          </div>
        ) : null}
        {vocabExam && vocabExam.total > 0 ? (
          <div className="contents" data-toc-sub="단어 시험">
            <VocabExamSheets exam={vocabExam} measureKey={mk} />
            {opts.vocabAnswers ? <VocabExamAnswerSheets exam={vocabExam} measureKey={mk} /> : null}
          </div>
        ) : null}
      </div>
    </TestBookBrand.Provider>
  );

  const pdf = usePdfSave();
  // 최종통합자료 안(embedded)에서는 통합자료가 한 번에 만든다 — 여기서도 돌면 가려진 채로 빈 PDF를 만들어 서버 일만 늘었다(2026-11-10)
  usePdfPrefetch("lesson-pack-print-root", PDF_SELECTOR, { enabled: !embedded });
  const [zoom, setZoom] = useState(70);

  // 새 수업용 자료(선생님 2026-11-10 「수업용 자료가 애초에 이렇게 나오게, 단어는 단어 탭으로」) — 기능을 켠 학원만
  if (classView)
    return embedded ? (
      <LessonClassView role={role} projects={projects} title={docName ?? ready[0]?.title ?? "수업용 자료"} embedded design={md} brand={brand} />
    ) : (
      <LessonClassView
        role={role}
        projects={projects}
        title={docName ?? ready[0]?.title ?? "수업용 자료"}
        closeSlot={<CloseSaveButton base={base} className="rounded-md px-2 py-1 text-xs font-bold text-white/80 hover:bg-white/10" />}
        design={md}
        brand={brand}
        onPrepared={reload}
      />
    );
  if (embedded) return sheets;

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          {/* 설정(디자인 · 쪽 번호 · 해석 등)은 바꾸는 즉시 저장된다 — 닫을 때 따로 보낼 것이 없다 */}
          <CloseSaveButton base={base} className="-ml-2 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100" />
          <DocumentTitle role={role} fallback="수업용 자료" asField />
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-500">구성</p>
            <label className="flex items-start gap-2 text-[13px] text-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={opts.allVocab} onChange={(e) => update({ allVocab: e.target.checked })} />
              <span>
                전체 단어장
                <span className="block text-[10.5px] text-slate-400">지문 단어를 맨 앞에 한데 모음</span>
              </span>
            </label>
            <div className="flex items-start gap-2 text-[13px] text-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked disabled />
              <span>
                지문마다 단어 정리 · 문장별 해석
                <span className="block text-[10.5px] text-slate-400">★핵심어 · 품사 · 지문 속 뜻 · 동의어 · 반의어 · 파생어 뜻</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {TRANSLATION_MODES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update({ translation: t.id })}
                  className={`rounded-md px-1 py-1.5 text-[11px] font-bold ${opts.translation === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="flex items-start gap-2 text-[13px] text-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={opts.blankNote} onChange={(e) => update({ blankNote: e.target.checked })} />
              <span>
                백지노트
                <span className="block text-[10.5px] text-slate-400">지문마다 2쪽 · 원문 · 동반의어 · 중요 내용 · 오답 다시 쓰기</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[13px] text-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={opts.vocabTest} onChange={(e) => update({ vocabTest: e.target.checked })} />
              <span>
                단어 시험지
                <span className="block text-[10.5px] text-slate-400">맨 뒤 · 영→한 · 한→영 · 동의어 · 반의어 · 파생어</span>
              </span>
            </label>
            {opts.vocabTest ? (
              <div className="space-y-1.5">
                <VocabExamRangeControls
                  wordCount={vocabWordCount}
                  from={opts.vocabFrom}
                  to={opts.vocabTo}
                  inOrder={opts.vocabInOrder}
                  onRange={(vocabFrom, vocabTo) => update({ vocabFrom, vocabTo })}
                  onInOrder={(vocabInOrder) => update({ vocabInOrder })}
                />
                <VocabExamControls value={opts.vocabExam} onChange={(vocabExam) => update({ vocabExam })} caps={vocabCaps} />
                {opts.vocabInOrder ? null : (
                  <button
                    type="button"
                    onClick={() => setVocabRound((r) => r + 1)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-1 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    ↻ 새로 섞기
                  </button>
                )}
                <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-xs font-bold text-slate-500">정답지 넣기</span>
                  <input type="checkbox" checked={opts.vocabAnswers} onChange={(e) => update({ vocabAnswers: e.target.checked })} className="h-4 w-4 accent-violet-500" />
                </label>
              </div>
            ) : null}
          </div>

          <MaterialDesignPicker value={md} onChange={chooseMd} />

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">쪽번호 넣기</span>
            <input type="checkbox" checked={pageNumbers} onChange={(e) => choosePageNumbers(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          </label>

          {missing.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              아직 만들지 않은 지문 {missing.length}개
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void prepareMissing()}
                className="mt-1.5 block w-full rounded-md bg-amber-500 py-1.5 font-bold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                만들기 (지문 {missing.length}개)
              </button>
            </div>
          ) : null}
          {busy ? <p className="text-[12px] font-semibold text-violet-700">{busy}</p> : null}
          {error ? <p className="text-[12px] font-semibold text-rose-600">{error}</p> : null}

          <RegenMaterials
            passages={ready.map((p) => ({ id: p.id, label: `${String(indexOf(p.id) + 1).padStart(2, "0")} · ${p.title}` }))}
            busy={!!busy}
            onRun={(targetIds, parts) => void runPrepare(ready.filter((p) => targetIds.includes(p.id)), parts)}
          />

          <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-xs font-bold text-emerald-900">단어학습 단어장</p>
            <p className="text-[11px] leading-relaxed text-slate-600">
              전체 단어(뜻·품사·동의어·반의어·지문 예문)를 단어학습 단어장으로 넣습니다. 다시 누르면 같은 단어장을 고칩니다.
            </p>
            <button
              type="button"
              disabled={vocabReg.busy || !ready.length}
              onClick={() => void registerVocab()}
              className="w-full rounded-md border border-emerald-300 bg-white py-1.5 text-[12px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {vocabReg.busy ? "등록 중…" : "단어학습에 등록"}
            </button>
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
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700"
          >
            인쇄
          </button>
          <button
            type="button"
            disabled={!!pdf.busy}
            onClick={() =>
              void pdf.save(
                "수업용자료",
                collectPrintPages(document.getElementById("lesson-pack-print-root"), PDF_SELECTOR),
                [docName ?? ready[0]?.title ?? "수업용 자료"]
              )
            }
            className="w-full rounded-xl border border-violet-300 bg-white py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
          >
            ⤓ PDF로 저장
          </button>
          {pdf.status ? (
            <p className={`text-[11px] font-semibold ${pdf.busy ? "text-violet-700" : "text-rose-600"}`}>{pdf.status}</p>
          ) : null}
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
          <div className="lb-zoom" style={{ zoom: zoom / 100 }}>
            {projects.length && !ready.length && !opts.blankNote ? (
              <div className="flex h-[60mm] w-[210mm] items-center justify-center rounded bg-white/70 text-sm text-slate-500 shadow print:hidden">
                {busy ?? "왼쪽에서 「만들기」를 누르면 수업용 자료가 나옵니다."}
              </div>
            ) : null}
            {sheets}
          </div>
        </div>
      </main>
    </div>
  );
}
