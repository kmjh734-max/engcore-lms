import { CANONICAL_SITE_URL } from "@/lib/branding";

/**
 * 중학교 수업자료 QR 주소(로그인 없이 여는 곳) — 인쇄물에 찍히므로 개발 PC에서 뽑아도 늘 실제 사이트 주소여야 한다.
 */
export type MsLectureSlug = "dialogue" | "grammar" | "reading";

export const MS_LECTURE_SECTIONS: Record<MsLectureSlug, { ko: string; prefix: string }> = {
  dialogue: { ko: "대화문", prefix: "대화문" },
  grammar: { ko: "문법", prefix: "문법" },
  reading: { ko: "본문", prefix: "본문" },
};

function qrBase(): string {
  const base = CANONICAL_SITE_URL.replace(/\/$/, "");
  return /localhost|127\.0\.0\.1/.test(base) ? "https://www.engcore.co.kr" : base;
}

export function msLectureUrl(unitId: string, slug: MsLectureSlug): string {
  return `${qrBase()}/ms-lecture/${unitId}/${slug}`;
}

export function msVocabUrl(unitId: string): string {
  return `${qrBase()}/exam-vocab/ms/${unitId}`;
}
