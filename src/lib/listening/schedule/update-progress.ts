import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduleAssignmentRow } from "@/lib/listening/schedule/types";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

async function refreshDailyTaskCounts(
  admin: SupabaseClient,
  dailyTaskId: string,
  totalCount: number
): Promise<{ completedCount: number; allDone: boolean }> {
  const { data: progressRows } = await admin
    .from("listening_daily_task_progress")
    .select("completed")
    .eq("daily_task_id", dailyTaskId);

  const completedCount = (progressRows ?? []).filter((r) => r.completed).length;
  const allDone = completedCount >= totalCount && totalCount > 0;
  const nextStatus = allDone
    ? "completed"
    : completedCount > 0
      ? "in_progress"
      : "pending";

  await admin
    .from("listening_daily_tasks")
    .update({
      completed_count: completedCount,
      status: nextStatus,
      completed_at: allDone ? new Date().toISOString() : null,
    })
    .eq("id", dailyTaskId);

  return { completedCount, allDone };
}

/**
 * Dictation 없이 completed=true 로 남은 문항을 복구한다.
 * (빈칸 생성 실패·클라이언트 오기록 등으로 세모 상태에서 Dictation 재시도 불가하던 문제)
 */
export async function reconcileDailyTaskDictationProgress(
  admin: SupabaseClient,
  opts: {
    dailyTaskId: string;
    studentId: string;
    setId: string;
    requireDictation: boolean;
    dictationPassScore: number;
  }
): Promise<void> {
  if (!opts.requireDictation) {
    // 받아쓰기가 필요 없는 과제인데 객관식만 끝낸 문항이 미완료로 남아 있으면 완료로 맞춘다
    // (예전 서버가 두 세트에 걸친 과제를 「받아쓰기 필요」로 보아 영영 안 끝나던 것 되살리기)
    const { data: stuck } = await admin
      .from("listening_daily_task_progress")
      .update({ completed: true, completed_at: new Date().toISOString() })
      .eq("daily_task_id", opts.dailyTaskId)
      .eq("student_id", opts.studentId)
      .eq("objective_completed", true)
      .eq("completed", false)
      .select("question_id");
    if (stuck && stuck.length > 0) {
      const { data: t } = await admin
        .from("listening_daily_tasks")
        .select("total_count")
        .eq("id", opts.dailyTaskId)
        .maybeSingle();
      if (t) await refreshDailyTaskCounts(admin, opts.dailyTaskId, t.total_count as number);
    }
    return;
  }

  const { data: task } = await admin
    .from("listening_daily_tasks")
    .select("total_count")
    .eq("id", opts.dailyTaskId)
    .maybeSingle();
  if (!task) return;

  const { data: rows } = await admin
    .from("listening_daily_task_progress")
    .select(
      "question_id, objective_completed, dictation_completed, completed, dictation_score"
    )
    .eq("daily_task_id", opts.dailyTaskId)
    .eq("student_id", opts.studentId);

  let changed = false;

  // 문항마다 따로 묻던 것(학생 화면을 열 때마다 N번)을 한 번에 읽는다 — 문항별 최고 점수 시도
  const checkIds = (rows ?? [])
    .filter((row) => row.completed || row.dictation_completed)
    .map((row) => row.question_id as string);
  const bestAttempt = new Map<string, { score: number | null; passed: boolean | null }>();
  if (checkIds.length > 0) {
    const attempts = await fetchAllRows<{ question_id: string; score: number | null; passed: boolean | null }>(
      (from, to) =>
        admin
          .from("listening_dictation_attempts")
          .select("question_id, score, passed")
          .eq("student_id", opts.studentId)
          .in("question_id", checkIds)
          .not("submitted_at", "is", null)
          .order("score", { ascending: false })
          .order("id")
          .range(from, to)
    ).catch(() => null);
    // 못 읽었으면 고치지 않는다(빈 결과로 보면 완료 문항을 잘못 되돌린다)
    if (!attempts) return;
    for (const a of attempts) {
      const k = String(a.question_id);
      if (!bestAttempt.has(k)) bestAttempt.set(k, a);
    }
  }
  const writes: PromiseLike<unknown>[] = [];
  const resetPassedIds: string[] = [];

  for (const row of rows ?? []) {
    if (!row.completed && !row.dictation_completed) continue;

    const attempt = bestAttempt.get(String(row.question_id)) ?? null;

    const score = attempt?.score != null ? (attempt.score as number) : null;
    const dictationOk = score != null && score >= opts.dictationPassScore;

    if (dictationOk) {
      if (!row.completed || !row.dictation_completed) {
        writes.push(admin
          .from("listening_daily_task_progress")
          .update({
            dictation_completed: true,
            dictation_score: score,
            completed: !!row.objective_completed,
            completed_at:
              row.objective_completed && dictationOk
                ? new Date().toISOString()
                : null,
          })
          .eq("daily_task_id", opts.dailyTaskId)
          .eq("question_id", row.question_id as string)
          .eq("student_id", opts.studentId));
        changed = true;
      }
      continue;
    }

    // 그때 통과 점수로 서버가 통과 처리한 문항(제출 점수가 기록과 같음)은
    // 선생님이 나중에 통과 점수를 올려도 그대로 둔다 — 새 점수는 아직 못 넘은 문항부터
    const passedUnderEarlierScore =
      !!row.completed &&
      !!row.dictation_completed &&
      row.dictation_score != null &&
      score != null &&
      score >= (row.dictation_score as number);
    if (passedUnderEarlierScore) continue;

    // 실제 통과 점수 미달인데 완료로 남아 있으면 되돌림
    if (row.completed || row.dictation_completed) {
      writes.push(admin
        .from("listening_daily_task_progress")
        .update({
          dictation_completed: false,
          dictation_score: score,
          completed: false,
          completed_at: null,
        })
        .eq("daily_task_id", opts.dailyTaskId)
        .eq("question_id", row.question_id as string)
        .eq("student_id", opts.studentId));
      changed = true;
    }

    // 세트 기준 passed=true 이지만 배정 점수 미달인 시도는 재도전 가능하도록 표시 해제
    if (attempt?.passed && score != null && score < opts.dictationPassScore) {
      resetPassedIds.push(row.question_id as string);
    }
  }

  if (resetPassedIds.length > 0) {
    writes.push(
      admin
        .from("listening_dictation_attempts")
        .update({ passed: false })
        .eq("student_id", opts.studentId)
        .in("question_id", resetPassedIds)
        .eq("passed", true)
        .lt("score", opts.dictationPassScore)
    );
  }
  await Promise.all(writes);

  if (changed) {
    await refreshDailyTaskCounts(
      admin,
      opts.dailyTaskId,
      task.total_count as number
    );
  }
}

export async function updateDailyTaskQuestionProgress(
  admin: SupabaseClient,
  opts: {
    dailyTaskId: string;
    studentId: string;
    questionId: string;
    objectiveCompleted: boolean;
    /** 학생이 고른 객관식 번호(1-based). 있으면 서버에서 정답과 비교해 저장 */
    selectedAnswer?: number | null;
    dictationCompleted?: boolean;
    dictationScore?: number | null;
    requireDictationPass: boolean;
    dictationPassScore: number;
  }
): Promise<{ ok: boolean; message?: string; taskCompleted?: boolean }> {
  const { data: task } = await admin
    .from("listening_daily_tasks")
    .select(
      "id, student_id, assignment_id, set_id, question_ids, completed_count, total_count, status, task_date"
    )
    .eq("id", opts.dailyTaskId)
    .maybeSingle();

  if (!task || task.student_id !== opts.studentId) {
    return { ok: false, message: "오늘 과제를 찾을 수 없습니다." };
  }

  const questionIds = (task.question_ids as string[]) ?? [];
  if (!questionIds.includes(opts.questionId)) {
    return { ok: false, message: "이 과제의 문항이 아닙니다." };
  }

  const [{ data: assignment }, { data: qRows }] = await Promise.all([
    admin
      .from("listening_schedule_assignments")
      .select("require_dictation_pass, dictation_pass_score")
      .eq("id", task.assignment_id)
      .maybeSingle(),
    admin.from("listening_questions").select("set_id").in("id", questionIds),
  ]);
  // 화면(student/listening/daily/[taskId])과 같은 기준: 과제 세트 + 과제 문항들의 세트 중
  // 하나라도 받아쓰기가 꺼져 있으면 받아쓰기 없이 끝낸다. 전에는 과제 세트 하나만 봐서
  // 두 세트에 걸친 과제가 화면은 「완료」, 서버는 「받아쓰기 필요」로 영영 안 끝났다.
  const taskSetIds = [
    ...new Set([task.set_id as string, ...(qRows ?? []).map((r) => r.set_id as string)]),
  ].filter(Boolean);
  const { data: taskSets } = await admin
    .from("listening_sets")
    .select("dictation_enabled")
    .in("id", taskSetIds);
  const anyDictationDisabled = (taskSets ?? []).some((s) => s.dictation_enabled === false);

  const requireDictation =
    (assignment?.require_dictation_pass ?? opts.requireDictationPass) &&
    !anyDictationDisabled;
  const passScore =
    assignment?.dictation_pass_score ?? opts.dictationPassScore;

  let dictationCompleted = opts.dictationCompleted ?? false;
  let dictationScore = opts.dictationScore ?? null;

  // Dictation은 DB 제출 기록으로만 통과 인정 (클라이언트 값 신뢰 금지)
  // 하루 과제가 세트 경계를 넘으면 task.set_id 와 문항 set_id 가 다를 수 있음
  if (requireDictation) {
    const { data: attempt } = await admin
      .from("listening_dictation_attempts")
      .select("score, passed, submitted_at, set_id")
      .eq("student_id", opts.studentId)
      .eq("question_id", opts.questionId)
      .not("submitted_at", "is", null)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attempt && attempt.score != null) {
      dictationScore = attempt.score as number;
      dictationCompleted = dictationScore >= passScore;
    } else {
      dictationCompleted = false;
      dictationScore = null;
    }
  }

  const dictationOk = !requireDictation || dictationCompleted;
  const completed = opts.objectiveCompleted && dictationOk;

  let objectiveCorrect: boolean | null | undefined;
  let selectedAnswer: number | null | undefined;
  if (
    opts.objectiveCompleted &&
    typeof opts.selectedAnswer === "number" &&
    opts.selectedAnswer > 0
  ) {
    selectedAnswer = Math.floor(opts.selectedAnswer);
    const { data: question } = await admin
      .from("listening_questions")
      .select("correct_answer")
      .eq("id", opts.questionId)
      .maybeSingle();
    const correct = Number(question?.correct_answer);
    if (Number.isFinite(correct) && correct > 0) {
      objectiveCorrect = selectedAnswer === correct;
    }
  }

  const progressPatch: Record<string, unknown> = {
    objective_completed: opts.objectiveCompleted,
    dictation_completed: dictationCompleted,
    dictation_score: dictationScore,
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  };
  if (objectiveCorrect !== undefined) {
    progressPatch.objective_correct = objectiveCorrect;
  }
  if (selectedAnswer !== undefined) {
    progressPatch.selected_answer = selectedAnswer;
  }

  const { data: updatedRows } = await admin
    .from("listening_daily_task_progress")
    .update(progressPatch)
    .eq("daily_task_id", opts.dailyTaskId)
    .eq("question_id", opts.questionId)
    .eq("student_id", opts.studentId)
    .select("id");
  if (updatedRows && updatedRows.length === 0) {
    // 과제를 만들 때 진행 줄이 빠졌으면(넣기 실패) 지금 만든다 — 전에는 0줄 갱신으로 과제가 0/N에서 멈췄다
    await admin.from("listening_daily_task_progress").upsert(
      {
        daily_task_id: opts.dailyTaskId,
        student_id: opts.studentId,
        question_id: opts.questionId,
        ...progressPatch,
      },
      { onConflict: "daily_task_id,question_id" }
    );
  }

  const { allDone } = await refreshDailyTaskCounts(
    admin,
    opts.dailyTaskId,
    task.total_count as number
  );

  return { ok: true, taskCompleted: allDone };
}

export async function loadDailyTaskProgressMap(
  admin: SupabaseClient,
  dailyTaskId: string,
  studentId: string
): Promise<
  Record<
    string,
    {
      objectiveCompleted: boolean;
      dictationCompleted: boolean;
      completed: boolean;
    }
  >
> {
  const { data } = await admin
    .from("listening_daily_task_progress")
    .select("question_id, objective_completed, dictation_completed, completed")
    .eq("daily_task_id", dailyTaskId)
    .eq("student_id", studentId);

  const out: Record<
    string,
    {
      objectiveCompleted: boolean;
      dictationCompleted: boolean;
      completed: boolean;
    }
  > = {};

  for (const row of data ?? []) {
    out[row.question_id as string] = {
      objectiveCompleted: !!row.objective_completed,
      dictationCompleted: !!row.dictation_completed,
      completed: !!row.completed,
    };
  }
  return out;
}

export async function getAssignmentForDailyTask(
  admin: SupabaseClient,
  dailyTaskId: string
): Promise<ScheduleAssignmentRow | null> {
  const { data: task } = await admin
    .from("listening_daily_tasks")
    .select("assignment_id")
    .eq("id", dailyTaskId)
    .maybeSingle();
  if (!task) return null;

  const { data: assignment } = await admin
    .from("listening_schedule_assignments")
    .select("*")
    .eq("id", task.assignment_id)
    .maybeSingle();

  return (assignment as ScheduleAssignmentRow) ?? null;
}
