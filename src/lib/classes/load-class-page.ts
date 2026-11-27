import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countClassVocabSets,
  loadClassListeningSchedules,
  loadClassStudentStats,
  type ClassListeningSchedule,
  type ClassMember,
  type ClassStudentStat,
} from "@/lib/classes/load-class-detail";
import { unwrapRelation } from "@/lib/progress/enrollment-progress";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export type ClassTab = "students" | "courses" | "settings";

export function parseClassTab(value: string | undefined): ClassTab {
  return value === "courses" || value === "settings" ? value : "students";
}

export interface StudentOption {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
}

export interface ClassPageData {
  classId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  room: string;
  teacherId: string | null;
  teacherName: string | null;
  members: ClassMember[];
  courses: { id: string; course_id: string; title: string }[];
  studentOptions: StudentOption[];
  vocabSetCount: number;
  todayIso: string;
  /** 학생 탭에서만 */
  stats: ClassStudentStat[] | null;
  /** 강좌·교재 탭에서만 */
  courseOptions: { id: string; title: string; is_published: boolean }[] | null;
  schedules: ClassListeningSchedule[] | null;
  /** 설정 탭 담당 강사 고르기 */
  teachers: { id: string; name: string }[];
}

/** 반 상세 한 화면 — 지금 연 탭에 필요한 것만 더 읽는다 */
export async function loadClassPageData(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: {
    variant: "admin" | "teacher";
    viewerId: string;
    classId: string;
    tab: ClassTab;
    todayIso: string;
  }
): Promise<ClassPageData | null> {
  const { variant, viewerId, classId, tab, todayIso } = params;

  let classQuery = supabase
    .from("classes")
    .select(
      "id, name, description, is_active, weekdays, start_time, end_time, room, teacher_id, academy_id, teacher:profiles!classes_teacher_id_fkey(id, name)"
    )
    .eq("id", classId);
  if (variant === "teacher") classQuery = classQuery.eq("teacher_id", viewerId);
  const { data: classRow } = await classQuery.maybeSingle();
  if (!classRow) return null;

  const teacher = unwrapRelation(
    classRow.teacher as { id: string; name: string } | { id: string; name: string }[] | null
  );

  // 반에 넣을 학생은 같은 학원 학생 모두에서 고른다 (원장님이 등록한 학생도 강사가 반에 넣을 수 있게)
  // 서버는 한 번에 1,000줄까지 — 큰 학원도 끝까지 넘겨 읽는다
  const studentQuery = fetchAllRows<{ id: string; name: string; username: string | null; email: string | null }>((from, to) =>
    admin
      .from("profiles")
      .select("id, name, username, email")
      .eq("role", "student")
      .eq("is_active", true)
      .eq("academy_id", classRow.academy_id as string)
      .order("name")
      .order("id")
      .range(from, to)
  ).then((data) => ({ data }), () => ({ data: null }));

  const [{ data: memberRows }, { data: courseRows }, { data: studentRows }, vocabSetCount] =
    await Promise.all([
      // 반은 위에서 확인했다. 원장님이 등록한 학생 이름도 보이게 서버에서 읽는다
      admin
        .from("class_students")
        .select(
          "id, student_id, student:profiles!class_students_student_id_fkey(name, username)"
        )
        .eq("class_id", classId)
        .order("created_at"),
      supabase
        .from("class_courses")
        .select("id, course_id, course:courses(title)")
        .eq("class_id", classId)
        .order("created_at"),
      studentQuery,
      countClassVocabSets(supabase, classId),
    ]);

  const members: ClassMember[] = (memberRows ?? []).map((m) => {
    const student = unwrapRelation(
      m.student as
        | { name: string; username: string | null }
        | { name: string; username: string | null }[]
        | null
    );
    return {
      id: m.id as string,
      studentId: m.student_id as string,
      name: student?.name ?? "—",
      username: student?.username ?? null,
    };
  });

  const courses = (courseRows ?? []).map((cc) => ({
    id: cc.id as string,
    course_id: cc.course_id as string,
    title:
      unwrapRelation(cc.course as { title: string } | { title: string }[] | null)?.title ?? "—",
  }));

  const base: ClassPageData = {
    classId,
    name: classRow.name as string,
    description: (classRow.description as string | null) ?? null,
    isActive: Boolean(classRow.is_active),
    weekdays: ((classRow as { weekdays?: number[] | null }).weekdays ?? []).map(Number),
    // "18:30:00" → "18:30" (시간 입력 칸이 쓰는 꼴)
    startTime: String((classRow as { start_time?: string | null }).start_time ?? "").slice(0, 5),
    endTime: String((classRow as { end_time?: string | null }).end_time ?? "").slice(0, 5),
    room: String((classRow as { room?: string | null }).room ?? ""),
    teacherId: (classRow.teacher_id as string | null) ?? null,
    teacherName: teacher?.name ?? null,
    members,
    courses,
    studentOptions: (studentRows ?? []) as StudentOption[],
    vocabSetCount,
    todayIso,
    stats: null,
    courseOptions: null,
    schedules: null,
    teachers: teacher ? [{ id: teacher.id, name: teacher.name }] : [],
  };

  if (tab === "students") {
    base.stats = await loadClassStudentStats(supabase, admin, {
      classId,
      members,
      courseIds: courses.map((c) => c.course_id),
      todayIso,
    });
  } else if (tab === "courses") {
    // 휴지통·보관 강좌는 반에 새로 배정할 수 없다(2026-09-28)
    let courseQuery = supabase
      .from("courses")
      .select("id, title, is_published")
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("title");
    if (variant === "teacher") courseQuery = courseQuery.eq("teacher_id", viewerId);
    const [{ data: options }, schedules] = await Promise.all([
      courseQuery,
      loadClassListeningSchedules(admin, classId, todayIso),
    ]);
    base.courseOptions = (options ?? []) as ClassPageData["courseOptions"];
    base.schedules = schedules;
  } else if (variant === "admin") {
    const { data: teachers } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("role", "teacher")
      .eq("is_active", true)
      .order("name");
    const list = (teachers ?? []) as { id: string; name: string }[];
    // 담당 강사가 비활성이어도 고르기 칸에서 사라지지 않게
    if (teacher && !list.some((t) => t.id === teacher.id)) list.push(teacher);
    base.teachers = list;
  }

  return base;
}
