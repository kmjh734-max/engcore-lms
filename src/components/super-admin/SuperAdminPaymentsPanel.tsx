"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

type Order = {
  id: string;
  academy_id: string;
  academy_name: string | null;
  order_id: string;
  payment_amount: number;
  total_credit: number;
  bonus_credit: number;
  status: string;
  payment_method: string | null;
  receipt_url: string | null;
  approved_at: string | null;
  created_at: string;
  failure_code: string | null;
  failure_message: string | null;
};

type Pkg = {
  id: string;
  name: string;
  payment_amount: number;
  credit_amount: number;
  bonus_credit: number;
  is_active: boolean;
  display_order: number;
};

export function SuperAdminPaymentsPanel({
  visibleIds = null,
  kindById = {},
}: {
  /** 학원회원·개인회원 중 하나만 볼 때 그 회원들의 id(전체면 null) */
  visibleIds?: Set<string> | null;
  kindById?: Record<string, "academy" | "personal">;
} = {}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [oRes, pRes] = await Promise.all([
        fetch("/api/super-admin/credits/payments?limit=80"),
        fetch("/api/super-admin/credits/packages"),
      ]);
      const oData = await oRes.json();
      const pData = await pRes.json();
      if (!oData.ok) {
        setError(oData.message ?? "결제내역 조회 실패");
      } else {
        setOrders(oData.orders ?? []);
      }
      if (pData.ok) setPackages(pData.packages ?? []);
    } catch {
      setError("결제 데이터를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelOrder(id: string) {
    if (
      !confirm(
        "이 결제를 전체 취소할까요? (충전 이후 크레딧을 쓰지 않은 경우만 가능)"
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/payments/toss/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_uuid: id }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "취소 실패");
        return;
      }
      setMessage("결제가 취소되고 크레딧이 회수되었습니다.");
      await load();
    } catch {
      setError("취소 요청 실패");
    } finally {
      setBusy(false);
    }
  }

  async function togglePackage(pkg: Pkg) {
    setBusy(true);
    try {
      const res = await fetch("/api/super-admin/credits/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pkg.id, is_active: !pkg.is_active }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "상품 수정 실패");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            토스 결제 내역
          </h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void load()}
          >
            새로고침
          </Button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="ui-table w-full text-sm">
            <thead>
              <tr>
                <th>학원</th>
                <th>금액</th>
                <th>크레딧</th>
                <th>주문번호</th>
                <th>상태</th>
                <th>결제일</th>
                <th>수단</th>
                <th>영수증</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders
                .filter((o) => !visibleIds || visibleIds.has(o.academy_id))
                .map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">
                    {o.academy_name ?? "—"}
                    {kindById[o.academy_id] === "personal" ? (
                      <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">개인</span>
                    ) : null}
                  </td>
                  <td className="tabular-nums">
                    {Number(o.payment_amount).toLocaleString("ko-KR")}원
                  </td>
                  <td className="tabular-nums">
                    {Number(o.total_credit).toLocaleString("ko-KR")}
                    {Number(o.bonus_credit) > 0
                      ? ` (+${Number(o.bonus_credit).toLocaleString("ko-KR")})`
                      : ""}
                  </td>
                  <td className="max-w-[120px] truncate font-mono text-[11px]">
                    {o.order_id}
                  </td>
                  <td className="text-xs">
                    {o.status}
                    {o.failure_code ? (
                      <span
                        className="block text-red-600"
                        title={o.failure_message ?? undefined}
                      >
                        {o.failure_code === "toss_canceled_credit_unrecovered"
                          ? "토스 취소됨 · 크레딧 회수 필요"
                          : o.failure_code === "toss_partial_credit_unrecovered"
                            ? "토스 부분 취소 · 크레딧 회수 필요"
                            : o.failure_code}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {o.approved_at
                      ? new Date(o.approved_at).toLocaleString("ko-KR")
                      : new Date(o.created_at).toLocaleString("ko-KR")}
                  </td>
                  <td className="text-xs">{o.payment_method ?? "—"}</td>
                  <td>
                    {o.receipt_url ? (
                      <a
                        href={o.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-700 underline"
                      >
                        보기
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {(o.status === "approved" ||
                      o.status === "cancel_pending") && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => void cancelOrder(o.id)}
                      >
                        취소
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500">
                    결제 내역이 없습니다. (마이그레이션 095 적용 후 표시)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">충전 상품 (DB)</h2>
        <p className="mt-1 text-xs text-slate-500">
          결제 금액·지급 크레딧은 DB에서 관리합니다. 비활성 상품은 학원 화면에
          보이지 않습니다.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="ui-table w-full text-sm">
            <thead>
              <tr>
                <th>이름</th>
                <th>결제</th>
                <th>기본</th>
                <th>보너스</th>
                <th>합계</th>
                <th>활성</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td className="tabular-nums">
                    {Number(p.payment_amount).toLocaleString("ko-KR")}원
                  </td>
                  <td className="tabular-nums">
                    {Number(p.credit_amount).toLocaleString("ko-KR")}
                  </td>
                  <td className="tabular-nums text-emerald-700">
                    {Number(p.bonus_credit).toLocaleString("ko-KR")}
                  </td>
                  <td className="tabular-nums font-semibold">
                    {(
                      Number(p.credit_amount) + Number(p.bonus_credit)
                    ).toLocaleString("ko-KR")}
                  </td>
                  <td>{p.is_active ? "ON" : "OFF"}</td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void togglePackage(p)}
                    >
                      {p.is_active ? "비활성" : "활성"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
