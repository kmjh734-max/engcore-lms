"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  vocabNeedsAntonymRefresh,
  type LessonPackData,
  type LessonPackVocabItem,
} from "@/lib/lesson-materials/generate-lesson-pack";
import { generateLessonMaterialsOrganizationDraft } from "@/lib/lesson-materials/generate-organization";
import {
  buildStoredTranslation,
  translatePassageSentences,
} from "@/lib/lesson-materials/translate-lines";

import {
  readTranslationMeta,
} from "@/lib/lesson-materials/translation-meta";

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

import { generateAndSaveLessonPackVocab } from "@/lib/lesson-materials/lesson-pack-vocab";

export async function generateAndSaveLessonPackVocabAction(role: Role, input: { projectId: string }) {
  return generateAndSaveLessonPackVocab(role, input, true);
}

export { vocabNeedsAntonymRefresh };

/** Backfill English title only (does not regenerate vocab/analysis cards). */
export async function ensureLessonMaterialTitleEnAction(
  role: Role,
  input: { projectId: string }
): Promise<
  | { ok: true; titleEn: string; title: string }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,title,title_en")
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

  const existingEn = ((project.title_en as string | null) ?? "").trim();
  if (existingEn) {
    return {
      ok: true,
      titleEn: existingEn,
      title: String(project.title ?? ""),
    };
  }

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };
  if (!items?.length) {
    return { ok: false, message: "지문 문장이 없어 제목을 만들 수 없습니다." };
  }

  try {
    const org = await generateLessonMaterialsOrganizationDraft({
      items: items.map((it) => ({
        english: it.english_text,
        korean: it.korean_text,
      })),
    });
    const titleEn = org.passageTitleEn?.trim() || "";
    if (!titleEn) {
      return { ok: false, message: "영어 제목을 만들지 못했습니다." };
    }

    const patch: Record<string, unknown> = {
      title_en: titleEn,
      updated_at: new Date().toISOString(),
    };
    // Keep existing Korean title; only fill if somehow empty
    const title = String(project.title ?? "").trim() || org.passageTitle;

    const { error: uErr } = await supabase
      .from("lesson_material_projects")
      .update(patch)
      .eq("id", projectId);
    if (uErr) return { ok: false, message: uErr.message };

    revalidatePath(`/${role}/lesson-materials`);
    revalidatePath(`/${role}/lesson-materials/lesson-pack`);
    revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
    return { ok: true, titleEn, title };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "영어 제목 생성 실패",
    };
  }
}

export async function saveLessonPackAction(
  role: Role,
  input: {
    projectId: string;
    headerLabel?: string;
    vocab: LessonPackVocabItem[];
    title?: string | null;
    titleEn?: string | null;
    source?: string | null;
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,lesson_pack_json")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    pq = pq.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: existing, error: readErr } = await pq.maybeSingle();
  // 이전 값을 못 읽었으면 쓰지 않는다 — 빈 값으로 덮어써 어법·어휘 캐시·문장 해석이 날아갔다(2026-11-28 점검)
  if (readErr) return { ok: false, message: "저장하지 못했어요. 잠시 뒤 다시 저장해 주세요." };
  if (!existing) return { ok: false, message: "자료를 찾을 수 없어요. 휴지통에 있는지 확인해 주세요." };
  const prev = (existing.lesson_pack_json ?? {}) as Partial<LessonPackData>;

  const pack: LessonPackData = {
    // 목록에 없는 캐시(어법·어휘·어순배열)가 저장할 때 지워지지 않게 먼저 펼친다.
    ...prev,
    headerLabel: (input.headerLabel ?? "26년도 1학기 중간고사 대비").trim(),
    vocab: input.vocab,
    updatedAt: new Date().toISOString(),
    blankCandidatePool: prev.blankCandidatePool ?? null,
    passageSourceHash: prev.passageSourceHash,
    sentenceTranslations: prev.sentenceTranslations,
    vocabAntonymChecked: true,
  };

  const patch: Record<string, unknown> = {
    lesson_pack_json: pack,
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) {
    const t = input.title?.trim();
    if (t) patch.title = t;
  }
  if (input.titleEn !== undefined) {
    patch.title_en = input.titleEn?.trim() || null;
  }
  if (input.source !== undefined) {
    patch.source = input.source?.trim() || null;
  }

  let q = supabase
    .from("lesson_material_projects")
    .update(patch)
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!);
  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { error: uErr } = await q;
  if (uErr) return { ok: false, message: uErr.message };

  revalidatePath(`/${role}/lesson-materials/lesson-pack`);
  revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true };
}

/** Regenerate AI translations (skips teacher-edited by default). */
export async function regenerateLessonPackTranslationsAction(
  role: Role,
  input: {
    projectId: string;
    /** When true, also overwrite teacher-edited rows */
    includeTeacher?: boolean;
  }
): Promise<
  | { ok: true; regenerated: number; skippedTeacher: number }
  | { ok: false; message: string }
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const supabase = await createClient();
  let pq = supabase
    .from("lesson_material_projects")
    .select("id,lesson_pack_json")
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

  const { data: items, error: iErr } = await supabase
    .from("lesson_material_items")
    .select("id,english_text,korean_text,order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (iErr) return { ok: false, message: iErr.message };

  const prev = (project.lesson_pack_json ?? {}) as Partial<LessonPackData>;
  const metaMap = readTranslationMeta(prev);
  let skippedTeacher = 0;
  const targets = (items ?? []).filter((it) => {
    if (!String(it.english_text ?? "").trim()) return false;
    const meta = metaMap.get(String(it.id));
    if (meta?.translationSource === "teacher" && !input.includeTeacher) {
      skippedTeacher += 1;
      return false;
    }
    return true;
  });

  if (targets.length === 0) {
    return {
      ok: false,
      message:
        skippedTeacher > 0
          ? "재생성할 문장이 없습니다. (교사 수정 해석은 기본 제외)"
          : "재생성할 영어 문장이 없습니다.",
    };
  }

  // Keep previous korean until new ones succeed
  let translated;
  try {
    translated = await translatePassageSentences({
      passageId: projectId,
      sentences: targets.map((it, idx) => ({
        sentenceId: String(it.id),
        order: Number(it.order_index ?? idx) + 1,
        english: String(it.english_text ?? ""),
      })),
    });
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `일부 문장의 해석을 생성하지 못했습니다. ${e.message}`
          : "일부 문장의 해석을 생성하지 못했습니다.",
    };
  }

  const byId = new Map(
    translated.map((t) => [t.sentenceId, t.koreanTranslation] as const)
  );
  let sentenceTranslations = [...(prev.sentenceTranslations ?? [])];
  let regenerated = 0;

  for (const row of targets) {
    const ko = byId.get(String(row.id)) ?? "";
    if (!ko) continue;
    const { error: itemErr } = await supabase
      .from("lesson_material_items")
      .update({ korean_text: ko, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (itemErr) continue; // 저장 못 한 문장은 해석 기록에도 넣지 않는다(문장·기록 어긋남 방지)
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
    regenerated += 1;
  }

  if (regenerated === 0) {
    return {
      ok: false,
      message: "새 해석을 저장하지 못했습니다. 기존 해석은 유지됩니다.",
    };
  }

  const pack: LessonPackData = {
    // 목록에 없는 캐시(어법·어휘·어순배열)가 저장할 때 지워지지 않게 먼저 펼친다.
    ...prev,
    headerLabel: prev.headerLabel || "26년도 1학기 중간고사 대비",
    vocab: prev.vocab ?? [],
    updatedAt: new Date().toISOString(),
    blankCandidatePool: prev.blankCandidatePool ?? null,
    passageSourceHash: prev.passageSourceHash,
    sentenceTranslations,
  };

  const { error: packErr } = await supabase
    .from("lesson_material_projects")
    .update({
      lesson_pack_json: pack,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  revalidatePath(`/${role}/lesson-materials/lesson-pack`);
  revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
  if (packErr) {
    return {
      ok: false,
      message: `해석 ${regenerated}문장은 바꿨지만 기록을 남기지 못했어요. 한 번 더 눌러 주세요.`,
    };
  }
  return { ok: true, regenerated, skippedTeacher };
}

export async function updateLessonMaterialProjectMeta(
  role: Role,
  input: {
    projectId: string;
    title?: string;
    titleEn?: string | null;
    source?: string | null;
  }
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };

  const projectId = input.projectId?.trim();
  if (!projectId) return { ok: false, message: "프로젝트 ID가 없습니다." };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof input.title === "string") {
    const t = input.title.trim();
    if (t) patch.title = t;
  }
  if (input.titleEn !== undefined) {
    patch.title_en = input.titleEn?.trim() || null;
  }
  if (input.source !== undefined) {
    patch.source = input.source?.trim() || null;
  }

  const supabase = await createClient();
  let q = supabase
    .from("lesson_material_projects")
    .update(patch)
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!);
  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { error: uErr } = await q;
  if (uErr) return { ok: false, message: uErr.message };

  revalidatePath(`/${role}/lesson-materials`);
  revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
  revalidatePath(`/${role}/lesson-materials/lesson-pack`);
  return { ok: true, message: "출처·영어 제목을 저장했습니다." };
}
