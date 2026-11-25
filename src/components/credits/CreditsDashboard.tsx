"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type {
  CreditKind,
  CreditsPageData,
  CreditTxnView,
} from "@/lib/credits/load-credits-page";

const n = (v: number) => v.toLocaleString("ko-KR");

const KIND_PILL: Record<CreditKind, { label: string; cls: string }> = {
  use: { label: "사용", cls: "bg-slate-100 text-slate-600" },
  charge: { label: "충전", cls: "bg-green-50 text-green-700" },
  grant: { label: "지급", cls: "bg-green-50 text-green-700" },
  adjust: { label: "조정", cls: "bg-brand-50 text-brand-700" },
  refund: { label: "환불", cls: "bg-amber-50 text-amber-700" },
};

const RECEIPT_STATUS: Record<string, { label: string; cls: string }> = {
  approved: { label: "결제 완료", cls: "bg-green-50 text-green-700" },
  canceled: { label: "취소됨", cls: "bg-slate-100 text-slate-600" },
  cancel_pending: { label: "취소 중", cls: "bg-amber-50 text-amber-700" },
  failed: { label: "결제 안 됨", cls: "bg-rose-50 text-rose-700" },
  ready: { label: "결제 전", cls: "bg-slate-100 text-slate-600" },
  processing: { label: "확인 중", cls: "bg-slate-100 text-slate-600" },
};

function shortDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function fullDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function CardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex h-[22px] items-center whitespace-nowrap rounded px-2 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function paceText(weeksLeft: number | null): string | null {
  if (weeksLeft === null) return null;
  if (weeksLeft < 1) return "이번 달 쓰는 속도면 1주 안에 다 써요";
  if (weeksLeft <= 12) return `이번 달 쓰는 속도면 약 ${weeksLeft}주 쓸 수 있어요`;
  return `이번 달 쓰는 속도면 약 ${Math.round(weeksLeft / 4.3)}개월 쓸 수 있어요`;
}

type Tab = "history" | "receipts" | "prices";
type Filter = "all" | "use" | "charge";

export function CreditsDashboard({
  data,
  canCharge = false,
}: {
  data: CreditsPageData;
  /** 학원 관리자만 true — 강사는 보기만 */
  canCharge?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("history");
  const [filter, setFilter] = useState<Filter>("all");

  const txns = useMemo(
    () =>
      data.transactions.filter((t: CreditTxnView) =>
        filter === "all"
          ? true
          : filter === "use"
            ? t.kind === "use" || (t.kind === "adjust" && t.delta < 0)
            : t.kind === "charge" || t.kind === "grant" || t.kind === "refund"
      ),
    [data.transactions, filter]
  );

  const maxGroup = Math.max(1, ...data.usageGroups.map((g) => g.amount));
  const pace = paceText(data.weeksLeft);
  const tabs: { id: Tab; label: string }[] = [
    { id: "history", label: "사용·충전 내역" },
    ...(data.receipts ? [{ id: "receipts" as Tab, label: "충전 영수증" }] : []),
    { id: "prices", label: "기능별 가격" },
  ];

  function changeMonth(value: string) {
    startTransition(() => {
      router.replace(`${pathname}?month=${value}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-[22px]">크레딧</h1>
          <p className="mt-1 text-sm text-slate-500">
            1크레딧 = 1원 · 기능을 쓸 때마다, 단어·듣기는 학생마다 매달 한 번 차감돼요.
          </p>
        </div>
        {canCharge ? (
          <Link
            href="/admin/credits/charge"
            className="inline-flex h-9 items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-md border border-brand-600 bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:border-brand-700 hover:bg-brand-700 sm:self-auto"
          >
            <CardIcon />
            충전하기
          </Link>
        ) : (
          <p className="text-[13px] text-slate-500">충전은 원장님(관리자)께 요청해 주세요.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-lg bg-side px-6 py-[22px] text-white">
          <span className="text-[13px] text-side-muted">남은 크레딧</span>
          <span className="text-[38px] font-extrabold leading-none tracking-tight tabular-nums">
            {n(data.balance)}
          </span>
          {pace ? <span className="text-[13px] text-side-text">{pace}</span> : null}
          <div className="h-px bg-[#223a58]" />
          <div className="flex justify-between text-[13px]">
            <span className="text-side-muted">이번 달 사용</span>
            <span className="font-bold tabular-nums">{n(data.thisMonth.used)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-side-muted">이번 달 충전</span>
            <span className="font-bold tabular-nums">{n(data.thisMonth.charged)}</span>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white px-5 py-[18px] shadow-card sm:px-[22px]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold text-slate-900">
              {data.thisMonth.month}월 어디에 썼나
            </h2>
            <span className="text-xs tabular-nums text-slate-500">
              {n(data.thisMonth.used)} 크레딧
            </span>
          </div>
          {data.usageGroups.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              이번 달에는 아직 쓴 크레딧이 없어요.
            </p>
          ) : (
            <ul className="mt-3.5 flex flex-col gap-2.5">
              {data.usageGroups.map((g) => (
                <li
                  key={g.label}
                  className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-3 gap-y-1 sm:grid-cols-[150px_minmax(0,1fr)_90px]"
                >
                  <span className="truncate text-[13px] text-slate-900">{g.label}</span>
                  <div className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-slate-100 sm:order-none sm:col-span-1">
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${Math.max(3, Math.round((g.amount / maxGroup) * 100))}%` }}
                    />
                  </div>
                  <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
                    {n(g.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <nav aria-label="크레딧 메뉴" className="flex gap-6 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={on ? "page" : undefined}
              className={`-mb-px flex h-10 shrink-0 items-center border-b-2 text-sm transition ${
                on
                  ? "border-brand-600 font-bold text-slate-900"
                  : "border-transparent font-medium text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "history" ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white" role="tablist" aria-label="내역 구분">
              {(
                [
                  ["all", "전체"],
                  ["use", "사용"],
                  ["charge", "충전"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => setFilter(id)}
                  className={`px-3.5 py-[7px] text-[13px] font-semibold ${
                    filter === id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="달"
              value={data.selectedMonth}
              onChange={(e) => changeMonth(e.target.value)}
              className="ui-select h-9 w-[150px]"
            >
              {data.monthOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card transition-opacity ${
              pending ? "opacity-60" : ""
            }`}
          >
            <div className="hidden grid-cols-[110px_70px_100px_100px_minmax(0,1fr)] gap-3.5 border-b border-slate-200 bg-slate-50 px-[18px] py-2.5 text-xs font-semibold text-slate-500 md:grid">
              <span>일시</span>
              <span>구분</span>
              <span>크레딧</span>
              <span>남은 크레딧</span>
              <span>내용</span>
            </div>
            {txns.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                이 달에는 내역이 없어요.
              </p>
            ) : (
              <ul>
                {txns.map((t) => {
                  const pill = KIND_PILL[t.kind];
                  const amount = `${t.delta > 0 ? "+" : "-"}${n(Math.abs(t.delta))}`;
                  const amountCls = t.delta > 0 ? "text-green-700" : "text-slate-900";
                  return (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 md:grid md:min-h-[54px] md:grid-cols-[110px_70px_100px_100px_minmax(0,1fr)] md:gap-3.5 md:px-[18px] md:py-2"
                    >
                      <span className="hidden text-[13px] tabular-nums text-slate-500 md:block">
                        {shortDateTime(t.createdAt)}
                      </span>
                      <span className="hidden md:block">
                        <Pill {...pill} />
                      </span>
                      <span className={`hidden text-[13px] font-bold tabular-nums md:block ${amountCls}`}>
                        {amount}
                      </span>
                      <span className="hidden text-[13px] tabular-nums text-slate-500 md:block">
                        {n(t.balanceAfter)}
                      </span>
                      <span className="min-w-0 md:truncate">
                        <span className="block truncate text-[13px] text-slate-900">{t.text}</span>
                        {t.material ? (
                          <span
                            className="mt-0.5 block truncate text-xs text-slate-500"
                            title={t.material}
                          >
                            자료: {t.material}
                          </span>
                        ) : null}
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 md:hidden">
                          <span className="tabular-nums">{shortDateTime(t.createdAt)}</span>
                          <Pill {...pill} />
                        </span>
                      </span>
                      <span className="shrink-0 text-right md:hidden">
                        <span className={`block text-[13px] font-bold tabular-nums ${amountCls}`}>
                          {amount}
                        </span>
                        <span className="block text-xs tabular-nums text-slate-400">
                          남은 {n(t.balanceAfter)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {tab === "receipts" && data.receipts ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
          <div className="hidden grid-cols-[140px_minmax(0,1fr)_110px_130px_90px_70px] gap-3.5 border-b border-slate-200 bg-slate-50 px-[18px] py-2.5 text-xs font-semibold text-slate-500 md:grid">
            <span>날짜</span>
            <span>상품</span>
            <span>결제 금액</span>
            <span>받은 크레딧</span>
            <span>상태</span>
            <span>영수증</span>
          </div>
          {data.receipts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">아직 충전한 적이 없어요.</p>
          ) : (
            <ul>
              {data.receipts.map((r) => {
                const st = RECEIPT_STATUS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-600" };
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-3 first:border-t-0 md:min-h-[54px] md:grid-cols-[140px_minmax(0,1fr)_110px_130px_90px_70px] md:gap-3.5 md:px-[18px] md:py-2"
                  >
                    <span className="order-2 text-xs text-slate-500 md:order-none md:text-[13px]">
                      {fullDate(r.at)}
                    </span>
                    <span className="order-1 truncate text-[13px] font-semibold text-slate-900 md:order-none">
                      {r.name}
                    </span>
                    <span className="order-3 text-[13px] tabular-nums text-slate-900 md:order-none">
                      {n(r.paymentAmount)}원
                    </span>
                    <span className="order-4 text-right text-[13px] tabular-nums text-slate-700 md:order-none md:text-left">
                      {n(r.totalCredit)}
                      {r.bonusCredit > 0 ? (
                        <span className="text-xs text-green-700"> (+{n(r.bonusCredit)})</span>
                      ) : null}
                    </span>
                    <span className="order-5 md:order-none">
                      <Pill {...st} />
                    </span>
                    <span className="order-6 text-right text-[13px] md:order-none md:text-left">
                      {r.receiptUrl ? (
                        <a
                          href={r.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          보기
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "prices" ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_72px] gap-3.5 border-b sm:grid-cols-[minmax(0,1fr)_120px_100px] border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500 sm:px-[18px]">
            <span>기능</span>
            <span>단위</span>
            <span className="text-right">크레딧</span>
          </div>
          {data.prices.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              가격 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          ) : (
            <ul>
              {data.prices.map((p) => (
                <li
                  key={p.key}
                  className="grid min-h-[48px] grid-cols-[minmax(0,1fr)_auto_72px] items-center sm:grid-cols-[minmax(0,1fr)_120px_100px] gap-3.5 border-t border-slate-100 px-4 first:border-t-0 sm:px-[18px]"
                >
                  <span className="truncate text-[13px] text-slate-900">{p.label}</span>
                  <span className="text-xs text-slate-500">{p.unit}</span>
                  <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
                    {n(p.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
