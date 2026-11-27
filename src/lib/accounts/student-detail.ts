"use server";

import { getCurrentProfile } from "@/lib/auth/get-profile";
import { getTodayIsoKorea } from "@/lib/date/korea-today";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export interface StudentDetailEnrollment {
  id: string;
  courseId: string;
  title: string;
  percent: number;
  /** 반에 배정된 강좌라서 자동으로 들어온 경우 */
  fromClass: boolean;
}

/** 학생에게 붙어 있는 단어장·듣기 세트 한 줄 */
export interface StudentDetailAssignment {
  /** 개별 배정이면 그 줄의 id, 반에서 온 것이면 null */
  id: string | null;
  setId: string;
  title: string;
  /** 반에 배정돼서 따라온 것 */
  fromClass: boolean;
}

export interface StudentDetail {
  classes: { id: string; name: string }[];
  enrollments: StudentDetailEnrollment[];
  vocab: StudentDetailAssignment[];
  listening: StudentDetailAssignment[];
  week: {
    /** 이번 주 듣기 과제가 있던 날 중 끝낸 날 */
    listening: { done: number; total: number } | null;
    /** 이번 주 끝낸 단어 단계 수 */
    vocabStages: number;
    /** 이번 주 다 본 영상 수 */
    videoLessons: number;
  };
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function weekStartIso(todayIso: string): string {
  const d = new Date(`${todayIso}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

/** 학생 창에 보여 줄 반·수강 강좌·이번 주 학습 (RLS로 볼 수 있는 만큼) */
export async function loadStudentDetail(
  studentId: string
): Promise<{ ok: true; detail: StudentDetail } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "teacher")) {
    return { ok: false, message: "볼 수 있는 권한이 없어요." };
  }
  if (!studentId) return { ok: false, message: "학생을 찾지 못했어요." };

  const supabase = await createClient();
  const todayIso = getTodayIsoKorea();
  const weekIso = weekStartIso(todayIso);
  const weekUtc = new Date(`${weekIso}T00:00:00+09:00`).toISOString();

  const [classRes, enrollRes, progressRes, taskRes, vocabRes] = await Promise.all([
    supabase
      .from("class_students")
      .select("class_id, class:classes(id, name)")
      .eq("student_id", studentId),
    supabase
      .from("enrollments")
      .select("id, course_id, created_at, course:courses(title)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: true }),
    // 서버는 한 번에 1,000줄까지 — 끝까지 넘겨 읽는다
    fetchAllRows<{ lesson_id: string; is_completed: boolean | null; completed_at: string | null }>((from, to) =>
      supabase
        .from("lesson_progress")
        .select("lesson_id, is_completed, completed_at")
        .eq("student_id", studentId)
        .order("lesson_id")
        .range(from, to)
    ).then((data) => ({ data }), () => ({ data: null })),
    supabase
      .from("listening_daily_tasks")
      .select("task_date, status")
      .eq("student_id", studentId)
      .gte("task_date", weekIso)
      .lte("task_date", todayIso),
    supabase
      .from("vocab_stage_progress")
      .select("stage1_completed_at, stage2_completed_at, stage3_completed_at, stage4_passed_at")
      .eq("student_id", studentId)
      .gte("updated_at", weekUtc),
  ]);

  const classes = (classRes.data ?? [])
    .map((r) => one(r.class as { id: string; name: string } | { id: string; name: string }[] | null))
    .filter((c): c is { id: string; name: string } => Boolean(c));
  const classIds = classes.map((c) => c.id);

  const enrollRows = (enrollRes.data ?? []) as Array<{
    id: string;
    course_id: string;
    course: { title: string } | { title: string }[] | null;
  }>;
  const courseIds = enrollRows.map((e) => e.course_id);

  const [classCourseRes, lessonRes] = await Promise.all([
    classIds.length && courseIds.length
      ? supabase
          .from("class_courses")
          .select("course_id")
          .in("class_id", classIds)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [] as { course_id: string }[] }),
    courseIds.length
      ? fetchAllRows<{ id: string; course_id: string }>((from, to) =>
          supabase
            .from("lessons")
            .select("id, course_id")
            .in("course_id", courseIds)
            .eq("is_published", true)
            .order("id")
            .range(from, to)
        ).then((data) => ({ data }), () => ({ data: null }))
      : Promise.resolve({ data: [] as { id: string; course_id: string }[] }),
  ]);

  const classCourseIds = new Set((classCourseRes.data ?? []).map((r) => r.course_id as string));
  const lessonsByCourse = new Map<string, string[]>();
  for (const l of (lessonRes.data ?? []) as { id: string; course_id: string }[]) {
    const list = lessonsByCourse.get(l.course_id) ?? [];
    list.push(l.id);
    lessonsByCourse.set(l.course_id, list);
  }
  const progress = (progressRes.data ?? []) as Array<{
    lesson_id: string;
    is_completed: boolean;
    completed_at: string | null;
  }>;
  const completedLessons = new Set(
    progress.filter((p) => p.is_completed).map((p) => p.lesson_id)
  );

  const enrollments: StudentDetailEnrollment[] = enrollRows.map((e) => {
    const lessons = lessonsByCourse.get(e.course_id) ?? [];
    const done = lessons.filter((id) => completedLessons.has(id)).length;
    return {
      id: e.id,
      courseId: e.course_id,
      title: one(e.course)?.title ?? "강좌",
      percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
      fromClass: classCourseIds.has(e.course_id),
    };
  });

  const dayDone = new Map<string, boolean>();
  for (const t of (taskRes.data ?? []) as { task_date: string; status: string }[]) {
    dayDone.set(t.task_date, (dayDone.get(t.task_date) ?? true) && t.status === "completed");
  }
  const listening = dayDone.size
    ? { done: [...dayDone.values()].filter(Boolean).length, total: dayDone.size }
    : null;

  let vocabStages = 0;
  for (const r of (vocabRes.data ?? []) as Record<string, string | null>[]) {
    for (const key of [
      "stage1_completed_at",
      "stage2_completed_at",
      "stage3_completed_at",
      "stage4_passed_at",
    ]) {
      const v = r[key];
      if (v && v >= weekUtc) vocabStages += 1;
    }
  }

  const videoLessons = progress.filter(
    (p) => p.is_completed && p.completed_at && p.completed_at >= weekUtc
  ).length;

  const { vocab, listening: listeningSets } = await loadAssignments(
    supabase,
    studentId,
    classIds
  );

  return {
    ok: true,
    detail: {
      classes,
      enrollments,
      vocab,
      listening: listeningSets,
      week: { listening, vocabStages, videoLessons },
    },
  };
}

/** 세트 이름을 id로만 읽어 온다. 한 번에 200개씩 끊어 묻는다. */
async function titlesByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "vocab_sets" | "listening_sets",
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from(table).select("id, title").in("id", chunk);
    for (const r of (data ?? []) as { id: string; title: string | null }[]) {
      if (r.title) map.set(String(r.id), String(r.title));
    }
  }
  return map;
}

/**
 * 이 학생에게 붙어 있는 단어장·듣기 세트.
 *
 * 2026-09-28: 세트 이름을 학원 전체에서 300개만 읽어 오다 보니, 그 밖의 세트는
 * 이름을 못 찾아 전부 「단어장」으로 보였다(선생님 지적). 이제 붙어 있는 세트의
 * id로만 이름을 읽는다.
 */
async function loadAssignments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  classIds: string[]
): Promise<{
  vocab: StudentDetailAssignment[];
  listening: StudentDetailAssignment[];
}> {
  const [vocabMine, vocabClass, listenMine, listenClass] = await Promise.all([
    supabase.from("vocab_assignments").select("id, set_id").eq("student_id", studentId).is("class_id", null),
    classIds.length
      ? supabase.from("vocab_assignments").select("set_id").in("class_id", classIds)
      : Promise.resolve({ data: [] as { set_id: string }[] }),
    supabase.from("listening_assignments").select("id, set_id").eq("student_id", studentId),
    classIds.length
      ? supabase.from("listening_assignments").select("set_id").in("class_id", classIds)
      : Promise.resolve({ data: [] as { set_id: string }[] }),
  ]);

  const vocabIds = [
    ...new Set(
      [...(vocabMine.data ?? []), ...(vocabClass.data ?? [])].map((r) => String(r.set_id))
    ),
  ];
  const listenIds = [
    ...new Set(
      [...(listenMine.data ?? []), ...(listenClass.data ?? [])].map((r) => String(r.set_id))
    ),
  ];
  const [vocabTitle, listenTitle] = await Promise.all([
    titlesByIds(supabase, "vocab_sets", vocabIds),
    titlesByIds(supabase, "listening_sets", listenIds),
  ]);

  const build = (
    mine: { id?: string; set_id: string }[],
    fromClass: { set_id: string }[],
    titles: Map<string, string>,
    fallback: string,
  ): StudentDetailAssignment[] => {
    const out: StudentDetailAssignment[] = [];
    const seen = new Set<string>();
    for (const r of fromClass) {
      const sid = String(r.set_id);
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: null, setId: sid, title: titles.get(sid) ?? fallback, fromClass: true });
    }
    for (const r of mine) {
      const sid = String(r.set_id);
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: r.id ? String(r.id) : null, setId: sid, title: titles.get(sid) ?? fallback, fromClass: false });
    }
    return out;
  };

  return {
    vocab: build(
      (vocabMine.data ?? []) as { id: string; set_id: string }[],
      (vocabClass.data ?? []) as { set_id: string }[],
      vocabTitle,
      "이름 없는 단어장"
    ),
    listening: build(
      (listenMine.data ?? []) as { id: string; set_id: string }[],
      (listenClass.data ?? []) as { set_id: string }[],
      listenTitle,
      "이름 없는 듣기 세트"
    ),
  };
}
