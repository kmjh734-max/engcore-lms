import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isEogudokOpen } from "@/lib/eogudok/data";
import { MAIN_BOOKS } from "@/lib/main-books/registry";

/** 관리자·강사 공통 — 본교재 수업자료(교재 카드 목록). 정수학원만. */
export async function MainBooksHomePage({ base }: { base: string }) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isEogudokOpen(profile.academy_id))) notFound();
  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">본교재 수업자료</h1>
        <p className="mt-1 text-sm text-slate-500">학원 본교재를 골라 주차·단원별로 학생용·교사용·정답과 테스트지를 뽑습니다.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {MAIN_BOOKS.map((b) => (
          <Link
            key={b.slug}
            href={`${base}/${b.slug}`}
            className="group rounded-xl bg-white p-5 ring-1 ring-slate-200 transition hover:ring-2"
            style={{ ["--tw-ring-color" as string]: b.color }}
          >
            <div className="text-xs font-semibold tracking-wider" style={{ color: b.color }}>{b.span}</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{b.title}</div>
            <div className="mt-1 text-sm text-slate-600">{b.subtitle}</div>
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{b.grades}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
