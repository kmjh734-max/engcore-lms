import { getTodayIsoKorea } from "@/lib/date/korea-today";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseDateOnly,
  toDateOnlyString,
} from "@/lib/listening/schedule/days-of-week";
import {
  isTaskStarted,
  planStudentDailyTasks,
  type PlanExistingTaskRow,
} from "@/lib/listening/schedule/plan-daily-tasks";
import { loadSchedulePauses } from "@/lib/listening/schedule/load-pauses";
import {
  applyPausesToAssignment,
  pausesForStudent,
  type SchedulePauseRange,
} from "@/lib/listening/schedule/pauses";
import { buildQuestionQueueForAssignment } from "@/lib/listening/schedule/question-queue";
import { resolveStudentIdsForScheduleAssignment } from "@/lib/listening/schedule/resolve-students";
import {
  getStudentListeningEffectiveStartIso,
  pruneIncompleteTasksBeforeEffectiveStart,
} from "@/lib/listening/schedule/student-effective-start";
import type { QuestionQueueItem } from "@/lib/listening/schedule/types";
import type { ScheduleAssignmentRow } from "@/lib/listening/schedule/types";

const INSERT_BATCH = 80;

type DailyTaskInsert = {
  assignment_id: string;
  student_id: string;
  task_date: string;
  set_id: string;
  question_ids: string[];
  status: "pending";
  completed_count: number;
  total_count: number;
};

/**
 * 진행 기록은 과제 100개 묶음이면 1000행(한 번에 돌려주는 최대)을 넘을 수 있다
 * (예: 하루 20문항 × 100과제). 넘친 행이 빠지면 손댄 문항을 안 손댄 것으로 보고 덜어 낼 수 있어 끝까지 읽는다.
 * 오류가 나면 예전처럼 읽은 데까지만 쓴다.
 */
async function pageProgressRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/** 진행 기록(객관식·받아쓰기 중 하나라도)이 있는 과제 id */
const STARTED_PROGRESS_FILTER =
  "objective_completed.eq.true,dictation_completed.eq.true,completed.eq.true,dictation_score.not.is.null";

/** 오늘·이후 과제에서 학생이 손댄 문항 id (객관식·받아쓰기 기록이 하나라도 있는 문항) */
async function loadTouchedQuestionIds(
  admin: SupabaseClient,
  taskIds: string[]
): Promise<Set<string>> {
  const touched = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += 100) chunks.push(taskIds.slice(i, i + 100));
  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      return pageProgressRows<{ question_id: string }>((from, to) =>
        admin
          .from("listening_daily_task_progress")
          .select("question_id")
          .in("daily_task_id", chunk)
          .or(STARTED_PROGRESS_FILTER)
          .order("id")
          .range(from, to)
      );
    })
  );
  for (const data of parts) {
    for (const row of data) touched.add(row.question_id as string);
  }
  return touched;
}

export async function loadStartedTaskIds(
  admin: SupabaseClient,
  taskIds: string[]
): Promise<Set<string>> {
  const started = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += 100) chunks.push(taskIds.slice(i, i + 100));
  // 읽기만 하므로 묶음끼리 동시에
  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      return pageProgressRows<{ daily_task_id: string }>((from, to) =>
        admin
          .from("listening_daily_task_progress")
          .select("daily_task_id")
          .in("daily_task_id", chunk)
          .or(STARTED_PROGRESS_FILTER)
          .order("id")
          .range(from, to)
      );
    })
  );
  for (const data of parts) {
    for (const row of data) started.add(row.daily_task_id as string);
  }
  return started;
}

async function insertDailyTasksBatch(
  admin: SupabaseClient,
  rows: DailyTaskInsert[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    const { data: inserted, error } = await admin
      .from("listening_daily_tasks")
      .insert(chunk)
      .select("id, student_id, question_ids");

    if (error || !inserted?.length) continue;

    const progressRows = inserted.flatMap((task) =>
      ((task.question_ids as string[]) ?? []).map((questionId) => ({
        daily_task_id: task.id as string,
        student_id: task.student_id as string,
        question_id: questionId,
        objective_completed: false,
        dictation_completed: false,
        completed: false,
      }))
    );

    for (let j = 0; j < progressRows.length; j += INSERT_BATCH) {
      await admin
        .from("listening_daily_task_progress")
        .insert(progressRows.slice(j, j + INSERT_BATCH));
    }
  }
}

export async function ensureDailyTaskForStudentDate(
  admin: SupabaseClient,
  assignment: ScheduleAssignmentRow,
  studentId: string,
  taskDateIso: string,
  queue?: QuestionQueueItem[],
  effectiveStartIso?: string
): Promise<{ created: boolean; taskId: string | null }> {
  const effectiveStart =
    effectiveStartIso ??
    (await getStudentListeningEffectiveStartIso(admin, assignment, studentId));
  if (taskDateIso < effectiveStart) {
    return { created: false, taskId: null };
  }

  const { data: before } = await admin
    .from("listening_daily_tasks")
    .select("id")
    .eq("assignment_id", assignment.id)
    .eq("student_id", studentId)
    .eq("task_date", taskDateIso)
    .maybeSingle();

  await ensureDailyTasksForStudentRange(
    admin,
    assignment,
    studentId,
    taskDateIso,
    taskDateIso,
    queue,
    effectiveStart
  );

  const { data: after } = await admin
    .from("listening_daily_tasks")
    .select("id")
    .eq("assignment_id", assignment.id)
    .eq("student_id", studentId)
    .eq("task_date", taskDateIso)
    .maybeSingle();

  return {
    created: !before?.id && Boolean(after?.id),
    taskId: (after?.id as string | undefined) ?? null,
  };
}

export async function ensureDailyTasksForStudentRange(
  admin: SupabaseClient,
  assignment: ScheduleAssignmentRow,
  studentId: string,
  fromIso: string,
  toIso: string,
  queue?: QuestionQueueItem[],
  effectiveStartIso?: string,
  /** 이 과제의 일시정지 기간 (과제 전체·학생별 모두 — 여기서 이 학생 것만 고른다). 없으면 읽는다 */
  pauses?: readonly SchedulePauseRange[]
): Promise<void> {
  const [effectiveStart, allPauses] = await Promise.all([
    effectiveStartIso ??
      getStudentListeningEffectiveStartIso(admin, assignment, studentId),
    pauses ??
      loadSchedulePauses(admin, [assignment.id]).then(
        (map) => map.get(assignment.id) ?? []
      ),
  ]);
  const pausedRanges = pausesForStudent(allPauses, studentId);

  // 정리(유효 시작일 이전 미완료 삭제)는 아래 읽기와 같이 돌리고, 끝나기를 기다린다
  const prunePromise = pruneIncompleteTasksBeforeEffectiveStart(admin, {
    studentId,
    assignmentId: assignment.id,
    effectiveStartIso: effectiveStart,
  });
  // 아래에서 먼저 오류가 나 기다리지 못해도 처리되지 않은 거부로 남지 않게
  prunePromise.catch(() => undefined);

  const clampedFrom = fromIso < effectiveStart ? effectiveStart : fromIso;
  if (clampedFrom > toIso) {
    await prunePromise;
    return;
  }

  const resolvedQueue =
    queue ?? (await buildQuestionQueueForAssignment(admin, assignment.id));
  if (resolvedQueue.length === 0) {
    await prunePromise;
    return;
  }

  const todayIso = getTodayIsoKorea();
  const queueIds = resolvedQueue.map((q) => q.questionId);
  const queueChunks: string[][] = [];
  for (let i = 0; i < queueIds.length; i += 100) queueChunks.push(queueIds.slice(i, i + 100));

  const [, { data: existingAll }, doneParts] = await Promise.all([
    prunePromise,
    admin
      .from("listening_daily_tasks")
      .select("id, task_date, status, completed_count, question_ids, set_id")
      .eq("assignment_id", assignment.id)
      .eq("student_id", studentId),
    Promise.all(
      queueChunks.map(async (chunk) => {
        return pageProgressRows<{ question_id: string; daily_task_id: string }>(
          (from, to) =>
            admin
              .from("listening_daily_task_progress")
              .select("question_id, daily_task_id")
              .eq("student_id", studentId)
              .eq("completed", true)
              .in("question_id", chunk)
              .order("id")
              .range(from, to)
        );
      })
    ),
  ]);

  // 정리와 동시에 읽었으니, 정리로 지워진 과제(유효 시작일 이전 미완료)와
  // 그 과제의 진행 기록(과제와 함께 지워짐)은 여기서 뺀다 — 정리 후 읽은 것과 같다.
  const allExisting = (existingAll ?? []) as PlanExistingTaskRow[];
  const prunedTaskIds = new Set(
    allExisting
      .filter(
        (row) =>
          row.task_date < effectiveStart &&
          (row.status === "pending" || row.status === "in_progress")
      )
      .map((row) => row.id)
  );
  const existingRows = allExisting.filter((row) => !prunedTaskIds.has(row.id));

  const completedQuestionIds = new Set<string>();
  for (const doneRows of doneParts) {
    for (const row of doneRows) {
      if (prunedTaskIds.has(row.daily_task_id as string)) continue;
      completedQuestionIds.add(row.question_id as string);
    }
  }

  // 오늘 과제를 풀기 시작했으면(끝낸 문항이 아직 없어도) 그대로 둔다
  const upcomingRows = existingRows.filter((row) => row.task_date >= todayIso);
  const [startedTaskIds, touchedQuestionIds] = await Promise.all([
    loadStartedTaskIds(
      admin,
      upcomingRows.filter((row) => !isTaskStarted(row)).map((row) => row.id)
    ),
    // 하루 문항 수를 줄였을 때 시작한 과제에서 덜어 내도 되는 문항을 가리려면 손댄 문항을 알아야 한다
    loadTouchedQuestionIds(
      admin,
      upcomingRows
        .filter((row) => (row.question_ids?.length ?? 0) > assignment.questions_per_day)
        .map((row) => row.id)
    ),
  ]);

  const { idsToDelete, inserts, updates } = planStudentDailyTasks({
    // 끝나는 날이 있으면 쉰 날만큼 뒤로 민 규칙으로 짠다
    assignment: applyPausesToAssignment(assignment, pausedRanges),
    queue: resolvedQueue,
    existingRows,
    completedQuestionIds,
    startedTaskIds,
    touchedQuestionIds,
    todayIso,
    fromIso: clampedFrom,
    toIso,
    pausedRanges,
  });

  // 시작한 오늘 과제에서 안 푼 문항을 덜어 낸다 — 덜어 낸 문항은 아래 inserts 로 다음 날에 들어간다
  for (const u of updates) {
    if (u.removed_ids.length > 0) {
      await admin
        .from("listening_daily_task_progress")
        .delete()
        .eq("daily_task_id", u.id)
        .in("question_id", u.removed_ids);
    }
    const { data: left } = await admin
      .from("listening_daily_task_progress")
      .select("completed")
      .eq("daily_task_id", u.id);
    const completedCount = (left ?? []).filter((r) => r.completed).length;
    const total = u.question_ids.length;
    const allDone = total > 0 && completedCount >= total;
    await admin
      .from("listening_daily_tasks")
      .update({
        question_ids: u.question_ids,
        total_count: total,
        completed_count: completedCount,
        status: allDone ? "completed" : completedCount > 0 ? "in_progress" : "pending",
        completed_at: allDone ? new Date().toISOString() : null,
      })
      .eq("id", u.id);
  }

  const pending: DailyTaskInsert[] = inserts.map((task) => ({
    assignment_id: assignment.id,
    student_id: studentId,
    task_date: task.task_date,
    set_id: task.set_id,
    question_ids: task.question_ids,
    status: "pending",
    completed_count: 0,
    total_count: task.question_ids.length,
  }));

  if (idsToDelete.length > 0) {
    await admin.from("listening_daily_tasks").delete().in("id", idsToDelete);
  }

  if (pending.length > 0) {
    await insertDailyTasksBatch(admin, pending);
  }
}

export async function bootstrapDailyTasksForAssignment(
  admin: SupabaseClient,
  assignment: ScheduleAssignmentRow,
  horizonDays = 30
): Promise<void> {
  const studentIds = await resolveStudentIdsForScheduleAssignment(
    admin,
    assignment
  );
  if (studentIds.length === 0) return;

  const [queue, pauseMap] = await Promise.all([
    buildQuestionQueueForAssignment(admin, assignment.id),
    loadSchedulePauses(admin, [assignment.id]),
  ]);
  if (queue.length === 0) return;
  const pauses = pauseMap.get(assignment.id) ?? [];

  const start = parseDateOnly(assignment.start_date);
  const end = assignment.end_date
    ? parseDateOnly(assignment.end_date)
    : new Date(start.getTime() + horizonDays * 86400000);
  const today = new Date();
  const to =
    end < today
      ? end
      : new Date(
          Math.min(end.getTime(), today.getTime() + horizonDays * 86400000)
        );

  const fromIso = assignment.start_date;
  const toIso = toDateOnlyString(to);
  if (fromIso > toIso) return;

  for (const studentId of studentIds) {
    const effectiveStart = await getStudentListeningEffectiveStartIso(
      admin,
      assignment,
      studentId
    );
    const studentFrom = fromIso < effectiveStart ? effectiveStart : fromIso;
    if (studentFrom > toIso) continue;

    await ensureDailyTasksForStudentRange(
      admin,
      assignment,
      studentId,
      studentFrom,
      toIso,
      queue,
      effectiveStart,
      pauses
    );
  }
}
