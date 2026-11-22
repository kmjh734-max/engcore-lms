/**
 * Stage 2/3 spelling: ignore case, trim, collapse spaces.
 * 물결표(~ ∼ 〜 ～)는 「be fond of ~」처럼 자리 표시일 뿐이라 치지 않아도 맞게 한다(선생님 2026-11-22).
 */
export function normalizeSpellingAnswer(value: string): string {
  return value
    .replace(/[~∼〜～]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[-–—]/g, "-");
}

export function gradeSpellingAnswer(
  correctAnswer: string,
  studentAnswer: string
): boolean {
  const student = studentAnswer.trim();
  if (!student) return false;
  return (
    normalizeSpellingAnswer(student) ===
    normalizeSpellingAnswer(correctAnswer)
  );
}
