"use client";

import { useEffect, useRef, useState } from "react";
import { TestDrawDialog } from "@/components/lesson-materials/test-book/TestDrawDialog";
import { WorkbookCreateModal } from "@/components/lesson-materials/WorkbookCreateModal";
import { postJson } from "@/lib/lesson-materials/post-json";
import type { getWorkbookDocument } from "@/lib/lesson-materials/document-actions";
import type { WorkbookData } from "@/lib/lesson-materials/workbook-types";
import {
  copyLessonMaterialDocuments,
  renameLessonMaterialDocument,
  trashLessonMaterialDocuments,
} from "@/lib/lesson-materials/document-actions";
import {
  documentPagePath,
  type LessonMaterialDocumentKind,
  type LessonMaterialDocumentRow,
} from "@/lib/lesson-materials/documents";

const KIND_LABEL: Record<LessonMaterialDocumentKind, string> = {
  lesson_pack: "수업용 자료",
  analysis_report: "지문 분석서",
  workbook: "워크북",
  integrated: "통합자료",
  one_page_summary: "1장 요약직보자료",
  one_page_test: "1장 테스트",
  test_book: "테스트 교재",
  test_draw: "뽑은 테스트지",
};

const KIND_ICON: Record<LessonMaterialDocumentKind, string> = {
  lesson_pack: "✦",
  analysis_report: "📄",
  workbook: "📘",
  integrated: "🗂",
  one_page_summary: "📃",
  one_page_test: "📝",
  test_book: "🧪",
  test_draw: "📑",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return parts;
}

/**
 * 자료함의 "만든 파일" 목록. 지문자료에서 수업용 자료·분석서·워크북을 만들 때마다
 * 파일이 하나씩 생긴다(수업용자료_0911). 이름을 누르면 열리고, 이름을 바꾸거나
 * 휴지통으로 보낼 수 있다. 체크해서 여러 개를 한 번에 지우거나 복사할 수도 있다.
 */
export function LessonMaterialDocumentList({
  role,
  kind,
  documents,
  onSelectedChange,
}: {
  role: "admin" | "teacher";
  kind: LessonMaterialDocumentKind;
  documents: LessonMaterialDocumentRow[];
  /** 고른 파일이 바뀔 때(수업용 자료 파일을 골라도 아래 바로 워크북·분석서를 만들게 — 선생님 2026-11-11) */
  onSelectedChange?: (docs: LessonMaterialDocumentRow[]) => void;
}) {
  const [rows, setRows] = useState(documents);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  // 서버에서 새 목록이 오면(새 파일, 새로 고침) 그것으로 바꾸고, 사라진 파일은 선택에서 뺀다.
  const [seen, setSeen] = useState(documents);
  if (seen !== documents) {
    setSeen(documents);
    setRows(documents);
    const alive = new Set(documents.map((d) => d.id));
    setSelected((prev) => new Set([...prev].filter((id) => alive.has(id))));
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const onSelectedRef = useRef(onSelectedChange);
  onSelectedRef.current = onSelectedChange;
  useEffect(() => {
    onSelectedRef.current?.(rows.filter((r) => selected.has(r.id)));
  }, [selected, rows]);

  function toggleSelect(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked.current) {
        const ids = rows.map((r) => r.id);
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

  /**
   * 테스트 교재: 고른 교재(여러 권이면 지문을 합쳐)로 테스트지 뽑기를 연다. 여는 것은 재료를 새로 만들지 않고,
   * 뽑을 때마다 지문·유형마다 값을 받는다 — 지문 선택 바의 「테스트지 뽑기」와 같은 화면(선생님 2026-10-20).
   */
  /*
   * 워크북·최종통합자료 파일에서도 같은 방식으로(선생님 2026-10-21: 테스트 교재처럼 이름 바꾸기 옆 버튼).
   * 파일의 지문으로 뽑기 창을 연다 — 뽑은 것은 「뽑은 테스트지」 파일로 저장된다.
   */
  const [drawIds, setDrawIds] = useState<string[] | null>(null);
  /** 뽑은 테스트지는 뽑기를 연 자료 이름으로 저장한다(선생님 2026-11-02) */
  const [drawName, setDrawName] = useState<string | null>(null);
  function openDraw(ids: string[]) {
    const picked = rows.filter((r) => ids.includes(r.id));
    const projectIds = [...new Set(picked.flatMap((r) => r.project_ids))];
    if (!projectIds.length) return;
    const first = picked[0]?.name?.trim() ?? "";
    setDrawName(first ? (picked.length > 1 ? `${first} 외 ${picked.length - 1}` : first) : null);
    setDrawIds(projectIds);
  }
  const canDraw = kind === "test_book" || kind === "workbook" || kind === "integrated";

  /*
   * 워크북 파일에 유형 더하기(선생님 2026-10-24: 이름 바꾸기 옆 버튼). 저장본의 유형을 읽어 만들기 창을
   * 추가 모드로 띄우고, 값 확인이 끝나면 워크북 화면을 새 탭에서 add=1로 열어 거기서 만들어 합친다.
   */
  const [addTarget, setAddTarget] = useState<{ id: string; projectIds: string[]; existingTypes: WorkbookData["selectedTypes"]; mode: "add" | "regen" } | null>(null);
  async function openAddTypes(doc: LessonMaterialDocumentRow, mode: "add" | "regen" = "add") {
    setError(null);
    setBusyIds(new Set([doc.id]));
    const res = await postJson<Awaited<ReturnType<typeof getWorkbookDocument>>>("/api/lesson-materials/documents/open", {
      op: "getWorkbook",
      role,
      id: doc.id,
    });
    setBusyIds(new Set());
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const payload = res.payload as WorkbookData | null;
    if (!payload || !Array.isArray(payload.selectedTypes)) {
      setError("저장된 워크북 내용이 없어 유형을 더할 수 없습니다. 워크북을 먼저 열어 완성해 주세요.");
      return;
    }
    const projectIds = res.projectIds?.length ? res.projectIds : doc.project_ids;
    if (!projectIds.length) {
      setError("이 워크북에는 지문이 없어 유형을 더할 수 없습니다.");
      return;
    }
    setAddTarget({ id: doc.id, projectIds, existingTypes: payload.selectedTypes, mode });
  }

  function open(id: string) {
    window.open(`${documentPagePath(role, kind)}?doc=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  }

  async function commitRename(id: string) {
    const name = draft.trim();
    const before = rows.find((r) => r.id === id)?.name ?? "";
    setEditingId(null);
    if (!name || name === before) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    setBusyIds(new Set([id]));
    const res = await renameLessonMaterialDocument(role, { id, name });
    setBusyIds(new Set());
    if (!res.ok) {
      setError(res.message);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name: before } : r)));
      return;
    }
  }

  async function trash(ids: string[], question: string) {
    if (ids.length === 0 || !window.confirm(`${question} 지문 자료는 그대로 남습니다.`)) return;
    setError(null);
    setBusyIds(new Set(ids));
    const res = await trashLessonMaterialDocuments(role, { ids });
    setBusyIds(new Set());
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const gone = new Set(ids);
    setRows((prev) => prev.filter((r) => !gone.has(r.id)));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
  }

  /** 고른 파일을 내용째 복사한다 — 사본은 목록 맨 위에 「이름 사본」으로 생긴다. */
  async function copy(ids: string[]) {
    if (ids.length === 0) return;
    setError(null);
    setBusyIds(new Set(ids));
    const res = await copyLessonMaterialDocuments(role, { ids });
    setBusyIds(new Set());
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const known = new Set(rows.map((r) => r.id));
    setRows((prev) => [...res.documents.filter((d) => !known.has(d.id)), ...prev]);
    setSelected(new Set());
  }

  return (
    <section className="mt-3">
      <h2 className="mb-2 text-sm font-bold text-slate-800">
        만든 {KIND_LABEL[kind]} <span className="font-semibold text-slate-400">{rows.length}</span>
      </h2>
      {error ? <p className="mb-2 text-xs text-rose-600">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          지문자료 탭에서 지문을 골라 {KIND_LABEL[kind]} 제작을 누르면 여기에 파일로 저장됩니다.
        </p>
      ) : (
        <>
        <div className="mb-1.5 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <label className="inline-flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
              }
            />
            전체 선택
          </label>
          <span className="text-[11px] text-slate-400">Shift + 클릭으로 범위 선택</span>
          {canDraw && selected.size > 0 ? (
            <button
              type="button"
              onClick={() => openDraw([...selected])}
              className="ml-auto rounded-md bg-violet-600 px-2.5 py-0.5 text-[11px] font-bold text-white hover:bg-violet-700"
            >
              테스트지 뽑기 ({selected.size}개)
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              disabled={busyIds.size > 0}
              onClick={() => void copy(rows.filter((r) => selected.has(r.id)).map((r) => r.id))}
              className={`${canDraw ? "" : "ml-auto "}rounded-md border border-violet-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50`}
            >
              선택 복사 ({selected.size})
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              disabled={busyIds.size > 0}
              onClick={() =>
                void trash(
                  rows.filter((r) => selected.has(r.id)).map((r) => r.id),
                  `선택한 파일 ${selected.size}개를 삭제할까요?`
                )
              }
              className={`rounded-md border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50`}
            >
              선택 삭제 ({selected.size})
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {rows.map((doc) => (
            <li
              key={doc.id}
              className={`flex items-center gap-2.5 px-3 py-1.5 ${
                selected.has(doc.id) ? "bg-violet-50" : "bg-white hover:bg-slate-50"
              } ${busyIds.has(doc.id) ? "opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                onChange={(e) => toggleSelect(doc.id, (e.nativeEvent as MouseEvent).shiftKey)}
                onClick={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    toggleSelect(doc.id, true);
                  }
                }}
                aria-label={`${doc.name} 선택`}
              />
              <span className="text-xs" aria-hidden>
                {KIND_ICON[kind]}
              </span>
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                {editingId === doc.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(doc.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full max-w-md rounded-md border border-violet-300 px-2 py-0.5 text-[13px] font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-200"
                    aria-label="파일 이름"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => open(doc.id)}
                    className="min-w-0 truncate text-left text-[13px] font-semibold text-slate-900 hover:text-violet-700 hover:underline"
                    title="새 탭에서 열기"
                  >
                    {doc.name}
                  </button>
                )}
                <span className="shrink-0 text-[11px] text-slate-400">
                  지문 {doc.project_ids.length}개 · {formatWhen(doc.created_at)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canDraw ? (
                  <button
                    type="button"
                    onClick={() => openDraw([doc.id])}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                  >
                    테스트지 뽑기
                  </button>
                ) : null}
                {kind === "workbook" ? (
                  <button
                    type="button"
                    disabled={busyIds.has(doc.id)}
                    onClick={() => void openAddTypes(doc)}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    title="이 워크북에 없는 유형을 더합니다"
                  >
                    유형 추가
                  </button>
                ) : null}
                {kind === "workbook" ? (
                  <button
                    type="button"
                    disabled={busyIds.has(doc.id)}
                    onClick={() => void openAddTypes(doc, "regen")}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    title="들어 있는 유형 가운데 골라 새로 만들어 바꿔 넣습니다"
                  >
                    다시 만들기
                  </button>
                ) : null}
                {kind === "lesson_pack" ? (
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `${documentPagePath(role, "lesson_pack")}/vocab-exam?doc=${encodeURIComponent(doc.id)}`,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                    title="이 수업용 자료의 단어로 영→한·한→영·동의어·반의어·파생어 시험지를 찍습니다"
                  >
                    단어 시험지
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setDraft(doc.name);
                    setEditingId(doc.id);
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
                >
                  이름 바꾸기
                </button>
                <button
                  type="button"
                  disabled={busyIds.size > 0}
                  onClick={() => void copy([doc.id])}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                  title="내용째 사본을 만듭니다"
                >
                  복사
                </button>
                <button
                  type="button"
                  onClick={() => void trash([doc.id], `「${doc.name}」 파일을 삭제할까요?`)}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
      <TestDrawDialog role={role} projectIds={drawIds ?? []} docName={drawName} open={!!drawIds} onClose={() => setDrawIds(null)} />
      {addTarget ? (
        <WorkbookCreateModal
          key={addTarget.mode}
          role={role}
          mode={addTarget.mode}
          projectIds={addTarget.projectIds}
          existingTypes={addTarget.existingTypes}
          open
          onClose={() => setAddTarget(null)}
          onAdd={(query) => {
            const params = new URLSearchParams(query);
            params.set("doc", addTarget.id);
            params.set("add", "1");
            // 워크북 화면이 add=1을 받아 더할 유형만 만들고 파일에 합친다(WorkbookWorkbench).
            window.open(`${documentPagePath(role, "workbook")}?${params.toString()}`, "_blank", "noopener,noreferrer");
          }}
        />
      ) : null}
    </section>
  );
}
