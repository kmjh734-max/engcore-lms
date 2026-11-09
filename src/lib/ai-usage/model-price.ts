/**
 * 모델 1M 토큰당 달러. OpenAI 공식 단가를 손으로 적어 둔다.
 *
 * 단가가 바뀌면 여기만 고친다. 목록에 없는 모델은 원가를 셈하지 않고 「단가 모름」으로
 * 따로 보여 준다 — 모르는 것을 아는 척 계산하면 원가율이 거짓이 된다.
 */
export type ModelPrice = {
  in: number;
  cachedIn: number;
  out: number;
  /*
   * 캐시에 「쓸 때」 더 받는 값을, 처음 보는 입력 토큰에 곱하는 수.
   *
   * 선생님 물음(2026-10-01): 원가가 제대로 책정되고 있는가.
   * 청구 내역을 줄 항목별로 받아 보니 gpt-5.6 계열에만 `cache writes` 줄이 있었다.
   * 30일분 $20.90(29,267원) — 단가표에 아예 없던 항목이다.
   *
   * 역산: sol은 처음 보는 입력 6.895M 가운데 4.12M이 캐시 쓰기였고, 쓰기 청구
   * $20.6063 ÷ 4.12M = $5/1M — 입력 단가($4)의 딱 1.25배다. terra도 같다
   * ($0.2985 ÷ 0.1194M = $2.5 = $2 × 1.25). gpt-5.5·gpt-4o 세대는 쓰기를 안 받는다.
   *
   * 다만 OpenAI 응답에는 「이 가운데 몇 개가 캐시 쓰기였나」가 오지 않는다. 그래서
   * 처음 보는 입력 전부에 평균 배수를 곱한다. 우리 쓰임에서 캐시 쓰기 비율이
   * sol 60%·terra 50%였으니 배수는 1 + 0.25×0.55 ≈ 1.15다.
   * 캐시가 더 잘 걸리게 고칠수록 이 비율은 올라가므로, 청구서와 나란히 다시 본다.
   */
  writeUplift?: number;
};

/** gpt-5.6 계열에서 처음 보는 입력에 곱하는 수(캐시 쓰기 값이 섞여 있다) */
const GPT56_WRITE_UPLIFT = 1.15;

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // 2026-09-29 공식 가격표에서 옮겨 적음 (developers.openai.com/api/docs/pricing)
  /*
   * sol은 1.23(2026-11-10 청구 대조, 10-27~11-09): 캐시가 잘 걸리게 고친 뒤 처음 보는 입력 중 캐시 쓰기 비율이 올라
   * 평균 1.15로는 sol을 1.3% 낮게 셌다. 청구 「cache writes $9.08 + input $0.68」÷ 단가표 처음 보는 입력값 = 1.23.
   * terra는 같은 셈으로 1.145라 그대로 둔다. 다시 재는 스크립트: scripts/tmp-rv/goldset/_oai-reconcile.mts
   */
  "gpt-5.6-sol": { in: 4, cachedIn: 0.4, out: 20, writeUplift: 1.23 },
  "gpt-5.6-terra": { in: 2, cachedIn: 0.2, out: 12, writeUplift: GPT56_WRITE_UPLIFT },
  "gpt-5.6-luna": { in: 0.2, cachedIn: 0.02, out: 1.2, writeUplift: GPT56_WRITE_UPLIFT },
  "gpt-5.5": { in: 5, cachedIn: 0.5, out: 30 },
  "gpt-5.4-nano": { in: 0.05, cachedIn: 0.005, out: 0.4 },
  "gpt-5.4-mini": { in: 0.25, cachedIn: 0.025, out: 2 },
  "gpt-5.4": { in: 2.5, cachedIn: 0.25, out: 15 },
  "gpt-5.2": { in: 1.75, cachedIn: 0.175, out: 14 },
  "gpt-5.1": { in: 1.25, cachedIn: 0.125, out: 10 },
  "gpt-5-mini": { in: 0.25, cachedIn: 0.025, out: 2 },
  "gpt-5-nano": { in: 0.05, cachedIn: 0.005, out: 0.4 },
  "gpt-5": { in: 1.25, cachedIn: 0.125, out: 10 },
  "gpt-4o-mini": { in: 0.15, cachedIn: 0.075, out: 0.6 },
  "gpt-4o": { in: 2.5, cachedIn: 1.25, out: 10 },
  /*
   * 되살리기용 모델(2026-10-01 확인). 평소에는 안 부르지만, 시험지를 못 읽었을 때·
   * 학생부 OCR·듣기 그림 계획에서 이 모델로 한 번 더 부른다. 단가가 없으면 그 호출만
   * 「단가 모름」으로 빠져, 정작 실패해서 두 번 부른 자리의 값이 원가에 안 잡힌다.
   */
  "gpt-4.1-mini": { in: 0.4, cachedIn: 0.1, out: 1.6 },
  "gpt-4.1": { in: 2, cachedIn: 0.5, out: 8 },
  // 그림 모델. 입력은 글·그림 단가가 다른데(글 $5·그림 $8) 사용량이 나뉘어 오지 않아
  // 글 쪽으로 잡는다. 삽화는 출력이 거의 전부라 차이가 작다.
  /*
   * gpt-image-2는 청구 내역으로 단가를 역산해 넣었다(2026-10-01, 30일분).
   * 호출 199건·출력 135,630토큰에 그림출력 $4.0689 → 정확히 $30/1M,
   * 글입력 $0.1971 ÷ 39,421토큰 → 정확히 $5/1M. 캐시 읽기는 쓰인 적이 없어
   * gpt-image-1.5와 같게 두었다.
   * 삽화(2×2 만화) 한 장이 30.0원이다.
   */
  "gpt-image-2": { in: 5, cachedIn: 2, out: 30 },
  /*
   * gpt-image-1.5는 그림 출력 $32·글 출력 $10인데 사용량이 나뉘어 오지 않아 전부 $32로
   * 잡는다. 30일분으로 맞춰 보니 실제 $35.6를 $41.7로 세어 17% 더 본다(넉넉하게 잡는 쪽).
   */
  "gpt-image-1.5": { in: 5, cachedIn: 2, out: 32 },
  "gpt-image-1": { in: 5, cachedIn: 2.5, out: 40 },
};

/*
 * 두 가지는 여기서 셈하지 않는다 — 우리 호출에 해당하지 않아서다.
 *  · 입력이 272K를 넘으면 입력 2배·출력 1.5배. 우리 지문은 그 근처도 못 간다.
 *  · 지역 처리(data residency) 창구는 10% 더. 우리는 기본 창구를 쓴다.
 * gpt-5.6-sol의 $4/$20은 2026-11-21까지의 할인가다. 그 뒤에는 다시 확인해야 한다.
 */

/** 1달러를 몇 원으로 볼지 */
export const WON_PER_USD = 1400;

/** 모델 이름 앞부분으로 단가를 찾는다(gpt-5-mini-2025-08-07 → gpt-5-mini) */
export function modelPrice(model: string): ModelPrice | null {
  const m = String(model ?? "").toLowerCase();
  for (const key of Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length)) {
    if (m.startsWith(key)) return MODEL_PRICES[key]!;
  }
  return null;
}

/** 이 호출이 얼마짜리인지(원). 단가를 모르면 null. */
export function usageWon(u: {
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}): number | null {
  const p = modelPrice(u.model);
  if (!p) return null;
  const fresh = Math.max(0, u.input_tokens - u.cached_input_tokens);
  const usd =
    (fresh * p.in * (p.writeUplift ?? 1) +
      u.cached_input_tokens * p.cachedIn +
      u.output_tokens * p.out) /
    1_000_000;
  return usd * WON_PER_USD;
}
