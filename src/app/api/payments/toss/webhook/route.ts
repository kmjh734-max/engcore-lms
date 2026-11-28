import { NextResponse } from "next/server";
import { getAdminClientSafe } from "@/lib/admin/api-json";
import { syncPaymentFromToss } from "@/lib/payments/credit-orders";

export const runtime = "nodejs";

/**
 * Toss webhook — never grant credits from payload alone.
 * Re-fetch payment from Toss API, then approve/refund idempotently.
 */
export async function POST(request: Request) {
  try {
    const client = getAdminClientSafe();
    if (!client.ok) return client.response;

    let body: {
      eventType?: string;
      data?: {
        paymentKey?: string;
        orderId?: string;
        status?: string;
      };
      paymentKey?: string;
      orderId?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const paymentKey =
      body.data?.paymentKey?.trim() || body.paymentKey?.trim() || undefined;
    const orderId =
      body.data?.orderId?.trim() || body.orderId?.trim() || undefined;

    if (!paymentKey && !orderId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    try {
      const order = await syncPaymentFromToss(client.admin, {
        paymentKey,
        orderId,
      });
      return NextResponse.json({
        ok: true,
        orderId: order?.order_id ?? null,
        status: order?.status ?? null,
      });
    } catch (e) {
      console.error(
        "[toss/webhook] sync failed",
        e instanceof Error ? e.message : e
      );
      // 토스 쪽 일시 오류(5xx·시간 초과·연결 끊김)면 500 — 토스가 웹훅을 다시 보내 놓치지 않게.
      // 업무상 오류(크레딧 이미 씀·잔액 부족 등)는 주문에 표시를 남겼으니 2xx 로 끝낸다.
      const status = (e as { status?: number })?.status;
      const name = (e as { name?: string })?.name;
      const transient =
        (typeof status === "number" && status >= 500) ||
        name === "AbortError" ||
        name === "TimeoutError" ||
        // fetch 연결 실패만(코드 버그로 난 TypeError 는 다시 받아도 같으니 제외)
        (e instanceof TypeError && /fetch failed|network|ECONN|ETIMEDOUT|socket/i.test(e.message));
      if (transient) {
        return NextResponse.json({ ok: false, retry: true }, { status: 503 });
      }
      return NextResponse.json({
        ok: false,
        message: e instanceof Error ? e.message : "sync failed",
      });
    }
  } catch (e) {
    console.error("[toss/webhook]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
