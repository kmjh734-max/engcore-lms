import type { PrintExamQuestion } from "@/lib/vocab/generate-print-test-questions";

/**
 * 정답지 3단 나누기. 예전에는 한 장에 78개(B5 66개)로 잘라 240문항이면 넉 장에 마지막 장이 6개였고,
 * 두 줄짜리 답이 많으면 단 아래가 잘릴 수 있었다(overflow: hidden).
 * 답마다 몇 줄이 될지 어림해 쪽을 채우고, 한 쪽 안에서는 세 단 높이가 고르게 되도록 나눈다.
 *
 * 한 단에 들어가는 줄 수·한 줄 글자 수는 A4·B5 정답지를 PDF로 찍어 잰 값에 여유를 둔 것
 * (A4: 단 높이 약 65줄·한 줄 한글 약 18자).
 */
const LINES_PER_COLUMN = { a4: 56, b5: 44 } as const;
const UNITS_PER_LINE = { a4: 17, b5: 15 } as const;

/** 한글·한자는 한 칸, 영문·숫자·기호는 반 칸 남짓으로 어림 */
function answerLines(answer: string, unitsPerLine: number): number {
  let units = 0;
  for (const ch of answer) {
    units += /[ㄱ-힝一-鿿]/.test(ch) ? 1 : 0.55;
  }
  return Math.max(1, Math.ceil(units / unitsPerLine));
}

/** cap 줄씩 차례로 채울 때 몇 단이 드는지 — 단마다 나눈 문항 */
function fillColumns(lines: number[], cap: number): number[][] {
  const cols: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  lines.forEach((n, i) => {
    if (cur.length > 0 && used + n > cap) {
      cols.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += n;
  });
  if (cur.length) cols.push(cur);
  return cols;
}

export function paginateAnswerKey(
  questions: PrintExamQuestion[],
  size: "a4" | "b5",
  /** 화면에서 단이 넘친 만큼 줄여 다시 나눌 줄 수(어림이 빗나간 답·머리 높이를 실측으로 바로잡음) */
  shrinkLines = 0
): PrintExamQuestion[][][] {
  const budget = Math.max(8, LINES_PER_COLUMN[size] - shrinkLines);
  const lines = questions.map((q) => answerLines(q.answer, UNITS_PER_LINE[size]));

  // 1) 쪽 나누기: 한 단 budget 줄로 세 단을 차례로 채운다
  const pages: number[][] = [];
  let start = 0;
  while (start < questions.length) {
    const cols = fillColumns(lines.slice(start), budget).slice(0, 3);
    const count = cols.reduce((n, c) => n + c.length, 0);
    pages.push(Array.from({ length: count }, (_, i) => start + i));
    start += count;
  }

  // 2) 쪽 안에서 세 단을 고르게: 세 단 안에 들어가는 가장 작은 단 높이를 찾는다(budget을 넘지 않음)
  return pages.map((idx) => {
    const pageLines = idx.map((i) => lines[i]);
    let lo = Math.max(...pageLines);
    let hi: number = budget;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fillColumns(pageLines, mid).length <= 3) hi = mid;
      else lo = mid + 1;
    }
    return fillColumns(pageLines, lo).map((col) => col.map((k) => questions[idx[k]]));
  });
}
