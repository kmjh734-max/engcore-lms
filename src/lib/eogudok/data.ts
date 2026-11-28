import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { isMiddleSchoolOpen } from "@/lib/middle-school/queries";

/**
 * 어구독 (겨울주간지) — 검수를 마친 완성본을 주차 조각으로 나눠 둔 것(content/eogudok)을 읽는다.
 * 조각은 참고파일/어구독/build/export_engcore.py 가 만든다. 내용은 고정이라 언제 뽑아도 같은 쪽이 나온다.
 * 정수학원만(중학교 수업자료와 같은 학원 설정) — 선생님 2026-11-26.
 */

export type EgGrade = 1 | 2 | 3;
export type EgWeek = {
  n: number;
  grammar: string;
  reading: string;
  src: string;
  pages: [number, number] | null;
  vocabCount: number;
  grammarCount: number;
  arrangeCount?: number;
  translateCount?: number;
};
export type EgMeta = { grade: EgGrade; weeks: EgWeek[]; totalPages: number };
export type EgTest = {
  vocab: { en: string; ko: string }[];
  grammar: { q: string; choices: [string, string]; ans: string }[];
  arrange?: { ko: string; bogi: string; ans: string; change: boolean }[];
  translate?: { en: string; ko: string }[];
};

const ROOT = path.join(process.cwd(), "content", "eogudok");

export const isEogudokOpen = isMiddleSchoolOpen;

export function parseGrade(v: string | null | undefined): EgGrade | null {
  return v === "1" || v === "2" || v === "3" ? (Number(v) as EgGrade) : null;
}

async function readJson<T>(g: EgGrade, file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(ROOT, `g${g}`, file), "utf8")) as T;
}

export const loadEgMeta = (g: EgGrade) => readJson<EgMeta>(g, "meta.json");
export const loadEgTest = (g: EgGrade, w: number) => readJson<EgTest>(g, `test_w${String(w).padStart(2, "0")}.json`);

type BookJson = { head: string; pages: { week: number; html: string }[] };
type AnswersJson = { head: string; ahead: string; blocks: Record<string, string> };

const PRINT_BAR = `
<style>@media print{.eg-bar{display:none!important}} .eg-bar{position:fixed;top:12px;right:12px;z-index:9999;display:flex;gap:8px;font:600 13px Pretendard,sans-serif}
.eg-bar button{background:#3a2fd0;color:#fff;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}</style>
<div class="eg-bar"><button onclick="window.print()">인쇄 · PDF 저장</button></div>`;

/** 학생용·교사용 책 HTML. weeks 가 비면 12주 전체. front=표지·차례 포함 */
export async function buildEgBook(g: EgGrade, mode: "student" | "teacher", weeks: number[], front: boolean) {
  const book = await readJson<BookJson>(g, mode === "teacher" ? "teacher.json" : "student.json");
  const want = new Set(weeks);
  const pages = book.pages.filter((p) => (p.week === 0 ? front : want.size === 0 || want.has(p.week)));
  return `${book.head}\n${PRINT_BAR}\n${pages.map((p) => p.html).join("\n")}\n</body></html>`;
}

export async function buildEgAnswers(g: EgGrade, weeks: number[]) {
  const a = await readJson<AnswersJson>(g, "answers.json");
  const keys = Object.keys(a.blocks).map(Number).sort((x, y) => x - y).filter((k) => weeks.length === 0 || weeks.includes(k));
  return `${a.head}\n${PRINT_BAR}\n${a.ahead}<div class="abook">${keys.map((k) => a.blocks[String(k)]).join("")}</div></body></html>`;
}
