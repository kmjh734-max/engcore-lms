import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createManagedAccount } from "@/lib/admin/manage-user";
import { isValidUsername, normalizeUsername } from "@/lib/auth/username";
import { cloneListeningCurriculumToAcademy } from "@/lib/listening/clone-curriculum";
import { cloneVocabCurriculumToAcademy } from "@/lib/vocab/clone-curriculum";
import { grantAcademyCredits } from "@/lib/credits";

/** 처음 가입하면 드리는 무료 크레딧 (1크레딧 = 1원) */
const SIGNUP_BONUS_CREDITS = 2000;

export const runtime = "nodejs";
// 가입 뒤 듣기·단어 교재를 복사한다(응답은 먼저 보내고 뒤에서 채운다).
export const maxDuration = 300;

/**
 * 학원 회원가입 — 원장님이 직접 가입하면 학원과 관리자 계정을 만들고 교재를 복사한다.
 * 예전에는 운영자가 학원을 만들어 줘야만 쓸 수 있었다.
 */

// 같은 곳에서 짧은 시간에 가입을 몰아 하지 못하게 (서버 한 대 안에서의 간단한 제한)
const recent = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

/** 학원 주소(영문). 아이디를 바탕으로 만들고, 겹치면 숫자를 붙인다 */
async function uniqueSlug(admin: ReturnType<typeof createAdminClient>, base: string): Promise<string> {
  const root = base.replace(/[^a-z0-9]/g, "").slice(0, 20) || "academy";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}${i + 1}`;
    const { data } = await admin.from("academies").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${root}${Date.now().toString(36)}`;
}

export async function POST(request: Request) {
  let body: {
    memberType?: "academy" | "personal";
    academyName?: string;
    ownerName?: string;
    username?: string;
    password?: string;
    phone?: string;
    email?: string;
    agreeTerms?: boolean;
    agreePrivacy?: boolean;
    agreeAge?: boolean;
    website?: string; // 사람은 채우지 않는 칸(자동 가입 막기)
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("요청을 읽지 못했어요. 다시 해 주세요.");
  }

  if (body.website) return jsonError("가입하지 못했어요.");
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (tooMany(ip)) return jsonError("잠시 뒤에 다시 가입해 주세요.", 429);

  const memberType = body.memberType === "personal" ? "personal" : "academy";
  const ownerName = (body.ownerName ?? "").trim();
  // 개인회원은 학원 이름 대신 "이름 선생님"으로 만든다 (자료 머리글·로그인 화면에 쓰인다)
  const academyName =
    memberType === "personal" ? `${ownerName} 선생님`.slice(0, 40) : (body.academyName ?? "").trim();
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const phone = (body.phone ?? "").replace(/[^0-9-]/g, "").trim();
  const email = (body.email ?? "").trim().toLowerCase();

  if (!academyName || academyName.length > 40) return jsonError("학원·공부방·교습소 이름을 40자 안으로 입력해 주세요.");
  if (!ownerName || ownerName.length > 20) return jsonError("이름을 입력해 주세요.");
  if (!isValidUsername(username)) return jsonError("아이디는 영문 소문자·숫자 3~32자로 입력해 주세요.");
  if (password.length < 8) return jsonError("비밀번호는 8자 이상으로 입력해 주세요.");
  if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(phone)) return jsonError("연락처를 휴대폰 번호 형식으로 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("이메일 주소를 확인해 주세요.");
  if (!body.agreeTerms || !body.agreePrivacy || !body.agreeAge) {
    return jsonError("필수 약관에 모두 동의해 주세요.");
  }

  const admin = createAdminClient();

  // 1) 학원
  const slug = await uniqueSlug(admin, username);
  const signupInfo = {
    member_type: memberType,
    owner_name: ownerName,
    contact_email: email,
    agreed_at: new Date().toISOString(),
    agreed: { terms: true, privacy: true, age14: true },
    ip,
  };
  const { data: academy, error: academyError } = await admin
    .from("academies")
    .insert({
      name: academyName,
      slug,
      phone,
      primary_color: "#2563EB",
      secondary_color: "#2563EB",
      status: "active",
      // 가입 축하 크레딧 자리를 먼저 잡아 둔다(bonus: claimed) — 같은 IP에서 동시에 가입해도
      // 서로의 자리를 보게 되어 두 곳 모두에 주지 않는다.
      settings: { signup: ip === "unknown" ? signupInfo : { ...signupInfo, bonus: "claimed" } },
    })
    .select("id, slug")
    .single();
  if (academyError || !academy) return jsonError("학원을 만들지 못했어요. 잠시 뒤 다시 해 주세요.", 500);

  // 2) 원장님 계정 (학원 관리자)
  const created = await createManagedAccount(admin, {
    name: ownerName,
    username,
    password,
    role: "admin",
    academyId: academy.id as string,
  });
  if (!created.ok) {
    await admin.from("academies").delete().eq("id", academy.id);
    return jsonError(created.message, created.status ?? 400);
  }
  const ownerId = String(created.profile.id ?? "");

  // 3) 가입 축하 크레딧 — 같은 학원에 두 번, 같은 IP에 두 번 주지 않는다
  //    (한 곳에서 계정을 여러 개 만들어 무료 크레딧만 받아 가는 것을 막는다)
  //    자리를 잡은(claimed) 곳이나 받은(granted) 곳이 같은 IP에 하나라도 있으면 주지 않는다.
  //    동시에 둘이 가입하면 둘 다 못 받을 수는 있어도 둘 다 받지는 않는다. 조회가 실패해도 주지 않는다.
  let bonusGranted = false;
  const { data: sameIp, error: sameIpError } =
    ip === "unknown"
      ? { data: [{ id: "x" }], error: null }
      : await admin
          .from("academies")
          .select("id")
          .eq("settings->signup->>ip", ip)
          .in("settings->signup->>bonus", ["granted", "claimed"])
          .neq("id", academy.id)
          .limit(1);
  const bonusAllowed = !sameIpError && (sameIp ?? []).length === 0;
  if (ip !== "unknown" && (!ownerId || !bonusAllowed)) {
    await admin
      .from("academies")
      .update({ settings: { signup: { ...signupInfo, bonus: "skipped" } } })
      .eq("id", academy.id);
  }
  if (ownerId && bonusAllowed) {
    try {
      await grantAcademyCredits(admin, {
        academyId: academy.id as string,
        amount: SIGNUP_BONUS_CREDITS,
        actorId: ownerId,
        note: "가입 축하 무료 크레딧",
        idempotencyKey: `signup_bonus:${academy.id}`,
      });
      bonusGranted = true;
      await admin
        .from("academies")
        .update({ settings: { signup: { ...signupInfo, bonus: "granted" } } })
        .eq("id", academy.id);
    } catch (e) {
      console.error("[signup] bonus credits failed", e);
      if (!bonusGranted) {
        await admin
          .from("academies")
          .update({ settings: { signup: { ...signupInfo, bonus: "failed" } } })
          .eq("id", academy.id);
      }
    }
  }

  // 4) 교재 복사는 뒤에서 (수십 초 걸린다)
  if (ownerId) {
    const targetAcademyId = academy.id as string;
    after(async () => {
      try {
        await cloneListeningCurriculumToAcademy({ targetAcademyId, ownerProfileId: ownerId });
        await cloneVocabCurriculumToAcademy({ targetAcademyId, ownerProfileId: ownerId });
      } catch (e) {
        console.error("[signup] curriculum clone failed", e);
      }
    });
  }

  return NextResponse.json({ ok: true, academySlug: academy.slug, username, bonusGranted });
}
