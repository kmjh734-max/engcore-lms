import { createLimiter, type Limiter } from "@/lib/lesson-materials/grammar-choice-v2/limiter";
import { callGrammarChoiceV2Json, parseModelJson } from "@/lib/lesson-materials/grammar-choice-v2/openai-call";
import {
  analyzerSystemPrompt,
  buildAnalyzerUserPayload,
} from "@/lib/lesson-materials/grammar-choice-v2/runtime-prompt";
import { isKnownPointCode } from "@/lib/lesson-materials/grammar-choice-v2/grammar-ontology";
import { detectedPointsFromSentences } from "@/lib/lesson-materials/grammar-choice-v2/local-candidates";
import type {
  AnalysisHintV2,
  DetectedGrammarPoint,
  ExactSentence,
  GrammarCandidate,
  GrammarPriority,
  GrammarTransformCode,
  LocalMandatoryHint,
  OmissionReason,
  Questionability,
  RiskLevel,
} from "@/lib/lesson-materials/grammar-choice-v2/types";

const PRIORITIES = new Set(["MANDATORY", "CORE", "BASIC"]);
const TRANSFORMS = new Set([
  "FORM_SWAP",
  "NUMBER_SWAP",
  "TENSE_SWAP",
  "VOICE_SWAP",
  "WORD_ORDER",
  "CLAUSE_MARKER",
  "NONFINITE_SWAP",
  "CASE_SWAP",
  "PARALLEL_FORM",
  "CONDITIONAL_FORM",
  "RELATIVE_CHOICE",
  "ADJ_ADV",
]);
const OMISSION_ENUM = [
  "",
  "NO_UNIQUE_DISTRACTOR",
  "OVERLAPPING_HIGHER_PRIORITY_POINT",
  "OVERLAP_WITH_HIGHER_PRIORITY",
  "SOURCE_FORM_NOT_EDITABLE",
  "DUPLICATE_SUBTYPE",
  "NOT_PEDAGOGICALLY_USEFUL",
] as const;

const OMISSIONS = new Set<string>(OMISSION_ENUM.filter(Boolean));
const TRANSFORM_ENUM = [...TRANSFORMS];

/** @deprecated 지문 전체를 한 호출로 보내던 시절의 상한. GENERATOR_CHUNK_OUTPUT_TOKEN_CAP를 쓴다. */
export const GENERATOR_OUTPUT_TOKEN_CAP = 12_000;

const ANALYZER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sentences"],
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sentenceId", "candidates"],
        properties: {
          sentenceId: { type: "string" },
          candidates: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "pointCode",
                "sourceSpan",
                "occurrenceIndex",
                "correctAnswer",
                "distractor",
                "priority",
                "difficulty",
                "riskLevel",
                "transformCode",
              ],
              properties: {
                pointCode: { type: "string" },
                sourceSpan: { type: "string" },
                occurrenceIndex: { type: "integer" },
                correctAnswer: { type: "string" },
                distractor: { type: "string" },
                transformCode: { type: "string", enum: TRANSFORM_ENUM },
                priority: { type: "string", enum: ["MANDATORY", "CORE", "BASIC"] },
                difficulty: { type: "string", enum: ["BASIC", "CORE", "ADVANCED"] },
                riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
              },
            },
          },
        },
      },
    },
  },
} ;

export type AnalyzerResult = {
  detected: DetectedGrammarPoint[];
  candidates: GrammarCandidate[];
  responseModel: string;
  promptChars: number;
  rawJson: string;
  parsed: unknown;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  fallback: boolean;
  /** 이 지문이 실제로 쓴 분석 호출 수. 문장 묶음 하나가 곧 한 호출이다. */
  callCount: number;
};

/**
 * 한 번의 분석 호출에 넣는 문장 수. 지문 전체를 한 호출에 넣으면 모델이 앞쪽
 * 몇 개만 실제로 분석하고 나머지는 만들기 쉬운 축(수일치·시제)으로 때운다.
 * 관측: 11문장 1호출에서 후보 16개 중 2개만 생존(폐기율 87%).
 *
 * 1문장인 이유는 속도다. 지연은 출력 토큰 수에 정비례하는데(실측 회귀
 * 17.1ms/토큰, 약 58 tok/s) 묶음 크기가 곧 출력 크기다. 3문장 묶음은
 * 호출당 출력 1,868토큰 / 지연 26.2초였다(실측 low, n=28). 1문장으로 쪼개면
 * 호출당 출력이 1/3이 되어 호출 자체가 빨라지고, 남는 호출은 전역 게이트가
 * 병렬로 흘린다. 묶음을 키워 봐야 같은 토큰을 직렬로 뱉을 뿐이다.
 */
/*
 * 2026-11-10 3으로 올림(원가). 위 실측은 effort=low 때였다. 지금은 none이라 1문장 호출의 출력이 163토큰뿐이고,
 * 원가의 대부분이 호출마다 다시 읽는 7천 토큰 지시문이었다(지문당 sol 16번, 지문당 217원 · 400크레딧 = 1.84배).
 * 같은 8지문을 1문장/3문장으로 나란히 돌림: 문항 45→45·48→54, 지문당 198→147원·199→163원, 24초→21초·19초.
 * 직접 풀어 본 품질은 같은 수준(둘 다 흐린 문항 1~2개). 시험 스크립트 scripts/tmp-rv/goldset/_gc-variant.mts
 */
export const ANALYZER_SENTENCES_PER_CALL = 3;

/**
 * 문장 하나에 허용하는 후보 수. 호출 상한은 묶음 크기에 비례해 잡는다.
 *
 * 호출당 4개로 고정했더니 3문장 묶음에서 상한이 그대로 천장이 됐다
 * (관측: 3문장 지문에서 정확히 4문항). 거를 후보가 남지 않으면 나쁜 문항을
 * 버릴 수 없어서, 뒤쪽 필터를 아무리 조여도 품질이 오르지 않는다.
 * 억지 후보는 상한이 아니라 "상한을 채우지 말라"는 프롬프트 지시가 막는다.
 */
/**
 * 문장 하나에서 요구할 후보 상한.
 *
 * 3에서 5로 올린다. 한 문장에 문법 지점이 여럿 들어 있는 것이 정상이고,
 * 선생님도 한 문장에 여러 문법이 들어가도 된다고 했다. 3이면 모델이 가장
 * 눈에 띄는 것만 내고 나머지를 버린다.
 */
export const ANALYZER_CANDIDATES_PER_SENTENCE = 5;

/**
 * 호출자가 게이트를 넘겨주지 않을 때 쓰는 지문 단독 상한.
 * 실행 경로(generate.ts)는 지문 전체가 공유하는 게이트를 넘긴다.
 */
export const ANALYZER_CHUNK_CONCURRENCY = 8;

/**
 * 문장 묶음 호출의 출력 상한.
 *
 * GPT-5 계열에서 max_completion_tokens는 reasoning 토큰까지 함께 센다.
 * effort=high는 reasoning이 크게 늘어 5,000에서는 응답이 통째로 잘렸다
 * (관측: 4개 지문 전부 TOKEN_LIMIT). 상한은 천장일 뿐 실제 지출이 아니므로
 * 잘림을 막을 만큼 넉넉히 둔다. 품질은 문장 분할과 candidateCap이 잡는다.
 */
export const GENERATOR_CHUNK_OUTPUT_TOKEN_CAP = 16_000;

type AnalyzerSentenceRow = {
  sentenceId?: string;
  detectedPoints?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
};

function chunkSentences(
  sentences: ExactSentence[],
  size: number
): ExactSentence[][] {
  const chunks: ExactSentence[][] = [];
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size));
  }
  return chunks;
}

export async function analyzeAndGeneratePassage(input: {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  passageId: string;
  sentences: ExactSentence[];
  analysisHints?: AnalysisHintV2[];
  localMandatoryHints?: LocalMandatoryHint[];
  sentencesPerCall?: number;
  /** 지문들이 공유하는 호출 게이트. 없으면 이 지문만의 상한을 쓴다. */
  limiter?: Limiter;
}): Promise<AnalyzerResult> {
  // 시험용 덮어쓰기(2026-11-10 원가 시험): GRAMMAR_V2_SENTENCES_PER_CALL
  const envPerCall = Number(process.env.GRAMMAR_V2_SENTENCES_PER_CALL ?? "");
  const perCall = Math.max(
    1,
    input.sentencesPerCall ?? (Number.isInteger(envPerCall) && envPerCall > 0 ? envPerCall : ANALYZER_SENTENCES_PER_CALL)
  );
  const chunks = chunkSentences(input.sentences, perCall);
  const started = Date.now();
  const gate = input.limiter ?? createLimiter(ANALYZER_CHUNK_CONCURRENCY);
  const systemPrompt = analyzerSystemPrompt();

  const calls = await Promise.all(
    chunks.map((chunk) => gate(async () => {
      const payload = buildAnalyzerUserPayload({
        passageId: input.passageId,
        sentences: chunk,
        candidateCap: chunk.length * ANALYZER_CANDIDATES_PER_SENTENCE,
      });
      const promptChars =
        systemPrompt.length + JSON.stringify(payload).length;
      const called = await callGrammarChoiceV2Json({
        stage: "GENERATOR",
        apiKey: input.apiKey,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        system: systemPrompt,
        user: JSON.stringify(payload),
        schemaName: "grammar_choice_v2_analyze",
        schema: ANALYZER_SCHEMA as unknown as Record<string, unknown>,
        maxCompletionTokens: GENERATOR_CHUNK_OUTPUT_TOKEN_CAP,
      });
      return { called, promptChars };
    }))
  );

  /**
   * 묶음 응답을 원래 문장 순서대로 하나의 분석 JSON으로 합친다.
   * rawJson은 replay가 다시 파싱하는 입력이므로, 합친 뒤 한 번만 파싱해야
   * candidateId 번호가 재생 시에도 동일하게 나온다.
   */
  const mergedSentences: AnalyzerSentenceRow[] = [];
  for (const { called } of calls) {
    const chunkParsed = parseModelJson<{ sentences?: AnalyzerSentenceRow[] }>(
      called.content
    );
    mergedSentences.push(...(chunkParsed.sentences ?? []));
  }
  const mergedRawJson = JSON.stringify({ sentences: mergedSentences });
  const parsed = parseAnalyzerRawJson(mergedRawJson, input.passageId);
  /**
   * 검출 목록은 모델이 아니라 검출기에서 온다. 모델 응답에 detectedPoints가
   * 남아 있는 것은 옛 스냅샷을 replay할 때뿐이므로, 비어 있을 때만 채운다.
   */
  const detected = parsed.detected.length
    ? parsed.detected
    : detectedPointsFromSentences(input.sentences);

  const sum = (pick: (row: (typeof calls)[number]) => number | null) =>
    calls.reduce((acc, row) => acc + (pick(row) ?? 0), 0);

  return {
    ...parsed,
    detected,
    responseModel: calls[0]?.called.responseModel ?? input.model,
    promptChars: sum((row) => row.promptChars),
    rawJson: mergedRawJson,
    // 묶음 호출은 병렬이므로 합이 아니라 실제 경과 시간을 보고한다.
    latencyMs: Date.now() - started,
    inputTokens: calls.length ? sum((row) => row.called.inputTokens) : null,
    outputTokens: calls.length ? sum((row) => row.called.outputTokens) : null,
    fallback: calls.some((row) => row.called.fallback),
    callCount: calls.length,
  };
}

export function parseAnalyzerRawJson(content: string, passageId: string): {
  detected: DetectedGrammarPoint[];
  candidates: GrammarCandidate[];
  parsed: unknown;
} {
  const parsed = parseModelJson<{
    sentences?: Array<{
      sentenceId?: string;
      detectedPoints?: Array<Record<string, unknown>>;
      candidates?: Array<Record<string, unknown>>;
    }>;
  }>(content);

  const detected: DetectedGrammarPoint[] = [];
  const candidates: GrammarCandidate[] = [];
  let n = 0;
  for (const row of parsed.sentences ?? []) {
    const sentenceId = String(row.sentenceId ?? "");
    for (const point of row.detectedPoints ?? []) {
      const code = String(point.pointCode ?? "");
      if (!isKnownPointCode(code)) continue;
      const omission = String(point.omissionReason ?? "");
      detected.push({
        sentenceId,
        pointCode: code,
        sourceSpan: String(point.sourceSpan ?? ""),
        occurrenceIndex: Number(point.occurrenceIndex ?? 0) || 0,
        priority: (PRIORITIES.has(String(point.priority))
          ? point.priority
          : "CORE") as GrammarPriority,
        questionability: (["SAFE", "RISKY", "NOT_SUITABLE"].includes(
          String(point.questionability)
        )
          ? point.questionability
          : "RISKY") as Questionability,
        evidence: String(point.evidence ?? "").slice(0, 240),
        omissionReason: OMISSIONS.has(omission)
          ? (omission as OmissionReason)
          : undefined,
      });
    }
    for (const cand of row.candidates ?? []) {
      const code = String(cand.pointCode ?? "");
      if (!isKnownPointCode(code)) continue;
      const distractors = Array.isArray(cand.distractors)
        ? cand.distractors.map((d) => String(d)).filter(Boolean).slice(0, 2)
        : cand.distractor
          ? [String(cand.distractor)]
          : [];
      if (!distractors.length) continue;
      n += 1;
      candidates.push({
        candidateId: `${passageId}-${sentenceId}-${n}`,
        sentenceId,
        pointCode: code,
        sourceSpan: String(cand.sourceSpan ?? ""),
        occurrenceIndex: Number(cand.occurrenceIndex ?? 0) || 0,
        correctAnswer: String(cand.correctAnswer ?? ""),
        distractors,
        transformCode: (TRANSFORMS.has(String(cand.transformCode))
          ? cand.transformCode
          : "FORM_SWAP") as GrammarTransformCode,
        priority: (PRIORITIES.has(String(cand.priority))
          ? cand.priority
          : "CORE") as GrammarPriority,
        difficulty: (["BASIC", "CORE", "ADVANCED"].includes(
          String(cand.difficulty)
        )
          ? cand.difficulty
          : "CORE") as GrammarCandidate["difficulty"],
        evidence: String(cand.evidence ?? "").slice(0, 240),
        ruleSummaryKo: String(cand.ruleSummaryKo ?? "").slice(0, 180),
        riskLevel: (["LOW", "MEDIUM", "HIGH"].includes(String(cand.riskLevel))
          ? cand.riskLevel
          : "MEDIUM") as RiskLevel,
      });
    }
  }
  return { detected, candidates, parsed };
}
