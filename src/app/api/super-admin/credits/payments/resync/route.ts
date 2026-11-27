import { NextResponse } from "next/server";
import { requireSuperAdminApi } from "@/lib/auth/require-super-admin-api";
import { getAdminClientSafe } from "@/lib/admin/api-json";
import { syncPaymentFromToss } from "@/lib/payments/credit-orders";

export const runtime = "nodejs";

/**
 * 최고관리자: 토스 실제 상태로 주문을 다시 맞춘다(웹훅을 손으로 다시 돌리는 것과 같음).
 * 토스에 취소를 요청하지 않는다 — 부분 취소분 크레딧 회수를 다시 시도할 때 쓴다.
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdminApi();
  if ("error" in auth && auth.error) return auth.error;
  const client = getAdminClientSafe();
  if (!client.ok) return client.response;

  const body = (await request.json().catch(() => ({}))) as { order_id?: string };
  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ ok: false, message: "order_id 가 없습니다." }, { status: 400 });
  }
  try {
    const order = await syncPaymentFromToss(client.admin, { orderId });
    return NextResponse.json({ ok: true, order });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "다시 맞추지 못했습니다." },
      { status: 500 }
    );
  }
}
