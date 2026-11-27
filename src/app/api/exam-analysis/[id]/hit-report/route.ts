import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { debitLessonCredits, lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { buildHitReport } from "@/lib/exam-analysis/hit-report";
import type { ExamItemRow } from "@/lib/exam-analysis/types";
import { requireMaterialMatch } from "@/lib/exam-analysis/access";

export const runtime = "nodejs";
export const maxDuration = 300;

const FEATURE = "exam_hit_report";

/**
 * 학교 시험지와 내가 만든 자료를 대조한다.
 *
 * 화면을 열 때마다 돌리면 지문 수천 개를 매번 훑어 느리고 헛일이다(2026-10-01).
 * 눌렀을 때만 돌리고 결과를 담아 둔다. 자료를 더 만든 뒤 다시 누르면 새로 담긴다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || (profile.role !== "admin" && profile.role !== "teacher")) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  const closed = await requireMaterialMatch(profile.academy_id);
  if (closed) return closed;
  const supabase = await createClient();
  const { data: analysis } = await supabase
    .from("school_exam_analyses")
    .select("id, academy_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!analysis || analysis.academy_id !== profile.academy_id) {
    return NextResponse.json({ ok: false, message: "시험 분석을 찾을 수 없습니다." }, { status: 404 });
  }

  const shortfall = await lessonCreditShortfall(profile.academy_id, FEATURE);
  if (shortfall) return NextResponse.json({ ok: false, message: shortfall }, { status: 402 });

  const admin = createAdminClient();
  const { data: items } = await admin
    .from("school_exam_items")
    .select("*")
    .eq("analysis_id", id)
    .order("order_index");
  if (!items?.length) {
    return NextResponse.json({ ok: false, message: "문항표가 아직 없습니다." }, { status: 400 });
  }

  // 선생님이 올리신 자료에서 뽑은 글(화면 쪽에서 읽어 보낸다)
  let uploads: Array<{ name: string; text: string }> = [];
  try {
    const body = (await req.json()) as { uploads?: Array<{ name?: string; text?: string }> };
    uploads = (body.uploads ?? [])
      .map((u) => ({ name: String(u.name ?? "올린 자료"), text: String(u.text ?? "") }))
      .filter((u) => u.text.trim().length > 40)
      .slice(0, 20);
  } catch {
    // 몸체가 없으면 올린 자료 없이 돈다
  }

  const report = await buildHitReport(
    admin,
    profile.academy_id,
    items as ExamItemRow[],
    // 시험지를 올리기 전에 만든 자료만 적중으로 센다
    (analysis.created_at as string) ?? null,
    uploads
  );

  const at = new Date().toISOString();
  const { error: saveErr } = await admin
    .from("school_exam_analyses")
    .update({ hit_report: report, hit_report_at: at })
    .eq("id", id);
  // 담지 못했으면 값을 받지 않는다(다시 누르면 처음부터 돈다)
  if (saveErr) {
    console.error("[hit-report] save failed", id, saveErr.message);
    return NextResponse.json(
      { ok: false, message: "대조 결과를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  // 만든 뒤에 받는다(후불) — 돌다 실패하면 값이 나가지 않는다
  await debitLessonCredits({
    academyId: profile.academy_id,
    actorId: profile.id,
    featureKey: FEATURE,
    projectId: id,
    idempotencyKey: `${FEATURE}:${id}:${at}`,
    metadata: { analysis_id: id, used_for: "exam_hit_report" },
    note: `시험지 적중 대조 ${report.total}문항${uploads.length ? ` · 올린 자료 ${uploads.length}개` : ""}`,
  });

  return NextResponse.json({ ok: true, report, at });
}
