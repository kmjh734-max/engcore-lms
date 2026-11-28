"use server";

import { revalidatePath } from "next/cache";
import { pageRows } from "@/lib/supabase/fetch-all-rows";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/vocab/actions-shared";
import { nextOrderIndexInFolder } from "@/lib/lesson-materials/project-order";

type Role = "admin" | "teacher";

function revalidateLibrary(role: Role) {
  revalidatePath(`/${role}/lesson-materials`);
}

async function requireRole(role: Role) {
  const profile = await getCurrentProfile();
  if (!profile) return { profile: null, error: actionError("로그인이 필요합니다.") };
  if (profile.role !== role) {
    return { profile: null, error: actionError("권한이 없습니다.") };
  }
  if (role === "teacher" && profile.is_active === false) {
    return { profile: null, error: actionError("비활성화된 계정입니다.") };
  }
  if (!profile.academy_id) {
    return { profile: null, error: actionError("소속 학원 정보가 없습니다.") };
  }
  return { profile, error: null as null };
}

export async function createLessonMaterialFolder(
  role: Role,
  input: { name: string; parentId?: string | null }
): Promise<ActionResult & { folderId?: string }> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const name = input.name.trim();
  if (!name) return actionError("폴더 이름을 입력해 주세요.");
  if (name === "미분류" || name === "휴지통") {
    return actionError("예약된 폴더 이름은 사용할 수 없습니다.");
  }

  const parentId = input.parentId?.trim() || null;
  const supabase = await createClient();

  if (parentId) {
    const { data: parent } = await supabase
      .from("lesson_material_folders")
      .select("id")
      .eq("id", parentId)
      .eq("academy_id", profile!.academy_id!)
      .maybeSingle();
    if (!parent) return actionError("상위 폴더를 찾을 수 없습니다.");
  }

  const { data, error: insertError } = await supabase
    .from("lesson_material_folders")
    .insert({
      name,
      parent_id: parentId,
      teacher_id: role === "teacher" ? profile!.id : null,
      created_by: profile!.id,
      academy_id: profile!.academy_id,
      order_index: 0,
    })
    .select("id")
    .single();

  if (insertError) return actionError(insertError.message);
  revalidateLibrary(role);
  return { ...actionSuccess("폴더가 생성되었습니다."), folderId: data.id };
}

export async function renameLessonMaterialFolder(
  role: Role,
  input: { folderId: string; name: string }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const name = input.name.trim();
  if (!name) return actionError("폴더 이름을 입력해 주세요.");
  if (name === "미분류" || name === "휴지통") {
    return actionError("예약된 폴더 이름은 사용할 수 없습니다.");
  }

  const supabase = await createClient();
  let q = supabase
    .from("lesson_material_folders")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", input.folderId)
    .eq("academy_id", profile!.academy_id!);

  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }

  const { error: updateError } = await q;
  if (updateError) return actionError(updateError.message);
  revalidateLibrary(role);
  return actionSuccess("폴더 이름을 수정했습니다.");
}

export async function deleteLessonMaterialFolder(
  role: Role,
  input: { folderId: string }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const supabase = await createClient();
  let q = supabase
    .from("lesson_material_folders")
    .delete()
    .eq("id", input.folderId)
    .eq("academy_id", profile!.academy_id!);

  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }

  const { error: deleteError } = await q;
  if (deleteError) return actionError(deleteError.message);
  revalidateLibrary(role);
  return actionSuccess("폴더를 삭제했습니다. 하위 자료는 미분류로 이동합니다.");
}

export async function moveLessonMaterialProjects(
  role: Role,
  input: { projectIds: string[]; folderId: string | null }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const ids = (input.projectIds ?? []).filter(Boolean);
  if (ids.length === 0) return actionError("이동할 자료를 선택해 주세요.");

  if (input.folderId) {
    const supabaseCheck = await createClient();
    const { data: folder } = await supabaseCheck
      .from("lesson_material_folders")
      .select("id")
      .eq("id", input.folderId)
      .maybeSingle();
    if (!folder) return actionError("대상 폴더를 찾을 수 없습니다.");
  }

  const supabase = await createClient();
  // 옮겨 가는 폴더의 맨 뒤에, 받은 순서(화면에 보이던 순서) 그대로 붙인다.
  const start = await nextOrderIndexInFolder(supabase, profile!.academy_id!, input.folderId, ids);
  const now = new Date().toISOString();
  const results = await Promise.all(
    ids.map((id, k) => {
      let q = supabase
        .from("lesson_material_projects")
        .update({
          folder_id: input.folderId,
          order_index: start + k,
          deleted_at: null,
          updated_at: now,
        })
        .eq("id", id)
        .eq("academy_id", profile!.academy_id!);
      if (role === "teacher") {
        q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
      }
      return q;
    })
  );
  const updateError = results.find((r) => r.error)?.error;
  if (updateError) return actionError(updateError.message);

  revalidateLibrary(role);
  return actionSuccess(`${ids.length}개 자료를 이동했습니다.`);
}

export async function trashLessonMaterialProjects(
  role: Role,
  input: { projectIds: string[] }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const ids = (input.projectIds ?? []).filter(Boolean);
  if (ids.length === 0) return actionError("휴지통으로 보낼 자료를 선택해 주세요.");

  const supabase = await createClient();
  let q = supabase
    .from("lesson_material_projects")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!);

  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }

  const { error: updateError } = await q;
  if (updateError) return actionError(updateError.message);

  revalidateLibrary(role);
  return actionSuccess(`${ids.length}개 자료를 휴지통으로 보냈습니다.`);
}

export async function restoreLessonMaterialProjects(
  role: Role,
  input: { projectIds: string[]; folderId?: string | null }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const ids = (input.projectIds ?? []).filter(Boolean);
  if (ids.length === 0) return actionError("복원할 자료를 선택해 주세요.");

  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
  if (input.folderId !== undefined) {
    patch.folder_id = input.folderId;
  }

  let q = supabase
    .from("lesson_material_projects")
    .update(patch)
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!);

  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }

  const { error: updateError } = await q;
  if (updateError) return actionError(updateError.message);

  revalidateLibrary(role);
  return actionSuccess(`${ids.length}개 자료를 복원했습니다.`);
}

export async function permanentlyDeleteLessonMaterialProjects(
  role: Role,
  input: { projectIds: string[] }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const ids = (input.projectIds ?? []).filter(Boolean);
  if (ids.length === 0) return actionError("삭제할 자료를 선택해 주세요.");

  const supabase = await createClient();
  let q = supabase
    .from("lesson_material_projects")
    .delete()
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!)
    .not("deleted_at", "is", null);

  if (role === "teacher") {
    q = q.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }

  const { error: deleteError } = await q;
  if (deleteError) return actionError(deleteError.message);

  revalidateLibrary(role);
  return actionSuccess(`${ids.length}개 자료를 영구 삭제했습니다.`);
}

export async function copyLessonMaterialProjects(
  role: Role,
  input: { projectIds: string[]; folderId: string | null }
): Promise<ActionResult & { copied?: number }> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const ids = (input.projectIds ?? []).filter(Boolean);
  if (ids.length === 0) return actionError("복사할 자료를 선택해 주세요.");

  const supabase = await createClient();

  if (input.folderId) {
    const { data: folder } = await supabase
      .from("lesson_material_folders")
      .select("id")
      .eq("id", input.folderId)
      .maybeSingle();
    if (!folder) return actionError("대상 폴더를 찾을 수 없습니다.");
  }

  let projectQuery = supabase
    .from("lesson_material_projects")
    .select(
      "id,title,title_en,source,analysis_json,illustration_prompt,illustration_url,illustration_captions,teacher_id,lesson_pack_json,analysis_report_json"
    )
    .in("id", ids)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);

  if (role === "teacher") {
    projectQuery = projectQuery.or(
      `teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`
    );
  }

  const { data: projects, error: projectsErr } = await projectQuery;
  if (projectsErr) return actionError(projectsErr.message);
  if (!projects?.length) return actionError("복사할 자료를 찾을 수 없습니다.");

  // 여러 지문을 한꺼번에 복사하면 문장이 1000줄을 넘어 뒤 지문 문장이 빠졌다 — 끝까지 읽는다
  const { data: items, error: itemsErr } = await pageRows((from, to) =>
    supabase
      .from("lesson_material_items")
      .select(
        "project_id,label,title,english_text,korean_text,order_index"
      )
      .in(
        "project_id",
        projects.map((p) => p.id)
      )
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (itemsErr) return actionError(itemsErr.message);

  const itemsByProject = new Map<string, typeof items>();
  for (const it of items ?? []) {
    const list = itemsByProject.get(it.project_id) ?? [];
    list.push(it);
    itemsByProject.set(it.project_id, list);
  }

  // 복사본은 대상 폴더 맨 뒤에, 받은 순서(화면에 보이던 순서) 그대로 붙인다.
  const orderOf = new Map(ids.map((id, i) => [id, i] as const));
  projects.sort((a, b) => (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0));
  let nextIndex = await nextOrderIndexInFolder(supabase, profile!.academy_id!, input.folderId);

  let copied = 0;
  for (const src of projects) {
    const { data: inserted, error: insertErr } = await supabase
      .from("lesson_material_projects")
      .insert({
        folder_id: input.folderId,
        title: `${src.title} 복사본`,
        title_en: src.title_en ?? null,
        source: src.source ?? null,
        teacher_id:
          role === "teacher" ? profile!.id : (src.teacher_id ?? null),
        created_by: profile!.id,
        academy_id: profile!.academy_id,
        order_index: nextIndex++,
        analysis_json: src.analysis_json ?? null,
        illustration_prompt: src.illustration_prompt ?? null,
        illustration_url: src.illustration_url ?? null,
        illustration_captions: src.illustration_captions ?? null,
        lesson_pack_json: src.lesson_pack_json ?? null,
        analysis_report_json: src.analysis_report_json ?? null,
        deleted_at: null,
      })
      .select("id")
      .single();
    if (insertErr || !inserted?.id) {
      return actionError(insertErr?.message ?? "복사에 실패했습니다.");
    }

    const srcItems = itemsByProject.get(src.id) ?? [];
    if (srcItems.length > 0) {
      const rows = srcItems.map((it) => ({
        project_id: inserted.id,
        label: it.label,
        title: it.title,
        english_text: it.english_text,
        korean_text: it.korean_text,
        order_index: it.order_index,
        academy_id: profile!.academy_id,
      }));
      const { error: itemInsertErr } = await supabase
        .from("lesson_material_items")
        .insert(rows);
      if (itemInsertErr) {
        // 문장 없는 빈 복사본을 남기지 않는다(다시 누르면 중복이 생겼다)
        await supabase.from("lesson_material_projects").delete().eq("id", inserted.id);
        revalidateLibrary(role);
        return actionError(
          copied > 0
            ? `${copied}개는 복사했고, 「${src.title}」에서 멈췄습니다: ${itemInsertErr.message}`
            : itemInsertErr.message
        );
      }
    }
    copied += 1;
  }

  revalidateLibrary(role);
  return {
    ...actionSuccess(`${copied}개 자료를 복사했습니다.`),
    copied,
  };
}

export async function saveLessonMaterialProjectWorkspace(
  role: Role,
  input: {
    projectId: string;
    title?: string;
    titleEn?: string | null;
    source?: string | null;
    analysisCards?: Array<{ title: string; desc: string }> | null;
    illustrationPrompt?: string | null;
    illustrationUrl?: string | null;
    illustrationCaptions?: string[] | null;
    items?: Array<{ id: string; english: string; korean: string }>;
  }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const projectId = input.projectId?.trim();
  if (!projectId) return actionError("프로젝트 ID가 없습니다.");

  const supabase = await createClient();

  let projectQ = supabase
    .from("lesson_material_projects")
    .select("id")
    .eq("id", projectId)
    .eq("academy_id", profile!.academy_id!);
  if (role === "teacher") {
    projectQ = projectQ.or(
      `teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`
    );
  }
  const { data: project } = await projectQ.maybeSingle();
  if (!project) return actionError("프로젝트를 찾을 수 없습니다.");

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
  if (input.analysisCards !== undefined) {
    patch.analysis_json = input.analysisCards?.length
      ? input.analysisCards
      : null;
  }
  if (input.illustrationPrompt !== undefined) {
    patch.illustration_prompt = input.illustrationPrompt?.trim() || null;
  }
  if (input.illustrationUrl !== undefined) {
    patch.illustration_url = input.illustrationUrl?.trim() || null;
  }
  if (input.illustrationCaptions !== undefined) {
    patch.illustration_captions = input.illustrationCaptions?.length
      ? input.illustrationCaptions
      : null;
  }

  const { error: updateErr } = await supabase
    .from("lesson_material_projects")
    .update(patch)
    .eq("id", projectId);
  if (updateErr) return actionError(updateErr.message);

  if (input.items?.length) {
    const { data: packRow, error: packReadErr } = await supabase
      .from("lesson_material_projects")
      .select("lesson_pack_json")
      .eq("id", projectId)
      .maybeSingle();
    // 이전 값을 못 읽었으면 해석 기록(pack)은 건드리지 않는다 — 빈 값으로 덮어써 캐시가 날아갔다(2026-11-28 점검)
    const packReadable = !packReadErr && !!packRow;
    const prev = (packRow?.lesson_pack_json ?? {}) as {
      headerLabel?: string;
      vocab?: unknown[];
      blankCandidatePool?: unknown;
      passageSourceHash?: string;
      sentenceTranslations?: Array<{
        sentenceId: string;
        order: number;
        english: string;
        koreanTranslation: string;
        sourceHash: string;
        translationSource: string;
        updatedAt: string;
      }>;
      updatedAt?: string;
    };
    const { data: existingItems } = await supabase
      .from("lesson_material_items")
      .select("id,korean_text")
      .eq("project_id", projectId);
    const prevKo = new Map(
      (existingItems ?? []).map((r) => [
        r.id as string,
        String(r.korean_text ?? "").trim(),
      ])
    );

    const { computeSentenceSourceHash } = await import(
      "@/lib/lesson-materials/translation-meta"
    );

    let sentenceTranslations = [...(prev.sentenceTranslations ?? [])];
    let metaChanged = false;

    for (const row of input.items) {
      const nextKo = row.korean.trim();
      const { error: itemErr } = await supabase
        .from("lesson_material_items")
        .update({
          english_text: row.english.trim(),
          korean_text: nextKo || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("project_id", projectId);
      if (itemErr) return actionError(itemErr.message);

      const before = prevKo.get(row.id) ?? "";
      const prevMeta = sentenceTranslations.find((t) => t.sentenceId === row.id);
      // 영어만 고치고 해석은 그대로 두면 저장된 해석의 영어가 옛 문장으로 남아
      // 워크북이 「현재 영어 원문과 일치하지 않습니다」로 막힌다 — 영어도 같이 맞춘다.
      const englishChanged =
        !!prevMeta &&
        prevMeta.sourceHash !== computeSentenceSourceHash(row.english.trim());
      if (nextKo && (nextKo !== before || englishChanged)) {
        // Manual edit relative to last saved value → teacher lock
        const stored = {
          sentenceId: row.id,
          order: 0,
          english: row.english.trim(),
          koreanTranslation: nextKo,
          sourceHash: computeSentenceSourceHash(row.english.trim()),
          translationSource:
            nextKo !== before
              ? ("teacher" as const)
              : (prevMeta?.translationSource ?? "legacy"),
          updatedAt: new Date().toISOString(),
        };
        sentenceTranslations = [
          ...sentenceTranslations.filter((t) => t.sentenceId !== row.id),
          stored,
        ];
        metaChanged = true;
      }
    }

    if (metaChanged && packReadable) {
      const { error: packErr } = await supabase
        .from("lesson_material_projects")
        .update({
          lesson_pack_json: {
            ...prev,
            headerLabel: prev.headerLabel || "26년도 1학기 중간고사 대비",
            vocab: prev.vocab ?? [],
            sentenceTranslations,
            updatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);
      if (packErr) {
        return actionError("문장은 저장했지만 해석 고친 표시를 남기지 못했어요. 한 번 더 저장해 주세요.");
      }
    }
  }

  revalidatePath(`/${role}/lesson-materials/project/${projectId}`);
  revalidateLibrary(role);
  return actionSuccess("저장되었습니다.");
}

export async function reorderLessonMaterialProjects(
  role: Role,
  input: { orderedIds: string[] }
): Promise<ActionResult> {
  const { profile, error } = await requireRole(role);
  if (error) return error;

  const orderedIds = input.orderedIds
    .map((id) => id.trim())
    .filter(Boolean);
  if (orderedIds.length === 0) {
    return actionError("순서 정보가 없습니다.");
  }

  const supabase = await createClient();

  /**
   * 자리가 바뀐 행만, 함께 고친다.
   *
   * 예전에는 목록 전체를 한 행씩 기다리며 고쳐서, 지문이 많을수록 끌어 놓을 때마다
   * 행 수만큼 왕복이 쌓였다(자료함에서 순서 바꾸기가 느리다는 지적). 한 번 끌면 보통
   * 몇 행만 자리가 바뀐다.
   */
  let current = supabase
    .from("lesson_material_projects")
    .select("id,order_index")
    .in("id", orderedIds)
    .eq("academy_id", profile!.academy_id!)
    .is("deleted_at", null);
  if (role === "teacher") {
    current = current.or(`teacher_id.eq.${profile!.id},created_by.eq.${profile!.id}`);
  }
  const { data: rows, error: readErr } = await current;
  if (readErr) return actionError(readErr.message);
  const indexNow = new Map((rows ?? []).map((r) => [r.id as string, r.order_index as number | null]));
  const changed = orderedIds
    .map((id, i) => ({ id, i }))
    .filter(({ id, i }) => indexNow.has(id) && indexNow.get(id) !== i);

  const updates = await Promise.all(
    changed.map(({ id, i }) =>
      supabase
        .from("lesson_material_projects")
        .update({ order_index: i })
        .eq("id", id)
        .eq("academy_id", profile!.academy_id!)
    )
  );
  const failed = updates.find((res) => res.error);
  if (failed?.error) return actionError(failed.error.message);

  revalidateLibrary(role);
  return actionSuccess("순서가 저장되었습니다.");
}
