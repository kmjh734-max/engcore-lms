import type { SupabaseClient } from "@supabase/supabase-js";
import { judgeReviewAnswer, type ReviewStage } from "@/lib/vocab/review-judge";

/**
 * 단어 복습: 틀린 단어를 모아 날짜를 띄워 가며 다시 낸다.
 * 선생님 기준(2026-09-20): 학생이 푼 모든 단어장에서 모으고, 졸업할 때까지 계속 낸다.
 * 하루에 나오는 양은 묶는다 — 밀린 학생이 100개를 보고 아예 안 하게 되는 것을 막는다.
 */
export type { ReviewStage };

/** 맞힌 뒤 다음 복습까지 걸리는 날 수 */
const BOX_DAYS = [1, 3, 7, 14];
/** 연속 이만큼 맞히면 졸업 */
const GRADUATE_STREAK = 2;
/** 하루에 내보낼 최대 개수 */
export const DAILY_REVIEW_LIMIT = 20;

/**
 * 한국 날짜로 n일 뒤 0시. 「내일 다시 나와요」가 정말 내일 나오게 —
 * 전에는 지금 시각 + 24시간이라 밤 9시에 틀리면 다음 날 저녁엔 아직 안 나오고 하루가 밀렸다.
 */
const dayAfter = (days: number) => {
  const kst = new Date(Date.now() + 9 * 3_600_000); // 한국 시각을 UTC 칸에 놓고 날짜만 쓴다
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate() + days;
  return new Date(Date.UTC(y, m, d) - 9 * 3_600_000).toISOString();
};

export type ReviewCard = {
  id: string;
  itemId: string;
  setId: string | null;
  stage: ReviewStage;
  word: string;
  meaning: string;
  exampleSentence: string | null;
  exampleMeaning: string | null;
  wrongCount: number;
};

/** 틀린 단어를 복습 목록에 넣는다(이미 있으면 처음부터 다시). */
export async function recordVocabWrong(
  admin: SupabaseClient,
  studentId: string,
  rows: Array<{ itemId: string; setId: string | null; stage: ReviewStage }>
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  /*
   * 한 묶음에 같은 단어가 두 번 들어오면(한 회차에 두 번 틀림) 같은 줄을 두 개 넣게 되어
   * unique (student_id, item_id, stage)에 걸리고, 그러면 그 묶음이 통째로 저장되지 않는다.
   * 먼저 추린다 — 틀린 횟수는 아래에서 이미 있는 줄에 더해 준다.
   */
  const once = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.itemId) once.set(`${r.itemId}|${r.stage}`, r);
  }
  const payload = [...once.values()].map((r) => ({
    student_id: studentId,
    item_id: r.itemId,
    set_id: r.setId,
    stage: r.stage,
    wrong_count: 1,
    correct_streak: 0,
    box: 0,
    due_at: dayAfter(1),
    graduated_at: null,
    last_result_at: now,
  }));
  // 이미 있는 단어는 틀린 횟수만 올리고 처음 칸으로 내린다
  const { data: existing } = await admin
    .from("vocab_review_items")
    .select("id, student_id, item_id, stage, wrong_count")
    .eq("student_id", studentId)
    .in("item_id", payload.map((r) => r.item_id));
  const seen = new Map(
    (existing ?? []).map((e) => [`${e.item_id}|${e.stage}`, e as { id: string; wrong_count: number }])
  );
  const fresh = payload.filter((p) => !seen.has(`${p.item_id}|${p.stage}`));
  if (fresh.length > 0) {
    // 동시에 온 다른 요청이 같은 단어를 먼저 넣었으면 그 줄만 건너뛰고 나머지는 넣는다
    // (전에는 insert 하나가 겹쳐 묶음 전체가 빠졌다)
    await admin
      .from("vocab_review_items")
      .upsert(fresh, { onConflict: "student_id,item_id,stage", ignoreDuplicates: true });
  }
  await Promise.all(
    payload
      .map((p) => ({ p, hit: seen.get(`${p.item_id}|${p.stage}`) }))
      .filter((x) => x.hit)
      .map((x) =>
        admin
          .from("vocab_review_items")
          .update({
            wrong_count: (x.hit!.wrong_count ?? 0) + 1,
            correct_streak: 0,
            box: 0,
            due_at: dayAfter(1),
            graduated_at: null,
            last_result_at: now,
          })
          .eq("id", x.hit!.id)
      )
  );
}

/**
 * 복습 답을 받아 채점하고 기록한다.
 *
 * 채점은 서버에서 한다 — 학생 화면은 바로 알려 주려고 같은 식을 한 번 더 돌릴 뿐이고,
 * 목록에 남는 정답 여부는 여기서 매긴 것이다(다른 단어학습 단계와 같은 기준).
 * 맞히면 한 칸 올리고, 연속 2회면 졸업시킨다.
 */
export async function recordReviewResult(
  admin: SupabaseClient,
  studentId: string,
  answers: Array<{ reviewId: string; answer: string }>
): Promise<{ graduated: number; results: Array<{ reviewId: string; correct: boolean }> }> {
  if (answers.length === 0) return { graduated: 0, results: [] };
  const { data: rows } = await admin
    .from("vocab_review_items")
    .select("id, item_id, stage, correct_streak, box, wrong_count")
    .eq("student_id", studentId)
    .in("id", answers.map((r) => r.reviewId));
  const list = rows ?? [];
  if (list.length === 0) return { graduated: 0, results: [] };

  const { data: items } = await admin
    .from("vocab_items")
    .select("id, word, meaning")
    .in("id", [...new Set(list.map((r) => r.item_id as string))]);
  const byItem = new Map((items ?? []).map((i) => [i.id as string, i]));
  const byId = new Map(list.map((r) => [r.id as string, r]));

  const now = new Date().toISOString();
  const results: Array<{ reviewId: string; correct: boolean }> = [];
  let graduated = 0;

  await Promise.all(
    answers.map((a) => {
      const row = byId.get(a.reviewId);
      if (!row) return Promise.resolve();
      const item = byItem.get(row.item_id as string);
      const correct = item
        ? judgeReviewAnswer(
            row.stage as ReviewStage,
            String(item.word ?? ""),
            String(item.meaning ?? ""),
            a.answer
          )
        : false;
      results.push({ reviewId: a.reviewId, correct });

      if (!correct) {
        return admin
          .from("vocab_review_items")
          .update({
            correct_streak: 0,
            box: 0,
            wrong_count: (row.wrong_count as number) + 1,
            due_at: dayAfter(1),
            last_result_at: now,
          })
          .eq("id", a.reviewId);
      }
      const streak = (row.correct_streak as number) + 1;
      if (streak >= GRADUATE_STREAK) {
        graduated++;
        return admin
          .from("vocab_review_items")
          .update({ correct_streak: streak, graduated_at: now, last_result_at: now })
          .eq("id", a.reviewId);
      }
      const box = Math.min((row.box as number) + 1, BOX_DAYS.length - 1);
      return admin
        .from("vocab_review_items")
        .update({ correct_streak: streak, box, due_at: dayAfter(BOX_DAYS[box]!), last_result_at: now })
        .eq("id", a.reviewId);
    })
  );
  return { graduated, results };
}

/** 오늘 복습할 단어 (많이 틀린 것부터, 하루 상한까지) */
export async function loadDueReview(
  admin: SupabaseClient,
  studentId: string,
  limit = DAILY_REVIEW_LIMIT
): Promise<ReviewCard[]> {
  const { data: rows } = await admin
    .from("vocab_review_items")
    .select("id, item_id, set_id, stage, wrong_count, due_at")
    .eq("student_id", studentId)
    .is("graduated_at", null)
    .lte("due_at", new Date().toISOString())
    .order("wrong_count", { ascending: false })
    .order("due_at")
    .limit(limit * 2);
  const list = rows ?? [];
  if (list.length === 0) return [];

  const [{ data: items }, { data: excluded }] = await Promise.all([
    admin
      .from("vocab_items")
      .select("id, word, meaning, example_sentence, example_meaning")
      .in("id", list.map((r) => r.item_id as string)),
    admin
      .from("vocab_sets")
      .select("id")
      .in("id", [...new Set(list.map((r) => r.set_id).filter(Boolean))] as string[])
      .eq("review_excluded", true),
  ]);
  const byItem = new Map((items ?? []).map((i) => [i.id as string, i]));
  const skip = new Set((excluded ?? []).map((s) => s.id as string));

  return list
    .filter((r) => byItem.has(r.item_id as string) && !(r.set_id && skip.has(r.set_id as string)))
    .slice(0, limit)
    .map((r) => {
      const item = byItem.get(r.item_id as string)!;
      return {
        id: r.id as string,
        itemId: r.item_id as string,
        setId: (r.set_id as string | null) ?? null,
        stage: r.stage as ReviewStage,
        word: String(item.word ?? ""),
        meaning: String(item.meaning ?? ""),
        exampleSentence: (item.example_sentence as string | null) ?? null,
        exampleMeaning: (item.example_meaning as string | null) ?? null,
        wrongCount: Number(r.wrong_count ?? 1),
      };
    });
}

/** 학생 화면 카드용: 오늘 복습할 개수와 모아 둔 전체 개수 */
export async function loadReviewCounts(
  admin: SupabaseClient,
  studentId: string
): Promise<{ due: number; total: number; graduated: number }> {
  const now = new Date().toISOString();
  const [due, total, graduated] = await Promise.all([
    admin
      .from("vocab_review_items")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .is("graduated_at", null)
      .lte("due_at", now),
    admin
      .from("vocab_review_items")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .is("graduated_at", null),
    admin
      .from("vocab_review_items")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .not("graduated_at", "is", null),
  ]);
  return {
    due: Math.min(due.count ?? 0, DAILY_REVIEW_LIMIT),
    total: total.count ?? 0,
    graduated: graduated.count ?? 0,
  };
}
