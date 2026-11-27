import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertListeningSetAccess } from "@/lib/listening/listening-api-auth";
import {
  ensureSegmentFilesExist,
  mergeQuestionAudioFromSegments,
} from "@/lib/listening/merge-segments-audio";

export const maxDuration = 60;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

/** segment mp3만 이어 붙여 final.mp3 생성 (TTS 없음) */
export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return jsonError("권한이 없습니다.", 403);
    }

    const body = (await request.json()) as { setId?: string; questionId?: string };
    const setId = body.setId?.trim();
    const questionId = body.questionId?.trim();
    if (!setId || !questionId) {
      return jsonError("setId와 questionId가 필요합니다.");
    }

    const access = await assertListeningSetAccess(setId);
    if (!access.ok) return jsonError(access.message, access.status);
    const setRow = access.setRow;

    if (
      profile.role === "teacher" &&
      setRow.teacher_id !== profile.id &&
      setRow.created_by !== profile.id
    ) {
      return jsonError("권한이 없습니다.", 403);
    }

    const admin = createAdminClient();
    const { data: qRow } = await admin
      .from("listening_questions")
      .select("id")
      .eq("id", questionId)
      .eq("set_id", setId)
      .maybeSingle();
    if (!qRow) return jsonError("이 세트의 문항이 아닙니다.", 403);

    await ensureSegmentFilesExist(setId, questionId);
    const audioUrl = await mergeQuestionAudioFromSegments({ setId, questionId });

    return NextResponse.json({ ok: true, audioUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "병합 실패";
    return jsonError(message);
  }
}
