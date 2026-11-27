import {
  getListeningGeneratorModelCandidates,
  isGpt5FamilyModel,
  isListeningModelUnavailableError,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  LISTENING_GPT5_MAX_COMPLETION_TOKENS,
  listeningMaxCompletionTokensForCount,
  listeningModelSupportsCustomTemperature,
} from "@/lib/listening/openai-listening-model";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

export interface ListeningChatOptions {
  system: string;
  user: string;
  temperature?: number;
  /** 미지정 시 문항 1개 기준 상한 */
  maxCompletionTokens?: number;
  /** 모델 후보 (미지정 시 기본 후보). 유형별 모델 등급에서 넘긴다 */
  models?: string[];
  /** 호출 하나의 시간 한도(ms). 미지정 시 150초 — 듣기 생성 라우트(최대 300초)보다 짧게 */
  timeoutMs?: number;
}

type RequestProfile = {
  includeTemperature: boolean;
  includeJsonMode: boolean;
  includeReasoningEffort: boolean;
};

function defaultProfile(model: string): RequestProfile {
  const gpt5 = isGpt5FamilyModel(model);
  return {
    includeTemperature: listeningModelSupportsCustomTemperature(model),
    includeJsonMode: true,
    includeReasoningEffort: gpt5,
  };
}

function buildChatCompletionBody(
  model: string,
  opts: ListeningChatOptions,
  profile: RequestProfile
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };

  if (profile.includeJsonMode) {
    body.response_format = { type: "json_object" };
  }
  if (profile.includeTemperature) {
    body.temperature = opts.temperature ?? 0.4;
  }
  const maxOut =
    opts.maxCompletionTokens ?? listeningMaxCompletionTokensForCount(1);
  if (isGpt5FamilyModel(model)) {
    body.max_completion_tokens = Math.min(LISTENING_GPT5_MAX_COMPLETION_TOKENS, maxOut);
    if (profile.includeReasoningEffort) {
      body.reasoning_effort = "low";
    }
  } else {
    body.max_tokens = Math.min(8192, maxOut);
  }

  return body;
}

function relaxProfile(
  model: string,
  profile: RequestProfile,
  bodyText: string
): RequestProfile | null {
  const next = { ...profile };
  let changed = false;

  if (next.includeTemperature && isUnsupportedTemperatureError(bodyText)) {
    next.includeTemperature = false;
    changed = true;
  }
  if (next.includeJsonMode && isUnsupportedParameterError(bodyText, "response_format")) {
    next.includeJsonMode = false;
    changed = true;
  }
  if (
    next.includeReasoningEffort &&
    isUnsupportedParameterError(bodyText, "reasoning_effort")
  ) {
    next.includeReasoningEffort = false;
    changed = true;
  }

  return changed ? next : null;
}

async function postChatCompletion(
  apiKey: string,
  model: string,
  opts: ListeningChatOptions,
  profile: RequestProfile
): Promise<Response> {
  return openAiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 150_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatCompletionBody(model, opts, profile)),
  });
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseCompletionContent(
  data: {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  },
  model: string
): string {
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (content) return content;

  const reason = choice?.finish_reason ?? "unknown";
  throw new Error(
    `OpenAI 응답이 비어 있습니다 (model=${model}, finish_reason=${reason}). GPT-5는 추론 토큰으로 예산이 소진될 수 있습니다.`
  );
}

export async function listeningChatCompletion(
  apiKey: string,
  opts: ListeningChatOptions
): Promise<string> {
  const models = opts.models?.length ? opts.models : getListeningGeneratorModelCandidates();
  let lastError = "OpenAI API 실패";

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    let profile = defaultProfile(model);
    let attempts = 0;
    let lastStatus = 500;
    let lastBodyText = "";

    while (attempts < 4) {
      attempts++;
      const response = await postChatCompletion(apiKey, model, opts, profile);

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{
            message?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        // 원가를 재 볼 때만 켠다 (LISTENING_LOG_TOKENS=1) — 새로 만드는 길과 비슷한 문항 길의 값을 비교하려면 필요하다
        if (process.env.LISTENING_LOG_TOKENS && data.usage) {
          console.log(
            `[listening-tokens] model=${model} in=${data.usage.prompt_tokens ?? 0} out=${data.usage.completion_tokens ?? 0}`
          );
        }
        return parseCompletionContent(data, model);
      }

      lastBodyText = await response.text();
      lastStatus = response.status;
      lastError = `OpenAI API 실패 (HTTP ${lastStatus}, model=${model}): ${lastBodyText.slice(0, 400)}`;

      const relaxed = relaxProfile(model, profile, lastBodyText);
      if (relaxed && lastStatus === 400) {
        profile = relaxed;
        continue;
      }

      break;
    }

    const hasFallback = i < models.length - 1;
    if (hasFallback && isListeningModelUnavailableError(lastStatus, lastBodyText)) {
      continue;
    }
    throw new Error(lastError);
  }

  throw new Error(lastError);
}

export async function listeningChatJson<T>(
  apiKey: string,
  opts: ListeningChatOptions
): Promise<T> {
  const content = await listeningChatCompletion(apiKey, opts);
  try {
    return JSON.parse(content) as T;
  } catch {
    return JSON.parse(extractJsonText(content)) as T;
  }
}
