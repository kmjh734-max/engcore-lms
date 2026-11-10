import type { SupabaseClient } from "@supabase/supabase-js";
import { joinOrphanParticles } from "@/lib/korean-spacing";

/** 모의고사 지문 모음(mock_exam_passages): 학력평가·모의평가 영어 지문 원문 */
export type MockPassage = {
  id: string;
  year: number;
  month: number;
  grade: number;
  kind: string;
  item_no: string;
  english_text: string;
  korean_text: string | null;
  gloss: string | null;
  word_count: number;
};

export type MockExamSummary = {
  key: string;
  year: number;
  month: number;
  grade: number;
  kind: string;
  count: number;
};

/*
 * 시험 종류: 학력평가 · 모의평가 · 수능(2026-11-10 워크시트메이커에서 넣음). 수능은 시행 연도·달로 적고(2025년 11월 =
 * 2026학년도 수능, 2020년은 12월 시행) 고3으로 둔다.
 */
export function mockKindShort(kind: string): string {
  return kind === "모의평가" ? "모평" : kind === "수능" ? "수능" : "학평";
}

/** 시험 이름: 24년 고2 6월 학평 · 25년 11월 수능(26학년도) */
export function mockExamShortName(p: { year: number; month: number; grade: number; kind: string }): string {
  const yy = String(p.year).slice(2);
  if (p.kind === "수능") return `${yy}년 ${p.month}월 수능(${String(p.year + 1).slice(2)}학년도)`;
  return `${yy}년 고${p.grade} ${p.month}월 ${mockKindShort(p.kind)}`;
}

/** 2024년 고2 6월 학력평가 24번 · 2025년 11월 수능(2026학년도) 24번 */
export function mockPassageLabel(p: Pick<MockPassage, "year" | "month" | "grade" | "kind" | "item_no">) {
  if (p.kind === "수능") return `${p.year}년 ${p.month}월 수능(${p.year + 1}학년도) ${p.item_no}번`;
  return `${p.year}년 고${p.grade} ${p.month}월 ${p.kind} ${p.item_no}번`;
}

/** 24년 고2 6월 학평 24번 (보고서 표처럼 좁은 칸) */
export function mockPassageShortLabel(p: Pick<MockPassage, "year" | "month" | "grade" | "kind" | "item_no">) {
  return `${mockExamShortName(p)} ${p.item_no}번`;
}

export const mockExamKey = (p: { year: number; month: number; grade: number }) => `${p.year}-${p.month}-${p.grade}`;

const COLUMNS = "id, year, month, grade, kind, item_no, english_text, korean_text, gloss, word_count";

/*
 * 해석의 띄어쓰기를 읽어 올 때 손본다.
 *
 * 선생님과 함께 훑어 보니(2026-09-29) 1,400개 가운데 886개(63%)에서 조사가
 * 홀로 떨어져 있었다 — 「최적 의」·「비율 을」·「관점 에서」. PDF에서 줄이 바뀌던
 * 자리가 공백으로 들어온 자국이고, 학생이 받는 자료에 그대로 실린다.
 *
 * 적재해 둔 것을 고치지 않고 읽는 자리에서 붙인다. 앞으로 새로 넣는 것도
 * 함께 손질되고, 원본은 건드리지 않는다.
 */
function tidy<T extends { korean_text?: string | null }>(rows: T[]): T[] {
  return rows.map((r) =>
    r.korean_text ? { ...r, korean_text: joinOrphanParticles(r.korean_text) } : r
  );
}

/** 시험 목록 (학년·연도·월별 지문 수) */
export async function loadMockExamList(admin: SupabaseClient): Promise<MockExamSummary[]> {
  // 한 번에 1,000줄까지만 오므로 나눠 읽는다
  const data: { year: number; month: number; grade: number; kind: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await admin
      .from("mock_exam_passages")
      .select("year, month, grade, kind")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("id")
      .range(from, from + 999);
    data.push(...((page ?? []) as typeof data));
    if (!page || page.length < 1000) break;
  }
  const map = new Map<string, MockExamSummary>();
  for (const r of data) {
    const key = mockExamKey(r as MockExamSummary);
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { key, year: r.year, month: r.month, grade: r.grade, kind: r.kind, count: 1 });
  }
  return [...map.values()];
}

/** 시험 하나의 지문들 (번호 순) */
export async function loadMockExamPassages(
  admin: SupabaseClient,
  exam: { year: number; month: number; grade: number }
): Promise<MockPassage[]> {
  const { data } = await admin
    .from("mock_exam_passages")
    .select(COLUMNS)
    .eq("year", exam.year)
    .eq("month", exam.month)
    .eq("grade", exam.grade)
    .order("sort_no");
  return tidy((data ?? []) as MockPassage[]);
}

/** 대조용: 전체 지문 */
export async function loadAllMockPassages(admin: SupabaseClient): Promise<MockPassage[]> {
  const out: MockPassage[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("mock_exam_passages")
      .select(COLUMNS)
      .order("id")
      .range(from, from + 999);
    out.push(...tidy((data ?? []) as MockPassage[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
