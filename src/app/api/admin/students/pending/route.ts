import { NextResponse } from "next/server";
import { adminJsonError, getAdminClientSafe } from "@/lib/admin/api-json";
import { requireAdminApi } from "@/lib/auth/require-admin-api";
import { regenerateJoinCode } from "@/lib/academy/join-code";

export const runtime = "nodejs";

/** 스스로 가입한 학생 승인·거절, 가입 코드 새로 만들기 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdminApi();
    if ("error" in auth && auth.error) return auth.error;

    const clientResult = getAdminClientSafe();
    if (!clientResult.ok) return clientResult.response;
    const admin = clientResult.admin;
    const academyId = auth.profile.academy_id;
    if (!academyId) return adminJsonError("소속 학원 정보가 없습니다.", 403);

    const body = (await request.json().catch(() => ({}))) as {
      studentId?: string;
      action?: "approve" | "reject" | "new-code";
    };

    if (body.action === "new-code") {
      const code = await regenerateJoinCode(admin, academyId);
      return NextResponse.json({ ok: true, code });
    }

    const studentId = String(body.studentId ?? "");
    if (!studentId) return adminJsonError("학생을 찾을 수 없습니다.", 400);

    // 우리 학원의 승인 대기 학생만 건드린다
    const { data: student } = await admin
      .from("profiles")
      .select("id, academy_id, role, approved_at")
      .eq("id", studentId)
      .maybeSingle();
    if (!student || student.academy_id !== academyId || student.role !== "student") {
      return adminJsonError("우리 학원의 학생이 아닙니다.", 403);
    }

    if (body.action === "approve") {
      const { error: upErr } = await admin
        .from("profiles")
        .update({ approved_at: new Date().toISOString(), approved_by: auth.profile.id })
        .eq("id", studentId);
      if (upErr) return adminJsonError("승인하지 못했어요. 다시 해 주세요.", 500);
      return NextResponse.json({ ok: true, message: "승인했어요." });
    }

    if (body.action === "reject") {
      // 이미 승인된 학생은 지우지 않는다 — 다른 관리자가 먼저 승인했거나 화면이 오래된 경우
      // 공부하던 계정과 기록이 통째로 지워졌다(2026-11-28 점검)
      if (student.approved_at) {
        return adminJsonError("이미 승인된 학생이에요. 화면을 새로 고쳐 주세요.", 409);
      }
      // 아직 아무 기록도 없는 계정이라 지운다
      const { error: delErr } = await admin.auth.admin.deleteUser(studentId);
      if (delErr && !/not.?found/i.test(delErr.message)) {
        return adminJsonError("거절하지 못했어요. 다시 해 주세요.", 500);
      }
      await admin.from("profiles").delete().eq("id", studentId).is("approved_at", null);
      return NextResponse.json({ ok: true, message: "가입을 거절했어요." });
    }

    return adminJsonError("알 수 없는 요청입니다.", 400);
  } catch (error) {
    console.error("[POST /api/admin/students/pending]", error);
    return adminJsonError("처리하지 못했습니다.", 500);
  }
}
