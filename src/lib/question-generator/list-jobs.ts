import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds } from "@/lib/supabase/fetch-all-rows";

/** 변형문제 목록 한 줄 — 목록 화면이 쓰는 칸만 */
export interface GenerationJobListRow {
  id: string;
  status: string;
  progress_message: string | null;
  total_requested: number;
  total_completed: number;
  total_failed: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  passage_id: string | null;
  english_source_passages: { title?: string } | null;
  /** request_config 에서 목록에 필요한 것만 (지문 본문은 싣지 않는다) */
  request_config: {
    title?: string;
    grade?: string;
    passageIds?: string[];
  };
  /** 지문 수 (request_config 의 passageIds → passages → passage 순으로 센 값) */
  passage_count: number;
}

type RawRow = {
  id: string;
  status: string;
  progress_message: string | null;
  total_requested: number;
  total_completed: number;
  total_failed: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  passage_id: string | null;
  english_source_passages: { title?: string } | { title?: string }[] | null;
  rc_title: string | null;
  rc_grade: string | null;
  rc_passage_ids: unknown;
};

function countPassages(
  passageIds: unknown,
  passages: unknown,
  passage: string | null | undefined
): number {
  if (Array.isArray(passageIds) && passageIds.length > 0) return passageIds.length;
  if (Array.isArray(passages)) {
    const n = passages.filter((p) =>
      String((p as { text?: unknown } | null)?.text ?? "").trim()
    ).length;
    if (n > 0) return n;
  }
  if ((passage ?? "").trim()) return 1;
  return 1;
}

/**
 * 학원(선생님은 자기 것)의 변형문제 — 최근 1,000개(예전엔 50개라 정수학원 이전 자료가 목록에서 사라졌다, 선생님 2026-11-26).
 * 예전에는 request_config 를 통째로(지문 본문 두 벌 포함) 내려받아 1초마다 다시 읽었다.
 * 제목·학년·지문 id 만 JSON 경로로 읽고, 지문 id 가 없는 옛 작업만 지문 수를 따로 센다.
 */
export async function listGenerationJobs(
  supabase: SupabaseClient,
  opts: { academyId: string; role: string; viewerId: string }
): Promise<{ jobs: GenerationJobListRow[]; error: string | null }> {
  let query = supabase
    .from("question_generation_jobs")
    .select(
      "id, status, progress_message, total_requested, total_completed, total_failed, error_message, created_at, completed_at, passage_id, english_source_passages(title), rc_title:request_config->>title, rc_grade:request_config->>grade, rc_passage_ids:request_config->passageIds"
    )
    .eq("academy_id", opts.academyId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (opts.role === "teacher") {
    query = query.eq("created_by", opts.viewerId);
  }

  const { data, error } = await query;
  if (error) return { jobs: [], error: error.message };
  const rows = (data ?? []) as unknown as RawRow[];

  // 지문 id 목록이 없는 옛 작업만 지문 본문으로 센다
  const legacyIds = rows
    .filter((r) => !(Array.isArray(r.rc_passage_ids) && r.rc_passage_ids.length > 0))
    .map((r) => r.id);
  const legacyCounts = new Map<string, number>();
  // 옛 작업은 지문 본문을 담고 있어 무겁다 — 조금씩 나눠 읽고, 실패하면 그 묶음은 1지문으로 둔다
  for (const part of chunkIds(legacyIds, 50)) {
    const { data: legacy, error: legacyErr } = await supabase
      .from("question_generation_jobs")
      .select("id, rc_passages:request_config->passages, rc_passage:request_config->>passage")
      .in("id", part);
    if (legacyErr) {
      console.error("[listGenerationJobs] legacy passage count", legacyErr.message);
      continue;
    }
    for (const row of (legacy ?? []) as unknown as Array<{
      id: string;
      rc_passages: unknown;
      rc_passage: string | null;
    }>) {
      legacyCounts.set(row.id, countPassages(null, row.rc_passages, row.rc_passage));
    }
  }

  const jobs = rows.map((r): GenerationJobListRow => {
    const passage = Array.isArray(r.english_source_passages)
      ? (r.english_source_passages[0] ?? null)
      : r.english_source_passages;
    const passageIds = Array.isArray(r.rc_passage_ids)
      ? (r.rc_passage_ids as string[])
      : undefined;
    return {
      id: r.id,
      status: r.status,
      progress_message: r.progress_message,
      total_requested: r.total_requested,
      total_completed: r.total_completed,
      total_failed: r.total_failed,
      error_message: r.error_message,
      created_at: r.created_at,
      completed_at: r.completed_at,
      passage_id: r.passage_id,
      english_source_passages: passage,
      request_config: {
        ...(r.rc_title != null ? { title: r.rc_title } : {}),
        ...(r.rc_grade != null ? { grade: r.rc_grade } : {}),
        ...(passageIds ? { passageIds } : {}),
      },
      passage_count:
        passageIds && passageIds.length > 0
          ? passageIds.length
          : (legacyCounts.get(r.id) ?? 1),
    };
  });

  return { jobs, error: null };
}
