import {
  buildStudentRecordChatBody,
  getStudentRecordModelCandidates,
  isGpt5FamilyModel,
  isModelUnavailableError,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  studentRecordModelSupportsTemperature,
} from "@/lib/student-records/model";
import type { NeltGrowthAnalysis } from "@/lib/nelt/compare/types";
import type { NeltDomain } from "@/types/nelt";
import {
  buildDomainSections,
  buildParentOverallSummary,
} from "@/lib/nelt/compare/domain-sections";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

export type NeltAiNarratives = {
  version: 1;
  model: string | null;
  /** 회차 지문 — 바뀌면 캐시 무효 */
  attemptFingerprint?: string;
  overallSummary: string;
  strengthsNarrative: string;
  nextGoalsNarrative: string;
  domainExplanations: Partial<Record<NeltDomain, string>>;
  domainPlans: Partial<Record<NeltDomain, string>>;
};

export function buildAttemptFingerprint(
  analysis: NeltGrowthAnalysis
): string {
  return analysis.attempts
    .map(
      (a) =>
        `${a.id}:${a.attemptNumber}:${a.testDate ?? ""}:${a.overallLevel ?? ""}`
    )
    .join("|");
}

const DOMAINS: NeltDomain[] = [
  "vocabulary",
  "grammar",
  "listening",
  "reading",
];

export function narrativesFromRuleBased(
  analysis: NeltGrowthAnalysis
): NeltAiNarratives {
  const sections = buildDomainSections(analysis);
  const domainExplanations: Partial<Record<NeltDomain, string>> = {};
  const domainPlans: Partial<Record<NeltDomain, string>> = {};
  for (const s of sections) {
    domainExplanations[s.domain] = s.explanation;
    domainPlans[s.domain] = s.plan;
  }
  return {
    version: 1,
    model: null,
    attemptFingerprint: buildAttemptFingerprint(analysis),
    overallSummary: buildParentOverallSummary(analysis).replace(
      /<\/?strong>/g,
      ""
    ),
    strengthsNarrative: analysis.strengthsNarrative,
    nextGoalsNarrative: analysis.nextGoalsNarrative,
    domainExplanations,
    domainPlans,
  };
}

export function parseStoredNarratives(
  raw: string | null | undefined
): NeltAiNarratives | null {
  if (!raw?.trim()) return null;
  try {
    const json = JSON.parse(raw) as NeltAiNarratives;
    if (json?.version !== 1 || typeof json.overallSummary !== "string") {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

export function applyAiNarratives(
  analysis: NeltGrowthAnalysis,
  ai: NeltAiNarratives
): NeltGrowthAnalysis {
  return {
    ...analysis,
    overallNarrative: ai.overallSummary,
    strengthsNarrative: ai.strengthsNarrative || analysis.strengthsNarrative,
    nextGoalsNarrative: ai.nextGoalsNarrative || analysis.nextGoalsNarrative,
  };
}

const SYSTEM = `당신은 영어학원 선생님이 학부모용 NELT 성장 리포트에 넣을 서술 문구를 작성한다.

목표: 기계적·보고서 말투가 아니라, 선생님이 학부모께 설명하듯 자연스럽고 따뜻한 한국어.

절대 금지:
- "판정 수준", "분석 결과에 의하면", "확인됩니다", "다음과 같이", "송부", "귀 자녀", "상기 학생"
- 향상되지 않은 영역을 향상된 것처럼 쓰기
- 없는 숫자·레벨·기간 지어내기
- "점수가 하락", "성적이 떨어짐"

규칙:
- 학년 수준(실력)이 실제로 오른 경우만 "올라왔습니다/좋아졌습니다"
- 시험 범위(난이도 코드)만 넓어지고 실력이 그대로/낮아진 경우는 "더 넓은 범위에 도전"으로만 설명
- "판정 수준" 대신 "실력", "학년 수준", "초등 ○학년 수준"
- 영역별 설명은 2~4문장. 수치 1~2개만 자연스럽게 넣기
- 보완점은 부정 평가 금지, 앞으로 수업에서 채울 계획으로

반드시 아래 JSON만 출력 (마크다운 코드펜스 금지):
{
  "overallSummary": "전체 성장 요약 2~4문장. 필요하면 <strong>강조</strong> 1회만",
  "strengthsNarrative": "종합 성장 평가 3~5문장",
  "nextGoalsNarrative": "향후 지도 계획 2~4문장",
  "domainExplanations": {
    "vocabulary": "...",
    "grammar": "...",
    "listening": "...",
    "reading": "..."
  },
  "domainPlans": {
    "vocabulary": "다음 학습 계획 1~2문장",
    "grammar": "...",
    "listening": "...",
    "reading": "..."
  }
}`;

function buildFacts(analysis: NeltGrowthAnalysis) {
  return {
    studentName: analysis.studentName,
    attemptCount: analysis.attemptCount,
    period: {
      from: analysis.start.testDate,
      to: analysis.end.testDate,
    },
    overall: {
      from: analysis.start.overallLevel,
      to: analysis.end.overallLevel,
      percentileFrom: analysis.start.overallPercentile,
      percentileTo: analysis.end.overallPercentile,
      percentileImproved:
        analysis.start.overallPercentile != null &&
        analysis.end.overallPercentile != null &&
        analysis.end.overallPercentile < analysis.start.overallPercentile,
    },
    vocabulary: analysis.vocabularyGrowth,
    domains: analysis.domainGrowth.map((d) => ({
      domain: d.domain,
      label: d.label,
      status: d.status,
      beforeLevel: d.beforeLevel,
      afterLevel: d.afterLevel,
      levelDelta: d.levelDelta,
      levelActuallyUp: d.levelDelta != null && d.levelDelta > 0.4,
      beforeDifficulty: d.beforeDifficulty,
      afterDifficulty: d.afterDifficulty,
      difficultyUp: d.difficultyUp,
      scoreComparable: d.scoreComparable,
      scoreDelta: d.scoreDelta,
      percentileImproved: d.percentileImproved,
      narrativeHint: d.narrative,
    })),
    highlights: analysis.highlights
      .filter((h) => h.parentVisible)
      .map((h) => ({
        title: h.title,
        before: h.beforeLabel,
        after: h.afterLabel,
        delta: h.deltaLabel,
      })),
    newlyCorrectGrammar: analysis.newlyCorrectGrammar.slice(0, 6).map((g) => ({
      category: g.category,
      detail: g.detail,
    })),
    focusGrammar: analysis.focusGrammar.slice(0, 6).map((g) => ({
      category: g.category,
      detail: g.detail,
    })),
    learningPlan: analysis.learningPlan,
    attemptSteps: analysis.attemptSteps.map((s) => s.summary),
  };
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1].trim() : t;
}

function normalizeAiJson(
  raw: unknown,
  fallback: NeltAiNarratives,
  model: string
): NeltAiNarratives {
  if (!raw || typeof raw !== "object") return { ...fallback, model };
  const o = raw as Record<string, unknown>;
  const domainExplanations = { ...fallback.domainExplanations };
  const domainPlans = { ...fallback.domainPlans };
  const ex = o.domainExplanations;
  const plans = o.domainPlans;
  if (ex && typeof ex === "object") {
    for (const d of DOMAINS) {
      const v = (ex as Record<string, unknown>)[d];
      if (typeof v === "string" && v.trim()) domainExplanations[d] = v.trim();
    }
  }
  if (plans && typeof plans === "object") {
    for (const d of DOMAINS) {
      const v = (plans as Record<string, unknown>)[d];
      if (typeof v === "string" && v.trim()) domainPlans[d] = v.trim();
    }
  }
  return {
    version: 1,
    model,
    attemptFingerprint: fallback.attemptFingerprint,
    overallSummary:
      typeof o.overallSummary === "string" && o.overallSummary.trim()
        ? o.overallSummary.trim()
        : fallback.overallSummary,
    strengthsNarrative:
      typeof o.strengthsNarrative === "string" && o.strengthsNarrative.trim()
        ? o.strengthsNarrative.trim()
        : fallback.strengthsNarrative,
    nextGoalsNarrative:
      typeof o.nextGoalsNarrative === "string" && o.nextGoalsNarrative.trim()
        ? o.nextGoalsNarrative.trim()
        : fallback.nextGoalsNarrative,
    domainExplanations,
    domainPlans,
  };
}

export async function generateNeltReportNarrativesAi(
  analysis: NeltGrowthAnalysis
): Promise<
  | { ok: true; narratives: NeltAiNarratives; source: "ai"; model: string }
  | { ok: false; narratives: NeltAiNarratives; source: "fallback"; message: string }
> {
  const fallback = narrativesFromRuleBased(analysis);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      narratives: fallback,
      source: "fallback",
      message: "OPENAI_API_KEY가 없습니다.",
    };
  }

  const user = `다음 JSON 사실만으로 학부모용 NELT 성장 리포트 서술을 작성하세요.\n${JSON.stringify(buildFacts(analysis), null, 2)}`;
  const candidates = getStudentRecordModelCandidates();
  let lastErr = "AI 생성 실패";
  // 부르는 라우트(report-narratives·share)가 90초라, 모델·재시도를 다 합쳐 70초 안에 끝낸다(넘으면 규칙 서술로)
  const deadline = AbortSignal.timeout(70_000);

  for (const model of candidates) {
    try {
      let includeTemperature = true;
      let includeReasoningEffort = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        const body = buildStudentRecordChatBody(model, SYSTEM, user, {
          includeTemperature,
          includeReasoningEffort,
        });
        if (includeTemperature && "temperature" in body) {
          body.temperature = 0.6;
        }
        if (isGpt5FamilyModel(model)) {
          body.max_completion_tokens = 3500;
          if (includeReasoningEffort) body.reasoning_effort = "medium";
        }

        const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: deadline,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
          if (isModelUnavailableError(res.status, text)) {
            lastErr = text.slice(0, 200);
            break;
          }
          if (includeTemperature && isUnsupportedTemperatureError(text)) {
            includeTemperature = false;
            continue;
          }
          if (
            includeReasoningEffort &&
            isUnsupportedParameterError(text, "reasoning_effort")
          ) {
            includeReasoningEffort = false;
            continue;
          }
          lastErr = text.slice(0, 200);
          break;
        }

        const json = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content?.trim();
        if (!content) {
          lastErr = "빈 응답";
          break;
        }
        try {
          const parsed = JSON.parse(stripCodeFence(content));
          return {
            ok: true,
            narratives: normalizeAiJson(parsed, fallback, model),
            source: "ai",
            model,
          };
        } catch {
          lastErr = "JSON 파싱 실패";
          break;
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "요청 실패";
    }
  }

  return {
    ok: false,
    narratives: fallback,
    source: "fallback",
    message: lastErr,
  };
}
