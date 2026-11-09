/**
 * 지금 인쇄 중인가(인쇄 창·인쇄 미리보기). 인쇄용 글꼴이 들어오며 「글꼴 다 들어옴」 신호가 다시 오면
 * 화면들이 쪽 나눔을 인쇄 크기로 다시 재서 쪽마다 두세 줄만 남는 빈 쪽이 생겼다(선생님 2026-11-09
 * 「바로 인쇄 누르면 여백이 많이 생긴다」 — 최종통합자료 121쪽이 313쪽). 인쇄 중에는 다시 재지 않는다.
 */
export function isPrinting(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("print").matches;
}
