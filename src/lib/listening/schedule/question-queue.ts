import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, fetchAllRowsSoft } from "@/lib/supabase/fetch-all-rows";
import type {
  DailyTaskSlice,
  QuestionQueueItem,
} from "@/lib/listening/schedule/types";

/** "고1 3회", "1회차" → 3, 1. 없으면 null */
export function parseListeningSetRound(title: string): number | null {
  const match = title.match(/(\d+)\s*회/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function sortSetIdsByRound(
  setIds: string[],
  titleById: Map<string, string> | Record<string, string>
): string[] {
  const titleOf = (id: string) =>
    titleById instanceof Map ? (titleById.get(id) ?? "") : (titleById[id] ?? "");
  return setIds
    .map((id, index) => ({
      id,
      index,
      round: parseListeningSetRound(titleOf(id)),
    }))
    .sort((a, b) => {
      if (a.round != null && b.round != null && a.round !== b.round) {
        return a.round - b.round;
      }
      if (a.round != null && b.round == null) return -1;
      if (a.round == null && b.round != null) return 1;
      return a.index - b.index;
    })
    .map((row) => row.id);
}

export async function buildQuestionQueueForAssignment(
  admin: SupabaseClient,
  assignmentId: string
): Promise<QuestionQueueItem[]> {
  const { data: setRows } = await admin
    .from("listening_schedule_assignment_sets")
    .select("set_id, order_index, set:listening_sets(title)")
    .eq("assignment_id", assignmentId)
    .order("order_index", { ascending: true });

  if (!setRows?.length) return [];

  const titleById = new Map<string, string>();
  const orderedIds: string[] = [];
  for (const row of setRows) {
    const setId = row.set_id as string;
    orderedIds.push(setId);
    const set = row.set as { title?: string } | { title?: string }[] | null;
    const title = Array.isArray(set)
      ? (set[0]?.title ?? "")
      : (set?.title ?? "");
    titleById.set(setId, title);
  }
  const setIds = sortSetIdsByRound(orderedIds, titleById);

  // 세트가 많으면(17문항 × 59세트 이상) 1000행을 넘어 뒷번호 문항이 빠졌다 — 끝까지 읽는다
  const questions = (
    await Promise.all(
      chunkIds(setIds, 80).map((chunk) =>
        fetchAllRowsSoft<{ id: string; order_index: number; set_id: string }>(
          (from, to) =>
            admin
              .from("listening_questions")
              .select("id, order_index, set_id")
              .in("set_id", chunk)
              .order("order_index", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
        )
      )
    )
  ).flat();

  const bySet = new Map<string, QuestionQueueItem[]>();
  for (const q of questions) {
    const setId = q.set_id as string;
    const list = bySet.get(setId) ?? [];
    list.push({
      setId,
      questionId: q.id as string,
      orderIndex: q.order_index as number,
    });
    bySet.set(setId, list);
  }

  const queue: QuestionQueueItem[] = [];
  for (const setId of setIds) {
    const items = bySet.get(setId) ?? [];
    items.sort((a, b) => a.orderIndex - b.orderIndex);
    queue.push(...items);
  }

  return queue;
}

/**
 * 하루 분량을 세트(회차) 경계에서 자른다.
 * `index * N` 방식은 17문항 세트가 3문항/일이면 6일차에 다음 회 1번을 끌어와
 * 다음 회가 2번부터 시작하고, 빠진 1번이 나중에 다시 섞여 나온다.
 */
export function buildPackedDailySlices(
  queue: QuestionQueueItem[],
  questionsPerDay: number
): DailyTaskSlice[] {
  const perDay = Math.max(1, Math.floor(questionsPerDay) || 1);
  const slices: DailyTaskSlice[] = [];
  let i = 0;
  while (i < queue.length) {
    const setId = queue[i]!.setId;
    const questionIds: string[] = [];
    while (
      questionIds.length < perDay &&
      i < queue.length &&
      queue[i]!.setId === setId
    ) {
      questionIds.push(queue[i]!.questionId);
      i += 1;
    }
    if (questionIds.length > 0) {
      slices.push({ setId, questionIds });
    }
  }
  return slices;
}

export function sliceQuestionsForStudyDay(
  queue: QuestionQueueItem[],
  studyDayIndex: number,
  questionsPerDay: number
): DailyTaskSlice | null {
  if (studyDayIndex < 0 || queue.length === 0) return null;
  const slices = buildPackedDailySlices(queue, questionsPerDay);
  return slices[studyDayIndex] ?? null;
}

/**
 * 1회→20회 큐에서, 이미 나온(또는 푼) 마지막 문항 다음부터만 남긴다.
 * 빠진 앞번호로 돌아가지 않고, 푼 문항은 다시 넣지 않는다.
 */
export function remainingQueueAfterConsumed(
  queue: QuestionQueueItem[],
  consumed: Set<string>
): QuestionQueueItem[] {
  if (consumed.size === 0) return queue;
  let lastIdx = -1;
  for (let i = 0; i < queue.length; i++) {
    if (consumed.has(queue[i]!.questionId)) lastIdx = i;
  }
  return queue
    .slice(lastIdx + 1)
    .filter((q) => !consumed.has(q.questionId));
}

export function buildLeftoverDailySlices(
  queue: QuestionQueueItem[],
  consumed: Set<string>,
  questionsPerDay: number
): DailyTaskSlice[] {
  return buildPackedDailySlices(
    remainingQueueAfterConsumed(queue, consumed),
    questionsPerDay
  );
}
