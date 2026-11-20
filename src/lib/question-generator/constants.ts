/** 유형별 최대 세트 수 */
export const MAX_SETS_PER_TYPE = 50;

/** 한 번에 생성 가능한 최대 문항 수 (지문 수 × 유형 합) */
export const MAX_TOTAL_QUESTIONS = 500;

/**
 * 한 번에 넣을 수 있는 최대 지문 수(100). 30이었는데 모의고사 한 회·교과서 몇 과를 한 번에 넣기엔
 * 모자랐다(윌링어학원 2026-11-20). 문항 수는 MAX_TOTAL_QUESTIONS(500)가 따로 막는다.
 */
export const MAX_PASSAGES = 100;

/** 로컬 검수 통과 최소 점수 (미달 시 문항 폐기) */
export const VALIDATION_PASS_SCORE = 70;

/**
 * 문항당 최대 재생성 횟수.
 *
 * 1회였을 때(2026-10-02, 384문항 작업) 검수에 한 번 더 걸리면 바로 다른 유형(제목추론)으로
 * 바꿔 만들어, 선생님이 청한 내용일치·불일치 22개가 제목추론으로 나갔다. 바꿔 만드는 것보다
 * 한 번 더 같은 유형으로 해 보는 쪽이 낫다. 걸리는 문항은 열에 하나 정도라 값은 조금 든다.
 */
export const MAX_REGENERATION_ATTEMPTS = 2;

/**
 * 동시에 만드는 문항 수. 문항 하나는 보통 8~12초인데, 호출 셋 중 하나꼴로 같은 양을
 * 26~42초에 걸쳐 돌려준다(OpenAI 쪽 처리 시간). 8개씩이면 이 느린 호출에 묶여 초당 0.3~0.4문항에
 * 그쳤다. 24개로 올려도 호출 속도는 같고 오류(429)도 없었으며(63문항 167초 → 87초), gpt-5.5 한도
 * (분당 10,000건·400만 토큰)에 비해 여유가 크다.
 */
// 검수 호출이 문항마다 하나 더 붙어(2026-10-03) 288문항이 7분 걸렸다. 32로 올린다.
// 전체 몫(GLOBAL_CALL_BUDGET 120) 안이라 다른 기능 자리는 그대로 남는다.
export const GENERATION_CONCURRENCY = 32;

/** 지문 최소 단어 수 (경고) */
export const MIN_PASSAGE_WORDS = 40;

/** 지문 최소 문장 수 (순서/삽입 등 경고) */
export const MIN_PASSAGE_SENTENCES_FOR_ORDER = 4;

/** 문장삽입·무관한문장: 문장 수가 이 값 이하이면 생성 생략 (5개 초과 필요) */
export const MIN_SENTENCES_FOR_INSERTION_IRRELEVANT = 6;

export const GRADES = [
  { value: "중1", label: "중1" },
  { value: "중2", label: "중2" },
  { value: "중3", label: "중3" },
  { value: "고1", label: "고1" },
  { value: "고2", label: "고2" },
  { value: "고3", label: "고3" },
] as const;

export const SOURCE_TYPES = [
  { value: "교과서", label: "교과서" },
  { value: "부교재", label: "부교재" },
  { value: "모의고사", label: "모의고사" },
  { value: "자체 지문", label: "자체 지문" },
  { value: "기타", label: "기타" },
] as const;

export const OVERALL_DIFFICULTIES = [
  { value: "기본", label: "기본" },
  { value: "내신", label: "내신" },
  { value: "고난도", label: "고난도" },
] as const;

export type GradeValue = (typeof GRADES)[number]["value"];
export type SourceTypeValue = (typeof SOURCE_TYPES)[number]["value"];
export type OverallDifficultyValue =
  (typeof OVERALL_DIFFICULTIES)[number]["value"];
