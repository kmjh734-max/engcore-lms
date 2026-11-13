import { Suspense } from "react";
import { WorkbookWorkbench } from "@/components/lesson-materials/WorkbookWorkbench";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";

export const maxDuration = 300;

export default async function AdminWorkbookPage() {
  // 워크북 지문별을 켠 학원(정수학원)은 새 워크북도 지문별 배치로 시작한다(선생님 2026-11-13)
  const profile = await getCurrentProfile();
  const byPassage = await isAcademyFeatureOn(createAdminClient(), profile?.academy_id, "bundle_workbook_by_passage");
  return (
    <Suspense
      fallback={
        <div className="flex h-[80vh] items-center justify-center bg-slate-100">
          <p className="text-sm text-slate-600">워크북을 준비하고 있습니다…</p>
        </div>
      }
    >
      <WorkbookWorkbench role="admin" defaultByPassage={byPassage} />
    </Suspense>
  );
}
