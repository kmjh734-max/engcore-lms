import { filterNavItems } from "@/lib/academy-features";
import { isStudyPlanEnabled, isStudyPlanNavItem } from "@/lib/study-plan/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGrammarBankOpen } from "@/lib/grammar-bank/queries";
import { isVocabDiagOpen } from "@/lib/vocab-diagnostic/access";
import { isMiddleSchoolOpen } from "@/lib/middle-school/queries";

/*
 * 관리자·강사 왼쪽 메뉴. 레이아웃과 홈 「사용법」 창이 같은 목록을 쓴다 — 사용법도 그 학원에 열린 메뉴만
 * 설명하게(선생님 2026-11-19).
 */
export type NavItem = { href: string; label: string; group?: string };

/** 개인회원(개인 선생님)에게는 강사·관리자 계정 관리가 필요 없다 */
const TEAM_ONLY = new Set(["/admin/teachers", "/admin/admins"]);

async function isPersonalMember(academyId: string | null | undefined): Promise<boolean> {
  if (!academyId) return false;
  const { data } = await createAdminClient().from("academies").select("settings").eq("id", academyId).maybeSingle();
  return (data?.settings as { signup?: { member_type?: string } } | null)?.signup?.member_type === "personal";
}

/**
 * 메뉴 묶음(선생님 2026-11-19): 수업자료 만들기 / 수업 운영 / 학생 학습 / 리포트.
 * 학원마다 열린 메뉴만 아래에서 걸러 보여 준다(새로 여는 메뉴는 없다).
 */
const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "관리 홈" },
  { href: "/admin/lesson-materials", label: "수업자료", group: "수업자료 만들기" },
  { href: "/admin/question-generator", label: "변형문제", group: "수업자료 만들기" },
  { href: "/admin/middle-school", label: "중학교 수업자료", group: "수업자료 만들기" },
  { href: "/admin/main-books", label: "본교재 수업자료", group: "수업자료 만들기" },
  { href: "/admin/grammar", label: "문법 문제 은행", group: "수업자료 만들기" },
  { href: "/admin/classes", label: "반 관리", group: "수업 운영" },
  { href: "/admin/students", label: "학생·수강", group: "수업 운영" },
  { href: "/admin/progress", label: "수강 현황", group: "수업 운영" },
  { href: "/admin/study-plans", label: "학습일정표", group: "수업 운영" },
  { href: "/admin/courses", label: "동영상강좌 관리", group: "학생 학습" },
  { href: "/admin/vocab", label: "단어학습", group: "학생 학습" },
  { href: "/admin/listening", label: "듣기학습", group: "학생 학습" },
  { href: "/admin/reports", label: "학습 리포트", group: "리포트" },
  { href: "/admin/exam-analysis", label: "내신 시험 분석", group: "리포트" },
  { href: "/admin/student-records", label: "학생부 분석", group: "리포트" },
  { href: "/admin/nelt", label: "NELT 성장 리포트", group: "리포트" },
  { href: "/admin/marketing/vocab-diagnostic", label: "어휘 진단", group: "마케팅" },
  { href: "/admin/teachers", label: "강사 관리", group: "관리" },
  { href: "/admin/admins", label: "관리자 계정", group: "관리" },
  { href: "/admin/credits", label: "크레딧", group: "관리" },
];

/** 그 학원 관리자에게 보이는 메뉴 */
export async function getAdminNavItems(academyId: string | null | undefined): Promise<NavItem[]> {
  const [personal, studyPlan, grammarOpen, diagOpen, middleOpen] = await Promise.all([
    isPersonalMember(academyId),
    isStudyPlanEnabled(academyId),
    isGrammarBankOpen(academyId),
    isVocabDiagOpen(academyId),
    isMiddleSchoolOpen(academyId),
  ]);
  let items = ADMIN_NAV;
  if (personal) items = items.filter((i) => !TEAM_ONLY.has(i.href));
  if (!studyPlan) items = items.filter((i) => !isStudyPlanNavItem(i.href));
  // 문법 문제 은행은 열어 준 학원에서만 메뉴에 둔다.
  if (!grammarOpen) items = items.filter((i) => i.href !== "/admin/grammar");
  // 마케팅 > 어휘 진단도 정수학원처럼 켜 준 학원에서만.
  if (!diagOpen) items = items.filter((i) => !i.href.startsWith("/admin/marketing"));
  // 중학교 수업자료는 정수학원만(선생님 2026-10-29).
  if (!middleOpen) items = items.filter((i) => i.href !== "/admin/middle-school" && i.href !== "/admin/main-books");
  return filterNavItems(items);
}

const TEACHER_NAV: NavItem[] = [
  { href: "/teacher", label: "강사 홈" },
  // 묶음·차례는 관리자 메뉴와 같다(선생님 2026-11-19): 수업자료 만들기 / 수업 운영 / 학생 학습 / 리포트
  { href: "/teacher/lesson-materials", label: "수업자료", group: "수업자료 만들기" },
  { href: "/teacher/question-generator", label: "변형문제", group: "수업자료 만들기" },
  { href: "/teacher/middle-school", label: "중학교 수업자료", group: "수업자료 만들기" },
  { href: "/teacher/main-books", label: "본교재 수업자료", group: "수업자료 만들기" },
  { href: "/teacher/grammar", label: "문법 문제 은행", group: "수업자료 만들기" },
  { href: "/teacher/classes", label: "반 관리", group: "수업 운영" },
  { href: "/teacher/students", label: "학생 관리", group: "수업 운영" },
  { href: "/teacher/progress", label: "수강 현황", group: "수업 운영" },
  { href: "/teacher/courses", label: "동영상강좌 관리", group: "학생 학습" },
  { href: "/teacher/vocab", label: "단어학습", group: "학생 학습" },
  { href: "/teacher/listening", label: "듣기학습", group: "학생 학습" },
  { href: "/teacher/reports", label: "학습 리포트", group: "리포트" },
  { href: "/teacher/exam-analysis", label: "내신 시험 분석", group: "리포트" },
  { href: "/teacher/student-records", label: "학생부 분석", group: "리포트" },
  { href: "/teacher/nelt", label: "NELT 성장 리포트", group: "리포트" },
  { href: "/teacher/credits", label: "크레딧", group: "관리" },
];

/** 그 학원 강사에게 보이는 메뉴 */
export async function getTeacherNavItems(academyId: string | null | undefined): Promise<NavItem[]> {
  const [grammarOpen, middleOpen] = await Promise.all([isGrammarBankOpen(academyId), isMiddleSchoolOpen(academyId)]);
  return filterNavItems(
    TEACHER_NAV.filter(
      (item) =>
        (grammarOpen || item.href !== "/teacher/grammar") &&
        (middleOpen || item.href !== "/teacher/middle-school") &&
        (middleOpen || item.href !== "/teacher/main-books"),
    ),
  );
}
