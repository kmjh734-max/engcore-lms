import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 값을 따로 받지 않는 보조 호출(목차 사진 읽기·생활기록부 글자 읽기 등)의 테두리(2026-11-28).
 *
 * 값표(feature_pricing)에 맞는 기능이 없어 차감은 하지 않는다. 대신 잔액이 있는 학원만 쓰게 하고,
 * 하루(24시간) 호출 수를 ai_usage_logs에서 세어 넘으면 막는다. 보통 쓰는 양의 몇 배로 넉넉히 잡는다.
 */
export async function aiDailyCapError(params: {
  academyId: string | null | undefined;
  usedFor: string;
  maxPerDay: number;
  /** 잔액이 0 이하이면 막는다 */
  requireBalance?: boolean;
}): Promise<NextResponse | null> {
  if (!params.academyId) {
    return NextResponse.json(
      { ok: false, message: "소속 학원 정보가 없습니다.", code: "no_academy" },
      { status: 403 }
    );
  }
  const admin = createAdminClient();
  const [wallet, logs] = await Promise.all([
    params.requireBalance
      ? admin.from("academy_wallets").select("balance").eq("academy_id", params.academyId).maybeSingle()
      : Promise.resolve(null),
    aiCallsLastDay(params.academyId, params.usedFor),
  ]);
  // 후불 차감(allowNegative)으로 잔액이 0 아래인 학원(정수학원 포함)도 있어 0 이하가 아니라 크게 밀린 경우만 막는다.
  if (wallet && Number(wallet.data?.balance ?? 0) <= -100_000) {
    return NextResponse.json(
      {
        ok: false,
        message: "크레딧이 부족합니다. 학원 관리자에게 충전을 요청해 주세요.",
        code: "insufficient_credits",
      },
      { status: 402 }
    );
  }
  if (logs >= params.maxPerDay) {
    return NextResponse.json(
      { ok: false, message: "오늘 쓸 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요.", code: "daily_limit" },
      { status: 429 }
    );
  }
  return null;
}

/** 이 학원이 지난 24시간 동안 이 자리(used_for)에서 부른 횟수 */
export async function aiCallsLastDay(academyId: string, usedFor: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("ai_usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("academy_id", academyId)
    .eq("used_for", usedFor)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return count ?? 0;
}
