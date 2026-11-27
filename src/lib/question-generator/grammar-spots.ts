/**
 * 어법 추론·어법 개수: 모델은 지문을 다시 쓰지 않고 「밑줄 자리」만 답하고, 밑줄 친 지문은 코드가 원문에 붙여 만든다
 * (선생님 2026-11-28 「원가를 줄이자」, 모든 유형 2.5배 이상).
 *
 * 전에는 모델이 밑줄을 넣으며 지문 전체를 다시 썼다. 11-15~27 어법 객관식 121문항에 생성 호출 343번 — 절반 넘게
 * 「밑줄 밖 원문이 바뀜」「문장이 빠짐」으로 버려졌고, 지문을 베끼는 데 출력의 40%(약 244토큰)가 들었다.
 * 자리만 받으면 밑줄 밖은 글자 하나 바뀔 수 없고, 출력도 줄어든다.
 */
import type { QuestionTypeOption } from "@/lib/question-generator/types";

export const GRAMMAR_SPOT_CODES = new Set(["어법추론", "어법모두고르기", "어법개수", "어법오류수정2", "어법오류수정3"]);
/** 어휘도 같은 꼴(①<u>낱말</u>, 문맥에 안 맞는 말로 바꾼 자리) — 2026-11-28 */
export const VOCAB_SPOT_CODES = new Set(["어휘추론", "어휘개수"]);

export type SpotKind = "grammar" | "vocab";

/** 이 문항을 자리 목록으로 받는가 — 지문 바꿔 쓰기를 켠 작업은 예전처럼 지문을 받는다 */
export function spotKindOf(option: Pick<QuestionTypeOption, "type" | "aingkaCode">, paraphraseOn: boolean): SpotKind | null {
  if (paraphraseOn) return null;
  if (option.type === "grammar" && GRAMMAR_SPOT_CODES.has(option.aingkaCode ?? "")) return "grammar";
  if (option.type === "vocabulary" && VOCAB_SPOT_CODES.has(option.aingkaCode ?? "")) return "vocab";
  return null;
}
export function grammarSpotMode(option: Pick<QuestionTypeOption, "type" | "aingkaCode">, paraphraseOn: boolean): boolean {
  return spotKindOf(option, paraphraseOn) !== null;
}

const GRAMMAR_MARKS = "ⓐⓑⓒⓓⓔⓕⓖⓗ";
const VOCAB_MARKS = "①②③④⑤⑥⑦⑧";
export const spotMarks = (kind: SpotKind) => (kind === "vocab" ? VOCAB_MARKS : GRAMMAR_MARKS);

/** 지시문의 형식 줄(지문 대신 자리 목록) */
export function grammarSpotFormatLine(count: number, kind: SpotKind = "grammar"): string {
  const marks = spotMarks(kind).slice(0, count);
  const show =
    kind === "vocab"
      ? "orig unchanged if this spot fits the context, or a DIFFERENT word/phrase (same part of speech, about the same length) that does not fit the context if this spot is wrong. The sentence must stay grammatical with it — it fits the same words around it (not \"starting to ignore to\" for \"pay attention to\"), so only the meaning is wrong"
      : "orig unchanged if this spot is grammatical, or orig with ONLY its form changed if this spot is an error — a real English form of the same word (were, to go, which, quickly), never a misspelling or a non-word (not \"farly\")";
  return `- Do NOT write the passage. Return "spots": exactly ${count} underline spots IN PASSAGE ORDER (first = ${marks[0]}, last = ${marks[count - 1]}). The code puts ${marks[0]}<u>…</u> marks into the original passage for you; everything outside the spots stays the original word for word.
- Each spot: {"ctx": "4-10 consecutive words copied EXACTLY from the PASSAGE that contain the spot (unique in the passage)", "orig": "the original word(s) at the spot, 1-4 words, exactly as in ctx", "show": "what the student sees under the underline — ${show}"}.
- Spots must not overlap and must be spread over the passage (not more than two in one sentence). In explanation${kind === "vocab" ? " and vocabularyJudgments" : ""} refer to spots by ${marks[0]}~${marks[count - 1]} in this order.`;
}

/** 출력 칸 모양 */
export const GRAMMAR_SPOT_SCHEMA = [{ ctx: "exact words from the passage", orig: "original word(s)", show: "shown form (same as orig if correct)" }];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 낱말 사이 공백·따옴표 꼴 차이는 봐준다 */
function looseRe(text: string, edges: boolean): RegExp | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const body = words
    .map((w) => esc(w).replace(/['’‘]/g, "['’‘]").replace(/["“”]/g, '["“”]'))
    .join("\\s+");
  const head = edges && /^[A-Za-z0-9]/.test(words[0]!) ? "(?<![A-Za-z0-9])" : "";
  const tail = edges && /[A-Za-z0-9]$/.test(words[words.length - 1]!) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(`${head}${body}${tail}`, "g");
}

export type GrammarSpot = { ctx?: unknown; orig?: unknown; show?: unknown };

/**
 * 자리 목록으로 밑줄 친 지문을 만든다. 자리는 지문 차례대로 찾는다(앞 자리 뒤에서부터).
 * 못 찾으면 까닭(다시 만들 때 모델에게 넘김)을 돌려준다.
 */
export function buildGrammarSpotPassage(
  passage: string,
  spots: unknown,
  /** 정확한 개수, 또는 [최소, 최대] */
  count: number | [number, number],
  kind: SpotKind = "grammar"
): { passageModified: string } | { error: string } {
  if (!Array.isArray(spots)) return { error: "spots 목록이 없습니다. 지문 대신 밑줄 자리 목록(spots)을 주세요." };
  const [lo, hi] = Array.isArray(count) ? count : [count, count];
  if (spots.length < lo || spots.length > hi) {
    return { error: `밑줄 자리가 ${spots.length}개입니다. ${lo === hi ? `정확히 ${lo}개` : `${lo}~${hi}개`}여야 합니다.` };
  }
  const MARKS = spotMarks(kind);
  let cursor = 0;
  const cuts: Array<{ start: number; end: number; show: string }> = [];
  for (let i = 0; i < spots.length; i++) {
    const s = (spots[i] ?? {}) as GrammarSpot;
    const mark = MARKS[i]!;
    const ctx = String(s.ctx ?? "").trim();
    const orig = String(s.orig ?? "").trim();
    const show = String(s.show ?? "").trim();
    if (!orig || !show) return { error: `${mark} 자리의 orig·show가 비었습니다.` };
    if (orig.split(/\s+/).length > 4 || show.split(/\s+/).length > 5) {
      return { error: `${mark} 자리 「${orig}」가 너무 깁니다. 밑줄은 1~4낱말입니다.` };
    }
    // ctx를 앞 자리 뒤에서 찾는다(없으면 orig만으로)
    const ctxRe = ctx ? looseRe(ctx, true) : null;
    let ctxStart = -1;
    let ctxEnd = -1;
    if (ctxRe) {
      ctxRe.lastIndex = cursor;
      const m = ctxRe.exec(passage);
      if (m) {
        ctxStart = m.index;
        ctxEnd = m.index + m[0].length;
      }
    }
    const origRe = looseRe(orig, true);
    if (!origRe) return { error: `${mark} 자리 orig가 비었습니다.` };
    let at = -1;
    let len = 0;
    if (ctxStart >= 0) {
      origRe.lastIndex = Math.max(ctxStart, cursor);
      const m = origRe.exec(passage);
      if (m && m.index + m[0].length <= ctxEnd) {
        at = m.index;
        len = m[0].length;
      }
    }
    if (at < 0) {
      // ctx가 어긋났으면 앞 자리 뒤의 orig가 하나뿐일 때만 받는다(어느 자리인지 모호하면 다시 만든다)
      const all = [...passage.slice(cursor).matchAll(looseRe(orig, true)!)];
      if (all.length === 1) {
        at = cursor + all[0]!.index!;
        len = all[0]![0].length;
      } else {
        return {
          error: `${mark} 자리 「${orig}」를 원문에서 찾지 못했습니다(ctx 「${ctx.slice(0, 60)}」). ctx는 원문을 글자 그대로, 자리는 지문 차례대로 주세요.`,
        };
      }
    }
    cuts.push({ start: at, end: at + len, show });
    cursor = at + len;
  }
  let out = "";
  let prev = 0;
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i]!;
    out += `${passage.slice(prev, c.start)}${MARKS[i]}<u>${c.show}</u>`;
    prev = c.end;
  }
  out += passage.slice(prev);
  return { passageModified: out };
}

/*
 * 빈칸(빈칸추론 상·하, 빈칸단어)도 지문을 다시 쓰지 않고 「지울 원문 글귀」만 받는다(2026-11-28).
 * 빈칸 지문을 베껴 쓰는 데 출력 약 190토큰이 들었고, 밑줄 밖을 고쳐 써 다시 만드는 일도 있었다.
 */
export const BLANK_SPOT_CODES = new Set(["빈칸추론", "빈칸단어"]);
/** 서술형 제시어 배열도 문장 하나를 ⓐ__________로 비운다 */
export const WORD_ORDER_SPOT_CODES = new Set(["제시어배열기본", "제시어배열어형변화", "제시어배열단어추가", "문법조건영작"]);
export function blankSpotMode(option: Pick<QuestionTypeOption, "type" | "aingkaCode">, paraphraseOn: boolean): boolean {
  if (paraphraseOn) return false;
  if (option.type === "sentence_blank") return BLANK_SPOT_CODES.has(option.aingkaCode ?? "");
  return WORD_ORDER_SPOT_CODES.has(option.aingkaCode ?? "");
}
export const WRITING_BLANK_FILL = "ⓐ__________";
export const SENTENCE_BLANK_FILL = "____________________________________";
export const WORD_BLANK_FILL = "________";

export function blankSpotFormatLine(word: boolean): string {
  return word
    ? `- Do NOT write the passage. Return "blankText": the ONE word to blank, exactly as it appears, and "blankCtx": 4-10 consecutive words copied EXACTLY from the passage that contain it (unique in the passage). The code replaces that word with ________; everything else stays the original word for word.`
    : `- Do NOT write the passage. Return "blankText": the exact words of the passage to blank, copied character for character (one sentence, or the last part of a sentence running to its end, about 6~14 words; it must end where the sentence ends — right before . ! ? ; or : — never before a comma; if part of a sentence, the rest stays). The code replaces them with ____________________________________; everything else stays the original word for word.`;
}

export function buildBlankPassage(
  passage: string,
  blankText: unknown,
  blankCtx: unknown,
  word: boolean,
  fill?: string,
  /** 문장 첫머리에서 시작해야 하는가(문법조건영작: 정답이 대문자로 시작하는 한 문장) */
  wholeSentence = false
): { passageModified: string } | { error: string } {
  const text = String(blankText ?? "").trim().replace(/^[\s"“]+|[\s"”]+$/g, "");
  if (!text) return { error: "blankText가 비었습니다. 지울 원문 글귀를 주세요." };
  if (word && /\s/.test(text)) return { error: `빈칸단어는 한 낱말만 지웁니다(「${text}」).` };
  const re = looseRe(text, true);
  if (!re) return { error: "blankText가 비었습니다." };
  const all = [...passage.matchAll(re)];
  let hit: RegExpMatchArray | undefined;
  if (all.length === 1) hit = all[0];
  else if (all.length > 1) {
    const ctxRe = looseRe(String(blankCtx ?? ""), true);
    const c = ctxRe ? ctxRe.exec(passage) : null;
    if (c) hit = all.find((m) => m.index! >= c.index && m.index! + m[0].length <= c.index + c[0].length);
    if (!hit) return { error: `「${text}」가 지문에 ${all.length}번 나옵니다. blankCtx로 어느 자리인지 알려 주세요.` };
  }
  if (!hit) return { error: `blankText 「${text.slice(0, 60)}」를 원문에서 찾지 못했습니다. 원문을 글자 그대로 옮겨 주세요.` };
  const at = hit.index!;
  let len = hit[0].length;
  if (wholeSentence) {
    const before = passage.slice(0, at).replace(/\s+$/, "");
    if (before && !/[.!?]["'’”)]*$/.test(before)) {
      return { error: `빈칸 「${text.slice(0, 30)}…」가 문장 첫머리에서 시작하지 않습니다(앞에 「${before.slice(-25)}」). 문장 하나를 통째로 고릅니다.` };
    }
  }
  if (!word) {
    // 끝 문장부호는 지문에 남긴다(보기는 마침표 없이) — 지운 글귀가 마침표까지 먹으면 보기 마침표와 겹친다
    const punct = /[.!?]["'’”)]*$/.exec(hit[0]);
    if (punct) len -= punct[0].length;
    // 문장(또는 ; :) 끝에서 끝나야 한다. 쉼표 앞에서 끊으면 남은 동격어가 빈칸 말을 되풀이한다(2026-11-28 시험 「, traditional handmade Korean paper.」)
    const next = passage.slice(at + len).replace(/^\s+/, "");
    if (next && !/^[.!?;:]/.test(next)) {
      return { error: `빈칸 「${text.slice(-40)}」가 문장 중간에서 끝납니다(뒤에 「${next.slice(0, 25)}」). 문장 끝까지 지우거나 다른 문장을 고릅니다.` };
    }
  }
  return { passageModified: `${passage.slice(0, at)}${fill ?? (word ? WORD_BLANK_FILL : SENTENCE_BLANK_FILL)}${passage.slice(at + len)}` };
}

/*
 * 문장삽입·무관한 문장·순서도 지문을 다시 쓰지 않는다(2026-11-28). 모델은 「어느 문장을 빼고 번호를 어디에」만 답하고
 * 지문·정답 자리는 코드가 원문에서 만든다. 「지문을 고쳐 썼습니다」「번호가 문장 중간」으로 다시 만들던 일이 사라진다.
 */
export const ORDER_INSERT_SPOT_TYPES = new Set(["sentence_insertion", "irrelevant_sentence", "order"]);
export function structSpotMode(option: Pick<QuestionTypeOption, "type">, paraphraseOn: boolean): boolean {
  return !paraphraseOn && ORDER_INSERT_SPOT_TYPES.has(option.type);
}

const CIRCLED5 = "①②③④⑤";
const SENT_END = /[.!?]["'’”)]*$/;

/** 문장 머리(첫 3~6낱말)로 문장이 시작하는 자리를 찾는다 — 앞이 글 처음이거나 문장 끝이어야 한다 */
function findSentenceStart(text: string, head: string, from: number): number {
  // 머리에 여는 따옴표를 붙였든 안 붙였든 같은 문장을 찾는다(대화문 “Yes, please cease.”, 2026-11-28 시험)
  const bare = head.trim().replace(/^["“‘']+/, "");
  const re = looseRe(bare, true);
  if (!re) return -1;
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // 바로 앞의 여는 따옴표는 문장에 딸린 것으로 보고, 문장 시작은 그 따옴표 자리다
    let at = m.index;
    while (at > 0 && /["“‘']/.test(text[at - 1]!) && (at < 2 || /\s/.test(text[at - 2]!))) at -= 1;
    const before = text.slice(0, at).replace(/\s+$/, "");
    if (at >= from && (!before || SENT_END.test(before) || /[:;]$/.test(before))) return at;
    re.lastIndex = m.index + 1;
  }
  return -1;
}

/** 문장 하나(원문 그대로)를 찾는다 */
function findExact(text: string, sentence: string): { at: number; len: number } | null {
  const re = looseRe(sentence.trim(), false);
  if (!re) return null;
  const m = re.exec(text);
  return m ? { at: m.index, len: m[0].length } : null;
}

export function insertionSpotFormatLine(): string {
  return `- Do NOT write the passage. Return "givenText": the sentence to take out, copied EXACTLY from the passage (it becomes the given sentence), and "slotsBefore": five strings in passage order, each the first 3~6 words (copied exactly) of the sentence that comes right AFTER that slot in the passage without the given sentence. Slots go only before sentences; the sentence that originally followed the given sentence must be one of them (that slot is the answer). Use "END" only if the last slot must come after the last sentence. The code builds the passage with ①~⑤ and sets questionText to givenText.`;
}

export function buildInsertionPassage(
  passage: string,
  givenText: unknown,
  slotsBefore: unknown
): { passageModified: string; questionText: string; answer: number } | { error: string } {
  const given = String(givenText ?? "").trim();
  if (!given) return { error: "givenText가 비었습니다." };
  const hit = findExact(passage, given);
  if (!hit) return { error: `주어진 문장 「${given.slice(0, 50)}…」를 원문에서 찾지 못했습니다. 원문 문장을 글자 그대로 주세요.` };
  const head = passage.slice(0, hit.at).replace(/\s+$/, "");
  const rest = `${head}${head ? " " : ""}${passage.slice(hit.at + hit.len).replace(/^\s+/, "")}`.trim();
  const gap = head ? head.length + 1 : 0;
  if (!Array.isArray(slotsBefore) || slotsBefore.length !== 5) return { error: "slotsBefore는 문장 머리 다섯 개여야 합니다." };
  const at: number[] = [];
  let cursor = 0;
  for (let i = 0; i < 5; i++) {
    const h = String(slotsBefore[i] ?? "").trim();
    if (/^end$/i.test(h)) {
      if (i !== 4) return { error: "END는 마지막 자리에만 씁니다." };
      at.push(rest.length);
      continue;
    }
    const p = findSentenceStart(rest, h, cursor);
    if (p < 0) {
      return { error: `${CIRCLED5[i]} 자리 「${h}」로 시작하는 문장을 (주어진 문장을 뺀) 지문에서 찾지 못했습니다. 문장 첫 낱말들을 글자 그대로, 차례대로 주세요.` };
    }
    at.push(p);
    cursor = p + 1;
  }
  const answerIdx = at.findIndex((p) => p === Math.min(gap, rest.length));
  if (answerIdx < 0) return { error: "주어진 문장이 있던 자리에 번호가 없습니다. 원래 그 문장 바로 뒤에 오던 문장 앞에 번호 하나를 둡니다." };
  let out = "";
  let prev = 0;
  at.forEach((p, i) => {
    out += rest.slice(prev, p) + (p >= rest.length ? ` ${CIRCLED5[i]}` : `${CIRCLED5[i]} `);
    prev = p;
  });
  out += rest.slice(prev);
  return { passageModified: out.replace(/ {2,}/g, " ").trim(), questionText: given, answer: answerIdx + 1 };
}

export function irrelevantSpotFormatLine(): string {
  return `- Do NOT write the passage. Return "irrelevantText": the ONE new sentence you add (written by you), "insertBefore": the first 3~6 words (copied exactly) of the original sentence it goes right before ("END" to put it at the end), and "marksBefore": five strings in passage order, each the first 3~6 words of a sentence that gets ⓐ~ⓔ — one of them is the start of irrelevantText, the others are original sentence starts copied exactly. The code builds the passage; the original sentences stay word for word.`;
}

export function buildIrrelevantPassage(
  passage: string,
  irrelevantText: unknown,
  insertBefore: unknown,
  marksBefore: unknown
): { passageModified: string; answer: number } | { error: string } {
  const add = String(irrelevantText ?? "").trim();
  if (!add || !SENT_END.test(add)) return { error: "irrelevantText는 마침표로 끝나는 한 문장이어야 합니다." };
  const before = String(insertBefore ?? "").trim();
  const base = passage.trimEnd();
  const pos = /^end$/i.test(before) ? base.length : findSentenceStart(base, before, 0);
  if (pos < 0) return { error: `「${before}」로 시작하는 원문 문장을 찾지 못했습니다.` };
  const full = pos >= base.length ? `${base} ${add}` : `${base.slice(0, pos)}${add} ${base.slice(pos)}`;
  const addAt = pos >= base.length ? base.length + 1 : pos;
  if (!Array.isArray(marksBefore) || marksBefore.length !== 5) return { error: "marksBefore는 문장 머리 다섯 개여야 합니다." };
  const at: number[] = [];
  let cursor = 0;
  for (let i = 0; i < 5; i++) {
    const h = String(marksBefore[i] ?? "").trim();
    const p = findSentenceStart(full, h, cursor);
    if (p < 0) return { error: `ⓐ~ⓔ의 ${i + 1}번째 「${h}」로 시작하는 문장을 찾지 못했습니다. 문장 첫 낱말들을 글자 그대로, 차례대로 주세요.` };
    at.push(p);
    cursor = p + 1;
  }
  const answerIdx = at.indexOf(addAt);
  if (answerIdx < 0) return { error: "끼워 넣은 문장에 번호가 없습니다." };
  const L = "ⓐⓑⓒⓓⓔ";
  let out = "";
  let prev = 0;
  at.forEach((p, i) => {
    out += full.slice(prev, p) + `${L[i]} `;
    prev = p;
  });
  out += full.slice(prev);
  return { passageModified: out.replace(/ {2,}/g, " ").trim(), answer: answerIdx + 1 };
}

export function orderSpotFormatLine(paraphraseLead: boolean): string {
  return `- Do NOT write the passage. Return "leadInEnd": the last 3~6 words (copied exactly, with the final punctuation) of the lead-in (the opening sentence or sentences the student reads first), ${
    paraphraseLead ? `"leadIn": the lead-in paraphrased as the type rules say, ` : ""
  }"partStarts": the first 3~6 words (copied exactly) of the 2nd and 3rd parts in ORIGINAL order (the 1st part starts right after the lead-in), and "labels": the labels you give the three parts in original order, e.g. ["B","C","A"] (never ["A","B","C"]). The code builds the lead-in and (A)(B)(C) from the original text; the right order is the labels read in original order, e.g. (B)-(C)-(A). Cut only at sentence boundaries; the parts stay word for word.`;
}

export function buildOrderPassage(
  passage: string,
  leadInEnd: unknown,
  partStarts: unknown,
  labels: unknown,
  leadInText?: unknown
): { passageModified: string; answerOrder: string } | { error: string } {
  const endText = String(leadInEnd ?? "").trim();
  const endRe = looseRe(endText, false);
  const m = endRe ? endRe.exec(passage) : null;
  if (!m) return { error: `주어진 글 끝 「${endText}」를 원문에서 찾지 못했습니다.` };
  let cut0 = m.index + m[0].length;
  const tail = /^["'’”)]*[.!?]?["'’”)]*/.exec(passage.slice(cut0));
  cut0 += tail ? tail[0].length : 0;
  if (!SENT_END.test(passage.slice(0, cut0).trimEnd())) return { error: "주어진 글이 문장 끝에서 끊기지 않았습니다." };
  // 첫째 부분 머리까지 셋을 주거나 「A / B」 한 줄로 준 답도 받는다(2026-11-28 시험 5문항 중 2번)
  if (typeof partStarts === "string") partStarts = partStarts.split(/\s*[/|]\s*/).filter(Boolean);
  if (Array.isArray(partStarts) && partStarts.length === 3) partStarts = partStarts.slice(1);
  if (!Array.isArray(partStarts) || partStarts.length !== 2) return { error: "partStarts는 둘째·셋째 부분의 머리 두 개여야 합니다." };
  const p2 = findSentenceStart(passage, String(partStarts[0] ?? ""), cut0 + 1);
  const p3 = p2 >= 0 ? findSentenceStart(passage, String(partStarts[1] ?? ""), p2 + 1) : -1;
  if (p2 < 0 || p3 < 0) return { error: "둘째·셋째 부분이 시작하는 문장을 원문에서 차례대로 찾지 못했습니다." };
  const lab = Array.isArray(labels) ? labels.map((x) => String(x).replace(/[^ABC]/gi, "").toUpperCase()) : [];
  if (lab.length !== 3 || new Set(lab).size !== 3 || lab.some((x) => !/^[ABC]$/.test(x))) {
    return { error: "labels는 A·B·C를 한 번씩 쓴 세 개여야 합니다." };
  }
  if (lab.join("") === "ABC") return { error: "labels가 원래 차례 그대로(A-B-C)입니다. 섞어서 붙입니다." };
  const parts = [passage.slice(cut0, p2), passage.slice(p2, p3), passage.slice(p3)].map((x) => x.trim());
  if (parts.some((x) => !x)) return { error: "빈 부분이 있습니다." };
  const origLead = passage.slice(0, cut0).trim();
  const lead = String(leadInText ?? "").trim() || origLead;
  if (lead !== origLead) {
    /*
     * 바꿔 쓴 주어진 글이 끊은 자리 뒤 문장까지 담으면 (A)(B)(C) 첫 문장과 같은 말이 되풀이되고 순서가 드러난다
     * (2026-11-28 시험 「Her mother operated a café.」 ↔ (C) 「Her mother ran a café…」).
     */
    const words = (t: string): string[] => t.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    if (words(lead).length > words(origLead).length * 1.6 + 4) {
      return { error: "바꿔 쓴 주어진 글이 원래 주어진 글보다 너무 깁니다. 끊은 자리까지의 내용만 바꿔 씁니다." };
    }
    const leadSet = new Set(words(lead).filter((w) => !words(origLead).includes(w)));
    for (const part of parts) {
      const first = words(part.split(/(?<=[.!?]["'’”)]*)\s+/)[0] ?? "");
      const hit = first.filter((w) => leadSet.has(w)).length;
      if (first.length >= 3 && hit >= 3 && hit / first.length >= 0.3) {
        return { error: "바꿔 쓴 주어진 글에 (A)(B)(C) 한 부분의 첫 문장 내용이 들어갔습니다. 끊은 자리까지의 내용만 바꿔 씁니다." };
      }
    }
  }
  const byLabel = ["A", "B", "C"].map((L) => `(${L}) ${parts[lab.indexOf(L)]}`);
  return { passageModified: `${lead}\n\n${byLabel.join("\n\n")}`, answerOrder: lab.map((L) => `(${L})`).join("-") };
}

export function writingBlankFormatLine(wholeSentence = false): string {
  /*
   * 문법조건영작은 코드가 문장 첫머리부터 받는다 — 「절도 된다」고 써 두어 「Thanks to their efforts,」 뒤에서 시작한 빈칸이
   * 두 번씩 버려졌다(2026-11-28 시험). 지시와 검사를 맞춘다.
   */
  const span = wholeSentence
    ? "the WHOLE sentence, from its very first word (include an opening phrase such as \"Thanks to their efforts,\") to its final period"
    : "the whole sentence, or the clause from a word to the sentence end";
  return `- Do NOT write the passage. Return "blankText": the exact words of the passage that the answer sentence replaces, copied character for character (${span}). The code replaces them with ⓐ__________; everything else stays the original word for word. Remove the WHOLE target — leave no part of the answer next to the blank.`;
}
