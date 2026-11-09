import { createHash } from "node:crypto";
import { callGrammarChoiceV2Json } from "@/lib/lesson-materials/grammar-choice-v2/openai-call";
import { resolveV2AnalyzerModel } from "@/lib/lesson-materials/grammar-choice-v2/generate";
import { isDerivedFromCorrect } from "@/lib/lesson-materials/grammar-choice-v2/local-validators";
import { engcoreWordLevel } from "@/lib/vocab/engcore-level";
import {
  formatWorkbookPassage,
  joinWorkbookPassageLines,
  type GrammarChoiceRenderSegment,
  type WorkbookVocabChoiceItem,
  type WorkbookVocabChoiceSection,
} from "@/lib/lesson-materials/workbook-types";

/**
 * 어휘 선택·어휘 수정의 재료: 지문의 내용어 자리마다 [원래 낱말 / 문맥상 틀린 낱말] 한 쌍.
 *
 * 1) 생성: 지문 전체를 보고 자리와 틀린 낱말을 넉넉히 만든다(빈칸 후보·단어장 반의어를 참고).
 * 2) 규칙 검사: 원문에 있는 자리인지, 어형·관사가 맞는지, 없는 낱말(접미사 붙이기)인지 본다.
 * 3) 검수: 다른 모델 호출이 지문 전체에서 "원래 낱말만 맞고 틀린 낱말은 확실히 틀린가"를
 *    판정한다. 둘 다 말이 되거나 문법만으로 답이 드러나는 쌍은 버린다.
 * 결과는 지문별로 저장해 두고, 지문이 바뀌지 않으면 다시 부르지 않는다.
 */

export const VOCAB_CHOICE_ALGORITHM_VERSION = "vocab-choice-v1";
/** 한 지문에 싣는 어휘 선택 자리 수 상한. */
/*
 * 선생님 요청(2026-09-20): "문장당 어휘 개수가 더 많으면 좋겠다. 한 문장에 여럿 들어가도 된다."
 * 문장당 2곳·전체 10개는 긴 지문에서도 열 자리에서 끊겼다. 3곳·16개로 올린다.
 */
const MAX_FINAL_ITEMS = 16;
const MAX_PER_SENTENCE = 3;

export type StoredVocabChoicePair = {
  sentenceId: string;
  /** 문장 안에서 몇 번째로 나오는 targetText인지(1부터) */
  occurrence: number;
  targetText: string;
  wrongText: string;
  meaningKo: string;
  relation: string;
  learningValue: number;
};

export type StoredVocabChoiceCache = {
  sourceHash: string;
  algorithmVersion: string;
  pairs: StoredVocabChoicePair[];
  /** 어느 수준으로 만든 쌍이 들었는지. 없으면 예전 것(= 난이도 UP과 같은 기준). */
  wordLevels?: VocabWordLevel[];
  createdAt: string;
};

/**
 * 어휘 선택 낱말 수준.
 * 선생님 말(2026-10-20): "지금 단어 구분할 때 어휘가 너무 어려워. 일반 / 난이도 UP으로 하자.
 * 단어 수준을 가지고." 그래서 수준은 우리 EngCore 단어장 레벨로 잰다.
 *  - normal(일반): 지문 낱말은 고교기본까지, 바꾼 낱말은 중학고난도까지만 쓴다.
 *  - hard(난이도 UP): 수준을 막지 않고, 단어장 레벨이 높은 자리를 앞세운다(예전 방식).
 */
export type VocabWordLevel = "normal" | "hard";
const NORMAL_TARGET_MAX_LEVEL = 7; // EngCore 고교기본
const NORMAL_WRONG_MAX_LEVEL = 6; // EngCore 중학고난도

type Sentence = { id: string; english: string };

export type VocabHint = { word: string; meaningKo?: string; antonyms?: string[] };

export function vocabChoiceSourceHash(sentences: Sentence[]): string {
  const joined = sentences.map((s) => formatWorkbookPassage(s.english).toLowerCase()).join("\n");
  return createHash("sha256").update(joined).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------- 위치 찾기

const WORD_CHAR = /[A-Za-z0-9'’-]/;

/** 원문(sourcePassage)에서 문장마다 시작·끝 위치. 문장은 순서대로 이어 붙어 있다. */
function locateSentences(passage: string, sentences: Sentence[]) {
  const spans = new Map<string, { start: number; end: number }>();
  let cursor = 0;
  for (const s of sentences) {
    const text = formatWorkbookPassage(s.english);
    if (!text) continue;
    let at = passage.indexOf(text, cursor);
    if (at < 0) {
      // 줄 끝 하이픈 이음 등으로 모양이 조금 달라진 문장: 앞 20자로 찾는다.
      at = passage.indexOf(text.slice(0, 20), cursor);
      if (at < 0) continue;
    }
    const end = Math.min(passage.length, at + text.length);
    spans.set(s.id, { start: at, end });
    cursor = end;
  }
  return spans;
}

/** 범위 안에서 낱말 경계에 맞는 n번째 targetText 위치. */
function findWord(
  passage: string,
  target: string,
  from: number,
  to: number,
  occurrence: number
): number {
  let seen = 0;
  let at = passage.indexOf(target, from);
  while (at >= 0 && at + target.length <= to) {
    const before = at > 0 ? passage[at - 1]! : " ";
    const after = passage[at + target.length] ?? " ";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
      seen += 1;
      if (seen === Math.max(1, occurrence)) return at;
    }
    at = passage.indexOf(target, at + 1);
  }
  return -1;
}

// ---------------------------------------------------------------- 규칙 검사

const FUNCTION_WORDS = new Set(
  (
    "a an the this that these those it its they them their he him his she her we us our you your i me my " +
    "and or but so because although though if when while as than then " +
    "in on at to of for with by from into onto about over under between among through during without within " +
    "is are was were be been being am do does did have has had can could will would shall should may might must " +
    "not no yes very too also just only even still"
  ).split(" ")
);

const PARTICLES = new Set("up down out off away back around along over in on".split(" "));

/** 자리에 든 낱말들 가운데 가장 높은 단어장 레벨. 단어장에 없는 낱말이 있으면 null. */
function phraseLevel(text: string): number | null {
  let max = 0;
  for (const w of words(text)) {
    // 구동사의 부사(jumps out, turns down)는 따로 재지 않는다.
    if (FUNCTION_WORDS.has(w.toLowerCase()) || PARTICLES.has(w.toLowerCase())) continue;
    const lv = engcoreWordLevel(w);
    if (lv === null) return null;
    max = Math.max(max, lv);
  }
  return max;
}

/** 틀린 낱말이 이 수준에 맞는지(선생님이 문항을 직접 더할 때 추천을 거른다). 자리는 선생님이 골랐으니 보지 않는다. */
export function wrongFitsWordLevel(wrong: string, level: VocabWordLevel): boolean {
  if (level === "hard") return true;
  const w = phraseLevel(wrong);
  return w !== null && w <= NORMAL_WRONG_MAX_LEVEL;
}

function fitsWordLevel(p: { targetText: string; wrongText: string }, level: VocabWordLevel): boolean {
  if (level === "hard") return true;
  const t = phraseLevel(p.targetText);
  const w = phraseLevel(p.wrongText);
  return t !== null && t <= NORMAL_TARGET_MAX_LEVEL && w !== null && w <= NORMAL_WRONG_MAX_LEVEL;
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function lastWord(text: string): string {
  const w = words(text);
  return (w[w.length - 1] ?? "").toLowerCase();
}

/** 끝 어형이 맞는지 대강 본다(-ing, -ed, -ly, -s). 문법만으로 답이 드러나지 않게 한다. */
function inflectionMatches(target: string, wrong: string): boolean {
  const t = lastWord(target);
  const w = lastWord(wrong);
  if (t.endsWith("ing") !== w.endsWith("ing")) return false;
  if (t.endsWith("ly") !== w.endsWith("ly")) return false;
  // -ed는 불규칙 과거형이 있어 한쪽만 -ed여도 허용하되, 한쪽이 -ing면 위에서 걸린다.
  return true;
}

const VOWEL_SOUND = /^(?:[aeio]|u(?!ni|se|su|ro|ti)|hour|honest|heir)/i;

/** 바로 앞 낱말이 a/an이면 틀린 낱말도 그 관사와 맞아야 한다. */
function articleMatches(passage: string, start: number, wrong: string): boolean {
  const before = passage.slice(Math.max(0, start - 4), start).toLowerCase();
  const m = before.match(/\b(a|an)\s$/);
  if (!m) return true;
  const vowel = VOWEL_SOUND.test(wrong.trim());
  return m[1] === "an" ? vowel : !vowel;
}

function matchLeadingCase(text: string, like: string): string {
  const a = text.charAt(0);
  const b = like.charAt(0);
  if (!a || !b) return text;
  if (b !== b.toLowerCase()) return a.toUpperCase() + text.slice(1);
  if (b !== b.toUpperCase()) return a.toLowerCase() + text.slice(1);
  return text;
}

type Located = StoredVocabChoicePair & { start: number; end: number; shownWrong: string };

function checkPair(
  passage: string,
  spans: Map<string, { start: number; end: number }>,
  pair: StoredVocabChoicePair
): { ok: true; located: Located } | { ok: false; reason: string } {
  const target = pair.targetText.trim();
  const wrong = pair.wrongText.trim();
  if (!target || !wrong) return { ok: false, reason: "빈 값" };
  if (words(target).length > 3 || words(wrong).length > 3) return { ok: false, reason: "너무 긴 자리" };
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(wrong)) return { ok: false, reason: "영어 낱말이 아님" };
  if (target.toLowerCase() === wrong.toLowerCase()) return { ok: false, reason: "같은 낱말" };
  if (words(target).every((w) => FUNCTION_WORDS.has(w.toLowerCase()))) {
    return { ok: false, reason: "기능어 자리" };
  }
  const span = spans.get(pair.sentenceId);
  if (!span) return { ok: false, reason: "문장 없음" };
  const start = findWord(passage, target, span.start, span.end, pair.occurrence);
  if (start < 0) return { ok: false, reason: "원문에 없는 자리" };
  // 문장 첫머리가 아닌데 대문자면 고유명사일 가능성이 크다.
  if (start > span.start && /^[A-Z]/.test(target)) return { ok: false, reason: "고유명사" };
  if (!inflectionMatches(target, wrong)) return { ok: false, reason: "어형 불일치" };
  if (!articleMatches(passage, start, wrong)) return { ok: false, reason: "관사 불일치" };
  if (isDerivedFromCorrect(target, wrong)) return { ok: false, reason: "파생형(없는 낱말 위험)" };
  // 같은 어근(increase / increasing)은 어휘가 아니라 어형 문제다.
  const stem = (w: string) => w.toLowerCase().replace(/(ing|ed|es|s|ly)$/, "").slice(0, 5);
  if (stem(lastWord(target)) === stem(lastWord(wrong))) return { ok: false, reason: "같은 어근" };
  return {
    ok: true,
    located: {
      ...pair,
      targetText: target,
      wrongText: wrong,
      start,
      end: start + target.length,
      shownWrong: matchLeadingCase(wrong, target),
    },
  };
}

// ---------------------------------------------------------------- 모델 호출

const GENERATOR_SYSTEM = `당신은 대한민국 고등학교 영어 내신·수능 어휘 문항 출제자이다.
주어진 지문에서 "문맥상 낱말의 쓰임"을 묻는 자리(수능 30번형, 어휘 선택 [A/B])를 고르고, 자리마다 문맥상 틀린 낱말 하나를 만든다.

# 자리(targetText)
- 글의 논리·주제를 떠받치는 내용어(명사·동사·형용사·부사) 한 낱말. 구동사 등은 두 낱말까지.
- 반대말이 뚜렷한 낱말을 먼저 고른다(safe↔dead, destroyed↔restored, dropping↔rising처럼). 이런 자리는 지문 내용만 보면 답이 하나로 정해지므로 많을수록 좋다.
- 고유명사, 숫자, 기능어(관사·대명사·전치사·접속사·조동사·be동사)는 고르지 않는다.
- 문장 하나에 최대 3곳까지 골라도 된다(한 문장에 물을 만한 낱말이 여럿이면 여럿 고른다). 여러 문장에 고르게 퍼뜨린다.
- hints의 낱말(핵심 어휘)을 우선 고려하되, 문맥 판단 가치가 없으면 쓰지 않아도 된다.
- targetText는 문장에 적힌 그대로(대소문자·어형 포함) 복사한다. 같은 문장에 여러 번 나오면 occurrence로 몇 번째(1부터)인지 적는다.

# 틀린 낱말(wrongText)
- 원래 낱말과 품사·어형(시제, 수, 비교급, -ing/-ed/-ly)이 같아 문법만으로는 가려지지 않아야 한다.
- 지문 전체를 읽으면 원래 낱말만 맞고, 틀린 낱말은 글의 논리와 확실히 모순되어야 한다.
  대표적으로 반의어나 논리를 뒤집는 말(increase↔decrease, accept↔reject, rare↔common, benefit↔harm).
- 금지: 동의어·유사어, 넣어도 해석에 따라 말이 되는 낱말, 철자만 비슷한 혼동어, 실재하지 않는 낱말.
- 바로 앞에 a/an이 있으면 그 관사와 맞는 낱말을 쓴다. 문장 첫 낱말이면 첫 글자를 대문자로 쓴다.

# 낱말 수준(wordLevel)
- "normal": 중학생~고1이 아는 쉬운 낱말로 묻는다. 자리는 쉬운 내용어(교과서 기본 어휘)를 고르고, 어려운 낱말 자리는 고르지 않는다.
  틀린 낱말은 중학 필수 수준의 쉬운 반대말로 쓴다(increase↔decrease, safe↔dangerous, easy↔difficult). 문장마다 쉬운 자리를 빠짐없이 찾는다.
- "hard": 고2~수능 수준 낱말도 쓴다. 어려운 내용어 자리를 앞세우고, 틀린 낱말도 그 수준에 맞춘다.

# 개수
- 후보를 넉넉히 만든다: 문장마다 물을 만한 자리가 있으면 모두 낸다(문장당 최대 3곳). 검수에서 절반쯤 빠지므로, 최종에 필요한 수의 두 배를 낸다고 생각하고 아끼지 않는다.
- meaningKo: 이 문맥에서 원래 낱말의 뜻(짧은 한국어).
- relation: "antonym"(반의어) | "reversal"(논리를 뒤집는 말) | "other".
- learningValue: 1~5, 이 자리를 묻는 학습 가치.
- alreadyUsedTargets가 오면 그 낱말들은 빼고 다른 자리를 고른다(같은 자리를 다시 내지 않는다).`;

const GENERATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sentenceId",
          "targetText",
          "occurrence",
          "wrongText",
          "meaningKo",
          "relation",
          "learningValue",
        ],
        properties: {
          sentenceId: { type: "string" },
          targetText: { type: "string" },
          occurrence: { type: "integer" },
          wrongText: { type: "string" },
          meaningKo: { type: "string" },
          relation: { type: "string", enum: ["antonym", "reversal", "other"] },
          learningValue: { type: "integer" },
        },
      },
    },
  },
} as const;

const AUDITOR_SYSTEM = `당신은 영어 어휘 문항 검수자이다. 각 항목은 지문의 한 자리에 [원래 낱말 / 바꾼 낱말]을 두는 어휘 문항 후보다.

판정 기준은 "지문에 적힌 내용"이다. 이 글 밖에서 상상할 수 있는 다른 상황은 근거가 되지 않는다.
예: 글이 밤이 되며 기온이 떨어졌다고 적었으면, dropping을 rising으로 바꾼 자리는 지문과 어긋나므로 keep이다.
"다른 이야기라면 기온이 오를 수도 있다"는 이유로 reject 하지 않는다.

아래를 모두 만족하면 keep, 하나라도 어긋나면 reject 한다.
1) 원래 낱말(original)은 그 자리에서 지문의 흐름에 맞다.
2) 바꾼 낱말(replacement)을 넣으면 지문이 말한 사실·인과·대조와 어긋난다(앞뒤 문장을 근거로 댈 수 있어야 한다).
3) 바꾼 낱말은 실재하는 영어 낱말이고, 그 자리에서 문법적으로 성립한다(품사·어형·관사·수·전치사 결합). 문법이나 연어만으로 답이 드러나면 reject.
4) 고등학생이 지문을 읽고 판단할 수 있는 낱말이다.

reject 해야 하는 대표적인 경우:
- 동의어·유사어라 둘 다 뜻이 통한다.
- 지문 어디를 봐도 둘 중 하나로 정할 근거가 없다.
- 바꾼 낱말이 그 자리에서 영어로 어색해(연어·전치사 결합) 뜻을 따지기 전에 걸러진다.
reason은 한국어로 짧게 쓴다. keep이면 지문의 어느 대목이 근거인지 한 구절로 적는다.`;

const AUDITOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "reason"],
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["keep", "reject"] },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function generatePairs(input: {
  apiKey: string;
  title: string;
  sentences: Sentence[];
  hints: VocabHint[];
  /** 이미 뽑은 자리(같은 낱말을 또 내지 않게) */
  avoidTargets?: string[];
  wordLevel: VocabWordLevel;
}): Promise<StoredVocabChoicePair[]> {
  const called = await callGrammarChoiceV2Json({
    stage: "GENERATOR",
    apiKey: input.apiKey,
    model: resolveV2AnalyzerModel(),
    // 생성은 넉넉히 만들고 검수가 거르므로 추론을 쓰지 않는다(어법 선택 분석 단계와 같다).
    // 지연은 출력 토큰에 비례해, low에서 지문당 50~60초가 걸렸다.
    reasoningEffort: "none",
    system: GENERATOR_SYSTEM,
    user: JSON.stringify({
      title: input.title,
      sentences: input.sentences.map((s) => ({ sentenceId: s.id, text: formatWorkbookPassage(s.english) })),
      hints: input.hints.slice(0, 24),
      wordLevel: input.wordLevel,
      ...(input.avoidTargets?.length ? { alreadyUsedTargets: input.avoidTargets.slice(0, 40) } : {}),
    }),
    schemaName: "vocab_choice_generate",
    schema: GENERATOR_SCHEMA as unknown as Record<string, unknown>,
    maxCompletionTokens: 8_000,
    // 지문 전체를 한 번에 만들어 정상 응답이 15~25초다. 어법 문턱(20초)을 쓰면 복제 요청이 자주 붙는다.
    // 끊은 요청도 값은 다 나가므로 정말 멈춘 호출에만 복제한다(90초 + 복제 약 25초 + 검수 상한 120초 < 300초).
    hedgeAfterMs: 90_000,
  });
  const parsed = parse<{ items?: Array<Partial<StoredVocabChoicePair>> }>(called.content);
  return (parsed?.items ?? []).map((it) => ({
    sentenceId: String(it.sentenceId ?? ""),
    occurrence: Math.max(1, Math.floor(Number(it.occurrence) || 1)),
    targetText: String(it.targetText ?? ""),
    wrongText: String(it.wrongText ?? ""),
    meaningKo: String(it.meaningKo ?? "").trim(),
    relation: String(it.relation ?? "other"),
    learningValue: Math.min(5, Math.max(1, Math.floor(Number(it.learningValue) || 3))),
  }));
}

async function auditPairs(input: {
  apiKey: string;
  passage: string;
  spans: Map<string, { start: number; end: number }>;
  pairs: Located[];
}): Promise<Located[]> {
  if (input.pairs.length === 0) return [];
  const called = await callGrammarChoiceV2Json({
    stage: "REVIEWER",
    apiKey: input.apiKey,
    /*
     * 검수는 terra(2026-11-10). 8지문 나란히: sol 검수 100문항·지문당 147원 → terra 검수 100문항·89원.
     * 통과한 문항을 직접 풀어 보니 같은 수준(같은 흠이 둘 다 나옴). 어휘 검수는 「반대말이 문맥에서 틀린가」만
     * 보는 판정이라 싼 모델로 충분하다. 어법 검수(둘 다 맞는 문법 가려내기)는 sol 그대로.
     */
    model: process.env.OPENAI_VOCAB_AUDITOR_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: "medium",
    system: AUDITOR_SYSTEM,
    user: JSON.stringify({
      passage: input.passage,
      items: input.pairs.map((p, i) => {
        const span = input.spans.get(p.sentenceId);
        return {
          id: String(i),
          sentence: span ? input.passage.slice(span.start, span.end) : "",
          original: p.targetText,
          replacement: p.shownWrong,
        };
      }),
    }),
    schemaName: "vocab_choice_audit",
    schema: AUDITOR_SCHEMA as unknown as Record<string, unknown>,
    maxCompletionTokens: 4_000,
    // 10여 개를 한 번에 판정해 어법 판정(3문항)보다 길다. 어법용 12초 복제·35초 상한을 쓰지 않는다.
    // 복제는 값이 두 배라 늦게 붙이되, 상한(120초) 안에 복제가 끝날 자리는 남긴다.
    hedgeAfterMs: 60_000,
    deadlineMs: 120_000,
  });
  const parsed = parse<{ results?: Array<{ id?: string; verdict?: string; reason?: string }> }>(called.content);
  const keep = new Set(
    (parsed?.results ?? []).filter((r) => r.verdict === "keep").map((r) => String(r.id))
  );
  if (process.env.VOCAB_AUDIT_LOG === "1") {
    for (const r of parsed?.results ?? []) {
      if (r.verdict === "keep") continue;
      const it = input.pairs[Number(r.id)];
      if (it) console.log(`  버림: ${it.targetText} → ${it.shownWrong} | ${r.reason ?? ""}`);
    }
  }
  return input.pairs.filter((_, i) => keep.has(String(i)));
}

// ---------------------------------------------------------------- 선정·조립

/**
 * 문장당 상한 안에서, 서로 붙지 않게 고른다.
 * 선생님 기준(2026-09-20): "반의어만 존재하면 여기저기 만들어도 된다." 그래서 반대말이
 * 뚜렷한 자리(antonym·reversal)를 앞세우고, 그 다음 학습 가치 순으로 고른다.
 */
function selectFinal(pairs: Located[], level: VocabWordLevel): Located[] {
  const rank = (r: string) => (r === "antonym" ? 0 : r === "reversal" ? 1 : 2);
  // 난이도 UP은 같은 짝 종류 안에서 단어장 레벨이 높은(단어장 밖 포함) 자리를 먼저 고른다.
  const hardness = (p: Located) => (level === "hard" ? (phraseLevel(p.targetText) ?? 10) : 0);
  const ordered = [...pairs]
    .filter((p) => fitsWordLevel(p, level))
    .sort(
      (a, b) =>
        rank(a.relation) - rank(b.relation) ||
        hardness(b) - hardness(a) ||
        b.learningValue - a.learningValue
    );
  const chosen: Located[] = [];
  const perSentence = new Map<string, number>();
  const usedTargets = new Set<string>();
  for (const p of ordered) {
    if (chosen.length >= MAX_FINAL_ITEMS) break;
    if ((perSentence.get(p.sentenceId) ?? 0) >= MAX_PER_SENTENCE) continue;
    if (usedTargets.has(p.targetText.toLowerCase())) continue;
    if (chosen.some((c) => p.start < c.end + 3 && c.start < p.end + 3)) continue;
    /*
     * 같은 문장에서 정답·오답을 맞바꾼 짝은 하나만(2026-11-10 시험): 「offers many [advantages], there are also
     * some [disadvantages]」를 둘 다 내면 둘 다 반대로 골라도 문장이 선다 — 짝으로 보면 답이 둘이다.
     */
    const lower = (s: string) => s.trim().toLowerCase();
    if (
      chosen.some(
        (c) =>
          c.sentenceId === p.sentenceId &&
          (lower(c.wrongText) === lower(p.targetText) || lower(c.targetText) === lower(p.wrongText))
      )
    )
      continue;
    chosen.push(p);
    perSentence.set(p.sentenceId, (perSentence.get(p.sentenceId) ?? 0) + 1);
    usedTargets.add(p.targetText.toLowerCase());
  }
  return chosen.sort((a, b) => a.start - b.start);
}

function hashIndex(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildSection(input: {
  projectId: string;
  title: string;
  source: string | null;
  passage: string;
  pairs: Located[];
}): WorkbookVocabChoiceSection | null {
  if (input.pairs.length === 0) return null;
  const items: WorkbookVocabChoiceItem[] = input.pairs.map((p, i) => {
    // 맞는 낱말이 늘 왼쪽이면 답이 보이므로 자리마다 고정된 방식으로 섞는다.
    const correctSide = hashIndex(`${input.projectId}|${p.sentenceId}|${p.targetText}`) % 2 === 0 ? "left" : "right";
    return {
      number: i + 1,
      choiceId: `${p.sentenceId}:${p.start}`,
      sentenceId: p.sentenceId,
      startCharIndex: p.start,
      endCharIndex: p.end,
      correctText: p.targetText,
      incorrectText: p.shownWrong,
      leftText: correctSide === "left" ? p.targetText : p.shownWrong,
      rightText: correctSide === "left" ? p.shownWrong : p.targetText,
      correctSide,
      meaningKo: p.meaningKo,
      relation: p.relation,
      learningValue: p.learningValue,
      grammarCategoryId: `vocab:${p.relation}:${p.targetText.toLowerCase()}`,
    };
  });
  const segments: GrammarChoiceRenderSegment[] = [];
  let cursor = 0;
  for (const it of items) {
    if (cursor < it.startCharIndex) {
      segments.push({ type: "text", text: input.passage.slice(cursor, it.startCharIndex) });
    }
    segments.push({ type: "choice", number: it.number, leftText: it.leftText, rightText: it.rightText });
    cursor = it.endCharIndex;
  }
  if (cursor < input.passage.length) segments.push({ type: "text", text: input.passage.slice(cursor) });
  return {
    projectId: input.projectId,
    title: input.title,
    source: input.source,
    sourcePassage: input.passage,
    segments,
    items,
    algorithmVersion: VOCAB_CHOICE_ALGORITHM_VERSION,
  };
}

/**
 * 지문 하나의 어휘 선택을 만든다. 저장된 쌍이 지문과 맞으면 모델을 부르지 않는다.
 * cacheToSave가 있으면 호출한 쪽이 lesson_pack_json에 저장한다.
 */
export async function generateVocabChoiceForPassage(input: {
  projectId: string;
  title: string;
  source: string | null;
  sentences: Sentence[];
  hints: VocabHint[];
  cache: StoredVocabChoiceCache | null;
  forceRegenerate?: boolean;
  /** 없으면 hard(예전 방식). 워크북은 일반이 기본이다. */
  wordLevel?: VocabWordLevel;
  /** 저장된 짝으로만 다시 고른다(모델을 부르지 않는다). 만든 워크북의 수준을 바꿀 때 쓴다. */
  cacheOnly?: boolean;
}): Promise<{
  section: WorkbookVocabChoiceSection | null;
  cacheToSave: StoredVocabChoiceCache | null;
  reason?: string;
  /** 모델 후보 → 자리 확인 → 검수 → 최종, 단계별 개수 */
  funnel?: { raw: number; located: number; audited: number; final: number };
}> {
  const sentences = input.sentences.filter((s) => s.english.trim());
  const passage = joinWorkbookPassageLines(sentences.map((s) => s.english));
  if (!passage) return { section: null, cacheToSave: null, reason: "영어 지문이 없습니다." };
  const spans = locateSentences(passage, sentences);
  const sourceHash = vocabChoiceSourceHash(sentences);

  const level: VocabWordLevel = input.wordLevel ?? "hard";
  const target = Math.min(MAX_FINAL_ITEMS, Math.max(8, Math.round(sentences.length * 1.2)));
  const sameSource =
    !!input.cache &&
    input.cache.sourceHash === sourceHash &&
    input.cache.algorithmVersion === VOCAB_CHOICE_ALGORITHM_VERSION;
  const cachedLocated = sameSource
    ? input.cache!.pairs.map((p) => checkPair(passage, spans, p)).flatMap((r) => (r.ok ? [r.located] : []))
    : [];
  /*
   * 저장된 쌍을 그대로 쓰는 경우: 이 수준으로 만든 적이 있거나, 다른 수준으로 만든 쌍 가운데
   * 이 수준에 맞는 것만으로도 충분할 때. 일반·난이도 UP을 오가도 매번 새로 만들지 않는다.
   */
  const cachedLevels: VocabWordLevel[] = input.cache?.wordLevels ?? ["hard"];
  const enoughFromCache =
    cachedLocated.filter((p) => fitsWordLevel(p, level)).length >= Math.ceil(target * 0.7);
  if (!input.forceRegenerate && sameSource && (cachedLevels.includes(level) || enoughFromCache)) {
    const section = buildSection({ ...input, passage, pairs: selectFinal(cachedLocated, level) });
    return { section, cacheToSave: null, reason: section ? undefined : "어휘 문항 자리가 없습니다." };
  }
  if (input.cacheOnly) {
    // 이 수준에 맞는 저장된 짝이 모자라도 있는 만큼으로 만든다. 하나도 없으면 바꾸지 않는다.
    const section = sameSource ? buildSection({ ...input, passage, pairs: selectFinal(cachedLocated, level) }) : null;
    return { section, cacheToSave: null, reason: section ? undefined : "이 수준에 맞는 저장된 어휘 짝이 없습니다." };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");

  const raw = await generatePairs({ apiKey, title: input.title, sentences, hints: input.hints, wordLevel: level });
  const located: Located[] = [];
  for (const pair of raw) {
    const r = checkPair(passage, spans, pair);
    // 수준에 안 맞는 쌍은 검수에 보내지 않는다(검수 값을 아낀다).
    if (r.ok && fitsWordLevel(r.located, level) && !located.some((l) => l.start === r.located.start)) {
      located.push(r.located);
    }
  }
  let kept = await auditPairs({ apiKey, passage, spans, pairs: located });

  /*
   * 검수를 통과하는 비율이 절반쯤이라 긴 지문에서도 대여섯 개에 그쳤다(선생님 지적 2026-09-20).
   * 검수 기준은 그대로 두고 — 어색한 문항이 들어가면 안 되므로 — 모자랄 때만 다른 자리로
   * 한 번 더 뽑아 같은 검수를 다시 받는다.
   */
  if (kept.length < target) {
    const used = located.map((l) => l.targetText);
    const more = await generatePairs({
      apiKey,
      title: input.title,
      sentences,
      hints: input.hints,
      avoidTargets: used,
      wordLevel: level,
    });
    const moreLocated: Located[] = [];
    for (const pair of more) {
      const r = checkPair(passage, spans, pair);
      if (!r.ok || !fitsWordLevel(r.located, level)) continue;
      if (located.some((l) => l.start === r.located.start) || moreLocated.some((l) => l.start === r.located.start)) continue;
      moreLocated.push(r.located);
    }
    if (moreLocated.length > 0) {
      const extra = await auditPairs({ apiKey, passage, spans, pairs: moreLocated });
      kept = [...kept, ...extra];
    }
  }
  // 다른 수준으로 만들어 둔 쌍도 남긴다(수준을 다시 바꿀 때 새로 만들지 않게).
  const strip = ({ start: _s, end: _e, shownWrong: _w, ...pair }: Located): StoredVocabChoicePair => pair;
  const keyOf = (p: StoredVocabChoicePair) => `${p.sentenceId}|${p.occurrence}|${p.targetText}|${p.wrongText}`;
  const newPairs = kept.map(strip);
  const newKeys = new Set(newPairs.map(keyOf));
  const keepOld = sameSource && !input.forceRegenerate;
  const oldLocated = keepOld ? cachedLocated.filter((c) => !newKeys.has(keyOf(strip(c)))) : [];
  const cacheToSave: StoredVocabChoiceCache = {
    sourceHash,
    algorithmVersion: VOCAB_CHOICE_ALGORITHM_VERSION,
    pairs: [...newPairs, ...oldLocated.map(strip)],
    wordLevels: [...new Set([...(keepOld ? cachedLevels : []), level])],
    createdAt: new Date().toISOString(),
  };
  const final = selectFinal([...kept, ...oldLocated], level);
  const section = buildSection({ ...input, passage, pairs: final });
  return {
    section,
    cacheToSave,
    reason: section ? undefined : "검수를 통과한 어휘 문항이 없습니다.",
    funnel: { raw: raw.length, located: located.length, audited: kept.length, final: final.length },
  };
}
