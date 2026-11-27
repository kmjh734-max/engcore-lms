/**
 * 저장이 끝난 뒤 한 번 더 훑는다 — 마지막 그물.
 *
 * 선생님 말씀(2026-10-01): 「강사가 매번 어떻게 확인하느냐, 그게 무슨 프로그램이냐」.
 * 맞는 말이다. 사람이 보는 일이 없어야 한다.
 *
 * 문항을 만들 때도 검수가 걸려 있고, 걸린 것은 저장하지 않고 버린다. 그래도 이 그물을
 * 하나 더 두는 까닭은 세 가지다.
 *  1. 검수를 지난 뒤에 손질하는 자리가 있다(기호 다시 매기기·해설 맞추기 등).
 *     그때 흠이 생기면 만들 때는 못 잡는다.
 *  2. 앞으로 저장하는 길이 늘었을 때 검수를 빠뜨려도 여기서 걸린다.
 *  3. 걸러 낸 수를 작업에 남겨 두면 무엇이 빠졌는지 보인다.
 *
 * 모델을 부르지 않는다 — 값이 들지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pageRows } from "@/lib/supabase/fetch-all-rows";
import {
  shouldRegenerate,
  validateGeneratedQuestion,
} from "@/lib/question-generator/validate-question";
import { QUESTION_TYPE_GROUPS } from "@/lib/question-generator/question-types";
import type { GeneratedQuestionPayload } from "@/lib/question-generator/types";

const OPTION_BY_KEY = new Map(
  QUESTION_TYPE_GROUPS.flatMap((g) => g.options).map((o) => [o.key, o])
);

/**
 * 작업에 저장된 문항을 다시 검수해, 걸린 것은 지운다.
 * 돌려주는 값은 지운 문항의 까닭(없으면 빈 배열).
 */
export async function sweepSavedQuestions(
  admin: SupabaseClient,
  jobId: string,
  allowParaphrase: boolean
): Promise<string[]> {
  // 1000문항 넘는 작업도 끝까지 본다(전에는 앞 1000문항만 점검)
  const { data } = await pageRows((from, to) =>
    admin
      .from("generated_english_questions")
      .select(
        "id, passage_id, option_key, instruction, question_text, passage_original, passage_modified, choices, correct_answer, explanation"
      )
      .eq("generation_job_id", jobId)
      .order("created_at")
      .order("id")
      .range(from, to)
  );
  if (!data?.length) return [];

  const badIds: string[] = [];
  const reasons: string[] = [];
  /*
   * 같은 지문·같은 유형으로 둘을 청하면 모델이 똑같은 문항을 둘 내놓는 일이 있다
   * (382문항 대조 2026-10-02: 지칭·특정표현이 짝마다 글자까지 같았다). 하나만 남긴다.
   */
  const seenSame = new Set<string>();
  for (const row of data) {
    const option = OPTION_BY_KEY.get(String(row.option_key));
    /*
     * 보기와 발문까지 넣어 견준다. 처음에는 묻는 글·본문·정답만 넣었는데, 내용일치는 묻는 글도
     * 본문도 비어 있어 정답 번호만 같으면 「똑같다」고 보고 멀쩡한 문항을 지웠다
     * (2026-10-03 새벽 작업에서 18개, 그 앞 작업에서 9개).
     */
    const sameKey = [
      String(row.passage_id ?? ""),
      String(row.option_key ?? ""),
      String(row.instruction ?? "").replace(/\s+/g, " ").trim(),
      String(row.question_text ?? "").replace(/\s+/g, " ").trim(),
      String(row.passage_modified ?? "").replace(/\s+/g, " ").trim(),
      JSON.stringify(row.choices ?? null),
      JSON.stringify(row.correct_answer ?? ""),
    ].join("\u0001");
    if (seenSame.has(sameKey)) {
      badIds.push(String(row.id));
      reasons.push(`[${option?.label ?? row.option_key}] 똑같은 문항이 둘이라 하나를 지웠습니다`);
      continue;
    }
    seenSame.add(sameKey);
  }
  for (const row of data) {
    if (badIds.includes(String(row.id))) continue;
    const option = OPTION_BY_KEY.get(String(row.option_key));
    if (!option) continue;
    const question = {
      type: option.type,
      instruction: String(row.instruction ?? ""),
      questionText: String(row.question_text ?? ""),
      passageOriginal: String(row.passage_original ?? ""),
      passageModified: String(row.passage_modified ?? ""),
      choices: (row.choices as GeneratedQuestionPayload["choices"]) ?? undefined,
      correctAnswer: row.correct_answer as GeneratedQuestionPayload["correctAnswer"],
      explanation: String(row.explanation ?? ""),
    } as GeneratedQuestionPayload;

    let v;
    try {
      v = validateGeneratedQuestion({
        passage: String(row.passage_original ?? ""),
        option,
        question,
        allowParaphrase,
      });
    } catch {
      // 검수기가 터지면 문항을 지우지 않는다 — 멀쩡한 것을 잃는 쪽이 더 나쁘다
      continue;
    }
    if (!shouldRegenerate(v)) continue;
    badIds.push(String(row.id));
    reasons.push(`[${option.label}] ${v.warnings[0] ?? "형태 검수 미달"}`);
  }

  if (badIds.length === 0) return [];
  // 한 번에 100개씩 지운다
  for (let i = 0; i < badIds.length; i += 100) {
    await admin
      .from("generated_english_questions")
      .delete()
      .in("id", badIds.slice(i, i + 100));
  }
  return reasons;
}
