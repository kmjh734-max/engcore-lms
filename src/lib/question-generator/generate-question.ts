import { engcoreLevelOf } from "@/lib/vocab/engcore-lemma";
import { isFunctionWord } from "@/lib/vocab/function-words";
import { renumberMarksInOrder } from "@/lib/question-generator/renumber-marks";
import { difficultyRule, targetLevelFromOverall, type TargetLevel } from "@/lib/question-generator/difficulty";
import { splitSummaryAnswer, summaryBlankFitProblem } from "@/lib/question-generator/summary-blank-fit";
import { fixNonVerbBankForms } from "@/lib/question-generator/verb-forms";
import {
  balancedGistRule,
  choiceCraftCommonRules,
  choiceExplanationRules,
  contentFalseChoiceCraft,
  factChoiceCraft,
  factExplanationRules,
  grammarChoiceCraftNote,
  impliedMeaningChoiceCraft,
  insertionChoiceCraft,
  irrelevantChoiceCraft,
  summaryChoiceCraft,
  titleChoiceCraft,
  topicChoiceCraft,
  vocabChoiceCraft,
} from "@/lib/question-generator/choice-craft";
import {
  grammarCatalogPromptBlock,
  grammarExplanationRules,
  pickGrammarFocus,
} from "@/lib/question-generator/grammar-catalog";
import { primeQuestionGeneratorCache, questionGeneratorChatJsonWithRetry } from "@/lib/question-generator/openai";
import { relabelOrderQuestion } from "@/lib/question-generator/order-relabel";
import { findAingkaOption } from "@/lib/question-generator/question-types";
import {
  cleanQuestionText,
  countEnglishSentences,
  countEnglishWords,
  ENGLISH_SENTENCE_GAP,
  passageHasConsecutiveWords,
  parseSummaryTableBlocks,
  parseSummaryWritingBlocks,
  parseWordOrderBlocks,
} from "@/lib/question-generator/text-utils";
import { MIN_SENTENCES_FOR_INSERTION_IRRELEVANT } from "@/lib/question-generator/constants";
import {
  CHART_UNFIT_TYPES,
  cleanSourcePassage,
  isChartDescriptionPassage,
} from "@/lib/question-generator/passage-clean";
import {
  questionNeedsVocabGloss,
  normalizeHardWordsFromRaw,
} from "@/lib/question-generator/exam-vocab";
import {
  plannedAnswerNumber,
  plannedWrongCount,
  wrongSpotLabel,
} from "@/lib/question-generator/item-variety";
import type { QuestionTypeOption } from "@/lib/question-generator/types";
import type {
  GeneratedQuestionPayload,
  PassageAnalysis,
} from "@/lib/question-generator/types";
import {
  pickWordOrderFocus,
  wordOrderCatalogBrief,
  type WordOrderMode,
} from "@/lib/question-generator/word-order-catalog";
import {
  alignInflectBankToExplanation,
  lemmaEnglishToken,
  normalizeWordOrderQuestionText,
  restoreLeadingProperNoun,
  splitWordBank,
} from "@/lib/question-generator/word-order-normalize";
import {
  reconcileGrammarFixQuestion,
  parseGrammarFixAnswer,
  widenUnderlineToWrongText,
} from "@/lib/question-generator/grammar-fix-normalize";
import { agreementBreakAfterFix } from "@/lib/question-generator/agreement-check";
import { falseGrammarError } from "@/lib/question-generator/grammar-false-error";
import { validateVocabularyConsistency } from "@/lib/question-generator/vocabulary-consistency";
import { plainKorean } from "@/lib/question-generator/plain-korean";
import {
  bankWordsLeftInBlankLine,
  widenBlankToSentence,
  closeBlankSentence,
  lowercaseAnswerAfterMidBlank,
  moveSpeakerLabelOutOfBlank,
} from "@/lib/question-generator/blank-line-overlap";
import {
  findWritingGrammar,
  objectParticle,
  WRITING_GRAMMAR_LIST,
  WRITING_GRAMMARS,
  type WritingGrammar,
} from "@/lib/question-generator/writing-grammar";
import {
  buildWordBankFromAnswer,
  joinWordBank,
  normalizeAndShuffleWordBank,
  shuffleWordBankKeepForms,
  tokenizeAnswerPhrase,
} from "@/lib/question-generator/word-order-normalize";

/** 함축의미 등 — 적합한 소재가 없으면 문항 생략 */
export class SkipQuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipQuestionError";
  }
}

/** 제목·주제·요지·일치/불일치/일치개수: 본문 표현을 그대로 베끼지 말고 paraphrase */
/*
 * 보기 낱말 수준을 난이도(상·하)에 맞춘다. 선생님과 함께 재 보니(2026-10-04) 상·하의 보기 낱말 수준이
 * 같았고 하가 오히려 어려웠다 — 「하」 내용일치에 customary·adverse, 주제에 frigid, 제목에 catalyst.
 * 바꿔 쓰기 지시가 난이도와 상관없이 「유의어로 많이, 더 어려운 대체어를」이라 시켰기 때문이다.
 *   하: 중3~고1 교과서 수준 기본 어휘. 본문의 쉬운 낱말은 그대로 써도 된다.
 *   중: 고1~고2 수준. 흔한 낱말로 바꿔 쓴다.
 *   상: 수능 수준 어휘까지. 자연스러운 말만(희귀어·고어·전문어 금지).
 */
function vocabularyLevelRule(difficulty: string | null | undefined): string {
  if (difficulty === "low") {
    return "VOCABULARY 하: use basic words a 중3~고1 student knows from textbooks (the common core of English plus words that appear in the passage). Easy passage words may be reused as they are — never swap an easy word for a rarer synonym (not customary, frigid, adverse, catalyst, assortment).";
  }
  if (difficulty === "high") {
    return "VOCABULARY 상: use words from a Korean high-school 고교필수~수능필수 wordbook (e.g. undermine, inherent, sustain, adverse, consequence). Do NOT go beyond that: no GRE-style or specialist words that are not in the passage (not rapport, affinity, vulnerability, receptivity, necessitate, substantive, remnants, toil, arable, acreage, autobiographical). Difficulty comes from subtle meaning, not rare words.";
  }
  return "VOCABULARY 중: 고1~고2 level; paraphrase with common words, not rare synonyms.";
}

function paraphraseChoiceRules(
  lang: "english" | "korean" | null | undefined,
  difficulty?: string | null
): string {
  const easy = difficulty === "low";
  const langHint =
    lang === "korean"
      ? "Korean choices: translate the idea, then reword — never paste English phrases from the passage."
      : lang === "english"
        ? easy
          ? "English choices: reword sentence structure; reusing single easy passage words is fine, but do not lift long chunks."
          : "English choices: synonym/rephrase heavily; do not lift consecutive content words from the passage."
        : "Reword ideas; do not copy passage wording.";
  return `PARAPHRASE (필수 · 학력평가형 · 어휘 다양성):
- Every choice/statement must paraphrase key content words (synonyms, different structure, reworded meaning).
- Ban copying distinctive multi-word chunks or long phrases from the passage.
- Correct items: same meaning via paraphrase; distractors: plausible but wrong via subtle meaning shifts.
- ${easy ? "Paraphrase with COMMON words; the test is understanding the passage, not knowing rare synonyms." : "Prefer vocabulary that tests understanding of paraphrased wording (동의어·유의어·우회 표현 많이)."}
- Same passage → many items: DO NOT recycle the same 5–8 theme words across items. Rotate synonym sets (e.g. progress↔advance/improvement)${easy ? "" : "; at 상 prefer the harder of two natural alternates"}. Use antonyms mainly inside distractors (미세한 의미 반전).
- ${vocabularyLevelRule(difficulty)}
- ${langHint}`;
}

/*
 * 내용일치·불일치의 말 바꾸기(2026-10-04). 「동의어로 많이, 세트를 돌려 가며」는 이 유형에서
 * 돌려 말하기·정도 바뀜·막연한 말을 낳았다. 사실은 그대로 두고 구조만 바꾸게 한다.
 */
function factWordingRule(lang: "english" | "korean" | null | undefined, difficulty?: string | null): string {
  return `WORDING (사실 보기):
- Reword sentence structure naturally so the item tests understanding, not word matching — but keep the passage's names, numbers, units and key nouns as they are. Do not hunt for synonyms or rotate synonym sets; do not lift long chunks either.
- ${vocabularyLevelRule(difficulty)}
- ${lang === "korean" ? "Korean choices: translate each fact faithfully into natural Korean (no English phrases)." : "English choices: plain exam English."}
- Keep the passage's hedges: if the passage says think/believe/may/can/might/seem (「~라고 생각할 수 있다」「~일 수 있다」), the choice keeps them — dropping them turns an opinion or possibility into a flat fact and can flip true/false (× 「A라고 생각할 수 있다」 → 「A이다」).`;
}

/**
 * 조건 영작에 쓸 어법 범위. 목록은 writing-grammar.ts에 따로 둔다
 * (고르기 문항용 목록을 그대로 쓰면 「등위 병렬을 사용할 것」 같은 조건이 나온다).
 * 지문에 실제로 있는 어법만 고르게 하므로, 무작위여도 지문과 겉돌지 않는다.
 */
const GRAMMAR_FOR_WRITING = WRITING_GRAMMAR_LIST;

/** aren't → are not, doesn't → does not, can't → cannot, won't → will not (보기에서 not이 사라지지 않게) */
function expandNegativeContractions(text: string): string {
  // 의문문은 풀면 어색하다(Won't you? → Will not you?)
  if (/\?\s*$/.test(text)) return text;
  return text.replace(/\b([A-Za-z]+)n[’']t\b/g, (whole: string, base: string) => {
    const lower = base.toLowerCase();
    if (lower === "ca") return base[0] === "C" ? "Cannot" : "cannot";
    if (lower === "wo") return base[0] === "W" ? "Will not" : "will not";
    if (lower === "sha") return base[0] === "S" ? "Shall not" : "shall not";
    return `${base} not`;
  });
}

/** questionText의 <보기> 줄에 fixNonVerbBankForms를 적용한다(제시어 배열 어형변화) */
function fixNonVerbBankLine(questionText: string, answerTokens: string[], explanation: string): string {
  const m = questionText.match(/(<보기>\s*\n)([^\n]+)/);
  if (!m) return questionText;
  const fixed = fixNonVerbBankForms(splitWordBank(m[2]!), answerTokens, explanation);
  return fixed ? questionText.replace(m[0], `${m[1]}${joinWordBank(fixed)}`) : questionText;
}

function typeRules(
  option: QuestionTypeOption,
  /** 지정 문법을 지문에서 찾을지, 고쳐 써서 만들지 (선생님 요청 2026-09-29) */
  writingMode: "passage" | "paraphrase" = "paraphrase",
  /** 제시어 배열을 지문 그대로 낼지 (기본: 지문 그대로) */
  wordOrderMode: "passage" | "paraphrase" = "passage",
  /** 같은 유형이 작업 전체에서 몇 번째인가 — 개수·자리·정답 번호를 돌리는 데 쓴다 */
  turn = 0,
  /** 작업 설정 「지문 바꿔 쓰기」를 켰는지 — 끄면 문장삽입 상도 주어진 문장을 원문 그대로 낸다 */
  paraphraseOn = false
): string {
  const code = option.aingkaCode || "";
  const en = option.choiceLanguage === "english";
  const paraphrase = paraphraseChoiceRules(option.choiceLanguage, option.difficulty);
  const craft = choiceCraftCommonRules();

  switch (option.type) {
    case "content_false":
    case "content_true": {
      const isFalse = option.type === "content_false";
      return `${en ? "5 ENGLISH" : "5 Korean"} factual choices about the WHOLE passage.
Ask which ${isFalse ? "does NOT match. Exactly ONE false statement (the key); the other four are TRUE" : "DOES match. Exactly ONE true statement (the key); the other four are FALSE"}.
Style like Korean HS mock exams (학력평가 내용${isFalse ? "불일치" : "일치"}).
- REQUIRED OUTPUT ORDER: write "choicePlan" FIRST (one row per choice: quote, passageSays, change, refutedBy, verdict), then write "choices" from that plan. An answer without choicePlan is rejected.
${factChoiceCraft(isFalse, en)}
${factWordingRule(option.choiceLanguage, option.difficulty)}
- Each choice must stand alone: name what it is about with a noun. Do NOT open a choice with This/These/It/Its pointing back to a passage sentence ("This bias comes from…", "Its y-axis ranges…") — write "Our bias about melting comes from…", "The upper graph's y-axis ranges…". The same for words that need a missing partner: "Other instruments…" (other than what?), "두 현상의 상관관계…" (which two?), "…은 예외가 된다" (an exception to what?) — name them inside the choice. He/She/His/Her for the one person the passage is about is fine.
${factExplanationRules()}
- SKIP: if the passage has fewer than 5 distinct, checkable facts (a very short or list-like passage), return {"skip":true,"reason":"사실 부족"} instead of forcing five choices.
questionText empty.`;
    }
    case "content_count": {
      // 보기 6개면 1~4개, 8개면 2~5개를 틀리게 — 개수가 한쪽으로 몰리지 않게 코드가 정한다
      const many = option.difficulty === "high";
      const contentFalseN = (many ? 2 : 1) + Math.floor(Math.random() * 4);
      return `일치개수 SHORT-ANSWER (NOT MCQ). Format like Korean school worksheets.
- instruction is fixed (count how many <보기> items do NOT match the passage).
- questionText = <보기> statements only, labeled (1) (2) (3) ... each on its own line.
- Language of statements: ${en ? "ENGLISH" : "Korean"}.
- Statement count: ${
        option.difficulty === "high" ? "exactly 8" : "exactly 6"
      }.
- choices: omit or empty array. No ①~⑤ options.
- REQUIRED OUTPUT ORDER: write "choicePlan" FIRST (one row per statement: n, quote, passageSays, change, refutedBy, verdict), then write questionText from that plan. An answer without choicePlan is rejected.
- Do NOT change the passage; omit passageModified.
- explanation: list which numbers are false and why (Korean, brief).
- Every statement must be clearly true or clearly false from the passage alone: no vague references ("the opposite direction" of what?), no comparisons the passage never makes, no paraphrase that could be read either way. A false statement changes one checkable fact.
- A FALSE statement must be false in its main claim. Do not keep the true claim and only reverse the order of the numbers: when the passage says B beat C 11 to 9, "B prevailed over C by a count of 9 to 11" still reads as true to a student (2026-11-12) — write "C prevailed over B by a count of 11 to 9".
- A TRUE statement must stay true against the WHOLE passage: do not drop a limit the passage adds later (원문 "keeps increasing … but both begin to fall after a peak" → 「계속 늘어난다」는 거짓으로도 읽힌다 — 「늘어나는 동안 …도 함께 늘어난다」). Keep the exact relation word: "is offset by" = 상쇄된다(not 줄인다), "may" ≠ 「한다」, "some" ≠ 「모두」.
- A TRUE statement adds nothing the passage does not say: no new agent ("it is estimated" → "archaeologists estimated"), form ("a short assessment" → "a questionnaire"), listener, or swapped word (pollen → nectar). One added detail makes it unverifiable, and the item is rejected.
${craft}
${contentFalseChoiceCraft(en)}
${paraphrase}
Difficulty: ${
        option.difficulty === "low"
          ? "LOW (하) — clearer true/false"
          : option.difficulty === "high"
            ? "HIGH (상) — subtler distinctions"
            : "standard"
      }.

--- 이번 문항 ---
- 틀린 진술을 <b>정확히 ${contentFalseN}개</b> 두고 나머지는 지문과 맞게 쓴다.
  correctAnswer = "${contentFalseN}".
  (전수조사 2026-09-29: 408문항 가운데 358개가 2~3개였다. 두셋만 찍어도 88%를 맞혔다.)`;
    }
    case "topic":
      return `${en ? "5 ENGLISH" : "5 Korean"} topic phrases. Exactly one correct.
${craft}
${topicChoiceCraft(en)}
${balancedGistRule()}
${paraphrase}
${choiceExplanationRules()}
Difficulty: ${
        option.difficulty === "low"
          ? "LOW (하) — clearer correct answer, weaker distractors"
          : option.difficulty === "high"
            ? "HIGH (상) — competitive distractors, but each wrong choice is clearly worse for one nameable reason (too narrow, too broad, adds a claim, reverses a relation); never two choices that both capture the whole main point"
            : "standard"
      }.`;
    case "title":
      return `${en ? "5 ENGLISH Title Case titles" : "5 Korean titles"}. Exactly one correct.
${craft}
${titleChoiceCraft(en)}
${balancedGistRule()}
${paraphrase}
${choiceExplanationRules()}
Difficulty: ${
        option.difficulty === "low"
          ? "LOW (하) — clearer correct answer, weaker distractors"
          : option.difficulty === "high"
            ? "HIGH (상) — competitive distractors, but each wrong choice is clearly worse for one nameable reason (too narrow, too broad, adds a claim, reverses a relation); never two choices that both capture the whole main point"
            : "standard"
      }.`;
    case "summary_mcq":
      // 요약문완성(빈칸 (A)(B) · …… 쌍)은 폐기됨. 요지 객관식만 허용.
      return `요지 MCQ only (NOT 요약문완성).
- 5 FULL ${en ? "ENGLISH" : "Korean"} sentence choices for the main point (요지).
- Do NOT invent a summary sentence with blanks (A)/(B).
- Do NOT use …… / ... pair choices (e.g. "성공 …… 노력").
- questionText must be empty.
${craft}
${summaryChoiceCraft(en)}
${balancedGistRule()}
${paraphrase}
${choiceExplanationRules()}
- Exactly one correct. Difficulty: ${
        option.difficulty === "low"
          ? "LOW (하)"
          : option.difficulty === "high"
            ? "HIGH (상)"
            : "standard"
      }.`;
    case "sentence_blank": {
      if (code === "연결어빈칸") {
        return `In passageModified put discourse blanks (A) and (B). 5 ENGLISH pair choices like "However …… Therefore". Exactly one correct.
${choiceExplanationRules()}
LANGUAGE: passageModified + choices MUST be ENGLISH only (no Korean).`;
      }
      // 문장빈칸 (효자·학력평가형)
      //
      // 선생님과 함께 전수조사(2026-09-29): 214문항 가운데 정답이 가장 긴 선택지인 것이
      // 42%였다(고르면 20%). 정답 평균 14.8낱말, 오답 평균 13.2낱말. 둘째로 긴 것보다
      // 네 낱말 이상 긴 정답이 24개(11%)였다. 길이만 보고도 찍힌다.
      //
      // 「길이를 비슷하게」라는 말은 이미 공통 규칙에 있었는데도 지켜지지 않았다.
      // 개수 유형과 같이 숫자로 못박는다.
      const blankLengthRule = `- 다섯 선택지의 낱말 수를 맞춘다: 가장 긴 것과 가장 짧은 것의 차이가 <b>3낱말 이내</b>.
- 정답이 가장 긴 선택지가 되지 않게 한다. 쓰고 나서 다섯 개의 낱말 수를 세어 보고, 정답이 제일 길면 오답을 늘리거나 정답을 줄여 다시 맞춘다.
- 빈칸으로 지운 문장에만 나오는 고유명사(사람·곳 이름)·연도는 바꿔 쓴 정답에 넣지 않는다. 학생 지문에 없는 정보다 — 그 문장이 글의 흐름에서 하는 말로 쓴다.`;
      if (option.difficulty === "high") {
        return `문장빈칸 HIGH (상) — 효자 기출동형:
- In passageModified, blank ONE important sentence (or key clause) with ____________________________________.
- The blanked content must be a flow-critical sentence from the passage.
- 5 ENGLISH full-sentence/phrase choices.
- CRITICAL: ALL choices (including the correct one) must PARAPHRASE the blanked sentence — synonyms/rewording, NOT copy the original wording.
${blankLengthRule}
- Exactly one correct. questionText empty.
${choiceExplanationRules()}
LANGUAGE: passageModified + ALL choices MUST be ENGLISH only. Never write Korean in passage or choices.`;
      }
      return `문장빈칸 LOW (하) — 효자 기출동형:
- In passageModified, blank ONE important sentence (or key clause) with ____________________________________.
- The blanked content must be a flow-critical sentence from the passage (like mock-exam sentence blanks).
- 5 ENGLISH full-sentence/phrase choices that fit the blank; correct answer may stay close to the original sentence meaning/wording.
${blankLengthRule}
- Exactly one correct. questionText empty.
${choiceExplanationRules()}
LANGUAGE: passageModified + ALL choices MUST be ENGLISH only. Never write Korean in passage or choices.`;
    }
    case "order":
      /*
       * 상은 지시문을 바꿔 쓰는 것이 하와 다른 점이다(선생님 말씀 2026-10-04). 바꿔 쓰기를 끈 작업도
       * 상의 지시문만은 바꿔 쓴다(선생님 결정 2026-10-06) — (A)(B)(C)는 원문 그대로.
       */
      if (option.difficulty === "high") {
        return `순서추론 HIGH (상) — 효자 기출동형:
- Format: lead-in paragraph (지시문) + paragraphs (A)(B)(C) + 5 order choices like (A)-(C)-(B).
- CRITICAL: PARAPHRASE the lead-in (지시문) only — reword synonyms/structure; do NOT copy it verbatim from the passage.
- Keep (A)(B)(C) body paragraphs as ORIGINAL wording from the passage (do not paraphrase A/B/C).
- Exactly one correct order. Put lead-in+(A)(B)(C) in passageModified. questionText empty.
- CHOOSE THE CUT POINTS so that only one order works (고정 시험지 2026-11-10: 두 순서가 다 읽히는 문항이 많았다). Start each of the 2nd and 3rd paragraphs in the correct order with a sentence that cannot stand right after the lead-in or another paragraph: a reference back (this/these/such/the + a noun just introduced, he/she/they), an addition or contrast word (also, In addition, however, Instead), or a time step (Then, Later). Do not cut where the next paragraph opens with a fresh general statement.
- Before answering, read each of the other four orders: if any of them also reads naturally, move the cut points (or skip with {"skip":true,"reason":"순서 단서 없음"}).
LANGUAGE: passageModified + ALL choices MUST be ENGLISH only. Never write Korean in passage or choices.`;
      }
      return `순서추론 LOW (하) — 효자 기출동형:
- Format: lead-in paragraph (지시문) + paragraphs (A)(B)(C) + 5 order choices like (A)-(C)-(B).
- Keep the lead-in (지시문) as ORIGINAL wording from the passage (do not paraphrase).
- Keep (A)(B)(C) as ORIGINAL wording from the passage.
- Exactly one correct order. Put lead-in+(A)(B)(C) in passageModified. questionText empty.
- CHOOSE THE CUT POINTS so that only one order works (고정 시험지 2026-11-10: 두 순서가 다 읽히는 문항이 많았다). Start each of the 2nd and 3rd paragraphs in the correct order with a sentence that cannot stand right after the lead-in or another paragraph: a reference back (this/these/such/the + a noun just introduced, he/she/they), an addition or contrast word (also, In addition, however, Instead), or a time step (Then, Later). Do not cut where the next paragraph opens with a fresh general statement.
- Before answering, read each of the other four orders: if any of them also reads naturally, move the cut points (or skip with {"skip":true,"reason":"순서 단서 없음"}).
LANGUAGE: passageModified + ALL choices MUST be ENGLISH only. Never write Korean in passage or choices.`;
    case "sentence_insertion": {
      // 선생님과 함께 전수조사(2026-09-29): 정답 자리가 ④에 44%, ③④를 합치면 71%였다.
      // ①은 174문항 가운데 3개뿐. 지문 속 자리가 곧 번호라 나중에 섞을 수 없으므로,
      // 개수 유형과 같이 자리를 코드가 먼저 정해 준다. ①은 도입문 바로 뒤라 뺀다.
      // 정답 자리는 plannedAnswerNumber 하나로만 정한다. 전에는 여기서 따로 무작위로 골라
      // 끝의 ANSWER SPOT과 번호가 어긋날 수 있었다(2026-10-03).
      const slot = plannedAnswerNumber("문장삽입", turn) ?? 3;
      const slotRule = `- correctAnswer = ${slot}. 반드시 ${CIRCLED[slot - 1]} 자리에서만 자연스럽게 이어지도록 지문을 끊어라.
- 자리를 먼저 정해 두고 그 앞뒤 문장이 삽입문 없이는 이어지지 않게 배치한다. 다른 자리가 되면 처음부터 다시 잡아라.`;
      /*
       * 상은 주어진 문장을 바꿔 쓰게 했는데, 바꿔 쓰기를 끈 작업에서도 그렇게 나와
       * 학생이 수업에서 읽은 문장과 달랐다(정수학원 10월 5일 점검 3건, 하나는 원문에 없는
       * 연결어 「In doing so」를 덧붙임). 바꿔 쓰기를 켰을 때만 재진술하고, 그때도 뜻·연결어를 지킨다.
       */
      if (option.difficulty === "high") {
        const givenRule = paraphraseOn
          ? "- CRITICAL: questionText = PARAPHRASE of that sentence (ENGLISH), not a verbatim copy. Keep its meaning and its original connective/reference words (However, This, Such …); never add a connective, reason or detail the original sentence does not have."
          : "- questionText = that sentence in ORIGINAL ENGLISH wording (do not paraphrase). Make it 상 by choosing a sentence whose place depends on subtle clues (pronouns, contrast, cause), not by rewording.";
        return `문장삽입 HIGH (상) — 효자 기출동형 (PDF: 위치):
- Pick a flow-critical sentence from the passage as the sentence to insert.
${givenRule}
- passageModified = remaining ENGLISH passage with five insertion slots marked ① ② ③ ④ ⑤ in the text.
- NEVER add a sentence that is not in the original passage to make room for slots (no new closing or bridging sentences). If there are too few sentence boundaries, you may split ONE long original sentence at a clause boundary, keeping its words.
- choices: omit or empty array — slots IN the passage are the options; do NOT invent separate choice texts.
${insertionChoiceCraft()}
LANGUAGE: questionText + passageModified MUST be ENGLISH only.

--- 이번 문항 ---
${slotRule}`;
      }
      return `문장삽입 LOW (하) — 효자 기출동형 (PDF: 위치):
- Pick a flow-critical sentence from the passage as the sentence to insert.
- questionText = that sentence in ORIGINAL ENGLISH wording (do not paraphrase).
- passageModified = remaining ENGLISH passage with five insertion slots marked ① ② ③ ④ ⑤ in the text.
- NEVER add a sentence that is not in the original passage to make room for slots (no new closing or bridging sentences). If there are too few sentence boundaries, you may split ONE long original sentence at a clause boundary, keeping its words.
- choices: omit or empty array — slots IN the passage are the options; do NOT invent separate choice texts.
${insertionChoiceCraft()}
LANGUAGE: questionText + passageModified MUST be ENGLISH only.

--- 이번 문항 ---
${slotRule}`;
    }
    case "irrelevant_sentence": {
      // 선생님과 함께 전수조사(2026-09-29): 133문항의 정답이 ⓒ(38%)·ⓓ(62%) 둘뿐이었다.
      // ⓑ와 ⓔ는 한 번도 정답이 아니었으니, ⓓ만 찍어도 열에 여섯을 맞힌다.
      // ⓐ는 주제문 자리라 그대로 빼고, ⓑ~ⓔ 넷 가운데 코드가 먼저 정한다.
      // ⓔ가 마지막 문장이면 정답으로 쓰기 어색했으므로(133개 중 73개) 마무리 문장을 남기게 한다.
      // 정답 자리는 plannedAnswerNumber 하나로만 정한다(문장삽입과 같은 까닭, 2026-10-03)
      const mark = plannedAnswerNumber("무관한문장", turn) ?? 3;
      const markRule = `- correctAnswer = ${mark} (${LETTERED[mark - 1]}). 무관한 문장은 반드시 ${LETTERED[mark - 1]} 자리에 둔다.
- ⓐ는 글의 주제를 세우는 문장이므로 무관한 문장으로 쓰지 않는다.
- ⓔ 뒤에는 번호를 붙이지 않은 마무리 문장을 한 문장 이상 남겨, 글의 흐름이 끝까지 보이게 한다.`;
      const irrelevantQuality = `IRRELEVANT SENTENCE QUALITY (효자 기출동형 — 필수):
- Do NOT invent a bizarre, random, or absurd sentence that has nothing to do with the passage vocabulary.
- The irrelevant sentence MUST reuse similar words / related content from the passage (same domain, overlapping vocabulary) so it LOOKS related at a glance.
- But it must break cohesion: different topic focus OR a different point that does not connect to the surrounding sentences.
${irrelevantChoiceCraft()}`;
      /*
       * 바꿔 쓰기를 끈 작업은 원문 문장을 하나도 고치거나 지우지 않고 무관한 문장 하나만 끼워 넣는다.
       * 상은 지문 전체를, 하도 군데군데 바꿔 썼다(10-06 작업: 「Just like how」→「Just as」, 구절 삭제,
       * 두 문장을 because로 합침, 「to death」 삭제). 켠 작업은 예전 그대로다.
       */
      const keepRule = paraphraseOn
        ? ""
        : "- KEEP THE PASSAGE VERBATIM: copy every original sentence word for word and in order. INSERT the one irrelevant sentence between two original sentences; do not replace, delete, shorten, merge or reword any original sentence.";
      if (option.difficulty === "high") {
        return `무관한문장 HIGH (상) — 효자 기출동형:
${paraphraseOn ? "- CRITICAL: PARAPHRASE the ENTIRE passage in passageModified (ENGLISH synonyms/rewording throughout)." : keepRule}
- Mark five candidate sentences with ⓐ ⓑ ⓒ ⓓ ⓔ (circled letters before each).
- Exactly ONE of ⓐ~ⓔ is the irrelevant sentence.
${irrelevantQuality}
- For HIGH: the irrelevant sentence should be subtler — same keywords/theme words, but a shifted claim/point that does not follow.
- choices: omit or empty array — letters IN the passage are the options; do NOT invent bottom choice texts.
- questionText empty.
LANGUAGE: passageModified MUST be ENGLISH only.

--- 이번 문항 ---
${markRule}`;
      }
      return `무관한문장 LOW (하) — 효자 기출동형:
${
        paraphraseOn
          ? `- Keep most of the passage ORIGINAL ENGLISH in passageModified.
- Replace ONE sentence with an irrelevant ENGLISH sentence (or insert one among five marked sentences).`
          : keepRule
      }
- Mark five candidate sentences with ⓐ ⓑ ⓒ ⓓ ⓔ in the passage.
- Exactly ONE of ⓐ~ⓔ is the irrelevant sentence.
${irrelevantQuality}
- For LOW: the topic shift can be clearer (still reuse similar wording; never totally weird).
- choices: omit or empty array — letters IN the passage are the options; do NOT invent bottom choice texts.
- questionText empty.
LANGUAGE: passageModified MUST be ENGLISH only.

--- 이번 문항 ---
${markRule}`;
    }
    case "grammar": {
      const catalog = grammarCatalogPromptBlock();
      const explainRules = grammarExplanationRules();
      if (code === "어법추론" || code === "어법모두고르기") {
        const { focusBlock } = pickGrammarFocus(1);
        return `${catalog}

--- 이번 문항 ---
어법 추론 — 틀린 어법 하나 고르기 (어휘 추론과 동일 형식):
${focusBlock}

형식:
- passageModified = 영어 지문, 밑줄 정확히 5개 ⓐⓑⓒⓓⓔ → ⓐ<u>대상</u>
- 어법상 틀린 곳 정확히 1개 — 위 ‘이번 문항’ 문법 반영
- 나머지 4개 밑줄은 어법상 맞음 (함정처럼 보이되 옳음)
- choices: omit or empty array — 기호 IN the passage are the options; do NOT invent bottom combination choices
- correctAnswer 1-5 mapping ⓐ=1 … ⓔ=5 (= 틀린 밑줄 번호). questionText 빈칸
${explainRules}
${grammarChoiceCraftNote()}
LANGUAGE: 지문은 영어만.`;
      }
      if (code === "어법개수") {
        const wrongN = plannedWrongCount(code, turn);
        const { focusBlock } = pickGrammarFocus(wrongN);
        return `${catalog}

--- 이번 문항 ---
어법 개수 — 교재 단원별 문법 다양 출제:
${focusBlock}

형식:
- passageModified = 영어 지문, 밑줄 정확히 6개 ⓐ~ⓕ → ⓐ<u>대상</u>
- 틀린 곳 정확히 ${wrongN}개 — 위 ‘이번 문항’ 문법 (단원 중복 없이). 나머지 맞음
- choices 고정: 1:"1개" 2:"2개" 3:"3개" 4:"4개" 5:"5개"
- correctAnswer = ${wrongN}. questionText 빈칸
${explainRules}
${grammarChoiceCraftNote()}
LANGUAGE: 지문은 영어만.`;
      }
      if (code === "어법연결") {
        return `In passageModified mark ⓐ, ⓑ, ⓒ with two alternatives in parentheses. 5 ENGLISH connection choices. Exactly one correct.`;
      }
      if (code === "어법고쳐쓰기") {
        return `No MCQ. Student finds one grammar error and rewrites. Model rewrite in correctAnswer.`;
      }
      if (
        code === "어법오류수정2" ||
        code === "어법오류수정3" ||
        code === "어법문장오류수정"
      ) {
        /*
         * 발문이 「모두 찾아」인데 개수가 늘 같으면 세어 볼 까닭이 없다.
         * 저장된 문항은 어법오류수정2가 100% 2개, 어법오류수정3이 97% 3개였다
         * (2026-10-01 최다빈 선생님 지적). 문항마다 돌려 가며 바꾼다.
         */
        const wrongN = plannedWrongCount(code, turn);
        const spotTotal = code === "어법오류수정3" ? 7 : 5;
        const spotLabel = wrongSpotLabel(
          spotTotal,
          wrongN,
          turn,
          code === "어법문장오류수정" ? "number" : "mark"
        );
        // <b>로 강조했더니 모델이 본문의 틀린 낱말까지 <b>로 감싸 답이 드러났다(382문항 대조 2026-10-02)
        const spotLine = `- 틀린 곳은 「${spotLabel}」 이다. 다른 자리는 모두 어법상 맞게 둔다. 본문에 <b> 같은 꾸밈 태그를 넣지 않는다.
  (자리가 ⓑⓓ·②④처럼 한쪽으로 몰리던 것을 막는다.)`;
        const { focusBlock } = pickGrammarFocus(wrongN);
        if (code === "어법문장오류수정") {
          return `${catalog}

--- 이번 문항 ---
서술형 · 어법 틀린 문장 수정 (수특형):
${focusBlock}

형식:
- passageModified = 영어 지문. 문장(또는 절) 앞에 ① ② ③ ④ ⑤ 표지.
- 어법상 틀린 문장 정확히 ${wrongN}개 — 위 ‘이번 문항’ 문법을 서로 다른 단원으로 반영.
${spotLine}
- 나머지 문장은 어법상 맞음.
- questionText:
<조건>
○ 틀린 곳의 기호와 수정한 형태를 모두 써야 정답으로 인정함

<답안행>
${wrongN}
- correctAnswer 형식: "③: why / ④: to continue" (번호 + 바르게 고친 핵심 형태)
- choices 없음. explanation 한글: 각 번호의 틀린 점 → 바른 형태 + 쉬운 이유.
CRITICAL 정합:
1) 틀린 문장 안의 오류 형태가 본문에 그대로 있어야 함.
2) correctAnswer의 기호 = 실제로 틀린 ${wrongN}개만. 맞는 문장 번호를 넣지 말 것.
3) explanation도 같은 ${wrongN}개만 틀림으로 설명. 정답과 해설이 모순되면 안 됨.
4) "are → are"처럼 고친 결과가 본문과 같은 쌍 금지.
LANGUAGE: 지문 영어만.`;
        }
        // 개수가 아니라 유형으로 정한다 — 어법오류수정2가 1·3개 차례일 때 7개로 나가 위 자리(ⓐ~ⓔ)와 어긋났다
        const marks =
          spotTotal === 5
            ? "ⓐⓑⓒⓓⓔ (5개 밑줄)"
            : "ⓐⓑⓒⓓⓔⓕⓖ (7개 밑줄)";
        return `${catalog}

--- 이번 문항 ---
서술형 · 어법 틀린 곳 ${wrongN}개 수정 (수특형):
${focusBlock}

형식:
- passageModified = 영어 지문. 밑줄 정확히 ${marks} → ⓐ<u>틀린형태또는맞는형태</u>
- 틀린 곳 정확히 ${wrongN}개 — <u>안에는 틀린 형태</u>를 넣음. 위 ‘이번 문항’ 문법을 서로 다른 단원으로 하나씩.
- 틀린 형태는 그 자리 **원문 낱말의 형태만** 바꿔 만든다(수·시제·태·품사·준동사). 다른 낱말로 바꾸거나 낱말을 끼워 넣지 말 것 — 바른 형태가 곧 원문이어야 고치는 답이 하나로 정해진다.
${spotLine}
- 나머지 밑줄은 어법상 맞음 (함정처럼 보이되 옳음) — <u>안에는 이미 바른 형태</u>.
- questionText:
<조건>
○ 틀린 곳의 기호와 수정한 형태를 모두 써야 정답으로 인정함

<답안행>
${wrongN}
- correctAnswer 형식 예: "ⓒ: keep / ⓓ: surprising" (기호 + 바른 형태만, ${wrongN}쌍). "are → are" 금지.
- choices 없음.
- explanation 한글: ⓐ~ⓔ(또는 ⓖ) 각각에 대해 (맞음) 또는 (틀림: 본문형 → 바른형 + 이유).
CRITICAL 정합 (필수):
1) correctAnswer에 적은 기호의 <u>본문</u>은 틀린 형태여야 하고, correctAnswer 값은 바른 형태.
2) explanation에서 틀리다고 한 기호 집합 = correctAnswer 기호 집합 (동일 ${wrongN}개).
3) explanation에서 맞다고 한 기호는 correctAnswer에 넣지 말 것.
4) 본문 밑줄 텍스트와 고친 형태가 같으면 그 기호는 정답이 될 수 없음.
LANGUAGE: 지문 영어만.`;
      }
      {
        const { focusBlock } = pickGrammarFocus(1);
        return `${catalog}

--- 이번 문항 ---
밑줄 5개 중 틀린 것 1개.
${focusBlock}
${explainRules}`;
      }
    }
    case "vocabulary":
      if (code === "어휘개수") {
        /*
         * 전수조사(2026-09-29): 146문항 가운데 100개가 정답 「3개」였다. 세 개만 찍어도
         * 68%를 맞힌다. 어법개수처럼 코드가 개수를 정해 주어 고르게 흩는다.
         */
        const wrongN = 1 + Math.floor(Math.random() * 5);
        /*
         * 밑줄 자리 수를 틀린 개수에 맞춰 늘린다.
         *
         * 전수조사(2026-09-30): 9/29에 개수를 코드가 정해 주도록 고쳤는데도 그 뒤 만든
         * 31문항이 2개·3개에만 몰렸다(14·16). 자리는 늘 여섯인데 「1개만 틀리게」나
         * 「5개 틀리게」는 여섯 자리에 억지스러워 모델이 따르지 않은 것이다.
         * 자리를 wrongN+3개로 두면 1개든 5개든 자연스러워진다.
         */
        // 보기가 늘 1개~5개라 밑줄이 다섯보다 적으면 「5개」가 답이 될 수 없는 보기가 된다(2026-10-13 점검 4문항)
        const spots = Math.max(5, wrongN + 3);
        const marks = "①②③④⑤⑥⑦⑧".slice(0, spots).split("").join(" ");
        return `

--- 이번 문항 ---
어휘 개수 — 고1 학력평가·내신 고퀄리티 (A4 변형동형):
- passageModified = FULL ENGLISH passage with exactly ${spots} vocabulary spots ${marks} as ①<u>word/phrase</u>.
- 문맥에 맞지 않는 곳을 <b>정확히 ${wrongN}개</b> 두고, 나머지 ${spots - wrongN}개는 <b>반드시</b> 문맥에 맞게 쓴다.
- 이 개수는 바꾸지 않는다. ${wrongN}개보다 많이도 적게도 두지 않는다.
- correctAnswer = ${wrongN}.
- WRONG 기법: 반의·방향 반전 / 유사 철자·형태 혼동어 / 문맥만 틀린 유의어.
${vocabChoiceCraft()}
${choiceExplanationRules()}
- choices MUST be EXACTLY and ONLY these five texts in order:
  1:"1개"  2:"2개"  3:"3개"  4:"4개"  5:"5개"
- vocabularyJudgments: ${spots}개를 번호 순서대로 모두 쓴다.
  · 각 항목 = {"number":1, "verdict":"correct" 또는 "wrong", "replacement":"틀린 경우의 바른 영어", "reason":"한글 이유"}
  · wrong은 정확히 ${wrongN}개, correct는 정확히 ${spots - wrongN}개다.
- questionText empty. explanation은 짧게 써도 되며, 서버가 vocabularyJudgments에서 학생용 해설을 다시 만든다.
LANGUAGE: passage ENGLISH only.`;
      }
      // 어휘추론 (어색한 것 고르기) — PDF형 ①~⑤, 하단 보기 없음
      return `어휘 어색한 것 고르기 — 고1 학력평가·내신 고퀄리티 (A4 변형동형):
- passageModified = FULL ENGLISH passage with exactly five vocabulary spots ① ② ③ ④ ⑤ as ①<u>word/phrase</u>.
- Exactly ONE is contextually WRONG; the other four are clearly correct in context.
- WRONG 기법 우선: (1) 반의·방향 반전 (2) 철자·형태 유사 혼동어 (3) 문맥만 틀린 유의어형.
${vocabChoiceCraft()}
${choiceExplanationRules()}
- choices: omit or empty array — numbers IN the passage are the options; do NOT print a separate choice list.
- CRITICAL: Do NOT use choices like "1개/2개/3개". That is a DIFFERENT question type (어휘개수). This is 어휘추론 — exactly ONE wrong word.
- correctAnswer 1-5 = the wrong underlined number. questionText empty.
- vocabularyJudgments: ①~⑤를 번호 순서대로 모두 쓴다.
  · 각 항목 = {"number":1, "verdict":"correct" 또는 "wrong", "replacement":"틀린 경우의 바른 영어", "reason":"한글 이유"}
  · wrong은 정확히 하나이고 correctAnswer와 같은 번호여야 한다. 나머지 네 개는 correct다.
- explanation은 짧게 써도 되며, 서버가 vocabularyJudgments에서 학생용 해설을 다시 만든다.
LANGUAGE: passage ENGLISH only.`;
    case "underlined_inference":
      if (code === "목적추론") {
        return `5 ENGLISH purpose choices (To + verb). Exactly one correct. passageModified optional. LANGUAGE: choices ENGLISH only.
${choiceCraftCommonRules()}`;
      }
      if (code === "심경추론") {
        return `5 English emotion-change choices like "worried → relieved". Exactly one correct. LANGUAGE: choices ENGLISH only.
${choiceCraftCommonRules()}`;
      }
      if (code === "함축의미추론") {
        return `함축의미추론 — A4 변형·학력평가 동형:
형식:
- passageModified = 영어 지문. 함축 표현 1곳 (A)<u>표현</u>.
- 대상 예(A4): "the arrow is as likely to point in the reverse direction", "a game of waiting for our own turn to speak"
- 없으면 {"skip":true,"reason":"적합한 함축 표현 없음"}.
- questionText "". choices: 영어 구/절 5개.
${choiceCraftCommonRules()}
${impliedMeaningChoiceCraft()}
${choiceExplanationRules()}
해설 한글: 정답 번호 + 문맥 paraphrase 이유 + 왜 직역/일반론이 아닌지.`;
      }
      return `Underline a key expression with <u>...</u> in passageModified. 5 ENGLISH meaning choices.`;
    case "writing": {
      if (code === "문법조건영작") {
        /*
         * 선생님 요청(2026-09-28): 특정 문법을 조건으로 하는 영작. 문법은 지문에 실제로
         * 있는 것 가운데 고른다(지문에 없는 문법을 억지로 시키면 답이 지문과 겉돈다).
         */
        /*
         * 칸 이름은 이미 쓰고 있는 제시어 배열 서술형과 똑같이 <조건>/<보기>/<해석>이다.
         * 선생님 지적(2026-09-28): 새 유형만 모양이 달라 한 줄 글로 붙어 나왔다.
         * 같은 칸 이름을 쓰면 기존 인쇄 틀(상자 세 개 + 답란)이 그대로 그려 준다.
         */
        /*
         * 선생님 요청(2026-09-29): 두 가지를 버튼으로 나눈다.
         * - 지문 그대로: 그 어법이 이미 쓰인 문장을 찾아 낸다. 없으면 건너뛴다.
         * - 고쳐 쓰기: 중요한 문장을 그 어법으로 바꿔 써서 낸다.
         */
        const byPassage = writingMode === "passage";
        return `서술형 · ${byPassage ? "정해진 어법이 쓰인 문장으로" : "정해진 어법으로 고쳐 써서"} 영작하기:
- 쓸 어법은 아래 목록에 있는 것만 쓴다. [이번 문항에 쓸 어법]이 따로 주어졌으면 그것을 쓴다.
${GRAMMAR_FOR_WRITING}
${
  byPassage
    ? `- 지문에서 <b>그 어법이 실제로 쓰인 문장</b>을 찾는다. 그 문장이 정답이다.
  · 지문을 고쳐 쓰지 않는다. 원문 문장 그대로 쓴다.
  · 그 어법이 쓰인 문장이 없거나 6낱말 미만이면 {"skip":true,"reason":"지문에 그 어법이 없음"}.`
    : `- 지문에서 <b>핵심을 담은 문장 하나</b>를 고른다(주장·결과·정의·대비). 사소한 연결 문장은 고르지 않는다.
  6낱말 미만이면 다른 문장을 고른다.
- 그 문장을 <b>고른 어법으로 고쳐 쓴다.</b> 뜻은 그대로 두고 구조만 바꾼다.
  · 지문에 이미 그 어법이 쓰여 있으면 그 문장을 그대로 써도 된다.
  · 없으면 <b>고쳐 쓴 문장</b>이 정답이다. 지문에 없는 문장이어도 된다.
  · 보기: 원문 "Curiosity keeps a reader turning pages."
    → It - that 강조구문 → "It is curiosity that keeps a reader turning pages."
  · 뜻이 달라지거나 어색한 영어가 되면 <b>다른 문장</b>을 골라 다시 한다.`
}
- passageModified = 영어 지문. <b>고른 문장이 있던 자리를 ⓐ__________ 빈칸으로 바꾼다.</b>
  · 그 문장은 지문에서 <b>완전히 지운다</b>. 일부라도 남기면 안 된다(베껴 쓰게 된다).
  · 나머지 지문은 원문 그대로 둔다.
- questionText 형식(필수). 태그는 각각 <b>그 줄에 혼자</b> 있어야 한다:
<조건>
○ [어법 이름]을 사용할 것

<보기>
word1 / word2 / … (정답 문장의 낱말을 원형으로 흩어 놓는다. 8~14개)

<해석>
(정답 문장의 우리말 뜻 한 줄. 자연스러운 한국어로)

- <조건>에는 <b>어법 줄 하나만</b> 쓴다. 낱말 수·대소문자 같은 나머지 조건은
  시스템이 정답에 맞춰 붙이므로 적지 않는다.
- [어법 이름]: 위 목록의 <b>이름을 그대로</b> 옮겨 적는다. 괄호 속 형태는 적지 않는다.
  보기: 「○ It - that 강조구문을 사용할 것」, 「○ 가정법 과거를 사용할 것」.
  목록에 없는 이름을 지어내거나 「어법을 사용할 것」처럼 뭉뚱그리면 안 된다.
- correctAnswer: 고쳐 쓴 영어 문장 하나. 그 어법이 <b>눈에 보이게</b> 들어 있어야 한다.
- 보기에는 정답 문장에 쓰이는 낱말만 넣는다. 어형변화는 동사만 한다 — 동사는 원형으로
  (be동사는 be), 명사·형용사·부사·대명사·관사·전치사는 정답에 쓰인 꼴 그대로 적는다
  (복수는 복수로: apples는 apples, 비교급·최상급도 그대로).
- choices 없음. explanation 한글: 어떤 어법을 묻는지와 왜 그 형태인지 한두 줄.`;
      }
      if (code === "지칭대명사서술") {
        return `서술형 · 지칭 추론 · 대명사·지시사 (수특형):
- passageModified = 영어 지문. 지시 대상이 분명한 대명사·지시사 1곳에 ⓐ<u>it</u> (또는 this/that/they/these/those/them).
- 앞선 문맥에 선행사(명사·동명사 등)가 본문에 그대로 있어야 함.
- 적합한 대명사 지칭이 없으면 {"skip":true,"reason":"명확한 대명사 지칭 없음"}.
- questionText:
<지칭답란>
ⓐ
- correctAnswer = 본문에 나오는 선행사 (보통 1단어, 필요 시 2단어). 예: Thinking / anxiety
- 정답은 밑줄 대명사 앞쪽 본문에 실제 존재하는 단어(형태 그대로).
- choices 없음. explanation 한글: 왜 그 선행사인지.
- instruction은 생성 후 시스템이 밑줄 단어에 맞게 고침 (템플릿 유지해도 됨).`;
      }
      if (code === "특정표현의미서술") {
        return `서술형 · 지칭 추론 · 특정 표현 의미 (수특형):
- passageModified = 영어 지문. 관용·비유·함축 표현 1곳을 <u>표현</u> (예: in the same boat).
- 그 표현의 문맥 의미와 같은 말이 본문 다른 곳에 연속 구로 있어야 함.
- 없으면 {"skip":true,"reason":"문맥 동의 구 없음"}.
- 정답 구 단어 수 N = 4~10 (본문 연속 단어 수와 일치).
- questionText:
<지칭답란>
ⓐ
- correctAnswer = 본문에서 찾은 연속 N단어 구 (예: dealing with internal anxiety in social situations)
- choices 없음. explanation 한글: 밑줄 표현 ↔ 본문 구 대응.
LANGUAGE: 지문·정답 영어만.`;
      }
      if (
        code === "제시어배열기본" ||
        code === "제시어배열어형변화" ||
        code === "제시어배열단어추가"
      ) {
        const mode: WordOrderMode =
          code === "제시어배열기본"
            ? "basic"
            : code === "제시어배열어형변화"
              ? "inflect"
              : "add";
        const { focusBlock, point, c } = pickWordOrderFocus(mode);
        /*
         * 쓸 문장을 코드가 골라 준다.
         *
         * 선생님 지적(2026-10-01): 만들다 버린 값도 우리가 낸다. 「지문 그대로」인데
         * 모델이 문장을 고쳐 써 와서 버리는 일이 잦았다(여섯 번에 네 번). 어느 문장을
         * 쓸지 미리 박아 주면 벗어날 데가 없다. 슬롯마다 다른 문장을 준다.
         */
        // 지문 그대로가 기본이다(선생님 결정 2026-09-29)
        const wordOrderKeepPassage = wordOrderMode !== "paraphrase";
        const catalog = wordOrderCatalogBrief();
        const modeRules =
          mode === "basic"
            ? `- <조건>: 「○ 주어진 단어를 모두 한 번씩만 사용할 것 (어형을 바꾸지 말 것)」
- <보기>: 정답에 쓰인 꼴 그대로 — 어형을 바꾸지 않는다(복수는 복수로, 동사도 정답의 시제·3인칭·분사 꼴 그대로. apples는 apples, makes는 makes). 생성 후 시스템이 무작위로 섞음. 8~12개
- correctAnswer = 보기를 어순만 맞춰 늘어놓은 완성 영어
- CRITICAL: <보기> 다중집합 = correctAnswer의 모든 토큰(전치사 for/to/of, 관사 the/a, 중복 pleasure 등 포함). 정답에 쓰인 단어를 보기에서 빼지 말 것.`
            : mode === "inflect"
              ? `- <조건>: 「○ 주어진 단어를 모두 한 번씩만 사용하되, 필요한 경우 동사의 형태를 바꿔 쓸 것」
- <보기>: 어형변화는 동사만 한다. 동사·조동사·be동사는 반드시 원형으로(be동사는 be. 과거·과거분사·3인칭 -s·-ing 금지 — 학생이 시제·분사·-ing·3인칭을 맞춘다). 명사·형용사·부사·대명사는 정답에 쓰인 꼴 그대로 — 복수는 복수로(ideas는 ideas, clothes는 clothes. apple로 주지 않는다), 비교급·최상급도 그대로(better는 better). 생성 후 시스템이 무작위로 섞음
- correctAnswer = 어형 변화를 적용한 완성 영어 (예시는 맨 뒤 「이번 문항」)
- CRITICAL: <보기> 다중집합 = correctAnswer 토큰(동사만 원형으로. 전치사·관사·중복 포함). 누락 금지.`
              : `- <조건>은 반드시 아래 두 줄만 (한 줄에 / 로 붙이지 말 것). 조건에 <보기> 태그 금지:
○ 단어 중복·어형 변화 가능
○ 보기에 없는 단어 추가 가능
- <보기>: 핵심 어휘 6~10개만(한글·안내문 금지). 어형변화는 동사만 한다 — 동사는 원형(be동사는 be), 명사·형용사·부사는 정답에 쓰인 꼴 그대로(복수는 복수로: apples는 apples, 비교급도 그대로). 생성 후 시스템이 무작위로 섞음
- correctAnswer = 관사·전치사·접속사 추가·어형 변화 포함한 완성문 (예시는 맨 뒤 「이번 문항」)
- CRITICAL: 정답의 내용어(명사·동사·형용사·부사)는 모두 <보기>에 넣을 것. 관사·전치사만 보기 밖에서 추가 가능.
- 금지: <보기> 본문에 '에 없는 단어'·한글 조사·문법 설명·중복 <보기> 태그`;

        /*
         * 해설에 문법 포인트 꼬리표(GP10 …)를 붙이게 하지 않는다.
         *
         * 선생님 지시(2026-10-01)로 문항을 하나하나 대조하다 찾았다. 「지문 그대로」로
         * 바꾼 뒤 빈칸으로 쓸 문장은 차례(슬롯)로 고른다 — 아래 POINT로 고르지 않는다.
         * 그런데 해설에는 여전히 그 POINT를 적게 해 두어, 관계부사가 없는 문장에
         * 「GP10 관계부사 구문에서는…」이, give류가 없는 문장에 「GP01 … give류는
         * to + 간접목적어」가 붙었다. 제시어배열 343문항 가운데 153개(45%)가 이랬다.
         * 학생이 해설을 믿지 못한다. POINT는 문장을 고르는 데만 쓰고, 해설은 그 문장
         * 자체를 풀이하게 한다.
         */
        /*
         * 문항마다 달라지는 것(이번 POINT·예시)만 맨 뒤 「이번 문항」으로 보낸다. 전에는 형식 규칙까지
         * 「이번 문항」 아래라 첫 메시지가 1,024토큰에 못 미쳐 캐시가 한 번도 안 걸렸다(4차 시험 2026-10-04:
         * 서술형 입력 2,275토큰 중 캐시 260).
         */
        return `${catalog}

서술형 · 제시어 배열 — 『고등영어 어법서술형』 반영

형식 (수특·내신·교재 서술형 연습 동형):
- passageModified = 영어 지문. 위 CASE에 맞는 **중요 문장/절** 한 곳을 ⓐ__________ 빈칸으로.
  · 지문의 핵심 주장·결과·정의·조건 등 ‘중요 문장’을 대상으로 할 것 (사소한 연결 문장 금지).
  · ${wordOrderKeepPassage
    ? "그 문장을 **지문에 있는 그대로** 쓴다. 고쳐 쓰지 말 것 — correctAnswer가 지문에 그대로 있어야 한다."
    : "필요하면 그 문장만 교재 구문에 맞게 다듬어 빈칸화 (나머지 지문은 유지). 다듬어도 **원래 문장의 자리에서 원래 문장을 대신**한다 — 새 문장을 끼워 넣지 말고, 원래 문장의 뜻·주어·시제를 지켜 앞뒤 문장과 그대로 이어지게 한다. 대명사(they·it·this)는 바로 앞 문장에 가리키는 말이 있을 때만 쓴다."}
  · CRITICAL: 정답 문장은 **통째로** 빈칸으로 지운다. 정답의 일부를 빈칸 옆에 남기지 말 것.
    남긴 말이 <보기>에도 있으면 같은 말이 두 번 보여 문항이 못 쓰게 된다
    (예: ⓐ__________ diverse viewpoints 인데 보기에도 diverse·viewpoints가 있는 경우).
- questionText 형식(필수, 태그·순서 유지):
<조건>
(모드 규칙에 맞는 ○ 조건 1~2줄)

<보기>
word1 / word2 / …

<해석>
(빈칸 정답의 자연스러운 한국어 한 문장)

${modeRules}
- acceptableAnswers: 구두점·대소문자만 다른 허용 답
- choices 없음
- explanation 한글: 정답 문장 + 왜 그 차례인지 (어떤 말이 주어·동사·목적어이고 무엇이 무엇을 꾸미는지). 지문에 없는 문법 이름이나 포인트 번호를 지어 붙이지 말 것.
- 금지: 이번 POINT와 무관한 단순 SVO만 반복, 지문과 무관한 새 주제 문장

--- 이번 문항 ---
${focusBlock}${mode === "basic" ? "" : `\n(정답 예: ${c.example})`}`;
      }
      return `Korean prompt + <조건> + given words in questionText. Model English answer in correctAnswer. passageModified optional.`;
    }
    case "summary_short": {
      if (code === "요약문빈칸영작") {
        return `서술형 · 요약문 빈칸 영작 (수특형 · 보기 배열):
- passageModified 생략(원문 지문 사용). 지문은 영어만.
- 난이도: 중학 고급~고교 기본. 요약문은 지문 표현을 최대한 살려 paraphrase. 지나치게 추상적이거나 새 단어를 지어내지 말 것.
- 빈칸 ⓐ, ⓑ는 각각 2~4단어로 제한 (너무 길면 학생이 쓸 수 없음).
- 빈칸 자리는 요약문의 핵심 서술어·목적어. 지문에서 그대로 또는 약간 변형된 표현 사용.
- questionText 형식(필수) — 섹션 태그는 반드시 줄 단독. 조건 문장 안에 <보기> 태그를 넣지 말 것:
<조건>
○ 보기의 단어를 모두 한 번씩만 사용할 것
○ 필요한 경우 동사의 형태를 바꿔 쓸 것
○ 글의 내용에 맞게 ⓐ, ⓑ를 완성할 것
○ ⓐ는 N단어, ⓑ는 M단어로 쓸 것 (N+M = 보기 단어 수, 예: 3·4)

<보기>
word1 / word2 / … (6~10개, 정답 ⓐ+ⓑ를 섞은 핵심 단어. 동사는 원형, 나머지는 정답 꼴 그대로. 적을수록 쉽고 명확함)

<요약문>
(영어 요약 1~2문장. 지문 핵심을 지문 표현 그대로 또는 최소 변형. 빈칸 ⓐ__________ 와 ⓑ__________ 포함)

- correctAnswer 형식: "ⓐ: … / ⓑ: …" (완성 영어 구)
- 정답이 하나뿐이게(2026-10-04 시험에서 둘 다 맞는 답이 나왔다):
  · ⓐ와 ⓑ는 요약문에서 맡는 역할이 달라야 한다(예: ⓐ 동사구, ⓑ 명사구). 두 칸의 답을 서로 바꿔 넣어도 말이 되면 안 된다.
  · 보기의 낱말 하나하나가 한쪽 칸에만 들어갈 수 있게 고른다.
  · 빈칸 안의 동사는 그 목적어·보어까지 같은 빈칸에 담는다. 타동사로 끝나 목적어가 빠지거나 다른 빈칸으로 떨어지면 안 된다(× ⓐ가 「how X serve」로 끝나고 serve의 목적어는 ⓑ 뒤에 따로 있음). 두 칸을 채운 요약문이 그대로 완전한 문장이어야 한다.
  · 어형변화는 동사만 한다. 보기에서 동사는 원형으로 준다(be동사는 be. 학생이 시제·분사·-ing·3인칭을 맞춘다). 명사·형용사·부사·대명사는 정답에 쓰인 꼴 그대로 준다 — 복수는 복수로(apples는 apples, 절대 apple이 아니다), 비교급·최상급도 그대로(better는 better).
- 요약문은 지문 핵심 문장을 거의 그대로 활용. 새 단어 지어내기 금지.
- 요약문의 주체·인과는 지문에 있는 그대로(10-14 점검: 기록을 남긴 쪽을 바꿈, 지문에 없는 원인을 붙임, 특정 집단을 사람 전체로 넓힘). 요약문만 읽어도 뜻이 통해야 한다 — this·such 같은 지시어가 가리킬 말을 요약문 안에 둔다. "The ⓐ in the passage are ⓑ"처럼 내용 없는 틀 금지.
- choices 없음. explanation 한글: 정답 + 지문 어디에 근거하는지.
- 금지: 조건 줄에 "<보기>의"처럼 태그 형태로 쓰기. "보기의"로 쓸 것.`;
      }
      if (code === "요약문빈칸2단어") {
        return `서술형 · 요약문 빈칸 · 본문에서 연속 2단어 찾기 (수특형):
- passageModified 생략. 지문 영어만.
- questionText 형식(필수):
<조건>
○ 본문에서 찾아 쓸 것
○ ⓐ는 본문에 나오는 연속된 두 단어로 쓸 것
○ ⓑ(및 ⓒ가 있으면)는 본문의 한 단어로 쓸 것 (형태 변형 금지)
○ 본문에 제시된 단어의 형태를 변형하지 말 것

<요약문>
(영어 paraphrase 요약. ⓐ__________ 는 연속 2단어 자리, ⓑ__________ 는 1단어. 필요 시 ⓒ도 1단어)

- 정답 구는 반드시 원문 passage에 연속으로 그대로 존재 (대소문자만 달라도 됨).
- correctAnswer: "ⓐ: social muscle / ⓑ: compassion" 형식
- choices 없음. explanation 한글: 본문 어디 근거인지.`;
      }
      if (code === "요약표빈칸단어") {
        /*
         * 선생님 요청(2026-09-28): 지문 내용을 표로 정리하고 (A)(B)(C)를 본문 단어로
         * 채우는 유형. 학교 시험지에서 실제로 쓰는 모양 그대로 만든다.
         */
        return `서술형 · 내용을 표로 정리 · 빈칸에 본문 단어 찾아 쓰기:
- passageModified 생략. 지문 영어만.
- 지문을 <b>두 갈래로 갈라 볼 수 있어야</b> 이 유형이 된다. 없으면 만들지 말고 SKIP.
  갈래 보기: 맞서는 두 입장 / 일어난 일과 그에 대한 반응 / 예전과 지금 / 원인과 결과.
- questionText 형식(필수). <조건>과 <표>는 각각 <b>그 줄에 혼자</b> 있어야 하고,
  표는 <b>한 줄이 한 행</b>이다(줄바꿈으로 행을 나눈다. 한 줄로 이어 붙이면 안 된다):
<조건>
○ 빈칸에 들어갈 말은 지문에 나온 단어를 쓰되, 필요하면 문맥에 맞게 형태를 바꿔 쓸 것
○ (A), (B), (C)는 각각 한 단어로 쓸 것

<표>
| | 첫째 갈래 이름 | 둘째 갈래 이름 |
| 줄이름1 | 영어 서술 … (A) … | 영어 서술 … |
| 줄이름2 | 영어 서술 … | 영어 서술 … (B) … |
| 줄이름3 | 영어 서술 … (C) … | 영어 서술 … |

실제 보기(2025년 9월 고2 19번 모양). 빈칸이 두 칸에 나뉘어 있는 것을 눈여겨본다:
| | Event | Amina's response |
| Land | Men began (A) and marking the ground. | She walked closer, wanting to know what was happening. |
| Building | Her uncle said a school would be built for village children. | Her eyes (B) with joy. |
| Distance | The nearest school was (C) away on foot. | She imagined learning to read and write. |

- 줄 이름과 빈칸이 아닌 칸에는 (A)(B)(C)의 정답 낱말을 쓰지 않는다(정답이 capacity 인데 줄 이름이 Capacity 이거나 옆 칸에 "no such capacity" 가 있으면 표만 보고 답한다).
- 표는 <b>정확히 세 칸</b>이다. 첫 줄이 머리글이고, 그 아래 세 줄이 내용이다.
  줄마다 | 로 칸을 나눈다.
- 머리글 첫 칸은 <b>비워 둔다</b>. 뒤 두 칸에 갈래 이름을 쓴다
  (보기: Event / Amina's response, Most experts / Darby Saxbe, Before / After).
- 둘째 줄부터 첫 칸은 <b>그 줄이 무엇에 관한 줄인지</b> 한두 낱말로 적는다.
  영어 명사로 짧게 쓴다(보기: Land, Building, Distance, Cost, Timing).
  「견줄 점 1」처럼 자리표시를 그대로 두면 안 된다.
- 갈래 이름과 줄 이름은 본문에서 끌어온다(지어내지 않는다).
- 같은 줄의 두 칸은 <b>같은 것을 다룬다</b>. 왼쪽이 무엇을 말하면 오른쪽은 그것에
  대한 다른 쪽 이야기를 쓴다.
- 칸 속 영어는 완결된 문장 한두 개로 쓴다(한 칸에 6~18낱말).
- 표의 영어 서술은 지문 문장을 그대로 베끼지 말고 짧게 paraphrase 한다.
- (A)(B)(C) 자리에 들어갈 낱말의 <b>어간은 반드시 지문에</b> 있어야 한다.
  지문에 없는 낱말을 지어내지 않는다.
- <b>셋 가운데 적어도 둘은 지문에 있는 형태와 달라야 한다</b>(품사·시제·수·태를 바꾼다).
  답이 지문을 눈으로 훑기만 해도 보이면 시험 문항이 되지 않는다(선생님 지적 2026-10-01).
  바꾸는 보기: make → making / to make, important → importance, decide → decision,
  grow → growth, quickly → quick, analyze → analysis, able → ability, lose → loss.
  바꾼 형태는 그 빈칸 자리에서 <b>문법적으로 맞아야</b> 한다(동사 자리에 명사를 넣지 않는다).
- 같은 낱말이 두 칸에 들어가도 된다(그때는 같은 기호를 두 번 쓴다).
- 빈칸을 <b>한쪽 칸에만 몰지 않는다</b>. 왼쪽 칸과 오른쪽 칸에 <b>나눠</b> 둔다
  (선생님 지적 2026-09-29: 보기가 한쪽 열에만 들어가는 경우가 있다).
  빈칸이 셋이면 한쪽에 둘·다른 쪽에 하나처럼 갈라 놓는다. 줄도 서로 다른 줄에 둔다.
- correctAnswer 형식: "(A): separate / (B): email / (C): boundaries"
- choices 없음. explanation 한글: 각 낱말이 본문 어디에 근거하는지 한 줄씩.`;
      }
      if (code === "요약문빈칸3단어") {
        return `서술형 · 요약문 빈칸 · 본문에서 연속 3단어 찾기 (수특형):
- passageModified 생략. 지문 영어만.
- questionText 형식(필수):
<조건>
○ 본문에서 찾아 쓸 것
○ ⓐ는 본문에 나오는 연속된 세 단어로 쓸 것
○ ⓑ(및 ⓒ가 있으면)는 본문의 한 단어로 쓸 것 (형태 변형 금지)
○ 본문에 제시된 단어의 형태를 변형하지 말 것

<요약문>
(영어 paraphrase 요약. 핵심 빈칸 ⓐ__________ = 연속 3단어, ⓑ__________ 는 1단어)

- 정답 ⓐ 구는 원문에 연속 3단어로 존재해야 함.
- ⓑ는 정확히 한 단어다. 「1~2단어」처럼 범위를 주면 한 단어로 줄여 써도 맞아 답이 둘이 된다(2026-10-04 시험: greater consistency / consistency, audible signals / signals).
- correctAnswer: "ⓐ: … … … / ⓑ: …" 형식
- choices 없음. explanation 한글.`;
      }
      return `요지 영작. <조건>이 있으면 questionText에 넣고, correctAnswer에 영어 한 문장.`;
    }
    case "short_title":
    case "short_topic":
      return `Short constructed response. Model answer in correctAnswer.`;
    default:
      return `Follow Korean high-school 학력평가 mock-exam variation style (고1 level).`;
  }
}

/** 지문 표지와 정답이 묶이거나 개수 보기가 고정인 유형은 셔플 금지 */
/** 보기마다 근거 인용·참거짓을 먼저 계획하게 하는 유형 */
const CONTENT_PLAN_TYPES = new Set(["content_true", "content_false", "content_count"]);
/** 글의 핵심을 먼저 정리하고 오답마다 어긋난 점을 적게 하는 유형 */
const GIST_PLAN_TYPES = new Set(["title", "topic"]);

const planNorm = (s: string) =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * 생성이 내놓은 보기 계획(choicePlan)을 코드로 대조한다. 틀리면 그 까닭(다음 시도 메모)을 돌려준다.
 *  - 근거 인용은 지문에 그대로 있어야 한다(지어낸 근거 금지).
 *  - 참·거짓 수가 정답과 맞아야 한다(내용일치: 참 1, 내용불일치: 거짓 1, 일치개수: 거짓 수 = 정답).
 *  - 제목·주제: 흠 없는(none) 보기가 정확히 하나이고 그것이 정답이어야 한다.
 */
function checkChoicePlan(raw: Record<string, unknown>, option: QuestionTypeOption, passage: string): string | null {
  const plan = Array.isArray(raw.choicePlan) ? (raw.choicePlan as Array<Record<string, unknown>>) : null;
  if (!plan || plan.length === 0) {
    if (process.env.QG_DEBUG_PLAN === "1") console.log("[plan-missing]", option.type, JSON.stringify(raw).slice(0, 600));
    return "보기 계획(choicePlan)이 없습니다. 보기마다 근거를 먼저 적습니다.";
  }
  const key = Number(String(raw.correctAnswer ?? "").replace(/[^0-9]/g, ""));
  if (CONTENT_PLAN_TYPES.has(option.type)) {
    const p = planNorm(passage);
    for (const row of plan) {
      // 상은 두 문장을 잇는 사실도 낸다 — 「 / 」로 나눈 인용을 하나씩 대조한다
      const parts = String(row.quote ?? "").split(/\s+\/\s+/).filter((s) => s.trim());
      if (parts.length === 0) return `보기 ${row.n}의 근거 인용이 없습니다. 지문 문장에서 그대로 옮깁니다.`;
      for (const part of parts) {
        const q = planNorm(part);
        if (q.split(" ").length < 4) return `보기 ${row.n}의 근거 인용이 너무 짧습니다. 지문 문장에서 그대로 옮깁니다.`;
        if (!p.includes(q)) return `보기 ${row.n}의 근거 인용 「${part.slice(0, 60)}」이 지문에 없습니다. 지문에서 글자 그대로 옮깁니다.`;
      }
      // 거짓 보기는 바꾼 의미 요소가 있어야 한다(「언급 없음」·덧붙이기로 만든 거짓을 막는다)
      if (String(row.verdict ?? "").toLowerCase().startsWith("f") && option.type !== "content_count") {
        if (/^\s*none/i.test(String(row.change ?? ""))) return `보기 ${row.n}은 거짓이라면서 바꾼 의미 요소가 없습니다. 원문 사실에서 요소 하나를 바꿔 원문으로 반박되게 합니다.`;
      }
    }
    /*
     * 상은 두 문장을 잇는 보기를 권하기만 한다. 코드로 강제했더니(2차 40문항 시험 2026-10-04) 모델이 인용을
     * 둘로 적지 않아 상 문항 대부분을 2~3번씩 다시 만들었고 원가가 문항당 101원(1.1배)이 됐다.
     */
    const verdicts = plan.map((r) => String(r.verdict ?? "").toLowerCase());
    const falses = plan.filter((_, i) => verdicts[i]!.startsWith("f"));
    const trues = plan.filter((_, i) => verdicts[i]!.startsWith("t"));
    if (option.type === "content_true") {
      if (trues.length !== 1) return `내용일치는 참인 보기가 하나여야 하는데 계획에서 참이 ${trues.length}개입니다.`;
      if (Number(trues[0]!.n) !== key) return `계획에서 참인 보기는 ${trues[0]!.n}번인데 정답은 ${key}번입니다.`;
    } else if (option.type === "content_false") {
      if (falses.length !== 1) return `내용불일치는 거짓인 보기가 하나여야 하는데 계획에서 거짓이 ${falses.length}개입니다.`;
      if (Number(falses[0]!.n) !== key) return `계획에서 거짓인 보기는 ${falses[0]!.n}번인데 정답은 ${key}번입니다.`;
    } else if (falses.length !== key) {
      return `계획에서 거짓인 진술은 ${falses.length}개인데 정답은 ${key}개입니다.`;
    }
    return null;
  }
  if (GIST_PLAN_TYPES.has(option.type)) {
    const clean = plan.filter((r) => /^none/i.test(String(r.flaw ?? "").trim()));
    if (clean.length !== 1) return `흠 없는 보기가 하나여야 하는데 계획에서 ${clean.length}개입니다. 오답마다 한 군데를 분명히 어긋나게 합니다.`;
    if (Number(clean[0]!.n) !== key) return `계획에서 흠 없는 보기는 ${clean[0]!.n}번인데 정답은 ${key}번입니다.`;
    if (option.type === "title") return checkTitleSubject(raw, key, passage);
  }
  return null;
}

/*
 * 제목 정답에 글감 낱말이 들어 있는지(전수조사 2026-10-04: 제목 정답 17%가 무슨 글인지 안 드러남).
 * 글감 낱말은 지문에 있는 말이어야 하고, 정답에 그 낱말(어형 변화 포함)이 있어야 한다.
 * 어형은 앞부분으로 맞춘다(animation → Animated, saving → Savings, residency → Residence).
 */
/*
 * 정답에만 극단어가 있으면 지문 없이 골라진다(내용일치 전수조사 2026-10-04: 「정답 ④만 always」,
 * 「정답에만 반드시」). 정답 혼자 극단어를 가지면 다시 만든다.
 */
const EXTREME_WORD = /\b(always|never|only|entirely|completely|invariably|solely|whenever)\b|항상|언제나|반드시|오직|전혀|결코|오로지|무조건/i;
function extremeWordGiveaway(raw: Record<string, unknown>): string | null {
  const key = Number(String(raw.correctAnswer ?? "").replace(/[^0-9]/g, ""));
  const choices = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
  if (choices.length < 2) return null;
  const hits = choices.filter((c) => EXTREME_WORD.test(String(c.text ?? "")));
  if (hits.length === 1 && Number(hits[0]!.number) === key) {
    const word = String(hits[0]!.text).match(EXTREME_WORD)?.[0];
    return `정답 보기에만 극단어 「${word}」가 있어 지문 없이도 골라집니다. 정답에서 빼거나, 다른 보기에도 지문과 맞는 정도어를 고르게 씁니다.`;
  }
  return null;
}

/**
 * 2026-10-11 90문항 점검: 「Just-noticeable difference (JND)」를 풀어 쓴 문장이 빈칸이 되고 보기는 「the JND」만 써서
 * 학생 지문 어디에도 약어 뜻이 없었다. 약어를 풀어 쓴 곳이 빈칸에 들어갔는데 지문·보기에 약어가 남으면 다시 만든다.
 */
export function blankedAbbreviation(raw: Record<string, unknown>, passage: string): string | null {
  const modified = String(raw.passageModified ?? "");
  if (!modified) return null;
  const choices = Array.isArray(raw.choices) ? (raw.choices as Array<{ text?: unknown }>).map((c) => String(c.text ?? "")) : [];
  for (const m of passage.matchAll(/\(([A-Z]{2,6})s?\)/g)) {
    const ab = m[1]!;
    if (modified.includes(`(${ab})`) || modified.includes(`(${ab}s)`)) continue;
    const used = new RegExp(`\\b${ab}s?\\b`);
    const inChoices = choices.filter((c) => used.test(c));
    // 보기마다 풀어 쓴 말을 함께 적었으면 뜻이 드러난다
    if (inChoices.length > 0 && inChoices.every((c) => c.includes(`(${ab}`))) continue;
    if (used.test(modified) || inChoices.length > 0) {
      return `약어 ${ab}를 풀어 쓴 문장이 빈칸에 들어가 학생 지문 어디에도 ${ab}의 뜻이 없습니다. 그 문장 말고 다른 문장을 빈칸으로 하거나, 보기에 풀어 쓴 말을 함께 씁니다.`;
    }
  }
  return null;
}

/**
 * 2026-11-12 시험 작업(de0a4775 B36): 요약표 정답 capacity 가 같은 표의 줄 이름 「Capacity」와 옆 칸 「no such capacity」에
 * 그대로 있었다 — 표만 보고 답을 쓴다. 정답 낱말이 표의 다른 자리에 같은 꼴로 있으면 다시 만든다.
 */
export function summaryTableAnswerLeak(rows: string[][], correctAnswer: string): string | null {
  const answers = [...correctAnswer.matchAll(/\(([A-C])\)\s*:?\s*([A-Za-z'’-]+)/g)].map((m) => ({ mark: m[1]!, word: m[2]!.toLowerCase() }));
  const text = rows.map((r) => r.join(" | ")).join("\n").toLowerCase();
  for (const a of answers) {
    if (a.word.length < 4) continue;
    if (new RegExp(`\\b${a.word.replace(/[^a-z'’-]/g, "")}\\b`).test(text)) {
      return `요약표 (${a.mark})의 정답 「${a.word}」가 표의 다른 칸이나 줄 이름에 그대로 적혀 있어 표만 보고 답할 수 있습니다. 줄 이름과 다른 칸에서는 그 낱말을 쓰지 않습니다.`;
    }
  }
  return null;
}

/**
 * 2026-11-12 점검(1d076c9f C57): 지문의 마지막 문장 「The following story illustrates how these different voting methods work.」를
 * 빈칸으로 지웠다 — 뒤에 올 글을 예고하는 문장이라 학생 지문에는 근거가 없고, 앞 문장에 이어지는 오답이 정답처럼 읽혔다.
 * 빈칸이 지문 맨 끝이고 지운 원문 문장이 「다음에 올 내용」을 가리키면 다시 만든다.
 */
export function blankedForwardPointer(raw: Record<string, unknown>, passage: string): string | null {
  const modified = String(raw.passageModified ?? "").replace(/<[^>]+>/g, "").trim();
  if (!/_{3,}[\s.?!"”’)]*$/.test(modified)) return null;
  const sentences = passage.replace(/\s+/g, " ").trim().split(/(?<=[.?!]["”’)]?)\s+(?=[A-Z"“‘(])/);
  const last = sentences[sentences.length - 1] ?? "";
  if (/\b(following|below|as follows)\b|\bnext (story|example|section|part|passage|paragraph)\b/i.test(last)) {
    return "빈칸으로 지운 마지막 문장이 뒤에 이어질 글을 예고하는 문장이라(following·below) 학생 지문 안에 근거가 없습니다. 글의 내용을 담은 다른 문장을 빈칸으로 합니다.";
  }
  return null;
}

/**
 * 2026-11-12 점검(1d076c9f B48): 문장삽입 ⑤가 지문 맨 끝(마지막 문장 뒤)에 놓였다 — 삽입문을 뺀 지문이 5문장뿐이라
 * 번호가 끝까지 밀린 것. 시험에서는 자리 번호가 문장 사이(또는 첫 문장 앞)에만 온다.
 * 맨 끝 ⑤를 지우고 ①을 첫 문장 앞에 두어 한 칸씩 민다(정답·해설 번호도 함께). 버리지 않고 고친다.
 * 정답이 맨 끝 자리면(삽입문이 글의 마지막 문장) 고칠 수 없어 까닭을 돌려준다.
 */
export function moveEndInsertionSlot(payload: { passageModified?: string | null; correctAnswer?: unknown; explanation?: string | null }): string | null {
  const text = String(payload.passageModified ?? "");
  const m = text.match(/\s*\(?\s*⑤\s*\)?\s*$/);
  if (!m) return null;
  const marks = [...text.matchAll(/[①②③④⑤]/g)].map((x) => x[0]).join("");
  if (marks !== "①②③④⑤") return null;
  const key = Number(String(payload.correctAnswer ?? "").replace(/[^0-9]/g, ""));
  if (key === 5) return "삽입문이 글의 마지막 문장이라 ⑤가 지문 맨 끝에 놓입니다. 글 가운데 문장을 삽입문으로 고릅니다.";
  if (!(key >= 1 && key <= 4)) return null;
  const paren = /\(\s*①\s*\)/.test(text);
  const next: Record<string, string> = { "①": "②", "②": "③", "③": "④", "④": "⑤" };
  const body = text.slice(0, m.index).replace(/[①②③④]/g, (c) => next[c]!);
  payload.passageModified = `${paren ? "( ① )" : "①"} ${body.trimStart()}`;
  payload.correctAnswer = typeof payload.correctAnswer === "number" ? key + 1 : String(key + 1);
  if (payload.explanation) payload.explanation = String(payload.explanation).replace(/[①②③④]/g, (c) => next[c]!);
  return null;
}

/**
 * 2026-10-12 점검(a27935eb A18): 「This is the Bronx in the New York of the early 1970s, …」를 빈칸으로 지웠는데
 * 정답 보기가 「among diverse Bronx residents」였다 — Bronx는 학생 지문 어디에도 없다.
 * 정답 보기의 고유명사(문장 가운데 대문자 낱말)·연도가 원문에는 있고 빈칸 뚫린 지문에는 없으면 다시 만든다.
 */
export function blankedOnlyNameInKey(raw: Record<string, unknown>, passage: string): string | null {
  const modified = String(raw.passageModified ?? "");
  if (!modified) return null;
  const key = Number(String(raw.correctAnswer ?? "").replace(/[^0-9]/g, ""));
  const choices = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
  const keyText = String(choices.find((c) => Number(c.number) === key)?.text ?? "");
  if (!keyText) return null;
  // 정답이 지운 원문 문장 그대로면(하 난이도의 원문 정답) 따지지 않는다
  const flat = (t: string) => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
  if (flat(keyText).length > 20 && flat(passage).includes(flat(keyText))) return null;
  // 연결어 빈칸(「However …… For example」)·여러 문장 보기는 조각마다 첫 낱말을 문장 머리로 본다
  const names = keyText.split(/……|…|\.\.\.|[.!?;:]\s+/).flatMap((seg) => {
    const words = seg.match(/[A-Za-z][A-Za-z’'-]*|\d{4}s?/g) ?? [];
    return words.filter((w, i) => (i > 0 && /^[A-Z][a-z]/.test(w) && w !== "I") || /^(?:1[5-9]|20)\d\ds?$/.test(w));
  });
  for (const w of names) {
    const base = w.replace(/[’']s$/, "");
    // base는 영문자·숫자·붙임표·홑따옴표뿐이라 정규식 특수문자가 없다
    const re = new RegExp(`(?<![A-Za-z0-9])${base}(?![A-Za-z0-9])`);
    if (re.test(passage) && !re.test(modified)) {
      return `정답 보기의 「${base}」는 빈칸으로 지운 문장에만 있어 학생 지문에서 찾을 수 없습니다. 보이는 지문에 있는 말로 정답을 쓰거나, 다른 문장을 빈칸으로 합니다.`;
    }
  }
  return null;
}

/**
 * 2026-10-12 점검: 함축의미 해설에 지문과 상관없는 「두 가지 기능을 하는 발언이라는 사전적 풀이가 아니다」가 들어갔다
 * (해설 지시의 예시가 새어 나옴). 지문에 two·both·dual·double이 없는데 해설이 「두 가지 기능」류를 말하면 다시 만든다.
 */
const DUAL_FUNCTION_EXPLANATION = /두\s*가지\s*(?:기능|역할|일|목적)|두\s*기능|이중\s*(?:기능|역할)|일석이조|일거양득/;
export function dualFunctionLeak(raw: Record<string, unknown>, passage: string): string | null {
  const m = String(raw.explanation ?? "").match(DUAL_FUNCTION_EXPLANATION);
  if (!m) return null;
  if (/\b(?:two|both|dual|double|twofold|twice)\b/i.test(passage)) return null;
  return `해설의 「${m[0]}」는 이 지문에 없는 말입니다. 밑줄의 뜻은 이 지문의 내용으로만 풀이합니다.`;
}

const SUBJECT_STOP = new Set(["the", "and", "for", "with", "how", "why", "what", "its", "their", "about", "people", "thing", "things", "way", "ways", "role"]);
function checkTitleSubject(raw: Record<string, unknown>, key: number, passage: string): string | null {
  const gp = (raw.gistPlan ?? {}) as Record<string, unknown>;
  const list = Array.isArray(gp.subjectWords) ? gp.subjectWords.map(String) : String(gp.subjectWords ?? "").split(/[,;/]/);
  const tokens = [...new Set(list.flatMap((w) => planNorm(w).split(" ")))].filter((w) => w.length >= 3 && !SUBJECT_STOP.has(w));
  if (tokens.length === 0) return "gistPlan.subjectWords(지문에서 옮긴 글감 낱말)가 없습니다.";
  const stem = (w: string) => w.slice(0, Math.max(4, w.length - 3));
  const passageWords = planNorm(passage).split(" ");
  const inPassage = tokens.filter((t) => passageWords.some((p) => p.startsWith(stem(t))));
  if (inPassage.length === 0) return `글감 낱말(${tokens.join(", ")})이 지문에 없습니다. 지문에 실제로 쓰인 글감 낱말을 고릅니다.`;
  const choices = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
  const keyText = String(choices.find((c) => Number(c.number) === key)?.text ?? "");
  /*
   * 정답 제목 「From X to Y」(2026-11-12 시험): 비교·주장하는 글인데 변화처럼 읽히거나 무엇에서 무엇으로인지 흐렸다
   * ("From Intense Happiness to Frequent Small Joys", "From Mine Stairs To Everyday Innovations That Ease Work").
   * 저장된 제목 정답 70개 중 5개가 이 꼴이고 그중 3개가 조건부였다.
   */
  if (/^\s*from\b/i.test(keyText)) {
    return `정답 제목 「${keyText.slice(0, 80)}」이 「From X to Y」 꼴이라 뜻이 흐립니다. 글감과 필자가 하는 말을 그대로 드러내는 꼴(How/Why …, 「글감: 하는 말」, 명사구)로 씁니다.`;
  }
  const keyWords = planNorm(keyText).split(" ");
  if (!inPassage.some((t) => keyWords.some((k) => k.startsWith(stem(t))))) {
    return `정답 제목 「${keyText.slice(0, 80)}」에 글감(${inPassage.join(", ")})이 없어 무슨 글인지 드러나지 않습니다. 글감을 쉬운 말 그대로 넣고 필자의 말을 붙입니다(비유 금지).`;
  }
  return null;
}

const NO_SHUFFLE_TYPES = new Set([
  "vocabulary",
  "grammar",
  "irrelevant_sentence",
  "sentence_insertion",
  "content_count",
]);

const COUNT_CHOICES = [
  { number: 1, text: "1개" },
  { number: 2, text: "2개" },
  { number: 3, text: "3개" },
  { number: 4, text: "4개" },
  { number: 5, text: "5개" },
];

const CIRCLED = ["①", "②", "③", "④", "⑤"];
const LETTERED = ["ⓐ", "ⓑ", "ⓒ", "ⓓ", "ⓔ"];

function parseChoiceAnswer(raw: unknown): number | null {
  if (typeof raw === "number" && raw >= 1 && raw <= 5) return raw;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^([1-5])/);
    if (m) return Number(m[1]);
    const ci = CIRCLED.indexOf(raw.trim());
    if (ci >= 0) return ci + 1;
  }
  return null;
}

/**
 * 객관식 선택지를 섞고, 정답 번호와 해설의 번호를 함께 다시 매긴다 (① 편향 방지).
 *
 * 선생님과 함께 전수조사(2026-09-29): 해설이 정답 번호를 오답처럼 설명하는 문항이
 * 객관식 2,352개 가운데 611개(26%)였다. 까닭은 섞은 뒤 해설에서 <b>정답 기호만</b>
 * 바꾸고 나머지 오답 기호는 그대로 둔 것이다. 정답이 ①에서 ④으로 갔다면 해설의
 * ①만 ④으로 바뀌어, 원래 ④이던 오답 설명과 번호가 겹치고 ① 자리 선택지의 설명은
 * 사라졌다.
 *
 * 이제 자리바꿈 전체를 해설에 적용한다. 한 번에 바꿔야 서로 덮어쓰지 않는다.
 */
function shuffleObjectiveChoices(
  choices: Array<{ number: number; text: string }>,
  correctAnswer: number,
  explanation: string
): {
  choices: Array<{ number: number; text: string }>;
  correctAnswer: number;
  explanation: string;
} {
  const n = choices.length;
  if (n < 2 || correctAnswer < 1 || correctAnswer > n) {
    return { choices, correctAnswer, explanation };
  }

  const before = choices.map((c) => c.text);
  const texts = [...before];
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = texts[i]!;
    texts[i] = texts[j]!;
    texts[j] = tmp;
  }

  // 섞기 전 번호 → 섞은 뒤 번호. 같은 글이 둘이면 앞에서부터 하나씩 짝지어 준다.
  const taken = new Array<boolean>(texts.length).fill(false);
  const oldToNew = new Map<number, number>();
  before.forEach((text, oldIdx) => {
    const newIdx = texts.findIndex((t, k) => !taken[k] && t === text);
    if (newIdx >= 0) {
      taken[newIdx] = true;
      oldToNew.set(oldIdx + 1, newIdx + 1);
    }
  });

  const newCorrect = oldToNew.get(correctAnswer) ?? correctAnswer;
  const newChoices = texts.map((text, i) => ({ number: i + 1, text }));

  let nextExplanation = explanation;
  if (explanation && [...oldToNew.entries()].some(([a, b]) => a !== b)) {
    /*
     * ①~⑤와 숫자로 적은 번호를 <b>한 번에</b> 바꾼다. 나눠서 바꾸면 방금 바꾼 것을
     * 또 바꾸게 된다.
     *
     * 선생님과 함께 전수조사(2026-09-29): 해설이 「3번이 알맞다」처럼 그냥 「N번」으로
     * 적은 문항이 84개였는데 그 가운데 65개(77%)가 정답 번호와 달랐다. 빈칸추론이
     * 79개 중 60개로 가장 심했다. 「정답: N」 꼴만 바꾸고 「N번」은 두었기 때문이다.
     */
    /*
     * 「①~④는 일치」 같은 범위는 번호를 하나씩 바꾸면 「③~①」처럼 뜻이 없어진다(내용일치 전수조사
     * 2026-10-04). 범위를 먼저 「①·②·③·④」로 풀고, 바꾼 뒤 나열을 번호 순으로 다시 놓는다.
     */
    const expanded = explanation.replace(/([①-⑤])\s*[~∼～\-–]\s*([①-⑤])/g, (whole, a: string, b: string) => {
      const from = CIRCLED.indexOf(a);
      const to = CIRCLED.indexOf(b);
      return from < to ? CIRCLED.slice(from, to + 1).join("·") : whole;
    });
    nextExplanation = expanded.replace(
      /([①-⑤])|((?:정답\s*[:：]?|답\s*[:：])\s*)([1-5])(\s*번?)|(?<!\d)([1-5])(\s*번)/g,
      (
        whole,
        circled: string | undefined,
        head: string | undefined,
        headNum: string | undefined,
        headTail: string | undefined,
        plainNum: string | undefined,
        plainTail: string | undefined
      ) => {
        if (circled) {
          const to = oldToNew.get(CIRCLED.indexOf(circled) + 1);
          return to ? CIRCLED[to - 1]! : whole;
        }
        if (headNum) {
          const to = oldToNew.get(Number(headNum));
          return to ? `${head}${to}${headTail}` : whole;
        }
        if (plainNum) {
          const to = oldToNew.get(Number(plainNum));
          return to ? `${to}${plainTail}` : whole;
        }
        return whole;
      }
    );
    /*
     * 「③·①·⑤」처럼 섞인 나열은 번호 순으로. 다만 「①·②·④·⑤는 각각 A, B, C, D」처럼 뒤 설명과
     * 차례로 짝지은 나열은 정렬하면 짝이 어긋난다(10-07 발곡고1 내용불일치 3문항) — 그대로 둔다.
     */
    nextExplanation = nextExplanation.replace(/[①-⑤](?:\s*[·,]\s*[①-⑤])+(?!\s*[·,]\s*[①-⑤])(?!\s*(?:은|는|이|가|도)?\s*각각)/g, (run) => {
      const sep = run.includes("·") ? "·" : ", ";
      return [...run.matchAll(/[①-⑤]/g)].map((m) => m[0]).sort((a, b) => CIRCLED.indexOf(a) - CIRCLED.indexOf(b)).join(sep);
    });
  }

  return {
    choices: newChoices,
    correctAnswer: newCorrect,
    explanation: nextExplanation,
  };
}

function hasHangul(text: string): boolean {
  return /[\uAC00-\uD7A3]/.test(text || "");
}

function normalizePayload(
  raw: Record<string, unknown>,
  option: QuestionTypeOption,
  passage: string,
  forcedInstruction: string
): GeneratedQuestionPayload {
  let choices = Array.isArray(raw.choices)
    ? raw.choices
        .map((c, i) => {
          const row = (c ?? {}) as Record<string, unknown>;
          return {
            number: typeof row.number === "number" ? row.number : i + 1,
            text: String(row.text ?? ""),
          };
        })
        .filter((c) => c.text.trim())
    : undefined;

  // 일치개수·문장삽입·무관·어휘/어법 추론: 하단 선택지 없음 (본문 표지가 보기)
  if (
    option.type === "content_count" ||
    option.type === "sentence_insertion" ||
    option.type === "irrelevant_sentence" ||
    (option.type === "vocabulary" && option.aingkaCode === "어휘추론") ||
    (option.type === "grammar" &&
      (option.aingkaCode === "어법추론" ||
        option.aingkaCode === "어법모두고르기"))
  ) {
    choices = undefined;
  }

  // 어법/어휘 개수: 보기 고정 1개~5개 (모델이 2개·5개만 내는 것 방지)
  if (
    (option.type === "grammar" && option.aingkaCode === "어법개수") ||
    (option.type === "vocabulary" && option.aingkaCode === "어휘개수")
  ) {
    choices = COUNT_CHOICES.map((c) => ({ ...c }));
  }

  let correctAnswer: string | number | number[] = raw.correctAnswer as
    | string
    | number
    | number[];
  let explanation = String(raw.explanation ?? "");

  if (option.type === "content_count") {
    const n =
      typeof correctAnswer === "number"
        ? correctAnswer
        : parseInt(String(correctAnswer ?? "").replace(/[^\d]/g, ""), 10);
    correctAnswer = Number.isFinite(n) ? String(n) : "0";
  } else if (
    (option.type === "grammar" && option.aingkaCode === "어법개수") ||
    (option.type === "vocabulary" && option.aingkaCode === "어휘개수")
  ) {
    const text = String(correctAnswer ?? "").trim();
    const match = text.match(/^([1-5])\s*(?:개)?$/);
    const n =
      typeof correctAnswer === "number" && Number.isInteger(correctAnswer)
        ? correctAnswer
        : match
          ? Number(match[1])
          : 0;
    // 잘못된 값을 1이나 5로 조용히 고치지 않는다. 아래 형태 검수에서 실패시킨다.
    correctAnswer = n;
  } else {
    const parsed = parseChoiceAnswer(correctAnswer);
    if (
      option.isObjective &&
      choices &&
      choices.length >= 2 &&
      !NO_SHUFFLE_TYPES.has(option.type)
    ) {
      const before = parsed ?? 1;
      const shuffled = shuffleObjectiveChoices(choices, before, explanation);
      choices = shuffled.choices;
      correctAnswer = shuffled.correctAnswer;
      explanation = shuffled.explanation;
    } else if (correctAnswer == null) {
      correctAnswer = parsed ?? 1;
    } else if (parsed != null) {
      correctAnswer = parsed;
    }
  }

  let passageModified =
    typeof raw.passageModified === "string" ? raw.passageModified : undefined;

  // 함축·어법·어휘·지칭서술: markdown 밑줄을 <u>로 정규화
  if (
    (option.type === "underlined_inference" &&
      option.aingkaCode === "함축의미추론") ||
    (option.type === "grammar" &&
      (option.aingkaCode === "어법추론" ||
        option.aingkaCode === "어법모두고르기" ||
        option.aingkaCode === "어법개수")) ||
    (option.type === "vocabulary" &&
      (option.aingkaCode === "어휘추론" || option.aingkaCode === "어휘개수")) ||
    (option.type === "writing" &&
      (option.aingkaCode === "지칭대명사서술" ||
        option.aingkaCode === "특정표현의미서술")) ||
    (option.type === "grammar" &&
      (option.aingkaCode === "어법오류수정2" ||
        option.aingkaCode === "어법오류수정3" ||
        option.aingkaCode === "어법문장오류수정"))
  ) {
    if (passageModified) {
      passageModified = passageModified
        .replace(/<\/?underline>/gi, (m) =>
          m.startsWith("</") ? "</u>" : "<u>"
        )
        .replace(/__(.+?)__/g, "<u>$1</u>")
        .replace(/\*\*(.+?)\*\*/g, "<u>$1</u>");
      // 해설이 고치라는 말이 밑줄 밖이면 밑줄을 넓힌다(2026-10-28 have been | declined)
      if (
        option.type === "grammar" &&
        (option.aingkaCode === "어법추론" ||
          option.aingkaCode === "어법모두고르기" ||
          option.aingkaCode === "어법개수")
      ) {
        passageModified = widenUnderlineToWrongText(passageModified, explanation);
      }
    }
  }

  let instructionOut = forcedInstruction;
  if (
    option.type === "underlined_inference" &&
    option.aingkaCode === "함축의미추론" &&
    passageModified
  ) {
    const um = passageModified.match(/<u>([\s\S]*?)<\/u>/i);
    const phrase = (um?.[1] || "").replace(/\s+/g, " ").trim();
    if (phrase) {
      if (!/\(A\)\s*<u>/i.test(passageModified)) {
        passageModified = passageModified.replace(/<u>/i, "(A)<u>");
      }
      instructionOut = `다음 글의 밑줄 친 (A) ${phrase}가 의미하는 바로 가장 적절한 것은?`;
    }
  }
  if (
    option.type === "writing" &&
    option.aingkaCode === "지칭대명사서술" &&
    passageModified
  ) {
    const um = passageModified.match(
      /ⓐ\s*<u>([\s\S]*?)<\/u>|<u>([\s\S]*?)<\/u>/i
    );
    const pronoun = (um?.[1] || um?.[2] || "it").replace(/\s+/g, " ").trim();
    if (!/ⓐ\s*<u>/i.test(passageModified) && /<u>/i.test(passageModified)) {
      passageModified = passageModified.replace(/<u>/i, "ⓐ<u>");
    }
    const ansWord = String(correctAnswer ?? "")
      .replace(/^ⓐ\s*[:：]?\s*/i, "")
      .trim();
    const n = Math.max(1, countEnglishWords(ansWord) || 1);
    instructionOut =
      n === 1
        ? `다음 글의 밑줄 친 ⓐ${pronoun}이 가리키는 바를 본문에서 정확히 찾아 한 단어의 영어로 쓰시오.`
        : `다음 글의 밑줄 친 ⓐ${pronoun}이 가리키는 바를 본문에서 정확히 찾아 ${n}단어의 영어로 쓰시오.`;
  }
  if (
    option.type === "writing" &&
    option.aingkaCode === "특정표현의미서술" &&
    passageModified
  ) {
    const um = passageModified.match(/<u>([\s\S]*?)<\/u>/i);
    const expr = (um?.[1] || "").replace(/\s+/g, " ").trim();
    const ansPhrase = String(correctAnswer ?? "")
      .replace(/^ⓐ\s*[:：]?\s*/i, "")
      .trim();
    const n = Math.max(1, countEnglishWords(ansPhrase) || 1);
    if (expr) {
      instructionOut = `다음 글의 밑줄 친 ${expr}가 문맥상 의미하는 바를 본문에서 찾아 ${n}단어의 영어로 쓰시오.`;
    }
  }

  return {
    type: option.type,
    category: option.category,
    difficulty: option.difficulty,
    choiceLanguage: option.choiceLanguage,
    passageOriginal: passage,
    // 모델이 틀린 자리를 <b>로 감싸 보내는 일이 있다 — 화면에 글자 그대로 찍히고 답이 드러난다
    passageModified: passageModified ? passageModified.replace(/<\/?b>/gi, "") : passageModified,
    instruction: instructionOut,
    questionText: stripRepeatedInstruction(
      cleanQuestionText(String(raw.questionText ?? "")),
      instructionOut
    ),
    choices,
    correctAnswer,
    acceptableAnswers: Array.isArray(raw.acceptableAnswers)
      ? raw.acceptableAnswers.map((x) => String(x))
      : undefined,
    /*
     * 선생님 지적(2026-09-29): 해설지에 "맞다."와 "맞습니다."가 섞여 나와 헷갈린다.
     * 프롬프트로도 시키지만 이따금 존댓말로 돌아가므로 내보내기 전에 어미를 고른다.
     */
    explanation: plainKorean(explanation),
    hardWords: questionNeedsVocabGloss({
      choices,
      questionType: option.type,
      optionKey: option.key,
      questionText: String(raw.questionText ?? ""),
      choiceLanguage: option.choiceLanguage,
    })
      ? normalizeHardWordsFromRaw(raw.hardWords)
      : [],
    evidence: [],
    scoringGuide:
      raw.scoringGuide && typeof raw.scoringGuide === "object"
        ? (raw.scoringGuide as GeneratedQuestionPayload["scoringGuide"])
        : undefined,
  };
}

/** 정답 숫자가 「몇 번째 기호」를 뜻하는 유형(개수형은 아니다) */
function answerIsMarkIndex(option: QuestionTypeOption): boolean {
  return (
    option.aingkaCode === "어휘추론" ||
    option.aingkaCode === "어법추론" ||
    option.aingkaCode === "어법모두고르기"
  );
}

/**
 * 해설에서 「A를 B로 바꾼다」는 주장을 뽑는다(소문자 쌍).
 *  - 화살표: confirm → confirmed
 *  - 한 낱말: confirm은 과거의 일을 나타내도록 confirmed로 바뀐다
 *  - 여러 낱말: instrument, signal, one을 각각 instruments, signals, ones로 바꾸어
 */
export function formChangeClaims(explanation: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const W = "[A-Za-z'’]+";
  for (const m of explanation.matchAll(new RegExp(`(${W})\\s*(?:→|->|⇒)\\s*(${W})`, "g"))) out.push([m[1]!, m[2]!]);
  for (const m of explanation.matchAll(
    new RegExp(`((?:${W},\\s*)+${W})\\s*(?:을|를)\\s*각각\\s*((?:${W},\\s*)+${W})\\s*(?:으로|로)`, "g")
  )) {
    const a = m[1]!.split(/,\s*/);
    const b = m[2]!.split(/,\s*/);
    if (a.length === b.length) a.forEach((x, i) => out.push([x, b[i]!]));
  }
  for (const m of explanation.matchAll(
    // 사이에 다른 영어 낱말이 끼면 다른 낱말 이야기다(「confirmed를 꾸미며, confirm은 … confirmed로」)
    new RegExp(`(${W})(?:은|는|이|가|을|를)\\s+[^.。A-Za-z]{0,40}?(${W})\\s*(?:으로|로)\\s*(?:바뀌|바뀐|바뀝|바꾸|바꾼|바꿉|바꿔|고쳐|고친|변)`, "g")
  )) {
    out.push([m[1]!, m[2]!]);
  }
  return out.map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]);
}

export function assertBasicQuestionShape(
  q: GeneratedQuestionPayload,
  option: QuestionTypeOption,
  /** 지정 문법을 지문에서 찾았는지, 고쳐 썼는지 (선생님 요청 2026-09-29) */
  writingMode: "passage" | "paraphrase" = "paraphrase",
  /** 제시어 배열을 지문 그대로 냈는지 (기본: 지문 그대로) */
  wordOrderMode: "passage" | "paraphrase" = "passage",
  /** 어법·어휘에서 지문을 그대로 두어야 하는지 (재진술을 껐으면 그대로) */
  keepPassage = true,
  /** 같은 유형이 작업 전체에서 몇 번째인가 — 만들 때 박아 준 개수와 맞춰 본다 */
  turn = 0,
  /** 박아 준 정답(개수·번호)과 맞춰 볼지. 다시 만들 때는 문항 자체만 맞으면 받는다 */
  planAnswer = true
): string | null {
  if (!q.instruction.trim()) return "발문이 비어 있습니다.";
  if (!q.explanation.trim()) return "해설이 비어 있습니다.";
  /*
   * 모델 출력이 깨진 경우를 거른다(12차 시험 2026-10-04: 해설에 「종이 아닌」이 수백 번 되풀이되고 말라얄람 문자가
   * 섞임). 한글·영문·숫자·문장부호·번호 기호 밖의 문자(인도·아랍·태국 문자 등)나 같은 토막의 반복을 본다.
   */
  {
    const allText = [q.explanation, q.questionText ?? "", ...(q.choices ?? []).map((c) => c.text)].join("\n");
    if (/[֐-ࣿऀ-෿฀-໿Ⴀ-ჿͰ-ϿЀ-ӿ]/.test(allText)) {
      return "해설·보기에 한글·영문 밖의 문자가 섞였습니다. 출력이 깨졌으니 다시 씁니다.";
    }
    const chunk = q.explanation.match(/([\s\S]{6,40}?)\1{4,}/);
    if (chunk || q.explanation.length > 3000) {
      return "해설에 같은 말이 되풀이됩니다. 출력이 깨졌으니 다시 씁니다.";
    }
  }
  /*
   * 보기 낱말 수준을 우리 EngCore 단어장에 맞춘다(선생님 말 2026-10-04: 「우리 단어장이랑 레벨을 맞춰 봐도 좋을 듯」).
   * 단어장에도 지문에도 없는 낱말이 하는 3개, 상은 4개 이상이면 그 낱말을 알려 주고 다시 만든다.
   * 10차 시험에서 상 25문항 중 9문항이 4개 이상이었다(rapport, affinity, vulnerability, arable …).
   */
  const wordLevelTypes = /^(title|topic|content_true|content_false|content_count|summary_mcq)$/;
  if (wordLevelTypes.test(option.type) && option.choiceLanguage !== "korean" && (option.difficulty === "low" || option.difficulty === "high")) {
    const passageWords = new Set((String(q.passageOriginal ?? "").match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((w) => w.toLowerCase()));
    const text = (q.choices ?? []).map((c) => c.text).join(" ") || String(q.questionText ?? "");
    const hard = new Set<string>();
    for (const w of text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []) {
      const l = w.toLowerCase();
      if (l.length <= 3 || /^[A-Z]/.test(w) || passageWords.has(l) || isFunctionWord(l)) continue;
      if (engcoreLevelOf(l) === null) hard.add(l);
    }
    const limit = option.difficulty === "low" ? 3 : 4;
    if (hard.size >= limit) {
      return `보기 낱말이 우리 단어장 수준을 넘습니다(${[...hard].slice(0, 6).join(", ")}). ${option.difficulty === "low" ? "하 난이도라 중학~고1 기본 어휘로" : "고교필수~수능필수 단어장 안의 낱말로"} 바꿔 씁니다.`;
    }
  }
  // 칸 제목이 두 번 나오면 학생에게 보기가 두 벌로 보인다(4차 시험 2026-10-04: <보기>·<해석>이 두 번, 조건 문구가 <해석>에 섞임)
  for (const tag of ["<조건>", "<보기>", "<해석>", "<요약문>", "<지칭답란>", "<답안행>"]) {
    if (String(q.questionText ?? "").split(tag).length - 1 > 1) return `문제 칸에 ${tag}가 두 번 들어갔습니다. 칸마다 한 번만 씁니다.`;
  }

  /*
   * 맞는 것을 틀렸다고 한 어법 문항은 버린다.
   * 「allows us to rehearse」의 to 를 떼라고 한 일이 있었다(2026-10-01 Jayden 선생님).
   * 문항 5,696개로 재 보니 이 잣대에 걸린 것은 그 한 문항뿐이었다 — 헛경보가 없다.
   */
  if (option.type === "grammar") {
    const ansText = typeof q.correctAnswer === "string" ? q.correctAnswer : "";
    const pairs = [
      ...ansText.split("/").flatMap((part) => {
        const m = part.match(/([ⓐ-ⓖ①-⑤])\s*[:：]\s*(.+)/);
        return m ? [{ mark: m[1]!, to: m[2]!.replace(/.*(?:→|->|⇒)\s*/, "").trim() }] : [];
      }),
      ...[
        ...q.explanation.matchAll(
          /([ⓐ-ⓖ①-⑤])[^→]{0,30}?(?:→|->|⇒)\s*([A-Za-z][A-Za-z' ]{0,40})/g
        ),
      ].map((m) => ({ mark: m[1]!, to: m[2]!.trim() })),
    ];
    const wrongCall = falseGrammarError(String(q.passageModified ?? ""), pairs);
    if (wrongCall) {
      return `맞는 자리를 틀렸다고 했습니다: ${wrongCall}`;
    }
  }

  /*
   * 보기가 너무 길면 문항으로 쓰기 어렵다.
   *
   * 전수조사(2026-09-30): 제시어 배열 보기가 스물여덟 개, 마흔 개까지 나온 것이
   * 일곱 개 있었다. 낱말 마흔 개를 늘어놓고 배열하라는 것은 시험 문항이 아니다.
   * 정답 문장을 짧은 것으로 고르게 다시 만든다.
   */
  {
    const box = (q.questionText || "").match(
      new RegExp("(?:^|\\n)<보기>\\s*\\n([\\s\\S]*?)(?=\\n<|$)")
    )?.[1];
    if (box) {
      const n = box.split(/\s*\/\s*|\n/).filter((w) => w.trim()).length;
      /*
       * 실제 문항을 재 보니 가운데가 12개, 95%가 20개, 가장 긴 것이 49개였다.
       * 스물다섯으로 자르면 지문에 긴 문장밖에 없는 자리에서 아예 못 만든다
       * (그 유형은 정답이 지문 문장 그대로여야 한다). 서른으로 둔다.
       */
      if (n > 30) {
        return `보기가 ${n}개나 됩니다. 서른 개를 넘지 않는 짧은 문장으로 만들어 주세요.`;
      }
    }
  }

  /*
   * 요약문 빈칸이 문장 경계를 넘으면 안 된다.
   *
   * 전수조사(2026-09-30): 정답이 「already watched. Then」처럼 마침표를 품은 것이
   * 있었다. 빈칸 하나가 두 문장에 걸쳐 있어 학생이 무엇을 쓰라는 것인지 알 수 없다.
   */
  if (option.type === "summary_short") {
    for (const part of String(q.correctAnswer ?? "").split(/\s*\/\s*/)) {
      const body = part.replace(/^[\u24D0-\u24D6]\s*[:：]\s*/, "").trim();
      if (/[.!?;]/.test(body.slice(0, -1))) {
        return "정답이 문장 경계를 넘습니다. 빈칸은 한 문장 안에서 닫아야 합니다.";
      }
    }
  }

  /*
   * 어법·어휘는 밑줄 자리 말고는 지문을 그대로 두어야 한다.
   *
   * 전수조사(2026-09-30): 재진술을 켜지 않았는데도 문장을 고쳐 쓴 것이 55개 있었다.
   * 「To find」를 「To uncover」로, 「we're」를 「we are」로 바꾸는 식이다.
   * 프롬프트에 적어 두기만 하고 확인은 안 하고 있었다.
   *
   * 밑줄 자리 낱말은 바뀌는 것이 맞으므로 열에 여덟은 남아야 한다고 본다.
   */
  if (
    keepPassage &&
    (option.type === "grammar" || option.type === "vocabulary") &&
    q.passageModified &&
    q.passageOriginal &&
    q.passageOriginal.length > 400
  ) {
    const words = (t: string) =>
      t
        .replace(/<\/?[a-z][^>]*>/gi, " ")
        .toLowerCase()
        .split(/[^a-z']+/)
        .filter((w) => w.length > 3);
    const made = words(q.passageModified);
    const from = new Set(words(q.passageOriginal));
    const kept = made.filter((w) => from.has(w)).length;
    const ratio = made.length ? kept / made.length : 1;
    if (ratio < 0.8) {
      return `지문을 고쳐 썼습니다(원문 낱말이 ${Math.round(ratio * 100)}%만 남음). 밑줄 자리 말고는 원문 그대로 두어야 합니다.`;
    }
  }

  /*
   * 밑줄 기호는 지문에 나오는 차례대로여야 한다.
   *
   * 실제 문항을 훑어보니 열여덟 개가 어긋나 있었다(2026-09-29). 심한 것은
   * ⓐ ⓕ ⓔ ⓓ ⓑ ⓒ ⓖ 차례로 찍혀, 학생이 몇 번째 밑줄인지 찾기가 어렵다.
   *
   * 예전에는 그냥 다시 만들게 했는데, 만들다 버린 값도 우리가 낸다(선생님 지적
   * 2026-10-01). 나온 차례대로 다시 매기고 정답·해설의 기호도 같이 옮긴다 —
   * 어제 옛 문항 스물한 개를 이 규칙으로 고쳤고 글자는 하나도 안 바뀌었다.
   */
  {
    const marks = "ⓐⓑⓒⓓⓔⓕⓖ①②③④⑤";
    const seen = [...String(q.passageModified ?? "").matchAll(/([ⓐ-ⓖ①-⑤])\s*<u>/g)].map((m) =>
      marks.indexOf(m[1]!)
    );
    if (seen.length >= 2 && seen.some((v, i) => i > 0 && seen[i - 1]! >= v)) {
      // 어휘추론·어법추론의 정답 숫자는 「몇 번째 기호」라 기호를 옮기면 같이 옮겨야 한다
      if (!renumberMarksInOrder(q, "passage", answerIsMarkIndex(option))) {
        return "밑줄 기호가 지문에 나오는 차례와 다릅니다.";
      }
    }
    /*
     * 요약문·표 빈칸은 본문이 아니라 묻는 글에 찍힌다. 거기도 차례를 본다.
     *
     * 선생님 지시(2026-10-01)로 문항을 하나하나 대조하다 찾았다. 요약문이
     * 「… in ⓑ____ and … where ⓐ____ …」로 거꾸로 찍혀 있었다(학원 전체 6문항).
     * 학생은 ⓐ부터 쓰는데 지면은 ⓑ가 먼저여서 헷갈린다. 글자는 안 바꾸고 기호만 옮긴다.
     */
    const inText = [...String(q.questionText ?? "").matchAll(/([ⓐ-ⓖ])\s*_{3,}/g)].map((m) =>
      marks.indexOf(m[1]!)
    );
    if (inText.length >= 2 && inText.some((v, i) => i > 0 && inText[i - 1]! >= v)) {
      renumberMarksInOrder(q, "questionText");
    }
    /*
     * 밑줄 없는 번호(문장삽입 ①~⑤, 무관한문장 ⓐ~ⓔ, 어법 문장 수정 ①~⑤)도 차례를 본다.
     *
     * 382문항 대조(2026-10-02): 문장삽입이 「② … ③ … ④ … ① … ⑤」로, 어법 문장 수정이
     * 「② … ③ … ④ … ① …」로 찍혀 나왔다. 자리를 코드가 정해 주니 모델이 번호를 자리에
     * 맞춰 찍고 나머지를 다시 매기지 않은 것이다. 글자는 두고 번호만 차례대로 옮긴다.
     */
    if (
      option.type === "sentence_insertion" ||
      option.type === "irrelevant_sentence" ||
      option.aingkaCode === "어법문장오류수정"
    ) {
      const bare = [...String(q.passageModified ?? "").matchAll(/[ⓐ-ⓖ①-⑤]/g)].map((m) =>
        marks.indexOf(m[0]!)
      );
      const distinct = bare.filter((v, i) => bare.indexOf(v) === i);
      if (distinct.length >= 2 && distinct.some((v, i) => i > 0 && distinct[i - 1]! >= v)) {
        if (!renumberMarksInOrder(q, "passage", option.aingkaCode !== "어법문장오류수정")) {
          return "번호가 지문에 나오는 차례와 다릅니다.";
        }
      }
    }
  }

  const englishBodyTypes = new Set([
    "order",
    "sentence_blank",
    "sentence_insertion",
    "irrelevant_sentence",
    "grammar",
    "vocabulary",
  ]);
  if (englishBodyTypes.has(option.type)) {
    const body = [
      q.passageModified || "",
      option.type === "sentence_insertion" ? q.questionText || "" : "",
      ...(option.type === "grammar" || option.type === "vocabulary"
        ? []
        : (q.choices ?? []).map((c) => c.text)),
    ].join("\n");
    if (hasHangul(body)) {
      return "본문·선택지는 영어여야 합니다 (한글 포함됨).";
    }
  }

  if (option.type === "sentence_insertion") {
    if (!(q.questionText || "").trim()) {
      return "문장삽입은 주어진 문장(questionText)이 필요합니다.";
    }
    const mod = q.passageModified || "";
    if (!/[①②③④⑤]/.test(mod) && !/\(\s*[1-5]\s*\)/.test(mod)) {
      return "문장삽입 본문에 ①~⑤ 위치 표시가 필요합니다.";
    }
    q.choices = undefined;
  } else if (option.type === "irrelevant_sentence") {
    const mod = q.passageModified || "";
    if (!/[ⓐⓑⓒⓓⓔ]/.test(mod) && !/[①②③④⑤]/.test(mod) && !/\([A-E]\)/.test(mod)) {
      return "무관한 문장 본문에 ⓐ~ⓔ 표지가 필요합니다.";
    }
    q.choices = undefined;
  } else if (
    option.type === "underlined_inference" &&
    option.aingkaCode === "함축의미추론"
  ) {
    const mod = q.passageModified || "";
    if (!/<u>[\s\S]*?<\/u>/i.test(mod)) {
      return "함축의미추론은 본문에 <u>밑줄</u> 표시가 필요합니다.";
    }
    if (!/\(A\)/i.test(mod)) {
      // normalizePayload에서 보정하지만, 이중 안전
      q.passageModified = mod.replace(/<u>/i, "(A)<u>");
    }
    if (!q.choices || q.choices.length < 5) {
      return "객관식 선택지가 5개 미만입니다.";
    }
    if ((q.choices ?? []).some((c) => hasHangul(c.text))) {
      return "함축의미추론 선택지는 영어여야 합니다.";
    }
    // 발문에 밑줄 표현 반영
    const um = (q.passageModified || "").match(/<u>([\s\S]*?)<\/u>/i);
    const phrase = (um?.[1] || "").replace(/\s+/g, " ").trim();
    if (phrase && !q.instruction.includes(phrase)) {
      q.instruction = `다음 글의 밑줄 친 (A) ${phrase}가 의미하는 바로 가장 적절한 것은?`;
    }
  } else if (
    option.type === "writing" &&
    (option.aingkaCode === "제시어배열기본" ||
      option.aingkaCode === "제시어배열어형변화" ||
      option.aingkaCode === "제시어배열단어추가")
  ) {
    const qt = q.questionText || "";
    if (!/<조건>/.test(qt) || !/<보기>/.test(qt) || !/<해석>/.test(qt)) {
      return "제시어 배열은 questionText에 <조건>·<보기>·<해석>이 필요합니다.";
    }
    // 빈칸이 문장 끝 마침표까지 삼켰으면 돌려준다 — 버리지 말고 고쳐 쓴다
    const moved = moveSpeakerLabelOutOfBlank(q.passageModified || "", q.passageOriginal || "", String(q.correctAnswer ?? ""));
    q.correctAnswer = moved.answer;
    const mod = closeBlankSentence(moved.passageModified);
    q.passageModified = mod;
    // 보기 낱말은 정답에서 뽑으므로 그 전에 맞춘다
    q.correctAnswer = lowercaseAnswerAfterMidBlank(mod, q.passageOriginal || "", String(q.correctAnswer ?? ""));
    if (!/ⓐ/.test(mod) || !/_{3,}/.test(mod)) {
      return "제시어 배열 본문에 ⓐ__________ 빈칸 표시가 필요합니다.";
    }
    if (hasHangul(mod)) {
      return "제시어 배열 본문은 영어여야 합니다 (한글 포함됨).";
    }
    if (!String(q.correctAnswer ?? "").trim()) {
      return "제시어 배열 정답(영어 완성문)이 필요합니다.";
    }
    q.choices = undefined;
    const woMode =
      option.aingkaCode === "제시어배열단어추가"
        ? ("add" as const)
        : option.aingkaCode === "제시어배열어형변화"
          ? ("inflect" as const)
          : ("basic" as const);
    /*
     * 어형변화 보기는 원형으로 내는데 aren't·doesn't를 be·do로만 줄여 not이 보기에서 사라졌다
     * (2026-10-13 점검 「emotions aren't just」「doesn't mean … don't know」). 보기는 풀어 쓴 정답
     * (are not)으로 만들고, 저장 정답은 아래 「지문 그대로」 대조가 끝난 뒤 풀어 쓴다.
     */
    q.questionText = normalizeWordOrderQuestionText(q.questionText || "", {
      correctAnswer:
        woMode === "inflect"
          ? expandNegativeContractions(String(q.correctAnswer ?? ""))
          : String(q.correctAnswer ?? ""),
      mode: woMode,
    });
    q.questionText = restoreLeadingProperNoun(q.questionText, String(q.correctAnswer ?? ""), q.passageOriginal || "");
    if (woMode === "inflect") {
      q.questionText = alignInflectBankToExplanation(q.questionText, q.explanation || "");
      /*
       * 어형변화는 동사만 한다(선생님 결정 2026-10-24). 명사·형용사·부사가 원형으로 남았으면 정답 꼴로 되돌린다.
       * 검수가 같은 규칙으로 걸러 내므로, 여기서 안 고치면 보기 한 낱말 때문에 다시 만들게 된다.
       */
      q.questionText = fixNonVerbBankLine(q.questionText, tokenizeAnswerPhrase(String(q.correctAnswer ?? "")), q.explanation || "");
    }
    /*
     * 선생님 지적(2026-09-29): 빈칸 옆에 정답 낱말이 그대로 남아 있는데 보기에도 같은 말이
     * 있어 중복이다. 정답 문장을 반만 지우고 나머지를 남긴 것이라 학생이 헷갈린다.
     */
    /*
     * 「지문 그대로」로 고르면 정답이 원문에 있어야 한다. 예전에는 늘 고쳐 써서
     * 제시어 배열의 96%가 원문에 없는 문장이었다(2026-09-29 확인).
     */
    if (wordOrderMode === "passage") {
      if (!passageHasConsecutiveWords(q.passageOriginal || "", String(q.correctAnswer ?? ""))) {
        return "「지문 그대로」로 만들 때는 정답이 지문에 있는 문장이어야 합니다.";
      }
      /*
       * 정답을 빈칸에 넣으면 원문이 그대로 돌아와야 한다. 원문 문장 전체를 비워 놓고 정답은 그 일부
       * (주어 없는 술부·관계절 조각)만 낸 문항이 여러 학원에서 나왔다(2026-10-03 전수 대조).
       */
      const toks = (s: string) =>
        s.toLowerCase().replace(/<\/?[ub]>/g, "").replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
      const filled = toks(mod.replace(/[ⓐ-ⓔ]?\s*_{3,}/, ` ${String(q.correctAnswer ?? "")} `));
      const orig = toks(cleanSourcePassage(q.passageOriginal || ""));
      if (filled.length && Math.abs(filled.length - orig.length) > 2) {
        return `정답을 빈칸에 넣어도 원문이 되지 않습니다(낱말 ${filled.length} / 원문 ${orig.length}). 빈칸은 정답 문장만 비워야 합니다.`;
      }
    }
    if (woMode === "inflect") {
      q.correctAnswer = expandNegativeContractions(String(q.correctAnswer ?? ""));
    }
    const bankLine = (q.questionText.match(/<보기>\s*\n([^\n]+)/) ?? [])[1] ?? "";
    let leftOver = bankWordsLeftInBlankLine(mod, bankLine);
    if (leftOver.length > 0) {
      // 남은 낱말까지 빈칸이 삼키게 넓힌다 — 버리지 말고 고쳐 쓴다
      const widened = widenBlankToSentence(mod);
      if (widened && bankWordsLeftInBlankLine(widened, bankLine).length === 0) {
        q.passageModified = widened;
        leftOver = [];
      }
    }
    if (leftOver.length > 0) {
      return `빈칸이 든 문장에 보기 낱말이 그대로 남아 있습니다: ${leftOver.join(", ")}`;
    }
    /*
     * 해설이 「A → B로 바꾼다」고 하는데 <보기>에 이미 B로 주어졌으면 해설이 틀렸다
     * (4·5차 시험 2026-10-04: confirmed·ones·kids가 보기에 그대로 있는데 「바꾼다」고 설명).
     */
    const bank = new Set(bankLine.toLowerCase().split(/[\/,\s]+/).map((w) => w.replace(/[^a-z'’]/g, "")).filter(Boolean));
    for (const [from, to] of formChangeClaims(String(q.explanation ?? ""))) {
      if (from !== to && bank.has(to) && !bank.has(from)) {
        return `해설이 ${from}를 ${to}로 바꾼다고 했지만 <보기>에 이미 ${to}로 주어져 있습니다. 실제로 형태가 바뀌는 낱말만 설명합니다.`;
      }
    }
  } else if (
    option.type === "writing" &&
    (option.aingkaCode === "지칭대명사서술" ||
      option.aingkaCode === "특정표현의미서술")
  ) {
    const mod = q.passageModified || "";
    if (!/<u>[\s\S]*?<\/u>/i.test(mod)) {
      return "지칭 서술형은 본문에 <u>밑줄</u>이 필요합니다.";
    }
    if (hasHangul(mod)) {
      return "지칭 서술형 본문은 영어여야 합니다.";
    }
    const ans = String(q.correctAnswer ?? "")
      .replace(/^ⓐ\s*[:：]?\s*/i, "")
      .trim();
    if (!ans) {
      return "지칭 서술형 정답이 필요합니다.";
    }
    if (hasHangul(ans)) {
      return "지칭 서술형 정답은 영어여야 합니다.";
    }
    const bodyForMatch = `${q.passageOriginal || ""}\n${mod}`;
    if (option.aingkaCode === "지칭대명사서술") {
      if (!/ⓐ\s*<u>/i.test(mod)) {
        return "대명사 지칭은 본문에 ⓐ<u>…</u> 표시가 필요합니다.";
      }
      const n = countEnglishWords(ans);
      if (n < 1 || n > 3) {
        return "대명사 지칭 정답은 본문에서 찾은 1~3단어여야 합니다.";
      }
      if (!passageHasConsecutiveWords(bodyForMatch, ans, n)) {
        return "대명사 지칭 정답이 본문에 있어야 합니다.";
      }
      const um = mod.match(/ⓐ\s*<u>([\s\S]*?)<\/u>/i);
      const pronoun = (um?.[1] || "it").replace(/\s+/g, " ").trim();
      q.instruction =
        n === 1
          ? `다음 글의 밑줄 친 ⓐ${pronoun}이 가리키는 바를 본문에서 정확히 찾아 한 단어의 영어로 쓰시오.`
          : `다음 글의 밑줄 친 ⓐ${pronoun}이 가리키는 바를 본문에서 정확히 찾아 ${n}단어의 영어로 쓰시오.`;
    } else {
      const n = countEnglishWords(ans);
      if (n < 3 || n > 12) {
        return "특정 표현 의미 정답은 본문 연속 3~12단어여야 합니다.";
      }
      if (!passageHasConsecutiveWords(bodyForMatch, ans, n)) {
        return "특정 표현 의미 정답이 본문에 연속 구로 있어야 합니다.";
      }
      const um = mod.match(/<u>([\s\S]*?)<\/u>/i);
      const expr = (um?.[1] || "").replace(/\s+/g, " ").trim();
      if (expr) {
        q.instruction = `다음 글의 밑줄 친 ${expr}가 문맥상 의미하는 바를 본문에서 찾아 ${n}단어의 영어로 쓰시오.`;
      }
      /*
       * 답란은 늘 ⓐ인데 본문에는 ⓐ가 없는 것이 마흔 개 가운데 여섯 개였다(2026-09-29).
       * 학생 눈에는 답란의 ⓐ가 가리키는 자리가 본문에 없다. 밑줄 앞에 ⓐ를 붙여 준다.
       */
      if (!/ⓐ\s*<u>/i.test(mod)) {
        q.passageModified = mod.replace(/<u>/i, "ⓐ<u>");
      }
    }
    if (!/<지칭답란>/.test(q.questionText || "")) {
      q.questionText = "<지칭답란>\nⓐ";
    }
    q.correctAnswer = ans;
    q.choices = undefined;
  } else if (
    option.type === "grammar" &&
    (option.aingkaCode === "어법오류수정2" ||
      option.aingkaCode === "어법오류수정3" ||
      option.aingkaCode === "어법문장오류수정")
  ) {
    // 만들 때 박아 준 개수와 같은 값을 본다(item-variety 한곳에서 정한다)
    const wrongN = plannedWrongCount(option.aingkaCode ?? "", turn);
    const mod = q.passageModified || "";
    if (hasHangul(mod)) {
      return "어법 수정 본문은 영어여야 합니다.";
    }
    if (option.aingkaCode === "어법문장오류수정") {
      if (!/[①②③④⑤]/.test(mod)) {
        return "문장 단위 어법 수정은 ①~⑤ 표지가 필요합니다.";
      }
    } else if (option.aingkaCode === "어법오류수정2") {
      if (!/[ⓐⓑⓒⓓⓔ]/.test(mod) || !/<u>[\s\S]*?<\/u>/i.test(mod)) {
        return "어법 2개 수정은 ⓐ~ⓔ 밑줄이 필요합니다.";
      }
    } else if (!/[ⓐⓑⓒⓓⓔⓕⓖ]/.test(mod) || !/<u>[\s\S]*?<\/u>/i.test(mod)) {
      return "어법 3개 수정은 ⓐ~ⓖ 밑줄이 필요합니다.";
    }
    const ans = String(q.correctAnswer ?? "").trim();
    if (!ans) {
      return "어법 수정 정답(기호+바른 형태)이 필요합니다.";
    }
    const reconciled = reconcileGrammarFixQuestion({
      passageModified: mod,
      correctAnswer: ans,
      explanation: q.explanation || "",
      wrongN,
    });
    if (!reconciled.ok) {
      return reconciled.reason ?? "어법 수정 정답·해설·본문이 일치하지 않습니다.";
    }
    q.correctAnswer = reconciled.correctAnswer;
    q.explanation = reconciled.explanation;
    /*
     * 정답대로 고쳐도 여전히 틀린 문장이면 버린다.
     *
     * 선생님 지시(2026-10-01)로 문항을 하나하나 대조하다 찾았다. ⓓ를
     * 「suggests that it become」으로 고쳐도 바로 앞의 we와 안 맞아
     * 「the particular market we suggests that it become」이 남았다.
     * 정답지대로 고쳐도 틀린 문항은 선생님이 채점할 수가 없다.
     * 밑줄 안에 일부러 심은 오류는 고침을 넣은 뒤에 보므로 걸리지 않는다
     * (문항 5,696개로 확인: 걸린 것은 그 한 문항뿐이었다).
     */
    const stillBroken = agreementBreakAfterFix(
      mod,
      parseGrammarFixAnswer(reconciled.correctAnswer)
    );
    if (stillBroken) {
      return `정답대로 고쳐도 주어·동사가 맞지 않습니다: "${stillBroken}"`;
    }
    /*
     * 답칸은 큰 칸 하나만 둔다.
     *
     * 선생님 지적(2026-09-30): 답지에는 정답이 2개인데 답칸이 하나만 나온다
     *  → 정답에서 세어 넉넉히 두게 고쳤다.
     * 선생님 지적(2026-10-01): 그래도 칸을 셋 만들어 두면 학생이 세 개인 줄 안다.
     *  → 칸 수로도 개수가 새지 않게 아예 큰 칸 하나만 둔다. 발문에서도 개수를 뺐다
     *    (「2개 찾아」 → 「모두 찾아」). 몇 개인지는 학생이 스스로 판단한다.
     */
    const answerRows = 1;
    const conditionLine = "\u25cb 틀린 곳의 기호와 수정한 형태를 모두 써야 정답으로 인정함";
    const askBody = /<조건>/.test(q.questionText || "")
      ? String(q.questionText).replace(/<답안행>[\s\S]*$/, "").trimEnd()
      : `<조건>\n${conditionLine}`;
    q.questionText = `${askBody}\n\n<답안행>\n${answerRows}`;
    q.choices = undefined;
  } else if (option.aingkaCode === "요약표빈칸단어") {
    /*
     * 선생님 지적(2026-09-28): 표가 한 줄 글로 붙어 나왔다. 인쇄가 표로 그리려면
     * <조건>·<표>가 줄 단위로 서 있어야 하므로, 여기서 갈라지지 않으면 버린다.
     */
    const blocks = parseSummaryTableBlocks(q.questionText || "");
    if (!blocks) {
      return "요약표 유형은 questionText에 <조건>과 <표>가 각각 줄 단위로 필요합니다.";
    }
    if (blocks.rows.length < 3 || (blocks.rows[0]?.length ?? 0) !== 3) {
      return "요약표는 머리글 한 줄과 내용 두 줄 이상, 줄 이름 칸을 포함해 세 칸이어야 합니다.";
    }
    const bodyRows = blocks.rows.slice(1);
    if (bodyRows.some((r) => r.slice(1).some((cell) => !cell.trim()))) {
      return "요약표에 빈 칸이 있습니다.";
    }
    const keys = bodyRows.map((r) => r[0] ?? "");
    if (keys.some((k) => !k.trim() || /견줄\s*점|비교\s*점/.test(k) || k.trim().length > 20)) {
      return "표 첫 칸에는 그 줄을 가리키는 짧은 이름이 필요합니다(예: Land, Building, Distance).";
    }
    const leaked = summaryTableAnswerLeak(blocks.rows, String(q.correctAnswer ?? ""));
    if (leaked) return leaked;
    /*
     * 빈칸이 한쪽 칸에만 몰리면 표를 가로로 읽을 일이 없어진다
     * (선생님 지적 2026-09-29: 보기가 한쪽 열에만 들어간다).
     */
    const blankCols = new Set<number>();
    for (const row of bodyRows) {
      row.forEach((cell, i) => {
        if (i > 0 && /\([A-E]\)/.test(cell)) blankCols.add(i);
      });
    }
    if (blocks.blankLabels.length >= 2 && blankCols.size < 2) {
      return "빈칸이 한쪽 칸에만 몰려 있습니다. 왼쪽·오른쪽 칸에 나눠 두세요.";
    }
    if (blocks.blankLabels.length < 2) {
      return "표 안에 (A)·(B) 같은 빈칸이 두 개 이상 필요합니다.";
    }
    /*
     * 이제는 형태를 바꿔 쓰게 한다(선생님 지적 2026-10-01: 「답이 너무 직관적이다」).
     * 그래서 그대로 있는지가 아니라 <b>어간이 지문에 있는지</b>로 본다 —
     * make → making, important → importance 는 받고, 지문에 없는 낱말은 거른다.
     */
    const passage = q.passageOriginal || "";
    const bodyWords: string[] = passage.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const stem = (w: string) => w.slice(0, Math.max(4, Math.floor(w.length * 0.6)));
    let changed = 0;
    let total = 0;
    for (const part of String(q.correctAnswer ?? "").split("/")) {
      const word = part.replace(/\([A-E]\)\s*[:：]?/, "").trim();
      if (!word) continue;
      total += 1;
      const w = word.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length < 3) return `정답 낱말 「${word}」이 너무 짧습니다.`;
      const exact = bodyWords.includes(w);
      if (!exact) changed += 1;
      const rooted = bodyWords.some((b) => b.startsWith(stem(w)) || w.startsWith(stem(b)));
      if (!rooted) {
        return `정답 낱말 「${word}」은 지문에 뿌리가 없습니다.`;
      }
    }
    // 셋 다 지문 그대로면 눈으로 훑기만 해도 답이 보인다
    if (total >= 3 && changed === 0) {
      return "빈칸 답이 모두 지문 그대로입니다. 적어도 둘은 형태를 바꿔 주세요.";
    }
    q.choices = undefined;
  } else if (option.aingkaCode === "문법조건영작") {
    /*
     * 기존 제시어 배열 서술형과 같은 칸(<조건>/<보기>/<해석>)이어야 인쇄가 상자로 그린다.
     * 조건에 어법 이름과 괄호 안 형태가 없으면 학생이 무엇을 쓸지 알 수 없어 버린다.
     */
    const blocks = parseWordOrderBlocks(q.questionText || "");
    if (!blocks) {
      return "조건 영작은 questionText에 <조건>·<보기>·<해석>이 각각 줄 단위로 필요합니다.";
    }
    const firstCondition = blocks.conditions.split(/\n+/)[0] ?? "";
    const grammar = findWritingGrammar(firstCondition);
    if (!grammar) {
      return "첫 조건에 어법 목록에 있는 이름이 필요합니다(예: 가정법 과거).";
    }
    const answer = String(q.correctAnswer ?? "").trim();
    if (!answer) {
      return "조건 영작 정답 문장이 필요합니다.";
    }
    /*
     * 선생님 요청(2026-09-29): 두 가지 방식이 있다.
     * - 지문 그대로: 정답이 지문에 있는 문장이어야 한다.
     * - 고쳐 쓰기: 지문에 없어도 된다. 대신 그 어법이 정답 문장에 정말 보여야 한다.
     * 어느 쪽이든 고른 어법이 안 보이면 버린다(어법을 골라 놓고 딴 게 나오던 것을 막는다).
     */
    if (writingMode === "passage") {
      if (!passageHasConsecutiveWords(q.passageOriginal || "", answer)) {
        return "「지문 그대로」로 만들 때는 정답이 지문에 있는 문장이어야 합니다.";
      }
    }
    if (grammar.check && !grammar.check.test(answer)) {
      return `정답 문장에 ${grammar.label}이 보이지 않습니다: ${answer}`;
    }
    /*
     * 선생님 지적(2026-09-28): 지문에 정답 문장이 그대로 있으면 베껴 쓰면 된다.
     * 기존 제시어 배열처럼 그 자리를 ⓐ__________ 빈칸으로 뚫어야 한다.
     */
    /*
     * 빈칸은 코드가 뚫는다 — 버리지 말고 고쳐 쓴다.
     *
     * 선생님 지적(2026-10-01): 만들다 버린 값도 우리가 낸다. 빠질 것 같으면 아예
     * 만들지 말든가 다 만들든가 해야 한다.
     *
     * 실측(2026-10-01): 조건 영작 여섯 번 가운데 세 번이 「빈칸을 안 뚫었다」로
     * 통째로 버려졌다. 그런데 정답이 지문에 있는 문장이면 그 자리를 빈칸으로 바꾸는
     * 일은 코드가 할 수 있다. 다시 부를 까닭이 없다.
     */
    const blankOut = (source: string): string | null => {
      const src = String(source ?? "");
      if (!src.trim()) return null;
      const tidy = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
      const want = tidy(answer);
      if (want.length < 12) return null;
      // 지문에서 정답 문장이 있는 자리를 글자 기준으로 찾는다 (구두점·공백 무시)
      const map: number[] = [];
      let flat = "";
      for (let i = 0; i < src.length; i += 1) {
        const c = src[i]!.toLowerCase();
        if (c >= "a" && c <= "z") {
          flat += c;
          map.push(i);
        }
      }
      const at = flat.indexOf(want);
      if (at >= 0) {
        const from = map[at]!;
        const to = map[at + want.length - 1]! + 1;
        return `${src.slice(0, from)}ⓐ__________${src.slice(to)}`;
      }

      /*
       * 「고쳐 쓰기」에서는 정답이 지문에 그대로 없다. 정답은 지문의 어느 한 문장을
       * 그 어법으로 고쳐 쓴 것이므로, 알맹이 낱말이 가장 많이 겹치는 문장을 뚫는다.
       */
      const words = (t: string) =>
        new Set(
          t
            .toLowerCase()
            .split(/[^a-z']+/)
            .filter((w) => w.length > 3)
        );
      const ansWords = words(answer);
      if (ansWords.size < 3) return null;
      const sentences: { text: string; at: number }[] = [];
      let cursor = 0;
      for (const piece of src.split(/(?<=[.!?])\s+/)) {
        const idx = src.indexOf(piece, cursor);
        if (idx >= 0) {
          sentences.push({ text: piece, at: idx });
          cursor = idx + piece.length;
        }
      }
      let best: { text: string; at: number; score: number } | null = null;
      for (const sent of sentences) {
        if (sent.text.trim().split(/\s+/).length < 6) continue;
        const sw = words(sent.text);
        if (sw.size === 0) continue;
        let shared = 0;
        for (const w of sw) if (ansWords.has(w)) shared += 1;
        const score = shared / Math.min(sw.size, ansWords.size);
        if (!best || score > best.score) best = { ...sent, score };
      }
      // 절반도 안 겹치면 엉뚱한 문장을 뚫는 셈이라 손대지 않는다
      if (!best || best.score < 0.5) return null;
      return `${src.slice(0, best.at)}ⓐ__________${src.slice(best.at + best.text.length)}`;
    };

    let modified = String(q.passageModified ?? "").trim();
    /*
     * 빈칸 말고 원문 문장을 하나 더 지운 지문도 원문에서 다시 뚫는다. 검수가 「원문 문장을 2개 지웠습니다」로
     * 버려 다른 유형으로 바뀌던 것(10-08~13 대체 119문항 중 13문항) — 원문은 우리가 가지고 있다.
     */
    const removedOriginalSentences = (mod: string): number => {
      const plain = mod.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      return String(q.passageOriginal ?? "")
        .replace(/<[^>]+>/g, "")
        .split(/(?<=[.!?]["'”’]?)\s+(?=[A-Z"'“‘(])/)
        .map((s) => s.trim().replace(/\s+/g, " "))
        .filter((s) => s.length > 15 && !plain.includes(s)).length;
    };
    const needsBlank =
      !modified ||
      !/ⓐ/.test(modified) ||
      !/_{3,}/.test(modified) ||
      passageHasConsecutiveWords(modified, answer) ||
      removedOriginalSentences(modified) >= 2;
    if (needsBlank) {
      // 모델 지문이 원문 문장을 잃었으면 그 지문은 버리고 원문에서 뚫는다
      const fromModel = modified && removedOriginalSentences(modified) < 2 ? blankOut(modified) : null;
      const fixed = fromModel ?? blankOut(q.passageOriginal || "");
      if (!fixed) {
        return "조건 영작은 정답 문장을 빈칸으로 뚫은 지문(passageModified)이 필요합니다.";
      }
      modified = fixed;
      q.passageModified = fixed;
    }

    /*
     * 조건은 코드가 다시 짠다 — 선생님 요청(2026-09-28): 조건을 좀 더 자세하게.
     * 모델이 쓴 문구는 어법 이름을 알아내는 데만 쓰고, 시험지에 실리는 줄은
     * 어법마다 정해 둔 것으로 채운다. 그래야 문항마다 조건이 들쭉날쭉하지 않다.
     * 낱말 수는 정답에서 세므로 늘 맞는다.
     */
    const wordCount = tokenizeAnswerPhrase(answer).length;
    const conditionLines = [
      // 선생님 요청(2026-09-28): 조건에는 문법 용어만 적는다. 괄호 속 형태는 빼 준다.
      `○ ${grammar.label}${objectParticle(grammar.label)} 사용할 것`,
      "○ <보기>에 있는 단어를 모두 한 번씩 사용할 것 (단어를 더하거나 빼지 말 것)",
      // 어형변화는 동사만 한다(선생님 결정 2026-10-24) — 명사·형용사는 보기에 정답 꼴 그대로 나간다
      "○ 필요하면 동사의 형태를 바꿔 쓸 것 (시제·수·태에 유의할 것)",
      ...(wordCount > 0 ? [`○ 모두 ${wordCount}단어로 쓸 것`] : []),
      "○ 첫 글자는 대문자로 쓰고, 문장 끝에 알맞은 문장 부호를 쓸 것",
    ];
    /*
     * 선생님 지적(2026-09-29): 보기 단어가 정답 순서 그대로 나왔다 — 베껴 쓰면 끝나는 문항이 된다.
     * 다른 제시어 배열은 normalizeWordOrderQuestionText가 섞어 주는데, 이 유형만 그 손질을
     * 거치지 않고 모델이 쓴 줄을 그대로 실었다. 여기서도 정답에서 보기를 다시 짜고 섞는다.
     * 조건이 「필요하면 어형을 바꿔 쓸 것」이므로 원형으로 낸다.
     */
    // 원형 손질은 buildWordBankFromAnswer가 한다. 여기서 다시 원형으로 돌리면 명사 복수형까지 깎인다(clothes→clothe).
    let bank =
      shuffleWordBankKeepForms(
        joinWordBank(buildWordBankFromAnswer(answer, "inflect", blocks.words))
      ) || normalizeAndShuffleWordBank(blocks.words);
    // 어형변화는 동사만 — 명사·형용사·부사가 원형으로 남았으면 정답 꼴로(선생님 결정 2026-10-24)
    bank = joinWordBank(
      fixNonVerbBankForms(splitWordBank(bank), tokenizeAnswerPhrase(answer), q.explanation || "") ?? splitWordBank(bank)
    );

    // 제시어 배열과 같은 검사 — 빈칸 옆에 정답 낱말이 남아 있으면 버린다
    let leftOver = bankWordsLeftInBlankLine(modified, bank);
    if (leftOver.length > 0) {
      const widened = widenBlankToSentence(modified);
      if (widened && bankWordsLeftInBlankLine(widened, bank).length === 0) {
        modified = widened;
        q.passageModified = widened;
        leftOver = [];
      }
    }
    if (leftOver.length > 0) {
      return `빈칸이 든 문장에 보기 낱말이 그대로 남아 있습니다: ${leftOver.join(", ")}`;
    }

    /*
     * 조건은 「보기에 있는 단어를 모두 한 번씩, 더하거나 빼지 말 것」이다. 그러면 보기와
     * 정답의 낱말이 하나하나 맞아야 한다. 숫자를 낱말로 세지 않아 2018이 보기에서 빠진
     * 채로 나간 일이 있었다(2026-10-01 Jayden 선생님 지적). 여기서 세어 막는다.
     */
    // be·do·have 꼴(is/are/was…)은 보기의 원형과 같은 낱말로 센다 — 조건이 「어형을 바꿔 쓸 것」이다.
    // 이것을 안 세어 「정답의 낱말 is가 보기에 없다」로 멀쩡한 문항을 버렸다(2026-10-03 254문항 작업 3개).
    const bankWords = splitWordBank(bank).map((w) => lemmaEnglishToken(w, { auxiliaries: true }).toLowerCase());
    const answerWords = tokenizeAnswerPhrase(answer).map((w) => lemmaEnglishToken(w, { auxiliaries: true }).toLowerCase());
    if (bankWords.length !== answerWords.length) {
      return `<보기> ${bankWords.length}낱말과 정답 ${answerWords.length}낱말이 맞지 않습니다.`;
    }
    /*
     * 보기는 정답에서 원형으로 만든 것이라, 같은 방식으로 다시 만든 것과 같으면 맞다.
     * 낱말마다 원형을 따로 견주면 used·feeding·surrounding을 use·feed·surround와 못 맞춰
     * 멀쩡한 문항을 버렸다(2026-10-13 호원고1 단원문법 서술형 9문항).
     */
    const sortedLower = (ws: string[]) => ws.map((w) => w.toLowerCase()).sort().join(" ");
    const rebuilt = buildWordBankFromAnswer(answer, "inflect", blocks.words);
    if (sortedLower(splitWordBank(bank)) !== sortedLower(rebuilt)) {
      const spare = [...bankWords];
      for (const w of answerWords) {
        const at = spare.indexOf(w);
        if (at < 0) {
          return `정답의 낱말 「${w}」이 <보기>에 없습니다.`;
        }
        spare.splice(at, 1);
      }
    }

    q.questionText = [
      "<조건>",
      conditionLines.join("\n"),
      "",
      "<보기>",
      bank,
      "",
      "<해석>",
      blocks.translation,
    ].join("\n");
    q.choices = undefined;
  } else if (
    option.type === "summary_short" &&
    (option.aingkaCode === "요약문빈칸영작" ||
      option.aingkaCode === "요약문빈칸2단어" ||
      option.aingkaCode === "요약문빈칸3단어")
  ) {
    const qt = q.questionText || "";
    const blocks = parseSummaryWritingBlocks(qt);
    if (!blocks) {
      return "요약문 서술형은 questionText에 <조건>·<요약문>이 필요합니다.";
    }
    if (option.aingkaCode === "요약문빈칸영작" && !blocks.words) {
      return "요약문 빈칸 영작은 <보기>가 필요합니다.";
    }
    if (!/[ⓐ]/.test(blocks.summary) || !/_{3,}/.test(blocks.summary)) {
      return "요약문에 ⓐ__________ 빈칸이 필요합니다.";
    }
    if (hasHangul(blocks.summary)) {
      return "요약문은 영어여야 합니다 (한글 포함됨).";
    }
    const ans = String(q.correctAnswer ?? "").trim();
    if (!ans) {
      return "요약문 빈칸 정답이 필요합니다.";
    }
    // 정답을 끼운 요약문이 어법에 맞는지 본다 (summary-blank-fit.ts 에 까닭이 적혀 있다)
    const fitProblem = summaryBlankFitProblem(blocks.summary, ans);
    if (fitProblem) return fitProblem;
    const passage = q.passageOriginal || "";
    if (
      option.aingkaCode === "요약문빈칸2단어" ||
      option.aingkaCode === "요약문빈칸3단어"
    ) {
      const n = option.aingkaCode === "요약문빈칸2단어" ? 2 : 3;
      // ⓐ: phrase 추출
      const m =
        ans.match(/ⓐ\s*[:：]?\s*([^/ⓐⓑⓒ\n]+)/i) ||
        ans.match(/^([^/]+)/);
      const phrase = (m?.[1] || "").trim();
      if (!passageHasConsecutiveWords(passage, phrase, n)) {
        return `요약문 ${n}단어 정답(ⓐ)이 본문에 연속 ${n}단어로 있어야 합니다.`;
      }
    }

    if (option.aingkaCode === "요약문빈칸영작") {
      /*
       * 선생님 지적(2026-09-29): 요약문 안에 이미 그 낱말이 있는데 보기에도 또 나오니,
       * 그 낱말을 넣을 자리가 없다. 실제로 81문항 가운데 10개가 그랬다
       * (while·doctor처럼 요약문에 보이는 말이 보기에 또 있었다).
       *
       * 보기를 정답에서 다시 짠다. 그러면 보기에 있는 말은 모두 갈 자리가 있고,
       * 정답에 필요한 말이 빠지지도 않는다. 섞는 것은 normalizeAndShuffleWordBank가 한다.
       */
      const answerText = String(q.correctAnswer ?? "")
        .replace(/[\u24D0-\u24D4]\s*[:：]?/g, " ")
        .replace(/\s*\/\s*/g, " ");
      let rebuilt = shuffleWordBankKeepForms(
        joinWordBank(buildWordBankFromAnswer(answerText, "basic", blocks.words ?? ""))
      );
      if (!rebuilt) {
        return "요약문 빈칸 보기를 만들지 못했습니다.";
      }
      /*
       * 어형변화는 동사만 한다(선생님 결정 2026-10-24). 모델 보기가 정답과 원형으로 맞으면 그대로 쓰므로
       * apple(정답 apples) 같은 명사 원형이 남을 수 있다. 빈칸을 채운 요약문으로 자리를 보고 정답 꼴로 되돌린다.
       */
      {
        let filled = blocks.summary;
        for (const [mark, phrase] of splitSummaryAnswer(String(q.correctAnswer ?? ""))) {
          filled = filled.replace(new RegExp(`${mark}\\s*_+`, "g"), ` ${phrase} `);
        }
        const fixed = fixNonVerbBankForms(splitWordBank(rebuilt), tokenizeAnswerPhrase(filled), q.explanation || "");
        if (fixed) rebuilt = joinWordBank(fixed);
      }
      /*
       * 조건의 낱말 수도 코드가 다시 쓴다.
       *
       * 선생님과 함께 전수조사(2026-09-29): 84문항 가운데 35개가 「ⓐ는 6단어,
       * ⓑ는 6단어」인데 실제 정답은 네 낱말에서 여덟 낱말까지였다. 여섯을 기본값처럼
       * 적어 둔 것이다. 학생이 조건대로 여섯 낱말에 맞춰 쓰면 도리어 틀린다.
       * 문법조건영작이 이미 정답에서 세어 적으므로 같은 방식으로 맞춘다.
       */
      const perBlank = [
        ...String(q.correctAnswer ?? "").matchAll(
          /([ⓐ-ⓔ])\s*[:：]\s*([^/\n]+)/g
        ),
      ].map((m) => ({
        mark: m[1]!,
        count: tokenizeAnswerPhrase(m[2]!).length,
      }));
      const keptConditions = blocks.conditions
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !/\d+\s*단어/.test(line));
      const conditionLines = perBlank.length
        ? [
            ...keptConditions,
            `○ ${perBlank
              .map((b) => `${b.mark}는 ${b.count}단어`)
              .join(", ")}로 쓸 것`,
          ]
        : keptConditions;

      q.questionText = [
        "<조건>",
        conditionLines.join("\n"),
        "",
        "<보기>",
        rebuilt,
        "",
        "<요약문>",
        blocks.summary.trim(),
      ].join("\n");
      // 보기를 다시 짜며 소문자가 된 고유명사·약어(oed·korean)를 되살린다(10-14 점검)
      q.questionText = restoreLeadingProperNoun(q.questionText, answerText.trim(), passage);
    }
    q.choices = undefined;
  } else if (option.isObjective && option.choiceLanguage) {
    if (!q.choices || q.choices.length < 5) {
      return "객관식 선택지가 5개 미만입니다.";
    }
  }

  if (option.type === "content_count") {
    // 진술 앞에 칸 이름 「<보기>」를 또 적어 오는 일이 있다 — 화면이 이미 <보기> 상자로 감싼다
    if (q.questionText) q.questionText = q.questionText.replace(/^\s*<보기>\s*/, "");
    const qt = (q.questionText || "").trim();
    if (!qt || !/\(1\)/.test(qt)) {
      return "일치개수 문항은 <보기> (1)(2)… 진술이 필요합니다.";
    }
    if (q.choices && q.choices.length > 0) {
      q.choices = undefined;
    }
    const ans = String(q.correctAnswer ?? "").trim();
    if (!/^\d+$/.test(ans)) {
      return "일치개수 정답은 숫자(개수)여야 합니다.";
    }
  }

  if (option.type === "order" && (!q.choices || q.choices.length < 5)) {
    return "객관식 선택지가 5개 미만입니다.";
  }
  /*
   * 한 문장을 쉼표 자리에서 쪼개 두 단락에 나눠 담으면 문장부호만 보고도 순서가 드러난다
   * (2026-10-04 시험 #A24: (A)가 쉼표로 끝나고 (C)가 소문자 such as로 시작).
   * 단락은 문장 경계에서만 나눈다.
   */
  if (option.type === "order") {
    const paras = [...String(q.passageModified ?? "").matchAll(/\(([A-C])\)\s*([\s\S]*?)(?=\n\s*\([A-C]\)|$)/g)].map((m) => m[2]!.trim());
    if (paras.some((p) => p && (/^[a-z]/.test(p) || /[,;:]$/.test(p)))) {
      return "(A)(B)(C) 단락을 문장 중간에서 나눴습니다. 단락은 문장이 끝나는 자리에서만 나눕니다.";
    }
  }

  if (option.type === "grammar" && option.isObjective) {
    const mod = q.passageModified || "";
    const isGrammarInference =
      option.aingkaCode === "어법추론" ||
      option.aingkaCode === "어법모두고르기";

    if (option.aingkaCode === "어법개수") {
      if (!q.choices || q.choices.length < 5) {
        return "객관식 선택지가 5개 미만입니다.";
      }
      if (!/[ⓐⓑⓒⓓⓔⓕ]/.test(mod) || !/<u>[\s\S]*?<\/u>/i.test(mod)) {
        return "어법 개수 문항은 ⓐ~ⓕ 밑줄 표지가 필요합니다.";
      }
    } else if (isGrammarInference) {
      // 어법 추론: 하단 조합 보기 없음 — 본문 ⓐ~ⓔ가 보기
      q.choices = undefined;
      if (!/[ⓐⓑⓒⓓⓔ]/.test(mod) || !/<u>[\s\S]*?<\/u>/i.test(mod)) {
        return "어법 추론 문항은 ⓐ~ⓔ 밑줄 표지가 필요합니다.";
      }
      const ans = parseChoiceAnswer(q.correctAnswer);
      if (ans == null) {
        return "어법 추론 정답은 1~5여야 합니다.";
      }
      q.correctAnswer = ans;
    } else if (!q.choices || q.choices.length < 5) {
      return "객관식 선택지가 5개 미만입니다.";
    }
    if (hasHangul(mod)) {
      return "본문은 영어여야 합니다 (한글 포함됨).";
    }
  }

  if (option.type === "vocabulary" && option.isObjective) {
    const mod = q.passageModified || "";
    if (option.aingkaCode === "어휘개수") {
      if (!q.choices || q.choices.length < 5) {
        return "객관식 선택지가 5개 미만입니다.";
      }
      const texts = (q.choices ?? []).map((c) => c.text.trim());
      if (texts.join("|") !== "1개|2개|3개|4개|5개") {
        return "어휘 개수 보기는 1개~5개여야 합니다.";
      }
    } else if (option.aingkaCode === "어휘추론") {
      // 어휘추론: 하단 보기 없음, ①~⑤만
      q.choices = undefined;
    }
    // 어휘개수는 박아 둔 개수를 대조하지 않는다(아래 생성 직후 대조와 같은 까닭)
    const expectedAnswer = !planAnswer || option.aingkaCode === "어휘개수"
      ? null
      : plannedAnswerNumber("어휘추론", turn);
    const consistency = validateVocabularyConsistency({
      code: option.aingkaCode,
      passageModified: mod,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      expectedAnswer,
    });
    if (!consistency.ok) return consistency.problems[0] ?? "어휘 문항의 문제·정답·해설이 맞지 않습니다.";
    q.explanation = consistency.explanation ?? q.explanation;
    if (hasHangul(mod)) {
      return "본문은 영어여야 합니다 (한글 포함됨).";
    }
  }

  if (option.type === "grammar" && option.aingkaCode === "어법개수") {
    const texts = (q.choices ?? []).map((c) => c.text.trim());
    if (texts.join("|") !== "1개|2개|3개|4개|5개") {
      return "어법 개수 보기는 1개~5개여야 합니다.";
    }
  }

  return null;
}

/**
 * 모든 문항에 공통인 규칙 — 유형·지문과 무관하게 항상 같은 문자열이어야
 * 같은 지문의 여러 문항에서 프롬프트 캐시가 앞부분을 재사용한다.
 * 유형·문항별 규칙은 user 메시지 끝(ITEM RULES)에 붙인다.
 */
/*
 * 유형마다 모델을 달리 쓴다 (2026-10-01 실험).
 *
 * 지문 4개 · 유형 9가지 · 문항 3개씩을 세 모델로 만들고, 어느 모델이 만들었는지
 * 가린 채 채점해 봤다(324문항).
 *   · 제목·요지·빈칸추론·내용불일치 — 가장 싼 모델도 형태를 한 번도 안 깨고 답도
 *     100%였다. 값은 2.5~2.7배 싸다.
 *   · 어법 — 가장 싼 모델은 셋 중 하나가 밑줄 번호를 안 붙여 다시 만들어야 했고
 *     답도 75%로 떨어졌다. 싼 값이 재생성으로 사라진다.
 *   · 서술형 요약영작 — 가장 싼 모델은 58%. 「보기를 모두 한 번씩」·단어 수 조건을
 *     못 지킨다.
 *   · 그 밖의 유형은 중간 모델이 예전 모델과 같거나 나았고(서술형은 83%→100%)
 *     값은 20~84% 싸다.
 *
 * 되돌리려면 환경변수로 덮어쓴다.
 */
const QG_MODEL_LIGHT = process.env.OPENAI_MODEL_QG_LIGHT?.trim() || "gpt-5.6-terra";
const QG_MODEL_MAIN = process.env.OPENAI_MODEL_QG_MAIN?.trim() || "gpt-5.6-sol";

/** 싼 모델로 만들어도 차이가 없던 유형 */
// 내용일치도 싼 모델로(2026-10-04: 내용불일치가 싼 모델로 두 차례 40문항 시험에서 불량 0, 내용일치는 비싼 모델 원가가 문항당 45원)
// 일치개수도 싼 모델로(2026-10-10: 비싼 모델은 문항당 약 95원이라 110크레딧에서 1.25~1.6배였다. 싼 모델 20문항 시험에서
// 정답 20/20, 평균 시도 1.1번, 문항당 약 54원. 처음 시험은 보기 계획을 빼먹어 25%가 실패했다 — 아래 일치개수 규칙에 계획 줄을 넣었다)
const LIGHT_TYPES = new Set(["title", "topic", "sentence_blank", "content_false", "content_true", "content_count"]);

function modelForType(option: { type: string }): string {
  return LIGHT_TYPES.has(option.type) ? QG_MODEL_LIGHT : QG_MODEL_MAIN;
}

const QUESTION_WRITER_SHARED_SYSTEM = `Korean HS English exam writer. ONE question JSON only. Fast & concise.
- No meta tags.
- NEVER create 요약문완성 (Korean summary with (A)/(B) blanks and …… pair choices). That type is removed.
- For MCQ: correctAnswer is 1-5. Prefer varied positions (not always 1).
- hardWords: When (a) English MCQ choices or (b) 일치개수 English <보기> (or Korean <보기>→passage): include 4~6 {word, meaning}. Target ≈ 중3+ / Lexile ≥~1000L (US Grade 8 CCSS text ~1010L–1185L). Prefer the HARDER lemmas that appear in THIS item's English — skip ultra-basics (people/important/money/make/need). Include short non-basic lemmas when apt (swap, skim, grasp, yield, burden, voucher, reluctant, scrutinize, comparable, misprint, conscious). Single dictionary token only (never phrases like "national monies"). Fake plurals (monies/datas) forbidden. meaning = short Korean gloss. Rotate lemmas across same-passage slots. If none fit → []. For Korean-only MCQ / count-only / subjective without English 보기 → [].
- explanation(해설)은 "~다"로 끝나는 평서형으로 쓴다. 존댓말("맞습니다", "합니다", "해요") 금지.
  보기: "정답은 ②다.", "앞 문장과 뜻이 반대라 틀리다.", "빈칸 뒤 근거와 맞다."
- The user message comes in this order: ITEM RULES → OUTPUT KEYS → PASSAGE. Follow every ITEM RULE exactly, with the same priority as the rules above.
- OUTPUT: exactly ONE JSON object whose keys are the ones listed under OUTPUT KEYS. NEVER output the wrapper keys "grade", "difficulty", "forcedInstruction" or "schema" — those describe the request, not the answer. "explanation" is a TOP-LEVEL key and must never be empty.`;

export async function generateOneQuestion(opts: {
  passage: string;
  analysis: PassageAnalysis;
  option: QuestionTypeOption;
  grade: string;
  overallDifficulty: string;
  sourceDetail?: string;
  /** 같은 지문 내 슬롯 (어휘·paraphrase 다양화) */
  diversitySlot?: { index: number; total: number; label: string };
  /** 같은 유형이 작업 전체에서 몇 번째인가(0부터). 지문이 달라도 이어진다. */
  typeTurn?: number;
  /** 원래 시험지의 수준을 적은 한 문단(동형모의고사). 선택지 길이·어휘를 여기에 맞춘다 */
  levelBrief?: string;
  /** 조건 영작에서 쓸 어법 이름 목록. 비우면 교재 기준 30가지에서 고른다 */
  grammarScope?: string[];
  grammarWritingMode?: "passage" | "paraphrase";
  /** 제시어 배열을 지문 그대로 낼지, 고쳐 써서 낼지 (기본: 지문 그대로) */
  wordOrderMode?: "passage" | "paraphrase";
  /** 이 문항의 목표 난이도. 없으면 overallDifficulty(내신→중, 고난도→상)를 따른다 */
  targetLevel?: TargetLevel | null;
  /** 어법·어휘에서 지문을 바꿔 써도 되는지(기본은 원문 그대로) */
  paraphraseGrammarVocab?: boolean;
  /** 같은 지문·같은 유형의 몇 번째 사본인가(0부터). 사본마다 근거 자리를 달리 잡게 한다 */
  copyIndex?: number;
  /** 앞 시도가 버려진 까닭. 다시 만들 때 같은 실수를 되풀이하지 않게 끝에 붙인다 */
  retryNote?: string;
  /** 1지문 다문항: 같은 지문을 함께 쓰는 다른 문항 이야기(공용 지문 모양, 피할 정답·근거) */
  setNote?: string;
  /** 몇 번째 시도인가(1부터) — 다시 만들 때 같은 문장을 또 고르지 않게 한다 */
  attempt?: number;
  /** 첫 메시지(유형 규칙)만 보내 캐시를 데우고 끝낸다 */
  primeOnly?: boolean;
}): Promise<GeneratedQuestionPayload> {
  const { option, analysis } = opts;
  // 시험지 흔적(정답 표기·문장 번호)을 걷어 낸 지문으로 만든다
  const passage = cleanSourcePassage(opts.passage);

  // 문장삽입·무관한문장: 문장 5개 이하면 출제 불가
  if (
    option.type === "sentence_insertion" ||
    option.type === "irrelevant_sentence"
  ) {
    const n = countEnglishSentences(passage);
    if (n < MIN_SENTENCES_FOR_INSERTION_IRRELEVANT) {
      throw new SkipQuestionError(
        `지문 문장이 ${n}개라 문장삽입·무관한문장을 생략합니다 (6개 이상 필요).`
      );
    }
  }

  // 지칭: 가리킬 대명사가 없는 지문이면 부르지 않는다 (만들다 버리는 값을 아낀다)
  if (
    option.aingkaCode === "지칭대명사서술" &&
    !/\b(it|its|they|them|their|this|these|those|he|she|him|her|his|one)\b/i.test(passage)
  ) {
    throw new SkipQuestionError("가리킬 대명사가 없는 지문이라 지칭 문항을 생략합니다.");
  }

  // 도표 설명문: 제목·주제·빈칸처럼 그래프가 있어야 풀리거나 유형이 안 맞는 것은 만들지 않는다
  if (isChartDescriptionPassage(passage) && CHART_UNFIT_TYPES.has(option.type)) {
    throw new SkipQuestionError(
      `도표 설명 지문이라 「${option.label || option.type}」 유형을 생략합니다 (내용일치·불일치·일치개수·어법·어휘·서술형만 만듭니다).`
    );
  }

  const meta = findAingkaOption(option.key);
  if (meta?.aingkaCode && !option.aingkaCode) {
    option.aingkaCode = meta.aingkaCode;
  }
  const forcedInstruction =
    meta?.koreanStem ||
    option.koreanStem ||
    "윗글의 내용과 일치하지 않는 것은?";

  const slimAnalysis = {
    overallTopic: analysis.overallTopic,
    overallMainIdea: analysis.overallMainIdea,
    titleCandidates: (analysis.titleCandidates ?? []).slice(0, 4),
  };

  const wordOrderCodes = new Set([
    "제시어배열기본",
    "제시어배열어형변화",
    "제시어배열단어추가",
  ]);
  const isWordOrder =
    option.type === "writing" &&
    wordOrderCodes.has(option.aingkaCode || meta?.aingkaCode || "");
  /*
   * 지정 문법 조건 영작도 <조건>·<보기>·<해석>을 쓰고 빈칸을 뚫는다. 여기서 빠져 있어 공통 규칙이
   * 「questionText는 비운다」「passageModified는 빼라」로 나가 유형 규칙과 부딪혔다(2026-10-13).
   */
  const isGrammarWriting = option.type === "writing" && (option.aingkaCode || meta?.aingkaCode) === "문법조건영작";
  // 요약표도 <조건>·<표>를 questionText에 쓰는데 공통 규칙은 「questionText는 비운다」였다(10-08~13 첫 시도 통과 40%)
  const isSummaryTable = option.type === "summary_short" && (option.aingkaCode || meta?.aingkaCode) === "요약표빈칸단어";

  const referenceCodes = new Set(["지칭대명사서술", "특정표현의미서술"]);
  const isReferenceWriting =
    option.type === "writing" &&
    referenceCodes.has(option.aingkaCode || meta?.aingkaCode || "");

  const summaryBlankCodes = new Set([
    "요약문빈칸영작",
    "요약문빈칸2단어",
    "요약문빈칸3단어",
  ]);
  const isSummaryBlank =
    option.type === "summary_short" &&
    summaryBlankCodes.has(option.aingkaCode || meta?.aingkaCode || "");

  const englishBodyTypes = new Set([
    "order",
    "sentence_blank",
    "sentence_insertion",
    "irrelevant_sentence",
    "grammar",
    "vocabulary",
  ]);
  const englishOnlyHint = isWordOrder
    ? "- CRITICAL LANGUAGE: passageModified MUST be ENGLISH only (blank ⓐ__________). questionText may include Korean in <해석>. correctAnswer ENGLISH."
    : isSummaryBlank
      ? "- CRITICAL LANGUAGE: <요약문> and correctAnswer ENGLISH only. <조건> may be Korean. Do NOT create old 요약문완성 MCQ with (A)/(B) …… pairs."
      : isReferenceWriting
        ? "- CRITICAL LANGUAGE: passageModified ENGLISH with <u>underline</u>. correctAnswer = exact words from passage. questionText = <지칭답란>."
    : englishBodyTypes.has(option.type)
    ? option.type === "grammar" || option.type === "vocabulary"
      ? "- CRITICAL LANGUAGE: passageModified MUST be ENGLISH only. Choice texts may be Korean (조합/개수) or empty numbers. Never put Hangul in the passage."
      : "- CRITICAL LANGUAGE: passageModified, questionText (if any), and choices MUST be ENGLISH only. Never put Korean Hangul in passage or choices. Only instruction/explanation may be Korean."
    : "";

  const grammarFixCodes = new Set([
    "어법오류수정2",
    "어법오류수정3",
    "어법문장오류수정",
  ]);
  const isGrammarFix =
    option.type === "grammar" &&
    grammarFixCodes.has(option.aingkaCode || meta?.aingkaCode || "");

  const needsModified =
    [
      "grammar",
      "vocabulary",
      "sentence_blank",
      "order",
      "sentence_insertion",
      "irrelevant_sentence",
      "underlined_inference",
    ].includes(option.type) ||
    isWordOrder ||
    isGrammarWriting ||
    isReferenceWriting;

  const needsQuestionText =
    option.type === "content_count" ||
    option.type === "sentence_insertion" ||
    isWordOrder ||
    isGrammarWriting ||
    isSummaryBlank ||
    isSummaryTable ||
    isReferenceWriting ||
    isGrammarFix ||
    (option.type === "writing" && option.aingkaCode === "서술형영작");
  const paraphraseTypes = new Set([
    "title",
    "topic",
    "summary_mcq",
    "content_true",
    "content_false",
    "content_count",
  ]);
  /*
   * 선생님이 고른 어법 범위에서 <b>이번 문항에 쓸 어법 하나</b>를 여기서 정한다.
   *
   * 선생님 지적(2026-09-29): 어법을 골라도 그게 안 나온다. 예전에는 「범위 안에서
   * 지문에 있는 것을 고르라」고만 해서, 지문에 없으면 딴 어법으로 새거나 건너뛰었다.
   * 이제 한 문항에 하나를 딱 정해 주고, 지문에 없으면 문장을 그 어법으로 고쳐 쓰게 한다.
   * 여러 개를 고르면 문항마다 돌아가며 쓴다.
   */
  const pickedWritingGrammar = (() => {
    if (option.aingkaCode !== "문법조건영작") return null;
    const scope = (opts.grammarScope ?? [])
      .map((label) => WRITING_GRAMMARS.find((g) => g.label === label))
      .filter((g): g is WritingGrammar => Boolean(g));
    /*
     * 지문 안 차례만 보면 지문마다 유형 차례가 똑같아 늘 같은 어법이 나왔다.
     * 고른 어법이 여럿인데 한두 개만 계속 나온다는 지적(2026-10-01). 작업 전체
     * 차례로 돌리면 지문이 바뀌어도 다음 어법으로 넘어간다.
     */
    const turn = opts.typeTurn ?? opts.diversitySlot?.index ?? 0;
    const inPassage = (pool: WritingGrammar[]) => pool.filter((g) => g.check?.test(passage));
    const byPassage = (opts.grammarWritingMode ?? "paraphrase") === "passage";
    if (scope.length === 0) {
      /*
       * 범위를 비우면 모델이 골랐는데, 저장된 47문항 중 수동태 16·It-that 강조구문 10으로
       * 쏠렸다(2026-10-13 지정 문법이 한쪽으로 몰린다는 의견). 지문에 실제로 쓰인 어법을
       * 코드가 찾아 작업 차례로 돌린다. 하나도 못 찾으면 예전처럼 모델에게 맡긴다.
       */
      const found = inPassage(WRITING_GRAMMARS);
      return found.length > 0 ? found[turn % found.length]! : null;
    }
    // 「지문 그대로」는 지문에 없는 어법이면 건너뛰게 되므로, 고른 범위 중 지문에 있는 것부터 돌린다
    const found = byPassage ? inPassage(scope) : [];
    const pool = found.length > 0 ? found : scope;
    return pool[turn % pool.length]!;
  })();

  /*
   * 틀 낱말이 굳어 같은 말이 되풀이된다(선생님 지적 2026-10-01).
   *
   * 저장된 문항을 세어 보니 한눈에 보였다 — 내용일치 보기에 mainly 49%·because 57%,
   * 제목추론에 hidden 20%·through 22%, 주제추론에 role 26%·through 27%. 지문이 달라도
   * 같은 틀로 찍어 낸 것이다. 학생이 틀만 보고 찍는다.
   *
   * 쓰지 말 말을 못 박고(아래), 문항마다 보기 모양을 돌려 쓴다(frameShapeLine).
   */
  const FRAME_BANS: Partial<Record<string, string>> = {
    title:
      "Hidden, Behind, Through, Beyond, Turning Point, The Power of, The Secret of, The Role of",
    topic:
      "the role of X in Y, the replacement of, the limits of, the growth of, the importance of, the power of, through",
    summary_mcq: "mainly, because, through",
    content_true: "mainly, because, presented, described, suggests",
    content_false: "mainly, because, presented, described, suggests",
    content_count: "mainly, because, presented, described, suggests",
  };
  const frameBanHint = FRAME_BANS[option.type]
    ? `- BANNED FRAMES (overused; never use these wordings): ${FRAME_BANS[option.type]}. Also: across the five choices, AT MOST TWO may start with the same word (never three), and use any one causal/hedge frame (because/so that/in order to/mainly/largely) at MOST once.`
    : "";

  const isFactType = option.type === "content_true" || option.type === "content_false";
  const paraphraseSystemHint = isFactType
    ? ""
    : paraphraseTypes.has(option.type)
    ? option.difficulty === "low"
      ? "- Choices/<보기> reword the passage with COMMON, easy words (하 level). Do NOT copy long passage phrases, but do not replace easy words with rare synonyms either. Use antonyms mainly in distractors."
      : "- Choices/<보기> MUST paraphrase with ROTATING synonyms/near-synonyms (동의어·유의어). Do NOT copy passage phrases. Across same-passage items, avoid reusing the same theme-word set every time; vary wording and use antonyms mainly in distractors. Title/topic: keep the passage's subject noun itself; vary only the rest."
    : "";
  /*
   * 검수에 걸려 버려지는 까닭을 만들 때부터 막는다(정수학원 273문항 작업 2026-10-04 대조).
   * 버린 생성이 원가의 38%였고, 대부분 같은 몇 가지가 되풀이됐다: 다르게 읽으면 맞는 「오류」,
   * 요구한 개수와 다른 실제 오류 수, 다른 답도 되는 서술형, 밑줄 바로 뒤 말을 답으로 한 특정표현.
   * 첫 메시지(유형마다 같은 글)에 넣어 캐시를 깨지 않는다.
   */
  const qualityRuleHint = [
    option.type === "grammar"
      ? `- GRAMMAR ERRORS MUST BE UNAMBIGUOUS. Every spot you call wrong must be ungrammatical under EVERY reading and have exactly ONE fix: the original word's form. Make an error only where a single form is required, e.g. a finite verb replaced by -ing/-ed/to-V in the main-verb slot, agreement with one clear subject, active/passive when the object is clearly present or absent, adjective/adverb modifying a verb or adjective, what/that or which/where where the clause is clearly complete or incomplete.
- NEVER call these wrong (they are defensible and get the item thrown away): an -ing/-ed form that can be read as modifying a noun; -ing after a to that can be a preposition (look forward to, the way to, be used to); it/they when either antecedent fits; her/his/him → their/them for one person (singular they is correct); tense-only changes; adverb position; which↔that; who↔whom; a word whose wrong-ness depends on meaning rather than grammar.
- Do NOT underline as a correct spot an original phrase that Korean school grammar marks wrong (e.g. "one of the things that makes" — schools teach make). Underline a different spot instead.
- COUNT before you answer: the spots whose text differs from the original passage must be exactly the spots you call wrong, and their number must equal the number this item asks for. Every other underlined spot keeps the original words.`
      : "",
    option.type === "vocabulary"
      ? "- Underline ONE word (two at most) per spot, never a phrase of three or more words."
      : "",
    // 12차 시험: 「A And B」 나열형 제목은 관계가 드러나지 않아 정답과 다퉜다
    option.type === "title" || option.type === "topic"
      ? "- Never use a bare list form like \"Cultural Difference And Species Survival\" (two nouns joined by And/&) for any choice — it hides the relation, so a wrong choice can look as right as the key. Every choice must state a relation or claim (how, why, from A to B, A as B, A that B …)."
      : "",
    /*
     * 전수조사(2026-10-04, 2,639문항): 제목 정답 17%가 글감을 감추거나 비유로 써서 무슨 글인지 안 드러났고,
     * 그런 문항에서 더 분명한 오답이 정답처럼 보여 복수정답이 됐다. 글감을 쉬운 말로 밝히게 한다.
     */
    // 싼 모델이 보기 계획을 자주 빼먹는다(상·하 시험 2026-10-04) — 내용일치처럼 먼저 쓰게 한다
    option.type === "title" || option.type === "topic"
      ? "- REQUIRED OUTPUT ORDER: write \"gistPlan\" and \"choicePlan\" FIRST, then \"choices\" from that plan. An answer without choicePlan is rejected."
      : "",
    option.type === "title" || option.type === "topic"
      ? "- BE EXPLICIT. Every choice — the key above all — names the passage's concrete subject in plain words (animation, the octopus, saving money, residency rules for school sports) and states what the passage says about it. A student who reads only the key must know what the passage is about. No metaphors, riddles or poetic labels (\"A Pledge Still Out of Reach\", \"When Planned Reserves Meet Present Lures\", \"Borrowed Shapes for Secret Feeding\"); never hide the subject behind a cover word (\"A Leaner Method\", \"Firm Guidance\", \"Small Ease\"). Repeating the passage's subject noun is allowed even though the rest is paraphrased. Wrong choices also name the subject; they differ in what they claim."
      : "",
    // 9·10차 시험: 「This stance…」「Such restricted activity…」처럼 보기만 읽으면 가리키는 말이 없었다
    option.isObjective
      ? "- Every choice must stand on its own: never begin with This/That/These/Those/Such/It/They referring to something outside the choice — name it (\"The objective view of science …\"). Keep cause-and-effect wording simple; one clear claim per choice. Never add a time frame (In the past, Today, Nowadays, In advance) or a cause the passage does not state."
      : "",
    /*
     * 내용일치·불일치 전수조사(1,248문항, 2026-10-04)에서 아직 막지 않은 것들.
     */
    option.type === "content_true" || option.type === "content_false" || option.type === "content_count"
      ? `- FACT CHOICES — each states ONE passage fact plainly:
  · Subjects are only people/things the passage names. Never invent an agent or a belief ("Workers …", "Gardeners found …", "사육자들은 ~을 알았다", "사람들은 ~라고 여긴다") unless the passage says exactly that.
  · Never join two separate passage facts with since/because/which can/so/~해서 into a cause the passage does not state.
  · Keep the passage's own names for concrete things and people (nest, friend, cheese, vaccine, Fahrenheit); never swap them for a cover word or a broader term (cradle, companion, melted dairy, formula, Celsius).
  · A TRUE choice keeps the passage's degree exactly ("not one day below" ≠ "kept rising", "every penny" ≠ "nearly all").
  · No choice may lean on another choice or on order words (that ideal, 그다음, 이후, 결국).
  · No giveaways: the false statement must not be the only choice with an extreme word (always/never/only/entirely/반드시/전혀), must not simply reverse another choice, and the true statement must not be the passage's main idea while the others are small details.`
      : "",
    !option.isObjective
      ? "- ONE ANSWER ONLY. The item must have exactly one correct answer; do not rely on acceptableAnswers to cover others. Before finishing, try to find a second answer a careful student could write: another phrase from the passage that fits the blank in grammar and meaning, another word order the given words and the Korean translation allow (a movable adverb or modifier), another valid correction. If one exists, change the item (pick a different blank, make the translation fix the order, choose an error with a single fix) until only one answer works.\n- A word-form change that is optional also makes two answers (life/lives both natural, Copernicus' / Copernicus's): only ask for a change the sentence forces. The <조건> must state rules only — never describe the answer's structure (where a colon goes, what a clause modifies)."
      : "",
    /*
     * 서술형 공통 규칙. 내용도 필요하지만, 요약문·특정표현은 첫 메시지가 1,024토큰 언저리라 캐시가
     * 안 걸렸다(4차 시험: 서술형 입력 캐시 11%). 이 덩어리로 넉넉히 넘긴다.
     */
    !option.isObjective
      ? `- SUBJECTIVE ITEM CONVENTIONS (all 서술형):
  · Word counting: a hyphenated word (well-being, long-term) is ONE word; a contraction (can't, it's) is ONE word; numbers written as digits count as one word. Any "N단어" in the instruction or <조건> must equal the answer's word count under this rule.
  · <조건> lines state rules only (word count, use every given word once, change forms only where required, find it in the passage). Never describe the answer's structure, its first word, where punctuation goes, or what modifies what.
  · <보기> and the blank must not leak the answer: no answer words left next to the blank, no word given twice unless the answer uses it twice, no Korean hints inside <보기>.
  · The Korean <해석> (when present) must be a faithful, natural translation of exactly the answer sentence — no extra content, nothing missing.
  · correctAnswer uses the exact format shown for this type ("ⓐ: … / ⓑ: …" for multi-blank items) and the exact spelling and capitalization the passage uses.
  · explanation (Korean, 평서형 "~다"): state the answer, point to the passage sentence it comes from, and explain only what is true of THIS sentence (subject, verb, object, what modifies what). No invented grammar labels or point numbers.
  · Before returning, re-read the item as a student: solve it from the instruction, <조건>, <보기> and passage alone. If you reach a different answer, or more than one, fix the item.`
      : "",
    option.aingkaCode === "특정표현의미서술"
      ? "- The answer phrase must MEAN the same as the underlined expression so that it could replace it, and it must come from a DIFFERENT place in the passage. Never use the words right after the underline, a cause/result of it, or a related action."
      : "",
    option.type === "summary_short"
      ? "- Each blank answer must be a complete phrase: it may not end with a function word (of, in, to, a, the, and…) or start with a conjunction."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const craftSystemHint = option.isObjective
    ? "- 보기: 5개 모두 그럴듯하게. 정답만 눈에 띄지 않게. 강한 오답 ≥2. 황당 오답 금지. 정답 하나. 길이·구조 균형."
    : "";

  const diversityHint =
    opts.diversitySlot && opts.diversitySlot.total > 1 && isFactType
      ? `- DIVERSITY SLOT ${opts.diversitySlot.index + 1}/${opts.diversitySlot.total}: same passage has many items. Test DIFFERENT facts than the most obvious ones (vary which sentences the choices come from), rather than swapping in synonyms.`
      : opts.diversitySlot && opts.diversitySlot.total > 1
      ? `- DIVERSITY SLOT ${opts.diversitySlot.index + 1}/${opts.diversitySlot.total} (${opts.diversitySlot.label}): same passage has many items. Use a DISTINCT synonym/near-synonym set and DISTINCT hardWords for THIS slot. Do not reuse the most obvious passage theme words that every slot would pick. Distractors may use subtle antonym/contrast shifts.`
      : "";
  /*
   * 같은 지문·같은 유형을 둘 청하면 프롬프트가 글자까지 같아 똑같은 문항이 둘 나왔다
   * (2026-10-02 작업: 지칭·특정표현 4쌍, 다음 작업: 내용일치 9쌍이 겹쳐 지워짐).
   * 사본마다 근거 자리를 달리 잡으라는 한 줄을 넣어 프롬프트를 다르게 한다.
   */
  const copyIndex = opts.copyIndex ?? 0;
  /*
   * 순서추론은 「앞부분/뒷부분」 힌트가 듣지 않는다 — 자르는 자리가 같으면 사본이 똑같아진다
   * (254문항 작업 #36·#37, #205·#206). 사본마다 주어진 글의 길이를 바꿔 경계가 달라지게 한다.
   */
  const copyHint =
    copyIndex > 0 && option.type === "order"
      ? `- SAME-TYPE COPY ${copyIndex + 1} for this passage: another 순서추론 item already exists. Split the passage DIFFERENTLY — the given text must be the first ${Math.min(copyIndex + 1, 3)} sentence(s) of the passage${opts.paraphraseGrammarVocab || option.difficulty === "high" ? " (or a paraphrase of exactly that span)" : ""}, so the (A)(B)(C) boundaries differ from the other copy.`
      : copyIndex > 0
      ? `- SAME-TYPE COPY ${copyIndex + 1} for this passage: another item of this exact type already exists for this passage. Make this one DIFFERENT — anchor the answer/underline/blank/referent in the ${["LATER part", "MIDDLE part", "EARLIER part"][copyIndex % 3]} of the passage, pick a different target sentence or word than the most obvious one, and write different choices.`
      : "";

  // 순서추론도 나열 지문이면 건너뛴다(2026-10-03 전수 대조: 「I have a dream」 반복 연설·항목 나열에서 순서가 둘 이상 성립)
  const allowSkip =
    option.type === "order" ||
    (option.type === "underlined_inference" &&
      (option.aingkaCode === "함축의미추론" ||
        meta?.aingkaCode === "함축의미추론")) ||
    isReferenceWriting;

  const questionTextRule = needsQuestionText
    ? option.type === "sentence_insertion"
      ? "Fill questionText with the ENGLISH given sentence to insert."
      : isGrammarWriting
        ? "Fill questionText with <조건>, <보기>, <해석> exactly as the ITEM RULES show (each tag on its own line)."
      : isSummaryTable
        ? "Fill questionText with <조건> and <표> exactly as the ITEM RULES show (each tag on its own line, one table row per line)."
      : isWordOrder
        ? "Fill questionText with <조건>, <보기>, <해석>. Blank = IMPORTANT passage sentence reflecting the sampled GRAMMAR POINT (not a trivial SVO)."
        : isSummaryBlank
          ? "Fill questionText with <조건>, optional <보기>, and <요약문> with ⓐ/ⓑ blanks."
          : isReferenceWriting
            ? "Fill questionText with <지칭답란> and ⓐ. passageModified needs <u>underline</u>."
            : isGrammarFix
              ? "Fill questionText with <조건> and <답안행>N. No MCQ choices."
              : option.type === "content_count"
                ? "Fill questionText with (1)(2)… statements."
                : "Fill questionText with <조건>/<보기> as needed."
    : 'questionText usually "".';

  const passageModifiedRule = needsModified
    ? isWordOrder || isGrammarWriting
      ? "passageModified MUST include blank ⓐ__________ in the ENGLISH passage."
      : isReferenceWriting
        ? "passageModified MUST underline the pronoun/expression with <u>…</u> (대명사는 ⓐ<u>it</u>)."
        : "Use passageModified when needed."
    : "Do NOT change passage; omit passageModified.";

  const explanationRule = isWordOrder
    ? "한글: 정답 문장 + 배열/어형 포인트."
    : isReferenceWriting
      ? "한글: 정답(본문 구) + 왜 그것이 가리키는 바/문맥 의미인지."
      : isGrammarFix
        ? "학생용 한글: 각 기호/번호 + 틀린 점 → 바른 형태 + 쉬운 이유. 영어 은어 금지."
        : option.type === "grammar"
          ? "학생용 한글 답지(정답 번호 + 틀린형→바른형 + 쉬운 이유). 영어 은어·코드 금지."
          : option.type === "underlined_inference" &&
              option.aingkaCode === "함축의미추론"
            ? "학생용 한글: 정답 번호 + 밑줄의 문맥 의미(이 지문의 말로) + 왜 밑줄 낱말의 사전 뜻 그대로가 아닌지. 지문에 없는 일반론 문장은 쓰지 않는다."
            : "1-2 Korean sentences.";

  // 유형·문항별 규칙 (예전 system 중간에 있던 가변 부분 — 문구 그대로, 순서만 뒤로)
  /*
   * 캐시 실험(2026-10-03): gpt-5.6은 앞 요청의 프롬프트 「전체」가 새 요청의 앞부분과
   * 메시지 단위로 같을 때만 캐시를 읽는다. 앞부분 일부만 같으면 0%다. 그래서 유형마다
   * 같은 규칙을 첫 메시지로 떼어 두고, 작업 시작 때 그 메시지만으로 한 번 불러 캐시를
   * 데운다(primeQuestionCache). 그러면 같은 유형의 모든 문항이 첫 메시지를 캐시로 읽는다.
   * 유형 규칙 가운데 문항마다 달라지는 부분(「--- 이번 문항 ---」 아래)은 둘째 메시지로 보낸다.
   */
  const typeRulesFull = typeRules(
    option,
    opts.grammarWritingMode ?? "paraphrase",
    opts.wordOrderMode ?? "passage",
    opts.typeTurn ?? opts.diversitySlot?.index ?? 0,
    opts.paraphraseGrammarVocab === true
  );
  const ITEM_MARK = "\n\n--- 이번 문항 ---\n";
  const markAt = typeRulesFull.indexOf(ITEM_MARK);
  const typeRulesStatic = markAt >= 0 ? typeRulesFull.slice(0, markAt) : typeRulesFull;
  const typeRulesForItem = markAt >= 0 ? typeRulesFull.slice(markAt + ITEM_MARK.length) : "";

  const itemRules = [
    `- instruction EXACTLY: ${JSON.stringify(forcedInstruction)}`,
    `- ${questionTextRule}`,
    `- ${passageModifiedRule}`,
    `- explanation: ${explanationRule}`,
    englishOnlyHint,
    allowSkip
      ? option.type === "order"
        ? '- 순서추론: 덩어리 사이를 잇는 단서(지시어·연결어·시간 흐름·앞 문단을 받는 말)가 없는 나열 지문(같은 꼴 문장의 반복, 항목 소개 나열)이면 순서가 하나로 정해지지 않는다. 그럴 때는 {"skip":true,"reason":"순서 단서 없음"}.'
        : isReferenceWriting
        ? '- 지칭 서술: 명확한 선행사/문맥 동의 구가 있을 때만. 없으면 {"skip":true,"reason":"..."}.'
        : '- 함축의미: 문맥 의존 표현만. 정답은 사전 뜻이 아니라 지문 구체 paraphrase(밑줄 낱말을 직역한 일반론 X). 없으면 {"skip":true,"reason":"..."}. 본문은 (A)<u>…</u>.\n- 함축의미 밑줄은 지문에 이미 있는 표현에 친다. 지문을 최대한 그대로 쓰고, 밑줄을 만들려고 새 문장을 지어 붙이지 않는다.'
      : "",
    option.type === "sentence_insertion"
      ? "- Do NOT return choices for 문장삽입; slots ①~⑤ in passageModified are the options."
      : "",
    option.type === "irrelevant_sentence"
      ? "- Do NOT return choices for 무관한문장; mark ⓐⓑⓒⓓⓔ IN the passage. The irrelevant sentence must reuse similar passage words but shift topic/point (not bizarre)."
      : "",
    option.aingkaCode === "어휘추론"
      ? "- Do NOT return bottom choices for 어휘 고르기; ①~⑤ in the passage are enough. correctAnswer is the wrong number."
      : "",
    option.aingkaCode === "어법추론" || option.aingkaCode === "어법모두고르기"
      ? "- Do NOT return bottom choices for 어법 추론; ⓐ~ⓔ in the passage are enough. correctAnswer is the ONE wrong underline (1-5)."
      : "",
    option.aingkaCode === "어법개수" || option.aingkaCode === "어휘개수"
      ? '- Count choices MUST be exactly ["1개","2개","3개","4개","5개"] in order — never sparse options.'
      : "",
    option.type === "grammar"
      ? "- 어법: ‘이번 문항’ 문법을 따르고, 해설은 쉬운 한글만(voice/relative/CASE id 금지)."
      : "",
    /*
     * 선생님 지적(2026-09-20): 어법·어휘가 지문을 재진술한다. 기본은 원문 그대로 두고
     * 밑줄 자리만 바꾼다. 재진술은 선생님이 켰을 때만 한다.
     */
    (option.type === "grammar" || option.type === "vocabulary") && !opts.paraphraseGrammarVocab
      ? `- KEEP THE PASSAGE VERBATIM: copy the original passage word for word into passageModified. The ONLY allowed change is the wording inside the marked spots (ⓐ~/①~). Do not reword, shorten, merge, split or reorder any sentence.
- Pick the marked spots from structures the passage ALREADY has (수일치·관계사·준동사·병렬·태·시제·비교 등 원문에 있는 것). If a target grammar point does not exist in this passage, choose another point that does — never rewrite a sentence to plant one.`
      : "",
    (option.type === "grammar" || option.type === "vocabulary") && opts.paraphraseGrammarVocab
      ? /*
         * 2026-10-10 점검(737문항): 바꿔 쓰기 켠 어법 조건부 15개가 모두 문장 단위로 지문을 흔든 것이었다 —
         * 첫 문장을 빼 지시어가 떠 버림, 문장 순서를 섞음, 원문에 없는 문장을 지어 붙여 같은 말이 되풀이됨,
         * 어휘추론에 단서 문장을 넣어 오답이 맞는 말이 됨.
         */
        `- 지문 재진술 켜짐: 밑줄 자리를 만들기 위해 문장 안의 낱말·구조는 바꿔 써도 된다(원문 뜻은 지킬 것).
- 바꿔 쓰더라도 문장 단위는 원문 그대로: 원문 문장을 하나도 빼지 않고, 순서를 바꾸지 않고, 원문에 없는 문장을 새로 지어 넣지 않는다. 문장 수와 차례가 원문과 같아야 한다.
- 바꿔 쓴 문장이 다른 밑줄·보기의 판단을 바꾸면 안 된다(맞는 보기를 틀리게, 틀린 보기를 맞게 만드는 단서 금지). 밑줄 밖의 낱말을 지우거나 덧붙여 원문 뜻을 바꾸지 않는다.`
      : "",
    /*
     * 바꿔 쓰기를 끈 작업은 어느 유형이든 지문을 원문 그대로 둔다(선생님 승인 2026-10-06).
     * 위 줄이 어법·어휘에만 있어서 무관한문장·순서추론·빈칸추론이 지문을 고쳐 썼다(10-06 작업).
     * 유형마다 바꿔도 되는 자리만 적어 준다. 검사는 validate-question.ts의 passageRewriteProblem.
     */
    needsModified && option.type !== "grammar" && option.type !== "vocabulary" && !opts.paraphraseGrammarVocab
      ? `- KEEP THE PASSAGE VERBATIM (지문 바꿔 쓰기 꺼짐): outside the parts this type changes, passageModified copies the original passage word for word — never reword, shorten, merge, split or drop any sentence or phrase. The ONLY allowed change: ${
          option.aingkaCode === "연결어빈칸"
            ? "the connective words replaced by (A)/(B). Use connectives that already start a clause in the passage; the rest of each sentence stays as it is"
            : option.type === "sentence_blank" || isWordOrder || isGrammarWriting
              ? "the blank that replaces the target sentence or phrase. If only part of a sentence is blanked, the rest of that sentence stays word for word"
              : option.type === "order"
                ? option.difficulty === "high"
                  ? "cutting the passage into the lead-in and (A)(B)(C) at sentence boundaries and adding the labels, and paraphrasing the lead-in as the type rules say. (A)(B)(C) stay word for word"
                  : "cutting the passage into the lead-in and (A)(B)(C) at sentence boundaries and adding the labels"
                : option.type === "sentence_insertion"
                  ? "taking out the given sentence (questionText, copied word for word) and putting ①~⑤ between sentences"
                  : option.type === "irrelevant_sentence"
                    ? "the ONE inserted irrelevant sentence and the marks ⓐ~ⓔ"
                    : "the marks and <u>underline</u> tags this type needs"
        }.`
      : "",
    paraphraseSystemHint,
    frameBanHint,
    craftSystemHint,
    qualityRuleHint,
    /*
     * 상·하를 고를 수 있는 객관식(제목·주제·요지·빈칸·순서·삽입·무관·내용일치류)은 문항의 상·하를 따른다.
     * 전에는 작업 난이도(실제 작업은 거의 다 「내신」→중)가 덮어써서 상·하 문항이 같은 「중」 지시를 받았고,
     * 「기본」이면 규칙이 통째로 빠졌다(4차 40문항 시험·작업 설정 대조 2026-10-04).
     */
    difficultyRule(
      option,
      option.isObjective && (option.difficulty === "high" || option.difficulty === "low")
        ? option.difficulty === "high"
          ? "상"
          : "하"
        : opts.targetLevel ?? targetLevelFromOverall(opts.overallDifficulty)
    ),
    opts.levelBrief ? `\n[원래 시험지의 수준]\n${opts.levelBrief}` : "",
    typeRulesStatic,
  ]
    .filter((line) => line.trim())
    .join("\n");
  // 문항마다 달라지는 규칙 — 둘째 메시지로 보낸다(첫 메시지 캐시를 깨지 않게)
  const itemRulesForThisItem = [
    typeRulesForItem,
    // 선생님이 범위를 정해 두었으면 이번 문항에 쓸 어법 하나를 여기서 정해 준다
    option.aingkaCode === "문법조건영작" && pickedWritingGrammar
      ? `[이번 문항에 쓸 어법] ${pickedWritingGrammar.label}(${pickedWritingGrammar.form})\n` +
        `  — ${pickedWritingGrammar.hint}\n` +
        `  이 어법으로 <b>반드시</b> 만든다. 다른 어법으로 바꾸지 않는다.\n` +
        `  지문에 이 어법이 없으면 중요한 문장 하나를 이 어법으로 <b>고쳐 써서</b> 만든다.`
      : "",
  ]
    .filter((line) => line.trim())
    .join("\n");

  /*
   * 「지문 그대로」 제시어 배열은 쓸 문장을 코드가 골라 준다.
   *
   * 선생님 지적(2026-10-01): 만들다 버린 값도 우리가 낸다. 모델이 문장을 고쳐 써 와서
   * 버리는 일이 잦았다(여섯 번에 네 번). 어느 문장을 쓸지 박아 주면 벗어날 데가 없다.
   *
   * 지문 뒤에 붙인다 — 유형 규칙 안에 넣으면 문항마다 앞머리가 달라져 캐시가 깨진다.
   */
  const pickedSentenceLine = (() => {
    if ((opts.wordOrderMode ?? "passage") === "paraphrase") return "";
    if (!/제시어배열/.test(option.aingkaCode ?? "")) return "";
    const sents = String(passage ?? "")
      .split(ENGLISH_SENTENCE_GAP)
      .map((t) => t.trim())
      .filter((t) => {
        const n = t.split(/\s+/).length;
        return n >= 8 && n <= 26;
      });
    if (sents.length === 0) return "";
    /*
     * 같은 지문에서 제시어 배열이 같은 문장을 두 번 고르지 않게, 사본 번호와 유형(기본·어형변화·
     * 단어추가)도 자리에 더한다. 대체로 들어온 문항이 원래 문항과 똑같이 나왔다(2026-10-03 #91·#92).
     */
    const typeOffset = { 제시어배열기본: 0, 제시어배열어형변화: 1, 제시어배열단어추가: 2 }[option.aingkaCode as string] ?? 0;
    /*
     * 제시어 배열은 지문의 중요한 문장(주제문·결론·핵심 주장)으로 한다(선생님 말씀 2026-10-04).
     * 한때 「다른 어순이 안 나오는 문장」을 앞세웠더니 짧고 덜 중요한 문장이 골라졌다. 다른 어순은
     * 선생님이 확인할 일이라(같은 날 결정) 그 감점은 뺐고, 중요도 점수로 고른다.
     * 글 제목이 첫 문장에 붙어 깨진 문장(대문자 낱말이 많은 것)만은 계속 피한다(8차 시험).
     */
    const titleMerged = (t: string) => t.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w)).length >= 3;
    const importance = (t: string, i: number) => {
      const n = t.split(/\s+/).length;
      let s = 0;
      // 결론·주장·요점을 알리는 말
      if (/\b(?:therefore|thus|hence|in short|in sum|to sum up|in conclusion|as a result|consequently|this means|this shows|this suggests|in other words|the key|the point|the lesson|what matters|must|should|need to|have to|it is (?:important|essential|crucial|necessary))\b/i.test(t)) s += 3;
      // 대조 뒤가 글쓴이의 주장인 경우가 많다
      if (/^(?:however|but|yet|instead|rather|in fact|actually)\b/i.test(t)) s += 2;
      // 주제문(첫 문장)·결론(마지막 문장)
      if (i === sents.length - 1) s += 2;
      if (i === 0) s += 1;
      // 예시는 핵심이 아니다
      if (/^(?:for example|for instance|such as|to illustrate|e\.g\.)\b/i.test(t)) s -= 3;
      // 묻는 문장·따옴표 대화는 배열할 핵심 문장이 아니다
      if (/\?\s*["”’]?$/.test(t)) s -= 4;
      if (/["“”]/.test(t)) s -= 2;
      if (n >= 10 && n <= 22) s += 1;
      if (titleMerged(t)) s -= 10;
      return s;
    };
    const scored = sents.map((t, i) => ({ t, s: importance(t, i) })).filter((x) => x.s > -10);
    const ranked = scored.length ? scored : sents.map((t) => ({ t, s: 0 }));
    const best = Math.max(...ranked.map((x) => x.s));
    // 가장 중요한 쪽에서 고르되, 같은 지문에서 사본이 다른 문장을 쓰도록 두세 문장은 남긴다
    const top = ranked.filter((x) => x.s >= best - 1).map((x) => x.t);
    const pool = top.length >= 2 ? top : ranked.sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.t);
    // 다시 만들 때는 다음 문장으로 넘긴다. 같은 문장으로 세 번 시도하면 같은 까닭(다른 어순도 답)으로 또 버려졌다.
    const retryShift = Math.max(0, (opts.attempt ?? 1) - 1);
    /*
     * 사본(copyIndex)은 반드시 다른 문장으로(2026-11-10): 예전 식 copyIndex*3은 후보가 2·3개일 때 나누어떨어져
     * 대체 문항(copyIndex+2 → +6)이 같은 지문의 원래 문항과 문장까지 똑같았다(66문항 시험에서 대체 3건 모두).
     * 사본 0은 핵심 후보(pool) 안에서 고르고, 사본 k는 핵심 후보 → 나머지 순으로 늘어놓은 목록에서 k칸 뒤를 쓴다.
     */
    const base = (opts.diversitySlot?.index ?? 0) + typeOffset + retryShift;
    const copyK = opts.copyIndex ?? 0;
    const firstIdx = base % pool.length;
    const ordered = [
      ...pool.slice(firstIdx),
      ...pool.slice(0, firstIdx),
      ...ranked
        .slice()
        .sort((a, b) => b.s - a.s)
        .map((x) => x.t)
        .filter((t) => !pool.includes(t)),
    ];
    const pick = ordered[copyK % ordered.length]!;
    return `\n\nUSE THIS SENTENCE: 이번 문항은 이 문장을 빈칸으로 한다(글자 그대로, 한 자도 바꾸지 말 것).\n"${pick}"`;
  })();

  /*
   * 문항마다 보기 모양을 돌려 쓴다. 금지 낱말만으로는 또 다른 틀 하나로 몰릴 뿐이다.
   * 작업 전체 차례(typeTurn)로 돌리므로 지문이 바뀌면 다음 모양으로 넘어간다.
   * 지문 뒤에 붙인다 — 유형 규칙 안에 넣으면 문항마다 앞머리가 달라져 캐시가 깨진다.
   */
  const frameShapeLine = (() => {
    const SHAPES: Partial<Record<string, string[]>> = {
      /*
       * 「When A Meets B」·막연한 콜론 틀은 비유 제목을 불렀다(전수조사 2026-10-04, 제목 정답 17%가
       * 무슨 글인지 안 드러남). 모양마다 글감을 넣을 자리를 못 박는다.
       */
      title: [
        "명사구 하나로 — 글감 + 그에 대한 말 (콜론·대시 없이)",
        "콜론 앞에 글감을 쓰고 뒤에 필자의 말 (Limited Animation: ~)",
        "의문문 — Why/What/How 뒤에 글감을 그대로",
        "동명사로 시작하고 글감을 목적어로 (Rethinking ~ / Making ~)",
        "From A to B — A와 B 모두 글의 구체적 대상",
      ],
      topic: [
        "how 로 시작하는 절",
        "why 로 시작하는 절",
        "the way (that) ~ 로 시작",
        "what ~ 로 시작하는 절",
        "명사구 하나로 (절을 쓰지 않는다)",
      ],
      /*
       * 「비교로 (A is more ~ than B)」·「Only when ~」 모양은 뺐다. 254문항 대조(2026-10-03)에서
       * 「Telescopes make distant objects more accessible ... than objects too remote ...」처럼
       * 뜻이 안 서는 보기가 이 두 모양에서만 나왔다.
       */
      /*
       * 「시간 표현을 앞세워 (In the past ~ / Today ~)」·「원인·결과로 (as a result ~)」는 뺐다.
       * 지문에 없는 시점(In the past·Today·In advance)이 붙거나 인과가 엉킨 보기가 이 두 모양에서 나왔다
       * (10·11차 시험 2026-10-04). 시점·인과는 지문에 그대로 있을 때만 쓴다.
       */
      /*
       * 「주어를 사람·집단으로」는 지문에 없는 사람(Workers, Gardeners, 사육자들은 ~알았다)을 지어냈다
       * (내용일치 전수조사 2026-10-04). 지문에 나온 사람만 주어로 쓰게 한다.
       */
      content_true: [
        "지문에 나온 사람·집단을 주어로 (지문에 없는 사람을 새로 세우지 않는다)",
        "주어를 사물·현상으로",
        "지문의 구체적 사실 하나를 그대로 진술 (수치·이름·장소 등, 지문에 있는 것만)",
        "행동·변화를 나타내는 동사를 중심으로",
      ],
    };
    SHAPES.content_false = SHAPES.content_true;
    const list = SHAPES[option.type];
    if (!list) return "";
    const turn = opts.typeTurn ?? opts.diversitySlot?.index ?? 0;
    return `

CHOICE SHAPE: 이번 문항의 <b>정답 보기</b>는 이 모양을 우선한다 — ${list[turn % list.length]}. 억지로 맞추지는 말되, 지난 문항과 같은 틀로 쓰지 않는다.
- 다섯 보기의 첫 낱말은 섞는다. 같은 낱말로 시작하는 보기는 셋까지만(넷 이상이면 버려진다).`;
  })();

  /*
   * 어법추론·어휘추론은 정답 번호가 한쪽으로 몰렸다 — 어휘추론 4번 32%, 1번 0%
   * (2026-10-01 Jayden 선생님 지적: 「정답 선지가 4번으로 패턴화」).
   * 이번 문항의 정답 번호를 박아 주어 고루 흩뜨린다. 지문 뒤에 붙여 캐시를 지킨다.
   */
  const answerSpotLine = (() => {
    const no = plannedAnswerNumber(option.aingkaCode ?? "", opts.typeTurn ?? opts.diversitySlot?.index ?? 0);
    if (!no) return "";
    const c = option.aingkaCode ?? "";
    const how =
      c === "문장삽입"
        ? `주어진 문장이 들어갈 자리를 <b>${no}번</b>으로 잡는다. 나머지 자리에 넣으면 글이 어색해야 한다.`
        : c === "무관한문장"
          ? `흐름에 어긋나는 문장을 <b>${no}번</b>에 둔다. 나머지 네 문장은 자연스럽게 이어진다.`
          : `${no}번 자리만 틀리게(문맥에 어긋나게) 하고 나머지 네 자리는 모두 맞게 둔다.`;
    return `

ANSWER SPOT: 이번 문항의 정답은 <b>${no}번</b>이다. ${how}`;
  })();

  // 슬롯 정보는 같은 유형 문항끼리도 달라지므로 맨 끝에 둔다
  const slotTail = opts.diversitySlot
    ? `\n\nITEM SLOT: ${JSON.stringify({
        diversitySlot: {
          index: opts.diversitySlot.index + 1,
          total: opts.diversitySlot.total,
          label: opts.diversitySlot.label,
        },
      })}${diversityHint ? `\n${diversityHint}` : ""}${copyHint ? `\n${copyHint}` : ""}`
    : "";

  /*
   * 순서: 공통 규칙(system) → 유형 규칙·틀 → 지문 → 슬롯.
   *
   * 실험(2026-10-01): 지문을 앞에 두면 (지문×유형) 짝이 저마다 한 번씩이라 같은
   * 앞머리가 두 번 나오지 않아 캐시가 0%였다. 유형 규칙을 앞으로 올리면 같은 유형의
   * 문항끼리 앞머리를 나눠 가져, 지문이 달라도 캐시가 걸린다.
   * 보내는 차례만 바꾸는 것이라 모델이 읽는 내용은 그대로다.
   */
  const itemData = JSON.stringify({
    grade: opts.grade,
    difficulty: option.difficulty,
    forcedInstruction,
    schema: {
      ...(option.type === "sentence_insertion"
        ? {
            questionText: "ENGLISH given sentence",
            passageModified: "ENGLISH passage with ① ② ③ ④ ⑤ slots",
            choices: [],
            correctAnswer: "integer 1-5",
          }
        : option.type === "irrelevant_sentence"
          ? {
              passageModified:
                "ENGLISH passage with ⓐ ⓑ ⓒ ⓓ ⓔ; one sentence similar in wording but off-point",
              choices: [],
              correctAnswer: "integer 1-5 (ⓐ=1 … ⓔ=5)",
            }
          : option.aingkaCode === "어휘추론"
            ? {
                passageModified:
                  "ENGLISH passage with ①<u>…</u> … ⑤<u>…</u>; exactly one wrong",
                choices: [],
                correctAnswer: "integer 1-5",
                vocabularyJudgments: [
                  {
                    number: "integer 1-5; include every number once in order",
                    verdict: "correct | wrong",
                    replacement: "ENGLISH; required only when wrong",
                    reason: "Korean reason",
                  },
                ],
              }
            : option.aingkaCode === "어법개수" ||
                option.aingkaCode === "어휘개수"
              ? {
                  passageModified: "ENGLISH passage with underlined spots",
                  choices: [
                    { number: 1, text: "1개" },
                    { number: 2, text: "2개" },
                    { number: 3, text: "3개" },
                    { number: 4, text: "4개" },
                    { number: 5, text: "5개" },
                  ],
                  correctAnswer: "integer 1-5 (= count of wrong spots)",
                  ...(option.aingkaCode === "어휘개수"
                    ? {
                        vocabularyJudgments: [
                          {
                            number: "integer; include every marked spot once in order",
                            verdict: "correct | wrong",
                            replacement: "ENGLISH; required only when wrong",
                            reason: "Korean reason",
                          },
                        ],
                      }
                    : {}),
                }
              : option.aingkaCode === "문법조건영작"
                ? {
                    /*
                     * 지정 문법 조건 영작은 이 틀이 없어 아래 객관식 틀(choices·정답 1-5)을 받았다 — questionText·passageModified
                     * 칸이 없으니 모델이 자주 비워 보내 「<조건>·<보기>·<해석>이 필요합니다」로 버려졌다
                     * (2026-10-13 호원고1 다시 만든 두 작업: 앞 시도 27번이 이 까닭, 4문항 대체, 원가 1.7배).
                     */
                    passageModified: "ENGLISH passage, the chosen sentence replaced by ⓐ__________ (everything else unchanged)",
                    questionText: "<조건>\n○ [어법 이름]을 사용할 것\n\n<보기>\nword / word / …\n\n<해석>\n(정답 문장의 우리말 뜻 한 줄)",
                    correctAnswer: "ENGLISH answer sentence",
                    choices: [],
                  }
              : allowSkip
                ? {
                    passageModified: "ENGLISH passage with <u>target</u>",
                    choices: [
                      { number: 1, text: "ENGLISH meaning paraphrase" },
                    ],
                    correctAnswer: "integer 1-5",
                    skip: "boolean optional",
                    reason: "string optional",
                  }
                : {
                    /*
                     * 보기를 쓰기 전에 근거부터 계획하게 한다(2026-10-04, ChatGPT 조언 반영 시험).
                     * 지문에 없는 시점·전제를 붙이거나 느슨하게 바꿔 쓴 보기가 조건부의 절반이었다.
                     * 근거 인용이 지문에 실제로 있는지, 참·거짓 수가 정답과 맞는지는 코드가 확인한다.
                     */
                    ...(CONTENT_PLAN_TYPES.has(option.type)
                      ? {
                          choicePlan: [
                            {
                              n: "integer — the choice number (or statement number for 일치개수)",
                              quote: "EXACT words copied from the passage sentence that decides this choice (6-25 words)",
                              passageSays: "the proposition the passage states: who/what, action, object, condition, quantity, time, and who claims it",
                              change: "none (a true choice) | <element>: <before> → <after> — the ONE meaning element you changed to make it false (subject, action, object, quantity, condition, time, claimant, direction); never add a time frame, cause, comparison, person or premise the passage lacks",
                              refutedBy: "for a false choice: why it and the quoted words cannot both be true (empty for a true choice)",
                              verdict: "true | false — must be decidable from the quote alone",
                            },
                          ],
                        }
                      : GIST_PLAN_TYPES.has(option.type)
                        ? {
                            gistPlan: {
                              subjectWords: "1-3 ENGLISH words copied from the passage that name what it is about (e.g. \"animation\", \"octopus\", \"subscription\") — the key must contain one of them",
                              topic: "what the passage is about (a few words)",
                              claim: "what the writer says about it",
                              coreRelation: "the key relation or contrast",
                            },
                            choicePlan: [
                              {
                                n: "integer — the choice number",
                                flaw: "none (the key) | stance changed | relation changed | conclusion changed | one detail over-represented | too broad — exactly ONE choice is none; a wrong choice must not also state the whole main point",
                              },
                            ],
                          }
                        : {}),
                    choices: [{ number: 1, text: "string" }],
                    correctAnswer: "integer 1-5 (vary; not always 1)",
                    ...(needsModified ? { passageModified: "string" } : {}),
                    /*
                     * 일치개수 틀(진술 (1)~(6)·틀린 개수)이 questionText를 쓰는 서술형 모두에 나가고 있었다 —
                     * 제시어 배열·요약문·어법 수정이 유형 규칙과 다른 틀을 받았다(2026-10-13 점검).
                     */
                    ...(needsQuestionText
                      ? option.type === "content_count"
                        ? {
                            questionText:
                              "(1) ...\\n(2) ...\\n(3) ...\\n(4) ...\\n(5) ...\\n(6) ...",
                            correctAnswer: "integer count of FALSE statements",
                            choices: [],
                          }
                        : {
                            questionText: "string — exactly the blocks the ITEM RULES show, each tag on its own line",
                            correctAnswer: "string — the answer in the form the ITEM RULES describe",
                            choices: [],
                          }
                      : {}),
                  }),
      explanation: "ko",
      hardWords: [{ word: "EN", meaning: "한글뜻" }],
    },
  });

  const userParts: string[] = [
    `ITEM RULES:\n${itemRules}`,
    `${itemRulesForThisItem ? `ITEM RULES (this item):\n${itemRulesForThisItem}\n\n` : ""}` +
      /*
       * 선생님 지적(2026-10-01): 모델이 이 덩어리를 그대로 되돌려 주던 일이 있었다(gpt-5.6-sol
       * 48문항 가운데 44개). 「ITEM FORM」이 「이 틀을 내놓으라」로 읽혀 OUTPUT KEYS로 바꾸고
       * 되돌려 주지 말라고 박았다.
       */
      `OUTPUT KEYS (fill these; do not copy this wrapper):\n${itemData}\n\nPASSAGE:\n` +
      `${JSON.stringify({ passage, hint: englishBodyTypes.has(option.type) ? undefined : slimAnalysis })}` +
      `${pickedSentenceLine}${frameShapeLine}${answerSpotLine}${slotTail}`,
    /*
     * 다시 만들 때 앞 시도가 왜 버려졌는지 알려 준다(2026-10-03). 이전에는 같은 프롬프트를
     * 그대로 다시 보내 같은 실수를 되풀이했다. 셋째 메시지로 따로 보내야 앞 두 메시지를
     * 캐시로 읽는다.
     */
    // 세트 메모도 따로 보낸다 — 앞 두 메시지를 캐시로 읽게
    ...(opts.setNote ? [`SAME-PASSAGE SET (every rule above still applies):
${opts.setNote.slice(0, 1800)}`] : []),
    ...(opts.retryNote
      ? [`PREVIOUS ATTEMPT REJECTED (do not repeat this problem; every rule above still applies):\n${opts.retryNote.slice(0, 400)}`]
      : []),
  ];
  const callBase = {
    preferredModels: [modelForType(option)],
    system: QUESTION_WRITER_SHARED_SYSTEM,
    // 같은 유형끼리 같은 자리로 모이게 이름표를 준다
    cacheKey: `qg-${option.type}-${option.aingkaCode ?? ""}`,
    temperature:
      option.type === "grammar"
        ? 0.55
        : option.type === "vocabulary"
          ? 0.4
          : 0.25,
  };
  if (opts.primeOnly) {
    /*
     * OpenAI는 1,024토큰보다 짧은 앞부분은 캐시하지 않는다. 그런 유형을 데우면 값만 든다
     * (무관한문장 941토큰은 데워도 0이었다, 2026-10-03). 토큰 수를 어림해 넉넉히 넘을 때만 데운다.
     * 어림: 영문·기호는 4글자에 1토큰, 한글은 1글자에 0.8토큰쯤.
     */
    const head = `${callBase.system}${userParts[0]}`;
    let nonAscii = 0;
    for (let i = 0; i < head.length; i++) if (head.charCodeAt(i) > 0x7f) nonAscii++;
    const approxTokens = (head.length - nonAscii) / 4 + nonAscii * 0.8;
    // 점검용: 첫 메시지 길이만 재고 부르지 않는다(값 없음)
    if (process.env.QG_PRIME_DRY === "1") {
      console.log(`[prime-dry] ${option.aingkaCode ?? option.type} ≈${Math.round(approxTokens)} tokens`);
      return null as unknown as GeneratedQuestionPayload;
    }
    if (approxTokens < 1200) return null as unknown as GeneratedQuestionPayload;
    await primeQuestionGeneratorCache({ ...callBase, user: [userParts[0]!] });
    return null as unknown as GeneratedQuestionPayload;
  }

  const raw = (await questionGeneratorChatJsonWithRetry({
    ...callBase,
    user: userParts,
    /*
     * 상한은 쓴 만큼만 값을 내므로 넉넉히 둔다. 1,600·2,800일 때 추론 토큰까지 합쳐 상한에 걸려 잘린
     * 호출이 생성의 8~10%였고, 잘린 응답은 값을 다 내고 버린 뒤 상한을 올려 다시 불렀다
     * (정수학원 발곡고1 2026-10-05: 34번·1,430원, 원가의 8%).
     */
    maxTokens:
      option.type === "grammar" || option.type === "vocabulary" ? 4000 : 3000,
  })) as Record<string, unknown>;

  if ((allowSkip || isFactType) && raw.skip === true) {
    throw new SkipQuestionError(
      String(raw.reason || "적합한 함축 표현이 없어 문항을 생략합니다.")
    );
  }

  // 보기 계획 대조(보기를 섞기 전 원래 번호로) — 틀리면 까닭을 남기고 다시 만든다
  const planTypes = CONTENT_PLAN_TYPES.has(option.type) || GIST_PLAN_TYPES.has(option.type);
  // 근거 인용은 한국어 보기여도 영어 원문이라 내용일치류는 언어와 상관없이 대조한다
  if (planTypes && (option.choiceLanguage !== "korean" || CONTENT_PLAN_TYPES.has(option.type))) {
    const planError = checkChoicePlan(raw, option, passage);
    if (planError) throw new Error(planError);
  }
  if (option.type === "sentence_blank") {
    const abbr = blankedAbbreviation(raw, passage);
    if (abbr) throw new Error(abbr);
    const blankedName = blankedOnlyNameInKey(raw, passage);
    if (blankedName) throw new Error(blankedName);
    const forward = blankedForwardPointer(raw, passage);
    if (forward) throw new Error(forward);
  }
  if (option.aingkaCode === "함축의미추론") {
    const dual = dualFunctionLeak(raw, passage);
    if (dual) throw new Error(dual);
  }
  if (option.type === "content_true" || option.type === "content_false") {
    const giveaway = extremeWordGiveaway(raw);
    if (giveaway) throw new Error(giveaway);
  }

  const payload = normalizePayload(
    raw,
    option,
    passage,
    forcedInstruction
  );
  if (option.type === "sentence_insertion") {
    const endSlot = moveEndInsertionSlot(payload as { passageModified?: string | null; correctAnswer?: unknown; explanation?: string | null });
    if (endSlot) throw new Error(endSlot);
  }
  // 보기 계획을 근거로 남긴다(해설·점검에서 쓴다). 보기를 섞어도 문장으로 찾을 수 있게 보기 글을 함께 적는다
  if (planTypes && Array.isArray(raw.choicePlan)) {
    const rawChoices = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
    payload.evidence = (raw.choicePlan as Array<Record<string, unknown>>).map((r) => {
      const text = rawChoices.find((c) => Number(c.number) === Number(r.n))?.text;
      return {
        sentence: String(r.quote ?? ""),
        description: [text ? `보기: ${String(text)}` : `보기 ${r.n}`, r.change ? `바꾼 것: ${r.change}` : "", r.verdict ? `판정: ${r.verdict}` : "", r.flaw ? `흠: ${r.flaw}` : ""]
          .filter(Boolean)
          .join(" · "),
      };
    });
  }

  if (
    option.type === "vocabulary" &&
    (option.aingkaCode === "어휘추론" || option.aingkaCode === "어휘개수")
  ) {
    const turn = opts.typeTurn ?? opts.diversitySlot?.index ?? 0;
    /*
     * 정답(틀린 개수·번호)을 미리 박아 두는 것은 정답이 한쪽으로 몰리지 않게 하려는 것이다.
     * 그런데 박아 둔 개수만 고집하면 다시 만들어도 계속 어긋나 끝내 못 만든다
     * (정수학원 273문항 작업 2026-10-04: 어휘개수 13개 중 6개 미생성, 값은 세 번씩 냈다).
     * 다시 만들 때는 문항 자체(본문·정답·판정)만 맞으면 받는다.
     */
    /*
     * 어휘개수는 첫 시도부터 박아 둔 개수를 대조하지 않는다. 지시문으로 개수는 계속 주되, 어긋나면
     * 다시 만든 시도는 어차피 대조 없이 받으므로 정답 분포는 같고 버리는 호출만 늘었다
     * (정수학원 발곡고1 272문항 2026-10-05: 어휘개수 17문항 중 13문항이 「계획한 정답은 N인데」로 한 번씩 버려짐).
     */
    const expectedAnswer = opts.retryNote || option.aingkaCode === "어휘개수"
      ? null
      : plannedAnswerNumber("어휘추론", turn);
    /*
     * 기호가 ② ① ③…으로 뒤바뀌어 왔으면 대조하기 전에 차례대로 매긴다.
     * 판정(vocabularyJudgments)의 번호는 모델이 찍은 기호를 가리키므로 같은 짝으로 옮긴다.
     * 뒤의 형태 검수에 맡기면 판정으로 만든 해설과 본문이 어긋난 채 매겨진다(2026-10-02).
     */
    let judgments = raw.vocabularyJudgments;
    const circled = "①②③④⑤";
    const seenMarks: string[] = [];
    for (const m of String(payload.passageModified ?? "").matchAll(/[①②③④⑤]/g)) {
      if (!seenMarks.includes(m[0]!)) seenMarks.push(m[0]!);
    }
    if (
      seenMarks.length >= 2 &&
      seenMarks.join("") !== circled.slice(0, seenMarks.length) &&
      renumberMarksInOrder(payload, "passage", answerIsMarkIndex(option)) &&
      Array.isArray(judgments)
    ) {
      // 옛 기호가 몇 번째로 나왔는지가 곧 새 번호다
      const newNo = (old: number) => {
        const at = seenMarks.indexOf(circled[old - 1] ?? "");
        return at >= 0 ? at + 1 : old;
      };
      judgments = judgments
        .map((j) => {
          const row = (j ?? {}) as Record<string, unknown>;
          const n = Number(row.number);
          return Number.isInteger(n) ? { ...row, number: newNo(n) } : row;
        })
        .sort((a, b) => Number(a.number) - Number(b.number));
    }
    const consistency = validateVocabularyConsistency({
      code: option.aingkaCode,
      passageModified: payload.passageModified,
      correctAnswer: payload.correctAnswer,
      judgments,
      expectedAnswer,
    });
    if (!consistency.ok) {
      throw new Error(consistency.problems.join(" · "));
    }
    payload.explanation = plainKorean(consistency.explanation ?? payload.explanation);
  }

  /*
   * 순서추론: 정답이 (A)-(B)-(C)로 나오면 라벨을 돌려 준다.
   * 글을 자르고 이름표만 차례대로 붙인 것이라 ①만 찍어도 맞던 것을 막는다.
   * 자세한 사정은 order-relabel.ts에 적었다.
   */
  if (
    option.type === "order" &&
    payload.passageModified &&
    Array.isArray(payload.choices) &&
    payload.choices.length >= 2
  ) {
    const answerNo = Number(payload.correctAnswer);
    if (Number.isFinite(answerNo) && answerNo >= 1) {
      const fixed = relabelOrderQuestion({
        passageModified: payload.passageModified,
        choices: payload.choices,
        correctAnswer: answerNo,
        explanation: payload.explanation || "",
      });
      if (fixed.changed) {
        payload.passageModified = fixed.passageModified;
        payload.choices = fixed.choices;
        payload.explanation = fixed.explanation;
      }
    }
  }
  const shapeError = assertBasicQuestionShape(
    payload,
    option,
    opts.grammarWritingMode ?? "paraphrase",
    opts.wordOrderMode ?? "passage",
    !opts.paraphraseGrammarVocab,
    opts.typeTurn ?? opts.diversitySlot?.index ?? 0,
    !opts.retryNote
  );
  if (shapeError) throw new Error(shapeError);
  /*
   * 어법 추론은 수능처럼 지문 속 ①~⑤로 (정답 번호와 같은 기호).
   * 무관한문장도 같다 — 지문은 ⓐ~ⓔ인데 정답지는 ②로 찍혀 학생이 맞춰 볼 수 없었다
   * (정수학원 10월 5일 작업 3문항 모두, 해설도 「정답은 ②다. ⓑ는 …」로 섞임).
   */
  if (
    option.type === "irrelevant_sentence" ||
    (option.type === "grammar" && (option.aingkaCode === "어법추론" || option.aingkaCode === "어법모두고르기"))
  ) {
    const toNum: Record<string, string> = { "ⓐ": "①", "ⓑ": "②", "ⓒ": "③", "ⓓ": "④", "ⓔ": "⑤" };
    const swap = (t?: string | null) => (t ? t.replace(/[ⓐⓑⓒⓓⓔ]/g, (m) => toNum[m] ?? m) : t);
    payload.passageModified = swap(payload.passageModified) ?? payload.passageModified;
    payload.explanation = swap(payload.explanation) ?? payload.explanation;
  }
  /*
   * 어법·어휘 추론의 해설 머리글 「정답은 ③이다」가 정답지와 다른 번호인 일이 있었다
   * (202문항 대조 2026-10-02: 둘 다 「어색한 것은 ②」라는 본문은 맞고 머리글만 틀렸다).
   * 번호 하나만 다르면 정답지에 맞춘다.
   */
  if (answerIsMarkIndex(option) && Number.isInteger(Number(payload.correctAnswer))) {
    const mark = "①②③④⑤"[Number(payload.correctAnswer) - 1];
    if (mark) {
      payload.explanation = String(payload.explanation ?? "").replace(
        /^(\s*정답은\s*)[①-⑤]/,
        `$1${mark}`
      );
    }
  }
  /*
   * 해설에 내부 문법 꼬리표(GP04·GP11 …)가 새어 나오지 않게 지운다. 프롬프트에서 막았는데도
   * 여러 학원 문항에서 보였다(2026-10-03 전수 대조).
   */
  payload.explanation = String(payload.explanation ?? "")
    .replace(/\s*\(?\bGP\s?\d{2}\b\)?\s*[:：·-]?\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  /*
   * 순서추론은 밑줄을 쓰지 않는다. 모델이 단서 문장(「(C) <u>This helped him…</u>」)에 밑줄을 쳐
   * 학생에게 답의 힌트가 그대로 보였다(정수학원 99문항 중 2개, 2026-10-04).
   */
  if (option.type === "order") {
    payload.passageModified = payload.passageModified?.replace(/<\/?u>/g, "") ?? payload.passageModified;
    payload.questionText = payload.questionText?.replace(/<\/?u>/g, "") ?? payload.questionText;
  }
  return payload;
}

/**
 * 묻는 글에 발문이 또 적혀 있으면 떼어낸다.
 *
 * 선생님 지시(2026-10-01)로 문항을 하나하나 대조하다 찾았다. 모델이 발문을
 * questionText 머리에 한 번 더 적어 와서, 인쇄물에 같은 발문이 두 번 나왔다
 * (「다음 글의 ①~⑤ 중 어법상 틀린 문장의 번호를 모두 쓰고…」가 발문 칸과 묻는 글에).
 * 발문은 instruction 칸이 맡으므로 묻는 글에서는 지운다.
 *
 * 글자가 똑같은 줄만 지운다 — 조금이라도 다르면 그 줄에 다른 뜻이 있을 수 있어 둔다.
 */
export function stripRepeatedInstruction(questionText: string, instruction: string): string {
  const want = String(instruction ?? "").trim();
  if (want.length < 14) return questionText;
  const kept = String(questionText ?? "")
    .split("\n")
    .filter((line) => line.trim() !== want);
  return kept.join("\n").replace(/^\n+/, "");
}
