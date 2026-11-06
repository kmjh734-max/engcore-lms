"use client";

import { useEffect, useState } from "react";
import { getLessonMaterialDocumentName } from "@/lib/lesson-materials/document-actions";

/**
 * 지금 연 자료 파일(?doc=)의 이름. PDF 저장 이름을 「자료 이름_수업용자료」처럼 짓는 데 쓴다
 * (선생님 2026-11-06: 지문 제목이 아니라 원래 제목으로). 파일로 연 게 아니면 null.
 */
export function useDocumentName(role: "admin" | "teacher"): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("doc")?.trim();
    if (!id) return;
    let alive = true;
    void getLessonMaterialDocumentName(role, { id })
      .then((r) => {
        if (alive && r.ok) setName(r.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [role]);
  return name;
}
