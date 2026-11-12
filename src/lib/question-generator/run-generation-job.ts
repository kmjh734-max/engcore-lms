import { createAdminClient } from "@/lib/supabase/admin";
import { sweepSavedQuestions } from "@/lib/question-generator/final-sweep";
import { aiReviewEnabled, reviewGeneratedQuestion } from "@/lib/question-generator/ai-review";
import {
  blindSolvable,
  blindSolveEnabled,
  blindSolveQuestion,
  blankChoicesCheckable,
  verifyBlankChoices,
  checkSubjectiveQuestion,
  PER_CHOICE_TYPES,
  verifyChoicesIndependently,
  rewriteRareWords,
  subjectiveCheckable,
} from "@/lib/question-generator/blind-solve";
import { fixCircledParticles } from "@/lib/question-generator/circled-particles";
import { dedupEnabled, dupSignature, isNearDuplicate, type DupSignature } from "@/lib/question-generator/near-duplicate";
import { CHART_UNFIT_TYPES, cleanSourcePassage, isChartDescriptionPassage } from "@/lib/question-generator/passage-clean";
import { withAiUsage } from "@/lib/ai-usage/context";
import { currentAiUsage } from "@/lib/ai-usage/record";
import {
  isGrammarBillingType,
  isWritingBillingType,
} from "@/lib/question-generator/billing-buckets";
import type { TargetLevel } from "@/lib/question-generator/difficulty";
import { analyzePassage } from "@/lib/question-generator/analyze-passage";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { usageWon } from "@/lib/ai-usage/model-price";
import {
  GENERATION_CONCURRENCY,
  MAX_REGENERATION_ATTEMPTS,
  MAX_SETS_PER_TYPE,
  MIN_SENTENCES_FOR_INSERTION_IRRELEVANT,
} from "@/lib/question-generator/constants";
import { syncExamVocabSetFromJob, diversifyJobHardWords } from "@/lib/question-generator/exam-vocab";
import { generateOneQuestion, SkipQuestionError } from "@/lib/question-generator/generate-question";
import { openAiUnderPressure } from "@/lib/question-generator/openai";
import { CREDIT_FEATURES } from "@/lib/credits";
import { debitLessonCredits } from "@/lib/credits/lesson-credits";
import { resolvePassages } from "@/lib/question-generator/passages";
import {
  expandCountRequests,
  findOptionByKey,
  sanitizeCounts,
} from "@/lib/question-generator/question-types";
import {
  shouldRegenerate,
  validateGeneratedQuestion,
} from "@/lib/question-generator/validate-question";
import { countEnglishSentences } from "@/lib/question-generator/text-utils";
import { isSetMarkKey, setFallbackAllowed, setKeysForPassage } from "@/lib/question-generator/passage-set";
import { setNoteFor, sharedPassageOf } from "@/lib/question-generator/passage-set-check";
import { markedSentences, mergeMarkedPassages } from "@/lib/question-generator/passage-set-merge";
import type {
  GenerationRequestConfig,
  GeneratedQuestionPayload,
  PassageAnalysis,
  QuestionTypeOption,
} from "@/lib/question-generator/types";

async function updateJob(
  jobId: string,
  patch: Record<string, unknown>
) {
  const admin = createAdminClient();
  await admin.from("question_generation_jobs").update(patch).eq("id", jobId);
}

function createProgressThrottler(minIntervalMs = 350) {
  let lastAt = 0;
  return async (
    jobId: string,
    patch: Record<string, unknown>,
    force = false
  ) => {
    const now = Date.now();
    if (!force && now - lastAt < minIntervalMs) return;
    lastAt = now;
    await updateJob(jobId, patch);
  };
}

/**
 * 모든 학원의 생성 작업이 함께 쓰는 동시 호출 몫. OpenAI 키 하나를 같이 쓰므로, 작업이
 * 여럿 돌면 이 몫을 나눠 쓴다(혼자면 GENERATION_CONCURRENCY까지). 120개는 gpt-5.5 분당
 * 토큰 한도의 절반쯤이라 분석서·워크북 같은 다른 기능이 쓸 자리가 남는다.
 */
const GLOBAL_CALL_BUDGET = 120;
/** 작업이 아무리 많아도 한 작업에 보장하는 동시 호출 수. */
const MIN_JOB_CONCURRENCY = 4;
/** 지금 돌고 있는 작업 수를 다시 세는 간격. */
const SHARE_REFRESH_MS = 20_000;

/** 지금 실행 중인(끊기지 않은) 생성 작업 수. 자기 자신을 포함한다. */
async function countRunningJobs(selfId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("question_generation_jobs")
    .select("id, _run:request_config->_run")
    .in("status", [...HELD_STATUSES, "pending"]);
  const now = Date.now();
  let n = 1;
  for (const row of (data ?? []) as Array<{ id: string; _run: { claimedAt?: string } | null }>) {
    if (row.id === selfId) continue;
    const at = Date.parse(row._run?.claimedAt ?? "");
    // 실행 기록이 없는 pending(아직 시작 전·복사만 한 작업)과 끊긴 작업은 세지 않는다.
    if (Number.isFinite(at) && now - at < RUNNER_MAX_LIFETIME_MS) n += 1;
  }
  return n;
}

/** 값 받는 갈래는 billing-buckets 한곳에서 정한다(확인 창도 같은 것을 쓴다) */
const isGrammarType = isGrammarBillingType;
const isWritingType = isWritingBillingType;

/**
 * items를 동시에 limit()개까지 처리한다. limit은 처리 중에도 바뀔 수 있다(다른 작업이
 * 시작되거나 한도가 빠듯해지면 줄고, 풀리면 는다). fn이 던지면 전체가 실패한다.
 */
export function runAdaptivePool<T>(
  items: T[],
  limit: () => number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    let next = 0;
    let inFlight = 0;
    let failed = false;
    const pump = () => {
      if (failed) return;
      while (inFlight < Math.max(1, limit()) && next < items.length) {
        const item = items[next++]!;
        inFlight += 1;
        fn(item).then(
          () => {
            inFlight -= 1;
            pump();
          },
          (e) => {
            failed = true;
            clearInterval(timer);
            reject(e);
          }
        );
      }
      if (next >= items.length && inFlight === 0) {
        clearInterval(timer);
        resolve();
      }
    };
    // 끝나는 문항이 없어도 몫이 늘어나면 새로 시작하도록 가끔 다시 본다.
    const timer = setInterval(pump, 2_000);
    pump();
  });
}

function toRow(
  payload: GeneratedQuestionPayload,
  opts: {
    passageId: string;
    jobId: string;
    option: QuestionTypeOption;
    userId: string;
    academyId: string;
    attempt: number;
    status: string;
    validationScore: number | null;
    errorMessage?: string | null;
    slot?: { index: number; itemNo: string; points: number | null; level: string | null } | null;
    /** 고른 유형으로 안 되어 다른 유형으로 바꿔 만들었을 때, 원래 고른 유형의 이름 */
    substitutedFrom?: string | null;
    /** 그 유형으로 안 된 까닭 (어느 검수에 걸렸는지) */
    substitutedReason?: string | null;
    /** 원래 고른 유형의 키 — 이어 받을 때 이 칸을 이미 채운 것으로 센다 */
    substitutedFromKey?: string | null;
    /** 1지문 다문항: 시험지 차례(지문 차례 × 세트 크기 + 세트 안 차례) */
    setSlotIndex?: number | null;
  }
) {
  const approved = opts.status === "approved";
  return {
    ...(typeof opts.setSlotIndex === "number" ? { slot_index: opts.setSlotIndex } : {}),
    ...(opts.slot
      ? {
          slot_index: opts.slot.index,
          item_no: opts.slot.itemNo,
          points: opts.slot.points,
          target_level: opts.slot.level,
        }
      : {}),
    passage_id: opts.passageId,
    generation_job_id: opts.jobId,
    option_key: opts.option.key,
    category: payload.category,
    question_type: payload.type,
    difficulty: payload.difficulty,
    choice_language: payload.choiceLanguage,
    passage_original: payload.passageOriginal,
    passage_modified: payload.passageModified ?? null,
    instruction: payload.instruction,
    question_text: payload.questionText,
    choices: payload.choices ?? null,
    correct_answer: payload.correctAnswer,
    acceptable_answers: payload.acceptableAnswers ?? null,
    // 번호 뒤 조사를 읽는 소리에 맞춘다(①는 → ①은)
    explanation: fixCircledParticles(payload.explanation),
    hard_words: payload.hardWords ?? [],
    evidence: payload.evidence ?? [],
    scoring_guide: payload.scoringGuide ?? null,
    /*
     * 선생님 지적(2026-10-01): 대체는 조용히 일어나면 안 된다. 어법을 골랐는데
     * 주제추론이 섞여 나오면 선생님이 당황한다. 바꿔 만든 것은 자취를 남긴다.
     */
    validation_result: opts.substitutedFrom
      ? {
          ...(payload.validation ?? {}),
          substitutedFrom: opts.substitutedFrom,
          substitutedReason: opts.substitutedReason ?? null,
          substitutedFromKey: opts.substitutedFromKey ?? null,
        }
      : payload.validation ?? null,
    validation_score: opts.validationScore,
    status: opts.status,
    generation_attempt: opts.attempt,
    error_message: opts.errorMessage ?? null,
    created_by: opts.userId,
    academy_id: opts.academyId,
    approved_by: approved ? opts.userId : null,
    approved_at: approved ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

async function generateWithValidation(opts: {
  passage: string;
  analysis: PassageAnalysis;
  option: QuestionTypeOption;
  grade: string;
  overallDifficulty: string;
  levelBrief?: string;
  grammarScope?: string[];
  grammarWritingMode?: "passage" | "paraphrase";
  /** 제시어 배열을 지문 그대로 낼지 (기본: 지문 그대로) */
  wordOrderMode?: "passage" | "paraphrase";
  sourceDetail?: string;
  diversitySlot?: { index: number; total: number; label: string };
  /** 같은 유형이 작업 전체에서 몇 번째인가(0부터) */
  typeTurn?: number;
  targetLevel?: TargetLevel | null;
  /** 어법·어휘에서 지문을 바꿔 써도 되는지(기본은 원문 그대로) */
  paraphraseGrammarVocab?: boolean;
  /** 같은 지문·같은 유형의 몇 번째 사본인가 */
  copyIndex?: number;
  /** 다시 만들기 횟수(설계도 칸은 빈자리가 없게 더 시도한다) */
  retries?: number;
  /** 지금 어느 단계인지 알린다 — 진행 문구에 「검수 중」 등을 띄운다 */
  onStage?: (stage: QgStage) => void;
  /** 같은 지문의 다른 문항과 겹치면 까닭(다음 시도에 넘길 메모), 아니면 null */
  duplicateNote?: (payload: GeneratedQuestionPayload) => string | null;
  /** 1지문 다문항: 같은 지문을 함께 쓰는 다른 문항 이야기 */
  setNote?: string;
}): Promise<{
  payload: GeneratedQuestionPayload | null;
  status: "approved";
  /** 뜻을 읽는 검수가 버려서 다시 만든 횟수 */
  reviewDropped?: number;
  attempt: number;
  error: string | null;
  skipped?: boolean;
}> {
  let lastError: string | null = null;
  /** 뜻을 읽는 검수가 버려서 다시 만든 횟수 */
  let reviewDropped = 0;

  const maxAttempts = (opts.retries ?? MAX_REGENERATION_ATTEMPTS) + 1;
  /** 앞 시도들이 버려진 까닭 — 다음 시도 프롬프트에 붙이고, 통과한 문항에 기록한다 */
  const issues: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onStage?.(attempt === 1 ? "make" : "redo");
    try {
      const payload = await generateOneQuestion({
        ...opts,
        retryNote: issues.length ? issues[issues.length - 1] : undefined,
        attempt,
      });
      const validation = validateGeneratedQuestion({
        passage: opts.passage,
        option: opts.option,
        question: payload,
        allowParaphrase: opts.paraphraseGrammarVocab === true,
      });
      payload.validation = validation;

      if (!shouldRegenerate(validation)) {
        /*
         * 규칙 검수를 지난 문항을 뜻을 읽는 검수에 한 번 더 넘긴다(선생님 결정 2026-10-03).
         * drop이면 다시 만들고, fix면 정답 번호·해설만 고쳐 저장한다. 호출이 실패하면 pass다.
         * 사용량은 생성 값에 섞이지 않게 used_for를 따로 적는다(값은 받지 않는다).
         */
        /*
         * 정답을 가리고 직접 풀어 본다(선생님 결정 2026-10-04, 「조건부도 나오지 않게」).
         * 답이 다르거나 다른 답도 맞다고 하면 뜻 검수까지 가지 않고 다시 만든다.
         */
        /*
         * 중복은 검수(값이 드는 호출) 전에 거르고, 같은 유형으로 다시 만들게 메모를 남긴다.
         * 3차 시험(2026-10-04)에서 다 만들고 풀어 본 뒤에야 중복으로 버려 곧장 다른 유형으로 넘겼고,
         * 요약문빈칸 2개는 끝내 못 만들었다.
         */
        const dupNote = opts.duplicateNote?.(payload);
        if (dupNote) {
          lastError = dupNote;
          issues.push(dupNote);
          continue;
        }
        opts.onStage?.("check");
        /*
         * 서술형 확인은 정답·해설을 보며 뜻 검수가 보는 것(조건·비문·해설)까지 함께 본다. 그래서 서술형은
         * 뜻 검수를 또 부르지 않는다 — 시험 50문항(2026-10-04)에서 검수비가 원가의 23%였다.
         */
        let reviewedBySolve = false;
        if (blindSolveEnabled() && (blindSolvable(payload) || subjectiveCheckable(payload))) {
          reviewedBySolve = !blindSolvable(payload);
          const runSolve = () =>
            withAiUsage({ ...currentAiUsage(), featureKey: null, usedFor: "qg_solve" }, () =>
              // 내용일치·불일치·일치개수·제목·주제는 보기마다 따로 판정한다(정답은 숨김, 대조는 코드)
              PER_CHOICE_TYPES.has(opts.option.type)
                ? verifyChoicesIndependently({ passage: cleanSourcePassage(opts.passage), payload, type: opts.option.type })
                : blindSolvable(payload)
                ? blindSolveQuestion({ passage: cleanSourcePassage(opts.passage), payload })
                : checkSubjectiveQuestion({ passage: cleanSourcePassage(opts.passage), payload, code: opts.option.aingkaCode })
            );
          let solved = await runSolve();
          /*
           * 낯선 낱말 때문에만 걸렸으면 문항 전체를 다시 만들지 않고 그 낱말만 쉬운 말로 바꾼 뒤 한 번 더 본다
           * (12차 시험: 다시 만든 17번 중 절반 이상이 이 까닭이었고 원가가 1.3배까지 떨어졌다).
           */
          if (solved.verdict === "drop" && solved.rareWords?.length) {
            const rewrote = await withAiUsage({ ...currentAiUsage(), featureKey: null, usedFor: "qg_solve" }, () =>
              rewriteRareWords({ payload, words: solved.rareWords! })
            );
            if (rewrote) solved = await runSolve();
          }
          // 빈칸추론은 풀이를 지난 뒤 보기를 하나씩 빈칸에 넣어 한 번 더 본다(정답처럼 읽히는 오답, 2026-11-12)
          if (solved.verdict === "pass" && opts.option.type === "sentence_blank" && blankChoicesCheckable(payload)) {
            const perChoice = await withAiUsage({ ...currentAiUsage(), featureKey: null, usedFor: "qg_solve" }, () =>
              verifyBlankChoices({ payload })
            );
            if (perChoice.verdict === "drop") solved = perChoice;
          }
          validation.solve = solved;
          if (solved.verdict === "drop") {
            reviewDropped += 1;
            lastError = `직접 풀기: ${solved.reason}`;
            issues.push(lastError);
            continue;
          }
        }
        if (aiReviewEnabled() && !reviewedBySolve) {
          const beforeReview = { correctAnswer: payload.correctAnswer, explanation: payload.explanation };
          const review = await withAiUsage(
            { ...currentAiUsage(), featureKey: null, usedFor: "qg_review" },
            () =>
              reviewGeneratedQuestion({
                passage: cleanSourcePassage(opts.passage),
                option: opts.option,
                payload,
                allowParaphrase: opts.paraphraseGrammarVocab === true,
              })
          );
          validation.review = { verdict: review.verdict, reason: review.reason, fixed: review.fixed };
          /*
           * 뜻 검수가 고친 정답·해설은 규칙 검수를 다시 거친다.
           *
           * 선생님 지적(2026-10-06): 발곡고1 동형모의고사가 24문항을 다 만든 뒤 22문항으로 줄었다.
           * 뜻 검수가 문장삽입 정답을 원문 자리(②)와 다른 ①로, 어휘추론 해설을 표지 순서와 어긋나게
           * 고쳐 저장했고, 마지막 그물(final-sweep)이 그 둘을 지워 번호가 비었다. 고치기 전 것은 규칙
           * 검수와 직접 풀기를 이미 지났으므로, 고친 것이 규칙에 걸리면 고치기 전으로 되돌린다.
           */
          if (review.verdict === "fix") {
            const recheck = validateGeneratedQuestion({
              passage: opts.passage,
              option: opts.option,
              question: payload,
              allowParaphrase: opts.paraphraseGrammarVocab === true,
            });
            if (shouldRegenerate(recheck)) {
              payload.correctAnswer = beforeReview.correctAnswer;
              payload.explanation = beforeReview.explanation;
              validation.review = {
                verdict: "pass",
                reason: `고친 값이 규칙 검수에 걸려 되돌림(${recheck.warnings[0] ?? "형태 검수 미달"}) — ${review.reason}`,
                fixed: [],
              };
            }
          }
          if (review.verdict === "drop") {
            reviewDropped += 1;
            lastError = `검수: ${review.reason}`;
            issues.push(lastError);
            continue;
          }
        }
        validation.attempt = attempt;
        if (issues.length) validation.earlierIssues = issues.slice();
        return { payload, status: "approved", attempt, error: null, reviewDropped };
      }
      lastError = validation.warnings.join(" · ") || "형태 검수 미달";
      issues.push(lastError);
    } catch (e) {
      if (e instanceof SkipQuestionError) {
        return {
          payload: null,
          status: "approved",
          attempt,
          error: e.message,
          skipped: true,
        };
      }
      lastError = e instanceof Error ? e.message : "생성 실패";
      /*
       * 형태 검수에서 던진 까닭도 다음 시도에 넘긴다. 전에는 검수 점수 미달만 넘겨서,
       * 던진 오류(「계획한 정답은 4인데 생성 정답은 2」 등)는 다시 만들어도 같은 실수를 되풀이했다
       * (정수학원 273문항 작업 2026-10-04: 어휘개수 6개가 세 번씩 같은 까닭으로 버려짐).
       */
      issues.push(lastError);
    }
  }

  // 미달·실패 문항은 저장하지 않고 폐기
  return {
    payload: null,
    status: "approved",
    attempt: maxAttempts,
    error: lastError ?? "생성 실패 — 문항 폐기",
  };
}

/** 문항 하나가 지금 있는 단계 — 진행 문구에 센다 */
type QgStage = "make" | "check" | "redo" | "swap";

type WorkItem = {
  passageId: string;
  passageText: string;
  analysis: PassageAnalysis;
  option: QuestionTypeOption;
  sourceDetail?: string;
  label: string;
  diversitySlot: { index: number; total: number; label: string };
  /**
   * 같은 유형이 작업 전체에서 몇 번째인가(0부터). 지문이 달라도 이어진다.
   *
   * 지문 안 차례(diversitySlot)만 보고 돌리면, 지문마다 유형 차례가 똑같아 늘 같은
   * 번호가 나온다 — 조건 문법을 여럿 골라도 한두 개만 계속 나왔다(2026-10-01 지적).
   */
  typeTurn: number;
  /**
   * 같은 지문·같은 유형의 몇 번째 사본인가(0부터). 한 유형을 2개씩 청하면 둘의 프롬프트가
   * 글자까지 같아 모델이 똑같은 문항을 둘 내놓았다(2026-10-02: 지칭·특정표현·내용일치).
   * 사본마다 근거 자리를 달리 잡으라는 한 줄을 넣는 데 쓴다.
   */
  copyIndex?: number;
  /** 설계도(동형모의고사) 칸 */
  slot?: { index: number; itemNo: string; points: number | null; level: TargetLevel };
  /** 1지문 다문항: 세트 안 차례(0부터)와 이 지문 세트의 첫 시험지 차례 */
  setPos?: number;
  setBase?: number;
  /** 1지문 다문항: 같은 지문의 다른 문항 이야기(만들 때 프롬프트에 붙인다) */
  setNote?: string;
  /** 저장한 문항(세트 검수에서 고쳐 쓰려고 둔다) */
  saved?: { id: string; payload: GeneratedQuestionPayload };
};

function slotKey(passageId: string, optionKey: string): string {
  return `${passageId}:${optionKey}`;
}

async function countSavedQuestions(jobId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("generated_english_questions")
    .select("id", { count: "exact", head: true })
    .eq("generation_job_id", jobId);
  return count ?? 0;
}

/** 고른 유형으로 안 되어 다른 유형으로 바꿔 만든 문항 수. 여러 번에 나눠 돌려도 맞는다. */
async function countSubstitutedQuestions(jobId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("generated_english_questions")
    .select("id", { count: "exact", head: true })
    .eq("generation_job_id", jobId)
    .not("validation_result->>substitutedFrom", "is", null);
  return count ?? 0;
}

/**
 * 후불 작업: 새로 만들어진 문항 수만큼 크레딧을 차감한다(버려지거나 생략된 문항은 받지 않는다).
 * 지난 차감(billedAt) 뒤에 저장된 문항만 센다. 그래서 이어서 재시도하면 새로 생긴 문항만 받고,
 * 문항을 지운 뒤 다시 만들어 개수가 제자리여도 새로 만든 문항 값은 받는다.
 * 같은 문항 묶음으로 두 번 불려도 차감 키가 같아 한 번만 차감된다.
 */
async function billGeneratedQuestions(jobId: string, completed: number): Promise<void> {
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("question_generation_jobs")
    .select("academy_id, created_by, request_config")
    .eq("id", jobId)
    .maybeSingle();
  const rc = (job?.request_config ?? null) as GenerationRequestConfig | null;
  const billing = rc?._billing;
  if (!job?.academy_id || !job.created_by || !rc || billing?.mode !== "post") return;

  /*
   * 아직 값을 매기지 않은 문항만 가져온다.
   * 선생님 결정(2026-09-29): 어법추론은 원가가 82원이라 다른 유형(32~53원)과 달리
   * 100으로 받는다. 그래서 유형을 보고 갈라 센다.
   */
  let rowsToBill: Array<{ created_at: string; option_key: string | null }> = [];
  let latest: string | null = null;
  {
    let q = admin
      .from("generated_english_questions")
      .select("created_at, option_key")
      .eq("generation_job_id", jobId)
      .order("created_at", { ascending: true });
    if (billing.billedAt) q = q.gt("created_at", billing.billedAt);
    const { data } = await q;
    rowsToBill = (data ?? []) as Array<{ created_at: string; option_key: string | null }>;
    // billedAt 없이 시작한 예전 작업은 이미 받은 만큼을 앞에서 덜어 낸다
    if (!billing.billedAt && (billing.billed ?? 0) > 0) {
      rowsToBill = rowsToBill.slice(billing.billed ?? 0);
    }
    latest = rowsToBill[rowsToBill.length - 1]?.created_at ?? null;
  }
  const toBill = rowsToBill.length;
  if (toBill <= 0 || !latest) return;

  /*
   * 어법 유형은 원가가 다른 유형의 두 배쯤이다(실측: 어법추론 77원 · 어법개수 72원,
   * 빈칸추론 32원). 지문 전체를 다시 읽고 다섯 자리를 한꺼번에 봐야 해서다.
   */
  const grammarCount = rowsToBill.filter((r) => isGrammarType(r.option_key)).length;
  const writingCount = rowsToBill.filter(
    (r) => !isGrammarType(r.option_key) && isWritingType(r.option_key)
  ).length;
  const plainCount = toBill - grammarCount - writingCount;

  /*
   * 내역에 무엇을 만들었는지 적는다.
   *
   * 선생님 요청(2026-09-29): 크레딧 사용 내역에 무엇을 썼는지 정확하게 찍히게 해 달라.
   * 동형모의고사도 같은 길로 값을 받는데 「변형문제」로만 찍혀 어디에 쓴 값인지 몰랐다.
   */
  const madeBy = rc.examAnalysisId ? "동형모의고사" : "변형문제";

  let ok = true;
  if (plainCount > 0) {
    ok =
      (await debitLessonCredits({
        academyId: job.academy_id as string,
        actorId: job.created_by as string,
        featureKey: CREDIT_FEATURES.qg_generate_job,
        quantity: plainCount,
        idempotencyKey: `qg_generate_job:${jobId}:upto-${latest}`,
        metadata: { job_id: jobId, used_for: "question_generator", made_by: madeBy },
        note: `${madeBy} ${plainCount}문항`,
      })) && ok;
  }
  if (writingCount > 0) {
    ok =
      (await debitLessonCredits({
        academyId: job.academy_id as string,
        actorId: job.created_by as string,
        featureKey: "qg_generate_writing",
        quantity: writingCount,
        idempotencyKey: `qg_generate_writing:${jobId}:upto-${latest}`,
        metadata: { job_id: jobId, used_for: "question_generator", made_by: madeBy },
        note: `${madeBy} 서술형 ${writingCount}문항`,
      })) && ok;
  }
  if (grammarCount > 0) {
    ok =
      (await debitLessonCredits({
        academyId: job.academy_id as string,
        actorId: job.created_by as string,
        featureKey: "qg_generate_grammar",
        quantity: grammarCount,
        idempotencyKey: `qg_generate_grammar:${jobId}:upto-${latest}`,
        metadata: { job_id: jobId, used_for: "question_generator", made_by: madeBy },
        note: `${madeBy} 어법 유형 ${grammarCount}문항`,
      })) && ok;
  }
  if (!ok) return;
  await admin
    .from("question_generation_jobs")
    .update({
      request_config: {
        ...rc,
        _billing: { mode: "post", billed: (billing.billed ?? 0) + toBill, billedAt: latest },
      },
    })
    .eq("id", jobId);
}

/**
 * 버려진 문항의 까닭을 짧게 간추린다.
 *
 * 만들었다가 검수에 걸려 버리는 문항이 열에 하나쯤 된다. 까닭을 남기지 않으면
 * 어느 규칙이 자주 걸리는지 알 수 없어, 지시문을 어디부터 다듬을지 못 고른다.
 */
function dropReasons(said: string[] | undefined): string | null {
  if (!said || said.length === 0) return null;
  const tally = new Map<string, number>();
  for (const one of said) {
    const key = String(one || "까닭 없음").slice(0, 60);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const top = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, n]) => `${key} ×${n}`);
  /*
   * 고른 유형으로 안 돼 버린 것과 다른 유형으로 바꾼 것을 함께 적는다.
   * 선생님 물음(2026-10-01): 탈락한 문제들은 왜 그런지도 알고 싶다.
   */
  return `고른 유형으로 안 된 문항 ${said.length}개 — ${top.join(" · ")}`;
}


/** 못 만든 까닭을 선생님이 읽을 말로 바꾼다(검수 내부 문구를 그대로 보이지 않는다) */
function friendlyDropReason(raw: string): string {
  if (/직접 풀/.test(raw)) return "풀어 보니 답이 하나로 정해지지 않음";
  if (/계획한 정답/.test(raw)) return "정해 둔 정답 개수에 맞게 만들지 못함";
  if (/사실상 같음/.test(raw)) return "같은 지문의 다른 문항과 겹침";
  if (/문장뿐|짧/.test(raw)) return "지문이 짧아 이 유형에 맞지 않음";
  if (/^검수|검수:/.test(raw)) return "검수에서 문제가 발견됨";
  if (/없음$|찾지 못/.test(raw)) return "지문에서 이 유형에 맞는 자리를 찾지 못함";
  return "조건에 맞는 문항을 만들지 못함";
}

/**
 * 끝난 작업에 선생님이 볼 안내를 만든다.
 * 선생님 요청(2026-10-04): 왜 탈락했는지 보여 주고, 크레딧은 만든 문항에서만 나갔다고 알려 달라.
 */
function teacherSummary(opts: { completed: number; failed: number; credits: number; dropped: string[] }): string {
  const parts: string[] = [];
  if (opts.failed > 0) {
    const byLabel = new Map<string, { n: number; reason: string }>();
    for (const d of opts.dropped) {
      const m = d.match(/^\[([^\]]+)\] 못 만듦: ([\s\S]*)$/);
      if (!m) continue;
      const row = byLabel.get(m[1]!) ?? { n: 0, reason: friendlyDropReason(m[2]!) };
      row.n += 1;
      byLabel.set(m[1]!, row);
    }
    const detail = [...byLabel.entries()].map(([label, r]) => `${label} ${r.n}개(${r.reason})`).join(" · ");
    parts.push(
      `못 만든 ${opts.failed}문항은 검수를 통과하지 못해 저장하지 않았고 크레딧도 받지 않았습니다${detail ? ` — ${detail}` : ""}.`
    );
  }
  if (opts.credits > 0) {
    parts.push(`크레딧은 만든 ${opts.completed}문항에만 ${opts.credits.toLocaleString("ko-KR")} 차감됐습니다.`);
  }
  return parts.join(" ");
}

/** 이 작업으로 차감된 크레딧(여러 토막에 나눠 받은 것까지) */
async function creditsChargedForJob(jobId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_transactions")
    .select("amount")
    .eq("metadata->>job_id", jobId);
  return (data ?? []).reduce((sum, r) => sum + Math.abs(Number((r as { amount?: number }).amount) || 0), 0);
}

/**
 * 이 작업의 실제 원가(모델 호출 값)와 받은 크레딧의 배수.
 *
 * 선생님 기준(2026-10-05): 변형문제는 무조건 원가의 2배 이상 받아야 한다. 전에는 시간대로 사용량을
 * 잘라 재서 작업이 겹치면 나눌 수 없었고, 배수가 1.7배로 떨어진 것을 다음 날 점검에서야 알았다.
 * 사용량 기록의 작업 번호(meta.qgJobId)로 모아 작업마다 남기고, 2배 아래면 경고한다.
 */
const QG_MIN_MARGIN = 2;
async function recordJobCost(jobId: string, credits: number): Promise<void> {
  const admin = createAdminClient();
  let won = 0;
  let calls = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("ai_usage_logs")
      .select("model,input_tokens,cached_input_tokens,output_tokens")
      .eq("meta->>qgJobId", jobId)
      .range(from, from + 999);
    for (const r of data ?? []) {
      won += usageWon(r as Parameters<typeof usageWon>[0]) ?? 0;
      calls += 1;
    }
    if (!data || data.length < 1000) break;
  }
  if (calls === 0) return;
  const margin = won > 0 ? credits / won : null;
  const below = margin !== null && credits > 0 && margin < QG_MIN_MARGIN;
  if (below) {
    console.error(`[qg-margin] 작업 ${jobId} 배수 ${margin!.toFixed(2)} — 목표 ${QG_MIN_MARGIN}배 미달 (원가 ${Math.round(won)}원, 크레딧 ${credits})`);
  }
  const { data: row } = await admin.from("question_generation_jobs").select("request_config").eq("id", jobId).maybeSingle();
  const rc = (row?.request_config ?? {}) as Record<string, unknown>;
  await admin
    .from("question_generation_jobs")
    .update({
      request_config: {
        ...rc,
        _cost: { won: Math.round(won), credits, calls, margin: margin === null ? null : Number(margin.toFixed(2)), belowTarget: below, at: new Date().toISOString() },
      },
    })
    .eq("id", jobId);
}

async function finalizeGenerationJob(
  jobId: string,
  opts: {
    totalRequested: number;
    /** 뜻을 읽는 검수가 버려서 다시 만든 수 */
    reviewDropped?: number;
    skipped: number;
    errorMessage?: string | null;
    /** 검수에 걸려 버린 문항들의 까닭 — 무엇을 다듬어야 하는지 보이게 남긴다 */
    dropped?: string[];
  }
): Promise<void> {
  // 작업이 끝났으니 모아 둔 사용량 기록을 밀어 넣는다(서버가 곧 잠든다).
  await flushAiUsage();

  /*
   * 저장이 끝난 뒤 한 번 더 훑는다 — 마지막 그물.
   * 선생님이 문항을 받기 전에 걸러져야 한다. 사람이 보는 일이 없어야 한다
   * (2026-10-01: 「강사가 매번 어떻게 확인하느냐」). 모델을 부르지 않는다.
   */
  const swept: string[] = [];
  try {
    const admin = createAdminClient();
    await updateJob(jobId, { progress_message: "마지막 점검 중 — 저장한 문항을 한 번 더 확인하고 있어요" });
    const { data: jobRow } = await admin
      .from("question_generation_jobs")
      .select("request_config")
      .eq("id", jobId)
      .maybeSingle();
    const rc = (jobRow?.request_config ?? {}) as Record<string, unknown>;
    swept.push(...(await sweepSavedQuestions(admin, jobId, rc.paraphraseGrammarVocab === true)));
  } catch (e) {
    console.error("final sweep failed", e);
  }

  const completed = await countSavedQuestions(jobId);
  const failed = Math.max(0, opts.totalRequested - completed - opts.skipped);
  const finalStatus = completed > 0 ? "completed" : "failed";
  const substituted = await countSubstitutedQuestions(jobId);

  let progressMessage = "생성 완료";
  if (finalStatus === "completed") {
    if (failed > 0 && opts.skipped > 0) {
      progressMessage = `생성 완료 (${completed}/${opts.totalRequested}, 미생성 ${failed} · 생략 ${opts.skipped})`;
    } else if (failed > 0) {
      progressMessage = `생성 완료 (${completed}/${opts.totalRequested}, 미생성 ${failed})`;
    } else if (opts.skipped > 0) {
      progressMessage = `생성 완료 (생략 ${opts.skipped})`;
    }
    // 고른 유형으로 안 되어 바꿔 만든 것은 반드시 알린다 — 조용히 섞이면 안 된다
    if (substituted > 0) progressMessage += ` · 다른 유형으로 바꿔 만든 것 ${substituted}개`;
    if ((opts.reviewDropped ?? 0) > 0) progressMessage += ` · 검수에서 걸러 다시 만든 것 ${opts.reviewDropped}개`;
  } else {
    progressMessage = "생성 실패";
  }

  // 값을 먼저 받아야 안내에 차감한 크레딧을 적을 수 있다
  await billGeneratedQuestions(jobId, completed);
  const credits = finalStatus === "completed" ? await creditsChargedForJob(jobId).catch(() => 0) : 0;
  try {
    await recordJobCost(jobId, credits);
  } catch (e) {
    console.error("job cost record failed", e);
  }
  // 검수 내부 까닭은 선생님 화면 대신 작업 설정에 남긴다(어디를 다듬을지 찾을 때 본다)
  const internal = dropReasons([...(opts.dropped ?? []), ...swept]);
  if (internal) {
    try {
      const admin = createAdminClient();
      const { data: row } = await admin.from("question_generation_jobs").select("request_config").eq("id", jobId).maybeSingle();
      const rc = (row?.request_config ?? {}) as Record<string, unknown>;
      await admin.from("question_generation_jobs").update({ request_config: { ...rc, _dropLog: internal } }).eq("id", jobId);
    } catch (e) {
      console.error("drop log save failed", e);
    }
  }

  await updateJob(jobId, {
    status: finalStatus,
    progress_message: progressMessage,
    error_message:
      finalStatus === "failed"
        ? opts.errorMessage ?? "선택한 유형 생성에 실패했습니다."
        : teacherSummary({ completed, failed, credits, dropped: opts.dropped ?? [] }) || null,
    completed_at: new Date().toISOString(),
    total_completed: completed,
    total_failed: failed,
  });

  if (completed > 0) {
    try {
      await diversifyJobHardWords(jobId);
    } catch (e) {
      console.error("hard words diversify failed", e);
    }
    try {
      await syncExamVocabSetFromJob(jobId);
    } catch (e) {
      console.error("exam vocab sync failed", e);
    }
  }
}

/**
 * 한 번의 서버 실행(Vercel 함수)은 300초에 끊긴다. 예전에는 작업 전체를 한 실행에서
 * 돌려, 210문항짜리가 141번째에서 끊기고 "생성 중"으로 멈춰 있었다. 이제는 실행마다
 * 정해진 시간만큼만 새 문항을 시작하고, 남으면 작업을 pending으로 돌려놓고 다음 실행이
 * 이어 받는다(runGenerationJob의 반환값 more, api/question-generator/continue).
 */
/** 이 시간이 지나면 새 문항을 시작하지 않는다. 느린 호출(최대 1분 남짓)이 끝날 자리를 남긴다. */
const CHUNK_DISPATCH_MS = 180_000;
/** 이 시간까지 끝나지 않은 문항은 버리고(저장 안 함) 다음 실행에 넘긴다. */
const CHUNK_HARD_STOP_MS = 265_000;
/** 실행 하나가 살아 있을 수 있는 최대 시간(300초 + 여유). 넘으면 멈춘 작업으로 본다. */
const RUNNER_MAX_LIFETIME_MS = 330_000;
/** 이어 받기 횟수 상한(최대 500문항도 이 안에 끝난다). */
const MAX_CHUNKS = 20;

/** 실행 중으로 표시되는 상태. 이 상태의 작업은 실행 하나가 가져간 것이다. */
const HELD_STATUSES = ["analyzing", "generating", "validating"];
/** 실행이 새로 가져갈 수 있는 상태. */
const FREE_STATUSES = ["pending", "failed", "partially_completed"];

/**
 * 실행 중으로 표시돼 있지만 그 실행이 이미 끝났을(끊겼을) 작업인지. 실행을 가져간
 * 시각이 없으면(예전 작업) 작업을 만든 시각으로 판단한다.
 */
export function isGenerationJobStale(job: {
  status: string;
  created_at?: string | null;
  request_config?: unknown;
}): boolean {
  if (!HELD_STATUSES.includes(job.status)) return false;
  const run = (job.request_config as GenerationRequestConfig | null)?._run;
  const since = Date.parse(run?.claimedAt ?? job.created_at ?? "");
  if (!Number.isFinite(since)) return false;
  return Date.now() - since > RUNNER_MAX_LIFETIME_MS;
}

/**
 * 끊긴 작업을 다시 가져갈 수 있게 pending으로 돌린다. 여럿이 동시에 불러도 상태가
 * 바뀐 뒤에는 조건이 맞지 않아 한 번만 바뀐다. 바꿨으면 true.
 */
export async function releaseStaleGenerationJob(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("question_generation_jobs")
    .select("id,status,created_at,request_config")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !isGenerationJobStale(job)) return false;
  const { data: updated } = await admin
    .from("question_generation_jobs")
    .update({ status: "pending", progress_message: "이어서 만드는 중…" })
    .eq("id", jobId)
    .eq("status", job.status)
    .select("id")
    .maybeSingle();
  return !!updated;
}

/**
 * 작업을 한 번 실행한다. 이미 다른 실행이 가져갔거나 끝난 작업이면 아무것도 하지 않는다.
 * 시간 안에 다 못 만들면 { more: true }를 돌려주고, 부른 쪽이 다음 실행을 이어 붙인다.
 * continuation은 이어 받는 실행(진행 문구와 이어 받기 횟수만 다르다).
 */
export async function runGenerationJob(
  jobId: string,
  opts: { continuation?: boolean } = {}
): Promise<{ more: boolean }> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("question_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) throw new Error("생성 작업을 찾을 수 없습니다.");

  let academyId = (job.academy_id as string | null) ?? null;
  if (!academyId && job.created_by) {
    const { data: creator } = await admin
      .from("profiles")
      .select("academy_id")
      .eq("id", job.created_by as string)
      .maybeSingle();
    academyId = (creator?.academy_id as string | null) ?? null;
  }
  /*
   * 이 작업이 부르는 모델 호출을 모두 「변형문제」로 묶어 둔다.
   * 지문 분석처럼 값을 따로 받지 않는 호출도 여기 안에서 일어나므로 같이 잡힌다.
   */
  setAiUsage({
    academyId,
    actorId: (job.created_by as string | null) ?? null,
    featureKey: "qg_generate_job",
    usedFor: "question_generator",
    // 작업 번호를 붙여 두면 동시에 돈 작업이 있어도 이 작업의 원가만 모을 수 있다(finalize의 원가 배수)
    meta: { qgJobId: jobId },
  });
  if (!academyId) {
    throw new Error("생성 작업에 학원 정보가 없습니다.");
  }

  // 실행 중인 작업은 가져가지 않는다. 끊긴 작업은 releaseStaleGenerationJob이 먼저
  // pending으로 돌려놓는다.
  if (!FREE_STATUSES.includes(job.status)) return { more: false };

  const prevRun = (job.request_config as GenerationRequestConfig | null)?._run;
  const chunk = opts.continuation ? (prevRun?.chunk ?? 0) + 1 : 1;
  const config: GenerationRequestConfig = {
    ...(job.request_config as GenerationRequestConfig),
    _run: { claimedAt: new Date().toISOString(), chunk },
  };

  // 동시 실행 방지: 가져갈 수 있는 상태에서 실행 중 상태로 바꾼 쪽 하나만 이어 간다.
  // 둘이 동시에 바꾸려 해도 뒤쪽은 이미 바뀐 상태를 보고 0건이 된다.
  const { data: claimed, error: claimErr } = await admin
    .from("question_generation_jobs")
    .update({
      status: "analyzing",
      progress_message: opts.continuation ? "이어서 만드는 중…" : "준비 중…",
      error_message: null,
      request_config: config,
    })
    .eq("id", jobId)
    .in("status", FREE_STATUSES)
    .select("id")
    .maybeSingle();
  if (claimErr || !claimed) return { more: false };

  const { data: existingRows } = await admin
    .from("generated_english_questions")
    .select("passage_id, option_key, slot_index, validation_result, question_type, passage_modified, choices, correct_answer")
    .eq("generation_job_id", jobId);
  /** 지문마다 이미 만든 문항의 비교용 낱말 — 같은 지문·같은 유형의 사실상 같은 문항을 거른다 */
  const dupSigs = new Map<string, DupSignature[]>();
  const rememberDup = (passageId: string, sig: DupSignature | null) => {
    if (!sig) return;
    const list = dupSigs.get(passageId) ?? [];
    list.push(sig);
    dupSigs.set(passageId, list);
  };
  for (const r of existingRows ?? []) {
    rememberDup(
      String(r.passage_id),
      dupSignature({
        type: r.question_type as string | null,
        passageModified: r.passage_modified as string | null,
        choices: r.choices as GeneratedQuestionPayload["choices"],
        correctAnswer: r.correct_answer,
      })
    );
  }
  /*
   * 다른 유형으로 바꿔 만든 문항은 「원래 고른 유형」 칸을 채운 것으로 센다.
   * 전에는 바뀐 유형 키로만 세어, 다음 토막이 원래 칸을 비었다고 보고 한 번 더 만들었다.
   * 249문항을 청했는데 254문항이 나온 까닭이다(2026-10-03).
   */
  const slotOptionKey = (r: { option_key?: unknown; validation_result?: unknown }) =>
    String(
      (r.validation_result as { substitutedFromKey?: string } | null)?.substitutedFromKey ?? r.option_key ?? ""
    );
  const existingSlots = new Set(
    (existingRows ?? []).map((r) => slotKey(String(r.passage_id), slotOptionKey(r)))
  );
  /**
   * 지문·유형 조합마다 이미 저장된 수. 한 유형을 2개씩 청하면 조합 하나에 문항이 둘이다.
   * 조합이 있다/없다로만 보면, 토막 경계에서 하나만 저장된 조합의 둘째 문항을 안 만든다.
   */
  const existingCountBySlot = new Map<string, number>();
  for (const r of existingRows ?? []) {
    const k = slotKey(String(r.passage_id), slotOptionKey(r));
    existingCountBySlot.set(k, (existingCountBySlot.get(k) ?? 0) + 1);
  }
  /** 유형마다 이미 만들어 둔 문항 수 — 이어 받아도 조건 문법 차례가 처음으로 돌아가지 않게 */
  const madeByType = new Map<string, number>();
  for (const r of existingRows ?? []) {
    const k = String(r.option_key ?? "");
    madeByType.set(k, (madeByType.get(k) ?? 0) + 1);
  }
  /** 설계도 작업: 이미 만든 칸 번호 */
  const doneSlotIndexes = new Set(
    (existingRows ?? []).map((r) => r.slot_index).filter((x): x is number => typeof x === "number")
  );
  const blueprint = Array.isArray(config.blueprint) && config.blueprint.length > 0 ? config.blueprint : null;
  const isResume = existingSlots.size > 0;

  // 신규 생성만 기존 문항 삭제. 재시도는 성공 문항 유지.
  if (!isResume) {
    await admin
      .from("generated_english_questions")
      .delete()
      .eq("generation_job_id", jobId);
  }

  config.counts = sanitizeCounts(config.counts, MAX_SETS_PER_TYPE);
  const userId = job.created_by as string;

  const passageIds =
    Array.isArray(config.passageIds) && config.passageIds.length > 0
      ? config.passageIds
      : [job.passage_id as string];

  const resolved = resolvePassages(config);
  const updateProgress = createProgressThrottler();

  try {
    if (!isResume) {
      await updateProgress(
        jobId,
        {
          progress_message: `지문 분석 중 (0/${passageIds.length})`,
        },
        true
      );
    }

    /*
     * 1지문 다문항이면 세트 차례대로 한 문항씩. 개수 칸(counts)도 같은 구성이라 요청 수·크레딧은 그대로 맞는다.
     */
    const setCfg = config.passageSet && !blueprint ? config.passageSet : null;
    /** 세트 구성이 여럿이면 지문 차례대로 번갈아 붙인다. 구성마다 문항 수는 같다 */
    const setOptionsFor = (pi: number) =>
      setKeysForPassage(setCfg!, pi)
        .map((k) => findOptionByKey(k))
        .filter((o): o is QuestionTypeOption => !!o);
    const options = setCfg ? setOptionsFor(0) : expandCountRequests(config.counts ?? {});
    const work: WorkItem[] = [];

    const passageRows = await Promise.all(
      passageIds.map(async (passageId, pi) => {
        const { data: passageRow } = await admin
          .from("english_source_passages")
          .select("*")
          .eq("id", passageId)
          .single();
        return { passageId, passageRow, pi };
      })
    );

    for (const { passageId, passageRow, pi } of passageRows) {
      if (!passageRow) {
        await updateJob(jobId, {
          status: "failed",
          error_message: `지문 ${pi + 1}을(를) 찾을 수 없습니다.`,
          completed_at: new Date().toISOString(),
        });
        return { more: false };
      }
    }

    const analyzed = await Promise.all(
      passageRows.map(async ({ passageId, passageRow, pi }) => {
        if (!passageRow) return null;

        if (!isResume) {
          await updateProgress(jobId, {
            status: "analyzing",
            progress_message: `지문 분석 중 (${pi + 1}/${passageIds.length})`,
          });
        }

        let analysis = passageRow.analysis as PassageAnalysis | null;
        if (!analysis) {
          analysis = await analyzePassage({
            passage: passageRow.passage,
            grade: passageRow.grade,
            overallDifficulty: passageRow.overall_difficulty,
          });
          await admin
            .from("english_source_passages")
            .update({
              analysis,
              updated_at: new Date().toISOString(),
            })
            .eq("id", passageId);
        }

        return { passageId, passageRow, analysis, pi };
      })
    );

    if (blueprint) {
      // 설계도 순서대로 한 칸에 한 문항
      blueprint.forEach((b, index) => {
        if (doneSlotIndexes.has(index)) return;
        const row = analyzed[b.passageIndex];
        const option = findOptionByKey(b.optionKey);
        if (!row || !option) return;
        work.push({
          passageId: row.passageId,
          passageText: row.passageRow.passage,
          analysis: row.analysis,
          option,
          sourceDetail: resolved[b.passageIndex]?.sourceDetail || config.sourceDetail || undefined,
          label: `${b.no}번 · ${option.label}`,
          diversitySlot: { index: 0, total: 0, label: option.label },
          typeTurn: 0,
          slot: { index, itemNo: b.no, points: b.points ?? null, level: b.level },
        });
      });
    }

    let chartSkipped = 0;
    const chartSkippedTypes = new Set<string>();
    for (const row of blueprint ? [] : analyzed) {
      if (!row) continue;
      const { passageId, passageRow, analysis, pi } = row;
      const meta = resolved[pi];
      const sourceDetail =
        meta?.sourceDetail ||
        config.sourceDetail ||
        passageRow.source_detail ||
        undefined;

      /** 이 지문에서 유형마다 몇 번째 사본인가 — 이미 저장된 수만큼은 건너뛴다 */
      const copyIndexByKey = new Map<string, number>();
      /*
       * 도표 설명문에는 제목·주제·요지·빈칸·삽입·순서·무관·함축을 만들지 않는다. 부르기 전에
       * 빼고 요청 수에서도 뺀다. 안에서 생략하면 「288 중 201」처럼 보여 선생님이 놀란다
       * (2026-10-03: 도표 지문 하나로 39개가 생략됐다).
       */
      const chartPassage = isChartDescriptionPassage(cleanSourcePassage(String(passageRow.passage ?? "")));
      for (const [pos, option] of (setCfg ? setOptionsFor(pi) : options).entries()) {
        if (chartPassage && CHART_UNFIT_TYPES.has(option.type)) {
          chartSkipped += 1;
          chartSkippedTypes.add(option.label || option.type);
          continue;
        }
        const key = slotKey(passageId, option.key);
        const copyIndex = copyIndexByKey.get(key) ?? 0;
        copyIndexByKey.set(key, copyIndex + 1);
        if (copyIndex < (existingCountBySlot.get(key) ?? 0)) continue;
        work.push({
          copyIndex,
          passageId,
          passageText: passageRow.passage,
          analysis,
          option,
          sourceDetail,
          label:
            passageIds.length > 1
              ? `지문${pi + 1} · ${option.label}`
              : option.label,
          diversitySlot: {
            index: 0,
            total: 0,
            label: option.label,
          },
          typeTurn: 0,
          ...(setCfg ? { setPos: pos, setBase: pi * setCfg.size } : {}),
        });
      }
    }

    /*
     * 요청 수는 처음 청한 그대로다(유형 수 × 지문 수).
     *
     * 선생님 지적(2026-10-02): 382문항을 만들었는데 「382/237」로 보였다. 두 번째 토막이
     * 요청 수를 「이미 만든 지문·유형 조합 수 + 남은 수」로 다시 셈한 탓이다. 한 유형을
     * 2개씩 청하면 조합 하나에 문항이 둘이라 조합 수는 문항 수보다 작다.
     */
    const totalRequested = blueprint
      ? blueprint.length
      : options.length * analyzed.filter(Boolean).length - chartSkipped;

    // 지문별로 슬롯 번호 부여 (동의어·보기단어 다양화 힌트)
    const slotByPassage = new Map<string, number>();
    const totalByPassage = new Map<string, number>();
    for (const item of work) {
      totalByPassage.set(
        item.passageId,
        (totalByPassage.get(item.passageId) ?? 0) + 1
      );
    }
    for (const item of work) {
      const idx = slotByPassage.get(item.passageId) ?? 0;
      slotByPassage.set(item.passageId, idx + 1);
      item.diversitySlot = {
        index: idx,
        total: totalByPassage.get(item.passageId) ?? 1,
        label: item.label,
      };
    }

    // 유형마다 작업 전체에서 몇 번째인지 — 조건 문법·어법 포인트를 고루 돌리는 데 쓴다
    const turnByType = new Map(madeByType);
    for (const item of work) {
      const n = turnByType.get(item.option.key) ?? 0;
      turnByType.set(item.option.key, n + 1);
      item.typeTurn = n;
    }

    // 재시도 시 남은 슬롯이 없으면 바로 완료 처리. 이어 받기가 너무 많이 반복되면
    // (계속 실패하는 유형 등) 거기서 끝낸다.
    if (work.length === 0 || chunk > MAX_CHUNKS) {
      await finalizeGenerationJob(jobId, {
        totalRequested,
        skipped: 0,
      });
      return { more: false };
    }

    // 이미 만든 수도 조합 수가 아니라 문항 수로 센다
    const initialCompleted = blueprint ? doneSlotIndexes.size : (existingRows ?? []).length;

    await updateProgress(
      jobId,
      {
        status: "generating",
        progress_message: opts.continuation
          ? `${initialCompleted}/${totalRequested} 완료 · 이어서 만드는 중`
          : isResume
            ? `실패 유형 재생성 중 (0/${work.length})`
            : `문제 생성 중 (0/${work.length})`,
        total_requested: totalRequested,
        total_completed: initialCompleted,
        total_failed: 0,
      },
      true
    );

    let completed = initialCompleted;
    let failed = 0;
    let skipped = 0;
    const dropped: string[] = [];
    let reviewDropped = 0;
    if (chartSkipped > 0) {
      dropped.push(
        `도표 설명 지문에는 ${[...chartSkippedTypes].join("·")} 유형을 만들지 않아 ${chartSkipped}개를 요청에서 뺐습니다`
      );
    }
    /** 시간이 모자라 이번 실행에서 시작하지 않은 문항 수. */
    let deferred = 0;
    /** 시간 초과로 이번 실행을 접었다. 이후에 끝나는 문항은 저장하지 않는다. */
    let abandoned = false;
    const inserts = new Set<Promise<unknown>>();
    const dispatchUntil = startedAt + CHUNK_DISPATCH_MS;

    // 동시에 만드는 문항 수: 돌고 있는 작업끼리 몫을 나누고(20초마다 다시 셈), 한도가
    // 빠듯하면 절반으로 줄인다. 혼자 돌면 GENERATION_CONCURRENCY.
    let share = GENERATION_CONCURRENCY;
    const refreshShare = async () => {
      const running = await countRunningJobs(jobId);
      share = Math.max(
        MIN_JOB_CONCURRENCY,
        Math.min(GENERATION_CONCURRENCY, Math.floor(GLOBAL_CALL_BUDGET / running))
      );
    };
    await refreshShare().catch(() => undefined);
    const shareTimer = setInterval(() => void refreshShare().catch(() => undefined), SHARE_REFRESH_MS);
    const limit = () =>
      openAiUnderPressure() ? Math.max(MIN_JOB_CONCURRENCY, Math.floor(share / 2)) : share;
    /** 이용자가 많아 몫이 줄었으면 진행 문구에 알린다. */
    const busyNote = () =>
      limit() < GENERATION_CONCURRENCY ? " · 이용자가 많아 조금 천천히 만드는 중" : "";

    /*
     * 문항마다 지금 무엇을 하는지 센다. 선생님 지적(2026-10-04): 막바지에 「260/273 완료」에서
     * 몇 분 서 있어 오류처럼 보였다. 실은 마지막 문항들이 검수에 걸려 다시 만들거나 다른 유형으로
     * 바꿔 만드는 중이었다. 그걸 그대로 보여 준다.
     */
    const stages = new Map<object, QgStage>();
    const stageNote = () => {
      const n: Record<QgStage, number> = { make: 0, check: 0, redo: 0, swap: 0 };
      for (const s of stages.values()) n[s] += 1;
      const parts = [
        n.make ? `만드는 중 ${n.make}` : "",
        n.check ? `검수 중 ${n.check}` : "",
        n.redo ? `검수에 걸려 다시 만드는 중 ${n.redo}` : "",
        n.swap ? `다른 유형으로 바꿔 만드는 중 ${n.swap}` : "",
      ].filter(Boolean);
      return parts.length ? ` · ${parts.join(" · ")}` : "";
    };
    const progressText = () =>
      `${completed + failed + skipped}/${totalRequested} 완료${skipped > 0 ? ` (생략 ${skipped})` : ""}${stageNote()}${busyNote()}`;
    let lastStageText = "";
    const pushStage = () => {
      const text = progressText();
      if (text === lastStageText || abandoned) return;
      lastStageText = text;
      void updateProgress(jobId, { progress_message: text }).catch(() => undefined);
    };
    // 줄여 쓰는 갱신(0.35초)에 마지막 바뀜이 묻히지 않게 몇 초마다 한 번 더 적는다
    const stageTimer = setInterval(() => {
      lastStageText = "";
      pushStage();
    }, 3000);

    /*
     * 유형마다 첫 문항을 먼저 끝내고 나머지를 돌린다 — 값을 아끼려는 것이다.
     *
     * 실험(2026-09-30): 같은 지문·같은 앞머리로 차례로 부르면 두 번째부터 입력의
     * 80%가 캐시로 들어간다(캐시 입력은 제값의 1/10). 그런데 실제로는 한 지문의
     * 문항을 한꺼번에 병렬로 부르다 보니 아무도 앞사람 캐시를 못 봐서, 하루치를
     * 재 보니 캐시가 3%뿐이었다.
     *
     * 유형 규칙을 프롬프트 앞으로 올려 두었으니(generate-question.ts), 유형마다
     * 한 발을 먼저 보내 캐시를 데우면 같은 유형의 나머지가 그 덕을 본다.
     * 보내는 차례만 바꾸는 것이라 문항 내용은 하나도 달라지지 않는다.
     */
    const byType = new Map<string, typeof work>();
    for (const item of work) {
      const k = item.option.key;
      byType.set(k, [...(byType.get(k) ?? []), item]);
    }
    // 유형끼리 모아 두고, 유형마다 첫 발을 먼저 보낸다
    const firstOfPassage: typeof work = [];
    const restOfWork: typeof work = [];
    for (const list of byType.values()) {
      if (list.length === 0) continue;
      firstOfPassage.push(list[0]!);
      restOfWork.push(...list.slice(1));
    }

    /** 문항 하나를 만들 때 넘기는 값 — 캐시 데우기도 똑같은 값으로 해야 첫 메시지가 같다 */
    const optsFor = (item: (typeof work)[number]) => ({
      passage: item.passageText,
      analysis: item.analysis,
      option: item.option,
      grade: config.grade || "고1",
      overallDifficulty: config.overallDifficulty || "기본",
      sourceDetail: item.sourceDetail,
      diversitySlot: item.diversitySlot,
      typeTurn: item.typeTurn,
      copyIndex: item.copyIndex,
      targetLevel: item.slot?.level ?? null,
      paraphraseGrammarVocab: config.paraphraseGrammarVocab === true,
      levelBrief: config.levelBrief,
      grammarScope: config.grammarScope,
      grammarWritingMode: config.grammarWritingMode,
      wordOrderMode: config.wordOrderMode ?? "passage",
      retries: item.slot ? 2 : undefined,
      setNote: item.setNote,
    });

    /*
     * 캐시 데우기(2026-10-03). 유형마다 첫 메시지(유형 규칙)만으로 한 번씩 불러 두면, 그 유형
     * 문항들이 그 부분을 캐시(값 1/10)로 읽는다. 이전에는 유형마다 첫 문항을 통째로 먼저
     * 만들고 다 끝날 때까지 나머지를 세워 두었다 — 검수가 붙은 뒤로 그 기다림이 1분을 넘었고,
     * 캐시는 gpt-5.6이 앞부분 일부만 같은 요청은 읽지 않아 거의 걸리지 않았다.
     * 데우기는 16토큰에서 끊는 짧은 호출이라 몇 초면 끝난다. 문항이 둘 이상인 묶음만 데운다.
     */
    const primeCaches = async () => {
      const groups = new Map<string, (typeof work)[number]>();
      const counts = new Map<string, number>();
      for (const item of work) {
        const k = `${item.option.key}|${item.slot?.level ?? ""}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (!groups.has(k)) groups.set(k, item);
      }
      const firsts = [...groups.entries()].filter(([k]) => (counts.get(k) ?? 0) >= 2).map(([, it]) => it);
      await runAdaptivePool(firsts, limit, async (item) => {
        setAiUsage({
          academyId,
          actorId: userId,
          featureKey: isGrammarType(item.option.key)
            ? "qg_generate_grammar"
            : isWritingType(item.option.key)
              ? "qg_generate_writing"
              : "qg_generate_job",
          usedFor: "question_generator",
          meta: { qgJobId: jobId },
        });
        await generateOneQuestion({ ...optsFor(item), primeOnly: true }).catch(() => undefined);
      });
    };

    const makeOne = async (item: (typeof work)[number]) => {
      if (Date.now() > dispatchUntil) {
        deferred += 1;
        return;
      }
      /*
       * 문장삽입·무관한문장: 문장 5개 이하면 만들지 않고 아래에서 다른 유형으로 바꿔 만든다.
       * 전에는 그냥 생략해 「150문항 중 142」가 됐다(정수학원 2026-10-03, 짧은 지문 8개의 문장삽입).
       */
      const sentenceCount = countEnglishSentences(item.passageText);
      const tooShortForSlots =
        (item.option.type === "sentence_insertion" || item.option.type === "irrelevant_sentence") &&
        sentenceCount < MIN_SENTENCES_FOR_INSERTION_IRRELEVANT;

      /*
       * 이 문항이 어느 값으로 걷히는지 기록에도 그대로 적는다.
       *
       * 전수조사(2026-09-30): 값은 어법·일반으로 나눠 받는데 사용량 기록은 모두
       * qg_generate_job 하나로 남아, 어법 유형의 원가를 따로 볼 수가 없었다.
       * 어법이 더 비싼지 아닌지를 모르면 값을 제대로 매길 수 없다.
       */
      setAiUsage({
        academyId,
        actorId: userId,
        featureKey: isGrammarType(item.option.key)
          ? "qg_generate_grammar"
          : isWritingType(item.option.key)
            ? "qg_generate_writing"
            : "qg_generate_job",
        usedFor: "question_generator",
        meta: { qgJobId: jobId },
      });

      const sigOf = (p: GeneratedQuestionPayload) =>
        dupSignature({ type: p.type, passageModified: p.passageModified, choices: p.choices, correctAnswer: p.correctAnswer });
      const duplicates = (p: GeneratedQuestionPayload) => {
        if (!dedupEnabled()) return false;
        const sig = sigOf(p);
        return !!sig && (dupSigs.get(item.passageId) ?? []).some((o) => isNearDuplicate(sig, o));
      };
      const duplicateNote = (p: GeneratedQuestionPayload) =>
        duplicates(p)
          ? `같은 지문의 다른 문항과 겹친다(정답 「${String(p.correctAnswer ?? "").slice(0, 80)}」, 같은 밑줄·같은 문장·같은 표현). 이 지문의 다른 문장·다른 표현을 골라 만든다.`
          : null;

      let result: Awaited<ReturnType<typeof generateWithValidation>> = tooShortForSlots
        ? ({ payload: null, skipped: true, error: `지문이 ${sentenceCount}문장뿐이라 번호 자리를 만들 수 없음` } as unknown as Awaited<ReturnType<typeof generateWithValidation>>)
        : await generateWithValidation({
            ...optsFor(item),
            onStage: (s) => {
              stages.set(item, s);
              pushStage();
            },
            duplicateNote,
          });
      reviewDropped += result.reviewDropped ?? 0;
      // 다음 실행이 이 문항을 다시 만든다. 여기서 저장하면 같은 칸이 두 번 생긴다.
      if (abandoned) return;

      /*
       * 같은 지문의 같은 유형 문항과 사실상 같으면 버리고 아래에서 다른 유형으로 만든다.
       * 정수학원 세 작업 조건부 25개 중 4개가 이 중복이었다(2026-10-04).
       */
      // 시도 사이에 다른 문항이 먼저 저장됐을 수 있어 한 번 더 본다
      if (result.payload && duplicates(result.payload)) {
        result = { ...result, payload: null, skipped: false, error: "같은 지문의 같은 유형 문항과 사실상 같음" } as typeof result;
      }

      /*
       * 빠지는 문항을 두지 않는다. 동형모의고사는 번호가 빠지면 1번부터 나오지 않고
       * 배점도 모자란다.
       *
       * 선생님 지적(2026-10-01): 만들다 버린 값도 우리가 낸다. 빠질 것 같으면 아예
       * 만들지 말든가 다 만들든가 해야 한다. 지금까지는 설계도 칸(동형모의고사)만
       * 다른 유형으로 살리고, 보통 변형문제는 그냥 빠졌다. 값은 이미 다 치렀는데
       * 문항은 없는 꼴이라 제일 아깝다.
       *
       * 이제 어느 쪽이든 다른 유형으로 바꿔 한 번 더 만든다. 난이도는 그대로 둔다.
       */
      let substitutedFrom: string | null = null;
      let substitutedReason: string | null = null;
      let substitutedFromKey: string | null = null;
      const requestedKey = item.option.key;
      /*
       * 다른 유형으로 바꿔 만들지 않을 유형(시험용 스위치 QG_NO_SUB_CODES, 쉼표로). 특정표현처럼 맞는 지문이 드문
       * 유형을 「되는 지문에서만 만들기」로 할지 「다른 유형으로 대체」로 할지 비교한다(2026-10-04).
       */
      const noSub = new Set((process.env.QG_NO_SUB_CODES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      // 어휘는 다른 유형으로 바꾸지 않는다 — 다만 도표 지문이면 어휘 자체를 안 만들어 번호가 비므로 바꾼다
      const chart = isChartDescriptionPassage(cleanSourcePassage(String(item.passageText ?? "")));
      if ((result.skipped || !result.payload) && (item.option.type !== "vocabulary" || chart) && !noSub.has(item.option.aingkaCode ?? "")) {
        const requestedLabel = item.option.label || item.option.key.split(":").pop() || "";
        /*
         * 왜 고른 유형으로 안 됐는지 적어 둔다.
         *
         * 선생님 물음(2026-10-01): 탈락한 문제들은 왜 그런지도 파악하면 좋겠다.
         * 지금까지는 대체가 성공하면 원래 까닭이 아무 데도 안 남아, 어떤 유형이
         * 어떤 자리에서 걸리는지 알 수가 없었다(버려진 문항 기록은 대체까지 실패할
         * 때만 쌓인다).
         */
        substitutedReason = result.error ?? "까닭 없음";
        const level = item.slot?.level ?? (item.option.difficulty === "high" ? "상" : "하");
        /*
         * 그 지문에 이미 있는 유형은 뒤로 미룬다. 순서추론이 안 돼서 바꾼 것이 같은 지문의 다른
         * 순서추론과 단락까지 똑같이 나온 일이 있었다(정수학원 193문항 중 3건, 2026-10-04).
         */
        const siblings = work.filter((w) => w !== item && w.passageId === item.passageId);
        const usedTypes = new Set(siblings.map((w) => w.option.type));
        /*
         * 같은 갈래(서술형끼리)는 option.type이 둘뿐이라 갈래로만 보면 거르지 못한다. 시험 50문항
         * (2026-10-04)에서 대체 5개가 모두 그 지문에 이미 있는 요약문빈칸2단어로 가서 답까지 겹쳤다.
         * 똑같은 유형(키)이 있으면 가장 뒤로, 같은 갈래면 그다음으로 미룬다.
         */
        const usedKeys = new Set(siblings.map((w) => w.option.key));
        const usedScore = (o: QuestionTypeOption) => (usedKeys.has(o.key) ? 2 : 0) + (usedTypes.has(o.type) ? 1 : 0);
        const alternatives = fallbackOptionsFor(item.option.key, level, item.typeTurn ?? item.copyIndex ?? 0, chart)
          // 1지문 다문항: 한 지문에 합칠 수 있는 유형만(같은 표시를 쓰는 유형·지문을 자르는 유형은 뺀다)
          .filter((alt) => !setCfg || setFallbackAllowed(alt.key, siblings.map((w) => w.option.key)))
          .sort((a, b) => usedScore(a) - usedScore(b));
        // 대체 후보는 앞의 셋까지만 — 다 실패하는 지문에서 후보마다 두 번씩 값만 쓰던 것을 막는다
        for (const alt of alternatives.slice(0, 3)) {
          const retry = await generateWithValidation({
            passage: item.passageText,
            analysis: item.analysis,
            option: alt,
            grade: config.grade || "고1",
            overallDifficulty: config.overallDifficulty || "기본",
            sourceDetail: item.sourceDetail,
            diversitySlot: item.diversitySlot,
            typeTurn: item.typeTurn,
            // 대체로 만든 문항은 그 유형의 원래 사본(0·1번)과 겹치기 쉽다 — 셋째 사본처럼 다르게 만들게 한다
            copyIndex: (item.copyIndex ?? 0) + 2,
            targetLevel: item.slot?.level ?? null,
            paraphraseGrammarVocab: config.paraphraseGrammarVocab === true,
            levelBrief: config.levelBrief,
            grammarScope: config.grammarScope,
            grammarWritingMode: config.grammarWritingMode,
            wordOrderMode: config.wordOrderMode ?? "passage",
            retries: 1,
            setNote: item.setNote,
            onStage: () => {
              stages.set(item, "swap");
              pushStage();
            },
            duplicateNote,
          });
          if (retry.payload && !duplicates(retry.payload)) {
            reviewDropped += retry.reviewDropped ?? 0;
            result = retry;
            item.option = alt;
            substitutedFrom = requestedLabel;
            substitutedFromKey = requestedKey;
            dropped.push(`[${requestedLabel} → ${alt.label || alt.key.split(":").pop()}] ${substitutedReason}`);
            break;
          }
        }
      }

      if (result.skipped) {
        skipped += 1;
        // 생략 까닭도 남긴다 — 「생략 39」만 보이면 왜 빠졌는지 알 수 없다(2026-10-03)
        dropped.push(`[${item.option.label || item.option.key.split(":").pop()}] 생략: ${result.error ?? ""}`);
      } else if (!result.payload) {
        failed += 1;
        // 선생님께 보일 「못 만든 문항」 안내가 유형별로 셀 수 있게 이름을 붙인다
        dropped.push(`[${item.option.label || item.option.key.split(":").pop()}] 못 만듦: ${result.error ?? "까닭 없음"}`);
      } else {
        completed += 1;
        rememberDup(item.passageId, sigOf(result.payload));
        const savedPayload = result.payload;
        const insert = admin.from("generated_english_questions").insert(
          toRow(result.payload, {
            passageId: item.passageId,
            jobId,
            option: item.option,
            userId,
            academyId,
            attempt: result.attempt,
            status: "approved",
            validationScore: result.payload.validation?.overallScore ?? null,
            errorMessage: null,
            slot: item.slot ?? null,
            substitutedFrom,
            substitutedReason,
            substitutedFromKey,
            setSlotIndex: item.setPos !== undefined ? (item.setBase ?? 0) + item.setPos : null,
          })
        ).select("id").single();
        const tracked: Promise<unknown> = Promise.resolve(insert)
          .then((r) => {
            const id = (r.data as { id?: string } | null)?.id;
            if (id) item.saved = { id, payload: savedPayload };
          })
          .finally(() => inserts.delete(tracked));
        inserts.add(tracked);
        await tracked;
      }

      stages.delete(item);
      await updateProgress(jobId, {
        total_completed: completed,
        total_failed: failed,
        progress_message: progressText(),
      });
    };

    /*
     * 1지문 다문항: 시험지에는 지문을 무조건 한 번만 찍는다(선생님 2026-10-11).
     * 표시형(빈칸·어법·어휘·함축·제시어배열…) 문항은 원문 위에서 하나씩 차례로 만들고, 뒤 문항은 앞 문항이
     * 빈칸·밑줄을 친 문장을 피하게 한다. 바꾼 자리를 원문 위에 겹쳐(mergeMarkedPassages) 공용 지문을 만들고,
     * 겹쳐지지 않으면 뒤 문항을 한 번 다시 만든다. 그다음 읽기형 문항에 공용 지문을 알려 주며 만든다.
     * 문항끼리 답이 겹쳐도 둔다(연습용) — 세트 검수는 하지 않는다.
     */
    const redoSaved = async (it: (typeof work)[number], note: string) => {
      const redo = await withAiUsage(
        {
          academyId,
          actorId: userId,
          featureKey: isGrammarType(it.option.key)
            ? "qg_generate_grammar"
            : isWritingType(it.option.key)
              ? "qg_generate_writing"
              : "qg_generate_job",
          usedFor: "question_generator",
          meta: { qgJobId: jobId },
        },
        () => generateWithValidation({ ...optsFor(it), retries: 1, setNote: note })
      );
      if (!redo.payload || !it.saved) return;
      const row = toRow(redo.payload, {
        passageId: it.passageId,
        jobId,
        option: it.option,
        userId,
        academyId,
        attempt: redo.attempt,
        status: "approved",
        validationScore: redo.payload.validation?.overallScore ?? null,
        errorMessage: null,
        setSlotIndex: (it.setBase ?? 0) + (it.setPos ?? 0),
      });
      const { error } = await admin.from("generated_english_questions").update(row).eq("id", it.saved.id);
      if (!error) it.saved = { id: it.saved.id, payload: redo.payload };
    };

    const makeSet = async (list: typeof work) => {
      if (!setCfg) return;
      const original = cleanSourcePassage(list[0]!.passageText);
      /*
       * 표시형·읽기형은 만들기 전에 갈라 둔다. 표시형(함축·빈칸 상)이 안 돼 읽기형(제목·주제)으로 바뀌면
       * makeOne이 it.option을 바꾸는데, 그 뒤에 갈랐더니 같은 문항을 읽기형으로 한 번 더 만들었다
       * (2026-10-11 72문항 작업이 75문항 — 대체가 난 지문 셋에서 하나씩 더).
       */
      /*
       * 문장 하나를 통째로 쓰는 표시형(제시어배열·빈칸·함축·지칭…)을 먼저, 밑줄을 여러 군데 흩어 치는
       * 어휘·어법을 나중에 만든다. 어휘추론이 먼저 세 문장짜리 지문 전부에 밑줄을 치자 뒤의 제시어배열이
       * 비울 문장이 없어, 다시 만들어도 겹친 채 저장됐다(2026-10-11 75문항 작업 두 지문).
       */
      const SPREAD = /(어휘추론|어법추론|어법개수|어휘개수|어법오류수정2|어법오류수정3)$/;
      const markers = list
        .filter((it) => isSetMarkKey(it.option.key))
        .sort((x, y) => Number(SPREAD.test(x.option.key)) - Number(SPREAD.test(y.option.key)));
      const readers = list.filter((it) => !isSetMarkKey(it.option.key));
      const avoidNote = (done: (typeof work)[number][]) => {
        const used = done.flatMap((d) =>
          d.saved ? markedSentences(d.saved.payload.passageOriginal || original, d.saved.payload.passageModified ?? "") : []
        );
        if (used.length === 0) return undefined;
        return [
          `Another item in this set already puts a blank or underlines in these sentences of the same printed passage. Do NOT put any blank, underline or change in them — choose your spots only in the other sentences, and keep every other word of the passage exactly as it is:`,
          ...used.map((t) => `- ${t}`),
        ].join("\n");
      };
      const merged = (done: (typeof work)[number][]) => {
        const saved = done.filter((d) => d.saved);
        if (saved.length === 0) return null;
        const base = saved[0]!.saved!.payload.passageOriginal || original;
        return mergeMarkedPassages(
          base,
          saved.map((d) => sharedPassageOf(d.saved!.payload, base))
        );
      };
      const done: (typeof work)[number][] = [];
      for (const m of markers) {
        m.setNote = avoidNote(done);
        await makeOne(m);
        // 앞 문항이 쓴 문장을 건드려 한 지문에 겹쳐지지 않았다 — 두 번까지 다시 만든다
        for (let t = 0; t < 2 && m.saved && done.some((d) => d.saved) && merged([...done, m]) === null && !abandoned; t++) {
          await redoSaved(m, `${avoidNote(done) ?? ""}\nYour previous version touched one of those sentences, so the marks could not share one printed passage.`);
        }
        done.push(m);
      }
      const shared = merged(done);
      await Promise.all(
        readers
          .map((it) => {
            it.setNote = setNoteFor({ size: setCfg.size, position: it.setPos ?? 0, sharedPassage: shared });
            return makeOne(it);
          })
      );
    };

    const pool = (async () => {
      await primeCaches();
      if (setCfg) {
        const byPassage = new Map<string, typeof work>();
        for (const it of work) byPassage.set(it.passageId, [...(byPassage.get(it.passageId) ?? []), it]);
        // 세트 하나가 문항을 둘씩 동시에 부르므로 세트 수는 절반으로
        await runAdaptivePool([...byPassage.values()], () => Math.max(1, Math.floor(limit() / 2)), makeSet);
      } else {
        await runAdaptivePool([...firstOfPassage, ...restOfWork], limit, makeOne);
      }
    })();

    let hardStop: ReturnType<typeof setTimeout> | undefined;
    let finishedInTime: boolean;
    try {
      finishedInTime = await Promise.race([
        pool.then(() => true),
        new Promise<false>((resolve) => {
          hardStop = setTimeout(
            () => resolve(false),
            Math.max(0, startedAt + CHUNK_HARD_STOP_MS - Date.now())
          );
        }),
      ]);
    } finally {
      clearTimeout(hardStop);
      clearInterval(shareTimer);
      clearInterval(stageTimer);
    }

    if (!finishedInTime || deferred > 0) {
      // 남은 문항은 다음 실행에 넘긴다. 저장 중이던 문항까지 끝난 뒤에 세어야
      // 다음 실행이 이미 만든 칸을 다시 만들지 않는다.
      abandoned = true;
      await Promise.allSettled([...inserts]);
      const saved = await countSavedQuestions(jobId);
      await updateJob(jobId, {
        status: "pending",
        total_completed: saved,
        total_failed: 0,
        progress_message: `${saved}/${totalRequested} 완료 · 이어서 만드는 중`,
      });
      return { more: true };
    }

    await finalizeGenerationJob(jobId, {
      totalRequested,
      skipped,
      dropped,
      reviewDropped,
    });
    return { more: false };
  } catch (e) {
    const saved = await countSavedQuestions(jobId);
    const cfgBlueprint = (job.request_config as GenerationRequestConfig)?.blueprint;
    const totalRequested = Array.isArray(cfgBlueprint) && cfgBlueprint.length > 0
      ? cfgBlueprint.length
      : (job.request_config as GenerationRequestConfig)
      ?.counts
      ? expandCountRequests(
          sanitizeCounts(
            (job.request_config as GenerationRequestConfig).counts ?? {},
            MAX_SETS_PER_TYPE
          )
        ).length *
        (Array.isArray(
          (job.request_config as GenerationRequestConfig).passageIds
        ) &&
        ((job.request_config as GenerationRequestConfig).passageIds?.length ??
          0) > 0
          ? (job.request_config as GenerationRequestConfig).passageIds!.length
          : 1)
      : saved;

    if (saved > 0) {
      await finalizeGenerationJob(jobId, {
        totalRequested: Math.max(totalRequested, saved),
        skipped: 0,
        errorMessage:
          e instanceof Error
            ? `일부 문항만 저장됨: ${e.message}`
            : "일부 문항만 저장됨",
      });
    } else {
      await updateJob(jobId, {
        status: "failed",
        error_message: e instanceof Error ? e.message : "생성 작업 실패",
        completed_at: new Date().toISOString(),
      });
    }
    return { more: false };
  }
}

/**
 * 시험지 번호를 비우지 않기 위한 대체 유형.
 *
 * 선생님 지적(2026-09-30): 미생성이 하나라도 있으면 번호가 1번부터 안 나온다.
 * 배점을 다 채워야 100점이 되므로, 그 지문에 안 맞는 유형이면 다른 유형으로라도
 * 만들어 번호를 채운다. 어떤 지문에도 낼 수 있는 유형부터 차례로 시도한다.
 */
/*
 * 대체 유형은 고른 유형과 같은 갈래에서 먼저 찾고, 객관식은 차례를 돌려 한 유형으로 몰리지 않게 한다.
 * 254문항 작업(2026-10-03)은 대체 35개 가운데 27개가 제목추론으로 가, 한 지문에 제목추론이
 * 20개나 됐다. 서술형·어법을 고른 선생님에게 제목추론이 쌓이면 시험지가 안 된다.
 */
/**
 * chart: 도표 설명 지문이면 주제·제목·요지·순서가 모두 「도표에 안 맞는 유형」이라 후보 셋이 다 생략돼 동형모의고사
 * 번호가 비었다(2026-10-12 호원고2 9·10차 26문항 중 25). 그때는 내용일치·불일치로 바꿔 만든다.
 */
function fallbackOptionsFor(optionKey: string, level: "상" | "중" | "하", turn = 0, chart = false) {
  const tier = level === "상" ? "high" : "low";
  const rotate = (list: string[]) => {
    const k = Math.abs(Math.floor(turn)) % list.length;
    return [...list.slice(k), ...list.slice(0, k)];
  };
  const keys = /^grammar:/.test(optionKey)
    ? ["grammar:na:default:어법추론", "grammar:na:default:어법개수"]
    : /^(writing|summary_short):/.test(optionKey)
      ? [
          "writing:na:default:제시어배열기본",
          "summary_short:na:default:요약문빈칸2단어",
          "writing:na:default:제시어배열어형변화",
          "summary_short:na:default:요약문빈칸3단어",
          "summary_short:na:default:요약문빈칸영작",
        ]
      : /sentence_insertion|irrelevant_sentence/.test(optionKey)
        ? [`order:na:${tier}:순서추론`, ...rotate([`topic:en:${tier}:주제추론`, `title:en:${tier}:제목추론`])]
        : rotate([
            `topic:en:${tier}:주제추론`,
            `title:en:${tier}:제목추론`,
            `summary_mcq:en:${tier}:요지추론`,
            `order:na:${tier}:순서추론`,
          ]);
  const out = [];
  for (const k of keys) {
    if (k === optionKey) continue;
    const got = findOptionByKey(k);
    if (got && !(chart && CHART_UNFIT_TYPES.has(got.type))) out.push(got);
  }
  if (chart && out.length === 0) {
    for (const k of rotate([`content_true:en:${tier}:내용일치`, `content_false:en:${tier}:내용불일치`])) {
      const got = k === optionKey ? null : findOptionByKey(k);
      if (got) out.push(got);
    }
  }
  return out;
}

export async function regenerateSingleQuestion(opts: {
  questionId: string;
  mode: "full" | "choices";
}): Promise<void> {
  const admin = createAdminClient();
  const { data: q } = await admin
    .from("generated_english_questions")
    .select("*")
    .eq("id", opts.questionId)
    .single();

  if (!q) throw new Error("문제를 찾을 수 없습니다.");

  const { data: passageRow } = await admin
    .from("english_source_passages")
    .select("passage, grade, overall_difficulty, analysis, source_detail")
    .eq("id", q.passage_id)
    .single();

  if (!passageRow) throw new Error("지문을 찾을 수 없습니다.");

  const option = findOptionByKey(q.option_key ?? "") ?? {
    key: q.option_key ?? `${q.question_type}:na:default`,
    type: q.question_type,
    category: q.category,
    label: q.question_type,
    difficulty: q.difficulty,
    choiceLanguage: q.choice_language,
    isObjective: true,
    preview: "",
  };

  let analysis = passageRow.analysis as PassageAnalysis | null;
  if (!analysis) {
    analysis = await analyzePassage({
      passage: passageRow.passage,
      grade: passageRow.grade,
      overallDifficulty: passageRow.overall_difficulty,
    });
  }

  const result = await generateWithValidation({
    passage: passageRow.passage,
    analysis,
    option: option as QuestionTypeOption,
    grade: passageRow.grade,
    overallDifficulty: passageRow.overall_difficulty,
    sourceDetail: passageRow.source_detail || undefined,
  });

  if (!result.payload) {
    throw new Error(result.error ?? "재생성에 실패했습니다. 문항을 삭제하세요.");
  }

  const before = { ...q };
  const patch: Record<string, unknown> = {
    instruction: result.payload.instruction,
    question_text: result.payload.questionText,
    passage_modified: result.payload.passageModified ?? null,
    choices: result.payload.choices ?? null,
    correct_answer: result.payload.correctAnswer,
    acceptable_answers: result.payload.acceptableAnswers ?? null,
    explanation: result.payload.explanation,
    evidence: [],
    scoring_guide: result.payload.scoringGuide ?? null,
    validation_result: result.payload.validation ?? null,
    validation_score: result.payload.validation?.overallScore ?? null,
    status: "approved",
    generation_attempt: (q.generation_attempt ?? 1) + 1,
    error_message: null,
    approved_by: q.created_by,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (opts.mode === "choices") {
    // keep instruction/question stem if possible; still overwrite choices/answer/explanation
    delete patch.instruction;
    delete patch.question_text;
    delete patch.passage_modified;
  }

  await admin
    .from("generated_english_questions")
    .update(patch)
    .eq("id", opts.questionId);

  await admin.from("question_edit_history").insert({
    question_id: opts.questionId,
    before_data: before,
    after_data: patch,
    edited_by: q.created_by,
  });
}
