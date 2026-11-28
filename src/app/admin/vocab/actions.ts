"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/vocab/actions-shared";
import {
  createVocabFolder as createFolderLib,
  deleteVocabFolder as deleteFolderLib,
  updateVocabFolder as updateFolderLib,
} from "@/lib/vocab/folder-actions";
import {
  bulkAssignFolderSets,
  formatBulkAssignSuccess,
} from "@/lib/vocab/folder-assignments";
import { bulkAssignSets } from "@/lib/vocab/bulk-assign-sets";
import { removeVocabAssignment } from "@/lib/vocab/class-assignments";
import {
  copyVocabSetToFolder,
  moveVocabSetToFolder,
} from "@/lib/vocab/set-ops";
import { nextVocabSetOrderIndex } from "@/lib/vocab/reorder-sets";
import { revalidateVocabPaths } from "@/lib/vocab/revalidate";
import {
  persistVocabItems,
  type VocabItemSaveInput,
} from "@/lib/vocab/save-items";

const ROLE = "admin" as const;

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return { profile: null, error: actionError("관리자 권한이 필요합니다.") };
  }
  return { profile, error: null };
}

export async function createVocabFolder(name: string) {
  return createFolderLib(ROLE, { name });
}

export async function updateVocabFolder(folderId: string, name: string) {
  return updateFolderLib(ROLE, folderId, { name });
}

export async function deleteVocabFolder(folderId: string) {
  return deleteFolderLib(ROLE, folderId);
}

export async function createVocabSet(input: {
  title: string;
  description?: string;
  teacherId?: string;
  folderId?: string | null;
}): Promise<ActionResult & { setId?: string }> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  const title = input.title.trim();
  if (!title) return actionError("단어장 제목을 입력해 주세요.");

  const folderId = input.folderId?.trim() || null;
  if (!profile!.academy_id) {
    return actionError(
      "소속 학원 정보가 없습니다. EngCore Admin에서 학원에 연결해 주세요."
    );
  }
  const supabase = await createClient();
  const orderIndex = await nextVocabSetOrderIndex(supabase, folderId);
  const { data, error: insertError } = await supabase
    .from("vocab_sets")
    .insert({
      title,
      description: input.description?.trim() || null,
      folder_id: folderId,
      order_index: orderIndex,
      teacher_id: input.teacherId || null,
      created_by: profile!.id,
      is_published: true,
      academy_id: profile!.academy_id,
    })
    .select("id")
    .single();

  if (insertError) return actionError(insertError.message);

  revalidateVocabPaths(ROLE, { folderId: folderId ?? undefined, setId: data.id });
  return { ...actionSuccess("단어장이 생성되었습니다."), setId: data.id };
}

export async function updateVocabSet(
  setId: string,
  input: {
    title?: string;
    description?: string;
    teacherId?: string | null;
  }
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const payload: Record<string, unknown> = { is_published: true };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return actionError("단어장 제목을 입력해 주세요.");
    payload.title = title;
  }
  if (input.description !== undefined) {
    payload.description = input.description.trim() || null;
  }
  if (input.teacherId !== undefined) payload.teacher_id = input.teacherId;

  const supabase = await createClient();
  if (payload.description !== undefined) {
    // 학원 교재의 설명 칸은 교재 표시(curriculum_locked)라 건드리지 않는다
    const { data: row } = await supabase.from("vocab_sets").select("is_locked").eq("id", setId).maybeSingle();
    if (row?.is_locked) delete payload.description;
  }
  const { error: updateError } = await supabase
    .from("vocab_sets")
    .update(payload)
    .eq("id", setId);

  if (updateError) return actionError(updateError.message);

  revalidateVocabPaths(ROLE, { setId });
  return actionSuccess("단어장이 수정되었습니다.");
}

export async function deleteVocabSet(
  setId: string,
  folderId?: string | null
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const { data: setRow } = await supabase
    .from("vocab_sets")
    .select("is_locked")
    .eq("id", setId)
    .maybeSingle();
  if (setRow?.is_locked) {
    return actionError("잠긴 커리큘럼 단어장은 삭제할 수 없습니다.");
  }

  const { error: deleteError } = await supabase
    .from("vocab_sets")
    .delete()
    .eq("id", setId);

  if (deleteError) return actionError(deleteError.message);

  revalidateVocabPaths(ROLE, { setId, folderId: folderId ?? undefined });
  return actionSuccess("단어장이 삭제되었습니다.");
}

export async function saveVocabItems(
  setId: string,
  items: VocabItemSaveInput[]
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await persistVocabItems(supabase, setId, items);

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { setId });
  const count = items.filter((i) => i.word.trim() && i.meaning.trim()).length;
  return actionSuccess(`${count}개 단어가 저장되었습니다.`);
}

export async function assignFolderToClass(
  folderId: string,
  classId: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await bulkAssignFolderSets(supabase, folderId, profile!.id, {
    classId,
  });

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { folderId, classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}

export async function assignFolderToStudents(
  folderId: string,
  studentIds: string[],
  classId?: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  if (!studentIds.length) {
    return actionError("배정할 학생을 선택해 주세요.");
  }

  const supabase = await createClient();
  const result = await bulkAssignFolderSets(supabase, folderId, profile!.id, {
    classId,
    studentIds,
  });

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { folderId, classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}

export async function assignSetToClass(
  setId: string,
  classId: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await bulkAssignSets(supabase, [setId], profile!.id, {
    classId,
  });

  if (!result.ok) return actionError(result.message);
  revalidateVocabPaths(ROLE, { setId, classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}

export async function assignSetToStudents(
  setId: string,
  studentIds: string[],
  classId?: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  if (!studentIds.length) {
    return actionError("배정할 학생을 선택해 주세요.");
  }

  const supabase = await createClient();
  const result = await bulkAssignSets(supabase, [setId], profile!.id, {
    classId,
    studentIds,
  });

  if (!result.ok) return actionError(result.message);
  revalidateVocabPaths(ROLE, { setId, classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}

export async function moveVocabSet(
  setId: string,
  folderId: string | null
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await moveVocabSetToFolder(supabase, setId, folderId);
  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { setId, folderId: folderId ?? undefined });
  return actionSuccess("폴더로 이동했습니다.");
}

export async function copyVocabSet(
  setId: string,
  targetFolderId: string | null
): Promise<ActionResult & { setId?: string }> {
  const { profile, error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await copyVocabSetToFolder(
    supabase,
    setId,
    targetFolderId,
    profile!.id
  );

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, {
    folderId: targetFolderId ?? undefined,
    setId: result.newSetId,
  });
  return {
    ...actionSuccess("단어장이 복사되었습니다."),
    setId: result.newSetId,
  };
}

export async function removeSetAssignment(
  assignmentId: string,
  setId: string
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await removeVocabAssignment(supabase, assignmentId);

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { setId });
  return actionSuccess("배정이 해제되었습니다.");
}

export async function removeFolderVocabAssignment(
  assignmentId: string,
  folderId: string
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = await createClient();
  const result = await removeVocabAssignment(supabase, assignmentId);

  if (!result.ok) return actionError(result.message);

  revalidateVocabPaths(ROLE, { folderId });
  return actionSuccess("배정이 해제되었습니다.");
}

export async function bulkMoveVocabSets(
  setIds: string[],
  folderId: string | null
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;
  if (!setIds.length) return actionError("이동할 단어장을 선택해 주세요.");

  const supabase = await createClient();
  for (const setId of setIds) {
    const result = await moveVocabSetToFolder(supabase, setId, folderId);
    if (!result.ok) return actionError(result.message);
  }

  revalidateVocabPaths(ROLE, { folderId: folderId ?? undefined });
  return actionSuccess(`${setIds.length}개 단어장을 이동했습니다.`);
}

export async function bulkDeleteVocabSets(
  setIds: string[],
  folderId?: string
): Promise<ActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;
  if (!setIds.length) return actionError("삭제할 단어장을 선택해 주세요.");

  const supabase = await createClient();
  // 하나씩 지울 때처럼 잠긴 커리큘럼 단어장은 서버에서도 막는다(화면에서만 거르던 것 — 2026-11-28 점검)
  const { data: lockedRows } = await supabase
    .from("vocab_sets")
    .select("id")
    .in("id", setIds)
    .eq("is_locked", true);
  const skipped = lockedRows?.length ?? 0;
  const { error: deleteError } = await supabase
    .from("vocab_sets")
    .delete()
    .in("id", setIds)
    .not("is_locked", "is", true);

  if (deleteError) return actionError(deleteError.message);

  revalidateVocabPaths(ROLE, { folderId });
  const n = setIds.length - skipped;
  return actionSuccess(
    skipped > 0
      ? `${n}개 단어장이 삭제되었습니다. (잠긴 단어장 ${skipped}개는 그대로 둡니다)`
      : `${n}개 단어장이 삭제되었습니다.`
  );
}

export async function bulkAssignVocabSetsToClass(
  setIds: string[],
  classId: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;
  if (!setIds.length) return actionError("배정할 단어장을 선택해 주세요.");

  const supabase = await createClient();
  const result = await bulkAssignSets(supabase, setIds, profile!.id, {
    classId,
  });

  if (!result.ok) return actionError(result.message);
  revalidateVocabPaths(ROLE, { classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}

export async function bulkAssignVocabSetsToStudents(
  setIds: string[],
  studentIds: string[],
  classId?: string
): Promise<ActionResult> {
  const { profile, error } = await requireAdmin();
  if (error) return error;
  if (!setIds.length) return actionError("배정할 단어장을 선택해 주세요.");
  if (!studentIds.length) return actionError("배정할 학생을 선택해 주세요.");

  const supabase = await createClient();
  const result = await bulkAssignSets(supabase, setIds, profile!.id, {
    classId,
    studentIds,
  });

  if (!result.ok) return actionError(result.message);
  revalidateVocabPaths(ROLE, { classId });
  return actionSuccess(formatBulkAssignSuccess(result));
}
