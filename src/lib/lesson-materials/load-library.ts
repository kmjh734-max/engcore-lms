import type { SupabaseClient } from "@supabase/supabase-js";
import type { LessonMaterialDocumentRow } from "@/lib/lesson-materials/documents";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";

/** 자료함에서 지문을 골라 만든 AI 변형문제 작업(자료함 변형문제 탭). */
export interface LessonQuestionJobRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  total_requested: number | null;
  total_completed: number | null;
  project_ids: string[];
}

export interface LessonMaterialFolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface LessonMaterialProjectRow {
  id: string;
  title: string;
  title_en: string | null;
  source: string | null;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  order_index: number;
  analysis_json?: unknown;
  /** True when logical-flow analysis exists */
  has_analysis: boolean;
  /** True when 수업용 자료(lesson pack) was saved */
  has_lesson_pack: boolean;
  /** True when 분석서 was saved */
  has_analysis_report: boolean;
}

export interface LessonMaterialLibraryData {
  folders: LessonMaterialFolderRow[];
  /** Active (not trashed) projects with a folder */
  projects: LessonMaterialProjectRow[];
  /** Active projects with no folder */
  unfiledProjects: LessonMaterialProjectRow[];
  /** Soft-deleted projects */
  trashedProjects: LessonMaterialProjectRow[];
  /** 만든 파일(수업용 자료 · 분석서 · 워크북), 최신순 */
  documents: LessonMaterialDocumentRow[];
  /** 자료함 지문으로 만든 변형문제, 최신순 */
  questionJobs: LessonQuestionJobRow[];
  /** 테스트 교재(수업자료 NEW)를 켠 학원인지 — 정수학원 */
  testBookOpen?: boolean;
  /** 자료함 「단어」 탭을 켠 학원인지 — 윌링어학원(2026-10-27) */
  vocabTabOpen?: boolean;
  /** 「단어」 탭에서 만든 단어장(수업자료 단어장 폴더), 최신순 */
  lessonVocabSets?: LessonVocabSetRow[];
}

export type LessonVocabSetRow = { id: string; title: string; created_at: string; word_count: number };

/** 자료함 「단어」 탭에서 만든 단어장이 들어가는 단어학습 폴더 이름 */
export const LESSON_VOCAB_FOLDER = "수업자료 단어장";

function analysisSnippet(analysis_json: unknown): string {
  if (!Array.isArray(analysis_json) || analysis_json.length === 0) return "";
  const first = analysis_json[0] as { desc?: string; title?: string };
  return String(first?.desc ?? first?.title ?? "").trim();
}

export async function loadLessonMaterialsLibraryData(
  supabase: SupabaseClient
): Promise<LessonMaterialLibraryData> {
  /**
   * 뱃지(분석·수업자료·분석서 있음)에 필요한 조각만 JSON 경로로 가져온다.
   *
   * 예전에는 지문마다 lesson_pack_json(어법 선택 캐시까지 통째로)과 analysis_report_json
   * 전체를 내려받아 있음/없음만 계산했다. 지문이 늘수록 자료함 첫 화면과, 순서를 바꾼 뒤
   * 새로 고침이 그만큼 느려졌다.
   */
  const profile = await getCurrentProfile();
  // 변형문제 작업은 목록 API와 같게 학원으로 거르고, 선생님은 자기 작업만 본다.
  let questionJobsQuery = supabase
    .from("question_generation_jobs")
    .select(
      "id,status,created_at,library_order,total_requested,total_completed,title:request_config->>title,project_ids:request_config->lessonProjectIds"
    )
    .not("request_config->lessonProjectIds", "is", null)
    // 새로 만든 작업(순서 없음)이 맨 위, 그다음 선생님이 정한 순서.
    .order("library_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(100);
  if (profile?.academy_id) questionJobsQuery = questionJobsQuery.eq("academy_id", profile.academy_id);
  if (profile?.role === "teacher") questionJobsQuery = questionJobsQuery.eq("created_by", profile.id);

  /**
   * 자료함 표는 모두 학원 행만 보인다(RLS). 학원을 직접 걸어 두면 DB가 학원 색인으로 그 행만 훑고,
   * 행마다 도는 권한 검사도 다른 학원 행에는 하지 않는다. (보이는 행은 같다)
   */
  const academyId = profile?.academy_id ?? null;
  let foldersQuery = supabase
    .from("lesson_material_folders")
    .select("id,name,parent_id,created_at")
    .order("created_at", { ascending: false });
  let projectsQuery = supabase
    .from("lesson_material_projects")
    .select(
      "id,title,title_en,source,folder_id,created_at,updated_at,deleted_at,order_index,analysis_first:analysis_json->0->>title,pack_vocab_first:lesson_pack_json->vocab->0,pack_header:lesson_pack_json->>headerLabel,report_first:analysis_report_json->sentences->0->>itemId"
    )
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  /*
   * 2026-10-29 속도: 있음/없음 판정은 작은 값 하나로(분석 첫 항목 title·분석서 첫 문장 itemId·단어 첫 칸) —
   * 예전엔 단어 목록 전체와 첫 항목 통째를 읽어 456지문에 820KB·0.7~1.4초였다(전 학원 820지문 판정 같음 확인).
   * 지문마다 문장 수를 세던 조회(문장 행 전부)는 화면이 쓰지 않아 뺐다.
   */
  let documentsQuery = supabase
    .from("lesson_material_documents")
    .select("id,kind,name,project_ids,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (academyId) {
    foldersQuery = foldersQuery.eq("academy_id", academyId);
    projectsQuery = projectsQuery.eq("academy_id", academyId);
    documentsQuery = documentsQuery.eq("academy_id", academyId);
  }

  const [foldersRes, projectsRes, documentsRes, questionJobsRes] = await Promise.all([
    foldersQuery,
    projectsQuery,
    documentsQuery,
    questionJobsQuery,
  ]);

  const folders = (foldersRes.data ?? []) as LessonMaterialFolderRow[];
  const rawProjects = (projectsRes.data ?? []) as unknown as Array<
    Omit<
      LessonMaterialProjectRow,
      "has_analysis" | "has_lesson_pack" | "has_analysis_report" | "analysis_json"
    > & {
      analysis_first?: unknown;
      pack_vocab_first?: unknown;
      pack_header?: string | null;
      report_first?: unknown;
      order_index?: number | null;
    }
  >;

  const projects: LessonMaterialProjectRow[] = rawProjects.map((p) => {
    const { analysis_first, pack_vocab_first, pack_header, report_first, ...rest } = p;
    return {
      ...rest,
      order_index: typeof p.order_index === "number" ? p.order_index : 0,
      has_analysis: analysis_first != null,
      has_lesson_pack: pack_vocab_first != null || (typeof pack_header === "string" && pack_header.trim().length > 0),
      has_analysis_report: report_first != null,
    };
  });
  // 파일 테이블이 없는 환경(마이그레이션 128 전)에서도 자료함은 열린다.
  const documents = (documentsRes.error ? [] : documentsRes.data ?? []) as LessonMaterialDocumentRow[];

  const active = projects.filter((p) => !p.deleted_at);
  const trashed = projects.filter((p) => !!p.deleted_at);

  /*
   * 지문이 모두 휴지통에 간(또는 사라진) 파일은 목록에서 감춘다(선생님 말씀 2026-10-05).
   * 지문을 휴지통에 보낸 뒤에도 1장 테스트 파일이 남아 있었고, 열면 「선택된 자료가 없습니다」만 떴다.
   * 파일을 지우지 않고 감추기만 하므로 지문을 복원하면 파일도 다시 보인다. 지문이 없는 파일은 그대로 둔다.
   */
  const activeIds = new Set(active.map((p) => p.id));
  const visibleDocuments = documents.filter((d) => {
    const ids = Array.isArray(d.project_ids) ? d.project_ids : [];
    return ids.length === 0 || ids.some((id) => activeIds.has(id));
  });

  const testBookOpen = await isAcademyFeatureOn(createAdminClient(), academyId, "test_book");
  const vocabTabOpen = await isAcademyFeatureOn(createAdminClient(), academyId, "lesson_vocab_tab");
  let lessonVocabSets: LessonVocabSetRow[] = [];
  if (vocabTabOpen && academyId) {
    // 단어 탭 단어장 + 테스트 교재·최종통합자료에서 등록한 「· 전체 단어」 단어장도 함께(선생님 2026-11-11 「단어 탭에 단어장이 다 사라졌다」)
    const { data: folders } = await supabase
      .from("vocab_folders")
      .select("id, name")
      .eq("academy_id", academyId)
      .in("name", [LESSON_VOCAB_FOLDER, "테스트 교재"]);
    const folderIds = (folders ?? []).map((f) => f.id as string);
    const tbFolder = new Set((folders ?? []).filter((f) => f.name !== LESSON_VOCAB_FOLDER).map((f) => f.id as string));
    // 테스트 교재·통합자료 폴더 단어장은 수업용 자료와 이름이 같은 것만(선생님 2026-11-11 「수업용 자료랑 단어장 제목이 안 맞다」)
    const lessonNames = new Set(visibleDocuments.filter((d) => d.kind === "lesson_pack").map((d) => String(d.name).trim()));
    if (folderIds.length) {
      const { data: sets } = await supabase
        .from("vocab_sets")
        .select("id, title, folder_id, created_at, vocab_items(count)")
        .in("folder_id", folderIds)
        .order("created_at", { ascending: false })
        .limit(200);
      lessonVocabSets = (sets ?? [])
        .filter((s) => !tbFolder.has(s.folder_id as string) || lessonNames.has(String(s.title).trim()))
        .map((s) => ({
        id: s.id as string,
        title: s.title as string,
        created_at: s.created_at as string,
        word_count: ((s as { vocab_items?: Array<{ count: number }> }).vocab_items?.[0]?.count as number | undefined) ?? 0,
      }));
    }
  }

  return {
    testBookOpen,
    vocabTabOpen,
    lessonVocabSets,
    folders,
    projects: active.filter((p) => p.folder_id !== null),
    unfiledProjects: active.filter((p) => p.folder_id === null),
    trashedProjects: trashed,
    documents: visibleDocuments,
    questionJobs: (questionJobsRes.error ? [] : (questionJobsRes.data ?? [])).map((j) => {
      const row = j as Record<string, unknown>;
      return {
        id: String(row.id),
        title: String(row.title ?? "").trim() || "변형문제",
        status: String(row.status ?? ""),
        created_at: String(row.created_at ?? ""),
        total_requested: (row.total_requested as number | null) ?? null,
        total_completed: (row.total_completed as number | null) ?? null,
        project_ids: Array.isArray(row.project_ids) ? (row.project_ids as string[]) : [],
      };
    }),
  };
}

export { analysisSnippet };
