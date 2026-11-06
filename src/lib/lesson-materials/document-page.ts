import { createClient } from "@/lib/supabase/server";
import type { LessonMaterialDocumentKind } from "@/lib/lesson-materials/documents";
import { sortProjectIdsByPassageOrder } from "@/lib/lesson-materials/passage-order";

function parseIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 수업용 자료·분석서 페이지가 보여 줄 지문 목록.
 * ?doc=가 있으면 그 파일에 저장된 지문(만들 때 고른 순서)을, 없으면 ?ids=를 쓴다.
 * 파일 조회는 사용자 세션으로 하므로 남의 파일은 RLS가 막는다.
 */
export async function resolveDocumentProjectIds(
  params: { ids?: string; doc?: string },
  kind: LessonMaterialDocumentKind
): Promise<string[]> {
  const docId = params.doc?.trim();
  if (docId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("lesson_material_documents")
      .select("project_ids,kind")
      .eq("id", docId)
      .is("deleted_at", null)
      .maybeSingle();
    const ids = (data?.kind === kind ? (data.project_ids as string[] | null) : null) ?? [];
    if (ids.length > 0) return ids;
  }
  // 새로 고른 지문(?ids=)은 폴더 차례로(선생님 2026-11-06: 교재·테스트지에서 지문 순서가 섞인다)
  const ids = parseIds(params.ids);
  if (ids.length < 2) return ids;
  return sortProjectIdsByPassageOrder(await createClient(), ids);
}
