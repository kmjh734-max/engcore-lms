import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 학원마다 켜고 끄는 기능.
 *
 * 켠 학원만 그 기능을 쓸 수 있다. 값은 academies.settings.features 에 담아 두고,
 * 슈퍼관리자 화면의 「기능」 탭에서 켜고 끈다. 새 기능을 넣을 때는 여기에 한 줄 보태면
 * 슈퍼관리자 화면에도 저절로 나온다.
 */
export const ACADEMY_FEATURES = [
  {
    key: "textbook_passages",
    label: "교과서 지문 불러오기",
    hint: "수업자료 입력·동형모의고사·문제 만들기에서 교과서 본문을 골라 넣을 수 있습니다.",
  },
  {
    key: "grammar_bank",
    label: "중학 문법 문제 은행",
    hint: "레벨·단원별로 문법 문항을 골라 시험지와 정답지로 뽑을 수 있습니다.",
  },
  {
    /*
     * 선생님 결정(2026-10-02): 수업자료 대조는 아직 다듬는 중이라 정수학원에만 둔다.
     * 시험지 분석의 「수업자료 대조」 켜기·끄기, 직접 만든 자료 올리기, 적중표가 모두 여기 묶인다.
     */
    key: "exam_material_match",
    label: "시험지 수업자료 대조",
    hint: "내신 시험지 분석에서 우리 학원 수업자료·올린 자료와 지문을 대조해 적중을 보여 줍니다.",
  },
  {
    /* 선생님 결정(2026-10-15): 시험지 분석의 적중 자료집(A4 인쇄용)은 정수학원에서 먼저 써 본다. */
    key: "exam_hit_book",
    label: "시험지 적중 자료집",
    hint: "내신 시험지 분석에서 적중표를 문항마다 A4 한 장짜리 적중 자료집으로 뽑습니다.",
  },
  {
    /*
     * 선생님 결정(2026-10-19): 워크북 대신 테스트지로 확인하는 수업용 교재(수업자료 NEW).
     * 단어 정리·동반의어 테스트·수업용 자료·테스트 견본·백지노트·정답지를 한 권으로 묶고,
     * 학원에서는 테스트지를 무작위로 뽑는다. 정수학원에서 먼저 써 본다.
     */
    key: "test_book",
    label: "수업자료 NEW: 테스트 교재",
    hint: "수업자료에서 테스트 중심 교재를 만들고, 수업 시간에 테스트지를 무작위로 뽑아 출력합니다.",
  },
  {
    /* 선생님 결정(2026-10-27): 자료함 「단어」 탭(지문을 골라 단어장 만들기 · 목록 · 시험지)은 윌링어학원만. */
    key: "lesson_vocab_tab",
    label: "수업자료: 단어 탭",
    hint: "자료함에서 지문을 골라 단어장을 만들고, 단어 목록을 보고 단어 시험지를 출력합니다.",
  },
  {
    /*
     * 선생님 결정(2026-11-10): 수업용 자료의 교사용·학생용 수업 화면(칠판 배경·글씨체·문법 번호·동반의어·
     * 출제 자리·쉽게 말하면·교사용 해설 8칸)은 정수학원에서 먼저 쓴다.
     */
    key: "lesson_class_view",
    label: "수업자료: 교사용·학생용 수업 화면",
    hint: "수업용 자료에서 칠판 화면·출제 자리·교사용 해설을 보고 교사용·학생용 PDF를 따로 받습니다.",
  },
  {
    /*
     * 선생님 결정(2026-10-29): 중학교 수업자료(족보닷컴 중학 교과서 자료 — 단어·문법·대화문·본문·문제)는
     * 정수학원만 쓴다. 크레딧은 받지 않는다.
     */
    key: "middle_school_lessons",
    label: "중학교 수업자료",
    hint: "중학 교과서 과를 골라 수업용 자료·워크북·문제를 만듭니다.",
  },
  {
    /*
     * 선생님 결정(2026-11-11): 최종통합자료의 워크북을 유형별이 아니라 지문별로, 유형이 바뀌어도 새 쪽 없이 이어 싣는다.
     * 정수학원만.
     */
    key: "bundle_workbook_by_passage",
    label: "워크북 지문별",
    hint: "최종통합자료에서 워크북을 지문 차례로(지문마다 모든 유형) 쪽을 나누지 않고 이어 싣고, 새로 만드는 워크북도 지문별 배치로 시작합니다.",
  },
  {
    /* 선생님 결정(2026-10-07): 마케팅 탭의 예비고1·예비중1 어휘 진단은 정수학원만 쓴다. */
    key: "vocab_diagnostic",
    label: "마케팅: 어휘 진단",
    hint: "예비고1·예비중1 학생에게 개인 링크로 어휘 진단을 보내고 결과 링크를 줍니다.",
  },
] as const;

export type AcademyFeatureKey = (typeof ACADEMY_FEATURES)[number]["key"];

export type AcademyFeatures = Record<AcademyFeatureKey, boolean>;

/** settings 안의 features를 읽어 빠진 것은 꺼진 것으로 채워 준다 */
export function readAcademyFeatures(settings: unknown): AcademyFeatures {
  const holder = (settings ?? {}) as { features?: Record<string, unknown> };
  const saved = holder.features ?? {};
  const out = {} as AcademyFeatures;
  for (const feature of ACADEMY_FEATURES) {
    out[feature.key] = saved[feature.key] === true;
  }
  return out;
}

/** 이 학원에서 그 기능을 켰는지 */
export async function isAcademyFeatureOn(
  admin: SupabaseClient,
  academyId: string | null | undefined,
  key: AcademyFeatureKey,
): Promise<boolean> {
  if (!academyId) return false;
  const { data } = await admin
    .from("academies")
    .select("settings")
    .eq("id", academyId)
    .maybeSingle();
  return readAcademyFeatures(data?.settings)[key];
}
