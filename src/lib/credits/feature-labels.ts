/**
 * 크레딧 내역·가격표에 보여 줄 기능 이름. DB 가격표 이름(label)에 내부 표현이 섞여 있어도
 * 화면에는 이 이름을 쓴다.
 */

type FeatureInfo = {
  label: string;
  /** "어디에 썼나" 묶음 */
  group: string;
  /** 수량 단위 (문항, 지문, 장) */
  unit?: string;
};

const FEATURES: Record<string, FeatureInfo> = {
  qg_generate_job: { label: "변형문제", group: "변형문제", unit: "문항" },
  /*
   * 어법 유형이라고만 적으니 어법오류수정·제시어배열도 여기 들어가는 줄 아셨다
   * (2026-10-01 선생님 지적). 값이 다른 두 유형만 여기 든다는 것을 이름에 적는다.
   */
  qg_generate_grammar: { label: "변형문제 어법추론·어법개수", group: "변형문제", unit: "문항" },
  qg_generate_writing: { label: "변형문제 서술형", group: "변형문제", unit: "문항" },
  qg_generate_set: { label: "변형문제 1지문 다문항", group: "변형문제", unit: "문항" },
  lesson_analysis_report: { label: "지문 분석서", group: "지문 분석서", unit: "지문" },
  lesson_pack: { label: "수업용 자료", group: "수업자료", unit: "지문" },
  lesson_teacher_notes: { label: "교사용 수업 해설", group: "수업자료", unit: "지문" },
  lesson_illustration: { label: "지문 삽화", group: "수업자료", unit: "장" },
  /*
   * 아래 셋은 워크북과 1장 테스트지가 함께 쓴다(값도 같다). 어디서 썼는지는
   * usedFor로 따로 적어 붙인다 — 1장 테스트지를 만들었는데 내역에 「워크북」이라고
   * 찍혀 무엇을 만들었는지 헷갈렸다(2026-09-29 윌링어학원).
   */
  lesson_workbook_grammar_choice: { label: "어법 선택 문항", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_vocab_choice: { label: "어휘 선택 문항", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_tf: { label: "O/X 문항", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_word_order: { label: "제시어 배열 영작", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_line_translation: { label: "한 줄 해석·전체 영작", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_gist: { label: "제목·주제·요지 해석", group: "워크북·1장 테스트", unit: "지문" },
  lesson_line_translate: { label: "문장 해석 다시 만들기", group: "수업자료", unit: "지문" },
  lesson_one_page_summary: { label: "1장 요약자료", group: "1장 자료", unit: "지문" },
  lesson_one_page_test: { label: "1장 테스트지", group: "1장 자료", unit: "지문" },
  lesson_one_page: { label: "1장 자료", group: "1장 자료", unit: "지문" },
  lesson_test_book: { label: "테스트 교재", group: "수업자료", unit: "지문" },
  lesson_test_draw: { label: "테스트지 뽑기", group: "수업자료", unit: "문항(세트 3)" },
  lesson_workbook_extras: { label: "수업자료 부가 재료 묶음(요약·지칭·함축·단어 등)", group: "워크북·1장 테스트", unit: "지문" },
  lesson_workbook_rule_type: { label: "워크북 빈칸·문장 순서·연결어·글의 순서·문장 삽입", group: "워크북·1장 테스트", unit: "유형×지문" },
  lesson_workbook_tb_type: { label: "워크북 요약문·도식화·지칭·함축·바꿔 말하기·단어 시험", group: "워크북·1장 테스트", unit: "유형×지문" },
  school_exam_analysis: { label: "내신 시험지 분석", group: "내신 시험 분석", unit: "회" },
  exam_hit_book: { label: "적중 자료집 만들기", group: "내신 시험 분석", unit: "회" },
  exam_hit_book_recheck: { label: "적중 자료집 문항 재검토", group: "내신 시험 분석", unit: "문항" },
  vocab_student_monthly: { label: "단어학습 학생 이용", group: "단어·듣기 학생 이용" },
  listening_student_monthly: { label: "듣기학습 학생 이용", group: "단어·듣기 학생 이용" },
  listening_generate_questions: { label: "듣기 문항 만들기", group: "듣기 자료", unit: "문항" },
  listening_generate_audio: { label: "듣기 음성 만들기", group: "듣기 자료", unit: "문항" },
  listening_generate_image: { label: "듣기 그림 만들기", group: "듣기 자료", unit: "장" },
  listening_generate_scene: { label: "듣기 상황 그림 만들기", group: "듣기 자료", unit: "문항" },
  listening_variant_questions: { label: "듣기 비슷한 문항 만들기", group: "듣기 자료", unit: "문항" },
  vocab_generate_examples: { label: "단어 예문 만들기", group: "단어 자료", unit: "단어" },
  vocab_generate_related: { label: "단어 동의어·반의어 만들기", group: "단어 자료", unit: "단어" },
  vocab_extract_passage: { label: "지문에서 단어 뽑기", group: "단어 자료", unit: "지문" },
  vocab_grade_meaning: { label: "단어 뜻 채점", group: "단어 자료" },
  student_record_analyze: { label: "학생부 분석", group: "학생부 분석", unit: "건" },
  report_ai_draft: { label: "학습 리포트 초안", group: "학습 리포트·안내문" },
  nelt_report_narratives: { label: "NELT 리포트 설명", group: "학습 리포트·안내문" },
  nelt_parent_message: { label: "NELT 학부모 안내문", group: "학습 리포트·안내문" },
};

/** 같은 기능을 여러 화면이 함께 쓸 때, 어느 화면에서 썼는지 */
const USED_FOR: Record<string, string> = {
  workbook: "워크북",
  one_page_test: "1장 테스트지",
  one_page_summary: "1장 요약자료",
  test_book: "테스트 교재",
};

/** 내역에 적을 「어디서 썼나」 (모르면 빈 문자열) */
export function usedForLabel(usedFor: unknown): string {
  const key = typeof usedFor === "string" ? usedFor.trim() : "";
  return USED_FOR[key] ?? "";
}

/** 화면용으로 내부 표현을 걷어 낸다 */
export function cleanCreditText(text: string): string {
  return text
    .replace(/\(?\s*토스페이먼츠\s*(테스트\s*)?(결제)?\s*\)?/g, "")
    .replace(/\bAI\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function featureLabel(featureKey: string | null, dbLabel?: string | null): string {
  if (featureKey && FEATURES[featureKey]) return FEATURES[featureKey].label;
  if (dbLabel) return cleanCreditText(dbLabel) || "기타 기능";
  return "기타 기능";
}

export function featureGroup(featureKey: string | null): string {
  return (featureKey && FEATURES[featureKey]?.group) || "기타";
}

/**
 * "변형문제 30문항", "1장 테스트지 · 어법 선택 문항 1지문", "듣기 음성 만들기 × 3"
 *
 * usedFor는 워크북·1장 테스트처럼 한 기능을 여러 화면이 나눠 쓸 때 어디서 썼는지다.
 * 예전 내역에는 없으므로, 없으면 기능 이름만 적는다(잘못된 이름을 붙이지 않는다).
 */
export function featureUsageText(
  featureKey: string | null,
  quantity: number | null,
  dbLabel?: string | null,
  usedFor?: unknown
): string {
  const where = usedForLabel(usedFor);
  const label = `${where ? `${where} · ` : ""}${featureLabel(featureKey, dbLabel)}`;
  const unit = featureKey ? FEATURES[featureKey]?.unit : undefined;
  const q = quantity && quantity > 0 ? Math.floor(quantity) : null;
  if (unit && q) return `${label} ${q.toLocaleString("ko-KR")}${unit}`;
  if (q && q > 1) return `${label} × ${q.toLocaleString("ko-KR")}`;
  return label;
}

/** 가격표 단위 문구 */
export function featurePriceUnit(featureKey: string, billingType: string): string {
  if (billingType === "monthly_seat") return "학생 1명·한 달";
  const unit = FEATURES[featureKey]?.unit;
  return unit ? `1${unit}` : "1회";
}
