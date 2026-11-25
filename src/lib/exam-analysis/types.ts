/** 내신 시험지 분석: 영역·유형 이름 (보고서·문항표에 쓰는 말) */

export const EXAM_CATEGORIES = ["대의 파악", "세부 정보", "논리·추론", "어법·어휘", "서술형", "기타"] as const;
export type ExamCategory = (typeof EXAM_CATEGORIES)[number];

export const EXAM_LEVELS = ["하", "중", "상"] as const;
export type ExamLevel = (typeof EXAM_LEVELS)[number];

/** 문항표에서 고를 수 있는 유형 (영역별) */
export const EXAM_TYPE_CHOICES: { category: ExamCategory; names: string[] }[] = [
  { category: "대의 파악", names: ["주제", "제목", "요지", "주장", "목적", "심경·분위기"] },
  { category: "세부 정보", names: ["내용 일치", "내용 불일치", "일치 개수", "지칭 대상"] },
  { category: "논리·추론", names: ["빈칸 추론", "순서 배열", "문장 삽입", "무관한 문장", "밑줄 의미", "요약문 완성", "연결어"] },
  { category: "어법·어휘", names: ["어법 판단", "어법 (개수)", "어휘 판단", "어휘 (개수)", "영영풀이"] },
  { category: "서술형", names: ["조건 영작(배열)", "요약문 영작", "어법 오류 수정", "우리말 조건 영작", "빈칸 영작", "본문 찾아 쓰기", "요약표 수정", "의미 설명"] },
  { category: "기타", names: ["대화문", "기타"] },
];

export type ExamItemRow = {
  id: string;
  order_index: number;
  item_no: string;
  points: number | null;
  is_subjective: boolean;
  category: ExamCategory;
  type_key: string | null;
  type_name: string;
  level: ExamLevel;
  difficulty: number;
  difficulty_reason: string | null;
  stem: string | null;
  passage_excerpt: string | null;
  passage_words: number | null;
  grammar_point: string | null;
  conditions: string | null;
  answer_guess: string | null;
  confidence: number | null;
  matched_item_id: string | null;
  matched_label: string | null;
  /** 모의고사 지문 모음에서 맞은 출처 (예: 24년 고2 6월 학평 24번) */
  matched_mock_id: string | null;
  matched_mock_label: string | null;
  /** 교과서 본문에서 맞은 출처 (예: 천재(조수경) 영어1 2과 본문3) */
  matched_textbook_id: string | null;
  matched_textbook_label: string | null;
  /** 선생님이 출처를 손으로 정했는지 — 다시 대조해도 덮어쓰지 않는다 */
  source_edited: boolean;
  /** 손으로 정한 갈래: textbook | mock | material | sub_material(부교재) | outside(외부지문) | custom */
  source_kind: string | null;
  /** 선생님이 직접 입력한 출처 명칭 (예: 올림포스 12강 3번) */
  source_label?: string | null;
  /** 점수가 갈린 문항(변별력 문항)으로 직접 지정되었는지 */
  is_decisive?: boolean;
  edited: boolean;
  /*
   * 문항마다 「어떻게 냈는지」(선생님 2026-11-25, 마이그레이션 210). 예전 분석에는 없다(null).
   * 동형모의고사가 그 번호 문항에 그대로 넘긴다 — blueprint.ts schoolItemNote.
   */
  /** 빈칸·요약 정답이 지문 그대로(verbatim)·바꿔 말함(paraphrase)·일부만 같음(partial) */
  answer_style?: "verbatim" | "paraphrase" | "partial" | null;
  choice_lang?: "en" | "ko" | "mixed" | null;
  choice_avg_words?: number | null;
  /** 선택지 어휘 수준 한 마디 */
  vocab_level?: string | null;
  /** 선택지 구문·추상도·오답 매력도 한 문장 */
  level_reason?: string | null;
  distractor_method?: string | null;
  passage_change?: string | null;
};

export type ExamAnalysisRow = {
  id: string;
  academy_id: string;
  school_name: string | null;
  grade: string | null;
  subject: string | null;
  exam_label: string | null;
  status: "reading" | "analyzing" | "ready" | "failed";
  page_count: number;
  missing: string | null;
  note: string | null;
  total_points: number | null;
  features: string[];
  strategy: string[];
  /** 선생님이 직접 지정한 점수가 갈린 문항 ID 목록 */
  decisive_item_ids?: string[] | null;
  /** 지문 전체의 평균 문장 길이(낱말). 쪽 글자로 코드가 잰 값 */
  sentence_words: number | null;
  /** 영어 선택지 평균 낱말 수 */
  choice_words: number | null;
  /** 추정 렉사일. 정식 측정값이 아니다 */
  lexile: number | null;
  /** 어휘 수준 한 마디 */
  vocab_level: string | null;
  /** 수준 요약 한 문장 */
  level_summary: string | null;
  error: string | null;
  match_materials: boolean;
  created_at: string;
};

const BASE_NAME: Record<string, [string, ExamCategory]> = {
  title: ["제목", "대의 파악"],
  topic: ["주제", "대의 파악"],
  summary_mcq: ["요지", "대의 파악"],
  content_true: ["내용 일치", "세부 정보"],
  content_false: ["내용 불일치", "세부 정보"],
  content_count: ["일치 개수", "세부 정보"],
  order: ["순서 배열", "논리·추론"],
  sentence_insertion: ["문장 삽입", "논리·추론"],
  sentence_blank: ["빈칸 추론", "논리·추론"],
  irrelevant_sentence: ["무관한 문장", "논리·추론"],
  underlined_inference: ["밑줄 의미", "논리·추론"],
  grammar: ["어법 판단", "어법·어휘"],
  vocabulary: ["어휘 판단", "어법·어휘"],
  summary_short: ["요약문 영작", "서술형"],
  writing: ["조건 영작(배열)", "서술형"],
  short_title: ["제목 쓰기", "서술형"],
  short_topic: ["주제 쓰기", "서술형"],
};

/** 분석이 준 유형 key("grammar:na:default:어법개수", "other:대화문흐름")를 문항표 이름·영역으로 */
export function typeNameFromKey(typeKey: string, isSubjective: boolean): { name: string; category: ExamCategory } {
  const [base, lang = "", , tag = ""] = typeKey.split(":");
  if (base === "other") {
    const raw = typeKey.slice("other:".length).trim() || "기타";
    const found = EXAM_TYPE_CHOICES.find((g) => g.names.some((n) => raw.replace(/\s/g, "").includes(n.replace(/\s|\(|\)/g, ""))));
    return { name: raw, category: isSubjective ? "서술형" : (found?.category ?? "기타") };
  }
  const hit = BASE_NAME[base ?? ""];
  if (!hit) return { name: typeKey, category: isSubjective ? "서술형" : "기타" };
  const category = hit[1];
  let name = hit[0];
  if (base === "grammar" && tag.includes("개수")) name = "어법 (개수)";
  if (base === "vocabulary" && tag.includes("개수")) name = "어휘 (개수)";
  if (base === "grammar" && isSubjective) name = "어법 오류 수정";
  if (["content_true", "content_false", "summary_mcq", "topic", "title"].includes(base ?? "") && lang !== "na") {
    name += lang === "en" ? " · 영어 선지" : " · 한글 선지";
  }
  return { name, category: isSubjective ? "서술형" : category };
}

export function categoryOfName(name: string, isSubjective: boolean): ExamCategory {
  if (isSubjective) return "서술형";
  const plain = name.split(" · ")[0]!;
  return EXAM_TYPE_CHOICES.find((g) => g.names.includes(plain))?.category ?? "기타";
}
