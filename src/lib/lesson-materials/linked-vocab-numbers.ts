import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import type { TestBookProjectInput } from "@/lib/lesson-materials/test-book";
import { numberProjectsByVocabSet } from "@/lib/lesson-materials/vocab-set-exam";

/**
 * 수업용 자료 파일에 이어진 단어장이 있으면 전체 단어장·단어 시험지 번호를 그 단어장 차례로 맞춘다
 * (선생님 2026-11-13). 파일은 보는 사람 권한으로 읽고(못 읽으면 그대로), 단어 차례는 강사마다 달라지지 않게
 * 관리 권한으로 읽는다 — 다른 강사가 만든 단어장이어도 같은 번호가 나와야 한다.
 */
export async function numberByLinkedVocabSet(
  supabase: SupabaseClient,
  docId: string | null | undefined,
  projects: TestBookProjectInput[]
): Promise<TestBookProjectInput[]> {
  const id = docId?.trim();
  if (!id) return projects;
  try {
    const { data: doc } = await supabase
      .from("lesson_material_documents")
      .select("setId:payload->>vocabSetId")
      .eq("id", id)
      .maybeSingle();
    const setId = (doc as { setId?: string | null } | null)?.setId;
    if (!setId) return projects;
    const admin = createAdminClient();
    const items = await fetchAllRows<{ word: string | null }>((from, to) =>
      admin.from("vocab_items").select("word").eq("set_id", setId).order("order_index").order("created_at").range(from, to)
    );
    return numberProjectsByVocabSet(projects, items.map((i) => i.word ?? ""));
  } catch {
    return projects;
  }
}
