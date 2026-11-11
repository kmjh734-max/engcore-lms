import type { VocabItem } from "@/types/database";

export type VocabPrintRow = VocabItem;

export interface VocabPrintSection {
  setId: string;
  title: string;
  description?: string | null;
  items: VocabPrintRow[];
  /**
   * 수업자료에서 만든 단어장이면 지문(출처)별 단어 번호 구간(1부터, 끝 포함). 시험지를 지문별로 뽑을 때 쓴다
   * (선생님 2026-11-06: 번호순 말고 지문별로도).
   */
  passageGroups?: VocabPassageGroup[];
}

export interface VocabPassageGroup {
  label: string;
  from: number;
  to: number;
  /** 지문 출처·제목(단어 탭 전체 단어장·지문별 시험지에 — 2026-11-11) */
  source?: string | null;
  title?: string | null;
}
