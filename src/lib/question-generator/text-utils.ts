import {
  lemmaWordBankOnly,
  stripExtraWordHint,
} from "@/lib/question-generator/word-order-normalize";
import { isolateFigureMarks } from "@/lib/question-generator/figure-mark";

/** 문장 중간의 <보기>의 → 보기의 (섹션 태그와 혼동 방지) */
export function sanitizeInlineSectionMentions(text: string): string {
  return (text || "")
    .replace(/<보기>(의|를|에|만|와|과|로|을|은|이|가)/g, "보기$1")
    .replace(/<조건>(의|를|에|만|와|과|로|을|은|이|가)/g, "조건$1")
    .replace(/<해석>(의|를|에)/g, "해석$1")
    .replace(/<요약문>(의|를|에)/g, "요약문$1")
    .replace(/<표>(의|를|에|와|과|로|은|는|이|가)/g, "표$1");
}

/**
 * 섹션 태그를 제 줄에 세운다.
 *
 * 선생님 지적(2026-09-28): 「<우리말> … <조건> ○ … <보기> …」처럼 한 줄로 뭉쳐 나온다.
 * 이미 만들어 둔 문항도 상자로 풀리도록, 태그 앞뒤에 줄을 넣어 준다.
 * <우리말>은 예전 이름이라 <해석>으로 바꿔 기존 인쇄 틀이 그대로 그리게 한다.
 */
function standAloneSectionTags(text: string): string {
  return (text || "")
    .replace(/<\s*우리말\s*>/g, "<해석>")
    .replace(/\s*<(조건|보기|해석|요약문|표|지칭답란|답안행)>\s*/g, "\n<$1>\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 조건이 「○ … ○ … ○ …」처럼 한 줄에 붙어 오면 한 줄에 하나씩 세운다.
 * 선생님 지적(2026-09-28): 조건이 뭉쳐 나와 읽을 수 없었다.
 */
function splitConditionBullets(conditions: string): string {
  return (conditions || "")
    .replace(/\s*○\s*/g, "\n○ ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "○")
    .join("\n");
}

/** 줄 단독 섹션 태그만 구분자로 인정 */
function sectionOpen(tag: string): RegExp {
  return new RegExp(`(?:^|\\n)\\s*<${tag}>\\s*(?=\\n|$)`);
}

function sliceAfterTag(text: string, tag: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*<${tag}>\\s*\\n?`);
  const m = re.exec(text);
  if (!m || m.index == null) return null;
  return text.slice(m.index + m[0].length);
}

function sliceUntilNextSection(text: string, stopTags: string[]): string {
  let cut = text.length;
  for (const tag of stopTags) {
    const m2 = new RegExp(`(?:^|\\n)\\s*<${tag}>\\s*(?=\\n|$)`).exec(text);
    if (m2 && m2.index != null && m2.index < cut) cut = m2.index;
  }
  return text.slice(0, cut).trim();
}

/** 메타 태그·군더더기 발문 제거 */
export function cleanQuestionText(text: string): string {
  return (text || "")
    .replace(/\[[^\]]*변형[^\]]*\]/g, "")
    .replace(/\[[0-9]{6}H[0-9][^\]]*\]/g, "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^\[[^\]]+\]$/.test(l)) return false;
      if (/다음 글을 읽고\s*물음에\s*답하시오\.?/.test(l)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** 지문 비교용 정규화 */
export function normalizePassage(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * 문장 끝 뒤 공백 — 「Dr. Kim」「Mr. Lee」처럼 호칭 뒤의 마침표는 빼고 찾는다.
 * 「Thanks, Dr.」에서 끊어 제시어 배열 빈칸이 문장 중간에서 시작하고 Kim이 보기로 들어갔다(10-14 점검).
 */
export const ENGLISH_SENTENCE_GAP =
  /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Jr|Sr|vs|etc|e\.g|i\.e)\.)(?<=[.!?]["'”’]?)\s+(?=[A-Z"'“‘(])/;

/**
 * 순서 배열 「일부 내용만」: 지문에서 이어진 문장 7개(주어진 글 1 + (A)(B)(C) 두 문장씩)를 잘라 준다.
 * Jayden 선생님(2026-11-24): (B)가 한 문장처럼 너무 짧게 나온다 — 긴 지문 전체를 셋으로 나누면 고르지 않다.
 * 8문장 이하는 그대로. 첫 문장부터 자른다.
 */
export function orderExcerpt(text: string, seed: number, size = 7): string {
  const sents = normalizePassage(text)
    .split(ENGLISH_SENTENCE_GAP)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sents.length <= size + 1) return text;
  // 글의 첫머리부터 자른다 — 가운데를 자르면 「주어진 글」이 논지 중간에서 시작해 순서 단서가 없었다(2026-11-24 시험 2번 중 1번 실패)
  void seed;
  const start = 0;
  return sents.slice(start, start + size).join(" ");
}

/** 영어 지문 문장 수 추정 (.?! 기준) */
export function countEnglishSentences(text: string): number {
  const cleaned = normalizePassage(text);
  if (!cleaned) return 0;
  const parts = cleaned
    // 닫는 따옴표 뒤(「…way.” Then」)에서도 자른다 — 예전 식은 못 잘라 지문 9~15%를 적게 셌다(모의고사 분석 2026-11-24)
    .split(ENGLISH_SENTENCE_GAP)
    .map((s) => s.trim())
    .filter((s) => {
      const letters = (s.match(/[A-Za-z]/g) ?? []).length;
      return letters >= 3;
    });
  return parts.length;
}

/** 제시어 배열 questionText의 <조건>/<보기>/<해석> 블록 파싱 */
export function parseWordOrderBlocks(text: string): {
  conditions: string;
  words: string;
  translation: string;
  allowExtraWords: boolean;
} | null {
  const cleaned = standAloneSectionTags(
    sanitizeInlineSectionMentions(cleanQuestionText(text))
  );
  if (
    !/<조건>/.test(cleaned) ||
    !sectionOpen("보기").test(cleaned) ||
    !/<해석>/.test(cleaned)
  ) {
    // fallback: still require tags somewhere
    if (!/<조건>/.test(cleaned) || !/<보기>/.test(cleaned) || !/<해석>/.test(cleaned)) {
      return null;
    }
  }

  const afterCond = sliceAfterTag(cleaned, "조건");
  const afterBogi = sliceAfterTag(cleaned, "보기");
  const afterInterp = sliceAfterTag(cleaned, "해석");
  if (afterCond == null || afterBogi == null || afterInterp == null) {
    return null;
  }

  let conditions = sliceUntilNextSection(afterCond, ["보기", "해석", "요약문"]);
  let words = sliceUntilNextSection(afterBogi, ["해석", "요약문", "조건"]);
  const translation = sliceUntilNextSection(afterInterp, [
    "조건",
    "보기",
    "요약문",
  ]);

  if (!conditions && !words && !translation) return null;

  // 조건에 남은 깨진 문구 복구
  conditions = splitConditionBullets(
    conditions
      .replace(/^의\s+단어를/m, "보기의 단어를")
      .replace(/○\s*의\s+단어를/g, "○ 보기의 단어를")
  );

  words = words
    .replace(/<\/?보기>/gi, "")
    .replace(/(?:보기)?\s*에\s*없는\s*단어\s*추가\s*가능/gi, "")
    .replace(/없는\s*단어\s*추가\s*가능/gi, "")
    // 조건 줄이 보기에 섞인 경우 제거
    .replace(/^○\s*.+$/gm, "")
    .replace(/보기의\s*단어를[\s\S]*?(?=[a-zA-Z]|$)/g, "")
    .trim();

  const stripped = stripExtraWordHint(conditions);
  conditions = stripped.conditions;
  const allowExtraWords =
    stripped.allowExtraWords ||
    /없는\s*단어\s*추가|추가\s*가능/.test(cleaned);

  words = lemmaWordBankOnly(words);

  return { conditions, words, translation, allowExtraWords };
}

/** 요약문 서술형 questionText: <조건> / (선택)<보기> / <요약문> */
export function parseSummaryWritingBlocks(text: string): {
  conditions: string;
  words: string | null;
  summary: string;
  blankLabels: string[];
} | null {
  const cleaned = standAloneSectionTags(
    sanitizeInlineSectionMentions(cleanQuestionText(text))
  );
  if (!/<조건>/.test(cleaned) || !/<요약문>/.test(cleaned)) {
    return null;
  }

  const afterCond = sliceAfterTag(cleaned, "조건");
  const afterSummary = sliceAfterTag(cleaned, "요약문");
  if (afterCond == null || afterSummary == null) return null;

  const hasBogiSection = sectionOpen("보기").test(cleaned);
  let conditions = sliceUntilNextSection(
    afterCond,
    hasBogiSection ? ["보기", "요약문"] : ["요약문", "보기"]
  );
  let words: string | null = null;
  if (hasBogiSection) {
    const afterBogi = sliceAfterTag(cleaned, "보기");
    if (afterBogi != null) {
      words = sliceUntilNextSection(afterBogi, ["요약문", "조건", "해석"]);
    }
  }
  const summary = sliceUntilNextSection(afterSummary, [
    "조건",
    "보기",
    "해석",
  ]);
  if (!summary) return null;

  conditions = splitConditionBullets(
    conditions
      .replace(/^의\s+단어를/m, "보기의 단어를")
      .replace(/○\s*의\s+단어를/g, "○ 보기의 단어를")
      .replace(/N\+M\s*=\s*<보기>\s*단어/gi, "N+M = 보기 단어")
  );

  if (words != null) {
    words = words
      .replace(/<\/?보기>/gi, "")
      .replace(/^○\s*.+$/gm, "")
      .replace(/보기의\s*단어를[\s\S]*?(?=[a-zA-Z]|$)/g, "")
      .trim();
    words = lemmaWordBankOnly(words);
  }

  const blankLabels = Array.from(
    new Set(summary.match(/[ⓐⓑⓒⓓⓔ]/g) ?? [])
  ).sort();
  return { conditions, words, summary, blankLabels };
}

/**
 * 요약표 서술형 questionText: <조건> + <표>.
 * 표는 한 줄이 한 행이고 | 로 칸을 나눈다. 첫 줄이 머리글 행이다.
 *
 * 선생님 지적(2026-09-28): 표가 「| | most political experts | Darby Saxbe | |」처럼
 * 한 줄 글로 붙어 나와 읽을 수 없었다. 여기서 행·칸으로 갈라 진짜 표로 그린다.
 */
export function parseSummaryTableBlocks(text: string): {
  conditions: string;
  rows: string[][];
  blankLabels: string[];
} | null {
  const cleaned = standAloneSectionTags(
    sanitizeInlineSectionMentions(cleanQuestionText(text))
  );
  if (!/<조건>/.test(cleaned) || !/<표>/.test(cleaned)) return null;

  const afterCond = sliceAfterTag(cleaned, "조건");
  const afterTable = sliceAfterTag(cleaned, "표");
  if (afterCond == null || afterTable == null) return null;

  const conditions = splitConditionBullets(
    sliceUntilNextSection(afterCond, ["표", "보기", "해석", "요약문"])
  );
  const body = sliceUntilNextSection(afterTable, ["조건", "보기", "해석", "요약문"]);

  const rows = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
    );
  if (rows.length < 2) return null;

  // 칸 수가 들쭉날쭉하면 가장 넓은 줄에 맞춰 빈칸으로 채운다
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2) return null;
  let padded = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]);

  /*
   * 첫 칸은 그 줄이 무엇에 관한 줄인지 적는 이름 칸이다(학력평가 모양: Land / Building
   * / Distance). 선생님 요청(2026-09-28): 「견줄 점」 같은 말은 쓰지 않는다.
   * 이름 칸 없이 두 칸만 오면 번호를 붙여 준다.
   */
  if (width === 2) {
    padded = padded.map((r, i) => [i === 0 ? "" : String(i), ...r]);
  }

  const blankLabels = Array.from(new Set(body.match(/\([A-E]\)/g) ?? [])).sort();
  return { conditions, rows: padded, blankLabels };
}

/**
 * 표 칸의 (A) 같은 빈칸을 밑줄로 넓혀 준다.
 * 선생님 요청(2026-09-28): 「______(A)______」 이렇게 학생이 쓸 자리가 보이게.
 */
export function withBlankRules(cell: string): string {
  return cell.replace(/\(([A-E])\)/g, "____($1)____");
}

/** 본문에 연속 N단어로 존재하는지 (대소문자·구두점 무시) */
export function passageHasConsecutiveWords(
  passage: string,
  phrase: string,
  expectedWordCount?: number
): boolean {
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      // 굽은 따옴표도 낱말 안 아포스트로피로 — you’ve가 두 낱말로 갈려 지문에 있는 정답을 버렸다(2026-11-23 API 없이 돌려 보기)
      .replace(/[’‘]/g, "'")
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const p = norm(passage);
  const ph = norm(phrase);
  if (!p || !ph) return false;
  const words = ph.split(" ").filter(Boolean);
  if (expectedWordCount != null && words.length !== expectedWordCount) {
    return false;
  }
  return ` ${p} `.includes(` ${ph} `);
}

/**
 * 리얼영어 서술형(어휘 빈칸·주제문·구문 변환·대화문·내용 매칭, 2026-11-23): 꼬리표 상자 + <답란>.
 * <답란> 아래 줄마다 답 칸 이름(ⓐ / ⓑ / 주제 / 정답)이다. <답란>이 없으면 null.
 */
export function parseTaggedAnswerBlocks(text: string): {
  sections: Array<{ tag: string; body: string }>;
  answerLabels: string[];
} | null {
  const cleaned = cleanQuestionText(text);
  if (!/(^|\n)\s*<답란>/.test(cleaned)) return null;
  const sections: Array<{ tag: string; body: string }> = [];
  let answerLabels: string[] = [];
  const parts = cleaned.split(/(?:^|\n)\s*<([^<>\n]{1,6})>\s*(?=\n|$)/);
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i]!.trim();
    const body = (parts[i + 1] ?? "").trim();
    if (tag === "답란") {
      answerLabels = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    } else if (body) {
      sections.push({ tag, body });
    }
  }
  if (answerLabels.length === 0) answerLabels = ["정답"];
  return { sections, answerLabels };
}

/** 지칭 서술형 답란 마커 */
export function parseReferenceAnswerBlock(text: string): {
  labels: string[];
} | null {
  const cleaned = cleanQuestionText(text).trim();
  if (!/<지칭답란>/.test(cleaned)) return null;
  const body =
    cleaned.match(/<지칭답란>\s*([\s\S]*?)$/)?.[1]?.trim() ?? "";
  const labels = (body.match(/[ⓐⓑⓒⓓⓔ]/g) ?? []).filter(Boolean);
  return { labels: labels.length ? labels : ["ⓐ"] };
}

/** 어법 오류 수정 서술형: <조건> + <답안행> */
export function parseGrammarCorrectionBlocks(text: string): {
  conditions: string;
  rowCount: number;
} | null {
  const cleaned = cleanQuestionText(text).trim();
  if (!/<조건>/.test(cleaned) || !/<답안행>/.test(cleaned)) return null;
  if (/<보기>|<해석>|<요약문>/.test(cleaned)) return null;
  const conditions =
    cleaned.match(/<조건>\s*([\s\S]*?)(?=<답안행>|$)/)?.[1]?.trim() ?? "";
  const rowRaw =
    cleaned.match(/<답안행>\s*(\d+)/)?.[1] ??
    cleaned.match(/<답안행>\s*([\s\S]*?)$/)?.[1]?.trim() ??
    "";
  const rowCount = Math.max(1, Math.min(5, parseInt(String(rowRaw), 10) || 2));
  return { conditions, rowCount };
}

/** 단어 수 (영어 공백 기준) */
export function countEnglishWords(text: string): number {
  return (text || "")
    /*
     * 낱말 안에 든 굽은 따옴표는 곧은 것으로 바꿔 한 낱말로 센다.
     *
     * 선생님과 함께 전수조사(2026-09-29): 특정표현의미서술에서 발문이 요구한 낱말 수와
     * 정답의 낱말 수가 어긋난 것이 있었다. 「10단어로 쓰시오」인데 정답은 아홉 낱말,
     * 「5단어」인데 네 낱말이었다. 까닭은 opponent’s와 can’t의 ’를 낱말 사이 공백으로
     * 바꿔 두 낱말로 센 것이다(곧은 '는 세지 않았다). 발문 숫자를 이 셈으로 적으므로
     * 학생이 세어 보면 하나가 모자란다.
     */
    .replace(/[’ʼ‘]/gu, (mark, at: number, whole: string) => {
      const before = whole[at - 1] ?? "";
      const after = whole[at + 1] ?? "";
      return /\p{L}/u.test(before) && /\p{L}/u.test(after) ? "'" : " ";
    })
    // well-being·long-term처럼 하이픈으로 이은 말은 한 낱말로 센다. 두 낱말로 세면 「9단어로 쓰시오」인데
    // 학생·검수는 8단어로 세어 문항이 버려졌다(시험 50문항 2026-10-04).
    .replace(/(\p{L})-(?=\p{L})/gu, "$1")
    // U.S.·e.g. 같은 점 찍은 약어도 한 낱말이다(7차 시험: 「in the U.S.」를 두 낱말로 세어 문항이 버려짐)
    .replace(/\b(?:\p{L}\.){2,}/gu, (m) => m.replace(/\./g, ""))
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * 복사·붙여넣기 시 생긴 어색한 줄바꿈을 풀어 A4 폭에 맞게 자연스럽게 흐르게 함.
 * 빈 줄(문단)만 유지하고, 한 줄 개행은 공백으로 합침.
 */
/** 한 글자를 어느 쪽에 붙일지 정할 때 쓰는 흔한 영어 낱말(앞 낱말이 이미 낱말이면 뒤쪽에 붙인다). */
const COMMON_WORDS = new Set([
  "the","and","that","have","for","not","with","you","this","but","his","from","they","say","her","she",
  "will","one","all","would","there","their","what","out","about","who","get","which","when","make","can",
  "like","time","just","him","know","take","people","into","year","your","good","some","could","them","see",
  "other","than","then","now","look","only","come","its","over","also","back","after","use","two","how",
  "our","work","first","well","way","even","new","want","because","any","these","give","day","most","us",
  "are","was","were","has","had","been","being","did","does","done","made","said","each","many","much",
  "more","such","very","own","same","those","while","before","between","under","above","again","still",
  "as","at","by","in","is","it","of","on","or","to","up","we","he","do","so","if","no","my","me","be","an",
]);

/**
 * 낱말 가운데가 띄어져 들어온 지문을 붙인다("as t he eastern" → "as the eastern", "th e" → "the").
 * 붙여 넣은 원문(PDF 복사 등)에 이런 깨짐이 섞여 시험지에 그대로 찍혔다(선생님 지적 2026-09-18).
 * 혼자 쓰이는 낱말은 a·I·A·O뿐이므로 그 밖의 한 글자만 손본다. 앞 낱말이 이미 온전한 낱말이면
 * (as t he) 뒤쪽에, 아니면(th e) 앞쪽에 붙인다.
 */
export function joinBrokenWords(line: string): string {
  const tokens = line.split(" ");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lone = /^[B-HJ-Zb-hj-z]$/.test(t);
    const prev = out[out.length - 1];
    const next = tokens[i + 1];
    const wordish = (w: string | undefined) => Boolean(w && /^[A-Za-z]{2,}$/.test(w));
    if (!lone || (!wordish(prev) && !wordish(next))) {
      out.push(t);
      continue;
    }
    const prevIsWord = wordish(prev) && COMMON_WORDS.has(prev!.toLowerCase());
    if (wordish(next) && (prevIsWord || !wordish(prev))) {
      tokens[i + 1] = t + next;
      continue;
    }
    out[out.length - 1] = prev + t;
  }
  return out.join(" ");
}
export function reflowPassageForPrint(text: string): string[] {
  // 그림 표시([[FIG:…]])는 제 문단으로 떼어 둔다 — 표시가 없으면 그대로
  const raw = isolateFigureMarks((text || "").replace(/\r\n/g, "\n")).trim();
  if (!raw) return [];
  return raw
    .split(/\n\s*\n+/)
    .map((para) =>
      para
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .map(joinBrokenWords)
    .filter(Boolean);
}
