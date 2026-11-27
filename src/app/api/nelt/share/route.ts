import { NextResponse } from "next/server";
import { requireNeltStaff } from "@/lib/nelt/require-nelt-staff";
import { CREDIT_FEATURES } from "@/lib/credits";
import { debitLessonCredits, lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { flushAiUsage, setAiUsage } from "@/lib/ai-usage/context";
import { buildNeltGrowthAnalysis } from "@/lib/nelt/compare/build-growth";
import { upsertNeltGrowthReport } from "@/lib/nelt/upsert-growth-report";
import { resolveNeltShareAttempts } from "@/lib/nelt/resolve-share-attempts";
import {
  buildNeltShareUrl,
  generateShareToken,
  resolveShareBaseUrl,
  shareExpiresAt,
} from "@/lib/nelt/share-token";
import {
  attachReportUrlToMessage,
  buildNeltParentMessageFallback,
  ensureNeltMessageTitle,
  generateNeltParentMessageAi,
  type NeltParentMessageMeta,
} from "@/lib/nelt/generate-parent-message";
import {
  applyAiNarratives,
  generateNeltReportNarrativesAi,
  parseStoredNarratives,
} from "@/lib/nelt/generate-report-narratives";
import { getAcademyBranding } from "@/lib/tenant/academy-branding";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NeltGrowthAnalysis } from "@/lib/nelt/compare/types";

export const runtime = "nodejs";
export const maxDuration = 90;

/** 학부모용 공유 링크 생성 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = await requireNeltStaff();
  if (!auth.ok) return auth.error;

  let body: {
    studentName?: string;
    parentMessage?: string;
    analysis?: NeltGrowthAnalysis;
    meta?: NeltParentMessageMeta;
    reportIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "요청 본문이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const studentName =
    body.studentName?.trim() || body.analysis?.studentName?.trim() || "";
  if (!studentName) {
    return NextResponse.json(
      { ok: false, message: "학생 이름이 필요합니다." },
      { status: 400 }
    );
  }

  // 링크 2개 이상 분석 = 성장 리포트 (미저장 미리보기면 자동 저장)
  const resolved = await resolveNeltShareAttempts(auth.supabase, {
    academyId: auth.academyId,
    createdBy: auth.profile.id,
    studentName,
    analysis: body.analysis,
    reportIds: body.reportIds,
  });
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, message: resolved.message },
      { status: 400 }
    );
  }

  const attempts = resolved.attempts;
  const analysis = buildNeltGrowthAnalysis(studentName, attempts);
  if (!analysis || analysis.attemptCount < 2) {
    return NextResponse.json(
      {
        ok: false,
        message: "결과 링크를 2개 이상 분석한 뒤 다시 시도해 주세요.",
      },
      { status: 400 }
    );
  }

  // 클라이언트가 이미 AI 서술을 갖고 있으면 스냅샷에만 유지(회차 지문 일치 시)
  if (
    body.analysis?.aiNarratives &&
    body.analysis.attemptCount === analysis.attemptCount &&
    body.analysis.start.attemptNumber === analysis.start.attemptNumber &&
    body.analysis.end.attemptNumber === analysis.end.attemptNumber
  ) {
    analysis.aiNarratives = body.analysis.aiNarratives;
    Object.assign(analysis, {
      overallNarrative:
        body.analysis.overallNarrative || analysis.overallNarrative,
      strengthsNarrative:
        body.analysis.strengthsNarrative || analysis.strengthsNarrative,
      stableNarrative:
        body.analysis.stableNarrative || analysis.stableNarrative,
      nextGoalsNarrative:
        body.analysis.nextGoalsNarrative || analysis.nextGoalsNarrative,
    });
  }

  const growth = await upsertNeltGrowthReport(auth.supabase, {
    academyId: auth.academyId,
    studentName,
    createdBy: auth.profile.id,
    attempts,
    reportIds: attempts.map((a) => a.id),
  });
  if (!growth.ok) {
    return NextResponse.json(
      { ok: false, message: growth.message },
      { status: 400 }
    );
  }

  // 학부모 공개 스냅샷에 AI 서술 포함
  let snapshotAnalysis = analysis;
  const { data: growthRow } = await auth.supabase
    .from("nelt_growth_reports")
    .select("generated_summary")
    .eq("id", growth.growthId)
    .maybeSingle();
  let narratives =
    analysis.aiNarratives ??
    parseStoredNarratives(growthRow?.generated_summary);
  // 공유 시에도 저장된 서술이 있으면 재생성하지 않음
  if (!narratives?.overallSummary?.trim()) {
    const shortfall = await lessonCreditShortfall(auth.academyId, CREDIT_FEATURES.nelt_report_narratives);
    if (shortfall) {
      return NextResponse.json({ ok: false, message: shortfall }, { status: 402 });
    }
    setAiUsage({
      academyId: auth.academyId,
      actorId: auth.profile.id,
      featureKey: CREDIT_FEATURES.nelt_report_narratives,
      usedFor: "nelt",
    });
    const generated = await generateNeltReportNarrativesAi(analysis);
    narratives = generated.narratives;
    if (generated.ok) {
      await debitLessonCredits({
        academyId: auth.academyId,
        actorId: auth.profile.id,
        featureKey: CREDIT_FEATURES.nelt_report_narratives,
        note: `NELT 성장 리포트 서술 · ${analysis.studentName}`,
      });
    }
    await auth.supabase
      .from("nelt_growth_reports")
      .update({
        generated_summary: JSON.stringify(narratives),
        updated_at: new Date().toISOString(),
      })
      .eq("id", growth.growthId);
  }
  if (narratives) {
    snapshotAnalysis = {
      ...applyAiNarratives(analysis, narratives),
      aiNarratives: narratives,
    };
  }

  // 안내문에는 공유하는 선생님의 학원 이름을 쓴다.
  const meta: NeltParentMessageMeta = {
    academyName: (await getAcademyBranding(auth.profile.academy_id)).name,
    ...(body.meta ?? {}),
  };

  let parentMessage = body.parentMessage?.trim() || "";
  if (!parentMessage) {
    const shortfall = await lessonCreditShortfall(auth.academyId, CREDIT_FEATURES.nelt_parent_message);
    if (shortfall) {
      return NextResponse.json({ ok: false, message: shortfall }, { status: 402 });
    }
    // 라우트 한도 90초 — 서술 생성에 쓴 시간을 빼고 남은 만큼만 기다린다(넘으면 규칙 안내문으로 공유는 그대로)
    const leftMs = Math.max(10_000, 82_000 - (Date.now() - startedAt));
    const ai = await generateNeltParentMessageAi(
      snapshotAnalysis,
      meta,
      undefined,
      AbortSignal.timeout(leftMs)
    );
    if (ai.ok) {
      await debitLessonCredits({
        academyId: auth.academyId,
        actorId: auth.profile.id,
        featureKey: CREDIT_FEATURES.nelt_parent_message,
        note: `NELT 학부모 안내문 · ${snapshotAnalysis.studentName}`,
      });
    }
    parentMessage = ai.ok
      ? ai.message
      : buildNeltParentMessageFallback(snapshotAnalysis, meta);
  }
  parentMessage = ensureNeltMessageTitle(parentMessage);

  const token = generateShareToken();
  const expiresAt = shareExpiresAt(30);
  const shareUrl = buildNeltShareUrl(token, resolveShareBaseUrl());
  parentMessage = attachReportUrlToMessage(parentMessage, shareUrl);

  await auth.supabase
    .from("nelt_growth_reports")
    .update({
      parent_message: parentMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", growth.growthId);

  const admin = createAdminClient();

  const { error } = await admin.from("nelt_shared_reports").insert({
    academy_id: auth.academyId,
    growth_report_id: growth.growthId,
    token,
    expires_at: expiresAt,
    created_by: auth.profile.id,
    parent_message: parentMessage,
    report_snapshot: snapshotAnalysis as unknown as Record<string, unknown>,
    student_name_raw: studentName,
  });

  if (error) {
    console.error("[nelt/share]", error.message);
    return NextResponse.json(
      {
        ok: false,
        message:
          error.message.includes("parent_message") ||
          error.message.includes("report_snapshot")
            ? "공유 테이블 마이그레이션(100)이 필요합니다."
            : "공유 링크 생성에 실패했습니다.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    shareUrl,
    token,
    expiresAt,
    parentMessage,
  });
}

/** 공개 조회 (토큰) */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "토큰이 없습니다." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("nelt_shared_reports")
    .select(
      "token, expires_at, parent_message, report_snapshot, student_name_raw, academy_id"
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "리포트를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { ok: false, message: "만료된 공유 링크입니다." },
      { status: 410 }
    );
  }

  return NextResponse.json({
    ok: true,
    studentName: data.student_name_raw,
    parentMessage: data.parent_message,
    analysis: data.report_snapshot,
    expiresAt: data.expires_at,
  });
}
