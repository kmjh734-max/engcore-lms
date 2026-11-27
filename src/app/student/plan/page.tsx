import Link from "next/link";
import { getKoreaYearMonth } from "@/lib/date/korea-today";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { HOMEWORK_CHECK_LABELS, listStudyPlans, loadStudyPlan, type HomeworkCheck } from "@/lib/study-plan";
import { weeksInMonth } from "@/lib/study-plan/weekday-dates";
import { isStudyPlanEnabled } from "@/lib/study-plan/access";

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

/** 선생님이 찍어 둔 숙제 확인 — 아직 안 찍은 회차는 아무것도 안 보인다 */
function CheckMark({ check }: { check: HomeworkCheck }) {
  if (!check) return null;
  const tone: Record<Exclude<HomeworkCheck, "">, string> = {
    none: "border-rose-200 bg-rose-50 text-rose-700",
    weak: "border-amber-200 bg-amber-50 text-amber-700",
    done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone[check]}`}>
      {HOMEWORK_CHECK_LABELS[check]}
    </span>
  );
}

/** 그 달이 걸치는 주 + 일정표에 실제로 적힌 주. 둘을 합쳐 빠짐없이 보여 준다. */
function weeksOf(year: number, month: number, rowWeeks: number[]): number[] {
  return [...new Set([...weeksInMonth(year, month), ...rowWeeks])].sort((a, b) => a - b);
}

/** 학생이 보는 내 학습일정표 */
export default async function StudentPlanPage({ searchParams }: PageProps) {
  const [profile, sp] = await Promise.all([getCurrentProfile(), searchParams]);
  if (!(await isStudyPlanEnabled(profile?.academy_id))) notFound();
  const admin = createAdminClient();
  // 서버는 UTC라 매달 1일 0~9시에 지난달이 보였다 — 한국 날짜로
  const now = getKoreaYearMonth();
  const year = Number(sp.year) || now.year;
  const month = Number(sp.month) || now.month;

  const [plan, months] = await Promise.all([
    loadStudyPlan(admin, profile!.id, year, month),
    listStudyPlans(admin, profile!.id),
  ]);

  return (
    <div>
      <PageHeader title="내 학습일정표" description="선생님이 적어 준 이번 달 계획이에요." />

      {months.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {months.map((m) => {
            const on = m.year === year && m.month === month;
            return (
              <Link
                key={`${m.year}-${m.month}`}
                href={`/student/plan?year=${m.year}&month=${m.month}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {m.year}.{m.month}
              </Link>
            );
          })}
        </div>
      ) : null}

      {!plan ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          {year}년 {month}월 일정표가 아직 없어요.
        </p>
      ) : (
        <div className="space-y-3">
          {/*
            9월처럼 5주에 걸치는 달이 있다. 고정값 [1,2,3,4]를 쓰다가 5주차 줄이 통째로
            안 보였다(선생님 지적 2026-09-28). 달력이 걸치는 주를 그대로 쓴다.
            일정표에 적힌 주차가 그보다 넘어가도 빠뜨리지 않게 합쳐 준다.
          */}
          {weeksOf(year, month, plan.rows.map((r) => r.week)).map((week) => {
            const rows = plan.rows.filter((r) => r.week === week);
            if (rows.length === 0) return null;
            return (
              <section key={week} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-bold text-slate-600">
                      <th className="w-16 px-3 py-2">{week}주</th>
                      <th className="w-24 px-2 py-2">영역</th>
                      <th className="w-36 px-2 py-2">교재</th>
                      {Array.from({ length: plan.sessionsPerWeek }, (_, i) => {
                        const d = plan.sessionDates?.[String(week)]?.[i] ?? "";
                        return (
                          <th key={i} className="px-2 py-2">
                            {i + 1}회차
                            {d ? <span className="ml-1 font-normal text-slate-400">{d.slice(5).replace("-", "/")}</span> : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.week}-${r.area}`} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2" />
                        <td className="px-2 py-2 font-semibold text-slate-800">{r.area}</td>
                        <td className="px-2 py-2 text-slate-600">{r.textbook}</td>
                        {r.entries.map((e, i) => (
                          <td key={i} className="px-2 py-2">
                            {e.progress ? <p className="text-slate-800">{e.progress}</p> : null}
                            {e.homework ? <p className="text-brand-700">숙제: {e.homework}</p> : null}
                            {e.note ? <p className="text-xs text-slate-500">{e.note}</p> : null}
                            <CheckMark check={e.check} />
                            {!e.progress && !e.homework && !e.note && !e.check ? (
                              <span className="text-slate-300">–</span>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
