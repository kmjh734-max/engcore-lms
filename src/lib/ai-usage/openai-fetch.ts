import { recordAiUsage } from "@/lib/ai-usage/record";

/** signal 없이 부른 OpenAI 호출의 마지막 안전판(10분) */
const OPENAI_DEFAULT_TIMEOUT_MS = 600_000;

/**
 * OpenAI를 부르는 공통 창구.
 *
 * 쓰는 법은 fetch와 똑같다 — 부르던 자리에서 fetch만 이것으로 바꾸면 된다.
 * 응답을 한 번 엿보아 모델·토큰·요청 id를 기록하고, 응답 자체는 손대지 않고 그대로 넘긴다.
 * 기록이 어긋나도 만들기를 막지 않는다.
 */
export async function openAiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  /*
   * 부르는 자리에서 signal을 안 넘기면 10분 뒤 끊는다(2026-11-28). 응답이 멈춘 채 붙잡혀
   * 있지 않게 하는 마지막 안전판이다. 직접 넘긴 signal(Request에 든 것 포함)은 그대로 쓴다.
   */
  const hasOwnSignal = Boolean(init?.signal) || (typeof Request !== "undefined" && input instanceof Request);
  const res = await fetch(
    input,
    hasOwnSignal ? init : { ...init, signal: AbortSignal.timeout(OPENAI_DEFAULT_TIMEOUT_MS) }
  );
  // 실패한 응답은 사용량이 없다. 읽어서 본문을 건드리지 않는다.
  if (!res.ok) return res;
  try {
    const clone = res.clone();
    const body = (await clone.json()) as OpenAiBody;
    const u = body?.usage;
    const reasoning = Number(u?.completion_tokens_details?.reasoning_tokens ?? u?.output_tokens_details?.reasoning_tokens ?? 0);
    if (u && body?.model) {
      recordAiUsage({
        model: String(body.model),
        inputTokens: Number(u.prompt_tokens ?? u.input_tokens ?? 0),
        cachedInputTokens: Number(
          u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0
        ),
        outputTokens: Number(u.completion_tokens ?? u.output_tokens ?? 0),
        requestId: res.headers.get("x-request-id"),
        /*
         * 추론 토큰은 출력 값에 들어가지만 응답에는 안 보인다. 변형문제 생성 출력 1,043토큰 중
         * 보이는 것은 430토큰쯤이라(2026-10-05 시험) 나머지가 무엇인지 재려고 남긴다.
         */
        meta: reasoning > 0 ? { reasoningTokens: reasoning } : undefined,
      });
    }
  } catch {
    /* 그림처럼 JSON이 아닌 응답은 기록하지 않는다 */
  }
  return res;
}

type OpenAiBody = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};
