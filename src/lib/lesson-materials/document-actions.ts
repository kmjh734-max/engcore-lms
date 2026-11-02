"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  defaultDocumentName,
  uniqueDocumentName,
  type LessonMaterialDocumentKind,
  type LessonMaterialDocumentRow,
} from "@/lib/lesson-materials/documents";
import { normalizeLessonBookOptions } from "@/lib/lesson-materials/lesson-book-options";

type Role = "admin" | "teacher";
type Fail = { ok: false; message: string };

const KINDS = new Set<LessonMaterialDocumentKind>([
  "lesson_pack",
  "analysis_report",
  "workbook",
  "integrated",
  "one_page_summary",
  "one_page_test",
  "test_book",
  "test_draw",
]);
const NAME_MAX = 80;

async function requireRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile) return { profile: null, error: "로그인이 필요합니다." };
  if (profile.role !== role) return { profile: null, error: "권한이 없습니다." };
  if (role === "teacher" && profile.is_active === false) {
    return { profile: null, error: "비활성화된 계정입니다." };
  }
  if (!profile.academy_id) return { profile: null, error: "소속 학원 정보가 없습니다." };
  return { profile, error: null as null };
}

function cleanName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/**
 * 지문자료에서 수업용 자료·분석서·워크북을 만들 때 파일 하나를 만든다.
 * 이름을 주지 않으면 수업용자료_0911처럼 짓고, 겹치면 -2, -3을 붙인다.
 */
export async function createLessonMaterialDocument(
  role: Role,
  input: {
    kind: LessonMaterialDocumentKind;
    projectIds: string[];
    name?: string | null;
    sourceQuery?: string | null;
  }
): Promise<{ ok: true; id: string; name: string } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  if (!KINDS.has(input.kind)) return { ok: false, message: "알 수 없는 자료 종류입니다." };
  const projectIds = [...new Set((input.projectIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (projectIds.length === 0) return { ok: false, message: "선택된 지문이 없습니다." };

  const supabase = await createClient();
  const base = cleanName(input.name) || defaultDocumentName(input.kind);
  const { data: same } = await supabase
    .from("lesson_material_documents")
    .select("name")
    .eq("academy_id", profile!.academy_id!)
    .eq("kind", input.kind)
    .is("deleted_at", null)
    .like("name", `${base.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const name = uniqueDocumentName(base, (same ?? []).map((row) => row.name as string));

  const { data, error: insertError } = await supabase
    .from("lesson_material_documents")
    .insert({
      kind: input.kind,
      name,
      project_ids: projectIds,
      source_query: input.sourceQuery ?? null,
      teacher_id: role === "teacher" ? profile!.id : null,
      created_by: profile!.id,
      academy_id: profile!.academy_id,
    })
    .select("id,name")
    .single();
  if (insertError || !data) {
    return { ok: false, message: insertError?.message ?? "파일을 만들지 못했습니다." };
  }
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true, id: data.id as string, name: data.name as string };
}

/** 자료 화면 왼쪽 위에 보이는 파일 이름(선생님 2026-10-21) */
export async function getLessonMaterialDocumentName(
  role: Role,
  input: { id: string }
): Promise<{ ok: true; name: string } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_material_documents")
    .select("name")
    .eq("id", input.id)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return { ok: false, message: "파일을 찾을 수 없습니다." };
  return { ok: true, name: data.name as string };
}

export async function renameLessonMaterialDocument(
  role: Role,
  input: { id: string; name: string }
): Promise<{ ok: true; name: string } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, message: "이름을 입력해 주세요." };
  const supabase = await createClient();
  const { data, error: updateError } = await supabase
    .from("lesson_material_documents")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("academy_id", profile!.academy_id!)
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, message: updateError.message };
  if (!data) return { ok: false, message: "파일을 찾을 수 없습니다." };
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true, name };
}

/**
 * 수업용 자료 「단어 시험지」를 인쇄·PDF로 뽑은 그대로 파일에 남긴다(선생님 2026-11-02 「한번 만들면 고정해야지」).
 * 다시 열면 이것을 그대로 보여 준다 — 코드가 바뀌어도 인쇄한 시험지와 정답지가 달라지지 않는다.
 */
export async function saveLessonPackVocabExam(
  role: Role,
  input: { id: string; saved: unknown }
): Promise<{ ok: true } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const saved = input.saved as { exam?: { total?: unknown; sections?: unknown } } | null;
  if (!saved || !Array.isArray(saved.exam?.sections) || typeof saved.exam?.total !== "number") {
    return { ok: false, message: "시험지 내용이 올바르지 않습니다." };
  }
  if (JSON.stringify(saved).length > 400_000) return { ok: false, message: "시험지가 너무 큽니다." };
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("lesson_material_documents")
    .select("payload")
    .eq("id", input.id)
    .eq("kind", "lesson_pack")
    .eq("academy_id", profile!.academy_id!)
    .maybeSingle();
  if (!cur) return { ok: false, message: "파일을 찾을 수 없습니다." };
  const prev = (cur.payload as Record<string, unknown> | null) ?? {};
  const { error: upErr } = await supabase
    .from("lesson_material_documents")
    .update({ payload: { ...prev, vocabExamSaved: { ...saved, savedAt: new Date().toISOString() } } })
    .eq("id", input.id)
    .eq("academy_id", profile!.academy_id!);
  if (upErr) return { ok: false, message: upErr.message };
  return { ok: true };
}

/** 파일을 휴지통으로 보낸다. 목록에서 여러 개를 골라 한 번에 보낼 수 있다. */
export async function trashLessonMaterialDocuments(
  role: Role,
  input: { ids: string[] }
): Promise<{ ok: true } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const ids = [...new Set((input.ids ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: "선택된 파일이 없습니다." };
  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("lesson_material_documents")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!);
  if (updateError) return { ok: false, message: updateError.message };
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true };
}

/**
 * 고른 파일을 내용(payload)째 복사한다. 이름은 「원래 이름 사본」, 겹치면 -2, -3을 붙인다.
 * 내용이 클 수 있어 한 번에 몰아 읽지 않고 한 개씩 읽어 넣는다.
 */
export async function copyLessonMaterialDocuments(
  role: Role,
  input: { ids: string[] }
): Promise<{ ok: true; documents: LessonMaterialDocumentRow[] } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const ids = [...new Set((input.ids ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: "선택된 파일이 없습니다." };
  if (ids.length > 30) return { ok: false, message: "한 번에 30개까지 복사할 수 있습니다." };
  const supabase = await createClient();
  const created: LessonMaterialDocumentRow[] = [];
  for (const id of ids) {
    const { data: src } = await supabase
      .from("lesson_material_documents")
      .select("kind,name,project_ids,payload,source_query")
      .eq("id", id)
      .eq("academy_id", profile!.academy_id!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!src) continue;
    const base = cleanName(`${src.name} 사본`);
    const { data: same } = await supabase
      .from("lesson_material_documents")
      .select("name")
      .eq("academy_id", profile!.academy_id!)
      .eq("kind", src.kind)
      .is("deleted_at", null)
      .like("name", `${base.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const name = uniqueDocumentName(base, (same ?? []).map((row) => row.name as string));
    const { data, error: insertError } = await supabase
      .from("lesson_material_documents")
      .insert({
        kind: src.kind,
        name,
        project_ids: src.project_ids ?? [],
        payload: src.payload ?? null,
        source_query: src.source_query ?? null,
        teacher_id: role === "teacher" ? profile!.id : null,
        created_by: profile!.id,
        academy_id: profile!.academy_id,
      })
      .select("id,kind,name,project_ids,created_at,updated_at")
      .single();
    if (insertError || !data) {
      return { ok: false, message: insertError?.message ?? "파일을 복사하지 못했습니다." };
    }
    created.push(data as LessonMaterialDocumentRow);
  }
  if (created.length === 0) return { ok: false, message: "복사할 수 있는 파일이 없습니다." };
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true, documents: created };
}

/** 워크북 파일을 연다: 저장된 결과가 있으면 그것을, 없으면 만든 조건을 돌려준다. */
export async function getWorkbookDocument(
  role: Role,
  input: { id: string }
): Promise<
  | {
      ok: true;
      name: string;
      projectIds: string[];
      payload: unknown | null;
      sourceQuery: string | null;
    }
  | Fail
> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const supabase = await createClient();
  const { data, error: readError } = await supabase
    .from("lesson_material_documents")
    .select("name,project_ids,payload,source_query,kind")
    .eq("id", input.id)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!data || data.kind !== "workbook") return { ok: false, message: "워크북 파일을 찾을 수 없습니다." };
  return {
    ok: true,
    name: data.name as string,
    projectIds: (data.project_ids as string[]) ?? [],
    payload: data.payload ?? null,
    sourceQuery: (data.source_query as string | null) ?? null,
  };
}

/**
 * 최종통합자료 파일을 만든다. payload에 구성(고른 파일·순서)과 표지 설정을 둔다.
 * project_ids에는 묶은 자료들이 쓰는 지문을 모두 둔다(자료함에서 지문 수 표시용).
 */
export async function createIntegratedDocument(
  role: Role,
  input: { name?: string | null; projectIds: string[]; payload: unknown }
): Promise<{ ok: true; id: string; name: string } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const supabase = await createClient();
  const base = cleanName(input.name) || defaultDocumentName("integrated");
  const { data: same } = await supabase
    .from("lesson_material_documents")
    .select("name")
    .eq("academy_id", profile!.academy_id!)
    .eq("kind", "integrated")
    .is("deleted_at", null)
    .like("name", `${base.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const name = uniqueDocumentName(base, (same ?? []).map((row) => row.name as string));
  const projectIds = [...new Set((input.projectIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  const { data, error: insertError } = await supabase
    .from("lesson_material_documents")
    .insert({
      kind: "integrated",
      name,
      project_ids: projectIds,
      payload: input.payload ?? null,
      teacher_id: role === "teacher" ? profile!.id : null,
      created_by: profile!.id,
      academy_id: profile!.academy_id,
    })
    .select("id,name")
    .single();
  if (insertError || !data) {
    return { ok: false, message: insertError?.message ?? "통합자료를 만들지 못했습니다." };
  }
  revalidatePath(`/${role}/lesson-materials`);
  return { ok: true, id: data.id as string, name: data.name as string };
}

/** 최종통합자료의 표지·구성 설정을 저장한다. */
export async function saveIntegratedDocument(
  role: Role,
  input: { id: string; payload: unknown }
): Promise<{ ok: true } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const supabase = await createClient();
  const { data, error: updateError } = await supabase
    .from("lesson_material_documents")
    .update({ payload: input.payload ?? null, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("kind", "integrated")
    .eq("academy_id", profile!.academy_id!)
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, message: updateError.message };
  if (!data) return { ok: false, message: "통합자료 파일을 찾을 수 없습니다." };
  return { ok: true };
}

/** 수업용 자료 설정(해석·전체 단어장·백지노트)을 파일에 저장한다. payload의 다른 값은 그대로 둔다. */
export async function saveLessonPackOptions(
  role: Role,
  input: { id: string; options: unknown }
): Promise<{ ok: true } | Fail> {
  const { profile, error } = await requireRole(role);
  if (error) return { ok: false, message: error };
  const options = normalizeLessonBookOptions(input.options);
  if (!options) return { ok: false, message: "설정을 읽지 못했습니다." };
  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("lesson_material_documents")
    .select("payload")
    .eq("id", input.id)
    .eq("kind", "lesson_pack")
    .eq("academy_id", profile!.academy_id!)
    .maybeSingle();
  if (!cur) return { ok: false, message: "파일을 찾을 수 없습니다." };
  const prev = (cur.payload as Record<string, unknown> | null) ?? {};
  const { error: upErr } = await supabase
    .from("lesson_material_documents")
    .update({
      payload: { ...prev, options: { ...((prev.options as Record<string, unknown> | undefined) ?? {}), ...options } },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("academy_id", profile!.academy_id!);
  if (upErr) return { ok: false, message: upErr.message };
  return { ok: true };
}
