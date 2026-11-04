"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MsUnitSummary } from "@/lib/middle-school/queries";

/** 학년 · 교과서를 고르고 과 카드를 누른다 */
export function MiddleSchoolHome({ units, base }: { units: MsUnitSummary[]; base: string }) {
  const books = useMemo(() => {
    const keys: string[] = [];
    for (const u of units) {
      const k = `${u.grade} ${u.publisher}`;
      if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [units]);
  const [book, setBook] = useState(books[0] ?? "");
  const shown = units.filter((u) => `${u.grade} ${u.publisher}` === book);

  if (!units.length) {
    return <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">아직 넣어 둔 교과서가 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {books.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBook(b)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
              b === book ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-violet-400"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((u) => (
          <div key={u.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-400 hover:shadow">
            <Link href={`${base}/${u.id}`} className="group flex-1">
              <div className="text-xs font-bold tracking-wide text-violet-600">LESSON {u.lessonNo}</div>
              <div className="mt-1 text-base font-bold text-slate-900 group-hover:text-violet-700">{u.title}</div>
              <div className="mt-2 text-xs text-slate-500">문법 · {u.grammarTitles.join(" / ") || "—"}</div>
              <div className="mt-0.5 text-xs text-slate-400">단어 {u.wordCount}개</div>
            </Link>
            <div className="mt-3 flex gap-1.5">
              <Link href={`${base}/${u.id}/vocab-exam`} className="flex-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-center text-xs font-semibold text-violet-700 hover:bg-violet-100">
                단어 시험지 출력
              </Link>
              <Link href={`${base}/${u.id}?test=1`} className="flex-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-center text-xs font-semibold text-violet-700 hover:bg-violet-100">
                테스트지 출력
              </Link>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Link href={`${base}/${u.id}?book=1`} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100">
                본교재 출력
              </Link>
              <Link href={`${base}/${u.id}?book=answers`} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100">
                정답지 출력
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
