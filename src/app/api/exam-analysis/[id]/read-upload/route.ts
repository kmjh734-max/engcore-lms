import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { readMaterialImage } from "@/lib/exam-analysis/read-page";
import { setAiUsage, flushAiUsage } from "@/lib/ai-usage/context";
import { requireMaterialMatch } from "@/lib/exam-analysis/access";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 선생님이 올리신 자료의 쪽 그림을 읽는다(스캔본일 때만 쓴다).
 *
 * PDF에 글자가 들어 있으면 화면 쪽에서 공짜로 뽑으므로 여기까지 오지 않는다. 스캔본도
 * 화면 쪽 무료 읽기로 지문이 있는 쪽을 고른 뒤 그 쪽만 보낸다(2026-10-02).
 * 값은 적중 대조(exam_hit_report, 1,500)에 들어 있으므로 여기서 따로 받지 않는다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || (profile.role !== "admin" && profile.role !== "teacher")) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }
  const closed = await requireMaterialMatch(profile.academy_id);
  if (closed) return closed;
  const admin = createAdminClient();
  const { data: analysis } = await admin
    .from("school_exam_analyses")
    .select("id, academy_id")
    .eq("id", id)
    .maybeSingle();
  if (!analysis || analysis.academy_id !== profile.academy_id) {
    return NextResponse.json({ ok: false, message: "시험 분석을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = (await req.json()) as { dataUrl?: string; label?: string };
  const dataUrl = String(body.dataUrl ?? "");
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > 6_000_000) {
    return NextResponse.json({ ok: false, message: "그림을 받지 못했습니다." }, { status: 400 });
  }

  setAiUsage({
    academyId: profile.academy_id,
    actorId: profile.id,
    featureKey: "exam_hit_report",
    usedFor: "exam_hit_report_upload",
    projectId: id,
  });
  try {
    const { text } = await readMaterialImage(dataUrl, String(body.label ?? "올린 자료"));
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "읽지 못했습니다." },
      { status: 500 }
    );
  } finally {
    await flushAiUsage();
  }
}
