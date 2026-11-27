import { usageWon, WON_PER_USD } from "@/lib/ai-usage/model-price";

/**
 * OpenAI 쪽 청구액·사용량을 받아 온다.
 *
 * 우리 기록(ai_usage_logs)만으로는 「빠짐없이 적고 있나」를 알 수 없다. 저쪽 숫자와
 * 나란히 놓아야 단가표가 맞는지, 우리가 놓치는 호출이 있는지 보인다.
 *
 * 관리자 키(OPENAI_ADMIN_KEY)가 있어야 한다 — api.usage.read 권한이 필요해서
 * 평소 쓰는 프로젝트 키로는 열리지 않는다. 키가 없으면 이 줄만 비우고 넘어간다.
 */
export type BillingDay = {
  /** YYYY-MM-DD (UTC 기준 — OpenAI가 그렇게 묶어 준다) */
  date: string;
  /** OpenAI가 실제로 매긴 값(원) */
  billedWon: number;
  /** OpenAI가 알려 준 사용량을 우리 단가표로 셈한 값(원) */
  byOurPriceWon: number;
  /** 단가를 몰라 못 센 모델 */
  unknownModels: string[];
};

export type BillingReport =
  | { ok: false; reason: "no_key" | "no_permission" | "failed"; message: string }
  | { ok: true; days: BillingDay[]; totalBilledWon: number; totalByOurPriceWon: number };

type CostBucket = { start_time: number; results?: Array<{ amount?: { value?: number } }> };
type UsageBucket = {
  start_time: number;
  results?: Array<{
    model?: string;
    /** 「flex-tier」면 값이 절반(2026-11-28부터 변형문제가 flex로 부른다) */
    service_tier?: string | null;
    input_tokens?: number;
    input_cached_tokens?: number;
    output_tokens?: number;
  }>;
};

const DAY = 86_400;
const ymd = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

export async function loadOpenAiBilling(days: number): Promise<BillingReport> {
  const key = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      reason: "no_key",
      message:
        "OPENAI_ADMIN_KEY가 없습니다. platform.openai.com에서 api.usage.read 권한이 있는 관리자 키를 만들어 넣어 주세요.",
    };
  }
  const start = Math.floor(Date.now() / 1000) - days * DAY;
  const headers = { authorization: `Bearer ${key}` };
  const limit = Math.min(180, Math.max(1, days + 1));

  try {
    const [costRes, usageRes] = await Promise.all([
      fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&limit=${limit}`, {
        headers,
        cache: "no-store",
      }),
      fetch(
        `https://api.openai.com/v1/organization/usage/completions?start_time=${start}&bucket_width=1d&group_by=model&group_by=service_tier&limit=${limit}`,
        { headers, cache: "no-store" }
      ),
    ]);
    if (costRes.status === 401 || costRes.status === 403) {
      return {
        ok: false,
        reason: "no_permission",
        message: "관리자 키에 api.usage.read 권한이 없습니다. 키 권한을 확인해 주세요.",
      };
    }
    if (!costRes.ok || !usageRes.ok) {
      return { ok: false, reason: "failed", message: "OpenAI 사용량을 받아오지 못했습니다." };
    }

    const cost = (await costRes.json()) as { data?: CostBucket[] };
    const usage = (await usageRes.json()) as { data?: UsageBucket[] };

    const billed = new Map<string, number>();
    for (const b of cost.data ?? []) {
      const d = ymd(b.start_time);
      for (const r of b.results ?? []) {
        billed.set(d, (billed.get(d) ?? 0) + Number(r.amount?.value ?? 0) * WON_PER_USD);
      }
    }

    const ours = new Map<string, number>();
    const unknown = new Map<string, Set<string>>();
    for (const b of usage.data ?? []) {
      const d = ymd(b.start_time);
      for (const r of b.results ?? []) {
        const won = usageWon({
          model: String(r.model ?? "") + (String(r.service_tier ?? "").startsWith("flex") ? "@flex" : ""),
          input_tokens: Number(r.input_tokens ?? 0),
          cached_input_tokens: Number(r.input_cached_tokens ?? 0),
          output_tokens: Number(r.output_tokens ?? 0),
        });
        if (won === null) {
          if (!unknown.has(d)) unknown.set(d, new Set());
          unknown.get(d)!.add(String(r.model ?? "?"));
          continue;
        }
        ours.set(d, (ours.get(d) ?? 0) + won);
      }
    }

    const dates = [...new Set([...billed.keys(), ...ours.keys()])].sort().reverse();
    const out: BillingDay[] = dates.map((date) => ({
      date,
      billedWon: billed.get(date) ?? 0,
      byOurPriceWon: ours.get(date) ?? 0,
      unknownModels: [...(unknown.get(date) ?? [])],
    }));
    return {
      ok: true,
      days: out,
      totalBilledWon: out.reduce((n, d) => n + d.billedWon, 0),
      totalByOurPriceWon: out.reduce((n, d) => n + d.byOurPriceWon, 0),
    };
  } catch {
    return { ok: false, reason: "failed", message: "OpenAI에 닿지 못했습니다." };
  }
}
