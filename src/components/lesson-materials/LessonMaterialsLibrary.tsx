"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LessonMaterialDocumentList } from "@/components/lesson-materials/LessonMaterialDocumentList";
import { LessonQuestionJobList } from "@/components/lesson-materials/LessonQuestionJobList";
import { IntegratedCreateModal } from "@/components/lesson-materials/integrated/IntegratedCreateModal";
import type { LessonMaterialDocumentKind } from "@/lib/lesson-materials/documents";
import { Icon } from "@/components/layout/NavIcon";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  type LessonMaterialLibraryData,
  type LessonMaterialProjectRow,
} from "@/lib/lesson-materials/load-library";
import {
  copyLessonMaterialProjects,
  createLessonMaterialFolder,
  deleteLessonMaterialFolder,
  moveLessonMaterialProjects,
  permanentlyDeleteLessonMaterialProjects,
  renameLessonMaterialFolder,
  reorderLessonMaterialProjects,
  restoreLessonMaterialProjects,
  trashLessonMaterialProjects,
} from "@/lib/lesson-materials/library-ops";
import { updateLessonMaterialProjectMeta } from "@/lib/lesson-materials/lesson-pack-actions";
import { LessonMaterialsSelectionBar } from "@/components/lesson-materials/LessonMaterialsSelectionBar";
import { LessonVocabTab } from "@/components/lesson-materials/LessonVocabTab";
import { useReloadOnNewDeploy } from "@/components/lesson-materials/use-reload-on-new-deploy";
import type { LessonMaterialFolderRow } from "@/lib/lesson-materials/load-library";

type FolderFilter = "all" | "unfiled" | "trash" | string;

type LibraryTab =
  | "materials"
  | "lesson"
  | "vocab"
  | "analysis"
  | "workbook"
  | "onePageSummary"
  | "onePageTest"
  | "testBook"
  | "questions"
  | "integrated";

const LIBRARY_TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "materials", label: "지문자료" },
  // 지문을 골라 단어장 만들기 · 목록 · 시험지 — 수업용자료 앞에(선생님 2026-11-10, 단어는 수업용자료에서 빠져 이 탭으로)
  { id: "vocab", label: "단어" },
  { id: "lesson", label: "수업용자료" },
  { id: "analysis", label: "분석서" },
  { id: "workbook", label: "워크북" },
  { id: "onePageSummary", label: "1장 요약직보자료" },
  { id: "onePageTest", label: "1장 테스트" },
  { id: "testBook", label: "뽑은 테스트지" },
  { id: "questions", label: "변형문제" },
  { id: "integrated", label: "최종통합자료" },
];

/** 끌기 손잡이. 듣기·단어 목록과 같은 점 여섯 개를 쓴다(선생님 요청). */
function GripIcon() {
  return <Icon name="grip" size={16} strokeWidth={2.4} />;
}

function reorderProjects(
  items: LessonMaterialProjectRow[],
  fromId: string,
  toId: string
): LessonMaterialProjectRow[] {
  if (fromId === toId) return items;
  const fromIndex = items.findIndex((p) => p.id === fromId);
  const toIndex = items.findIndex((p) => p.id === toId);
  if (fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [removed] = next.splice(fromIndex, 1);
  if (!removed) return items;
  next.splice(toIndex, 0, removed);
  return next;
}

export function LessonMaterialsLibrary({
  role,
  data,
}: {
  role: "admin" | "teacher";
  data: LessonMaterialLibraryData;
}) {
  useReloadOnNewDeploy();
  const router = useRouter();
  // 제작 탭에서 저장·닫기 후 이 탭으로 돌아오면 새 파일이 보이도록 목록을 다시 받는다.
  useEffect(() => {
    let last = Date.now();
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 5_000) return;
      last = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [router]);
  const base = role === "admin" ? "/admin/lesson-materials" : "/teacher/lesson-materials";
  const [folderChoice, setFolderChoice] = useState<FolderFilter>("all");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("materials");
  /**
   * 폴더는 지문자료 탭에서만 쓴다. 수업용자료·분석서·워크북 탭은 고른 폴더와 상관없이
   * 전체를 보여 주고, 왼쪽에서 폴더를 누르면 지문자료 탭으로 돌아간다.
   */
  const folderScoped = libraryTab === "materials";
  const folderFilter: FolderFilter = folderScoped ? folderChoice : "all";
  function setFolderFilter(next: FolderFilter) {
    setFolderChoice(next);
    setLibraryTab("materials");
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 아래 바의 「단어장 만들기」를 누를 때마다 늘린다 — 단어 탭이 이름 창을 띄운다 */
  const [vocabAsk, setVocabAsk] = useState(0);
  /** 내 순서(끌어서 정한 순서) / 최근 추가순. */
  const [sortMode, setSortMode] = useState<"custom" | "recent">("custom");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  /** 새 통합자료 생성 창. 지문을 골라 연 경우 그 지문으로 만든 파일을 미리 골라 둔다. */
  const [integratedOpen, setIntegratedOpen] = useState<null | { preselected: string[] }>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(data.folders.map((f) => f.id))
  );
  const lastClicked = useRef<string | null>(null);

  const folderNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of data.folders) m.set(f.id, f.name);
    return m;
  }, [data.folders]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, LessonMaterialFolderRow[]>();
    for (const f of data.folders) {
      const key = f.parent_id ?? null;
      const list = m.get(key) ?? [];
      list.push(f);
      m.set(key, list);
    }
    return m;
  }, [data.folders]);

  function folderProjectCount(folderId: string): number {
    return data.projects.filter((p) => p.folder_id === folderId).length;
  }

  function collectDescendantIds(folderId: string): string[] {
    const out = [folderId];
    const kids = childrenByParent.get(folderId) ?? [];
    for (const k of kids) out.push(...collectDescendantIds(k.id));
    return out;
  }

  const foldersFlat = useMemo(() => {
    const out: Array<{ folder: LessonMaterialFolderRow; depth: number }> = [];
    function walk(parentId: string | null, depth: number) {
      for (const f of childrenByParent.get(parentId) ?? []) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [childrenByParent]);

  const activeProjects = useMemo(() => {
    return [...data.unfiledProjects, ...data.projects];
  }, [data.unfiledProjects, data.projects]);

  const visibleProjects = useMemo(() => {
    let list: typeof activeProjects;
    if (folderFilter === "trash") {
      list = [...data.trashedProjects];
    } else if (folderFilter === "all") {
      list = [...activeProjects];
    } else if (folderFilter === "unfiled") {
      list = [...data.unfiledProjects];
    } else {
      const ids = new Set(collectDescendantIds(folderFilter));
      list = data.projects.filter(
        (p) => p.folder_id && ids.has(p.folder_id)
      );
    }

    if (libraryTab === "lesson") {
      list = list.filter((p) => p.has_lesson_pack);
    } else if (libraryTab === "analysis") {
      list = list.filter((p) => p.has_analysis_report);
    } else if (!["materials", "lesson", "analysis", "vocab"].includes(libraryTab)) {
      // 워크북·1장 자료·변형문제·최종통합자료 탭은 만든 파일만 보여 준다.
      list = [];
    }

    // 같은 번호끼리는 처음 만든 순서로 둔다. 예전에는 마지막으로 고친 시각을 써서,
    // 옮기거나 내용을 고칠 때마다 자리가 바뀌었다.
    const createdAt = (p: LessonMaterialProjectRow) =>
      Date.parse(p.created_at ?? p.updated_at) || 0;
    if (sortMode === "recent") {
      list.sort((a, b) => createdAt(b) - createdAt(a));
    } else {
      // 순서 번호는 폴더 안에서의 순서라, 여러 폴더를 함께 볼 때(전체·하위 폴더 포함)는
      // 폴더 차례(미분류 먼저)대로 묶고 그 안에서 번호순으로 둔다. 묶지 않으면 폴더마다
      // 0번끼리, 1번끼리 번갈아 섞였다.
      const folderRank = new Map(foldersFlat.map(({ folder }, i) => [folder.id, i] as const));
      const rank = (p: LessonMaterialProjectRow) =>
        p.folder_id ? (folderRank.get(p.folder_id) ?? foldersFlat.length) : -1;
      list.sort((a, b) => {
        const fr = rank(a) - rank(b);
        if (fr !== 0) return fr;
        const oi = (a.order_index ?? 0) - (b.order_index ?? 0);
        if (oi !== 0) return oi;
        return createdAt(a) - createdAt(b);
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    folderFilter,
    libraryTab,
    data,
    activeProjects,
    sortMode,
    childrenByParent,
    foldersFlat,
  ]);

  const totalActive = activeProjects.length;
  const selectedIds = [...selected];
  const selectedCount = selectedIds.length;
  /**
   * 고른 자료를 화면에 보이는 순서대로. 옮기기·복사는 이 순서대로 대상 폴더 맨 뒤에 붙는다
   * (selectedIds는 누른 순서라, 그대로 보내면 옮긴 뒤 순서가 누른 순서로 바뀌었다).
   */
  const selectedInViewOrder = [
    ...visibleProjects.filter((p) => selected.has(p.id)).map((p) => p.id),
    ...selectedIds.filter((id) => !visibleProjects.some((p) => p.id === id)),
  ];
  /**
   * 자료를 만들 때 쓰는 순서 — 화면을 어떻게 보고 있든 지문을 넣은 순서로 낸다.
   *
   * 「최근 추가순」으로 보다가 전체 선택하면 수업자료·1장 요약자료가 마지막 지문부터
   * 거꾸로 나왔다. 무엇을 보고 있든 자료는 1번 지문부터 나와야 헷갈리지 않는다.
   */
  const selectedInInputOrder = (() => {
    const folderRank = new Map(foldersFlat.map(({ folder }, i) => [folder.id, i] as const));
    const byId = new Map(activeProjects.map((p) => [p.id, p] as const));
    const key = (id: string) => {
      const p = byId.get(id);
      if (!p) return [Number.MAX_SAFE_INTEGER, 0, 0] as const;
      const rank = p.folder_id ? (folderRank.get(p.folder_id) ?? foldersFlat.length) : -1;
      return [rank, p.order_index ?? 0, Date.parse(p.created_at ?? p.updated_at) || 0] as const;
    };
    return [...selectedIds].sort((a, b) => {
      const [ar, ao, ac] = key(a);
      const [br, bo, bc] = key(b);
      return ar - br || ao - bo || ac - bc;
    });
  })();
  const inTrash = folderFilter === "trash";
  const tabComingSoon = false;
  /** 만든 파일을 보여 주는 탭. 워크북 탭은 파일만 있고 지문별 목록이 없다. */
  const documentKind: LessonMaterialDocumentKind | null =
    libraryTab === "lesson"
      ? "lesson_pack"
      : libraryTab === "analysis"
        ? "analysis_report"
        : libraryTab === "workbook"
          ? "workbook"
          : libraryTab === "onePageSummary"
            ? "one_page_summary"
            : libraryTab === "onePageTest"
              ? "one_page_test"
              : libraryTab === "testBook"
                ? "test_book"
              : libraryTab === "integrated"
                ? "integrated"
                : null;
  const tabDocuments = useMemo(
    () => (documentKind ? (data.documents ?? []).filter((d) => d.kind === documentKind) : []),
    [data.documents, documentKind]
  );
  /** 워크북·1장 자료·변형문제·최종통합자료 탭은 만든 결과만 있고 지문별 목록이 없다. */
  const showProjectList =
    libraryTab === "materials" || libraryTab === "lesson" || libraryTab === "analysis" || libraryTab === "vocab";

  /** 폴더(또는 미분류)를 고른 채 새 자료를 추가하면 그 폴더에 들어간다. */
  const newMaterialHref =
    folderScoped && folderChoice !== "all" && folderChoice !== "trash"
      ? `${base}/input?folder=${encodeURIComponent(folderChoice)}`
      : `${base}/input`;

  const currentFolderLabel = !folderScoped
    ? (LIBRARY_TABS.find((t) => t.id === libraryTab)?.label ?? "전체")
    : folderFilter === "all"
      ? "전체"
      : folderFilter === "unfiled"
        ? "미분류"
        : folderFilter === "trash"
          ? "휴지통"
          : (folderNameById.get(folderFilter) ?? "폴더");

  const tabEmptyMessage =
    libraryTab === "lesson"
      ? "수업용 자료가 저장된 지문이 없습니다."
      : libraryTab === "analysis"
        ? "분석서가 저장된 지문이 없습니다."
        : libraryTab === "questions"
          ? "변형문제는 준비 중입니다."
          : libraryTab === "workbook"
            ? "워크북은 준비 중입니다."
            : libraryTab === "integrated"
              ? "최종통합자료는 준비 중입니다."
              : "자료가 없습니다.";

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [orderedProjects, setOrderedProjects] =
    useState<LessonMaterialProjectRow[]>(visibleProjects);

  useEffect(() => {
    setOrderedProjects(visibleProjects);
  }, [visibleProjects]);

  const canReorder =
    !inTrash &&
    !tabComingSoon &&
    sortMode === "custom" &&
    (libraryTab === "materials" ||
      libraryTab === "lesson" ||
      libraryTab === "analysis");

  /**
   * 순서는 화면에 바로 반영하고 저장은 뒤에서 한다.
   *
   * 예전에는 저장이 끝날 때까지 목록을 흐리게 막고(pointer-events-none), 끝나면 페이지
   * 전체를 다시 불러왔다. 서버가 행을 하나씩 고치던 것까지 겹쳐 한 번 끌 때마다 몇 초씩
   * 멈췄다. 저장 중에 또 끌면 마지막 순서만 이어서 저장한다.
   */
  const pendingOrder = useRef<string[] | null>(null);
  const savingOrder = useRef(false);

  async function persistOrder(next: LessonMaterialProjectRow[]) {
    pendingOrder.current = next.map((p) => p.id);
    if (savingOrder.current) return;
    savingOrder.current = true;
    setReordering(true);
    setError(null);
    try {
      while (pendingOrder.current) {
        const orderedIds = pendingOrder.current;
        pendingOrder.current = null;
        const res = await reorderLessonMaterialProjects(role, { orderedIds });
        if (!res.ok) {
          setError(res.message);
          setOrderedProjects(visibleProjects);
          pendingOrder.current = null;
          return;
        }
      }
      // 저장 응답에 새 목록이 실려 오므로 따로 새로 고치지 않는다(runAction 참고).
    } catch {
      setError("서버 응답이 늦어 순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setOrderedProjects(visibleProjects);
    } finally {
      savingOrder.current = false;
      setReordering(false);
    }
  }

  function handleDropOn(targetId: string) {
    if (!canReorder || !draggingId || draggingId === targetId) return;
    const next = reorderProjects(orderedProjects, draggingId, targetId);
    setOrderedProjects(next);
    setDraggingId(null);
    setDragOverId(null);
    void persistOrder(next);
  }

  function projectOpenHref(projectId: string) {
    if (libraryTab === "lesson") {
      return `${base}/lesson-pack?ids=${encodeURIComponent(projectId)}`;
    }
    if (libraryTab === "analysis") {
      return `${base}/analysis-report?ids=${encodeURIComponent(projectId)}`;
    }
    return `${base}/project/${projectId}`;
  }

  function toggleSelect(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked.current) {
        const ids = orderedProjects.map((p) => p.id);
        const a = ids.indexOf(lastClicked.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          for (let i = from; i <= to; i++) next.add(ids[i]!);
          lastClicked.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastClicked.current = id;
      return next;
    });
  }

  function selectAllVisible(checked: boolean) {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(orderedProjects.map((p) => p.id)));
  }

  /**
   * 서버 작업을 부르고 결과를 반영한다. 작업들이 revalidatePath를 부르므로 응답에 새 목록이
   * 이미 실려 온다. 예전에는 그 뒤에 router.refresh()로 목록을 한 번 더 불러와 이동·복사
   * 때마다 기다림이 두 배였다.
   */
  function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    setError(null);
    setMoveOpen(false);
    setCopyOpen(false);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setSelected(new Set());
      } catch {
        setError("서버 응답이 늦어 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  async function handleCreateFolder() {
    const name = folderName.trim();
    if (!name) {
      setError("폴더 이름을 입력해 주세요.");
      return;
    }
    runAction(async () => {
      const res = await createLessonMaterialFolder(role, {
        name,
        parentId: createParentId,
      });
      if (res.ok) {
        setFolderName("");
        setCreatingFolder(false);
        setCreateParentId(null);
        if (res.folderId) {
          setFolderFilter(res.folderId);
          if (createParentId) {
            setExpandedFolders((prev) => new Set([...prev, createParentId]));
          }
        }
      }
      return res;
    });
  }

  function startRename(folder: LessonMaterialFolderRow) {
    setRenamingId(folder.id);
    setRenameValue(folder.name);
    setMenuFolderId(null);
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) return;
    runAction(async () => {
      const res = await renameLessonMaterialFolder(role, {
        folderId: renamingId,
        name,
      });
      if (res.ok) setRenamingId(null);
      return res;
    });
  }

  function renderFolderRow(folder: LessonMaterialFolderRow, depth: number) {
    const kids = childrenByParent.get(folder.id) ?? [];
    const expanded = expandedFolders.has(folder.id);
    const count = folderProjectCount(folder.id);
    const isActive = folderFilter === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`group flex w-full items-center gap-1 rounded-md px-2 py-[3px] text-left text-[13px] ${
            isActive
              ? "bg-violet-100 font-semibold text-violet-800"
              : "text-slate-700 hover:bg-slate-50"
          }`}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              className="h-4 w-4 shrink-0 text-[10px] text-slate-400"
              onClick={() =>
                setExpandedFolders((prev) => {
                  const next = new Set(prev);
                  if (next.has(folder.id)) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                })
              }
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="inline-block h-4 w-4 shrink-0" />
          )}
          {renamingId === folder.id ? (
            <input
              className="min-w-0 flex-1 rounded border border-violet-300 px-1.5 py-0 text-[13px]"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenamingId(null);
              }}
              onBlur={() => commitRename()}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => {
                setFolderFilter(folder.id);
                setSelected(new Set());
                setMenuFolderId(null);
              }}
            >
              {folder.name}
            </button>
          )}
          <span className="text-[11px] tabular-nums text-slate-400">{count}</span>
          <div className="relative">
            <button
              type="button"
              className="rounded px-1 text-xs text-slate-400 opacity-0 group-hover:opacity-100"
              onClick={() =>
                setMenuFolderId((id) => (id === folder.id ? null : folder.id))
              }
            >
              ⋯
            </button>
            {menuFolderId === folder.id ? (
              <div className="absolute right-0 z-30 mt-1 w-36 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                  onClick={() => startRename(folder)}
                >
                  이름 수정
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                  onClick={() => {
                    setCreateParentId(folder.id);
                    setCreatingFolder(true);
                    setFolderName("");
                    setMenuFolderId(null);
                    setExpandedFolders((prev) => new Set([...prev, folder.id]));
                  }}
                >
                  하위 폴더 추가
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    if (
                      !confirm(
                        `"${folder.name}" 폴더를 삭제할까요?\n하위 폴더도 함께 삭제되고, 자료는 미분류로 이동합니다.`
                      )
                    ) {
                      return;
                    }
                    setMenuFolderId(null);
                    runAction(() =>
                      deleteLessonMaterialFolder(role, { folderId: folder.id })
                    );
                  }}
                >
                  폴더 삭제
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {expanded
          ? kids.map((child) => renderFolderRow(child, depth + 1))
          : null}
      </div>
    );
  }

  return (
    <div className="flex gap-4 pb-28">
      <aside className="w-60 shrink-0 self-start rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-600">
            자료함 폴더{" "}
            <span className="font-medium text-slate-400">{data.folders.length}</span>
          </p>
          <button
            type="button"
            title="휴지통"
            onClick={() => {
              setFolderFilter("trash");
              setSelected(new Set());
            }}
            className={`rounded-md px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 ${
              folderFilter === "trash" ? "bg-violet-50 text-violet-700" : ""
            }`}
          >
            🗑
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreatingFolder((v) => !v);
            setCreateParentId(null);
            setError(null);
          }}
          className="mb-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-violet-300 bg-violet-50 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
        >
          + 폴더 생성
        </button>

        {creatingFolder ? (
          <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {createParentId ? (
              <p className="text-xs text-slate-500">
                상위: {folderNameById.get(createParentId) ?? "폴더"}
              </p>
            ) : null}
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={createParentId ? "하위 폴더 이름" : "폴더 이름"}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFolder();
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => void handleCreateFolder()}
              >
                만들기
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreatingFolder(false);
                  setCreateParentId(null);
                }}
              >
                취소
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-px">
          <button
            type="button"
            onClick={() => {
              setFolderFilter("all");
              setSelected(new Set());
            }}
            className={`flex w-full items-center justify-between rounded-md px-2 py-[3px] text-left text-[13px] ${
              folderScoped && folderChoice === "all"
                ? "bg-violet-100 font-semibold text-violet-800"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span>전체</span>
            <span className="text-[11px] tabular-nums text-slate-400">{totalActive}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setFolderFilter("unfiled");
              setSelected(new Set());
            }}
            className={`flex w-full items-center justify-between rounded-md px-2 py-[3px] text-left text-[13px] ${
              folderScoped && folderChoice === "unfiled"
                ? "bg-violet-100 font-semibold text-violet-800"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span>미분류</span>
            <span className="text-[11px] tabular-nums text-slate-400">
              {data.unfiledProjects.length}
            </span>
          </button>

          {(childrenByParent.get(null) ?? []).map((f) =>
            renderFolderRow(f, 0)
          )}
        </div>

        <div className="mt-3">
          <Link
            href={newMaterialHref}
            className="inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700"
          >
            + 새 자료 추가
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 space-y-3">
        <nav
          className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-1"
          aria-label="자료 종류"
        >
          {LIBRARY_TABS.filter(
            (tab) =>
              // 테스트 교재 탭은 뺐다(선생님 2026-10-21 「아예 없어 줘」) — 뽑은 테스트지는 워크북 탭 아래에
              tab.id !== "testBook" && (tab.id !== "vocab" || data.vocabTabOpen === true)
          ).map((tab) => {
            const active = libraryTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setLibraryTab(tab.id);
                  setSelected(new Set());
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? "border-violet-600 font-bold text-slate-900"
                    : "border-transparent font-medium text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold text-violet-700">
              {currentFolderLabel}
            </h1>
            <p className="text-xs text-slate-500">
              {tabComingSoon
                ? "준비 중"
                : libraryTab === "questions"
                  ? `${data.questionJobs.length}개의 변형문제가 있습니다.`
                  : documentKind && !showProjectList
                  ? `${tabDocuments.length}개의 파일이 있습니다.`
                  : documentKind
                    ? `파일 ${tabDocuments.length}개 · 지문 ${visibleProjects.length}개`
                    : `${visibleProjects.length}개의 자료가 있습니다.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
              title="내 순서: 끌어서 정한 순서 / 최근 추가순: 새로 만든 자료부터"
              onClick={() => setSortMode((m) => (m === "custom" ? "recent" : "custom"))}
            >
              {sortMode === "custom" ? "내 순서 ▾" : "최근 추가순 ▾"}
            </button>

            {selectedCount > 0 && !inTrash ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    runAction(() =>
                      trashLessonMaterialProjects(role, {
                        projectIds: selectedIds,
                      })
                    )
                  }
                >
                  휴지통 이동 ({selectedCount})
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setMoveOpen((v) => !v);
                      setCopyOpen(false);
                    }}
                  >
                    선택 이동 ({selectedCount})
                  </Button>
                  {moveOpen ? (
                    <div className="absolute right-0 z-20 mt-1 max-h-80 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      <button
                        type="button"
                        className="block w-full truncate rounded-md px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                        onClick={() =>
                          runAction(() =>
                            moveLessonMaterialProjects(role, {
                              projectIds: selectedInViewOrder,
                              folderId: null,
                            })
                          )
                        }
                      >
                        미분류
                      </button>
                      {foldersFlat.map(({ folder: f, depth }) => (
                        <button
                          key={f.id}
                          type="button"
                          className="block w-full truncate rounded-md px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                          style={{ paddingLeft: 10 + depth * 10 }}
                          onClick={() =>
                            runAction(() =>
                              moveLessonMaterialProjects(role, {
                                projectIds: selectedInViewOrder,
                                folderId: f.id,
                              })
                            )
                          }
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setCopyOpen((v) => !v);
                      setMoveOpen(false);
                    }}
                  >
                    복사 ({selectedCount})
                  </Button>
                  {copyOpen ? (
                    <div className="absolute right-0 z-20 mt-1 max-h-80 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      <button
                        type="button"
                        className="block w-full truncate rounded-md px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                        onClick={() =>
                          runAction(() =>
                            copyLessonMaterialProjects(role, {
                              projectIds: selectedInViewOrder,
                              folderId: null,
                            })
                          )
                        }
                      >
                        미분류로 복사
                      </button>
                      {foldersFlat.map(({ folder: f, depth }) => (
                        <button
                          key={f.id}
                          type="button"
                          className="block w-full truncate rounded-md px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                          style={{ paddingLeft: 10 + depth * 10 }}
                          onClick={() =>
                            runAction(() =>
                              copyLessonMaterialProjects(role, {
                                projectIds: selectedInViewOrder,
                                folderId: f.id,
                              })
                            )
                          }
                        >
                          {f.name}로 복사
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {selectedCount > 0 && inTrash ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    runAction(() =>
                      restoreLessonMaterialProjects(role, {
                        projectIds: selectedIds,
                      })
                    )
                  }
                >
                  복원 ({selectedCount})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-rose-600 hover:bg-rose-700"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !confirm(
                        "선택한 자료를 영구 삭제할까요? 되돌릴 수 없습니다."
                      )
                    ) {
                      return;
                    }
                    runAction(() =>
                      permanentlyDeleteLessonMaterialProjects(role, {
                        projectIds: selectedIds,
                      })
                    );
                  }}
                >
                  영구 삭제 ({selectedCount})
                </Button>
              </>
            ) : null}

            {libraryTab === "integrated" ? (
              <button
                type="button"
                onClick={() => setIntegratedOpen({ preselected: [] })}
                className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
              >
                + 새 통합자료 생성
              </button>
            ) : (
              <Link
                href={newMaterialHref}
                className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
              >
                + 새 자료 추가
              </Link>
            )}
          </div>
        </div>

        {error ? (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        ) : null}

        {libraryTab === "questions" && !inTrash ? (
          <LessonQuestionJobList role={role} jobs={data.questionJobs} />
        ) : null}
        {documentKind && !inTrash ? (
          <LessonMaterialDocumentList
            key={documentKind}
            role={role}
            kind={documentKind}
            documents={tabDocuments}
          />
        ) : null}
        {documentKind === "workbook" && !inTrash && (data.documents ?? []).some((d) => d.kind === "test_draw") ? (
          // 뽑은 테스트지(선생님 2026-10-20: 만들고 나면 어디에 저장돼야) — 뽑은 그대로 다시 열어 인쇄
          <div className="mt-4">
            <LessonMaterialDocumentList
              key="test_draw"
              role={role}
              kind="test_draw"
              documents={(data.documents ?? []).filter((d) => d.kind === "test_draw")}
            />
          </div>
        ) : null}
        {libraryTab === "vocab" && !inTrash ? (
          <LessonVocabTab
            role={role}
            sets={data.lessonVocabSets ?? []}
            selectedIds={selectedInInputOrder}
            onMade={() => setSelected(new Set())}
            askSignal={vocabAsk}
            lessonDocs={(data.documents ?? [])
              .filter((d) => d.kind === "lesson_pack")
              .map((d) => ({ name: d.name, project_ids: Array.isArray(d.project_ids) ? d.project_ids : [] }))}
          />
        ) : null}
        {(documentKind || libraryTab === "vocab") && showProjectList && !inTrash ? (
          <h2 className="mt-4 text-sm font-bold text-slate-800">지문별 자료</h2>
        ) : null}

        {!tabComingSoon && showProjectList ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <label className="inline-flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={
                orderedProjects.length > 0 &&
                orderedProjects.every((p) => selected.has(p.id))
              }
              onChange={(e) => selectAllVisible(e.target.checked)}
            />
            전체 선택
          </label>
          <span className="text-[11px] text-slate-400">
            {canReorder
              ? "왼쪽 손잡이를 끌어 순서를 바꾸세요 · Shift + 클릭으로 범위 선택"
              : "Shift + 클릭으로 범위 선택"}
            {reordering ? " · 순서 저장 중…" : ""}
          </span>
        </div>
        ) : null}

        <ul
          className={`mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200 ${
            showProjectList ? "" : "hidden"
          }`}
        >
          {tabComingSoon || orderedProjects.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              {tabEmptyMessage}
            </li>
          ) : (
            orderedProjects.map((p) => {
              const checked = selected.has(p.id);
              const openHref = inTrash
                ? undefined
                : projectOpenHref(p.id);
              const isDragging = draggingId === p.id;
              const isOver = dragOverId === p.id && draggingId !== p.id;
              return (
                <li
                  key={p.id}
                  onDragOver={(e) => {
                    if (!canReorder || !draggingId || draggingId === p.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverId(p.id);
                  }}
                  onDragLeave={() => {
                    setDragOverId((cur) => (cur === p.id ? null : cur));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOn(p.id);
                  }}
                  className={`px-2.5 py-1 first:rounded-t-lg last:rounded-b-lg ${
                    checked ? "bg-violet-50" : "bg-white hover:bg-slate-50"
                  } ${isDragging ? "opacity-50" : ""} ${
                    isOver ? "ring-2 ring-inset ring-violet-400" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {canReorder ? (
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/project-id", p.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(p.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverId(null);
                        }}
                        className={`flex h-6 w-5 shrink-0 cursor-grab select-none items-center justify-center rounded border shadow-sm transition-all duration-150 hover:border-violet-300 hover:bg-violet-600 hover:text-white active:scale-95 active:cursor-grabbing ${
                          isDragging
                            ? "border-violet-500 bg-violet-600 text-white"
                            : "border-slate-200 bg-gradient-to-b from-white to-slate-50 text-slate-400"
                        }`}
                        title="끌어서 순서 변경"
                        aria-label={`${p.title} 순서 변경`}
                      >
                        <GripIcon />
                      </span>
                    ) : (
                      <span className="flex h-6 w-5 shrink-0 items-center justify-center rounded border border-slate-100 text-slate-200" aria-hidden>
                        <GripIcon />
                      </span>
                    )}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        toggleSelect(p.id, (e.nativeEvent as MouseEvent).shiftKey)
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) {
                          e.preventDefault();
                          toggleSelect(p.id, true);
                        }
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      {inTrash ? (
                        <div className="truncate text-[13px] font-semibold text-slate-900">
                          {p.title}
                        </div>
                      ) : editingMetaId === p.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="min-w-0 flex-1 rounded-md border border-violet-300 px-2 py-0.5 text-[13px] font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-200"
                            value={editTitle}
                            autoFocus
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingMetaId(null);
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const name = editTitle.trim();
                                if (!name) return;
                                runAction(async () => {
                                  const res =
                                    await updateLessonMaterialProjectMeta(
                                      role,
                                      { projectId: p.id, title: name }
                                    );
                                  if (res.ok) setEditingMetaId(null);
                                  return res;
                                });
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending || !editTitle.trim()}
                            onClick={() => {
                              const name = editTitle.trim();
                              if (!name) return;
                              runAction(async () => {
                                const res =
                                  await updateLessonMaterialProjectMeta(role, {
                                    projectId: p.id,
                                    title: name,
                                  });
                                if (res.ok) setEditingMetaId(null);
                                return res;
                              });
                            }}
                          >
                            저장
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingMetaId(null)}
                          >
                            취소
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={openHref ?? `${base}/project/${p.id}`}
                            className="min-w-0 truncate text-[13px] font-semibold text-slate-900 hover:text-violet-700"
                            target={
                              libraryTab === "lesson" ||
                              libraryTab === "analysis"
                                ? "_blank"
                                : undefined
                            }
                            rel={
                              libraryTab === "lesson" ||
                              libraryTab === "analysis"
                                ? "noopener noreferrer"
                                : undefined
                            }
                          >
                            {p.title}
                          </Link>
                          <button
                            type="button"
                            title="이름 변경"
                            aria-label="이름 변경"
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-violet-50 hover:text-violet-700"
                            onClick={() => {
                              setEditingMetaId(p.id);
                              setEditTitle(p.title);
                            }}
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-3.5 w-3.5"
                              aria-hidden
                            >
                              <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
                            </svg>
                          </button>
                          {/* 출처는 제목 옆에 작게 둔다. 줄을 따로 두면 한 칸이 두 줄로 커졌다. */}
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                            {p.source?.trim() ?? ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
        </div>
      </main>

      {!inTrash && libraryTab !== "vocab" ? (
        <LessonMaterialsSelectionBar
          role={role}
          selectedCount={selectedCount}
          selectedIds={selectedInInputOrder}
          testBookOpen={false}
          onIntegrated={() => setIntegratedOpen({ preselected: selectedInInputOrder })}
          onVocab={
            data.vocabTabOpen
              ? () => {
                  // 고른 지문은 그대로 두고 단어 탭으로 옮겨 이름 창을 띄운다
                  setLibraryTab("vocab");
                  setVocabAsk((n) => n + 1);
                }
              : undefined
          }
        />
      ) : null}
      {integratedOpen ? (
        <IntegratedCreateModal
          role={role}
          open
          onClose={() => setIntegratedOpen(null)}
          data={data}
          preselectedProjectIds={integratedOpen.preselected}
        />
      ) : null}
    </div>
  );
}
