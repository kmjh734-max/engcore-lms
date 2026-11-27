import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelTossPayment,
  confirmTossPayment,
  isTossCanceledStatus,
  isTossPartialCanceledStatus,
  isTossPaidStatus,
  isTossVoidStatus,
  isTossWaitingStatus,
  retrieveTossPayment,
  retrieveTossPaymentByOrderId,
  type TossPayment,
} from "@/lib/payments/toss/client";

export type CreditPackage = {
  id: string;
  name: string;
  payment_amount: number;
  credit_amount: number;
  bonus_credit: number;
  is_active: boolean;
  display_order: number;
};

export type CreditPaymentOrder = {
  id: string;
  academy_id: string;
  package_id: string;
  order_id: string;
  payment_amount: number;
  paid_credit: number;
  bonus_credit: number;
  total_credit: number;
  status: string;
  payment_key: string | null;
  payment_method: string | null;
  receipt_url: string | null;
  requested_by: string;
  requested_at: string;
  approved_at: string | null;
  canceled_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

export function generatePaymentOrderId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(12).toString("hex");
  return `ord_${ts}_${rand}`;
}

/** 1회 충전 상한(부가세 포함) */
export const MAX_CHARGE_WON = 100_000;

export async function loadActivePackage(
  admin: SupabaseClient,
  packageId: string
): Promise<CreditPackage | null> {
  const { data } = await admin
    .from("credit_packages")
    .select(
      "id, name, payment_amount, credit_amount, bonus_credit, is_active, display_order"
    )
    .eq("id", packageId)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as CreditPackage;
}

export async function createReadyOrder(
  admin: SupabaseClient,
  params: {
    academyId: string;
    packageId: string;
    requestedBy: string;
  }
): Promise<CreditPaymentOrder> {
  const pkg = await loadActivePackage(admin, params.packageId);
  if (!pkg) {
    throw new Error("유효하지 않거나 비활성인 충전 상품입니다.");
  }
  // 충전업종 심사 조건: 1회 충전 10만 원 이하(토스 2026-10-12). 관리자 화면에서 값을 올려도 결제는 막는다.
  if (Number(pkg.payment_amount) > MAX_CHARGE_WON) {
    throw new Error("1회 충전 금액은 10만 원을 넘을 수 없습니다.");
  }

  const orderId = generatePaymentOrderId();
  const paid = Number(pkg.credit_amount);
  const bonus = Number(pkg.bonus_credit);
  const total = paid + bonus;

  const { data, error } = await admin
    .from("credit_payment_orders")
    .insert({
      academy_id: params.academyId,
      package_id: pkg.id,
      order_id: orderId,
      payment_amount: Number(pkg.payment_amount),
      paid_credit: paid,
      bonus_credit: bonus,
      total_credit: total,
      status: "ready",
      requested_by: params.requestedBy,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "주문 생성에 실패했습니다.");
  }
  return data as CreditPaymentOrder;
}

export async function getOrderByOrderId(
  admin: SupabaseClient,
  orderId: string
): Promise<CreditPaymentOrder | null> {
  const { data } = await admin
    .from("credit_payment_orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as CreditPaymentOrder) || null;
}

/** 아직 충전 전인 주문 상태 */
const OPEN_STATUSES = ["ready", "processing"];

/**
 * 주문 행 고치기. fromStatuses 를 주면 지금 상태가 그중 하나일 때만 바꾼다 —
 * 승인·취소된 주문을 늦게 온 요청이 덮어쓰지 않게. 실제로 바뀐 행이 있으면 true.
 */
/** 토스가 응답을 주며 분명히 거절했는가(4xx). 시간 초과·네트워크·5xx 는 아님 */
function isDefiniteTossReject(e: unknown): boolean {
  const s = (e as { status?: number })?.status;
  return typeof s === "number" && s >= 400 && s < 500;
}

async function markOrder(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  fromStatuses?: string[]
): Promise<boolean> {
  let q = admin
    .from("credit_payment_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (fromStatuses && fromStatuses.length > 0) {
    q = q.in("status", fromStatuses);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[credit-orders] markOrder", id, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function approveOrderInDb(
  admin: SupabaseClient,
  params: {
    orderUuid: string;
    paymentKey: string;
    paymentMethod?: string | null;
    receiptUrl?: string | null;
  }
): Promise<CreditPaymentOrder> {
  const { data, error } = await admin.rpc("approve_credit_payment_order", {
    p_order_uuid: params.orderUuid,
    p_payment_key: params.paymentKey,
    p_payment_method: params.paymentMethod ?? null,
    p_receipt_url: params.receiptUrl ?? null,
  });
  if (error) throw new Error(error.message);
  return data as CreditPaymentOrder;
}

function paymentMethodLabel(p: TossPayment): string | null {
  if (p.method) return String(p.method);
  if (p.card?.company) return String(p.card.company);
  return null;
}

/**
 * Confirm with Toss then credit once. Safe to retry.
 */
export async function confirmAndCreditOrder(
  admin: SupabaseClient,
  params: {
    orderId: string;
    paymentKey: string;
    amountFromClient: number;
    academyId: string;
  }
): Promise<{ order: CreditPaymentOrder; alreadyApproved: boolean }> {
  const order = await getOrderByOrderId(admin, params.orderId);
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  if (order.academy_id !== params.academyId) {
    throw new Error("다른 학원의 주문입니다.");
  }

  if (order.status === "approved") {
    return { order, alreadyApproved: true };
  }
  if (order.status === "canceled" || order.status === "cancel_pending") {
    throw new Error("취소된(또는 취소 중인) 주문입니다.");
  }
  if (order.status === "failed") {
    throw new Error("실패한 주문입니다. 새 주문을 만들어 주세요.");
  }

  if (Number(order.payment_amount) !== Number(params.amountFromClient)) {
    await markOrder(
      admin,
      order.id,
      {
        status: "failed",
        failure_code: "AMOUNT_mismatch",
        failure_message: "결제 금액이 주문과 일치하지 않습니다.",
      },
      OPEN_STATUSES
    );
    throw new Error("결제 금액이 주문과 일치하지 않습니다.");
  }

  const claimed = await markOrder(
    admin,
    order.id,
    { status: "processing" },
    OPEN_STATUSES
  );
  if (!claimed) {
    // 그사이 웹훅 등이 먼저 처리했을 수 있다
    const fresh = await getOrderByOrderId(admin, order.order_id);
    if (fresh?.status === "approved") {
      return { order: fresh, alreadyApproved: true };
    }
    throw new Error("주문 상태가 바뀌었습니다. 결제 내역을 확인해 주세요.");
  }

  let tossPayment: TossPayment;
  try {
    tossPayment = await confirmTossPayment({
      paymentKey: params.paymentKey,
      orderId: order.order_id,
      amount: Number(order.payment_amount),
    });
  } catch (e) {
    // Already confirmed on Toss → retrieve and recover
    const msg = e instanceof Error ? e.message : "";
    const code = (e as { code?: string })?.code || "";
    if (
      /ALREADY_PROCESSED|already/i.test(code) ||
      /이미 처리/i.test(msg)
    ) {
      tossPayment = await retrieveTossPayment(params.paymentKey);
    } else {
      // 시간 초과·네트워크·토스 5xx 면 결제가 실제로 됐을 수 있다 → 토스에 다시 물어본다.
      const recovered = await retrieveTossPayment(params.paymentKey).catch(
        () => null
      );
      if (
        recovered &&
        recovered.orderId === order.order_id &&
        (isTossPaidStatus(recovered.status) ||
          isTossWaitingStatus(recovered.status))
      ) {
        tossPayment = recovered;
      } else {
        const httpStatus = (e as { status?: number })?.status;
        // 다른 요청(두 번 누름·다른 탭)이 승인 중이면 토스가 IN_PROGRESS·READY 로 보인다 → failed 로 덮지 않는다.
        const otherInFlight =
          recovered?.orderId === order.order_id &&
          ["IN_PROGRESS", "READY"].includes(String(recovered?.status));
        const definite =
          !otherInFlight &&
          typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500;
        // 토스가 분명히 거절(4xx)했을 때만 failed. 응답을 못 받은 경우는 processing 으로 두어
        // 웹훅(DONE)이 오면 충전되게 한다. failed 여도 토스가 DONE 이면 syncPaymentFromToss 가 되살린다.
        await markOrder(
          admin,
          order.id,
          definite
            ? {
                status: "failed",
                failure_code: code || "confirm_failed",
                failure_message: msg.slice(0, 500),
              }
            : {
                failure_code: code || "confirm_unknown",
                failure_message: msg.slice(0, 500),
              },
          ["processing"]
        );
        throw e;
      }
    }
  }

  if (tossPayment.orderId !== order.order_id) {
    throw new Error("토스 응답 orderId가 일치하지 않습니다.");
  }
  if (Number(tossPayment.totalAmount) !== Number(order.payment_amount)) {
    throw new Error("토스 승인 금액이 주문과 일치하지 않습니다.");
  }
  if (isTossWaitingStatus(tossPayment.status)) {
    // 입금 전 — 주문은 processing 그대로. 입금되면 웹훅(DONE)에서 충전한다.
    throw new Error("입금이 확인되면 크레딧이 충전됩니다.");
  }
  if (!isTossPaidStatus(tossPayment.status)) {
    throw new Error(`결제 상태가 승인 완료가 아닙니다: ${tossPayment.status}`);
  }

  let approved: CreditPaymentOrder;
  try {
    approved = await approveOrderInDb(admin, {
      orderUuid: order.id,
      paymentKey: tossPayment.paymentKey,
      paymentMethod: paymentMethodLabel(tossPayment),
      receiptUrl: tossPayment.receipt?.url ?? null,
    });
  } catch (e) {
    // 그사이 다른 요청이 주문을 failed 등으로 바꿨으면, 토스 실제 상태(DONE)로 다시 맞춘다.
    const synced = await syncPaymentFromToss(admin, {
      paymentKey: tossPayment.paymentKey,
    }).catch(() => null);
    if (synced?.status === "approved") {
      return { order: synced, alreadyApproved: true };
    }
    throw e;
  }

  return { order: approved, alreadyApproved: false };
}

/**
 * Webhook / recovery: never trust payload alone — re-fetch from Toss.
 */
export async function syncPaymentFromToss(
  admin: SupabaseClient,
  params: { orderId?: string; paymentKey?: string }
): Promise<CreditPaymentOrder | null> {
  let toss: TossPayment | null = null;
  if (params.paymentKey) {
    toss = await retrieveTossPayment(params.paymentKey);
  } else if (params.orderId) {
    toss = await retrieveTossPaymentByOrderId(params.orderId);
  }
  if (!toss) return null;

  let order = await getOrderByOrderId(admin, toss.orderId);
  if (!order) return null;

  if (isTossCanceledStatus(toss.status)) {
    if (order.status === "canceled") return order;
    if (order.status === "approved" || order.status === "cancel_pending") {
      return settleTossCancels(admin, order, toss, order.requested_by);
    }
    // 충전 전 주문 — 크레딧을 준 적 없으니 취소로만 바꾼다
    await markOrder(
      admin,
      order.id,
      {
        status: "canceled",
        canceled_at: new Date().toISOString(),
      },
      [...OPEN_STATUSES, "failed"]
    );
    return (await getOrderByOrderId(admin, order.order_id))!;
  }

  if (isTossVoidStatus(toss.status)) {
    // 입금 기한 지남·승인 실패 — 충전 없이 실패로
    await markOrder(
      admin,
      order.id,
      {
        status: "failed",
        failure_code: `toss_${toss.status.toLowerCase()}`,
        failure_message: `토스 결제 상태: ${toss.status}`,
      },
      OPEN_STATUSES
    );
    return (await getOrderByOrderId(admin, order.order_id))!;
  }

  if (isTossPaidStatus(toss.status)) {
    if (Number(toss.totalAmount) !== Number(order.payment_amount)) {
      return order;
    }
    if (order.status === "approved") return order;
    if (order.status === "failed") {
      // 승인 요청이 실패로 남았지만 토스는 DONE — 다시 열어 충전한다(승인 RPC는 ready/processing만 받음)
      await markOrder(admin, order.id, { status: "processing" }, ["failed"]);
      const fresh = await getOrderByOrderId(admin, order.order_id);
      if (!fresh) return null;
      order = fresh;
      if (order.status === "approved") return order;
    }
    if (order.status === "ready" || order.status === "processing") {
      return approveOrderInDb(admin, {
        orderUuid: order.id,
        paymentKey: toss.paymentKey,
        paymentMethod: paymentMethodLabel(toss),
        receiptUrl: toss.receipt?.url ?? null,
      });
    }
  }

  return order;
}

/** 토스는 취소됐는데 크레딧 회수가 막힌 주문을 cancel_pending 으로 남긴다(최고관리자 확인용). */
async function markRefundBlocked(
  admin: SupabaseClient,
  order: CreditPaymentOrder,
  tossStatus: string,
  reason: string
) {
  const blocked = /credits_already_used|insufficient_balance_for_refund|insufficient_credits/.test(
    reason
  );
  await markOrder(
    admin,
    order.id,
    {
      status: "cancel_pending",
      failure_code: blocked
        ? "toss_canceled_credit_unrecovered"
        : "refund_db_failed",
      failure_message:
        `토스 결제 취소(${tossStatus}) — 크레딧 ${Number(order.total_credit)} 회수 못 함: ${reason}`.slice(
          0,
          500
        ),
    },
    ["approved", "cancel_pending"]
  );
  console.error("[credit-orders] toss canceled but credits not recovered", {
    orderId: order.order_id,
    academyId: order.academy_id,
    totalCredit: order.total_credit,
    reason,
  });
}

export async function cancelApprovedOrder(
  admin: SupabaseClient,
  params: {
    orderUuid: string;
    actorId: string;
    cancelReason: string;
  }
): Promise<CreditPaymentOrder> {
  const { data: order, error } = await admin
    .from("credit_payment_orders")
    .select("*")
    .eq("id", params.orderUuid)
    .maybeSingle();

  if (error || !order) throw new Error("주문을 찾을 수 없습니다.");
  const o = order as CreditPaymentOrder;

  if (o.status === "canceled") return o;
  if (o.status !== "approved" && o.status !== "cancel_pending") {
    throw new Error("승인 완료된 결제만 취소할 수 있습니다.");
  }
  if (!o.payment_key) throw new Error("paymentKey가 없습니다.");

  // Pre-check usage before calling Toss
  const { count: debitCount } = await admin
    .from("credit_transactions")
    .select("id", { count: "exact", head: true })
    .eq("academy_id", o.academy_id)
    .eq("type", "debit")
    .gte("created_at", o.approved_at ?? o.created_at);

  if ((debitCount ?? 0) > 0) {
    throw new Error(
      "해당 충전 이후 크레딧이 사용되어 자동 취소할 수 없습니다. 수동 확인이 필요합니다."
    );
  }

  const { data: wallet } = await admin
    .from("academy_wallets")
    .select("balance")
    .eq("academy_id", o.academy_id)
    .maybeSingle();
  // 부분 취소로 이미 거둔 만큼은 빼고 본다
  const already = (await partialRecovered(admin, o)).sum;
  if ((wallet?.balance ?? 0) < Number(o.total_credit) - already) {
    throw new Error(
      "잔액이 충전분보다 적어 자동 취소할 수 없습니다. 수동 확인이 필요합니다."
    );
  }

  await markOrder(admin, o.id, { status: "cancel_pending" }, [
    "approved",
    "cancel_pending",
  ]);

  let canceled: TossPayment | null = null;
  try {
    canceled = await cancelTossPayment({
      paymentKey: o.payment_key,
      cancelReason: params.cancelReason,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "토스 취소 실패";
    const code = (e as { code?: string })?.code || "";
    if (!/ALREADY_CANCELED|이미 취소/i.test(`${code} ${msg}`)) {
      await markOrder(
        admin,
        o.id,
        {
          // 토스가 분명히 거절(4xx)했으면 돈도 크레딧도 그대로이니 approved 로 되돌린다.
          ...(isDefiniteTossReject(e) ? { status: "approved" } : {}),
          failure_code: code || "cancel_failed",
          failure_message: msg.slice(0, 500),
        },
        ["cancel_pending"]
      );
      throw e;
    }
  }

  // 취소 내역(부분 취소가 먼저 있었는지)은 토스 응답으로 본다. 이미 취소돼 있던 경우엔 다시 읽는다.
  const toss =
    canceled ?? (await retrieveTossPayment(o.payment_key).catch(() => null));
  return settleTossCancels(
    admin,
    o,
    toss ?? ({ status: "CANCELED", cancels: null } as unknown as TossPayment),
    params.actorId
  );
}

const PARTIAL_KEY = (orderId: string) => `toss_partial:${orderId}:`;
/** LIKE 에서 _ · % 가 아무 글자로 읽히지 않게 */
const PARTIAL_LIKE = (orderId: string) =>
  PARTIAL_KEY(orderId).replace(/[\\%_]/g, (c) => "\\" + c) + "%";

/** 부분 취소로 이미 거둔 크레딧 합 */
async function partialRecovered(
  admin: SupabaseClient,
  order: CreditPaymentOrder
): Promise<{ count: number; sum: number }> {
  const { data } = await admin
    .from("credit_transactions")
    .select("amount")
    .eq("academy_id", order.academy_id)
    .like("idempotency_key", PARTIAL_LIKE(order.order_id));
  const rows = data ?? [];
  return {
    count: rows.length,
    sum: rows.reduce((t, r) => t + Number((r as { amount: number }).amount || 0), 0),
  };
}

/**
 * 토스 취소(전액·부분)를 크레딧에 반영한다.
 * - 부분 취소가 한 번도 없던 전액 취소: 예전과 같이 refund_credit_payment_order(사용 여부·잔액 확인 포함).
 * - 부분 취소: 취소된 금액 비율만큼만 거둔다(취소 건마다 한 번, 같은 웹훅이 다시 와도 다시 거두지 않음).
 *   누적 비율로 계산해 끝에 전액이 취소되면 정확히 충전량 전부가 된다.
 */
async function settleTossCancels(
  admin: SupabaseClient,
  order: CreditPaymentOrder,
  toss: TossPayment,
  actorId: string
): Promise<CreditPaymentOrder> {
  const full = !isTossPartialCanceledStatus(toss.status);
  const cancels = (toss.cancels ?? [])
    .filter(
      (c) =>
        Number(c.cancelAmount) > 0 &&
        !!c.transactionKey &&
        (!c.cancelStatus || c.cancelStatus.toUpperCase() === "DONE")
    )
    .sort((a, b) =>
      String(a.canceledAt ?? "").localeCompare(String(b.canceledAt ?? ""))
    );

  const { count: partialDone } = await partialRecovered(admin, order);

  if (full && partialDone === 0 && cancels.length <= 1) {
    const { data, error } = await admin.rpc("refund_credit_payment_order", {
      p_order_uuid: order.id,
      p_actor_id: actorId,
      p_force: false,
    });
    if (error) {
      // 토스에서는 돈이 이미 돌아갔는데 크레딧을 못 거둠(이미 씀·잔액 부족 등).
      // cancel_pending 으로 남겨 최고관리자 결제내역에서 보이게 하고 손으로 맞춘다.
      await markRefundBlocked(admin, order, toss.status, error.message);
      throw new Error(error.message);
    }
    return data as CreditPaymentOrder;
  }

  const totalWon = Number(order.payment_amount);
  const totalCredit = Number(order.total_credit);
  if (!(totalWon > 0) || cancels.length === 0) {
    const reason = "토스 취소 내역을 읽지 못함";
    if (full) await markRefundBlocked(admin, order, toss.status, reason);
    else await markPartialBlocked(admin, order, reason);
    throw new Error(reason);
  }

  let cumWon = 0;
  let prevCredit = 0;
  for (const c of cancels) {
    cumWon = Math.min(totalWon, cumWon + Number(c.cancelAmount));
    const target =
      cumWon >= totalWon ? totalCredit : Math.floor((totalCredit * cumWon) / totalWon);
    const amount = target - prevCredit;
    prevCredit = target;
    if (amount <= 0) continue;
    const { error } = await admin.rpc("adjust_academy_credits", {
      p_academy_id: order.academy_id,
      p_amount: amount,
      p_direction: "debit",
      p_actor_id: actorId,
      p_note: `토스페이먼츠 결제 부분 취소 회수 (${Number(c.cancelAmount).toLocaleString("ko-KR")}원)`,
      p_idempotency_key: `${PARTIAL_KEY(order.order_id)}${c.transactionKey}`,
    });
    if (error) {
      if (full) await markRefundBlocked(admin, order, toss.status, error.message);
      else await markPartialBlocked(admin, order, error.message);
      throw new Error(error.message);
    }
  }

  if (full) {
    await markOrder(
      admin,
      order.id,
      {
        status: "canceled",
        canceled_at: new Date().toISOString(),
        failure_code: null,
        failure_message: null,
      },
      ["approved", "cancel_pending"]
    );
  } else {
    // 부분 취소 표시만 지운다(그사이 다른 표시가 붙었으면 그대로)
    await admin
      .from("credit_payment_orders")
      .update({ failure_code: null, failure_message: null, updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "approved")
      .eq("failure_code", "toss_partial_credit_unrecovered");
  }
  return (await getOrderByOrderId(admin, order.order_id)) ?? order;
}

/** 부분 취소분 크레딧을 못 거둠 — 결제는 남아 있으니 상태는 그대로, 결제내역에 표시만. */
async function markPartialBlocked(
  admin: SupabaseClient,
  order: CreditPaymentOrder,
  reason: string
) {
  await markOrder(
    admin,
    order.id,
    {
      failure_code: "toss_partial_credit_unrecovered",
      failure_message: `토스 부분 취소 — 취소분 크레딧 회수 못 함: ${reason}`.slice(0, 500),
    },
    ["approved"]
  );
  console.error("[credit-orders] toss partial cancel, credits not recovered", {
    orderId: order.order_id,
    academyId: order.academy_id,
    reason,
  });
}
