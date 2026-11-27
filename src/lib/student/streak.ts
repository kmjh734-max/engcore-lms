import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

/**
 * 학생이 며칠 연속으로 공부했는지(학생 홈의 동기부여 카드).
 * 단어(뜻 익히기·스펠링·예문·종합테스트)·듣기(시험·받아쓰기)·영상 기록 중 하나라도 있으면 그날 공부한 것으로 본다.
 * 오늘 아직 안 했으면 어제까지 이어진 기록을 보여 준다(오늘 하면 이어진다).
 */
export type StudentStreak = {
  streak: number;
  studiedToday: boolean;
  best: number;
  /** 이번 주 월~일 */
  week: Array<{ iso: string; label: string; studied: boolean; isToday: boolean; future: boolean }>;
};

const kstDay = (d: Date | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(typeof d === "string" ? new Date(d) : d);

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function loadStudentStreak(studentId: string): Promise<StudentStreak> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 70 * 86400000).toISOString();
  const pick = async (table: string, col: string) => {
    // 서버는 한 번에 1,000줄까지 — 70일치를 끝까지 넘겨 읽는다
    const data = await fetchAllRows<unknown>((from, to) =>
      admin.from(table).select(col).eq("student_id", studentId).gte(col, since).order(col).range(from, to)
    ).catch(() => [] as unknown[]);
    return (data as unknown as Array<Record<string, string | null>>).map((r) => r[col]).filter(Boolean) as string[];
  };
  const stamps = (
    await Promise.all([
      pick("vocab_progress", "last_studied_at"),
      pick("vocab_spelling_attempts", "created_at"),
      pick("vocab_example_attempts", "created_at"),
      pick("vocab_final_test_attempts", "submitted_at"),
      pick("listening_exam_attempts", "submitted_at"),
      pick("listening_dictation_attempts", "submitted_at"),
      pick("lesson_progress", "last_watched_at"),
    ])
  ).flat();
  const days = new Set(stamps.map((s) => kstDay(s)));

  const today = kstDay(new Date());
  const studiedToday = days.has(today);
  let streak = 0;
  for (let d = studiedToday ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;

  // 70일 안의 가장 긴 연속 기록
  let best = 0;
  let run = 0;
  for (let i = 69; i >= 0; i--) {
    const d = addDays(today, -i);
    run = days.has(d) ? run + 1 : 0;
    best = Math.max(best, run);
  }

  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const labels = ["월", "화", "수", "목", "금", "토", "일"];
  const week = labels.map((label, i) => {
    const iso = addDays(monday, i);
    return { iso, label, studied: days.has(iso), isToday: iso === today, future: iso > today };
  });

  return { streak, studiedToday, best, week };
}
