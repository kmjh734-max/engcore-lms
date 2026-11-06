"use server";

import { revalidatePath } from "next/cache";
import { LESSON_VOCAB_FOLDER } from "@/lib/lesson-materials/load-library";
import { defaultDocumentName, uniqueDocumentName } from "@/lib/lesson-materials/documents";
import { createClient } from "@/lib/supabase/server";
import { sortProjectIdsByPassageOrder } from "@/lib/lesson-materials/passage-order";
import { persistVocabItems, type VocabItemSaveInput } from "@/lib/vocab/save-items";
import { nextVocabSetOrderIndex } from "@/lib/vocab/reorder-sets";
import { loadBundleExtraProjects } from "@/lib/lesson-materials/load-material-payloads";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import { flushAiUsage, withAiUsage } from "@/lib/ai-usage/context";
import { debitLessonCredits, lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { generateOnePageContent } from "@/lib/lesson-materials/generate-one-page";
import type { LessonPackData } from "@/lib/lesson-materials/generate-lesson-pack";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import { generateAndSaveLessonPackVocab } from "@/lib/lesson-materials/lesson-pack-vocab";
import { findPhrase, isOnePageContentFresh, onePageSentences, type OnePageContent } from "@/lib/lesson-materials/one-page";
import { patchLessonPack } from "@/lib/lesson-materials/patch-lesson-pack";
import { pickKeySentenceIds } from "@/lib/lesson-materials/key-sentences";
import { generateWorkbookLineTranslation } from "@/lib/lesson-materials/generate-workbook-line-translation";
import { generateWorkbookWordOrderWriting } from "@/lib/lesson-materials/generate-workbook-word-order-writing";
import type { StoredWordOrderChunkCache } from "@/lib/lesson-materials/word-order-chunk-cache";
import type { StoredBlankCandidatePool } from "@/lib/lesson-materials/workbook-blank-cache";
import { glossTestBookChunks, refineTestBookVocab } from "@/lib/lesson-materials/generate-test-book";
import {
  KEY_SENTENCE_VERSION,
  analyzeKeySentences,
  keySentenceNorm,
  type KeySentence,
  type KeySentenceAnalysis,
} from "@/lib/grammar/key-sentence-analysis";
import {
  TEST_BOOK_MATERIAL_VERSION,
  TEST_BOOK_VOCAB_VERSION,
  isTestBookMaterialFresh,
  isTestBookMaterialSameSource,
  mergeTestBookVocabHints,
  normalizeTestBookOptions,
  testBookSourceHash,
  testDrawUnits,
  type TestBookMaterial,
  type TestBookOptions,
  type TestBookProjectInput,
} from "@/lib/lesson-materials/test-book";

type Role = "admin" | "teacher";
type Fail = { ok: false; message: string };

/** 테스트 교재 값(지문당). 같은 지문은 한 번만 받는다. */
const TEST_BOOK_FEATURE = "lesson_test_book";

async function requireTestBook(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) return { profile: null, error: "권한이 없습니다." };
  if (role === "teacher" && profile.is_active === false) return { profile: null, error: "비활성화된 계정입니다." };
  if (!profile.academy_id) return { profile: null, error: "소속 학원 정보가 없습니다." };
  if (!(await isAcademyFeatureOn(createAdminClient(), profile.academy_id, "test_book"))) {
    return { profile: null, error: "이 학원에서는 테스트 교재를 쓸 수 없습니다." };
  }
  return { profile, error: null as null };
}

/**
 * 지문 문장 분석. 출처가 교과서 본문 이름과 같고 저장해 둔 분석이 지금 규칙이면 그것을(문장은 글자로 맞춘다),
 * 아니면 같은 규칙으로 계산한다. 돌려주는 sentences는 지문 문장 차례(못 맞춘 문장은 계산한 값).
 */
async function loadKeySentenceAnalysis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  academyId: string,
  source: string | null,
  english: string[]
): Promise<KeySentenceAnalysis> {
  const live = analyzeKeySentences(english, source);
  if (!source?.trim()) return live;
  const { data } = await supabase
    .from("textbook_passages")
    .select("key_sentences")
    .eq("academy_id", academyId)
    .eq("label", source.trim())
    .limit(1)
    .maybeSingle();
  const stored = data?.key_sentences as KeySentenceAnalysis | null | undefined;
  if (!stored || stored.version !== KEY_SENTENCE_VERSION || !Array.isArray(stored.sentences)) return live;
  const byText = new Map<string, KeySentence>(stored.sentences.map((s) => [keySentenceNorm(s.english), s] as const));
  return {
    ...stored,
    sentences: english.map((e, i) => byText.get(keySentenceNorm(e)) ?? live.sentences[i]!),
  };
}

async function loadProject(role: Role, profile: { id: string; academy_id: string | null }, projectId: string) {
  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,source,lesson_pack_json,analysis_report_json")
    .eq("id", projectId)
    .eq("academy_id", profile.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") pq = pq.or(`teacher_id.eq.${profile.id},created_by.eq.${profile.id}`);
  const { data: project } = await pq.maybeSingle();
  if (!project) return null;
  const { data: items } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  return { supabase, project, items: items ?? [] };
}

/**
 * 지문 하나의 테스트 교재 재료를 준비한다.
 * 1. 해석·단어 목록이 없으면 수업용 자료를 먼저 만든다(수업용 자료 값은 그쪽에서 따로).
 * 2. 1장 자료 재료(동반의어·어법 포인트·T/F·요약문)가 없으면 만든다.
 * 3. 단어 정리(품사·지문 속 뜻·파생어), 중요문장(워크북과 같은 규칙), 어순 덩어리(워크북과 같은 캐시).
 * 원문이 그대로면 저장해 둔 것을 쓴다. 값은 같은 지문에 한 번만 받는다.
 */
/**
 * 워크북 새 유형(지칭·함축·바꿔 말하기·도식화·연결어·삽입·요약문·직독직해·단어 시험지)에 쓰는 재료.
 * 테스트 교재와 같은 재료를 만들되, 테스트 교재 기능 스위치 없이 모든 학원이 쓰고 값은 지문당 한 번
 * lesson_workbook_extras(200, 마이그레이션 197)로 받는다(선생님 2026-10-21: 테스트 교재를 워크북·최종통합자료로 합침).
 */
export async function prepareWorkbookExtrasAction(
  role: Role,
  input: {
    projectId: string;
    regenerate?: Array<"vocab" | "gloss" | "content">;
    /** 자료함 「단어」 탭에서 부름 — 그 기능을 켠 학원이면 값을 받지 않는다(선생님 2026-10-28) */
    vocabTab?: boolean;
    /** 워크북에서 고른 유형(tb_*) — 그 유형 재료만 만들고 유형마다 값을 받는다(선생님 2026-10-28) */
    tbTypes?: string[];
  }
) {
  return preparePassage(role, input, "workbook");
}

const LINE_TRANSLATION_FEATURE = "lesson_workbook_line_translation";

/** 직독직해 덩어리가 문장 수만큼 있고 절반 넘게 채워졌는가 */
function chunkGlossUsable(gloss: TestBookMaterial["chunkGloss"] | undefined, count: number) {
  return !!gloss && gloss.length === count && gloss.filter((c) => c?.length).length * 2 >= count;
}

/**
 * 워크북 해석 적기를 끊어 읽기로 만들 때 쓰는 직독직해 덩어리만 준다(선생님 2026-10-27: 문장마다 ↔ 끊어 읽기로
 * 바꾸는데 왜 크레딧이 드나). 예전에는 워크북 부가 재료 전체(1장 재료·단어 정리·어순 덩어리, 지문당 200)를 만들고
 * 값을 받았다. 덩어리는 gpt-4o-mini 한 번(1원 아래)이고 한 번 만들면 다시 쓴다.
 * chargeKey가 있으면(처음 만들 때 끊어 읽기를 고른 경우) 문장마다 해석과 같은 한 줄 해석 값을 지문당 한 번 받는다.
 * 바꾸기에는 chargeKey를 주지 않는다 — 값이 없다.
 */
export async function prepareWorkbookChunkGlossAction(
  role: Role,
  input: { projectId: string; chargeKey?: string }
): Promise<
  | {
      ok: true;
      sentences: Array<{ english: string; korean: string }>;
      chunkGloss: Array<Array<{ en: string; ko: string }> | null>;
      title: string;
      source: string | null;
    }
  | Fail
> {
  const { profile, error } = await requireLessonRole(role);
  if (error) return { ok: false, message: error };
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) return { ok: false, message: "선택된 지문이 없습니다." };
  const chargeKey = String(input.chargeKey ?? "").trim().slice(0, 80);
  const loaded = await loadProject(role, profile!, projectId);
  if (!loaded) return { ok: false, message: "지문을 찾을 수 없습니다." };
  const { supabase, project, items } = loaded;
  const pack = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const sentences = onePageSentences(items.filter((it) => String(it.english_text ?? "").trim()));
  if (!sentences.length) return { ok: false, message: "지문 문장이 없습니다." };
  const english = sentences.map((s) => s.english);
  const hash = testBookSourceHash(english);

  if (chargeKey) {
    const shortfall = await lessonCreditShortfall(profile!.academy_id!, LINE_TRANSLATION_FEATURE);
    if (shortfall) return { ok: false, message: shortfall };
  }

  const material = pack.testBookMaterial;
  let chunkGloss =
    material && isTestBookMaterialSameSource(material, english) && chunkGlossUsable(material.chunkGloss, sentences.length)
      ? material.chunkGloss!
      : pack.chunkGlossCache?.sourceHash === hash && chunkGlossUsable(pack.chunkGlossCache.chunkGloss, sentences.length)
        ? pack.chunkGlossCache.chunkGloss
        : null;
  try {
    if (!chunkGloss) {
      const usage = {
        academyId: profile!.academy_id,
        actorId: profile!.id,
        featureKey: chargeKey ? LINE_TRANSLATION_FEATURE : null,
        usedFor: "workbook",
        projectId,
      };
      chunkGloss = await withAiUsage(usage, () => glossTestBookChunks({ title: project.title as string, sentences }));
      await flushAiUsage();
      await patchLessonPack(supabase, projectId, pack, {
        chunkGlossCache: { sourceHash: hash, chunkGloss, createdAt: new Date().toISOString() },
      });
    }
    if (chargeKey) {
      await debitLessonCredits({
        academyId: profile!.academy_id!,
        actorId: profile!.id,
        featureKey: LINE_TRANSLATION_FEATURE,
        projectId,
        idempotencyKey: `${LINE_TRANSLATION_FEATURE}:chunk:${chargeKey}:${projectId}`,
        note: `워크북 해석 적기(끊어 읽기) · ${project.title}`,
      });
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "끊어 읽기를 만들지 못했습니다." };
  }
  return {
    ok: true,
    sentences,
    chunkGloss,
    title: String(project.title ?? ""),
    source: (project.source as string | null) ?? null,
  };
}

export async function prepareTestBookPassageAction(
  role: Role,
  input: {
    projectId: string;
    forceRegenerate?: boolean;
    regenerate?: Array<"vocab" | "gloss" | "content">;
  }
) {
  return preparePassage(role, input, "test_book");
}

async function requireLessonRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) return { profile: null, error: "권한이 없습니다." };
  if (role === "teacher" && profile.is_active === false) return { profile: null, error: "비활성화된 계정입니다." };
  if (!profile.academy_id) return { profile: null, error: "소속 학원 정보가 없습니다." };
  return { profile, error: null as null };
}

const WORKBOOK_EXTRAS_FEATURE = "lesson_workbook_extras";
/**
 * 워크북 유형마다 지문당 값(30, 마이그레이션 202). 고른 유형만 받는다(선생님 2026-10-28: 요약문만 골랐는데
 * 「지칭·함축·요약 등」 200이 나갔다). 재료도 고른 유형에 필요한 것만 만든다.
 */
const WORKBOOK_TB_TYPE_FEATURE = "lesson_workbook_tb_type";
/** 1장 재료(가벼운 것)가 있어야 하는 유형 */
const TB_CONTENT_TYPES = new Set(["tb_summary", "tb_flow", "tb_reference", "tb_implication", "tb_paraphrase"]);
/** 단어 정리·직독직해·중요문장 재료가 있어야 하는 유형 */
const TB_MATERIAL_TYPES = new Set(["tb_chunk_line", "tb_vocab_exam", "tb_insert"]);
/** 값을 받는 유형 — 연결어·글의 순서·문장 삽입은 규칙으로만 만들어 받지 않는다 */
const TB_PAID_TYPES: Record<string, string> = {
  tb_summary: "요약문 완성",
  tb_flow: "도식화",
  tb_reference: "지칭추론",
  tb_implication: "함축의미",
  tb_paraphrase: "바꿔 말하기",
  tb_vocab_exam: "단어 시험",
  tb_chunk_line: "해석 적기(끊어 읽기)",
};

/** 재료가 필요 없는 유형만 골랐을 때 쓰는 빈 1장 재료·빈 테스트 교재 재료(저장하지 않는다) */
function emptyOnePageContent(): OnePageContent {
  return {
    version: "",
    sourceHash: "",
    topicKo: "",
    titleEn: "",
    summaryEn: "",
    summaryKeywords: [],
    summaryKo: "",
    flow: [],
    vocab: [],
    grammar: [],
    paraphrases: [],
    tf: [],
    keySentenceIndexes: [],
    createdAt: new Date().toISOString(),
  };
}
function emptyTestBookMaterial(): TestBookMaterial {
  return { version: "", sourceHash: "", vocab: [], keyIndexes: [], chunks: [], createdAt: new Date().toISOString() };
}

async function preparePassage(
  role: Role,
  input: {
    projectId: string;
    forceRegenerate?: boolean;
    /**
     * 기능마다 다시 만들기(선생님 2026-10-20): 단어 정리·직독직해·1장 자료 재료(동반의어·T/F·지칭 등) 가운데
     * 고른 것만 새로 만든다. 같은 지문의 테스트 교재 값은 다시 받지 않는다.
     */
    regenerate?: Array<"vocab" | "gloss" | "content">;
    vocabTab?: boolean;
    /** 워크북에서 고른 유형(tb_*). 주면 그 유형에 필요한 재료만 만들고 유형마다 값을 받는다 */
    tbTypes?: string[];
  },
  kind: "test_book" | "workbook"
): Promise<
  | {
      ok: true;
      content: OnePageContent;
      material: TestBookMaterial;
      sentences: Array<{ english: string; korean: string }>;
      title: string;
      source: string | null;
    }
  | Fail
> {
  const { profile, error } = kind === "test_book" ? await requireTestBook(role) : await requireLessonRole(role);
  if (error) return { ok: false, message: error };
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) return { ok: false, message: "선택된 지문이 없습니다." };
  // 워크북에서 고른 유형만 — 그 유형에 필요한 재료만 만들고 유형마다 값을 받는다(2026-10-28)
  const typed = kind === "workbook" && !input.vocabTab && Array.isArray(input.tbTypes) && input.tbTypes.length > 0;
  const tbTypes = typed ? input.tbTypes!.filter((t) => typeof t === "string") : [];
  // 자료함 「단어」 탭은 단어 정리만 쓴다 — 1장 재료(어법·검수, gpt-5-mini 30번 안팎·지문당 약 96원)를 만들지 않는다
  // (선생님 2026-10-29: 윌링 사흘 원가의 45%가 무료 단어 탭에서 돈 1장 재료였다)
  const vocabOnly = kind === "workbook" && input.vocabTab === true;
  const needContent = !vocabOnly && (!typed || tbTypes.some((t) => TB_CONTENT_TYPES.has(t)));
  const needMaterial = !typed || tbTypes.some((t) => TB_MATERIAL_TYPES.has(t));
  const paidTypes = tbTypes.filter((t) => t in TB_PAID_TYPES);
  const FEATURE = kind === "test_book" ? TEST_BOOK_FEATURE : typed ? WORKBOOK_TB_TYPE_FEATURE : WORKBOOK_EXTRAS_FEATURE;

  let loaded = await loadProject(role, profile!, projectId);
  if (!loaded) return { ok: false, message: "지문을 찾을 수 없습니다." };

  // 자료함 「단어」 탭(윌링어학원)에서 만드는 단어 정리는 값을 받지 않는다(선생님 2026-10-28).
  // 기능을 켠 학원만 — 다른 학원이 이 표시로 워크북 재료 값을 피하지 못하게
  const free =
    (typed && paidTypes.length === 0) ||
    (kind === "workbook" &&
      input.vocabTab === true &&
      (await isAcademyFeatureOn(createAdminClient(), profile!.academy_id, "lesson_vocab_tab")));
  if (!free) {
    const shortfall = await lessonCreditShortfall(profile!.academy_id!, FEATURE);
    if (shortfall) return { ok: false, message: shortfall };
  }

  // 1. 해석·단어 목록
  const pack0 = (loaded.project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const missingKorean = loaded.items.some((it) => String(it.english_text ?? "").trim() && !String(it.korean_text ?? "").trim());
  if (missingKorean || (needMaterial && !(pack0.vocab ?? []).length)) {
    // 단어·해석 값은 따로 받지 않는다 — 이 재료 값(지문당 한 번)에 들어 있다(선생님 2026-10-26: 두 번 뜬다)
    const res = await generateAndSaveLessonPackVocab(role, { projectId }, false);
    if (!res.ok) return { ok: false, message: res.message };
    loaded = await loadProject(role, profile!, projectId);
    if (!loaded) return { ok: false, message: "지문을 찾을 수 없습니다." };
  }
  const { supabase, project, items } = loaded;
  const pack = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const usable = items.filter((it) => String(it.english_text ?? "").trim());
  const sentences = onePageSentences(usable);
  const english = sentences.map((s) => s.english);
  const usage = {
    academyId: profile!.academy_id,
    actorId: profile!.id,
    featureKey: FEATURE,
    usedFor: kind,
    projectId,
  };

  try {
    // 2. 1장 자료 재료. 단어 정리만 이것을 기다리고, 어순 덩어리·직독직해는 같이 돌린다
    //    (선생님 2026-10-26: 수업용 자료가 너무 오래 걸린다 — 예전에는 다섯 단계를 차례로 기다렸다)
    let content = pack.onePageContent;
    const again = new Set(input.forceRegenerate ? ["vocab", "gloss", "content"] : (input.regenerate ?? []));
    const fullFresh = isOnePageContentFresh(content, english);
    const liteFresh = isOnePageContentFresh(pack.workbookLiteContent, english);
    const contentP: Promise<OnePageContent | undefined> = typed || vocabOnly
      ? // 워크북 유형만(또는 단어 탭): 1장 자료 재료가 있으면 그것을, 없으면 어법·낱말을 뺀 가벼운 재료를 따로 만들어 둔다
        !needContent
        ? Promise.resolve(fullFresh ? content! : liteFresh ? pack.workbookLiteContent! : undefined)
        : !again.has("content") && fullFresh
          ? Promise.resolve(content!)
          : !again.has("content") && liteFresh
            ? Promise.resolve(pack.workbookLiteContent!)
            : withAiUsage(usage, () =>
                generateOnePageContent({ title: project.title as string, sentences: english, lite: true })
              ).then(async (r) => {
                await patchLessonPack(supabase, projectId, pack, { workbookLiteContent: r.content });
                return r.content;
              })
      : again.has("content") || !fullFresh
        ? withAiUsage(usage, () => generateOnePageContent({ title: project.title as string, sentences: english })).then(
            async (r) => {
              await patchLessonPack(supabase, projectId, pack, { onePageContent: r.content });
              return r.content;
            }
          )
        : Promise.resolve(content!);
    // 나중에 기다린다 — 그 사이 실패해도 처리 안 된 거부로 서버가 멈추지 않게
    contentP.catch(() => {});

    // 3. 테스트 교재 재료
    let material = pack.testBookMaterial;
    // 예전 생성 실패로 최신 재료 안에 직독직해만 비어 있을 수 있다. 이 상태를 최신으로
    // 취급하면 끊어읽기를 골라도 모든 문장이 전체해석으로 나오는 폴백에 머문다.
    // 절반 넘게 비어도 다시 만든다(경민고1 4과: 9문장 중 1문장만 있어 끊어 읽기가 거의 전체해석으로 나왔다)
    const missingChunkGloss =
      !material?.chunkGloss ||
      material.chunkGloss.length !== sentences.length ||
      material.chunkGloss.filter((chunks) => chunks?.length).length * 2 < sentences.length;
    // 워크북에서 재료가 필요 없는 유형만 골랐으면 만들지 않는다(있는 것은 쓴다)
    if (!needMaterial && !isTestBookMaterialFresh(material, english)) material = null;
    if (needMaterial && (again.size || missingChunkGloss || !isTestBookMaterialFresh(material, english))) {
      // 원문이 그대로면(재료 버전만 바뀌었으면) 단어 정리는 다시 쓰고 규칙으로 만드는 것만 새로
      const reuseVocab =
        !again.has("vocab") && isTestBookMaterialSameSource(material, english) && material.vocabVersion === TEST_BOOK_VOCAB_VERSION;
      const oldVocab = reuseVocab ? material!.vocab : null;
      const vocabP = oldVocab
        ? Promise.resolve(oldVocab)
        : contentP.then(async (c) => {
            // 1장 재료가 없으면(단어 탭) 수업용 자료 단어 목록의 동반의어를 참고로 준다 — 4o-mini는 긴 지문에서 동반의어를 비워 둔다
            const fromPack = !c?.vocab?.length;
            const keyHints = fromPack
              ? (pack.vocab ?? []).map((v) => ({ surface: v.word, synonyms: v.synonyms ?? [], antonyms: v.antonyms ?? [] }))
              : c!.vocab.map((v) => ({ surface: v.surface, synonyms: v.synonyms, antonyms: v.antonyms }));
            const rows = await withAiUsage(usage, () =>
              refineTestBookVocab({ title: project.title as string, sentences, packVocab: pack.vocab ?? [], keyHints })
            );
            if (!fromPack) return rows;
            const hint = new Map(keyHints.map((h) => [h.surface.trim().toLowerCase(), h] as const));
            const fill = (own: string[], more: string[], word: string) =>
              own.length ? own : more.filter((w) => w.trim() && w.trim().toLowerCase() !== word.toLowerCase()).slice(0, 3);
            return rows.map((r) => {
              const h = r.key ? hint.get(r.word.trim().toLowerCase()) : undefined;
              return h ? { ...r, synonyms: fill(r.synonyms, h.synonyms, r.word), antonyms: fill(r.antonyms, h.antonyms, r.word) } : r;
            });
          });
      vocabP.catch(() => {});
      // 직독직해 덩어리: 원문이 같고 이미 있으면 다시 쓰고, 없으면 만든다(gpt-4o-mini, 1원 아래) — 바로 시작
      const oldGloss =
        material && isTestBookMaterialSameSource(material, english) && !again.has("gloss") && !missingChunkGloss
          ? material.chunkGloss
          : undefined;
      const glossP = oldGloss?.length
        ? Promise.resolve(oldGloss)
        : withAiUsage(usage, () => glossTestBookChunks({ title: project.title as string, sentences })).catch(() => undefined);

      // 중요문장: 워크북 「중요문장 어순배열」과 같은 규칙(분석서 주제문 → 빈칸 후보 핵심 문장 → 규칙)
      const report = (project.analysis_report_json ?? null) as AnalysisReportData | null;
      const ids = usable.map((it) => String(it.id));
      const keyIds = pickKeySentenceIds({
        sentences: usable.map((it) => ({ id: String(it.id), english: String(it.english_text ?? "") })),
        analysisSentences: report?.sentences ?? null,
        coreSentenceIds: (pack.blankCandidatePool as StoredBlankCandidatePool | undefined)?.coreSentenceIds ?? null,
      });
      // 어순배열 문장: 그 과 단원문법이 든 문장(꼭)과 구문이 어려운 문장. 교과서 본문은 저장해 둔
      // 분석(textbook_passages.key_sentences)을 쓰고, 없거나 옛 규칙이면 같은 규칙으로 바로 계산한다.
      const analysis = await loadKeySentenceAnalysis(
        supabase,
        profile!.academy_id!,
        (project.source as string | null) ?? null,
        sentences.map((s) => s.english)
      );
      const unitKey = analysis.unitKey;
      const usableAt = (si: number) => {
        const w = sentences[si]!.english.split(/\s+/).length;
        return w >= 6 && w <= 40 && !!sentences[si]!.korean.trim();
      };
      const unitHits = analysis.sentences
        .map((s, si) => ({ si, grammar: s?.unitGrammar ?? [] }))
        .filter((h) => h.grammar.length && usableAt(h.si))
        .slice(0, 5);
      const hardHits = analysis.sentences
        .map((s, si) => ({ si, structures: s?.structures ?? [], score: s?.score ?? 0, hard: !!s?.hard }))
        .filter((h) => h.hard && usableAt(h.si) && !unitHits.some((u) => u.si === h.si))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(({ si, structures }) => ({ si, structures }));
      const keyIndexes = [
        ...new Set([
          ...unitHits.map((h) => h.si),
          ...hardHits.map((h) => h.si),
          ...keyIds.map((id) => ids.indexOf(id)).filter((i) => i >= 0),
        ]),
      ].sort((a, b) => a - b);
      const chunkKeySet = new Set(keyIndexes.map((i) => ids[i]!));

      // 어순 덩어리: 워크북과 같은 캐시를 쓰고, 없으면 같은 방법으로 만들어 캐시에 넣는다(워크북도 같은 덩어리를 쓴다)
      const chunks: Array<string[] | null> = sentences.map(() => null);
      const passageInput = {
        projectId,
        title: project.title as string,
        source: (project.source as string | null) ?? null,
        sentences: usable.map((it) => ({
          id: String(it.id),
          english: String(it.english_text ?? ""),
          korean: (it.korean_text as string | null) ?? null,
        })),
        sentenceTranslations: pack.sentenceTranslations ?? [],
        packJson: pack,
        wordOrderChunkCache: (pack.wordOrderChunkCache as StoredWordOrderChunkCache | undefined) ?? null,
      };
      const bilingual = generateWorkbookLineTranslation({ passages: [passageInput] });
      const chunksP = (async () => {
        if (bilingual.blocking.length === 0 && keyIndexes.length) {
          const keySet = chunkKeySet;
          const wo = await withAiUsage(usage, () =>
            generateWorkbookWordOrderWriting({
              workbookId: `test-book-${projectId}`,
              passages: [passageInput],
              prebuiltLineSections: bilingual.sections
                .map((sec) => ({ ...sec, items: sec.items.filter((it) => keySet.has(it.sentenceId)) }))
                .filter((sec) => sec.items.length > 0),
              prebuiltSkipped: bilingual.skipped,
              prebuiltBlocking: [],
            })
          );
          for (const sec of wo.sections) {
            for (const it of sec.items) {
              const i = ids.indexOf(it.sentenceId);
              if (i >= 0) chunks[i] = it.originalChunks.map((c) => c.text);
            }
          }
          for (const { cache } of wo.cachesToSave) {
            await patchLessonPack(supabase, projectId, pack, { wordOrderChunkCache: cache });
          }
        }
      })();
      const [vocab, chunkGloss] = await Promise.all([vocabP, glossP, chunksP]);

      material = {
        version: TEST_BOOK_MATERIAL_VERSION,
        chunkGloss,
        vocabVersion: TEST_BOOK_VOCAB_VERSION,
        sourceHash: testBookSourceHash(english),
        vocab,
        keyIndexes,
        chunks,
        unitKey,
        unitHits: unitHits.sort((a, b) => a.si - b.si),
        hardHits: hardHits.sort((a, b) => a.si - b.si),
        createdAt: new Date().toISOString(),
      };
      await patchLessonPack(supabase, projectId, pack, { testBookMaterial: material });
    }
    content = await contentP;
    await flushAiUsage();

    if (!free && typed) {
      // 예전 묶음 값(200)을 이미 낸 지문은 유형 값을 더 받지 않는다
      const { data: paidBundle } = await createAdminClient()
        .from("credit_transactions")
        .select("id")
        .eq("academy_id", profile!.academy_id!)
        .eq("idempotency_key", `${WORKBOOK_EXTRAS_FEATURE}:${projectId}`)
        .limit(1);
      if (!paidBundle?.length)
        for (const t of paidTypes)
          await debitLessonCredits({
            academyId: profile!.academy_id!,
            actorId: profile!.id,
            featureKey: WORKBOOK_TB_TYPE_FEATURE,
            projectId,
            // 같은 지문·같은 유형은 한 번만 받는다
            idempotencyKey: `${WORKBOOK_TB_TYPE_FEATURE}:${projectId}:${t}`,
            note: `워크북 ${TB_PAID_TYPES[t]} · ${project.title}`,
          });
    } else if (!free)
      await debitLessonCredits({
        academyId: profile!.academy_id!,
        actorId: profile!.id,
        featureKey: FEATURE,
        projectId,
        // 같은 지문은 기능마다 한 번만 받는다(다시 열거나 다시 만들어도 같은 키).
        idempotencyKey: `${kind === "test_book" ? TEST_BOOK_FEATURE : WORKBOOK_EXTRAS_FEATURE}:${projectId}`,
        note: `${kind === "test_book" ? "테스트 교재" : "워크북 지칭·함축·요약 등"} · ${project.title}`,
      });
    return {
      ok: true,
      content: content ?? emptyOnePageContent(),
      material: mergeTestBookVocabHints(material ?? emptyTestBookMaterial(), content),
      sentences,
      title: String(project.title ?? ""),
      source: (project.source as string | null) ?? null,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "테스트 교재 재료를 만들지 못했습니다." };
  }
}

/** 테스트지 뽑기 값(1크레딧 단위 — 문항 1 · 세트 3 · 단어 시험 지문당 3). 조립만 하므로 원가는 없다 — 마이그레이션 194·201. */
const TEST_DRAW_FEATURE = "lesson_test_draw";

/**
 * 테스트지를 뽑을 때 값을 받는다(선생님 2026-10-20: 새로 뽑을 때마다 기능에 따라). 뽑은 지문 수 × 유형 수.
 * 같은 뽑기(seed)는 두 번 받지 않는다. 모자라면 뽑지 않는다.
 */
export async function chargeTestDrawAction(
  role: Role,
  input: { seed: string; projectIds: string[]; typeCount: number; snapshot?: unknown; name?: string | null }
): Promise<{ ok: true; docId: string | null; name: string | null } | Fail> {
  // 워크북·최종통합자료에서도 뽑는다(2026-10-21 테스트 교재 메뉴를 합침) — 학원 기능 스위치 없이
  const { profile, error } = await requireLessonRole(role);
  if (error) return { ok: false, message: error };
  const seed = String(input.seed ?? "").trim().slice(0, 80);
  const passages = [...new Set((input.projectIds ?? []).map(String).filter(Boolean))].length;
  // 뽑은 시험지(snapshot)로 문항·세트를 센다(선생님 2026-10-26 — 유형별·문항별로)
  const snapSheets = (input.snapshot as { sheets?: Array<{ sheet?: unknown }> } | null | undefined)?.sheets;
  if (!seed || !passages || !Array.isArray(snapSheets) || !snapSheets.length) return { ok: false, message: "뽑을 지문과 유형을 골라 주세요." };
  const hasVocab = !!(input.snapshot as { vocabExam?: unknown } | null | undefined)?.vocabExam;
  const count = testDrawUnits(
    snapSheets.map((x) => x?.sheet as { sections?: Array<{ type?: unknown; items?: unknown[] }> } | undefined),
    hasVocab ? passages : 0
  );
  const quantity = count.units;
  if (!quantity) return { ok: false, message: "뽑을 문항이 없습니다. 유형을 다시 골라 주세요." };
  const shortfall = await lessonCreditShortfall(profile!.academy_id!, TEST_DRAW_FEATURE, quantity);
  if (shortfall) return { ok: false, message: shortfall };
  const ok = await debitLessonCredits({
    academyId: profile!.academy_id!,
    actorId: profile!.id,
    featureKey: TEST_DRAW_FEATURE,
    quantity,
    idempotencyKey: `${TEST_DRAW_FEATURE}:${seed}`,
    note: `테스트지 뽑기 · 지문 ${passages}개 · 문항 ${count.items}개 · 세트 ${count.sets}개${hasVocab ? ` · 단어 시험 ${passages}지문` : ""}`,
  });
  if (!ok) return { ok: false, message: "크레딧을 차감하지 못했습니다. 잠시 뒤 다시 눌러 주세요." };

  // 뽑은 그대로 파일로 남긴다(다시 열어 인쇄 — 값 없음). 저장이 안 돼도 뽑기는 그대로 보여 준다.
  const snap = input.snapshot as { sheets?: unknown[]; vocabExam?: unknown } | null | undefined;
  if (!snap || !Array.isArray(snap.sheets)) return { ok: true, docId: null, name: null };
  const supabase = await createClient();
  // 뽑기를 연 자료 이름 그대로(선생님 2026-11-02), 없으면 「테스트지_날짜」. 같은 이름이 있으면 -2, -3…
  const base = String(input.name ?? "").trim().slice(0, 76) || defaultDocumentName("test_draw");
  const { data: same } = await supabase
    .from("lesson_material_documents")
    .select("name")
    .eq("academy_id", profile!.academy_id!)
    .eq("kind", "test_draw")
    .is("deleted_at", null)
    .like("name", `${base}%`);
  const name = uniqueDocumentName(base, (same ?? []).map((r) => r.name as string));
  // 지문별 시험지는 폴더 차례로 저장한다(선생님 2026-11-06)
  const drawIds = await sortProjectIdsByPassageOrder(supabase, (input.projectIds ?? []).map(String).filter(Boolean));
  const drawRank = new Map(drawIds.map((id, i) => [id, i] as const));
  const sheetRank = (x: unknown) => drawRank.get(String((x as { sheet?: { projectId?: unknown } } | null)?.sheet?.projectId ?? "")) ?? Number.MAX_SAFE_INTEGER;
  const drawSheets = snap.sheets.map((x, i) => ({ x, i })).sort((a, b) => sheetRank(a.x) - sheetRank(b.x) || a.i - b.i).map((v) => v.x);
  const { data: doc } = await supabase
    .from("lesson_material_documents")
    .insert({
      kind: "test_draw",
      name,
      project_ids: drawIds,
      payload: { version: 1, createdAt: new Date().toISOString(), sheets: drawSheets, vocabExam: snap.vocabExam ?? null },
      teacher_id: role === "teacher" ? profile!.id : null,
      created_by: profile!.id,
      academy_id: profile!.academy_id,
    })
    .select("id")
    .maybeSingle();
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true, docId: (doc?.id as string | undefined) ?? null, name: doc ? name : null };
}

/** 교재 설정(유형·해석 보기·계획표 등)을 파일에 저장한다. */
export async function saveTestBookOptionsAction(
  role: Role,
  input: { id: string; options: unknown }
): Promise<{ ok: true; options: TestBookOptions } | Fail> {
  const { profile, error } = await requireTestBook(role);
  if (error) return { ok: false, message: error };
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, message: "파일을 찾을 수 없습니다." };
  const options = normalizeTestBookOptions(input.options);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("lesson_material_documents").select("payload").eq("id", id).maybeSingle();
  const prev = (cur?.payload as Record<string, unknown> | null) ?? {};
  const { data, error: upErr } = await supabase
    .from("lesson_material_documents")
    .update({ payload: { ...prev, version: 1, options }, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("kind", "test_book")
    .eq("academy_id", profile!.academy_id!)
    .select("id")
    .maybeSingle();
  if (upErr) return { ok: false, message: upErr.message };
  if (!data) return { ok: false, message: "파일을 찾을 수 없습니다." };
  return { ok: true, options };
}

/**
 * 교재의 전체 단어(지문마다 단어 정리, 같은 낱말은 처음 지문 것)를 단어학습 단어장으로 등록한다.
 * 단어학습 「테스트 교재」 폴더에 교재 이름으로 만들고, 다시 누르면 같은 단어장을 새 내용으로 맞춘다
 * (파일 payload.vocabSetId). 예문은 그 단어가 나온 지문 문장과 해석이다. 값은 들지 않는다.
 */
export async function registerTestBookVocabAction(
  role: Role,
  input: {
    docId: string | null;
    title: string;
    projectIds: string[];
    /** 자료함 「단어」 탭: 적은 이름 그대로 「수업자료 단어장」 폴더에 늘 새로 만든다(2026-10-27) */
    lessonTab?: boolean;
  }
): Promise<{ ok: true; setId: string; count: number; created: boolean } | Fail> {
  const { profile, error } = await requireLessonRole(role);
  if (error) return { ok: false, message: error };
  const projectIds = [...new Set((input.projectIds ?? []).map((s) => String(s).trim()).filter(Boolean))];
  if (!projectIds.length) return { ok: false, message: "선택된 지문이 없습니다." };
  const supabase = await createClient();
  const projects = await loadBundleExtraProjects(supabase, projectIds);

  const seen = new Set<string>();
  const items: VocabItemSaveInput[] = [];
  for (const p of projects) {
    for (const row of p.material?.vocab ?? []) {
      const k = row.word.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const s = p.sentences.find((x) => findPhrase(x.english, row.word));
      items.push({
        word: row.word,
        meaning: row.meaning,
        part_of_speech: row.pos || null,
        synonyms: row.synonyms.join(", ") || undefined,
        antonyms: row.antonyms.join(", ") || undefined,
        forms: row.forms,
        confusables: row.confusables ?? [],
        example_sentence: s?.english,
        example_meaning: s?.korean || undefined,
        order_index: items.length,
      });
    }
  }
  if (!items.length) return { ok: false, message: "단어 정리가 아직 없습니다. 교재를 먼저 만들어 주세요." };

  const title = input.lessonTab
    ? String(input.title ?? "").trim().slice(0, 80) || "수업자료 단어장"
    : `${String(input.title ?? "").trim() || "테스트 교재"} · 전체 단어`;
  const folderName = input.lessonTab ? LESSON_VOCAB_FOLDER : "테스트 교재";
  const docId = input.docId?.trim() || null;
  let payload: Record<string, unknown> = {};
  if (docId) {
    // 테스트 교재 파일 또는 최종통합자료 파일(단어장 id를 파일에 남겨 다음에 같은 단어장을 고친다)
    const { data } = await supabase
      .from("lesson_material_documents")
      .select("payload")
      .eq("id", docId)
      .in("kind", ["test_book", "integrated", "lesson_pack"])
      .maybeSingle();
    payload = (data?.payload as Record<string, unknown> | null) ?? {};
  }

  // 지난번 등록한 단어장이 아직 있으면 그것을 고친다
  let setId = typeof payload.vocabSetId === "string" ? payload.vocabSetId : null;
  if (setId) {
    const { data } = await supabase.from("vocab_sets").select("id").eq("id", setId).maybeSingle();
    if (!data) setId = null;
  }
  const created = !setId;
  if (!setId) {
    const { data: folder } = await supabase
      .from("vocab_folders")
      .select("id")
      .eq("academy_id", profile!.academy_id!)
      .eq("name", folderName)
      .limit(1)
      .maybeSingle();
    let folderId = (folder?.id as string | undefined) ?? null;
    if (!folderId) {
      const { data: made, error: fErr } = await supabase
        .from("vocab_folders")
        .insert({ name: folderName, teacher_id: role === "teacher" ? profile!.id : null, created_by: profile!.id, academy_id: profile!.academy_id })
        .select("id")
        .single();
      if (fErr) return { ok: false, message: fErr.message };
      folderId = made.id as string;
    }
    const { data: set, error: sErr } = await supabase
      .from("vocab_sets")
      .insert({
        title,
        description: input.lessonTab ? "자료함 단어 탭에서 만든 단어장" : "테스트 교재에서 등록한 단어장",
        folder_id: folderId,
        order_index: await nextVocabSetOrderIndex(supabase, folderId),
        teacher_id: profile!.id,
        created_by: profile!.id,
        is_published: true,
        academy_id: profile!.academy_id,
      })
      .select("id")
      .single();
    if (sErr) return { ok: false, message: sErr.message };
    setId = set.id as string;
  } else {
    await supabase.from("vocab_sets").update({ title }).eq("id", setId);
  }

  const saved = await persistVocabItems(supabase, setId, items);
  if (!saved.ok) return { ok: false, message: saved.message };
  if (docId) {
    await supabase
      .from("lesson_material_documents")
      .update({ payload: { ...payload, vocabSetId: setId } })
      .eq("id", docId)
      .in("kind", ["test_book", "integrated", "lesson_pack"]);
  }
  revalidatePath(`/${role}/vocab`);
  return { ok: true, setId, count: items.length, created };
}

/**
 * 테스트지 뽑기 창(워크북·최종통합자료)이 쓰는 지문 재료. 읽기만 한다(값 없음). 재료가 없는 지문은
 * material이 null — 창에서 prepareWorkbook으로 만든다.
 */
export async function loadDrawProjectsAction(
  role: Role,
  input: { projectIds: string[] }
): Promise<{ ok: true; projects: TestBookProjectInput[] } | Fail> {
  const { error } = await requireLessonRole(role);
  if (error) return { ok: false, message: error };
  const picked = [...new Set((input.projectIds ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 80);
  if (!picked.length) return { ok: false, message: "선택된 지문이 없습니다." };
  const supabase = await createClient();
  // 테스트지도 지문은 폴더 차례로(선생님 2026-11-06)
  const ids = await sortProjectIdsByPassageOrder(supabase, picked);
  return { ok: true, projects: await loadBundleExtraProjects(supabase, ids) };
}
