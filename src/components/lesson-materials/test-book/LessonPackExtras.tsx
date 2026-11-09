"use client";

import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { isPrinting } from "@/lib/print/is-printing";
import { PASSAGE_PREP_CONCURRENCY } from "@/lib/lesson-materials/test-book";

import { useEffect, useMemo, useState } from "react";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { postJson } from "@/lib/lesson-materials/post-json";
import type {
  loadDrawProjectsAction,
  prepareWorkbookExtrasAction,
} from "@/lib/lesson-materials/test-book-actions";
import {
  TEST_BOOK_THEMES,
  buildWordTest,
  isTestBookProjectReady,
  type TestBookOptions,
  type TestBookProjectInput,
  type TestBookTheme,
} from "@/lib/lesson-materials/test-book";
import {
  AllVocabSheets,
  BlankNoteSheets,
  LessonSheets,
  TEST_BOOK_CSS,
  TEST_BOOK_FONTS_HREF,
  TestBookBrand,
  TranslationBackSheets,
  VocabSheets,
  WordTestSheets,
  partStyle,
} from "@/components/lesson-materials/test-book/TestBookSheets";
import { TRANSLATION_MODES } from "@/components/lesson-materials/test-book/TestBookControls";

type LoadResult = Awaited<ReturnType<typeof loadDrawProjectsAction>>;
type PrepareResult = Awaited<ReturnType<typeof prepareWorkbookExtrasAction>>;

/**
 * 수업용 자료에 더하는 테스트 교재 자료(선생님 2026-10-21: 수업용 자료 제작에도 테스트북 기능을, 백지노트도).
 * 학습 계획표는 넣지 않는다(선생님 2026-10-21 — 계획표는 최종통합자료에서 워크북을 보고 만든다).
 * 수업용 자료 쪽들 뒤에 전체 단어장 → 지문마다(단어 정리 · 해석 쓰기 · 동반의어·품사 TEST · 백지노트)를 붙인다.
 * 켜고 끄는 것은 수업용 자료 모양처럼 이 브라우저에 기억한다.
 */
export type LessonPackExtrasOptions = {
  allVocab: boolean;
  wordNote: boolean;
  lessonWrite: boolean;
  translation: TestBookOptions["translation"];
  wordTest: boolean;
  blankNote: boolean;
  theme: TestBookTheme;
};

export const DEFAULT_LESSON_PACK_EXTRAS: LessonPackExtrasOptions = {
  allVocab: false,
  wordNote: false,
  lessonWrite: false,
  translation: "hide",
  wordTest: false,
  blankNote: false,
  theme: "b",
};

const EXTRAS_KEY = "lesson-pack-test-book-extras";

export function useLessonPackExtras() {
  const [opts, setOpts] = useState<LessonPackExtrasOptions>(DEFAULT_LESSON_PACK_EXTRAS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXTRAS_KEY);
      if (raw) setOpts({ ...DEFAULT_LESSON_PACK_EXTRAS, ...(JSON.parse(raw) as Partial<LessonPackExtrasOptions>) });
    } catch {
      /* 저장소를 못 쓰면 끈 채로 */
    }
  }, []);
  const update = (patch: Partial<LessonPackExtrasOptions>) =>
    setOpts((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(EXTRAS_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
  const any = opts.allVocab || opts.wordNote || opts.lessonWrite || opts.wordTest || opts.blankNote;
  return { opts, update, any };
}

/** 지문 재료(1장 자료·단어 정리)를 불러오고, 없는 지문은 만들기(지문당 한 번 값) */
export function useExtrasProjects(role: "admin" | "teacher", projectIds: string[], enabled: boolean) {
  const [projects, setProjects] = useState<TestBookProjectInput[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = projectIds.join(",");
  const load = async () => {
    const res = await postJson<LoadResult>("/api/lesson-materials/test-book", { role, op: "loadDraw", projectIds });
    if (res.ok) setProjects(res.projects);
    else setError(res.message);
  };
  useEffect(() => {
    if (!enabled || !projectIds.length || projects) return;
    void load().catch((e) => setError(e instanceof Error ? e.message : "지문을 불러오지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  const missing = (projects ?? []).filter((p) => !isTestBookProjectReady(p));
  async function prepareMissing() {
    if (busy || !missing.length) return;
    const go = await askCreditConfirm({
      title: "테스트 교재 자료",
      description: "지문마다 단어 정리(품사·지문 속 뜻·파생어·동반의어)와 테스트 재료를 만듭니다. 이미 값을 낸 지문은 다시 받지 않습니다.",
      subject: `재료가 없는 지문 ${missing.length}개`,
      contents: missing.map((p) => p.title),
      items: [{ feature: "lesson_workbook_extras", quantity: missing.length }],
    });
    if (!go) return;
    const failed: string[] = [];
    let done = 0;
    setBusy(`재료를 만들고 있습니다… (0/${missing.length})`);
    await runWithConcurrency(missing, PASSAGE_PREP_CONCURRENCY, async (p) => {
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
      setBusy(`재료를 만들고 있습니다… (${++done}/${missing.length})`);
    });
    setBusy(null);
    setError(failed.length ? failed.join(" · ") : null);
    await load();
  }
  /** 기능마다 다시 만들기(테스트 교재와 같다) — 단어 정리·직독직해·1장 자료 재료는 값 없음 */
  async function regenerate(ids: string[], parts: RegenPart[]) {
    if (busy || !ids.length || !parts.length) return;
    const failed: string[] = [];
    let done = 0;
    setBusy(`다시 만들고 있습니다… (0/${ids.length})`);
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
      setBusy(`다시 만들고 있습니다… (${++done}/${ids.length})`);
    });
    setBusy(null);
    setError(failed.length ? failed.join(" · ") : null);
    await load();
  }
  return { projects, missing, busy, error, prepareMissing, regenerate };
}

export type RegenPart = "vocab" | "gloss" | "content";
const REGEN_PARTS: Array<{ key: RegenPart; label: string }> = [
  { key: "vocab", label: "단어 정리(뜻·동반의어·파생어)" },
  { key: "gloss", label: "직독직해" },
  { key: "content", label: "1장 자료 재료(동반의어·T/F·지칭·함축·흐름)" },
];

/** 기능마다 다시 만들기 — 지문 하나 또는 전체, 고른 것만(값 없음). 어법·분석서는 워크북·분석서에서 다시 만든다. */
export function RegenMaterials({
  passages,
  busy,
  onRun,
}: {
  passages: Array<{ id: string; label: string }>;
  busy: boolean;
  onRun: (ids: string[], parts: RegenPart[]) => void;
}) {
  const [target, setTarget] = useState("all");
  const [parts, setParts] = useState<Set<RegenPart>>(() => new Set());
  if (!passages.length) return null;
  return (
    <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2">
      <p className="text-[11px] font-bold text-slate-500">재료 다시 만들기 (값 없음)</p>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[12px]">
        <option value="all">지문 전체</option>
        {passages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {REGEN_PARTS.map((x) => (
        <label key={x.key} className="flex items-center gap-2 text-[12px] text-slate-700">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-violet-600"
            checked={parts.has(x.key)}
            onChange={() =>
              setParts((prev) => {
                const next = new Set(prev);
                if (next.has(x.key)) next.delete(x.key);
                else next.add(x.key);
                return next;
              })
            }
          />
          {x.label}
        </label>
      ))}
      <button
        type="button"
        disabled={busy || !parts.size}
        onClick={() => onRun(target === "all" ? passages.map((p) => p.id) : [target], REGEN_PARTS.map((x) => x.key).filter((k) => parts.has(k)))}
        className="w-full rounded-md border border-slate-300 bg-white py-1 text-[12px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        다시 만들기
      </button>
    </div>
  );
}

/** 설정 창 칸 */
export function LessonPackExtrasControls({
  opts,
  update,
  projects,
  missing,
  busy,
  error,
  onPrepare,
  onRegenerate,
}: {
  opts: LessonPackExtrasOptions;
  update: (patch: Partial<LessonPackExtrasOptions>) => void;
  projects: TestBookProjectInput[];
  missing: TestBookProjectInput[];
  busy: string | null;
  error: string | null;
  onPrepare: () => void;
  onRegenerate: (ids: string[], parts: RegenPart[]) => void;
}) {
  const rows: Array<[keyof LessonPackExtrasOptions, string, string]> = [
    ["allVocab", "전체 단어장", "지문 단어를 한데 모음"],
    ["wordNote", "단어 정리", "품사 · 지문 속 뜻 · 파생어 · 동반의어"],
    ["lessonWrite", "문장별 해석 쓰기", "해석을 지우거나 뒤로 모아 직접 써 보기"],
    ["wordTest", "동반의어 · 품사 TEST", "지문마다"],
    ["blankNote", "백지노트", "지문마다 2쪽"],
  ];
  const any = rows.some(([k]) => opts[k] === true);
  return (
    <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <p className="text-xs font-bold text-violet-900">테스트 교재 자료 더하기</p>
      <p className="text-[11px] leading-snug text-slate-500">수업용 자료 뒤에 붙습니다.</p>
      {rows.map(([k, label, hint]) => (
        <label key={k} className="flex items-start gap-2 text-[13px] text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-violet-600"
            checked={opts[k] === true}
            onChange={(e) => update({ [k]: e.target.checked } as Partial<LessonPackExtrasOptions>)}
          />
          <span>
            {label}
            <span className="block text-[10.5px] text-slate-400">{hint}</span>
          </span>
        </label>
      ))}
      {opts.lessonWrite ? (
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-1">
          {TRANSLATION_MODES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => update({ translation: t.id })}
              className={`rounded-md px-1 py-1 text-[11px] font-bold ${opts.translation === t.id ? "bg-violet-600 text-white" : "text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {any ? (
        <div className="grid grid-cols-2 gap-1 pt-1">
          {TEST_BOOK_THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => update({ theme: t.key })}
              className={`rounded-md border px-1 py-1 text-[11px] font-bold ${
                opts.theme === t.key ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {any && missing.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          재료가 없는 지문 {missing.length}개는 빠집니다(백지노트는 들어감).
          <button
            type="button"
            disabled={!!busy}
            onClick={onPrepare}
            className="mt-1 block w-full rounded bg-amber-500 py-1 font-bold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {busy ?? `재료 만들기 (지문 ${missing.length}개)`}
          </button>
        </div>
      ) : null}
      {any ? (
        <RegenMaterials
          passages={projects
            .filter(isTestBookProjectReady)
            .map((p) => ({ id: p.id, label: `${String(projects.indexOf(p) + 1).padStart(2, "0")} · ${p.title}` }))}
          busy={!!busy}
          onRun={onRegenerate}
        />
      ) : null}
      {busy && !missing.length ? <p className="text-[11px] text-violet-700">{busy}</p> : null}
      {error ? <p className="text-[11px] font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}

/** 인쇄 쪽 */
export function LessonPackExtrasSheets({
  projects,
  opts,
  logoSrc,
  academy = "",
}: {
  projects: TestBookProjectInput[];
  opts: LessonPackExtrasOptions;
  logoSrc?: string | null;
  academy?: string;
}) {
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
  const ready = useMemo(() => projects.filter(isTestBookProjectReady), [projects]);
  const words = useMemo(() => new Map(ready.map((p) => [p.id, buildWordTest(p, "book")] as const)), [ready]);
  const brand = useMemo(() => ({ logoSrc: logoSrc || null, academy }), [logoSrc, academy]);
  const indexOf = (id: string) => projects.findIndex((p) => p.id === id);
  const mk = `lp-extras|${fontsTick}`;
  const style = partStyle({ id: "lesson", no: "", en: "LESSON", ko: "수업용 자료", color: "#1d2a8f" });
  return (
    <TestBookBrand.Provider value={brand}>
      <link rel="stylesheet" href={TEST_BOOK_FONTS_HREF} />
      <style>{TEST_BOOK_CSS}</style>
      <div className={`tb-theme-${opts.theme} contents`} style={style}>
        {opts.allVocab && ready.length ? <AllVocabSheets projects={ready} indexOf={indexOf} measureKey={mk} /> : null}
        {projects.map((p) => {
          const ok = isTestBookProjectReady(p);
          return (
            <div key={p.id} className="contents">
              {opts.wordNote && ok ? <VocabSheets index={indexOf(p.id)} project={p} measureKey={mk} /> : null}
              {opts.lessonWrite && ok ? (
                <LessonSheets index={indexOf(p.id)} project={p} translation={opts.translation} measureKey={`${mk}|${opts.translation}`} />
              ) : null}
              {opts.wordTest && ok ? (
                <WordTestSheets index={indexOf(p.id)} project={p} test={words.get(p.id)!} measureKey={mk} />
              ) : null}
              {opts.blankNote ? <BlankNoteSheets index={indexOf(p.id)} project={p} /> : null}
            </div>
          );
        })}
        {opts.lessonWrite && opts.translation === "back" && ready.length ? (
          <TranslationBackSheets projects={ready} measureKey={mk} />
        ) : null}
      </div>
    </TestBookBrand.Provider>
  );
}
