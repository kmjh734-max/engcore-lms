/**
 * 학교별 출제 버릇 — 같은 학교 시험을 모아 「어디서 · 어떤 유형으로 내는가」를 뽑는다.
 *
 * 까닭(선생님 지시 2026-10-01): 시험 하나씩만 보면 다음 시험에 무엇을 만들지 알 수 없다.
 * 같은 학교 것을 모아 두면 「이 학교는 천재 1과에서 요지·내용일치·빈칸으로 낸다」가
 * 보이고, 그대로 미리 만들어 두면 된다.
 *
 * 이미 분석해 둔 것을 모으기만 한다 — 모델을 부르지 않으므로 값이 들지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export type TypeStat = {
  name: string;
  /** 모두 몇 문항 */
  count: number;
  /** 몇 번의 시험에 나왔나 */
  exams: number;
  /** 평균 배점 */
  points: number | null;
  /** 서술형인가 */
  subjective: boolean;
};

export type SourceStat = {
  /** 교재 이름이나 학평 이름 (예: 천재(조수경) 영어1 1과) */
  name: string;
  kind: "교과서" | "모의고사" | "수업자료";
  count: number;
  exams: number;
};

export type SchoolPattern = {
  key: string;
  school: string;
  grade: string;
  /** 분석해 둔 시험 */
  exams: Array<{ id: string; label: string; at: string; items: number; points: number | null }>;
  types: TypeStat[];
  sources: SourceStat[];
  /** 모든 시험에 빠짐없이 나온 유형 */
  always: string[];
  totalItems: number;
  subjectiveRatio: number;
};

/** 「천재(조수경) 영어1 1과 본문3」 → 「천재(조수경) 영어1 1과」 (본문 번호는 묶는다) */
function lessonOf(label: string): string {
  return String(label ?? "")
    .replace(/\s*(본문|추가지문)\s*\d+\s*$/, "")
    .trim();
}

export async function loadSchoolPatterns(
  admin: SupabaseClient,
  academyId: string
): Promise<SchoolPattern[]> {
  const { data: analyses } = await admin
    .from("school_exam_analyses")
    .select("id, school_name, grade, subject, exam_label, status, total_points, created_at")
    .eq("academy_id", academyId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(200);
  const list = analyses ?? [];
  if (list.length === 0) return [];

  const ids = list.map((a) => String(a.id));
  const items: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    // 서버는 한 번에 1,000줄까지 — 50회분이면 넘는다. 끝까지 넘겨 읽는다
    const data = await fetchAllRows<Record<string, unknown>>((from, to) =>
      admin
        .from("school_exam_items")
        .select(
          "analysis_id, item_no, type_name, points, is_subjective, matched_label, matched_mock_label, matched_textbook_label"
        )
        .in("analysis_id", chunk)
        .order("analysis_id")
        .order("item_no")
        .order("id")
        .range(from, to)
    );
    items.push(...data);
  }
  const byAnalysis = new Map<string, typeof items>();
  for (const it of items) {
    const k = String(it.analysis_id);
    byAnalysis.set(k, [...(byAnalysis.get(k) ?? []), it]);
  }

  const groups = new Map<string, typeof list>();
  for (const a of list) {
    const key = `${String(a.school_name ?? "이름 없음").trim()}|${String(a.grade ?? "").trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const out: SchoolPattern[] = [];
  for (const [key, exams] of groups) {
    const [school, grade] = key.split("|");
    const typeMap = new Map<string, { count: number; exams: Set<string>; pts: number[]; subj: boolean }>();
    const srcMap = new Map<string, { kind: SourceStat["kind"]; count: number; exams: Set<string> }>();
    let total = 0;
    let subjective = 0;

    for (const a of exams) {
      for (const it of byAnalysis.get(String(a.id)) ?? []) {
        total += 1;
        if (it.is_subjective) subjective += 1;
        const name = String(it.type_name ?? "").split(" · ")[0]!.trim() || "기타";
        const t = typeMap.get(name) ?? { count: 0, exams: new Set<string>(), pts: [], subj: false };
        t.count += 1;
        t.exams.add(String(a.id));
        if (typeof it.points === "number") t.pts.push(it.points);
        if (it.is_subjective) t.subj = true;
        typeMap.set(name, t);

        const tb = it.matched_textbook_label ? String(it.matched_textbook_label) : "";
        const mk = it.matched_mock_label ? String(it.matched_mock_label) : "";
        const mt = it.matched_label ? String(it.matched_label) : "";
        const pick: Array<[string, SourceStat["kind"]]> = tb
          ? [[lessonOf(tb), "교과서"]]
          : mk
            ? [[mk, "모의고사"]]
            : mt
              ? [[mt, "수업자료"]]
              : [];
        for (const [n, kind] of pick) {
          const s = srcMap.get(n) ?? { kind, count: 0, exams: new Set<string>() };
          s.count += 1;
          s.exams.add(String(a.id));
          srcMap.set(n, s);
        }
      }
    }

    const types: TypeStat[] = [...typeMap]
      .map(([name, t]) => ({
        name,
        count: t.count,
        exams: t.exams.size,
        points: t.pts.length ? Math.round((t.pts.reduce((x, y) => x + y, 0) / t.pts.length) * 10) / 10 : null,
        subjective: t.subj,
      }))
      .sort((a, b) => b.count - a.count);

    const sources: SourceStat[] = [...srcMap]
      .map(([name, s]) => ({ name, kind: s.kind, count: s.count, exams: s.exams.size }))
      .sort((a, b) => b.count - a.count);

    out.push({
      key,
      school: school!,
      grade: grade!,
      exams: exams.map((a) => ({
        id: String(a.id),
        label: String(a.exam_label ?? "시험"),
        at: String(a.created_at ?? ""),
        items: (byAnalysis.get(String(a.id)) ?? []).length,
        points: typeof a.total_points === "number" ? a.total_points : null,
      })),
      types,
      sources,
      // 모든 시험에 빠짐없이 나온 유형 — 다음에도 거의 나온다
      always: exams.length >= 2 ? types.filter((t) => t.exams === exams.length).map((t) => t.name) : [],
      totalItems: total,
      subjectiveRatio: total ? Math.round((subjective / total) * 100) : 0,
    });
  }

  return out.sort((a, b) => b.exams.length - a.exams.length || b.totalItems - a.totalItems);
}
