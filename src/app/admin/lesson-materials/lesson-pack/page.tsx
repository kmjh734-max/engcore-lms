import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import { createClient } from "@/lib/supabase/server";
import { resolveDocumentProjectIds } from "@/lib/lesson-materials/document-page";
import { LessonBookWorkbench } from "@/components/lesson-materials/LessonBookWorkbench";
import { loadBundleExtraProjects } from "@/lib/lesson-materials/load-material-payloads";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { normalizeLessonBookOptions } from "@/lib/lesson-materials/lesson-book-options";
import Link from "next/link";

export default async function AdminLessonPackPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; doc?: string; newDoc?: string }>;
}) {
  // ?doc=면 저장된 파일의 지문을, 아니면 ?ids=를 쓴다.
  const params = await searchParams;
  const ids = await resolveDocumentProjectIds(params, "lesson_pack");

  if (ids.length === 0) {
    return (
      <div className="px-4 py-10">
        <p className="text-sm text-slate-600">선택된 자료가 없습니다.</p>
        <Link
          href="/admin/lesson-materials"
          className="mt-3 inline-block text-sm text-violet-700"
        >
          ← 자료함
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  // 수업용 자료는 테스트 교재의 수업용 자료 모양으로 만든다(선생님 2026-10-21) — 단어 정리·해석 재료를 읽는다
  const projects = await loadBundleExtraProjects(supabase, ids);
  const branding = await getAcademyBrandingForCurrentUser();
  // 파일에 저장된 설정(해석 등)
  const docId = params.doc?.trim();
  const { data: doc } = docId
    ? await supabase.from("lesson_material_documents").select("opts:payload->options").eq("id", docId).eq("kind", "lesson_pack").maybeSingle()
    : { data: null };
  const savedOptions = normalizeLessonBookOptions((doc as { opts?: unknown } | null)?.opts);

  // 교사용·학생용 수업 화면(정수학원 먼저, 2026-11-10)
  const profile = await getCurrentProfile();
  const classView = await isAcademyFeatureOn(createAdminClient(), profile?.academy_id, "lesson_class_view");
  return (
    <LessonBookWorkbench
      role="admin"
      projects={projects}
      savedOptions={savedOptions}
      logoSrc={branding.logoUrl}
      academyName={branding.name || ""}
      classView={classView}
    />
  );
}
