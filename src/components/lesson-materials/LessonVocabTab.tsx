"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/lesson-materials/post-json";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import type { LessonVocabSetRow } from "@/lib/lesson-materials/load-library";
import type { loadDrawProjectsAction, prepareWorkbookExtrasAction } from "@/lib/lesson-materials/test-book-actions";
import { PASSAGE_PREP_CONCURRENCY, isTestBookProjectReady } from "@/lib/lesson-materials/test-book";
import { deleteVocabSet as adminDeleteVocabSet, updateVocabSet as adminUpdateVocabSet } from "@/app/admin/vocab/actions";
import { deleteVocabSet as teacherDeleteVocabSet, updateVocabSet as teacherUpdateVocabSet } from "@/app/teacher/vocab/actions";

type LoadResult = Awaited<ReturnType<typeof loadDrawProjectsAction>>;
type PrepareResult = Awaited<ReturnType<typeof prepareWorkbookExtrasAction>>;
type RegisterResult = { ok: true; setId: string; count: number; created: boolean } | { ok: false; message: string };

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function todayName(): string {
  const d = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const m = d.find((p) => p.type === "month")?.value ?? "";
  const day = d.find((p) => p.type === "day")?.value ?? "";
  return `단어장_${m}${day}`;
}

/** 목록에 보이는 이름 — 통합자료·테스트 교재에서 등록할 때 붙은 「 · 전체 단어」를 떼어 수업용 자료 이름과 같게 */
function shownTitle(title: string): string {
  return title.replace(/\s*·\s*전체 단어$/, "");
}

/** 고른 지문이 모두 들어 있는 수업용 자료 이름(가장 작은 것) — 단어장 이름을 수업용 자료와 같게(선생님 2026-11-11) */
function lessonNameFor(selectedIds: string[], docs: Array<{ name: string; project_ids: string[] }>): string | null {
  if (!selectedIds.length) return null;
  const hit = docs
    .filter((d) => selectedIds.every((id) => d.project_ids.includes(id)))
    .sort((a, b) => a.project_ids.length - b.project_ids.length)[0];
  return hit?.name?.trim() || null;
}

/**
 * 자료함 「단어」 탭(윌링어학원, 선생님 2026-10-27): 지문을 골라 단어장을 만들고, 만든 단어장의 목록을 보고
 * 단어 시험지를 출력한다. 단어장은 단어학습 「수업자료 단어장」 폴더에 들어가 단어학습 화면에서도 그대로 쓴다.
 * 단어는 지문마다 만든 단어 정리(품사·지문 속 뜻·동의어·반의어)이고, 없는 지문은 먼저 만든다 — 값은 받지 않는다(선생님 2026-10-28).
 */
export function LessonVocabTab({
  role,
  sets,
  selectedIds,
  onMade,
  askSignal = 0,
  lessonDocs = [],
}: {
  role: "admin" | "teacher";
  sets: LessonVocabSetRow[];
  selectedIds: string[];
  onMade: () => void;
  /** 다른 탭 아래 바에서 「단어장 만들기」를 눌렀다(늘어날 때마다 이름 창을 띄운다) */
  askSignal?: number;
  /** 수업용 자료 파일(이름·지문) — 새 단어장 이름을 수업용 자료 이름으로 */
  lessonDocs?: Array<{ name: string; project_ids: string[] }>;
}) {
  const router = useRouter();
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // 다른 자료처럼 이름 바꾸기·삭제(선생님 2026-10-29) — 단어학습 단어장 기능을 그대로 쓴다
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const updateSet = role === "admin" ? adminUpdateVocabSet : teacherUpdateVocabSet;
  const deleteSet = role === "admin" ? adminDeleteVocabSet : teacherDeleteVocabSet;

  async function commitRename(id: string, before: string) {
    const title = draft.trim();
    setEditingId(null);
    if (!title || title === before) return;
    const res = await updateSet(id, { title });
    if (!res.ok) {
      setMessage({ text: res.message || "이름을 바꾸지 못했습니다.", error: true });
      return;
    }
    setMessage(null);
    router.refresh();
  }

  async function removeSet(id: string, title: string) {
    if (!window.confirm(`「${title}」 단어장을 삭제할까요? 단어학습의 같은 단어장도 함께 지워집니다. 지문 자료는 그대로 남습니다.`)) return;
    setBusy("단어장을 지우는 중…");
    try {
      const res = await deleteSet(id);
      if (!res.ok) throw new Error(res.message || "단어장을 지우지 못했습니다.");
      setMessage({ text: `「${title}」 단어장을 삭제했습니다.`, error: false });
      router.refresh();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "단어장을 지우지 못했습니다.", error: true });
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    if (askSignal > 0 && selectedIds.length) setNaming(lessonNameFor(selectedIds, lessonDocs) ?? todayName());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askSignal]);

  async function make(name: string) {
    setMessage(null);
    setBusy("지문을 확인하고 있습니다…");
    try {
      const loaded = await postJson<LoadResult>("/api/lesson-materials/test-book", { role, op: "loadDraw", projectIds: selectedIds });
      if (!loaded.ok) throw new Error(loaded.message);
      const missing = loaded.projects.filter((p) => !isTestBookProjectReady(p));
      if (missing.length) {
        let done = 0;
        const failed: string[] = [];
        setBusy(`단어 정리를 만들고 있습니다… (0/${missing.length})`);
        await runWithConcurrency(missing, PASSAGE_PREP_CONCURRENCY, async (p) => {
          try {
            const res = await postJson<PrepareResult>("/api/lesson-materials/test-book", { role, op: "prepareWorkbook", projectId: p.id, lessonTab: true });
            if (!res.ok) failed.push(`「${p.title}」 ${res.message}`);
          } catch (e) {
            failed.push(`「${p.title}」 ${e instanceof Error ? e.message : "만들지 못했습니다."}`);
          }
          setBusy(`단어 정리를 만들고 있습니다… (${++done}/${missing.length})`);
        });
        if (failed.length) throw new Error(failed.join(" · "));
      }
      setBusy("단어장을 만들고 있습니다…");
      const res = await postJson<RegisterResult>("/api/lesson-materials/test-book", {
        role,
        op: "registerVocab",
        title: name,
        projectIds: selectedIds,
        lessonTab: true,
      });
      if (!res.ok) throw new Error(res.message);
      setMessage({ text: `「${name}」 단어장을 만들었습니다 · ${res.count}단어`, error: false });
      onMade();
      router.refresh();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "단어장을 만들지 못했습니다.", error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">
          만든 단어장 <span className="font-semibold text-slate-400">{sets.length}</span>
        </h2>
        <button
          type="button"
          disabled={!selectedIds.length || !!busy}
          onClick={() => setNaming(lessonNameFor(selectedIds, lessonDocs) ?? todayName())}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
          title={selectedIds.length ? "고른 지문의 단어로 단어장을 만듭니다" : "아래 지문 목록에서 지문을 먼저 고르세요"}
        >
          📗 단어장 만들기{selectedIds.length ? ` (지문 ${selectedIds.length}개)` : ""}
        </button>
      </div>
      {busy ? <p className="text-xs font-semibold text-violet-700">{busy}</p> : null}
      {message ? <p className={`text-xs font-semibold ${message.error ? "text-rose-600" : "text-emerald-700"}`}>{message.text}</p> : null}
      {sets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          아래 지문 목록에서 지문을 고른 뒤 「단어장 만들기」를 누르면 여기에 단어장이 생깁니다.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {sets.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 bg-white px-3 py-1.5 hover:bg-slate-50">
              <span className="text-xs" aria-hidden>
                📗
              </span>
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                {editingId === s.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(s.id, s.title)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(s.id, s.title);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full max-w-md rounded-md border border-violet-300 px-2 py-0.5 text-[13px] font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-200"
                    aria-label="단어장 이름"
                  />
                ) : (
                  <a
                    href={`/${role}/lesson-materials/vocab-set-exam?set=${s.id}&view=list`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-[13px] font-semibold text-slate-900 hover:text-violet-700 hover:underline"
                  >
                    {shownTitle(s.title)}
                  </a>
                )}
                <span className="shrink-0 text-[11px] text-slate-400">
                  {s.word_count}단어 · {formatWhen(s.created_at)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/${role}/lesson-materials/vocab-set-exam?set=${s.id}&view=list`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                >
                  목록 보기
                </a>
                <a
                  href={`/${role}/lesson-materials/vocab-set-exam?set=${s.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                >
                  시험지 출력
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(s.title);
                    setEditingId(s.id);
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
                >
                  이름 바꾸기
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void removeSet(s.id, s.title)}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selectedIds.length && naming == null && !busy ? (
        // 지문을 고르면 아래에 뜨는 바(다른 탭의 선택 바와 같은 자리·모양, 선생님 2026-10-28)
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 lg:left-[244px]">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl bg-violet-600 px-4 py-3 text-white shadow-xl">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
              {selectedIds.length}개 자료 선택됨
            </span>
            <button
              type="button"
              onClick={() => setNaming(lessonNameFor(selectedIds, lessonDocs) ?? todayName())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-violet-700 shadow-sm hover:bg-violet-50"
            >
              📗 단어장 만들기
            </button>
          </div>
        </div>
      ) : null}

      {naming != null ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              const name = naming.trim() || todayName();
              setNaming(null);
              void make(name);
            }}
          >
            <header className="flex items-center justify-between bg-violet-600 px-5 py-4 text-white">
              <h2 className="text-base font-bold">📗 단어장 만들기</h2>
              <button type="button" className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/20" onClick={() => setNaming(null)} aria-label="닫기">
                ×
              </button>
            </header>
            <div className="space-y-1 px-5 py-4">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">단어장 이름</span>
                <input
                  autoFocus
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={naming}
                  maxLength={80}
                  onChange={(e) => setNaming(e.target.value)}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p className="text-[11px] text-slate-500">
                고른 지문 {selectedIds.length}개의 단어를 합쳐(같은 낱말은 한 번) 단어학습 「수업자료 단어장」 폴더에 만듭니다.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" onClick={() => setNaming(null)}>
                취소
              </button>
              <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700">
                만들기
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
