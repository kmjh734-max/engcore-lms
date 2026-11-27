import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import { getTodayIsoKorea } from "@/lib/date/korea-today";
import {
  getReportRangeBounds,
  type ReportRangeBounds,
} from "@/lib/reports/date-range";
import type { ReportRange } from "@/lib/reports/types";
import type {
  DailyTaskStatus,
  ScheduleAssignmentRow,
} from "@/lib/listening/schedule/types";

export interface ListeningScheduleRecentTask {
  taskDate: string;
  status: DailyTaskStatus;
  statusLabel: string;
  completedCount: number;
  totalCount: number;
  setTitle: string;
}

export interface ListeningScheduleReportSection {
  assignmentId: string;
  title: string;
  periodLabel: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  missedOrPendingTasks: number;
  recentTasks: ListeningScheduleRecentTask[];
  lastActivityDate: string | null;
  summaryLine: string;
}

function dailyTaskStatusLabel(status: DailyTaskStatus): string {
  switch (status) {
    case "completed":
      return "완료";
    case "in_progress":
      return "진행중";
    case "missed":
      return "미완료";
    case "pending":
    default:
      return "대기";
  }
}

function formatPeriodLabel(assignment: ScheduleAssignmentRow): string {
  const start = assignment.start_date;
  const end = assignment.end_date ?? "진행중";
  return `${start} ~ ${end}`;
}

function dateOnlyBounds(bounds: ReportRangeBounds): {
  start: string | null;
  end: string;
} {
  return {
    start: bounds.start ? getTodayIsoKorea(bounds.start) : null,
    end: getTodayIsoKorea(bounds.end),
  };
}

async function loadAssignmentsForStudent(
  supabase: SupabaseClient,
  studentId: string
): Promise<ScheduleAssignmentRow[]> {
  const byId = new Map<string, ScheduleAssignmentRow>();

  const [{ data: direct }, { data: classRows }] = await Promise.all([
    supabase
      .from("listening_schedule_assignments")
      .select("*")
      .eq("target_type", "student")
      .eq("target_student_id", studentId),
    supabase.from("class_students").select("class_id").eq("student_id", studentId),
  ]);

  for (const row of (direct ?? []) as ScheduleAssignmentRow[]) {
    byId.set(row.id, row);
  }

  const classIds = (classRows ?? []).map((r) => r.class_id as string);
  if (classIds.length > 0) {
    const { data: classBased } = await supabase
      .from("listening_schedule_assignments")
      .select("*")
      .eq("target_type", "class")
      .in("target_class_id", classIds);

    for (const row of (classBased ?? []) as ScheduleAssignmentRow[]) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()];
}

/**
 * 학습 리포트용 듣기 스케줄(일일 과제) 요약.
 * 활성 배정 + 기간 내 일일 과제 진행을 반영한다.
 */
export async function buildListeningScheduleReport(
  supabase: SupabaseClient,
  studentId: string,
  range: ReportRange = "30d"
): Promise<ListeningScheduleReportSection[]> {
  const bounds = getReportRangeBounds(range);
  const { start: startDate, end: endDate } = dateOnlyBounds(bounds);

  const assignments = await loadAssignmentsForStudent(supabase, studentId);

  let tasksQuery = supabase
    .from("listening_daily_tasks")
    .select(
      "id, assignment_id, task_date, set_id, status, completed_count, total_count, updated_at"
    )
    .eq("student_id", studentId)
    .lte("task_date", endDate)
    .order("task_date", { ascending: false });

  if (startDate) {
    tasksQuery = tasksQuery.gte("task_date", startDate);
  }

  const { data: tasks } = await tasksQuery;

  const taskRows = tasks ?? [];
  if (assignments.length === 0 && taskRows.length === 0) return [];

  const setIds = [
    ...new Set(taskRows.map((t) => t.set_id as string).filter(Boolean)),
  ];
  const setTitleById = new Map<string, string>();
  if (setIds.length > 0) {
    const { data: sets } = await supabase
      .from("listening_sets")
      .select("id, title")
      .in("id", setIds);
    for (const s of sets ?? []) {
      setTitleById.set(s.id as string, (s.title as string) ?? "");
    }
  }

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  for (const task of taskRows) {
    const aid = task.assignment_id as string;
    if (!assignmentById.has(aid)) {
      assignmentById.set(aid, {
        id: aid,
        title: "듣기 스케줄",
        description: null,
        assigned_by: null,
        target_type: "student",
        target_class_id: null,
        target_student_id: studentId,
        start_date: "",
        end_date: null,
        days_of_week: [],
        questions_per_day: 0,
        require_dictation_pass: false,
        dictation_pass_score: 0,
        lock_next_until_today_complete: false,
        is_active: false,
      });
    }
  }

  const tasksByAssignment = new Map<string, typeof taskRows>();
  for (const task of taskRows) {
    const aid = task.assignment_id as string;
    const list = tasksByAssignment.get(aid) ?? [];
    list.push(task);
    tasksByAssignment.set(aid, list);
  }

  const sections: ListeningScheduleReportSection[] = [];

  for (const assignment of assignmentById.values()) {
    const rows = tasksByAssignment.get(assignment.id) ?? [];
    // 실제 학습(완료·진행)한 일만 리포트에 포함
    const studiedRows = rows.filter(
      (r) =>
        r.status === "completed" ||
        r.status === "in_progress" ||
        (r.completed_count as number) > 0
    );
    if (studiedRows.length === 0) continue;

    const completedTasks = studiedRows.filter(
      (r) => r.status === "completed"
    ).length;
    const inProgressOnly = studiedRows.filter(
      (r) => r.status !== "completed"
    ).length;
    const totalStudied = studiedRows.length;
    const missedOrPendingTasks = rows.filter(
      (r) => r.status === "pending" || r.status === "missed"
    ).length;

    const recentTasks: ListeningScheduleRecentTask[] = studiedRows
      .slice(0, 8)
      .map((r) => {
        const status = r.status as DailyTaskStatus;
        return {
          taskDate: r.task_date as string,
          status,
          statusLabel: dailyTaskStatusLabel(status),
          completedCount: r.completed_count as number,
          totalCount: r.total_count as number,
          setTitle: setTitleById.get(r.set_id as string) ?? "",
        };
      });

    const activityDates = studiedRows.map((r) => r.task_date as string);
    const lastActivityDate =
      activityDates.length > 0
        ? activityDates.reduce((a, b) => (a > b ? a : b))
        : null;

    let summaryLine = `${totalStudied}일 학습(완료 ${completedTasks}일`;
    if (inProgressOnly > 0) {
      summaryLine += `, 진행중 ${inProgressOnly}일`;
    }
    summaryLine += ")";
    if (missedOrPendingTasks > 0) {
      summaryLine += `. 같은 기간 미학습 ${missedOrPendingTasks}일`;
    }
    summaryLine += ".";

    const title =
      assignment.title ||
      (studiedRows[0]
        ? setTitleById.get(studiedRows[0].set_id as string) || "듣기 스케줄"
        : "듣기 스케줄");

    sections.push({
      assignmentId: assignment.id,
      title,
      periodLabel: assignment.start_date
        ? formatPeriodLabel(assignment)
        : "—",
      totalTasks: totalStudied,
      completedTasks,
      inProgressTasks: inProgressOnly,
      missedOrPendingTasks,
      recentTasks,
      lastActivityDate,
      summaryLine,
    });
  }

  return sections.sort((a, b) => {
    const da = a.lastActivityDate ?? "";
    const db = b.lastActivityDate ?? "";
    if (da !== db) return db.localeCompare(da);
    return a.title.localeCompare(b.title, "ko");
  });
}

/** 스케줄·일일과제·시도에 포함된 듣기 세트 ID */
export async function loadStudentListeningSetIdsForReport(
  supabase: SupabaseClient,
  studentId: string
): Promise<string[]> {
  const { data: classLinks } = await supabase
    .from("class_students")
    .select("class_id")
    .eq("student_id", studentId);
  const classIds = (classLinks ?? []).map((r) => r.class_id as string);

  const [
    { data: directAssign },
    { data: classAssign },
    { data: dailyTasks },
    { data: dictationAttempts },
    { data: examAttempts },
  ] = await Promise.all([
    supabase
      .from("listening_assignments")
      .select("set_id")
      .eq("student_id", studentId),
    classIds.length > 0
      ? supabase
          .from("listening_assignments")
          .select("set_id")
          .in("class_id", classIds)
      : Promise.resolve({ data: [] as { set_id: string }[] }),
    fetchAllRowsSoft<{ set_id: string }>((from, to) =>
      supabase
        .from("listening_daily_tasks")
        .select("set_id")
        .eq("student_id", studentId)
        .order("id")
        .range(from, to)
    ).then((data) => ({ data })),
    fetchAllRowsSoft<{ set_id: string }>((from, to) =>
      supabase
        .from("listening_dictation_attempts")
        .select("set_id")
        .eq("student_id", studentId)
        .order("id")
        .range(from, to)
    ).then((data) => ({ data })),
    fetchAllRowsSoft<{ set_id: string }>((from, to) =>
      supabase
        .from("listening_exam_attempts")
        .select("set_id")
        .eq("student_id", studentId)
        .order("id")
        .range(from, to)
    ).then((data) => ({ data })),
  ]);

  const scheduleAssignments = await loadAssignmentsForStudent(
    supabase,
    studentId
  );
  const scheduleAssignmentIds = scheduleAssignments.map((a) => a.id);
  let scheduleSetIds: string[] = [];
  if (scheduleAssignmentIds.length > 0) {
    const { data: scheduleSets } = await supabase
      .from("listening_schedule_assignment_sets")
      .select("set_id")
      .in("assignment_id", scheduleAssignmentIds);
    scheduleSetIds = (scheduleSets ?? []).map((r) => r.set_id as string);
  }

  return [
    ...new Set([
      ...(directAssign ?? []).map((a) => a.set_id as string),
      ...(classAssign ?? []).map((a) => a.set_id as string),
      ...(dailyTasks ?? []).map((t) => t.set_id as string),
      ...(dictationAttempts ?? []).map((a) => a.set_id as string),
      ...(examAttempts ?? []).map((a) => a.set_id as string),
      ...scheduleSetIds,
    ]),
  ];
}
