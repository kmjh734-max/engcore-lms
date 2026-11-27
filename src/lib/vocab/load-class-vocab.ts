import type { SupabaseClient } from "@supabase/supabase-js";
import { pageRows } from "@/lib/supabase/fetch-all-rows";
import type {
  ClassStudentVocabRow,
  VocabSetOption,
} from "@/components/vocab/ClassVocabPanel";

export async function loadClassVocabPanelData(
  supabase: SupabaseClient,
  role: "admin" | "teacher",
  userId: string,
  classId: string
): Promise<{
  students: ClassStudentVocabRow[];
  setOptions: VocabSetOption[];
}> {
  const [membersRes, assignmentsRes, setsRes] = await Promise.all([
    supabase
      .from("class_students")
      .select(
        "student_id, student:profiles!class_students_student_id_fkey(id, name)"
      )
      .eq("class_id", classId)
      .order("created_at"),
    // 반 학생 × 세트, 학원 단어장 모두 1000개를 넘을 수 있다 — 끝까지 읽는다
    pageRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("vocab_assignments")
        .select("id, set_id, student_id, set:vocab_sets(id, title)")
        .eq("class_id", classId)
        .not("student_id", "is", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    pageRows<Record<string, unknown>>((from, to) =>
      (role === "admin"
        ? supabase
            .from("vocab_sets")
            .select("id, title, folder:vocab_folders(name)")
        : supabase
            .from("vocab_sets")
            .select("id, title, folder:vocab_folders(name)")
            .or(`teacher_id.eq.${userId},created_by.eq.${userId}`)
      )
        .order("title")
        .order("id")
        .range(from, to)
    ),
  ]);

  const assignmentsByStudent = new Map<
    string,
    { id: string; set_id: string; title: string }[]
  >();

  for (const row of assignmentsRes.data ?? []) {
    const studentId = row.student_id as string;
    const set = Array.isArray(row.set) ? row.set[0] : row.set;
    const list = assignmentsByStudent.get(studentId) ?? [];
    list.push({
      id: row.id as string,
      set_id: row.set_id as string,
      title: (set as { title?: string } | null)?.title ?? "—",
    });
    assignmentsByStudent.set(studentId, list);
  }

  const students: ClassStudentVocabRow[] = (membersRes.data ?? []).map(
    (row) => {
      const student = Array.isArray(row.student) ? row.student[0] : row.student;
      const studentId = row.student_id as string;
      return {
        student_id: studentId,
        name: (student as { name?: string } | null)?.name ?? "—",
        assignments: assignmentsByStudent.get(studentId) ?? [],
      };
    }
  );

  const setOptions: VocabSetOption[] = (setsRes.data ?? []).map((row) => {
    const folder = Array.isArray(row.folder) ? row.folder[0] : row.folder;
    return {
      id: row.id as string,
      title: row.title as string,
      folder_name: (folder as { name?: string } | null)?.name ?? null,
    };
  });

  return { students, setOptions };
}
