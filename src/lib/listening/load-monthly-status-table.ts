import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getKoreaDayUtcBounds,
  getMonthDateRange,
  getTodayIsoKorea,
} from "@/lib/date/korea-today";
import { isStudyDay, parseDateOnly } from "@/lib/listening/schedule/days-of-week";
import { loadSchedulePauses } from "@/lib/listening/schedule/load-pauses";
import {
  applyPausesToAssignment,
  isDatePaused,
  pausesForStudent,
  pauseStateOn,
  type SchedulePauseRange,
} from "@/lib/listening/schedule/pauses";
import { computeStudentListeningEffectiveStartIso } from "@/lib/listening/schedule/student-effective-start";
import type {
  DailyTaskStatus,
  ScheduleAssignmentRow,
} from "@/lib/listening/schedule/types";
import type {
  HomeworkDayCell,
  HomeworkDaySymbol,
  ListeningOmrAttemptRow,
  ListeningOmrStudentSummary,
  ListeningStatusRow,
  ListeningStatusTable,
} from "@/lib/learning-status/types";
import { listReportStudents } from "@/lib/reports/list-students";
import { fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import type { UserRole } from "@/types/database";

type TaskRow = {
  id: string;
  student_id: string;
  task_date: string;
  status: DailyTaskStatus;
  completed_count: number;
  total_count: number;
  assignment_id: string;
};

async function loadAssignmentsByStudent(
  supabase: SupabaseClient,
  studentIds: string[]
): Promise<{
  byStudent: Map<string, ScheduleAssignmentRow[]>;
  /** 학생 id → (반 id → 반 가입 시각) — 과제 유효 시작일 계산용 */
  membershipCreatedAt: Map<string, Map<string, string>>;
}> {
  const result = new Map<string, ScheduleAssignmentRow[]>();
  const membershipCreatedAt = new Map<string, Map<string, string>>();
  if (studentIds.length === 0) return { byStudent: result, membershipCreatedAt };

  for (const id of studentIds) {
    result.set(id, []);
  }

  const [{ data: direct }, { data: classLinks }] = await Promise.all([
    supabase
      .from("listening_schedule_assignments")
      .select("*")
      .eq("is_active", true)
      .eq("target_type", "student")
      .in("target_student_id", studentIds),
    supabase
      .from("class_students")
      .select("student_id, class_id, created_at")
      .in("student_id", studentIds),
  ]);

  const classIdsByStudent = new Map<string, string[]>();
  for (const row of classLinks ?? []) {
    const sid = row.student_id as string;
    const cid = row.class_id as string;
    const list = classIdsByStudent.get(sid) ?? [];
    list.push(cid);
    classIdsByStudent.set(sid, list);
    const joined = membershipCreatedAt.get(sid) ?? new Map<string, string>();
    if (row.created_at) joined.set(cid, row.created_at as string);
    membershipCreatedAt.set(sid, joined);
  }

  const allClassIds = [
    ...new Set((classLinks ?? []).map((r) => r.class_id as string)),
  ];

  let classAssignments: ScheduleAssignmentRow[] = [];
  if (allClassIds.length > 0) {
    const { data } = await supabase
      .from("listening_schedule_assignments")
      .select("*")
      .eq("is_active", true)
      .eq("target_type", "class")
      .in("target_class_id", allClassIds);
    classAssignments = (data ?? []) as ScheduleAssignmentRow[];
  }

  for (const row of (direct ?? []) as ScheduleAssignmentRow[]) {
    const sid = row.target_student_id;
    if (!sid) continue;
    const list = result.get(sid) ?? [];
    list.push(row);
    result.set(sid, list);
  }

  for (const [studentId, classIds] of classIdsByStudent) {
    for (const assignment of classAssignments) {
      if (
        assignment.target_class_id &&
        classIds.includes(assignment.target_class_id)
      ) {
        const list = result.get(studentId) ?? [];
        if (!list.some((a) => a.id === assignment.id)) {
          list.push(assignment);
          result.set(studentId, list);
        }
      }
    }
  }

  return { byStudent: result, membershipCreatedAt };
}

function aggregateTasksForDay(rows: TaskRow[]): {
  status: DailyTaskStatus | null;
  completedCount: number;
  totalCount: number;
} {
  if (rows.length === 0) {
    return { status: null, completedCount: 0, totalCount: 0 };
  }

  const allCompleted = rows.every((r) => r.status === "completed");
  if (allCompleted) {
    return {
      status: "completed",
      completedCount: rows.reduce((sum, r) => sum + r.completed_count, 0),
      totalCount: rows.reduce((sum, r) => sum + r.total_count, 0),
    };
  }

  const anyProgress = rows.some(
    (r) => r.status === "in_progress" || r.status === "completed"
  );
  if (anyProgress) {
    return {
      status: "in_progress",
      completedCount: rows.reduce((sum, r) => sum + r.completed_count, 0),
      totalCount: rows.reduce((sum, r) => sum + r.total_count, 0),
    };
  }

  const pick = rows[0]!;
  return {
    status: pick.status,
    completedCount: pick.completed_count,
    totalCount: pick.total_count,
  };
}

function isDateInAssignment(
  taskDateIso: string,
  assignment: ScheduleAssignmentRow,
  effectiveStartIso?: string
): boolean {
  if (effectiveStartIso && taskDateIso < effectiveStartIso) return false;
  const taskDate = parseDateOnly(taskDateIso);
  const start = parseDateOnly(assignment.start_date);
  const end = assignment.end_date ? parseDateOnly(assignment.end_date) : null;
  if (taskDate < start) return false;
  if (end && taskDate > end) return false;
  return isStudyDay(taskDate, assignment.days_of_week);
}

function toDaySymbol(
  status: DailyTaskStatus | null,
  taskDate: string,
  todayIso: string,
  isStudyDayFlag: boolean,
  completedCount: number,
  totalCount: number
): HomeworkDaySymbol {
  if (!isStudyDayFlag) return "none";
  if (taskDate > todayIso) return "scheduled";
  if (!status) return "missing";
  if (status === "completed") return "complete";
  if (status === "in_progress" && completedCount > 0) return "partial";
  return "missing";
}

type ExamAttemptRow = {
  student_id: string;
  set_id: string;
  score: number;
  correct_count: number;
  total_count: number;
  submitted_at: string;
};

async function loadTeacherListeningSetIds(
  admin: SupabaseClient,
  teacherId: string
): Promise<Set<string>> {
  const { data } = await admin
    .from("listening_sets")
    .select("id")
    .or(`teacher_id.eq.${teacherId},created_by.eq.${teacherId}`);

  return new Set((data ?? []).map((row) => row.id as string));
}

function buildStudentDays(
  assignments: ScheduleAssignmentRow[],
  tasksByDate: Map<string, TaskRow[]>,
  year: number,
  month: number,
  daysInMonth: number,
  todayIso: string,
  effectiveStartByAssignmentId: Map<string, string>,
  /** 과제 id → 이 학생에게 걸린 일시정지 기간 */
  pausesByAssignmentId: Map<string, SchedulePauseRange[]>
): HomeworkDayCell[] {
  const activeAssignmentIds = new Set(assignments.map((a) => a.id));
  const isPaused = (assignmentId: string, iso: string) =>
    isDatePaused(pausesByAssignmentId.get(assignmentId), iso);
  // 끝나는 날은 쉰 날만큼 뒤로 민 규칙으로 본다
  const effectiveAssignments = assignments.map((a) =>
    applyPausesToAssignment(a, pausesByAssignmentId.get(a.id))
  );
  const days: HomeworkDayCell[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const taskDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dateObj = parseDateOnly(taskDate);
    const weekday = dateObj.getDay();
    const ruleAssignments = effectiveAssignments.filter((a) =>
      isDateInAssignment(
        taskDate,
        a,
        effectiveStartByAssignmentId.get(a.id)
      )
    );
    // 멈춘 날은 학습일로 세지 않는다 (그날 끝낸 과제는 그대로 완료로 센다)
    const studyAssignments = ruleAssignments.filter(
      (a) => !isPaused(a.id, taskDate)
    );
    const rows = (tasksByDate.get(taskDate) ?? []).filter(
      (r) => r.status === "completed" || !isPaused(r.assignment_id, taskDate)
    );
    // 요일·기간을 바꾼 뒤에도 이미 나간 과제는 표에 남긴다
    const isStudyDayFlag =
      studyAssignments.length > 0 ||
      rows.some((r) => activeAssignmentIds.has(r.assignment_id));

    if (!isStudyDayFlag && ruleAssignments.length > 0) {
      days.push({
        day,
        weekday,
        taskDate,
        symbol: "paused",
        isToday: taskDate === todayIso,
        isStudyDay: false,
        completedCount: 0,
        totalCount: 0,
      });
      continue;
    }

    const aggregated = aggregateTasksForDay(rows);

    const completedCount = aggregated.completedCount;
    const totalCount =
      aggregated.totalCount > 0
        ? aggregated.totalCount
        : (studyAssignments[0]?.questions_per_day ?? 0);
    const symbol = toDaySymbol(
      aggregated.status,
      taskDate,
      todayIso,
      isStudyDayFlag,
      completedCount,
      totalCount
    );

    days.push({
      day,
      weekday,
      taskDate,
      symbol,
      isToday: taskDate === todayIso,
      isStudyDay: isStudyDayFlag,
      completedCount,
      totalCount,
    });
  }

  return days;
}

export async function loadListeningMonthlyStatusTable(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  role: UserRole,
  viewerId: string,
  options: {
    year: number;
    month: number;
    classId?: string;
    nameQuery?: string;
    loginQuery?: string;
  }
): Promise<ListeningStatusTable> {
  const todayIso = getTodayIsoKorea();
  const { start, end, daysInMonth } = getMonthDateRange(
    options.year,
    options.month
  );

  const students = await listReportStudents(supabase, role, viewerId, {
    classId: options.classId,
    nameQuery: options.nameQuery,
    loginQuery: options.loginQuery,
  });

  if (students.length === 0) {
    return {
      year: options.year,
      month: options.month,
      todayIso,
      daysInMonth,
      rows: [],
      omrByStudent: [],
    };
  }

  const studentById = new Map(
    students.map((s) => [
      s.id,
      {
        name: s.name,
        classLabel: s.classNames.join(", ") || "—",
        teacherLabel: s.teacherNames.join(", "),
      },
    ])
  );
  const studentIds = students.map((s) => s.id);
  const monthBounds = {
    start: getKoreaDayUtcBounds(start).start,
    end: getKoreaDayUtcBounds(end).end,
  };
  const teacherSetIdsPromise =
    role === "teacher"
      ? loadTeacherListeningSetIds(admin, viewerId)
      : Promise.resolve(null as Set<string> | null);

  const [
    { byStudent: assignmentsByStudent, membershipCreatedAt, pauseMap },
    { data: taskRows },
    examQuery,
    teacherSetIds,
  ] = await Promise.all([
    // 과제를 읽는 대로 일시정지 기간도 이어 읽는다 (다른 조회와 같이 돈다)
    loadAssignmentsByStudent(admin, studentIds).then(async (loaded) => ({
      ...loaded,
      pauseMap: await loadSchedulePauses(admin, [
        ...new Set([...loaded.byStudent.values()].flat().map((a) => a.id)),
      ]),
    })),
    // 학원 전체(반 고르지 않음)면 학생 × 한 달 과제가 1000행을 넘어 칸이 비었다 — 끝까지 읽는다
    fetchAllRowsSoft<TaskRow>((from, to) =>
      admin
        .from("listening_daily_tasks")
        .select(
          "id, student_id, task_date, status, completed_count, total_count, assignment_id"
        )
        .in("student_id", studentIds)
        .gte("task_date", start)
        .lte("task_date", end)
        .order("id")
        .range(from, to)
    ).then((data) => ({ data })),
    fetchAllRowsSoft<ExamAttemptRow>((from, to) =>
      admin
        .from("listening_exam_attempts")
        .select(
          "student_id, set_id, score, correct_count, total_count, submitted_at"
        )
        .in("student_id", studentIds)
        .gte("submitted_at", monthBounds.start)
        .lte("submitted_at", monthBounds.end)
        .order("submitted_at", { ascending: false })
        .order("id")
        .range(from, to)
    ).then((data) => ({ data })),
    teacherSetIdsPromise,
  ]);

  let examRows = (examQuery.data ?? []) as ExamAttemptRow[];
  if (teacherSetIds && teacherSetIds.size > 0) {
    examRows = examRows.filter((row) => teacherSetIds.has(row.set_id));
  } else if (teacherSetIds && teacherSetIds.size === 0) {
    examRows = [];
  }

  const setTitleById = new Map<string, string>();
  const examSetIds = [...new Set(examRows.map((row) => row.set_id))];

  const tasksByStudentDate = new Map<string, Map<string, TaskRow[]>>();
  const taskIds: string[] = [];
  for (const row of (taskRows ?? []) as TaskRow[]) {
    const sid = row.student_id;
    const date = row.task_date;
    const byDate = tasksByStudentDate.get(sid) ?? new Map<string, TaskRow[]>();
    const list = byDate.get(date) ?? [];
    list.push(row);
    byDate.set(date, list);
    tasksByStudentDate.set(sid, byDate);
    taskIds.push(row.id);
  }

  const accuracyByStudent = new Map<
    string,
    { correctCount: number; answeredCount: number }
  >();
  for (const id of studentIds) {
    accuracyByStudent.set(id, { correctCount: 0, answeredCount: 0 });
  }

  // 시험 세트 제목과 문항별 채점 기록은 서로 상관없어 한 번에(묶음도 동시에) 읽는다
  const taskIdChunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += 200) {
    taskIdChunks.push(taskIds.slice(i, i + 200));
  }
  const [setRowsRes, progressChunks] = await Promise.all([
    examSetIds.length > 0
      ? admin.from("listening_sets").select("id, title").in("id", examSetIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    Promise.all(
      taskIdChunks.map(async (chunk) => {
        return fetchAllRowsSoft<{
          student_id: string;
          objective_completed: boolean;
          objective_correct: boolean | null;
        }>((from, to) =>
          admin
            .from("listening_daily_task_progress")
            .select("student_id, objective_completed, objective_correct")
            .in("daily_task_id", chunk)
            .eq("objective_completed", true)
            .order("id")
            .range(from, to)
        );
      })
    ),
  ]);
  for (const set of setRowsRes.data ?? []) {
    setTitleById.set(set.id as string, set.title as string);
  }
  for (const progressRows of progressChunks) {
    for (const p of progressRows) {
      const sid = p.student_id as string;
      const bucket = accuracyByStudent.get(sid);
      if (!bucket) continue;
      // 구데이터는 objective_correct=null → 채점 불가. 채점된 문항만 집계
      if (p.objective_correct === true) {
        bucket.correctCount += 1;
        bucket.answeredCount += 1;
      } else if (p.objective_correct === false) {
        bucket.answeredCount += 1;
      }
    }
  }

  const omrAttemptsByStudent = new Map<string, ListeningOmrAttemptRow[]>();

  for (const row of examRows) {
    const sid = row.student_id;
    const student = studentById.get(sid);
    if (!student) continue;

    const attempt: ListeningOmrAttemptRow = {
      studentId: sid,
      studentName: student.name,
      classLabel: student.classLabel,
      setId: row.set_id,
      setTitle: setTitleById.get(row.set_id) ?? "듣기 시험",
      examDate: getTodayIsoKorea(new Date(row.submitted_at)),
      score: row.score,
      correctCount: row.correct_count,
      totalCount: row.total_count,
    };

    const list = omrAttemptsByStudent.get(sid) ?? [];
    list.push(attempt);
    omrAttemptsByStudent.set(sid, list);
  }

  const rows: ListeningStatusRow[] = students.map((student) => {
    const assignments = assignmentsByStudent.get(student.id) ?? [];
    // 반 가입일은 위에서 한 번에 읽었으니 학생·과제마다 다시 조회하지 않는다
    const joinedByClass = membershipCreatedAt.get(student.id);
    const effectiveStartByAssignmentId = new Map<string, string>();
    const pausesByAssignmentId = new Map<string, SchedulePauseRange[]>();
    for (const a of assignments) {
      effectiveStartByAssignmentId.set(
        a.id,
        computeStudentListeningEffectiveStartIso(
          a,
          a.target_class_id ? joinedByClass?.get(a.target_class_id) : null
        )
      );
      pausesByAssignmentId.set(a.id, pausesForStudent(pauseMap.get(a.id), student.id));
    }
    const tasksByDate = tasksByStudentDate.get(student.id) ?? new Map();
    const days = buildStudentDays(
      assignments,
      tasksByDate,
      options.year,
      options.month,
      daysInMonth,
      todayIso,
      effectiveStartByAssignmentId,
      pausesByAssignmentId
    );

    // 오늘 멈춰 있는 과제 (여럿이면 가장 먼저 멈춘 것)
    let pause: ListeningStatusRow["pause"] = null;
    for (const ranges of pausesByAssignmentId.values()) {
      const state = pauseStateOn(ranges, todayIso);
      if (state && (!pause || state.since < pause.since)) {
        pause = { since: state.since, until: state.until };
      }
    }

    let completedCount = 0;
    let totalCount = 0;
    const missedDates: string[] = [];
    for (const cell of days) {
      if (!cell.isStudyDay || cell.taskDate > todayIso) continue;
      totalCount += 1;
      if (cell.symbol === "complete") {
        completedCount += 1;
      } else if (cell.symbol === "missing" || cell.symbol === "partial") {
        missedDates.push(cell.taskDate);
      }
    }

    const executionRate =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const programLabel =
      assignments.length === 0
        ? "듣기학습"
        : assignments.length === 1
          ? assignments[0]!.title
          : `듣기학습 (${assignments.length}개 과제)`;

    const accuracy = accuracyByStudent.get(student.id) ?? {
      correctCount: 0,
      answeredCount: 0,
    };

    return {
      studentId: student.id,
      studentName: student.name,
      classLabel: student.classNames.join(", ") || "—",
      teacherLabel: student.teacherNames.join(", "),
      programLabel,
      days,
      completedCount,
      totalCount,
      executionRate,
      correctCount: accuracy.correctCount,
      answeredCount: accuracy.answeredCount,
      missedDates,
      pause,
    };
  });

  const omrByStudent: ListeningOmrStudentSummary[] = students
    .flatMap((student) => {
      const attempts = (omrAttemptsByStudent.get(student.id) ?? []).sort(
        (a, b) => b.examDate.localeCompare(a.examDate)
      );
      if (attempts.length === 0) return [];

      const scores = attempts.map((a) => a.score);
      const summary: ListeningOmrStudentSummary = {
        studentId: student.id,
        studentName: student.name,
        classLabel: student.classNames.join(", ") || "—",
        attemptCount: attempts.length,
        bestScore: Math.max(...scores),
        latestScore: attempts[0]!.score,
        latestDate: attempts[0]!.examDate,
        attempts,
      };
      return [summary];
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));

  return {
    year: options.year,
    month: options.month,
    todayIso,
    daysInMonth,
    rows,
    omrByStudent,
  };
}
