/**
 * 지문 속 그림 표시 — 「The graph above …」 도표 지문에 원문 도표를 넣는다(선생님 2026-11-26).
 * 지문 글자 안에 한 줄로 `[[FIG:/mock-figures/파일.png]]` 을 두면 웹 인쇄는 <img>, 한글 문제지는 그림 개체로 찍는다.
 * 표시가 없는 지문은 아무것도 바뀌지 않는다(이미 인쇄한 자료가 달라지지 않게).
 */

/** 한 문단(줄)이 그림 표시뿐인지 — 맞으면 그림 주소 */
export const FIG_LINE_RE = /^\s*\[\[FIG:([^\]\s]+)\]\]\s*$/;
const FIG_ANY_RE = /\s*(\[\[FIG:[^\]\s]+\]\])\s*/g;

export function figureSrcOf(line: string): string | null {
  const m = String(line ?? "").match(FIG_LINE_RE);
  return m ? m[1]! : null;
}

export function hasFigureMark(text: string | null | undefined): boolean {
  return Boolean(text && text.includes("[[FIG:"));
}

/**
 * 그림 표시를 앞뒤 빈 줄로 떼어 제 문단이 되게 한다(줄바꿈이 공백으로 합쳐져도 글 속에 섞이지 않게).
 * 표시가 없으면 글자 하나 바꾸지 않고 그대로 돌려준다.
 */
export function isolateFigureMarks(text: string): string {
  if (!hasFigureMark(text)) return text;
  return text.replace(FIG_ANY_RE, "\n\n$1\n\n").replace(/^\n+|\n+$/g, "");
}

/** 글 안의 그림 주소들(차례대로, 겹치지 않게) */
export function figureSrcsIn(texts: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!hasFigureMark(t)) continue;
    for (const m of t!.matchAll(/\[\[FIG:([^\]\s]+)\]\]/g)) out.add(m[1]!);
  }
  return [...out];
}
