/**
 * 만들기 전 확인 창을 부르는 다리.
 *
 * 크레딧이 나가는 곳이 화면 곳곳에 있어서, 자리마다 창을 따로 두면 빠지는 곳이 생긴다.
 * 창은 학원·선생님 화면 맨 위에 하나만 띄워 두고, 어디서든 askCreditConfirm()으로 부른다.
 * 창이 없으면(학생 화면 등) 그냥 통과시킨다 — 확인 창 때문에 기능이 막히지는 않게 한다.
 */

export type CreditConfirmItem = {
  /** feature_pricing의 feature_key */
  feature: string;
  /** 단가 × 몇 개 (지문 수 등) */
  quantity?: number;
};

/** 견본을 보여 줄 자료 종류. 없으면 견본 없이 값만 묻는다. */
export type CreditSampleKind =
  | "lesson_pack"
  | "analysis_report"
  | "workbook"
  | "one_page_summary"
  | "one_page_test"
  | "integrated"
  | "question"
  | "exam_mock"
  /** 동형모의고사 만들기 — 학교 시험지 양식 문제지 견본(시험 분석 만들기 견본과 따로, 2026-11-24) */
  | "exam_mock_paper"
  | "illustration";

export type CreditConfirmRequest = {
  /** 창 제목에 쓸 이름 (예: "1장 요약직보자료") */
  title: string;
  /** 무엇을 만드는지 한두 줄 */
  description?: string;
  /** 대상 설명 (예: "고른 지문 2개") */
  subject?: string;
  /** 들어가는 항목 */
  contents?: string[];
  /** 값이 나가는 기능들 */
  items: CreditConfirmItem[];
  /** 왼쪽에 보여 줄 견본 */
  sample?: CreditSampleKind;
};

type Listener = (req: (CreditConfirmRequest & { resolve: (ok: boolean) => void }) | null) => void;

let listener: Listener | null = null;

/** 확인 창이 붙을 때 부른다. 창이 사라지면 null로 해제한다. */
export function setCreditConfirmListener(next: Listener | null) {
  listener = next;
}

/** 이 화면에 확인 창이 떠 있는지 */
export function hasCreditConfirm(): boolean {
  return listener !== null;
}

const SKIP_KEY = "engcore:skip-credit-confirm";

export function creditConfirmSkipped(): boolean {
  try {
    return window.localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCreditConfirmSkipped(skip: boolean) {
  try {
    if (skip) window.localStorage.setItem(SKIP_KEY, "1");
    else window.localStorage.removeItem(SKIP_KEY);
  } catch {
    // 브라우저가 저장을 막아 두면 그냥 매번 묻는다
  }
}

/**
 * 만들기 전에 묻는다. 만들어도 된다고 하면 true.
 * 확인 창이 없거나 "다음부터 건너뛰기"를 켜 두었으면 묻지 않고 true.
 */
export function askCreditConfirm(req: CreditConfirmRequest): Promise<boolean> {
  if (!listener) return Promise.resolve(true);
  if (creditConfirmSkipped()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    listener?.({ ...req, resolve });
  });
}
