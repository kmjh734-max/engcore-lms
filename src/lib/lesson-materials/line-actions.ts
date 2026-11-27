"use server";

import { getCurrentProfile } from "@/lib/auth/get-profile";
import { translateEnglishLinesToKorean } from "@/lib/lesson-materials/translate-lines";
import {
  LESSON_CREDIT_FEATURES,
  refundLessonCredits,
  reserveLessonCredits,
} from "@/lib/credits/lesson-credits";
import { flushAiUsage, withAiUsage } from "@/lib/ai-usage/context";

export async function translateLessonMaterialLinesAction(input: {
  lines: string[];
}): Promise<{ ok: true; korean: string[] } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
    return { ok: false, message: "권한이 필요합니다." };
  }
  if (profile.role === "teacher" && profile.is_active === false) {
    return { ok: false, message: "비활성화된 계정입니다." };
  }

  const lines = (input.lines ?? []).map((l) => String(l ?? "").trim());
  if (lines.length === 0 || lines.some((l) => !l)) {
    return { ok: false, message: "번역할 영어 문장이 없습니다." };
  }

  /*
   * 선생님 지적(2026-09-29): "API를 쓰는 곳은 모두 크레딧을 쓰도록 해야 해."
   * 여기는 모델을 부르는데 값을 안 받고 있었다. 값을 먼저 잡아 두고 만든다.
   */
  const hold = await reserveLessonCredits({
    academyId: profile.academy_id!,
    actorId: profile.id,
    featureKey: LESSON_CREDIT_FEATURES.lineTranslate,
    metadata: { used_for: "lesson_pack", lines: lines.length },
    note: `문장 해석 다시 만들기 · ${lines.length}문장`,
  });
  if (!hold.ok) return { ok: false, message: hold.message };

  try {
    const korean = await withAiUsage(
      {
        academyId: profile.academy_id,
        actorId: profile.id,
        featureKey: LESSON_CREDIT_FEATURES.lineTranslate,
        usedFor: "lesson_pack",
      },
      () => translateEnglishLinesToKorean(lines)
    );
    await flushAiUsage();
    return { ok: true, korean };
  } catch (e) {
    await refundLessonCredits({
      academyId: profile.academy_id!,
      actorId: profile.id,
      amount: hold.charged,
      reservationKey: hold.idempotencyKey,
      note: "문장 해석을 만들지 못해 되돌림",
    });
    return {
      ok: false,
      message: e instanceof Error ? e.message : "한줄해석 생성에 실패했습니다.",
    };
  }
}
