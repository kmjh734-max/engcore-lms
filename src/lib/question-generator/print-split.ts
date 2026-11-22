/**
 * 인쇄 쪽 나눔에서 한 단보다 긴 문항(지문이 아주 긴 경우)을 단·쪽을 넘겨 이어 싣기 위한 도구.
 *
 * 예전에는 문항 하나를 통째로 한 단에 넣었다. 선생님이 지문을 아주 길게 넣으면 문항이 한 단보다
 * 길어 어느 단에도 들어가지 않았고, 쪽 높이가 고정이라 아래가 잘려 인쇄되지 않았다.
 * 이제 그런 문항만 지문을 문장(아주 긴 문장은 어절 묶음) 단위로 나눠 다음 단·다음 쪽으로 잇는다.
 * 한 단에 들어가는 문항은 예전처럼 쪼개지 않는다.
 */

/** 지문의 한 조각(문단 번호와 그 문단 안의 문장 또는 어절 묶음). */
export type PrintUnit = { para: number; text: string };

/**
 * 지문 속 표 한 문단: 「[표] 머리 | 머리 // 칸 | 칸 // …」(줄은 「 // 」, 칸은 「 | 」, 첫 줄이 머리).
 * 중학교 문제 은행에서 칸마다 한 줄로 흩어졌던 표를 이 꼴로 저장한다(2026-11-22).
 */
export const TABLE_MARK = "[표]";

export function parseTableParagraph(text: string): string[][] | null {
  if (!text.startsWith(TABLE_MARK)) return null;
  const rows = text
    .slice(TABLE_MARK.length)
    .split(/\s+\/\/\s+/)
    .map((r) => r.split(/\s+\|\s+/).map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  // 「[표] 글 한 줄」처럼 칸 나눔이 없는 옛 꼴은 표가 아니라 글로 둔다
  return rows.some((r) => r.length >= 2) ? rows : null;
}

/** 쪼갠 문항의 한 부분: 지문 조각 [from, to), 머리(번호·지시문)와 꼬리(보기·선택지)를 싣는지. */
export type PrintPiecePart = { from: number; to: number; first: boolean; last: boolean };

/** 단에 싣는 한 덩어리: 문항 전체(part 없음) 또는 쪼갠 문항의 한 부분. */
export type PrintPiece = { item: number; part?: PrintPiecePart };

export type PrintPiecePage = { left: PrintPiece[]; right: PrintPiece[] };

/** 한 조각에 넣는 최대 어절 수. 이보다 긴 문장은 어절 묶음으로 더 나눈다. */
const MAX_UNIT_WORDS = 40;

/** <u>…</u> 밖의 공백 위치에서만 자른다(밑줄 표시가 두 조각으로 갈리지 않게). */
function splitOutsideTags(text: string, isBreak: (before: string, index: number) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<") {
      const rest = text.slice(i, i + 4).toLowerCase();
      if (rest.startsWith("<u>")) depth++;
      else if (rest.startsWith("</u>")) depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && text[i] === " " && isBreak(text.slice(start, i), i)) {
      const piece = text.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** 문장 끝(. ! ? 뒤에 따옴표·괄호가 올 수 있음) 다음 공백에서 자른다. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

function splitSentenceWords(sentence: string): string[] {
  const words = sentence.split(" ").length;
  if (words <= MAX_UNIT_WORDS) return [sentence];
  const size = Math.ceil(words / Math.ceil(words / MAX_UNIT_WORDS));
  let count = 0;
  return splitOutsideTags(sentence, () => {
    count++;
    if (count >= size) {
      count = 0;
      return true;
    }
    return false;
  });
}

/**
 * 문단 목록(공백이 한 칸으로 정리된 것)을 인쇄 조각으로 나눈다. 같은 문단의 조각을 " "로
 * 이어 붙이면 원래 문단과 글자 하나 다르지 않다.
 */
export function splitPrintUnits(paragraphs: string[]): PrintUnit[] {
  const units: PrintUnit[] = [];
  paragraphs.forEach((para, pi) => {
    // 표 문단(「[표] 칸 | 칸 // 칸 | 칸」, 중학교 문제 은행)은 쪼개지 않는다
    if (para.startsWith(TABLE_MARK)) {
      units.push({ para: pi, text: para });
      return;
    }
    const sentences = splitOutsideTags(para, (before) => SENTENCE_END.test(before));
    for (const s of sentences) {
      for (const chunk of splitSentenceWords(s)) units.push({ para: pi, text: chunk });
    }
  });
  return units;
}

/**
 * A4 2단: 왼쪽 단 → 오른쪽 단 → 다음 쪽 순서로 싣는다. 한 단에 들어가는 문항은 통째로 두고
 * (남은 자리가 모자라면 다음 단으로), 한 단보다 긴 문항만 split.fit으로 잰 만큼씩 나눠 잇는다.
 * 쪼갠 문항의 끝 부분은 지문 끝과 보기·선택지를 함께 싣는다.
 */
export function paginatePrintPieces(
  heights: number[],
  opts: {
    firstColumnMaxPx: number;
    nextColumnMaxPx: number;
    questionGapPx: number;
    columnSafetyPx?: number;
    /** 이미 문항이 있는 단에서 긴 문항을 시작하려면 남아 있어야 하는 높이. */
    minStartPx?: number;
  },
  split?: {
    /** 문항의 지문 조각 수(2 미만이면 쪼갤 수 없다). */
    unitCount: (item: number) => number;
    /**
     * from부터 maxPx 안에 들어가는 가장 큰 to(마지막 조각이면 꼬리 포함)와 그 높이.
     * 하나도 들어가지 않으면 to = from.
     */
    fit: (item: number, from: number, first: boolean, maxPx: number) => { to: number; height: number };
  }
): PrintPiecePage[] {
  const n = heights.length;
  if (n === 0) return [];
  const safety = opts.columnSafetyPx ?? 0;
  const pages: PrintPiecePage[] = [];
  let page: PrintPiecePage = { left: [], right: [] };
  let side: "left" | "right" = "left";
  let used = 0;
  let pageIndex = 0;
  const maxH = () => (pageIndex === 0 ? opts.firstColumnMaxPx : opts.nextColumnMaxPx) - safety;
  const nextColumn = () => {
    if (side === "left") {
      side = "right";
    } else {
      pages.push(page);
      page = { left: [], right: [] };
      side = "left";
      pageIndex++;
    }
    used = 0;
  };

  let i = 0;
  let from = 0;
  let first = true;
  for (let guard = 0; i < n && guard < 100000; guard++) {
    const col = page[side];
    const gap = col.length > 0 ? opts.questionGapPx : 0;
    const room = maxH() - used - gap;

    if (first) {
      const h = heights[i]!;
      if (h <= room) {
        col.push({ item: i });
        used += gap + h;
        i++;
        continue;
      }
      const units = split ? split.unitCount(i) : 0;
      if (units < 2) {
        if (col.length > 0) {
          nextColumn();
          continue;
        }
        // 쪼갤 수 없는 긴 문항: 예전처럼 한 단에 혼자 둔다.
        col.push({ item: i });
        i++;
        nextColumn();
        continue;
      }
      /*
       * 남은 자리에 통째로 들어가지 않는 문항은 예전에는 다음 단으로 넘겼다. 그러면 짧은 문항
       * 두 개 아래가 통째로 비는 단이 생겼다(선생님 지적 2026-09-17: "밑에 여백이 있는데
       * 상단에 짧은 2문제만 나온 경우가 있다, 종이를 아껴야"). 이제 남은 자리가 넉넉하면
       * 지문을 이어 싣고 나머지(지문 끝과 선택지)는 다음 단으로 잇는다.
       * 남은 자리가 좁으면 두세 줄만 걸쳐 읽기 불편하므로 예전처럼 다음 단에서 시작한다.
       * 한 단에 들어가는 문항은 같은 쪽 안에서만(왼쪽 단 → 오른쪽 단) 잇는다. 쪽을 넘기면
       * 지문과 선택지가 다른 장에 찍혀 풀기 어렵다(선생님 지적 2026-09-17).
       */
      const minStart = opts.minStartPx ?? 0;
      const oversized = h > maxH();
      if (col.length > 0 && (room < minStart || (!oversized && (side as string) === "right"))) {
        nextColumn();
        continue;
      }
    }

    const units = split!.unitCount(i);
    const r = split!.fit(i, from, first, room);
    let to = Math.min(r.to, units);
    let h = r.height;
    if (to <= from) {
      if (col.length > 0) {
        nextColumn();
        continue;
      }
      // 빈 단에도 조각 하나가 들어가지 않는 경우(거의 없음): 한 조각씩이라도 넘긴다.
      to = from + 1;
      h = room;
    }
    col.push({ item: i, part: { from, to, first, last: to >= units } });
    used += gap + h;
    if (to >= units) {
      i++;
      from = 0;
      first = true;
    } else {
      from = to;
      first = false;
      nextColumn();
    }
  }
  if (page.left.length > 0 || page.right.length > 0) pages.push(page);
  return pages;
}
