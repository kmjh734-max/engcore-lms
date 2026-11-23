import type { LessonPackVocabItem } from "@/lib/lesson-materials/generate-lesson-pack";
import {
  findExactWordOccurrences,
  isExcludedBlankWord,
  tokenizeWords,
} from "@/lib/lesson-materials/validate-workbook-blank";
import {
  computeBlankFinalScore,
  DEGREE_ADVERBS,
  inferGradeFromScores,
  isSoftEasyWord,
  normalizeWordFamily,
  synthesizeScoresForLemma,
} from "@/lib/lesson-materials/blank-concept-score";
import type { BlankPartOfSpeech } from "@/lib/lesson-materials/workbook-types";

/**
 * Deterministic content-word candidates from the passage (no OpenAI).
 * Includes A/B/C content words; skips function words & bare degree adverbs.
 */
export function buildHeuristicBlankCandidates(input: {
  sentences: Array<{ id: string; english: string }>;
  titleText?: string;
  maxCandidates?: number;
}): unknown[] {
  const max = input.maxCandidates ?? 48;
  const out: unknown[] = [];
  const usedPos = new Set<string>();

  type Hit = {
    sentenceId: string;
    answerText: string;
    occurrenceIndex: number;
    lemma: string;
    start: number;
    end: number;
    score: number;
  };
  const hits: Hit[] = [];

  for (const s of input.sentences) {
    const tokens = tokenizeWords(s.english);
    for (const tok of tokens) {
      const lemma = tok.text.toLowerCase();
      const posKey = `${s.id}:${tok.start}:${tok.end}`;
      if (usedPos.has(posKey)) continue;
      if (isExcludedBlankWord(tok.text)) continue;
      if (DEGREE_ADVERBS.has(lemma)) continue;
      if (lemma.length < 3) continue;
      const occs = findExactWordOccurrences(s.english, tok.text);
      const occurrenceIndex = occs.findIndex(
        (h) => h.start === tok.start && h.end === tok.end
      );
      if (occurrenceIndex < 0) continue;
      let score = lemma.length;
      if (lemma.length >= 7) score += 3;
      if (input.titleText?.toLowerCase().includes(lemma)) score += 4;
      if (isSoftEasyWord(lemma)) score -= 4;
      hits.push({
        sentenceId: s.id,
        answerText: tok.text,
        occurrenceIndex,
        lemma,
        start: tok.start,
        end: tok.end,
        score,
      });
      usedPos.add(posKey);
    }
  }

  hits.sort((a, b) => b.score - a.score);

  for (let i = 0; i < hits.length && out.length < max; i++) {
    const h = hits[i]!;
    const scores = synthesizeScoresForLemma({
      lemma: h.lemma,
      partOfSpeech: "noun",
      titleText: input.titleText,
      semanticRole: "context",
      grade: "C",
    });
    // Deterministic fillers default to B/C — never auto-promote to A unless title hit
    let grade = inferGradeFromScores(scores);
    if (grade === "A" && !input.titleText?.toLowerCase().includes(h.lemma)) {
      grade = "B";
      scores.centrality = Math.min(scores.centrality, 3);
      scores.learningValue = Math.min(scores.learningValue, 3);
    }
    out.push({
      candidateId: `heur-${i + 1}`,
      sentenceId: h.sentenceId,
      answerText: h.answerText,
      occurrenceIndex: h.occurrenceIndex,
      lemma: h.lemma,
      wordFamily: normalizeWordFamily(h.lemma),
      partOfSpeech: "noun" as BlankPartOfSpeech,
      meaningKo: h.lemma,
      grade,
      semanticRole: "context",
      competitionGroup: null,
      scores: {
        ...scores,
        commonnessPenalty: Math.max(
          scores.commonnessPenalty,
          isSoftEasyWord(h.lemma) ? 3 : 2
        ),
      },
      reasonKo: "지문 내용어 폴백",
      priority: grade === "A" ? 4 : grade === "B" ? 3 : 2,
      tokenStartIndex: h.start,
      tokenEndIndex: h.end,
      start: h.start,
      end: h.end,
    });
  }

  return out;
}

export function buildBlankCandidatesFromVocab(input: {
  sentences: Array<{ id: string; english: string }>;
  vocab: LessonPackVocabItem[];
  titleText?: string;
  maxCandidates?: number;
}): unknown[] {
  const max = input.maxCandidates ?? 48;
  const vocabLemmas = new Set(
    input.vocab.map((v) => v.word.toLowerCase().trim()).filter(Boolean)
  );
  const out: unknown[] = [];
  const usedLemma = new Set<string>();

  type Hit = {
    sentenceId: string;
    answerText: string;
    occurrenceIndex: number;
    lemma: string;
    partOfSpeech: BlankPartOfSpeech;
    meaningKo: string;
    start: number;
    end: number;
  };
  const hits: Hit[] = [];

  for (const v of input.vocab) {
    const lemma = v.word.trim().toLowerCase();
    if (!lemma || usedLemma.has(lemma) || isExcludedBlankWord(lemma)) continue;
    const meaning = v.meaning.trim();
    const posMatch = /^(n|v|a|ad|adj|adv|명|동|형|부)\.?/i.exec(meaning);
    const pos: BlankPartOfSpeech = /^ad|^adv|^부/i.test(posMatch?.[1] ?? "")
      ? "adverb"
      : /^a|^adj|^형/i.test(posMatch?.[1] ?? "")
        ? "adjective"
        : /^v|^동/i.test(posMatch?.[1] ?? "")
          ? "verb"
          : "noun";
    const meaningKo =
      meaning.replace(/^(n|v|a|ad|adj|adv|명|동|형|부)\.?\s*/i, "").trim() ||
      lemma;

    for (const s of input.sentences) {
      const tokens = tokenizeWords(s.english);
      for (const tok of tokens) {
        const lower = tok.text.toLowerCase();
        /*
         * 어미를 뗀 줄기가 3자 미만이면 맞춰 보지 않는다. Korea’s·U.S.·Let’s 의 「s」는 떼면 빈 글자라
         * 어떤 낱말과도 맞는다고 나와, traditional 자리에 「s」 빈칸이 뚫렸다(전수 대조 2026-11-19, 12개 워크북).
         */
        const stem = lower.replace(/(?:ing|ed|es|s)$/, "");
        const match =
          lower === lemma ||
          (lemma.length >= 4 &&
            (lower.startsWith(lemma) || (stem.length >= 3 && lemma.startsWith(stem))));
        if (!match) continue;
        const occs = findExactWordOccurrences(s.english, tok.text);
        const occurrenceIndex = occs.findIndex(
          (h) => h.start === tok.start && h.end === tok.end
        );
        if (occurrenceIndex < 0) continue;
        hits.push({
          sentenceId: s.id,
          answerText: tok.text,
          occurrenceIndex,
          lemma,
          partOfSpeech: pos,
          meaningKo,
          start: tok.start,
          end: tok.end,
        });
        usedLemma.add(lemma);
        break;
      }
      if (usedLemma.has(lemma)) break;
    }
  }

  const ranked = hits
    .map((h) => {
      const scores = synthesizeScoresForLemma({
        lemma: h.lemma,
        partOfSpeech: h.partOfSpeech,
        vocabLemmas,
        titleText: input.titleText,
        semanticRole: "academic",
      });
      return { h, scores };
    })
    .sort((a, b) => computeBlankFinalScore(b.scores) - computeBlankFinalScore(a.scores));

  for (let i = 0; i < ranked.length && out.length < max; i++) {
    const { h, scores } = ranked[i]!;
    const grade = inferGradeFromScores(scores);
    out.push({
      candidateId: `vocab-${i + 1}`,
      id: `vocab-${i + 1}`,
      sentenceId: h.sentenceId,
      answerText: h.answerText,
      occurrenceIndex: h.occurrenceIndex,
      lemma: h.lemma,
      wordFamily: normalizeWordFamily(h.lemma),
      partOfSpeech: h.partOfSpeech,
      meaningKo: h.meaningKo,
      grade,
      semanticRole: "academic",
      competitionGroup: null,
      scores,
      reasonKo: "수업용자료 핵심 어휘",
      selectionReasonKo: "수업용자료 핵심 어휘",
      priority: 4,
      tokenStartIndex: h.start,
      tokenEndIndex: h.end,
      start: h.start,
      end: h.end,
    });
  }

  return out;
}
