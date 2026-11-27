import { NextResponse } from "next/server";
import { pageRows } from "@/lib/supabase/fetch-all-rows";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * 배정 창에서 "무엇을 배정할지" 고르는 목록 — 단어장 전체와 폴더.
 *
 * 선생님 요청(2026-09-28): 배정할 때 폴더별·세트별로 고르게 해 달라.
 * 그러려면 배정 창이 고른 단어장만이 아니라 전체 목록을 알아야 한다.
 * 강사는 자기 단어장만 본다(다른 화면과 같은 기준).
 */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 401 });
  }

  const supabase = await createClient();
  // 지문마다 단어장이 생겨 1000개를 넘으면 뒤쪽 단어장이 빠져 폴더째 배정이 일부만 됐다 — 끝까지 읽는다
  const setsQuery = pageRows<{ id: string; title: string; folder_id: string | null }>((from, to) =>
    (profile.role === "admin"
      ? supabase.from("vocab_sets").select("id, title, folder_id")
      : supabase
          .from("vocab_sets")
          .select("id, title, folder_id")
          .or(`teacher_id.eq.${profile.id},created_by.eq.${profile.id}`)
    )
      .order("title")
      .order("id")
      .range(from, to)
  );

  const [setsRes, foldersRes] = await Promise.all([
    setsQuery,
    supabase.from("vocab_folders").select("id, name").order("name"),
  ]);

  if (setsRes.error) {
    return NextResponse.json({ ok: false, message: "단어장을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sets: (setsRes.data ?? []).map((s) => ({
      id: s.id as string,
      title: (s.title as string) ?? "",
      folderId: (s.folder_id as string | null) ?? null,
    })),
    folders: (foldersRes.data ?? []).map((f) => ({ id: f.id as string, name: (f.name as string) ?? "" })),
  });
}
