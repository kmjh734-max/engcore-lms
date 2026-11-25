/*
 * 동형모의고사 지문 갈래(교과서/모의고사) — 화면에서도 쓰므로 서버 코드와 떼어 둔다.
 * 선생님 지적(2026-11-25) 「교과서·모의고사 지문 비율도 맞춰서 실제 동형도 그렇게 맞춰야 해」.
 */
/** 고른 지문 이름으로 갈래를 어림한다(교과서 「1과 본문2」, 모의고사 「24년 고2 6월 학평 24번」) */
export function passageKindFromLabel(label: string): "textbook" | "mock" | null {
  if (/\d+\s*과|본문|대화문|Lesson|추가지문/i.test(label)) return "textbook";
  if (/학평|모의|학력평가|수능|\d+월|외부/.test(label)) return "mock";
  return null;
}

