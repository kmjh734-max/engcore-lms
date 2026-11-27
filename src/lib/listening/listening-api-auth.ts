import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export const CURRICULUM_LOCK_MARKER = "curriculum_locked";

export function listeningSetIsLocked(row: {
  is_locked?: boolean | null;
  description?: string | null;
}): boolean {
  if (row.is_locked === true) return true;
  return (row.description ?? "").includes(CURRICULUM_LOCK_MARKER);
}

type AccessOk = {
  ok: true;
  profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;
  admin: ReturnType<typeof createAdminClient>;
  setRow: {
    id: string;
    teacher_id: string | null;
    created_by: string | null;
    academy_id: string | null;
    is_locked: boolean;
  };
};

type AccessErr = {
  ok: false;
  message: string;
  status: number;
};

async function loadSetRow(
  admin: ReturnType<typeof createAdminClient>,
  setId: string
) {
  const full = await admin
    .from("listening_sets")
    .select("id, teacher_id, created_by, academy_id, is_locked, description")
    .eq("id", setId)
    .maybeSingle();

  if (!full.error) return full;

  // is_locked 컬럼 미적용 환경 폴백
  const fallback = await admin
    .from("listening_sets")
    .select("id, teacher_id, created_by, academy_id, description")
    .eq("id", setId)
    .maybeSingle();
  return fallback;
}

export async function assertListeningSetAccess(
  setId: string
): Promise<AccessOk | AccessErr> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
    return { ok: false, message: "권한이 없습니다.", status: 403 };
  }

  const admin = createAdminClient();
  const { data: setRow, error: setErr } = await loadSetRow(admin, setId);

  if (setErr || !setRow) {
    return { ok: false, message: "듣기 세트를 찾을 수 없습니다.", status: 200 };
  }

  if (
    profile.role === "admin" &&
    (!profile.academy_id ||
      !setRow.academy_id ||
      setRow.academy_id !== profile.academy_id)
  ) {
    return {
      ok: false,
      message: "다른 학원 세트에는 접근할 수 없습니다.",
      status: 403,
    };
  }

  const isLocked = listeningSetIsLocked(setRow);

  if (profile.role === "teacher") {
    const owns =
      setRow.teacher_id === profile.id || setRow.created_by === profile.id;
    const sameAcademy =
      !!profile.academy_id &&
      !!setRow.academy_id &&
      setRow.academy_id === profile.academy_id;
    if (!owns && !(isLocked && sameAcademy)) {
      return { ok: false, message: "이 세트에 대한 권한이 없습니다.", status: 403 };
    }
    if (
      profile.academy_id &&
      setRow.academy_id &&
      setRow.academy_id !== profile.academy_id
    ) {
      return {
        ok: false,
        message: "다른 학원 세트에는 접근할 수 없습니다.",
        status: 403,
      };
    }
  }

  return {
    ok: true,
    profile,
    admin,
    setRow: {
      id: setRow.id,
      teacher_id: setRow.teacher_id,
      created_by: setRow.created_by,
      academy_id: setRow.academy_id,
      is_locked: isLocked,
    },
  };
}

/**
 * 학원 DB 세트는 잠금을 풀기 전에는 아무도 지울 수 없다.
 * 지우는 쪽은 service-role 로 도니 RLS 가 걸리지 않는다. 그래서 여기서 막는다.
 */
export async function assertListeningSetDeletable(setId: string) {
  const access = await assertListeningSetAccess(setId);
  if (!access.ok) return access;
  if (access.setRow.is_locked) {
    return {
      ok: false as const,
      message: "학원 DB 자료는 지울 수 없습니다. 꼭 지워야 하면 먼저 잠금을 풀어 주세요.",
      status: 403,
    };
  }
  return access;
}

/** Teachers cannot mutate locked curriculum sets; admins can. */
export async function assertListeningSetWritable(setId: string) {
  const access = await assertListeningSetAccess(setId);
  if (!access.ok) return access;
  if (access.profile.role === "teacher" && access.setRow.is_locked) {
    return {
      ok: false as const,
      message: "잠긴 커리큘럼 세트는 관리자만 수정할 수 있습니다.",
      status: 403,
    };
  }
  return access;
}
