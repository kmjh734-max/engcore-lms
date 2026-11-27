import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import { getTodayIsoKorea } from "@/lib/date/korea-today";
import {
  addDaysIso,
  runWithConcurrency,
} from "@/lib/listening/schedule/edit-assignment";
import { ensureDailyTasksForStudentRange } from "@/lib/listening/schedule/generate-daily-tasks";
import {
  isMissingPauseTable,
  loadSchedulePauses,
  mapPauseRow,
  PAUSE_TABLE,
} from "@/lib/listening/schedule/load-pauses";
import {
  applyPausesToAssignment,
  pausesForStudent,
  type SchedulePauseRange,
} from "@/lib/listening/schedule/pauses";
import { buildQuestionQueueForAssignment } from "@/lib/listening/schedule/question-queue";
import { resolveStudentIdsForScheduleAssignment } from "@/lib/listening/schedule/resolve-students";
import { getStudentListeningEffectiveStartIso } from "@/lib/listening/schedule/student-effective-start";
import type { ScheduleAssignmentRow } from "@/lib/listening/schedule/types";

/** 다시 시작할 날은 오늘로부터 1년 안 */
export const PAUSE_UNTIL_MAX_DAYS = 365;
/** 재개 뒤 미리 만들어 둘 기간 (학생 화면 futureDays 와 같게) */
const REGENERATE_HORIZON_DAYS = 45;

const MISSING_TABLE_MESSAGE =
  "일시정지를 쓰려면 DB 업데이트(135)가 필요해요. 관리자에게 알려 주세요.";

type ActionResult =
  | { ok: true; message: string; clearedTasks?: number }
  | { ok: false; message: string };

/**
 * 오늘·이후 미완료 일일 과제 삭제 (일시정지 시 학생 화면·밀린 과제 방지).
 * studentId 가 있으면 그 학생 것만. 지운 과제의 문항은 재개하면 다시 나간다.
 */
export async function clearIncompleteTasksFromDate(
  admin: SupabaseClient,
  assignmentId: string,
  fromDateIso: string,
  studentId?: string | null
): Promise<number> {
  // 반 전체를 멈추면 학생 × 앞으로 날짜가 1000개를 넘어 일부 학생 과제가 남았다 — 끝까지 읽는다
  const rows = await fetchAllRowsSoft<{ id: string }>((from, to) => {
    let query = admin
      .from("listening_daily_tasks")
      .select("id")
      .eq("assignment_id", assignmentId)
      .gte("task_date", fromDateIso)
      .in("status", ["pending", "in_progress"]);
    if (studentId) query = query.eq("student_id", studentId);
    return query.order("id").range(from, to);
  });

  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    // 진행 기록은 FK cascade
    await admin.from("listening_daily_tasks").delete().in("id", ids.slice(i, i + 100));
  }
  return ids.length;
}

/** 같은 범위(과제 전체 / 이 학생)에서 today 에 걸린 멈춤 */
function coveringSameScope(
  ranges: SchedulePauseRange[],
  studentId: string | null,
  todayIso: string
): SchedulePauseRange[] {
  return ranges.filter(
    (r) =>
      r.studentId === studentId &&
      r.startDate <= todayIso &&
      (r.endDate === null || todayIso < r.endDate)
  );
}

async function loadPausesStrict(
  admin: SupabaseClient,
  assignmentId: string
): Promise<{ ok: true; ranges: SchedulePauseRange[] } | { ok: false; message: string }> {
  const { data, error } = await admin
    .from(PAUSE_TABLE)
    .select("id, assignment_id, student_id, start_date, end_date, paused_by, paused_at")
    .eq("assignment_id", assignmentId);
  if (error) {
    return {
      ok: false,
      message: isMissingPauseTable(error) ? MISSING_TABLE_MESSAGE : error.message,
    };
  }
  return { ok: true, ranges: (data ?? []).map((row) => mapPauseRow(row)) };
}

/**
 * 일시정지: 오늘부터 멈춘다.
 * - studentId = null 이면 과제 전체, 값이 있으면 반 배정 안의 이 학생만.
 * - untilIso 가 있으면 그날부터 저절로 다시 나간다.
 * - 오늘·이후 미완료 과제는 지운다 (끝낸 과제·지난 기록은 그대로).
 */
export async function pauseScheduleAssignment(
  admin: SupabaseClient,
  opts: {
    assignment: ScheduleAssignmentRow;
    studentId: string | null;
    untilIso: string | null;
    actorId: string | null;
    todayIso?: string;
  }
): Promise<ActionResult> {
  const todayIso = opts.todayIso ?? getTodayIsoKorea();
  const { assignment, studentId, untilIso } = opts;

  if (!assignment.is_active) {
    return { ok: false, message: "이미 멈춰 있는 과제예요." };
  }
  if (untilIso && untilIso <= todayIso) {
    return { ok: false, message: "다시 시작할 날은 내일 이후로 골라 주세요." };
  }

  const loaded = await loadPausesStrict(admin, assignment.id);
  if (!loaded.ok) return loaded;

  if (coveringSameScope(loaded.ranges, null, todayIso).length > 0) {
    return {
      ok: false,
      message: studentId
        ? "반 전체가 일시정지 중이에요."
        : "이미 일시정지 중이에요.",
    };
  }
  if (studentId && coveringSameScope(loaded.ranges, studentId, todayIso).length > 0) {
    return { ok: false, message: "이미 일시정지 중인 학생이에요." };
  }

  const { error } = await admin.from(PAUSE_TABLE).insert({
    assignment_id: assignment.id,
    student_id: studentId,
    start_date: todayIso,
    end_date: untilIso,
    paused_by: opts.actorId,
  });
  if (error) {
    return {
      ok: false,
      message: isMissingPauseTable(error) ? MISSING_TABLE_MESSAGE : error.message,
    };
  }

  const clearedTasks = await clearIncompleteTasksFromDate(
    admin,
    assignment.id,
    todayIso,
    studentId
  );

  return {
    ok: true,
    clearedTasks,
    message: untilIso
      ? "일시정지했어요. 다시 시작하는 날부터 멈춘 곳 다음 문항이 나가요."
      : "일시정지했어요. 재개하면 멈춘 곳 다음 문항부터 이어져요.",
  };
}

/**
 * 재개: 오늘부터 다시 나간다 (멈춘 곳 다음 문항부터).
 * - 오늘 멈추고 오늘 재개하면 기록을 지운다(쉰 날이 없음).
 * - 예전 방식(is_active = false)으로 멈춘 과제는 is_active 를 다시 켠다.
 */
export async function resumeScheduleAssignment(
  admin: SupabaseClient,
  opts: {
    assignment: ScheduleAssignmentRow;
    studentId: string | null;
    actorId: string | null;
    todayIso?: string;
  }
): Promise<ActionResult> {
  const todayIso = opts.todayIso ?? getTodayIsoKorea();
  const { assignment, studentId } = opts;

  let legacyResumed = false;
  if (!studentId && !assignment.is_active) {
    const { error } = await admin
      .from("listening_schedule_assignments")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", assignment.id);
    if (error) return { ok: false, message: error.message };
    legacyResumed = true;
  }

  const loaded = await loadPausesStrict(admin, assignment.id);
  if (!loaded.ok) {
    // 표가 없어도 예전 방식 재개는 끝났다
    return legacyResumed ? { ok: true, message: "재개했어요." } : loaded;
  }

  const covering = coveringSameScope(loaded.ranges, studentId, todayIso);
  if (covering.length === 0) {
    return legacyResumed
      ? { ok: true, message: "재개했어요. 멈춘 곳 다음 문항부터 이어져요." }
      : { ok: false, message: "일시정지 중이 아니에요." };
  }

  const nowIso = new Date().toISOString();
  for (const range of covering) {
    const result =
      range.startDate >= todayIso
        ? await admin.from(PAUSE_TABLE).delete().eq("id", range.id)
        : await admin
            .from(PAUSE_TABLE)
            .update({
              end_date: todayIso,
              resumed_by: opts.actorId,
              resumed_at: nowIso,
            })
            .eq("id", range.id);
    if (result.error) return { ok: false, message: result.error.message };
  }

  return { ok: true, message: "재개했어요. 오늘부터 멈춘 곳 다음 문항이 나가요." };
}

/**
 * 멈추거나 다시 시작한 뒤 오늘부터 앞으로 45일 과제를 다시 짠다
 * (멈춘 날은 비우고, 다시 나가는 날부터 멈춘 곳 다음 문항으로 채움).
 * studentIds 가 없으면 과제의 학생 모두.
 */
export async function regenerateUpcomingScheduleTasks(
  admin: SupabaseClient,
  assignmentId: string,
  studentIds?: string[] | null,
  todayIso = getTodayIsoKorea()
): Promise<void> {
  const { data: row } = await admin
    .from("listening_schedule_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!row) return;
  const assignment = row as ScheduleAssignmentRow;
  if (!assignment.is_active) return;

  const [ids, queue, pauseMap] = await Promise.all([
    studentIds?.length
      ? Promise.resolve(studentIds)
      : resolveStudentIdsForScheduleAssignment(admin, assignment),
    buildQuestionQueueForAssignment(admin, assignment.id),
    loadSchedulePauses(admin, [assignment.id]),
  ]);
  if (ids.length === 0 || queue.length === 0) return;
  const pauses = pauseMap.get(assignment.id) ?? [];
  const horizonTo = addDaysIso(todayIso, REGENERATE_HORIZON_DAYS);

  await runWithConcurrency(ids, 5, async (studentId) => {
    const effectiveStart = await getStudentListeningEffectiveStartIso(
      admin,
      assignment,
      studentId
    );
    const endIso = applyPausesToAssignment(
      assignment,
      pausesForStudent(pauses, studentId)
    ).end_date;
    const toIso = endIso && endIso < horizonTo ? endIso : horizonTo;
    const fromIso = effectiveStart > todayIso ? effectiveStart : todayIso;
    if (fromIso > toIso) return;
    await ensureDailyTasksForStudentRange(
      admin,
      assignment,
      studentId,
      fromIso,
      toIso,
      queue,
      effectiveStart,
      pauses
    );
  });
}
