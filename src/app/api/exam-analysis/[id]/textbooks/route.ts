import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnAnalysis, requireExamStaff } from "@/lib/exam-analysis/access";
import { resolveTextbookPassageAcademyId } from "@/lib/textbooks/shared-passages";
import { mockExamShortName } from "@/lib/mock-passages";

export const runtime = "nodejs";

/**
 * 출처를 손으로 달 때 고를 목록 — 교과서 본문과 모의고사 지문.
 *
 * 지문 불러오기와 달리 대화문(듣기·말하기)도 함께 준다 — 듣기 지문이 시험에
 * 나오면 그 출처도 달 수 있어야 한다.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  if (!(await loadOwnAnalysis(id, auth.profile.academy_id))) {
    return NextResponse.json({ ok: false, message: "분석을 찾을 수 없어요." }, { status: 404 });
  }

  const admin = createAdminClient();
  const ownerId = await resolveTextbookPassageAcademyId(admin, auth.profile.academy_id);
  const rows: { id: string; subject: string; publisher: string; lesson: string; part: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("textbook_passages")
      .select("id, subject, publisher, lesson, part")
      .eq("academy_id", ownerId)
      .order("order_index")
      .range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }

  // 교재별로 묶어 준다 — 고를 때 교재를 먼저 고르고 본문을 고른다
  const books = new Map<string, { key: string; label: string; parts: { id: string; label: string }[] }>();
  for (const r of rows) {
    const key = `${r.subject}|${r.publisher}`;
    if (!books.has(key)) books.set(key, { key, label: `${r.publisher} ${r.subject}`, parts: [] });
    books.get(key)!.parts.push({ id: r.id, label: `${r.lesson} ${r.part}` });
  }
  // 모의고사는 시험 회차로 묶는다
  const mockRows: { id: string; year: number; month: number; grade: number; kind: string; item_no: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("mock_exam_passages")
      .select("id, year, month, grade, kind, item_no")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("sort_no")
      .range(from, from + 999);
    mockRows.push(...((data ?? []) as typeof mockRows));
    if (!data || data.length < 1000) break;
  }
  const exams = new Map<string, { key: string; label: string; parts: { id: string; label: string }[] }>();
  for (const r of mockRows) {
    const key = `${r.year}-${r.month}-${r.grade}`;
    if (!exams.has(key)) {
      exams.set(key, { key, label: mockExamShortName(r), parts: [] });
    }
    exams.get(key)!.parts.push({ id: r.id, label: `${r.item_no}번` });
  }

  /*
   * 이 시험이 주로 어느 교재·회차에서 나왔는지 앞으로 올린다.
   *
   * 선생님 말씀(2026-09-30): 다른 지문이 2026년 고2 3월이면 그 지문도 그 3월 안에
   * 있을 가능성이 높다. 자동으로 그 안을 다시 뒤지는 것은 해 보니 겹침이 0이라
   * 소용이 없었다 — 대신 손으로 달 때 그 회차가 맨 위에 오게 해 찾기 쉽게 한다.
   */
  const { data: matched } = await admin
    .from("school_exam_items")
    .select("matched_textbook_id, matched_mock_id")
    .eq("analysis_id", id);
  const bookHits = new Map<string, number>();
  const examHits = new Map<string, number>();
  for (const r of matched ?? []) {
    if (r.matched_textbook_id) {
      const row = rows.find((x) => x.id === r.matched_textbook_id);
      if (row) {
        const k = `${row.subject}|${row.publisher}`;
        bookHits.set(k, (bookHits.get(k) ?? 0) + 1);
      }
    }
    if (r.matched_mock_id) {
      const row = mockRows.find((x) => x.id === r.matched_mock_id);
      if (row) {
        const k = `${row.year}-${row.month}-${row.grade}`;
        examHits.set(k, (examHits.get(k) ?? 0) + 1);
      }
    }
  }
  const byUse = (hits: Map<string, number>) =>
    (a: { key: string; label: string }, b: { key: string; label: string }) => {
      const d = (hits.get(b.key) ?? 0) - (hits.get(a.key) ?? 0);
      return d !== 0 ? d : a.label.localeCompare(b.label, "ko");
    };

  return NextResponse.json({
    ok: true,
    books: [...books.values()].sort(byUse(bookHits)),
    mocks: [...exams.values()].sort(byUse(examHits)),
  });
}
