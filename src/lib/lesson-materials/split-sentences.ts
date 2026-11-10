const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "vs",
  "etc",
  "fig",
  "no",
  "vol",
  "st",
  "rd",
]);

/** 문장 첫머리에 흔히 오는 말. U.S. 뒤에 이 말이 오면 문장이 끝난 것이고, 아니면(U.S. News) 이어진다. */
const SENTENCE_STARTERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "he", "she", "they", "we", "i", "you",
  "in", "on", "at", "for", "but", "and", "so", "however", "then", "there", "its", "their", "his", "her",
  "our", "my", "your", "today", "now", "since", "when", "after", "before", "as", "if", "while", "because",
]);

/** U.S. · U.K. · a.m. 처럼 글자마다 점을 찍은 약어 */
function isInitialism(token: string): boolean {
  const last = token.replace(/["'”’)]+$/g, "");
  return /^([A-Za-z]\.){2,}$/.test(last);
}

function isAbbreviation(token: string): boolean {
  const last = token.replace(/["'”’)]+$/g, "");
  if (/^[A-Z]\.$/.test(last)) return true;
  const bare = last.replace(/[.]+$/, "").toLowerCase();
  return ABBREVIATIONS.has(bare);
}

/**
 * 따옴표 안의 끝맺음(. ! ?)에서 자를지: 따옴표가 닫힌 뒤 같은 문장이 이어지면(“Hurry! One item left!” even though ~,
 * “…,” she said) 자르지 않고, 대사가 따옴표 안에서 끝나면(“We’re both busy. Tilly can —” 다음 대사) 자른다.
 * 2026-11-10 전수 점검: 따옴표 안을 통째로 묶어 대사 여러 문장·두 사람 말이 한 문장이 된 것 15곳.
 */
function quoteContinuesAfterClose(chars: string[], from: number, curly: boolean): boolean {
  for (let j = from; j < chars.length && j < from + 600; j++) {
    const c = chars[j]!;
    if (c === "\n") return false;
    if ((curly && c === "”") || (!curly && c === '"')) {
      const rest = chars.slice(j + 1, j + 12).join("");
      // 닫힌 뒤 소문자·쉼표·대시로 이어지면 같은 문장
      return /^\s*[a-z,;:—–-]/.test(rest);
    }
  }
  return true;
}

export function splitEnglishSentences(text: string): string[] {
  const cleaned = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    // □ 소제목은 새 줄로(…main source of income. □ For a Sustainable Diet — 2026-11-10)
    .replace(/\s*([□■◆▶►])\s*/g, "\n$1 ")
    .trim();
  if (!cleaned) return [];

  const sentences: string[] = [];
  let buf = "";
  const chars = [...cleaned];
  /*
   * 따옴표 안에서는 끊지 않는다(“Hurry! One item left!” even though ~ 가 두 문장으로 갈리던 것,
   * 2026-10-22 분석지 대조). 따옴표 짝이 안 맞는 글(OCR)에서 지문 전체가 한 문장이 되지 않게 길이로 막는다.
   */
  let quoteDepth = 0;
  let straightOpen = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === "\n") {
      const t = buf.trim();
      if (t) sentences.push(t);
      buf = "";
      quoteDepth = 0;
      straightOpen = false;
      continue;
    }

    buf += ch;
    if (ch === "“") quoteDepth++;
    else if (ch === "”") quoteDepth = Math.max(0, quoteDepth - 1);
    else if (ch === '"') straightOpen = !straightOpen;
    // 대사와 대사 사이(…told me —” “I’ll tell you…): 앞 대사가 끝맺음·대시로 닫히고 바로 새 따옴표가 열리면 자른다
    if (ch === "”" && quoteDepth === 0 && chars[i + 1] === " " && chars[i + 2] === "“" && /[.!?—–…]\s*$/.test(buf.slice(0, -1))) {
      const t = buf.trim();
      if (t) sentences.push(t);
      buf = "";
      continue;
    }
    if (!/[.!?]/.test(ch)) continue;

    let look = i + 1;
    while (
      look < chars.length &&
      /["'”’)]/.test(chars[look] ?? "")
    ) {
      const q = chars[look]!;
      buf += q;
      if (q === "”") quoteDepth = Math.max(0, quoteDepth - 1);
      else if (q === '"') straightOpen = !straightOpen;
      i = look;
      look = i + 1;
    }

    const after = chars[i + 1];
    const after2 = chars[i + 2];
    const endOfText = after === undefined;
    const newline = after === "\n";
    const newSentence =
      after === " " && !!after2 && /[A-Z"“‘(]/.test(after2);

    if (!endOfText && !newline && !newSentence) continue;
    const insideQuote = (quoteDepth > 0 || straightOpen) && buf.length < 400;
    if (insideQuote && !endOfText && !newline && quoteContinuesAfterClose(chars, i + 1, quoteDepth > 0)) continue;

    const t = buf.trim();
    const lastWord = t.split(/\s+/).pop() ?? "";
    if (isAbbreviation(lastWord) && !endOfText) continue;
    if (isInitialism(lastWord) && !endOfText && !newline) {
      const nextWord = chars.slice(i + 2, i + 30).join("").split(/[\s,.;:!?]/)[0] ?? "";
      if (!SENTENCE_STARTERS.has(nextWord.toLowerCase())) continue;
    }
    if (t) sentences.push(t);
    buf = "";
  }

  const rest = buf.trim();
  if (rest) sentences.push(rest);
  return sentences;
}

export function splitKoreanSentences(text: string): string[] {
  const cleaned = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=(?:다|요|까|니다|습니다|세요)[.!?]|[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitPassageIntoLinePairs(input: {
  english: string;
  korean?: string;
}): Array<{ english: string; korean: string }> {
  const enLines = splitEnglishSentences(input.english);
  const krLines = splitKoreanSentences(input.korean ?? "");
  if (enLines.length === 0) return [];
  return enLines.map((english, i) => ({
    english,
    korean: krLines.length === enLines.length ? (krLines[i] ?? "") : "",
  }));
}
