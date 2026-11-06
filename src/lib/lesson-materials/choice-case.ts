/**
 * [A / B] 고르기 두 보기의 첫 글자 크기를 맞춘다 — 문장 첫머리에서 한쪽만 대문자면 그쪽이 답인 게 드러났다
 * (선생님 2026-11-06 검수: 「What / that」「Despite / although」).
 */
export function sameCaseChoices(a: string, b: string): [string, string] {
  const up = (s: string) => /^[A-Z]/.test(s);
  const low = (s: string) => /^[a-z]/.test(s);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (up(a) && low(b)) return [a, cap(b)];
  if (up(b) && low(a)) return [cap(a), b];
  return [a, b];
}
