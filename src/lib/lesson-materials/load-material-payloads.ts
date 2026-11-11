import type { SupabaseClient } from "@supabase/supabase-js";
import type { LessonMaterialAnalysisCard } from "@/lib/lesson-materials/generate-organization";
import type { LessonPackData, LessonPackVocabItem } from "@/lib/lesson-materials/generate-lesson-pack";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import { syncReportSpotsWithTeacherNotes } from "@/lib/lesson-materials/analysis-spot-sync";
import type { LessonPackProjectInput } from "@/components/lesson-materials/LessonPackWorkbench";
import type { AnalysisReportProjectInput } from "@/components/lesson-materials/AnalysisReportWorkbench";
import {
  isOnePageContentFresh,
  onePageSentences,
  onePageSourceHash,
  type OnePageProjectInput,
} from "@/lib/lesson-materials/one-page";
import { readCachedGrammarChoiceV2 } from "@/lib/lesson-materials/grammar-choice-v2/read-cached";
import type { StoredGrammarChoiceV2Cache } from "@/lib/lesson-materials/grammar-choice-v2/cache";
import {
  generateVocabChoiceForPassage,
  type StoredVocabChoiceCache,
} from "@/lib/lesson-materials/vocab-choice";
import { isTestBookMaterialFresh, mergeTestBookVocabHints, type TestBookProjectInput } from "@/lib/lesson-materials/test-book";

/**
 * 수업용 자료·분석서 화면에 넘길 지문 데이터(최종통합자료가 여러 파일을 한꺼번에 불러올 때 쓴다).
 * 수업용 자료·분석서 페이지와 같은 모양으로 만든다. 조회는 사용자 세션이라 RLS가 권한을 가린다.
 */
export async function loadLessonPackProjects(
  supabase: SupabaseClient,
  ids: string[]
): Promise<LessonPackProjectInput[]> {
  if (ids.length === 0) return [];
  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase
      .from("lesson_material_projects")
      .select("id,title,title_en,source,folder_id,analysis_json,illustration_url,lesson_pack_json,deleted_at")
      .in("id", ids)
      .is("deleted_at", null),
    supabase
      .from("lesson_material_items")
      .select("id,project_id,english_text,korean_text,order_index")
      .in("project_id", ids)
      .order("order_index", { ascending: true }),
  ]);
  const folderIds = [
    ...new Set((projects ?? []).map((p) => p.folder_id as string | null).filter((id): id is string => !!id)),
  ];
  const { data: folders } = folderIds.length
    ? await supabase.from("lesson_material_folders").select("id,name").in("id", folderIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const folderNameById = new Map((folders ?? []).map((f) => [f.id as string, f.name as string] as const));
  const itemsByProject = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id as string) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id as string, list);
  }
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p] as const));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const pack = (p.lesson_pack_json ?? {}) as Partial<LessonPackData>;
      return {
        id: p.id as string,
        title: p.title as string,
        titleEn: (p.title_en as string | null) ?? null,
        source: (p.source as string | null) ?? null,
        folderName: p.folder_id ? (folderNameById.get(p.folder_id as string) ?? "폴더") : "미분류",
        analysisCards: Array.isArray(p.analysis_json) ? (p.analysis_json as LessonMaterialAnalysisCard[]) : [],
        headerLabel: pack.headerLabel || "26년도 1학기 중간고사 대비",
        vocab: Array.isArray(pack.vocab) ? (pack.vocab as LessonPackVocabItem[]) : [],
        antonymChecked: pack.vocabAntonymChecked === true,
        illustrationUrl: (p.illustration_url as string | null) ?? null,
        items: (itemsByProject.get(p.id as string) ?? []).map((it) => ({
          id: it.id as string,
          english_text: it.english_text as string,
          korean_text: (it.korean_text as string | null) ?? null,
          order_index: it.order_index as number,
        })),
      };
    });
}

export async function loadAnalysisReportProjects(
  supabase: SupabaseClient,
  ids: string[]
): Promise<AnalysisReportProjectInput[]> {
  if (ids.length === 0) return [];
  // 1장 자료 재료(지칭·함축·바꿔 말하기 — 문장 밑 주석)도 함께 읽는다. 원문이 바뀌었으면 쓰지 않는다.
  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase
      .from("lesson_material_projects")
      .select("id,title,title_en,source,analysis_report_json,lesson_pack_json,deleted_at")
      .in("id", ids)
      .is("deleted_at", null),
    supabase
      .from("lesson_material_items")
      .select("project_id,english_text,korean_text,order_index")
      .in("project_id", ids)
      .order("order_index", { ascending: true }),
  ]);
  const itemsByProject = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id as string) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id as string, list);
  }
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p] as const));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const report = (p.analysis_report_json ?? null) as AnalysisReportData | null;
      const hasSentences = !!report && Array.isArray(report.sentences) && report.sentences.length > 0;
      const pack = (p.lesson_pack_json ?? {}) as Partial<LessonPackData>;
      const english = onePageSentences(
        (itemsByProject.get(p.id as string) ?? []) as Array<{ english_text?: string | null; korean_text?: string | null }>
      ).map((s) => s.english);
      return {
        id: p.id as string,
        title: p.title as string,
        titleEn: (p.title_en as string | null) ?? null,
        source: (p.source as string | null) ?? null,
        headerLabel: report?.headerLabel || "26년도 1학기 중간고사 대비",
        // 빈칸 추론·함축 의미는 수업용 자료(교사용 해설)가 고른 자리와 같게(2026-11-11)
        report: hasSentences
          ? syncReportSpotsWithTeacherNotes(
              report!,
              pack.teacherNotes,
              onePageSentences(
                (itemsByProject.get(p.id as string) ?? []).filter((it) => String(it.english_text ?? "").trim()) as Array<{ english_text?: string | null; korean_text?: string | null }>
              ).map((x) => x.english)
            )
          : null,
        onePageContent: isOnePageContentFresh(pack.onePageContent, english) ? pack.onePageContent : null,
      };
    });
}

/**
 * 1장 요약직보자료·1장 테스트 화면에 넘길 지문 데이터. 재료는 지금 원문으로 만든 것만 넘기고,
 * 없거나 옛 원문이면 null로 둬서 화면이 준비하게 한다.
 */
export async function loadOnePageProjects(
  supabase: SupabaseClient,
  ids: string[]
): Promise<OnePageProjectInput[]> {
  if (ids.length === 0) return [];
  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase
      .from("lesson_material_projects")
      .select("id,title,title_en,source,lesson_pack_json,deleted_at")
      .in("id", ids)
      .is("deleted_at", null),
    supabase
      .from("lesson_material_items")
      .select("project_id,english_text,korean_text,order_index")
      .in("project_id", ids)
      .order("order_index", { ascending: true }),
  ]);
  const itemsByProject = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id as string) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id as string, list);
  }
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p] as const));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const pack = (p.lesson_pack_json ?? {}) as Partial<LessonPackData>;
      const sentences = onePageSentences(
        (itemsByProject.get(p.id as string) ?? []) as Array<{ english_text?: string | null; korean_text?: string | null }>
      );
      const english = sentences.map((s) => s.english);
      return {
        id: p.id as string,
        title: p.title as string,
        titleEn: (p.title_en as string | null) ?? null,
        source: (p.source as string | null) ?? null,
        sentences,
        sourceHash: onePageSourceHash(english),
        content: isOnePageContentFresh(pack.onePageContent, english) ? pack.onePageContent : null,
      };
    });
}

/**
 * 테스트 교재 화면에 넘길 지문 데이터. 1장 자료 재료·테스트 교재 재료는 지금 원문으로 만든 것만
 * 넘기고, 없거나 옛 원문이면 null로 둬서 화면이 준비하게 한다.
 */
export async function loadTestBookProjects(
  supabase: SupabaseClient,
  ids: string[]
): Promise<TestBookProjectInput[]> {
  if (ids.length === 0) return [];
  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase
      .from("lesson_material_projects")
      .select("id,title,title_en,source,lesson_pack_json,analysis_report_json,deleted_at")
      .in("id", ids)
      .is("deleted_at", null),
    supabase
      .from("lesson_material_items")
      .select("project_id,english_text,korean_text,order_index")
      .in("project_id", ids)
      .order("order_index", { ascending: true }),
  ]);
  const itemsByProject = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id as string) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id as string, list);
  }
  const byId = new Map((projects ?? []).map((p) => [p.id as string, p] as const));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const pack = (p.lesson_pack_json ?? {}) as Partial<LessonPackData>;
      const sentences = onePageSentences(
        (itemsByProject.get(p.id as string) ?? []) as Array<{ english_text?: string | null; korean_text?: string | null }>
      );
      const english = sentences.map((s) => s.english);
      const content = isOnePageContentFresh(pack.onePageContent, english) ? pack.onePageContent : null;
      return {
        id: p.id as string,
        title: p.title as string,
        titleEn: (p.title_en as string | null) ?? null,
        source: (p.source as string | null) ?? null,
        sentences,
        content,
        analysis: (p.analysis_report_json as AnalysisReportData | null) ?? null,
        // 워크북 어법 선택이 저장돼 있으면 테스트 교재 어법선택도 그것을 쓴다(값 없음)
        grammarChoice: readCachedGrammarChoiceV2(
          pack.grammarChoiceV2Cache as StoredGrammarChoiceV2Cache | null | undefined,
          p.id as string,
          (itemsByProject.get(p.id as string) ?? []).map((it) => String(it.english_text ?? ""))
        ),
        material: isTestBookMaterialFresh(pack.testBookMaterial, english)
          ? mergeTestBookVocabHints(pack.testBookMaterial, content)
          : null,
      };
    });
}

/**
 * 최종통합자료의 계획표·전체 단어장·백지노트에 쓰는 지문 데이터. 무거운 열(lesson_pack_json 통째·분석서)은
 * 읽지 않고 필요한 칸(1장 자료 재료·테스트 교재 재료)만 꺼낸다.
 */
export async function loadBundleExtraProjects(
  supabase: SupabaseClient,
  ids: string[]
): Promise<TestBookProjectInput[]> {
  if (ids.length === 0) return [];
  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase
      .from("lesson_material_projects")
      .select(
        "id,title,title_en,source,illustration_url,opc:lesson_pack_json->onePageContent,tbm:lesson_pack_json->testBookMaterial,gc:lesson_pack_json->grammarChoiceV2Cache,vc:lesson_pack_json->vocabChoiceCache"
      )
      .in("id", ids)
      .is("deleted_at", null),
    supabase
      .from("lesson_material_items")
      .select("id,project_id,english_text,korean_text,order_index")
      .in("project_id", ids)
      .order("order_index", { ascending: true }),
  ]);
  const itemsByProject = new Map<string, NonNullable<typeof items>>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id as string) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id as string, list);
  }
  const rows = (projects ?? []) as unknown as Array<{
    id: string;
    title: string;
    title_en: string | null;
    source: string | null;
    illustration_url: string | null;
    opc: LessonPackData["onePageContent"] | null;
    tbm: LessonPackData["testBookMaterial"] | null;
    gc: StoredGrammarChoiceV2Cache | null;
    vc: StoredVocabChoiceCache | null;
  }>;
  const byId = new Map(rows.map((p) => [p.id, p] as const));
  return Promise.all(ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(async (p) => {
      const projectItems = itemsByProject.get(p.id) ?? [];
      const sentences = onePageSentences(projectItems as Array<{ english_text?: string | null; korean_text?: string | null }>);
      const english = sentences.map((s) => s.english);
      const content = isOnePageContentFresh(p.opc ?? undefined, english) ? (p.opc ?? null) : null;
      const sentenceIds = projectItems
        .filter((item) => String(item.english_text ?? "").trim())
        .map((item) => String(item.id));
      // 워크북에서 이미 만들고 검수한 어휘 선택 캐시를 모델 호출 없이 테스트지에도 쓴다.
      const vocabChoice = await generateVocabChoiceForPassage({
        projectId: p.id,
        title: p.title,
        source: p.source ?? null,
        sentences: sentences.map((sentence, i) => ({ id: sentenceIds[i] ?? `s${i}`, english: sentence.english })),
        hints: (content?.vocab ?? []).map((item) => ({
          word: item.surface,
          antonyms: item.antonyms,
        })),
        cache: p.vc,
        wordLevel: "normal",
        cacheOnly: true,
      });
      return {
        id: p.id,
        title: p.title,
        titleEn: p.title_en ?? null,
        source: p.source ?? null,
        sentences,
        content,
        material: isTestBookMaterialFresh(p.tbm ?? undefined, english)
          ? mergeTestBookVocabHints(p.tbm!, content)
          : null,
        // 워크북 어법 선택이 저장돼 있으면 테스트지 어법선택도 그것을 쓴다(값 없음)
        grammarChoice: readCachedGrammarChoiceV2(
          p.gc,
          p.id,
          (itemsByProject.get(p.id) ?? []).map((it) => String(it.english_text ?? ""))
        ),
        vocabChoice: vocabChoice.section,
        illustrationUrl: p.illustration_url ?? null,
      };
    }));
}
