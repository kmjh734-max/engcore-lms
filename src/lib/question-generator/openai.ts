import {
  getListeningGeneratorModelCandidates,
  isGpt5FamilyModel,
  isListeningModelUnavailableError,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  LISTENING_GPT5_MAX_COMPLETION_TOKENS,
  listeningModelSupportsCustomTemperature,
} from "@/lib/listening/openai-listening-model";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

function modelCandidates(preferred?: string[]): string[] {
  const dedicated = process.env.OPENAI_MODEL_QUESTION_GENERATOR?.trim();
  const base = getListeningGeneratorModelCandidates();
  const extras = (preferred ?? []).map((m) => m.trim()).filter(Boolean);
  const ordered: string[] = [];
  const push = (m: string) => {
    if (m && !ordered.includes(m)) ordered.push(m);
  };
  for (const m of extras) push(m);
  if (dedicated) push(dedicated);
  for (const m of base) push(m);
  return ordered;
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

function buildBody(
  model: string,
  system: string,
  user: string | string[],
  temperature: number,
  maxTokens: number,
  profile: RequestProfile,
  reasoningEffort?: "low" | "medium" | "high" | "xhigh",
  cacheKey?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      // 여러 덩어리면 메시지를 나눠 보낸다 — gpt-5.6은 메시지 단위로 캐시를 읽는다
      ...(Array.isArray(user) ? user : [user]).map((content) => ({ role: "user", content })),
    ],
  };
  // 같은 앞부분을 다시 보내면 값이 십분의 일이다. 여러 문항을 한꺼번에 만들면
  // 요청이 서로 다른 기계로 흩어져 앞부분을 다시 읽는데, 이 이름표를 붙이면
  // 같은 자리로 모인다. 안 붙인 문항 생성만 캐시 적중이 0%였다.
  if (cacheKey) {
    body.prompt_cache_key = cacheKey;
  }
  if (profile.includeJsonMode) {
    body.response_format = { type: "json_object" };
  }
  if (profile.includeTemperature) {
    body.temperature = temperature;
  }
  if (isGpt5FamilyModel(model)) {
    body.max_completion_tokens = Math.min(
      LISTENING_GPT5_MAX_COMPLETION_TOKENS,
      maxTokens
    );
    if (profile.includeReasoningEffort) {
      body.reasoning_effort = reasoningEffort ?? "low";
    }
  } else {
    body.max_tokens = Math.min(NON_GPT5_MAX_TOKENS, maxTokens);
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
  if (
    next.includeJsonMode &&
    isUnsupportedParameterError(bodyText, "response_format")
  ) {
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

/**
 * 재시도 정책 (호출 낭비 방지)
 * - 한 모델당 실제 요청은 최대 3회 (첫 요청 + 재시도 2회)
 *   · finish_reason "length"(토큰 상한으로 잘림) → 상한을 올려 1회
 *   · 빈 응답 / JSON 해석 실패 → 1회
 *   · 5xx·네트워크 오류 → 짧은 대기 후 1회 (총 2회 시도)
 *   · 사용 한도(429) → 버리지 않고 기다렸다 다시(최대 90초, 횟수에 넣지 않음). 그 뒤는 위와 같다.
 * - 파라미터 미지원 400(temperature·reasoning_effort·response_format)은
 *   해당 파라미터를 빼고 다시 보냄 (과금 없는 거절이라 위 횟수에 포함하지 않음)
 * - 모델 폴백은 1회 (사용할 수 없는 모델은 건너뛰고 세지 않음)
 */
const MAX_ATTEMPTS_PER_MODEL = 3;
const MAX_MODELS_TRIED = 2;
const MAX_PROFILE_RELAXES = 3;
const TRANSIENT_BACKOFF_DEFAULT_MS = 1500;
const TRANSIENT_BACKOFF_MAX_MS = 8000;
const NON_GPT5_MAX_TOKENS = 8192;

function tokenLimitFor(model: string): number {
  return isGpt5FamilyModel(model)
    ? LISTENING_GPT5_MAX_COMPLETION_TOKENS
    : NON_GPT5_MAX_TOKENS;
}

function isTransientStatus(status: number, bodyText: string): boolean {
  if (status === 429) {
    // 크레딧 소진은 기다려도 풀리지 않음
    return !bodyText.toLowerCase().includes("insufficient_quota");
  }
  return status === 408 || status >= 500;
}

function transientBackoffMs(res: Response | null): number {
  const retryAfterMs = Number(res?.headers.get("retry-after-ms"));
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, TRANSIENT_BACKOFF_MAX_MS);
  }
  const retryAfterSec = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, TRANSIENT_BACKOFF_MAX_MS);
  }
  return TRANSIENT_BACKOFF_DEFAULT_MS + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 사용 한도(429)는 여러 학원이 한 키를 함께 쓰다 몰릴 때 난다. 이때는 문항을 버리거나
 * 다른 모델로 넘기지 않고, OpenAI가 알려 주는 만큼 기다렸다가 다시 보낸다(시도 횟수에
 * 넣지 않는다). 기다린 시간이 이만큼을 넘으면 그때부터는 일반 오류처럼 다룬다.
 */
const RATE_LIMIT_WAIT_BUDGET_MS = 90_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 20_000;

/** 이 프로세스에서 마지막으로 한도에 걸린 시각 / 남은 토큰이 적다고 본 시각. */
let rateLimitedAt = 0;
let tokensLowAt = 0;

/**
 * 지금 OpenAI 한도가 빠듯한지. 생성 작업이 동시에 보내는 문항 수를 줄이는 데 쓴다
 * (run-generation-job.ts).
 */
export function openAiUnderPressure(): boolean {
  const now = Date.now();
  return now - rateLimitedAt < 30_000 || now - tokensLowAt < 15_000;
}

function noteRateLimitHeaders(res: Response) {
  const limit = Number(res.headers.get("x-ratelimit-limit-tokens"));
  const remaining = Number(res.headers.get("x-ratelimit-remaining-tokens"));
  if (limit > 0 && Number.isFinite(remaining) && remaining / limit < 0.15) {
    tokensLowAt = Date.now();
  }
}

function rateLimitBackoffMs(res: Response, waitedMs: number): number {
  const hinted = transientBackoffMs(res);
  // 알려 준 시간이 없으면 기다릴수록 조금씩 길게, 여럿이 한꺼번에 다시 몰리지 않게 흩는다.
  const base = Math.max(hinted, Math.min(RATE_LIMIT_BACKOFF_MAX_MS, 2000 + waitedMs / 3));
  return Math.min(RATE_LIMIT_BACKOFF_MAX_MS, base) + Math.floor(Math.random() * 1500);
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("JSON 파싱에 실패했습니다.");
  }
}

/**
 * 딥시크 시험용(2026-11-10, 고정 시험지로 검수 비교). 모델 이름이 deepseek- 로 시작할 때만 탄다 —
 * 운영 설정에는 그런 모델이 없으므로 운영 흐름은 그대로다. 사용량은 deepseekUsage에 모은다.
 */
export const deepseekUsage = { calls: 0, input: 0, cached: 0, output: 0, failed: 0 };

async function deepseekChatJson(
  model: string,
  opts: { system: string; user: string | string[]; maxTokens?: number; reasoningEffort?: string }
): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error("DEEPSEEK_API_KEY가 설정되지 않았습니다.");
  const users = Array.isArray(opts.user) ? opts.user : [opts.user];
  // 딥시크는 low·high·max만 받는다 — medium은 high로
  const effort = opts.reasoningEffort === "low" ? "low" : opts.reasoningEffort === "xhigh" ? "max" : "high";
  let last = "딥시크 호출 실패";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          reasoning_effort: effort,
          response_format: { type: "json_object" },
          max_tokens: Math.max(opts.maxTokens ?? 4096, 8000),
          messages: [
            { role: "system", content: `${opts.system}\nReply with JSON only.` },
            ...users.map((u) => ({ role: "user", content: u })),
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        last = `딥시크 ${res.status}: ${text.slice(0, 200)}`;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const data = JSON.parse(text);
      const u = data.usage ?? {};
      deepseekUsage.calls += 1;
      deepseekUsage.input += Number(u.prompt_tokens ?? 0);
      deepseekUsage.cached += Number(u.prompt_cache_hit_tokens ?? 0);
      deepseekUsage.output += Number(u.completion_tokens ?? 0);
      return extractJsonObject(String(data.choices?.[0]?.message?.content ?? ""));
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await sleep(2000 * (attempt + 1));
    }
  }
  deepseekUsage.failed += 1;
  throw new Error(last);
}

export async function questionGeneratorChatJson(opts: {
  system: string;
  user: string | string[];
  temperature?: number;
  maxTokens?: number;
  /** GPT-5 계열 reasoning_effort (기본 low) */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** 우선 시도할 모델 (예: gpt-5.5) */
  preferredModels?: string[];
  /** 프롬프트 앞부분 재사용 이름표 (유형마다 하나) */
  cacheKey?: string;
}): Promise<unknown> {
  const first = opts.preferredModels?.[0];
  if (first?.startsWith("deepseek-")) return deepseekChatJson(first, opts);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const temperature = opts.temperature ?? 0.35;
  const baseMaxTokens = opts.maxTokens ?? 4096;
  let lastError = "생성 요청에 실패했습니다.";
  let modelsTried = 0;

  for (const model of modelCandidates(opts.preferredModels)) {
    if (modelsTried >= MAX_MODELS_TRIED) break;

    let profile = defaultProfile(model);
    let maxTokens = baseMaxTokens;
    let attempts = 0;
    let relaxes = 0;
    let lengthRetried = false;
    let contentRetried = false;
    let transientRetried = false;
    let reachedModel = false;
    let rateWaitedMs = 0;

    while (attempts < MAX_ATTEMPTS_PER_MODEL) {
      let res: Response;
      let bodyText: string;
      try {
        res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildBody(
              model,
              opts.system,
              opts.user,
              temperature,
              maxTokens,
              profile,
              opts.reasoningEffort,
              opts.cacheKey
            )
          ),
        });
        bodyText = await res.text();
        noteRateLimitHeaders(res);
      } catch {
        // 네트워크 오류 — 짧게 쉬고 1회만 더
        reachedModel = true;
        attempts++;
        lastError = "생성 서버와 연결하지 못했습니다.";
        if (!transientRetried && attempts < MAX_ATTEMPTS_PER_MODEL) {
          transientRetried = true;
          await sleep(transientBackoffMs(null));
          continue;
        }
        break;
      }

      if (!res.ok) {
        // 파라미터 미지원 거절은 모델 미존재로 오인하기 전에 먼저 걸러 냄
        const relaxed =
          relaxes < MAX_PROFILE_RELAXES
            ? relaxProfile(model, profile, bodyText)
            : null;
        if (relaxed) {
          profile = relaxed;
          relaxes++;
          continue;
        }
        if (isListeningModelUnavailableError(res.status, bodyText)) {
          lastError = `모델 ${model}을(를) 사용할 수 없습니다.`;
          break;
        }
        if (
          res.status === 429 &&
          isTransientStatus(429, bodyText) &&
          rateWaitedMs < RATE_LIMIT_WAIT_BUDGET_MS
        ) {
          rateLimitedAt = Date.now();
          const wait = rateLimitBackoffMs(res, rateWaitedMs);
          rateWaitedMs += wait;
          await sleep(wait);
          continue;
        }
        reachedModel = true;
        attempts++;
        lastError = `생성 요청 실패 (${res.status})`;
        if (
          isTransientStatus(res.status, bodyText) &&
          !transientRetried &&
          attempts < MAX_ATTEMPTS_PER_MODEL
        ) {
          transientRetried = true;
          await sleep(transientBackoffMs(res));
          continue;
        }
        break;
      }

      reachedModel = true;
      attempts++;

      let parsed: {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
        }>;
      } = {};
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = {};
      }
      const choice = parsed.choices?.[0];
      const content = String(choice?.message?.content ?? "");
      if (content.trim()) {
        try {
          return extractJsonObject(content);
        } catch {
          // 아래에서 재시도 여부 판단
        }
      }

      // 토큰 상한으로 잘림 → 상한을 올려 1회
      const limit = tokenLimitFor(model);
      if (
        choice?.finish_reason === "length" &&
        !lengthRetried &&
        Math.min(limit, maxTokens) < limit
      ) {
        lengthRetried = true;
        maxTokens = Math.min(limit, Math.max(maxTokens * 2, maxTokens + 2048));
        lastError = "응답이 길이 제한으로 잘렸습니다.";
        continue;
      }

      // 빈 응답·해석 불가 → 같은 설정으로 1회
      lastError = content.trim()
        ? "응답 형식을 해석하지 못했습니다."
        : "응답이 비어 있습니다.";
      if (!contentRetried) {
        contentRetried = true;
        continue;
      }
      break;
    }

    if (reachedModel) modelsTried++;
  }

  throw new Error(lastError);
}

/**
 * 재시도·모델 폴백은 questionGeneratorChatJson 안에서 처리한다.
 * (예전처럼 전체를 한 번 더 돌리면 최악 호출 수가 두 배가 되므로 그대로 위임)
 */
/**
 * 캐시를 데운다 — 첫 메시지(유형 규칙)까지만 보내고 16토큰에서 끊는다.
 *
 * 실험(2026-10-03): gpt-5.6은 앞 요청의 프롬프트 「전체」가 새 요청의 앞부분과 메시지 단위로
 * 같을 때만 캐시를 읽는다. 이렇게 한 번 보내 두면 같은 유형 문항들이 이 부분을 캐시로
 * 읽는다(제목추론 2,500토큰 가운데 2,131토큰). 실패해도 문항 만들기에는 상관없다.
 * 사용량은 openAiFetch가 평소처럼 기록한다.
 */
export async function primeQuestionGeneratorCache(opts: {
  system: string;
  user: string[];
  temperature?: number;
  preferredModels?: string[];
  cacheKey?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
}): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return;
  const model = modelCandidates(opts.preferredModels)[0];
  if (!model) return;
  try {
    const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        buildBody(model, opts.system, opts.user, opts.temperature ?? 0.35, 16, defaultProfile(model), opts.reasoningEffort, opts.cacheKey)
      ),
    });
    await res.text();
  } catch {
    // 데우기는 덤이다 — 실패해도 그냥 넘어간다
  }
}

export async function questionGeneratorChatJsonWithRetry(
  opts: Parameters<typeof questionGeneratorChatJson>[0]
): Promise<unknown> {
  return questionGeneratorChatJson(opts);
}
