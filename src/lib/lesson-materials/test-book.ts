/**
 * 테스트 교재(수업자료 NEW, 정수학원) 공용 — 브라우저에서도 쓴다.
 *
 * 선생님 구성(2026-10-19): 워크북을 숙제로 길게 내는 대신, 교재에는 단어 정리·동반의어 테스트·
 * 수업용 자료·테스트 견본·백지노트를 싣고, 학원에서는 같은 재료로 테스트지를 무작위로 뽑아
 * 1:1로 채점한다. 틀린 것은 백지노트에 정리한다.
 *
 * 재료는 지문마다 한 번 만들어 lesson_pack_json.testBookMaterial에 둔다(단어 정리·중요문장·
 * 어순 덩어리). 문항은 1장 자료 재료(onePageContent: 동반의어·어법 포인트·T/F·요약문)와 이 재료로
 * 규칙에 따라 조립하므로, 견본과 뽑기 모두 모델을 다시 부르지 않는다.
 * 섞기는 열쇠(seed)로 정해진다 — 교재 견본은 늘 같은 열쇠, 뽑기는 누를 때마다 새 열쇠.
 */
import { fixVocabWord, isBadWordForm, isEmptyVocabWord, isProperNounVocab } from "@/lib/lesson-materials/bad-word-forms";
import { sameCaseChoices } from "@/lib/lesson-materials/choice-case";
import {
  createSeededRng,
  fisherYatesShuffle,
  hashSeedToUint32,
  stripLeadingSentenceMarkers,
} from "@/lib/lesson-materials/sentence-order-shuffle";
import { formatWorkbookPassage } from "@/lib/lesson-materials/workbook-types";
import { normalizeCoverOverrides, type BookCoverSpec } from "@/lib/lesson-materials/book-cover";
import {
  answerSentence,
  buildOnePageSentenceOrder,
  findPhrase,
  findPhraseAt,
  splitSummaryByKeywords,
  type OnePageContent,
} from "@/lib/lesson-materials/one-page";
import type { AnalysisReportData } from "@/lib/lesson-materials/generate-analysis-report";
import type { WorkbookGrammarChoiceSection, WorkbookVocabChoiceSection } from "@/lib/lesson-materials/workbook-types";
import { addChoiceItem, type ChoiceSection } from "@/lib/lesson-materials/choice-edit";
import { inflectionsOf, verbBaseForms } from "@/lib/question-generator/verb-forms";

/**
 * 재료 형식이 바뀌면 올린다. 원문이 그대로인 옛 재료는 열 때 단어 정리(모델 호출)는 그대로 두고
 * 중요문장·어순 덩어리처럼 규칙으로 만드는 것만 다시 계산한다(선생님 2026-10-20: 들어갈 때마다
 * 새로 만드는 것 같고 너무 오래 걸린다 — 버전을 올리면 지문마다 단어 정리를 처음부터 다시 만들었다).
 */
export const TEST_BOOK_MATERIAL_VERSION = "tb-4";
/** 단어 정리(모델이 만드는 부분) 규칙이 바뀌면 올린다 — 이것만 다르면 단어 정리만 다시 만든다 */
export const TEST_BOOK_VOCAB_VERSION = "tv-5";

// ---------------------------------------------------------------- 유형

export type TestBookTypeKey =
  | "line"
  | "gist"
  | "vocabFix"
  | "sentenceOrder"
  | "wordOrder"
  | "blank"
  | "grammar"
  | "vocab"
  | "order"
  | "tf"
  | "writing"
  | "link"
  | "sequence"
  | "insert"
  | "summary"
  | "grammarFix"
  | "words"
  | "reference"
  | "implication"
  | "paraphrase"
  | "flow";

/*
 * 유형 이름·차례는 워크북과 같게(선생님 2026-10-26 — 테스트지 뽑기도 워크북과 같은 유형·같은 순서로).
 * 워크북 차례: 해석 적기 · 제목·주제·요지 해석 · T/F 문제 · 빈칸 채우기 · 어법 선택 · 어법 수정 · 어휘 선택 ·
 * 어휘 수정 · 문장 순서 배열 · 어순배열 영작 · 중요문장 어순배열 · 통문장 영작 · 연결어 빈칸 · 문장 삽입 ·
 * 요약문 완성 · 지칭추론 · 함축의미 · 도식화 · 글의 순서. (단어 시험은 따로 나가는 단어 시험지)
 */
export const TEST_BOOK_TYPES: Array<{ key: TestBookTypeKey; label: string; basic: boolean; hint: string }> = [
  { key: "line", label: "해석 적기", basic: true, hint: "문장을 보고 해석 쓰기" },
  { key: "gist", label: "제목·주제·요지 해석", basic: false, hint: "영어 제목·요지를 우리말로 해석하기" },
  { key: "tf", label: "T/F 문제", basic: true, hint: "바꿔 쓴 문장으로 참·거짓" },
  { key: "blank", label: "빈칸 채우기", basic: true, hint: "해석을 보고 핵심어 채우기" },
  { key: "grammar", label: "어법 선택", basic: true, hint: "[ 바른 형태 / 틀린 형태 ] 고르기" },
  { key: "grammarFix", label: "어법 수정", basic: false, hint: "틀린 곳 찾아 고쳐 쓰기" },
  { key: "vocab", label: "어휘 선택", basic: true, hint: "[ 문맥에 맞는 말 / 반대말 ] 고르기" },
  { key: "vocabFix", label: "어휘 수정", basic: false, hint: "문맥상 어색한 어휘 찾아 고쳐 쓰기" },
  { key: "sentenceOrder", label: "문장 순서 배열", basic: false, hint: "첫 문장 뒤 문장들을 글의 흐름대로 배열하기" },
  { key: "wordOrder", label: "어순배열 영작", basic: false, hint: "모든 문장을 덩어리 배열로 영작하기" },
  { key: "order", label: "중요문장 어순배열", basic: true, hint: "워크북과 같은 덩어리, 섞는 순서만 새로" },
  { key: "writing", label: "통문장 영작", basic: true, hint: "중요문장 해석만 보고 영어로 쓰기" },
  { key: "link", label: "연결어 빈칸", basic: true, hint: "However·Therefore 같은 연결어 채우기" },
  { key: "insert", label: "문장 삽입", basic: false, hint: "중요문장이 들어갈 자리 고르기" },
  { key: "summary", label: "요약문 완성", basic: false, hint: "요약 한 문장의 핵심어 채우기" },
  // 「단어 영↔한」은 뺐다 — 단어 시험지가 같이 나간다(선생님 2026-10-21)
  { key: "reference", label: "지칭추론", basic: false, hint: "밑줄 친 말이 가리키는 것을 본문에서 찾아 쓰기" },
  { key: "implication", label: "함축의미", basic: false, hint: "밑줄 친 표현이 이 글에서 뜻하는 바 쓰기" },
  // 「바꿔 말하기」는 뺐다(선생님 2026-10-21 — 워크북·분석서에서도 안 넣는다)
  { key: "flow", label: "도식화", basic: false, hint: "글의 흐름 칸에 알맞은 내용 고르기" },
  { key: "sequence", label: "글의 순서", basic: false, hint: "주어진 글 뒤 (A)~(E) 순서 맞추기" },
];

export const ALL_TEST_BOOK_TYPES: TestBookTypeKey[] = TEST_BOOK_TYPES.map((t) => t.key);
export const BASIC_TEST_BOOK_TYPES: TestBookTypeKey[] = TEST_BOOK_TYPES.filter((t) => t.basic).map((t) => t.key);

export function testBookTypeLabel(key: TestBookTypeKey): string {
  return TEST_BOOK_TYPES.find((t) => t.key === key)?.label ?? key;
}

/** 저장값을 읽는다. 모르는 값은 버리고, 차례는 유형 목록 차례로 맞춘다. */
export function normalizeTestBookTypes(raw: unknown, fallback = BASIC_TEST_BOOK_TYPES): TestBookTypeKey[] {
  if (!Array.isArray(raw)) return [...fallback];
  const on = new Set(raw.map(String));
  return ALL_TEST_BOOK_TYPES.filter((k) => on.has(k));
}

// ---------------------------------------------------------------- 재료

/** 단어 정리 한 줄. 동의어·반의어는 핵심어(key)에만 붙는다. */
export type TestBookVocabRow = {
  word: string;
  /** n. v. a. ad. 구 … */
  pos: string;
  /** 지문 속 뜻 */
  meaning: string;
  synonyms: string[];
  antonyms: string[];
  /** 품사가 다른 형태(파생어) — 「명사형은?」 시험에 쓴다 */
  forms: Array<{ word: string; pos: string; ko?: string }>;
  /** 시험에 나올 어구(없으면 빈 문자열) */
  phrase: string;
  /** 철자가 비슷해 헷갈리는 낱말(adapt → adopt, adept) — 객관식 오답·어휘선택에 쓴다 */
  confusables?: string[];
  /** 내용상 핵심어이거나 바꿔 쓰기로 나올 만한 단어 */
  key: boolean;
};

export type TestBookMaterial = {
  version: string;
  sourceHash: string;
  vocab: TestBookVocabRow[];
  /** 단어 정리 규칙 버전(없으면 tv-1: 파생어 품사 표기가 다르면 버리던 때) */
  vocabVersion?: string;
  /** 워크북 「중요문장 어순배열」과 같은 규칙으로 고른 문장(0부터, 지문 차례) */
  keyIndexes: number[];
  /** 문장마다 어순 덩어리(원래 차례). 워크북과 같은 캐시에서 온다. 못 나눈 문장은 null. */
  chunks: Array<string[] | null>;
  /** 교과서 지문이면 그 과(「공통영어1|NE능률(민병천)|1」)와 단원문법이 든 문장(0부터) */
  unitKey?: string | null;
  unitHits?: Array<{ si: number; grammar: string[] }>;
  /** 구문·구조가 어려운 문장(0부터, 단원문법 문장 빼고 2개까지) — key-sentence-analysis */
  hardHits?: Array<{ si: number; structures: string[] }>;
  /** 문장마다 직독직해 덩어리(원문 조각 + 뜻). 못 만든 문장은 null — 한줄해석 「직독직해」에 쓴다 */
  chunkGloss?: Array<Array<{ en: string; ko: string }> | null>;
  createdAt: string;
};

/** 영어 원문 해시(재료가 옛 원문으로 만든 것인지 가린다). 해시에는 그 재료의 버전이 섞인다. */
export function testBookSourceHash(englishLines: string[], version: string = TEST_BOOK_MATERIAL_VERSION): string {
  const joined = englishLines
    .map((t) => formatWorkbookPassage(t).toLowerCase())
    .filter(Boolean)
    .join("\n");
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += hashSeedToUint32(`${joined}#tb#${version}#${i}`).toString(16).padStart(8, "0");
  }
  return out;
}

/** 지금 원문으로 만든 재료인가(버전은 따지지 않는다) — 단어 정리를 다시 쓸 수 있는지 */
export function isTestBookMaterialSameSource(
  material: TestBookMaterial | null | undefined,
  englishLines: string[]
): material is TestBookMaterial {
  return !!material?.version && material.sourceHash === testBookSourceHash(englishLines, material.version);
}

export function isTestBookMaterialFresh(
  material: TestBookMaterial | null | undefined,
  englishLines: string[]
): material is TestBookMaterial {
  // 단어 정리 판도 본다 — 판만 올리고 이것을 빼 두어, 파생어 뜻(tv-4)이 열어도 들어가지 않았다(2026-10-20)
  return (
    material?.version === TEST_BOOK_MATERIAL_VERSION &&
    material.vocabVersion === TEST_BOOK_VOCAB_VERSION &&
    isTestBookMaterialSameSource(material, englishLines)
  );
}

/**
 * 단어 정리 핵심어의 동의어·반의어에 1장 자료 핵심어의 것(같은 낱말일 때만)을 더한다. 모델은 부르지 않는다.
 * 단어 정리 모델이 하나만 고르는 일이 많았다(선생님 2026-10-20: 여러 개일 수 있는데 한 개만 — 억지로는 말고).
 * 핵심어가 아닌 줄이나 1장 자료에 없는 낱말은 그대로 둔다.
 */
export function mergeTestBookVocabHints(
  material: TestBookMaterial,
  content: OnePageContent | null | undefined
): TestBookMaterial {
  // 이미 만든 재료에 든 틀린 파생어·고유명사도 읽을 때 뺀다(윌링어학원 2026-10-30)
  material = {
    ...material,
    vocab: material.vocab
      .filter((r) => !isProperNounVocab(r.word, r.meaning))
      .map((r) => ({
        ...r,
        word: fixVocabWord(r.word),
        synonyms: r.synonyms.filter((w) => !isEmptyVocabWord(w)),
        antonyms: r.antonyms.filter((w) => !isEmptyVocabWord(w)),
        forms: r.forms.filter((f) => !isBadWordForm(r.word, f.word)),
      })),
  };
  if (!content?.vocab?.length) return material;
  const hints = new Map(content.vocab.map((v) => [v.surface.trim().toLowerCase(), v] as const));
  const merge = (own: string[], more: string[], word: string) => {
    const seen = new Set([word.trim().toLowerCase()]);
    return [...own, ...more]
      .map((w) => w.trim())
      .filter((w) => {
        const k = w.toLowerCase();
        if (!w || seen.has(k) || isEmptyVocabWord(w)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3);
  };
  return {
    ...material,
    vocab: material.vocab.map((r) => {
      const h = r.key ? hints.get(r.word.trim().toLowerCase()) : undefined;
      if (!h) return r;
      return { ...r, synonyms: merge(r.synonyms, h.synonyms, r.word), antonyms: merge(r.antonyms, h.antonyms, r.word) };
    }),
  };
}

/** 화면에 넘기는 지문 하나 */
export type TestBookProjectInput = {
  id: string;
  title: string;
  titleEn: string | null;
  source: string | null;
  sentences: Array<{ english: string; korean: string }>;
  /** 1장 자료 재료(지금 원문으로 만든 것만). 없으면 화면이 준비한다. */
  content: OnePageContent | null;
  /** 테스트 교재 재료(지금 원문으로 만든 것만) */
  material: TestBookMaterial | null;
  /** 수업자료 분석서(있으면 「분석 자료」에 싣는다) */
  analysis?: AnalysisReportData | null;
  /** 워크북 어법 선택(저장된 것). 있으면 어법선택을 워크북과 같은 문항으로 싣는다. */
  grammarChoice?: WorkbookGrammarChoiceSection | null;
  /** 선생님이 고친 어휘 선택(교재 파일에 저장). 있으면 어휘선택을 이 문항으로 싣는다. */
  vocabChoice?: WorkbookVocabChoiceSection | null;
  /** 지문 삽화(4컷). 있으면 수업용 자료 본문 뒤에 싣는다(선생님 2026-10-26: 만든 삽화가 안 나온다). */
  illustrationUrl?: string | null;
};

export function isTestBookProjectReady(
  p: TestBookProjectInput
): p is TestBookProjectInput & { content: OnePageContent; material: TestBookMaterial } {
  return !!p.content && !!p.material;
}

// ---------------------------------------------------------------- 교재 설정(파일 payload)

export type TestBookTranslationMode = "show" | "hide" | "back";

/*
 * 교재 차례(선생님 2026-10-20): 표지 → 목차 → 학습 계획표·이수표 → 수업용 자료 → 백지노트 →
 * 분석 자료 → 테스트지 자료 → 정답지. 묶음마다 넣고 뺄 수 있고, 테스트지 자료는 안에서 다시 고른다.
 */
/** 표지 글자(최종통합자료 표지와 같은 칸). 비어 있으면 교재 이름·범위·학원명으로 채운다. */
export type TestBookCover = {
  presetId: string;
  /** 위 라벨(시험 범위 등) */
  label: string;
  /** 큰 제목(줄바꿈 가능) */
  title: string;
  /** 제목 아래·꼬릿말(줄바꿈 가능) */
  progress: string;
  academy: string;
  /** 색 번짐 표지의 큰 글자(줄바꿈 가능). 비우면 「read. / test. / note.」 */
  headline: string;
  /** 내신 표지에서 선생님이 고친 칸(integrated.ts IntegratedCover.exam과 같다) */
  exam?: Partial<BookCoverSpec>;
};

/** 내지 디자인(선생님 2026-10-21: ABC로 고르게) */
export type TestBookTheme = "a" | "b" | "c" | "d" | "e" | "f";
export const TEST_BOOK_THEMES: Array<{ key: TestBookTheme; label: string; hint: string }> = [
  { key: "a", label: "A 클래식", hint: "가는 선·색 띠" },
  { key: "b", label: "B 파스텔 블룸", hint: "화사한 번짐·둥근 카드" },
  { key: "c", label: "C 볼드 블록", hint: "색 띠 머리·굵은 번호" },
  { key: "d", label: "D 매거진", hint: "세리프·가는 선" },
];

export type TestBookOptions = {
  /** 테스트지 자료 · 테스트 견본에 싣는 유형 */
  types: TestBookTypeKey[];
  /** 수업용 자료 해석: 있음 · 지움(쓸 줄) · 뒤쪽에 모음 */
  translation: TestBookTranslationMode;
  /** 통문장 영작: 모든 문장 · 중요문장만 */
  writing: WritingScope;
  /** 한줄해석: 전체 해석 · 직독직해 */
  lineMode: LineMode;
  /** 테스트 견본 난이도 */
  level: TestLevel;
  /** 내지 디자인: A 클래식 · B 파스텔 블룸 · C 볼드 블록 · D 매거진 */
  theme: TestBookTheme;
  /** 표지 */
  cover: boolean;
  /** 표지 모양·글자 */
  coverInfo: TestBookCover;
  /** 목차(묶음마다 쪽 범위) */
  toc: boolean;
  /** 묶음마다 간지(지문별 시작 쪽) — 목차를 켰을 때 */
  dividers: boolean;
  /** 묶음 안에서 지문마다 간지 */
  passageDividers: boolean;
  /** 학습 계획표·이수표 */
  plan: boolean;
  /** 수업용 자료: 지문마다 단어 정리 + 문장별 해석 */
  lesson: boolean;
  /** 수업용 자료 앞 전체 단어장(지문 단어를 한데 모음) */
  allVocab: boolean;
  /** 지문마다 백지노트 2쪽 */
  blankNote: boolean;
  /** 분석 자료: 지문마다 분석서(분석서가 있는 지문만) */
  analysis: boolean;
  /** 분석 자료 모양 — 분석서 화면의 A(교재 세리프)·B(산세리프)·C(클래식 인쇄) */
  analysisStyle: "a" | "b" | "c";
  /** 분석 자료 해석 — 전체 해석 · 직독직해 */
  analysisTranslation: "full" | "chunk";
  /** 테스트지 자료 */
  tests: boolean;
  /** 테스트지 자료 · 맨 앞 단어 시험지(지문을 합친 한 묶음) */
  allWordTest: boolean;
  /** 단어 시험지 문항 수·유형 */
  vocabExam: VocabExamOptions;
  /** 테스트지 자료 · 지문마다 동반의어·품사 TEST */
  wordTest: boolean;
  /** 맨 뒤 정답지 */
  answers: boolean;
  /** 선생님이 고친 어법·어휘 선택(지문 id → 문항, 원문 해시). 원문이 바뀌면 쓰지 않는다. */
  choiceEdits: {
    grammar: Record<string, { hash: string; section: WorkbookGrammarChoiceSection }>;
    vocab: Record<string, { hash: string; section: WorkbookVocabChoiceSection }>;
  };
};

export const DEFAULT_TEST_BOOK_OPTIONS: TestBookOptions = {
  types: BASIC_TEST_BOOK_TYPES,
  translation: "hide",
  writing: "all",
  lineMode: "full",
  level: "basic",
  theme: "b",
  cover: true,
  coverInfo: { presetId: "exam-black", label: "", title: "", progress: "", academy: "", headline: "" },
  toc: true,
  dividers: true,
  passageDividers: true,
  plan: true,
  lesson: true,
  allVocab: true,
  blankNote: true,
  analysis: true,
  analysisStyle: "a",
  analysisTranslation: "full",
  tests: true,
  allWordTest: true,
  vocabExam: { counts: { meaning: 10, spelling: 10, synonym: 5, antonym: 5, form: 5, formChoice: 5 } },
  wordTest: true,
  answers: true,
  choiceEdits: { grammar: {}, vocab: {} },
};

export function normalizeTestBookOptions(raw: unknown): TestBookOptions {
  const r = (raw ?? {}) as Partial<Record<keyof TestBookOptions, unknown>>;
  const t = r.translation;
  return {
    types: normalizeTestBookTypes(r.types),
    translation: t === "show" || t === "hide" || t === "back" ? t : DEFAULT_TEST_BOOK_OPTIONS.translation,
    writing: r.writing === "key" ? "key" : "all",
    lineMode: r.lineMode === "chunk" ? "chunk" : "full",
    level: r.level === "up" ? "up" : "basic",
    theme: (["a", "b", "c", "d", "e", "f"] as const).includes(r.theme as TestBookTheme) ? (r.theme as TestBookTheme) : "b",
    cover: r.cover !== false,
    coverInfo: (() => {
      const c = (r.coverInfo ?? {}) as Partial<Record<keyof TestBookCover, unknown>>;
      const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : "");
      return {
        // 색 번짐 표지는 지웠다(2026-10-22) — 예전 id는 coverPreset이 내신 · 검정으로 연다.
        presetId: str(c.presetId) || "exam-black",
        label: str(c.label),
        title: str(c.title),
        progress: str(c.progress),
        academy: str(c.academy),
        headline: str(c.headline),
        exam: normalizeCoverOverrides(c.exam),
      };
    })(),
    toc: r.toc !== false,
    dividers: r.dividers !== false,
    passageDividers: r.passageDividers !== false,
    plan: r.plan !== false,
    lesson: r.lesson !== false,
    allVocab: r.allVocab !== false,
    blankNote: r.blankNote !== false,
    analysis: r.analysis !== false,
    analysisStyle: r.analysisStyle === "b" || r.analysisStyle === "c" ? r.analysisStyle : "a",
    analysisTranslation: r.analysisTranslation === "chunk" ? "chunk" : "full",
    tests: r.tests !== false,
    // 예전 파일은 전체 단어장과 TEST를 한 칸(allVocab)으로 켜고 껐다
    allWordTest: r.allWordTest === undefined ? r.allVocab !== false : r.allWordTest !== false,
    vocabExam: normalizeVocabExam(r.vocabExam),
    wordTest: r.wordTest !== false,
    answers: r.answers !== false,
    choiceEdits: (() => {
      const c = (r.choiceEdits ?? {}) as { grammar?: unknown; vocab?: unknown };
      const pick = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
      return { grammar: pick(c.grammar), vocab: pick(c.vocab) } as TestBookOptions["choiceEdits"];
    })(),
  };
}

// ---------------------------------------------------------------- 문항 모양

/** 한 줄 안의 조각: 글자 · 빈칸(번호) · 고르기 [왼쪽 / 오른쪽] */
/** 빈칸·고르기의 n은 지문 안 번호(워크북 모양: 빈칸 ¹____, 고르기 ①[A / B]) */
export type TestSeg = string | { blank: string; n?: string } | { pick: [string, string]; n?: string } | { u: string; n?: string };

export type TestItem = {
  /** (1) (2) … 또는 A B */
  no: string;
  text: TestSeg[];
  /** 함께 주는 해석 */
  ko?: string;
  /** 어순배열 덩어리(섞은 차례) */
  chunks?: string[];
  /** 직독직해 덩어리(원래 차례) — 덩어리마다 아래에 뜻 쓸 칸 */
  gloss?: string[];
  /** 문장 앞에 주는 말(어순배열: In other words, …) */
  lead?: string;
  /** 영작 조건 */
  hint?: string;
  /** 문항 위 작은 꼬리표(단원문법) */
  tag?: string;
  /** 쓸 줄 수 */
  lines?: number;
  /** T/F 칸 */
  tf?: boolean;
  answer: string;
};

export type TestSection = {
  type: TestBookTypeKey;
  title: string;
  /** 발문 옆 짧은 안내 */
  hint?: string;
  /** 보기 상자 */
  box?: string[];
  /** 문항 앞에 놓는 글(문장 순서의 주어진 글, 문장 삽입의 주어진 문장) */
  given?: string;
  /** 지문을 통째로 싣는 유형(연결어·삽입·요약문, 빈칸·어법선택·어휘선택) */
  passage?: TestSeg[];
  /** 지문 아래 [해석](빈칸) */
  passageKo?: string;
  /** 문항이 지문 안에 번호로 들어 있다 — 문항 줄을 따로 그리지 않는다(정답·점수는 items로) */
  inline?: boolean;
  items: TestItem[];
  /** 지문형 유형의 정답(문항이 하나로 묶인 경우) */
  answer?: string;
  /** 도식화: 흐름 칸(이름)과 섞은 보기 */
  diagram?: { steps: string[]; choices: string[] };
};

export type TestSheet = {
  projectId: string;
  title: string;
  source: string | null;
  sections: TestSection[];
};

/*
 * 테스트지 뽑기 값(선생님 2026-10-26): 문항당 1크레딧, 지문 통째 유형은 세트당 3크레딧,
 * 단어 시험지는 지문당 3크레딧. 기능(lesson_test_draw)은 1크레딧 단위로 받고 수량을 여기서 센다.
 */
export const TEST_DRAW_SET_TYPES = new Set<TestBookTypeKey>(["link", "insert", "summary", "flow", "sequence", "sentenceOrder", "gist"]);
export const TEST_DRAW_SET_CREDITS = 3;

/**
 * 지문 재료(단어·해석·1장 자료 재료)를 한꺼번에 몇 지문씩 만드는가(선생님 2026-10-27 「모든 게 좀 오래 걸려」).
 * 지문 하나가 약 3분인데 3개씩(어떤 화면은 하나씩) 돌려 7지문이면 9분 넘게 걸렸다. 지문 안의 호출은 이미 동시에 나간다.
 */
export const PASSAGE_PREP_CONCURRENCY = 6;
export const TEST_DRAW_VOCAB_CREDITS = 3;

export function testDrawUnits(
  sheets: Array<{ sections?: Array<{ type?: unknown; items?: unknown[] }> } | null | undefined>,
  vocabPassages: number
): { units: number; items: number; sets: number } {
  let items = 0;
  let sets = 0;
  for (const sh of sheets) {
    for (const sec of sh?.sections ?? []) {
      if (TEST_DRAW_SET_TYPES.has(sec.type as TestBookTypeKey)) sets += 1;
      else items += Array.isArray(sec.items) ? sec.items.length : 0;
    }
  }
  return { units: items + sets * TEST_DRAW_SET_CREDITS + Math.max(0, vocabPassages) * TEST_DRAW_VOCAB_CREDITS, items, sets };
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const no = (i: number) => `(${i + 1})`;

// ---------------------------------------------------------------- 조립

export type BlankMode = "same" | "diff";
/**
 * 난이도: 기본 · UP(선생님 2026-10-20: 워크북처럼). 다시 만들지 않고 문항 내는 방식만 바꾼다 —
 * 빈칸 문장마다 둘, 어순배열 덩어리 잘게·앞말 없음, 영작 단어 수 숨김, 바꿔 말하기 힌트 숨김, T/F 고쳐 쓰기.
 */
export type TestLevel = "basic" | "up";
/** 한줄해석: 문장 전체를 해석 · 덩어리마다 직독직해 */
export type LineMode = "full" | "chunk";
/** 통문장 영작 범위: 모든 문장 · 중요문장(단원문법·어려운 구문·핵심 문장)만 */
export type WritingScope = "all" | "key";

type Ready = TestBookProjectInput & { content: OnePageContent; material: TestBookMaterial };

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clean(text: string): string {
  return stripLeadingSentenceMarkers(formatWorkbookPassage(text));
}

/** 정해진 열쇠로 섞은 뒤 앞에서 n개 */
function pickN<T>(items: T[], n: number, seed: string): T[] {
  if (items.length <= n) return fisherYatesShuffle(items, createSeededRng(seed));
  return fisherYatesShuffle(items, createSeededRng(seed)).slice(0, n);
}

/** 고른 것을 지문 차례로 */
function bySentence<T extends { si: number; at?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.si - b.si || (a.at ?? 0) - (b.at ?? 0));
}

/** 문장 안 낱말 자리를 찾아 앞·뒤로 나눈다 */
function splitAt(sentence: string, phrase: string): { before: string; hit: string; after: string } | null {
  const at = findPhrase(sentence, phrase);
  if (!at) return null;
  return { before: sentence.slice(0, at.start), hit: sentence.slice(at.start, at.end), after: sentence.slice(at.end) };
}

/** 대소문자를 원문 자리에 맞춘다(문장 첫 낱말이면 대문자) */
function matchCase(model: string, word: string): string {
  if (!model || !word) return word;
  return /^[A-Z]/.test(model) && /^[a-z]/.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word;
}

const LINK_WORDS = [
  "However",
  "Therefore",
  "Thus",
  "For example",
  "For instance",
  "In other words",
  "In addition",
  "Moreover",
  "Furthermore",
  "As a result",
  "In fact",
  "Instead",
  "Nevertheless",
  "Similarly",
  "On the other hand",
  "In contrast",
  "That is",
  "Otherwise",
  "Consequently",
  "Yet",
  "Still",
  "Besides",
  "Likewise",
  "Meanwhile",
  "Accordingly",
  "Hence",
  "Finally",
  "In short",
  "Above all",
];

const LINK_RE = new RegExp(`^(${LINK_WORDS.map((w) => w.replace(/\s+/g, "\\s+")).join("|")})\\b\\s*,?`, "");

type Cand = { si: number; at?: number; key: string };

function blankCandidates(p: Ready): Array<Cand & { phrase: string }> {
  const out: Array<Cand & { phrase: string }> = [];
  const seen = new Set<string>();
  const add = (si: number, phrase: string) => {
    const s = p.sentences[si];
    if (!s || !s.korean.trim() || !phrase.trim()) return;
    const hit = findPhrase(clean(s.english), phrase);
    if (!hit) return;
    const k = `${si}|${phrase.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ si, at: hit.start, key: k, phrase });
  };
  for (const v of p.content.vocab) add(v.sentenceIndex, v.surface);
  // 단어 정리의 핵심어가 나온 문장
  for (const row of p.material.vocab.filter((r) => r.key)) {
    const si = p.sentences.findIndex((s) => findPhrase(clean(s.english), row.word));
    if (si >= 0) add(si, row.word);
  }
  return out;
}

/**
 * 교재 견본(열쇠가 book)은 지문 차례, 뽑기는 차례를 섞는다 — 단어 영↔한만 쓴다.
 * 해석 적기·통문장 영작은 뽑기도 지문 차례 그대로(선생님 2026-11-06: 테스트지에서 해석 순서가 섞인다).
 */
function arrange<T>(items: T[], seed: string): T[] {
  return seed.startsWith("book|") ? items : fisherYatesShuffle(items, createSeededRng(`${seed}|arrange`));
}

/*
 * 선생님 요청(2026-10-19): 중요문장 어순배열만 중요문장으로 하고, 나머지 유형은 지문 전체를 다룬다
 * (한줄해석·빈칸·영작은 모든 문장, 어법·어휘·T/F·연결어는 만들어 둔 것을 모두).
 */
function buildLine(p: Ready, seed: string, mode: LineMode = "full", max?: number): TestSection | null {
  const all = keyFirst(p, p.sentences.map((s, si) => ({ si, s })).filter(({ s }) => s.korean.trim() && words(s.english) >= 3), seed, max);
  if (!all.length) return null;
  // 직독직해(선생님 2026-10-20): 덩어리마다 아래에 뜻을 쓴다. 덩어리를 못 만든 문장은 전체 해석으로.
  const gloss = mode === "chunk" ? p.material.chunkGloss : undefined;
  return {
    type: "line",
    title: "해석 적기",
    hint: mode === "chunk" ? "끊어 읽는 덩어리마다 뜻 쓰기" : undefined,
    items: all.map(({ s, si }, i) => {
      const g = gloss?.[si];
      if (g?.length) {
        return { no: no(i), text: [], gloss: g.map((c) => c.en), answer: g.map((c) => c.ko).join(" / ") };
      }
      return { no: no(i), text: [clean(s.english)], lines: words(s.english) > 22 ? 2 : 1, answer: s.korean };
    }),
  };
}

/**
 * 직독직해 덩어리만으로 「해석 적기(끊어 읽기)」 문항을 만든다 — buildTestSheet(…, ["line"], { lineMode: "chunk" })와
 * 같은 결과(같은 열쇠). 워크북에서 문장마다 ↔ 끊어 읽기로 바꿀 때 1장 재료 없이 쓴다(선생님 2026-10-27).
 */
export function buildChunkLineSection(
  p: { id: string; title: string; source: string | null; sentences: Array<{ english: string; korean: string }> },
  chunkGloss: TestBookMaterial["chunkGloss"],
  seed: string
): TestSection | null {
  // 해석이 비어도 덩어리 뜻이 있으면 그 문장을 싣는다
  const sentences = p.sentences.map((s, si) => ({
    ...s,
    korean: s.korean.trim() || (chunkGloss?.[si] ?? []).map((c) => c.ko).join(" "),
  }));
  const ready = { ...p, titleEn: null, sentences, material: { chunkGloss, keyIndexes: [] } } as unknown as Ready;
  return buildLine(ready, `${seed}|${p.id}`, "chunk");
}

const STOP = new Set(
  "about above after again against because before being below between could during every their there these those through under until where which while would should other another however therefore people".split(" ")
);

/** 후보가 없는 문장의 빈칸: 문장에서 가장 긴 내용어(고유명사·기능어 빼고) */
function fallbackBlank(sentence: string): string | null {
  const ws = sentence.match(/[A-Za-z][a-z]+(?:-[a-z]+)*/g) ?? [];
  const firstWord = sentence.match(/[A-Za-z]+/)?.[0];
  const cands = ws.filter((w) => w.length >= 5 && !STOP.has(w.toLowerCase()) && (/^[a-z]/.test(w) || w === firstWord));
  if (!cands.length) return null;
  return [...cands].sort((x, y) => y.length - x.length)[0]!;
}

/**
 * 문장마다 빈칸 하나. 「같은 자리」는 교재 견본과 같은 낱말, 「다른 자리」는 그 문장의 다른 후보.
 * 워크북 빈칸과 같은 모양으로 지문을 통째로 싣고 아래에 [해석]을 둔다(선생님 2026-10-20).
 */
function buildBlank(p: Ready, seed: string, mode: BlankMode, up = false): TestSection | null {
  const pool = blankCandidates(p);
  const passage: TestSeg[] = [];
  const items: TestItem[] = [];
  p.sentences.forEach((s, si) => {
    const sentence = clean(s.english);
    if (!sentence) return;
    if (passage.length) passage.push(" ");
    const phrases: string[] = [];
    if (s.korean.trim()) {
      const mine = pool.filter((c) => c.si === si);
      if (!mine.length) {
        const f = fallbackBlank(sentence);
        if (f) phrases.push(f);
      } else {
        const bookOne = pickN(mine, 1, `book|${p.id}|blank|${si}`)[0]!;
        const others = mine.filter((c) => c.key !== bookOne.key);
        phrases.push((mode === "diff" && others.length ? pickN(others, 1, `${seed}|blank|${si}`)[0]! : bookOne).phrase);
        // 난이도 UP: 문장마다 빈칸 하나 더(자리가 있는 문장만)
        if (up) {
          const extra = pickN(others.filter((c) => c.phrase !== phrases[0]), 1, `${seed}|blank2|${si}`)[0];
          if (extra) phrases.push(extra.phrase);
        }
      }
    }
    // 겹치지 않는 자리만, 문장 앞에서부터
    const hits = phrases
      .map((ph) => findPhrase(sentence, ph))
      .filter((h): h is NonNullable<typeof h> => !!h)
      .sort((x, y) => x.start - y.start)
      .filter((h, i, all) => i === 0 || h.start >= all[i - 1]!.end);
    if (!hits.length) {
      passage.push(sentence);
      return;
    }
    let cursor = 0;
    for (const h of hits) {
      const n = String(items.length + 1);
      passage.push(sentence.slice(cursor, h.start), { blank: "", n });
      items.push({ no: `${n}.`, text: [], answer: sentence.slice(h.start, h.end) });
      cursor = h.end;
    }
    passage.push(sentence.slice(cursor));
  });
  if (!items.length) return null;
  return {
    type: "blank",
    title: "빈칸 채우기",
    hint: up ? "해석을 보고 빈칸 채우기 · 문장마다 빈칸 둘" : "해석을 보고 빈칸 채우기",
    passage,
    passageKo: p.sentences.map((s) => s.korean.trim()).filter(Boolean).join(" "),
    inline: true,
    items,
  };
}

type PickCand = Cand & { before: string; right: string; wrong: string; after: string };

function grammarCandidates(p: Ready): PickCand[] {
  const out: PickCand[] = [];
  p.content.grammar.forEach((g, gi) => {
    if (!g.right || !g.wrong || g.right === g.wrong) return;
    const s = p.sentences[g.sentenceIndex];
    if (!s) return;
    const sentence = clean(s.english);
    const target = findPhrase(sentence, g.target);
    if (!target) return;
    const inside = findPhrase(sentence.slice(target.start, target.end), g.right);
    if (!inside) return;
    const start = target.start + inside.start;
    const end = target.start + inside.end;
    out.push({
      si: g.sentenceIndex,
      at: start,
      key: `g${gi}`,
      before: sentence.slice(0, start),
      right: sentence.slice(start, end),
      wrong: matchCase(sentence.slice(start, end), g.wrong),
      after: sentence.slice(end),
    });
  });
  return out;
}

/** antonymOnly: 어휘 수정용 — 철자 비슷한 혼동어는 뜻이 비슷할 수 있어(disappear/dissipate) 반의어만 쓴다 */
function vocabCandidates(p: Ready, antonymOnly = false): PickCand[] {
  const out: PickCand[] = [];
  // 오답은 철자가 비슷한 혼동어휘를 먼저(선생님 의견 2026-10-21: 어휘선택이 동반의어와 비슷하다), 없으면 반의어
  const rowOf = (surface: string) =>
    p.material.vocab.find((r) => r.word.toLowerCase() === surface.toLowerCase()) ??
    p.material.vocab.find((r) => r.word.length >= 4 && surface.toLowerCase().startsWith(r.word.toLowerCase().slice(0, Math.max(4, r.word.length - 2))));
  p.content.vocab.forEach((v, vi) => {
    const conf = rowOf(v.surface)?.confusables?.find((w) => w.trim() && words(w) <= 2 && w.toLowerCase() !== v.surface.toLowerCase());
    const antonym = v.antonyms.find((a) => a.trim() && words(a) <= 2);
    const ant = antonymOnly ? antonym : (conf ?? antonym);
    const s = p.sentences[v.sentenceIndex];
    if (!ant || !s) return;
    const part = splitAt(clean(s.english), v.surface);
    if (!part) return;
    if (out.some((o) => o.right.toLowerCase() === part.hit.toLowerCase())) return;
    out.push({ si: v.sentenceIndex, at: part.before.length, key: `v${vi}`, before: part.before, right: part.hit, wrong: matchCase(part.hit, ant), after: part.after });
  });
  return out;
}

function pickSection(
  p: Ready,
  type: "grammar" | "vocab",
  title: string,
  hint: string,
  pool: PickCand[],
  seed: string
): TestSection | null {
  const chosen = bySentence(pool);
  if (!chosen.length) return null;
  // 한 문장에 고르기 자리가 여럿이면 문장을 한 번만 싣고 괄호를 여러 개 넣는다(겹치는 자리는 앞의 것만)
  const bySi = new Map<number, PickCand[]>();
  for (const c of chosen) {
    const list = bySi.get(c.si) ?? [];
    const end = (x: PickCand) => (x.at ?? 0) + x.right.length;
    if (!list.some((x) => (c.at ?? 0) < end(x) && (x.at ?? 0) < end(c))) list.push(c);
    bySi.set(c.si, list);
  }
  // 워크북 어법·어휘 선택과 같은 모양: 지문을 통째로 싣고 고르기 자리에 ①[A / B](선생님 2026-10-20)
  const passage: TestSeg[] = [];
  const items: TestItem[] = [];
  p.sentences.forEach((s, si) => {
    const cands = bySi.get(si);
    const sentence = cands ? cands[0]!.before + cands[0]!.right + cands[0]!.after : clean(s.english);
    if (!sentence) return;
    if (passage.length) passage.push(" ");
    if (!cands) {
      passage.push(sentence);
      return;
    }
    let cursor = 0;
    for (const c of [...cands].sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) {
      const at = c.at ?? c.before.length;
      passage.push(sentence.slice(cursor, at));
      const n = circled(items.length);
      const left = hashSeedToUint32(`${seed}|${c.key}|side`) % 2 === 0;
      passage.push({ pick: left ? [c.right, c.wrong] : [c.wrong, c.right], n });
      items.push({ no: n, text: [], answer: c.right });
      cursor = at + c.right.length;
    }
    passage.push(sentence.slice(cursor));
  });
  return { type, title, hint, passage, inline: true, items };
}

/**
 * 어법선택을 워크북 어법 선택 문항 그대로(선생님 2026-10-20: 퀄리티가 안 나온다, 워크북 참고).
 * 지문·고르기 자리·바른 말은 워크북과 같고, 뽑기는 열쇠에 따라 [A / B] 좌우만 바꾼다.
 */
function workbookGrammarSection(p: Ready, seed: string, skip?: Set<number>): TestSection | null {
  return choiceSectionTest(p.grammarChoice, "grammar", "어법 선택", "알맞은 것에 ○", seed, skip);
}

/** 어법·어휘 선택 문항(워크북 형태)을 테스트 견본으로. 뽑기는 열쇠에 따라 [A / B] 좌우만 바꾼다. */
function choiceSectionTest(
  gc: ChoiceSection | null | undefined,
  type: "grammar" | "vocab",
  title: string,
  hint: string,
  seed: string,
  /** 다른 유형(어법 서술형)이 쓰는 자리 번호 — 바른 말을 원문 글자로 둔다 */
  skip?: Set<number>
): TestSection | null {
  if (!gc?.segments?.length || !gc.items?.length) return null;
  const byNo = new Map(gc.items.map((it) => [it.number, it] as const));
  const book = seed.startsWith("book|");
  const passage: TestSeg[] = [];
  const items: TestItem[] = [];
  for (const seg of gc.segments) {
    if (seg.type === "text") {
      passage.push(seg.text);
      continue;
    }
    const it = byNo.get(seg.number);
    if (skip?.has(seg.number)) {
      passage.push(it?.correctText ?? seg.leftText);
      continue;
    }
    const n = circled(items.length);
    const swap = !book && hashSeedToUint32(`${seed}|wgc|${seg.number}`) % 2 === 1;
    passage.push({ pick: swap ? sameCaseChoices(seg.rightText, seg.leftText) : sameCaseChoices(seg.leftText, seg.rightText), n });
    items.push({ no: n, text: [], answer: it?.correctText ?? "" });
  }
  if (!items.length) return null;
  return { type, title, hint, passage, inline: true, items };
}

/**
 * 고치기 창에 넘길 문항(워크북 형태). 어법은 워크북 어법 선택이 있으면 그것, 없으면 지금 문항을
 * 같은 형태로 바꾼다. 어휘는 지금 문항(1장 자료 핵심어의 반의어)을 바꾼다.
 */
export function testBookChoiceSection(
  p: TestBookProjectInput & { content: OnePageContent; material: TestBookMaterial },
  kind: "grammar" | "vocab"
): ChoiceSection {
  if (kind === "grammar" && p.grammarChoice?.items?.length) return p.grammarChoice;
  if (kind === "vocab" && p.vocabChoice?.items?.length) return p.vocabChoice;
  const sents = p.sentences.map((s) => clean(s.english));
  const starts: number[] = [];
  let at = 0;
  const parts: string[] = [];
  sents.forEach((t) => {
    if (!t) {
      starts.push(-1);
      return;
    }
    if (parts.length) at += 1;
    starts.push(at);
    parts.push(t);
    at += t.length;
  });
  const sourcePassage = parts.join(" ");
  let section = {
    projectId: p.id,
    title: p.title,
    source: p.source,
    sourcePassage,
    segments: [{ type: "text" as const, text: sourcePassage }],
    items: [],
    algorithmVersion: "test-book",
  } as unknown as ChoiceSection;
  const cands = kind === "grammar" ? grammarCandidates(p) : vocabCandidates(p);
  for (const c of bySentence(cands)) {
    const base = starts[c.si];
    if (base == null || base < 0) continue;
    const start = base + (c.at ?? c.before.length);
    try {
      section = addChoiceItem(section, { start, end: start + c.right.length, incorrectText: c.wrong, kind });
    } catch {
      // 겹치는 자리 등은 뺀다
    }
  }
  return section;
}

/** 어순배열: 같은 덩어리를 섞는다. 원래 차례·뒤집은 차례와 같으면 다시 섞는다. */
function shuffleChunks(chunks: string[], seed: string): string[] {
  for (let attempt = 0; attempt < 12; attempt++) {
    const out = fisherYatesShuffle(chunks, createSeededRng(`${seed}#${attempt}`));
    const same = out.every((c, i) => c === chunks[i]);
    const reversed = out.every((c, i) => c === chunks[chunks.length - 1 - i]);
    if (!same && !(reversed && chunks.length > 2)) return out;
  }
  return [...chunks.slice(1), chunks[0]!];
}

/** 첫 덩어리가 연결어(In other words,)면 주고 나머지만 섞는다 */
function splitLead(chunks: string[]): { lead: string; rest: string[] } {
  const first = chunks[0] ?? "";
  if (chunks.length > 3 && LINK_RE.test(first) && first.replace(LINK_RE, "").trim() === "") {
    return { lead: first, rest: chunks.slice(1) };
  }
  return { lead: "", rest: chunks };
}

/** 어순배열에 쓸 중요문장(같은 시험지의 영작이 이 문장을 피한다) */
function orderPicks(p: Ready, seed: string): Array<{ si: number; chunks: string[] }> {
  const pool = p.material.keyIndexes
    .map((si) => ({ si, chunks: p.material.chunks[si] }))
    .filter((x): x is { si: number; chunks: string[] } => !!x.chunks && x.chunks.length >= 3 && !!p.sentences[x.si]?.korean.trim());
  // 선생님 2026-10-20: 단원문법이 든 문장은 꼭(5개까지), 구문·구조가 어려운 문장도(2개까지).
  // 둘 다 없는 지문만 다른 중요문장으로 2개.
  const unit = new Set((p.material.unitHits ?? []).map((h) => h.si));
  const hard = new Set((p.material.hardHits ?? []).map((h) => h.si));
  const withUnit = pool.filter((x) => unit.has(x.si)).slice(0, 5);
  const withHard = pool.filter((x) => hard.has(x.si) && !unit.has(x.si)).slice(0, 2);
  if (withUnit.length || withHard.length) return bySentence([...withUnit, ...withHard]);
  return bySentence(pickN(pool, 2, `${seed}|order`));
}

/** 난이도 UP 어순배열: 네 낱말 이상 덩어리를 반으로 나눈다 */
function finerChunks(chunks: string[]): string[] {
  return chunks.flatMap((c) => {
    const w = c.split(/\s+/);
    if (w.length < 4) return [c];
    const mid = Math.ceil(w.length / 2);
    return [w.slice(0, mid).join(" "), w.slice(mid).join(" ")];
  });
}

function buildOrder(p: Ready, seed: string, up = false): TestSection | null {
  const chosen = orderPicks(p, seed);
  if (!chosen.length) return null;
  return {
    type: "order",
    title: "중요문장 어순배열",
    hint: up ? "해석에 맞게 배열하기 · 덩어리 잘게, 앞말 없음" : "해석에 맞게 배열하기",
    items: chosen.map((c, i) => {
      const split = splitLead(c.chunks);
      const lead = up ? "" : split.lead;
      const rest = up ? finerChunks(c.chunks) : split.rest;
      const grammar = p.material.unitHits?.find((h) => h.si === c.si)?.grammar ?? [];
      const structures = p.material.hardHits?.find((h) => h.si === c.si)?.structures ?? [];
      return {
        no: no(i),
        text: [],
        tag: grammar.length
          ? `단원문법 · ${grammar.join(" · ")}`
          : structures.length
            ? `어려운 구문 · ${structures.slice(0, 3).join(" · ")}`
            : undefined,
        ko: p.sentences[c.si]!.korean,
        lead: lead || undefined,
        chunks: shuffleChunks(rest, `${seed}|order|${c.si}`),
        lines: 1,
        answer: answerSentence(p.sentences[c.si]!.english),
      };
    }),
  };
}

function buildTf(p: Ready, seed: string, up = false): TestSection | null {
  const all = p.content.tf.filter((t) => t.statement.trim());
  if (!all.length) return null;
  const order = fisherYatesShuffle(all, createSeededRng(`${seed}|tf`));
  return {
    type: "tf",
    title: "T/F 문제",
    hint: up ? "맞으면 T, 틀리면 F — F는 아래 줄에 바르게 고쳐 쓰기" : "지문 내용과 맞으면 T, 틀리면 F",
    items: order.map((x, i) => ({ no: no(i), text: [x.statement], tf: true, lines: up ? 1 : undefined, answer: x.answer })),
  };
}

/** 통문장 영작: 모든 문장 또는 중요문장만(선생님 2026-10-20 — 고르게) */
function buildWriting(p: Ready, seed: string, scope: WritingScope, up = false, max?: number): TestSection | null {
  const key = new Set(p.material.keyIndexes);
  const all = keyFirst(
    p,
    p.sentences
      .map((s, si) => ({ si, s }))
      .filter(({ s, si }) => s.korean.trim() && words(s.english) >= 3 && (scope === "all" || key.has(si))),
    seed,
    max
  );
  if (!all.length) return null;
  return {
    type: "writing",
    title: "통문장 영작",
    hint: "해석만 보고 영어로 쓰기",
    items: all.map(({ s }, i) => {
      const answer = answerSentence(s.english);
      return { no: no(i), text: [], ko: s.korean, hint: up ? undefined : `${words(answer)}단어`, lines: words(answer) > 16 ? 2 : 1, answer };
    }),
  };
}

/** 연결어 빈칸. max가 있으면 연결어 자리 가운데 max개만 비우고 나머지는 원문 그대로 둔다. */
function buildLink(p: Ready, seed: string, max?: number): TestSection | null {
  const hits: Array<{ si: number; word: string; rest: string }> = [];
  p.sentences.forEach((s, si) => {
    const text = clean(s.english);
    const m = text.match(LINK_RE);
    if (!m) return;
    const word = m[1]!.replace(/\s+/g, " ");
    hits.push({ si, word, rest: text.slice(m[0].length).trimStart() });
  });
  if (!hits.length) return null;
  const keep = max != null && max < hits.length ? new Set(pickN(hits, max, `${seed}|linkcap`).map((h) => h.si)) : null;
  const chosen = keep ? hits.filter((h) => keep.has(h.si)) : hits;
  const labels = "ABCDEFGHIJ";
  const used = new Set(chosen.map((h) => h.si));
  const passage: TestSeg[] = [];
  let k = 0;
  p.sentences.forEach((s, si) => {
    if (passage.length) passage.push(" ");
    if (used.has(si)) {
      const h = chosen.find((x) => x.si === si)!;
      passage.push({ blank: `(${labels[k++]})` }, `, ${h.rest}`);
    } else {
      passage.push(clean(s.english));
    }
  });
  const answers = chosen.map((h) => h.word);
  const distractors = pickN(
    LINK_WORDS.filter((w) => !answers.some((a) => a.toLowerCase() === w.toLowerCase())),
    Math.max(2, Math.min(4, 6 - answers.length)),
    `${seed}|linkbox`
  );
  return {
    type: "link",
    title: "연결어 빈칸",
    hint: "보기에서 골라 쓰기",
    box: fisherYatesShuffle([...answers, ...distractors], createSeededRng(`${seed}|linkboxorder`)),
    passage,
    items: [],
    answer: chosen.map((h, i) => `(${labels[i]}) ${h.word}`).join("  "),
  };
}

/**
 * 문장 순서. 여러 문항이면 주어진 글을 한 문장씩 늘려 다른 문항을 만든다(at=0이 첫 문장만 주는 기본 문항).
 * 섞을 문장이 셋 미만이 되면 만들지 않는다.
 */
function buildSequence(p: Ready, seed: string, at = 0): TestSection | null {
  const english = p.sentences.map((s) => s.english);
  if (english.length - (at + 1) < 3) return null;
  const order = buildOnePageSentenceOrder(
    at > 0 ? [english.slice(0, at + 1).join(" "), ...english.slice(at + 1)] : english,
    at > 0 ? `${p.id}|${seed}|${at}` : `${p.id}|${seed}`
  );
  if (!order) return null;
  return {
    type: "sequence",
    title: "글의 순서",
    hint: "주어진 글 다음에 이어질 순서",
    given: order.given,
    items: order.items.map((it) => ({ no: `(${it.label})`, text: [it.text], answer: "" })),
    answer: order.answer.map((l) => `(${l})`).join(" - "),
  };
}

/** 문장 삽입으로 뺄 문장 count개(중요문장 먼저 — 없으면 시험 포인트의 삽입 자리) */
function insertSentences(p: Ready, seed: string, count: number): number[] {
  if (p.sentences.length < 4) return [];
  const pool = p.material.keyIndexes.filter((si) => si > 0 && si < p.sentences.length);
  const fromExam = p.content.examPoints?.find((e) => e.kind === "insert")?.sentenceIndex;
  const candidates = pool.length ? pool : fromExam != null && fromExam > 0 ? [fromExam] : [];
  return pickN([...new Set(candidates)], count, `${seed}|insert`);
}

function buildInsert(p: Ready, seed: string, si: number): TestSection | null {
  const rest = p.sentences.map((s, i) => ({ i, text: clean(s.english) })).filter((x) => x.i !== si);
  // 자리: 남은 문장 사이(첫 문장 뒤부터). 정답 자리를 넣고 다섯 자리까지.
  const gaps = rest.map((_, k) => k).filter((k) => k >= 1);
  const correctGap = rest.findIndex((x) => x.i > si);
  const answerGap = correctGap < 0 ? rest.length : correctGap;
  const others = pickN(gaps.filter((g) => g !== answerGap), 4, `${seed}|insertgaps`);
  const marks = [...new Set([answerGap, ...others])].sort((a, b) => a - b).slice(0, 5);
  const passage: TestSeg[] = [];
  rest.forEach((x, k) => {
    const m = marks.indexOf(k);
    if (m >= 0) passage.push(` ( ${CIRCLED[m]} ) `);
    else if (passage.length) passage.push(" ");
    passage.push(x.text);
  });
  const endMark = marks.indexOf(rest.length);
  if (endMark >= 0) passage.push(` ( ${CIRCLED[endMark]} )`);
  return {
    type: "insert",
    title: "문장 삽입",
    hint: "주어진 문장이 들어갈 곳",
    given: clean(p.sentences[si]!.english),
    passage,
    items: [],
    answer: CIRCLED[marks.indexOf(answerGap)] ?? "",
  };
}

/** 낱말 앞뒤 문장부호를 뗀다(따옴표·쉼표·마침표). */
function bareWord(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9'’-]+|[^A-Za-z0-9'’-]+$/g, "");
}

/**
 * 요약문 완성 〈보기〉의 동사 원형 찾기(옛 재료용 — 새 재료는 만들 때 모델이 summaryVerbs로 준다).
 * 선생님(2026-10-24): 어형변화는 동사만. apples를 apple로 주지 않는다.
 *  · 불규칙 꼴(went·taken·has·is)은 표로 바로 원형.
 *  · 규칙 꼴(-ed·-ing)은 원형 후보가 지문 안에 낱말로 나올 때만(named → name이 지문에 있을 때).
 *  · -s 꼴은 명사 복수와 가릴 수 없어 그대로 둔다. 애매하면 정답 꼴 그대로가 안전하다.
 */
function codeVerbBase(lower: string, passageWords: Set<string>): string | null {
  const regular = /(?:ed|ing)$/.test(lower);
  for (const b of verbBaseForms(lower)) {
    if (b === lower || !inflectionsOf(b).has(lower)) continue;
    const sForm =
      lower === `${b}s` || lower === `${b}es` || (b.endsWith("y") && lower === `${b.slice(0, -1)}ies`);
    if (sForm) continue;
    if (!regular) return b; // 표에 있는 불규칙 꼴
    if (passageWords.has(b)) return b;
  }
  return null;
}

/** 핵심 어구 하나의 낱말들을 〈보기〉 꼴로(동사만 원형). 동사가 들어 있는지도 함께 돌려준다. */
function summaryBankTokens(
  kw: string,
  known: Map<string, string>,
  passageWords: Set<string>
): { words: string[]; hasVerb: boolean } {
  const words: string[] = [];
  let hasVerb = false;
  for (const raw of kw.split(/\s+/)) {
    const tok = bareWord(raw);
    if (!tok) continue;
    const lower = tok.toLowerCase();
    const base = known.get(lower) ?? codeVerbBase(lower, passageWords);
    if (base && base !== lower) {
      hasVerb = true;
      words.push(base);
    } else {
      words.push(tok);
    }
  }
  return { words, hasVerb };
}

/**
 * 요약문 완성. withBank(기본)면 빈칸 답 낱말을 〈보기〉로 주고 동사만 원형으로 바꿔 둔다 — 학생이 어형을
 * 바꿔 넣는다(선생님 2026-10-24: 보기 없이는 너무 어렵다). 빈칸 셋은 동사가 든 어구를 먼저 고른다.
 */
function buildSummary(p: Ready, seed: string, withBank = true): TestSection | null {
  if (!p.content.summaryEn.trim() || !p.content.summaryKeywords.length) return null;
  const known = new Map((p.content.summaryVerbs ?? []).map((v) => [v.form.toLowerCase(), v.base.toLowerCase()] as const));
  const passageWords = new Set(
    [...p.sentences.map((s) => s.english), p.content.summaryEn]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z'’-]+/)
      .filter(Boolean)
  );
  const scored = p.content.summaryKeywords.map((kw, i) => ({ kw, i, ...summaryBankTokens(kw, known, passageWords) }));
  // 동사가 든 어구 먼저, 그다음 나머지 — 셋을 고른 뒤 요약문에 나온 차례로
  const chosen = withBank
    ? [...scored.filter((x) => x.hasVerb), ...scored.filter((x) => !x.hasVerb)].slice(0, 3).sort((a, b) => a.i - b.i)
    : scored.slice(0, 3);
  const kws = chosen.map((x) => x.kw);
  const labels = "ABC";
  const parts = splitSummaryByKeywords(p.content.summaryEn, kws);
  const passage: TestSeg[] = parts.map((x) => (x.keywordIndex == null ? x.text : { blank: `(${labels[x.keywordIndex]})` }));
  const answers = parts.filter((x) => x.keywordIndex != null).map((x) => `(${labels[x.keywordIndex!]}) ${x.text}`);
  if (!answers.length) return null;
  const bank = withBank
    ? fisherYatesShuffle(
        chosen.flatMap((x) => x.words),
        createSeededRng(`${seed}|summary-bank`)
      )
    : null;
  return {
    type: "summary",
    title: "요약문 완성",
    hint: bank
      ? "보기의 낱말을 모두 한 번씩 쓰되, 동사는 필요하면 형태를 바꿔 빈칸을 완성할 것"
      : "지문을 한 문장으로 요약할 때 빈칸에 알맞은 말",
    ...(bank ? { box: bank } : {}),
    passage,
    items: [],
    answer: answers.join("  "),
  };
}

/**
 * 지문에 밑줄 칠 자리(문장 번호·표현·몇 번째)를 지문 조각으로. 같은 문장에 여럿이면 앞에서부터.
 * 찾지 못한 표현은 뺀다(그 번호는 쓰지 않는다).
 */
function underlinePassage(
  p: Ready,
  marks: Array<{ si: number; phrase: string; occurrence?: number }>
): { passage: TestSeg[]; placed: number[] } {
  const bySi = new Map<number, Array<{ k: number; start: number; end: number }>>();
  marks.forEach((m, k) => {
    const s = p.sentences[m.si];
    if (!s) return;
    const sentence = clean(s.english);
    const hit = (m.occurrence ? findPhraseAt(sentence, m.phrase, m.occurrence) : null) ?? findPhrase(sentence, m.phrase);
    if (!hit) return;
    const list = bySi.get(m.si) ?? [];
    if (list.some((x) => hit.start < x.end && x.start < hit.end)) return;
    list.push({ k, start: hit.start, end: hit.end });
    bySi.set(m.si, list);
  });
  const order = [...bySi.values()].flat().sort((a, b) => a.k - b.k);
  const numberOf = new Map(order.map((x, i) => [x.k, circled(i)] as const));
  const passage: TestSeg[] = [];
  p.sentences.forEach((s, si) => {
    const sentence = clean(s.english);
    if (!sentence) return;
    if (passage.length) passage.push(" ");
    let cursor = 0;
    for (const m of (bySi.get(si) ?? []).sort((a, b) => a.start - b.start)) {
      passage.push(sentence.slice(cursor, m.start), { u: sentence.slice(m.start, m.end), n: numberOf.get(m.k) });
      cursor = m.end;
    }
    passage.push(sentence.slice(cursor));
  });
  return { passage, placed: order.map((x) => x.k) };
}

/** 지칭추론(1장 테스트지처럼): 밑줄 친 지칭어가 가리키는 말을 본문에서 찾아 쓴다 */
function buildReference(p: Ready): TestSection | null {
  const refs = (p.content.references ?? []).filter((r) => r.surface.trim() && r.referent.trim()).slice(0, 6);
  if (!refs.length) return null;
  const { passage, placed } = underlinePassage(p, refs.map((r) => ({ si: r.sentenceIndex, phrase: r.surface, occurrence: r.occurrence })));
  if (!placed.length) return null;
  return {
    type: "reference",
    title: "지칭추론",
    hint: "밑줄 친 말이 가리키는 것을 본문에서 찾아 쓰기",
    passage,
    items: placed.map((k, i) => ({ no: circled(i), text: [refs[k]!.surface, " → ", { blank: "" }], answer: refs[k]!.referent })),
  };
}

/** 함축의미: 밑줄 친 표현이 이 글에서 뜻하는 바를 우리말로 */
function buildImplication(p: Ready): TestSection | null {
  const imps = (p.content.implications ?? []).filter((m) => m.expression.trim() && (m.meaningKo.trim() || m.meaningEn.trim())).slice(0, 4);
  if (!imps.length) return null;
  const { passage, placed } = underlinePassage(p, imps.map((m) => ({ si: m.sentenceIndex, phrase: m.expression })));
  if (!placed.length) return null;
  return {
    type: "implication",
    title: "함축의미",
    hint: "밑줄 친 표현이 이 글에서 뜻하는 바를 우리말로",
    passage,
    items: placed.map((k, i) => ({
      no: circled(i),
      text: [imps[k]!.expression],
      lines: 2,
      answer: [imps[k]!.meaningKo, imps[k]!.meaningEn].filter((x) => x.trim()).join(" — "),
    })),
  };
}

/** 바꿔 말하기: 본문 표현과 같은 뜻 문장(패러프레이징)의 핵심 낱말을 첫 글자만 주고 채운다 */
function buildParaphrase(p: Ready, seed: string, up = false): TestSection | null {
  const items: TestItem[] = [];
  for (const x of p.content.paraphrases ?? []) {
    const options = x.paraphrases.filter((t) => t.trim());
    if (!x.expression.trim() || !options.length) continue;
    const para = pickN(options, 1, `${seed}|para|${x.sentenceIndex}`)[0]!;
    const own = new Set(x.expression.toLowerCase().match(/[a-z]+/g) ?? []);
    // 본문에 없는 내용어 가운데 가장 긴 것(바꿔 쓴 핵심 낱말)
    const word = (para.match(/[A-Za-z][a-z]+(?:-[a-z]+)*/g) ?? [])
      .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()) && !own.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    const part = word ? splitAt(para, word) : null;
    if (!part) continue;
    items.push({
      no: no(items.length),
      text: ["= ", part.before, { blank: up ? "" : part.hit[0]! }, part.after],
      tag: x.expression,
      ko: up ? undefined : x.meaningKo || undefined,
      answer: part.hit,
    });
  }
  if (!items.length) return null;
  return {
    type: "paraphrase",
    title: "바꿔 말하기",
    hint: up ? "본문 표현(위)과 같은 뜻이 되도록 빈칸 채우기" : "본문 표현(위)과 같은 뜻이 되도록 빈칸 채우기 · 첫 글자 줌",
    items: items.slice(0, 6),
  };
}

/** 도식화: 글의 흐름 칸(배경·전환·예시…)에 섞은 보기에서 알맞은 내용을 골라 넣는다 */
function buildFlow(p: Ready, seed: string): TestSection | null {
  const nodes = (p.content.flow ?? []).filter((n) => n.ko.trim()).slice(0, 6);
  if (nodes.length < 3) return null;
  const split = (t: string) => {
    const m = t.match(/^\s*([^:：]{1,12})[:：]\s*(.+)$/);
    return m ? { label: m[1]!.trim(), body: m[2]!.trim() } : { label: "", body: t.trim() };
  };
  const parts = nodes.map((n) => split(n.ko));
  const letters = "ⓐⓑⓒⓓⓔⓕ";
  const order = fisherYatesShuffle(parts.map((_, i) => i), createSeededRng(`${seed}|flow`));
  const letterOf = new Map(order.map((orig, pos) => [orig, letters[pos]!] as const));
  return {
    type: "flow",
    title: "도식화",
    hint: "글의 흐름에 맞게 칸에 알맞은 내용을 보기에서 골라 쓰기",
    diagram: { steps: parts.map((x, i) => x.label || `${i + 1}단계`), choices: order.map((orig, pos) => `${letters[pos]} ${parts[orig]!.body}`) },
    items: parts.map((x, i) => ({ no: x.label || `${i + 1}단계`, text: [], answer: letterOf.get(i)! })),
    inline: true,
  };
}

/** 워크북 어법 선택의 [바른 말 / 틀린 말] 쌍(검수를 마친 자리) — 원문 위치와 맞는 것만 */
type WorkbookGrammarPair = { number: number; start: number; end: number; right: string; wrong: string; sentenceId: string; category: string; value: number };

function workbookGrammarPairs(p: Ready): WorkbookGrammarPair[] {
  const gc = p.grammarChoice;
  const text = gc?.sourcePassage ?? "";
  if (!gc?.items?.length || !text) return [];
  return gc.items
    .filter(
      (it) =>
        it.startCharIndex >= 0 &&
        it.startCharIndex < it.endCharIndex &&
        it.endCharIndex <= text.length &&
        text.slice(it.startCharIndex, it.endCharIndex) === it.correctText &&
        !!it.incorrectText.trim() &&
        it.incorrectText.trim().toLowerCase() !== it.correctText.trim().toLowerCase()
    )
    .map((it) => ({
      number: it.number,
      start: it.startCharIndex,
      end: it.endCharIndex,
      right: it.correctText,
      wrong: it.incorrectText.trim(),
      sentenceId: it.sentenceId,
      category: it.grammarCategoryId,
      value: it.learningValue,
    }));
}

/**
 * 어법 서술형에 쓸 워크북 자리(선생님 2026-10-26: 서술형이 빈약하다 — 워크북 어법 자리로, 선택과 안 겹치게).
 * 학습 가치가 높은 것 먼저, 문항 하나가 문장 하나라 서로 다른 문장에서, 되도록 다른 문법 항목으로.
 */
function pickGrammarFixPairs(pairs: WorkbookGrammarPair[], count: number, seed: string): WorkbookGrammarPair[] {
  const pool = fisherYatesShuffle(pairs, createSeededRng(`${seed}|gfix`)).sort((a, b) => b.value - a.value);
  const chosen: WorkbookGrammarPair[] = [];
  const takes = (x: WorkbookGrammarPair, newCategory: boolean) =>
    !chosen.includes(x) &&
    !chosen.some((c) => c.sentenceId === x.sentenceId) &&
    (!newCategory || !chosen.some((c) => c.category === x.category));
  for (const strict of [true, false]) {
    for (const x of pool) {
      if (chosen.length >= count) break;
      if (takes(x, strict)) chosen.push(x);
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** 지문 속 자리를 감싼 문장의 범위. 지문 문장을 차례로 찾아 쓰고, 못 찾으면 마침표로 가른다. */
function sentenceSpan(p: Ready, text: string, start: number, end: number): { from: number; to: number } {
  let cursor = 0;
  for (const s of p.sentences) {
    const sentence = clean(s.english);
    if (!sentence) continue;
    const at = text.indexOf(sentence, cursor);
    if (at < 0) continue;
    cursor = at + sentence.length;
    if (at <= start && end <= cursor) return { from: at, to: cursor };
  }
  const head = text.slice(0, start).search(/[^.!?]*$/);
  const tail = /[.!?]["'”’)]*(\s|$)/.exec(text.slice(end));
  return { from: Math.max(0, head), to: tail ? end + tail.index + tail[0].trimEnd().length : text.length };
}

function buildGrammarFixFromWorkbook(p: Ready, chosen: WorkbookGrammarPair[]): TestSection | null {
  const text = p.grammarChoice?.sourcePassage ?? "";
  const items = chosen.map((x, i) => {
    const span = sentenceSpan(p, text, x.start, x.end);
    const wrong = matchCase(x.right, x.wrong);
    const sentence = (text.slice(span.from, x.start) + wrong + text.slice(x.end, span.to)).trim();
    return { no: no(i), text: [sentence], lines: 1, answer: `${wrong} → ${x.right}` };
  });
  if (!items.length) return null;
  return { type: "grammarFix", title: "어법 수정", hint: "틀린 곳을 찾아 바르게 고쳐 쓰기", items };
}

/**
 * 제목·주제·요지 해석(워크북과 같이 영어를 주고 우리말로). 1장 자료의 영어 제목·요약문을 쓰고
 * 정답은 지문 제목·요약문 해석이다. 영어 주제문은 1장 자료에 없어 제목·요지 둘만.
 */
function buildGist(p: Ready): TestSection | null {
  const items: TestItem[] = [];
  const title = p.content.titleEn.trim();
  if (title && p.title.trim()) items.push({ no: no(items.length), tag: "제목", text: [title], lines: 1, answer: p.title.trim() });
  const gist = p.content.summaryEn.trim();
  if (gist && p.content.summaryKo.trim()) items.push({ no: no(items.length), tag: "요지", text: [gist], lines: 2, answer: p.content.summaryKo.trim() });
  if (!items.length) return null;
  return { type: "gist", title: "제목·주제·요지 해석", hint: "영어를 우리말로 해석하기", items };
}

/** 어휘 수정: 문맥에 어색한 낱말(어휘 선택의 오답)을 넣은 문장에서 찾아 고쳐 쓴다 */
function buildVocabFix(p: Ready, skip: Set<string>): TestSection | null {
  const chosen = bySentence(vocabCandidates(p, true).filter((c) => !skip.has(c.key)));
  if (!chosen.length) return null;
  // 바꾼 낱말 앞 관사를 맞춘다(a improvisation처럼 관사가 답을 알려 주지 않게)
  const article = (before: string, word: string) =>
    before.replace(/\b([Aa])(n?)(\s+)$/, (_m, a: string, _n: string, sp: string) => `${a}${/^[aeiou]/i.test(word) ? "n" : ""}${sp}`);
  return {
    type: "vocabFix",
    title: "어휘 수정",
    hint: "문맥상 어색한 낱말을 찾아 바르게 고쳐 쓰기",
    items: chosen.map((c, i) => ({ no: no(i), text: [article(c.before, c.wrong) + c.wrong + c.after], lines: 1, answer: `${c.wrong} → ${c.right}` })),
  };
}

/** 문장 순서 배열(워크북과 같이 첫 문장을 주고 나머지 문장을 섞는다) */
function buildSentenceOrder(p: Ready, seed: string): TestSection | null {
  const all = p.sentences.map((s) => clean(s.english)).filter(Boolean);
  if (all.length < 4) return null;
  const [given, ...rest] = all;
  const ids = rest.map((_, i) => i);
  let order = fisherYatesShuffle(ids, createSeededRng(`${seed}|sorder`));
  if (order.every((x, i) => x === i)) order = [...order.slice(1), order[0]!];
  return {
    type: "sentenceOrder",
    title: "문장 순서 배열",
    hint: "주어진 문장 다음에 이어질 순서대로 번호 쓰기",
    given,
    items: order.map((orig, k) => ({ no: no(k), text: [rest[orig]!], answer: "" })),
    answer: ids.map((orig) => no(order.indexOf(orig))).join(" - "),
  };
}

/** 어순배열 영작: 모든 문장(덩어리를 못 나눈 짧은 문장은 뺀다). 중요문장 어순배열과 같은 모양. */
function buildWordOrder(p: Ready, seed: string, up = false, max?: number): TestSection | null {
  const pool = keyFirst(
    p,
    p.sentences
      .map((_, si) => ({ si, chunks: p.material.chunks[si] }))
      .filter((x): x is { si: number; chunks: string[] } => !!x.chunks && x.chunks.length >= 3 && !!p.sentences[x.si]?.korean.trim()),
    seed,
    max
  );
  if (!pool.length) return null;
  return {
    type: "wordOrder",
    title: "어순배열 영작",
    hint: up ? "해석에 맞게 배열하기 · 덩어리 잘게, 앞말 없음" : "해석에 맞게 배열하기",
    items: pool.map((c, i) => {
      const split = splitLead(c.chunks);
      const lead = up ? "" : split.lead;
      const rest = up ? finerChunks(c.chunks) : split.rest;
      return {
        no: no(i),
        text: [],
        ko: p.sentences[c.si]!.korean,
        lead: lead || undefined,
        chunks: shuffleChunks(rest, `${seed}|word-order|${c.si}`),
        lines: 1,
        answer: answerSentence(p.sentences[c.si]!.english),
      };
    }),
  };
}

function buildGrammarFix(p: Ready, seed: string, skip: Set<string>): TestSection | null {
  void seed;
  const chosen = bySentence(grammarCandidates(p).filter((c) => !skip.has(c.key)));
  if (!chosen.length) return null;
  return {
    type: "grammarFix",
    title: "어법 수정",
    hint: "틀린 곳을 찾아 바르게 고쳐 쓰기",
    items: chosen.map((c, i) => ({ no: no(i), text: [c.before + c.wrong + c.after], lines: 1, answer: `${c.wrong} → ${c.right}` })),
  };
}

function buildWords(p: Ready, seed: string): TestSection | null {
  const rows = p.material.vocab.filter((r) => r.word && r.meaning);
  const chosen = arrange(rows, seed);
  if (!chosen.length) return null;
  return {
    type: "words",
    title: "단어 영↔한",
    hint: "영어는 뜻을, 뜻은 영어를 쓰기",
    items: chosen.map((r, i) => {
      const en2ko = hashSeedToUint32(`${seed}|w|${r.word}`) % 2 === 0;
      return { no: no(i), text: [en2ko ? r.word : r.meaning], lines: 0, answer: en2ko ? r.meaning : r.word };
    }),
  };
}

/**
 * 지문 하나로 테스트지를 조립한다. seed가 같으면 같은 시험지가 나온다(교재 견본은 "book").
 * 재료가 모자라 못 만드는 유형은 빠진다.
 */
/*
 * 자동 뽑기(선생님 2026-10-21: 다 뽑으면 너무 많다 — 기준을 정해 무작위로). 유형마다 지문당 문항 상한.
 * 해석·영작은 중요문장(어순배열과 같은 규칙·단원문법·어려운 구문)을 먼저 고르고, 지문 안에 번호가 박히는
 * 유형(빈칸·어법·어휘·지칭·함축)은 고르지 않은 자리를 원문 글자로 되돌린다.
 */
export type TestLimits = Partial<Record<TestBookTypeKey, number>>;

/** 상한이 있으면 중요문장 먼저, 그다음 무작위로 max개 — 지문 차례는 그대로 둔다 */
function keyFirst<T extends { si: number }>(p: Ready, list: T[], seed: string, max?: number): T[] {
  if (max == null || list.length <= max) return list;
  const key = new Set([
    ...p.material.keyIndexes,
    ...(p.material.unitHits ?? []).map((h) => h.si),
    ...(p.material.hardHits ?? []).map((h) => h.si),
  ]);
  const rng = createSeededRng(`${seed}|limit`);
  const ranked = [
    ...fisherYatesShuffle(list.filter((x) => key.has(x.si)), rng),
    ...fisherYatesShuffle(list.filter((x) => !key.has(x.si)), rng),
  ].slice(0, max);
  const keep = new Set(ranked.map((x) => x.si));
  return list.filter((x) => keep.has(x.si));
}

/** 이미 만든 문항에서 max개만 남긴다(번호는 다시 매긴다) */
function limitSection(sec: TestSection, max: number, seed: string): TestSection {
  if (sec.items.length <= max) return sec;
  const rng = createSeededRng(`${seed}|${sec.type}|cap`);
  const keepIdx = new Set(fisherYatesShuffle(sec.items.map((_, i) => i), rng).slice(0, max));
  const numbered = !!sec.passage?.some((g) => typeof g !== "string" && "n" in g && g.n);
  if (!numbered) {
    // 문항 목록만 있는 유형(T/F·어순배열·어법 서술형 등): 앞에서부터 차례로(이미 섞여 있다)
    const items = sec.items.slice(0, max).map((it, i) => ({ ...it, no: it.no.startsWith("(") ? no(i) : it.no }));
    return { ...sec, items };
  }
  // 지문에 번호가 박힌 유형: 남길 번호만 다시 매기고, 나머지 자리는 원문 글자로
  const itemOf = (n: string) => sec.items.findIndex((it) => it.no === n || it.no === `${n}.`);
  const renum = new Map<string, string>();
  let k = 0;
  const passage = (sec.passage ?? []).map((g) => {
    if (typeof g === "string" || !("n" in g) || !g.n) return g;
    const idx = itemOf(g.n);
    if (idx < 0 || !keepIdx.has(idx)) {
      if ("blank" in g) return sec.items[idx]?.answer ?? "";
      if ("pick" in g) return sec.items[idx]?.answer ?? g.pick[0];
      return "u" in g ? g.u : "";
    }
    const isBlank = "blank" in g;
    const nn = isBlank ? String(k + 1) : circled(k);
    k += 1;
    renum.set(g.n, nn);
    return { ...g, n: nn };
  });
  const items = sec.items
    .map((it, i) => ({ it, i }))
    .filter(({ i }) => keepIdx.has(i))
    .map(({ it }) => {
      const old = it.no.replace(/\.$/, "");
      const nn = renum.get(old) ?? it.no;
      return { ...it, no: it.no.endsWith(".") ? `${nn}.` : nn };
    });
  return { ...sec, passage, items };
}

export function buildTestSheet(
  p: Ready,
  types: TestBookTypeKey[],
  opts: {
    seed: string;
    blankMode?: BlankMode;
    writing?: WritingScope;
    lineMode?: LineMode;
    level?: TestLevel;
    limits?: TestLimits;
    /** 요약문 완성에 〈보기〉(동사만 원형)를 준다. 기본 켬(선생님 2026-10-24). */
    summaryBank?: boolean;
  }
): TestSheet {
  const seed = `${opts.seed}|${p.id}`;
  const up = opts.level === "up";
  const on = new Set(types);
  const sections: TestSection[] = [];
  // 어법선택·어법 서술형을 함께 고르면 어법 자리를 번갈아 나눈다(같은 자리를 두 번 묻지 않게)
  const grammarPool = grammarCandidates(p);
  const both = on.has("grammar") && on.has("grammarFix") && !p.grammarChoice?.items?.length;
  const forPick = both ? grammarPool.filter((_, i) => i % 2 === 0) : grammarPool;
  // 워크북 어법 선택이 있으면 어법 서술형도 그 자리로: 서술형 몫을 먼저 떼고 어법선택은 남은 자리 전부.
  // 함께 고르면 서술형은 자리의 절반을 넘지 않는다(어법선택에도 자리가 남게).
  const wbPairs = on.has("grammarFix") ? workbookGrammarPairs(p) : [];
  const fixWant = Math.max(1, opts.limits?.grammarFix ?? 4);
  const fixPairs = wbPairs.length
    ? pickGrammarFixPairs(wbPairs, Math.min(fixWant, on.has("grammar") ? Math.floor(wbPairs.length / 2) : wbPairs.length), seed)
    : [];
  const fixNos = new Set(fixPairs.map((x) => x.number));
  const wbGrammar = on.has("grammar") ? workbookGrammarSection(p, seed, fixNos) : null;
  // 1장 자료 어법 자리로 어법선택을 만들었을 때만 서술형이 그 자리를 피한다
  // (예전에는 워크북 어법선택을 쓸 때도 1장 자리를 모두 쓴 것으로 쳐서 서술형이 통째로 빠졌다)
  const usedGrammar = new Set(on.has("grammar") && !wbGrammar ? forPick.map((c) => c.key) : []);
  // 어휘 선택·어휘 수정을 함께 고르면(1장 자료 어휘 자리로 만들 때) 자리를 번갈아 나눈다
  const vocabPool = vocabCandidates(p);
  const vocabFromWb = !!p.vocabChoice?.items?.length;
  const vocabBoth = on.has("vocab") && on.has("vocabFix") && !vocabFromWb;
  const forVocabPick = vocabBoth ? vocabPool.filter((_, i) => i % 2 === 0) : vocabPool;
  const usedVocab = new Set(on.has("vocab") && !vocabFromWb ? forVocabPick.map((c) => c.key) : []);
  for (const key of ALL_TEST_BOOK_TYPES) {
    if (!on.has(key)) continue;
    const sec =
      key === "line" ? buildLine(p, seed, opts.lineMode ?? "full", opts.limits?.line)
      : key === "blank" ? buildBlank(p, seed, opts.blankMode ?? "same", up)
      : key === "grammar" ? (wbGrammar ?? pickSection(p, "grammar", "어법 선택", "알맞은 것에 ○", forPick, seed))
      : key === "vocab"
        ? (choiceSectionTest(p.vocabChoice, "vocab", "어휘 선택", "문맥에 맞는 것에 ○", seed) ??
          pickSection(p, "vocab", "어휘 선택", "문맥에 맞는 것에 ○", forVocabPick, seed))
      : key === "order" ? buildOrder(p, seed, up)
      : key === "tf" ? buildTf(p, seed, up)
      : key === "writing" ? buildWriting(p, seed, opts.writing ?? "all", up, opts.limits?.writing)
      : key === "link" ? buildLink(p, seed, opts.limits?.link)
      : key === "sequence" || key === "insert" ? null
      : key === "summary" ? buildSummary(p, seed, opts.summaryBank !== false)
      : key === "reference" ? buildReference(p)
      : key === "implication" ? buildImplication(p)
      : key === "paraphrase" ? buildParaphrase(p, seed, up)
      : key === "flow" ? buildFlow(p, seed)
      : key === "grammarFix" ? (fixPairs.length ? buildGrammarFixFromWorkbook(p, fixPairs) : buildGrammarFix(p, seed, usedGrammar))
      : key === "gist" ? buildGist(p)
      : key === "vocabFix" ? buildVocabFix(p, usedVocab)
      : key === "sentenceOrder" ? buildSentenceOrder(p, seed)
      : key === "wordOrder" ? buildWordOrder(p, seed, up, opts.limits?.wordOrder)
      : buildWords(p, seed);
    if (key === "sequence" || key === "insert") {
      // 지문 통째 유형은 문항 수만큼 서로 다른 문항을 싣는다(기본 1문항, 재료가 모자라면 되는 만큼)
      const count = Math.max(1, opts.limits?.[key] ?? 1);
      const made =
        key === "sequence"
          ? Array.from({ length: count }, (_, at) => buildSequence(p, seed, at))
          : insertSentences(p, seed, count).map((si) => buildInsert(p, seed, si));
      for (const x of made) if (x) sections.push(x);
      continue;
    }
    const cap = key === "line" || key === "writing" || key === "link" || key === "wordOrder" || key === "sentenceOrder" ? undefined : opts.limits?.[key];
    if (sec) sections.push(cap != null ? limitSection(sec, cap, seed) : sec);
  }
  return { projectId: p.id, title: p.title, source: p.source, sections };
}

// ---------------------------------------------------------------- 동반의어 테스트

export type WordTest = {
  /** 뜻 쓰기 */
  meaning: Array<{ no: string; word: string; answer: string }>;
  /** 동의어(=)·반의어(↔) 고르기 */
  synonym: Array<{ no: string; word: string; rel: "=" | "↔"; choices: string[]; answer: number }>;
  /** 품사 바꾸기: ambitious (a.) → n. ______ */
  forms: Array<{ no: string; word: string; pos: string; toPos: string; answer: string }>;
};

/** 품사 이름(시험지에 「명사형」처럼 쓴다) */
export const POS_NAME: Record<string, string> = {
  "n.": "명사형",
  "v.": "동사형",
  "a.": "형용사형",
  "ad.": "부사형",
};

/**
 * 동반의어 객관식 오답 셋(선생님 의견 2026-10-21: 너무 연관 없는 말 대신 혼동어휘·같은 품사로).
 * 1) 문제 낱말과 철자가 비슷한 혼동어휘 2) 같은 품사인 다른 단어와 그 동반의어. 정답·문제 낱말과
 * 뿌리가 같은 말(exclusion·excluded)은 둘 다 답이 될 수 있어 쓰지 않는다.
 */
function choiceDistractors(rows: TestBookVocabRow[], r: TestBookVocabRow, correct: string, key: string): string[] {
  const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);
  const banned = new Set([r.word, ...r.synonyms, ...r.antonyms, correct].map((w) => w.toLowerCase()));
  const bannedStems = new Set([r.word, correct].map(stem).filter((s) => s.length >= 4));
  const ok = (w: string) => !!w.trim() && !banned.has(w.toLowerCase()) && !bannedStems.has(stem(w));
  const out: string[] = [];
  const add = (list: string[]) => {
    for (const w of list) {
      if (out.length >= 3) return;
      if (ok(w) && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w.trim());
    }
  };
  add(pickN(r.confusables ?? [], 2, `${key}|cf`));
  const samePos = rows
    .filter((o) => o.word !== r.word && o.pos === r.pos)
    .flatMap((o) => [o.word, ...o.synonyms, ...o.antonyms, ...(o.confusables ?? [])]);
  add(pickN([...new Set(samePos)], 6, `${key}|sp`));
  if (out.length < 3) add(pickN([...new Set(rows.flatMap((o) => [o.word, ...o.synonyms]))], 6, `${key}|any`));
  return out.slice(0, 3);
}

export function buildWordTest(p: Ready, seed: string): WordTest {
  const rows = p.material.vocab.filter((r) => r.word && r.meaning);
  // 뜻 쓰기: 핵심어를 먼저, 모자라면 나머지에서
  const keyRows = rows.filter((r) => r.key);
  const restRows = rows.filter((r) => !r.key);
  const meaningRows = [...pickN(keyRows, 10, `${seed}|m1`), ...pickN(restRows, 10, `${seed}|m2`)].slice(0, 10);
  const meaning = meaningRows.map((r, i) => ({ no: String(i + 1), word: r.word, answer: r.meaning }));

  // 고르기: 동의어나 반의어가 있는 핵심어. 오답은 다른 단어·다른 단어의 동의어에서.
  const pool = keyRows.filter((r) => r.synonyms.length || r.antonyms.length);
  const chosen = pickN(pool, 6, `${seed}|syn`);
  const synonym = chosen.map((r, i) => {
    const useAnt = r.antonyms.length > 0 && (r.synonyms.length === 0 || hashSeedToUint32(`${seed}|rel|${r.word}`) % 3 === 0);
    const rel: "=" | "↔" = useAnt ? "↔" : "=";
    const correct = (useAnt ? r.antonyms : r.synonyms)[0]!;
    const wrong = choiceDistractors(rows, r, correct, `${seed}|syn|${r.word}`);
    const choices = fisherYatesShuffle([correct, ...wrong], createSeededRng(`${seed}|synorder|${r.word}`));
    return { no: String(i + 1), word: r.word, rel, choices, answer: choices.indexOf(correct) };
  });

  // 품사 바꾸기: 파생어가 있는 단어(핵심어 먼저), 한 단어에 한 문항
  const formPool = [...keyRows, ...restRows].flatMap((r) =>
    r.forms
      .filter((f) => f.word && POS_NAME[f.pos] && f.pos !== r.pos && f.word.toLowerCase() !== r.word.toLowerCase())
      .slice(0, 1)
      .map((f) => ({ word: r.word, pos: r.pos, toPos: f.pos, answer: f.word }))
  );
  const forms = pickN(formPool, 6, `${seed}|forms`).map((f, i) => ({ no: String(i + 1), ...f }));
  return { meaning, synonym, forms };
}

export function circled(i: number): string {
  return CIRCLED[i] ?? `(${i + 1})`;
}

// ---------------------------------------------------------------- 단어 시험지

/*
 * 단어 시험은 따로 한 장(선생님 2026-10-20: 영↔한만이 아니라 파생어·동반의어 객관식도, 문항 수를 정해서).
 * 고른 지문들의 단어를 합쳐(같은 낱말은 처음 지문 것) 고른 유형에 문항 수를 고르게 나눈다.
 */
export type VocabExamKind = "meaning" | "spelling" | "synonym" | "antonym" | "form" | "formChoice";

export const VOCAB_EXAM_KINDS: Array<{ key: VocabExamKind; label: string; hint: string }> = [
  { key: "meaning", label: "뜻 쓰기 (영→한)", hint: "단어를 보고 지문 속 뜻 쓰기" },
  { key: "spelling", label: "철자 쓰기 (한→영)", hint: "뜻을 보고 영어 쓰기" },
  { key: "synonym", label: "동의어 고르기", hint: "4지선다" },
  { key: "antonym", label: "반의어 고르기", hint: "4지선다" },
  { key: "form", label: "파생어 쓰기", hint: "품사를 바꿔 쓰기" },
  { key: "formChoice", label: "파생어 고르기", hint: "4지선다" },
];

/** 「전체」 — 범위 안 단어로 낼 수 있는 만큼 */
export const VOCAB_EXAM_ALL = 9999;
/**
 * 유형마다 문항 수(선생님 2026-10-20: 단어 시험은 유형별로 문항 수를 정하게). 범위 단어를 한 번에 다 내기도 한다
 * (윌링어학원 Jayden 선생님 2026-10-29: 240단어 뜻쓰기 240문항. 10-30: 수업용 자료 화면도 30개에 막히지 않게).
 */
export const VOCAB_EXAM_KIND_COUNTS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, VOCAB_EXAM_ALL];

export type VocabExamOptions = { counts: Record<VocabExamKind, number> };

/** 칸에 적은 출제 범위(0은 비움)를 전체 단어장 번호 안으로 맞춘다. 전체면 null. */
export function vocabExamRange(from: number, to: number, wordCount: number): { from: number; to: number } | null {
  if (!wordCount) return null;
  const a = Math.min(Math.max(from || 1, 1), wordCount);
  const b = Math.min(Math.max(to || wordCount, a), wordCount);
  return a === 1 && b === wordCount ? null : { from: a, to: b };
}

export const DEFAULT_VOCAB_EXAM: VocabExamOptions = {
  counts: { meaning: 10, spelling: 10, synonym: 5, antonym: 5, form: 5, formChoice: 5 },
};

export function normalizeVocabExam(raw: unknown): VocabExamOptions {
  const r = (raw ?? {}) as { counts?: Record<string, unknown> };
  const counts = { ...DEFAULT_VOCAB_EXAM.counts };
  if (r.counts && typeof r.counts === "object") {
    for (const k of VOCAB_EXAM_KINDS.map((x) => x.key)) {
      const n = Math.floor(Number(r.counts[k]));
      if (Number.isFinite(n) && n >= 0) counts[k] = Math.min(VOCAB_EXAM_ALL, n);
    }
  }
  return { counts };
}

export type VocabExamItem = {
  no: number;
  /** 전체 단어장 번호(지문 차례로 같은 낱말은 한 번, 1부터) */
  wordNo: number;
  /** 문항에 보이는 말(단어·뜻·「restore (v.) → n.」) */
  prompt: string;
  /** 철자 쓰기 첫 글자 */
  hint?: string;
  /** 객관식 보기 */
  choices?: string[];
  /** 정답(객관식은 보기 번호 ①…, 쓰기는 낱말·뜻) */
  answer: string;
  /** 지문 번호(1부터) */
  passage: number;
};

export type VocabExamSection = { kind: VocabExamKind; title: string; hint: string; items: VocabExamItem[] };

export type VocabExam = { total: number; sections: VocabExamSection[] };

const CHOICE_NO = "①②③④";

/**
 * 단어 시험 옵션.
 * range: 전체 단어장 번호 범위(1부터, 끝 포함) — 그 번호 단어만 낸다.
 * inOrder: 무작위 대신 단어장 번호 순서대로 앞에서부터 낸다.
 * (윌링어학원 Jayden 선생님 2026-10-29: 「1~50번만 번호순 또는 무작위로」)
 */
export type VocabExamBuildOptions = VocabExamOptions & {
  seed: string;
  range?: { from: number; to: number } | null;
  inOrder?: boolean;
  /** 유형별 최대 수를 셀 때만: 영→한·한→영 단어 나누기를 하지 않는다 */
  shareWords?: boolean;
};

export function buildVocabExam(
  projects: Array<{ passage: number; vocab: TestBookVocabRow[] }>,
  opts: VocabExamBuildOptions
): VocabExam {
  // 번호는 전체 단어장(allVocabRows)과 같게 센다: 지문 차례, 같은 낱말은 처음 것 하나
  const seen = new Set<string>();
  const rows: Array<TestBookVocabRow & { passage: number; wordNo: number }> = [];
  let wordNo = 0;
  for (const p of projects) {
    for (const r of p.vocab) {
      const k = r.word.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      wordNo += 1;
      if (!r.word || !r.meaning) continue;
      if (opts.range && (wordNo < opts.range.from || wordNo > opts.range.to)) continue;
      rows.push({ ...r, passage: p.passage, wordNo });
    }
  }
  const mcq = (r: TestBookVocabRow, correct: string, key: string) => {
    const wrong = choiceDistractors(rows, r, correct, `${opts.seed}|vx|${key}`);
    if (wrong.length < 3) return null;
    const choices = fisherYatesShuffle([correct, ...wrong], createSeededRng(`${opts.seed}|vxo|${key}`));
    return { choices, answer: CHOICE_NO[choices.indexOf(correct)]! };
  };
  // 유형마다 만들 수 있는 문항(후보)
  const cands: Record<VocabExamKind, Array<Omit<VocabExamItem, "no">>> = {
    meaning: rows.map((r) => ({ prompt: r.word, answer: r.meaning, passage: r.passage, wordNo: r.wordNo })),
    spelling: rows
      .filter((r) => /^[A-Za-z]/.test(r.word))
      // 첫 글자는 알려 주지 않는다(선생님 2026-10-21)
      .map((r) => ({ prompt: r.meaning, answer: r.word, passage: r.passage, wordNo: r.wordNo })),
    synonym: rows.flatMap((r) => {
      const c = r.synonyms[0];
      const m = c ? mcq(r, c, `s|${r.word}`) : null;
      return m ? [{ prompt: r.word, ...m, passage: r.passage, wordNo: r.wordNo }] : [];
    }),
    antonym: rows.flatMap((r) => {
      const c = r.antonyms[0];
      const m = c ? mcq(r, c, `a|${r.word}`) : null;
      return m ? [{ prompt: r.word, ...m, passage: r.passage, wordNo: r.wordNo }] : [];
    }),
    form: rows.flatMap((r) => {
      const f = r.forms.find((x) => x.word && POS_NAME[x.pos] && x.pos !== r.pos);
      return f ? [{ prompt: `${r.word} (${r.pos}) → ${f.pos}`, answer: f.word, passage: r.passage, wordNo: r.wordNo }] : [];
    }),
    formChoice: rows.flatMap((r) => {
      // 같은 뿌리의 꼴로만 보기를 만든다(선생님 의견: affect · affection · affective · affectionate)
      const f = r.forms.find((x) => x.word && POS_NAME[x.pos] && x.pos !== r.pos);
      if (!f) return [];
      const family = [...new Set([r.word, ...r.forms.map((x) => x.word), ...(r.confusables ?? []).filter((w) => w[0]?.toLowerCase() === r.word[0]?.toLowerCase())])]
        .filter((w) => w && w.toLowerCase() !== f.word.toLowerCase());
      if (family.length < 3) return [];
      const choices = fisherYatesShuffle([f.word, ...pickN(family, 3, `${opts.seed}|fc|${r.word}`)], createSeededRng(`${opts.seed}|fco|${r.word}`));
      return [{ prompt: `${r.word} 의 ${POS_NAME[f.pos]}`, choices, answer: CHOICE_NO[choices.indexOf(f.word)]!, passage: r.passage, wordNo: r.wordNo }];
    }),
  };
  const want: Record<string, number> = {};
  for (const k of VOCAB_EXAM_KINDS.map((x) => x.key)) want[k] = Math.min(opts.counts[k] ?? 0, cands[k].length);
  const kinds = VOCAB_EXAM_KINDS.map((x) => x.key).filter((k) => want[k]! > 0);
  if (!kinds.length) return { total: 0, sections: [] };
  // 영→한과 한→영에는 같은 단어를 내지 않는다(한쪽 문제가 다른 쪽 답이 된다 — 선생님 2026-11-02).
  // 동의어·반의어·파생어는 겹쳐도 된다. 철자(후보가 적다)를 먼저 잡고, 쪽에는 원래 유형 차례로 싣는다.
  const EXCLUSIVE: VocabExamKind[] = ["spelling", "meaning"];
  const used = new Set<number>();
  const pickedBy: Partial<Record<VocabExamKind, Array<Omit<VocabExamItem, "no">>>> = {};
  for (const k of [...kinds].sort((x, y) => Number(x !== "spelling") - Number(y !== "spelling"))) {
    const exclusive = EXCLUSIVE.includes(k) && !opts.shareWords;
    const free = exclusive ? cands[k].filter((it) => !used.has(it.wordNo)) : cands[k];
    const n = Math.min(want[k] ?? 0, free.length);
    const picked = opts.inOrder ? free.slice(0, n) : pickN(free, n, `${opts.seed}|vxk|${k}`);
    if (exclusive) for (const it of picked) used.add(it.wordNo);
    pickedBy[k] = picked;
  }
  let no = 0;
  const sections: VocabExamSection[] = [];
  for (const k of kinds) {
    const picked = pickedBy[k] ?? [];
    if (!picked.length) continue;
    const meta = VOCAB_EXAM_KINDS.find((x) => x.key === k)!;
    const items = picked.map((it) => ({ ...it, no: ++no }));
    sections.push({ kind: k, title: meta.label, hint: meta.hint, items });
  }
  return { total: no, sections };
}
