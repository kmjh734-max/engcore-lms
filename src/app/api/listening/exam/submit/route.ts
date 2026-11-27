import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { scheduleStudentMonthlySeat } from "@/lib/credits/monthly-seat";
import { gradeListeningExamAnswers } from "@/lib/listening/exam/grade-answers";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStudentAssignedListeningSet } from "@/lib/listening/student-set-access";

export const maxDuration = 60;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "student") {
      return jsonError("학생 계정으로 로그인해야 답안을 제출할 수 있습니다.", 403);
    }
    if (profile.is_active === false) {
      return jsonError("비활성화된 계정입니다.", 403);
    }

    const body = (await request.json()) as {
      setId?: string;
      answers?: Record<string, number>;
      source?: "qr_omr" | "online" | "schedule";
      dailyTaskId?: string;
    };

    const setId = body.setId?.trim();
    if (!setId) return jsonError("setId가 필요합니다.");

    const answers = body.answers ?? {};
    const source = body.source ?? "qr_omr";

    const admin = createAdminClient();

    const { data: setRow } = await admin
      .from("listening_sets")
      .select("id, title, academy_id, is_published")
      .eq("id", setId)
      .maybeSingle();

    if (!setRow) {
      return jsonError("듣기 세트를 찾을 수 없습니다.");
    }

    // 배정된 세트이거나, 같은 학원에 공개된 세트(종이 시험 QR)만 제출할 수 있다
    const sameAcademyPublished =
      setRow.is_published === true &&
      !!profile.academy_id &&
      setRow.academy_id === profile.academy_id;
    if (
      !sameAcademyPublished &&
      !(await isStudentAssignedListeningSet(admin, profile.id, setId))
    ) {
      return jsonError("배정된 듣기 세트가 아닙니다.", 403);
    }

    const dailyTaskId = body.dailyTaskId?.trim() || null;
    if (dailyTaskId) {
      const { data: task } = await admin
        .from("listening_daily_tasks")
        .select("id")
        .eq("id", dailyTaskId)
        .eq("student_id", profile.id)
        .maybeSingle();
      if (!task) return jsonError("오늘 과제를 찾을 수 없습니다.", 403);
    }

    const { data: questions, error: qErr } = await admin
      .from("listening_questions")
      .select("id, order_index, correct_answer")
      .eq("set_id", setId)
      .order("order_index", { ascending: true });

    if (qErr || !questions?.length) {
      return jsonError("채점할 문항이 없습니다.");
    }

    const graded = gradeListeningExamAnswers(
      questions.map((q) => ({
        id: q.id as string,
        order_index: q.order_index as number,
        correct_answer: q.correct_answer as number,
      })),
      answers
    );

    const { data: attempt, error: aErr } = await admin
      .from("listening_exam_attempts")
      .insert({
        student_id: profile.id,
        set_id: setId,
        source,
        daily_task_id: dailyTaskId,
        score: graded.score,
        correct_count: graded.correctCount,
        total_count: graded.totalCount,
      })
      .select("id, submitted_at")
      .single();

    if (aErr || !attempt) {
      return jsonError(aErr?.message ?? "시험 결과 저장에 실패했습니다.");
    }

    const answerRows = graded.answers.map((row) => ({
      attempt_id: attempt.id,
      question_id: row.questionId,
      order_index: row.orderIndex,
      student_answer: row.studentAnswer,
      correct_answer: row.correctAnswer,
      is_correct: row.isCorrect,
    }));

    const { error: ansErr } = await admin
      .from("listening_exam_answers")
      .insert(answerRows);

    if (ansErr) {
      await admin.from("listening_exam_attempts").delete().eq("id", attempt.id);
      return jsonError(ansErr.message);
    }

    // 새 달에 처음 공부하면 이번 달 듣기 이용료를 낸다(응답 뒤에, 잔액이 모자라도 막지 않는다)
    scheduleStudentMonthlySeat({
      academyId: profile.academy_id,
      studentId: profile.id,
      kind: "listening",
    });

    return NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      submittedAt: attempt.submitted_at,
      score: graded.score,
      correctCount: graded.correctCount,
      totalCount: graded.totalCount,
      results: graded.answers.map((row) => ({
        questionId: row.questionId,
        orderIndex: row.orderIndex,
        studentAnswer: row.studentAnswer,
        correctAnswer: row.correctAnswer,
        isCorrect: row.isCorrect,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "시험 제출 오류";
    return jsonError(message);
  }
}
