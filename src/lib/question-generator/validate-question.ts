import { ENGLISH_SENTENCE_GAP, joinBrokenWords } from "@/lib/question-generator/text-utils";
import { grammarSwapSpots } from "@/lib/question-generator/grammar-swap";
import { VALIDATION_PASS_SCORE } from "@/lib/question-generator/constants";
import { cleanSourcePassage } from "@/lib/question-generator/passage-clean";
import type {
  GeneratedQuestionPayload,
  QuestionTypeOption,
  QuestionValidation,
} from "@/lib/question-generator/types";
import { validateVocabularyConsistency } from "@/lib/question-generator/vocabulary-consistency";
import {
  scrubWordBankNoise,
  splitWordBank,
  tokenizeAnswerPhrase,
} from "@/lib/question-generator/word-order-normalize";
import { splitSummaryAnswer } from "@/lib/question-generator/summary-blank-fit";
import { findNonVerbBankForms } from "@/lib/question-generator/verb-forms";

/** 밑줄 태그·기호·빈칸을 걷어 내고 따옴표를 통일한 본문 */
function plainText(text: string): string {
  return String(text ?? "")
    .replace(/<\/?u>/g, "")
    .replace(/<\/?b>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/[ⓐ-ⓩ①-⑳]/g, " ")
    .replace(/_{3,}/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    // 대시 꼴·띄어쓰기 통일(— – -). 모델이 「answers — regardless」를 「answers—regardless」로,
    // 「5-10」을 「5–10」으로 바꿔 와 「원문을 고쳐 썼다」로 버려졌다(2026-10-03).
    .replace(/[—–]/g, "-")
    // 원문에 눈에 안 보이는 소프트 하이픈(too-cold)이 섞여 오면 문항의 보통 하이픈과 다른 글자로 세어
    // 「원문 문장을 3개 지웠다」로 잘못 걸렸다(2026-10-04 저장 문항 수정 중).
    .replace(/\u00AD/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** 영어 문장 단위(짧은 조각은 뺀다) */
export function sentencesOf(text: string): string[] {
  return plainText(text)
    // 「U.S. who」처럼 약어 뒤에서 끊지 않는다 — 문장 하나를 둘로 세어 「2개 지웠다」고 잘못 걸렸다
    .split(ENGLISH_SENTENCE_GAP)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

function wordCount(text: string): number {
  return plainText(text).split(/\s+/).filter(Boolean).length;
}

/** 지문에서 낱말만 뽑아 센다(밑줄 기호·문장부호는 뺀다) */
function passageWords(text: string): string[] {
  return (text || "")
    .replace(/<\/?u>/g, " ")
    .replace(/[ⓐ-ⓩ①-⑳]/g, " ")
    .toLowerCase()
    .replace(/[^a-z' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 어법·어휘는 지문을 다시 쓰면 안 된다(선생님 지적 2026-09-20: "어법 개수가 지문을 재진술한다").
 * 밑줄 자리의 낱말만 바뀌어야 하므로, 원문 낱말이 그대로 남은 비율로 가린다.
 * 재진술을 켜고 만든 문항은 이 검사를 건너뛴다.
 */
export function passageKeptRatio(original: string, modified: string): number {
  const a = passageWords(original);
  const b = passageWords(modified);
  if (a.length < 20 || b.length < 20) return 1;
  const bag = new Map<string, number>();
  for (const w of a) bag.set(w, (bag.get(w) ?? 0) + 1);
  let same = 0;
  for (const w of b) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      same++;
      bag.set(w, n - 1);
    }
  }
  return same / b.length;
}

/** 어법·어휘에서 지문을 그대로 두었다고 볼 최저선(밑줄 6곳이 바뀌어도 넘는 값) */
export const PASSAGE_KEEP_MIN = 0.9;

/**
 * 어법·어휘: 밑줄 밖 원문이 빠졌거나 바뀌었는지.
 *
 * 2026-10-11 점검(72문항)에서 어법개수 하나가 「Rooms have their own "sound" because they impose
 * their own characteristics」의 가운데 일곱 낱말을 지우고 「Rooms have ⓐtheirs characteristics」로 냈다.
 * 낱말 주머니(90%)·밑줄 속 대조·문장 수 어느 것으로도 안 잡혔다. 밑줄 바깥 낱말 덩어리가 원문에
 * 차례대로 이어 나오는지 보고, 밑줄 자리에서만 (밑줄 낱말 수 + 3)까지 건너뛰게 한다.
 * 걸리면 빠진·바뀐 자리 앞 낱말을 돌려준다.
 */
export function underlineOutsideProblem(original: string, modified: string): string | null {
  // 원문의 깨진 낱말(「t he」)은 문항에서 붙여 낸다 — 같은 손질을 한 뒤 견준다
  const words = (t: string) =>
    joinBrokenWords(plainText(t))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean)
      // 어휘에서 낱말을 바꾸면 앞 관사도 맞춰 바꾼다(a below → an above) — 같은 것으로 본다
      .map((w) => (w === "an" ? "a" : w));
  const src = words(original);
  if (src.length < 20 || !/<u>/i.test(modified)) return null;
  // 밑줄 밖 덩어리와 밑줄(낱말 수)을 번갈아 늘어놓는다
  const parts = String(modified).split(/<u>([\s\S]*?)<\/u>/i);
  let pos = 0;
  // 지문 첫머리: 원문 앞에 붙은 단원 제목(「Dark Patterns: Deception or …」)은 문항이 빼고 낸다
  let skip = 20;
  for (let k = 0; k < parts.length; k++) {
    if (k % 2 === 1) {
      skip = words(parts[k] ?? "").length + 3;
      pos = Math.min(pos, src.length);
      continue;
    }
    const run = words(parts[k] ?? "");
    if (!run.length) continue;
    let found = -1;
    for (let j = pos; j <= Math.min(pos + skip, src.length - run.length); j++) {
      let ok = true;
      for (let t = 0; t < run.length; t++) {
        if (src[j + t] !== run[t]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      // 가장 길게 맞는 자리에서 어긋나기 시작한 낱말을 보여 준다
      let best = 0;
      for (let j = pos; j <= Math.min(pos + skip, src.length - 1); j++) {
        let t = 0;
        while (t < run.length && src[j + t] === run[t]) t++;
        best = Math.max(best, t);
      }
      return run.slice(Math.max(0, best - 2), best + 4).join(" ");
    }
    pos = found + run.length;
    skip = 0;
  }
  return null;
}

/** 낱말·숫자만 남겨 붙인다 — 문장부호·따옴표·대소문자·띄어쓰기 차이는 고친 것으로 치지 않는다 */
function squashText(text: string): string {
  return plainText(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 「지문 바꿔 쓰기」를 끈 작업은 어느 유형이든 지문이 원문 그대로여야 한다(선생님 승인 2026-10-06).
 *
 * 원문 대조가 어법·어휘·문장삽입에만 걸려 있어서, 끈 작업에서도 무관한문장이 「Just like how」를
 * 「Just as」로 바꾸고 두 문장을 because로 합쳤고, 순서추론은 주어진 글 첫 문장을 바꿔 쓰고,
 * 빈칸추론은 「and in drawings」를 「and drawings」로 고쳤다(10-06 작업 대조).
 *
 * 유형이 정당하게 바꾸는 자리 — 빈칸, (A)(B)(C) 이름표, 번호 ①~⑤·ⓐ~ⓔ, 밑줄, 빼낸 삽입 문장,
 * 끼워 넣은 무관한 문장 — 에서 지문을 끊고, 끊긴 조각 하나하나가 원문에 글자 그대로 있는지 본다.
 * 빈칸 문장도 빈칸 밖 낱말은 원문 그대로여야 한다. 원문 문장이 통째로 빠졌는지도 센다(빈칸이 비운 문장,
 * 무관한 문장과 바꿔 낸 한 문장만 빠질 수 있다).
 * 어법·어휘와 지칭·특정표현은 위·아래에 따로 대조가 있어 여기서 보지 않는다.
 */
export function passageRewriteProblem(opts: {
  passage: string;
  option: QuestionTypeOption;
  question: GeneratedQuestionPayload;
}): string | null {
  const { option, question: q } = opts;
  const code = option.aingkaCode ?? "";
  if (option.type === "grammar" || option.type === "vocabulary") return null;
  if (/지칭대명사서술|특정표현의미서술/.test(code)) return null;
  const modified = String(q.passageModified ?? "");
  if (!modified.trim()) return null;

  const CUT = "\u0000";
  let body = modified.replace(/<\/?[ub]>/gi, "").replace(/\*\*/g, "");
  // 무관한문장: 정답 번호 뒤 한 문장은 새로 넣은 문장이라 대조에서 뺀다
  if (option.type === "irrelevant_sentence") {
    const no = Number(q.correctAnswer);
    const at = Number.isInteger(no) && no >= 1 && no <= 5
      ? [...body.matchAll(/[①-⑤ⓐ-ⓔ]/g)].find((m) => "①②③④⑤".indexOf(m[0]) + 1 === no || "ⓐⓑⓒⓓⓔ".indexOf(m[0]) + 1 === no)
      : undefined;
    if (!at) return null;
    const start = at.index! + 1;
    const rest = body.slice(start);
    const nextMark = rest.search(/[①-⑤ⓐ-ⓔ]/);
    const span = nextMark >= 0 ? rest.slice(0, nextMark) : rest;
    const end = span.match(/^[\s\S]*?[.!?]["'”’)]*(?=\s|$)/)?.[0].length ?? span.length;
    body = body.slice(0, start) + CUT + body.slice(start + end);
  }
  // 순서추론 상은 지시문을 바꿔 쓴다(선생님 결정 2026-10-06) — (A) 앞 지시문은 대조에서 뺀다
  const leadInParaphrased = option.type === "order" && option.difficulty === "high";
  if (leadInParaphrased) {
    const first = body.search(/\(\s*A\s*\)/);
    if (first > 0) body = body.slice(first);
  }
  // 빈칸 수 — 연결어빈칸은 밑줄 없이 (A)(B) 이름표만 연결어 자리에 둔다
  const blanks =
    (body.match(/_{3,}/g) ?? []).length +
    (option.type === "sentence_blank" && !/_{3,}/.test(body) ? (body.match(/\(\s*[A-E]\s*\)/g) ?? []).length : 0);
  const pieces = body
    .replace(/_{3,}/g, CUT)
    .replace(/[ⓐ-ⓩ①-⑳]/g, CUT)
    .replace(/\(\s*[A-E]\s*\)/g, CUT)
    .split(CUT)
    .filter((p) => squashText(p).length > 0);
  const original = squashText(opts.passage);
  if (!original) return null;

  for (const piece of pieces) {
    if (original.includes(squashText(piece))) continue;
    // 어느 문장이 바뀌었는지 보여 준다(조각 안 문장들은 원문에 있는데 이어 붙인 것이 다르면 조각 머리)
    const sentence =
      piece
        .split(/(?<=[.!?]["'”’)]?)\s+/)
        .find((s) => squashText(s) && !original.includes(squashText(s))) ?? piece;
    return `지문을 고쳐 썼습니다: "${plainText(sentence).slice(0, 50)}…". 지문 바꿔 쓰기를 끈 작업은 원문 그대로 둡니다.`;
  }
  const given = option.type === "sentence_insertion" ? String(q.questionText ?? "") : "";
  if (given.trim() && !original.includes(squashText(given))) {
    return "주어진 문장을 원문과 다르게 고쳐 썼습니다. 지문 바꿔 쓰기를 끈 작업은 원문 문장을 그대로 뺍니다.";
  }

  // 원문 문장이 빠졌는지 — 조각 하나에 있거나, 번호로 끊긴 문장이면 조각을 차례로 이은 데 있으면 된다
  const hay = [...pieces.map(squashText), pieces.map(squashText).join(""), squashText(given)].filter(Boolean);
  let missing = sentencesOf(opts.passage).filter((s) => !hay.some((h) => h.includes(squashText(s))));
  // 순서추론 상: 바꿔 쓴 지시문 자리(원문 첫머리에 이어진 문장들)는 빠진 것으로 치지 않는다
  if (leadInParaphrased) {
    const all = sentencesOf(opts.passage);
    let lead = 0;
    while (lead < all.length && missing.includes(all[lead]!)) lead++;
    missing = missing.filter((s) => !all.slice(0, lead).includes(s));
  }
  const allowed = blanks + (option.type === "irrelevant_sentence" ? 1 : 0);
  if (missing.length > allowed) {
    return `원문 문장을 ${missing.length - allowed}개 지웠습니다("${missing[0]!.slice(0, 40)}…"). 지문 바꿔 쓰기를 끈 작업은 원문 문장을 지우거나 합치지 않습니다.`;
  }
  return null;
}

/** 로컬 형태 검수만 (AI 검수 호출 없음 — 속도 우선) */
export function validateGeneratedQuestion(opts: {
  passage: string;
  option: QuestionTypeOption;
  question: GeneratedQuestionPayload;
  /** 지문 재진술을 켜고 만든 문항이면 원문 대조를 건너뛴다 */
  allowParaphrase?: boolean;
}): QuestionValidation {
  /*
   * 만들 때는 손질한 지문(cleanSourcePassage)을 쓰는데 대조는 날것으로 했다. 그래서
   * 원문을 그대로 쓴 문항도 「원문을 고쳐 썼다」「문장 2개를 지웠다」로 걸려 버려졌다
   * (2026-10-03 288문항 작업). 대조도 같은 지문으로 한다.
   */
  opts = { ...opts, passage: cleanSourcePassage(opts.passage) };
  const q = opts.question;
  const option = opts.option;
  const warnings: string[] = [];
  let score = 100;

  if (option.isObjective) {
    const slotInPassage =
      option.type === "sentence_insertion" ||
      option.type === "irrelevant_sentence" ||
      (option.type === "vocabulary" && option.aingkaCode === "어휘추론") ||
      // 어법 추론: 밑줄 ①~⑤가 지문 안에 있고 아래 보기는 없다
      (option.type === "grammar" &&
        (option.aingkaCode === "어법추론" || option.aingkaCode === "어법모두고르기"));

    if (slotInPassage) {
      if (option.type === "grammar") {
        const marks = (q.passageModified ?? "").match(/[①②③④⑤ⓐⓑⓒⓓⓔ]/g) ?? [];
        if (new Set(marks).size < 5) {
          warnings.push("지문에 밑줄 번호 5개가 없습니다.");
          score -= 40;
        }
      }
      if (
        option.type === "sentence_insertion" &&
        !(q.questionText || "").trim()
      ) {
        warnings.push("주어진 문장이 없습니다.");
        score -= 40;
      }
    } else if (!q.choices || q.choices.length !== 5) {
      warnings.push("선택지 개수가 5개가 아닙니다.");
      score -= 40;
    }

    const nums = new Set((q.choices ?? []).map((c) => c.number));
    if (!slotInPassage && nums.size !== (q.choices?.length ?? 0)) {
      warnings.push("선택지 번호가 중복되었습니다.");
      score -= 15;
    }
    if (!slotInPassage) {
      const empty = (q.choices ?? []).some((c) => !c.text.trim());
      if (empty) {
        warnings.push("빈 선택지가 있습니다.");
        score -= 20;
      }
    }

    // 개수형: 1개~5개 고정 검증
    if (
      (option.type === "grammar" && option.aingkaCode === "어법개수") ||
      (option.type === "vocabulary" && option.aingkaCode === "어휘개수")
    ) {
      const texts = (q.choices ?? []).map((c) => c.text.trim());
      if (texts.join("|") !== "1개|2개|3개|4개|5개") {
        warnings.push("개수 보기가 1개~5개 형식이 아닙니다.");
        score -= 40;
      }
    }
  }

  // 어법·어휘: 밑줄 자리 말고 지문을 고쳐 쓰면 버린다
  if (
    !opts.allowParaphrase &&
    (option.type === "grammar" || option.type === "vocabulary") &&
    (q.passageModified ?? "").trim()
  ) {
    const kept = passageKeptRatio(opts.passage, q.passageModified ?? "");
    if (kept < PASSAGE_KEEP_MIN) {
      warnings.push(`지문을 고쳐 썼습니다(원문 유지 ${Math.round(kept * 100)}%). 원문 그대로 다시 만듭니다.`);
      score -= 45;
    } else {
      /*
       * 낱말 주머니 90%로는 못 잡는 것이 있다(100문항 대조 2026-10-02).
       * 170낱말 지문에 12낱말짜리 가정법 문장을 새로 끼워 넣어도 93%라 통과했고,
       * 원문 한 절을 14낱말짜리 구문으로 바꿔 밑줄을 쳐도 통과했다.
       * 밑줄 하나하나를 원문과 견주고, 문장 수가 늘었는지 본다.
       */
      const original = plainText(opts.passage);
      const foreign = [...String(q.passageModified).matchAll(/<u>([\s\S]*?)<\/u>/g)]
        .map((m) => plainText(m[1] ?? ""))
        // 여섯 낱말부터 잡는다 — 「keep their children mildly supervise」(목적격보어, 다섯 낱말)는 정상이었다
        .filter((u) => u && !original.includes(u) && wordCount(u) > 5);
      if (foreign.length > 0) {
        warnings.push(
          `밑줄이 원문과 다르게 길게 고쳐졌습니다: "${foreign[0]!.slice(0, 40)}". 원문 낱말 한두 개만 바꿔야 합니다.`
        );
        score -= 45;
      } else if (sentencesOf(q.passageModified ?? "").length > sentencesOf(opts.passage).length) {
        warnings.push("원문에 없는 문장을 지문에 넣었습니다. 원문 문장 안에서만 밑줄을 쳐야 합니다.");
        score -= 45;
      } else {
        const at = underlineOutsideProblem(opts.passage, q.passageModified ?? "");
        if (at) {
          warnings.push(`밑줄 밖 원문이 빠졌거나 바뀌었습니다(「${at}」 근처). 밑줄 자리 말고는 원문 그대로 둡니다.`);
          score -= 45;
        }
      }
    }
  }

  /*
   * 어법·어휘 바꿔 쓰기 켬: 문장 안은 바꿔 써도 문장 수는 원문과 같아야 한다.
   * 프롬프트로만 막았더니 어휘추론에서 「You gradually slow down.」이 빠져
   * 「What happens?」 뒤 흐름이 끊겼다(10-14 점검).
   */
  if (
    opts.allowParaphrase &&
    (option.type === "grammar" || option.type === "vocabulary") &&
    // 어법문장오류수정은 문장 다섯을 골라 내는 유형이라 원래 줄어든다
    option.aingkaCode !== "어법문장오류수정" &&
    (q.passageModified ?? "").trim()
  ) {
    const origN = sentencesOf(opts.passage).length;
    const modN = sentencesOf(q.passageModified ?? "").length;
    if (modN < origN) {
      warnings.push(`원문 문장 ${origN - modN}개가 빠졌거나 합쳐졌습니다. 바꿔 쓰더라도 문장 수와 차례는 원문 그대로 둡니다.`);
      score -= 45;
    }
  }

  // 나머지 유형: 바꿔 쓰기를 끈 작업은 유형이 바꾸는 자리 말고 지문을 원문 그대로 둔다
  if (!opts.allowParaphrase) {
    const rewritten = passageRewriteProblem(opts);
    if (rewritten) {
      warnings.push(rewritten);
      score -= 45;
    }
  }

  /*
   * 아래 넷은 100문항 대조(2026-10-02)에서 검수기가 못 잡던 꼴이다.
   */
  const modifiedText = String(q.passageModified ?? "");
  const code = option.aingkaCode ?? "";
  const answerStr = typeof q.correctAnswer === "string" ? q.correctAnswer : "";

  /*
   * 빈칸추론: 정답 보기가 빈칸 뒤(또는 앞)에 그대로 남아 있으면 답이 드러난다.
   * 2026-10-03 전수 대조에서 정수학원 문항 둘(#2410·#5186)이 이랬다.
   */
  if (option.type === "sentence_blank" && modifiedText && Array.isArray(q.choices)) {
    const keyed = q.choices.find((c) => Number(c.number) === Number(q.correctAnswer));
    const ans = plainText(String(keyed?.text ?? "")).toLowerCase().replace(/[.!?]+$/, "");
    if (ans.split(/\s+/).length >= 5 && plainText(modifiedText).toLowerCase().includes(ans)) {
      warnings.push("빈칸 정답이 지문에 그대로 남아 있습니다. 답이 드러납니다.");
      score -= 45;
    }
  }

  // 빈칸추론: 원문 문장을 비운 것이 아니라 새 문장을 끼워 넣음 (#23·#72)
  if (option.type === "sentence_blank" && code !== "연결어빈칸" && /_{3,}/.test(modifiedText)) {
    const modPlain = plainText(modifiedText);
    const removed = sentencesOf(opts.passage).filter((s) => !modPlain.includes(s));
    if (removed.length === 0) {
      warnings.push("원문 문장을 비우지 않고 새 문장을 끼워 넣었습니다. 원문 문장 하나를 빈칸으로 바꿔야 합니다.");
      score -= 45;
    }
  }

  // 문장삽입: 번호 두 개 사이에 문장이 없어 같은 자리가 됨 (#98 「③ ④ If hip-hop…」)
  if (option.type === "sentence_insertion" && modifiedText) {
    const segments = modifiedText.replace(/<\/?u>/g, "").split(/[①②③④⑤]/);
    if (segments.length >= 3) {
      const between = segments.slice(1, -1);
      const empty = between.findIndex((s) => wordCount(s) < 3);
      if (empty >= 0) {
        const marks = "①②③④⑤";
        warnings.push(`삽입 자리 ${marks[empty]}과 ${marks[empty + 1]} 사이에 문장이 없습니다. 자리마다 문장이 있어야 합니다.`);
        score -= 45;
      }
    }
  }

  // 요약문 2·3단어: ⓐ 말고 다른 빈칸은 1~2단어여야 한다 (#74 「expand their territory」)
  if (option.type === "summary_short" && /요약문빈칸[23]단어$/.test(code) && answerStr) {
    for (const m of answerStr.matchAll(/([ⓑ-ⓔ])\s*[:：]\s*([^/]+)/g)) {
      const n = wordCount(m[2] ?? "");
      if (n > 2) {
        warnings.push(`${m[1]} 답이 ${n}단어입니다. ⓐ 말고 다른 빈칸은 본문 1~2단어여야 합니다.`);
        score -= 45;
        break;
      }
    }
  }

  // 제시어 배열·지정 문법 영작: 원문 문장을 하나만 비워야 한다 (#82는 두 문장을 지웠다).
  // 조건 영작은 그 한 문장을 고쳐 써서 내므로 하나가 빠지는 것은 정상이다. 둘 이상 지우면 앞뒤를 가리키는
  // 말(These changes…)이 대상을 잃는다(2026-10-03 전수 대조: 윌링어학원 영작 5개).
  if (/제시어배열|문법조건영작/.test(code) && /_{3,}/.test(modifiedText)) {
    const modPlain = plainText(modifiedText);
    const removed = sentencesOf(opts.passage).filter((s) => !modPlain.includes(s));
    if (removed.length >= 2) {
      warnings.push(`원문 문장을 ${removed.length}개 지웠습니다. 빈칸으로 비울 문장 하나만 지워야 합니다.`);
      score -= 45;
    }
  }

  /*
   * 요약표: 빈칸 (A)(B)(C)는 표 안에서 차례대로 나와야 한다. (A)→(C)→(B)로 섞인 표가 있었다
   * (2026-10-03 전수 대조 #1000).
   */
  if (/요약표/.test(code)) {
    const labels = [...String(q.questionText ?? "").matchAll(/\(([A-E])\)/g)].map((m) => m[1]!);
    const firsts = labels.filter((l, i) => labels.indexOf(l) === i);
    if (firsts.length >= 2 && firsts.join("") !== "ABCDE".slice(0, firsts.length)) {
      warnings.push(`표 빈칸이 ${firsts.map((l) => `(${l})`).join("→")} 차례로 나옵니다. (A)(B)(C) 차례여야 합니다.`);
      score -= 45;
    }
  }

  /*
   * 개수형(어법개수): 해설이 「어색한 것은 ⓐ, ⓓ이다」로 짚은 수와 정답 개수가 같아야 한다.
   * 정답 5개인데 해설은 넷을 짚은 문항이 있었다(2026-10-03 전수 대조 #6082·#6090).
   */
  if (code === "어법개수") {
    const listed = String(q.explanation ?? "").match(/어색한\s*것은\s*((?:[ⓐ-ⓕ][\s,·와과및]*)+)/);
    const n = Number(q.correctAnswer);
    if (listed && Number.isInteger(n)) {
      const marks = new Set([...listed[1]!.matchAll(/[ⓐ-ⓕ]/g)].map((m) => m[0]));
      if (marks.size > 0 && marks.size !== n) {
        warnings.push(`해설이 틀린 곳을 ${marks.size}개 짚었는데 정답은 ${n}개입니다.`);
        score -= 45;
      }
    }
  }

  // 어형변화: 보기가 정답 꼴 그대로면 바꿀 어형이 없다 (#37 aren't·is가 보기에 그대로)
  if (code === "제시어배열어형변화") {
    const bankLine = (q.questionText ?? "").match(/<보기>\s*\n?([^\n]+)/)?.[1] ?? "";
    const bank = splitWordBank(scrubWordBankNoise(bankLine)).map((t) => t.toLowerCase());
    const answerTokens = tokenizeAnswerPhrase(String(q.correctAnswer ?? "")).map((t) => t.toLowerCase());
    if (bank.length > 0 && bank.length === answerTokens.length) {
      const sorted = (a: string[]) => [...a].sort().join("\u0001");
      if (sorted(bank) === sorted(answerTokens)) {
        warnings.push("어형변화 유형인데 보기가 정답 꼴 그대로라 바꿀 어형이 없습니다. 보기는 원형으로 주어야 합니다.");
        score -= 45;
      }
    }
  }

  /*
   * 어형변화는 동사만 한다(선생님 결정 2026-10-24). 보기의 동사는 원형(be동사는 be)으로 주고
   * 명사·형용사·부사는 정답에 쓰인 꼴 그대로 둔다(apples는 apples, better는 better).
   * 보기 낱말이 정답에 그대로 없고 동사 어형으로도 읽히지 않는 꼴(명사 복수·비교급·최상급·-ly)로만
   * 바뀌었으면 명사·형용사를 원형으로 준 것이다. -s로만 다른 짝은 정답 문장에서 분명한 명사 자리
   * (관사·소유격·전치사·형용사 뒤, 복수 be·조동사 앞)일 때만 센다. 자세한 규칙은 verb-forms.ts.
   */
  if (
    code === "요약문빈칸영작" ||
    code === "제시어배열어형변화" ||
    code === "문법조건영작" ||
    code === "제시어배열기본" ||
    code === "제시어배열단어추가"
  ) {
    const qt = String(q.questionText ?? "");
    const bankLine = qt.match(/<보기>\s*\n?([^\n]+)/)?.[1] ?? "";
    const bank = splitWordBank(scrubWordBankNoise(bankLine));
    let answerTokens: string[] = [];
    if (code === "요약문빈칸영작") {
      // 빈칸을 채운 요약문 전체로 본다 — 빈칸 앞뒤 말(the·their)이 명사 자리를 알려 준다
      const summary = qt.match(/<요약문>\s*\n?([\s\S]*?)$/)?.[1]?.trim() ?? "";
      const byMark = splitSummaryAnswer(answerStr);
      if (summary && byMark.size > 0) {
        let filled = summary;
        for (const [mark, phrase] of byMark) {
          filled = filled.replace(new RegExp(`${mark}\\s*_+`, "g"), ` ${phrase} `);
        }
        answerTokens = tokenizeAnswerPhrase(filled);
      } else {
        answerTokens = tokenizeAnswerPhrase(
          answerStr.replace(/[ⓐ-ⓔ]\s*[:：]?/g, " ").replace(/\s*\/\s*/g, " ")
        );
      }
    } else {
      answerTokens = tokenizeAnswerPhrase(answerStr);
    }
    if (bank.length > 0 && answerTokens.length > 0) {
      const issues = findNonVerbBankForms(bank, answerTokens);
      if (issues.length > 0) {
        const first = issues[0]!;
        warnings.push(
          `보기 「${first.bank}」이 정답에 「${first.answer}」로 쓰였습니다. 어형변화는 동사만 하므로 명사·형용사·부사는 정답 꼴 그대로 줘야 합니다.`
        );
        score -= 45;
      } else if (code === "제시어배열기본") {
        // 기본은 어형을 바꾸지 않으므로 보기 낱말이 정답에 그대로 있어야 한다(선생님 2026-10-24)
        const have = new Set(answerTokens.map((t) => t.toLowerCase()));
        const off = bank.find((b) => !have.has(b.toLowerCase()));
        if (off) {
          warnings.push(`보기 「${off}」이 정답에 그대로 없습니다. 제시어 배열 기본은 보기를 정답 꼴 그대로 줍니다.`);
          score -= 45;
        }
      }
    }
  }

  /*
   * 아래는 382문항 전수 대조(2026-10-02, 선생님이 새로 만든 작업)에서 나온 꼴이다.
   */
  const originalPlain = plainText(opts.passage);

  // 문장삽입: 번호가 문장 중간에 찍힘(#46 「leaves, ④ chew them」), 하 난이도인데 원문에 없는 문장을 넣음(#145)
  if (option.type === "sentence_insertion" && modifiedText) {
    const body = modifiedText.replace(/<\/?[ub]>/gi, "");
    const midSentence = [...body.matchAll(/[①②③④⑤]/g)].find((m) => {
      const before = body.slice(0, m.index).replace(/\s+$/, "");
      if (!before) return false;
      return !/[.!?]["'’”)]*$/.test(before);
    });
    if (midSentence) {
      warnings.push(`삽입 자리 ${midSentence[0]}가 문장 중간에 있습니다. 번호는 문장과 문장 사이에만 둡니다.`);
      score -= 45;
    } else if (!opts.allowParaphrase && option.difficulty === "low") {
      const origN = sentencesOf(opts.passage).length;
      const modN = sentencesOf(modifiedText).length;
      if (origN >= 3 && modN > origN - 1) {
        warnings.push("원문에 없는 문장을 지문에 넣었습니다. 주어진 문장만 빼고 나머지는 원문 그대로 둡니다.");
        score -= 45;
      }
    }
  }

  // 어법 문장 수정: 정답으로 적은 번호의 문장이 원문과 같다 = 오류를 심지 않았다 (#124 「정답을 구성할 수 없다」, #219 번호 밀림)
  if (code === "어법문장오류수정" && !opts.allowParaphrase && modifiedText && answerStr) {
    const body = modifiedText.replace(/<\/?[ub]>/gi, "");
    const segments = new Map<string, string>();
    const parts = body.split(/([①②③④⑤])/);
    for (let i = 1; i < parts.length; i += 2) segments.set(parts[i]!, plainText(parts[i + 1] ?? ""));
    for (const m of answerStr.matchAll(/([①②③④⑤])\s*[:：]/g)) {
      const seg = segments.get(m[1]!);
      if (seg && seg.length > 10 && originalPlain.includes(seg)) {
        warnings.push(`정답 ${m[1]}의 문장이 원문과 같습니다. 그 문장에 틀린 곳이 없습니다.`);
        score -= 45;
        break;
      }
    }
  }

  /*
   * 번호 하나가 문장 여럿을 묶을 때, 고친 곳이 번호 없는 뒤 문장에 들어가면 학생은
   * 「① 문장」이 어느 것인지 알 수 없다. 288문항 작업 #27·#114가 이랬다(2026-10-03).
   * 번호 뒤 첫 문장 말고는 원문 그대로여야 한다.
   */
  if (code === "어법문장오류수정" && !opts.allowParaphrase && modifiedText) {
    const body = modifiedText.replace(/<\/?[ub]>/gi, "");
    const parts = body.split(/([①②③④⑤])/);
    for (let i = 1; i < parts.length; i += 2) {
      const rest = sentencesOf(parts[i + 1] ?? "").slice(1);
      const changed = rest.find((s) => !originalPlain.includes(s));
      if (changed) {
        warnings.push(`${parts[i]} 뒤 번호 없는 문장을 고쳤습니다("${changed.slice(0, 40)}…"). 틀린 곳은 번호가 붙은 문장에 둡니다.`);
        score -= 45;
        break;
      }
    }
  }

  // 어법 수정 2·3: 밑줄 수가 발문(ⓐ~ⓔ / ⓐ~ⓖ)과 다름 (#220 7개, #221 5개)
  if (code === "어법오류수정2" || code === "어법오류수정3") {
    const n = (modifiedText.match(/<u>/gi) ?? []).length;
    const need = code === "어법오류수정2" ? 5 : 7;
    if (n > 0 && n !== need) {
      warnings.push(`밑줄이 ${n}개입니다. ${code === "어법오류수정2" ? "ⓐ~ⓔ 다섯" : "ⓐ~ⓖ 일곱"} 개여야 합니다.`);
      score -= 45;
    }
  }

  /*
   * 밑줄마다 앞뒤 두 낱말을 붙여 원문과 견준다. 바뀐 밑줄의 자리와 수가 정답과 맞아야 한다.
   *  - 어법추론·어휘추론: 바뀐 밑줄이 하나뿐이고 그 번호가 정답 (#224는 ④를 바꾸고 정답을 3이라 했다)
   *  - 어법개수·어휘개수: 바뀐 밑줄 수 = 정답 개수
   * 바뀐 낱말이 지문 다른 곳에 우연히 있어도 앞뒤 낱말까지 보면 가려진다.
   */
  if (
    !opts.allowParaphrase &&
    (option.type === "grammar" || option.type === "vocabulary") &&
    /(어법추론|어휘추론|어법개수|어휘개수)$/.test(code) &&
    modifiedText
  ) {
    const windows = [...modifiedText.matchAll(
      /((?:[A-Za-z’'-]+[\s,;:]+){0,2})(?:[ⓐ-ⓖ①-⑤]\s*)?<u>([\s\S]*?)<\/u>((?:[\s,;:]+[A-Za-z’'-]+){0,2})/g
    )];
    const changed = windows
      .map((m, i) => ({ i, text: plainText(`${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`) }))
      .filter((w) => w.text && !originalPlain.includes(w.text));
    const no = Number(q.correctAnswer);
    if (/추론$/.test(code) && windows.length >= 4) {
      if (changed.length !== 1) {
        warnings.push(`원문과 다른 밑줄이 ${changed.length}개입니다. 하나만 바꿔야 합니다.`);
        score -= 45;
      } else if (Number.isFinite(no) && changed[0]!.i + 1 !== no) {
        warnings.push(`바뀐 밑줄은 ${changed[0]!.i + 1}번인데 정답은 ${no}번입니다.`);
        score -= 45;
      }
    } else if (/개수$/.test(code) && windows.length >= 4 && Number.isFinite(no) && changed.length !== no) {
      warnings.push(`원문과 다른 밑줄이 ${changed.length}개인데 정답은 ${no}개입니다.`);
      score -= 45;
    }
    /*
     * 밑줄 둘이 붙어 있으면(사이 0~1낱말) 어느 쪽을 고쳐도 말이 돼 답이 둘로 읽힌다 —
     * 2026-10-11 점검 「②enhance the ③unreliability」(정답 ③, ②를 reduce로 고쳐도 통함). 저장 374개 중 11개.
     */
    if (option.type === "vocabulary") {
      const gaps = [...modifiedText.replace(/[ⓐ-ⓩ①-⑳]/g, "").matchAll(/<\/u>([^<]*)<u>/g)].map(
        (g) => (g[1] ?? "").split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length
      );
      if (gaps.some((n) => n <= 1)) {
        warnings.push("어휘 밑줄 둘이 붙어 있습니다(사이 한 낱말 이하). 어느 쪽이 틀렸는지 갈리지 않게 두 낱말 이상 띄웁니다.");
        score -= 45;
      }
    }
    // 어휘는 낱말 하나를 바꾸는 유형이다 — 「carry away from the nest」처럼 구를 통째로 바꾸면 어휘 문항이 아니다 (#86)
    if (option.type === "vocabulary") {
      const long = windows.find((m) => wordCount(m[2] ?? "") > 2);
      if (long) {
        warnings.push(`어휘 밑줄 "${plainText(long[2] ?? "").slice(0, 30)}"이 세 낱말 넘습니다. 낱말 하나(많아야 둘)만 밑줄 칩니다.`);
        score -= 45;
      }
    }
  }

  /*
   * 어법 오류는 원문 낱말의 형태를 바꿔 만든다 — 다른 낱말로 갈아 끼우면 고쳐도 원문이 되지 않는다(7차 시험 without → tried).
   * 원래 위 블록(추론·개수, 바꿔 쓰기 끔) 안에만 있어서, 2026-10-07 점검에서 어법오류수정3의 do → make,
   * 바꿔 쓰기 켠 작업의 whom → it·fiercely → hardly가 그대로 나갔다. 앞뒤 낱말이 원문과 맞는 자리만 보므로
   * 바꿔 쓴 지문에서도 엉뚱한 자리를 잡지 않는다.
   */
  if (option.type === "grammar" && modifiedText) {
    /*
     * 바꿔 쓰기를 켜면 모델이 구를 고쳐 「find difficult to」·「look forward to give」 같은 정식 어법 자리를
     * 만든다. 그때는 낱말 하나를 다른 낱말로 바꾼 것(whom → it, fiercely → hardly)만 본다.
     */
    const one = (t: string) => t.trim().split(/\s+/).length === 1;
    const swapped = grammarSwapSpots(String(opts.passage ?? ""), modifiedText).filter(
      (x) => !opts.allowParaphrase || (one(x.original) && one(x.underlined))
    );
    if (swapped.length) {
      warnings.push(
        `원문 「${swapped[0]!.original}」을 다른 낱말 「${swapped[0]!.underlined}」로 바꿨습니다. 어법 오류는 원문 낱말의 형태만 바꿔 만듭니다.`
      );
      score -= 45;
    }
  }

  /*
   * 202문항 대조(2026-10-02, 두 번째 새 작업)에서 나온 꼴.
   */
  // 어법 수정 2·3: 정답으로 적은 밑줄이 원문과 같다(#6은 원문의 in을 틀렸다 했고, #141은 원문의 takes를 정답에 넣었다)
  if (!opts.allowParaphrase && (code === "어법오류수정2" || code === "어법오류수정3") && modifiedText && answerStr) {
    const uls = [...modifiedText.matchAll(
      /((?:[A-Za-z’'-]+[\s,;:]+){0,2})([ⓐ-ⓖ])\s*<u>([\s\S]*?)<\/u>((?:[\s,;:]+[A-Za-z’'-]+){0,2})/g
    )];
    const unchanged = new Set(
      uls.filter((m) => originalPlain.includes(plainText(`${m[1] ?? ""}${m[3] ?? ""}${m[4] ?? ""}`))).map((m) => m[2]!)
    );
    const inside = new Map(uls.map((m) => [m[2]!, plainText(m[3] ?? "").toLowerCase()]));
    for (const m of answerStr.matchAll(/([ⓐ-ⓖ])\s*[:：]\s*([^/]+)/g)) {
      if (unchanged.has(m[1]!)) {
        warnings.push(`정답 ${m[1]}의 밑줄이 원문과 같습니다. 틀린 곳이 아닙니다.`);
        score -= 45;
        break;
      }
      if (inside.get(m[1]!) === plainText(m[2] ?? "").toLowerCase()) {
        warnings.push(`정답 ${m[1]}의 고친 꼴이 밑줄과 같습니다.`);
        score -= 45;
        break;
      }
      /*
       * 고친 꼴을 제자리에 넣으면 원문이 돌아와야 한다. 원문 낱말을 다른 낱말로 바꿔 넣거나
       * 없던 낱말을 끼우면(resilient → resiliently) 맞는 고침이 여럿 생긴다
       * (정수학원 193문항 #B11, 2026-10-04 — 10/2 이후 문항 40개 중 이 하나만 걸렸다).
       */
      const ul = uls.find((u) => u[2] === m[1]);
      const fix = String(m[2] ?? "").replace(/.*(?:→|->|⇒)\s*/, "").trim();
      if (ul && fix) {
        const restored = [`${ul[1] ?? ""}${fix}${ul[4] ?? ""}`, `${fix}${ul[4] ?? ""}`, `${ul[1] ?? ""}${fix}`].map(plainText);
        if (!restored.some((r) => originalPlain.includes(r))) {
          warnings.push(`정답 ${m[1]}을 「${fix}」로 고쳐도 원문이 되지 않습니다. 원문 낱말의 형태만 바꿔 오류를 만듭니다.`);
          score -= 45;
          break;
        }
      }
    }
  }

  // 어법 문장 수정: 번호는 문장 앞에만 (#4 「② While painting these works, ③ Pollock …」)
  if (code === "어법문장오류수정" && modifiedText) {
    const body = modifiedText.replace(/<\/?[ub]>/gi, "");
    const mid = [...body.matchAll(/[①②③④⑤]/g)].find((m) => {
      const before = body.slice(0, m.index).replace(/\s+$/, "");
      return before.length > 0 && !/[.!?]["'’”)]*$/.test(before);
    });
    if (mid) {
      warnings.push(`번호 ${mid[0]}가 문장 중간에 있습니다. 번호는 문장 앞에만 둡니다.`);
      score -= 45;
    }
  }

  /*
   * 문장삽입: 주어진 문장을 정답 자리에 넣으면 원문이 되어야 한다 (#27은 ④인데 ⑤라 했다).
   * 처음엔 하만 봤다. 바꿔 쓰기를 끈 작업은 상도 원문 문장을 그대로 빼므로(2026-10-06) 상도 본다.
   */
  if (
    option.type === "sentence_insertion" &&
    !opts.allowParaphrase &&
    modifiedText &&
    (q.questionText ?? "").trim()
  ) {
    const squash = (s: string) => plainText(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = squash(opts.passage);
    const parts = modifiedText.replace(/<\/?[ub]>/gi, "").split(/[①②③④⑤]/);
    if (parts.length === 6 && target.length > 0) {
      const sentence = String(q.questionText);
      const fits: number[] = [];
      for (let k = 1; k <= 5; k++) {
        const candidate = [...parts.slice(0, k), sentence, ...parts.slice(k)].join(" ");
        if (squash(candidate) === target) fits.push(k);
      }
      const no = Number(q.correctAnswer);
      if (fits.length === 1 && Number.isFinite(no) && fits[0] !== no) {
        warnings.push(`주어진 문장을 원문 자리에 넣으면 ${"①②③④⑤"[fits[0]! - 1]}인데 정답이 ${no}번입니다.`);
        score -= 45;
      } else if (fits.length === 0) {
        warnings.push("주어진 문장을 어느 자리에 넣어도 원문이 되지 않습니다. 원문 문장을 그대로 빼야 합니다.");
        score -= 45;
      }
    }
  }

  // 지칭·특정표현: 원문을 고쳐 쓰면 안 되고(#68 「and it appears」를 지어 넣음), 답이 대명사면 안 된다(#131 「this」)
  if (/지칭대명사서술|특정표현의미서술/.test(code) && modifiedText) {
    if (!opts.allowParaphrase && plainText(modifiedText) !== originalPlain) {
      warnings.push("지칭·특정표현은 원문에 밑줄만 쳐야 합니다. 문장을 고쳐 쓰거나 넣었습니다.");
      score -= 45;
    }
    /*
     * 특정표현의 답은 밑줄과 같은 뜻의 다른 구여야 한다. 288문항 작업 #171은
     * 「its own iron casting facility」의 답을 바로 뒤에 붙은 「where it made its metal plates」로
     * 냈다. 밑줄 바로 뒤(세 낱말 안)에서 시작하는 구는 이어지는 말일 뿐이라 거른다.
     */
    if (/특정표현의미서술/.test(code) && answerStr) {
      const ans = plainText(answerStr.replace(/^[ⓐ-ⓔ]\s*[:：]?\s*/, "")).toLowerCase().replace(/[.,;:!?]+$/, "").trim();
      const u = modifiedText.match(/<u>([\s\S]*?)<\/u>([\s\S]{0,160})/i);
      if (ans && u) {
        const after = plainText(u[2] ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3 + ans.split(/\s+/).length).join(" ");
        if (after.includes(ans)) {
          warnings.push(`특정표현의 답 "${ans}"이 밑줄 바로 뒤에 이어지는 말입니다. 같은 뜻의 다른 구를 찾아야 합니다.`);
          score -= 45;
        }
      }
    }
    if (/^(it|its|this|that|these|those|they|them|their|he|she|him|her|one)$/i.test(answerStr.replace(/^[ⓐ-ⓔ]\s*[:：]?\s*/, "").trim())) {
      warnings.push(`지칭의 답이 대명사 "${answerStr}"입니다. 가리키는 명사를 써야 합니다.`);
      score -= 45;
    }
  }

  // 요약문 2·3단어: 구가 기능어·부사로 끝나면 요약문이 비문이 된다 (#95 「focus on what they actually」)
  if (option.type === "summary_short" && /요약문빈칸[23]단어$/.test(code) && answerStr) {
    const first = (answerStr.match(/ⓐ\s*[:：]?\s*([^/]+)/)?.[1] ?? answerStr.split("/")[0] ?? "").trim();
    const words = plainText(first).toLowerCase().split(/\s+/).filter(Boolean);
    const last = words[words.length - 1] ?? "";
    if (/^(a|an|the|of|to|and|or|but|that|than|as|in|on|at|for|with|by|is|are|was|were|be|actually|very|so|not|only|just|even|also|still)$/.test(last) || /^(and|or|but)$/.test(words[0] ?? "")) {
      warnings.push(`ⓐ "${first}"가 기능어로 끝나거나 접속사로 시작합니다. 요약문이 비문이 됩니다.`);
      score -= 45;
    }
  }

  // 빈칸추론: 두 보기가 말만 바꾼 같은 뜻이면 정답이 둘이다 (#139 「limits … apparent」 vs 「shortcomings … clear」)
  if (option.type === "sentence_blank" && Array.isArray(q.choices) && q.choices.length >= 5) {
    const bag = (s: string) =>
      new Set(
        plainText(s)
          .toLowerCase()
          .replace(/[^a-z' ]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3)
      );
    const bags = q.choices.map((c) => bag(String(c?.text ?? "")));
    // 「not·only·less」 같은 말 하나로 뜻이 뒤집히는 보기는 같은 말이 아니다 (#233 「matter」 vs 「do not matter」)
    const POLARITY = /^(not|no|never|only|less|least|fewer|little|more|most|without|rather|instead|hardly|cannot|unlike|merely|although|despite|secondary|equally)$/;
    outer: for (let a = 0; a < bags.length; a++) {
      for (let b = a + 1; b < bags.length; b++) {
        const A = bags[a]!;
        const B = bags[b]!;
        if (A.size < 4 || B.size < 4) continue;
        let both = 0;
        for (const w of A) if (B.has(w)) both++;
        const jaccard = both / (A.size + B.size - both);
        const diff = [...A].filter((w) => !B.has(w)).concat([...B].filter((w) => !A.has(w)));
        if (jaccard >= 0.6 && !diff.some((w) => POLARITY.test(w))) {
          warnings.push(`보기 ${"①②③④⑤"[a]}과 ${"①②③④⑤"[b]}가 거의 같은 말입니다. 오답은 뜻이 달라야 합니다.`);
          score -= 45;
          break outer;
        }
      }
    }
  }

  if (!q.instruction.trim()) {
    warnings.push("발문이 없습니다.");
    score -= 30;
  }
  if (!q.explanation.trim()) {
    warnings.push("해설이 없습니다.");
    score -= 25;
  }
  if (q.type !== option.type) {
    warnings.push("요청 유형과 생성 유형이 다릅니다.");
    score -= 30;
  }

  if (
    option.type === "vocabulary" &&
    (option.aingkaCode === "어휘추론" || option.aingkaCode === "어휘개수")
  ) {
    const consistency = validateVocabularyConsistency({
      code: option.aingkaCode,
      passageModified: q.passageModified,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    });
    if (!consistency.ok) {
      warnings.push(...consistency.problems);
      score -= 80;
    }
  }

  // 요지인데 요약문완성(빈칸·…… 쌍)으로 나온 경우 폐기
  if (option.type === "summary_mcq") {
    const blob = [
      q.questionText,
      q.instruction,
      ...(q.choices ?? []).map((c) => c.text),
    ]
      .join("\n")
      .toLowerCase();
    const looksLikeSummaryBlank =
      /요약문/.test(blob) ||
      (/\(a\)/.test(blob) && /\(b\)/.test(blob)) ||
      (q.choices ?? []).some((c) => /……|\.{2,}\s*\S+\s*\.{2,}|…{2,}/.test(c.text));
    if (looksLikeSummaryBlank) {
      warnings.push("요약문완성 형식이 감지되어 요지 문항으로 사용할 수 없습니다.");
      score -= 80;
    }
  }

  /*
   * 아래 다섯 가지는 전수 대조(선생님 지시 2026-10-01)에서 나온 흠이다.
   * 검수기(scripts/check-questions.mts)로만 보고 있었는데, 만들 때 막지 않으면
   * 다시 생긴다. 그래서 여기로 옮겨 왔다.
   */
  const marksOf = (t: string) => [...String(t ?? "").matchAll(/([ⓐ-ⓖ])\s*[:：]/g)].map((m) => m[1]!);
  const ansText = typeof q.correctAnswer === "string" ? q.correctAnswer : "";

  // 1) 정답이 본문에 없는 기호를 가리킨다
  if (ansText && (q.passageModified ?? "").includes("<u>")) {
    const inBody = new Set(
      [...String(q.passageModified).matchAll(/([ⓐ-ⓖ①-⑤])\s*<u>/g)].map((m) => m[1]!)
    );
    if (inBody.size > 0) {
      const missing = marksOf(ansText).filter((mk) => !inBody.has(mk));
      if (missing.length > 0) {
        warnings.push(`정답이 본문에 없는 기호를 가리킵니다: ${missing.join(" ")}`);
        score -= 45;
      }
    }
  }

  /*
   * 2) 객관식인데 해설이 다른 번호를 정답이라고 못 박는다.
   *    정답을 말로만 풀고 오답 번호만 나열하는 것은 정상 꼴이라 건드리지 않는다
   *    (전수 5,696개에서 그 꼴 세 건이 모두 옳은 해설이었다). 「③이 알맞다」처럼
   *    번호를 정답으로 지목한 것만 본다.
   */
  // 어법·어휘 추론은 보기가 본문 밑줄이라 choices가 없다 — 그래도 머리글 번호는 본다 (202문항 대조 #9·#77)
  const markIndexType =
    (option.type === "grammar" || option.type === "vocabulary") && /추론$/.test(option.aingkaCode ?? "");
  if ((Array.isArray(q.choices) && q.choices.length >= 4) || markIndexType) {
    const no = Number(q.correctAnswer);
    if (Number.isFinite(no)) {
      const claimed = new Set<number>();
      const push = (ch: string) => {
        const at = "①②③④⑤".indexOf(ch);
        if (at >= 0) claimed.add(at + 1);
      };
      for (const m of q.explanation.matchAll(
        /([①-⑤])\s*(?:이|가|은|는|을|를|번)?\s*(?:정답|알맞|적절하다|적절한|맞다|들어가)/g
      )) push(m[1]!);
      for (const m of q.explanation.matchAll(/정답[^①-⑤가-힣]{0,4}([①-⑤])/g)) push(m[1]!);
      // 「정답은 ③이다」처럼 조사가 붙은 꼴 (202문항 대조 2026-10-02: 어법추론 둘이 머리글만 다른 번호였다)
      for (const m of q.explanation.matchAll(/정답\s*(?:은|는|이|가)\s*([①-⑤])/g)) push(m[1]!);
      if (claimed.size > 0 && !claimed.has(no)) {
        warnings.push(`정답은 ${no}번인데 해설은 ${[...claimed].join(",")}번을 정답이라고 합니다.`);
        score -= 40;
      }
    }
  }

  /*
   * 3) 「본문에서 찾아 쓰기」인데 정답이 본문에 없다.
   *
   * 형태를 바꿔 쓰라고 한 문항은 그대로 있을 수가 없다(요약표 (A)(B)(C) —
   * 선생님 지적 2026-10-01: 「답이 너무 직관적이다」). 그때는 어간으로 본다.
   */
  const formChanged = /형태를 바꿔|어형을 바꿔|형태를 변형/.test(q.questionText ?? "");
  if (ansText && formChanged) {
    const bodyWords = `${opts.passage} ${q.passageModified ?? ""}`.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const parts = [...ansText.matchAll(/\([A-G]\)\s*[:：]\s*([^/]+)/g)].map((m) => m[1]!.trim());
    for (const text of parts) {
      const w = text.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length < 4) continue;
      const stem = w.slice(0, Math.max(4, Math.floor(w.length * 0.6)));
      if (!bodyWords.some((b) => b.startsWith(stem) || w.startsWith(b.slice(0, Math.max(4, Math.floor(b.length * 0.6)))))) {
        warnings.push(`본문에 없는 낱말을 답으로 썼습니다: "${text.slice(0, 24)}"`);
        score -= 45;
        break;
      }
    }
  } else if (ansText && /본문에서 찾아|본문에 나오는|본문의 한 단어|본문에서 정확히/.test(q.questionText ?? "")) {
    const body = `${opts.passage} ${q.passageModified ?? ""}`.toLowerCase().replace(/[^a-z]/g, "");
    const parts = [
      ...[...ansText.matchAll(/[ⓐ-ⓖ]\s*[:：]\s*([^/]+)/g)].map((m) => m[1]!.trim()),
      ...[...ansText.matchAll(/\([A-G]\)\s*[:：]\s*([^/]+)/g)].map((m) => m[1]!.trim()),
    ];
    for (const text of parts.length ? parts : [ansText]) {
      const key = text.toLowerCase().replace(/[^a-z]/g, "");
      if (key.length >= 4 && !body.includes(key)) {
        warnings.push(`본문에서 찾아 쓰는 문항인데 정답이 본문에 없습니다: "${text.slice(0, 30)}"`);
        score -= 45;
        break;
      }
    }
  }

  /*
   * 4) 「개수」 유형: 정답 숫자와 해설이 든 틀린 개수가 다르다.
   *
   * 처음에는 「ⓑ (틀림)」 꼴만 읽어서, 가장 흔한 「· ⓑ to rehearse → rehearse : …」를
   * 통째로 못 읽었다(2026-10-01). 일부만 읽히면 개수를 적게 세어 멀쩡한 문항을 버린다.
   * 그래서 세 가지 꼴을 모두 읽고, 기호마다 맞다/틀리다가 다 가려졌을 때만 센다.
   */
  if (/개수$/.test(option.aingkaCode ?? "") && option.type !== "vocabulary") {
    const no = Number(q.correctAnswer);
    const expl = q.explanation;
    const wrong = new Set<string>();
    const right = new Set<string>();
    /*
     * 줄 단위로 가린다. 한 줄이 기호 하나를 말하는 것이 해설의 꼴이다.
     * 글자 사이 거리로 재면 「ⓒ z는 올바른 표현이다」의 한글 조사에 막혀 못 읽는다.
     */
    for (const line of expl.split("\n")) {
      const mk = line.match(/[ⓐ-ⓖ①-⑤]/);
      if (!mk) continue;
      const isList = /(?:어색한|틀린)\s*것은/.test(line);
      if (isList) {
        for (const m of line.matchAll(/[ⓐ-ⓖ①-⑤]/g)) wrong.add(m[0]!);
        continue;
      }
      if (/→|->|⇒|틀림|틀리다|어색|부적절/.test(line)) wrong.add(mk[0]!);
      else if (/맞음|맞다|맞습니다|올바른|알맞|적절하다/.test(line)) right.add(mk[0]!);
    }
    // 머리글이 한 줄에 다 들어온 해설도 읽는다
    const listed = expl.match(/(?:어색한|틀린)\s*것은[^\n]{1,60}/);
    if (listed) for (const m of listed[0]!.matchAll(/[ⓐ-ⓖ①-⑤]/g)) wrong.add(m[0]!);

    const inBody = new Set(
      [...String(q.passageModified ?? "").matchAll(/([ⓐ-ⓖ①-⑤])\s*<u>/g)].map((m) => m[1]!)
    );
    /*
     * 본문에 있는 기호만 센다. 「정답은 ⑤이다」의 ⑤는 보기 번호이지 틀린 자리가 아니다 —
     * 그것까지 세어 멀쩡한 문항을 버리던 것을 막는다.
     */
    for (const mk of [...wrong]) if (!inBody.has(mk)) wrong.delete(mk);
    for (const mk of [...right]) if (!inBody.has(mk)) right.delete(mk);
    // 기호마다 맞다/틀리다가 다 가려졌을 때만 센다 — 덜 읽고 버리면 안 된다
    const judged = new Set([...wrong, ...right]);
    const allJudged = inBody.size > 0 && [...inBody].every((mk) => judged.has(mk));
    if (Number.isFinite(no) && allJudged && wrong.size !== no) {
      warnings.push(`정답은 ${no}개인데 해설은 ${wrong.size}개를 틀렸다고 합니다.`);
      score -= 40;
    }
  }

  // 5) 해설 끝에 이 문장과 무관한 문법 포인트 꼬리표가 붙었다
  if (/제시어배열/.test(option.aingkaCode ?? "")) {
    const tail = q.explanation.split(/(?<=[.다])\s+/).filter((line) => /^\s*GP\d{2}/.test(line));
    if (tail.length > 0) {
      warnings.push("해설 끝에 문법 포인트 꼬리표가 붙었습니다.");
      // 통과선(70)을 넘겨야 다시 만든다
      score -= 35;
    }
  }

  /*
   * 보기 다섯 개가 같은 말로 시작하면 틀로 굳은 것이다.
   *
   * 윌링어학원 세트(2F4D57)를 보니 주제추론 열넷 가운데 셋이 다섯 보기를 전부
   * 「The ~」나 「How ~」로 시작했다. 학생이 내용이 아니라 틀을 보고 가른다.
   * 저장된 문항 전체로 재 보니 주제추론 14%·내용일치 21%·요지추론 14%가 그랬다.
   *
   * 빈칸추론·함축의미추론은 뺀다 — 거기서는 다섯 보기가 같은 꼴로 늘어서는 것이 맞다.
   */
  const HEAD_VARIETY_TYPES = new Set(["title", "topic", "main_idea", "content_true", "content_false"]);
  if (HEAD_VARIETY_TYPES.has(option.type) && Array.isArray(q.choices) && q.choices.length >= 5) {
    const heads = q.choices
      // 보기는 {number, text} 꼴이다. 문자열로 읽어 규칙이 한 번도 안 걸리던 것을 고친다.
      .map((c) => String(c?.text ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "")
      .filter(Boolean);
    if (heads.length >= 5) {
      const cnt = new Map<string, number>();
      for (const h of heads) cnt.set(h, (cnt.get(h) ?? 0) + 1);
      const [word, n] = [...cnt].sort((a, b) => b[1] - a[1])[0]!;
      /*
       * 글감 낱말(Myers-Briggs, Hemingway's, bee)이나 한글 보기(투표, 마이어스-브릭스)로 다섯 보기가 시작하는 것은
       * 틀이 아니라 글감이다 — 학생이 틀로 가를 수도 없다. 2026-10-27~11-09 작업 다섯 개에서 이 경고로만
       * 다시 만든 것이 13번(재생성 99번 중 가장 많은 갈래)이었다. 틀 낱말(the·how·why …)은 그대로 막는다.
       */
      const TEMPLATE_HEADS = new Set(["the", "a", "an", "how", "why", "what", "when", "where", "which", "who", "ways", "way", "importance", "role", "effects", "benefits", "reasons", "need", "necessity", "difficulty", "difficulties", "can", "is", "are", "do", "does"]);
      const bare = word.replace(/[’']s$/, "").replace(/[^a-z0-9-]/g, "");
      const topicWord =
        /[가-힣]/.test(word) ||
        (!TEMPLATE_HEADS.has(bare) && bare.length >= 3 && new RegExp(`\\b${bare.replace(/-/g, "\\-")}`, "i").test(opts.passage));
      if (n >= 4 && !topicWord) {
        warnings.push(`보기 ${n}개가 "${word}"로 시작합니다. 틀을 바꿔 주세요.`);
        score -= 35;
      }
    }
  }

  /*
   * 정답 보기만 꼴이 다르면 내용을 안 읽고도 골라진다.
   *
   * 정수학원 10월 5일 점검: 한글 제목·주제의 정답에만 「겨울 온실(greenhouses)」「conceptual model」처럼
   * 영어가 섞이거나, 정답만 「어떻게 ~할 수 있는가」 의문형이고 나머지는 명사구였다(4건).
   */
  if ((option.type === "title" || option.type === "topic") && Array.isArray(q.choices) && q.choices.length >= 5) {
    const key = Number(q.correctAnswer);
    const texts = q.choices.map((c) => String(c?.text ?? "").trim());
    const answer = texts[key - 1];
    if (answer) {
      const others = texts.filter((_, i) => i !== key - 1);
      const korean = texts.every((t) => /[가-힣]/.test(t));
      // AI·DNA 같은 대문자 약어는 글감이라 셈하지 않는다
      const hasLatin = (t: string) => /[a-z]{2,}/.test(t);
      const isQuestion = (t: string) => /[?？]$|까$|(는가|인가|한가)$/.test(t) || /^(왜|어떻게|무엇|어떤|누가|언제)\s/.test(t);
      if (korean && hasLatin(answer) && others.every((t) => !hasLatin(t))) {
        warnings.push("정답 보기에만 영어가 섞여 있습니다. 다른 보기와 같은 꼴로 씁니다.");
        score -= 35;
      } else if (isQuestion(answer) && others.every((t) => !isQuestion(t))) {
        warnings.push("정답 보기만 의문형입니다. 다섯 보기를 같은 꼴로 씁니다.");
        score -= 35;
      } else if (/[:：]/.test(answer) && others.every((t) => !/[:：]/.test(t))) {
        // 정답만 「What …: …」 제목 꼴이었다(2026-10-07 권승현 전용문제, 저장 1,703개 중 11개)
        warnings.push("정답 보기만 「…: …」 꼴입니다. 다섯 보기를 같은 꼴로 씁니다.");
        score -= 35;
      }
    }
  }

  return {
    singleCorrectAnswer: true,
    answerMatchesExplanation: Boolean(q.explanation.trim()),
    evidenceExists: true,
    ambiguityRisk: score < 70 ? "high" : "low",
    difficultyMatch: true,
    grammarChecked: true,
    overallScore: Math.max(0, Math.min(100, score)),
    warnings,
    typeMatch: q.type === option.type,
  };
}

export function shouldRegenerate(v: QuestionValidation): boolean {
  if (v.overallScore < VALIDATION_PASS_SCORE) return true;
  if (!v.answerMatchesExplanation) return true;
  if (v.typeMatch === false) return true;
  if (!v.singleCorrectAnswer) return true;
  return false;
}
