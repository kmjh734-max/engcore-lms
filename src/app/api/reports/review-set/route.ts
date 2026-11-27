import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { canViewStudentReport } from "@/lib/reports/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { bulkAssignSets } from "@/lib/vocab/bulk-assign-sets";

export const runtime = "nodejs";

const REVIEW_FOLDER = "복습 단어장";

/**
 * 학생이 틀린 단어(리포트의 복습할 단어)만 모아 새 단어장을 만든다 — 재시험지 출력·배정용.
 * 선생님 폴더 "복습 단어장"에 넣고, assign이면 그 학생에게 바로 배정한다(월 이용료는 배정 규칙대로).
 */
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
    return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
  }

  let body: { studentId?: string; itemIds?: string[]; assign?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const studentId = String(body.studentId ?? "");
  const itemIds = [...new Set((body.itemIds ?? []).map(String))].slice(0, 200);
  if (!studentId || itemIds.length === 0) {
    return NextResponse.json({ ok: false, message: "복습할 단어가 없어요." }, { status: 400 });
  }

  const supabase = await createClient();
  if (!(await canViewStudentReport(supabase, profile.role, profile.id, studentId))) {
    return NextResponse.json({ ok: false, message: "이 학생에게 접근할 수 없어요." }, { status: 403 });
  }

  const callerAcademyId = (profile.academy_id as string | null) ?? null;
  if (!callerAcademyId) {
    return NextResponse.json({ ok: false, message: "소속 학원 정보가 없습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const [{ data: student }, { data: items }] = await Promise.all([
    admin.from("profiles").select("name, academy_id").eq("id", studentId).maybeSingle(),
    // 우리 학원 단어장의 낱말만
    admin
      .from("vocab_items")
      .select("id, word, meaning, part_of_speech, example_sentence, example_meaning, synonyms, antonyms, vocab_sets!inner(academy_id)")
      .in("id", itemIds)
      .eq("vocab_sets.academy_id", callerAcademyId),
  ]);
  if (!items?.length) {
    return NextResponse.json({ ok: false, message: "단어를 찾지 못했어요." }, { status: 404 });
  }
  const academyId = (student?.academy_id as string | null) ?? (profile.academy_id as string | null) ?? null;

  // 선생님(또는 원장님)의 "복습 단어장" 폴더
  let { data: folder } = await admin
    .from("vocab_folders")
    .select("id")
    .eq("academy_id", academyId)
    .eq("teacher_id", profile.id)
    .eq("name", REVIEW_FOLDER)
    .maybeSingle();
  if (!folder) {
    const created = await admin
      .from("vocab_folders")
      .insert({ name: REVIEW_FOLDER, academy_id: academyId, teacher_id: profile.id, created_by: profile.id })
      .select("id")
      .single();
    if (created.error) {
      return NextResponse.json({ ok: false, message: "폴더를 만들지 못했어요." }, { status: 500 });
    }
    folder = created.data;
  }

  const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date());
  const title = `${(student?.name as string) || "학생"} 복습 ${today.replace(/\s/g, "")} (${items.length}단어)`;
  const { data: set, error: setError } = await admin
    .from("vocab_sets")
    .insert({
      title,
      teacher_id: profile.id,
      created_by: profile.id,
      is_published: true,
      academy_id: academyId,
      folder_id: folder!.id,
      order_index: Math.floor(Date.now() / 1000),
    })
    .select("id")
    .single();
  if (setError || !set) {
    return NextResponse.json({ ok: false, message: "단어장을 만들지 못했어요." }, { status: 500 });
  }

  // 리포트에 나온 차례대로
  const order = new Map(itemIds.map((id, i) => [id, i]));
  const rows = [...items]
    .sort((a, b) => (order.get(a.id as string) ?? 0) - (order.get(b.id as string) ?? 0))
    .map((it, i) => ({
      set_id: set.id,
      word: it.word,
      meaning: it.meaning,
      part_of_speech: it.part_of_speech,
      example_sentence: it.example_sentence,
      example_meaning: it.example_meaning,
      synonyms: it.synonyms,
      antonyms: it.antonyms,
      order_index: i + 1,
    }));
  const ins = await admin.from("vocab_items").insert(rows);
  if (ins.error) {
    await admin.from("vocab_sets").delete().eq("id", set.id);
    return NextResponse.json({ ok: false, message: "단어를 넣지 못했어요." }, { status: 500 });
  }

  let assignMessage: string | null = null;
  if (body.assign) {
    const result = await bulkAssignSets(supabase, [set.id as string], profile.id, { studentIds: [studentId] });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message, setId: set.id }, { status: 400 });
    }
    assignMessage = "학생에게 배정했어요.";
  }

  const base = profile.role === "admin" ? "/admin" : "/teacher";
  return NextResponse.json({
    ok: true,
    setId: set.id,
    title,
    message: assignMessage ?? "복습 단어장을 만들었어요.",
    printUrl: `${base}/vocab/print?${new URLSearchParams({ sets: set.id as string, mode: "exam", back: `${base}/reports` })}`,
  });
}
