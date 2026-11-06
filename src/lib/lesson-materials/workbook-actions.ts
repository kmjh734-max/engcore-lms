"use server";

import { pickKeySentenceIds } from "@/lib/lesson-materials/key-sentences";
import {
  LESSON_CREDIT_FEATURES,
  refundLessonCredits,
  reserveLessonCredits,
} from "@/lib/credits/lesson-credits";
import { flushAiUsage, setAiUsage, withAiUsage } from "@/lib/ai-usage/context";
import { createClient } from "@/lib/supabase/server";
import { sortProjectIdsByPassageOrder } from "@/lib/lesson-materials/passage-order";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { patchLessonPack } from "@/lib/lesson-materials/patch-lesson-pack";
import { generateWorkbookBlankFill } from "@/lib/lesson-materials/generate-workbook-blank";
import { mapLineTranslationToFullEnWriting } from "@/lib/lesson-materials/generate-workbook-full-en-writing";
import { generateWorkbookLineTranslation } from "@/lib/lesson-materials/generate-workbook-line-translation";
import { generateWorkbookSentenceOrder } from "@/lib/lesson-materials/generate-workbook-sentence-order";
import { generateWorkbookTf } from "@/lib/lesson-materials/generate-workbook-tf";
import { generateWorkbookGist } from "@/lib/lesson-materials/generate-workbook-gist";
import { generateWorkbookWordOrderWriting } from "@/lib/lesson-materials/generate-workbook-word-order-writing";
import { generateWorkbookGrammarChoice } from "@/lib/lesson-materials/generate-workbook-grammar-choice";
import {
  generateWorkbookGrammarChoiceV2,
  resolveGrammarChoiceEngineVersion,
  stampGrammarChoiceEngineDiagnostics,
} from "@/lib/lesson-materials/grammar-choice-v2/generate";
import type { StoredGrammarChoiceV2Cache } from "@/lib/lesson-materials/grammar-choice-v2/cache";
import type { StoredGrammarChoiceCache } from "@/lib/lesson-materials/grammar-choice-cache";
import type { StoredGrammarChoiceV5Cache } from "@/lib/lesson-materials/grammar-choice-v5-cache";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import type { StoredWordOrderChunkCache } from "@/lib/lesson-materials/word-order-chunk-cache";
import { SENTENCE_ORDER_SKIP_TOO_FEW } from "@/lib/lesson-materials/sentence-order-constants";
import type { LessonPackData, LessonPackVocabItem } from "@/lib/lesson-materials/generate-lesson-pack";
import type { StoredBlankCandidatePool } from "@/lib/lesson-materials/workbook-blank-cache";
import {
  generateVocabChoiceForPassage,
  type StoredVocabChoiceCache,
} from "@/lib/lesson-materials/vocab-choice";
import {
  DEFAULT_WORKBOOK_TF_OPTIONS,
  DEFAULT_WORKBOOK_GIST_OPTIONS,
  READY_WORKBOOK_TYPE_IDS,
  clampGistCount,
  clampTfCount,
  defaultWorkbookTitle,
  parseBlankHintType,
  parseBlankTranslationLayout,
  parseBlankDensity,
  sortWorkbookTypesByPrintOrder,
  WORKBOOK_RULE_TYPES,
  WORKBOOK_TYPE_SHORT,
  type WorkbookBlankFillOptions,
  type WorkbookData,
  type WorkbookGistOptions,
  type WorkbookTfOptions,
  type WorkbookGrammarChoiceSection,
  type WorkbookGrammarChoiceSkip,
  type WorkbookTypeId,
  type WorkbookVocabChoiceSection,
} from "@/lib/lesson-materials/workbook-types";

type Role = "admin" | "teacher";

async function requireRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) {
    return { profile: null as null, error: "권한이 없습니다." };
  }
  if (role === "teacher" && profile.is_active === false) {
    return { profile: null as null, error: "비활성화된 계정입니다." };
  }
  if (!profile.academy_id) {
    return { profile: null as null, error: "소속 학원 정보가 없습니다." };
  }
  return { profile, error: null as null };
}

function normalizeSelectedTypes(raw: WorkbookTypeId[]): WorkbookTypeId[] {
  const ready = new Set(READY_WORKBOOK_TYPE_IDS);
  const filtered = [...new Set(raw)].filter((id) => ready.has(id));
  return sortWorkbookTypesByPrintOrder(filtered);
}

export async function generateWorkbookAction(
  role: Role,
  input: {
    projectIds: string[];
    selectedTypes: WorkbookTypeId[];
    tfOptions?: Partial<WorkbookTfOptions>;
    blankOptions?: Partial<WorkbookBlankFillOptions>;
    /** 제목·주제·요지 해석: 갈래마다 개수(2026-10-24) */
    gistOptions?: Partial<WorkbookGistOptions>;
    title?: string;
    /** Exclude these project IDs from one-line translation only */
    lineTranslationExcludeIds?: string[];
    /** 어법 선택 캐시를 무시하고 새 모델로 다시 생성 */
    forceRegenerate?: boolean;
    /** 어법 선택은 생성하지 않고 비워 둔다. 클라이언트가 지문 단위로 따로 채운다. */
    deferGrammarChoice?: boolean;
    /**
     * 이미 만든 끊어읽기에서 문장별 전체해석으로 바꿀 때만 쓴다.
     * 저장된 문장 해석을 다시 배열할 뿐 모델을 부르지 않으므로 크레딧을 받지 않는다.
     */
    reuseStoredLineTranslations?: boolean;
  }
): Promise<
  | { ok: true; workbook: WorkbookData }
  | {
      ok: false;
      message: string;
      code?: "MISSING_TRANSLATION" | "MISSING_LINE_TRANSLATION";
      lineTranslationExcludeIds?: string[];
    }
> {
  const tLoad0 = Date.now();
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const ids = (input.projectIds ?? []).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { ok: false, message: "선택된 자료가 없습니다." };

  const types = normalizeSelectedTypes(input.selectedTypes ?? []);
  if (types.length === 0) {
    return {
      ok: false,
      message:
        "생성 가능한 문제 유형을 선택해 주세요. (어법 선택, 어법 수정, T/F, 빈칸 채우기, 문장 순서 배열, 한줄해석, 통문장 영작, 어순배열 영작)",
    };
  }
  const unknown = (input.selectedTypes ?? []).filter(
    (t) => !READY_WORKBOOK_TYPE_IDS.includes(t) && t
  );
  if (unknown.length) {
    return {
      ok: false,
      message:
        "준비 중인 유형이 포함되어 있습니다. 준비된 유형만 선택해 주세요.",
    };
  }

  const wantTf = types.includes("tf");
  const wantBlank = types.includes("blank_fill");
  const wantGist = types.includes("gist_ko");
  const gistOptions: WorkbookGistOptions = {
    title: clampGistCount(input.gistOptions?.title ?? DEFAULT_WORKBOOK_GIST_OPTIONS.title),
    topic: clampGistCount(input.gistOptions?.topic ?? DEFAULT_WORKBOOK_GIST_OPTIONS.topic),
    gist: clampGistCount(input.gistOptions?.gist ?? DEFAULT_WORKBOOK_GIST_OPTIONS.gist),
  };
  // 어법 선택은 지문당 30~180초가 걸려 다른 유형과 한 요청에 묶으면 함수 실행시간
  // 상한을 넘긴다. 클라이언트가 generateGrammarChoicePassageAction으로 지문 단위로
  // 따로 호출할 때는 여기서 건너뛰고, 유형 선택 자체는 워크북 구조에 그대로 남긴다.
  const wantGrammarChoice =
    types.includes("grammar_choice") && input.deferGrammarChoice !== true;
  const wantSentenceOrder = types.includes("sentence_order");
  const wantLineKo = types.includes("one_line_ko");
  const wantFullEn = types.includes("full_en_writing");
  const wantFullWordOrder = types.includes("word_order_writing");
  // 중요문장 어순배열: 같은 어순배열 흐름을 주제문·핵심 문장에만 돌린다(2026-10-07)
  const wantKeyWordOrder = types.includes("key_word_order");
  const wantWordOrder = wantFullWordOrder || wantKeyWordOrder;
  const wantBilingual = wantLineKo || wantFullEn || wantWordOrder;
  const freeStoredLineSwitch =
    input.reuseStoredLineTranslations === true &&
    types.length === 1 &&
    wantLineKo &&
    input.forceRegenerate !== true;
  const lineTranslationExcludeIds = [
    ...new Set(
      (input.lineTranslationExcludeIds ?? [])
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];

  const tfOptions: WorkbookTfOptions = {
    count: clampTfCount(
      input.tfOptions?.count ?? DEFAULT_WORKBOOK_TF_OPTIONS.count
    ),
    language:
      input.tfOptions?.language === "ko"
        ? "ko"
        : DEFAULT_WORKBOOK_TF_OPTIONS.language,
    difficulty:
      input.tfOptions?.difficulty === "hard"
        ? "hard"
        : DEFAULT_WORKBOOK_TF_OPTIONS.difficulty,
  };

  const blankOptions: WorkbookBlankFillOptions = {
    hintType: parseBlankHintType(input.blankOptions?.hintType),
    showTranslation:
      input.blankOptions?.showTranslation === false ? false : true,
    translationLayout: parseBlankTranslationLayout(
      input.blankOptions?.translationLayout
    ),
    density: parseBlankDensity(input.blankOptions?.density),
  };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,source,lesson_pack_json,analysis_report_json,deleted_at")
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: projects, error: pErr } = await pq;
  if (pErr) return { ok: false, message: pErr.message };

  const byId = new Map((projects ?? []).map((p) => [p.id, p] as const));
  // 지문은 늘 폴더 차례로(선생님 2026-11-06: 교재·테스트지에서 지문 순서가 섞인다)
  const ordered = (await sortProjectIdsByPassageOrder(supabase, ids)).map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length === 0) {
    return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  }

  const passages: Array<{
    projectId: string;
    title: string;
    source: string | null;
    sentences: Array<{
      id: string;
      english: string;
      korean: string | null;
    }>;
    englishLines: string[];
    blankPool: StoredBlankCandidatePool | null;
    vocabLemmas: string[];
    vocab: LessonPackVocabItem[];
    sentenceTranslations: import("@/lib/lesson-materials/translation-meta").StoredSentenceTranslation[];
    packJson: Partial<LessonPackData>;
    wordOrderChunkCache: StoredWordOrderChunkCache | null;
    grammarChoiceCache: StoredGrammarChoiceCache | null;
    grammarBlueprintCache: import("@/lib/lesson-materials/grammar-blueprint-cache").StoredGrammarBlueprintCache | null;
    grammarChoiceV5Cache: StoredGrammarChoiceV5Cache | null;
    grammarChoiceV2Cache: StoredGrammarChoiceV2Cache | null;
    analysisReport: AnalysisReportData | null;
  }> = [];

  for (const p of ordered) {
    const { data: items, error: iErr } = await supabase
      .from("lesson_material_items")
      .select("id,english_text,korean_text,order_index")
      .eq("project_id", p!.id)
      .order("order_index", { ascending: true });
    if (iErr) return { ok: false, message: iErr.message };
    const sentences = (items ?? []).map((it, idx) => ({
      id: String(it.id ?? `s${idx}`),
      english: String(it.english_text ?? ""),
      korean: (it.korean_text as string | null) ?? null,
    }));
    const pack = (p!.lesson_pack_json ?? {}) as Partial<LessonPackData>;
    const analysisReport =
      (p as { analysis_report_json?: unknown }).analysis_report_json &&
      typeof (p as { analysis_report_json?: unknown }).analysis_report_json ===
        "object"
        ? ((p as { analysis_report_json: AnalysisReportData })
            .analysis_report_json as AnalysisReportData)
        : null;
    passages.push({
      projectId: p!.id,
      title: p!.title,
      source: (p!.source as string | null) ?? null,
      sentences,
      englishLines: sentences.map((s) => s.english),
      // 자료함에서 제작을 누른 경우(forceRegenerate)는 저장된 빈칸 후보·어순 청크도 쓰지 않고 새로 만든다.
      blankPool: input.forceRegenerate
        ? null
        : ((pack.blankCandidatePool as StoredBlankCandidatePool) ?? null),
      vocabLemmas: (pack.vocab ?? []).map((v) => v.word),
      vocab: pack.vocab ?? [],
      sentenceTranslations: pack.sentenceTranslations ?? [],
      packJson: pack,
      wordOrderChunkCache: input.forceRegenerate
        ? null
        : ((pack.wordOrderChunkCache as StoredWordOrderChunkCache) ?? null),
      grammarChoiceCache:
        (pack.grammarChoiceCache as StoredGrammarChoiceCache) ?? null,
      grammarBlueprintCache:
        (pack.grammarBlueprintCache as import("@/lib/lesson-materials/grammar-blueprint-cache").StoredGrammarBlueprintCache) ??
        null,
      grammarChoiceV5Cache:
        (pack.grammarChoiceV5Cache as StoredGrammarChoiceV5Cache) ?? null,
      grammarChoiceV2Cache:
        (pack.grammarChoiceV2Cache as StoredGrammarChoiceV2Cache) ?? null,
      analysisReport,
    });
  }
  const dataLoadMs = Date.now() - tLoad0;

  const now = new Date();
  const workbook: WorkbookData = {
    metadata: {
      title: input.title?.trim() || defaultWorkbookTitle(now),
      createdAt: now.toISOString(),
    },
    selectedTypes: types,
    tfOptions,
    blankOptions,
    sections: [],
    blankSections: [],
    grammarChoiceSections: [],
    grammarChoiceSkipped: [],
    sentenceOrderQuestions: [],
    sentenceOrderSkipped: [],
    lineTranslationSections: [],
    lineTranslationSkipped: [],
    gistSections: [],
    gistSkipped: [],
    fullEnWritingSections: [],
    fullEnWritingSkipped: [],
    wordOrderWritingSections: [],
    wordOrderWritingSkipped: [],
    keyWordOrderSections: [],
  };
  const workbookId = `${workbook.metadata.title}|${workbook.metadata.createdAt}`;
  /**
   * 모델 호출 기록에 학원·기능을 붙인다(2026-10-25). 전에는 T/F·해석·제목주제 호출이 기능 없이 남아
   * 원가를 기능별로 모을 수 없었고, 모아 두었다가 쓰는 기록이 응답 뒤에 끊겨 다섯 지문 중 둘이 빠졌다.
   */
  const usageCtx = (featureKey: string | null) => ({
    academyId: profile!.academy_id!,
    actorId: profile!.id,
    featureKey,
    usedFor: "workbook",
  });
  // 바깥 테두리: 따로 감싸지 않은 호출(한 줄 해석·전체 영작은 동기 함수라 못 감싼다)은 여기에 붙는다
  setAiUsage(usageCtx(wantBilingual ? LESSON_CREDIT_FEATURES.workbookLineTranslation : null));

  /*
   * 선생님 지적(2026-09-29): "API를 쓰는 곳은 모두 크레딧을 쓰도록 해야 해."
   * 한 줄 해석·전체 영작·제시어 배열 영작은 「값이 들지 않는 갈래」로 두었는데
   * 실제로는 모델을 부른다. 값을 먼저 잡아 두고 만든다.
   */
  const extraHolds: Array<{ amount: number; what: string }> = [];
  // 규칙으로만 만드는 유형도 유형마다 지문당 5(선생님 2026-10-28 「무료는 좀 그래」)
  const ruleTypes = types.filter((t) => WORKBOOK_RULE_TYPES.has(t));
  for (const [want, feature, what, per] of [
    [wantBilingual && !freeStoredLineSwitch, LESSON_CREDIT_FEATURES.workbookLineTranslation, "한 줄 해석·전체 영작", 1],
    [wantWordOrder, LESSON_CREDIT_FEATURES.workbookWordOrder, "제시어 배열 영작", 1],
    [wantGist, LESSON_CREDIT_FEATURES.workbookGist, "제목·주제·요지 해석", 1],
    [
      ruleTypes.length > 0,
      LESSON_CREDIT_FEATURES.workbookRuleType,
      ruleTypes.map((t) => WORKBOOK_TYPE_SHORT[t] ?? t).join("·"),
      ruleTypes.length,
    ],
  ] as const) {
    if (!want) continue;
    const hold = await reserveLessonCredits({
      academyId: profile!.academy_id!,
      actorId: profile!.id,
      featureKey: feature,
      quantity: passages.length * per,
      metadata: { used_for: "workbook" },
      note: `워크북 ${what} · 지문 ${passages.length}개`,
    });
    if (!hold.ok) {
      for (const h of extraHolds) {
        await refundLessonCredits({
          academyId: profile!.academy_id!,
          actorId: profile!.id,
          amount: h.amount,
          note: `워크북을 만들지 못해 되돌림 (${h.what})`,
        });
      }
      return { ok: false, message: hold.message };
    }
    extraHolds.push({ amount: hold.charged, what });
  }
  const giveBackExtras = async (why: string) => {
    for (const h of extraHolds) {
      await refundLessonCredits({
        academyId: profile!.academy_id!,
        actorId: profile!.id,
        amount: h.amount,
        note: `워크북 ${h.what}을 만들지 못해 되돌림 (${why})`,
      });
    }
    extraHolds.length = 0;
  };

  try {
    let openAiFromBlank = 0;
    let openAiFromGrammar = 0;

    if (wantGrammarChoice) {
      const selection = resolveGrammarChoiceEngineVersion();
      const engine = selection.version;
      const gc =
        engine === "v2"
          ? await generateWorkbookGrammarChoiceV2({
              forceRegenerate: input.forceRegenerate === true,
              passages: passages.map((p) => ({
                projectId: p.projectId,
                title: p.title,
                source: p.source,
                sentences: p.sentences,
                analysisReport: p.analysisReport,
                grammarChoiceV2Cache: input.forceRegenerate
                  ? null
                  : p.grammarChoiceV2Cache,
              })),
            })
          : await generateWorkbookGrammarChoice({
              forceRegenerate: input.forceRegenerate === true,
              passages: passages.map((p) => ({
                projectId: p.projectId,
                title: p.title,
                source: p.source,
                sentences: p.sentences,
                analysisReport: p.analysisReport,
                grammarChoiceV5Cache: input.forceRegenerate
                  ? null
                  : p.grammarChoiceV5Cache,
              })),
            });
      workbook.grammarChoiceSections = stampGrammarChoiceEngineDiagnostics(
        gc.sections,
        selection
      );
      workbook.grammarChoiceSkipped = gc.skipped;
      if (
        engine === "v2" &&
        process.env.GRAMMAR_CHOICE_ENGINE_COMPARE === "1"
      ) {
        const v1 = await generateWorkbookGrammarChoice({
          forceRegenerate: false,
          passages: passages.map((p) => ({
            projectId: p.projectId,
            title: p.title,
            source: p.source,
            sentences: p.sentences,
            analysisReport: p.analysisReport,
            grammarChoiceV5Cache: p.grammarChoiceV5Cache,
          })),
        });
        const note = `v2=${gc.sections.reduce((n, s) => n + s.items.length, 0)} v1=${v1.sections.reduce((n, s) => n + s.items.length, 0)}`;
        workbook.grammarChoiceSections = stampGrammarChoiceEngineDiagnostics(
          gc.sections,
          selection
        ).map((section) => ({
          ...section,
          diagnostics: section.diagnostics
            ? { ...section.diagnostics, staffCompareNote: note }
            : section.diagnostics,
        }));
      }
      openAiFromGrammar = gc.timing.openAiRequestCount;
      workbook.timing = {
        ...gc.timing,
        dataLoadMs,
        totalMs: dataLoadMs + gc.timing.totalMs,
        openAiRequestCount: openAiFromGrammar,
      };

      for (const { projectId, cache } of gc.cachesToSave) {
        const prev = (byId.get(projectId)?.lesson_pack_json ?? {}) as Partial<LessonPackData>;
        // 저장 직전에 다시 읽어 합친다(같은 지문의 다른 캐시를 되돌리지 않게).
        await patchLessonPack(supabase, projectId, prev,
          engine === "v2"
            ? { grammarChoiceV2Cache: cache as StoredGrammarChoiceV2Cache }
            : { grammarChoiceV5Cache: cache as StoredGrammarChoiceV5Cache }
        );
      }
    }

    /**
     * 유형별 생성은 서로 독립인데 하나씩 순서대로 기다리고 있었다.
     * 실측(4지문 35문장, 지문 병렬화 후): 빈칸 31초 + 어순배열 16초 + T/F 10초 = 57초.
     * 먼저 띄워 두면 합이 아니라 최댓값이 된다. 각 결과는 workbook의 서로 다른
     * 필드로 들어가므로 섞이지 않는다.
     *
     * 실패는 소비 지점에서 다시 던진다. 그대로 두면 아래 조기 반환 경로에서
     * 처리되지 않은 거부가 남는다.
     */
    const settle = <T,>(task: Promise<T>) =>
      task.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
    const unwrap = <T,>(
      row: { ok: true; value: T } | { ok: false; error: unknown }
    ): T => {
      if (row.ok) return row.value;
      throw row.error;
    };

    const bilingualEarly = wantBilingual
      ? generateWorkbookLineTranslation({
          passages: passages.map((p) => ({
            projectId: p.projectId,
            title: p.title,
            source: p.source,
            sentences: p.sentences,
            sentenceTranslations: p.sentenceTranslations,
          })),
          excludeProjectIds: lineTranslationExcludeIds,
        })
      : null;
    // T/F는 만들 때마다 새로 생성한다(지문당, 10문항을 넘으면 2배). 모자라면 시작하지 않는다.
    const tfCreditQty = passages.length * (tfOptions.count > 10 ? 2 : 1);
    // 값을 먼저 잡아 둔다 — 모자라면 만들지 않는다(잔액이 마이너스로 내려가지 않게).
    let tfHold = 0;
    if (wantTf) {
      const hold = await reserveLessonCredits({
        academyId: profile!.academy_id!,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.workbookTf,
        quantity: tfCreditQty,
        metadata: { used_for: "workbook" },
        note: `워크북 O/X · 지문 ${passages.length}개 · ${tfOptions.count}문항`,
      });
      if (!hold.ok) return { ok: false, message: hold.message };
      tfHold = hold.charged;
    }
    const blankTask = wantBlank
      ? settle(
          generateWorkbookBlankFill({
          passages: passages.map((p) => ({
            projectId: p.projectId,
            title: p.title,
            source: p.source,
            sentences: p.sentences,
            blankPool: p.blankPool,
            vocabLemmas: p.vocabLemmas,
            vocab: p.vocab,
            sentenceTranslations: p.sentenceTranslations,
          })),
          options: blankOptions,
          })
        )
      : null;
    const tfTask = wantTf
      ? settle(
          withAiUsage(usageCtx(LESSON_CREDIT_FEATURES.workbookTf), () =>
          generateWorkbookTf({
            title: workbook.metadata.title,
            passages: passages.map((p) => ({
              projectId: p.projectId,
              title: p.title,
              source: p.source,
              englishLines: p.englishLines,
            })),
            options: tfOptions,
          }))
        )
      : null;
    // 제목·주제·요지 해석: 지문당 한 번, 다른 갈래와 동시에(2026-10-24)
    const gistTask = wantGist
      ? settle(
          withAiUsage(usageCtx(LESSON_CREDIT_FEATURES.workbookGist), () =>
          generateWorkbookGist({
            passages: passages.map((p) => ({
              projectId: p.projectId,
              title: p.title,
              source: p.source,
              englishLines: p.englishLines,
            })),
            options: gistOptions,
          }))
        )
      : null;
    // 중요 문장: 분석서 「주제문」 → 빈칸 후보 핵심 문장 → 규칙 점수(새 모델 호출 없음)
    const keyIdsByProject = new Map(
      passages.map((p) => [
        p.projectId,
        new Set(
          pickKeySentenceIds({
            sentences: p.sentences,
            analysisSentences: p.analysisReport?.sentences ?? null,
            coreSentenceIds: (p.packJson.blankCandidatePool as StoredBlankCandidatePool | undefined)?.coreSentenceIds ?? null,
          })
        ),
      ])
    );
    const onlyKeySentences = <T extends { projectId: string; items: Array<{ sentenceId: string }> }>(sections: T[]): T[] =>
      sections
        .map((sec) => ({ ...sec, items: sec.items.filter((it) => keyIdsByProject.get(sec.projectId)?.has(it.sentenceId)) }))
        .filter((sec) => sec.items.length > 0);
    const wordOrderTask =
      wantWordOrder && bilingualEarly && bilingualEarly.blocking.length === 0
        ? settle(
            withAiUsage(usageCtx(LESSON_CREDIT_FEATURES.workbookWordOrder), () =>
            generateWorkbookWordOrderWriting({
                workbookId,
                passages: passages.map((p) => ({
                  projectId: p.projectId,
                  title: p.title,
                  source: p.source,
                  sentences: p.sentences,
                  sentenceTranslations: p.sentenceTranslations,
                  packJson: p.packJson,
                  wordOrderChunkCache: p.wordOrderChunkCache,
                })),
                // 어순배열 영작을 함께 고르지 않았으면 중요 문장만 만든다(청크 호출도 그만큼만)
                prebuiltLineSections: wantFullWordOrder
                  ? bilingualEarly.sections
                  : onlyKeySentences(bilingualEarly.sections),
                prebuiltSkipped: bilingualEarly.skipped,
                prebuiltBlocking: [],
            }))
          )
        : null;

    if (wantBlank) {
      const blankResult = unwrap(await blankTask!);
      workbook.blankSections = blankResult.sections;
      openAiFromBlank = blankResult.timing.openAiRequestCount;
      const prevOpenAi = workbook.timing?.openAiRequestCount ?? 0;
      workbook.timing = {
        ...blankResult.timing,
        dataLoadMs,
        totalMs:
          dataLoadMs +
          blankResult.timing.totalMs +
          (workbook.timing?.totalMs ?? dataLoadMs) -
          dataLoadMs,
        openAiRequestCount: prevOpenAi + openAiFromBlank,
      };

      // Persist newly generated pools for next time (0 OpenAI)
      for (const { projectId, pool } of blankResult.poolsToSave) {
        const prev = (byId.get(projectId)?.lesson_pack_json ?? {}) as Partial<LessonPackData>;
        // 생성 시작 때 읽은 옛 값으로 덮지 않게 저장 직전에 다시 읽어 합친다.
        await patchLessonPack(supabase, projectId, prev, {
          blankCandidatePool: pool,
          passageSourceHash: pool.sourceHash,
        });
      }

      if (blankResult.statusNotes.length && process.env.NODE_ENV !== "production") {
        console.info("[workbook-blank]", blankResult.statusNotes.join(" | "));
      }
      console.info(
        "[workbook-timing]",
        JSON.stringify({
          openAiRequestCount: openAiFromBlank,
          dataLoadMs,
          translationLookupMs: blankResult.timing.translationLookupMs,
          blankSelectionMs: blankResult.timing.blankSelectionMs,
          totalMs: workbook.timing.totalMs,
        })
      );
    }

    if (wantTf) {
      let tf;
      try {
        tf = unwrap(await tfTask!);
      } catch (e) {
        await refundLessonCredits({
          academyId: profile!.academy_id!,
          actorId: profile!.id,
          amount: tfHold,
          note: "O/X 문항을 만들지 못해 되돌림",
        });
        throw e;
      }
      workbook.sections = tf.sections;
      // TF still uses OpenAI — timing note only for blank path when TF absent
      if (workbook.timing && !wantBlank) {
        workbook.timing.openAiRequestCount = passages.length;
      }
    }

    if (wantGist) {
      // 던지면 바깥 catch가 잡아 둔 값을 되돌린다. T/F 값은 T/F 쪽에서 따로 잡아 여기서 같이 되돌린다.
      let gist;
      try {
        gist = unwrap(await gistTask!);
        if (gist.sections.length === 0) {
          throw new Error(
            `제목·주제·요지를 만들지 못했습니다. ${gist.skipped[0]?.reason ?? ""}`.trim()
          );
        }
      } catch (e) {
        if (tfHold > 0) {
          await refundLessonCredits({
            academyId: profile!.academy_id!,
            actorId: profile!.id,
            amount: tfHold,
            note: "제목·주제·요지를 만들지 못해 O/X 값 되돌림",
          });
          tfHold = 0;
        }
        throw e;
      }
      workbook.gistSections = gist.sections;
      workbook.gistSkipped = gist.skipped;
      workbook.gistOptions = gistOptions;
    }

    if (wantSentenceOrder) {
      const so = generateWorkbookSentenceOrder({
        workbookId,
        passages: passages.map((p) => ({
          projectId: p.projectId,
          title: p.title,
          source: p.source,
          sentences: p.sentences,
        })),
      });
      workbook.sentenceOrderQuestions = so.questions;
      workbook.sentenceOrderSkipped = so.skipped;
      if (!workbook.timing) {
        workbook.timing = {
          dataLoadMs,
          translationLookupMs: 0,
          blankSelectionMs: 0,
          pdfRenderMs: 0,
          totalMs: dataLoadMs,
          openAiRequestCount: 0,
        };
      }
      if (wantSentenceOrder && !wantBlank && !wantTf) {
        workbook.timing.openAiRequestCount = 0;
      }
    }

    if (wantBilingual) {
      const bilingual = bilingualEarly!;

      if (bilingual.blocking.length > 0) {
        const message = bilingual.blocking.map((b) => b.reason).join("\n");
        return {
          ok: false,
          message:
            message ||
            "저장된 한글 해석이 없거나 영어 원문이 변경되었습니다. 수업용자료에서 해석을 확인해 주세요.",
          code: "MISSING_LINE_TRANSLATION",
          lineTranslationExcludeIds: bilingual.blocking.map((b) => b.projectId),
        };
      }

      const skipped = bilingual.skipped.map((s) => ({
        projectId: s.projectId,
        title: s.title,
        reason: s.reason,
      }));

      if (wantLineKo) {
        workbook.lineTranslationSections = bilingual.sections;
        workbook.lineTranslationSkipped = skipped;
      }
      if (wantFullEn) {
        workbook.fullEnWritingSections =
          mapLineTranslationToFullEnWriting(bilingual.sections);
        workbook.fullEnWritingSkipped = skipped;
      }
      if (wantWordOrder) {
        const wo = unwrap(await wordOrderTask!);
        if (wantFullWordOrder) {
          workbook.wordOrderWritingSections = wo.sections;
          workbook.wordOrderWritingSkipped = skipped;
        }
        // 중요 문장은 지문마다 1번부터 다시 번호를 붙인다(원문 문장 번호가 듬성듬성 찍히지 않게)
        if (wantKeyWordOrder) {
          workbook.keyWordOrderSections = onlyKeySentences(wo.sections).map((sec) => ({
            ...sec,
            items: sec.items.map((it, i) => ({ ...it, orderIndex: i + 1 })),
          }));
        }

        for (const { projectId, cache } of wo.cachesToSave) {
          const prev = (byId.get(projectId)?.lesson_pack_json ?? {}) as Partial<LessonPackData>;
          // 빈칸 후보 저장을 되돌리지 않게 저장 직전에 다시 읽어 합친다.
          await patchLessonPack(supabase, projectId, prev, { wordOrderChunkCache: cache });
        }

        if (!workbook.timing) {
          workbook.timing = {
            dataLoadMs,
            translationLookupMs: 0,
            blankSelectionMs: 0,
            pdfRenderMs: 0,
            totalMs: dataLoadMs,
            openAiRequestCount: wo.openAiRequestCount,
          };
        } else {
          workbook.timing.openAiRequestCount =
            (workbook.timing.openAiRequestCount ?? 0) + wo.openAiRequestCount;
        }
      }

      if (!workbook.timing) {
        workbook.timing = {
          dataLoadMs,
          translationLookupMs: 0,
          blankSelectionMs: 0,
          pdfRenderMs: 0,
          totalMs: dataLoadMs,
          openAiRequestCount: 0,
        };
      }
      if (!wantBlank && !wantTf && !wantWordOrder) {
        workbook.timing.openAiRequestCount = 0;
      }
    }

    if (
      wantGrammarChoice &&
      (workbook.grammarChoiceSections?.length ?? 0) === 0
    ) {
      return {
        ok: false,
        message: "어법 선택 문항을 만들지 못했습니다. 다시 시도해 주세요.",
      };
    }
    if (wantBlank && workbook.blankSections.length === 0) {
      return { ok: false, message: "빈칸 채우기 결과를 만들지 못했습니다." };
    }
    if (wantTf && workbook.sections.length === 0) {
      return { ok: false, message: "T/F 결과를 만들지 못했습니다." };
    }
    if (
      wantSentenceOrder &&
      (workbook.sentenceOrderQuestions?.length ?? 0) === 0
    ) {
      const detail =
        workbook.sentenceOrderSkipped
          ?.map((s) => `「${s.title}」 ${s.reason}`)
          .join(" ") ?? SENTENCE_ORDER_SKIP_TOO_FEW;
      return {
        ok: false,
        message: detail || "문장 순서 배열 결과를 만들지 못했습니다.",
      };
    }
    if (
      wantLineKo &&
      (workbook.lineTranslationSections?.length ?? 0) === 0
    ) {
      return {
        ok: false,
        message:
          "한줄해석 결과를 만들지 못했습니다. 해석이 있는 지문을 선택해 주세요.",
      };
    }
    if (
      wantFullEn &&
      (workbook.fullEnWritingSections?.length ?? 0) === 0
    ) {
      return {
        ok: false,
        message:
          "통문장 영작 결과를 만들지 못했습니다. 해석이 있는 지문을 선택해 주세요.",
      };
    }
    if (
      wantKeyWordOrder &&
      (workbook.keyWordOrderSections?.length ?? 0) === 0
    ) {
      return {
        ok: false,
        message:
          "중요문장 어순배열 결과를 만들지 못했습니다. 해석이 있는 지문을 선택해 주세요.",
      };
    }
    if (
      wantFullWordOrder &&
      (workbook.wordOrderWritingSections?.length ?? 0) === 0
    ) {
      return {
        ok: false,
        message:
          "어순배열 영작 결과를 만들지 못했습니다. 해석이 있는 지문을 선택해 주세요.",
      };
    }

    await flushAiUsage();
    return { ok: true, workbook };
  } catch (e) {
    await giveBackExtras("만들기 실패");
    await flushAiUsage();
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code)
        : undefined;
    return {
      ok: false,
      message: e instanceof Error ? e.message : "워크북 생성 실패",
      ...(code === "MISSING_TRANSLATION"
        ? { code: "MISSING_TRANSLATION" as const }
        : code === "MISSING_LINE_TRANSLATION"
          ? { code: "MISSING_LINE_TRANSLATION" as const }
          : {}),
    };
  }
}

/**
 * 지문 한 개의 어법 선택만 생성한다.
 *
 * generateWorkbookAction은 모든 지문·모든 유형을 한 요청 안에서 순차 처리하기
 * 때문에, 지문이 늘어나면 서버리스 함수 실행시간 상한을 넘겨 통째로 실패한다.
 * 실패하면 이미 끝난 지문의 분석 결과(호출당 30~180초)도 저장되지 못하고 버려진다.
 * 지문 단위로 나눠 호출하면 요청 하나가 짧아지고, 끝난 지문은 즉시 캐시에 남아
 * 재시도가 싸진다. 클라이언트가 지문 수만큼 순차 호출하며 진행률을 표시한다.
 */
export async function generateGrammarChoicePassageAction(
  role: Role,
  input: {
    projectId: string;
    forceRegenerate?: boolean;
    /** 어느 화면에서 부른 것인지 — 크레딧 내역에 그대로 적는다 */
    usedIn?: "workbook" | "one_page_test" | "test_book";
  }
): Promise<
  | {
      ok: true;
      section: WorkbookGrammarChoiceSection | null;
      skipped: WorkbookGrammarChoiceSkip | null;
      openAiRequestCount: number;
    }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "선택된 자료가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,source,lesson_pack_json,analysis_report_json,deleted_at")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: projects, error: pErr } = await pq;
  if (pErr) return { ok: false, message: pErr.message };
  const project = (projects ?? [])[0];
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", project.id)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };

  const sentences = (items ?? []).map((it, idx) => ({
    id: String(it.id ?? `s${idx}`),
    english: String(it.english_text ?? ""),
  }));
  const pack = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const analysisReport =
    (project as { analysis_report_json?: unknown }).analysis_report_json &&
    typeof (project as { analysis_report_json?: unknown })
      .analysis_report_json === "object"
      ? ((project as { analysis_report_json: AnalysisReportData })
          .analysis_report_json as AnalysisReportData)
      : null;

  const forceRegenerate = input.forceRegenerate === true;
  /*
   * 새로 만들 때만 크레딧을 쓴다(저장된 문항을 다시 쓰면 0).
   * 값을 먼저 잡아 두고 만든다 — 모자라면 여기서 멈춘다. 만들다 실패하면 되돌린다.
   */
  const usedFor = input.usedIn === "one_page_test" || input.usedIn === "test_book" ? input.usedIn : "workbook";
  const hold = await reserveLessonCredits({
    academyId: profile!.academy_id!,
    actorId: profile!.id,
    featureKey: LESSON_CREDIT_FEATURES.workbookGrammarChoice,
    projectId: project.id,
    metadata: { used_for: usedFor },
    note: `${usedFor === "one_page_test" ? "1장 테스트지" : usedFor === "test_book" ? "테스트 교재" : "워크북"} 어법 선택 · ${project.title}`,
  });
  if (!hold.ok) return { ok: false, message: hold.message };
  const giveBack = (why: string) =>
    refundLessonCredits({
      academyId: profile!.academy_id!,
      actorId: profile!.id,
      amount: hold.charged,
      note: `어법 선택을 만들지 못해 되돌림 (${why})`,
    });
  const selection = resolveGrammarChoiceEngineVersion();
  const engine = selection.version;

  try {
    const passage = {
      projectId: project.id,
      title: project.title,
      source: (project.source as string | null) ?? null,
      sentences,
      analysisReport,
    };
    const gc = await withAiUsage(
      {
        academyId: profile!.academy_id,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.workbookGrammarChoice,
        usedFor,
        projectId: project.id as string,
      },
      async () =>
      engine === "v2"
        ? await generateWorkbookGrammarChoiceV2({
            forceRegenerate,
            passages: [
              {
                ...passage,
                grammarChoiceV2Cache: forceRegenerate
                  ? null
                  : ((pack.grammarChoiceV2Cache as StoredGrammarChoiceV2Cache) ??
                    null),
              },
            ],
          })
        : await generateWorkbookGrammarChoice({
            forceRegenerate,
            passages: [
              {
                ...passage,
                grammarChoiceV5Cache: forceRegenerate
                  ? null
                  : ((pack.grammarChoiceV5Cache as StoredGrammarChoiceV5Cache) ??
                    null),
              },
            ],
          })
    );
    await flushAiUsage();

    // 이 지문이 끝나는 즉시 캐시에 남긴다. 뒤 지문이 실패해도 다시 만들지 않는다.
    for (const { cache } of gc.cachesToSave) {
      // 어휘 선택이 같은 지문에 동시에 캐시를 저장할 수 있어, 저장 직전에 다시 읽어 합친다.
      await patchLessonPack(supabase, project.id, pack,
        engine === "v2"
          ? { grammarChoiceV2Cache: cache as StoredGrammarChoiceV2Cache }
          : { grammarChoiceV5Cache: cache as StoredGrammarChoiceV5Cache }
      );
    }

    // 저장된 문항을 그대로 쓴 경우(새로 부르지 않음)에는 잡아 둔 값을 돌려준다.
    if (gc.timing.openAiRequestCount === 0) await giveBack("저장된 문항을 그대로 씀");
    const stamped = stampGrammarChoiceEngineDiagnostics(gc.sections, selection);
    return {
      ok: true,
      section: stamped[0] ?? null,
      skipped: gc.skipped[0] ?? null,
      openAiRequestCount: gc.timing.openAiRequestCount,
    };
  } catch (e) {
    await giveBack("만들기 실패");
    return {
      ok: false,
      message: e instanceof Error ? e.message : "어법 선택 생성 실패",
    };
  }
}

/**
 * 지문 하나의 어휘 선택 재료를 만든다(어휘 수정도 이것으로 만든다). 어법 선택처럼
 * 브라우저가 지문마다 따로 부른다(/api/lesson-materials/vocab-choice).
 */
export async function generateVocabChoicePassageAction(
  role: Role,
  input: {
    projectId: string;
    forceRegenerate?: boolean;
    /** 어느 화면에서 부른 것인지 — 크레딧 내역에 그대로 적는다 */
    usedIn?: "workbook" | "one_page_test";
    /** 낱말 수준. 없으면 예전 방식(난이도 UP과 같다). */
    wordLevel?: "normal" | "hard";
    /** 저장된 짝으로만 다시 고른다 — 모델을 부르지 않으므로 크레딧을 잡지 않는다. */
    cacheOnly?: boolean;
  }
): Promise<
  | {
      ok: true;
      section: WorkbookVocabChoiceSection | null;
      skipped: WorkbookGrammarChoiceSkip | null;
    }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "선택된 자료가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,source,lesson_pack_json,deleted_at")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: projects, error: pErr } = await pq;
  if (pErr) return { ok: false, message: pErr.message };
  const project = (projects ?? [])[0];
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,order_index")
    .eq("project_id", project.id)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };

  const sentences = (items ?? []).map((it, idx) => ({
    id: String(it.id ?? `s${idx}`),
    english: String(it.english_text ?? ""),
  }));
  const pack = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  // 빈칸 후보(핵심 어휘)와 단어장(반의어)을 자리·오답의 참고로 준다.
  const hints = [
    ...((pack.blankCandidatePool as StoredBlankCandidatePool | null | undefined)?.candidates ?? [])
      .slice()
      .sort((a, b) => (b.finalScore ?? b.priority ?? 0) - (a.finalScore ?? a.priority ?? 0))
      .slice(0, 16)
      .map((c) => ({ word: c.answerText, meaningKo: c.meaningKo })),
    ...(pack.vocab ?? []).map((v) => ({
      word: v.word,
      meaningKo: v.meaning,
      antonyms: v.antonyms ?? [],
    })),
  ];

  if (input.cacheOnly) {
    const result = await generateVocabChoiceForPassage({
      projectId: project.id,
      title: project.title,
      source: (project.source as string | null) ?? null,
      sentences,
      hints,
      cache: (pack.vocabChoiceCache as StoredVocabChoiceCache | null | undefined) ?? null,
      wordLevel: input.wordLevel,
      cacheOnly: true,
    });
    return {
      ok: true,
      section: result.section,
      skipped: result.section
        ? null
        : { projectId: project.id, title: project.title, reason: result.reason ?? "어휘 문항을 만들지 못했습니다." },
    };
  }

  const usedFor = input.usedIn === "one_page_test" ? "one_page_test" : "workbook";
  const hold = await reserveLessonCredits({
    academyId: profile!.academy_id!,
    actorId: profile!.id,
    featureKey: LESSON_CREDIT_FEATURES.workbookVocabChoice,
    projectId: project.id,
    metadata: { used_for: usedFor },
    note: `${usedFor === "one_page_test" ? "1장 테스트지" : "워크북"} 어휘 선택 · ${project.title}`,
  });
  if (!hold.ok) return { ok: false, message: hold.message };
  const giveBack = (why: string) =>
    refundLessonCredits({
      academyId: profile!.academy_id!,
      actorId: profile!.id,
      amount: hold.charged,
      note: `어휘 선택을 만들지 못해 되돌림 (${why})`,
    });

  try {
    const result = await withAiUsage(
      {
        academyId: profile!.academy_id,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.workbookVocabChoice,
        usedFor,
        projectId: project.id as string,
      },
      () =>
        generateVocabChoiceForPassage({
      projectId: project.id,
      title: project.title,
      source: (project.source as string | null) ?? null,
      sentences,
      hints,
      cache: (pack.vocabChoiceCache as StoredVocabChoiceCache | null | undefined) ?? null,
          forceRegenerate: input.forceRegenerate === true,
          wordLevel: input.wordLevel,
        })
    );
    await flushAiUsage();
    if (result.cacheToSave) {
      await patchLessonPack(supabase, project.id, pack, {
        vocabChoiceCache: result.cacheToSave,
      });
    } else {
      // 저장본을 그대로 썼다(새로 만들지 않았다) — 잡아 둔 값을 돌려준다.
      await giveBack("저장된 문항을 그대로 씀");
    }
    return {
      ok: true,
      section: result.section,
      skipped: result.section
        ? null
        : {
            projectId: project.id,
            title: project.title,
            reason: result.reason ?? "어휘 문항을 만들지 못했습니다.",
          },
    };
  } catch (e) {
    await giveBack("만들기 실패");
    return {
      ok: false,
      message: e instanceof Error ? e.message : "어휘 선택 생성 실패",
    };
  }
}
