/** Lesson-materials workbook types (ready + placeholder cards). */
import { defaultDocumentName } from "@/lib/lesson-materials/documents";
import type { TestSection, VocabExam } from "@/lib/lesson-materials/test-book";

export type WorkbookTypeId =
  | "grammar_choice"
  | "vocab_choice"
  | "grammar_fix"
  | "vocab_fix"
  | "blank_fill"
  | "tf"
  | "sentence_order"
  /** @deprecated removed from catalog; kept for old session payloads */
  | "vocab_example"
  | "one_line_ko"
  /** 제목·주제·요지 해석: 바꿔 쓴 영어 제목·주제·요지를 주고 우리말로 해석(선생님 2026-10-24) */
  | "gist_ko"
  | "full_en_writing"
  | "word_order_writing"
  /** 주제문·핵심 문장만 골라 어순배열(2026-10-07) */
  | "key_word_order"
  /*
   * 테스트 교재에서 옮긴 유형(2026-10-21 — 테스트 교재를 워크북·최종통합자료로 합침). 1장 자료 재료로
   * 조립하며, 재료는 지문당 lesson_workbook_extras로 한 번 받는다.
   */
  | "tb_chunk_line"
  | "tb_link"
  | "tb_insert"
  | "tb_summary"
  | "tb_reference"
  | "tb_implication"
  | "tb_paraphrase"
  | "tb_flow"
  | "tb_vocab_exam"
  | "tb_sequence";

export type WorkbookTypeMeta = {
  id: WorkbookTypeId;
  title: string;
  subtitle: string;
  ready: boolean;
  displayOrder: number;
  printOrder: number;
  /** 고르는 목록에는 안 보인다(다른 유형의 선택지로 고른다) */
  hidden?: boolean;
};

/**
 * 워크북 유형 순서. 만들기 화면의 목록, 실제 워크북, 인쇄, 정답이 모두 이 순서를 따른다.
 * 2026-09-11 선생님 지정: 한줄해석, T/F, 빈칸 채우기, 어법 선택, 어법 수정, 어휘 선택,
 * 어휘 수정, 문장 순서 배열, 어순배열 영작, 통문장 영작.
 * 2026-10-07 「중요문장 어순배열」(주제문·핵심 문장만)을 어순배열 영작 뒤에 더했다.
 */
export const WORKBOOK_TYPE_CATALOG: WorkbookTypeMeta[] = [
  {
    id: "one_line_ko",
    // 한줄해석·직독직해를 「해석 적기」 하나로(선생님 2026-10-21) — 만들 때 문장마다 / 끊어 읽기를 고른다
    title: "해석 적기",
    subtitle: "영어 문장을 한국어로 해석하기",
    ready: true,
    displayOrder: 1,
    printOrder: 1,
  },
  {
    id: "gist_ko",
    title: "제목·주제·요지 해석",
    subtitle: "바꿔 쓴 영어 제목·주제·요지를 우리말로 해석하기",
    ready: true,
    displayOrder: 1.7,
    printOrder: 1.7,
  },
  {
    id: "tf",
    title: "T/F 문제",
    subtitle: "지문 이해도를 확인하는 True/False 문항",
    ready: true,
    displayOrder: 2,
    printOrder: 2,
  },
  {
    id: "blank_fill",
    title: "빈칸 채우기",
    subtitle: "핵심 어휘에 생성된 빈칸을 채우며 지문 정리하기",
    ready: true,
    displayOrder: 3,
    printOrder: 3,
  },
  {
    id: "grammar_choice",
    title: "어법 선택",
    subtitle: "[A/B] 중 어법상 알맞은 것을 고르기",
    ready: true,
    displayOrder: 4,
    printOrder: 4,
  },
  {
    id: "grammar_fix",
    title: "어법 수정",
    subtitle: "어법상 어색한 부분을 고치는 서술형",
    ready: true,
    displayOrder: 5,
    printOrder: 5,
  },
  {
    id: "vocab_choice",
    title: "어휘 선택",
    subtitle: "[A/B] 중 문맥에 알맞은 어휘 고르기",
    ready: true,
    displayOrder: 6,
    printOrder: 6,
  },
  {
    id: "vocab_fix",
    title: "어휘 수정",
    subtitle: "문맥상 어색한 어휘를 고치는 서술형",
    ready: true,
    displayOrder: 7,
    printOrder: 7,
  },
  {
    id: "sentence_order",
    title: "문장 순서 배열",
    subtitle: "글의 흐름에 맞게 문장 순서 배열하기",
    ready: true,
    displayOrder: 8,
    printOrder: 8,
  },
  {
    id: "word_order_writing",
    title: "어순배열 영작",
    subtitle: "제시된 단어를 배열하여 문장 만들기",
    ready: true,
    displayOrder: 9,
    printOrder: 9,
  },
  {
    id: "key_word_order",
    title: "중요문장 어순배열",
    subtitle: "주제문·핵심 문장만 골라 어순 배열하기",
    ready: true,
    displayOrder: 10,
    printOrder: 10,
  },
  {
    id: "full_en_writing",
    title: "통문장 영작",
    subtitle: "한글 해석을 보고 영어 통문장 쓰기",
    ready: true,
    displayOrder: 11,
    printOrder: 11,
  },
  { id: "tb_chunk_line", title: "해석 적기 (끊어 읽기)", subtitle: "끊어 읽는 덩어리마다 뜻 쓰기", ready: true, displayOrder: 1, printOrder: 1, hidden: true },
  { id: "tb_link", title: "연결어 빈칸", subtitle: "However·Therefore 같은 연결어 채우기", ready: true, displayOrder: 13, printOrder: 13 },
  { id: "tb_insert", title: "문장 삽입", subtitle: "중요문장이 들어갈 자리 고르기", ready: true, displayOrder: 14, printOrder: 14 },
  { id: "tb_summary", title: "요약문 완성", subtitle: "한 문장 요약의 핵심어 채우기", ready: true, displayOrder: 15, printOrder: 15 },
  { id: "tb_reference", title: "지칭추론", subtitle: "밑줄 친 말이 가리키는 것 쓰기", ready: true, displayOrder: 16, printOrder: 16 },
  { id: "tb_implication", title: "함축의미", subtitle: "밑줄 친 표현이 뜻하는 바 쓰기", ready: true, displayOrder: 17, printOrder: 17 },
  // 「바꿔 말하기」는 뺐다(선생님 2026-10-21) — 예전에 만든 워크북은 그대로 보인다
  { id: "tb_flow", title: "도식화", subtitle: "글의 흐름 칸에 알맞은 내용 고르기", ready: true, displayOrder: 19, printOrder: 19 },
  { id: "tb_sequence", title: "글의 순서", subtitle: "주어진 글 뒤 (A)~(E) 순서 맞추기", ready: true, displayOrder: 21, printOrder: 21 },
  /*
   * 단어 시험은 한줄해석 바로 다음(선생님 2026-10-21). 단어 영↔한도 이 안에서 같이 낸다(뜻 쓰기·철자 쓰기 —
   * 따로 두니 두 번 나와 이상하다고 하셔서 하나로 합침). 유형마다 문항 수는 만들 때 고른다.
   */
  { id: "tb_vocab_exam", title: "단어 시험", subtitle: "영→한·한→영·동의어·반의어·파생어", ready: true, displayOrder: 1.5, printOrder: 1.5 },
];

/** 학습 계획표 이수 칸에 쓰는 짧은 이름(최종통합자료 계획표가 고른 워크북 유형으로 칸을 만든다) */
export const WORKBOOK_TYPE_SHORT: Record<WorkbookTypeId, string> = {
  one_line_ko: "해석",
  gist_ko: "제목주제",
  tf: "T/F",
  blank_fill: "빈칸",
  grammar_choice: "어법",
  grammar_fix: "어법수정",
  vocab_choice: "어휘",
  vocab_fix: "어휘수정",
  sentence_order: "순서",
  word_order_writing: "어순",
  key_word_order: "중요어순",
  full_en_writing: "영작",
  tb_chunk_line: "직독직해",
  tb_link: "연결어",
  tb_insert: "삽입",
  tb_summary: "요약",
  tb_reference: "지칭",
  tb_implication: "함축",
  tb_paraphrase: "바꿔말",
  tb_flow: "도식",
  tb_vocab_exam: "단어시험",
  tb_sequence: "글순서",
  vocab_example: "예문",
};

/** 테스트 교재에서 옮긴 워크북 유형 → 테스트 교재 문항 유형(단어 시험지는 따로 만든다) */
export const TB_WORKBOOK_TYPES = {
  tb_chunk_line: "line",
  tb_link: "link",
  tb_insert: "insert",
  tb_summary: "summary",
  tb_reference: "reference",
  tb_implication: "implication",
  tb_paraphrase: "paraphrase",
  tb_flow: "flow",
  tb_vocab_exam: null,
  tb_sequence: "sequence",
} as const;
export type TbWorkbookTypeId = keyof typeof TB_WORKBOOK_TYPES;
/** 규칙으로만 만드는 유형 — 유형마다 지문당 5(lesson_workbook_rule_type, 선생님 2026-10-28 「무료는 좀 그래」) */
export const WORKBOOK_RULE_TYPES = new Set<string>(["blank_fill", "sentence_order", "tb_link", "tb_sequence", "tb_insert"]);
/** 유형마다 지문당 값을 받는 유형(lesson_workbook_tb_type). 연결어·글의 순서·문장 삽입은 규칙으로만 만들어 값이 없다 */
export const TB_PAID_WORKBOOK_TYPES = new Set<string>([
  "tb_summary",
  "tb_flow",
  "tb_reference",
  "tb_implication",
  "tb_paraphrase",
  "tb_vocab_exam",
  "tb_chunk_line",
]);
export function isTbWorkbookType(id: string): id is TbWorkbookTypeId {
  return id in TB_WORKBOOK_TYPES;
}
/** 지문마다 테스트 교재 문항 하나(워크북 파일에 그대로 저장) */
export type WorkbookTbSection = {
  projectId: string;
  title: string;
  source: string | null;
  section: TestSection;
  /** 지문 원문(요약문 완성 위에 싣는다, 선생님 2026-10-27). 옛 워크북은 없어 화면이 불러온다. */
  passage?: string;
};

export const READY_WORKBOOK_TYPE_IDS: WorkbookTypeId[] = WORKBOOK_TYPE_CATALOG.filter(
  (t) => t.ready
).map((t) => t.id);

export function getWorkbookTypeMeta(id: WorkbookTypeId): WorkbookTypeMeta | undefined {
  return WORKBOOK_TYPE_CATALOG.find((t) => t.id === id);
}

/** Selected types sorted by printOrder (not click order). */
export function sortWorkbookTypesByPrintOrder(
  ids: WorkbookTypeId[]
): WorkbookTypeId[] {
  return [...new Set(ids)].sort((a, b) => {
    const pa = getWorkbookTypeMeta(a)?.printOrder ?? 999;
    const pb = getWorkbookTypeMeta(b)?.printOrder ?? 999;
    return pa - pb;
  });
}

/**
 * 선생님이 정한 항목 차례를 따른다. 정하지 않은 항목은 기본 인쇄 순서대로 뒤에 붙는다.
 * 선생님 요청(2026-10-20): 워크북 항목(한줄해석·어법 등) 순서를 바꿀 수 있게.
 */
export function orderWorkbookTypes(
  ids: WorkbookTypeId[],
  order: readonly WorkbookTypeId[] | null | undefined
): WorkbookTypeId[] {
  const base = sortWorkbookTypesByPrintOrder(ids);
  if (!order?.length) return base;
  const at = (id: WorkbookTypeId) => {
    const i = order.indexOf(id);
    return i >= 0 ? i : order.length;
  };
  return base.map((id, i) => ({ id, i })).sort((a, b) => at(a.id) - at(b.id) || a.i - b.i).map((x) => x.id);
}

export function workbookTypeDisplayTitle(id: WorkbookTypeId): string {
  if (id === "vocab_example") return "어휘 테스트 (예문)";
  return getWorkbookTypeMeta(id)?.title ?? id;
}

export type WorkbookTfLanguage = "en" | "ko";
export type WorkbookTfDifficulty = "normal" | "hard";

export type WorkbookTfOptions = {
  count: number;
  language: WorkbookTfLanguage;
  difficulty: WorkbookTfDifficulty;
};

export const DEFAULT_WORKBOOK_TF_OPTIONS: WorkbookTfOptions = {
  count: 4,
  language: "en",
  difficulty: "normal",
};

export type BlankHintType = "first_letter" | "none";
export type BlankTranslationLayout = "chunk" | "sentence_pair";
export type BlankDensity = "standard" | "high";

export type WorkbookBlankFillOptions = {
  hintType: BlankHintType;
  showTranslation: boolean;
  translationLayout: BlankTranslationLayout;
  density: BlankDensity;
};

export const DEFAULT_WORKBOOK_BLANK_OPTIONS: WorkbookBlankFillOptions = {
  hintType: "first_letter",
  showTranslation: true,
  translationLayout: "chunk",
  density: "high",
};

export type BlankGenerationMetadata = {
  englishWordCount: number;
  density: BlankDensity;
  targetBlankCount: number;
  actualBlankCount: number;
  shortfallReason: string | null;
};

export type WorkbookTranslation = {
  sentenceId: string;
  english: string;
  korean: string;
  source: "teacher" | "stored" | "refined" | "generated";
  validated: boolean;
};

export type WorkbookMetadata = {
  title: string;
  createdAt: string;
};

export type WorkbookTfItem = {
  index: number;
  statement: string;
  answer: "T" | "F";
  explanation: string;
  /** Required when answer is F — corrected true version */
  correctedStatement?: string;
};

export type WorkbookPassageSection = {
  projectId: string;
  title: string;
  source: string | null;
  passage: string;
  items: WorkbookTfItem[];
};

export type BlankPartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb";

export type GeneratedBlankCandidate = {
  id: string;
  sentenceId: string;
  answerText: string;
  occurrenceIndex: number;
  lemma: string;
  partOfSpeech: BlankPartOfSpeech;
  meaningKo: string;
  selectionReasonKo: string;
  priority: number;
};

export type BlankRenderToken =
  | { type: "text"; text: string }
  | {
      type: "blank";
      blankId: string;
      number: number;
      answerText: string;
      firstLetter?: string;
    };

export type WorkbookBlankAnswer = {
  number: number;
  answerText: string;
  lemma: string;
  meaningKo: string;
};

export type WorkbookBlankSentence = {
  id: string;
  english: string;
  korean: string;
  tokens: BlankRenderToken[];
};

export type WorkbookBlankSection = {
  projectId: string;
  title: string;
  source: string | null;
  sourcePassage: string;
  sentences: WorkbookBlankSentence[];
  /** Chunk layout: all sentence tokens flattened with spaces between sentences */
  passageTokens: BlankRenderToken[];
  answers: WorkbookBlankAnswer[];
  fullKorean: string;
  translationWarning?: string;
  generation?: BlankGenerationMetadata;
  translations?: WorkbookTranslation[];
};

export type WorkbookGenerationTiming = {
  dataLoadMs: number;
  translationLookupMs: number;
  blankSelectionMs: number;
  pdfRenderMs: number;
  totalMs: number;
  openAiRequestCount: number;
};

/** Sentence-order workbook question (deterministic shuffle stored once). */
export type WorkbookSentenceOrderItem = {
  displayNumber: number;
  sentenceId: string;
  english: string;
  englishDisplay: string;
  originalOrderIndex: number;
};

export type WorkbookSentenceOrderQuestion = {
  questionId: string;
  passageId: string;
  title: string;
  source: string | null;
  setIndex: number;
  passageOrdinal: number;
  seed: string;
  pinFirstSentence: boolean;
  givenSentence: {
    sentenceId: string;
    english: string;
    englishDisplay: string;
    originalOrderIndex: number;
  } | null;
  originalSentenceIds: string[];
  originalEnglish: string[];
  shuffledSentenceIds: string[];
  shuffledItems: WorkbookSentenceOrderItem[];
  answerOrderNumbers: number[];
  restoredPassagePreview: string;
};

export type WorkbookSentenceOrderSkip = {
  projectId: string;
  title: string;
  reason: string;
};

export type WorkbookLineTranslationItem = {
  sentenceId: string;
  orderIndex: number;
  english: string;
  englishDisplay: string;
  korean: string;
  sourceHash: string;
  answerLineCount: number;
};

export type WorkbookLineTranslationSection = {
  projectId: string;
  title: string;
  source: string | null;
  items: WorkbookLineTranslationItem[];
  algorithmVersion: string;
};

export type WorkbookLineTranslationSkip = {
  projectId: string;
  title: string;
  reason: string;
};

/** 제목·주제·요지 해석(선생님 2026-10-24): 갈래마다 몇 개를 줄지(0~3). */
export type WorkbookGistOptions = {
  title: number;
  topic: number;
  gist: number;
};
export const DEFAULT_WORKBOOK_GIST_OPTIONS: WorkbookGistOptions = { title: 1, topic: 1, gist: 1 };
export const MAX_GIST_COUNT = 3;
export function clampGistCount(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(MAX_GIST_COUNT, v));
}
/** "1,1,1"(제목,주제,요지) ↔ 옵션 */
export function parseGistOptions(raw: string | null | undefined): WorkbookGistOptions {
  if (!raw?.trim()) return DEFAULT_WORKBOOK_GIST_OPTIONS;
  const [t, p, g] = raw.split(",").map((x) => clampGistCount(x));
  return { title: t ?? 1, topic: p ?? 1, gist: g ?? 1 };
}
export function gistOptionsParam(o: WorkbookGistOptions): string {
  return [o.title, o.topic, o.gist].map(clampGistCount).join(",");
}
export const GIST_KIND_LABEL = { title: "제목", topic: "주제", gist: "요지" } as const;
export type WorkbookGistKind = keyof typeof GIST_KIND_LABEL;

export type WorkbookGistItem = {
  orderIndex: number;
  kind: WorkbookGistKind;
  /** 지문 문장을 베끼지 않고 바꿔 쓴 영어 */
  english: string;
  /** 정답(우리말 해석) */
  korean: string;
  answerLineCount: number;
};

export type WorkbookGistSection = {
  projectId: string;
  title: string;
  source: string | null;
  items: WorkbookGistItem[];
  /** 지문 원문(문항 위에 싣는다, 선생님 2026-10-27). 옛 워크북은 없어 화면이 불러온다. */
  passage?: string;
};

export type WorkbookFullEnWritingItem = {
  sentenceId: string;
  orderIndex: number;
  english: string;
  englishDisplay: string;
  korean: string;
  sourceHash: string;
  answerLineCount: number;
};

export type WorkbookFullEnWritingSection = {
  projectId: string;
  title: string;
  source: string | null;
  items: WorkbookFullEnWritingItem[];
  algorithmVersion: string;
};

export type WorkbookWordOrderChunk = {
  chunkId: string;
  text: string;
  originalIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
};

export type WorkbookWordOrderWritingItem = {
  questionId: string;
  passageId: string;
  sentenceId: string;
  orderIndex: number;
  korean: string;
  originalEnglish: string;
  originalChunks: WorkbookWordOrderChunk[];
  shuffledChunks: WorkbookWordOrderChunk[];
  seed: string;
  sourceHash: string;
  answerLineCount: number;
  chunkSource?:
    | "stored-syntax"
    | "cached-ai"
    | "new-ai"
    | "deterministic-fallback"
    | "legacy-word-groups"
    | "stored"
    | "cache"
    | "openai"
    | "fallback";
  chunkValidationPassed?: boolean;
};

export type WorkbookWordOrderWritingSection = {
  projectId: string;
  title: string;
  source: string | null;
  items: WorkbookWordOrderWritingItem[];
  algorithmVersion: string;
};

export type GrammarChoiceAmbiguityRisk = "low" | "medium" | "high";

export type GrammarChoiceSourceType =
  | "analysis_required"
  | "ai_supplement"
  | "heuristic_supplement";

export type GrammarChoiceCandidate = {
  choiceId: string;
  passageId: string;
  sentenceId: string;
  startTokenIndex: number;
  endTokenIndex: number;
  originalText: string;
  correctText: string;
  incorrectText: string;
  grammarCategoryId: string;
  grammarCategoryName: string;
  bookTerm: string;
  /** 문항이 묻는 것과 코드가 어긋나 정답지에 라벨을 싣지 않는다. */
  labelHidden?: boolean;
  explanationKo: string;
  incorrectReasonKo: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  learningValue: 1 | 2 | 3 | 4 | 5;
  ambiguityRisk: GrammarChoiceAmbiguityRisk;
  sourceType?: GrammarChoiceSourceType;
  analysisPointId?: string | null;
  structureSummary?: string;
};

export type GrammarChoiceRenderSegment =
  | { type: "text"; text: string }
  | {
      type: "choice";
      number: number;
      leftText: string;
      rightText: string;
    };

export type WorkbookGrammarChoiceItem = {
  number: number;
  choiceId: string;
  sentenceId: string;
  startTokenIndex: number;
  endTokenIndex: number;
  /** Inclusive start / exclusive end in sourcePassage */
  startCharIndex: number;
  endCharIndex: number;
  originalText: string;
  correctText: string;
  incorrectText: string;
  leftText: string;
  rightText: string;
  correctSide: "left" | "right";
  grammarCategoryId: string;
  grammarCategoryName: string;
  bookTerm: string;
  /** 문항이 묻는 것과 코드가 어긋나 정답지에 라벨을 싣지 않는다. */
  labelHidden?: boolean;
  explanationKo: string;
  incorrectReasonKo: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  learningValue: 1 | 2 | 3 | 4 | 5;
  sourceType?: GrammarChoiceSourceType;
  analysisPointId?: string | null;
  structureSummary?: string;
  analysisOriginLabel?: string;
  /** Teacher/replay provenance. Not rendered on the student surface. */
  internalProvenance?: {
    code: string;
    subtype: string;
    priority: string;
    assessmentAxis: string;
    occurrenceId: string;
    sourceSpan: string;
    candidateId: string;
    exclusionReason: string | null;
  };
};

export type WorkbookGrammarChoiceDiagnostics = {
  sentenceCount: number;
  analysisHintCount: number;
  generatedCandidateCount: number;
  codeValidatedCount: number;
  originalMismatchCount: number;
  rangeErrorCount: number;
  overlapDuplicateCount: number;
  reviewSubmittedCount: number;
  reviewAcceptedCount: number;
  bothPossibleRejectCount: number;
  lexicalRejectCount: number;
  trivialRejectCount: number;
  finalCount: number;
  grammarCategoryCount: number;
  averageQualityScore: number;
  passageRestored: boolean;
  cacheHit: boolean;
  generatorModel: string;
  reviewerModel: string;
  /** OpenAI 응답 JSON의 model 필드 (요청명과 다를 수 있음) */
  generatorResponseModel: string;
  reviewerResponseModel: string;
  generatorActualResponseModel: string;
  reviewerActualResponseModel: string;
  generatorReasoningEffort: string;
  reviewerReasoningEffort: string;
  reasoningEffort: string;
  openAICallCount: number;
  localFallbackUsed: false;
  generatorVersion: string;
  /** Engine actually used for this section. Teacher diagnostics only. */
  engineVersion?: "v1" | "v2";
  /** Set when GRAMMAR_CHOICE_ENGINE_VERSION is neither v1 nor v2. */
  engineSelectionNote?: string;
  reviewerVersion: string;
  apiCalls: Array<{
    stage: "GENERATOR_INITIAL" | "GENERATOR_TOP_UP" | "REVIEWER";
    requestedModel: string;
    actualResponseModel: string;
    reasoningEffort: string;
  }>;
  forceRegenerate: boolean;
  oldQuestionReuseCount: number;
  generatorActualModel: string;
  reviewerActualModel: string;
  newQuestionCount: number;
  desiredQuestionCount?: number;
  discoveredGrammarPointCount?: number;
  initialCandidateCount?: number;
  initialApprovedCount?: number;
  topUpRoundCount?: number;
  topUpCandidateCount?: number;
  topUpApprovedCount?: number;
  finalQuestionCount?: number;
  renderedQuestionCount?: number;
  countMismatch?: boolean;
  difficultyMix?: { BASIC: number; CORE: number; ADVANCED: number };
  sentencePointCounts?: Array<{ sentenceId: string; count: number }>;
  rejectReasonCounts?: Record<string, number>;
  /** Same distractor pair with the same code/subtype appearing more than once. */
  repeatedCodeSubtypePairs?: string[];
  generateApiCalls: number;
  reviewApiCalls: number;
  underTargetReason: string | null;
  mandatoryDetected?: number;
  mandatoryEligible?: number;
  mandatoryRendered?: number;
  mandatoryExcludedWithValidReason?: number;
  sectionStatus?: "COMPLETE" | "PARTIAL" | "REJECTED";
  analysisOnlyCount?: number;
  eligibleQuestionCount?: number;
  excludedOccurrenceCount?: number;
  missingEligibleCount?: number;
  mandatoryCoverage?: "N/A" | number;
  /** MANDATORY grammar occurrences. Not student items. */
  detectedMandatoryOccurrences?: number;
  analysisOnlyMandatoryOccurrences?: number;
  eligibleMandatoryOccurrences?: number;
  validExcludedMandatoryOccurrences?: number;
  renderedMandatoryOccurrences?: number;
  missingEligibleMandatoryOccurrences?: number;
  /** Student-question candidates, not mixed with mandatory detections. */
  totalEligibleQuestions?: number;
  /** Student items actually inserted. */
  totalRenderedQuestions?: number;
  /** All-priority occurrence exclusions. */
  totalExcludedOccurrences?: number;
  countUnits?: Record<string, string>;
  /** Teacher-only. Set only when GRAMMAR_CHOICE_ENGINE_COMPARE=1. */
  staffCompareNote?: string;
  reviewRejectSamples: Array<{ candidateId: string; reasons: string[] }>;
  codeRejectSamples: Array<{
    candidateId: string;
    reason: string;
    pair: string;
  }>;
};

export type WorkbookGrammarChoiceSection = {
  projectId: string;
  title: string;
  source: string | null;
  sourcePassage: string;
  segments: GrammarChoiceRenderSegment[];
  items: WorkbookGrammarChoiceItem[];
  algorithmVersion: string;
  diagnostics?: WorkbookGrammarChoiceDiagnostics;
};

export type WorkbookGrammarChoiceSkip = {
  projectId: string;
  title: string;
  reason: string;
};

export type WorkbookData = {
  metadata: WorkbookMetadata;
  selectedTypes: WorkbookTypeId[];
  tfOptions: WorkbookTfOptions;
  blankOptions: WorkbookBlankFillOptions;
  /** T/F sections (empty when T/F not selected) */
  sections: WorkbookPassageSection[];
  /** Blank-fill sections (empty when blank_fill not selected) */
  blankSections: WorkbookBlankSection[];
  /** Grammar-choice sections */
  grammarChoiceSections?: WorkbookGrammarChoiceSection[];
  grammarChoiceSkipped?: WorkbookGrammarChoiceSkip[];
  /** Sentence-order questions (empty when sentence_order not selected) */
  sentenceOrderQuestions?: WorkbookSentenceOrderQuestion[];
  /** Passages skipped for sentence-order (too few sentences / restore fail) */
  sentenceOrderSkipped?: WorkbookSentenceOrderSkip[];
  /** One-line Korean translation sections */
  lineTranslationSections?: WorkbookLineTranslationSection[];
  lineTranslationSkipped?: WorkbookLineTranslationSkip[];
  /** 제목·주제·요지 해석(영어 제시 → 우리말 해석) */
  gistSections?: WorkbookGistSection[];
  gistSkipped?: WorkbookLineTranslationSkip[];
  gistOptions?: WorkbookGistOptions;
  /** Full-sentence English writing (Korean prompt → English answer) */
  fullEnWritingSections?: WorkbookFullEnWritingSection[];
  fullEnWritingSkipped?: WorkbookLineTranslationSkip[];
  /** Word-order writing (Korean + scrambled tokens → English) */
  wordOrderWritingSections?: WorkbookWordOrderWritingSection[];
  wordOrderWritingSkipped?: WorkbookLineTranslationSkip[];
  /** 중요문장 어순배열 — 어순배열 영작과 같은 꼴, 주제문·핵심 문장만 */
  keyWordOrderSections?: WorkbookWordOrderWritingSection[];
  /** 어법 수정: 어법 선택에서 검수한 자리 중 몇 곳에 틀린 형태를 넣은 지문 */
  grammarFixSections?: WorkbookGrammarFixSection[];
  grammarFixSkipped?: WorkbookGrammarChoiceSkip[];
  grammarFixOptions?: WorkbookGrammarFixOptions;
  /** 어휘 선택: [원래 낱말 / 문맥상 틀린 낱말] 중 고르기. 어휘 수정의 재료이기도 하다. */
  vocabChoiceSections?: WorkbookVocabChoiceSection[];
  vocabChoiceSkipped?: WorkbookGrammarChoiceSkip[];
  /** 어휘 수정: 어휘 선택 쌍으로 만든다(구조는 어법 수정과 같다). */
  vocabFixSections?: WorkbookGrammarFixSection[];
  vocabFixSkipped?: WorkbookGrammarChoiceSkip[];
  vocabFixOptions?: WorkbookGrammarFixOptions;
  /** 어휘 선택·수정 낱말 수준(EngCore 단어장 기준). 없으면 예전에 만든 것(난이도 UP과 같다). */
  vocabWordLevel?: "normal" | "hard";
  /** 유형별 단 수. 없으면 1단. 한줄해석·통문장 영작·어순배열 영작은 늘 1단이다. */
  columnLayout?: Partial<Record<WorkbookColumnTypeId, 1 | 2>>;
  /**
   * 정답지 단 수. 2면 정답지를 두 단으로 싣는다(없으면 1단).
   * 선생님 말씀(2026-10-20): 답지가 한 단이라 쪽이 너무 많다(답지는 따로 프린트한다).
   */
  answerColumns?: 1 | 2;
  /** 백지노트(지문마다 2쪽)를 정답지 앞에 붙인다 — 다시 만들지 않고 값도 없다(선생님 2026-10-27) */
  blankNote?: boolean;
  /** 항목 인쇄 차례. 없으면 기본 순서(printOrder). */
  typeOrder?: WorkbookTypeId[];
  /**
   * 항목마다 지문 배치. "page"면 지문마다 새 쪽에서 시작하고, 없으면 앞 지문에 이어 싣는다.
   * 선생님 요청(2026-10-20): 한줄해석·어법 등을 한 지문씩 낼지 이어서 낼지 고르게.
   */
  passageBreak?: Partial<Record<WorkbookTypeId, "page">>;
  /**
   * 나오는 순서. "passage"면 지문별(지문 하나에 고른 유형을 다 풀고 다음 지문, 지문마다 새 쪽),
   * 없거나 "type"이면 유형별(지금까지 방식). 선생님 2026-10-26.
   */
  layoutOrder?: "type" | "passage";
  /**
   * 지문별일 때 지문(유형)마다 새 쪽에서 시작하지 않고, 단 수가 같은 유형(2단 도식화·T/F 등)을 지문 차례대로
   * 이어 실어 한 쪽에 둘 이상 나오게 한다(Jayden 선생님 2026-11-20). 해석 적기 같은 쓰기 유형은 그대로 새 쪽.
   */
  passageJoin?: boolean;
  timing?: WorkbookGenerationTiming;
  /** 테스트 교재에서 옮긴 유형의 문항(유형마다 지문 목록). 단어 시험지는 vocabExam. */
  tbSections?: Partial<Record<TbWorkbookTypeId, WorkbookTbSection[]>>;
  vocabExam?: VocabExam | null;
  tbSkipped?: Partial<Record<TbWorkbookTypeId, WorkbookGrammarChoiceSkip[]>>;
};

/** 1단·2단을 고를 수 있는 유형(쓰기 칸이 있는 유형은 뺀다). */
export const WORKBOOK_COLUMN_TYPES = [
  "grammar_choice",
  "grammar_fix",
  "vocab_choice",
  "vocab_fix",
  "blank_fill",
  "tf",
  "sentence_order",
  "tb_chunk_line",
  "tb_link",
  "tb_insert",
  "tb_summary",
  "tb_reference",
  "tb_implication",
  "tb_paraphrase",
  "tb_flow",
  "tb_vocab_exam",
  "tb_sequence",
] as const;
export type WorkbookColumnTypeId = (typeof WORKBOOK_COLUMN_TYPES)[number];

/**
 * 어법 수정 출제 방식.
 * - underline: 밑줄 친 여러 곳 중 틀린 것을 찾아 고친다(틀린 곳 수를 알려 준다).
 * - find: 밑줄 없이 지문에서 틀린 곳을 찾아 고친다.
 */
export type WorkbookGrammarFixMode = "underline" | "find";

export type WorkbookGrammarFixOptions = {
  mode: WorkbookGrammarFixMode;
  /** 지문당 틀린 곳 수(어법 선택 자리가 모자라면 그만큼 줄어든다). */
  errorCount: number;
};

export const DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS: WorkbookGrammarFixOptions = {
  mode: "underline",
  errorCount: 3,
};

export const GRAMMAR_FIX_ERROR_COUNTS = [2, 3, 4, 5] as const;

export function clampGrammarFixErrors(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_WORKBOOK_GRAMMAR_FIX_OPTIONS.errorCount;
  return Math.min(5, Math.max(1, Math.floor(v)));
}

export function parseGrammarFixMode(raw: unknown): WorkbookGrammarFixMode {
  return raw === "find" ? "find" : "underline";
}

export type GrammarFixRenderSegment =
  | { type: "text"; text: string }
  /** 밑줄형은 번호가 있고, 찾기형 틀린 곳은 번호 없이 본문에 섞인다. */
  | { type: "spot"; number: number | null; text: string };

export type WorkbookGrammarFixAnswer = {
  /** 밑줄 번호(찾기형은 null) */
  number: number | null;
  wrongText: string;
  correctText: string;
};

export type WorkbookVocabChoiceItem = {
  number: number;
  choiceId: string;
  sentenceId: string;
  /** Inclusive start / exclusive end in sourcePassage */
  startCharIndex: number;
  endCharIndex: number;
  correctText: string;
  incorrectText: string;
  leftText: string;
  rightText: string;
  correctSide: "left" | "right";
  /** 문맥상 원래 낱말의 뜻 */
  meaningKo: string;
  relation: string;
  learningValue: number;
  /** 수정형을 만들 때 자리를 고르게 퍼뜨리는 열쇠(어법의 문법 항목 자리) */
  grammarCategoryId: string;
};

export type WorkbookVocabChoiceSection = {
  projectId: string;
  title: string;
  source: string | null;
  sourcePassage: string;
  segments: GrammarChoiceRenderSegment[];
  items: WorkbookVocabChoiceItem[];
  algorithmVersion: string;
};

export type WorkbookGrammarFixSection = {
  projectId: string;
  title: string;
  source: string | null;
  mode: WorkbookGrammarFixMode;
  segments: GrammarFixRenderSegment[];
  /** 틀린 곳, 지문 순서 */
  answers: WorkbookGrammarFixAnswer[];
  /** 밑줄 친 곳 수(찾기형은 틀린 곳 수와 같다) */
  spotCount: number;
};

/** Soft target range for grammar-choice count by passage length. */
export function getGrammarChoiceTargetRange(englishWordCount: number): {
  min: number;
  max: number;
} {
  // Kept for legacy imports; v5 uses getGrammarChoiceFinalTargetRange
  if (englishWordCount < 80) return { min: 4, max: 6 };
  if (englishWordCount < 120) return { min: 6, max: 8 };
  if (englishWordCount < 180) return { min: 8, max: 12 };
  return { min: 10, max: 14 };
}

/** 워크북_0911 (한국 시간). 워크북 파일 이름의 기본값이기도 하다. */
export function defaultWorkbookTitle(d = new Date()): string {
  return defaultDocumentName("workbook", d);
}

/** 지문 1개당 T/F 선택지 최대 개수. */
export const MAX_TF_COUNT = 20;

export function clampTfCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 4;
  return Math.min(MAX_TF_COUNT, Math.max(1, Math.floor(v)));
}

export function countEnglishWords(text: string): number {
  // Hyphenated compounds count as one; drop pure numbers / punctuation-only.
  const m = formatWorkbookPassage(text).match(
    /[A-Za-z]+(?:-[A-Za-z]+)*(?:'[A-Za-z]+)?/g
  );
  return m?.length ?? 0;
}

/** @deprecated use computeBlankTargetCount — kept as standard-density alias */
export function recommendedBlankCount(englishWordCount: number): number {
  return computeBlankTargetCount({
    englishWordCount,
    density: "standard",
    hintType: "first_letter",
    showTranslation: true,
  });
}

export function computeBlankTargetCount(input: {
  englishWordCount: number;
  density: BlankDensity;
  hintType: BlankHintType;
  showTranslation: boolean;
}): number {
  const { low, high } = getBlankTargetRange({
    englishWordCount: input.englishWordCount,
    density: input.density,
  });
  // Prefer upper-mid of range so density expands when good content words exist
  let target = Math.round(low + (high - low) * 0.7);
  if (input.hintType === "none") target = Math.max(low, target - 1);
  if (!input.showTranslation) target = Math.max(low, target - 1);
  return Math.min(high, Math.max(low, target));
}

export function getBlankTargetRange(input: {
  englishWordCount: number;
  density: BlankDensity;
}): { low: number; high: number } {
  const n = Math.max(0, input.englishWordCount);
  if (input.density === "standard") {
    if (n < 100) return { low: 12, high: 15 };
    if (n < 150) return { low: 17, high: 20 };
    if (n < 200) return { low: 21, high: 25 };
    if (n < 250) return { low: 25, high: 30 };
    const low = Math.max(25, Math.round(n * 0.11));
    const high = Math.max(low + 1, Math.round(n * 0.13));
    return { low, high };
  }
  // high = 많이 / 난이도 UP
  if (n < 100) return { low: 16, high: 20 };
  if (n < 150) return { low: 21, high: 25 };
  if (n < 200) return { low: 26, high: 31 };
  if (n < 250) return { low: 31, high: 37 };
  const low = Math.max(31, Math.round(n * 0.14));
  const high = Math.max(low + 1, Math.round(n * 0.16));
  return { low, high };
}

export function getMaxBlanksForSentence(
  sentenceWordCount: number,
  density: BlankDensity
): number {
  if (density === "standard") {
    if (sentenceWordCount <= 8) return 2;
    if (sentenceWordCount <= 16) return 3;
    if (sentenceWordCount <= 26) return 4;
    return 5;
  }
  if (sentenceWordCount <= 8) return 2;
  if (sentenceWordCount <= 14) return 3;
  if (sentenceWordCount <= 22) return 4;
  if (sentenceWordCount <= 32) return 5;
  return 6;
}

export function parseBlankHintType(raw: string | null | undefined): BlankHintType {
  return raw === "none" ? "none" : "first_letter";
}

export function parseBlankTranslationLayout(
  raw: string | null | undefined
): BlankTranslationLayout {
  return raw === "sentence_pair" ? "sentence_pair" : "chunk";
}

export function parseBlankDensity(raw: string | null | undefined): BlankDensity {
  return raw === "standard" ? "standard" : "high";
}

export function estimateBlankCountPreview(options: WorkbookBlankFillOptions): {
  low: number;
  high: number;
} {
  const a = getBlankTargetRange({
    englishWordCount: 120,
    density: options.density,
  });
  const b = getBlankTargetRange({
    englishWordCount: 180,
    density: options.density,
  });
  return { low: a.low, high: b.high };
}

/**
 * Collapse OCR/import hard wraps (and blank lines) into one flowing paragraph.
 */
export function formatWorkbookPassage(text: string): string {
  const cleaned = String(text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?p[^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ")
    .replace(/[\t\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned.replace(/(\w)-\s+(\w)/g, "$1$2");
}

/** Join sentence/line rows into a single continuous passage. */
export function joinWorkbookPassageLines(lines: string[]): string {
  const parts = lines.map((l) => formatWorkbookPassage(l)).filter(Boolean);
  if (parts.length === 0) return "";
  let out = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!;
    if (out.endsWith("-") && /^[a-z]/.test(next)) {
      out = `${out.slice(0, -1)}${next}`;
    } else {
      out = `${out} ${next}`;
    }
  }
  return formatWorkbookPassage(out);
}
