/**
 * 어법 추론·어법 개수: 모델은 지문을 다시 쓰지 않고 「밑줄 자리」만 답하고, 밑줄 친 지문은 코드가 원문에 붙여 만든다
 * (선생님 2026-11-28 「원가를 줄이자」, 모든 유형 2.5배 이상).
 *
 * 전에는 모델이 밑줄을 넣으며 지문 전체를 다시 썼다. 11-15~27 어법 객관식 121문항에 생성 호출 343번 — 절반 넘게
 * 「밑줄 밖 원문이 바뀜」「문장이 빠짐」으로 버려졌고, 지문을 베끼는 데 출력의 40%(약 244토큰)가 들었다.
 * 자리만 받으면 밑줄 밖은 글자 하나 바뀔 수 없고, 출력도 줄어든다.
 */
import type { QuestionTypeOption } from "@/lib/question-generator/types";

export const GRAMMAR_SPOT_CODES = new Set(["어법추론", "어법모두고르기", "어법개수"]);

/** 이 문항을 자리 목록으로 받는가 — 지문 바꿔 쓰기를 켠 작업은 예전처럼 지문을 받는다 */
export function grammarSpotMode(option: Pick<QuestionTypeOption, "type" | "aingkaCode">, paraphraseOn: boolean): boolean {
  return option.type === "grammar" && GRAMMAR_SPOT_CODES.has(option.aingkaCode ?? "") && !paraphraseOn;
}

const MARKS = "ⓐⓑⓒⓓⓔⓕⓖⓗ";

/** 지시문의 형식 줄(지문 대신 자리 목록) */
export function grammarSpotFormatLine(count: number): string {
  const marks = MARKS.slice(0, count);
  return `- Do NOT write the passage. Return "spots": exactly ${count} underline spots IN PASSAGE ORDER (first = ${marks[0]}, last = ${marks[count - 1]}). The code puts ${marks[0]}<u>…</u> marks into the original passage for you; everything outside the spots stays the original word for word.
- Each spot: {"ctx": "4-10 consecutive words copied EXACTLY from the PASSAGE that contain the spot (unique in the passage)", "orig": "the original word(s) at the spot, 1-4 words, exactly as in ctx", "show": "what the student sees under the underline — orig unchanged if this spot is grammatical, or orig with ONLY its form changed if this spot is an error"}.
- Spots must not overlap and must be spread over the passage (not more than two in one sentence). In explanation refer to spots by ${marks[0]}~${marks[count - 1]} in this order.`;
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
export function buildGrammarSpotPassage(passage: string, spots: unknown, count: number): { passageModified: string } | { error: string } {
  if (!Array.isArray(spots)) return { error: "spots 목록이 없습니다. 지문 대신 밑줄 자리 목록(spots)을 주세요." };
  if (spots.length !== count) return { error: `밑줄 자리가 ${spots.length}개입니다. 정확히 ${count}개여야 합니다.` };
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
