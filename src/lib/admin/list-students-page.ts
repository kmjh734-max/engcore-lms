import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export const STUDENTS_PAGE_SIZE = 50;

export type StudentStatusFilter = "all" | "active" | "inactive";

/** 학생 등록 때 같이 받은 신상 정보 — 목록·수정 창·학생 창에 보여 준다 */
export interface StudentListDetails {
  phone: string | null;
  parentPhone: string | null;
  school: string | null;
  schoolGrade: string | null;
  birthDate: string | null;
  enrolledOn: string | null;
}

export interface StudentListRow extends StudentListDetails {
  id: string;
  name: string;
  username: string | null;
  email: string;
  is_active: boolean;
  classNames: string[];
  courseCount: number;
}

export interface StudentsPageData {
  rows: StudentListRow[];
  classOptions: { id: string; name: string }[];
  courseOptions: { id: string; title: string }[];
  page: number;
  total: number;
  pageSize: number;
}

export interface StudentsPageFilters {
  page?: number;
  search?: string;
  classId?: string;
  status?: StudentStatusFilter;
}

export function parseStudentFilters(sp: {
  page?: string;
  q?: string;
  class?: string;
  status?: string;
}): Required<StudentsPageFilters> {
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "all";
  return {
    page: Math.max(1, Number(sp.page) || 1),
    search: sp.q?.trim() ?? "",
    classId: sp.class?.trim() ?? "",
    status,
  };
}

/** PostgREST or() 안에서 문제를 일으키는 글자를 뺀다 */
function safeTerm(term: string): string {
  return term.replace(/[,()*%"\\]/g, " ").trim();
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * 학생·수강 목록 한 페이지. 이름·아이디 검색, 반, 상태로 거른다.
 * 관리자는 학원 전체(RLS), 강사는 scope로 좁힌다.
 */
export async function loadStudentsPageData(
  supabase: SupabaseClient,
  filters: StudentsPageFilters,
  scope: {
    createdBy?: string;
    classTeacherId?: string;
    courseTeacherId?: string;
    /** 강사 화면: 내가 등록한 학생 + 내 반 학생 (같은 학원 안에서) */
    teacherVisible?: { teacherId: string; academyId: string };
  } = {}
): Promise<StudentsPageData> {
  const page = Math.max(1, filters.page ?? 1);
  const search = safeTerm(filters.search ?? "");
  const from = (page - 1) * STUDENTS_PAGE_SIZE;
  const to = from + STUDENTS_PAGE_SIZE - 1;

  let classQuery = supabase.from("classes").select("id, name").order("name");
  if (scope.classTeacherId) classQuery = classQuery.eq("teacher_id", scope.classTeacherId);
  // 새로 배정할 때는 휴지통·보관 강좌를 고를 수 없다(2026-09-28)
  let courseQuery = supabase
    .from("courses")
    .select("id, title")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("title")
    .limit(500);
  if (scope.courseTeacherId) courseQuery = courseQuery.eq("teacher_id", scope.courseTeacherId);

  const [{ data: classData }, { data: courseData }, classMembers] = await Promise.all([
    classQuery,
    courseQuery,
    filters.classId
      ? supabase
          .from("class_students")
          .select("student_id")
          .eq("class_id", filters.classId)
          .limit(2000)
          .then(({ data }) => (data ?? []).map((r) => r.student_id as string))
      : Promise.resolve(null),
  ]);

  const classOptions = (classData ?? []) as { id: string; name: string }[];
  const courseOptions = (courseData ?? []) as { id: string; title: string }[];
  const empty: StudentsPageData = {
    rows: [],
    classOptions,
    courseOptions,
    page,
    total: 0,
    pageSize: STUDENTS_PAGE_SIZE,
  };
  if (classMembers && classMembers.length === 0) return empty;

  let list = supabase
    .from("profiles")
    .select(
      "id, name, username, email, is_active, phone, parent_phone, school, school_grade, birth_date, enrolled_on",
      { count: "exact" },
    )
    .eq("role", "student");
  if (scope.createdBy) list = list.eq("created_by", scope.createdBy);
  if (scope.teacherVisible) {
    const { teacherId, academyId } = scope.teacherVisible;
    // 서버는 한 번에 1,000줄까지 — 끝까지 넘겨 읽는다
    const mine = await fetchAllRows<{ student_id: string }>((from, to) =>
      supabase
        .from("class_students")
        .select("student_id, classes!inner(teacher_id, is_active)")
        .eq("classes.teacher_id", teacherId)
        .eq("classes.is_active", true)
        .order("class_id")
        .order("student_id")
        .range(from, to)
    ).catch(() => [] as { student_id: string }[]);
    const memberIds = [...new Set(mine.map((r) => r.student_id as string))];
    list = list.eq("academy_id", academyId);
    list = memberIds.length
      ? list.or(`created_by.eq.${teacherId},id.in.(${memberIds.join(",")})`)
      : list.eq("created_by", teacherId);
  }
  if (search) list = list.or(`name.ilike.*${search}*,username.ilike.*${search}*`);
  if (filters.status === "active") list = list.eq("is_active", true);
  if (filters.status === "inactive") list = list.eq("is_active", false);
  if (classMembers) list = list.in("id", classMembers);

  const { data: students, count } = await list.order("name").range(from, to);
  type Raw = Omit<StudentListRow, "classNames" | "courseCount" | keyof StudentListDetails> & {
    phone: string | null;
    parent_phone: string | null;
    school: string | null;
    school_grade: string | null;
    birth_date: string | null;
    enrolled_on: string | null;
  };
  const raw = (students ?? []) as Raw[];
  // 선생님 지적(2026-10-23): 전화번호를 넣었는데 화면에 안 뜬다 — 목록이 아예 읽지 않고 있었다
  const base = raw.map(({ phone, parent_phone, school, school_grade, birth_date, enrolled_on, ...rest }) => ({
    ...rest,
    phone: phone ?? null,
    parentPhone: parent_phone ?? null,
    school: school ?? null,
    schoolGrade: school_grade ?? null,
    birthDate: birth_date ?? null,
    enrolledOn: enrolled_on ?? null,
  }));
  if (base.length === 0) return { ...empty, total: count ?? 0 };

  const ids = base.map((s) => s.id);
  const [{ data: links }, { data: enrollments }] = await Promise.all([
    supabase
      .from("class_students")
      .select("student_id, class:classes(name)")
      .in("student_id", ids),
    fetchAllRows<{ student_id: string }>((from, to) =>
      supabase.from("enrollments").select("student_id").in("student_id", ids).order("id").range(from, to)
    ).then((data) => ({ data }), () => ({ data: null })),
  ]);

  const classNames = new Map<string, string[]>();
  for (const l of links ?? []) {
    const name = one(l.class as { name: string } | { name: string }[] | null)?.name;
    if (!name) continue;
    const sid = l.student_id as string;
    classNames.set(sid, [...(classNames.get(sid) ?? []), name]);
  }
  const courseCount = new Map<string, number>();
  for (const e of enrollments ?? []) {
    const sid = e.student_id as string;
    courseCount.set(sid, (courseCount.get(sid) ?? 0) + 1);
  }

  return {
    ...empty,
    total: count ?? base.length,
    rows: base.map((s) => ({
      ...s,
      classNames: (classNames.get(s.id) ?? []).sort((a, b) => a.localeCompare(b, "ko")),
      courseCount: courseCount.get(s.id) ?? 0,
    })),
  };
}
