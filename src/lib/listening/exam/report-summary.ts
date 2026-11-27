import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import { loadStudentListeningSetIdsForReport } from "@/lib/listening/schedule/report-summary";
import { getReportRangeBounds, isIsoInReportRange } from "@/lib/reports/date-range";
import type { ReportRange } from "@/lib/reports/types";

export interface ListeningExamReportSection {
  setId: string;
  setTitle: string;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
  latestSubmittedAt: string | null;
  summaryLine: string;
}

export async function buildListeningExamReport(
  supabase: SupabaseClient,
  studentId: string,
  range?: ReportRange
): Promise<ListeningExamReportSection[]> {
  const { data: attempts } = await supabase
    .from("listening_exam_attempts")
    .select("id, set_id, score, correct_count, total_count, submitted_at")
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: false });

  if (!attempts || attempts.length === 0) return [];

  const assignedSetIds = await loadStudentListeningSetIdsForReport(
    supabase,
    studentId
  );
  const attemptSetIds = [...new Set(attempts.map((a) => a.set_id as string))];
  const setIds = [
    ...new Set([...assignedSetIds, ...attemptSetIds]),
  ];

  const { data: sets } = await supabase
    .from("listening_sets")
    .select("id, title")
    .in("id", setIds);

  // 세트가 60개쯤 넘으면 문항이 1000행을 넘어 문항 수가 틀렸다 — 끝까지 읽는다
  const questions = (
    await Promise.all(
      chunkIds(setIds, 80).map((chunk) =>
        fetchAllRowsSoft<{ id: string; set_id: string }>((from, to) =>
          supabase
            .from("listening_questions")
            .select("id, set_id")
            .in("set_id", chunk)
            .order("id")
            .range(from, to)
        )
      )
    )
  ).flat();

  const qCountBySet = new Map<string, number>();
  for (const q of questions) {
    const sid = q.set_id as string;
    qCountBySet.set(sid, (qCountBySet.get(sid) ?? 0) + 1);
  }

  const bounds = range ? getReportRangeBounds(range) : null;

  const sections: ListeningExamReportSection[] = [];

  for (const set of sets ?? []) {
    const setId = set.id as string;
    const setAttempts = attempts.filter((a) => {
      if (a.set_id !== setId) return false;
      if (!bounds) return true;
      const submitted = (a.submitted_at as string).slice(0, 10);
      return isIsoInReportRange(submitted, bounds);
    });
    if (setAttempts.length === 0) continue;

    const bestScore = Math.max(...setAttempts.map((a) => a.score as number));
    const latest = setAttempts[0]!;
    const questionCount = qCountBySet.get(setId) ?? latest.total_count;

    sections.push({
      setId,
      setTitle: set.title as string,
      questionCount,
      attemptCount: setAttempts.length,
      bestScore,
      latestScore: latest.score as number,
      latestSubmittedAt: latest.submitted_at as string,
      summaryLine: `최근 ${latest.correct_count}/${latest.total_count} (${latest.score}점), 최고 ${bestScore}점 · ${setAttempts.length}회`,
    });
  }

  return sections.sort((a, b) => a.setTitle.localeCompare(b.setTitle, "ko"));
}
