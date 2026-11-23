import type {
  BlankDensity,
  BlankPartOfSpeech,
  GeneratedBlankCandidate,
} from "@/lib/lesson-materials/workbook-types";
import {
  computeBlankFinalScore,
  DEGREE_ADVERBS,
  inferGradeFromScores,
  isBlankCandidateEligible,
  isBlankCandidateEligibleC,
  isSoftEasyWord,
  normalizeBlankScores,
  normalizeWordFamily,
  parseBlankGrade,
  synthesizeScoresForLemma,
  type BlankCandidateScore,
  type BlankGrade,
  type BlankSemanticRole,
} from "@/lib/lesson-materials/blank-concept-score";
import type { BlankCandidateSource } from "@/lib/lesson-materials/blank-selection-diagnostics";

const EXCLUDED_LOWER = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "we",
  "us",
  "our",
  "ours",
  "they",
  "them",
  "their",
  "theirs",
  "this",
  "that",
  "these",
  "those",
  "who",
  "whom",
  "whose",
  "which",
  "what",
  "and",
  "or",
  "but",
  "so",
  "nor",
  "for",
  "yet",
  "of",
  "in",
  "on",
  "at",
  "to",
  "from",
  "by",
  "with",
  "as",
  "into",
  "onto",
  "over",
  "under",
  "about",
  "be",
  "am",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "not",
  "no",
  "yes",
  "perhaps",
  "maybe",
  "without",
  "between",
  "among",
  "across",
  "through",
  "during",
  "before",
  "after",
  "while",
  "when",
  "where",
  "how",
  "why",
  "because",
  "although",
  "though",
  "whether",
  "if",
  "then",
  "than",
  "also",
  "just",
  "only",
  "even",
  "still",
  "already",
  "always",
  "never",
  "often",
  "sometimes",
  "such",
  "other",
  "another",
  "same",
  "own",
  "each",
  "every",
  "both",
  "few",
  "much",
  "most",
  "more",
  "less",
  "many",
  "some",
  "any",
  "all",
  "one",
  "two",
  "first",
  "second",
  "there",
  "here",
  "once",
  "upon",
  "within",
  "along",
  "against",
  "toward",
  "towards",
  "around",
  "above",
  "below",
  "out",
  "up",
  "down",
  "off",
  "again",
  "further",
  "rather",
  "quite",
  "almost",
  "enough",
  "however",
  "therefore",
  "thus",
  "law",
  "spoken",
  "states",
  "daily",
  "inner",
  "fear",
  "work",
  "begins",
]);

const POS_OK = new Set<BlankPartOfSpeech>([
  "noun",
  "verb",
  "adjective",
  "adverb",
]);

const SEMANTIC_OK = new Set<BlankSemanticRole>([
  "theme",
  "main_claim",
  "logic",
  "academic",
  "context",
  "collocation",
]);

export type BlankSourceSentence = {
  id: string;
  english: string;
};

export type WordSpan = {
  text: string;
  start: number;
  end: number;
  wordIndex: number;
};

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findExactWordOccurrences(
  sentence: string,
  answerText: string
): WordSpan[] {
  const target = answerText.trim();
  if (!target) return [];
  // Case-insensitive match, but keep original surface casing from the sentence
  const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, "gi");
  const allWords = tokenizeWords(sentence);
  const hits: WordSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const wordIndex =
      allWords.find((w) => w.start === start && w.end === end)?.wordIndex ??
      allWords.findIndex((w) => w.start <= start && w.end >= end);
    hits.push({
      text: sentence.slice(start, end),
      start,
      end,
      wordIndex: wordIndex >= 0 ? wordIndex : hits.length,
    });
  }
  return hits;
}

/** Map AI aliases (s0, s1, 1, ?? onto real sentence ids. */
export function resolveBlankSentenceId(
  rawId: string,
  sentences: BlankSourceSentence[]
): string | null {
  const id = rawId.trim();
  if (!id) return null;
  if (sentences.some((s) => s.id === id)) return id;
  const m = /^(?:s|S|sentence)?(\d+)$/.exec(id);
  if (m) {
    const n = Number(m[1]);
    // accept 0-based and 1-based
    if (sentences[n]) return sentences[n]!.id;
    if (n >= 1 && sentences[n - 1]) return sentences[n - 1]!.id;
  }
  return null;
}

export function tokenizeWords(sentence: string): WordSpan[] {
  // 굽은 따옴표(’)도 한 낱말로 — Let’s 가 「Let」+「s」로 갈려 「s」만 빈칸이 됐다(윌링, 선생님 2026-11-23)
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  const out: WordSpan[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(sentence)) !== null) {
    out.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      wordIndex: idx++,
    });
  }
  return out;
}

export function isExcludedBlankWord(answerText: string): boolean {
  const bare = answerText.replace(/[^A-Za-z'’]/g, "").replace(/’/g, "'").toLowerCase();
  if (!bare) return true;
  if (EXCLUDED_LOWER.has(bare)) return true;
  if (DEGREE_ADVERBS.has(bare)) return true;
  if (/^\d+$/.test(bare)) return true;
  return false;
}

export type ValidatedBlankCandidate = GeneratedBlankCandidate & {
  start: number;
  end: number;
  wordIndex: number;
  globalWordIndex: number;
  conceptScore: number;
  finalScore: number;
  wordFamily: string;
  semanticRole: BlankSemanticRole | null;
  competitionGroup: string | null;
  scores: BlankCandidateScore;
  grade: BlankGrade;
  eligible: boolean;
  sources: Array<"ai" | "saved-vocabulary" | "deterministic-fallback">;
};

function parseScores(row: Record<string, unknown>): BlankCandidateScore | null {
  const nested = row.scores;
  if (nested && typeof nested === "object") {
    return normalizeBlankScores(nested as Partial<BlankCandidateScore>);
  }
  if (
    row.centrality != null ||
    row.learningValue != null ||
    row.contextImportance != null ||
    row.contextualImportance != null ||
    row.examUsefulness != null ||
    row.reusability != null
  ) {
    return normalizeBlankScores(row as Partial<BlankCandidateScore>);
  }
  return null;
}

export function validateBlankCandidates(input: {
  passageId: string;
  responsePassageId: string;
  sentences: BlankSourceSentence[];
  generatedCandidates: unknown;
  recommendedCount: number;
  density?: BlankDensity;
  vocabLemmas?: Set<string>;
  titleText?: string;
  coreSentenceIds?: string[];
}): {
  valid: ValidatedBlankCandidate[];
  rejected: Array<{ reason: string; raw?: unknown; code?: string }>;
  coreSentenceIds: string[];
} {
  const rejected: Array<{ reason: string; raw?: unknown; code?: string }> = [];
  if (input.responsePassageId && input.responsePassageId !== input.passageId) {
    rejected.push({
      reason: `passageId 불일치 (${input.responsePassageId})`,
    });
  }

  const byId = new Map(input.sentences.map((s) => [s.id, s] as const));
  const sentenceOffsets = new Map<string, number>();
  let running = 0;
  for (const s of input.sentences) {
    sentenceOffsets.set(s.id, running);
    running += tokenizeWords(s.english).length + 1;
  }

  const list = Array.isArray(input.generatedCandidates)
    ? input.generatedCandidates
    : [];
  if (!Array.isArray(input.generatedCandidates)) {
    rejected.push({ reason: "candidates媛 諛곗뿴???꾨떂" });
  }

  const coreSentenceIds = (input.coreSentenceIds ?? [])
    .map((id) => resolveBlankSentenceId(String(id), input.sentences))
    .filter((id): id is string => Boolean(id));

  const valid: ValidatedBlankCandidate[] = [];
  const usedPositions = new Set<string>();

  for (const raw of list) {
    const row = raw as Record<string, unknown>;
    const sentenceIdRaw = String(row.sentenceId ?? "").trim();
    const sentenceId = resolveBlankSentenceId(sentenceIdRaw, input.sentences);
    const answerText = String(
      row.answerText ?? row.originalText ?? row.token ?? ""
    ).trim();
    const lemma =
      String(row.lemma ?? "").trim().toLowerCase() ||
      answerText.toLowerCase();
    const meaningKo =
      String(row.meaningKo ?? "").trim() || lemma || answerText;
    const selectionReasonKo = String(
      row.reasonKo ?? row.reason ?? row.selectionReasonKo ?? ""
    ).trim();
    const partOfSpeechRaw = String(row.partOfSpeech ?? "").trim().toLowerCase();
    const partOfSpeech = (
      POS_OK.has(partOfSpeechRaw as BlankPartOfSpeech)
        ? partOfSpeechRaw
        : "noun"
    ) as BlankPartOfSpeech;
    let occurrenceIndex = Number(row.occurrenceIndex);
    const id =
      String(row.candidateId ?? row.id ?? "").trim() ||
      `auto-${valid.length + 1}`;
    const wordFamily = normalizeWordFamily(
      lemma,
      String(row.wordFamily ?? "").trim() || null
    );
    const semanticRaw = String(row.semanticRole ?? "").trim() as BlankSemanticRole;
    const semanticRole = SEMANTIC_OK.has(semanticRaw) ? semanticRaw : null;
    const competitionGroupRaw = row.competitionGroup;
    const competitionGroup =
      competitionGroupRaw == null ||
      competitionGroupRaw === "" ||
      competitionGroupRaw === "null"
        ? null
        : String(competitionGroupRaw).trim();

    let priority = Number(row.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      priority = 3;
    }

    if (!sentenceId) {
      rejected.push({ reason: `sentenceId 없음: ${sentenceIdRaw}`, raw });
      continue;
    }
    if (!answerText || !/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(answerText)) {
      rejected.push({ reason: `answerText 단일어 아님: ${answerText}`, raw });
      continue;
    }
    if (!lemma) {
      rejected.push({ reason: "lemma 비어 있음", raw });
      continue;
    }
    if (isExcludedBlankWord(answerText)) {
      rejected.push({ reason: `제외 어휘: ${answerText}`, raw });
      continue;
    }

    let scores = parseScores(row);
    if (!scores) {
      scores = synthesizeScoresForLemma({
        lemma,
        partOfSpeech,
        vocabLemmas: input.vocabLemmas,
        titleText: input.titleText,
        semanticRole,
        grade: parseBlankGrade(row.grade),
      });
    }

    // Soft-easy words: raise commonness unless clearly core
    if (isSoftEasyWord(lemma)) {
      const coreish =
        scores.centrality >= 4 ||
        semanticRole === "main_claim" ||
        semanticRole === "theme";
      scores = normalizeBlankScores({
        ...scores,
        commonnessPenalty: coreish
          ? Math.min(scores.commonnessPenalty, 2)
          : Math.max(scores.commonnessPenalty, 3),
        learningValue: coreish
          ? scores.learningValue
          : Math.min(scores.learningValue, 2),
      });
    }

    let grade =
      parseBlankGrade(row.grade) ?? inferGradeFromScores(scores);
    // Re-infer after soft adjustments when AI grade missing
    if (!parseBlankGrade(row.grade)) {
      grade = inferGradeFromScores(scores);
    }

    const eligibleAb = isBlankCandidateEligible(scores);
    const eligibleC = isBlankCandidateEligibleC(scores);
    if (grade === "A" || grade === "B") {
      if (!eligibleAb && eligibleC) grade = "C";
      else if (!eligibleAb && !eligibleC) {
        rejected.push({
          reason: `자격 미달: ${answerText}`,
          raw,
          code: "TOO_COMMON" as const,
        });
        continue;
      }
    } else if (grade === "C" && !eligibleC) {
      rejected.push({
        reason: `C등급 자격 미달: ${answerText}`,
        raw,
        code: "TOO_COMMON" as const,
      });
      continue;
    }

    const sourcesRaw = row.sources ?? row.source;
    let sources: BlankCandidateSource[] = [];
    if (Array.isArray(sourcesRaw)) {
      sources = sourcesRaw
        .map((s) => String(s))
        .filter((s): s is BlankCandidateSource =>
          s === "ai" ||
          s === "saved-vocabulary" ||
          s === "deterministic-fallback"
        );
    } else if (typeof sourcesRaw === "string") {
      if (
        sourcesRaw === "ai" ||
        sourcesRaw === "saved-vocabulary" ||
        sourcesRaw === "deterministic-fallback"
      ) {
        sources = [sourcesRaw];
      }
    }
    if (sources.length === 0) sources = ["ai"];

    const sentence = byId.get(sentenceId)!;
    let hits = findExactWordOccurrences(sentence.english, answerText);
    if (!hits.length && lemma !== answerText.toLowerCase()) {
      hits = findExactWordOccurrences(sentence.english, lemma);
    }
    if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
      occurrenceIndex = 0;
    }
    if (!hits[occurrenceIndex] && hits.length > 0) {
      occurrenceIndex = 0;
    }
    if (!hits[occurrenceIndex]) {
      rejected.push({
        reason: `occurrence 없음: ${answerText}#${occurrenceIndex}`,
        raw,
        code: "TOKEN_MAPPING_FAILED" as const,
      });
      continue;
    }
    const hit = hits[occurrenceIndex]!;
    /*
     * 저장된 후보 묶음(lesson_pack_json)에 이미 들어간 「s」(lemma=traditional·series 등)도 막는다 — 표제어가
     * 네 글자 이상인데 정답이 두 글자 이하면 밀린 자리다(전수 대조 2026-11-19).
     */
    if (hit.text.length <= 2 && lemma.length >= 4) {
      rejected.push({ reason: `밀린 자리: ${hit.text} (표제어 ${lemma})`, raw, code: "TOKEN_MAPPING_FAILED" as const });
      continue;
    }
    const posKey = `${sentenceId}:${hit.start}:${hit.end}`;
    if (usedPositions.has(posKey)) {
      rejected.push({ reason: `위치 중복: ${posKey}`, raw });
      continue;
    }

    usedPositions.add(posKey);
    const base = sentenceOffsets.get(sentenceId) ?? 0;
    const finalScore = computeBlankFinalScore(scores);
    valid.push({
      id,
      sentenceId,
      answerText: hit.text,
      occurrenceIndex,
      lemma,
      partOfSpeech,
      meaningKo,
      selectionReasonKo: selectionReasonKo || "핵심 어휘",
      priority,
      start: hit.start,
      end: hit.end,
      wordIndex: hit.wordIndex,
      globalWordIndex: base + hit.wordIndex,
      conceptScore: finalScore,
      finalScore,
      wordFamily,
      semanticRole,
      competitionGroup,
      scores,
      grade,
      eligible: grade === "C" ? eligibleC : eligibleAb,
      sources,
    });
  }

  return { valid, rejected, coreSentenceIds };
}

export type { SelectBlankResult } from "@/lib/lesson-materials/select-workbook-blanks";
export {
  selectBlankCandidates,
  selectBlankCandidatesByDensity,
} from "@/lib/lesson-materials/select-workbook-blanks";

