import type { PassageSetConfig } from "./passage-set";
export type QuestionTypeCode =
  | "title"
  | "topic"
  | "summary_mcq"
  | "content_true"
  | "content_false"
  | "content_count"
  | "order"
  | "sentence_blank"
  | "irrelevant_sentence"
  | "sentence_insertion"
  | "underlined_inference"
  | "grammar"
  | "vocabulary"
  | "summary_short"
  | "writing"
  | "short_title"
  | "short_topic";

export type QuestionCategory =
  | "main_idea"
  | "details"
  | "inference"
  | "grammar_vocabulary"
  | "subjective";

export type DifficultyLevel = "low" | "medium" | "high" | "default";

export type ChoiceLanguage = "english" | "korean" | null;

export type JobStatus =
  | "pending"
  | "analyzing"
  | "generating"
  | "validating"
  | "partially_completed"
  | "completed"
  | "failed";

export type QuestionStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "archived";

export type GenerationMode = "custom" | "preset";

export interface QuestionTypeOption {
  /** unique key used in request config counts, e.g. title:english:high */
  key: string;
  type: QuestionTypeCode;
  category: QuestionCategory;
  label: string;
  difficulty: DifficultyLevel;
  choiceLanguage: ChoiceLanguage;
  isObjective: boolean;
  preview: string;
  /** 아잉카 태그용 코드 (예: 요지추론) */
  aingkaCode?: string;
  /** 고정 한글 발문 */
  koreanStem?: string;
}

export interface QuestionTypeGroup {
  category: QuestionCategory;
  label: string;
  options: QuestionTypeOption[];
}

export interface GenerationRequestCounts {
  [optionKey: string]: number;
}

/** 생성 요청에 포함되는 개별 지문 */
export interface PassageInput {
  /** 클라이언트 임시 id (저장용) */
  clientId?: string;
  /** 지문별 제목 (비우면 공통 제목 + 번호) */
  title?: string;
  /** 지문별 출처 상세 (비우면 공통 sourceDetail) */
  sourceDetail?: string;
  text: string;
}

/**
 * 설계도 한 칸(동형모의고사): 시험지 번호 하나 = 문항 하나.
 * passageIndex는 passages 안의 지문 번호, optionKey는 유형 선택지 key.
 */
export interface BlueprintSlot {
  no: string;
  passageIndex: number;
  optionKey: string;
  level: "상" | "중" | "하";
  points?: number | null;
}

export interface GenerationRequestConfig {
  title: string;
  schoolName: string;
  grade: string;
  sourceType: string;
  sourceDetail: string;
  overallDifficulty: string;
  /** 단일 지문(하위 호환). passages가 있으면 무시될 수 있음 */
  passage: string;
  /** 다중 지문 (지문마다 동일 유형 세트 적용) */
  passages?: PassageInput[];
  /** 생성 시 저장된 지문 row id 목록 */
  passageIds?: string[];
  /** 어법·어휘에서 지문을 바꿔 쓸지(기본은 원문 그대로) */
  paraphraseGrammarVocab?: boolean;
  mode: GenerationMode;
  presetId: string | null;
  counts: GenerationRequestCounts;
  /** 있으면 counts 대신 이 순서대로 한 문항씩 만든다(동형모의고사) */
  blueprint?: BlueprintSlot[];
  /** 1지문 다문항: 지문마다 이 차례로 문항 2~3개를 만들고 시험지에는 지문을 한 번만 찍는다 */
  passageSet?: PassageSetConfig;
  /** 동형모의고사를 만든 시험 분석 id */
  examAnalysisId?: string;
  /**
   * 원래 시험지의 수준(평균 문장 길이·선택지 길이·추정 렉사일·어휘 등급)을 적은 한 문단.
   * 동형모의고사를 만들 때 새 문항의 선택지와 표현을 이 수준에 맞추게 한다.
   * 선생님 요청(2026-09-28): 수준과 유형이 정말 반영이 잘 되도록.
   */
  levelBrief?: string;
  /**
   * 조건 영작에서 쓸 어법 범위(어법 이름 목록). 비우면 교재 기준 목록에서 알아서 고른다.
   * 선생님 요청(2026-09-28): 그 문법을 무작위로 해도 되고 정해 둔 범위로 해도 좋다.
   */
  grammarScope?: string[];
  /**
   * 지정 문법으로 어떻게 만들지 (선생님 요청 2026-09-29).
   * - "passage": 그 어법이 이미 쓰인 지문 문장으로 만든다. 없으면 그 문항은 건너뛴다.
   * - "paraphrase": 중요한 문장을 그 어법으로 고쳐 써서 만든다(기본).
   */
  grammarWritingMode?: "passage" | "paraphrase";
  /**
   * 제시어 배열을 지문 문장 그대로 낼지, 고쳐 써서 낼지.
   * 기본은 지문 그대로(선생님 결정 2026-09-29). 예전에는 늘 고쳐 썼다.
   */
  wordOrderMode?: "passage" | "paraphrase";
  /** 동형모의고사 순서 배열을 지문 일부(이어진 7문장)로 낼지 — 「excerpt」면 코드가 잘라 준다 */
  orderMode?: "excerpt";
  forceGenerateDespiteWarnings?: boolean;
  /** 자료함(수업자료)에서 지문을 골라 만든 경우 그 지문 id. 있으면 자료함 변형문제 탭에 보인다. */
  lessonProjectIds?: string[];
  /**
   * 서버 실행 기록. 한 번의 실행은 5분 제한이 있어 문항이 많으면 여러 번에 나눠 이어서
   * 만든다(run-generation-job.ts). claimedAt은 지금 실행이 작업을 가져간 시각.
   */
  _run?: { claimedAt: string; chunk: number };
  /**
   * 크레딧 후불: 작업이 끝날 때 새로 만들어진 문항 수만큼 차감한다. billed는 이미 차감한 문항 수
   * (예전에 미리 차감한 작업은 그때까지 저장된 수). billedAt 이후에 저장된 문항만 새로 받는다 —
   * 지운 문항을 다시 만들거나 같은 작업으로 다시 만들어도 새 문항 값은 받는다.
   */
  _billing?: { mode: "post"; billed: number; billedAt?: string };
}

export interface PassageAnalysis {
  overallTopic: string;
  overallMainIdea: string;
  titleCandidates: string[];
  paragraphRoles: Array<{ index: number; role: string; summary: string }>;
  sentenceFacts: Array<{ sentence: string; keyInfo: string }>;
  eventRelations: string[];
  causeEffect: string[];
  compareContrast: string[];
  timeOrder: string[];
  properNouns: string[];
  numbers: string[];
  keyVocabulary: string[];
  antonymCandidates: Array<{ word: string; antonym: string; reason: string }>;
  grammarPoints: Array<{ span: string; point: string }>;
  insertionClues: string[];
  orderClues: string[];
  blankCandidates: string[];
  writingCandidates: string[];
  estimatedDifficulty: string;
  unsuitableTypes: Array<{ type: QuestionTypeCode; reason: string }>;
  warnings: string[];
}

export interface GeneratedChoice {
  number: number;
  text: string;
}

export interface GeneratedEvidence {
  sentence: string;
  description: string;
}

export interface ScoringGuide {
  totalPoints: number;
  fullScoreCondition: string;
  partialScoreConditions: Array<{ points: number; condition: string }>;
  requiredKeywords?: string[];
  requiredGrammar?: string[];
}

export interface QuestionValidation {
  singleCorrectAnswer: boolean;
  answerMatchesExplanation: boolean;
  evidenceExists: boolean;
  ambiguityRisk: "low" | "medium" | "high";
  difficultyMatch: boolean;
  grammarChecked: boolean;
  overallScore: number;
  warnings: string[];
  typeMatch?: boolean;
  /** 뜻을 읽는 검수(모델)의 판정. 규칙 검수가 못 보는 복수 정답·비문·원문 표현 오류 지목을 본다 */
  review?: { verdict: "pass" | "fix" | "drop"; reason: string; fixed?: string[] };
  /** 정답을 가리고 직접 풀어 본 결과 */
  solve?: { verdict: "pass" | "drop"; answer: number | null; reason: string };
  /** 몇 번째 시도에서 통과했나(1부터) */
  attempt?: number;
  /** 앞 시도들이 버려진 까닭 */
  earlierIssues?: string[];
}

export interface GeneratedQuestionPayload {
  type: QuestionTypeCode;
  category: QuestionCategory;
  difficulty: DifficultyLevel;
  choiceLanguage: ChoiceLanguage;
  passageOriginal: string;
  passageModified?: string;
  instruction: string;
  questionText: string;
  choices?: GeneratedChoice[];
  correctAnswer: string | number | number[];
  acceptableAnswers?: string[];
  explanation: string;
  /** 보기·지문에서 뽑은 고난도 단어 (해설지·단어학습) */
  hardWords?: Array<{ word: string; meaning: string }>;
  evidence: GeneratedEvidence[];
  scoringGuide?: ScoringGuide;
  validation?: QuestionValidation;
}

export interface PresetConfig {
  counts: GenerationRequestCounts;
}

export interface QuestionSetItem {
  questionId: string;
  orderIndex: number;
}
