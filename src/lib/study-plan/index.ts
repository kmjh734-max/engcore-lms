import type { SupabaseClient } from "@supabase/supabase-js";
import { weeksInMonth } from "./weekday-dates";

/**
 * 학습일정표 — 학생 한 명의 한 달 계획.
 * 엑셀 양식(정수학원 1:1 맞춤 PLAN)을 그대로 옮긴다: 주차 × 영역 × 수업 회차.
 */
export const DEFAULT_AREAS = ["영단어", "문법", "독해", "듣기"];
/*
 * 주차는 그 달이 걸치는 주를 쓴다 — weekday-dates.ts의 weeksInMonth.
 * 예전에 있던 고정값 [1,2,3,4]는 뺐다. 9월처럼 5주에 걸치는 달에서 학생 화면이
 * 5주차 줄을 통째로 빠뜨렸다(선생님 지적 2026-09-28).
 */

/**
 * 숙제를 했는지 선생님이 찍어 두는 칸 — 빈 문자열은 아직 안 찍음.
 *
 * 선생님 요청(2026-09-30): 영역마다 숙제를 했는지 체크하고 싶다.
 * 「미실시 · 미흡 · 완료」 세 단계를 쓴다. 처음에 「확인」을 끼워 넣었다가
 * 선생님이 세 단계로 줄이자고 해서 뺐다 — 예전 값은 빈 칸으로 열린다.
 */
export type HomeworkCheck = "" | "none" | "weak" | "done";
export const HOMEWORK_CHECK_LABELS: Record<Exclude<HomeworkCheck, "">, string> = {
  none: "미실시",
  weak: "미흡",
  done: "완료",
};
const HOMEWORK_CHECKS = Object.keys(HOMEWORK_CHECK_LABELS) as Array<Exclude<HomeworkCheck, "">>;

export type PlanEntry = {
  progress: string;
  homework: string;
  note: string;
  check: HomeworkCheck;
};

/** 회차 출결 — 빈 문자열은 아직 적지 않음 */
export type Attendance = "" | "present" | "late" | "absent" | "makeup" | "holiday";
export const ATTENDANCE_LABELS: Record<Exclude<Attendance, "">, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  makeup: "보강",
  holiday: "공휴일",
};
export type PlanRow = {
  id: string;
  week: number;
  area: string;
  textbook: string;
  orderIndex: number;
  entries: PlanEntry[];
};
export type StudyPlan = {
  id: string;
  studentId: string;
  year: number;
  month: number;
  sessionsPerWeek: number;
  teacherId: string | null;
  note: string;
  /** 주차별 수업 날짜: { "1": ["2026-09-01", …] } */
  sessionDates: Record<string, string[]>;
  /** 주차별 회차 출결: { "1": ["present", "absent", …] } */
  attendance: Record<string, Attendance[]>;
  rows: PlanRow[];
};

export const emptyEntry = (): PlanEntry => ({
  progress: "",
  homework: "",
  note: "",
  check: "",
});

export function fitEntries(entries: unknown, sessions: number): PlanEntry[] {
  const list = Array.isArray(entries) ? entries : [];
  return Array.from({ length: sessions }, (_, i) => {
    const e = (list[i] ?? {}) as Partial<PlanEntry>;
    const check = String(e.check ?? "");
    return {
      progress: String(e.progress ?? ""),
      homework: String(e.homework ?? ""),
      note: String(e.note ?? ""),
      // 예전에 저장한 줄에는 이 칸이 없다 — 모르는 값은 빈 칸으로 둔다
      check: (HOMEWORK_CHECKS as string[]).includes(check) ? (check as HomeworkCheck) : "",
    };
  });
}

/** 이 학생의 그 달 일정표. 없으면 null */
export async function loadStudyPlan(
  admin: SupabaseClient,
  studentId: string,
  year: number,
  month: number
): Promise<StudyPlan | null> {
  const { data: plan } = await admin
    .from("study_plans")
    .select("id, student_id, year, month, sessions_per_week, teacher_id, note, session_dates, attendance")
    .eq("student_id", studentId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (!plan) return null;

  const { data: rows } = await admin
    .from("study_plan_rows")
    .select("id, week, area, textbook, order_index, entries")
    .eq("plan_id", plan.id)
    .order("week")
    .order("order_index");

  const sessions = Number(plan.sessions_per_week) || 3;
  return {
    id: plan.id as string,
    studentId: plan.student_id as string,
    year: Number(plan.year),
    month: Number(plan.month),
    sessionsPerWeek: sessions,
    teacherId: (plan.teacher_id as string | null) ?? null,
    note: String(plan.note ?? ""),
    sessionDates: (plan.session_dates ?? {}) as Record<string, string[]>,
    attendance: (plan.attendance ?? {}) as Record<string, Attendance[]>,
    rows: (rows ?? []).map((r) => ({
      id: r.id as string,
      week: Number(r.week),
      area: String(r.area ?? ""),
      textbook: String(r.textbook ?? ""),
      orderIndex: Number(r.order_index ?? 0),
      entries: fitEntries(r.entries, sessions),
    })),
  };
}

/** 지난달 것을 베껴 새 달 일정표를 만든다(교재명은 그대로, 진도·숙제는 비운다) */
export async function createStudyPlan(
  admin: SupabaseClient,
  input: {
    academyId: string;
    studentId: string;
    year: number;
    month: number;
    sessionsPerWeek: number;
    teacherId?: string | null;
    createdBy?: string | null;
    copyFrom?: { year: number; month: number } | null;
  }
): Promise<StudyPlan> {
  const { data: plan, error } = await admin
    .from("study_plans")
    .insert({
      academy_id: input.academyId,
      student_id: input.studentId,
      year: input.year,
      month: input.month,
      sessions_per_week: input.sessionsPerWeek,
      teacher_id: input.teacherId ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !plan) throw new Error(error?.message ?? "일정표를 만들지 못했습니다.");

  const previous = input.copyFrom
    ? await loadStudyPlan(admin, input.studentId, input.copyFrom.year, input.copyFrom.month)
    : null;

  /*
   * 지난달 영역·교재명만 물려받는다.
   *
   * 선생님 지적(2026-10-01): 10월 표가 통째로 비어 있었다. 지난달 **1주차** 줄만
   * 보고 물려받는데, 달 중간에 들어온 학생은 앞 주차를 빼 두어 1주차에 줄이 없다
   * (9월은 5주차만 있었다). 그래서 물려받을 것이 없다고 보고 빈 표를 만들었다.
   *
   * 줄이 있는 **마지막 주차**를 본다 — 교재는 달이 갈수록 바뀌므로 그 달의 끝이
   * 다음 달 시작에 가깝다. 지난달이 아예 비어 있으면 기본 영역으로 채운다.
   */
  const lastWeek = previous?.rows.length
    ? Math.max(...previous.rows.map((r) => r.week))
    : null;
  const carried = previous && lastWeek !== null
    ? [...new Map(
        previous.rows
          .filter((r) => r.week === lastWeek)
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((r) => [r.area, r.textbook]),
      ).entries()]
    : [];
  const areas = carried.length
    ? carried
    : DEFAULT_AREAS.map((a) => [a, ""] as [string, string]);

  const rows = weeksInMonth(input.year, input.month).flatMap((week) =>
    areas.map(([area, textbook], i) => ({
      plan_id: plan.id,
      week,
      area,
      textbook,
      order_index: i,
      entries: Array.from({ length: input.sessionsPerWeek }, () => emptyEntry()),
    }))
  );
  if (rows.length > 0) {
    const { error: rowsErr } = await admin.from("study_plan_rows").insert(rows);
    if (rowsErr) {
      // 빈 표가 「만들었어요」로 남고 같은 달 다시 만들기도 막히던 것 — 표를 지우고 실패로 알린다(2026-11-28 점검)
      await admin.from("study_plans").delete().eq("id", plan.id);
      throw new Error(`학습일정표 줄을 넣지 못했어요: ${rowsErr.message}`);
    }
  }

  return (await loadStudyPlan(admin, input.studentId, input.year, input.month))!;
}

/** 표 전체 저장 (행을 지웠다 다시 넣는다 — 영역을 더하거나 뺄 수 있다) */
export async function saveStudyPlanRows(
  admin: SupabaseClient,
  planId: string,
  sessionsPerWeek: number,
  rows: Array<Omit<PlanRow, "id">>,
  sessionDates?: Record<string, string[]>,
  attendance?: Record<string, Attendance[]>
): Promise<void> {
  /*
   * 2026-09-28: 여기서 오류를 하나도 보지 않고 있었다. 줄을 지운 뒤 넣다가 실패하면
   * 적어 둔 것이 모두 사라지는데 화면에는 "저장했어요"가 떴다. 선생님이 "저장해도
   * 제대로 저장이 안 되는 것 같다"고 한 것이 이것이다. 이제 한 단계마다 확인하고,
   * 넣기가 실패하면 지우기 전 줄을 되돌려 놓는다.
   */
  const { error: planError } = await admin
    .from("study_plans")
    .update({
      sessions_per_week: sessionsPerWeek,
      ...(sessionDates ? { session_dates: sessionDates } : {}),
      ...(attendance ? { attendance } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);
  if (planError) throw new Error(`일정표를 저장하지 못했어요: ${planError.message}`);

  // 지우기 전에 지금 줄을 들고 있는다 — 넣기가 실패하면 이것으로 되돌린다
  const { data: before } = await admin
    .from("study_plan_rows")
    .select("week, area, textbook, order_index, entries")
    .eq("plan_id", planId);

  const { error: deleteError } = await admin
    .from("study_plan_rows")
    .delete()
    .eq("plan_id", planId);
  if (deleteError) throw new Error(`이전 내용을 지우지 못했어요: ${deleteError.message}`);

  if (rows.length === 0) return;

  const { error: insertError } = await admin.from("study_plan_rows").insert(
    rows.map((r) => ({
      plan_id: planId,
      week: r.week,
      area: r.area,
      textbook: r.textbook,
      order_index: r.orderIndex,
      entries: fitEntries(r.entries, sessionsPerWeek),
    }))
  );
  if (insertError) {
    if (before?.length) {
      await admin
        .from("study_plan_rows")
        .insert(before.map((r) => ({ ...r, plan_id: planId })));
    }
    throw new Error(`저장하지 못했어요: ${insertError.message}`);
  }

  // 정말 들어갔는지 되읽어 본다. 넣었다는 말만 믿지 않는다.
  const { count } = await admin
    .from("study_plan_rows")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (count !== rows.length) {
    throw new Error(`저장이 덜 됐어요. ${rows.length}줄을 보냈는데 ${count ?? 0}줄만 들어갔어요.`);
  }
}

/** 학생이 가진 일정표 목록(최근 것부터) */
export async function listStudyPlans(
  admin: SupabaseClient,
  studentId: string
): Promise<Array<{ year: number; month: number }>> {
  const { data } = await admin
    .from("study_plans")
    .select("year, month")
    .eq("student_id", studentId)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(24);
  return (data ?? []).map((r) => ({ year: Number(r.year), month: Number(r.month) }));
}
