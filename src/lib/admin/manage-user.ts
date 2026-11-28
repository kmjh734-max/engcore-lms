import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidUsername,
  normalizeUsername,
  toInternalEmail,
} from "@/lib/auth/username";
import type { UserRole } from "@/types/database";

const PROFILE_SELECT_BASE =
  "id, name, email, role, username, is_active, created_at, academy_id";
const PROFILE_SELECT_WITH_CREATED_BY = `${PROFILE_SELECT_BASE}, created_by`;

const MIGRATION_HINT =
  " Supabase SQL Editor에서 supabase/FIX_CREATED_BY_AND_SIGNUP.sql 을 실행해 주세요.";

function isMissingColumnError(
  message: string | undefined,
  column: string
): boolean {
  const m = message ?? "";
  return (
    m.includes(column) &&
    (m.includes("schema cache") || m.includes("Could not find"))
  );
}

async function selectProfileAfterWrite(
  admin: SupabaseClient,
  userId: string,
  withCreatedBy: boolean
) {
  if (withCreatedBy) {
    return admin
      .from("profiles")
      .select(PROFILE_SELECT_WITH_CREATED_BY)
      .eq("id", userId);
  }
  return admin.from("profiles").select(PROFILE_SELECT_BASE).eq("id", userId);
}

const ROLE_LABEL: Record<"student" | "teacher" | "admin", string> = {
  student: "학생",
  teacher: "강사",
  admin: "관리자",
};

export type ManagedAccountRole = Extract<UserRole, "student" | "teacher" | "admin">;

export interface CreateAccountInput {
  name: string;
  username: string;
  password: string;
  role: ManagedAccountRole;
  createdBy?: string | null;
  /** 멀티테넌트: 소속 학원 (학원 관리자·강사·학생 생성 시 필수에 가깝게 사용) */
  academyId?: string | null;
}

export interface UpdateAccountInput {
  name?: string;
  username?: string;
  is_active?: boolean;
  allowUsernameChange: boolean;
  /** 설정 시 해당 생성자의 학생만 수정 가능 (강사용) */
  restrictToCreatorId?: string;
  /** 설정 시 같은 학원 계정만 수정 가능 (학원 관리자용) */
  restrictToAcademyId?: string;
}

export interface ResetPasswordOptions {
  restrictToCreatorId?: string;
  restrictToAcademyId?: string;
}

type Result<T> =
  | { ok: true; message: string; profile: T }
  | { ok: false; message: string; status: number };

async function syncProfileAfterAuthCreate(
  admin: SupabaseClient,
  userId: string,
  payload: {
    name: string;
    email: string;
    role: ManagedAccountRole;
    username: string;
    createdBy: string | null;
    academyId?: string | null;
  }
): Promise<Result<Record<string, unknown>>> {
  const basePayload: Record<string, unknown> = {
    name: payload.name,
    email: payload.email,
    role: payload.role,
    username: payload.username,
    is_active: true,
  };
  if (payload.academyId) {
    basePayload.academy_id = payload.academyId;
  }

  let useCreatedBy =
    payload.createdBy != null && payload.role === "student";
  let writePayload: Record<string, unknown> = useCreatedBy
    ? { ...basePayload, created_by: payload.createdBy }
    : { ...basePayload };

  const tryUpdate = async (body: Record<string, unknown>, withCreatedBy: boolean) => {
    const { error } = await admin
      .from("profiles")
      .update(body)
      .eq("id", userId);
    if (error) return { rows: null as null, error, withCreatedBy };
    const read = await selectProfileAfterWrite(admin, userId, withCreatedBy);
    return { rows: read.data, error: read.error, withCreatedBy };
  };

  let { rows, error: updateError, withCreatedBy } = await tryUpdate(
    writePayload,
    useCreatedBy
  );

  if (
    updateError &&
    useCreatedBy &&
    (isMissingColumnError(updateError.message, "created_by") ||
      updateError.message.includes("foreign key"))
  ) {
    useCreatedBy = false;
    writePayload = { ...basePayload };
    const retry = await tryUpdate(writePayload, false);
    rows = retry.rows;
    updateError = retry.error;
    withCreatedBy = false;
  }

  if (updateError) {
    const hint =
      updateError.message.includes("username") ||
      updateError.message.includes("is_active") ||
      isMissingColumnError(updateError.message, "created_by")
        ? MIGRATION_HINT
        : "";
    return {
      ok: false,
      message: updateError.message + hint,
      status: 500,
    };
  }

  let profile: Record<string, unknown> | null =
    (rows?.[0] as Record<string, unknown> | undefined) ?? null;

  if (!profile) {
    const tryInsert = async (
      body: Record<string, unknown>,
      withCreatedBy: boolean
    ) => {
      const query = admin.from("profiles").insert({ id: userId, ...body });
      if (withCreatedBy) {
        return query.select(PROFILE_SELECT_WITH_CREATED_BY).single();
      }
      return query.select(PROFILE_SELECT_BASE).single();
    };

    let { data: inserted, error: insertError } = await tryInsert(
      writePayload,
      withCreatedBy
    );

    if (
      insertError &&
      withCreatedBy &&
      isMissingColumnError(insertError.message, "created_by")
    ) {
      const retry = await tryInsert({ ...basePayload }, false);
      inserted = retry.data;
      insertError = retry.error;
    }

    if (insertError) {
      if (
        insertError.message.includes("username") &&
        insertError.message.includes("unique")
      ) {
        return {
          ok: false,
          message: "이미 사용 중인 아이디입니다.",
          status: 409,
        };
      }
      const hint =
        insertError.message.includes("username") ||
        insertError.message.includes("is_active") ||
        isMissingColumnError(insertError.message, "created_by")
          ? MIGRATION_HINT
          : "";
      return {
        ok: false,
        message: insertError.message + hint,
        status: 500,
      };
    }
    profile = inserted as Record<string, unknown> | null;
  }

  if (!profile) {
    return {
      ok: false,
      message: "프로필 저장 후 데이터를 불러오지 못했습니다.",
      status: 500,
    };
  }

  if (profile.role !== payload.role) {
    const { data: fixed, error: roleFixError } = await admin
      .from("profiles")
      .update({ role: payload.role })
      .eq("id", userId)
      .select(PROFILE_SELECT_BASE)
      .single();

    if (roleFixError) {
      return { ok: false, message: roleFixError.message, status: 500 };
    }
    if (fixed) profile = fixed as Record<string, unknown>;
  }

  return {
    ok: true,
    message: "",
    profile,
  };
}

export async function createManagedAccount(
  admin: SupabaseClient,
  input: CreateAccountInput
): Promise<Result<Record<string, unknown>>> {
  const label = ROLE_LABEL[input.role];
  const name = input.name.trim();
  const username = normalizeUsername(input.username);
  const password = input.password;

  if (!name) {
    return { ok: false, message: `${label} 이름을 입력해 주세요.`, status: 400 };
  }

  if (!username) {
    return {
      ok: false,
      message:
        "아이디는 영문 소문자·숫자만 사용할 수 있습니다. (한글·특수문자는 사용할 수 없습니다.)",
      status: 400,
    };
  }

  if (!isValidUsername(username)) {
    return {
      ok: false,
      message: "아이디는 영문 소문자·숫자 3~32자로 입력해 주세요.",
      status: 400,
    };
  }

  if (password.length < 6) {
    return {
      ok: false,
      message: "비밀번호는 6자 이상이어야 합니다.",
      status: 400,
    };
  }

  const internalEmail = toInternalEmail(username);

  const { data: existingUsername } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existingUsername) {
    return {
      ok: false,
      message: "이미 사용 중인 아이디입니다.",
      status: 409,
    };
  }

  const { data: existingEmail } = await admin
    .from("profiles")
    .select("id")
    .eq("email", internalEmail)
    .maybeSingle();

  if (existingEmail) {
    return {
      ok: false,
      message: "이미 등록된 로그인 정보입니다.",
      status: 409,
    };
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: input.role,
      },
    });

  if (authError) {
    const msg = authError.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return {
        ok: false,
        message: "이미 등록된 로그인 정보입니다.",
        status: 409,
      };
    }
    if (msg.includes("database error")) {
      return {
        ok: false,
        message:
          "계정 생성 중 DB 오류가 발생했습니다. Supabase SQL Editor에서 마이그레이션 010_fix_handle_new_user_safe.sql 을 실행한 뒤, Authentication → Logs에서 상세 오류를 확인해 주세요. (아이디 중복·마이그레이션 미적용 가능)",
        status: 400,
      };
    }
    return { ok: false, message: authError.message, status: 400 };
  }

  if (!authData?.user) {
    return { ok: false, message: "계정 생성에 실패했습니다.", status: 400 };
  }

  const userId = authData.user.id;

  const syncResult = await syncProfileAfterAuthCreate(admin, userId, {
    name,
    email: internalEmail,
    role: input.role,
    username,
    createdBy: input.role === "student" ? input.createdBy ?? null : null,
    academyId: input.academyId ?? null,
  });

  if (!syncResult.ok) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (rollbackError) {
      console.error("[createManagedAccount] rollback failed:", rollbackError);
    }
    return syncResult;
  }

  const profile = syncResult.profile;

  return {
    ok: true,
    message: `${label} 계정이 생성되었습니다.`,
    profile: profile as Record<string, unknown>,
  };
}

export async function updateManagedAccount(
  admin: SupabaseClient,
  id: string,
  role: ManagedAccountRole,
  input: UpdateAccountInput
): Promise<Result<Record<string, unknown>>> {
  const label = ROLE_LABEL[role];

  let fetchQuery = admin
    .from("profiles")
    .select(PROFILE_SELECT_BASE)
    .eq("id", id)
    .eq("role", role);

  if (input.restrictToCreatorId) {
    fetchQuery = fetchQuery.eq("created_by", input.restrictToCreatorId);
  }
  if (input.restrictToAcademyId) {
    fetchQuery = fetchQuery.eq("academy_id", input.restrictToAcademyId);
  }

  let { data: current, error: fetchError } = await fetchQuery.single();

  if (
    fetchError &&
    input.restrictToCreatorId &&
    isMissingColumnError(fetchError.message, "created_by")
  ) {
    let fallbackQuery = admin
      .from("profiles")
      .select(PROFILE_SELECT_BASE)
      .eq("id", id)
      .eq("role", role);
    if (input.restrictToAcademyId) {
      fallbackQuery = fallbackQuery.eq("academy_id", input.restrictToAcademyId);
    }
    const fallback = await fallbackQuery.single();
    current = fallback.data;
    fetchError = fallback.error;
  }

  if (fetchError || !current) {
    return {
      ok: false,
      message: `${label} 계정을 찾을 수 없습니다.`,
      status: 404,
    };
  }

  const updates: {
    name?: string;
    username?: string;
    email?: string;
    is_active?: boolean;
  } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      return { ok: false, message: "이름을 입력해 주세요.", status: 400 };
    }
    updates.name = name;
  }

  if (input.is_active !== undefined) {
    updates.is_active = input.is_active;
  }

  if (input.allowUsernameChange && input.username !== undefined) {
    const username = normalizeUsername(input.username);
    if (!isValidUsername(username)) {
      return {
        ok: false,
        message: "아이디는 영문 소문자·숫자 3~32자로 입력해 주세요.",
        status: 400,
      };
    }

    if (username !== current.username) {
      const { data: taken } = await admin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .neq("id", id)
        .maybeSingle();

      if (taken) {
        return {
          ok: false,
          message: "이미 사용 중인 아이디입니다.",
          status: 409,
        };
      }

      const newEmail = toInternalEmail(username);
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(
        id,
        { email: newEmail }
      );

      if (authUpdateError) {
        return { ok: false, message: authUpdateError.message, status: 400 };
      }

      updates.username = username;
      updates.email = newEmail;
    }
  }

  if (Object.keys(updates).length === 0) {
    return {
      ok: true,
      message: "변경 사항이 없습니다.",
      profile: current as Record<string, unknown>,
    };
  }

  let profile: Record<string, unknown> | null = null;
  let updateError: { message: string } | null = null;

  const primaryUpdate = await admin
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select(PROFILE_SELECT_WITH_CREATED_BY)
    .single();

  profile = (primaryUpdate.data as Record<string, unknown> | null) ?? null;
  updateError = primaryUpdate.error;

  if (updateError && isMissingColumnError(updateError.message, "created_by")) {
    const fallback = await admin
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .select(PROFILE_SELECT_BASE)
      .single();
    profile = (fallback.data as Record<string, unknown> | null) ?? null;
    updateError = fallback.error;
  }

  if (updateError) {
    // 로그인 이메일은 이미 새 아이디로 바뀌었는데 프로필이 실패하면 옛·새 아이디 모두 로그인이 안 됐다
    // — 로그인 이메일을 원래대로 되돌린다(2026-11-28 점검)
    const oldEmail = (current as { email?: string | null } | null)?.email;
    if (typeof updates.email === "string" && oldEmail && oldEmail !== updates.email) {
      await admin.auth.admin.updateUserById(id, { email: oldEmail }).catch(() => undefined);
    }
    const hint = isMissingColumnError(updateError.message, "created_by")
      ? MIGRATION_HINT
      : "";
    return { ok: false, message: updateError.message + hint, status: 500 };
  }

  const message =
    updates.is_active === false
      ? "계정이 비활성화되었습니다."
      : updates.is_active === true
        ? "계정이 활성화되었습니다."
        : "저장되었습니다.";

  return {
    ok: true,
    message,
    profile: (profile ?? current) as Record<string, unknown>,
  };
}

export async function resetManagedAccountPassword(
  admin: SupabaseClient,
  id: string,
  role: ManagedAccountRole,
  password: string,
  options?: ResetPasswordOptions
): Promise<Result<null>> {
  const label = ROLE_LABEL[role];

  if (password.length < 6) {
    return {
      ok: false,
      message: "비밀번호는 6자 이상이어야 합니다.",
      status: 400,
    };
  }

  let accountQuery = admin
    .from("profiles")
    .select("id, role, academy_id")
    .eq("id", id)
    .eq("role", role);

  if (options?.restrictToCreatorId) {
    accountQuery = accountQuery.eq("created_by", options.restrictToCreatorId);
  }
  if (options?.restrictToAcademyId) {
    accountQuery = accountQuery.eq("academy_id", options.restrictToAcademyId);
  }

  let { data: account, error: accountError } = await accountQuery.single();

  if (
    accountError &&
    options?.restrictToCreatorId &&
    isMissingColumnError(accountError.message, "created_by")
  ) {
    let fallbackQuery = admin
      .from("profiles")
      .select("id, role, academy_id")
      .eq("id", id)
      .eq("role", role);
    if (options?.restrictToAcademyId) {
      fallbackQuery = fallbackQuery.eq(
        "academy_id",
        options.restrictToAcademyId
      );
    }
    const fallback = await fallbackQuery.single();
    account = fallback.data;
    accountError = fallback.error;
  }

  if (!account) {
    return {
      ok: false,
      message: `${label} 계정을 찾을 수 없습니다.`,
      status: 404,
    };
  }

  const { error } = await admin.auth.admin.updateUserById(id, { password });

  if (error) {
    return { ok: false, message: error.message, status: 400 };
  }

  return {
    ok: true,
    message: "비밀번호가 변경되었습니다.",
    profile: null,
  };
}

export async function deleteManagedAccount(
  admin: SupabaseClient,
  id: string,
  role: ManagedAccountRole,
  options?: ResetPasswordOptions
): Promise<Result<null>> {
  const label = ROLE_LABEL[role];

  let accountQuery = admin
    .from("profiles")
    .select("id, role, name, academy_id")
    .eq("id", id)
    .eq("role", role);

  if (options?.restrictToCreatorId) {
    accountQuery = accountQuery.eq("created_by", options.restrictToCreatorId);
  }
  if (options?.restrictToAcademyId) {
    accountQuery = accountQuery.eq("academy_id", options.restrictToAcademyId);
  }

  let { data: account, error: accountError } = await accountQuery.single();

  if (
    accountError &&
    options?.restrictToCreatorId &&
    isMissingColumnError(accountError.message, "created_by")
  ) {
    let fallbackQuery = admin
      .from("profiles")
      .select("id, role, name, academy_id")
      .eq("id", id)
      .eq("role", role);
    if (options?.restrictToAcademyId) {
      fallbackQuery = fallbackQuery.eq(
        "academy_id",
        options.restrictToAcademyId
      );
    }
    const fallback = await fallbackQuery.single();
    account = fallback.data;
    accountError = fallback.error;
  }

  if (accountError || !account) {
    return {
      ok: false,
      message: `${label} 계정을 찾을 수 없습니다.`,
      status: 404,
    };
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id);

  if (deleteError) {
    const msg = deleteError.message.toLowerCase();
    if (msg.includes("not found") || msg.includes("user not found")) {
      await admin.from("profiles").delete().eq("id", id).eq("role", role);
      return {
        ok: true,
        message: `${label} 계정이 삭제되었습니다.`,
        profile: null,
      };
    }
    return { ok: false, message: deleteError.message, status: 400 };
  }

  return {
    ok: true,
    message: `${label} 계정이 삭제되었습니다.`,
    profile: null,
  };
}
