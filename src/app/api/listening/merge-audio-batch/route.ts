import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertListeningSetAccess } from "@/lib/listening/listening-api-auth";
import {
  ensureSegmentFilesExist,
  mergeQuestionAudioFromSegments,
} from "@/lib/listening/merge-segments-audio";

export const maxDuration = 120;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

/** 세트 전체: segment → final.mp3 병합만 (TTS 없음) */
export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return jsonError("권한이 없습니다.", 403);
    }

    const body = (await request.json()) as { setId?: string };
    const setId = body.setId?.trim();
    if (!setId) return jsonError("setId가 필요합니다.");

    const access = await assertListeningSetAccess(setId);
    if (!access.ok) return jsonError(access.message, access.status);

    const admin = createAdminClient();
    const { data: questions, error } = await admin
      .from("listening_questions")
      .select("id, order_index")
      .eq("set_id", setId)
      .order("order_index");

    if (error || !questions?.length) {
      return jsonError("문항이 없습니다.");
    }

    const results: Array<{
      orderIndex: number;
      ok: boolean;
      audioUrl?: string;
      message?: string;
    }> = [];

    for (const q of questions) {
      try {
        await ensureSegmentFilesExist(setId, q.id);
        const audioUrl = await mergeQuestionAudioFromSegments({
          setId,
          questionId: q.id,
        });
        results.push({ orderIndex: q.order_index, ok: true, audioUrl });
      } catch (e) {
        results.push({
          orderIndex: q.order_index,
          ok: false,
          message: e instanceof Error ? e.message : "병합 실패",
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: okCount > 0,
      message: `${okCount}/${results.length}개 문항 final.mp3 병합 완료`,
      results,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "일괄 병합 실패");
  }
}
