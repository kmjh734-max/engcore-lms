/**
 * 적중 자료집 — 적중표를 학부모·학생에게 보여 줄 A4 자료로 다시 짠다.
 *
 * 까닭(선생님 지시 2026-10-15): 손으로 만든 발곡고 적중 자료집(PDF)처럼 사이트에서도 나오게.
 * 적중표는 「지문이 같은 내 문항이 몇 개」까지만 알려 준다. 자료집은 문항마다
 *  - 학교 시험 문제(군데군데 흐리게)와 정답
 *  - 시험 전에 낸 우리 문항을 그대로, 같은 자리에 빨간 표시
 *  - 「무엇이 같은가」를 원문 그대로 나란히
 * 를 보여 준다.
 *
 * 판정은 보수적으로 한다(선생님 지시 2026-10-14 「그 자리를 그대로 썼는지가 중요해」).
 *  ① 동일 유형 · 동일 포인트 — 같은 유형으로 <b>같은 자리</b>를 물은 우리 문항이 있다.
 *     밑줄·빈칸은 앞뒤 낱말이 같은 자리, 문장삽입은 주어진 문장이 같을 때,
 *     순서배열은 정답 순서와 덩어리 첫머리가 같을 때, 주제·제목은 정답 표현이 겹칠 때만.
 *  ② 유사 유형 — 같은 지문·같은 유형을 풀었지만 자리가 다르거나, 1장 테스트지가 그 자리를 괄호로 물었다.
 * 시험지를 올리기 전에 만든 자료만 센다. 모델을 부르지 않는다(글자 대조).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExamAnalysisRow, ExamItemRow } from "@/lib/exam-analysis/types";
import { onePageSentences, type OnePageContent } from "@/lib/lesson-materials/one-page";
import { findPassageAll, sameStem, stemsFor } from "@/lib/exam-analysis/uploaded-material";
import { examChat } from "@/lib/exam-analysis/openai";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export type BookVerdict = "same" | "similar" | "none";

export type BookCard =
  | {
      kind: "question";
      source: string;
      date: string;
      instruction: string;
      questionText: string;
      /** 지문 — <u>·<mark> 만 남긴 HTML */
      passageHtml: string;
      choices: string[];
      answerNo: number | null;
      answerText: string;
      /** 이 문항이 시험과 같은 자리를 물었는가 */
      same: boolean;
      /** 시험과 형식이 다른 자료면 「다른 형식 · 어순 배열」 같은 꼬리표 */
      tag?: string;
      /** 보기가 이스케이프된 HTML(<mark> 표시 포함)인가 — 손으로 만든 자료집에서 근거 보기에 표시를 단다 */
      choicesHtml?: boolean;
    }
  | { kind: "line"; source: string; date: string; linesHtml: string[]; tag?: string };

export type BookCompare = { exam: string; ours: string; same: string };

export type BookItem = {
  id: string;
  no: string;
  typeName: string;
  points: number | null;
  level: string;
  verdict: BookVerdict;
  /** 시험과 같은 자리(①) 또는 같은 유형(②)을 미리 다룬 우리 자료 수 */
  count: number;
  stem: string;
  /** 시험 지문 — 흐림·표시를 넣은 HTML */
  examHtml: string;
  choices: Array<{ text: string; answer: boolean }>;
  answer: string;
  reason: string;
  compare: BookCompare[];
  cards: BookCard[];
};

export type HitBook = {
  /** 시험지 분석 id — 문항 재검토 단추가 쓴다 */
  analysisId?: string;
  title: string;
  subtitle: string;
  examLabel: string;
  cutoff: string | null;
  items: BookItem[];
  sameCount: number;
  similarCount: number;
  samePct: number;
  similarPct: number;
  total: number;
  materials: number;
};

// ── 글자 다루기
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <u> 만 살리고 나머지 태그는 글자로 */
const keepU = (s: string) =>
  esc(s).replace(/&lt;u&gt;/g, "<u>").replace(/&lt;\/u&gt;/g, "</u>");

const STOP = new Set(
  "the a an and or but of to in on for with as at by from is are was were be been being it its this that these those their his her they we you i not no can will would could should may might do does did have has had more most than then so such which who whom whose what when where how why about into over under between among own same other another each every all any some one two three new good well also just only very much many".split(" ")
);
const plainWords = (s: string) =>
  String(s ?? "").toLowerCase().replace(/<\/?[a-z]+>/g, " ").match(/[a-z][a-z'’-]*/g) ?? [];
const contentWords = (s: string) => plainWords(s).filter((w) => w.length > 2 && !STOP.has(w));

function grams(s: string, n = 3): Set<string> {
  const w = plainWords(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}
/** a 가 b 안에 얼마나 들어 있나 (0~1) */
function within(a: string, b: string): number {
  const ga = grams(a);
  if (ga.size === 0) return 0;
  const gb = grams(b);
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit += 1;
  return hit / ga.size;
}
/** 지문에 세 번 넘게 나오는 낱말 — 주제어라 보기마다 들어 있어 「같은 사실」의 근거가 못 된다 */
function topicWords(body: string): Set<string> {
  const n = new Map<string, number>();
  for (const w of contentWords(body)) n.set(w, (n.get(w) ?? 0) + 1);
  return new Set([...n].filter(([, k]) => k >= 3).map(([w]) => w));
}

function sharedContent(a: string, b: string): string[] {
  const set = new Set(contentWords(b));
  return [...new Set(contentWords(a).filter((w) => set.has(w)))];
}

/** 한글 진술끼리 — 띄어쓰기·문장부호를 빼고 두 글자 묶음이 a 쪽에서 얼마나 b 에 들어 있나 */
function koWithin(a: string, b: string): number {
  const g = (x: string) => {
    const t = x.replace(/[^가-힣A-Za-z0-9]/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const ga = g(a);
  if (ga.size < 6) return 0;
  const gb = g(b);
  let hit = 0;
  for (const x of ga) if (gb.has(x)) hit += 1;
  return hit / ga.size;
}

const CIRCLED = "①②③④⑤";
const circledNo = (s: string | null | undefined): number | null => {
  const i = CIRCLED.indexOf(String(s ?? "").trim().charAt(0));
  return i >= 0 ? i + 1 : null;
};
const dateLabel = (at: string | null | undefined) => {
  const m = String(at ?? "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
};

// ── 시험지 쪽 글을 문항별로 자른다
type ExamBlock = { stem: string; body: string; choices: string[] };

const itemKey = (no: string) => {
  const d = String(no ?? "").match(/\d+/)?.[0] ?? "";
  return /서|논|답/.test(String(no)) ? `서${d}` : d;
};

/**
 * 쪽 머리말·꼬리말인가 — 「1학년 공통영어2 1교시」, 「1학년 공통영어2　6/8」, 「7/8」, 「성명 (   )」 같은 줄.
 * 선생님 지적(2026-10-15 호원고1): 이런 줄이 문제 본문에 끼어 들어갔다. 쪽마다 띄어쓰기·오타(공동영어2)가 달라
 * 글자로 같은지 보지 않고 꼴로 가린다 — 영어 낱말이 없고 학년·교시·과목·쪽 번호로 된 짧은 줄.
 */
export function isPageChrome(line: string): boolean {
  const t = line.replace(/[\s\u3000]+/g, " ").trim();
  if (!t) return false;
  // 시험지 끝 안내문(「※ 확인사항」, 「이 시험문제의 저작권은 …」)은 문제가 아니다(상우고1 28번에 섞임, 2026-10-15)
  if (/저작권|확인\s*사항|전재와\s*복제|무단\s*(복제|전재)|처벌될\s*수/.test(t)) return true;
  if (/^[-–(]?\s*\d+\s*[/)]?\s*\d*\s*[-–)]?$/.test(t)) return true; // 7/8 · - 3 - · (3)
  if (/[A-Za-z]{3}/.test(t.replace(/공통영어|영어/g, ""))) return false;
  if (t.length > 60 || /^[①②③④⑤]/.test(t)) return false;
  // 학년·교시·과목·반·쪽 번호 말고 다른 글이 없는 줄만 — 「1학년 때 나는 …」 같은 우리말 문장은 남긴다
  const rest = t.replace(/\d+\s*\/\s*\d+|\d|학년도|학년|학기|교시|반|번|공통영어|공동영어|영어|과목|[()\[\]/·.,:-]|\s/g, "");
  return rest.length === 0 || /교시|학년도|정기시험|지필평가|성명|학번|수험번호|답안지|문제지|감독/.test(t);
}

/** 쪽 사이 표지 — 쪽 글을 이어 붙여 splitExamBlocks 에 넘길 때 사이에 넣는다 */
export const PAGE_BREAK = "<<PAGE>>";

export function splitExamBlocks(pageText: string): Map<string, ExamBlock> {
  const lines = String(pageText ?? "")
    .split(/\r?\n/)
    .filter((l) => l === PAGE_BREAK || !isPageChrome(l));
  const raw = new Map<string, string[]>();
  const shared = new Map<string, string[]>();
  let cur: string | null = null;
  let group: { from: number; to: number; lines: string[] } | null = null;
  /*
   * 쪽 맨 위, 첫 문항 번호 앞 글은 앞 쪽에서 넘어온 것 — 그 쪽 첫 문항의 바로 앞 번호에 붙인다.
   * 사진이 쪽 순서대로 올라오지 않으면 저장 순서상 앞 문항에 붙어, 15번 보기가 빠지고 17번에 다른 지문이 섞였다(호원고1, 2026-10-21).
   */
  const groups: Array<{ from: number; to: number; lines: string[] }> = [];
  let orphan: string[] | null = null;
  let prevCur: string | null = null;
  const carried = new Map<string, string[]>();
  // 번호로 자리를 못 정한 넘어온 글은 예전처럼 저장 순서상 앞 문항에 붙인다(버리지 않는다)
  const flushOrphan = () => {
    if (orphan?.length && prevCur && raw.has(prevCur)) raw.get(prevCur)!.push(...orphan);
    orphan = null;
  };
  for (const line of lines) {
    if (line === PAGE_BREAK) {
      flushOrphan();
      prevCur = cur;
      cur = null;
      // 묶음 머리(「[10, 논술형 3]」)는 다음 쪽 문항까지 이어진다 — 지문 아래 쪽에 10번 발문이 있었다(호원고1)
      orphan = [];
      continue;
    }
    // 「[1~2] 다음 글을 …」, 「[13, 논술형 4] 다음 글을 …」 — 지문 하나를 여러 문항이 같이 쓴다
    const head = line.match(/^\s*\[\s*(\d{1,2})\s*(?:[~∼-]\s*(\d{1,2})\s*)?(?:\]|,[^\]]*\])/);
    const num = line.match(/^\s*(\d{1,2})\s*[.)]\s+\S/);
    const subj = line.match(/^\s*[[<]?\s*(?:서술형|서답형|논술형)\s*(\d{1,2})\s*[\]>]?/);
    if (head) {
      flushOrphan();
      group = { from: Number(head[1]), to: Number(head[2] ?? head[1]), lines: [line.replace(head[0], "").trim()] };
      groups.push(group);
      cur = null;
      continue;
    }
    if (num || subj) {
      if (orphan?.length && num && Number(num[1]) > 1) {
        const prev = String(Number(num[1]) - 1);
        carried.set(prev, [...(carried.get(prev) ?? []), ...orphan]);
        orphan = null;
      }
      flushOrphan();
      cur = num ? String(Number(num[1])) : `서${Number(subj![1])}`;
      if (!raw.has(cur)) raw.set(cur, [line]);
      else cur = null; // 같은 번호가 또 나오면(정답표 등) 앞 것을 쓴다
      if (cur && group && num && Number(num[1]) >= group.from && Number(num[1]) <= group.to) {
        shared.set(cur, group.lines);
      }
      continue;
    }
    if (orphan) {
      orphan.push(line);
      continue;
    }
    if (cur) raw.get(cur)!.push(line);
    else if (group) group.lines.push(line);
  }
  flushOrphan();
  for (const [k, ls] of carried) if (raw.has(k)) raw.get(k)!.push(...ls);
  // 묶음 머리와 그 문항이 다른 쪽에 있으면(쪽 순서가 섞여 사이에 다른 묶음이 끼면) 번호 범위로 다시 잇는다(호원고1 10번)
  for (const k of raw.keys()) {
    if (shared.has(k) || !/^\d+$/.test(k)) continue;
    const g = groups.find((x) => Number(k) >= x.from && Number(k) <= x.to);
    if (g) shared.set(k, g.lines);
  }
  const out = new Map<string, ExamBlock>();
  for (const [k, ls] of raw) {
    const stem = (ls[0] ?? "").replace(/^\s*(\d{1,2}\s*[.)]|[[<]?\s*(서술형|서답형|논술형)\s*\d+\s*[\]>]?)\s*/, "").trim();
    const body: string[] = [];
    const choices: string[] = [];
    for (const l of [...(shared.get(k)?.slice(1) ?? []), ...ls.slice(1)]) {
      if (/^\s*[①②③④⑤]/.test(l)) {
        for (const c of l.split(/(?=[①②③④⑤])/)) if (c.trim()) choices.push(c.trim().slice(1).trim());
      } else if (l.trim() && !/^\s*-?\s*\d+\s*(\/\s*\d+)?\s*-?\s*$/.test(l)) body.push(l.trim());
    }
    out.set(k, { stem, body: body.join("\n"), choices: choices.slice(0, 5) });
  }
  return out;
}

// ── 묻는 자리
/** mark: 밑줄 바로 앞 ①~⑤ 표지(있으면) — 정답 자리를 가리는 데 쓴다 */
type Spot = { inner: string; left: string; right: string; mark?: string };

function spotsOf(text: string): Spot[] {
  const t = String(text ?? "");
  const out: Spot[] = [];
  // (A)·ⓐ·① 같은 표지는 낱말로 치지 않는다
  // 대화문 화자 표시(B:, G:)도 뺀다
  const clean = (x: string) => x.replace(/\([A-Ha-h]\)|[①-⑤ⓐ-ⓗ]|(^|\s)[A-Z]:(?=\s)/g, " ");
  const ctx = (at: number, end: number) => ({
    left: plainWords(clean(t.slice(Math.max(0, at - 80), at))).slice(-3).join(" "),
    right: plainWords(clean(t.slice(end, end + 80))).slice(0, 3).join(" "),
  });
  for (const m of t.matchAll(/<u>([\s\S]*?)<\/u>/g)) {
    if (m.index === undefined) continue;
    const mark = t.slice(Math.max(0, m.index - 5), m.index).match(/[①②③④⑤ⓐ-ⓗ]|\([a-eA-E]\)/)?.[0]?.toLowerCase();
    out.push({ inner: m[1] ?? "", ...ctx(m.index, m.index + m[0].length), mark });
  }
  for (const m of t.matchAll(/_{3,}|\(\s*[A-E]\s*\)\s*_{2,}|_{2,}\s*\(\s*[A-E]\s*\)\s*_{2,}/g)) {
    if (m.index === undefined) continue;
    out.push({ inner: "", ...ctx(m.index, m.index + m[0].length) });
  }
  return out;
}

/**
 * 학교가 원문에서 바꾼 자리 — 시험 지문과 원래 지문을 낱말로 맞대어 1~2낱말이 바뀐 곳.
 *
 * 어법 문장 고르기처럼 밑줄이 없는 문항은 시험지만으로는 어디를 물었는지 모른다.
 * 학교는 틀린 자리를 만들려고 원문 낱말을 바꾸므로, 바뀐 곳이 곧 묻는 자리다(2026-10-15).
 */
const FUNCTION_WORDS = new Set(
  "a an the is are was were be been being am do does did have has had which what that where when who whom whose why how it its they them their this these those to with by of for in on at from as than and or but if whether not no".split(" ")
);
/** 어법으로 바꾼 곳인가 — 같은 낱말의 다른 꼴(stand→standing)이거나 기능어(is→are, which→what)가 끼었다 */
function grammarChange(exam: string[], orig: string[]): boolean {
  if ([...exam, ...orig].some((w) => FUNCTION_WORDS.has(w))) return true;
  return exam.some((a) => orig.some((b) => a.slice(0, 4) === b.slice(0, 4) && a !== b));
}

function diffSpots(exam: string, orig: string, kind: "grammar" | "vocab" | "any" = "any"): Spot[] {
  const clean = (x: string) => x.replace(/<\/?u>/g, " ").replace(/\([A-Ha-h]\)|[①-⑤ⓐ-ⓗ]|(^|\s)[A-Z]:(?=\s)/g, " ");
  const A = plainWords(clean(exam));
  const B = plainWords(clean(orig));
  const n = A.length;
  const m = B.length;
  if (!n || !m || n * m > 400000) return [];
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }
  const out: Spot[] = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && A[i] === B[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const si = i;
    const sj = j;
    while (i < n && !(j < m && A[i] === B[j])) {
      if (j < m && L[i]![j + 1]! >= L[i + 1]![j]!) j += 1;
      else i += 1;
    }
    const ex = i - si;
    const or = j - sj;
    // 1~2낱말을 바꾼 곳만 — 문장을 통째로 고쳐 쓴 곳은 묻는 자리가 아니다
    const g = grammarChange(A.slice(si, i), B.slice(sj, j));
    const fits = kind === "any" || (kind === "grammar" ? g : !g && or >= 1);
    if (ex >= 1 && ex <= 2 && or <= 2 && si >= 3 && fits) {
      out.push({
        inner: A.slice(si, i).join(" "),
        left: A.slice(si - 3, si).join(" "),
        right: A.slice(i, i + 3).join(" "),
      });
    }
  }
  return out;
}

/** 두 자리가 같은 곳인가 — 앞 세 낱말이나 뒤 세 낱말이 같다 */
const sameSpot = (a: Spot, b: Spot) =>
  (a.left.split(" ").length === 3 && a.left === b.left) || (a.right.split(" ").length === 3 && a.right === b.right);

type Family = "underline" | "blank" | "idea" | "content" | "insertion" | "order" | "irrelevant" | "writing" | "other";

function familyOf(typeName: string, subjective: boolean): Family {
  const t = typeName.replace(/\s/g, "");
  if (t.includes("영작")) return "writing";
  if (t.includes("삽입")) return "insertion";
  if (t.includes("순서")) return "order";
  if (t.includes("무관")) return "irrelevant";
  if (/빈칸|요약/.test(t) && !subjective) return "blank";
  if (/어법|어휘|밑줄|지칭|영영/.test(t) && !subjective) return "underline";
  if (/주제|제목|요지|주장|목적/.test(t) && !subjective) return "idea";
  if (/일치/.test(t)) return "content";
  if (subjective) return "writing";
  return "other";
}

type Made = {
  id: string;
  option_key: string;
  instruction: string | null;
  question_text: string | null;
  passage_modified: string | null;
  /** 지문을 바꾸지 않는 유형(내용 일치 등)은 passage_modified 가 비어 원문만 있다 */
  passage_original?: string | null;
  choices: unknown;
  correct_answer: unknown;
  created_at: string | null;
  item_no: number | null;
  generation_job_id: string | null;
};

const choiceTexts = (c: unknown): string[] =>
  Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : String((x as { text?: string })?.text ?? ""))) : [];

function answerOf(q: Made): { no: number | null; text: string } {
  const raw = String(q.correct_answer ?? "").trim();
  const no = /^[1-5]$/.test(raw) ? Number(raw) : circledNo(raw);
  const cs = choiceTexts(q.choices);
  if (no && cs[no - 1]) return { no, text: cs[no - 1]! };
  return { no: null, text: raw };
}

/** 서술형 모범 답을 조각으로 — 「1-1 … / 1-2 …」, 「(A) … / (B) …」 */
const answerParts = (a: string) =>
  String(a ?? "")
    .split(/\s*\/\s*|\n|(?=\(\w\)\s)|(?=\d-\d\s)/)
    .map((x) => x.replace(/^\(?\w\)?\s*|^\d-\d\s*/, "").trim())
    .filter(Boolean);

/** 지문 속 ①~⑤ 표지 뒤 문장 */
const afterMarker = (t: string, n: number | null) => (n ? (t.split(/[①②③④⑤]/)[n] ?? "").trim() : "");

/** 우리 문항 하나가 시험의 그 자리를 물었는가 — 같다면 무엇이 같은지 */
function judge(
  fam: Family,
  exam: { block: ExamBlock; answer: string; spots: Spot[]; answerNo: number | null },
  q: Made
): { same: boolean; marks: string[]; compare?: BookCompare } {
  const mod = String(q.passage_modified ?? "");
  const ans = answerOf(q);
  const examAll = `${exam.block.body}\n${exam.block.choices.join("\n")}`;
  if (fam === "underline" || fam === "blank") {
    const mine = spotsOf(mod);
    for (const s of exam.spots) {
      const m = mine.find((x) => sameSpot(s, x));
      if (!m) continue;
      const examSide = `… ${s.left} [${s.inner ? s.inner.replace(/<\/?u>/g, "") : "_____"}] ${s.right} …`;
      const ourInner = m.inner ? m.inner.replace(/<\/?u>/g, "") : ans.text;
      return {
        same: true,
        marks: [ourInner].filter((x) => x.trim().length > 1),
        compare: {
          exam: examSide,
          ours: `… ${m.left} [${ourInner || "_____"}] ${m.right} …`,
          same: fam === "blank" ? "같은 문장의 같은 자리를 비움" : "같은 낱말 자리에 밑줄",
        },
      };
    }
    // 학교가 빈칸 둘레를 조금 고쳐도 빈칸이 든 문장이 같으면 같은 빈칸이다
    if (fam === "blank") {
      const blankSentence = (t: string) =>
        (t.replace(/<\/?u>/g, "").split(/(?<=[.!?]["”’]?)\s+/).find((x) => /_{3,}/.test(x)) ?? "").replace(/_{2,}|\(\s*[A-E]\s*\)/g, " ");
      const es = blankSentence(exam.block.body);
      const ms = blankSentence(mod);
      if (plainWords(es).length >= 6 && plainWords(ms).length >= 6 && within(es, ms) >= 0.5) {
        return {
          same: true,
          marks: [ans.text].filter((x) => x.length > 2),
          compare: { exam: es.trim(), ours: ms.trim(), same: "빈칸이 든 문장이 같음" },
        };
      }
    }
    // 빈칸·요약은 정답 표현이 겹치는지도 본다
    if (fam === "blank" && exam.answer && ans.text) {
      const sh = sharedContent(exam.answer, ans.text);
      if (sh.length >= 3) {
        return {
          same: true,
          marks: sh,
          compare: { exam: exam.answer, ours: ans.text, same: `정답 표현이 겹침: ${sh.join(" · ")}` },
        };
      }
    }
    return { same: false, marks: [] };
  }
  if (fam === "idea") {
    if (!exam.answer || !ans.text) return { same: false, marks: [] };
    const sh = sharedContent(exam.answer, ans.text);
    const base = Math.min(contentWords(exam.answer).length, contentWords(ans.text).length) || 1;
    if (sh.length >= 2 && sh.length / base >= 0.34) {
      return { same: true, marks: sh, compare: { exam: exam.answer, ours: ans.text, same: `정답 표현이 겹침: ${sh.join(" · ")}` } };
    }
    return { same: false, marks: [] };
  }
  if (fam === "content") {
    /*
     * 시험 정답 진술(영어 보기, 아니면 지문 속 ④ 뒤 문장)과 우리 보기가 같은 사실이어야 한다.
     * 도표 항목 이름(Less Time Getting Ready for Work 등)만 겹치는 것은 다른 사실이다(2026-10-15 발곡고1 11번).
     */
    // 한글 보기면 우리 문항의 한글 보기와 글자로 견준다
    if (/[가-힣]{4}/.test(exam.answer)) {
      for (const c of choiceTexts(q.choices)) {
        if (/[가-힣]{4}/.test(c) && koWithin(exam.answer, c) >= 0.6) {
          return { same: true, marks: [c], compare: { exam: exam.answer, ours: c, same: "같은 사실을 보기로 다룸" } };
        }
      }
      return { same: false, marks: [] };
    }
    const stmt = /[a-z]{3}/i.test(exam.answer) && !/[가-힣]/.test(exam.answer) ? exam.answer : afterMarker(exam.block.body, exam.answerNo);
    const topic = topicWords(exam.block.body);
    const base = contentWords(stmt).filter((w) => !topic.has(w)).length;
    if (base < 3) return { same: false, marks: [] };
    for (const c of choiceTexts(q.choices)) {
      const sh = sharedContent(stmt, c).filter((w) => !topic.has(w));
      if (sh.length >= 3 && sh.length / base >= 0.6) {
        return { same: true, marks: [c], compare: { exam: stmt, ours: c, same: "같은 사실을 보기로 다룸" } };
      }
    }
    return { same: false, marks: [] };
  }
  if (fam === "insertion") {
    const given = exam.block.body.split("\n")[0] ?? "";
    const qt = String(q.question_text ?? "");
    if (given.length > 20 && qt.length > 20 && within(given, qt) >= 0.6) {
      return {
        same: true,
        marks: [qt.trim()],
        compare: { exam: given, ours: qt, same: exam.answerNo && ans.no === exam.answerNo ? "주어진 문장이 같음 · 정답 자리도 같음" : "주어진 문장이 같음" },
      };
    }
    return { same: false, marks: [] };
  }
  if (fam === "order") {
    const ord = (s: string) => (s.match(/\(([A-C])\)/g) ?? []).join("-");
    const eo = ord(exam.answer);
    const mo = ord(ans.text);
    if (!eo || eo !== mo) return { same: false, marks: [] };
    const chunk = mod.match(/\(A\)\s*([^\n(]{20,})/)?.[1] ?? "";
    const head = plainWords(chunk).slice(0, 5).join(" ");
    if (head.split(" ").length === 5 && plainWords(examAll).join(" ").includes(head)) {
      return { same: true, marks: [], compare: { exam: exam.answer, ours: ans.text, same: "덩어리를 나눈 자리와 정답 순서가 같음" } };
    }
    return { same: false, marks: [] };
  }
  if (fam === "irrelevant") {
    const es = afterMarker(exam.block.body, exam.answerNo);
    const ms = afterMarker(mod.replace(/<\/?u>/g, ""), ans.no);
    if (es.length > 20 && ms.length > 20 && within(es, ms) >= 0.6) {
      return { same: true, marks: [ms], compare: { exam: es, ours: ms, same: "흐름과 무관한 문장이 같음" } };
    }
    return { same: false, marks: [] };
  }
  if (fam === "writing") {
    if (exam.answer.length > 15 && ans.text.length > 15 && within(exam.answer, ans.text) >= 0.5) {
      return { same: true, marks: [ans.text], compare: { exam: exam.answer, ours: ans.text, same: "모범 답과 같은 문장을 미리 씀" } };
    }
    // 모범 답이 조각(1-1 · 1-2, (A) · (B))이면 한 조각이라도 통째로 같으면 같은 자리다
    for (const part of answerParts(exam.answer)) {
      if (plainWords(part).length >= 4 && within(part, String(ans.text ?? "")) >= 0.85) {
        return { same: true, marks: [part], compare: { exam: part, ours: ans.text, same: "모범 답 조각과 같은 답을 미리 씀" } };
      }
    }
    return { same: false, marks: [] };
  }
  return { same: false, marks: [] };
}

/**
 * 같은 자리는 아니어도 「이 문제를 풀었으면 바로 풀리는가」 — ② 유사의 근거.
 *
 * 선생님 지적(2026-10-15 호원고1): 같은 지문에 같은 유형이 있기만 하면 ②로 세어 「같은 유형 50번」처럼 부풀고
 * 근거가 엉뚱했다. 손으로 만들 때처럼 ②에도 겹치는 것을 요구한다. 삽입·순서·무관한 문장만 지문 + 유형으로 충분하다.
 */
function judgeNear(
  fam: Family,
  exam: { block: ExamBlock; answer: string; allSpots: Spot[]; answerNo: number | null },
  q: Made
): { near: boolean; marks: string[]; compare?: BookCompare } {
  const mod = String(q.passage_modified ?? "");
  const ans = answerOf(q);
  const ins = String(q.instruction ?? "").replace(/\s+/g, " ").slice(0, 60);
  if (fam === "insertion" || fam === "order" || fam === "irrelevant") {
    const ord = (x: string) => (x.match(/\(([A-C])\)/g) ?? []).join("-");
    const sameOrder = fam === "order" && ord(exam.answer) !== "" && ord(exam.answer) === ord(ans.text);
    return {
      near: true,
      marks: [],
      compare: {
        exam: exam.block.stem || exam.answer,
        ours: ins,
        same: sameOrder ? "같은 지문 순서 배열 · 정답 순서도 같음" : "같은 지문을 같은 유형으로 풀었음",
      },
    };
  }
  if (fam === "underline" || fam === "blank") {
    const mine = spotsOf(mod);
    for (const s of exam.allSpots) {
      const m = mine.find((x) => sameSpot(s, x));
      if (!m) continue;
      const inner = untagU(m.inner) || ans.text;
      return {
        near: true,
        marks: [inner].filter((x) => x.trim().length > 1),
        compare: { exam: examSideOf(s), ours: `… ${m.left} [${inner || "_____"}] ${m.right} …`, same: "정답은 아니지만 시험이 물은 다른 자리를 같이 물음" },
      };
    }
    if (fam === "blank" && exam.answer && ans.text) {
      const sh = sharedContent(exam.answer, ans.text);
      if (sh.length >= 2) return { near: true, marks: sh, compare: { exam: exam.answer, ours: ans.text, same: `정답 표현 일부가 겹침: ${sh.join(" · ")}` } };
    }
    return { near: false, marks: [] };
  }
  if (fam === "idea") {
    // 지문 주제어(The Connoisseur 등)만 겹친 것은 근거가 못 된다
    const topic = topicWords(exam.block.body);
    const sh = sharedContent(exam.answer, ans.text).filter((w) => !topic.has(w));
    if (sh.length >= 2) return { near: true, marks: sh, compare: { exam: exam.answer, ours: ans.text, same: `정답 표현 일부가 겹침: ${sh.join(" · ")}` } };
    return { near: false, marks: [] };
  }
  if (fam === "content") {
    const ko = /[가-힣]{4}/.test(exam.answer);
    const stmt = ko ? exam.answer : /[a-z]{3}/i.test(exam.answer) ? exam.answer : afterMarker(exam.block.body, exam.answerNo);
    for (const c of choiceTexts(q.choices)) {
      const ok = ko
        ? /[가-힣]{4}/.test(c) && koWithin(stmt, c) >= 0.45
        : (() => {
            const topic = topicWords(exam.block.body);
            const sh = sharedContent(stmt, c).filter((w) => !topic.has(w));
            const base = contentWords(stmt).filter((w) => !topic.has(w)).length || 1;
            return sh.length >= 3 && sh.length / base >= 0.5;
          })();
      if (ok) return { near: true, marks: [c], compare: { exam: stmt, ours: c, same: "비슷한 사실을 보기로 다룸" } };
    }
    return { near: false, marks: [] };
  }
  if (fam === "writing") {
    // 모범 답이 여러 조각(1-1, 1-2, (A)·(B))이면 조각마다 견준다
    const parts = answerParts(exam.answer).filter((x) => x.length > 12);
    const theirs = String(ans.text ?? "");
    for (const part of parts) {
      if (theirs.length > 12 && (within(part, theirs) >= 0.5 || within(theirs, part) >= 0.6)) {
        return { near: true, marks: [theirs], compare: { exam: part, ours: theirs, same: "모범 답 일부를 미리 써 봄" } };
      }
    }
    return { near: false, marks: [] };
  }
  return { near: false, marks: [] };
}

const untagU = (x: string) => x.replace(/<\/?u>/g, "");

/** <mark> 를 HTML 글자 위에 덧칠한다(태그 안은 건드리지 않는다) */
function markHtml(html: string, marks: string[]): string {
  let out = html;
  for (const m of [...new Set(marks)].filter((x) => x.trim().length > 2).sort((a, b) => b.length - a.length)) {
    const pat = esc(m.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    try {
      out = out.replace(new RegExp(`(?<!\\w)(${pat})(?![^<]*>)`, "i"), "<mark>$1</mark>");
    } catch {
      /* 이상한 글자가 섞이면 표시만 건너뛴다 */
    }
  }
  return out;
}

/** 시험 지문 — 묻는 자리는 빨간 상자, 나머지 문장은 군데군데 흐리게 */
function examHtml(fam: Family, block: ExamBlock): string {
  const lines = block.body.split("\n");
  const keyLine = fam === "insertion" ? 0 : -1;
  let n = 0;
  return lines
    .map((line, li) => {
      if (li === keyLine) return `<span class="key">${keepU(line)}</span>`;
      return line
        .split(/(?<=[.!?]["”’]?)\s+/)
        .map((s) => {
          const h = keepU(s)
            .replace(/<u>([\s\S]*?)<\/u>/g, '<span class="key"><u>$1</u></span>')
            .replace(/(_{3,}|\(\s*[A-E]\s*\)\s*_{2,})/g, '<span class="key">$1</span>');
          n += 1;
          if (h.includes('class="key"') || s.length < 40 || n % 3 !== 2) return h;
          // 문장 가운데 3분의 1을 흐린다 — 내용을 다 보이지 않게(선생님 지시 2026-10-13)
          const w = h.split(" ");
          const a = Math.floor(w.length / 3);
          const b = Math.floor((w.length * 2) / 3);
          return [...w.slice(0, a), `<span class="blur">${w.slice(a, b).join(" ")}</span>`, ...w.slice(b)].join(" ");
        })
        .join(" ");
    })
    .join("<br>");
}

// ── 수업자료 — 워크북 · 1장 테스트지 · 1장 요약자료
/*
 * 선생님 지시(2026-10-15 「DB에 있을텐데?」): 변형문제만이 아니라 수업자료에서도 그 자리를 찾는다.
 * 워크북·1장 테스트지는 지문이 [왼 / 오른] 괄호·틀린 자리 표시와 함께 저장돼 있고,
 * 1장 요약자료는 지문(수업자료 프로젝트)마다 어법 포인트·어휘·출제 자리·제목·요약문이 저장돼 있다.
 * 같은 자리를 다뤘으면 근거로 넣는다. 형식이 시험과 같은 것(영작 → 영작)만 ①, 나머지는 ②로 센다.
 */
type Seg = { type?: string; text?: string; leftText?: string; rightText?: string };
type SegRow = { html: string; spots: Spot[] };
/** level cand: 규칙으로는 자리를 못 찾았지만 지문이 나오는 곳 — 모델 판정에만 후보로 넘긴다 */
type MatHit = { level: "same" | "similar" | "cand"; source: string; date: string; lineHtml: string; compare: BookCompare; typeSame?: boolean };

/** 괄호·틀린 자리 조각을 문장 단위 줄로 */
function segRows(segs: Seg[]): SegRow[] {
  const rows: SegRow[] = [];
  let html = "";
  let marked = "";
  const flush = () => {
    if (marked.trim()) rows.push({ html: html.trim(), spots: spotsOf(marked) });
    html = "";
    marked = "";
  };
  for (const s of segs) {
    if (s.type === "choice") {
      html += `<b class="br">[${esc(s.leftText ?? "")} / ${esc(s.rightText ?? "")}]</b>`;
      marked += `<u>${s.leftText ?? ""}</u>`;
    } else if (s.type === "spot") {
      html += `<b class="br">${esc(s.text ?? "")}</b>`;
      marked += `<u>${s.text ?? ""}</u>`;
    } else {
      const parts = String(s.text ?? "").split(/(?<=[.!?]["”’]?)\s+/);
      parts.forEach((p, i) => {
        if (i > 0) flush();
        const tail = i < parts.length - 1 ? " " : "";
        html += esc(p) + tail;
        marked += p + tail;
      });
      // 조각이 문장 끝에서 끝나면(대화문 빈칸 쓰기처럼 문장마다 조각이 나뉜 경우) 거기서 끊는다
      if (/[.!?]["”’]?\s*$/.test(String(s.text ?? ""))) flush();
    }
  }
  flush();
  return rows;
}

const plainOfSegs = (segs: Seg[]) => segs.map((s) => (s.type === "choice" ? s.leftText : s.text) ?? "").join("");
const examSideOf = (s: Spot) => `… ${s.left} [${s.inner.replace(/<\/?u>/g, "") || "_____"}] ${s.right} …`;
const untag = (h: string) =>
  h.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** 문장 안 낱말 자리를 Spot 과 표시 HTML 로 */
function spotIn(sentence: string, surface: string, shown: string, from = 0): { spot: Spot; html: string } | null {
  const i = sentence.toLowerCase().indexOf(surface.toLowerCase(), from);
  if (!surface.trim() || i < 0) return null;
  const a = sentence.slice(0, i);
  const b = sentence.slice(i, i + surface.length);
  const c = sentence.slice(i + surface.length);
  const spot = spotsOf(`${a}<u>${b}</u>${c}`)[0];
  if (!spot) return null;
  return { spot, html: `${esc(a)}<b class="br hit">${esc(shown)}</b>${esc(c)}` };
}

type MatCtx = {
  body: string;
  fam: Family;
  spots: Spot[];
  /** 영작·빈칸·제목 등 정답 글 */
  answer: string;
  /** 내용 일치: 정답 진술(영어) */
  stmt: string;
  /** 문장삽입: 주어진 문장 */
  given: string;
  cutoffMs: number;
  /** 이 시험지 학교 — 다른 학교 이름이 붙은 자료는 뺀다 */
  school: string;
};

const WB_SPOT: Array<[string, string]> = [
  ["grammarChoiceSections", "어법 선택"],
  ["vocabChoiceSections", "어휘 선택"],
  ["grammarFixSections", "어법 수정"],
  ["vocabFixSections", "어휘 수정"],
];
const WB_WRITE: Array<[string, string]> = [
  ["keyWordOrderSections", "중요문장 어순배열"],
  ["wordOrderWritingSections", "어순 배열 영작"],
  ["fullEnWritingSections", "통영작"],
];

async function materialHits(admin: SupabaseClient, academyId: string, ctx: MatCtx): Promise<MatHit[]> {
  // 시험 지문과 같은 수업자료 지문(교과서 대화문도 여기 있다)
  const pidSet = new Set<string>();
  for (const p of probes(ctx.body)) {
    const { data } = await admin.from("lesson_material_items").select("project_id").ilike("english_text", `%${p}%`).limit(50);
    for (const r of data ?? []) pidSet.add(String(r.project_id));
  }
  if (pidSet.size === 0) return [];
  const { data: projects } = await admin
    .from("lesson_material_projects")
    .select("id, title, lesson_pack_json")
    .eq("academy_id", academyId)
    // 지운 프로젝트도 센다 — 시험 전에 학생에게 준 자료는 그대로이고, 워크북·1장 문서도 남아 있다.
    // 지운 것을 빼니 호원고1 워크북·1장 자료가 하나도 안 잡혔다(2026-10-21, 지문 24개 프로젝트를 정리해 지움)
    .in("id", [...pidSet]);
  const pids = (projects ?? []).map((p) => String(p.id));
  if (pids.length === 0) return [];
  const before = (at: unknown) => {
    const t = at ? new Date(String(at)).getTime() : NaN;
    return Number.isFinite(t) && t < ctx.cutoffMs;
  };
  const out: MatHit[] = [];
  const add = (h: MatHit) => {
    if (!out.some((x) => x.source === h.source && x.lineHtml === h.lineHtml)) out.push(h);
  };
  const ofThis = (text: string, projectId?: unknown) =>
    (!!projectId && pids.includes(String(projectId))) || (text.length > 40 && within(text, ctx.body) >= 0.3);
  /*
   * 자료 묶음 — 규칙이 같은 자리를 못 잡아도 모델이 읽고 가리도록, 이 지문을 다룬 자료의 내용(괄호 자리 · T/F ·
   * 영작 · 해석 · 어법/어휘 포인트 · 출제 자리)을 자료마다 한 덩어리로 모은다(2026-10-15 손 판정과 차이 줄이기).
   */
  const pack = new Map<string, { date: string; lines: string[] }>();
  const put = (source: string, date: string, line: string) => {
    const l = line.replace(/\s+/g, " ").trim();
    if (l.length < 4) return;
    const p = pack.get(source) ?? { date, lines: [] };
    if (!p.lines.includes(l)) p.lines.push(l);
    pack.set(source, p);
  };
  const near = (en: string) => en.length > 15 && within(en, ctx.body) >= 0.5;

  /** 괄호·틀린 자리 줄에서 시험 자리와 같은 곳을 찾는다 */
  const spotRows = (rows: SegRow[], source: string, date: string, what: string) => {
    for (const r of rows) {
      const s = ctx.spots.find((e) => r.spots.some((x) => sameSpot(e, x)));
      if (!s) continue;
      const at = r.spots.findIndex((x) => sameSpot(s, x));
      let k = -1;
      const html = r.html.replace(/<b class="br">/g, (m) => (++k === at ? '<b class="br hit">' : m));
      add({ level: "similar", source, date, lineHtml: html, compare: { exam: examSideOf(s), ours: untag(html), same: what } });
    }
  };
  const writeRow = (text: string, source: string, date: string, what: string, level: "same" | "similar" = "same") => {
    // 짧은 정답(열 낱말 미만)은 거의 통째로 같아야 한다 — 「Is there anything else I …」 앞부분만 같은 문장 막기
    const need = plainWords(ctx.answer).length < 10 ? 0.8 : 0.6;
    if (ctx.answer.length > 15 && text.length > 15 && within(ctx.answer, text) >= need) {
      add({
        level,
        source,
        date,
        lineHtml: `<b class="br hit">${esc(text)}</b>`,
        compare: { exam: ctx.answer, ours: text, same: what },
      });
    }
  };
  const tfRow = (statement: string, source: string, date: string) => {
    const base = contentWords(ctx.stmt).length;
    const sh = sharedContent(ctx.stmt, statement);
    if (base >= 4 && sh.length >= 4 && sh.length / base >= 0.6) {
      add({
        level: "similar",
        source,
        date,
        lineHtml: `<b class="br hit">${esc(statement)}</b>`,
        compare: { exam: ctx.stmt, ours: statement, same: "같은 사실을 T/F로 다룸" },
      });
    }
  };

  // 워크북 · 1장 테스트지
  const { data: docs } = await admin
    .from("lesson_material_documents")
    .select("name, kind, created_at, payload")
    .eq("academy_id", academyId)
    .is("deleted_at", null)
    .in("kind", ["workbook", "one_page_test"])
    .overlaps("project_ids", pids)
    .limit(200);
  for (const d of docs ?? []) {
    if (!before(d.created_at) || otherSchool(String(d.name ?? ""), ctx.school)) continue;
    const p = (d.payload ?? {}) as Record<string, unknown>;
    const date = dateLabel(String(d.created_at ?? ""));
    const name = String(d.name ?? "");
    if (d.kind === "one_page_test") {
      const source = `1장 테스트지 「${name}」`;
      type TestPassage = {
        rows?: Array<{ segments?: Seg[]; writing?: { answer?: string } | null }>;
        tf?: Array<{ statement?: string }>;
      };
      for (const ps of (p.passages ?? []) as TestPassage[]) {
        const rows = ps.rows ?? [];
        if (!ofThis(rows.map((r) => plainOfSegs(r.segments ?? [])).join(" "))) continue;
        for (const r of rows) {
          for (const sr of segRows(r.segments ?? [])) if (sr.spots.length) put(source, date, untag(sr.html));
          if (r.writing?.answer) put(source, date, `영작: ${r.writing.answer}`);
        }
        for (const t of ps.tf ?? []) put(source, date, `T/F: ${t.statement ?? ""}`);
        if (ctx.fam === "underline" || ctx.fam === "blank") {
          spotRows(rows.flatMap((r) => segRows(r.segments ?? [])), source, date, "1장 테스트지가 같은 자리를 괄호로 물음");
        }
        if (ctx.fam === "writing") {
          for (const r of rows) writeRow(String(r.writing?.answer ?? ""), source, date, "1장 테스트지에서 같은 문장을 영작함");
        }
        if (ctx.fam === "content") for (const t of ps.tf ?? []) tfRow(String(t.statement ?? ""), source, date);
      }
      continue;
    }
    {
      const src = `워크북 「${name}」`;
      for (const [key, label] of WB_SPOT) {
        for (const sct of (p[key] ?? []) as Array<{ segments?: Seg[]; projectId?: string }>) {
          if (!ofThis(plainOfSegs(sct.segments ?? []), sct.projectId)) continue;
          for (const sr of segRows(sct.segments ?? [])) if (sr.spots.length) put(src, date, `${label}: ${untag(sr.html)}`);
        }
      }
      type BTok = { type?: string; text?: string; answerText?: string };
      for (const sct of (p.blankSections ?? []) as Array<{ passageTokens?: BTok[]; projectId?: string }>) {
        const segs: Seg[] = (sct.passageTokens ?? []).map((t) => (t.type === "blank" ? { type: "spot", text: t.answerText ?? "" } : { type: "text", text: t.text ?? "" }));
        if (!ofThis(plainOfSegs(segs), sct.projectId)) continue;
        for (const sr of segRows(segs)) if (sr.spots.length) put(src, date, `빈칸 쓰기: ${untag(sr.html)}`);
      }
      for (const sct of (p.sections ?? []) as Array<{ passage?: string; items?: Array<{ statement?: string; answer?: string }> }>) {
        if (!ofThis(String(sct.passage ?? ""))) continue;
        for (const it of sct.items ?? []) put(src, date, `T/F(${it.answer ?? ""}): ${it.statement ?? ""}`);
      }
      for (const [key, label] of WB_WRITE) {
        for (const sct of (p[key] ?? []) as Array<{ items?: Array<{ english?: string; englishDisplay?: string }> }>) {
          for (const it of sct.items ?? []) {
            const en = String(it.english ?? it.englishDisplay ?? "");
            if (near(en)) put(src, date, `${label}: ${en}`);
          }
        }
      }
      for (const sct of (p.lineTranslationSections ?? []) as Array<{ items?: Array<{ english?: string; korean?: string }> }>) {
        for (const it of sct.items ?? []) if (near(String(it.english ?? ""))) put(src, date, `한 줄 해석: ${it.english} (${it.korean ?? ""})`);
      }
    }
    if (ctx.fam === "underline" || ctx.fam === "blank") {
      for (const [key, label] of WB_SPOT) {
        for (const s of (p[key] ?? []) as Array<{ segments?: Seg[]; projectId?: string }>) {
          const segs = s.segments ?? [];
          if (!ofThis(plainOfSegs(segs), s.projectId)) continue;
          spotRows(segRows(segs), `워크북 「${name}」 · ${label}`, date, `워크북 ${label}이 같은 자리를 물음`);
        }
      }
      // 빈칸 쓰기 — 지문 전체가 빈칸(정답 낱말) 표시와 함께 있다
      type BlankTok = { type?: string; text?: string; answerText?: string };
      for (const s of (p.blankSections ?? []) as Array<{ passageTokens?: BlankTok[]; projectId?: string }>) {
        const segs: Seg[] = (s.passageTokens ?? []).map((t) =>
          t.type === "blank" ? { type: "spot", text: t.answerText ?? "" } : { type: "text", text: t.text ?? "" }
        );
        if (!ofThis(plainOfSegs(segs), s.projectId)) continue;
        spotRows(segRows(segs), `워크북 「${name}」 · 빈칸 쓰기`, date, "워크북 빈칸 쓰기가 같은 자리를 비움");
      }
    }
    if (ctx.fam === "writing") {
      for (const [key, label] of WB_WRITE) {
        for (const s of (p[key] ?? []) as Array<{ items?: Array<{ english?: string; englishDisplay?: string }> }>) {
          for (const it of s.items ?? []) {
            const en = String(it.english ?? it.englishDisplay ?? "");
            writeRow(en, `워크북 「${name}」 · ${label}`, date, `워크북 ${label}에서 같은 문장을 영작함`);
          }
        }
      }
      // 한 줄 해석 — 같은 영어 문장을 우리말로 옮겨 봤다(형식이 달라 ②)
      for (const s of (p.lineTranslationSections ?? []) as Array<{ items?: Array<{ english?: string }> }>) {
        for (const it of s.items ?? []) {
          writeRow(String(it.english ?? ""), `워크북 「${name}」 · 한 줄 해석`, date, "워크북 한 줄 해석에서 같은 문장을 다룸", "similar");
        }
      }
    }
    if (ctx.fam === "content" && /[가-힣]{4}/.test(ctx.answer)) {
      type KoItem = { english?: string; korean?: string };
      const lines = [
        ...((p.lineTranslationSections ?? []) as Array<{ items?: KoItem[] }>).flatMap((x) => x.items ?? []),
        ...((p.blankSections ?? []) as Array<{ sentences?: KoItem[] }>).flatMap((x) => x.sentences ?? []),
      ];
      for (const l of lines) {
        const ko = String(l.korean ?? "");
        if (ko.length > 8 && koWithin(ctx.answer, ko) >= 0.6) {
          add({
            level: "similar",
            source: `워크북 「${name}」 · 한 줄 해석`,
            date,
            lineHtml: `${esc(String(l.english ?? ""))}<br><b class="br hit">${esc(ko)}</b>`,
            compare: { exam: ctx.answer, ours: `${String(l.english ?? "")} (${ko})`, same: "시험 보기의 문장을 한 줄 해석으로 다룸" },
          });
        }
      }
    }
    if (ctx.fam === "content") {
      for (const s of (p.sections ?? []) as Array<{ passage?: string; items?: Array<{ statement?: string }> }>) {
        if (!ofThis(String(s.passage ?? ""))) continue;
        for (const it of s.items ?? []) tfRow(String(it.statement ?? ""), `워크북 「${name}」 · T/F`, date);
      }
    }
  }

  // 1장 요약자료 — 지문마다 저장된 재료
  // 서버는 한 번에 1,000줄까지 — 끝까지 넘겨 읽는다
  const sents = await fetchAllRows<{ project_id: string; english_text: string; korean_text: string | null; order_index: number }>(
    (from, to) =>
      admin
        .from("lesson_material_items")
        .select("project_id, english_text, korean_text, order_index")
        .in("project_id", pids)
        .order("order_index")
        .order("id")
        .range(from, to)
  );
  for (const pr of projects ?? []) {
    const c = ((pr.lesson_pack_json ?? {}) as { onePageContent?: OnePageContent | null }).onePageContent;
    if (!c || !before(c.createdAt)) continue;
    const source = `1장 요약자료 「${String(pr.title ?? "")}」`;
    const date = dateLabel(c.createdAt);
    const ss = onePageSentences((sents ?? []).filter((s) => String(s.project_id) === String(pr.id))).map((s) => s.english);
    put(source, date, `주제: ${c.topicKo ?? ""} / 제목: ${c.titleEn ?? ""}`);
    put(source, date, `요약문: ${c.summaryEn ?? ""}`);
    for (const g of c.grammar ?? []) put(source, date, `어법 포인트: ${g.target} — [${g.right} / ${g.wrong}] ${g.point}`);
    for (const v of c.vocab ?? []) put(source, date, `어휘: ${v.surface} ≒ ${(v.synonyms ?? []).join(", ")} ↔ ${(v.antonyms ?? []).join(", ")}`);
    for (const e of c.examPoints ?? []) put(source, date, `출제 자리(${e.kind}): ${e.insertSentence ?? e.target}`);
    for (const t of c.tf ?? []) put(source, date, `T/F(${t.answer}): ${t.statement}`);
    const hitSpot = (sentenceIndex: number, surface: string, shown: string, note: string, what: string, from = 0) => {
      const sen = ss[sentenceIndex];
      if (!sen) return;
      const r = spotIn(sen, surface, shown, from);
      if (!r) return;
      const s = ctx.spots.find((e) => sameSpot(e, r.spot));
      if (!s) return;
      const html = `${r.html}${note ? ` <span class="nt">${esc(note)}</span>` : ""}`;
      add({ level: "similar", source, date, lineHtml: html, compare: { exam: examSideOf(s), ours: untag(html), same: what } });
    };
    if (ctx.fam === "underline" || ctx.fam === "blank") {
      for (const g of c.grammar ?? []) {
        if (!g.right) continue;
        // 맞는 말이 target 안 어디에 있는지로 자리를 잡는다
        const sen = (ss[g.sentenceIndex] ?? "").toLowerCase();
        const t = sen.indexOf(String(g.target ?? "").toLowerCase());
        hitSpot(g.sentenceIndex, g.right, `[${g.right} / ${g.wrong}]`, `어법 포인트: ${g.point}`, "1장 요약자료가 같은 자리를 어법 포인트로 짚음", Math.max(0, t));
      }
      for (const v of c.vocab ?? []) {
        const note = [v.synonyms?.length ? `≒ ${v.synonyms.join(", ")}` : "", v.antonyms?.length ? `↔ ${v.antonyms.join(", ")}` : ""]
          .filter(Boolean)
          .join("  ");
        hitSpot(v.sentenceIndex, v.surface, v.surface, note, "1장 요약자료가 같은 낱말을 동의어·반의어로 짚음");
      }
      for (const e of c.examPoints ?? []) {
        if (e.kind === "blank") hitSpot(e.sentenceIndex, e.target, e.target, "빈칸 출제 자리", "1장 요약자료가 같은 자리를 빈칸 출제 자리로 표시");
      }
    }
    if (ctx.fam === "insertion" && ctx.given.length > 20) {
      for (const e of c.examPoints ?? []) {
        if (e.kind !== "insert") continue;
        const sen = String(e.insertSentence ?? ss[e.sentenceIndex] ?? e.target ?? "");
        if (sen.length > 20 && within(ctx.given, sen) >= 0.6) {
          add({
            level: "similar",
            source,
            date,
            lineHtml: `<b class="br hit">${esc(sen)}</b> <span class="nt">[문장삽입 유력]</span>`,
            compare: { exam: ctx.given, ours: sen, same: "1장 요약자료가 같은 문장을 [문장삽입 유력]으로 표시" },
          });
        }
      }
    }
    if (ctx.fam === "idea" && /[a-z]{3}/i.test(ctx.answer)) {
      for (const [label, text] of [
        ["영어 제목", c.titleEn],
        ["요약문", c.summaryEn],
      ] as const) {
        const sh = sharedContent(ctx.answer, String(text ?? ""));
        const base = Math.min(contentWords(ctx.answer).length, contentWords(String(text ?? "")).length) || 1;
        if (sh.length >= 2 && sh.length / base >= 0.34) {
          add({
            level: "similar",
            source,
            date,
            lineHtml: `${esc(label)}: ${markHtml(esc(String(text)), sh)}`,
            compare: { exam: ctx.answer, ours: String(text), same: `1장 요약자료 ${label}과 정답 표현이 겹침: ${sh.join(" · ")}` },
          });
        }
      }
    }
    if (ctx.fam === "content") for (const t of c.tf ?? []) tfRow(String(t.statement ?? ""), source, date);
  }
  for (const [source, v] of pack) {
    out.push({
      level: "cand",
      source,
      date: v.date,
      lineHtml: esc(v.lines.join("\n").slice(0, 1800)).replace(/\n/g, "<br>"),
      compare: { exam: "", ours: "", same: "" },
    });
  }
  return out;
}

// ── 선생님이 올린 자료(PDF) — 선생님 지시(2026-10-15): 개인 자료도 올려 같이 대조
/*
 * 올린 PDF에서 뽑은 글에는 밑줄이 없다. 대신 [왼 / 오른] 괄호, ①~⑤ 표지 뒤 낱말, 빈칸 줄은 남는다.
 * 그 셋을 「묻는 자리」로 삼고, 지문 자리 바로 앞 발문으로 유형을 가린다(uploaded-material.ts).
 * 같은 유형 + 같은 자리 = ①, 둘 중 하나만 = ②. 발문도 자리도 못 읽으면 넣지 않는다.
 */
export type HitUpload = { name: string; text: string };

function uploadSpots(win: string): Spot[] {
  const marked = win
    .replace(/\[\s*([^\[\]\/\n]{1,40}?)\s*\/\s*([^\[\]\n]{1,40}?)\s*\]/g, "<u>$1 / $2</u>")
    .replace(/[①②③④⑤]\s*([A-Za-z][A-Za-z'’-]*(?:\s+[a-z][A-Za-z'’-]*){0,2})/g, (_m, w: string) => `<u>${w}</u>`);
  return spotsOf(marked);
}

function uploadHits(
  ctx: MatCtx & { stem: string | null; typeName: string },
  uploads: HitUpload[]
): MatHit[] {
  const out: MatHit[] = [];
  for (const u of uploads) {
    const seen = new Set<string>();
    // 같은 유형 발문인 곳부터 — 앞 여덟 곳만 보면 모음집 뒤쪽 같은 유형 문항을 놓친다(상우고1 4번)
    const spots = findPassageAll(u.text, ctx.body)
      .slice(0, 40)
      .map((at) => ({ at, stems: stemsFor(u.text, at) }))
      .map((x) => ({ ...x, same: x.stems.some((s) => sameStem(ctx.stem, ctx.typeName, s)) }))
      .sort((x, y) => Number(y.same) - Number(x.same))
      .slice(0, 10);
    for (const { at, stems, same: typeSame } of spots) {
      const win = u.text.slice(Math.max(0, at - 200), at + 2600);
      let spot: { line: string; exam: string; ours: string; what: string } | null = null;
      // 근거 문장 바로 앞 발문이 같은 유형인가(주어진 문장은 지문과 떨어져 앞에 나오기도 한다)
      let spotTypeSame = false;

      if (ctx.fam === "underline" || ctx.fam === "blank") {
        const mine = uploadSpots(win);
        const s = ctx.spots.find((e) => mine.some((x) => sameSpot(e, x)));
        const m = s ? mine.find((x) => sameSpot(s, x))! : null;
        if (s && m) {
          const inner = untag(m.inner);
          spot = {
            line: `… ${esc(m.left)} <b class="br hit">${esc(inner || "_____")}</b> ${esc(m.right)} …`,
            exam: examSideOf(s),
            ours: `… ${m.left} [${inner || "_____"}] ${m.right} …`,
            what: "올린 자료가 같은 자리를 물음",
          };
        }
      }
      if (!spot && ctx.fam === "blank") {
        const sent = (t: string) =>
          (t.split(/(?<=[.!?]["”’]?)\s+/).find((x) => /_{3,}/.test(x)) ?? "").replace(/_{2,}|\(\s*[A-E]\s*\)/g, " ");
        const es = sent(ctx.body.replace(/<\/?u>/g, ""));
        const ms = sent(win);
        if (plainWords(es).length >= 6 && plainWords(ms).length >= 6 && within(es, ms) >= 0.5) {
          spot = { line: esc(ms.trim()), exam: es.trim(), ours: ms.trim(), what: "올린 자료가 같은 문장을 비움" };
        }
      }
      if (!spot && ctx.fam === "insertion" && ctx.given.length > 20) {
        /*
         * 주어진 문장은 지문 속 문장이라 지문을 실은 자료엔 다 들어 있다. 문장 삽입 발문 바로 뒤
         * (주어진 문장 자리)에 나올 때만 근거로 본다(2026-10-15 상우고1 2·4번에서 걸림).
         */
        for (const m of u.text.matchAll(/주\s*어\s*진\s*문\s*장|들\s*어\s*가\s*기\s*에/g)) {
          if (m.index === undefined) continue;
          const after = u.text.slice(m.index, m.index + 450);
          const sen = after.split(/(?<=[.!?]["”’]?)\s+|\n/).find((x) => x.length > 15 && within(ctx.given, x) >= 0.8);
          // 다른 문장을 넣는 삽입 문제면 그 문장은 지문 속에 원래 자리대로 있다 — 주어진 문장이 아니다(상우고1 2번)
          if (sen && !givenAsGiven(u.text.slice(m.index, m.index + 700), ctx.given, ctx.body.split("\n").slice(1).join(" "))) continue;
          if (sen) {
            spotTypeSame = true;
            spot = { line: `<b class="br hit">${esc(sen.trim())}</b>`, exam: ctx.given, ours: sen.trim(), what: "올린 자료가 같은 문장을 주어진 문장으로 냄" };
            break;
          }
        }
      }
      if (!spot && ctx.fam === "writing") {
        const want = ctx.answer;
        const sen = win.split(/(?<=[.!?]["”’]?)\s+|\n/).find((x) => x.length > 15 && want.length > 15 && within(want, x) >= 0.8);
        if (sen) {
          spotTypeSame = stemsFor(u.text, u.text.indexOf(sen)).some((x) => sameStem(ctx.stem, ctx.typeName, x));
          spot = {
            line: `<b class="br hit">${esc(sen.trim())}</b>`,
            exam: want,
            ours: sen.trim(),
            what: "올린 자료에 같은 문장",
          };
        }
      }
      if (!spot && (ctx.fam === "idea" || ctx.fam === "content")) {
        const ko = /[가-힣]{4}/.test(ctx.answer);
        for (const line of win.split(/\n|(?=[①②③④⑤])/)) {
          const l = line.replace(/^[①②③④⑤]\s*/, "").trim();
          // 대의 파악은 보기·정답 줄만 — 지문 문단이 정답 낱말(atoms · cycle)을 품어 「같은 내용」으로 잡혔다(상우고1 14번)
          if (l.length < 10 || (ctx.fam === "idea" && l.length > 200)) continue;
          const ok = ko
            ? /[가-힣]{4}/.test(l) && koWithin(ctx.answer, l) >= 0.6
            : (() => {
                const sh = sharedContent(ctx.fam === "content" ? ctx.stmt : ctx.answer, l);
                const base = contentWords(ctx.fam === "content" ? ctx.stmt : ctx.answer).length || 1;
                return ctx.fam === "content" ? sh.length >= 4 && sh.length / base >= 0.6 : sh.length >= 2 && sh.length / base >= 0.4;
              })();
          if (ok) {
            spot = { line: `<b class="br hit">${esc(l)}</b>`, exam: ctx.fam === "content" && !ko ? ctx.stmt : ctx.answer, ours: l, what: "올린 자료가 같은 내용을 보기로 다룸" };
            break;
          }
        }
      }
      const sameType = typeSame || spotTypeSame;
      // 지문 + 유형만 같은 것은 삽입·순서·무관한 문장일 때만 근거가 된다(우리 문항과 같은 잣대)
      if (!spot && !(sameType && (ctx.fam === "insertion" || ctx.fam === "order" || ctx.fam === "irrelevant"))) continue;
      const key = spot ? spot.ours : `type:${stems[0] ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // 같은 유형 발문을 보여 준다 — 첫 발문(빈칸)만 실려 모델이 무관한 문장 문제를 못 알아봤다(상우고1 22번)
      const shownStem = stems.find((x) => sameStem(ctx.stem, ctx.typeName, x)) ?? stems[0];
      const stemLine = shownStem ? `<span class="nt">${esc(shownStem.replace(/\s+/g, " ").slice(0, 60))}</span>` : "";
      out.push({
        level: spot && sameType ? "same" : "similar",
        typeSame: sameType,
        source: `올린 자료 「${u.name}」`,
        date: "",
        // 같은 유형만 맞은 자리는 그 문항 하나를 통째로(발문 → 지문 → 보기) — 지문 앞 700자만 보내 제목 보기가 잘렸다(상우고1 14번)
        lineHtml: spot
          ? ctx.fam === "idea"
            ? // 대의 파악은 보기 한 줄만 보이면 우리 정답이 안 보인다 — 그 문항을 통째로, 맞은 줄에 표시
              `${stemLine}<br>${markHtml(esc(oneQuestionWindow(u.text, stemStart(u.text, shownStem, at), at).replace(/\s+/g, " ")), [spot.ours])}`
            : `${stemLine}<br>${spot.line}`
          : `${stemLine}<br>${esc(oneQuestionWindow(u.text, stemStart(u.text, shownStem, at), at).replace(/\s+/g, " "))}`,
        compare: spot
          ? { exam: spot.exam, ours: spot.ours, same: sameType ? `${spot.what} · 같은 유형` : spot.what }
          : { exam: ctx.typeName, ours: stems[0] ?? "", same: "올린 자료에 같은 지문 · 같은 유형" },
      });
    }
  }
  return out;
}

// ── 다른 학교 자료 — 이름에 다른 학교가 적혀 있으면 이 학교 학생에게 준 자료가 아니다(2026-10-15 호원고1에 경민고 자료가 섞임)
function schoolsIn(title: string): string[] {
  return [...String(title ?? "").matchAll(/([가-힣]{1,4})(?:여자고등학교|고등학교|여고|고)(?=\s?\d|\s?[([]|\s|$|_|-)/g)].map((m) => m[1]!);
}
export function otherSchool(title: string, school: string): boolean {
  const mine = String(school ?? "").replace(/(여자)?고등학교$|여고$|고$/, "");
  const names = schoolsIn(title);
  if (!mine || names.length === 0) return false;
  return !names.some((n) => n === mine || mine.startsWith(n) || n.startsWith(mine));
}

/*
 * 올린 자료에서 시험 지문이 나오는 곳(바로 앞 발문 + 지문 + 보기)을 통째로 모델 판정 후보로 넘긴다.
 * 선생님 자료는 밑줄이 글자로 남지 않아 규칙이 같은 자리를 못 잡는 일이 많다 — 상우고1에 학평 변형 23개를 올렸는데
 * 7~28번 지문이 문항마다 3~14개 자료에 나오는데도 하나도 근거가 되지 못했다(2026-10-15). 읽고 가리는 것은 모델이 한다.
 */
/**
 * 올린 자료의 저작권 문구 · 카페/웹 주소 · 일련번호 · 쪽 표시를 지운다 — 자료집 카드에 「본 콘텐츠는 … 저작권」,
 * 「유별난! 영어 공부 cafe.naver.com/…」, 「I410-141-25-99-091285986 - 2 -」가 그대로 찍혔다(선생님 지적 2026-10-15).
 */
const COPYRIGHT = /저작권|무단\s*(?:복제|전재|배포)|라이[센선]스를?\s*획득|All rights reserved|Copyright|ⓒ|©/i;
const COPYRIGHT_AROUND = new RegExp(`[^.!?\\n]{0,80}(?:${COPYRIGHT.source})[^.!?\\n]{0,80}[.!?]?`, "gi");

export function cleanUploadText(t: string): string {
  return String(t ?? "")
    .split("\n")
    /*
     * 짧은 줄은 통째로 지우고, 긴 줄(PDF 글이 한 줄로 이어 붙은 것)은 그 문구 둘레만 지운다 — 줄째 지우니
     * 자료 하나가 통째로 사라졌다(2026-10-15 상우고1 「우작서점」 1과 변형문제 8만 자 → 0).
     */
    .map((line) => (line.length <= 200 ? (COPYRIGHT.test(line) ? "" : line) : line.replace(COPYRIGHT_AROUND, " ")))
    .join("\n")
    .replace(/https?:\/\/\S+|www\.\S+|cafe\.naver\.com\/\S*|blog\.naver\.com\/\S*/gi, " ")
    .replace(/유별난!?\s*영어\s*공부/g, " ")
    .replace(/\bI\d{3}-\d{3}-\d{2}-\d{2}-\d{6,}\b/g, " ")
    .replace(/(^|\s)-\s?\d{1,3}\s?-(?=\s|$)/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

/** 발문이 지문 바로 앞(1500자 안)에 있으면 그 자리부터, 아니면 지문부터 */
function stemStart(text: string, stem: string | undefined, at: number): number {
  const s = stem ? text.lastIndexOf(stem.slice(0, 24), at) : -1;
  return s >= 0 && at - s < 1500 ? s : at;
}

/** 올린 자료에서 그 문항 하나만 — 발문부터 다음 문항 번호 전까지 */
function oneQuestionWindow(text: string, start: number, at: number): string {
  const tail = text.slice(at + 40, at + 2600);
  const next = tail.search(/\n\s*\[?\d{1,3}\s*[.)\]]\s|\n\s*※|\n\s*■|\n\s*\[\d{4,}/);
  const end = next >= 0 ? at + 40 + next : at + 1800;
  return text.slice(start, end).replace(/\n{2,}/g, "\n").slice(0, 1800);
}

function uploadWindows(ctx: MatCtx & { stem: string | null; typeName: string }, uploads: HitUpload[]): MatHit[] {
  const out: MatHit[] = [];
  for (const u of uploads) {
    const seen = new Set<string>();
    /*
     * 한 자료에 같은 지문이 열 번 넘게 나온다(변형문제 모음) — 앞 여섯 곳만 보니 뒤쪽 같은 유형 문항을 놓쳤다
     * (2026-10-15 상우고1 4번: 「[고1] 2과 변형문제」 109번 문장 삽입). 다 보고 같은 유형 발문인 곳을 앞에 둔다.
     */
    const spots = findPassageAll(u.text, ctx.body)
      .slice(0, 40)
      .map((at) => ({ at, stems: stemsFor(u.text, at) }))
      .map((x) => ({ ...x, same: x.stems.some((s) => sameStem(ctx.stem, ctx.typeName, s)) }))
      .sort((x, y) => Number(y.same) - Number(x.same))
      .slice(0, 6);
    for (const { at, stems, same: typeSame } of spots) {
      const key = stems[0] ?? String(at);
      if (seen.has(key)) continue;
      seen.add(key);
      const stemAt = stems[0] ? u.text.lastIndexOf(stems[0].slice(0, 24), at) : -1;
      const start = stemAt >= 0 && at - stemAt < 1500 ? stemAt : Math.max(0, at - 60);
      const win = oneQuestionWindow(u.text, start, at);
      out.push({
        level: "cand",
        source: `올린 자료 「${u.name}」`,
        date: "",
        lineHtml: esc(win).replace(/\n/g, "<br>"),
        compare: { exam: "", ours: "", same: "" },
        typeSame,
      });
    }
  }
  // 같은 유형 발문이 붙은 곳을 앞에
  return out.sort((a, b) => Number(!!b.typeSame) - Number(!!a.typeSame));
}

// ── 같은 지문으로 만든 우리 문항
/** 시험 지문에서 낱말 여섯 개가 이어진 구절을 고루 뽑는다 — 밑줄·빈칸 자리는 학교가 바꾸므로 피한다 */
function probes(body: string): string[] {
  const toks = String(body ?? "").replace(/<u>[\s\S]*?<\/u>|_{2,}|\([A-E]\)/g, " | ").split(/\s+/).filter(Boolean);
  const runs: string[] = [];
  let run: string[] = [];
  for (const t of toks) {
    if (/^[A-Za-z]+$/.test(t)) {
      run.push(t);
      if (run.length === 6) {
        runs.push(run.join(" "));
        run = [];
      }
    } else run = [];
  }
  if (runs.length <= 4) return runs;
  const step = runs.length / 4;
  return [0, 1, 2, 3].map((i) => runs[Math.floor(i * step)]!);
}

async function ourQuestions(
  admin: SupabaseClient,
  academyId: string,
  body: string,
  cutoffMs: number
): Promise<{ qs: Made[]; passages: string[] }> {
  const ids = new Set<string>();
  const passages = new Map<string, string>();
  for (const p of probes(body)) {
    const { data } = await admin.from("english_source_passages").select("id, passage").ilike("passage", `%${p}%`).limit(50);
    for (const r of data ?? []) {
      ids.add(String(r.id));
      passages.set(String(r.id), String(r.passage ?? ""));
    }
  }
  if (ids.size === 0) return { qs: [], passages: [] };
  const out: Made[] = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const data = await fetchAllRows<Made>((from, to) =>
      admin
        .from("generated_english_questions")
        .select("id, option_key, instruction, question_text, passage_modified, passage_original, choices, correct_answer, created_at, item_no, generation_job_id")
        .eq("academy_id", academyId)
        .in("passage_id", chunk)
        .order("id")
        .range(from, to)
    );
    for (const q of data) {
      const t = q.created_at ? new Date(q.created_at).getTime() : NaN;
      if (Number.isFinite(t) && t < cutoffMs) out.push(q);
    }
  }
  return { qs: out, passages: [...new Set(passages.values())] };
}

/** 시험 유형과 우리 문항 유형이 같은 갈래인가 */
function sameFamily(examType: string, subjective: boolean, q: Made): boolean {
  const code = String(q.option_key ?? "").split(":").pop() ?? "";
  const t = examType.replace(/\s/g, "");
  // 문장삽입·무관한 문장은 보기 없이 정답 번호만 담겨 있다 — 보기로 객관식을 가리면 통째로 빠진다(발곡고1 7번, 2026-10-15)
  if (!subjective && t.includes("삽입")) return code.includes("삽입");
  if (!subjective && t.includes("순서")) return code.includes("순서");
  if (!subjective && t.includes("무관")) return code.includes("무관");
  // 밑줄 고르기 어법·어휘도 보기 칸이 비어 있다(정답 번호와 지문 밑줄만) — 객관식에서 빠져 호원고1 2·6번이 같은 유형을 못 찾았다(2026-10-21)
  const underlined = /어법|어휘|함축|지칭/.test(code) && /<u>/.test(String(q.passage_modified ?? ""));
  const mc = choiceTexts(q.choices).length >= 4 || /삽입|무관|순서/.test(code) || underlined;
  if (subjective || t.includes("영작")) return !mc;
  if (!mc) return false;
  if (t.includes("요약")) return code.includes("요약");
  if (t.includes("빈칸")) return code.includes("빈칸");
  if (t.includes("어법")) return code.includes("어법");
  if (t.includes("어휘")) return code.includes("어휘");
  if (/밑줄|함축/.test(t)) return code.includes("함축");
  if (t.includes("지칭")) return code.includes("지칭");
  // 목적도 대의 파악 — 우리 문항은 요지·주제로 같은 뜻을 묻는다(호원고1 7번)
  if (/주제|제목|요지|주장|목적/.test(t)) return /주제|제목|요지|주장|목적/.test(code);
  if (t.includes("일치")) return code.includes("일치");
  return false;
}

/**
 * 문장 삽입: 우리 자료에 그 문장이 「주어진 문장」으로 나왔는가. 지문 속(앞 세 낱말과 뒤 세 낱말이 모두 시험 지문 글과
 * 시험 지문 글과 이어지는 곳)에 들어 있으면 주어진 문장이 아니다 — 모델이 어법 문제 지문 속 (A)…(B) 사이 문장이나
 * 다른 문장을 넣는 삽입 문제의 지문 속 문장을 「같은 주어진 문장」으로 보고 ①을 줬다(2026-10-15 상우고1 2·26번).
 */
function givenAsGiven(text: string, given: string, examPassage: string): boolean {
  // 따옴표 모양(’ / ')이 자료마다 달라 낱말이 어긋났다 — 맞춰 비교한다
  const words = (x: string) => plainWords(String(x).replace(/<[^>]+>/g, " ").replace(/\(\s*[A-Ea-e]\s*\)/g, " ").replace(/[’‘`]/g, "'"));
  const g = words(given);
  if (g.length < 5) return true;
  const t = words(text);
  const e = ` ${words(examPassage).join(" ")} `;
  let found = false;
  for (let i = 0; i + g.length <= t.length; i++) {
    if (g.some((w, k) => t[i + k] !== w)) continue;
    found = true;
    const prev = t.slice(Math.max(0, i - 3), i);
    const next = t.slice(i + g.length, i + g.length + 3);
    if (prev.length < 3 || next.length < 3) return true;
    if (!e.includes(` ${prev.join(" ")} `) || !e.includes(` ${next.join(" ")} `)) return true;
  }
  // 낱말 그대로는 없으면, 조금 바꿔 쓴 주어진 문장(발문 아래 상자)일 때만 — 아예 없으면 같은 주어진 문장이 아니다(상우고1 26번)
  return !found && within(given, String(text).replace(/<[^>]+>/g, " ").slice(0, 400)) >= 0.8;
}

/** 올린 자료 전체에서 — 삽입 발문 뒤에 그 문장이 주어진 문장으로 나온 곳이 하나라도 있는가 */
function uploadGivesGiven(text: string, given: string, examPassage: string): boolean {
  for (const m of text.matchAll(/주\s*어\s*진\s*문\s*장|들\s*어\s*가\s*기\s*에|들\s*어\s*갈/g)) {
    const win = text.slice(m.index ?? 0, (m.index ?? 0) + 700);
    if (!win.split(/(?<=[.!?]["”’]?)\s+|\n/).some((x) => x.length > 15 && within(given, x) >= 0.8)) continue;
    if (givenAsGiven(win, given, examPassage)) return true;
  }
  return false;
}

// ── 모델 판정 — 선생님 지시(2026-10-15): 「판정이 제대로인지가 중요해」
/*
 * 글자 규칙은 후보를 모으는 데까지만 쓴다. 규칙만으로는 「주제어만 겹친 것」, 「지문 속 문장이라 어디에나 있는 것」을
 * 끝까지 가려내지 못했다(호원고1·상우고1에서 확인). 그래서 시험 문항과 후보 원문을 모두 모델에 보여 주고,
 * 손으로 만든 자료집과 같은 잣대로 ①/②/아님을 가리고 원문 인용과 까닭을 받는다. 모델이 실패하면 규칙 판정을 쓴다.
 */
/** key: q 같은 유형 우리 문항 · o 다른 유형 우리 문항 · m 규칙이 자리를 찾은 자료 · p 자료 묶음 · u 올린 자료 */
/** sameType: 시험과 같은 유형인가 — 아래 「우리 학원 문제」 카드는 같은 유형만 붙인다(2026-10-15 선생님 지적) */
type AiCand = { key: string; brief: string; card: BookCard; source: string; date: string; fallbackCompare?: BookCompare; ruleSame?: boolean; sameType?: boolean; exactType?: boolean; typeCode?: string };
type AiResult = {
  verdict: BookVerdict;
  matched: Array<{ key: string; level: "same" | "similar" }>;
  evidence: Array<{ key: string; exam_quote: string; ours_quote: string; why: string }>;
  reason: string;
};

const JUDGE_MODEL = () => process.env.OPENAI_MODEL_HIT_BOOK?.trim() || "gpt-5.6-sol";

const JUDGE_SYSTEM = `너는 영어 내신 시험의 「적중」을 가리는 판정관이다. 학원이 시험 전에 학생들에게 준 자료가 실제 시험 문항을 얼마나 그대로 다뤘는지를, 학부모에게 보여 줄 자료집에 쓸 수 있을 만큼 정확하고 보수적으로 가린다.

판정 기준 (①과 ②는 아래 기준대로 근거를 보고 가린다 — 기준에 맞으면 망설이지 말고 ①이다. ②인지 아닌지 애매하면, 같은 지문·같은 유형에서 시험이 묻는 것과 관련된 내용을 다뤘는지로 가린다):
① same — 「동일 유형 + 동일 포인트」: 우리 자료가 시험과 같은 형식으로, 시험이 물은 「바로 그 자리」를 물었다.
  - 어휘·어법 판단(밑줄 하나 고르기): 시험 정답 자리(학교가 바꾼 낱말)와 같은 낱말 자리를 물었어야 한다. 같은 자리면 우리가 바꿔 넣은 낱말이 시험과 달라도 ①이다. 다른 밑줄 자리는 ①이 아니다.
  - 어법·어휘 개수: 시험이 틀리게 바꾼 자리들 가운데 하나 이상을 같은 자리로 물었어야 한다.
  - 어휘 판단과 어휘 개수, 어법 판단과 어법 개수·어법 수정은 같은 유형으로 본다 — 같은 자리를 물었으면 ①이다.
  - 빈칸: 같은 문장을 비웠거나, 정답이 같은 뜻이면 ①이다(표현이 달라도).
  - 주제·제목·요지·목적(대의 파악): 우리 문항의 정답이 시험 정답과 분명히 같은 뜻이면 갈래가 달라도(요지 시험에 주제 문제, 목적 시험에 요지 문제) ①이다(요지를 서술형으로 써 본 것도 같다). 뜻이 일부만 겹치면 ②. 지문 주제어만 겹치는 것은 아니다.
  - 내용 일치·불일치·일치 개수: 시험 정답 진술이 묻는 바로 그 사실을 우리 보기로 다뤘으면 ①이다(참 버전으로 다뤘든 틀린 버전으로 다뤘든). 같은 도표·같은 문장을 보기로 다룬 것도 그 사실이면 ①. 고유명사만 겹치는 것은 아니다.
  - 문장 삽입: 주어진 문장이 같아야 한다 — 같은 문장을 바꿔 쓴 것(같은 내용이 같은 자리에 들어가는 주어진 문장)도 같다. 지문 속 문장이라 어디에나 들어 있는 것은 근거가 아니다.
  - 순서: 같은 지문 순서 문제에서 정답 순서가 같으면 ①이다(덩어리를 나눈 자리가 조금 달라도). 무관한 문장: 끼워 넣은 문장이 같으면 ①, 같은 지문 무관한 문장 문제만 풀었으면 ②.
  - 서술형·영작: 모범 답과 같은 문장·표현을 미리 써 봤어야 한다.
② similar — 「유사 유형」: 이 자료를 풀었으면 시험 문제를 바로 풀 수 있다. 예: 같은 지문을 시험과 같은 유형으로 풀며 시험이 묻는 정보(같은 문장·같은 도표 항목·같은 수치·같은 사실)를 이미 다뤘다, 같은 자리를 괄호 고르기·빈칸 쓰기·T/F·요약자료로 다뤘다, 정답과 비슷한 뜻을 다뤘다, 같은 지문의 삽입·순서·무관한 문장을 같은 유형으로 풀었다.
  같은 지문을 같은 유형으로 푼 우리 문항이 있으면 적어도 ②가 되는지 먼저 따진다(같은 정보를 다뤘으면 ②).
  예: 도표 내용 불일치에서 시험이 비교한 항목들을 우리 보기가 각각 다뤘다면, 정확히 같은 비교가 아니어도 ②다. 같은 지문의 내용 일치 문항이 시험 정답 문장 둘레의 사실을 다뤘다면 ②다.
none — 지문만 같거나, 다른 자리를 물었거나, 근거가 약하다.

후보마다 [키]가 붙어 있다. ⟦ ⟧ 는 그 자료가 물은 자리(밑줄·괄호·빈칸)다.
- [q] 시험과 같은 유형의 우리 문항, [u] 선생님이 올린 자료(앞 발문으로 유형을 보고, 같은 유형·같은 자리면 ①).
- [o] 같은 지문의 다른 유형 우리 문항, [m]·[p] 수업자료(1장 테스트지·워크북·1장 요약자료 — 괄호·T/F·빈칸 쓰기·해석·어법/어휘 포인트·출제 자리)는 형식이 달라 ②까지다. 시험이 물은 그 자리·그 사실·그 문장을 다뤘으면 ②로 넣는다.
- 손으로 확인한 판정과 맞추어야 한다: 같은 지문이라도 그 자리를 다룬 근거가 있으면 빠뜨리지 말고 찾아 넣는다. 근거가 없으면 넣지 않는다.
JSON 하나만 답한다:
{"verdict":"same|similar|none",
 "matched":[{"key":"q1","level":"same|similar"}],
 "evidence":[{"key":"q1","exam_quote":"시험 원문에서 그 자리를 짧게 그대로","ours_quote":"우리 자료 원문에서 그 자리를 짧게 그대로","why":"무엇이 같은지 한 줄"}],
 "reason":"학부모가 읽을 한두 문장. 시험 정답이 무엇이었고, 우리 자료 어디에서 그 자리를 다뤘는지 구체적으로.",
 "note":"판정 근거를 한 줄로(내부 기록용). none 이면 왜 근거가 없는지."}
- matched: 근거가 되는 후보 전부(같은 자리를 다룬 수). 근거가 아닌 후보는 넣지 않는다.
- evidence: 가장 강한 근거부터 최대 3개. 인용은 반드시 주어진 원문에서 글자 그대로 옮긴다.
- verdict 가 none 이면 matched·evidence 는 빈 배열, reason 은 빈 글.
- reason·why 에는 [q1]·[m2] 같은 키를 쓰지 말고 자료 이름(예: 「동형모의고사 9번」, 「워크북 빈칸 쓰기」)으로 쓴다.
- 「AI」, 「모델」, 「판정관」 같은 말을 쓰지 않는다. 한국어로 쓴다.`;

/** ⟦ ⟧ 로 묻는 자리를 보이게 */
const briefMark = (html: string) =>
  untag(
    String(html ?? "")
      .replace(/<u>([\s\S]*?)<\/u>/g, "⟦$1⟧")
      .replace(/<b class="br hit">([\s\S]*?)<\/b>/g, "⟦$1⟧")
      .replace(/<br\s*\/?>/g, " / ")
  );

/** 혹시 남은 [q1]·m2~m6 같은 키를 지운다 */
const dropKeys = (t: string) =>
  String(t ?? "")
    .replace(/\[?\b[qm]\d+\b\]?(?:\s*(?:[~·,와과및]|그리고)\s*\[?\b[qm]?\d+\b\]?)*(?:에서|에서도|이|가|은|는|와|과|도|의)?/g, "우리 자료$&")
    .replace(/우리 자료\[?\b[qm]\d+\b\]?(?:\s*(?:[~·,와과및]|그리고)\s*\[?\b[qm]?\d+\b\]?)*/g, "우리 자료")
    .replace(/(우리 자료\s*){2,}/g, "우리 자료 ")
    .replace(/우리 자료은/g, "우리 자료는")
    .replace(/우리 자료이(?=\s)/g, "우리 자료가")
    .replace(/우리 자료과/g, "우리 자료와")
    .replace(/\s{2,}/g, " ")
    .trim();

async function aiJudge(examBrief: string, cands: AiCand[]): Promise<AiResult | null> {
  if (cands.length === 0) return null;
  const user = `[시험 문항]\n${examBrief}\n\n[시험 전 우리 자료 후보]\n${cands.map((c) => c.brief).join("\n\n")}`;
  if (process.env.HITBOOK_DEBUG) console.log(`\n##### PROMPT (${cands.length})\n${user.slice(0, 9000)}\n#####`);
  // 손 판정용: 후보를 파일로만 내보내고 모델은 부르지 않는다(규칙 판정으로 넘어감)
  if (process.env.HITBOOK_DUMP) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.HITBOOK_DUMP, `${JSON.stringify({ exam: examBrief, cands })}\n`);
    return null;
  }
  try {
    const { text } = await examChat(
      {
        model: JUDGE_MODEL(),
        reasoning_effort: "medium",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: user },
        ],
      },
      2
    );
    if (process.env.HITBOOK_DEBUG) console.log(`##### ANSWER
${text}
#####`);
    const raw = JSON.parse(text) as Partial<AiResult>;
    const keys = new Set(cands.map((c) => c.key));
    const verdict: BookVerdict = raw.verdict === "same" || raw.verdict === "similar" ? raw.verdict : "none";
    const matched = (raw.matched ?? []).filter((m) => m && keys.has(m.key) && (m.level === "same" || m.level === "similar"));
    const evidence = (raw.evidence ?? [])
      .filter((e) => e && keys.has(e.key))
      .slice(0, 3)
      .map((e) => ({ ...e, why: dropKeys(e.why) }));
    if (verdict !== "none" && matched.length === 0) return { verdict: "none", matched: [], evidence: [], reason: "" };
    return { verdict, matched, evidence, reason: dropKeys(String(raw.reason ?? "")) };
  } catch (e) {
    console.error("[hit-book/aiJudge]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** 시험 문항을 모델에 보일 글로 */
function examBriefOf(it: ExamItemRow, block: ExamBlock, markedBody: string, answer: string): string {
  return [
    `유형: ${it.type_name}${it.is_subjective ? " (서술형)" : ""}`,
    `발문: ${block.stem || it.stem || ""}`,
    `지문: ${briefMark(markedBody).slice(0, 3500)}`,
    block.choices.length ? `보기: ${block.choices.map((c, i) => `${CIRCLED[i]} ${c}`).join("  ")}` : "",
    `정답: ${String(it.answer_guess ?? "")}${answer && !String(it.answer_guess ?? "").includes(answer) ? ` (${answer})` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── 묶기
export async function buildHitBook(
  admin: SupabaseClient,
  analysis: ExamAnalysisRow,
  items: ExamItemRow[],
  /** 이 시험지를 올린 때 — 그보다 앞서 만든 자료만 센다 */
  cutoff: string | null,
  /** 선생님이 올린 자료 — 시험 전에 학생에게 준 것이라고 보고 그대로 센다 */
  uploads: HitUpload[] = [],
  /**
   * ai: 모델로 판정 · only: 이 문항만(재검토)
   * reuse: 저장된 판정(적중 · 까닭 · 도식)을 그대로 두고 카드만 다시 고른다 — 모델을 다시 부르지 않는다
   */
  opts: { ai?: boolean; only?: string; reuse?: Map<string, BookItem> } = {}
): Promise<HitBook> {
  const cutoffMs = cutoff ? new Date(cutoff).getTime() : Number.POSITIVE_INFINITY;
  uploads = uploads.map((u) => ({ ...u, text: cleanUploadText(u.text) }));
  const before = (at: string | null | undefined) => {
    const t = at ? new Date(at).getTime() : NaN;
    return Number.isFinite(t) ? t < cutoffMs : true;
  };

  const { data: pages } = await admin
    .from("school_exam_pages")
    .select("text")
    .eq("analysis_id", analysis.id)
    .order("page_no");
  const blocks = splitExamBlocks((pages ?? []).map((p) => String(p.text ?? "")).join(`\n${PAGE_BREAK}\n`));

  const jobTitle = new Map<string, string>();
  const loadJobs = async (qs: Made[]) => {
    const need = [...new Set(qs.map((q) => q.generation_job_id).filter((x): x is string => !!x && !jobTitle.has(x)))];
    for (let i = 0; i < need.length; i += 200) {
      const { data } = await admin.from("question_generation_jobs").select("id, rc_title:request_config->>title").in("id", need.slice(i, i + 200));
      for (const j of data ?? []) {
        jobTitle.set(String(j.id), String((j.rc_title as string | null) ?? "변형문제"));
      }
    }
  };

  /*
   * 문항마다 지문을 찾고 자료를 읽어 대조한다 — 넷씩 같이 돌린다(24문항 1분 → 20초 남짓).
   */
  /*
   * 「윗글의 …」 문항은 지문이 앞 문항에 붙어 있다(호원고1 10번 — 본문이 비어 있었다). 앞 문항의 지문을 빌린다.
   */
  const itemBlocks = new Map<string, ExamBlock>();
  let lastBody = "";
  for (const it of items) {
    const b = blocks.get(itemKey(it.item_no)) ?? { stem: it.stem ?? "", body: it.passage_excerpt ?? "", choices: [] };
    // 영어 글자로 센다 — 서술형은 본문 칸에 한글 발문만 500자 넘게 있어 지문이 있는 줄 알고 빌려 오지 않았다(호원고1 서술 3)
    const long = (b.body.match(/[A-Za-z]/g) ?? []).length >= 150;
    itemBlocks.set(it.id, !long && lastBody && /윗글|위 글|위의 글/.test(`${b.stem} ${it.stem ?? ""}`) ? { ...b, body: lastBody } : b);
    if (long) lastBody = b.body;
  }

  const one = async (it: ExamItemRow): Promise<BookItem> => {
    const block = itemBlocks.get(it.id)!;
    const fam = familyOf(it.type_name, it.is_subjective);
    const answerNo = circledNo(it.answer_guess);
    const answer =
      answerNo && block.choices[answerNo - 1]
        ? block.choices[answerNo - 1]!
        : String(it.answer_guess ?? "").replace(/^[①②③④⑤]\s*/, "");
    /*
     * 밑줄 하나를 고르는 문제(어휘·어법 판단)는 정답 자리 — 학교가 바꾼 낱말 — 만 견준다.
     * 다른 밑줄 자리를 다룬 것은 같은 자리가 아니다(선생님 지시 2026-10-14 「바꾼 어휘가 나왔는지」).
     */
    // 밑줄 대신 ⓐ~ⓗ 표지만 있는 시험지(호원고1)는 표지 뒤 한두 낱말을 묻는 자리로 읽는다
    const markedBody = /<u>/.test(block.body)
      ? block.body
      : block.body.replace(/([ⓐ-ⓗ])\s*([A-Za-z][A-Za-z'’-]*(?:\s+[a-z][A-Za-z'’-]*)?)/g, (_m, k: string, w: string) => `${k}<u>${w}</u>`);
    const allSpots = spotsOf(markedBody);
    // 정답 표지 — 「③ (c): …」처럼 (a)~(e)가 있으면 그것, 아니면 ①~⑤
    const ansMark =
      String(it.answer_guess ?? "").match(/\(([a-eA-E])\)|[ⓐ-ⓗ]/)?.[0]?.toLowerCase() ?? (answerNo ? CIRCLED[answerNo - 1] : undefined);
    // 개수 문항(「4개: ⓑ, ⓒ, ⓕ, ⓗ」)은 정답이 여럿이라 좁히지 않는다
    const ansSpot = fam === "underline" && ansMark && !it.type_name.includes("개수") ? allSpots.find((x) => x.mark === ansMark) : undefined;
    const spots = ansSpot ? [ansSpot] : allSpots;
    const exam = { block, answer, spots, answerNo };

    /*
     * 같은 지문으로 만든 우리 문항을 직접 찾는다. 적중표는 시험 지문 앞 150자로만 대조하고
     * 읽는 양에도 한도가 있어(2026-10-15 발곡고1에서 빈칸·삽입 문항이 통째로 빠짐) 여기서는 쪽 글 전체를 쓴다.
     */
    const { qs: found, passages: origs } = await ourQuestions(admin, analysis.academy_id, block.body, cutoffMs);
    // 밑줄 정답 자리를 모르면(어법 문장 고르기 등) 학교가 원문에서 바꾼 자리를 묻는 자리로 더한다
    if (fam === "underline" && allSpots.length === 0) {
      const orig = origs
        .map((p) => ({ p, w: within(block.body, p) }))
        .sort((a, b) => b.w - a.w)[0];
      if (orig && orig.w >= 0.5) {
        const kind = it.type_name.includes("어법") ? "grammar" : it.type_name.includes("어휘") ? "vocab" : "any";
        for (const d of diffSpots(block.body, orig.p, kind)) if (!spots.some((x) => sameSpot(x, d))) spots.push(d);
      }
    }
    await loadJobs(found);
    const cands = found.filter(
      (q) =>
        sameFamily(it.type_name, it.is_subjective, q) &&
        !/^\s*\[시험\]/.test(jobTitle.get(String(q.generation_job_id)) ?? "") &&
        !otherSchool(jobTitle.get(String(q.generation_job_id)) ?? "", String(analysis.school_name ?? ""))
    );
    const judged = cands.map((q) => {
      const j = judge(fam, exam, q);
      if (j.same) return { q, ...j, near: true };
      const n = judgeNear(fam, { block, answer, allSpots, answerNo }, q);
      return { q, same: false, near: n.near, marks: n.marks, compare: n.compare };
    });
    const sameQs = judged.filter((j) => j.same);
    const nearQs = judged.filter((j) => !j.same && j.near);

    // 수업자료(워크북 · 1장 테스트지 · 1장 요약자료)에서 같은 자리
    const matCtx: MatCtx = {
      body: block.body,
      fam,
      spots,
      answer,
      stmt: /[a-z]{3}/i.test(answer) && !/[가-힣]/.test(answer) ? answer : afterMarker(block.body, answerNo),
      given: fam === "insertion" ? (block.body.split("\n")[0] ?? "") : "",
      cutoffMs,
      school: String(analysis.school_name ?? ""),
    };
    const upCtx = { ...matCtx, stem: block.stem || it.stem, typeName: it.type_name };
    const allMats = await materialHits(admin, analysis.academy_id, matCtx);
    const mats = [...allMats.filter((m) => m.level !== "cand"), ...uploadHits(upCtx, uploads)];
    const packs = allMats.filter((m) => m.level === "cand" && !mats.some((x) => x.source === m.source)).slice(0, 6);
    // 모델 판정에만 쓰는 후보 — 규칙이 이미 잡은 자료는 빼고 자료마다 한 곳
    const saved = opts.reuse?.get(it.id);
    /*
     * 모델에 보일 규칙 근거 — 같은 자리 → 같은 유형 → 나머지 순으로 열둘까지. 예전엔 앞 여섯만 보내고 나머지 자료는
     * 「규칙이 이미 잡았다」며 창 후보에서도 빼, 아잉카 변형문제 제목 문항이 아무 데도 안 실렸다(상우고1 14번, 2026-10-21).
     */
    const shownMats = [...mats].sort((x, y) => Number(y.level === "same") - Number(x.level === "same") || Number(!!y.typeSame) - Number(!!x.typeSame)).slice(0, 12);
    const upCands = opts.ai || saved
      ? uploadWindows(upCtx, uploads)
          .filter((w, i, xs) => !shownMats.some((m) => m.source === w.source) && xs.findIndex((x) => x.source === w.source) === i)
          .slice(0, saved ? 999 : 10)
      : [];
    const sameMats = mats.filter((m) => m.level === "same");
    const matSources = new Set(mats.map((m) => m.source)).size;

    const label = (q: Made) =>
      `${jobTitle.get(String(q.generation_job_id)) ?? "변형문제"}${q.item_no ? ` ${q.item_no}번` : ""}`;
    const qCard = (q: Made, marks: string[], same: boolean): BookCard => {
      const a = answerOf(q);
      return {
        kind: "question",
        source: label(q),
        date: dateLabel(q.created_at),
        instruction: String(q.instruction ?? ""),
        questionText: String(q.question_text ?? ""),
        passageHtml: markHtml(keepU(String(q.passage_modified || q.passage_original || "")), marks),
        choices: choiceTexts(q.choices),
        answerNo: a.no,
        answerText: a.no ? "" : a.text,
        same,
      };
    };
    const base = {
      id: it.id,
      no: it.item_no,
      typeName: it.type_name.split(" · ")[0]!,
      points: it.points,
      level: it.level,
      stem: block.stem || String(it.stem ?? ""),
      examHtml: examHtml(fam, { ...block, body: markedBody }),
      choices: block.choices.map((text, i) => ({ text, answer: answerNo === i + 1 })),
      answer: String(it.answer_guess ?? ""),
    };

    if (opts.ai || saved) {
      // 후보: 우리 문항(규칙으로 같음 → 가까움 → 나머지 같은 유형) 여덟, 수업자료·올린 자료 여섯
      // 같은 유형 이름(요지면 요지)을 앞에 — 주제·제목 문항에 밀려 요지 문항이 빠지던 것(발곡고1 12번)
      const exact = (q: Made) => {
        const code = String(q.option_key ?? "").split(":").pop() ?? "";
        const t = it.type_name.replace(/\s/g, "");
        return ["요지", "주제", "제목", "주장", "어법", "어휘", "빈칸", "요약", "일치", "불일치"].some((w) => t.includes(w) && code.includes(w));
      };
      const rank = (j: (typeof judged)[number]) => (j.same ? 0 : j.near ? 1 : exact(j.q) ? 2 : 3);
      const order = [...judged].sort((x, y) => rank(x) - rank(y));
      // 다른 유형이지만 같은 지문의 우리 문항 — 같은 문장·사실을 다뤘으면 ②가 될 수 있다(발곡고1 6·11번)
      const others = found
        .filter(
          (q) =>
            !cands.includes(q) &&
            !/^\s*\[시험\]/.test(jobTitle.get(String(q.generation_job_id)) ?? "") &&
            !otherSchool(jobTitle.get(String(q.generation_job_id)) ?? "", String(analysis.school_name ?? ""))
        )
        .slice(0, 4);
      const qBrief = (key: string, q: Made, note: string) => {
        const a = answerOf(q);
        const code = String(q.option_key ?? "").split(":").pop() ?? "";
        return [
          `[${key}] ${label(q)} (${dateLabel(q.created_at)}) · 유형 ${code}${note}`,
          `발문: ${String(q.instruction ?? "")}`,
          q.question_text ? `문제 글: ${briefMark(String(q.question_text))}` : "",
          `지문: ${briefMark(String(q.passage_modified || q.passage_original || "")).slice(0, 1800)}`,
          choiceTexts(q.choices).length ? `보기: ${choiceTexts(q.choices).map((c, k) => `${CIRCLED[k]} ${c}`).join("  ")}` : "",
          `정답: ${a.no ? `${CIRCLED[a.no - 1]} ${a.text}` : a.text}`,
        ]
          .filter(Boolean)
          .join("\n");
      };
      const pool: AiCand[] = [
        ...order.slice(0, 12).map((j, i): AiCand => {
          const a = answerOf(j.q);
          const code = String(j.q.option_key ?? "").split(":").pop() ?? "";
          return {
            key: `q${i + 1}`,
            // 주제·제목·요지는 한 갈래로 후보를 모으지만, 카드는 유형 이름까지 같은 것만(요지 시험에 주제 문항 X)
            exactType: exact(j.q) || !/주제|제목|요지|주장/.test(it.type_name),
            typeCode: code,
            source: label(j.q),
            date: dateLabel(j.q.created_at),
            card: qCard(j.q, j.marks, j.same),
            fallbackCompare: j.compare,
            brief: qBrief(`q${i + 1}`, j.q, ""),
          };
        }),
        ...others.map(
          (q, i): AiCand => ({
            key: `o${i + 1}`,
            typeCode: String(q.option_key ?? "").split(":").pop() ?? "",
            source: label(q),
            date: dateLabel(q.created_at),
            card: qCard(q, [], false),
            brief: qBrief(`o${i + 1}`, q, " (시험과 다른 유형)"),
          })
        ),
        ...[...shownMats, ...upCands, ...packs].map((m, i): AiCand => ({
          key: m.source.startsWith("올린 자료") ? `u${i + 1}` : m.level === "cand" ? `p${i + 1}` : `m${i + 1}`,
          ruleSame: m.level === "same",
          sameType: m.level === "same" || !!m.typeSame,
          source: m.source,
          date: m.date,
          card: { kind: "line", source: m.source, date: m.date, linesHtml: [m.lineHtml] },
          fallbackCompare: m.compare,
          // 올린 자료는 규칙이 자리를 찾았어도 [u] — [m](수업자료, ②까지)로 보여 같은 삽입 문장이 ②가 되던 것(상우고1 4번)
          // 모델에 보이는 이름표와 키가 같아야 한다 — [m1]로 보이고 키는 p1 이라 근거가 버려지던 것(발곡고1 5·8번)
          brief: `[${m.source.startsWith("올린 자료") ? `u${i + 1}` : m.level === "cand" ? `p${i + 1}` : `m${i + 1}`}] ${m.source}${m.date ? ` (${m.date})` : ""}\n${briefMark(m.lineHtml)}`,
        })),
      ];
      const fromSaved = (b: BookItem): AiResult => {
        // 도식의 「…  (자료 이름)」에서 자료 이름으로 후보 키를 되찾는다
        const evidence = b.compare.flatMap((c) => {
          const ours = c.ours.trim();
          const hit = pool.find((x) => ours.endsWith(`(${x.source})`));
          if (!hit) return [];
          const quote = ours.slice(0, ours.length - hit.source.length - 2).trim();
          return [{ key: hit.key, exam_quote: c.exam, ours_quote: quote, why: c.same }];
        });
        const level = b.verdict === "same" ? ("same" as const) : ("similar" as const);
        return { verdict: b.verdict, matched: evidence.map((e) => ({ key: e.key, level })), evidence, reason: b.reason };
      };
      if (saved && saved.verdict === "none") return { ...base, verdict: "none", count: 0, reason: saved.reason, compare: [], cards: [] };
      // 문장 삽입: 그 문장이 우리 자료에서 지문 속 문장일 뿐이면 모델에게 미리 알린다 — 까닭 글에 「같은 주어진 문장」이라 쓰지 않게
      const givenOk = new Map<string, boolean>();
      if (fam === "insertion" && matCtx.given) {
        const passage = block.body.split("\n").slice(1).join(" ");
        const givenWords = plainWords(matCtx.given).join(" ");
        for (const c of pool) {
          // 우리가 만든 삽입 문항은 발문 아래 글이 곧 주어진 문장이다(바꿔 쓴 문장이어도) — 검사하지 않는다(발곡고1 7번이 ②로 깎였다)
          if (c.card.kind === "question") continue;
          const up = uploads.find((u) => c.source === `올린 자료 「${u.name}」`);
          const body = c.card.linesHtml.join(" ");
          const has = up ? plainWords(up.text).join(" ").includes(givenWords) : within(matCtx.given, body.replace(/<[^>]+>/g, " ")) >= 0.8;
          if (!has) continue;
          const ok = up ? uploadGivesGiven(up.text, matCtx.given, passage) : givenAsGiven(body, matCtx.given, passage);
          givenOk.set(c.key, ok);
          if (!ok) c.brief += "\n(확인: 시험의 주어진 문장이 이 자료에서는 지문 속 문장으로만 나온다 — 주어진 문장으로 낸 삽입 문제가 아니다)";
        }
      }
      const r = saved ? fromSaved(saved) : pool.length ? await aiJudge(examBriefOf(it, block, markedBody, answer), pool) : null;
      if (r) {
        const byKey = new Map(pool.map((c) => [c.key, c]));
        // 다른 유형 문항(o)·자료 묶음(p)·규칙이 같은 형식이라 하지 않은 자료(m)는 ②까지 — 한 줄 해석에 같은 문장이 있다고 ①이 되던 것(발곡고1 1·3번)
        const cap = (k: string) => k.startsWith("q") || k.startsWith("u") || (k.startsWith("m") && byKey.get(k)?.ruleSame);
        r.matched = r.matched.map((m) => (m.level === "same" && !cap(m.key) ? { ...m, level: "similar" as const } : m));
        if (fam === "insertion" && matCtx.given) {
          const passage = block.body.split("\n").slice(1).join(" ");
          r.matched = r.matched.map((m) => {
            const c = byKey.get(m.key);
            if (m.level !== "same" || !c || c.card.kind === "question") return m;
            const known = givenOk.get(m.key);
            const up = uploads.find((u) => c.source === `올린 자료 「${u.name}」`);
            const ok =
              known ??
              (up
                ? uploadGivesGiven(up.text, matCtx.given, passage)
                : givenAsGiven(c.card.linesHtml.join(" "), matCtx.given, passage));
            return ok ? m : { ...m, level: "similar" as const };
          });
        }
        if (!saved && r.verdict === "same" && !r.matched.some((m) => m.level === "same")) r.verdict = r.matched.length ? "similar" : "none";
        /*
         * 같은 지문 · 같은 유형 우리 문항이 있으면 적어도 ② — 일람표의 ② 정의 그대로다. 모델이 「묻는 자리가 다르다」며
         * 아님을 낸 것(호원고1 8번: 같은 지문 어법 문제를 두 번 풀었는데 다루지 않음)을 바로잡는다.
         */
        /*
         * 삽입 · 순서 · 무관한 문장은 그 유형을 풀어 봤어야 ② — 다른 유형 문항(o)이나 자료 묶음(p)만으로 ②를 주던 것
         * (호원고1 13번: 무관한 문장 문제는 없고 순서 문제만 있었다)을 「다루지 않음」으로 돌린다.
         */
        if (!saved && r.verdict === "similar" && (fam === "insertion" || fam === "order" || fam === "irrelevant")) {
          const typed = r.matched.filter((m) => m.key.startsWith("q") || ((m.key.startsWith("u") || m.key.startsWith("m")) && byKey.get(m.key)?.sameType));
          if (typed.length === 0) {
            r.verdict = "none";
            r.matched = [];
            r.evidence = [];
            r.reason = "";
          } else r.matched = typed;
        }
        const sameTypeQ = pool.find((c) => c.key.startsWith("q") && c.exactType);
        if (!saved && r.verdict === "none" && sameTypeQ) {
          r.verdict = "similar";
          r.matched = [{ key: sameTypeQ.key, level: "similar" }];
          r.evidence = [{ key: sameTypeQ.key, exam_quote: it.type_name.split(" · ")[0]!, ours_quote: sameTypeQ.card.kind === "question" ? sameTypeQ.card.instruction : "", why: "같은 지문을 같은 유형으로 미리 풀었음" }];
          r.reason = `「${sameTypeQ.source}」(${sameTypeQ.date})에서 같은 지문을 같은 유형으로 미리 풀었습니다. 시험이 물은 자리까지 같지는 않아 유사 유형으로 셉니다.`;
        }
        const evKeys = [...new Set([...r.evidence.map((e) => e.key), ...r.matched.map((m) => m.key)])];
        const cards: BookCard[] = [];
        /*
         * 같은 유형 우리 문항(q)과 같은 유형 발문이 붙은 자료를 먼저 붙인다. ② 쪽(또는 같은 유형 카드가 없을 때)은
         * 근거가 된 다른 형식 자료도 붙이되 「다른 형식 · 어순 배열」 꼬리표로 밝힌다 — 같은 유형만 남기니 ② 쪽 아래가
         * 텅 비었다(2026-10-15 상우고1 4·7·20번).
         */
        const sameKindOf = (k: string) => {
          const c = byKey.get(k);
          return (k.startsWith("q") && !!c?.exactType) || (!k.startsWith("q") && !k.startsWith("o") && !!c?.sameType);
        };
        const tagOf = (c: AiCand) => `다른 형식 · ${(c.typeCode || "").replace(/[_-]+/g, " ").trim() || (c.card.kind === "line" ? c.source.split(/\s*[·:]\s*/)[0] : "다른 유형")}`;
        const ordered = [...evKeys.filter(sameKindOf), ...evKeys.filter((k) => !sameKindOf(k))];
        for (const k of ordered) {
          const c = byKey.get(k);
          const sameKind = sameKindOf(k);
          if (!sameKind && (r.verdict === "same" ? cards.length > 0 : false)) continue;
          if (!c || cards.some((x) => x.source === c.source && x.kind === c.card.kind)) continue;
          const quote = r.evidence.find((e) => e.key === k)?.ours_quote ?? "";
          /*
           * 인용에 ⑥·[ ]·⟦ ⟧ 가 섞이면 지문 글자와 그대로 맞지 않아 빨간 표시가 안 붙었다 — 표지를 뗀 글과
           * 괄호 안 낱말로도 표시한다(2026-10-15 발곡고1 14번 「build back our ⑥ [hostility]」).
           */
          const inner = [...quote.matchAll(/[[⟦]([^\]⟧]{2,40})[\]⟧]/g)].map((m) => m[1]!.split("/")[0]!.trim());
          const plainQuote = quote.replace(/[①-⑳ⓐ-ⓩ]|[[\]⟦⟧]/g, " ").replace(/\s+/g, " ").trim();
          // 긴 인용(문단 통째)은 빨간 상자로 칠하지 않는다 — 지문 반이 빨개졌다(상우고1 2번)
          const marks = [quote, plainQuote, ...inner].filter((x) => x.length > 2 && x.length <= 160);
          const mark = (h: string) => {
            for (const m of marks) {
              const out = markHtml(h, [m]);
              if (out !== h) return out;
            }
            return h;
          };
          const tag = sameKind ? undefined : tagOf(c);
          cards.push(
            c.card.kind === "question"
              ? { ...c.card, tag, passageHtml: quote ? mark(c.card.passageHtml) : c.card.passageHtml }
              : { ...c.card, tag, linesHtml: c.card.linesHtml.map((h) => (quote ? mark(h) : h)) }
          );
          if (cards.length >= 2) break;
        }
        const compare: BookCompare[] = r.evidence.map((e) => ({
          exam: e.exam_quote,
          ours: `${e.ours_quote}  (${byKey.get(e.key)?.source ?? ""})`,
          same: e.why,
        }));
        const counted = r.matched.filter((m) => (r.verdict === "same" ? m.level === "same" : true));
        if (saved) return { ...base, verdict: saved.verdict, count: saved.count, reason: saved.reason, compare: saved.compare, cards };
        return {
          ...base,
          verdict: r.verdict,
          count: new Set(counted.map((m) => m.key)).size,
          reason: r.reason,
          compare,
          cards,
        };
      }
    }

    const verdict: BookVerdict =
      sameQs.length > 0 || sameMats.length > 0 ? "same" : nearQs.length > 0 || mats.length > 0 ? "similar" : "none";
    const count = (verdict === "same" ? sameQs.length : nearQs.length) + matSources;

    const cardOf = (j: (typeof judged)[number]): BookCard => qCard(j.q, j.marks, j.same);
    // 카드는 두 장 — 같은 자리를 물은 것이 앞
    const matCards: BookCard[] = [...new Set(mats.filter((m) => m.level === "same" || m.typeSame).map((m) => m.source))].map((src) => {
      const ms = mats.filter((m) => m.source === src);
      return { kind: "line", source: src, date: ms[0]!.date, linesHtml: ms.slice(0, 3).map((m) => m.lineHtml) };
    });
    const qCards = (sameQs.length ? sameQs : nearQs).map(cardOf);
    const matFirst = sameQs.length === 0 && sameMats.length > 0;
    const cards: BookCard[] = matFirst
      ? matCards.slice(0, 2)
      : matCards.length
        ? [...qCards.slice(0, 1), ...matCards.slice(0, qCards.length ? 1 : 2)]
        : qCards.slice(0, 2);

    const compare: BookCompare[] = [];
    const cmpAll = [
      ...sameQs.map((j) => j.compare),
      ...sameMats.map((m) => m.compare),
      ...nearQs.map((j) => j.compare),
      ...mats.filter((m) => m.level === "similar").map((m) => m.compare),
    ];
    for (const c of cmpAll) {
      if (c && !compare.some((x) => x.exam === c.exam && x.ours === c.ours)) compare.push(c);
      if (compare.length >= 3) break;
    }

    const firstQ = sameQs[0];
    const firstM = sameMats[0] ?? mats[0];
    const matNote = mats.length ? ` 수업자료(워크북 · 1장 자료)에서도 같은 자리를 ${mats.length}번 다뤘습니다.` : "";
    const reason =
      verdict === "same"
        ? firstQ
          ? `${label(firstQ.q)}(${dateLabel(firstQ.q.created_at)})가 시험과 같은 자리를 물었습니다${
              firstQ.compare ? ` — ${firstQ.compare.same}` : ""
            }.${matNote} 시험 전에 같은 자리를 다룬 우리 자료가 모두 ${count}개입니다.`
          : `${firstM!.source}(${firstM!.date}) — ${firstM!.compare.same}. 시험 전에 같은 자리를 다룬 우리 자료가 모두 ${count}개입니다.`
        : verdict === "similar"
          ? nearQs.length > 0
            ? `${label(nearQs[0]!.q)}(${dateLabel(nearQs[0]!.q.created_at)}) — ${nearQs[0]!.compare?.same ?? "같은 지문 · 같은 유형"}.${nearQs.length > 1 ? ` 이렇게 가까운 우리 문항이 ${nearQs.length}개입니다.` : ""}${matNote} 묻는 자리까지 같지는 않아 유사 유형으로 셉니다.`
            : `${firstM!.source}(${firstM!.date}) — ${firstM!.compare.same}. 시험과 같은 형식의 문항은 없어 유사 유형으로 셉니다.`
          : "";

    return { ...base, verdict, count, reason, compare, cards };
  };
  const todo = opts.only ? items.filter((x) => x.id === opts.only) : items;
  const out: BookItem[] = new Array(todo.length);
  let next = 0;
  // 모델 판정은 문항마다 수십 초라 열 개씩 같이 돌린다(5분 안에 끝나게)
  await Promise.all(
    Array.from({ length: Math.min(opts.ai ? 10 : 4, todo.length) }, async () => {
      while (next < todo.length) {
        const k = next++;
        out[k] = await one(todo[k]!);
      }
    })
  );
  return assembleHitBook(analysis, out, cutoff);
}

/** 문항 번호 순서 — 1, 2, … 20, 서술형1 … (재검토·병렬 판정으로 순서가 섞였다) */
export function itemOrder(a: { no: string }, b: { no: string }): number {
  const key = (no: string) => {
    const n = no.match(/\d+/)?.[0];
    return [/^\d/.test(no) ? 0 : 1, n ? Number(n) : 999] as const;
  };
  const [ga, na] = key(a.no);
  const [gb, nb] = key(b.no);
  return ga - gb || na - nb || a.no.localeCompare(b.no);
}

/** 문항들로 자료집 합계를 낸다 — 재검토로 한 문항만 바꿀 때도 쓴다 */
export function assembleHitBook(analysis: ExamAnalysisRow, out: BookItem[], cutoff: string | null): HitBook {
  out = [...out].sort(itemOrder);
  const pts = (x: BookItem) => Number(x.points ?? 0);
  const totalPts = Number(analysis.total_points ?? 0) || out.reduce((s, x) => s + pts(x), 0) || 1;
  const same = out.filter((x) => x.verdict === "same");
  const similar = out.filter((x) => x.verdict === "similar");
  const school = String(analysis.school_name ?? "").replace(/등학교$/, "");
  const grade = String(analysis.grade ?? "").replace(/학년/, "");
  return {
    analysisId: analysis.id,
    title: `${school}${grade}`,
    subtitle: [analysis.school_name, analysis.grade ? `${grade}학년` : "", analysis.subject].filter(Boolean).join(" · "),
    examLabel: String(analysis.exam_label ?? ""),
    cutoff,
    items: out,
    sameCount: same.length,
    similarCount: similar.length,
    samePct: Math.round((same.reduce((s, x) => s + pts(x), 0) / totalPts) * 1000) / 10,
    similarPct: Math.round((similar.reduce((s, x) => s + pts(x), 0) / totalPts) * 1000) / 10,
    total: out.length,
    materials: out.filter((x) => x.verdict !== "none").reduce((s, x) => s + x.count, 0),
  };
}

/**
 * DB(jsonb)가 받지 못하는 글자를 지운다 — 제어 문자(\u0000 등)와 짝 없는 유니코드 반쪽.
 * 선생님 화면에서 「unsupported Unicode escape sequence」로 저장이 막혔다(2026-10-15, 한글 자료 23개를 올린 상우고1).
 */
// eslint-disable-next-line no-control-regex -- DB(jsonb)가 받지 못하는 제어 문자를 일부러 찾는다
const PG_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function pgSafe<T>(value: T): T {
  if (typeof value === "string") return value.replace(PG_BAD, "") as T;
  if (Array.isArray(value)) return value.map((x) => pgSafe(x)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, x]) => [k, pgSafe(x)])) as T;
  }
  return value;
}

/** 보고서 화면에 띄우는 요약 — 담아 둔 자료집에서 뽑는다 */
export type HitBookSummary = {
  at: string;
  samePct: number;
  similarPct: number;
  sameCount: number;
  similarCount: number;
  total: number;
  materials: number;
  items: Array<{ id: string; no: string; typeName: string; verdict: BookVerdict; count: number }>;
};

export function summarizeHitBook(book: HitBook, at: string): HitBookSummary {
  return {
    at,
    samePct: book.samePct,
    similarPct: book.similarPct,
    sameCount: book.sameCount,
    similarCount: book.similarCount,
    total: book.total,
    materials: book.materials,
    items: book.items.map((x) => ({ id: x.id, no: x.no, typeName: x.typeName, verdict: x.verdict, count: x.count })),
  };
}
