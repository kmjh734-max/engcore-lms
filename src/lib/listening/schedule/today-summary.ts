import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodayIsoKorea } from "@/lib/date/korea-today";
import {
  isStudyDay,
  parseDateOnly,
  toDateOnlyString,
} from "@/lib/listening/schedule/days-of-week";
import { getStudentListeningCalendar } from "@/lib/listening/schedule/calendar";
import { ensureDailyTasksForStudentRange } from "@/lib/listening/schedule/generate-daily-tasks";
import {
  applyPausesToAssignment,
  nextUnpausedStudyDateAfter,
  pauseStateOn,
} from "@/lib/listening/schedule/pauses";
import { buildQuestionQueueForAssignment } from "@/lib/listening/schedule/question-queue";
import {
  isAssignmentPausedOn,
  loadStudentScheduleContext,
  type StudentScheduleContext,
} from "@/lib/listening/schedule/student-context";
import { pruneIncompleteTasksBeforeEffectiveStart } from "@/lib/listening/schedule/student-effective-start";
import type { DailyTaskStatus, ScheduleAssignmentRow } from "@/lib/listening/schedule/types";

export interface StudentDailyTaskView {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  taskDate: string;
  setId: string;
  setTitle: string;
  questionIds: string[];
  questionRangeLabel: string;
  status: DailyTaskStatus;
  completedCount: number;
  totalCount: number;
  remainingCount: number;
}

/** 선생님이 지금 멈춰 둔 과제 (학생 화면 안내용) */
export interface StudentPausedAssignmentView {
  assignmentId: string;
  assignmentTitle: string;
  since: string;
  /** 다시 시작하는 날. null = 선생님이 다시 시작할 때까지 */
  until: string | null;
}

function isDateInAssignment(
  taskDateIso: string,
  assignment: ScheduleAssignmentRow
): boolean {
  const taskDate = parseDateOnly(taskDateIso);
  const start = parseDateOnly(assignment.start_date);
  const end = assignment.end_date ? parseDateOnly(assignment.end_date) : null;
  if (taskDate < start) return false;
  if (end && taskDate > end) return false;
  return isStudyDay(taskDate, assignment.days_of_week);
}

const MISSED_TASK_LOOKBACK_DAYS = 14;

function lookbackIsoFrom(todayIso: string, days: number): string {
  const d = parseDateOnly(todayIso);
  d.setDate(d.getDate() - days);
  return toDateOnlyString(d);
}

async function loadSetTitles(
  admin: SupabaseClient,
  setIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(setIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const { data } = await admin
    .from("listening_sets")
    .select("id, title")
    .in("id", unique);

  for (const row of data ?? []) {
    map.set(row.id as string, (row.title as string) ?? "");
  }
  return map;
}

function formatQuestionRangeLabel(orderIndexes: number[]): string {
  if (orderIndexes.length === 0) return "";
  const sorted = [...orderIndexes].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first === last) return `${first}번`;
  return `${first}–${last}번`;
}

type QuestionInfo = { orderIndex: number; setId: string | null; setTitle: string | null };

/** 문항 번호(범위 표시)와 문항이 속한 세트·세트 제목을 한 번에 */
async function loadQuestionInfo(
  admin: SupabaseClient,
  questionIds: string[]
): Promise<Map<string, QuestionInfo>> {
  const unique = [...new Set(questionIds.filter(Boolean))];
  const map = new Map<string, QuestionInfo>();
  if (!unique.length) return map;

  const { data } = await admin
    .from("listening_questions")
    .select("id, order_index, set_id, set:listening_sets(title)")
    .in("id", unique);

  for (const row of data ?? []) {
    const set = row.set as { title?: string } | { title?: string }[] | null;
    const title = Array.isArray(set) ? set[0]?.title : set?.title;
    map.set(row.id as string, {
      orderIndex: row.order_index as number,
      setId: (row.set_id as string | null) ?? null,
      setTitle: typeof title === "string" ? title : null,
    });
  }
  return map;
}

function mapTaskRow(
  row: Record<string, unknown>,
  assignmentTitle: string,
  setTitle: string,
  questionInfo?: Map<string, QuestionInfo>
): StudentDailyTaskView {
  const total = row.total_count as number;
  const completed = row.completed_count as number;
  const questionIds = (row.question_ids as string[]) ?? [];
  const orders = questionIds
    .map((id) => questionInfo?.get(id)?.orderIndex)
    .filter((n): n is number => typeof n === "number");
  return {
    id: row.id as string,
    assignmentId: row.assignment_id as string,
    assignmentTitle,
    taskDate: row.task_date as string,
    setId: row.set_id as string,
    setTitle,
    questionIds,
    questionRangeLabel: formatQuestionRangeLabel(orders),
    status: row.status as DailyTaskStatus,
    completedCount: completed,
    totalCount: total,
    remainingCount: Math.max(0, total - completed),
  };
}

/** 기존 과제만 조회 — 페이지 로딩을 막지 않음 */
export async function getStudentScheduleTodaySummaryReadOnly(
  admin: SupabaseClient,
  studentId: string,
  todayIso = getTodayIsoKorea(),
  /** 같은 요청에서 이미 읽은 과제 목록 (없으면 여기서 읽는다) */
  context?: StudentScheduleContext
) {
  const ctx = context ?? (await loadStudentScheduleContext(admin, studentId));
  const { effectiveStartByAssignment, pausesByAssignment } = ctx;
  // 오늘 멈춘 과제는 오늘 할 일·못 끝낸 학습에서 뺀다 (안내만 한다)
  const pausedToday = ctx.assignments.filter((a) =>
    isAssignmentPausedOn(ctx, a.id, todayIso)
  );
  const pausedIds = new Set(pausedToday.map((a) => a.id));
  const assignments = ctx.assignments.filter((a) => !pausedIds.has(a.id));
  const paused: StudentPausedAssignmentView[] = pausedToday.flatMap((a) => {
    const state = pauseStateOn(pausesByAssignment.get(a.id), todayIso);
    return state
      ? [
          {
            assignmentId: a.id,
            assignmentTitle: a.title,
            since: state.since,
            until: state.until,
          },
        ]
      : [];
  });

  // 유효 시작일 이전 미완료 정리와 과제 조회를 같이 한다.
  // 정리 대상(유효 시작일 이전)은 아래에서 어차피 걸러 내므로 결과는 같다.
  const [, { data: missedRows }, { data: todayRows }] = await Promise.all([
    Promise.all(
      assignments.map((a) =>
        pruneIncompleteTasksBeforeEffectiveStart(admin, {
          studentId,
          assignmentId: a.id,
          effectiveStartIso:
            effectiveStartByAssignment.get(a.id) ?? a.start_date,
        })
      )
    ),
    admin
      .from("listening_daily_tasks")
      .select(
        "id, assignment_id, task_date, set_id, question_ids, status, completed_count, total_count, assignment:listening_schedule_assignments(title)"
      )
      .eq("student_id", studentId)
      .lt("task_date", todayIso)
      .in("status", ["pending", "in_progress"])
      .order("task_date", { ascending: true }),
    admin
      .from("listening_daily_tasks")
      .select(
        "id, assignment_id, task_date, set_id, question_ids, status, completed_count, total_count"
      )
      .eq("student_id", studentId)
      .eq("task_date", todayIso),
  ]);

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const activeAssignmentIds = new Set(assignments.map((a) => a.id));

  const keptMissedRows = (missedRows ?? []).filter((row) => {
    const assignmentId = row.assignment_id as string;
    if (!activeAssignmentIds.has(assignmentId)) return false;
    const effectiveStart =
      effectiveStartByAssignment.get(assignmentId) ?? "0000-01-01";
    return (row.task_date as string) >= effectiveStart;
  });

  let todayRow: Record<string, unknown> | null = null;
  let todayAssignment: ScheduleAssignmentRow | null = null;
  for (const row of todayRows ?? []) {
    const assignment = assignmentById.get(row.assignment_id as string);
    if (!assignment) continue;
    const effectiveStart =
      effectiveStartByAssignment.get(assignment.id) ?? assignment.start_date;
    if (todayIso < effectiveStart) continue;
    // 오늘 과제가 둘 이상이면 아직 안 끝낸 것을 먼저(달력과 같은 기준) — 전에는 첫 줄만 보여 끝낸 것이 뽑히기도 했다
    const done = (row as { status?: string }).status === "completed";
    if (todayRow && done) continue;
    todayRow = row as Record<string, unknown>;
    todayAssignment = assignment;
    if (!done) break;
  }

  // 세트 제목 · 문항 번호(와 문항의 세트) · 오늘 과제 진행은 서로 기다릴 필요가 없다
  const missedSetIds = (missedRows ?? []).map((r) => r.set_id as string);
  const questionIdsForLabels = [
    ...(missedRows ?? []).flatMap((r) => (r.question_ids as string[]) ?? []),
    ...(todayRows ?? []).flatMap((r) => (r.question_ids as string[]) ?? []),
  ];
  const [setTitles, questionInfo, todayProgressRows] = await Promise.all([
    loadSetTitles(admin, [
      ...missedSetIds,
      ...(todayRow ? [todayRow.set_id as string] : []),
    ]),
    loadQuestionInfo(admin, questionIdsForLabels),
    todayRow
      ? admin
          .from("listening_daily_task_progress")
          .select("question_id, completed")
          .eq("daily_task_id", todayRow.id as string)
          .eq("student_id", studentId)
          .then(({ data }) => data ?? [])
      : Promise.resolve([] as { question_id: string; completed: boolean }[]),
  ]);

  const missedTasks: StudentDailyTaskView[] = keptMissedRows.map((row) => {
    const assignment = row.assignment as { title?: string } | null;
    return mapTaskRow(
      row as Record<string, unknown>,
      assignment?.title ?? "듣기 과제",
      setTitles.get(row.set_id as string) ?? "",
      questionInfo
    );
  });

  let todayTask: StudentDailyTaskView | null =
    todayRow && todayAssignment
      ? mapTaskRow(
          todayRow as Record<string, unknown>,
          todayAssignment.title,
          "",
          questionInfo
        )
      : null;
  let nextStudyDate: string | null = null;

  // 다음 학습일 — 멈춘 날은 건너뛴다 (다시 시작할 날이 정해진 멈춤도 포함)
  for (const assignment of ctx.assignments) {
    const effectiveStart =
      effectiveStartByAssignment.get(assignment.id) ?? assignment.start_date;
    const ranges = pausesByAssignment.get(assignment.id);
    const next = nextUnpausedStudyDateAfter(
      todayIso < effectiveStart ? addDaysIso(effectiveStart, -1) : todayIso,
      assignment.days_of_week,
      applyPausesToAssignment(assignment, ranges).end_date,
      ranges
    );
    if (next && (!nextStudyDate || next < nextStudyDate)) {
      nextStudyDate = next;
    }
  }

  if (todayTask) {
    // 이어 풀 문항(없으면 첫 문항)이 속한 세트를 보여 준다
    let displaySetId = todayTask.setId;
    let displaySetTitle: string | null = null;
    const incompleteQid = todayProgressRows.find((p) => !p.completed)
      ?.question_id as string | undefined;
    const pickQid = incompleteQid ?? todayTask.questionIds[0];
    if (pickQid) {
      const info = questionInfo.get(pickQid);
      if (info) {
        if (info.setId) {
          displaySetId = info.setId;
          displaySetTitle = info.setTitle;
        }
      } else {
        // 과제 문항 목록에 없는 문항이면 예전처럼 직접 찾는다
        const { data: qRow } = await admin
          .from("listening_questions")
          .select("set_id")
          .eq("id", pickQid)
          .maybeSingle();
        if (qRow?.set_id) displaySetId = qRow.set_id as string;
      }
    }

    let setTitle =
      displaySetTitle ??
      setTitles.get(displaySetId) ??
      null;
    if (setTitle === null && displaySetId !== todayTask.setId) {
      setTitle = (await loadSetTitles(admin, [displaySetId])).get(displaySetId) ?? null;
    }
    todayTask = {
      ...todayTask,
      setId: displaySetId,
      setTitle: setTitle ?? setTitles.get(todayTask.setId) ?? "",
    };
  }

  const isStudyDayToday = assignments.some((a) => {
    const effectiveStart =
      effectiveStartByAssignment.get(a.id) ?? a.start_date;
    if (todayIso < effectiveStart) return false;
    return isDateInAssignment(
      todayIso,
      applyPausesToAssignment(a, pausesByAssignment.get(a.id))
    );
  });

  return {
    todayIso,
    isStudyDayToday,
    todayTask,
    missedTasks,
    nextStudyDate,
    paused,
  };
}

/** 오늘 과제만 동기 생성 — 페이지 첫 응답을 빠르게 */
export async function ensureStudentTodayAndMissedTasks(
  admin: SupabaseClient,
  studentId: string,
  todayIso = getTodayIsoKorea(),
  /** 같은 요청에서 이미 읽은 과제 목록 (없으면 여기서 읽는다) */
  context?: StudentScheduleContext
): Promise<void> {
  const ctx = context ?? (await loadStudentScheduleContext(admin, studentId));
  const { assignments, effectiveStartByAssignment, pausesByAssignment } = ctx;
  if (assignments.length === 0) return;

  await Promise.all(
    assignments.map(async (assignment) => {
      const effectiveStart =
        effectiveStartByAssignment.get(assignment.id) ?? assignment.start_date;
      if (todayIso < effectiveStart) return;
      // 오늘 멈춘 과제는 만들지 않는다
      if (isAssignmentPausedOn(ctx, assignment.id, todayIso)) return;
      const pauses = pausesByAssignment.get(assignment.id) ?? [];
      if (!isDateInAssignment(todayIso, applyPausesToAssignment(assignment, pauses))) {
        return;
      }
      const queue = await buildQuestionQueueForAssignment(admin, assignment.id);
      if (queue.length === 0) return;
      await ensureDailyTasksForStudentRange(
        admin,
        assignment,
        studentId,
        todayIso,
        todayIso,
        queue,
        effectiveStart,
        pauses
      );
    })
  );
}

/** 누락된 일일 과제 생성 — 미래 구간 포함 (백그라운드용) */
function addDaysIso(iso: string, days: number): string {
  const d = parseDateOnly(iso);
  d.setDate(d.getDate() + days);
  return toDateOnlyString(d);
}

export async function ensureStudentScheduleDailyTasks(
  admin: SupabaseClient,
  studentId: string,
  todayIso = getTodayIsoKorea(),
  options?: { futureDays?: number; context?: StudentScheduleContext }
): Promise<void> {
  const futureDays = options?.futureDays ?? 30;
  const { assignments, effectiveStartByAssignment, pausesByAssignment } =
    options?.context ?? (await loadStudentScheduleContext(admin, studentId));
  const lookbackFrom = lookbackIsoFrom(todayIso, MISSED_TASK_LOOKBACK_DAYS);
  const futureTo = addDaysIso(todayIso, futureDays);

  await Promise.all(
    assignments.map(async (assignment) => {
      const effectiveStart =
        effectiveStartByAssignment.get(assignment.id) ?? assignment.start_date;
      let rangeFrom =
        assignment.start_date > lookbackFrom
          ? assignment.start_date
          : lookbackFrom;
      if (rangeFrom < effectiveStart) rangeFrom = effectiveStart;

      // 멈춘 날은 과제를 만들지 않고, 끝나는 날은 쉰 날만큼 뒤로 밀린다
      const pauses = pausesByAssignment.get(assignment.id) ?? [];
      const endIso = applyPausesToAssignment(assignment, pauses).end_date;
      const rangeTo = endIso && endIso < futureTo ? endIso : futureTo;
      if (rangeFrom > rangeTo) return;

      const queue = await buildQuestionQueueForAssignment(admin, assignment.id);
      await ensureDailyTasksForStudentRange(
        admin,
        assignment,
        studentId,
        rangeFrom,
        rangeTo,
        queue,
        effectiveStart,
        pauses
      );
    })
  );
}

export async function getStudentScheduleTodaySummary(
  admin: SupabaseClient,
  studentId: string,
  todayIso = getTodayIsoKorea()
) {
  const context = await loadStudentScheduleContext(admin, studentId);
  await ensureStudentTodayAndMissedTasks(admin, studentId, todayIso, context);
  return getStudentScheduleTodaySummaryReadOnly(admin, studentId, todayIso, context);
}

/**
 * 학생 듣기 화면 첫 데이터: 오늘 과제를 만든 뒤 오늘 요약과 달력을 같이 읽는다.
 * (API 와 학생 듣기 페이지가 함께 쓴다. 과제 목록은 한 번만 읽어 넘긴다)
 * 45일 미래 과제 만들기는 호출한 쪽에서 after() 로 돌린다.
 */
export async function loadStudentListeningTodayPayload(
  admin: SupabaseClient,
  studentId: string,
  opts: { todayIso: string; year: number; month: number }
) {
  const context = await loadStudentScheduleContext(admin, studentId);

  // 동기: 오늘·미완료만 생성 (45일 미래 생성은 응답을 막지 않음)
  await ensureStudentTodayAndMissedTasks(admin, studentId, opts.todayIso, context);

  const [summary, calendar] = await Promise.all([
    getStudentScheduleTodaySummaryReadOnly(admin, studentId, opts.todayIso, context),
    getStudentListeningCalendar(
      admin,
      studentId,
      opts.year,
      opts.month,
      opts.todayIso,
      context
    ),
  ]);

  return { context, summary, calendar };
}
