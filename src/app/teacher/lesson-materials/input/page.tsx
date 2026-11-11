import { LessonMaterialsInputWizard } from "@/components/lesson-materials/LessonMaterialsInputWizard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isTextbookPassageOpen } from "@/lib/textbooks/shared-passages";
import { isOutsidePassageOpen } from "@/lib/outside-passages/access";

export const maxDuration = 120;

export default async function TeacherLessonMaterialsInputPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  // 자료함에서 폴더를 고른 채 "새 자료 추가"를 누르면 그 폴더에 넣는다("unfiled"는 미분류).
  const { folder } = await searchParams;
  const folderId = folder?.trim() || null;
  let folderLabel: string | null = null;
  if (folderId === "unfiled") {
    folderLabel = "미분류";
  } else if (folderId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("lesson_material_folders")
      .select("name")
      .eq("id", folderId)
      .maybeSingle();
    folderLabel = (data?.name as string | undefined) ?? null;
  }
  // 교과서 본문은 열어 준 학원에서만 불러올 수 있다.
  const profile = await getCurrentProfile();
  const admin = createAdminClient();
  const [textbookOpen, outsideOpen, vocabAuto] = await Promise.all([
    isTextbookPassageOpen(admin, profile?.academy_id),
    isOutsidePassageOpen(admin, profile?.academy_id),
    // 단어 탭을 켠 학원만 지문 저장 때 단어장을 자동으로 만든다(단어 정리 값이 없는 학원) — 선생님 2026-11-11
    isAcademyFeatureOn(admin, profile?.academy_id, "lesson_vocab_tab"),
  ]);
  return (
    <LessonMaterialsInputWizard
      role="teacher"
      folderId={folderId}
      folderLabel={folderLabel}
      textbookOpen={textbookOpen}
      outsideOpen={outsideOpen}
      vocabAuto={vocabAuto}
    />
  );
}
