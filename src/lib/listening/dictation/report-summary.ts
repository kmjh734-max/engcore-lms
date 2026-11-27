import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import type { DictationBlankItem } from "@/lib/listening/dictation/types";
import { normalizeDictationText } from "@/lib/listening/dictation/normalize-text";
import { loadStudentListeningSetIdsForReport } from "@/lib/listening/schedule/report-summary";
import {
  getReportRangeBounds,
  isIsoInReportRange,
} from "@/lib/reports/date-range";
import type { ReportRange } from "@/lib/reports/types";

export interface ListeningDictationReportSection {
  setId: string;
  setTitle: string;
  questionCount: number;
  passedQuestionCount: number;
  averageBestScore: number | null;
  totalAttempts: number;
  frequentWrongWords: string[];
  summaryLine: string;
  questionRows: Array<{
    orderIndex: number;
    questionType: string;
    bestScore: number | null;
    attemptCount: number;
    passed: boolean;
  }>;
}

export async function buildListeningDictationReport(
  supabase: SupabaseClient,
  studentId: string,
  range: ReportRange = "all"
): Promise<ListeningDictationReportSection[]> {
  const setIds = await loadStudentListeningSetIdsForReport(supabase, studentId);
  if (setIds.length === 0) return [];

  const bounds = getReportRangeBounds(range);

  const { data: sets } = await supabase
    .from("listening_sets")
    .select("id, title, dictation_enabled")
    .in("id", setIds);

  // 학생 한 명이라도 받아쓰기 기록은 수천 행이 된다 — 끝까지 읽는다
  const attempts = (
    await Promise.all(
      chunkIds(setIds, 80).map((chunk) =>
        fetchAllRowsSoft<Record<string, unknown>>((from, to) =>
          supabase
            .from("listening_dictation_attempts")
            .select(
              "set_id, question_id, score, passed, attempt_no, submitted_at, blank_items, student_answers"
            )
            .eq("student_id", studentId)
            .in("set_id", chunk)
            .not("submitted_at", "is", null)
            .order("id")
            .range(from, to)
        )
      )
    )
  ).flat();

  const attemptsInRange = attempts.filter((a) =>
    range === "all"
      ? true
      : isIsoInReportRange(a.submitted_at as string, bounds)
  );

  const questions = (
    await Promise.all(
      chunkIds(setIds, 80).map((chunk) =>
        fetchAllRowsSoft<Record<string, unknown>>((from, to) =>
          supabase
            .from("listening_questions")
            .select("id, set_id, order_index, question_type")
            .in("set_id", chunk)
            .order("id")
            .range(from, to)
        )
      )
    )
  ).flat();

  const sections: ListeningDictationReportSection[] = [];

  for (const set of sets ?? []) {
    const setId = set.id as string;
    const setAttempts = attemptsInRange.filter((a) => a.set_id === setId);
    if (setAttempts.length === 0) continue;

    const setQuestions = questions.filter((q) => q.set_id === setId);

    const wrongWords: string[] = [];
    const byQuestion = new Map<
      string,
      { best: number | null; attempts: number; passed: boolean }
    >();

    for (const q of setQuestions) {
      byQuestion.set(q.id as string, { best: null, attempts: 0, passed: false });
    }

    for (const att of setAttempts) {
      const qid = att.question_id as string;
      let row = byQuestion.get(qid);
      if (!row) {
        row = { best: null, attempts: 0, passed: false };
        byQuestion.set(qid, row);
      }
      row.attempts += 1;
      const sc = att.score as number | null;
      if (sc != null) {
        row.best = row.best == null ? sc : Math.max(row.best, sc);
      }
      if (att.passed) row.passed = true;

      const items = (att.blank_items ?? []) as DictationBlankItem[];
      const ans = (att.student_answers ?? {}) as Record<string, string>;
      for (const item of items) {
        const student = normalizeDictationText(ans[item.id] ?? "");
        const correct = normalizeDictationText(item.answer);
        if (student && student !== correct) {
          wrongWords.push(item.answer);
        }
      }
    }

    const questionRows = (
      setQuestions.length > 0
        ? setQuestions
        : [...byQuestion.keys()].map((id) => ({
            id,
            set_id: setId,
            order_index: 0,
            question_type: "",
          }))
    )
      .map((q) => {
        const meta = byQuestion.get(q.id as string) ?? {
          best: null,
          attempts: 0,
          passed: false,
        };
        return {
          orderIndex: (q.order_index as number) ?? 0,
          questionType: (q.question_type as string) ?? "",
          bestScore: meta.best,
          attemptCount: meta.attempts,
          passed: meta.passed,
        };
      })
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const passedCount = questionRows.filter((r) => r.passed).length;
    const questionCount =
      setQuestions.length > 0 ? setQuestions.length : questionRows.length;
    const scores = questionRows
      .map((r) => r.bestScore)
      .filter((s): s is number => s != null);
    const avg =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    const freq = [...wrongWords].reduce((map, w) => {
      map.set(w, (map.get(w) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const frequentWrongWords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    let summaryLine = `Dictation ${setAttempts.length}회 제출`;
    if (avg != null && avg >= 85) {
      summaryLine =
        "듣기 후 Dictation 단계에서 핵심 단어 청취 정확도가 높았습니다.";
    } else if (frequentWrongWords.length > 0) {
      summaryLine = `${frequentWrongWords.slice(0, 4).join(", ")} 관련 핵심어에서 오답이 반복되어 복습이 필요합니다.`;
    } else if (avg != null) {
      summaryLine = `평균 Dictation 점수는 ${avg}점이며, ${passedCount}/${questionCount}문항을 통과했습니다.`;
    }

    sections.push({
      setId,
      setTitle: set.title as string,
      questionCount,
      passedQuestionCount: passedCount,
      averageBestScore: avg,
      totalAttempts: setAttempts.length,
      frequentWrongWords,
      summaryLine,
      questionRows,
    });
  }

  return sections.sort((a, b) => a.setTitle.localeCompare(b.setTitle, "ko"));
}
