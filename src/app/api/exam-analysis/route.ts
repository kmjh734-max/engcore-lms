import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { requireExamStaff } from "@/lib/exam-analysis/access";
import { loadExamAnalyses } from "@/lib/exam-analysis/load";

export const runtime = "nodejs";

/** 새 시험지 분석 시작 { pageCount, schoolName?, grade?, subject?, examLabel? } */
export async function POST(request: Request) {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const { profile } = auth;
  const body = (await request.json().catch(() => ({}))) as {
    pageCount?: number;
    schoolName?: string;
    grade?: string;
    subject?: string;
    examLabel?: string;
    matchMaterials?: boolean;
  };
  const pageCount = Math.floor(Number(body.pageCount) || 0);
  if (pageCount < 1 || pageCount > 20) {
    return NextResponse.json({ ok: false, message: "시험지는 1~20쪽까지 올릴 수 있어요." }, { status: 400 });
  }
  const shortfall = await lessonCreditShortfall(profile.academy_id, "school_exam_analysis");
  if (shortfall) return NextResponse.json({ ok: false, message: shortfall, code: "insufficient_credits" }, { status: 402 });

  // 쪽 읽기는 값을 분석이 끝날 때 받으므로, 끝내지 않은 분석을 끝없이 만들지 못하게 하루 테두리를 둔다(2026-11-28).
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = () =>
    createAdminClient()
      .from("school_exam_analyses")
      .select("id", { count: "exact", head: true })
      .eq("academy_id", profile.academy_id)
      .gte("created_at", since);
  // 업로드 실패로 reading 에 남은 분석도 세어지므로 넉넉히 잡는다(보통 학원은 하루 몇 건).
  const [{ count: dayCount }, { count: unfinished }] = await Promise.all([recent(), recent().eq("status", "reading")]);
  if ((dayCount ?? 0) >= 300 || (unfinished ?? 0) >= 150) {
    return NextResponse.json(
      { ok: false, message: "하루에 올릴 수 있는 시험지 수를 넘었어요. 내일 다시 올려 주세요.", code: "daily_limit" },
      { status: 429 }
    );
  }

  const clean = (s?: string) => (s ?? "").trim().slice(0, 60) || null;
  const { data, error } = await createAdminClient()
    .from("school_exam_analyses")
    .insert({
      academy_id: profile.academy_id,
      created_by: profile.id,
      page_count: pageCount,
      school_name: clean(body.schoolName),
      grade: clean(body.grade),
      subject: clean(body.subject),
      exam_label: clean(body.examLabel),
      match_materials: body.matchMaterials !== false,
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ ok: false, message: "분석을 시작하지 못했어요." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

/** 동형모의고사에 쓸 분석 목록(분석이 끝난 것만, 최근 것부터) */
export async function GET() {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const list = await loadExamAnalyses(auth.profile.academy_id);
  return NextResponse.json({
    ok: true,
    analyses: list
      .filter((a) => a.status === "ready")
      .map((a) => ({
        id: a.id,
        title: [a.school_name ?? "학교 미입력", a.grade ? `${a.grade}학년` : "", a.subject].filter(Boolean).join(" "),
        exam: a.exam_label,
        items: a.counts.n,
        subjective: a.counts.subj,
        created_at: a.created_at,
      })),
  });
}
