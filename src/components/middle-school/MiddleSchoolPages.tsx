import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import { isMiddleSchoolOpen, loadMsQuestions, loadMsUnit, loadMsUnits } from "@/lib/middle-school/queries";
import { loadAcademyName } from "@/lib/grammar-bank/academy-name";
import { MiddleSchoolHome } from "./MiddleSchoolHome";
import { MiddleSchoolUnitWorkspace } from "./MiddleSchoolUnitWorkspace";
import { getAcademyBrandingForCurrentUser } from "@/lib/tenant/academy-branding";
import { decodeQuestionIds, sortMsQuestions } from "@/lib/middle-school/exam-print";
import { MsExamPrintView } from "./MsExamViews";
import { LessonPackVocabExam } from "@/components/lesson-materials/LessonPackVocabExam";
import { vocabSetAsProject } from "@/lib/lesson-materials/vocab-set-exam";
import type { VocabItem } from "@/types/database";

/** 관리자·강사 화면이 같이 쓰는 중학교 수업자료 쪽(base = /admin/middle-school 등) */
export async function MiddleSchoolHomePage({ base }: { base: string }) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isMiddleSchoolOpen(profile.academy_id))) notFound();
  const units = await loadMsUnits(profile.academy_id);
  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">중학교 수업자료</h1>
        <p className="mt-1 text-sm text-slate-500">학년과 교과서, 과를 고르면 그 과의 단어·문법·대화문·본문으로 자료를 만듭니다.</p>
      </header>
      <MiddleSchoolHome units={units} base={base} />
    </div>
  );
}

export async function MiddleSchoolUnitPage({
  base,
  unitId,
  test = false,
  book = null,
}: {
  base: string;
  unitId: string;
  test?: boolean;
  /** 과 카드 「본교재 출력」·「정답지 출력」 */
  book?: "book" | "answers" | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isMiddleSchoolOpen(profile.academy_id))) notFound();
  const [unit, academyName] = await Promise.all([
    loadMsUnit(profile.academy_id, unitId),
    loadAcademyName(profile.academy_id),
  ]);
  if (!unit) notFound();
  const questions = await loadMsQuestions(unit.id);
  return (
    <div className="space-y-4 p-6">
      <header className="no-print">
        <Link href={base} className="text-sm text-violet-700">← 과 목록</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">
          {unit.grade} {unit.publisher} {unit.lessonNo}과 <span className="text-slate-500">· {unit.title}</span>
        </h1>
      </header>
      <MiddleSchoolUnitWorkspace unit={unit} questions={questions} academyName={academyName ?? ""} base={base} startTest={test} startBook={book} />
    </div>
  );
}

/** 단어 시험지: 고등 수업용 자료 「단어 시험지」와 같은 화면(그 과 단어장으로, 크레딧 없음) */
export async function MiddleSchoolVocabExamPage({ base, unitId }: { base: string; unitId: string }) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isMiddleSchoolOpen(profile.academy_id))) notFound();
  const unit = await loadMsUnit(profile.academy_id, unitId);
  if (!unit) notFound();
  const branding = await getAcademyBrandingForCurrentUser();
  const POS = /^((?:n|v|a|adj|adv|prep|conj|pron|int)\.)\s*/;
  const seen = new Set<string>();
  const items = unit.words
    .filter((w) => {
      const k = w.word.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((w) => ({ word: w.word.trim(), meaning: w.meaning.replace(POS, ""), part_of_speech: w.meaning.match(POS)?.[1] ?? null }) as VocabItem);
  const title = `${unit.grade} ${unit.publisher} ${unit.lessonNo}과 단어`;
  return (
    <LessonPackVocabExam
      role={base.startsWith("/admin") ? "admin" : "teacher"}
      docName={title}
      projects={[vocabSetAsProject({ id: unit.id, title }, items)]}
      fromWordSet
      closeBase={base}
      source={`${unit.grade} ${unit.publisher} ${unit.lessonNo}과`}
      sourceSub={unit.title}
      logoSrc={branding.logoUrl}
      academyName={branding.name || ""}
    />
  );
}

/** 문제 인쇄: 변형문제 인쇄 화면 그대로(고른 문항 id를 주소에 담는다 — 문제지·해설지 전환에도 그대로 간다) */
export async function MiddleSchoolExamPrintPage({
  base,
  unitId,
  sel,
  mode,
}: {
  base: string;
  unitId: string;
  sel: string;
  mode: "exam" | "answers";
}) {
  const profile = await getCurrentProfile();
  if (!profile?.academy_id || !(await isMiddleSchoolOpen(profile.academy_id))) notFound();
  const unit = await loadMsUnit(profile.academy_id, unitId);
  if (!unit) notFound();
  const all = await loadMsQuestions(unit.id);
  const byId = new Map(all.map((q) => [q.id, q]));
  const picked = sortMsQuestions(
    decodeQuestionIds(sel)
      .map((id) => byId.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q),
  );
  if (!picked.length) notFound();
  const branding = await getAcademyBrandingForCurrentUser();
  return (
    <MsExamPrintView
      unit={{ id: unit.id, grade: unit.grade, publisher: unit.publisher, lessonNo: unit.lessonNo, title: unit.title }}
      questions={picked}
      mode={mode}
      academyName={branding.name}
      base={base}
      sel={sel}
    />
  );
}
