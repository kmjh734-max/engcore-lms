import { createAdminClient } from "@/lib/supabase/admin";
import {
  finalStoragePath,
  segmentStoragePath,
} from "@/lib/listening/storage-paths";

const BUCKET = "listening-audio";

/** 세트의 storage 음원 경로 — 행을 지우기 전에 모아 둔다(지우면 문항·조각 행도 사라진다) */
async function listListeningSetAssetPaths(setId: string): Promise<string[]> {
  const admin = createAdminClient();

  const { data: questions } = await admin
    .from("listening_questions")
    .select("id")
    .eq("set_id", setId);

  const questionIds = (questions ?? []).map((q) => q.id);
  const paths: string[] = [];

  for (const qid of questionIds) {
    paths.push(finalStoragePath(setId, qid));
  }

  if (questionIds.length > 0) {
    const { data: segments } = await admin
      .from("listening_question_segments")
      .select("id, question_id")
      .in("question_id", questionIds);

    for (const seg of segments ?? []) {
      paths.push(segmentStoragePath(setId, seg.question_id, seg.id));
    }
  }

  return paths;
}

/** 세트 삭제 전 storage 음원 파일 제거 */
export async function deleteListeningSetAssets(setId: string): Promise<void> {
  const admin = createAdminClient();
  const paths = await listListeningSetAssetPaths(setId);
  if (paths.length > 0) {
    await admin.storage.from(BUCKET).remove(paths);
  }
}

/** 행을 먼저 지우고 파일을 지운다 — 행 삭제가 실패하면 음원이 사라진 세트가 남던 순서를 바꿈 */
export async function deleteListeningSet(setId: string): Promise<void> {
  const admin = createAdminClient();
  const paths = await listListeningSetAssetPaths(setId);
  const { error } = await admin.from("listening_sets").delete().eq("id", setId);
  if (error) throw new Error(error.message);
  if (paths.length > 0) {
    await admin.storage.from(BUCKET).remove(paths);
  }
}
