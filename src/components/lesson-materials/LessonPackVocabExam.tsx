"use client";

import { useEffect, useMemo, useState } from "react";
import { isPrinting } from "@/lib/print/is-printing";
import { CloseSaveButton } from "@/components/lesson-materials/CloseSaveButton";
import { usePdfPrefetch, usePdfSave } from "@/components/pdf/usePdfSave";
import { collectPrintPages } from "@/lib/pdf/download-sheets-pdf";
import {
  DEFAULT_VOCAB_EXAM,
  VOCAB_EXAM_ALL,
  buildVocabExam,
  isTestBookProjectReady,
  normalizeVocabExam,
  vocabExamRange,
  type TestBookProjectInput,
  type VocabExamOptions,
} from "@/lib/lesson-materials/test-book";
import {
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  AllVocabSheets,
  TestBookBrand,
  TestBookStudent,
  allVocabRows,
  VocabExamAnswerSheets,
  VocabExamSheets,
  partStyle,
} from "@/components/lesson-materials/test-book/TestBookSheets";
import { VocabExamControls, VocabExamRangeControls } from "@/components/lesson-materials/test-book/TestBookControls";
import { vocabExamCaps } from "@/components/lesson-materials/test-book/useVocabExamCaps";
import { MaterialDesignPicker } from "@/components/lesson-materials/MaterialDesignPicker";
import { useMaterialDesign } from "@/lib/lesson-materials/material-design";
import { postJson } from "@/lib/lesson-materials/post-json";
import type { SavedVocabExam } from "@/lib/lesson-materials/vocab-exam-saved";

/**
 * 수업용 자료 파일에서 단어 시험지만 뽑아 찍는다(선생님 2026-10-27: 이름 바꾸기 옆 「단어 시험지」, 워크북처럼
 * 영→한·한→영·동의어·반의어·파생어를 유형마다 문항 수를 정해서). 수업용 자료가 만든 단어 정리를 그대로 쓰므로
 * 값을 받지 않는다. 재료가 없는 지문은 빠진다(수업용 자료를 열면 만든다).
 * 쪽 틀은 수업용 자료와 같은 #lesson-pack-print-root — 전역 인쇄 규칙이 이 이름만 남긴다.
 */
const OPTIONS_KEY = "lesson-pack-vocab-exam";
const PDF_SELECTOR = ":is(.tb-sheet:not(.tb-measure .tb-sheet))";
const PRINT_CSS = `
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  @page app-print-a4 { size: 210mm 297mm; margin: 0; }
  #lesson-pack-print-root { page: app-print-a4; gap: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; }
  #lesson-pack-print-root .tb-sheet { box-shadow: none !important; }
  .lb-zoom { zoom: 1 !important; }
}
`;

export function LessonPackVocabExam({
  role,
  docName,
  projects,
  logoSrc = null,
  academyName = "",
  fromWordSet = false,
  listOnly = false,
  editHref = null,
  examHref = null,
  closeBase = null,
  source = null,
  sourceSub = null,
  docId = null,
  savedExam = null,
  legacyPick = false,
}: {
  role: "admin" | "teacher";
  docName: string;
  projects: TestBookProjectInput[];
  logoSrc?: string | null;
  academyName?: string;
  /** 자료함 「단어」 탭 단어장(지문 하나로 묶어 넘긴다) — 지문 번호를 감춘다 */
  fromWordSet?: boolean;
  /**
   * 단어장만 보여 준다(자료함 「단어」 탭 「목록 보기」, 선생님 2026-10-29) — 수업용 자료 모양 전체 단어장 + 인쇄·PDF.
   * 고치기는 단어학습 편집 화면(editHref)에서 한다.
   */
  listOnly?: boolean;
  editHref?: string | null;
  /** 단어장 화면에서 시험지 화면으로 */
  examHref?: string | null;
  /** 닫으면 돌아갈 곳(기본은 자료함) */
  closeBase?: string | null;
  /** 시험지 오른쪽 위에 찍는 출처(중학교: 「중1 동아(윤정미) 1과」)와 그 아래 줄(과 제목) */
  source?: string | null;
  sourceSub?: string | null;
  /** 수업용 자료 파일: 인쇄·PDF로 뽑은 시험지를 여기에 남겨 다시 열면 그대로 보여 준다(선생님 2026-11-02) */
  docId?: string | null;
  savedExam?: SavedVocabExam | null;
  /** 2026-11-02 전에 만든 파일 — 예전 뽑기로 그때 인쇄한 것과 같은 단어 */
  legacyPick?: boolean;
}) {
  const base = closeBase ?? (role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials");
  const [md, chooseMd] = useMaterialDesign();
  const ready = useMemo(() => projects.filter(isTestBookProjectReady), [projects]);
  const missing = projects.length - ready.length;
  const indexOf = (id: string) => projects.findIndex((p) => p.id === id);
  /** 전체 단어장 번호(지문 차례, 같은 낱말은 한 번) — 출제 범위는 이 번호로 */
  const wordCount = useMemo(() => allVocabRows(ready, () => 0).at(-1)?.no ?? 0, [ready]);

  // 출제 범위는 파일마다 달라 기억하지 않는다(비우면 전체)
  const [rangeFrom, setRangeFrom] = useState(savedExam?.rangeFrom ?? 0);
  const [rangeTo, setRangeTo] = useState(savedExam?.rangeTo ?? 0);
  /** 파일에 남긴 시험지(인쇄·PDF 때 저장)와, 그것을 그대로 보여 주는 중인지 */
  const [saved, setSaved] = useState<SavedVocabExam | null>(savedExam);
  const [pinned, setPinned] = useState(!!savedExam);
  const range = useMemo(() => vocabExamRange(rangeFrom, rangeTo, wordCount), [rangeFrom, rangeTo, wordCount]);
  const caps = useMemo(() => vocabExamCaps(projects, range), [projects, range]);

  // 유형별 문항 수 · 정답지 · 번호순 · 단어장 — 이 브라우저에 기억한다
  const [counts, setCounts] = useState<VocabExamOptions>(savedExam?.counts ?? DEFAULT_VOCAB_EXAM);
  const [answers, setAnswers] = useState(savedExam?.answers ?? true);
  const [inOrder, setInOrder] = useState(savedExam?.inOrder ?? false);
  const [wordList, setWordList] = useState(savedExam?.wordList ?? false);
  useEffect(() => {
    // 저장된 시험지가 있으면 그때 설정 그대로(이 브라우저 기억보다 먼저)
    if (savedExam) return;
    try {
      const raw = window.localStorage.getItem(OPTIONS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { vocabExam?: unknown; answers?: unknown; inOrder?: unknown; wordList?: unknown };
      setCounts(normalizeVocabExam(saved.vocabExam));
      if (typeof saved.answers === "boolean") setAnswers(saved.answers);
      if (typeof saved.inOrder === "boolean") setInOrder(saved.inOrder);
      if (typeof saved.wordList === "boolean") setWordList(saved.wordList);
    } catch {
      /* 저장소를 못 쓰면 기본 */
    }
  }, [savedExam]);
  const settings = { vocabExam: counts, answers, inOrder, wordList };
  const remember = (patch: Partial<typeof settings>) => {
    try {
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify({ ...settings, ...patch }));
    } catch {
      /* 무시 */
    }
  };
  const chooseCounts = (v: VocabExamOptions) => {
    setPinned(false);
    setCounts(v);
    remember({ vocabExam: v });
  };
  const chooseAnswers = (on: boolean) => {
    setAnswers(on);
    remember({ answers: on });
  };
  const chooseInOrder = (on: boolean) => {
    setPinned(false);
    setInOrder(on);
    remember({ inOrder: on });
  };
  const chooseWordList = (on: boolean) => {
    setWordList(on);
    remember({ wordList: on });
  };

  // 「새로 섞기」 — 같은 단어에서 다른 문항·보기 차례로
  const [round, setRound] = useState(savedExam?.round ?? 0);
  /** 시험지·단어장 제목(비우면 「단어 시험」/「전체 단어장」) — 파일마다 달라 기억하지 않는다 */
  const [sheetTitle, setSheetTitle] = useState(savedExam?.title ?? "");
  const examTitle = sheetTitle.trim() || "단어 시험";
  const listTitle = sheetTitle.trim() || "전체 단어장";
  /** 학생 이름: 시험지 「이름」 칸에 찍는다(저장하지 않는다 — 학생마다 바꿔 뽑는다) */
  const [student, setStudent] = useState("");
  const titleField = (
    <>
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{listOnly ? "단어장 제목" : "시험지 제목"}</span>
      <input
        type="text"
        value={sheetTitle}
        onChange={(e) => setSheetTitle(e.target.value)}
        placeholder={listOnly ? "전체 단어장" : "단어 시험"}
        maxLength={40}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
      />
      {source ? (
        <span className="mt-1 block text-[11px] text-slate-400">
          출처: {source}
          {sourceSub ? ` · ${sourceSub}` : ""}
        </span>
      ) : null}
    </label>
    {listOnly ? null : (
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-slate-500">학생 이름</span>
        <input
          type="text"
          value={student}
          onChange={(e) => setStudent(e.target.value)}
          placeholder="비우면 빈칸으로"
          maxLength={20}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
        />
      </label>
    )}
    </>
  );
  const built = useMemo(
    () =>
      buildVocabExam(
        ready.map((p) => ({ passage: projects.indexOf(p) + 1, vocab: p.material.vocab })),
        { ...counts, seed: `lesson-pack|vocab|${round}`, range, inOrder, shareWords: legacyPick }
      ),
    [ready, projects, counts, round, range, inOrder, legacyPick]
  );
  const exam = pinned && saved ? saved.exam : built;

  /** 인쇄·PDF로 뽑을 때 지금 시험지를 파일에 남긴다 — 다음에 열면 이것이 그대로 나온다 */
  const [saveNote, setSaveNote] = useState<string | null>(null);
  async function keepExam() {
    if (!docId || !exam.total) return;
    if (pinned && saved && saved.title === sheetTitle && saved.answers === answers && saved.wordList === wordList) return;
    const next: SavedVocabExam = { exam, counts, inOrder, rangeFrom, rangeTo, round, title: sheetTitle, answers, wordList };
    const res = await postJson<{ ok: true } | { ok: false; message: string }>("/api/lesson-materials/documents/open", {
      op: "saveVocabExam",
      role,
      id: docId,
      saved: next,
    }).catch(() => null);
    if (res && res.ok) {
      setSaved({ ...next, savedAt: new Date().toISOString() });
      setPinned(true);
      setSaveNote(null);
    } else {
      setSaveNote(`시험지를 파일에 저장하지 못했습니다${res && !res.ok ? `: ${res.message}` : ""}. 다시 열면 달라질 수 있어요.`);
    }
  }
  /** 유형마다 고른 수보다 단어가 모자라 덜 나온 것 */
  const short = exam.sections.filter((s) => {
    const want = counts.counts[s.kind] ?? 0;
    return want < VOCAB_EXAM_ALL && s.items.length < want;
  });
  const wanted = Object.values(counts.counts).reduce((n, c) => n + c, 0);

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
  const mk = `lp-vocab-exam|${fontsTick}`;
  const brand = useMemo(() => ({ logoSrc: logoSrc || null, academy: academyName }), [logoSrc, academyName]);

  const pdf = usePdfSave();
  usePdfPrefetch("lesson-pack-print-root", PDF_SELECTOR);
  const [zoom, setZoom] = useState(70);

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-200 print:static print:z-auto print:block print:bg-white">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white print:hidden">
        <div className="space-y-1 border-b border-slate-100 px-4 py-3">
          <CloseSaveButton base={base} label="← 닫기" className="-ml-2 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100" />
          <p className="text-xs font-bold text-violet-700">{listOnly ? "단어장" : "단어 시험지"}</p>
          <p className="truncate text-sm font-bold text-slate-900" title={docName}>
            {docName}
          </p>
          <p className="text-[11px] text-slate-400">
            {listOnly ? `단어 ${wordCount}개` : fromWordSet ? `단어장 ${wordCount}단어로 냅니다` : `지문 ${projects.length}개의 단어를 합쳐 냅니다`}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {listOnly ? (
            <>
              {titleField}
              {editHref ? (
                <a
                  href={editHref}
                  className="block w-full rounded-lg border border-violet-300 bg-violet-50 py-2 text-center text-[13px] font-bold text-violet-800 hover:bg-violet-100"
                >
                  ✎ 단어 고치기
                </a>
              ) : null}
              <p className="text-[11px] leading-snug text-slate-400">
                단어·뜻·품사·동의어·반의어를 고치거나 더하고 지울 수 있어요. 고친 뒤 이 화면을 다시 열면 바로 반영돼요.
              </p>
              {examHref ? (
                <a
                  href={examHref}
                  className="block w-full rounded-lg border border-slate-300 bg-white py-2 text-center text-[13px] font-bold text-slate-700 hover:bg-slate-50"
                >
                  이 단어장으로 시험지 만들기 →
                </a>
              ) : null}
              <MaterialDesignPicker value={md} onChange={chooseMd} />
            </>
          ) : (
          <>
          {docId ? (
            pinned && saved ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-snug text-emerald-900">
                <b>저장된 시험지</b>
                {saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} 인쇄` : ""}
                <span className="block text-[11px] text-emerald-800/80">
                  인쇄했던 시험지·정답지 그대로 나옵니다. 문항 수·범위를 바꾸거나 새로 섞으면 새 시험지가 됩니다.
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
                인쇄하거나 PDF로 저장하면 이 시험지가 파일에 저장되어, 다시 열어도 같은 문제·정답이 나옵니다.
                {saved ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCounts(saved.counts);
                      setInOrder(saved.inOrder);
                      setRangeFrom(saved.rangeFrom);
                      setRangeTo(saved.rangeTo);
                      setRound(saved.round);
                      setSheetTitle(saved.title);
                      setPinned(true);
                    }}
                    className="mt-1.5 block w-full rounded-md border border-emerald-300 bg-white py-1 text-[12px] font-bold text-emerald-800 hover:bg-emerald-50"
                  >
                    ← 저장된 시험지로 돌아가기
                  </button>
                ) : null}
              </div>
            )
          ) : null}
          {titleField}

          <VocabExamRangeControls
            wordCount={wordCount}
            from={rangeFrom}
            to={rangeTo}
            inOrder={inOrder}
            onRange={(from, to) => {
              setPinned(false);
              setRangeFrom(from);
              setRangeTo(to);
            }}
            onInOrder={chooseInOrder}
          />

          <VocabExamControls value={counts} onChange={chooseCounts} caps={caps} />
          {short.length ? (
            <p className="text-[11px] leading-snug text-amber-700">
              단어가 모자라 덜 나온 유형: {short.map((s) => `${s.title} ${s.items.length}문항`).join(" · ")}
            </p>
          ) : null}
          {wanted > 0 && exam.total === 0 && ready.length ? (
            <p className="text-[11px] text-amber-700">고른 유형으로 낼 수 있는 단어가 없습니다.</p>
          ) : null}

          {inOrder ? null : (
            <button
              type="button"
              onClick={() => {
                setPinned(false);
                setRound((r) => r + 1);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
            >
              ↻ 새로 섞기
            </button>
          )}

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">
              전체 단어장 넣기
              <span className="block text-[10.5px] font-normal text-slate-400">번호 붙은 단어 목록(범위만) · 시험지 앞에</span>
            </span>
            <input type="checkbox" checked={wordList} onChange={(e) => chooseWordList(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          </label>

          <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-bold text-slate-500">정답지 넣기</span>
            <input type="checkbox" checked={answers} onChange={(e) => chooseAnswers(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          </label>

          <MaterialDesignPicker value={md} onChange={chooseMd} />

          {missing > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              단어 정리가 없는 지문 {missing}개는 빠집니다. 수업용 자료를 열어 먼저 만들어 주세요.
            </p>
          ) : null}
          </>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4">
          <button
            type="button"
            disabled={listOnly ? !wordCount : !exam.total}
            onClick={() => {
              void keepExam();
              window.print();
            }}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            인쇄
          </button>
          <button
            type="button"
            disabled={!!pdf.busy || (listOnly ? !wordCount : !exam.total)}
            onClick={() => {
              void keepExam();
              void pdf.save(
                `${docName} ${sheetTitle.trim() || (listOnly ? "단어장" : "단어 시험지")}`,
                collectPrintPages(document.getElementById("lesson-pack-print-root"), PDF_SELECTOR),
                [docName]
              );
            }}
            className="w-full rounded-xl border border-violet-300 bg-white py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
          >
            ⤓ PDF로 저장
          </button>
          {saveNote ? <p className="text-[11px] font-semibold text-rose-600">{saveNote}</p> : null}
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
            {!listOnly && !exam.total ? (
              <div className="flex h-[60mm] w-[210mm] items-center justify-center rounded bg-white/70 text-sm text-slate-500 shadow print:hidden">
                {ready.length ? "왼쪽에서 유형별 문항 수를 골라 주세요." : "단어 정리가 있는 지문이 없습니다. 수업용 자료를 먼저 열어 만들어 주세요."}
              </div>
            ) : null}
            <TestBookStudent.Provider value={listOnly ? "" : student.trim()}>
            <TestBookBrand.Provider value={brand}>
              <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
              <style>{TEST_BOOK_CSS}</style>
              <style>{PRINT_CSS}</style>
              <div
                id="lesson-pack-print-root"
                className={`tb-theme-${md} flex flex-col items-center gap-6 print:gap-0 [&_.tb-sheet]:shadow-xl print:[&_.tb-sheet]:shadow-none`}
                style={partStyle({ id: "lesson", no: "", en: "VOCABULARY TEST", ko: "단어 시험", color: "#1d2a8f" })}
              >
                {listOnly ? (
                  <AllVocabSheets projects={ready} indexOf={indexOf} measureKey={mk} noPassage={fromWordSet} title={listTitle} />
                ) : (
                  <>
                    {wordList ? <AllVocabSheets projects={ready} indexOf={indexOf} measureKey={mk} range={range} noPassage={fromWordSet} /> : null}
                    <VocabExamSheets exam={exam} measureKey={mk} title={examTitle} label={source || undefined} right={source ? sourceSub || undefined : undefined} />
                    {answers ? <VocabExamAnswerSheets exam={exam} measureKey={mk} title={`정답 · ${examTitle}`} source={source || undefined} /> : null}
                  </>
                )}
              </div>
            </TestBookBrand.Provider>
            </TestBookStudent.Provider>
          </div>
        </div>
      </main>
    </div>
  );
}
