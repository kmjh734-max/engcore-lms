"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/lesson-materials/post-json";
import type { loadDrawProjectsAction } from "@/lib/lesson-materials/test-book-actions";
import {
  VOCAB_EXAM_KINDS,
  buildVocabExam,
  isTestBookProjectReady,
  type TestBookProjectInput,
  type VocabExamKind,
} from "@/lib/lesson-materials/test-book";

type LoadResult = Awaited<ReturnType<typeof loadDrawProjectsAction>>;

/** 단어 시험으로 낼 수 있는 양 — 고른 지문 단어 수와 유형마다 최대 문항 수 */
export type VocabExamCaps = {
  words: number;
  perKind: Record<VocabExamKind, number>;
  /** 단어 정리가 아직 없는 지문 수(만들 때 재료를 만들고 나서 센다) */
  missing: number;
};

/** 이미 받은 지문으로 센다(값·호출 없음). 지문 단어를 합쳐 같은 낱말은 한 번만. */
export function vocabExamCaps(
  projects: TestBookProjectInput[],
  range: { from: number; to: number } | null = null
): VocabExamCaps {
  const ready = projects.filter(isTestBookProjectReady);
  const all = Object.fromEntries(VOCAB_EXAM_KINDS.map((k) => [k.key, 9999])) as Record<VocabExamKind, number>;
  const exam = buildVocabExam(
    ready.map((p, i) => ({ passage: i + 1, vocab: p.material.vocab })),
    { counts: all, seed: "caps", range, shareWords: true }
  );
  const perKind = Object.fromEntries(VOCAB_EXAM_KINDS.map((k) => [k.key, 0])) as Record<VocabExamKind, number>;
  for (const s of exam.sections) perKind[s.kind] = s.items.length;
  const words = new Set(ready.flatMap((p) => p.material.vocab.filter((r) => r.word && r.meaning).map((r) => r.word.toLowerCase()))).size;
  return { words, perKind, missing: projects.length - ready.length };
}

/**
 * 만들기 전에 단어 수를 보여 준다(선생님 2026-10-27: 추출된 단어 개수를 분석지를 만들어야만 알 수 있다).
 * 지문 재료만 읽는다 — 재료를 새로 만들지 않는다.
 */
export function useVocabExamCaps(role: "admin" | "teacher", projectIds: string[], enabled: boolean): VocabExamCaps | null {
  const [caps, setCaps] = useState<VocabExamCaps | null>(null);
  const key = projectIds.join(",");
  useEffect(() => {
    if (!enabled || !projectIds.length) return;
    let alive = true;
    void postJson<LoadResult>("/api/lesson-materials/test-book", { role, op: "loadDraw", projectIds })
      .then((res) => {
        if (alive && res.ok) setCaps(vocabExamCaps(res.projects));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, role]);
  return enabled ? caps : null;
}
