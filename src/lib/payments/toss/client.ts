import { assertTossServerConfigured } from "@/lib/payments/toss/env";

const TOSS_API = "https://api.tosspayments.com/v1";

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  orderName?: string;
  status: string;
  totalAmount: number;
  method?: string | null;
  receipt?: { url?: string | null } | null;
  card?: { company?: string; number?: string } | null;
  fails?: Array<{ code?: string; message?: string }>;
  canceledAt?: string | null;
};

function authHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

async function tossFetch<T>(
  path: string,
  init: RequestInit & { secretKey?: string } = {}
): Promise<T> {
  const { secretKey } = init.secretKey
    ? { secretKey: init.secretKey }
    : assertTossServerConfigured();
  const { secretKey: _s, ...rest } = init as RequestInit & { secretKey?: string };
  void _s;

  const res = await fetch(`${TOSS_API}${path}`, {
    ...rest,
    headers: {
      Authorization: authHeader(secretKey),
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : "TOSS_ERROR";
    const message =
      typeof body.message === "string"
        ? body.message
        : "토스페이먼츠 요청에 실패했습니다.";
    const err = new Error(message) as Error & { code: string; status: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export async function confirmTossPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossPayment> {
  return tossFetch<TossPayment>("/payments/confirm", {
    method: "POST",
    body: JSON.stringify({
      paymentKey: params.paymentKey,
      orderId: params.orderId,
      amount: params.amount,
    }),
  });
}

export async function retrieveTossPayment(
  paymentKey: string
): Promise<TossPayment> {
  return tossFetch<TossPayment>(
    `/payments/${encodeURIComponent(paymentKey)}`,
    { method: "GET" }
  );
}

export async function retrieveTossPaymentByOrderId(
  orderId: string
): Promise<TossPayment> {
  return tossFetch<TossPayment>(
    `/payments/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" }
  );
}

export async function cancelTossPayment(params: {
  paymentKey: string;
  cancelReason: string;
}): Promise<TossPayment> {
  return tossFetch<TossPayment>(
    `/payments/${encodeURIComponent(params.paymentKey)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ cancelReason: params.cancelReason }),
    }
  );
}

/** 돈이 실제로 들어온 상태만. WAITING_FOR_DEPOSIT(가상계좌 입금 전)은 아직 아님 — 입금되면 DONE 웹훅으로 충전. */
export function isTossPaidStatus(status: string | undefined | null): boolean {
  const s = (status || "").toUpperCase();
  return s === "DONE";
}

/** 입금 대기(가상계좌). 주문은 processing 그대로 두고 DONE 이 오면 충전. */
export function isTossWaitingStatus(status: string | undefined | null): boolean {
  const s = (status || "").toUpperCase();
  return s === "WAITING_FOR_DEPOSIT";
}

export function isTossCanceledStatus(status: string | undefined | null): boolean {
  const s = (status || "").toUpperCase();
  return s === "CANCELED" || s === "PARTIAL_CANCELED";
}

/** 결제가 끝내 성립하지 않은 상태(입금 기한 지남·승인 실패). */
export function isTossVoidStatus(status: string | undefined | null): boolean {
  const s = (status || "").toUpperCase();
  return s === "EXPIRED" || s === "ABORTED";
}
