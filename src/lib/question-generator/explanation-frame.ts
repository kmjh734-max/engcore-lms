/**
 * 객관식 해설 끝을 「따라서 정답은 '보기 글' ④번이다.」로 맞춘다(리얼영어 해설 틀, 선생님 2026-11-23).
 * 모델이 앞머리에 쓰는 「정답은 ②다.」는 떼고, 끝 문장은 코드가 정답 번호와 보기 글로 붙인다 —
 * 해설 속 번호와 실제 정답이 어긋날 일이 없다. 서술형(보기 없음)은 그대로 둔다.
 */

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

/** 끝 문장에 따옴표로 넣을 만큼 짧은 보기 글(이보다 길면 번호만) */
const QUOTE_MAX = 90;

export function frameChoiceExplanation(input: {
  explanation: string | null | undefined;
  choices: Array<{ number?: number; text?: string }> | null | undefined;
  correctAnswer: unknown;
  /** 보기 목록 없이 지문 속 ①~⑤로 고르는 객관식(어법·어휘 추론, 문장 삽입, 무관한 문장)도 끝 문장을 단다 */
  isObjective?: boolean;
}): string {
  const raw = String(input.explanation ?? "").trim();
  const choices = Array.isArray(input.choices) ? input.choices : [];
  const n = Number(input.correctAnswer);
  const max = choices.length >= 2 ? choices.length : input.isObjective ? 5 : 0;
  if (!raw || !max || !Number.isInteger(n) || n < 1 || n > max) return raw;
  const mark = CIRCLED[n - 1] ?? String(n);
  const text = String(choices.find((c) => Number(c.number) === n)?.text ?? choices[n - 1]?.text ?? "")
    .replace(/<\/?u>/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  let body = raw
    // 앞머리 「정답은 ②다.」「정답은 ②이다.」「정답은 2번이다.」
    .replace(/^정답은\s*[①-⑧\d]+\s*번?\s*(?:이)?다[.;]?\s*/, "")
    // 이미 붙어 있던 끝 문장
    .replace(/\s*따라서\s*정답은[^.]*[.]?\s*$/, "")
    .trim();
  if (body && !/[.!?」』)]$/.test(body)) body += ".";

  const quote = text && text.length <= QUOTE_MAX && !/^[①-⑧ⓐ-ⓩ\d\s]*$/.test(text) ? `'${text}' ` : "";
  const tail = `따라서 정답은 ${quote}${mark}번이다.`;
  // 줄로 된 해설(어휘 판정 「① 맞음 — …」)은 줄을 읽어 다시 검사하므로 끝 문장을 새 줄에 단다
  const sep = body.includes("\n") ? "\n" : " ";
  return body ? `${body}${sep}${tail}` : tail;
}
