import { rejectConditionalChoice } from "@/lib/lesson-materials/grammar-choice-v2/conditional-ch05";
import { rejectConjunctionChoice } from "@/lib/lesson-materials/grammar-choice-v2/conjunction-ch10";
import { rejectNonfiniteChoice } from "@/lib/lesson-materials/grammar-choice-v2/nonfinite-ch09";
import { rejectSpecialChoice } from "@/lib/lesson-materials/grammar-choice-v2/special-ch14";
import { rejectVoiceChoice } from "@/lib/lesson-materials/grammar-choice-v2/voice-ch03";
import { rejectModalChoice } from "@/lib/lesson-materials/grammar-choice-v2/modal-ch04";
import { rejectSentenceChoice } from "@/lib/lesson-materials/grammar-choice-v2/sentence-ch01";
import { rejectTenseChoice } from "@/lib/lesson-materials/grammar-choice-v2/tense-ch02";
import { rejectInfinitiveChoice } from "@/lib/lesson-materials/grammar-choice-v2/infinitive-ch06";
import { rejectGerundChoice } from "@/lib/lesson-materials/grammar-choice-v2/gerund-ch07";
import { rejectPartsChoice } from "@/lib/lesson-materials/grammar-choice-v2/parts-ch13";
import { rejectComparisonChoice } from "@/lib/lesson-materials/grammar-choice-v2/comparison-ch12";
import { rejectParticipleChoice } from "@/lib/lesson-materials/grammar-choice-v2/participle-ch08";
import { rejectRelativeChoice } from "@/lib/lesson-materials/grammar-choice-v2/relative-ch11";
import {
  ambiguousSubjectBoundary,
  bothWhatThatGrammatical,
} from "@/lib/lesson-materials/grammar-choice-v2/choice-repair";
import {
  isMechanicalToInfinitiveMarker,
  isWhToInfinitiveSpan,
  rejectFabricatedDistractor,
} from "@/lib/lesson-materials/grammar-choice-v2/distractor-guard";
import {
  hasInterveningAgreement,
  isNumberAgreementPair,
  whenFollowedByFiniteClause,
} from "@/lib/lesson-materials/grammar-choice-v2/structure-frames";
import { ontologyPoint } from "@/lib/lesson-materials/grammar-choice-v2/grammar-ontology";
import { findOccurrences } from "@/lib/lesson-materials/grammar-choice-v2/span-resolver";
import type {
  ExactSentence,
  GrammarCandidate,
  LocalRejectCode,
} from "@/lib/lesson-materials/grammar-choice-v2/types";

const MODALS = new Set([
  "can",
  "could",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "will",
  "would",
]);

const IMPERATIVES = new Set(["think", "imagine", "consider"]);

export function normalizeToken(text: string): string {
  return text.trim().toLowerCase().replace(/[’]/g, "'");
}

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * 불규칙 동사의 과거·과거분사를 원형으로 되돌리는 표.
 *
 * 규칙 접사만 벗기면 said -> said, went -> went로 남아 원형과 다른 낱말로 보인다.
 * 그러면 said/says 같은 순수 시제 굴절 쌍이 "형태가 아니라 의미로 갈리는 쌍"으로
 * 오분류되어 MEANING_ONLY_CONTRAST로 죽는다.
 * 관측: 스냅샷 17지문에서 제안된 TENSE 후보 5개가 전부 이 경로로 탈락했다
 * (said/says x4, occupy/occupied x1). 시제 문항 0건의 직접 원인이다.
 */
const IRREGULAR_VERB_STEM = new Map<string, string>([
  ["said", "say"], ["went", "go"], ["gone", "go"], ["made", "make"],
  ["took", "take"], ["taken", "take"], ["came", "come"], ["saw", "see"],
  ["seen", "see"], ["knew", "know"], ["known", "know"], ["got", "get"],
  ["gotten", "get"], ["gave", "give"], ["given", "give"], ["found", "find"],
  ["thought", "think"], ["told", "tell"], ["became", "become"],
  ["left", "leave"], ["felt", "feel"], ["brought", "bring"], ["began", "begin"],
  ["begun", "begin"], ["kept", "keep"], ["held", "hold"], ["wrote", "write"],
  ["written", "write"], ["stood", "stand"], ["heard", "hear"],
  ["meant", "mean"], ["met", "meet"], ["ran", "run"], ["paid", "pay"],
  ["sat", "sit"], ["spoke", "speak"], ["spoken", "speak"], ["led", "lead"],
  ["grew", "grow"], ["grown", "grow"], ["lost", "lose"], ["fell", "fall"],
  ["fallen", "fall"], ["sent", "send"], ["built", "build"],
  ["understood", "understand"], ["drew", "draw"], ["drawn", "draw"],
  ["broke", "break"], ["broken", "break"], ["spent", "spend"],
  ["chose", "choose"], ["chosen", "choose"], ["rose", "rise"], ["risen", "rise"],
  ["drove", "drive"], ["driven", "drive"], ["ate", "eat"], ["eaten", "eat"],
  ["forgot", "forget"], ["forgotten", "forget"], ["bought", "buy"],
  ["caught", "catch"], ["taught", "teach"], ["sought", "seek"],
  ["fought", "fight"], ["won", "win"], ["shown", "show"],
  ["arose", "arise"], ["arisen", "arise"], ["dealt", "deal"], ["laid", "lay"],
  ["did", "do"], ["done", "do"], ["does", "do"], ["had", "have"], ["has", "have"],
  ["slept", "sleep"], ["woke", "wake"], ["woken", "wake"], ["wore", "wear"], ["worn", "wear"],
  ["threw", "throw"], ["thrown", "throw"], ["flew", "fly"], ["flown", "fly"], ["swam", "swim"],
  ["swum", "swim"], ["sang", "sing"], ["sung", "sing"], ["rang", "ring"], ["rung", "ring"],
  ["drank", "drink"], ["drunk", "drink"], ["hid", "hide"], ["hidden", "hide"], ["bit", "bite"],
  ["bitten", "bite"], ["rode", "ride"], ["ridden", "ride"], ["froze", "freeze"], ["frozen", "freeze"],
  ["stole", "steal"], ["stolen", "steal"], ["tore", "tear"], ["torn", "tear"], ["shook", "shake"],
  ["shaken", "shake"], ["forgave", "forgive"], ["forgiven", "forgive"], ["lent", "lend"],
  ["bent", "bend"], ["fed", "feed"], ["fled", "flee"], ["hung", "hang"], ["dug", "dig"],
  ["struck", "strike"], ["stuck", "stick"], ["swept", "sweep"], ["wept", "weep"], ["crept", "creep"],
  ["dreamt", "dream"], ["learnt", "learn"], ["burnt", "burn"], ["spelt", "spell"], ["lit", "light"],
  ["slid", "slide"], ["sold", "sell"], ["won't", "will"],
]);

/**
 * 비교에만 쓰는 어간. 원형이 아니다.
 *
 * 묵음 e를 떼어 맞춘다. 떼지 않으면 taking -> tak, take -> take, writing -> writ,
 * written -> write로 같은 동사가 서로 다른 낱말로 보여 took / taking, written /
 * writing 같은 표준 형태 쌍이 "의미로만 갈리는 쌍"으로 떨어졌다. 호출부는 모두
 * 두 어간이 같은지만 보므로(어간으로 낱말을 만들지 않는다) 원형일 필요가 없다.
 */
export function stemVerb(word: string): string {
  const w = normalizeToken(word).replace(/^to\s+/, "");
  const irregular = IRREGULAR_VERB_STEM.get(w);
  if (irregular) return dropSilentE(irregular);
  if (w.endsWith("ing") && w.length > 4) {
    let stem = w.slice(0, -3);
    if (stem.length >= 4 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1);
    return dropSilentE(stem);
  }
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("es") && w.length > 4) return dropSilentE(w.slice(0, -2));
  if (w.endsWith("s") && w.length > 3) return dropSilentE(w.slice(0, -1));
  if (w.endsWith("ied") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ed") && w.length > 4) {
    let stem = w.slice(0, -2);
    if (stem.length >= 4 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1);
    return dropSilentE(stem);
  }
  return dropSilentE(w);
}

function dropSilentE(stem: string): string {
  return stem.length > 3 && stem.endsWith("e") && !stem.endsWith("ee") ? stem.slice(0, -1) : stem;
}

export function subtypeKey(pointCode: string, a: string, b: string): string {
  const pair = [normalizeToken(a), normalizeToken(b)].sort().join("|");
  if (
    /\bmany\b/.test(`${normalizeToken(a)} ${normalizeToken(b)}`) &&
    /kind/.test(pair)
  ) {
    return "COUNTABLE_PLURAL_AFTER_MANY";
  }
  return `${pointCode}:${pair}`;
}

/**
 * 문장 속 정답 자리. 낱말 경계로 찾는다.
 *
 * indexOf로 찾으면 in이 feeling 안에서, to가 impostor 안에서 잡혀 앞 낱말과 앞 문맥을
 * 엉뚱한 데서 읽었다(2026-09-11 배포 전 점검: at some point [in / during] their lives의
 * 앞 낱말이 feel로 읽혔다). 대소문자가 달라도 찾는다.
 */
export function spanStart(sentence: string, span: string): number {
  const needle = span.trim();
  if (!needle) return -1;
  return (
    findOccurrences(sentence, needle)[0] ??
    findOccurrences(sentence.toLowerCase(), needle.toLowerCase())[0] ??
    sentence.toLowerCase().indexOf(needle.toLowerCase())
  );
}

function previousToken(sentence: string, span: string): string {
  const at = spanStart(sentence, span);
  if (at <= 0) return "";
  const before = sentence.slice(0, at).trim();
  const parts = tokens(before);
  return normalizeToken(parts[parts.length - 1] ?? "");
}

function isInflectionOnly(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length !== tb.length || ta.length === 0) return false;
  let diffs = 0;
  for (let i = 0; i < ta.length; i++) {
    if (normalizeToken(ta[i]!) === normalizeToken(tb[i]!)) continue;
    diffs += 1;
    if (stemVerb(ta[i]!) !== stemVerb(tb[i]!)) return false;
  }
  return diffs === 1;
}

function stripLeadingTo(text: string): string {
  const n = normalizeToken(text);
  return n.startsWith("to ") ? n.slice(3).trim() : n;
}

/**
 * 전치사 to를 거느리는 표현. 뒤에는 동명사가 와야 하므로 to 뒤 V / V-ing 대비가
 * 곧 문법 포인트다(look forward to hearing, be used to getting up).
 */
const TO_PREPOSITION_GOVERNOR =
  /\b(?:look(?:s|ed|ing)? forward|(?:used|accustomed|devoted|committed|dedicated|opposed|addicted|close|key|contribution|objection|approach|attention|reply|answer|access|in addition|with a view|when it comes)|object(?:s|ed)?|contribut(?:e|es|ed|ing)|admit(?:s|ted)?|confess(?:es|ed)?|react(?:s|ed)?|adjust(?:s|ed)?|resort(?:s|ed)?)\s*$/i;

/**
 * 부정사 to가 네모 밖에 있고 네모 안에서 -ing만 붙었다 떨어지는 쌍(want to [go / going]).
 * 앞의 to가 답을 기계적으로 정한다.
 *
 * 예전에는 네모 안에 to가 들어간 쌍(to borrow / borrowing, drawing / to draw)과
 * 전치사 to 뒤(look forward to [hearing / hear])까지 여기서 막았다. 앞의 것은
 * 동명사·to부정사를 가르는 축 자체이고 뒤의 것은 전치사+동명사의 대표 문항이라,
 * 목적·병렬·it takes to·remember to 같은 코드가 대표 문항부터 떨어졌다.
 */
function isMechanicalGovernorForm(
  correct: string,
  wrong: string,
  prev: string,
  before: string
): boolean {
  const c = normalizeToken(correct);
  const w = normalizeToken(wrong);
  // 앞의 to 뒤에 to가 또 오는 쌍(was meant to [stirring / to stir])은 to가 둘이 된다.
  if (prev === "to" && (c.startsWith("to ") || w.startsWith("to "))) {
    const cb = stripLeadingTo(c);
    const wb = stripLeadingTo(w);
    if (cb && wb && !cb.includes(" ") && !wb.includes(" ") && stemVerb(cb) === stemVerb(wb)) return true;
  }
  if (c.startsWith("to ") || w.startsWith("to ")) return false;
  if (!c || !w || c.includes(" ") || w.includes(" ")) return false;
  if (stemVerb(c) !== stemVerb(w)) return false;
  if (c.endsWith("ing") === w.endsWith("ing")) return false;
  if (prev !== "to") return false;
  const beforeTo = before.replace(/\s*\bto\s*$/i, "");
  return !TO_PREPOSITION_GOVERNOR.test(beforeTo);
}

function looksLikeToVVsToVing(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  const pair = [na, nb].sort();
  if (pair[0]!.startsWith("to ") && pair[1]!.startsWith("to ")) {
    const left = pair[0]!.slice(3);
    const right = pair[1]!.slice(3);
    return left.endsWith("ing") !== right.endsWith("ing");
  }
  return (
    (na.endsWith("ing") || nb.endsWith("ing")) &&
    stemVerb(na) === stemVerb(nb) &&
    !na.includes(" ") &&
    !nb.includes(" ")
  );
}

export function repairForbiddenConditionalDistractor(
  candidate: GrammarCandidate
): GrammarCandidate {
  if (!candidate.pointCode.startsWith("CONDITIONAL_")) return candidate;
  const wrong = candidate.distractors[0] ?? "";
  const next = rewriteConditionalWrong(candidate.correctAnswer, wrong);
  if (!next || next === wrong) return candidate;
  return { ...candidate, distractors: [next, ...candidate.distractors.slice(1)] };
}

function rewriteConditionalWrong(correct: string, wrong: string): string | null {
  const c = normalizeToken(correct);
  const w = normalizeToken(wrong);
  if (/\bwould\b|\bcould\b|\bmight\b/.test(w)) return null;
  if (/\bhad\b/.test(c) && /\bhave\b|\bhas\b/.test(w)) {
    return wrong.replace(/\b(?:have|has)\b/i, "would have");
  }
  if (/\bwere\b/.test(c) && /\b(?:is|are|was)\b/.test(w)) {
    return wrong.replace(/\b(?:is|are|was)\b/i, "would be");
  }
  return null;
}

function isMisclassifiedComparative(correct: string, wrong: string): boolean {
  const parts = [correct, wrong].map((s) => s.trim().toLowerCase()).sort();
  if (!parts.every((part) => /^more [a-z]+$/.test(part))) return false;
  const stems = parts.map((part) => part.replace(/^more /, ""));
  return stems[0] !== stems[1] && (stems[0] + "ly" === stems[1] || stems[1] + "ly" === stems[0]);
}

const IRREGULAR_COMPARATIVE = new Set(["better", "worse", "farther", "further", "lesser", "elder"]);
const IRREGULAR_SUPERLATIVE = new Set(["best", "worst", "farthest", "furthest", "least", "eldest"]);
const COMPARATIVE_STOP = new Set([
  "other", "another", "whether", "after", "over", "under", "never", "water", "number",
  "power", "member", "order", "cover", "answer", "paper", "letter", "teacher", "however",
  "whatever", "whoever", "wherever", "either", "neither", "rather", "her", "per", "were",
  "there", "where", "here", "user", "server", "filter", "corner", "border", "mother",
  "father", "brother", "sister", "weather", "together", "ever", "carrier", "barrier",
  "integer", "proper", "inner", "outer", "former",
]);
const SUPERLATIVE_STOP = new Set([
  "interest", "forest", "honest", "modest", "protest", "request", "contest", "digest",
  "suggest", "arrest", "invest", "persist", "exist", "rest", "test", "west",
]);

function looksComparativeForm(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_COMPARATIVE.has(w)) return true;
  if (COMPARATIVE_STOP.has(w) || w.length < 5) return false;
  if (/ier$/.test(w)) return true;
  return /er$/.test(w);
}

function looksSuperlativeForm(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_SUPERLATIVE.has(w)) return true;
  if (SUPERLATIVE_STOP.has(w) || w.length < 6) return false;
  if (/iest$/.test(w)) return true;
  return /est$/.test(w);
}

/** more/less + comparative, most + superlative, or a redundant marker on an irregular degree form. */
export function isDoubleDegreeMarking(text: string): boolean {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i += 1) {
    const mark = words[i]!;
    const next = words[i + 1]!;
    if ((mark === "more" || mark === "less") && looksComparativeForm(next)) return true;
    if (mark === "most" && looksSuperlativeForm(next)) return true;
  }
  return false;
}

export function rejectCandidate(input: {
  candidate: GrammarCandidate;
  sentence: ExactSentence;
}): LocalRejectCode | null {
  const { candidate, sentence } = input;
  const correct = candidate.correctAnswer;
  const wrong = candidate.distractors[0] ?? "";
  if (!correct || !wrong) return "SOURCE_ANSWER_MISMATCH";
  if (isMechanicalToInfinitiveMarker(correct, wrong)) return "MECHANICAL_INFINITIVE_MARKER";
  if (correct !== candidate.sourceSpan) return "SOURCE_ANSWER_MISMATCH";
  if (!sentence.text.includes(correct)) return "SOURCE_SPAN_NOT_FOUND";
  if (bothWhatThatGrammatical(sentence.text, correct, wrong)) return "BOTH_GRAMMATICAL";
  /*
   * 목적의 to부정사 정답에 V-ing 오답은 분사구문으로 읽혀 둘 다 선다(2026-11-10 시험:
   * 「consider the costs [to avoid / avoiding] financial strain」, 「utilizes a video lecture service
   * [to expand / expanding] her knowledge」). 다른 오답(동사원형 등)을 가진 후보만 남긴다.
   */
  if (
    candidate.pointCode === "INFINITIVE_ADVERB_ROLE" &&
    /^to\s+[a-z]/i.test(correct.trim()) &&
    /^[a-z]+ing\b/i.test(wrong.trim())
  ) {
    return "BOTH_GRAMMATICAL";
  }
  if (ambiguousSubjectBoundary(sentence.text, correct)) return "AMBIGUOUS_SUBJECT_BOUNDARY";
  if (
    candidate.pointCode === "INDIRECT_QUESTION_ORDER" &&
    isWhToInfinitiveSpan(`${correct} ${sentence.text}`) &&
    !/\b(?:you|we|they|things?)\s+(?:have|should)\b/i.test(correct)
  ) {
    return "ANALYSIS_ONLY";
  }
  const basic = tooBasicForLevel(sentence.text, correct, wrong);
  if (basic) return basic;
  /**
   * 간접의문문은 의문사·whether·if가 이끄는 절이어야 한다. all you have to do is ...처럼
   * 의문사 없는 you have를 [you have / do you have]로 묻는 것은 간접의문문이 아니고
   * 오답도 어색하다(2026-09-11 선생님 검토에서 두 지문에 나왔다).
   */
  if (candidate.pointCode === "INDIRECT_QUESTION_ORDER") {
    const at = spanStart(sentence.text, correct);
    const lead = sentence.text.slice(0, Math.max(0, at)).split(/\s+/).filter(Boolean).slice(-5).join(" ");
    const inBox = /^(?:what|which|where|when|why|how|who|whom|whose|whether|if)\b/i.test(correct);
    if (!inBox && !/\b(?:what|which|where|when|why|how|who|whom|whose|whether|if)\b/i.test(lead)) {
      return "CODE_SPAN_CONTRACT_MISMATCH";
    }
  }
  /**
   * 어순 문항의 오답은 의문문 어순(조동사·be동사가 주어 앞)이어야 학습자가 실제로
   * 틀리는 형태다. [you'll enjoy / enjoy you'll]처럼 낱말을 아무렇게나 뒤집은 오답은 뺀다.
   */
  if (
    (candidate.pointCode === "INDIRECT_QUESTION_ORDER" || candidate.pointCode === "NOUN_CLAUSE_DECLARATIVE_ORDER") &&
    !/^(?:what\s+|which\s+|where\s+|when\s+|why\s+|how\s+|whether\s+|if\s+)?(?:am|is|are|was|were|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must)\b/i.test(wrong.trim())
  ) {
    return "IMPLAUSIBLE_DISTRACTOR";
  }
  // too/enough 문항은 enough의 자리(형용사 뒤)를 묻는다. [too long / long too]는 이 축이 아니다.
  if (candidate.pointCode === "TOO_ENOUGH" && !/\benough\b/i.test(`${correct} ${wrong}`)) {
    return "IMPLAUSIBLE_DISTRACTOR";
  }
  if (isMisclassifiedComparative(correct, wrong)) return "MISCLASSIFIED_ASSESSMENT_AXIS";
  if (isDoubleDegreeMarking(correct) || isDoubleDegreeMarking(wrong)) return "DOUBLE_DEGREE_MARKING";
  if (candidate.pointCode === "UNMAPPED_HIGH_VALUE_POINT") return "UNMAPPED_ASSESSMENT_AXIS";
  const pair = [correct, wrong].map((s) => s.trim().toLowerCase()).sort().join("|");
  if (pair === "used|would use" && /\bImagine if\b/i.test(sentence.text)) {
    return "BOTH_CHOICES_GRAMMATICAL_IN_CONTEXT";
  }
  const fabricated = rejectFabricatedDistractor({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (fabricated) return fabricated;

  const conditionalReject = rejectConditionalChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (conditionalReject) return conditionalReject;

  const relativeReject = rejectRelativeChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (relativeReject) return relativeReject;

  const conjunctionReject = rejectConjunctionChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (conjunctionReject) return conjunctionReject;

  const participleReject = rejectParticipleChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (participleReject) return participleReject;

  const nonfiniteReject = rejectNonfiniteChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (nonfiniteReject) return nonfiniteReject;

  const specialReject = rejectSpecialChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (specialReject) return specialReject;

  const voiceReject = rejectVoiceChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (voiceReject) return voiceReject;

  const modalReject = rejectModalChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (modalReject) return modalReject;

  const sentenceReject = rejectSentenceChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (sentenceReject) return sentenceReject;

  const tenseReject = rejectTenseChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (tenseReject) return tenseReject;

  const infinitiveReject = rejectInfinitiveChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (infinitiveReject) return infinitiveReject;

  const gerundReject = rejectGerundChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (gerundReject) return gerundReject;

  const partsReject = rejectPartsChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (partsReject) return partsReject;

  const comparisonReject = rejectComparisonChoice({
    pointCode: candidate.pointCode,
    correct,
    wrong,
    sentence: sentence.text,
  });
  if (comparisonReject) return comparisonReject;

  const point = ontologyPoint(candidate.pointCode);
  const prev = previousToken(sentence.text, correct);
  const chapter = point?.chapter;

  const gerundVersusTo =
    (candidate.pointCode === "GERUND_VERB_OBJECT" || candidate.pointCode === "GERUND_FIXED_CONSTRUCTION") &&
    /^(?:[a-z]+ing|to [a-z]+)$/i.test(correct.trim()) &&
    /^(?:[a-z]+ing|to [a-z]+)$/i.test(wrong.trim()) &&
    correct.trim().toLowerCase().startsWith("to ") !== wrong.trim().toLowerCase().startsWith("to ");
  const before = sentence.text.slice(0, Math.max(0, spanStart(sentence.text, correct)));
  if (!gerundVersusTo && isMechanicalGovernorForm(correct, wrong, prev, before)) {
    return "MECHANICAL_GOVERNOR_FORM";
  }
  if (
    prev === "to" &&
    looksLikeToVVsToVing(correct, wrong) &&
    !TO_PREPOSITION_GOVERNOR.test(before.replace(/\s*\bto\s*$/i, ""))
  ) {
    return "MECHANICAL_INFINITIVE_MARKER";
  }

  if (MODALS.has(prev) && isInflectionOnly(correct, wrong)) {
    return "MECHANICAL_MODAL_FORM";
  }

  const first = normalizeToken(tokens(sentence.text)[0] ?? "");
  if (
    IMPERATIVES.has(first) &&
    IMPERATIVES.has(normalizeToken(correct).replace(/s$/, "")) &&
    isInflectionOnly(correct, wrong)
  ) {
    return "TRIVIAL_IMPERATIVE_INFLECTION";
  }

  if (isListedTrivialPair(sentence.text, correct, wrong)) {
    return "TOO_TRIVIAL_SHORT_AGREEMENT";
  }
  if (
    !isAllowedLongAgreement(sentence.text, correct) &&
    (chapter === "C02" ||
      candidate.pointCode.startsWith("AGREEMENT_") ||
      isShortAgreementPair(correct, wrong))
  ) {
    if (isTrivialShortAgreement(sentence.text, correct, wrong)) {
      return "TOO_TRIVIAL_SHORT_AGREEMENT";
    }
  }

  if (isBothGrammaticalPair(correct, wrong, sentence.text)) {
    return "BOTH_GRAMMATICAL";
  }
  if (isContextLockedNonfinite(candidate.pointCode) && isLockedToIngPair(correct, wrong)) {
    return null;
  }
  if (isStructuralPronounPair(candidate.pointCode, correct, wrong, sentence.text)) {
    return null;
  }
  if (isConfusableAdverbPair(correct, wrong)) return "MEANING_ONLY_CONTRAST";
  if (pairKey(correct, wrong) === "during|when") {
    if (!whenFollowedByFiniteClause(sentence.text) || !/^when$/i.test(correct)) {
      return "MEANING_ONLY_CONTRAST";
    }
  } else if (isMeaningOnlyContrast(correct, wrong, candidate.pointCode)) {
    return "MEANING_ONLY_CONTRAST";
  }
  if (isImplausible(correct, wrong, sentence.text)) {
    return "IMPLAUSIBLE_DISTRACTOR";
  }
  if (isAmbiguousTense(correct, wrong, sentence.text, candidate.pointCode)) {
    return "AMBIGUOUS_TENSE";
  }
  // 가주어·가목적어 it은 뒤의 to부정사·that절을 받는 자리라 that/this가 들어갈 수 없다.
  if (!DUMMY_IT_CODES.has(candidate.pointCode) && isAmbiguousReference(correct, wrong)) {
    return "AMBIGUOUS_REFERENCE";
  }
  return null;
}

function pairKey(a: string, b: string): string {
  return [normalizeToken(a), normalizeToken(b)].sort().join("|");
}

function immediateSubject(sentence: string, span: string): string {
  const at = spanStart(sentence, span);
  if (at < 0) return "";
  const before = sentence.slice(0, at).trim();
  return normalizeToken(tokens(before).at(-1) ?? "");
}

function isListedTrivialPair(sentence: string, correct: string, wrong: string): boolean {
  const sorted = pairKey(correct, wrong);
  const joined = `${normalizeToken(correct)} ${normalizeToken(wrong)}`;
  if (sorted === "many kind|many kinds") return true;
  if (sorted === "kind|kinds" && /\bmany\b/i.test(sentence)) return true;
  if (/\bmany\b/.test(joined) && /\bkinds?\b/.test(joined)) return true;

  const subject = immediateSubject(sentence, correct);
  if ((sorted === "are|is" || sorted === "is|are") && (subject === "information" || subject === "sections")) {
    return true;
  }
  if (sorted === "has|have" && subject === "graphs") return true;
  return false;
}

function isShortAgreementPair(correct: string, wrong: string): boolean {
  const sorted = pairKey(correct, wrong);
  return sorted === "are|is" || sorted === "has|have" || sorted === "was|were";
}

function isAllowedLongAgreement(sentence: string, correct: string): boolean {
  const c = normalizeToken(correct);
  if (!/^(is|are|was|were|has|have)$/.test(c)) return false;
  const at = spanStart(sentence, correct);
  if (at < 0) return false;
  const before = sentence.slice(0, at);
  if (/\b(?:who|which|that|whose)\b/i.test(before.slice(-48))) return true;
  if (/[,—–]/.test(before.slice(-24))) return true;
  return tokens(before).length > 6;
}

/**
 * 형용사와 그 부사형인지 본다.
 *
 * 예전에는 X + ly와 y -> ily만 알았다. 그래서 reliable / reliably가 서로 무관한 두
 * 낱말로 보여 MEANING_ONLY_CONTRAST로 죽었다. -le, -ic, -e, -ll로 끝나는 형용사는
 * 부사형이 규칙과 다르게 만들어지고, 이 형태들이 어법 문항에 자주 나온다.
 */
function isAdjAdvPair(a: string, b: string): boolean {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  const [short, long] = [left, right].sort((x, y) => x.length - y.length);
  if (!short || !long) return false;
  if (long === `${short}ly`) return true;
  if (short.endsWith("y") && long === `${short.slice(0, -1)}ily`) return true;
  // reliable -> reliably, simple -> simply, terrible -> terribly
  if (short.endsWith("le") && long === `${short.slice(0, -1)}y`) return true;
  // basic -> basically, dramatic -> dramatically
  if (short.endsWith("ic") && long === `${short}ally`) return true;
  // true -> truly, whole -> wholly
  if (short.endsWith("e") && long === `${short.slice(0, -1)}ly`) return true;
  // full -> fully, dull -> dully
  if (short.endsWith("ll") && long === `${short}y`) return true;
  return false;
}

function isContextLockedNonfinite(code: string): boolean {
  return (
    code === "NONFINITE_MEMORY_COMPLEMENT" ||
    code === "NONFINITE_STOP_COMPLEMENT" ||
    code === "NONFINITE_TRY_COMPLEMENT" ||
    code === "NONFINITE_MEAN_COMPLEMENT" ||
    code === "NONFINITE_GO_ON_COMPLEMENT"
  );
}

function isLockedToIngPair(correct: string, wrong: string): boolean {
  const pair = [normalizeToken(correct), normalizeToken(wrong)].sort().join("|");
  return /^[a-z]+ing\|to [a-z]+$/.test(pair);
}

function isConfusableAdverbPair(correct: string, wrong: string): boolean {
  const pair = pairKey(correct, wrong);
  return ["hard|hardly", "late|lately", "near|nearly", "high|highly", "close|closely", "most|mostly"].includes(pair);
}

function isStructuralPronounPair(code: string, correct: string, wrong: string, sentence: string): boolean {
  const pair = pairKey(correct, wrong);
  if (code === "PRONOUN_REFLEXIVE" && ["ourselves|us", "themselves|them", "himself|him", "herself|her"].includes(pair)) {
    return /\b(?:we|they|he|she)\b/i.test(sentence) && !/\bincluding\b/i.test(sentence);
  }
  if (code === "PRONOUN_SUBJECT_OBJECT_CASE" && ["he|him", "i|me", "she|her", "they|them", "we|us"].includes(pair)) {
    return !/\bit was\b/i.test(sentence);
  }
  /**
   * 소유격과 목적격·주격의 대립(their / them, our / us)은 문법 축이다 —
   * 한정사 자리에 격이 맞는 형태가 무엇인가를 묻는다. 예전에는 이 쌍이
   * 구조쌍 목록에 없어서 "형태가 아니라 의미로 갈리는 쌍"으로 오분류돼 죽었다.
   */
  if (
    (code.includes("POSSESSIVE") || code.includes("PRONOUN")) &&
    ["their|them", "their|they", "our|us", "our|we", "your|you", "him|his", "it|its"].includes(pair)
  ) {
    return true;
  }
  return false;
}

function isAllowedPedagogicPair(correct: string, wrong: string): boolean {
  const sorted = pairKey(correct, wrong);
  if (sorted === "its|it's" || sorted === "it's|its") return true;
  if (sorted === "what|which") return true;
  if (sorted === "it|this" || sorted === "it|that") return true;
  return isAdjAdvPair(correct, wrong);
}

/**
 * 문법 낱말. 이 부류끼리의 대비(such/so, each/all, although/despite, it/one,
 * didn't/wasn't)는 어느 쪽이 맞는지를 구조가 정하므로 "의미로만 갈리는 쌍"이 아니다.
 * 예전에는 be·have·관계사 몇 개만 여기 있어서, 목록에 있는 비교·수량·대명사·접속사
 * 문항이 로컬 단계에서 전부 떨어졌다(관측: 대표 문항 207개 중 약 30개가 이 사유).
 * 둘 다 되는 경우(at / on 같은)는 뒤의 유일성 판정이 거른다.
 */
const GRAMMAR_WORD = new Set([
  "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers",
  "it", "its", "it's", "they", "them", "their", "theirs", "we", "us", "our", "ours",
  "myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves",
  "one", "ones", "other", "others", "another", "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what", "where", "when", "why", "how",
  "whoever", "whomever", "whatever", "whichever", "wherever", "whenever", "however", "whether", "if",
  "a", "an", "the", "some", "any", "no", "every", "each", "all", "both", "either", "neither",
  "few", "little", "many", "much", "several", "enough", "such", "so", "too", "very",
  "more", "most", "less", "least", "fewer", "fewest", "better", "best", "worse", "worst",
  "farther", "further", "farthest", "furthest",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "about", "into", "onto", "during",
  "despite", "since", "until", "till", "before", "after", "while", "because", "although", "though",
  "unless", "than", "as", "like", "without", "within", "among", "between", "through", "across",
  "against", "toward", "towards", "upon", "instead",
  "and", "or", "but", "nor", "yet", "whereas", "not",
  "is", "are", "was", "were", "am", "be", "been", "being", "has", "have", "had", "having",
  "do", "does", "did", "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't",
  "don't", "doesn't", "didn't", "can't", "couldn't", "won't", "wouldn't", "shouldn't", "mustn't",
  "can", "could", "may", "might", "must", "shall", "should", "will", "would",
]);

const MODAL_WORD = new Set(["can", "could", "may", "might", "must", "shall", "should", "will", "would"]);
const MODAL_TENSE_PAIR = new Set(["will|would", "can|could", "may|might", "shall|should"]);
const SHOULD_FORM_CODES = new Set([
  "SHOULD_SPECIAL_USE", "CONDITIONAL_IF_SHOULD", "CONDITIONAL_INVERTED_SHOULD", "MANDATIVE_SHOULD",
]);

/** 조동사 자체가 문법 포인트인 코드. 여기서는 조동사끼리의 대비가 형태 문제다. */
function modalIsTheForm(pointCode: string): boolean {
  return (
    pointCode.startsWith("CONDITIONAL_") ||
    pointCode.startsWith("WISH_") ||
    pointCode.startsWith("AS_IF_") ||
    pointCode.startsWith("TENSE_") ||
    pointCode.startsWith("MANDATIVE_") ||
    pointCode.startsWith("WOULD_RATHER") ||
    pointCode === "WITHOUT_IF_CONDITION" ||
    pointCode === "OTHERWISE_CONDITIONAL" ||
    pointCode === "IF_ONLY" ||
    pointCode === "SHOULD_SPECIAL_USE" ||
    pointCode === "IT_IS_TIME_SUBJUNCTIVE"
  );
}

/** creativity / creative, children's / childrens', tallest / taller: 같은 낱말 가족. */
function isDerivationalFamily(a: string, b: string): boolean {
  const x = a.replace(/[’']/g, "");
  const y = b.replace(/[’']/g, "");
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared += 1;
  return shared >= 5 && shared >= Math.min(x.length, y.length) - 3;
}

function isMeaningOnlyContrast(correct: string, wrong: string, pointCode: string): boolean {
  if (isAllowedPedagogicPair(correct, wrong)) return false;
  const c = tokens(correct);
  const w = tokens(wrong);
  if (c.length !== w.length || c.length === 0) return false;
  const diffs: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (normalizeToken(c[i]!) !== normalizeToken(w[i]!)) diffs.push(i);
  }
  if (diffs.length !== 1) return false;
  const a = normalizeToken(c[diffs[0]!]!);
  const b = normalizeToken(w[diffs[0]!]!);
  // 같은 조동사의 시제 대비(will/would, can/could)만 형태 문제다. could/would처럼
  // 조동사가 다르면 뜻(능력·의지)이 갈리는 것이다.
  if (MODAL_WORD.has(a) && MODAL_WORD.has(b)) {
    // lest ... should, if S should, Should you ...: should 자체가 묻는 형태다.
    if (SHOULD_FORM_CODES.has(pointCode) && (a === "should" || b === "should")) return false;
    return !(modalIsTheForm(pointCode) && MODAL_TENSE_PAIR.has([a, b].sort().join("|")));
  }
  if (GRAMMAR_WORD.has(a) && GRAMMAR_WORD.has(b)) return false;
  if (stemVerb(a) === stemVerb(b) || isInflectedPair(a, b) || isComparativePair(a, b)) return false;
  if (isAdjAdvPair(a, b) || isDerivationalFamily(a, b)) return false;
  return true;
}

function isComparativePair(a: string, b: string): boolean {
  const forms = new Set([
    "far", "further", "farther", "furthest", "farthest", "good", "better", "best",
    "bad", "worse", "worst", "much", "many", "more", "most", "little", "less", "least",
  ]);
  if (forms.has(a) && forms.has(b)) return true;
  // taller / tallest, larger / largest
  const base = (word: string) => word.replace(/(?:est|er)$/, "").replace(/e$/, "");
  return /(?:er|est)$/.test(a) && /(?:er|est)$/.test(b) && base(a) === base(b);
}

function isInflectedPair(a: string, b: string): boolean {
  const [short, long] = [a, b].sort((x, y) => x.length - y.length);
  if (long === `${short}s` || long === `${short}es` || long === `${short}ed` || long === `${short}ing`) {
    return true;
  }
  if (short.endsWith("e") && (long === `${short.slice(0, -1)}ing` || long === `${short.slice(0, -1)}ed`)) {
    return true;
  }
  return stemVerb(a) === stemVerb(b);
}

function isTrivialShortAgreement(
  sentence: string,
  correct: string,
  wrong: string
): boolean {
  const c = normalizeToken(correct);
  const w = normalizeToken(wrong);
  const agree = new Set([
    "is|are",
    "are|is",
    "was|were",
    "were|was",
    "has|have",
    "have|has",
    "applies|apply",
    "apply|applies",
    "writes|write",
    "write|writes",
    "wants|want",
    "want|wants",
  ]);
  const pair = `${c}|${w}`;
  if (!agree.has(pair) && !isNumberAgreementPair(correct, wrong)) return false;
  if (hasInterveningAgreement(sentence, correct)) return false;
  // Learning foreign languages is ...: 주어가 동명사구이고 동사 바로 앞은 복수 명사다.
  // 짧아도 대표적인 함정이라 사소한 수일치가 아니다.
  if (/^\s*(?:[A-Z][a-z]+ing|[a-z]+ing)\b/.test(sentence.slice(0, Math.max(0, spanStart(sentence, correct))))) {
    return false;
  }
  if (/\b(?:one of|the number of|a number of|not only|what|there|the news|each of|along with)\b/i.test(sentence)) {
    return false;
  }
  if (/\b(?:who|which|that)\b/i.test(sentence) && c.match(/^(is|are|was|were|has|have)$/)) {
    const between = sentence.slice(0, Math.max(0, spanStart(sentence, correct)));
    if (/\b(?:who|which|that|of)\b/i.test(between.slice(-40))) return false;
  }
  const at = spanStart(sentence, correct);
  const before = sentence.slice(Math.max(0, at - 48), at);
  const gap = tokens(before);
  const intervening =
    /\b(of|who|which|that|whose|when|where|with|by|from|in|on|for|outside|inside)\b/i.test(
      before.slice(-40)
    ) && gap.length > 3;
  if (intervening || gap.length > 6) return false;
  return gap.length <= 3;
}

function isBothGrammaticalPair(
  correct: string,
  wrong: string,
  sentence: string
): boolean {
  const pair = [normalizeToken(correct), normalizeToken(wrong)].sort().join("|");
  if (pair === "it|this") return true;
  if (pair === "if|unless") return true;
  if (
    pair === "that|which" &&
    !/,\s*which\b/.test(sentence) &&
    !/\b(?:for|with|to|from|of|in|on|by|about|into|through|without|over|under|between|among)\s+which\b/i.test(sentence)
  ) {
    return true;
  }
  if (pair === "think|to think" && /all we have to do is/i.test(sentence)) {
    return true;
  }
  if (pair === "have|to have" && /all (?:s|we) have to do is/i.test(sentence)) {
    return true;
  }
  return false;
}

function isImplausible(correct: string, wrong: string, sentence: string): boolean {
  const w = normalizeToken(wrong);
  if (w === "who" && /\bwas\s+that\b/i.test(sentence)) return true;
  if (w === "what" && /,\s*which\b/.test(sentence) && normalizeToken(correct) === "which") {
    return false;
  }
  return false;
}

/**
 * 문장 안에서 시제를 확정짓는 시간 표지.
 *
 * isAmbiguousTense는 "표지가 없으면 모호하니 거부"하는 게이트다. 그런데 목록이
 * 좁아서 실제로 시제를 확정하는 표현을 대부분 놓쳤다. 관측: 제안된
 * TENSE_EXPLICIT_TIME_MARKER 후보가 전부 여기서 탈락했는데 정작 그 문장들은
 * once said / Today ... occupy처럼 표지가 분명했다. 코드명이 이미
 * "명시적 시간 표지"인 후보가 표지 없음으로 걸리던 셈이다.
 *
 * 넓히는 방향이지만 가드를 푸는 것은 아니다. 표지가 없으면 지금과 똑같이
 * 탈락하고, 살아남은 후보도 블라인드 유일성 게이트와 검수를 그대로 통과해야 한다.
 */
const EXPLICIT_TIME_MARKER_RE =
  /\b(?:yesterday|ago|already|since|for|before|after|by the time|now|then|when|while|tomorrow|just|never|always|once|today|tonight|nowadays|currently|recently|lately|these days|at present|so far|up to now|ever since|last (?:night|week|month|year|time)|next (?:week|month|year)|this (?:morning|afternoon|evening|week|month|year)|over the (?:past|last)|in \d{4})\b/i;

const DUMMY_IT_CODES = new Set(["DUMMY_IT_SUBJECT", "DUMMY_IT_OBJECT", "INFINITIVE_DUMMY_IT"]);

const SUBJECT_CASE_PAIRS = new Set(["i|me", "he|him", "she|her", "we|us", "they|them"]);
const SUBJECT_PRONOUNS = new Set(["i", "he", "she", "we", "they"]);

/**
 * 고등 내신·수능 수준에 너무 쉬운 문항을 뺀다(2026-09-11 선생님 검토).
 *
 * - [I / me] am a sophomore: 주어 자리 주격 대명사. 목적어 자리(between you and me)는
 *   고등 문항이라 남긴다.
 * - [its / it's]: 철자 문제에 가깝다.
 * - [Is there / Does there be]: 학습자가 실제로 쓰지 않는 형태라 오답 구실을 못 한다.
 * - [don't / not] feel: do 부정문. 중학 기초다.
 * - "Ah, [that / what] sounds boring.": 문장 첫머리 지시대명사 that은 절 표지가 아니라
 *   that/what 문항이 아니고, 라벨도 [that 명사절]로 잘못 붙었다.
 */
function tooBasicForLevel(
  sentence: string,
  correct: string,
  wrong: string
): "TOO_BASIC_FOR_LEVEL" | "CODE_SPAN_CONTRACT_MISMATCH" | null {
  const c = normalizeToken(correct);
  const w = normalizeToken(wrong);
  const pair = [c, w].sort().join("|");
  if (pair === "it's|its") return "TOO_BASIC_FOR_LEVEL";
  // 표는 주격|목적격 순서다. pair는 알파벳순이라(them|they, us|we, her|she) 두 순서를 다 본다.
  // 예전에는 한 순서만 봐서 i|me, he|him만 걸리고 they / them, we / us가 그대로 나왔다.
  if ((SUBJECT_CASE_PAIRS.has(`${c}|${w}`) || SUBJECT_CASE_PAIRS.has(`${w}|${c}`)) && SUBJECT_PRONOUNS.has(c)) {
    return "TOO_BASIC_FOR_LEVEL";
  }
  // Even if [you / your] don't feel like it: 주어 자리 you와 소유격 your
  if (c === "you" && w === "your") return "TOO_BASIC_FOR_LEVEL";
  if (/\bdo(?:es)?\s+there\s+be\b/i.test(wrong) || /^(?:do|does|did)\s+there\b/i.test(wrong.trim())) {
    return "TOO_BASIC_FOR_LEVEL";
  }
  // 네모를 줄이면 [Is there / Does there be]가 [Is / Does] there가 된다.
  if (/^(?:do|does|did)$/.test(w) && /^(?:is|are|was|were)$/.test(c)) {
    const at = spanStart(sentence, correct);
    if (at >= 0 && /^\s+there\b/i.test(sentence.slice(at + correct.length))) return "TOO_BASIC_FOR_LEVEL";
  }
  if (/^(?:don't|doesn't|didn't|do not|does not|did not)\|not$/.test([c, w].sort((x, y) => y.length - x.length).join("|"))) {
    return "TOO_BASIC_FOR_LEVEL";
  }
  if (pair === "that|what") {
    const at = spanStart(sentence, correct);
    const before = sentence.slice(0, Math.max(0, at));
    const after = sentence.slice(at + correct.length);
    const clauseStart = /(?:^|[,"“”'‘’—:;!?.]\s*|\b(?:ah|oh|well|yes|no),?\s*)$/i.test(before.trim() === "" ? "" : before);
    // However, [that / what] doesn't mean ...: 조동사·부정형이 바로 오는 것도 지시대명사다.
    if (clauseStart && /^\s*(?:sounds|seems|is|was|looks|means|makes|feels|works|happens|matters|doesn['’]t|does|didn['’]t|did|isn['’]t|wasn['’]t|can|could|will|would|may|might|must|should|has|had)\b/i.test(after)) {
      return "CODE_SPAN_CONTRACT_MISMATCH";
    }
  }
  return null;
}

/**
 * 시제 일치·간접화법·불변 진리는 시간 부사가 아니라 주절의 과거 보고 동사가
 * 시제를 정한다(I knew that he had lied, She said that water boils). 시간 부사만
 * 표지로 보면 이 세 코드는 대표 문항부터 AMBIGUOUS_TENSE로 떨어졌다.
 */
const REPORTING_PAST_RE =
  /\b(?:said|told|asked|knew|thought|believed|felt|heard|learned|learnt|realized|explained|claimed|insisted|reported|found|noticed|discovered|wondered|admitted|promised|taught|showed|wrote)\b/i;
const REPORTING_TENSE_CODES = new Set(["TENSE_SEQUENCE", "TENSE_REPORTED_SPEECH", "TENSE_UNIVERSAL_TRUTH"]);

function isAmbiguousTense(
  correct: string,
  wrong: string,
  sentence: string,
  pointCode: string
): boolean {
  if (!pointCode.startsWith("TENSE_")) return false;
  if (!isInflectionOnly(correct, wrong)) return false;
  if (REPORTING_TENSE_CODES.has(pointCode) && REPORTING_PAST_RE.test(sentence)) return false;
  const hasMarker = EXPLICIT_TIME_MARKER_RE.test(sentence);
  return !hasMarker;
}

function isAmbiguousReference(correct: string, wrong: string): boolean {
  const pair = [normalizeToken(correct), normalizeToken(wrong)].sort().join("|");
  return pair === "it|that";
}

export function needsAuditor(candidate: GrammarCandidate): boolean {
  if (candidate.riskLevel === "HIGH") return true;
  if (candidate.pointCode.startsWith("TENSE_")) return true;
  if (candidate.pointCode.startsWith("CONDITIONAL_")) return true;
  if (candidate.pointCode.startsWith("WISH_") || candidate.pointCode.startsWith("AS_IF_")) {
    return true;
  }
  if (
    candidate.pointCode === "RELATIVE_WHO_WHOM" ||
    candidate.pointCode === "RELATIVE_ADVERB_WHERE" ||
    candidate.pointCode === "RELATIVE_WHAT" ||
    candidate.pointCode === "RELATIVE_NONRESTRICTIVE"
  ) {
    return true;
  }
  if (candidate.pointCode.startsWith("VOICE_") && candidate.riskLevel !== "LOW") {
    return true;
  }
  // 정답에 접미사를 붙여 만든 오답은 실재하지 않는 단어일 수 있다
  // (관측: extinct → extinctly가 그대로 출제됐다). 실재 여부는 어휘 지식이라
  // 로컬 규칙으로 못 가리므로 감사 모델에 보낸다.
  if (isDerivedFromCorrect(candidate.correctAnswer, candidate.distractors[0] ?? "")) {
    return true;
  }
  return false;
}

/** 한쪽이 다른 쪽에 파생 접미사를 붙인 형태인지 본다. */
const DERIVATION_SUFFIXES = ["ly", "ing", "ed", "er", "est", "ness", "ful"];

function suffixDerived(base: string, derived: string): boolean {
  if (!base || !derived || base === derived) return false;
  // 복수 명사의 -s 자리에 접미사를 붙인 것(impostors / impostorly, friends / friendly)도
  // 실재 여부를 검수 모델이 가리게 한다. friendly는 있고 impostorly는 없다.
  const singular = /[^su]s$/.test(base) ? base.slice(0, -1) : "";
  if (singular && DERIVATION_SUFFIXES.some((suffix) => derived === `${singular}${suffix}`)) return true;
  return DERIVATION_SUFFIXES.some(
    (suffix) =>
      derived === `${base}${suffix}` ||
      derived === `${base.replace(/e$/, "")}${suffix}` ||
      base === `${derived}${suffix}` ||
      base === `${derived.replace(/e$/, "")}${suffix}`
  );
}

/**
 * 정답에 접미사를 붙여 만든 오답인지 본다. 그런 오답은 실재하지 않는 낱말일 수
 * 있고(misunderstood -> misunderstoodly, extinct -> extinctly) 실재 여부는 어휘
 * 지식이라 로컬 규칙으로 못 가린다. 걸리면 검수 모델로 보낸다.
 *
 * 예전에는 스팬에 공백이 있으면 곧바로 false였다. 그래서
 * [a misunderstood text / a misunderstoodly text]처럼 네모가 여러 단어인 경우
 * 검사가 아예 돌지 않았고, 없는 낱말이 그대로 출제됐다. 한 단어 스팬이었다면
 * 잡혔을 것이다. 이제 달라진 낱말끼리 짝지어 본다.
 */
export function isDerivedFromCorrect(correct: string, wrong: string): boolean {
  const base = correct.trim().toLowerCase();
  const derived = wrong.trim().toLowerCase();
  if (!base || !derived || base === derived) return false;
  if (!base.includes(" ") && !derived.includes(" ")) return suffixDerived(base, derived);

  const c = base.split(/\s+/).filter(Boolean);
  const w = derived.split(/\s+/).filter(Boolean);
  if (c.length === w.length) {
    // 자리를 맞춰 놓고 달라진 낱말끼리만 본다.
    return c.some((token, i) => suffixDerived(token, w[i] ?? ""));
  }
  // 길이가 다르면 공통 낱말을 빼고 남은 것끼리 본다.
  const shared = new Set(c.filter((t) => w.includes(t)));
  const restC = c.filter((t) => !shared.has(t));
  const restW = w.filter((t) => !shared.has(t));
  return restC.some((a) => restW.some((b) => suffixDerived(a, b)));
}
