/**
 * 수업용 자료 문장 옆 사진·그림(선생님 2026-11-15, 정수학원만 — 기능 lesson_figures).
 *
 * 실제 대상(동물·식물·장소)이나 실험·수치·구조가 나오는 지문에만, 그 내용을 처음 말하는 문장 옆에 1~2장.
 * 무료 사진(위키미디어 등, 출처 표기)을 먼저 쓰고 없으면 그림을 만든다. 수치·구조 도식은 SVG로 직접 그린다.
 * 자리는 오른쪽 칸이 기본이고, 그림이 크거나(wide) 오른쪽 칸이 문장보다 길어지면 문장 아래 띠로 내린다.
 */
export type LessonFigure = {
  /** 문장 첫머리(문장이 다시 나뉘어도 찾게) — 못 찾으면 si */
  q: string;
  si?: number;
  /** 사진 주소(Supabase 저장소 — PDF 서버가 받을 수 있는 곳) */
  src?: string;
  /** 직접 그린 도식 */
  svg?: string;
  caption: string;
  credit: string;
  /** 가로로 긴 그림 — 처음부터 문장 아래 띠로 */
  wide?: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 그림마다 붙을 문장 번호 */
export function placeFigures(sentences: string[], figures: LessonFigure[] | null | undefined): Map<number, LessonFigure[]> {
  const out = new Map<number, LessonFigure[]>();
  const ns = sentences.map(norm);
  for (const f of figures ?? []) {
    if (!f || (!f.src && !f.svg)) continue;
    const q = norm(f.q ?? "");
    let si = q ? ns.findIndex((s) => s.startsWith(q) || (q.length >= 12 && s.includes(q))) : -1;
    if (si < 0 && typeof f.si === "number" && f.si >= 0 && f.si < sentences.length) si = f.si;
    if (si < 0) continue;
    out.set(si, [...(out.get(si) ?? []), f]);
  }
  return out;
}
