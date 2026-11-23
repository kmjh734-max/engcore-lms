"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/lesson-materials/post-json";
import { DOCUMENT_NAME_EVENT } from "@/components/lesson-materials/open-new-document";

/**
 * 자료 화면 왼쪽 위의 파일 이름(선생님 2026-10-21: 수업용 자료든 분석지든 만들면 그 파일 제목을 왼쪽 위에).
 * 주소의 ?doc=로 이름을 읽고, 새로 만들면 만든 뒤에 받는다. 누르면 그 자리에서 이름을 바꾼다.
 * 파일이 없는 화면(주소에 doc이 없고 만들지도 않음)에서는 기본 글자(fallback)를 보인다.
 */
export function DocumentTitle({
  role,
  fallback,
  asField = false,
}: {
  role: "admin" | "teacher";
  fallback: string;
  /** 「파일 이름」 칸으로 늘 보이게(선생님 2026-10-26: 수업용 자료도 닫기(저장) 아래에 파일 이름 입력) */
  asField?: boolean;
}) {
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState(false);
  /** 파일 이름 칸: 바꾼 뒤 잠깐 「저장했습니다」 */
  const [savedNote, setSavedNote] = useState<"saved" | "error" | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onName = (e: Event) => {
      const d = (e as CustomEvent).detail as { id?: string; name?: string } | undefined;
      if (d?.id && d.name) setDoc({ id: d.id, name: d.name });
    };
    window.addEventListener(DOCUMENT_NAME_EVENT, onName);
    const id = new URLSearchParams(window.location.search).get("doc")?.trim();
    if (id) {
      void postJson<{ ok: true; name: string } | { ok: false; message: string }>("/api/lesson-materials/documents/open", {
        op: "getName",
        role,
        id,
      })
        .then((res) => {
          if (res.ok) setDoc((cur) => cur ?? { id, name: res.name });
        })
        .catch(() => {});
    }
    return () => window.removeEventListener(DOCUMENT_NAME_EVENT, onName);
  }, [role]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    setEditing(false);
    const name = draft.trim();
    if (!doc || !name || name === doc.name) return;
    const prev = doc.name;
    setDoc({ ...doc, name });
    const res = await postJson<{ ok: true; name: string } | { ok: false; message: string }>("/api/lesson-materials/documents/open", {
      op: "rename",
      role,
      id: doc.id,
      name,
    }).catch(() => null);
    if (!res || !res.ok) setDoc({ ...doc, name: prev });
    // 쪽 머리에 파일 이름을 찍는 화면(워크북)이 바로 따라 바뀌게 알린다
    else window.dispatchEvent(new CustomEvent(DOCUMENT_NAME_EVENT, { detail: { id: doc.id, name: res.name || name } }));
    setSavedNote(res && res.ok ? "saved" : "error");
    setTimeout(() => setSavedNote(null), 2500);
  }

  if (asField) {
    return (
      <label className="block space-y-1">
        <span className="flex items-center justify-between text-xs font-bold text-slate-500">
          파일 이름
          {savedNote ? (
            <span className={`text-[11px] font-semibold ${savedNote === "saved" ? "text-emerald-600" : "text-rose-600"}`}>
              {savedNote === "saved" ? "✓ 저장했습니다" : "저장하지 못했습니다"}
            </span>
          ) : (
            <span className="text-[11px] font-normal text-slate-400">고치고 Enter</span>
          )}
        </span>
        <input
          value={editing ? draft : (doc?.name ?? "")}
          placeholder={doc ? "" : `${fallback} (파일을 만드는 중…)`}
          disabled={!doc}
          maxLength={80}
          onFocus={() => {
            if (!doc) return;
            setDraft(doc.name);
            setEditing(true);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(doc?.name ?? "");
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50"
        />
      </label>
    );
  }
  if (!doc) return <span className="min-w-0 truncate text-sm font-bold text-slate-900">{fallback}</span>;
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="min-w-0 flex-1 rounded-md border border-violet-300 px-2 py-0.5 text-sm font-bold text-slate-900 outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      title={`${doc.name} — 눌러서 이름 바꾸기`}
      onClick={() => {
        setDraft(doc.name);
        setEditing(true);
      }}
      className="min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left text-sm font-bold text-slate-900 hover:bg-slate-100"
    >
      {doc.name}
    </button>
  );
}
