import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { scheduleStudentMonthlySeat } from "@/lib/credits/monthly-seat";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreDictationAttempt } from "@/lib/listening/dictation/score-blanks";
import { filterWordOnlyBlankItems } from "@/lib/listening/dictation/word-only";
import type { DictationBlankItem } from "@/lib/listening/dictation/types";
import { DEFAULT_DICTATION_SETTINGS } from "@/lib/listening/dictation/types";

export const maxDuration = 60;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "student") {
      return jsonError("학생 권한이 필요합니다.", 403);
    }

    const body = (await request.json()) as {
      attemptId?: string;
      studentAnswers?: Record<string, string>;
      /** 화면이 보내도 쓰지 않는다 — 통과 기준은 서버(배정·세트 설정)에서만 정한다 */
      passScore?: number;
      dailyTaskId?: string;
    };

    const attemptId = body.attemptId?.trim();
    if (!attemptId) return jsonError("attemptId가 필요합니다.");

    const admin = createAdminClient();
    const { data: attempt, error: aErr } = await admin
      .from("listening_dictation_attempts")
      .select(
        "id, student_id, set_id, question_id, attempt_no, blank_items, submitted_at"
      )
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr || !attempt) return jsonError("Dictation 시도를 찾을 수 없습니다.");
    if (attempt.student_id !== profile.id) {
      return jsonError("권한이 없습니다.", 403);
    }
    if (attempt.submitted_at) {
      return jsonError("이미 제출한 시도입니다.");
    }

    const { data: setRow } = await admin
      .from("listening_sets")
      .select("dictation_pass_score")
      .eq("id", attempt.set_id)
      .maybeSingle();

    let passScore =
      setRow?.dictation_pass_score ?? DEFAULT_DICTATION_SETTINGS.dictation_pass_score;

    const dailyTaskId = body.dailyTaskId?.trim();
    if (dailyTaskId) {
      const { data: task } = await admin
        .from("listening_daily_tasks")
        .select("assignment_id, student_id")
        .eq("id", dailyTaskId)
        .maybeSingle();
      if (task && task.student_id === profile.id) {
        const { data: assignment } = await admin
          .from("listening_schedule_assignments")
          .select("dictation_pass_score")
          .eq("id", task.assignment_id)
          .maybeSingle();
        if (assignment?.dictation_pass_score != null) {
          passScore = assignment.dictation_pass_score as number;
        }
      }
    }

    const blankItems = filterWordOnlyBlankItems(
      (attempt.blank_items ?? []) as DictationBlankItem[]
    );
    if (blankItems.length === 0) {
      return jsonError("채점할 Dictation 빈칸이 없습니다.");
    }
    const studentAnswers = body.studentAnswers ?? {};

    const scored = scoreDictationAttempt(blankItems, studentAnswers, passScore);

    const { error: upErr } = await admin
      .from("listening_dictation_attempts")
      .update({
        student_answers: studentAnswers,
        score: scored.score,
        passed: scored.passed,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", attemptId);

    if (upErr) return jsonError(upErr.message);

    // 새 달에 처음 공부하면 이번 달 듣기 이용료를 낸다(응답 뒤에, 잔액이 모자라도 막지 않는다)
    scheduleStudentMonthlySeat({
      academyId: profile.academy_id,
      studentId: profile.id,
      kind: "listening",
    });

    return NextResponse.json({
      ok: true,
      score: scored.score,
      passed: scored.passed,
      passScore: scored.passScore,
      results: scored.results,
      attemptNo: attempt.attempt_no,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Dictation 제출 오류";
    return jsonError(message);
  }
}
