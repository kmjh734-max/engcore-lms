import { createAdminClient } from "@/lib/supabase/admin";
import { loadAcademyMaterialPassages } from "@/lib/exam-analysis/material-passages";
import type { ExamAnalysisRow, ExamItemRow } from "@/lib/exam-analysis/types";
import { measureVocabLevel } from "@/lib/vocab/engcore-level";

const ANALYSIS_COLUMNS =
  "id, academy_id, school_name, grade, subject, exam_label, status, page_count, missing, note, total_points, features, strategy, decisive_item_ids, error, match_materials, created_at, sentence_words, choice_words, lexile, vocab_level, level_summary, hit_report, hit_report_at";

/** 학원의 시험지 분석 목록 (최근 것부터) + 문항 수 */
export async function loadExamAnalyses(academyId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("school_exam_analyses")
    .select(ANALYSIS_COLUMNS)
    .eq("academy_id", academyId)
    .order("created_at", { ascending: false })
    .limit(200);
  const list = (data ?? []) as ExamAnalysisRow[];
  const ids = list.map((a) => a.id);
  const counts = new Map<string, { n: number; hard: number; subj: number; matched: number }>();
  if (ids.length) {
    const { data: items } = await admin
      .from("school_exam_items")
      .select("analysis_id, level, is_subjective, matched_item_id")
      .in("analysis_id", ids);
    for (const it of items ?? []) {
      const c = counts.get(it.analysis_id as string) ?? { n: 0, hard: 0, subj: 0, matched: 0 };
      c.n++;
      if (it.level === "상") c.hard++;
      if (it.is_subjective) c.subj++;
      if (it.matched_item_id) c.matched++;
      counts.set(it.analysis_id as string, c);
    }
  }
  return list.map((a) => ({ ...a, counts: counts.get(a.id) ?? { n: 0, hard: 0, subj: 0, matched: 0 } }));
}

export async function loadExamAnalysis(id: string, academyId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("school_exam_analyses").select(ANALYSIS_COLUMNS).eq("id", id).maybeSingle();
  if (!data || data.academy_id !== academyId) return null;
  const { data: items } = await admin
    .from("school_exam_items")
    .select("*")
    .eq("analysis_id", id)
    .order("order_index");
  return { analysis: data as ExamAnalysisRow, items: (items ?? []) as ExamItemRow[] };
}

export type MaterialPassage = {
  id: string;
  project: string;
  title: string;
  /** 자료에 적어 둔 출처 (예: 공통영어2 YBM(박준언) 1과 본문1). 없으면 빈 글 */
  source: string;
  words: number;
  preview: string;
  /** 우리 단어장으로 잰 어휘 수준(예: 중학필수). 못 재면 null */
  level: string | null;
};

/** 동형모의고사 지문 고르기용: 학원 수업자료(자료 하나 = 지문 하나) 목록. 글은 보내지 않고 앞부분만 */
export async function loadMaterialPassages(academyId: string): Promise<MaterialPassage[]> {
  const list = await loadAcademyMaterialPassages(createAdminClient(), academyId);
  return list
    .map((p) => {
      const words = p.text.split(/\s+/).filter(Boolean);
      return { id: p.projectId, project: p.folder, title: p.title, source: p.source, words: words.length, preview: words.slice(0, 14).join(" "), level: measureVocabLevel(p.text).label, updated: p.updatedAt };
    })
    .filter((m) => m.words >= 40)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map(({ id, project, title, source, words, preview, level }) => ({ id, project, title, source, words, preview, level }));
}

/** 이 시험 분석으로 만든 동형모의고사(변형문제 작업) — 최근 것부터 */
/** 이 시험으로 만든 동형모의고사 수 — 다음 회차 번호(「N차」)를 정할 때 쓴다. 목록은 20개까지만 읽어서 따로 센다 */
export async function countExamMocks(analysisId: string, academyId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("question_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("academy_id", academyId)
    .eq("request_config->>examAnalysisId", analysisId);
  return count ?? 0;
}

export async function loadExamMocks(analysisId: string, academyId: string) {
  const { data } = await createAdminClient()
    .from("question_generation_jobs")
    .select("id, status, created_at, rc_title:request_config->>title")
    .eq("academy_id", academyId)
    .eq("request_config->>examAnalysisId", analysisId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((j) => ({
    id: j.id as string,
    status: j.status as string,
    created_at: j.created_at as string,
    title: String((j.rc_title as string | null) ?? "동형모의고사"),
  }));
}
