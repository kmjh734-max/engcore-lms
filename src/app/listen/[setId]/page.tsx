import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { StudentListeningExamHub } from "@/components/listening/StudentListeningExamHub";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStudentAssignedListeningSet } from "@/lib/listening/student-set-access";

export default async function ListenHubPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/login?redirect=${encodeURIComponent(`/listen/${setId}`)}`);
  }

  if (profile.is_active === false) {
    redirect("/login?inactive=1");
  }

  // QR OMR: full set (not schedule daily-task subsets via RLS).
  const admin = createAdminClient();

  const { data: set } = await admin
    .from("listening_sets")
    .select("id, title, academy_id, is_published")
    .eq("id", setId)
    .maybeSingle();

  if (!set) notFound();

  if (profile.role === "student") {
    // 종이 시험 QR: 같은 학원에 공개된 세트이거나 배정된 세트만 (제출 API와 같은 기준)
    const sameAcademyPublished =
      set.is_published === true &&
      !!profile.academy_id &&
      set.academy_id === profile.academy_id;
    if (
      !sameAcademyPublished &&
      !(await isStudentAssignedListeningSet(admin, profile.id, setId))
    ) {
      notFound();
    }
  } else if (
    (profile.role === "admin" || profile.role === "teacher") &&
    profile.academy_id &&
    set.academy_id &&
    set.academy_id !== profile.academy_id
  ) {
    notFound();
  }

  const { data: questions } = await admin
    .from("listening_questions")
    .select("id, order_index, audio_url")
    .eq("set_id", setId)
    .order("order_index", { ascending: true });

  const canSubmitOmr = profile.role === "student";
  let initialAttempt = null;

  if (canSubmitOmr) {
    const { data: latest } = await admin
      .from("listening_exam_attempts")
      .select("id, score, correct_count, total_count, submitted_at")
      .eq("student_id", profile.id)
      .eq("set_id", setId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      const { data: answerRows } = await admin
        .from("listening_exam_answers")
        .select(
          "question_id, order_index, student_answer, correct_answer, is_correct"
        )
        .eq("attempt_id", latest.id)
        .order("order_index", { ascending: true });

      initialAttempt = {
        score: latest.score as number,
        correctCount: latest.correct_count as number,
        totalCount: latest.total_count as number,
        submittedAt: latest.submitted_at as string,
        results: (answerRows ?? []).map((row) => ({
          questionId: row.question_id as string,
          orderIndex: row.order_index as number,
          studentAnswer: row.student_answer as number | null,
          correctAnswer: row.correct_answer as number,
          isCorrect: row.is_correct as boolean,
        })),
      };
    }
  }

  return (
    <StudentListeningExamHub
      setId={setId}
      setTitle={set.title}
      questions={(questions ?? []).map((q) => ({
        id: q.id as string,
        orderIndex: q.order_index as number,
        audioUrl: q.audio_url as string | null,
      }))}
      canSubmitOmr={canSubmitOmr}
      initialAttempt={initialAttempt}
    />
  );
}
