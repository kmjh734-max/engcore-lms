import {
  MAX_PASSAGES,
  MAX_SETS_PER_TYPE,
  MAX_TOTAL_QUESTIONS,
  MIN_PASSAGE_WORDS,
} from "@/lib/question-generator/constants";
import { resolvePassages, truncatedPassageEnd, wordCount } from "@/lib/question-generator/passages";
import { findOptionByKey, sanitizeCounts, sumCounts } from "@/lib/question-generator/question-types";
import { passageSetCounts, passageSetProblem } from "@/lib/question-generator/passage-set";
import type { GenerationRequestConfig } from "@/lib/question-generator/types";
import type { createClient } from "@/lib/supabase/server";

/**
 * 변형문제 작업 만들기(지문 저장 + 작업 행). 변형문제 화면과 동형모의고사가 함께 쓴다.
 * 만든 작업은 pending — 실행은 부른 쪽이 시작한다.
 */
export type CreateJobOk = {
  jobId: string;
  passageId: string;
  passageIds: string[];
};
export type CreateJobErr = { error: string; status?: number };

export async function createJobFromConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  academyId: string,
  config: GenerationRequestConfig,
  reuse?: { reuseJobId: string; role: string }
): Promise<CreateJobOk | CreateJobErr> {
  // 1지문 다문항: 세트 구성이 곧 유형별 개수다(크레딧·요청 수 계산이 그대로 맞는다)
  if (config.passageSet) {
    const problem = passageSetProblem(config.passageSet);
    if (problem) return { error: problem, status: 400 };
    config.counts = passageSetCounts(config.passageSet);
    config.blueprint = undefined;
  }
  config.counts = sanitizeCounts(config.counts, MAX_SETS_PER_TYPE);

  const passages = resolvePassages(config);
  if (passages.length === 0) {
    return { error: "영어 지문을 1개 이상 입력해 주세요.", status: 400 };
  }
  if (passages.length > MAX_PASSAGES) {
    return {
      error: `지문은 최대 ${MAX_PASSAGES}개까지 넣을 수 있습니다.`,
      status: 400,
    };
  }

  for (let i = 0; i < passages.length; i++) {
    const wc = wordCount(passages[i]!.text);
    if (wc < Math.min(15, MIN_PASSAGE_WORDS)) {
      return {
        error: `지문 ${i + 1}이(가) 너무 짧습니다. 더 긴 영어 지문을 입력해 주세요.`,
        status: 400,
      };
    }
    const cut = truncatedPassageEnd(passages[i]!.text);
    if (cut) {
      return {
        error: `지문 ${i + 1}이(가) 「…${cut}」에서 마침표 없이 끝납니다. 글이 잘리지 않았는지 확인하고, 끝 문장까지 넣거나 마침표를 찍어 주세요.`,
        status: 400,
      };
    }
  }

  let total: number;
  if (Array.isArray(config.blueprint) && config.blueprint.length > 0) {
    // 설계도: 칸마다 지문 번호·유형·난이도가 맞는지 확인
    const bad = config.blueprint.find(
      (b) =>
        !Number.isInteger(b.passageIndex) ||
        b.passageIndex < 0 ||
        b.passageIndex >= passages.length ||
        !findOptionByKey(b.optionKey) ||
        !["상", "중", "하"].includes(b.level)
    );
    if (bad) return { error: `설계도 ${bad.no}번 칸이 올바르지 않습니다.`, status: 400 };
    total = config.blueprint.length;
    if (total > MAX_TOTAL_QUESTIONS) {
      return { error: `한 번에 최대 ${MAX_TOTAL_QUESTIONS}문항까지 생성할 수 있습니다.`, status: 400 };
    }
  } else {
    const perPassage = sumCounts(config.counts ?? {}).total;
    if (perPassage <= 0) {
      return { error: "생성할 문항 수를 1개 이상 선택해 주세요.", status: 400 };
    }
    total = perPassage * passages.length;
    if (total > MAX_TOTAL_QUESTIONS) {
      return {
        error: `한 번에 최대 ${MAX_TOTAL_QUESTIONS}문항까지 생성할 수 있습니다. (지문 ${passages.length}개 × ${perPassage}문항 = ${total})`,
        status: 400,
      };
    }
  }
  for (const n of Object.values(config.counts ?? {})) {
    if (n < 0 || n > MAX_SETS_PER_TYPE) {
      return {
        error: `유형별 세트 수는 0~${MAX_SETS_PER_TYPE}입니다.`,
        status: 400,
      };
    }
  }

  if (reuse?.reuseJobId) {
    let jobQ = supabase
      .from("question_generation_jobs")
      .select("id, status, created_by")
      .eq("id", reuse.reuseJobId);
    if (reuse.role === "teacher") {
      jobQ = jobQ.eq("created_by", userId);
    }
    const { data: existing, error: exErr } = await jobQ.maybeSingle();
    if (exErr) {
      return { error: exErr.message, status: 500 };
    }
    if (!existing) {
      return { error: "이어서 생성할 작업을 찾을 수 없습니다.", status: 404 };
    }
    if (
      ["analyzing", "generating", "validating"].includes(
        String(existing.status)
      )
    ) {
      return {
        error: "이미 생성 중인 작업입니다. 잠시 후 다시 시도해 주세요.",
        status: 409,
      };
    }
  }

  const passageIds: string[] = [];

  for (const p of passages) {
    const { data: passageRow, error: pErr } = await supabase
      .from("english_source_passages")
      .insert({
        title: p.title,
        passage: p.text,
        school_name: config.schoolName?.trim() || null,
        grade: config.grade || "고1",
        source_type: config.sourceType || "자체 지문",
        source_detail: p.sourceDetail || null,
        overall_difficulty: config.overallDifficulty || "기본",
        draft_config: config,
        created_by: userId,
        academy_id: academyId,
      })
      .select("id")
      .single();

    if (pErr || !passageRow) {
      return {
        error: pErr?.message ?? "지문 저장에 실패했습니다.",
        status: 500,
      };
    }
    passageIds.push(passageRow.id);
  }

  const primaryId = passageIds[0]!;
  const requestConfig: GenerationRequestConfig = {
    ...config,
    passage: passages[0]!.text,
    passages: passages.map((p) => ({
      clientId: p.clientId,
      title: p.title,
      sourceDetail: p.sourceDetail,
      text: p.text,
    })),
    passageIds,
  };

  if (reuse?.reuseJobId) {
    // 기존 문항 제거 후 같은 job에 설정만 갱신 (새 목록 항목 방지)
    const { error: delQErr } = await supabase
      .from("generated_english_questions")
      .delete()
      .eq("generation_job_id", reuse.reuseJobId);
    if (delQErr) {
      return { error: delQErr.message, status: 500 };
    }

    const { data: job, error: jErr } = await supabase
      .from("question_generation_jobs")
      .update({
        passage_id: primaryId,
        generation_mode: config.mode || "custom",
        preset_id: config.presetId || null,
        request_config: requestConfig,
        status: "pending",
        total_requested: total,
        total_completed: 0,
        total_failed: 0,
        error_message: null,
        completed_at: null,
        progress_message: "대기 중",
      })
      .eq("id", reuse.reuseJobId)
      .select("id")
      .single();

    if (jErr || !job) {
      return {
        error: jErr?.message ?? "작업 갱신에 실패했습니다.",
        status: 500,
      };
    }

    return {
      jobId: job.id as string,
      passageId: primaryId,
      passageIds,
    };
  }

  const { data: job, error: jErr } = await supabase
    .from("question_generation_jobs")
    .insert({
      passage_id: primaryId,
      generation_mode: config.mode || "custom",
      preset_id: config.presetId || null,
      request_config: requestConfig,
      status: "pending",
      total_requested: total,
      created_by: userId,
      academy_id: academyId,
      progress_message: "대기 중",
    })
    .select("id")
    .single();

  if (jErr || !job) {
    return {
      error: jErr?.message ?? "작업 생성에 실패했습니다.",
      status: 500,
    };
  }

  return {
    jobId: job.id as string,
    passageId: primaryId,
    passageIds,
  };
}

