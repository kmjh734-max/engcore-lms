/**
 * 수업용 자료 단어 목록·해석 만들기(서버 액션이 아닌 안쪽 함수). 서버 액션은 lesson-pack-actions.ts가 감싼다 —
 * 값을 건너뛰는 charge=false를 화면에서 부를 수 없게 여기 둔다.
 */
import {
  debitLessonCredits,
  LESSON_CREDIT_FEATURES,
  lessonCreditShortfall,
} from "@/lib/credits/lesson-credits";
import { setAiUsage } from "@/lib/ai-usage/context";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  generateLessonPackVocab,
  type LessonPackData,
  type LessonPackVocabItem,
} from "@/lib/lesson-materials/generate-lesson-pack";
import { generateLessonMaterialsOrganizationDraft } from "@/lib/lesson-materials/generate-organization";
import {
  buildStoredTranslation,
  needsTranslationRefresh,
  translatePassageSentences,
} from "@/lib/lesson-materials/translate-lines";
import { callBlankOpenAI } from "@/lib/lesson-materials/generate-workbook-blank";
import { buildBlankCandidatesFromVocab } from "@/lib/lesson-materials/build-blank-candidates-from-vocab";
import {
  validateBlankCandidates,
} from "@/lib/lesson-materials/validate-workbook-blank";
import {
  BLANK_POOL_ALGORITHM_VERSION,
  computePassageSourceHash,
  isBlankPoolFresh,
  type StoredBlankCandidatePool,
} from "@/lib/lesson-materials/workbook-blank-cache";
import {
  computeSentenceSourceHash,
  readTranslationMeta,
  type StoredSentenceTranslation,
} from "@/lib/lesson-materials/translation-meta";
import { formatWorkbookPassage } from "@/lib/lesson-materials/workbook-types";

type Role = "admin" | "teacher";

export async function requireLessonPackRole(role: Role) {
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

export async function generateAndSaveLessonPackVocab(
  role: Role,
  input: { projectId: string },
  /** false: 부르는 쪽이 값을 따로 받는다(수업용 자료 재료 — 한 번만 받게, 선생님 2026-10-26) */
  charge: boolean,
  /** 단어장만 만들 때: 워크북 빈칸 후보(gpt-5.6, 지문당 ~50초)는 건너뛴다 — 워크북이 없으면 그때 만든다(2026-11-11) */
  opts: { skipBlankPool?: boolean } = {}
): Promise<
  | {
      ok: true;
      vocab: LessonPackVocabItem[];
      headerLabel: string;
      titleEn: string | null;
    }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireLessonPackRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,title_en,lesson_pack_json")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: project, error: pErr } = await pq.maybeSingle();
  if (pErr || !project) {
    return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  }

  // 수업용 자료는 새로 만들 때마다 크레딧을 쓴다. 모자라면 만들지 않고 안내한다.
  if (charge) {
    const shortfall = await lessonCreditShortfall(profile!.academy_id!, LESSON_CREDIT_FEATURES.lessonPack);
    if (shortfall) return { ok: false, message: shortfall };
  }

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };

  setAiUsage({
    academyId: profile!.academy_id,
    actorId: profile!.id,
    featureKey: LESSON_CREDIT_FEATURES.lessonPack,
    usedFor: "lesson_pack",
    projectId,
  });

  const prevPack = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const metaMap = readTranslationMeta(prevPack);

  // Fill missing / incomplete Korean — never overwrite teacher edits.
  const needTr = (items ?? []).filter((it) => {
    const id = String(it.id);
    const en = String(it.english_text ?? "");
    const meta = metaMap.get(id);
    if (meta?.translationSource === "teacher") return false;
    // 저장된 해석이 옛 영어 문장의 것이면(문장을 고친 뒤) 다시 번역한다 — 그대로 두면
    // 워크북이 「저장된 해석이 현재 영어 원문과 일치하지 않습니다」로 막힌다.
    if (meta?.sourceHash && meta.sourceHash !== computeSentenceSourceHash(en)) {
      return true;
    }
    if (meta?.translationSource === "generated") {
      const hash = computeSentenceSourceHash(en);
      if (meta.sourceHash === hash && String(it.korean_text ?? "").trim()) {
        // Still refresh if heuristic says incomplete (legacy bad AI output)
        return needsTranslationRefresh(en, it.korean_text as string | null);
      }
    }
    return needsTranslationRefresh(en, it.korean_text as string | null);
  });

  let sentenceTranslations: StoredSentenceTranslation[] = [
    ...(prevPack.sentenceTranslations ?? []),
  ];

  if (needTr.length > 0) {
    try {
      const translated = await translatePassageSentences({
        passageId: projectId,
        sentences: needTr.map((it, idx) => ({
          sentenceId: String(it.id),
          order: Number(it.order_index ?? idx) + 1,
          english: String(it.english_text ?? ""),
        })),
      });
      const byId = new Map(
        translated.map((t) => [t.sentenceId, t.koreanTranslation] as const)
      );
      for (const row of needTr) {
        const ko = byId.get(String(row.id)) ?? "";
        if (!ko) continue;
        await supabase
          .from("lesson_material_items")
          .update({ korean_text: ko, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        row.korean_text = ko;
        const stored = buildStoredTranslation({
          sentenceId: String(row.id),
          order: Number(row.order_index ?? 0) + 1,
          english: String(row.english_text ?? ""),
          koreanTranslation: ko,
          translationSource: "generated",
        });
        sentenceTranslations = [
          ...sentenceTranslations.filter((t) => t.sentenceId !== stored.sentenceId),
          stored,
        ];
      }
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error
            ? `일부 문장의 해석을 생성하지 못했습니다. 실패한 문장만 다시 시도할 수 있습니다. ${e.message}`
            : "일부 문장의 해석을 생성하지 못했습니다. 실패한 문장만 다시 시도할 수 있습니다.",
      };
    }
  }

  // Ensure meta exists for sentences that already have korean (legacy)
  for (const it of items ?? []) {
    const id = String(it.id);
    const en = String(it.english_text ?? "");
    const ko = String(it.korean_text ?? "").trim();
    if (!en || !ko) continue;
    const existing = sentenceTranslations.find((t) => t.sentenceId === id);
    // 교사가 고친 해석은 다시 번역하지 않으므로, 영어가 바뀌었으면 지금 해석으로 영어만 맞춘다.
    if (
      existing &&
      (existing.translationSource !== "teacher" ||
        existing.sourceHash === computeSentenceSourceHash(en))
    ) {
      continue;
    }
    sentenceTranslations = [
      ...sentenceTranslations.filter((t) => t.sentenceId !== id),
      buildStoredTranslation({
        sentenceId: id,
        order: Number(it.order_index ?? 0) + 1,
        english: en,
        koreanTranslation: ko,
        translationSource: existing?.translationSource ?? "legacy",
      }),
    ];
  }

  const english = (items ?? []).map((it) => it.english_text).join("\n");
  const korean = (items ?? [])
    .map((it) => it.korean_text ?? "")
    .filter(Boolean)
    .join("\n");

  try {
    const vocab = await generateLessonPackVocab({
      englishPassage: english,
      koreanPassage: korean,
      title: project.title,
    });
    const prev = prevPack;

    const sentences = (items ?? []).map((it, idx) => ({
      id: String(it.id ?? `s${idx}`),
      english: formatWorkbookPassage(String(it.english_text ?? "")),
    })).filter((s) => s.english);
    const sourceHash = computePassageSourceHash(sentences.map((s) => s.english));
    let blankCandidatePool: StoredBlankCandidatePool | null =
      (prev.blankCandidatePool as StoredBlankCandidatePool) ?? null;

    if (!opts.skipBlankPool && !isBlankPoolFresh(blankCandidatePool, projectId, sourceHash) && sentences.length) {
      try {
        const vocabSet = new Set(vocab.map((v) => v.word.toLowerCase()));
        let raw = await callBlankOpenAI({
          passageId: projectId,
          title: project.title,
          targetCount: 22,
          maxPerSentence: 3,
          sentences,
          existingVocabulary: vocab.map((v) => ({
            word: v.word,
            lemma: v.word,
            meaningKo: v.meaning,
          })),
        }).then((r) => r.candidates).catch(async () => {
          return buildBlankCandidatesFromVocab({
            sentences,
            vocab,
            titleText: project.title,
            maxCandidates: 22,
          });
        });
        // Prefer AI; if AI returned empty, fall back
        if (!Array.isArray(raw) || raw.length < 8) {
          const fromVocab = buildBlankCandidatesFromVocab({
            sentences,
            vocab,
            titleText: project.title,
            maxCandidates: 22,
          });
          if (fromVocab.length > (raw?.length ?? 0)) raw = fromVocab;
        }
        const { valid, coreSentenceIds } = validateBlankCandidates({
          passageId: projectId,
          responsePassageId: projectId,
          sentences,
          generatedCandidates: raw,
          recommendedCount: 32,
          density: "high",
          vocabLemmas: vocabSet,
          titleText: project.title,
        });
        if (valid.length) {
          blankCandidatePool = {
            passageId: projectId,
            sourceHash,
            algorithmVersion: BLANK_POOL_ALGORITHM_VERSION,
            createdAt: new Date().toISOString(),
            coreSentenceIds,
            candidates: valid
              .sort((a, b) => {
                if (a.grade !== b.grade) return a.grade === "A" ? -1 : 1;
                return b.finalScore - a.finalScore;
              })
              .slice(0, 48)
              .map((c) => ({
                sentenceId: c.sentenceId,
                answerText: c.answerText,
                occurrenceIndex: c.occurrenceIndex,
                lemma: c.lemma,
                partOfSpeech: c.partOfSpeech,
                meaningKo: c.meaningKo,
                priority: c.priority,
                conceptScore: c.finalScore ?? c.conceptScore,
                selectionReasonKo: c.selectionReasonKo,
                wordFamily: c.wordFamily,
                semanticRole: c.semanticRole,
                competitionGroup: c.competitionGroup,
                scores: c.scores,
                finalScore: c.finalScore,
                grade: c.grade,
              })),
          };
        }
      } catch {
        // Best-effort; vocab still saves
      }
    }

    const pack: LessonPackData = {
    // 목록에 없는 캐시(어법·어휘·어순배열)가 저장할 때 지워지지 않게 먼저 펼친다.
    ...prev,
      headerLabel: prev.headerLabel || "26년도 1학기 중간고사 대비",
      vocab,
      updatedAt: new Date().toISOString(),
      blankCandidatePool,
      passageSourceHash: sourceHash,
      sentenceTranslations,
      vocabAntonymChecked: true,
    };

    let titleEn = ((project.title_en as string | null) ?? "").trim() || null;
    if (!titleEn && (items ?? []).length > 0) {
      try {
        const org = await generateLessonMaterialsOrganizationDraft({
          items: (items ?? []).map((it) => ({
            english: it.english_text,
            korean: it.korean_text,
          })),
        });
        titleEn = org.passageTitleEn?.trim() || null;
      } catch {
        // title backfill is best-effort; vocab save still proceeds
      }
    }

    const patch: Record<string, unknown> = {
      lesson_pack_json: pack,
      updated_at: new Date().toISOString(),
    };
    if (titleEn) patch.title_en = titleEn;

    const { error: uErr } = await supabase
      .from("lesson_material_projects")
      .update(patch)
      .eq("id", projectId);
    if (uErr) return { ok: false, message: uErr.message };
    if (charge) {
      await debitLessonCredits({
        academyId: profile!.academy_id!,
        actorId: profile!.id,
        featureKey: LESSON_CREDIT_FEATURES.lessonPack,
        projectId,
        note: `수업용 자료 · ${project.title}`,
      });
    }

    revalidatePath(`/${role}/lesson-materials`);
    revalidatePath(`/${role}/lesson-materials/lesson-pack`);
    revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
    return {
      ok: true,
      vocab,
      headerLabel: pack.headerLabel,
      titleEn: titleEn ?? ((project.title_en as string | null) ?? null),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "어휘 생성 실패",
    };
  }
}
