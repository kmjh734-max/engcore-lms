import type { QuestionPrintPreloaded, QuestionPrintRow } from "@/components/question-generator/QuestionPrintView";
import type { MsQuestion, MsUnit } from "./queries";

/**
 * 중학교 문제 은행 문항을 변형문제 인쇄 화면(QuestionPrintView) 모양으로 바꾼다
 * (선생님 2026-10-29 「예상문제도 변형문제 디자인·형식과 같이」).
 *
 * - 같은 지문을 쓰는 문항(「다음 글을 읽고 물음에 답하시오」)은 같은 passage_id — 지문별 묶음(bySet)이 [1~3]으로 묶어 지문을 한 번 찍는다.
 * - 지문 칸은 빈 줄로 문단을 가른다 — 대화문·<보기> 줄이 한 줄로 합쳐지지 않게 줄마다 문단으로 둔다.
 */

const CIRC = "①②③④⑤";

/** 출처 차례(선생님 2026-10-30 「정리가 덜 됐다」): 예상문제 PRE-STEP → 1회 → 2회 → Grammar Build Up → 최다빈출 → 최상위 → 최다오답 */
const SOURCE_RANK: Array<[RegExp, number]> = [
  [/^본문학습/, -1], // STEP 번호 순(이름 차례)
  [/^대표유형/, -0.5],
  [/PRE-STEP/i, 0],
  [/예상문제\s*1회/, 1],
  [/예상문제\s*2회/, 2],
  [/예상문제/, 3],
  [/Grammar Build Up/i, 4],
  [/최다빈출/, 5],
  [/최상위/, 6],
  [/최다오답/, 7],
];
/**
 * 내신콘서트(선생님 2026-11-04 「거기 있는 모든 문제를 다 넣어」): 책 차례대로 — 어휘 → 대화 → 문법 → 본문 → 기타 지문 → 실전 모의고사.
 * 문제 은행(변형문제 탭)에만 나오고 최종통합자료에는 넣지 않는다.
 */
// 출처 이름: 「내신콘서트 단어 · 연습 문제」 … 「내신콘서트 종합문제 · 실전 모의고사 Basic 1회」(선생님 2026-11-04 차례: 단어 대화문 문법 본문 종합문제)
export const CONCERT_ORDER = [
  "단어 · 연습 문제",
  "단어 · 실전 문제",
  "대화문 · 연습 문제",
  "대화문 · 실전 문제",
  "문법 · 연습 문제",
  "문법 · 실전 문제",
  "본문 · 연습 문제",
  "본문 · 실전 문제",
  "실전 모의고사 Basic",
  "실전 모의고사 Intermediate",
  "실전 모의고사 서술형",
  "실전 모의고사 Advanced",
];
export const isConcertSource = (source: string) => /^내신콘서트/.test(source);
export function msSourceRank(source: string): number {
  if (isConcertSource(source)) {
    const i = CONCERT_ORDER.findIndex((k) => source.includes(k));
    return 8 + (i < 0 ? CONCERT_ORDER.length : i) / 100;
  }
  for (const [re, r] of SOURCE_RANK) if (re.test(source)) return r;
  return 9;
}
export function sortMsSources(list: Iterable<string>): string[] {
  return [...new Set(list)].sort((a, b) => msSourceRank(a) - msSourceRank(b) || a.localeCompare(b, "ko"));
}
/** 문항을 출처 차례 → 그 자료 안 차례로 */
export function sortMsQuestions(list: MsQuestion[]): MsQuestion[] {
  return [...list].sort((a, b) => msSourceRank(a.source) - msSourceRank(b.source) || a.source.localeCompare(b.source, "ko") || a.no - b.no);
}
const BLANK = "__________";

/** 서술형 빈칸 표시를 밑줄 칸으로 */
function blanks(s: string): string {
  return s.replace(/<blank\/>/g, BLANK);
}

/** 보기 밑줄: 여는 표시가 빠지고 닫는 표시만 남은 보기(「To read</u> is …」)는 보기 첫머리부터 밑줄로 */
function fixUnderline(s: string): string {
  const open = (s.match(/<u>/g) ?? []).length;
  const close = (s.match(/<\/u>/g) ?? []).length;
  return close > open ? "<u>".repeat(close - open) + s : s;
}

/** 묶음 지문 열쇠(같은 글이면 같은 값) */
function groupKey(lines: string[]): string {
  let h = 0;
  for (const c of lines.join("\n")) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return `g${(h >>> 0).toString(36)}`;
}

export function msQuestionToPrintRow(q: MsQuestion): QuestionPrintRow {
  const group = q.groupLines?.length ? q.groupLines : null;
  const answers = q.answer.split(/\s*,\s*/).filter(Boolean);
  const correct: unknown =
    q.kind === "mc" ? (answers.length === 1 && /^\d$/.test(answers[0]) ? Number(answers[0]) : answers.map((a) => CIRC[Number(a) - 1] ?? a).join(", ")) : q.answer;
  return {
    id: String(q.id),
    instruction: q.stem.replace(/<\/?u>/g, ""),
    // 묶음 문항의 제 글(Q: … / A: …)은 지문 아래 글로, 아니면 제 글이 곧 지문
    question_text: group ? q.body.map(blanks).join("\n") : "",
    passage_original: (group ?? q.body).map(blanks).join("\n\n"),
    passage_modified: null,
    choices: q.choices.map((c) => ({ number: c.no, text: fixUnderline(blanks(c.text)).replace(/\n/g, " / ") })),
    correct_answer: correct,
    // 해설은 글자로만 찍힌다: 밑줄 표시는 뺀다
    explanation: q.explanation.replace(/<\/?u>/g, ""),
    question_type: `ms_${q.kind}`,
    category: q.area,
    passage_id: group ? groupKey(group) : `q${q.id}`,
  };
}

export function msExamPreloaded(unit: Pick<MsUnit, "grade" | "publisher" | "lessonNo" | "title">, questions: MsQuestion[], title?: string): QuestionPrintPreloaded {
  const rows = questions.map(msQuestionToPrintRow);
  const seen = new Set<string>();
  const passages: QuestionPrintPreloaded["passages"] = [];
  questions.forEach((q, i) => {
    const id = rows[i].passage_id!;
    if (seen.has(id)) return;
    seen.add(id);
    // 문항 위 작은 글은 영역(단어·의사소통·어법·본문) — 출처는 머리글 제목에 한 번만(출처별로 따로 찍는다)
    passages.push({ id, source_detail: q.area });
  });
  return {
    title: title ?? `${unit.grade} ${unit.lessonNo}과 변형문제`,
    grade: unit.grade,
    sourceDetail: `Lesson ${unit.lessonNo} ${unit.title}`,
    questions: rows,
    passages,
  };
}

/** 고른 문항 id들을 주소 한 조각으로(36진법, 「.」로 잇기) */
export function encodeQuestionIds(ids: number[]): string {
  return ids.map((n) => n.toString(36)).join(".");
}

export function decodeQuestionIds(sel: string): number[] {
  return sel
    .split(".")
    .map((s) => parseInt(s, 36))
    .filter((n) => Number.isFinite(n) && n > 0);
}
