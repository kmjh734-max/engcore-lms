/**
 * 어휘추론·어휘개수의 본문 표지, 정답, 해설을 한 덩어리로 대조한다.
 *
 * 자유형 해설에서 정답을 추측하지 않는다. 생성 모델이 내놓은 구조화 판정으로
 * 학생용 해설을 다시 만들고, 저장 뒤에는 그 고정 형식을 다시 읽어 같은 검사를 한다.
 */

const VOCAB_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"] as const;

export type VocabularyJudgmentVerdict = "correct" | "wrong";

export interface VocabularyJudgment {
  number: number;
  verdict: VocabularyJudgmentVerdict;
  replacement?: string;
  reason: string;
}

export interface VocabularyConsistencyResult {
  ok: boolean;
  problems: string[];
  judgments: VocabularyJudgment[];
  explanation?: string;
}

type VocabularyCode = "어휘추론" | "어휘개수";

function answerNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  const text = String(value ?? "").trim();
  const markAt = VOCAB_MARKS.indexOf(text as (typeof VOCAB_MARKS)[number]);
  if (markAt >= 0) return markAt + 1;
  const match = text.match(/^([1-8])\s*(?:개|번)?$/);
  return match ? Number(match[1]) : null;
}

function plainEnglish(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeRawJudgments(raw: unknown): VocabularyJudgment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const number = Number(row.number);
    const verdict = String(row.verdict ?? "").trim().toLowerCase();
    const reason = String(row.reason ?? "").trim();
    const replacement = String(row.replacement ?? "").trim();
    if (!Number.isInteger(number) || number < 1 || number > 8) return [];
    if (verdict !== "correct" && verdict !== "wrong") return [];
    return [{
      number,
      verdict: verdict as VocabularyJudgmentVerdict,
      ...(replacement ? { replacement } : {}),
      reason,
    }];
  });
}

function judgmentsFromExplanation(explanation: string): VocabularyJudgment[] {
  const out: VocabularyJudgment[] = [];
  for (const line of String(explanation ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*([①-⑧])\s+(맞음|틀림)\s*[—–:-]\s*(.+?)\s*$/);
    if (!match) continue;
    const number = VOCAB_MARKS.indexOf(match[1] as (typeof VOCAB_MARKS)[number]) + 1;
    const verdict: VocabularyJudgmentVerdict = match[2] === "틀림" ? "wrong" : "correct";
    const body = match[3]!.trim();
    const replacement =
      verdict === "wrong"
        ? body.match(/(?:→|⇒|->)\s*([A-Za-z][A-Za-z' -]{0,50}?)(?=\s*[:：]|$)/)?.[1]?.trim()
        : undefined;
    const reason = body.replace(/^.*?(?:[:：])\s*/, "").trim() || body;
    out.push({ number, verdict, ...(replacement ? { replacement } : {}), reason });
  }
  return out;
}

function inspectSpots(passageModified: string) {
  const text = String(passageModified ?? "");
  const allMarks = [...text.matchAll(/[①-⑧]/g)].map((m) => m[0]!);
  const allUnderlines = [...text.matchAll(/<u>[\s\S]*?<\/u>/gi)];
  const paired = [...text.matchAll(/([①-⑧])\s*<u>\s*([^<>]*?\S[^<>]*?)\s*<\/u>/gi)].map(
    (m) => ({ mark: m[1]!, word: m[2]!.trim() })
  );
  return { allMarks, allUnderlines, paired };
}

function expectedMarks(code: VocabularyCode, answer: number | null): string[] {
  if (code === "어휘추론") return VOCAB_MARKS.slice(0, 5);
  if (answer == null || answer < 1 || answer > 5) return [];
  // 만들 때와 같은 자리 수 — 생성은 max(5, 개수+3)인데 여기는 개수+3이라 「1개」 문항(5곳)이 늘 떨어졌다(2026-11-23)
  return VOCAB_MARKS.slice(0, Math.max(5, answer + 3));
}

function renderExplanation(
  code: VocabularyCode,
  answer: number,
  spots: Array<{ mark: string; word: string }>,
  judgments: VocabularyJudgment[]
): string {
  const header = code === "어휘추론"
    ? `정답은 ${VOCAB_MARKS[answer - 1]}이다.`
    : `정답은 ${answer}개다.`;
  const byNumber = new Map(judgments.map((j) => [j.number, j]));
  const lines = spots.map((spot, index) => {
    const judgment = byNumber.get(index + 1)!;
    if (judgment.verdict === "wrong") {
      return `${spot.mark} 틀림 — ${spot.word} → ${judgment.replacement}: ${judgment.reason}`;
    }
    return `${spot.mark} 맞음 — ${spot.word}: ${judgment.reason}`;
  });
  return [header, ...lines].join("\n");
}

export function validateVocabularyConsistency(input: {
  code: string | null | undefined;
  passageModified: string | null | undefined;
  correctAnswer: unknown;
  /** 생성 직후에는 구조화 판정, 저장 뒤 재검사 때는 고정 형식 해설을 사용한다. */
  judgments?: unknown;
  explanation?: string | null;
  /** 만들 때 미리 정한 정답 번호/오류 개수. 모델이 임의로 바꾸면 실패한다. */
  expectedAnswer?: number | null;
}): VocabularyConsistencyResult {
  const code = input.code === "어휘개수" ? "어휘개수" : input.code === "어휘추론" ? "어휘추론" : null;
  if (!code) {
    return { ok: true, problems: [], judgments: [] };
  }

  const problems: string[] = [];
  const answer = answerNumber(input.correctAnswer);
  if (answer == null || answer < 1 || answer > 5) {
    problems.push(`정답은 1~5의 정수여야 합니다: ${String(input.correctAnswer ?? "")}`);
  }
  if (input.expectedAnswer != null && answer !== input.expectedAnswer) {
    problems.push(`계획한 정답은 ${input.expectedAnswer}인데 생성 정답은 ${answer ?? "없음"}입니다.`);
  }

  const expected = expectedMarks(code, answer);
  const spots = inspectSpots(String(input.passageModified ?? ""));
  const pairedMarks = spots.paired.map((spot) => spot.mark);
  if (spots.allMarks.join("") !== pairedMarks.join("") || spots.allUnderlines.length !== spots.paired.length) {
    problems.push("모든 번호는 바로 뒤의 <u>낱말</u>과 정확히 한 쌍이어야 합니다.");
  }
  if (expected.length > 0 && pairedMarks.join("") !== expected.join("")) {
    problems.push(`본문 표지는 ${expected.join(" ")}를 순서대로 한 번씩 써야 합니다.`);
  }
  if (spots.paired.some((spot) => !/[A-Za-z]/.test(spot.word))) {
    problems.push("밑줄마다 영어 낱말 또는 영어 구가 있어야 합니다.");
  }

  const judgments = input.judgments === undefined
    ? judgmentsFromExplanation(String(input.explanation ?? ""))
    : normalizeRawJudgments(input.judgments);
  const expectedNumbers = expected.map((_, index) => index + 1);
  const judgmentNumbers = judgments.map((j) => j.number);
  if (
    expectedNumbers.length > 0 &&
    (judgmentNumbers.length !== expectedNumbers.length ||
      judgmentNumbers.some((number, index) => number !== expectedNumbers[index]))
  ) {
    problems.push("어휘 판정은 모든 표지를 번호 순서대로 정확히 한 번씩 설명해야 합니다.");
  }
  if (judgments.some((j) => j.reason.length < 2)) {
    problems.push("각 표지의 맞음·틀림 이유가 필요합니다.");
  }

  const wrong = judgments.filter((j) => j.verdict === "wrong");
  if (code === "어휘추론" && answer != null) {
    if (wrong.length !== 1 || wrong[0]?.number !== answer) {
      problems.push(`어휘추론은 ${VOCAB_MARKS[answer - 1]} 하나만 틀려야 하며 정답과 같아야 합니다.`);
    }
  }
  if (code === "어휘개수" && answer != null && wrong.length !== answer) {
    problems.push(`정답은 ${answer}개인데 어휘 판정은 ${wrong.length}개를 틀렸다고 합니다.`);
  }

  const spotByNumber = new Map(spots.paired.map((spot, index) => [index + 1, spot]));
  for (const judgment of wrong) {
    const replacement = String(judgment.replacement ?? "").trim();
    if (!/[A-Za-z]/.test(replacement)) {
      problems.push(`${VOCAB_MARKS[judgment.number - 1]}의 바른 교체어가 없습니다.`);
      continue;
    }
    const marked = spotByNumber.get(judgment.number)?.word ?? "";
    if (plainEnglish(marked) && plainEnglish(marked) === plainEnglish(replacement)) {
      problems.push(`${VOCAB_MARKS[judgment.number - 1]}의 교체어가 밑줄 낱말과 같습니다.`);
    }
  }

  const ok = problems.length === 0 && answer != null;
  return {
    ok,
    problems,
    judgments,
    ...(ok ? { explanation: renderExplanation(code, answer, spots.paired, judgments) } : {}),
  };
}

