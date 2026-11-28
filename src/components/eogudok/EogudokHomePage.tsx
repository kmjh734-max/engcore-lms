import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isEogudokOpen, loadEgMeta } from "@/lib/eogudok/data";
import { EogudokHome } from "./EogudokHome";

/** 관리자·강사 공통 — 어구독 (겨울주간지). 정수학원만. */
export async function EogudokHomePage({ back }: { back: string }) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isEogudokOpen(profile.academy_id))) notFound();
  const metas = await Promise.all(([1, 2, 3] as const).map((g) => loadEgMeta(g)));
  return (
    <div className="space-y-4 p-6">
      <header>
        <Link href={back} className="text-sm text-violet-700">← 본교재 수업자료</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">어구독 (겨울주간지)</h1>
        <p className="mt-1 text-sm text-slate-500">
          예비고1·2·3 겨울방학 12주 교재입니다. 주차를 골라 학생용·교사용·정답을 뽑고, 조교 1:1 주간 테스트를 만듭니다.
        </p>
      </header>
      <EogudokHome metas={metas} />
    </div>
  );
}
