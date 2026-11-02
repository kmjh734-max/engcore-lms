import { createAdminClient } from "@/lib/supabase/admin";
import { isAcademyFeatureOn } from "@/lib/academies/features";
import type { MsWorkbook } from "./workbook";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import { loadMsLectures } from "./lectures";
import type { MsLectureSlug } from "./qr-url";

/**
 * 중학교 수업자료(선생님 2026-10-29): 족보닷컴 중학 교과서 자료를 과 단위로 읽는다.
 * 정수학원만 켠다(기능 키 middle_school_lessons). 자료는 정수학원 것으로 적재돼 있다.
 */

export type MsWord = {
  section: "대화문" | "본문";
  word: string;
  meaning: string;
  examples?: { en: string; ko: string }[];
};

export type MsGrammar = {
  no: number;
  title: string;
  /** 「설명 | e.g. 예문」 꼴 — 예문이 없으면 설명만 */
  points: string[];
  examples: { en: string; ko: string; fromText: boolean }[];
};

export type MsLine = { en: string; ko: string; speaker: string };

export type MsText = {
  id: string;
  kind: "대화문" | "본문";
  part: string;
  title: string | null;
  lines: MsLine[];
  /** 본문 문장 분석(고등 분석서와 같은 형식, 직접 써서 넣은 것). 대화문·아직 안 쓴 본문은 null */
  analysis?: AnalysisReportData | null;
};

export type MsUnitSummary = {
  id: string;
  grade: string;
  publisher: string;
  lessonNo: number;
  title: string;
  wordCount: number;
  grammarTitles: string[];
};

export type MsUnit = MsUnitSummary & {
  words: MsWord[];
  grammar: MsGrammar[];
  dialogues: MsText[];
  passages: MsText[];
  /** 미리 정해 둔 워크북 문항(족보닷컴 본문 10단계 워크북) */
  workbook: MsWorkbook;
  /** 강의가 올라가 있는 영역 — 이 영역만 쪽에 강의 QR을 찍는다 */
  lectureSections: MsLectureSlug[];
};

/** 문제 은행 문항(족보닷컴 예상문제 그대로) — 글 안에 밑줄 <u>…</u>, 빈칸 <blank/> */
export type MsQuestion = {
  id: number;
  source: string;
  no: number;
  area: string;
  kind: "mc" | "sa";
  stem: string;
  groupLead: string | null;
  groupLines: string[] | null;
  body: string[];
  choices: { no: number; text: string }[];
  answer: string;
  explanation: string;
  review: string;
};

export async function loadMsQuestions(unitId: string): Promise<MsQuestion[]> {
  const { data } = await createAdminClient()
    .from("ms_questions")
    .select("id, source, no, area, kind, stem, group_lead, group_lines, body, choices, answer, explanation, review")
    .eq("unit_id", unitId)
    .order("source")
    .order("no");
  return (data ?? []).map((r) => ({
    id: r.id as number,
    source: r.source as string,
    no: r.no as number,
    area: r.area as string,
    kind: r.kind as "mc" | "sa",
    stem: r.stem as string,
    groupLead: (r.group_lead as string | null) ?? null,
    groupLines: (r.group_lines as string[] | null) ?? null,
    body: (r.body as string[]) ?? [],
    choices: (r.choices as { no: number; text: string }[]) ?? [],
    answer: r.answer as string,
    explanation: r.explanation as string,
    review: r.review as string,
  }));
}

export async function isMiddleSchoolOpen(academyId: string | null | undefined): Promise<boolean> {
  return isAcademyFeatureOn(createAdminClient(), academyId, "middle_school_lessons");
}

type UnitRow = {
  id: string;
  grade: string;
  publisher: string;
  lesson_no: number;
  title: string;
  words: MsWord[];
  grammar: MsGrammar[];
};

function summary(r: UnitRow): MsUnitSummary {
  return {
    id: r.id,
    grade: r.grade,
    publisher: r.publisher,
    lessonNo: r.lesson_no,
    title: r.title,
    wordCount: (r.words ?? []).length,
    grammarTitles: (r.grammar ?? []).map((g) => g.title),
  };
}

export async function loadMsUnits(academyId: string): Promise<MsUnitSummary[]> {
  const { data } = await createAdminClient()
    .from("ms_units")
    .select("id, grade, publisher, lesson_no, title, words, grammar")
    .eq("academy_id", academyId)
    .order("grade")
    .order("publisher")
    .order("lesson_no");
  return ((data ?? []) as UnitRow[]).map(summary);
}

export async function loadMsUnit(academyId: string, unitId: string): Promise<MsUnit | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("ms_units")
    .select("id, grade, publisher, lesson_no, title, words, grammar, workbook")
    .eq("academy_id", academyId)
    .eq("id", unitId)
    .maybeSingle();
  if (!row) return null;
  let texts: unknown[] | null = (
    await admin.from("ms_texts").select("id, kind, part, title, lines, analysis").eq("unit_id", unitId).order("order_index")
  ).data;
  // 마이그레이션 207(analysis 칸)을 아직 안 적용한 DB에서도 화면이 열리게
  if (!texts) {
    texts = (await admin.from("ms_texts").select("id, kind, part, title, lines").eq("unit_id", unitId).order("order_index")).data;
  }
  const all = (texts ?? []) as MsText[];
  const r = row as UnitRow & { workbook: MsWorkbook | null };
  const lectures = await loadMsLectures({ academyId, grade: r.grade, publisher: r.publisher, lessonNo: r.lesson_no });
  return {
    ...summary(r),
    words: r.words ?? [],
    grammar: r.grammar ?? [],
    dialogues: all.filter((t) => t.kind === "대화문"),
    passages: all.filter((t) => t.kind === "본문"),
    workbook: r.workbook ?? {},
    lectureSections: (Object.keys(lectures) as MsLectureSlug[]).filter((k) => lectures[k].length > 0),
  };
}
