import { NextResponse } from "next/server";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { chargeFeatureOrError, CREDIT_FEATURES } from "@/lib/credits/charge";
import { lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { openAiErrorMessage } from "@/lib/vocab/openai-error-message";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

export const maxDuration = 300;

interface RequestItem {
  word: string;
  meaning: string;
}

interface GeneratedItem extends RequestItem {
  synonyms: string;
  antonyms: string;
}

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
    const academyId = profile.academy_id;
    setAiUsage({
      academyId,
      actorId: profile.id,
      featureKey: CREDIT_FEATURES.vocab_generate_related,
      usedFor: "vocab_related_words",
    });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonError(
        "OPENAI_API_KEY가 설정되어 있지 않습니다. .env.local에 키를 추가한 뒤 개발 서버를 재시작해 주세요."
      );
    }

    const body = (await request.json()) as {
      items?: RequestItem[];
      kind?: "synonyms" | "antonyms" | "both";
    };
    const kind = body.kind ?? "both";
    const items = (body.items ?? []).filter(
      (i) => i.word?.trim() && i.meaning?.trim()
    );

    if (items.length === 0) {
      return jsonError("생성할 단어가 없습니다.");
    }

    // 값은 단어당(선생님 2026-10-26). 잔액이 모자라면 만들기 전에 알려 준다(차감은 아직 안 함)
    const shortfall = await lessonCreditShortfall(
      academyId,
      CREDIT_FEATURES.vocab_generate_related,
      items.length
    );
    if (shortfall) {
      return NextResponse.json(
        { ok: false, message: shortfall, code: "insufficient_credits" },
        { status: 402 }
      );
    }

    const fieldGuide =
      kind === "synonyms"
        ? `For each word, provide English synonyms ONLY when they are natural and useful for learners. Use 1–4 synonyms as needed (comma-separated). If there is no good synonym, return an empty string "". Do NOT invent weak/forced synonyms. Leave antonyms as "".`
        : kind === "antonyms"
          ? `For each word, provide English antonyms ONLY when they are clear and useful. Use 1–4 antonyms as needed (comma-separated). If there is no natural antonym, return "". Do NOT invent forced antonyms. Leave synonyms as "".`
          : `For each word, provide synonyms and/or antonyms ONLY when natural and useful for middle/high school learners.
- Synonyms: 0–4 words (comma-separated). Empty string if none fit well.
- Antonyms: 0–4 words (comma-separated). Empty string if none fit well.
- Do NOT force a fixed count of 2. Prefer quality over quantity.
- Do NOT invent weak near-synonyms or forced antonyms just to fill fields.`;

    const prompt = `You are an English vocabulary teacher for Korean students.

${fieldGuide}
Use words appropriate for middle/high school learners. Do not include inappropriate content.

Return ONLY valid JSON in this exact shape (no markdown):
{
  "items": [
    {
      "word": "exact word from input",
      "meaning": "exact meaning from input",
      "synonyms": "optional comma-separated list, or empty string",
      "antonyms": "optional comma-separated list, or empty string"
    }
  ]
}

Words to process:
${JSON.stringify(items.map((i) => ({ word: i.word.trim(), meaning: i.meaning.trim() })))}`;

    const response = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(280_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You output only valid JSON. Never include markdown fences or extra text.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error", response.status, errText);
      return jsonError(openAiErrorMessage(response.status, errText));
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return jsonError("AI 생성에 실패했습니다.");
    }

    let parsed: { items?: GeneratedItem[] };
    try {
      parsed = JSON.parse(content) as { items?: GeneratedItem[] };
    } catch {
      return jsonError("AI 응답을 해석하지 못했습니다.");
    }

    const generated = parsed.items ?? [];
    if (generated.length === 0) {
      return jsonError("AI가 결과를 반환하지 않았습니다. 다시 시도해 주세요.");
    }

    const byWord = new Map(
      generated.map((g) => [g.word.trim().toLowerCase(), g])
    );

    const result: GeneratedItem[] = items.map((item) => {
      const match = byWord.get(item.word.trim().toLowerCase());
      return {
        word: item.word.trim(),
        meaning: item.meaning.trim(),
        synonyms: match?.synonyms?.trim() ?? "",
        antonyms: match?.antonyms?.trim() ?? "",
      };
    });

    const filled = result.filter((r) =>
      kind === "synonyms"
        ? r.synonyms
        : kind === "antonyms"
          ? r.antonyms
          : r.synonyms || r.antonyms
    );
    if (filled.length === 0) {
      return jsonError("생성된 내용이 비어 있습니다. 다시 시도해 주세요.");
    }

    // 동의어나 반의어가 하나라도 채워진 단어 수만큼 차감
    const chargeErr = await chargeFeatureOrError({
      academyId,
      featureKey: CREDIT_FEATURES.vocab_generate_related,
      actorId: profile.id,
      // 이미 만든 결과라 잔액이 그 사이 모자라져도 차감하고 결과를 돌려준다
      allowNegative: true,
      idempotencyKey: `vocab_generate_related:${academyId}:${profile.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      metadata: { words: items.length, filled: filled.length, kind },
      quantity: filled.length,
    });
    await flushAiUsage();
    if (chargeErr) return chargeErr;
    return NextResponse.json({ ok: true, items: result, kind });
  } catch (err) {
    console.error("generate-related-words error", err);
    return jsonError("AI 생성에 실패했습니다.");
  }
}
