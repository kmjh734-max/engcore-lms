import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  payloadPassageIds,
  reorderPayloadByPassage,
  sortProjectIdsByPassageOrder,
} from "@/lib/lesson-materials/passage-order";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 만든 워크북 결과를 워크북 파일(lesson_material_documents.payload)에 저장한다.
 *
 * 서버 액션이 아니라 API 라우트인 이유: 지문 여러 개·유형 여러 개 워크북은 JSON이
 * 서버 액션 본문 상한(1MB)을 넘을 수 있다. 권한은 로그인 사용자의 역할을 확인하고,
 * 행 소유는 RLS(선생님은 자기 파일, 관리자는 자기 학원)가 가린다.
 */
export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
      return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
    }
    if (!profile.academy_id) {
      return NextResponse.json({ ok: false, message: "소속 학원 정보가 없습니다." });
    }
    const body = (await request.json()) as { id?: string; workbook?: unknown };
    const id = String(body.id ?? "").trim();
    if (!id || !body.workbook || typeof body.workbook !== "object") {
      return NextResponse.json({ ok: false, message: "저장할 워크북이 없습니다." });
    }
    const supabase = await createClient();
    // 지문별 칸은 늘 폴더 차례로 저장한다(선생님 2026-11-06: 나중에 붙인 지문·누른 차례로 섞였다)
    const { data: row } = await supabase
      .from("lesson_material_documents")
      .select("project_ids")
      .eq("id", id)
      .eq("kind", "workbook")
      .maybeSingle();
    const projectIds = await sortProjectIdsByPassageOrder(supabase, [
      ...((row?.project_ids as string[] | null) ?? []),
      ...payloadPassageIds(body.workbook),
    ]);
    const workbook = reorderPayloadByPassage(body.workbook, projectIds);
    const { data, error } = await supabase
      .from("lesson_material_documents")
      .update({ payload: workbook, ...(projectIds.length ? { project_ids: projectIds } : {}), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("kind", "workbook")
      .eq("academy_id", profile.academy_id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, message: error.message });
    if (!data) return NextResponse.json({ ok: false, message: "워크북 파일을 찾을 수 없습니다." });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      message: e instanceof Error ? e.message : "워크북을 저장하지 못했습니다.",
    });
  }
}
