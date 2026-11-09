"use client";

import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { PASSAGE_PREP_CONCURRENCY } from "@/lib/lesson-materials/test-book";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { askCreditConfirm } from "@/lib/credits/confirm-store";
import { postJson } from "@/lib/lesson-materials/post-json";
import type {
  loadDrawProjectsAction,
  prepareWorkbookExtrasAction,
} from "@/lib/lesson-materials/test-book-actions";
import {
  BASIC_TEST_BOOK_TYPES,
  TEST_BOOK_TYPES,
  VOCAB_EXAM_KINDS,
  type TestLimits,
  type TestSheet,
  buildTestSheet,
  buildVocabExam,
  isTestBookProjectReady,
  testBookTypeLabel,
  testDrawUnits,
  type BlankMode,
  type LineMode,
  type TestBookProjectInput,
  type TestBookTypeKey,
  type TestLevel,
  type VocabExamOptions,
  type WritingScope,
} from "@/lib/lesson-materials/test-book";
import {
  LevelSwitch,
  LineModeSwitch,
  TypeChecks,
  VocabExamControls,
  WritingScopeSwitch,
} from "@/components/lesson-materials/test-book/TestBookControls";

type LoadResult = Awaited<ReturnType<typeof loadDrawProjectsAction>>;

/*
 * 자동 뽑기 기준(선생님 2026-10-21 확정): 분량에 따라 지문당 유형 수와 유형마다 지문당 문항 상한.
 * 유형은 고른 것을 섞어 지문마다 차례로 나눠 준다(골고루, 한 지문에 같은 유형 두 번 없음).
 * 요약문·도식화·제목·요지·문장 순서 배열은 지문 하나 통째(1세트)다. 연결어는 빈칸 수, 글의 순서·삽입은 지문당 문항 수를 고른다.
 * 어법선택은 상한 없이 워크북 자리를 전부 싣는다(선생님 2026-10-26: 3~6자리는 빈약하다).
 */
type AutoSize = "short" | "normal" | "long";
const AUTO: Record<AutoSize, { label: string; perPassage: number; vocab: number; limits: TestLimits }> = {
  short: {
    label: "짧게",
    perPassage: 2,
    vocab: 3,
    limits: { line: 2, writing: 1, order: 1, wordOrder: 2, blank: 3, vocab: 3, grammarFix: 2, vocabFix: 2, tf: 3, reference: 1, implication: 1 },
  },
  normal: {
    label: "보통",
    perPassage: 3,
    vocab: 5,
    limits: { line: 3, writing: 2, order: 2, wordOrder: 3, blank: 5, vocab: 4, grammarFix: 3, vocabFix: 3, tf: 4, reference: 2, implication: 2 },
  },
  long: {
    label: "길게",
    perPassage: 4,
    vocab: 8,
    limits: { line: 4, writing: 3, order: 3, wordOrder: 4, blank: 7, vocab: 6, grammarFix: 4, vocabFix: 4, tf: 5 },
  },
};
/** 기준표 줄 */
const LIMIT_ROWS: Array<{ key: TestBookTypeKey; label: string; unit: string; how: string }> = [
  { key: "line", label: "해석 적기", unit: "문장", how: "중요문장 먼저" },
  { key: "tf", label: "T/F 문제", unit: "문항", how: "무작위" },
  { key: "blank", label: "빈칸 채우기", unit: "칸", how: "무작위" },
  { key: "grammar", label: "어법 선택", unit: "자리", how: "워크북 자리 전부" },
  { key: "grammarFix", label: "어법 수정", unit: "문항", how: "워크북 어법 자리 · 선택과 안 겹침" },
  { key: "vocab", label: "어휘 선택", unit: "자리", how: "무작위" },
  { key: "vocabFix", label: "어휘 수정", unit: "문항", how: "어휘 자리 · 선택과 안 겹침" },
  { key: "wordOrder", label: "어순배열 영작", unit: "문장", how: "중요문장 먼저" },
  { key: "order", label: "중요문장 어순배열", unit: "문장", how: "단원문법·어려운 구문 먼저" },
  { key: "writing", label: "통문장 영작", unit: "문장", how: "중요문장 먼저" },
  { key: "reference", label: "지칭추론·함축의미", unit: "개", how: "무작위" },
];
/** 예상 시간(초) — 문항마다, 통째 유형은 세트마다 */
const SECONDS: Partial<Record<TestBookTypeKey, number>> = {
  line: 60, writing: 90, order: 60, wordOrder: 60, blank: 20, grammar: 15, vocab: 15, grammarFix: 40, vocabFix: 40, tf: 20, reference: 40, implication: 60, gist: 60,
};
const SET_SECONDS: Partial<Record<TestBookTypeKey, number>> = { link: 60, sequence: 90, insert: 60, summary: 60, flow: 90, sentenceOrder: 120 };
/** 지문 전체가 한 문항인 유형은 개수를 따로 고르지 않는다. */
const WHOLE_PASSAGE_TYPES = new Set<TestBookTypeKey>(["summary", "flow", "gist", "sentenceOrder"]);
/** 지문 통째 유형이라 「가능한 만큼」 없이 1문항부터 고른다(기본 1문항) */
const SET_COUNT_TYPES = new Set<TestBookTypeKey>(["sequence", "insert"]);
const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const SET_COUNT_OPTIONS = [1, 2, 3] as const;
function estimateMinutes(sheets: TestSheet[], vocabItems: number): number {
  let sec = vocabItems * 10;
  for (const sh of sheets)
    for (const s of sh.sections) sec += SET_SECONDS[s.type] ?? (SECONDS[s.type] ?? 30) * s.items.length;
  return Math.max(1, Math.round(sec / 60));
}
/** 고른 유형을 열쇠로 섞어 지문마다 차례로 k개씩(골고루, 같은 열쇠면 같은 배정) */
/**
 * 지문마다 실을 유형(선생님 2026-11-06 「해석 적기·빈칸·T/F가 한 지문에만 몰린다 — 고른 유형은 여러 지문에서 고루」):
 * 문장·자리 단위 유형(해석·빈칸·T/F·어순배열·영작·어법·어휘 등)은 고른 지문 모두에 싣고, 대신 지문당 문항 수를 줄여
 * 전체 분량을 예전(지문마다 유형 몇 개씩 돌려 주던 때)과 비슷하게 맞춘다(share). 지문 통째 유형(요약문·도식화·제목·요지·
 * 글의 순서·삽입·문장 순서·연결어)은 지문마다 하나씩 돌려 준다.
 */
function assignTypes(ids: string[], types: TestBookTypeKey[], k: number, seed: string): { picks: Record<string, TestBookTypeKey[]>; share: number } {
  const isSet = (t: TestBookTypeKey) => WHOLE_PASSAGE_TYPES.has(t) || SET_COUNT_TYPES.has(t) || t === "link";
  const pinned: TestBookTypeKey[] = types.filter((type) => type === "grammar" || type === "vocab");
  const spread = types.filter((t) => !pinned.includes(t) && !isSet(t));
  const sets = types.filter((t) => !pinned.includes(t) && isSet(t));
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (let i = sets.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [sets[i], sets[j]] = [sets[j]!, sets[i]!];
  }
  // 예전에는 지문마다 (k - 고정 유형) 개만 돌려 받았다 — 그만큼의 비율로 지문당 문항 수를 줄인다
  const slots = Math.max(1, Math.min(Math.max(k, pinned.length), types.length) - pinned.length);
  const share = Math.min(1, slots / Math.max(1, spread.length + sets.length));
  const out: Record<string, TestBookTypeKey[]> = {};
  ids.forEach((id, i) => {
    const picked: TestBookTypeKey[] = [...pinned, ...spread];
    if (sets.length) picked.push(sets[i % sets.length]!);
    out[id] = TEST_BOOK_TYPES.map((x) => x.key).filter((t) => picked.includes(t));
  });
  return { picks: out, share };
}
type PrepareResult = Awaited<ReturnType<typeof prepareWorkbookExtrasAction>>;

function newSeed(): string {
  return `draw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 테스트지 뽑기 창 — 워크북·최종통합자료가 같이 쓴다(선생님 2026-10-21: 테스트 교재를 합치며 뽑기는 둘 다).
 * 고른 지문·유형으로 새로 섞어 뽑고(지문 × 유형마다 값), 뽑은 그대로 「뽑은 테스트지」 파일로 저장해 새 탭에서 연다.
 * 재료(1장 자료·단어 정리)가 없는 지문은 먼저 만든다(지문당 한 번 값, 워크북 새 유형과 같은 재료).
 */
export function TestDrawDialog({
  role,
  projectIds,
  docName = null,
  open,
  onClose,
}: {
  role: "admin" | "teacher";
  projectIds: string[];
  /** 뽑기를 연 자료 파일 이름 — 뽑은 테스트지를 이 이름으로 저장한다 */
  docName?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const [projects, setProjects] = useState<TestBookProjectInput[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<TestBookTypeKey[]>(BASIC_TEST_BOOK_TYPES);
  const [blankMode, setBlankMode] = useState<BlankMode>("diff");
  const [level, setLevel] = useState<TestLevel>("basic");
  const [lineMode, setLineMode] = useState<LineMode>("full");
  const [writing, setWriting] = useState<WritingScope>("all");
  const [vocabOn, setVocabOn] = useState(true);
  const [vocab, setVocab] = useState<VocabExamOptions>(() => ({
    counts: Object.fromEntries(VOCAB_EXAM_KINDS.map((kind) => [kind.key, AUTO.normal.vocab])) as VocabExamOptions["counts"],
  }));
  const [busy, setBusy] = useState<string | null>(null);
  /** 자동 뽑기(기준대로 무작위) · 전부 뽑기(고른 유형 전부) */
  const [mode, setMode] = useState<"auto" | "all">("auto");
  const [size, setSize] = useState<AutoSize>("normal");
  /** 유형별 지문당 최대 문항 수. 재료가 적으면 실제 가능한 개수로 자동으로 줄어든다. */
  const [limits, setLimits] = useState<TestLimits>({ ...AUTO.normal.limits });
  const [showRule, setShowRule] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean; href?: string } | null>(null);
  const idsKey = projectIds.join(",");

  const load = async () => {
    setLoadError(null);
    const res = await postJson<LoadResult>("/api/lesson-materials/test-book", { role, op: "loadDraw", projectIds });
    if (!res.ok) {
      setLoadError(res.message);
      return;
    }
    setProjects(res.projects);
    setPicked(new Set(res.projects.filter(isTestBookProjectReady).map((p) => p.id)));
  };
  useEffect(() => {
    if (!open || !projectIds.length) return;
    setProjects(null);
    setMessage(null);
    void load().catch((e) => setLoadError(e instanceof Error ? e.message : "지문을 불러오지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  if (!open) return null;
  const list = projects ?? [];
  const ready = list.filter(isTestBookProjectReady);
  const missing = list.filter((p) => !isTestBookProjectReady(p));
  const indexOf = (id: string) => list.findIndex((p) => p.id === id);
  const chosen = ready.filter((p) => picked.has(p.id));
  const changeTypes = (next: TestBookTypeKey[]) => {
    setLimits((prev) => {
      const updated = { ...prev };
      for (const type of next) {
        if (!WHOLE_PASSAGE_TYPES.has(type) && !SET_COUNT_TYPES.has(type) && type !== "link" && type !== "grammar" && updated[type] == null) {
          updated[type] = AUTO[size].limits[type] ?? 3;
        }
      }
      return updated;
    });
    setTypes(next);
  };

  async function prepareMissing() {
    if (busy || !missing.length) return;
    const go = await askCreditConfirm({
      title: "테스트지 재료",
      description: "지문마다 테스트지에 쓰는 재료(단어 정리·지칭·함축·요약 등)를 만듭니다. 이미 값을 낸 지문은 다시 받지 않습니다.",
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
    if (failed.length) setMessage({ text: failed.join(" · "), error: true });
    await load();
  }

  /** 뽑을 시험지(자동이면 지문마다 유형을 나누고 상한을 건다) */
  function makeSnapshot(seed: string) {
    const auto = mode === "auto";
    const preset = AUTO[size];
    const assigned = auto ? assignTypes(chosen.map((p) => p.id), types, preset.perPassage, seed) : null;
    const picks = assigned ? assigned.picks : Object.fromEntries(chosen.map((p) => [p.id, types] as const));
    // 자동이면 모든 지문에 싣는 유형의 지문당 문항 수를 비율만큼 줄인다(최소 1)
    const useLimits: TestLimits = { ...limits };
    if (assigned && assigned.share < 1) {
      for (const [t, n] of Object.entries(limits) as Array<[TestBookTypeKey, number | undefined]>) {
        if (typeof n === "number" && n > 0) useLimits[t] = Math.max(1, Math.round(n * assigned.share));
      }
    }
    const vocabOpts = vocab;
    return {
      sheets: chosen.map((p) => ({
        project: { id: p.id, index: indexOf(p.id), title: p.title, titleEn: p.titleEn, source: p.source },
        sheet: buildTestSheet(p, picks[p.id]!, { seed, blankMode, writing, lineMode, level, limits: useLimits }),
      })),
      vocabExam: vocabOn
        ? buildVocabExam(
            chosen.map((p) => ({ passage: indexOf(p.id) + 1, vocab: p.material.vocab })),
            { ...vocabOpts, seed: `${seed}|vocab` }
          )
        : null,
    };
  }
  // 예상 시간·문항 수(열쇠 하나로 미리 조립해 본다 — 실제 뽑기는 조합이 달라도 분량은 비슷하다)
  const preview = (() => {
    if (!chosen.length || !types.length) return null;
    const snap = makeSnapshot("preview");
    const items = snap.sheets.reduce((n, s) => n + s.sheet.sections.reduce((m, x) => m + x.items.length, 0), 0);
    return { minutes: estimateMinutes(snap.sheets.map((s) => s.sheet), snap.vocabExam?.total ?? 0), items, vocab: snap.vocabExam?.total ?? 0 };
  })();

  async function runDraw() {
    if (busy || !chosen.length || !types.length) return;
    const perPassage = mode === "auto" ? Math.min(AUTO[size].perPassage, types.length) : types.length;
    const typeCount = perPassage + (vocabOn ? 1 : 0);
    // 값은 뽑은 문항으로 센다(문항 1 · 세트 3 · 단어 시험 지문당 3) — 확인 창과 서버가 같은 시험지를 센다
    const seed = newSeed();
    const snapshot = makeSnapshot(seed);
    const count = testDrawUnits(snapshot.sheets.map((s) => s.sheet), snapshot.vocabExam ? chosen.length : 0);
    const go = await askCreditConfirm({
      title: "테스트지 뽑기",
      description: "고른 지문과 유형으로 테스트지를 새로 뽑습니다. 누를 때마다 문항·보기 순서가 새로 나옵니다.",
      subject: `지문 ${chosen.length}개 · 문항 ${count.items}개 · 세트 ${count.sets}개${snapshot.vocabExam ? " · 단어 시험" : ""}${mode === "auto" ? ` (자동 뽑기 · ${AUTO[size].label})` : ""}`,
      contents: [...types.map((t) => testBookTypeLabel(t)), ...(vocabOn ? ["단어 시험지"] : [])],
      items: [{ feature: "lesson_test_draw", quantity: count.units }],
      sample: "one_page_test",
    });
    if (!go) return;
    // 새 탭은 누른 순간 열어 둔다(응답 뒤에 열면 팝업 차단에 걸린다)
    const tab = window.open("", "_blank");
    setBusy("뽑는 중…");
    setMessage(null);
    try {
      const res = await postJson<{ ok: true; docId: string | null; name: string | null } | { ok: false; message: string }>(
        "/api/lesson-materials/test-book",
        { op: "chargeDraw", role, seed, projectIds: chosen.map((p) => p.id), typeCount, snapshot, name: docName }
      );
      if (!res.ok) {
        tab?.close();
        setMessage({ text: res.message, error: true });
      } else if (res.docId) {
        const href = `${base}/test-book?doc=${encodeURIComponent(res.docId)}`;
        if (tab) tab.location.href = href;
        setMessage({ text: `「${res.name ?? "테스트지"}」로 저장했습니다 · 자료함 「뽑은 테스트지」에서 다시 열 수 있습니다.`, error: false, href });
      } else {
        tab?.close();
        setMessage({ text: "뽑았지만 파일로 저장하지 못했습니다. 다시 눌러 주세요.", error: true });
      }
    } catch (e) {
      tab?.close();
      setMessage({ text: e instanceof Error ? e.message : "뽑지 못했습니다.", error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4 print:hidden" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-base font-black text-slate-900">테스트지 뽑기</p>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
            닫기
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-500">범위</p>
              {loadError ? <p className="text-[12px] font-semibold text-rose-600">{loadError}</p> : null}
              {!projects && !loadError ? <p className="text-[12px] text-slate-500">지문을 불러오고 있습니다…</p> : null}
              {list.map((p, i) => {
                const ok = isTestBookProjectReady(p);
                return (
                  <label key={p.id} className="flex min-h-[26px] items-center gap-2 py-0.5 text-[13px] text-slate-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-violet-600"
                      disabled={!ok}
                      checked={picked.has(p.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })
                      }
                    />
                    {/* 제목과 출처를 함께(선생님 2026-11-09: 제목만으로는 어느 지문인지 고르기 어렵다) */}
                    <span className="min-w-0 flex-1" title={p.source ? `${p.title} · ${p.source}` : p.title}>
                      <span className="block truncate">
                        {String(i + 1).padStart(2, "0")} {p.title}
                      </span>
                      {p.source?.trim() ? (
                        <span className="block truncate pl-[1.4em] text-[11px] font-medium text-slate-500">{p.source.trim()}</span>
                      ) : null}
                    </span>
                    {!ok ? <span className="shrink-0 text-[10px] font-semibold text-amber-600">재료 없음</span> : null}
                  </label>
                );
              })}
              {missing.length ? (
                <Button type="button" size="sm" variant="secondary" className="mt-1 w-full" disabled={!!busy} onClick={() => void prepareMissing()}>
                  재료 만들기 (지문 {missing.length}개)
                </Button>
              ) : null}
            </div>
            <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <p className="text-xs font-bold text-violet-900">
                {mode === "auto" ? "유형 (이 가운데서 지문마다 골고루 뽑음)" : "유형 (고른 유형을 모두 싣고, 문항은 누를 때마다 새로 섞음)"}
              </p>
              <TypeChecks
                value={types}
                onChange={changeTypes}
                accessory={(type, selected) =>
                  selected && !WHOLE_PASSAGE_TYPES.has(type) ? (
                    <select
                      aria-label={`${testBookTypeLabel(type)} 문항 수`}
                      value={limits[type] ?? (SET_COUNT_TYPES.has(type) ? 1 : "all")}
                      onChange={(e) => {
                        const value = e.target.value === "all" ? undefined : Number(e.target.value);
                        setLimits((prev) => ({ ...prev, [type]: value }));
                      }}
                      className="rounded-md border border-violet-200 bg-white px-1 py-0.5 text-[11px]"
                    >
                      {(SET_COUNT_TYPES.has(type) ? SET_COUNT_OPTIONS : COUNT_OPTIONS).map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {type === "link" ? "칸" : "문항"}
                        </option>
                      ))}
                      {SET_COUNT_TYPES.has(type) ? null : <option value="all">가능한 만큼</option>}
                    </select>
                  ) : selected ? <span className="text-[10px] font-semibold text-slate-400">1세트</span> : null
                }
              />
            </div>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-lg border border-violet-200 bg-white p-2.5">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    ["auto", "자동 뽑기"],
                    ["all", "전부 뽑기"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={`rounded-md px-1 py-1.5 text-[12px] font-bold ${mode === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "auto" ? (
                <>
                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(AUTO) as AutoSize[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setSize(k);
                          setLimits({ ...AUTO[k].limits });
                          setVocab({
                            counts: Object.fromEntries(VOCAB_EXAM_KINDS.map((kind) => [kind.key, AUTO[k].vocab])) as VocabExamOptions["counts"],
                          });
                        }}
                        className={`rounded-md border px-1 py-1 text-[11px] font-bold ${
                          size === k ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {AUTO[k].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    고른 유형을 고른 지문 모두에 고루 싣고(요약문·글의 순서 같은 지문 통째 유형은 지문마다 하나씩), 분량에 맞춰 지문당 문항 수를 줄여 무작위로 뽑습니다.
                    <button type="button" onClick={() => setShowRule((v) => !v)} className="ml-1 font-semibold text-violet-700 underline">
                      {showRule ? "기준 닫기" : "기준 보기"}
                    </button>
                  </p>
                  {showRule ? (
                    <table className="w-full text-[10.5px] text-slate-600">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left font-semibold">유형</th>
                          {(Object.keys(AUTO) as AutoSize[]).map((k) => (
                            <th key={k} className={`font-semibold ${size === k ? "text-violet-700" : ""}`}>
                              {AUTO[k].label}
                            </th>
                          ))}
                          <th className="text-left font-semibold">고르는 순서</th>
                        </tr>
                      </thead>
                      <tbody>
                        {LIMIT_ROWS.map((r) => (
                          <tr key={r.key} className="border-t border-slate-100">
                            <td>{r.label}</td>
                            {(Object.keys(AUTO) as AutoSize[]).map((k) => (
                              <td key={k} className={`text-center ${size === k ? "font-bold text-violet-700" : ""}`}>
                                {AUTO[k].limits[r.key] != null ? `${AUTO[k].limits[r.key]}${r.unit}` : "전부"}
                              </td>
                            ))}
                            <td>{r.how}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-100">
                          <td>제목·요지·문장 순서 배열·연결어·삽입·요약·도식·글의 순서</td>
                          <td colSpan={3} className="text-center">
                            지문 통째 · 연결어는 전부, 순서·삽입은 1문항(유형 옆에서 바꿈)
                          </td>
                          <td />
                        </tr>
                        <tr className="border-t border-slate-100">
                          <td>단어 시험지</td>
                          {(Object.keys(AUTO) as AutoSize[]).map((k) => (
                            <td key={k} className={`text-center ${size === k ? "font-bold text-violet-700" : ""}`}>
                              유형마다 {AUTO[k].vocab}
                            </td>
                          ))}
                          <td>무작위</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : null}
                </>
              ) : (
                <p className="text-[11px] text-slate-600">고른 유형을 지문마다 모두 싣고, 아래에서 정한 문항 수만큼 냅니다.</p>
              )}
              {preview ? (
                <p className="text-[12px] font-bold text-slate-800">
                  예상 약 {preview.minutes}분 · {preview.items}문항{preview.vocab ? ` + 단어 ${preview.vocab}문항` : ""}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-500">빈칸 자리</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    ["same", "견본과 같은 자리"],
                    ["diff", "다른 자리"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBlankMode(id)}
                    className={`rounded-md px-1 py-1.5 text-[11px] font-bold ${blankMode === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <LevelSwitch value={level} onChange={setLevel} />
            {types.includes("line") ? <LineModeSwitch value={lineMode} onChange={setLineMode} /> : null}
            {types.includes("writing") ? <WritingScopeSwitch value={writing} onChange={setWriting} /> : null}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={vocabOn} onChange={(e) => setVocabOn(e.target.checked)} />
              단어 시험지 함께(고른 지문 합침)
            </label>
            {vocabOn ? <VocabExamControls value={vocab} onChange={setVocab} /> : null}
            <p className="text-[11px] leading-relaxed text-slate-500">
              뽑은 테스트지는 정답지와 함께 새 탭에서 열리고, 자료함 「뽑은 테스트지」에 저장됩니다. 다시 열 때는 값이 들지 않습니다.
            </p>
          </div>
        </div>
        <div className="space-y-1.5 border-t border-slate-100 px-5 py-3">
          <Button type="button" className="w-full" disabled={!!busy || !chosen.length || !types.length} onClick={() => void runDraw()}>
            {busy ?? `뽑기 (지문 ${chosen.length}개)`}
          </Button>
          {message ? (
            <p className={`text-[11px] font-semibold ${message.error ? "text-rose-600" : "text-emerald-700"}`}>
              {message.text}
              {message.href ? (
                <>
                  {" "}
                  <a href={message.href} target="_blank" rel="noreferrer" className="underline">
                    열기
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
