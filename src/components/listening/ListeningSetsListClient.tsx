"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/layout/NavIcon";
import {
  ListeningMenu,
  ListeningMenuDivider,
  ListeningMenuItem,
  ListeningMenuLabel,
} from "@/components/listening/ListeningMenu";
import {
  ListeningModuleHeader,
  type ListeningBasePath,
} from "@/components/listening/ListeningModuleHeader";
import type {
  ListeningSetFolderItem,
  ListeningSetListItem,
} from "@/lib/listening/load-listening-page-data";
import type { ListeningSetQuestionStats } from "@/lib/listening/load-listening-overview";

type FolderFilter = "all" | "uncategorized" | string;
type ReadyFilter = "all" | "voice" | "unassigned";

const READY_LABEL: Record<ReadyFilter, string> = {
  all: "전체",
  voice: "음성 준비 안 됨",
  unassigned: "배정 안 됨",
};

const ROW_GRID =
  "grid grid-cols-[16px_minmax(0,1fr)_32px] items-center gap-3 md:grid-cols-[16px_16px_minmax(0,1fr)_64px_150px_110px_120px_32px] md:gap-3.5";

interface ListeningSetsListClientProps {
  sets: ListeningSetListItem[];
  folders?: ListeningSetFolderItem[];
  basePath: ListeningBasePath;
  questionStats: Record<string, ListeningSetQuestionStats>;
  /** 진행 중인 배정의 대상 이름 (세트별) */
  targetsBySet: Record<string, string[]>;
  assignCount: number;
}

async function readJson(res: Response): Promise<{ ok?: boolean; message?: string } & Record<string, unknown>> {
  try {
    return (await res.json()) as { ok?: boolean; message?: string };
  } catch {
    return { ok: false, message: "요청을 처리하지 못했어요." };
  }
}

function targetSummary(targets: string[]): string | null {
  if (targets.length === 0) return null;
  if (targets.length === 1) return targets[0]!;
  return `${targets[0]} 외 ${targets.length - 1}`;
}

function VoiceCell({ stats }: { stats: ListeningSetQuestionStats }) {
  const { questionCount: total, audioReadyCount: ready } = stats;
  if (total === 0 || ready === 0) {
    return (
      <span className="inline-flex h-[22px] items-center rounded bg-slate-100 px-2 text-xs font-semibold text-slate-500">
        음성 없음
      </span>
    );
  }
  if (ready >= total) {
    return (
      <span className="inline-flex h-[22px] items-center gap-1 rounded bg-green-50 px-2 text-xs font-semibold text-green-700">
        <Icon name="check" size={12} strokeWidth={2.6} />
        음성 {ready}/{total}
      </span>
    );
  }
  return (
    <div className="flex w-full items-center gap-2">
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-amber-700"
          style={{ width: `${Math.round((ready / total) * 100)}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-amber-700">
        {ready}/{total}
      </span>
    </div>
  );
}

export function ListeningSetsListClient({
  sets,
  folders = [],
  basePath,
  questionStats,
  targetsBySet,
  assignCount,
}: ListeningSetsListClientProps) {
  const router = useRouter();
  const isTeacher = basePath.startsWith("/teacher");
  const [folderList, setFolderList] = useState(folders);
  const [localSets, setLocalSets] = useState<ListeningSetListItem[]>(sets);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<FolderFilter | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /**
   * 고른 세트 — 단어학습과 같은 방식으로, 고른 다음 아래 막대에서 배정한다.
   * 선생님 요청(2026-09-28): 모듈마다 배정하는 방식이 달라 헷갈리니 하나로 맞춘다.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setFolderList(folders), [folders]);
  useEffect(() => {
    setLocalSets(sets);
    setSelected((prev) => {
      const alive = new Set(sets.map((s) => s.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sets]);

  function toggleSelected(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const statsOf = (id: string): ListeningSetQuestionStats =>
    questionStats[id] ?? { questionCount: 0, audioReadyCount: 0 };
  const voiceNotReady = (id: string) => {
    const s = statsOf(id);
    return s.questionCount === 0 || s.audioReadyCount < s.questionCount;
  };

  const folderNameById = useMemo(
    () => new Map(folderList.map((f) => [f.id, f.name])),
    [folderList]
  );

  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("uncategorized", 0);
    for (const f of folderList) counts.set(f.id, 0);
    for (const s of localSets) {
      const key = s.folder_id && folderNameById.has(s.folder_id) ? s.folder_id : "uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [localSets, folderList, folderNameById]);

  /** 잠긴 세트만 든 폴더 = 학원 교재 */
  const curriculumFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of folderList) {
      const inFolder = localSets.filter((s) => s.folder_id === f.id);
      if (inFolder.length > 0 && inFolder.every((s) => s.is_locked)) ids.add(f.id);
    }
    return ids;
  }, [folderList, localSets]);

  const curriculumFolders = folderList.filter((f) => curriculumFolderIds.has(f.id));
  const myFolders = folderList.filter((f) => !curriculumFolderIds.has(f.id));

  const sortedSets = useMemo(
    () => [...localSets].sort((a, b) => a.order_index - b.order_index),
    [localSets]
  );

  const folderScoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedSets.filter((s) => {
      if (folderFilter === "uncategorized") {
        if (s.folder_id && folderNameById.has(s.folder_id)) return false;
      } else if (folderFilter !== "all" && s.folder_id !== folderFilter) {
        return false;
      }
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sortedSets, folderFilter, query, folderNameById]);

  const visibleSets = folderScoped.filter((s) => {
    if (readyFilter === "voice") return voiceNotReady(s.id);
    if (readyFilter === "unassigned") return (targetsBySet[s.id] ?? []).length === 0;
    return true;
  });

  const notReadyCount = folderScoped.filter((s) => voiceNotReady(s.id)).length;
  const filterName =
    folderFilter === "all"
      ? "전체"
      : folderFilter === "uncategorized"
        ? "미분류"
        : (folderNameById.get(folderFilter) ?? "폴더");

  // ---- 폴더 ----

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) {
      setNewFolderOpen(false);
      return;
    }
    setError(null);
    const res = await fetch("/api/listening/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await readJson(res);
    const folder = data.folder as ListeningSetFolderItem | undefined;
    if (!data.ok || !folder) {
      setError(data.message ?? "폴더를 만들지 못했어요.");
      return;
    }
    setFolderList((prev) => [...prev, folder]);
    setNewFolderName("");
    setNewFolderOpen(false);
    setFolderFilter(folder.id);
    router.refresh();
  }

  async function renameFolder(folderId: string) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === folderNameById.get(folderId)) return;
    setError(null);
    setFolderList((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)));
    const res = await fetch(`/api/listening/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await readJson(res);
    if (!data.ok) setError(data.message ?? "폴더 이름을 바꾸지 못했어요.");
    router.refresh();
  }

  async function deleteFolder(folderId: string) {
    const name = folderNameById.get(folderId) ?? "폴더";
    if (!window.confirm(`「${name}」 폴더를 지울까요?\n안의 세트는 미분류로 옮겨져요.`)) return;
    setError(null);
    const res = await fetch(`/api/listening/folders/${folderId}`, { method: "DELETE" });
    const data = await readJson(res);
    if (!data.ok) {
      setError(data.message ?? "폴더를 지우지 못했어요.");
      return;
    }
    setFolderList((prev) => prev.filter((f) => f.id !== folderId));
    if (folderFilter === folderId) setFolderFilter("all");
    router.refresh();
  }

  async function moveFolder(folderId: string, dir: -1 | 1) {
    const idx = folderList.findIndex((f) => f.id === folderId);
    const swapWith = idx + dir;
    if (idx === -1 || swapWith < 0 || swapWith >= folderList.length) return;
    const next = [...folderList];
    const tmp = next[idx]!;
    next[idx] = next[swapWith]!;
    next[swapWith] = tmp;
    const reindexed = next.map((f, i) => ({ ...f, order_index: i }));
    setFolderList(reindexed);
    setError(null);
    const res = await fetch("/api/listening/folders/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: reindexed.map((f) => ({ id: f.id, orderIndex: f.order_index })),
      }),
    });
    const data = await readJson(res);
    if (!data.ok) {
      setError(data.message ?? "폴더 순서를 저장하지 못했어요.");
      router.refresh();
    }
  }

  // ---- 세트 ----

  async function moveSetToFolder(setId: string, folderId: string | null) {
    const target = localSets.find((s) => s.id === setId);
    if (target && (target.folder_id ?? null) === folderId) return;
    setBusyId(setId);
    setError(null);
    setLocalSets((prev) =>
      prev.map((s) => (s.id === setId ? { ...s, folder_id: folderId } : s))
    );
    const res = await fetch(`/api/listening/sets/${setId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    const data = await readJson(res);
    setBusyId(null);
    if (!data.ok) setError(data.message ?? "폴더를 옮기지 못했어요.");
    router.refresh();
  }

  async function persistOrder(nextVisible: ListeningSetListItem[]) {
    // 보이는 세트가 가진 순서 칸만 다시 나눠 준다 (다른 폴더 순서는 그대로)
    const slots = nextVisible.map((s) => s.order_index).sort((a, b) => a - b);
    const items = nextVisible.map((s, i) => ({ id: s.id, orderIndex: slots[i] ?? i }));
    const orderById = new Map(items.map((it) => [it.id, it.orderIndex]));
    setLocalSets((prev) =>
      prev.map((s) => (orderById.has(s.id) ? { ...s, order_index: orderById.get(s.id)! } : s))
    );
    setError(null);
    const res = await fetch("/api/listening/sets/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await readJson(res);
    if (!data.ok) {
      setError(data.message ?? "순서를 저장하지 못했어요.");
      router.refresh();
    }
  }

  function handleRowDrop(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const from = visibleSets.findIndex((s) => s.id === sourceId);
    const to = visibleSets.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...visibleSets];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    void persistOrder(next);
  }

  function handleFolderDrop(target: FolderFilter) {
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    setDropFolder(null);
    if (!sourceId || target === "all") return;
    void moveSetToFolder(sourceId, target === "uncategorized" ? null : target);
  }

  function folderDropProps(target: FolderFilter) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragId) return;
        e.preventDefault();
        setDropFolder(target);
      },
      onDragLeave: () => setDropFolder((p) => (p === target ? null : p)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        handleFolderDrop(target);
      },
    };
  }

  async function deleteSet(setId: string, title: string) {
    if (!window.confirm(`「${title}」 세트와 문항·음성·배정을 모두 지울까요?\n이 세트가 든 듣기 일정의 학생 하루 과제·풀이 기록도 함께 지워지고 되돌릴 수 없어요.`)) return;
    setBusyId(setId);
    setError(null);
    const res = await fetch(`/api/listening/sets/${setId}`, { method: "DELETE" });
    const data = await readJson(res);
    setBusyId(null);
    if (!data.ok) {
      setError(data.message ?? "세트를 지우지 못했어요.");
      return;
    }
    setLocalSets((prev) => prev.filter((s) => s.id !== setId));
    router.refresh();
  }

  // ---- 화면 ----

  function folderRow({
    id,
    name,
    count,
    locked = false,
    menu = false,
    index = 0,
    total = 0,
  }: {
    id: FolderFilter;
    name: string;
    count: number;
    locked?: boolean;
    menu?: boolean;
    index?: number;
    total?: number;
  }) {
    const on = folderFilter === id;
    const droppable = id !== "all" && !locked;
    if (renamingId === id) {
      return (
        <div key={id} className="px-1 py-0.5">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void renameFolder(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void renameFolder(id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            aria-label="폴더 이름"
            className="ui-input h-8 py-1"
          />
        </div>
      );
    }
    return (
      <div
        key={id}
        {...(droppable ? folderDropProps(id) : {})}
        className={`group flex h-[34px] items-center rounded-md ${
          on ? "bg-brand-50 text-brand-700" : "text-slate-800 hover:bg-slate-50"
        } ${dropFolder === id ? "ring-2 ring-inset ring-brand-400" : ""}`}
      >
        <button
          type="button"
          onClick={() => setFolderFilter(id)}
          className={`flex min-w-0 flex-1 items-center gap-2 pl-2.5 text-left text-[13px] ${
            on ? "font-semibold" : "font-medium"
          }`}
        >
          <Icon
            name={locked ? "lock" : "folder"}
            size={15}
            className={on ? "text-brand-700" : "text-slate-400"}
          />
          <span className="truncate">{name}</span>
        </button>
        <span
          className={`px-1.5 text-xs tabular-nums ${on ? "text-brand-700" : "text-slate-400"} ${
            menu ? "" : "pr-2.5"
          }`}
        >
          {count}
        </span>
        {menu ? (
          <div className="shrink-0">
            <ListeningMenu
              label={`${name} 폴더 메뉴`}
              triggerClassName="flex h-7 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-200/70 lg:opacity-0 lg:focus:opacity-100 lg:group-hover:opacity-100 aria-expanded:opacity-100"
            >
              <ListeningMenuItem
                icon="edit"
                onClick={() => {
                  setRenamingId(id);
                  setRenameValue(name);
                }}
              >
                이름 바꾸기
              </ListeningMenuItem>
              <ListeningMenuItem
                icon="upload"
                disabled={index === 0}
                onClick={() => void moveFolder(id, -1)}
              >
                위로 올리기
              </ListeningMenuItem>
              <ListeningMenuItem
                icon="download"
                disabled={index === total - 1}
                onClick={() => void moveFolder(id, 1)}
              >
                아래로 내리기
              </ListeningMenuItem>
              <ListeningMenuDivider />
              <ListeningMenuItem icon="trash" danger onClick={() => void deleteFolder(id)}>
                폴더 지우기
              </ListeningMenuItem>
            </ListeningMenu>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <ListeningModuleHeader
        basePath={basePath}
        setCount={localSets.length}
        assignCount={assignCount}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* 폴더 */}
        <aside className="w-full shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-3.5 shadow-card lg:w-[216px]">
          {curriculumFolders.length > 0 ? (
            <>
              <p className="px-1 pb-1.5 text-xs font-semibold text-slate-500">학원 교재</p>
              {curriculumFolders.map((f) =>
                folderRow({
                  id: f.id,
                  name: f.name,
                  count: countsByFolder.get(f.id) ?? 0,
                  locked: true,
                  menu: !isTeacher,
                  index: folderList.indexOf(f),
                  total: folderList.length,
                })
              )}
              <div className="mx-1 my-2.5 h-px bg-slate-100" />
            </>
          ) : null}
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-xs font-semibold text-slate-500">내 세트</span>
            <button
              type="button"
              onClick={() => setNewFolderOpen(true)}
              aria-label="폴더 만들기"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <Icon name="plus" size={16} strokeWidth={2} />
            </button>
          </div>
          {folderRow({ id: "all", name: "전체", count: localSets.length })}
          {folderRow({
            id: "uncategorized",
            name: "미분류",
            count: countsByFolder.get("uncategorized") ?? 0,
          })}
          {myFolders.map((f) =>
            folderRow({
              id: f.id,
              name: f.name,
              count: countsByFolder.get(f.id) ?? 0,
              menu: true,
              index: folderList.indexOf(f),
              total: folderList.length,
            })
          )}
          {newFolderOpen ? (
            <div className="px-1 pt-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => void createFolder()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createFolder();
                  if (e.key === "Escape") {
                    setNewFolderName("");
                    setNewFolderOpen(false);
                  }
                }}
                placeholder="새 폴더 이름"
                aria-label="새 폴더 이름"
                className="ui-input h-8 py-1"
              />
            </div>
          ) : null}
        </aside>

        {/* 세트 목록 */}
        <section className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-base font-bold text-slate-900">{filterName}</span>
              <span className="text-[13px] text-slate-500">
                {visibleSets.length}개
                {notReadyCount > 0 ? ` · 음성 준비 안 된 세트 ${notReadyCount}개` : ""}
              </span>
            </p>
            <div className="flex gap-2">
              <label className="relative block min-w-0 flex-1 sm:w-[220px] sm:flex-none">
                <Icon
                  name="search"
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="세트 이름 찾기"
                  aria-label="세트 이름 찾기"
                  className="ui-input h-9 py-1.5 pl-9"
                />
              </label>
              <select
                value={readyFilter}
                onChange={(e) => setReadyFilter(e.target.value as ReadyFilter)}
                aria-label="준비 상태"
                className="ui-select h-9 w-auto py-1.5"
              >
                {(Object.keys(READY_LABEL) as ReadyFilter[]).map((k) => (
                  <option key={k} value={k}>
                    {`준비 상태: ${READY_LABEL[k]}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? (
            <p className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}

          {localSets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <Icon name="headphones" size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 font-semibold text-slate-800">아직 듣기 세트가 없어요</p>
              <p className="mt-1 text-sm text-slate-500">세트는 따로 만들어 올립니다.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-card">
              <div
                className={`${ROW_GRID} hidden rounded-t-lg border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500 md:grid`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  aria-label="보이는 세트 모두 고르기"
                  checked={visibleSets.length > 0 && visibleSets.every((s) => selected.has(s.id))}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const s of visibleSets) {
                        if (on) next.add(s.id);
                        else next.delete(s.id);
                      }
                      return next;
                    });
                  }}
                />
                <span />
                <span>세트</span>
                <span>문항</span>
                <span>음성</span>
                <span>받아쓰기</span>
                <span>배정</span>
                <span />
              </div>
              {visibleSets.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  {query.trim() || readyFilter !== "all"
                    ? "조건에 맞는 세트가 없어요."
                    : "이 폴더에는 세트가 없어요."}
                </p>
              ) : (
                <ul>
                  {visibleSets.map((set, i) => {
                    const stats = statsOf(set.id);
                    const targets = targetsBySet[set.id] ?? [];
                    const target = targetSummary(targets);
                    const readOnly = isTeacher && !!set.is_locked;
                    const dictOn = set.dictation_enabled !== false;
                    const dictLabel = dictOn ? `사용 · ${set.dictation_pass_score ?? 80}점` : "끔";
                    const folderName =
                      set.folder_id && folderFilter === "all"
                        ? folderNameById.get(set.folder_id)
                        : undefined;
                    const sub = set.is_locked ? "학원 교재" : (folderName ?? "내 세트");
                    return (
                      <li
                        key={set.id}
                        onDragOver={(e) => {
                          if (!dragId || dragId === set.id) return;
                          e.preventDefault();
                          setDragOverId(set.id);
                        }}
                        onDragLeave={() => setDragOverId((p) => (p === set.id ? null : p))}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleRowDrop(set.id);
                        }}
                        className={`${ROW_GRID} min-h-[58px] px-4 py-2.5 ${
                          i > 0 ? "border-t border-slate-100" : ""
                        } ${dragId === set.id ? "opacity-50" : ""} ${
                          dragOverId === set.id ? "bg-brand-50/60 shadow-[inset_0_2px_0_0_theme(colors.brand.500)]" : ""
                        } ${busyId === set.id ? "opacity-60" : ""} ${
                          selected.has(set.id) ? "bg-brand-50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          aria-label={`${set.title} 고르기`}
                          checked={selected.has(set.id)}
                          onChange={(e) => toggleSelected(set.id, e.target.checked)}
                        />
                        <span
                          draggable={!readOnly}
                          onDragStart={() => setDragId(set.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setDragOverId(null);
                            setDropFolder(null);
                          }}
                          title="끌어서 순서를 바꾸거나 왼쪽 폴더에 놓아요"
                          aria-label={`${set.title} 순서 손잡이`}
                          className={`hidden text-slate-400 md:block ${
                            readOnly ? "cursor-default opacity-40" : "cursor-grab hover:text-slate-600 active:cursor-grabbing"
                          }`}
                        >
                          <Icon name="grip" size={16} />
                        </span>

                        <div className="min-w-0">
                          <Link
                            href={`${basePath}/${set.id}`}
                            className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-brand-700"
                          >
                            {set.is_locked ? (
                              <Icon name="lock" size={13} strokeWidth={2} className="text-slate-400" />
                            ) : null}
                            <span className="truncate">{set.title}</span>
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>
                          {/* 좁은 화면: 한 줄 요약 */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 md:hidden">
                            <span className="tabular-nums">{stats.questionCount}문항</span>
                            <span className="w-32">
                              <VoiceCell stats={stats} />
                            </span>
                            <span className={dictOn ? "" : "text-slate-400"}>받아쓰기 {dictLabel}</span>
                            <span className={target ? "" : "text-slate-400"}>{target ?? "배정 안 됨"}</span>
                          </div>
                        </div>

                        <span className="hidden text-[13px] tabular-nums text-slate-800 md:block">
                          {stats.questionCount}문항
                        </span>
                        <span className="hidden md:flex">
                          <VoiceCell stats={stats} />
                        </span>
                        <span className={`hidden text-[13px] md:block ${dictOn ? "text-slate-700" : "text-slate-400"}`}>
                          {dictLabel}
                        </span>
                        <span
                          className={`hidden truncate text-[13px] md:block ${target ? "text-slate-700" : "text-slate-400"}`}
                          title={targets.join(", ") || undefined}
                        >
                          {target ?? "배정 안 됨"}
                        </span>

                        <ListeningMenu label={`${set.title} 메뉴`}>
                          <ListeningMenuItem icon="edit" href={`${basePath}/${set.id}`}>
                            열기
                          </ListeningMenuItem>
                          <ListeningMenuItem icon="print" href={`${basePath}/${set.id}/print`}>
                            시험지 인쇄
                          </ListeningMenuItem>
                          <ListeningMenuItem icon="calendar" href={`${basePath}/assign?set=${set.id}`}>
                            배정하기
                          </ListeningMenuItem>
                          {!readOnly ? (
                            <>
                              <ListeningMenuDivider />
                              <ListeningMenuLabel>폴더 옮기기</ListeningMenuLabel>
                              <ListeningMenuItem
                                icon="move"
                                active={!set.folder_id}
                                onClick={() => void moveSetToFolder(set.id, null)}
                              >
                                미분류
                              </ListeningMenuItem>
                              {myFolders.map((f) => (
                                <ListeningMenuItem
                                  key={f.id}
                                  icon="folder"
                                  active={set.folder_id === f.id}
                                  onClick={() => void moveSetToFolder(set.id, f.id)}
                                >
                                  {f.name}
                                </ListeningMenuItem>
                              ))}
                              <ListeningMenuDivider />
                              <ListeningMenuItem
                                icon="trash"
                                danger
                                onClick={() => void deleteSet(set.id, set.title)}
                              >
                                세트 지우기
                              </ListeningMenuItem>
                            </>
                          ) : null}
                        </ListeningMenu>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {visibleSets.length > 0 && selected.size === 0 ? (
            <p className="px-1 text-xs text-slate-400">
              왼쪽 네모로 세트를 고르면 아래 막대에서 반·학생에게 배정할 수 있어요.
            </p>
          ) : null}
          {localSets.length > 0 ? (
            <p className="px-1 text-xs text-slate-400">
              손잡이를 끌어 순서를 바꾸거나, 왼쪽 폴더 위에 놓아 옮길 수 있어요.
            </p>
          ) : null}
        </section>
      </div>

      {selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 lg:left-[244px]">
          <div className="pointer-events-auto flex max-w-full items-center gap-3.5 overflow-x-auto rounded-[10px] bg-side py-2.5 pl-[18px] pr-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.25)]">
            <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-white">
              {selected.size}개 선택
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  router.push(`${basePath}/assign?set=${[...selected].join(",")}`)
                }
                className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-brand-600 px-3 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              >
                <Icon name="calendar" size={16} strokeWidth={2} />
                배정
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="선택 풀기"
                title="선택 풀기"
              >
                <Icon name="x" size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
