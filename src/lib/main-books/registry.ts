/**
 * 본교재 수업자료 — 학원이 쓰는 자체 교재 목록(선생님 2026-11-26: 「여러 교재를 추가할 거라」).
 * 교재를 늘릴 때는 여기에 한 줄 + src/app/{admin,teacher}/main-books/<slug>/page.tsx 한 쪽을 붙인다.
 */
export type MainBook = {
  slug: string;
  title: string;
  subtitle: string;
  grades: string;
  span: string;
  /** 카드 색 */
  color: string;
};

export const MAIN_BOOKS: MainBook[] = [
  {
    slug: "eogudok",
    title: "어구독 (겨울주간지)",
    subtitle: "어법 · 구문 · 독해 — 매주 어법 한 장 + 학평 기출 지문, 조교 1:1 주간 테스트",
    grades: "예비고1 · 예비고2 · 예비고3",
    span: "겨울방학 12주",
    color: "#3a2fd0",
  },
];
