import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

/**
 * 슈퍼관리자 홈 맨 위 "운영 현황" — 가입·매출·크레딧 사용을 이번 달 기준으로 한눈에.
 */
function kstMonthStart(): string {
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
  return new Date(`${ym}-01T00:00:00+09:00`).toISOString();
}

export async function SuperAdminStats() {
  const admin = createAdminClient();
  const since = kstMonthStart();

  const [{ data: academies }, { data: orders }, { data: debits }, { data: pricing }, { count: studentCount }] =
    await Promise.all([
      admin.from("academies").select("id, created_at, settings"),
      admin.from("credit_payment_orders").select("payment_amount, status, approved_at").eq("status", "approved").gte("approved_at", since),
      // 한 번에 1,000행까지만 와서 합계가 모자랐다 — 끝까지 넘겨 받는다
      fetchAllRows<{ amount: number | null; feature_key: string | null }>((from, to) =>
        admin.from("credit_transactions").select("amount, feature_key").eq("type", "debit").gte("created_at", since).order("id").range(from, to)
      ).then((data) => ({ data }), () => ({ data: null })),
      admin.from("feature_pricing").select("feature_key, label"),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("is_active", true),
    ]);

  const isPersonal = (a: { settings: unknown }) =>
    (a.settings as { signup?: { member_type?: string } } | null)?.signup?.member_type === "personal";
  const list = academies ?? [];
  const personal = list.filter(isPersonal).length;
  const newThisMonth = list.filter((a) => (a.created_at as string) >= since).length;
  const revenue = (orders ?? []).reduce((s, o) => s + Number(o.payment_amount ?? 0), 0);
  const used = (debits ?? []).reduce((s, d) => s + Number(d.amount ?? 0), 0);

  const label = new Map((pricing ?? []).map((p) => [p.feature_key as string, p.label as string]));
  const byFeature = new Map<string, number>();
  for (const d of debits ?? []) {
    const k = (d.feature_key as string | null) ?? "기타";
    byFeature.set(k, (byFeature.get(k) ?? 0) + Number(d.amount ?? 0));
  }
  const top = [...byFeature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = top[0]?.[1] ?? 1;

  const cards: Array<[string, string, string]> = [
    ["회원", `${list.length}곳`, `학원 ${list.length - personal} · 개인 ${personal}`],
    ["이번 달 신규 가입", `${newThisMonth}곳`, ""],
    ["이번 달 결제", `${revenue.toLocaleString("ko-KR")}원`, `${(orders ?? []).length}건`],
    ["이번 달 크레딧 사용", `${used.toLocaleString("ko-KR")}`, "크레딧(= 원)"],
    ["활성 학생", `${(studentCount ?? 0).toLocaleString("ko-KR")}명`, "전체 학원"],
  ];

  return (
    <section className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(([t, v, sub]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{t}</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{v}</p>
            {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
          </div>
        ))}
      </div>
      {top.length ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">이번 달 많이 쓴 기능</p>
          <ul className="mt-2 space-y-1.5">
            {top.map(([k, v]) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="w-56 shrink-0 truncate text-slate-700">{label.get(k) ?? k}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(3, Math.round((v / topMax) * 100))}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">
                  {v.toLocaleString("ko-KR")}크레딧
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
