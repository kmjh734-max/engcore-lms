import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  buildPassageVocabPrompt,
  normalizePassageVocabItems,
} from "@/lib/vocab/extract-passage-vocabulary";
import { openAiErrorMessage } from "@/lib/vocab/openai-error-message";
import {
  chargeFeatureOrError,
  CREDIT_FEATURES,
} from "@/lib/credits/charge";
import { lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

export const maxDuration = 120;

function jsonError(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return jsonError("권한이 없습니다.", 403);
    }

    if (!profile.academy_id) {
      return NextResponse.json(
        { ok: false, message: "소속 학원 정보가 없습니다.", code: "no_academy" },
        { status: 403 }
      );
    }

    // 1) 입력 확인 — 크레딧은 단어를 실제로 뽑은 뒤에만 차감한다
    let body: { passage?: string; idempotencyKey?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("요청을 읽지 못했어요. 다시 해 주세요.");
    }
    const passage = typeof body.passage === "string" ? body.passage.trim() : "";

    if (passage.length < 30) {
      return jsonError("지문이 너무 짧습니다. 영어 지문을 더 입력해 주세요.");
    }
    if (passage.length > 12000) {
      return jsonError("지문이 너무 깁니다. 12,000자 이하로 입력해 주세요.");
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonError(
        "OPENAI_API_KEY가 설정되어 있지 않습니다. .env.local에 키를 추가한 뒤 개발 서버를 재시작해 주세요."
      );
    }

    // 2) 잔액이 모자라면 만들기 전에 알려 준다(차감은 아직 안 함)
    const shortfall = await lessonCreditShortfall(
      profile.academy_id,
      CREDIT_FEATURES.vocab_extract_passage
    );
    if (shortfall) {
      return NextResponse.json(
        { ok: false, message: shortfall, code: "insufficient_credits" },
        { status: 402 }
      );
    }
    setAiUsage({
      academyId: profile.academy_id,
      actorId: profile.id,
      featureKey: CREDIT_FEATURES.vocab_extract_passage,
      usedFor: "vocab",
    });

    const response = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(110_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You output only valid JSON. Never include markdown fences or extra text.",
          },
          { role: "user", content: buildPassageVocabPrompt(passage) },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI passage extract error", response.status, errText);
      return jsonError(openAiErrorMessage(response.status, errText));
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return jsonError("단어 추출에 실패했습니다.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return jsonError("결과를 읽지 못했어요. 다시 해 주세요.");
    }

    const items = normalizePassageVocabItems(parsed);
    if (items.length === 0) {
      return jsonError("추출된 단어가 없습니다. 지문을 확인해 주세요.");
    }

    // 3) 쓸 수 있는 단어가 나왔을 때만 차감
    const clientKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim().slice(0, 120)
        : null;
    const chargeErr = await chargeFeatureOrError({
      academyId: profile.academy_id,
      featureKey: CREDIT_FEATURES.vocab_extract_passage,
      actorId: profile.id,
      // 이미 만든 결과라 잔액이 그 사이 모자라져도 차감하고 결과를 돌려준다
      allowNegative: true,
      idempotencyKey: clientKey
        ? `vocab_extract_passage:${profile.id}:${clientKey}`
        : `vocab_extract_passage:${profile.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      metadata: { words: items.length },
    });
    if (chargeErr) return chargeErr;

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("extract-from-passage error", err);
    return jsonError("단어 추출에 실패했습니다.");
  }
}
