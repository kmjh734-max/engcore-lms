import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuestionAudio } from "@/lib/listening/generate-audio";
import { EXAM_DEFAULT_SPEECH_SPEED } from "@/lib/listening/speech-speed";
import { CREDIT_FEATURES } from "@/lib/credits/charge";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import {
  adjustAcademyCredits,
  creditsErrorResponse,
  debitFeatureCredits,
} from "@/lib/credits";
import { assertListeningSetWritable } from "@/lib/listening/listening-api-auth";

export const maxDuration = 180;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return jsonError("권한이 없습니다.", 403);
    }

    const body = (await request.json()) as {
      setId?: string;
      questionId?: string;
      segmentId?: string;
      speed?: number;
      speechSpeed?: number;
    };

    const setId = body.setId?.trim();
    const questionId = body.questionId?.trim();
    if (!setId || !questionId) {
      return jsonError("setId와 questionId가 필요합니다.");
    }

    const writable = await assertListeningSetWritable(setId);
    if (!writable.ok) return jsonError(writable.message, writable.status);

    const admin = createAdminClient();
    const { data: question, error: qErr } = await admin
      .from("listening_questions")
      .select("id, set_id")
      .eq("id", questionId)
      .eq("set_id", setId)
      .maybeSingle();

    if (qErr || !question) {
      return jsonError("문항을 찾을 수 없습니다.");
    }

    const { data: setRow } = await admin
      .from("listening_sets")
      .select("teacher_id, created_by, speech_speed")
      .eq("id", setId)
      .maybeSingle();

    if (
      profile.role === "teacher" &&
      setRow &&
      setRow.teacher_id !== profile.id &&
      setRow.created_by !== profile.id
    ) {
      return jsonError("이 세트에 대한 권한이 없습니다.", 403);
    }

    const speechSpeed =
      typeof body.speed === "number"
        ? body.speed
        : typeof body.speechSpeed === "number"
          ? body.speechSpeed
          : typeof setRow?.speech_speed === "number"
            ? setRow.speech_speed
            : EXAM_DEFAULT_SPEECH_SPEED;

    // 문항·권한을 다 확인한 뒤 차감하고, 음성을 못 만들면 되돌려 준다.
    const chargeKey = `listening_generate_audio:${questionId}:${Date.now()}`;
    if (!profile.academy_id) {
      return NextResponse.json(
        { ok: false, message: "소속 학원 정보가 없습니다.", code: "no_academy" },
        { status: 403 }
      );
    }
    // 실제로 차감한 만큼만 되돌리려고 차감 결과를 받아 둔다(무료 학원·가격 꺼짐이면 0).
    let chargedAmount = 0;
    try {
      const debit = await debitFeatureCredits(admin, {
        academyId: profile.academy_id,
        featureKey: CREDIT_FEATURES.listening_generate_audio,
        actorId: profile.id,
        idempotencyKey: chargeKey,
        metadata: { set_id: setId, question_id: questionId },
      });
      if (!debit.skipped && debit.transaction) {
        chargedAmount = Math.abs(Number(debit.transaction.amount) || 0);
      }
    } catch (err) {
      const mapped = creditsErrorResponse(err);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    setAiUsage({
      academyId: profile.academy_id,
      actorId: profile.id,
      featureKey: CREDIT_FEATURES.listening_generate_audio,
      usedFor: "listening",
    });

    let result: Awaited<ReturnType<typeof generateQuestionAudio>>;
    try {
      result = await generateQuestionAudio({
        setId,
        questionId,
        segmentId: body.segmentId?.trim() || undefined,
        speechSpeed,
      });
    } catch (genErr) {
      if (chargedAmount > 0) {
        await adjustAcademyCredits(admin, {
          academyId: profile.academy_id,
          amount: chargedAmount,
          direction: "grant",
          actorId: profile.id,
          note: "듣기 음성 만들기 실패 — 차감 취소",
          idempotencyKey: `refund:${chargeKey}`,
        }).catch((e) => console.error("[generate-audio] refund failed", e));
      }
      throw genErr;
    }

    return NextResponse.json({
      ok: true,
      questionId,
      audioUrl: result.audioUrl,
      provider: result.provider,
      stage: "uploaded",
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "음원 생성에 실패했습니다.";
    return jsonError(message);
  }
}
