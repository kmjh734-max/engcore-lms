import { createClient } from "@/lib/supabase/server";
import { resolveDocumentProjectIds } from "@/lib/lesson-materials/document-page";
import { LessonPackVocabExam } from "@/components/lesson-materials/LessonPackVocabExam";
import { lessonPackLegacyPick, lessonPackSavedExam } from "@/lib/lesson-materials/vocab-exam-saved";
import { loadBundleExtraProjects } from "@/lib/lesson-materials/load-material-payloads";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { numberByLinkedVocabSet } from "@/lib/lesson-materials/linked-vocab-numbers";
import Link from "next/link";

/** 수업용 자료 파일의 단어로 단어 시험지(자료함 「단어 시험지」 버튼) */
export default async function TeacherLessonPackVocabExamPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const params = await searchParams;
  const ids = await resolveDocumentProjectIds(params, "lesson_pack");

  if (ids.length === 0) {
    return (
      <div className="px-4 py-10">
        <p className="text-sm text-slate-600">선택된 자료가 없습니다.</p>
        <Link href="/teacher/lesson-materials" className="mt-3 inline-block text-sm text-violet-700">
          ← 자료함
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  // 단어 번호는 이어진 단어장 차례로(없으면 지문 차례 그대로)
  const projects = await numberByLinkedVocabSet(supabase, params.doc, await loadBundleExtraProjects(supabase, ids));
  const branding = await getAcademyBrandingForCurrentUser();
  const { data: doc } = await supabase
    .from("lesson_material_documents")
    .select("id, name, created_at, payload")
    .eq("id", params.doc?.trim() ?? "")
    .maybeSingle();

  return (
    <LessonPackVocabExam
      role="teacher"
      docName={(doc as { name?: string } | null)?.name || "수업용 자료"}
      docId={(doc as { id?: string } | null)?.id ?? null}
      savedExam={lessonPackSavedExam(doc)}
      legacyPick={lessonPackLegacyPick(doc)}
      projects={projects}
      logoSrc={branding.logoUrl}
      academyName={branding.name || ""}
    />
  );
}
