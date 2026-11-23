import { ALL_QUESTION_OPTIONS } from "@/lib/question-generator/question-types";

/** option_key `type:lang:diff:코드` → 코드 (상·하·영·한 무시) */
export function printTypeCodeFromOptionKey(optionKey: string | null | undefined): string {
  const key = (optionKey || "").trim();
  if (!key) return "기타";
  const parts = key.split(":");
  if (parts.length >= 4) return parts[parts.length - 1] || "기타";
  // fallback: aingka-less keys
  return key;
}

/** 인쇄 소제목 — 상/하·영/한 구분 없이 유형명만 */
const PRINT_TYPE_LABEL: Record<string, string> = {
  제목추론: "제목",
  주제추론: "주제",
  요지추론: "요지",
  순서추론: "순서",
  빈칸추론: "빈칸",
  문장삽입: "문장 삽입",
  무관한문장: "무관한 문장",
  함축의미추론: "함축 의미",
  목적추론: "목적",
  심경추론: "심경·분위기",
  연결어빈칸: "연결어 빈칸",
  요약완성AB: "요약문 완성",
  답변가능개수: "답변 가능 개수",
  사례분류: "사례 분류",
  빈칸단어: "빈칸 · 단어",
  어법통문장: "어법 · 통문장",
  어휘빈칸공통: "어휘 빈칸 · 공통어",
  주제문작성: "주제문 작성",
  구문변환: "구문 변환",
  대화문완성: "대화문 완성",
  내용매칭: "내용 매칭",
  내용일치: "내용 일치",
  내용불일치: "내용 불일치",
  일치개수: "일치 개수",
  어법추론: "어법 · 추론",
  어법모두고르기: "어법 · 추론",
  어법개수: "어법 · 개수",
  어휘추론: "어휘",
  어휘개수: "어휘 · 개수",
  제시어배열기본: "제시어 배열 · 기본",
  제시어배열어형변화: "제시어 배열 · 어형변화",
  제시어배열단어추가: "제시어 배열 · 단어추가",
  요약문빈칸영작: "요약문 빈칸 · 영작",
  요약문빈칸2단어: "요약문 빈칸 · 2단어",
  요약문빈칸3단어: "요약문 빈칸 · 3단어",
  지칭대명사서술: "지칭 · 대명사",
  특정표현의미서술: "지칭 · 특정 표현",
  어법오류수정2: "어법 수정 · 2개",
  어법오류수정3: "어법 수정 · 3개",
  어법문장오류수정: "어법 수정 · 문장",
};

/** 카탈로그 등장 순 → 유형별 출력 순서 */
const CATALOG_TYPE_ORDER: string[] = [];
const seen = new Set<string>();
for (const o of ALL_QUESTION_OPTIONS) {
  const code = o.aingkaCode || printTypeCodeFromOptionKey(o.key);
  if (!code || seen.has(code)) continue;
  seen.add(code);
  CATALOG_TYPE_ORDER.push(code);
}

export function printTypeLabel(code: string): string {
  if (PRINT_TYPE_LABEL[code]) return PRINT_TYPE_LABEL[code];
  // 옵션 라벨에서 상·하·영·한 표기 제거
  const opt = ALL_QUESTION_OPTIONS.find(
    (o) => o.aingkaCode === code || printTypeCodeFromOptionKey(o.key) === code
  );
  if (opt?.label) {
    return opt.label
      .replace(/\s*[·・]\s*(하|상|중)\s*$/g, "")
      .replace(/\s*\((영|한|영어|한글)\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return code;
}

export function printTypeSortIndex(code: string): number {
  const i = CATALOG_TYPE_ORDER.indexOf(code);
  return i >= 0 ? i : 10_000;
}

export type PrintTypeGroup<T> = {
  code: string;
  label: string;
  items: T[];
};

/**
 * 선생님이 정한 유형 차례(코드 목록)대로 묶음을 다시 늘어놓는다.
 * 목록에 없는 유형은 원래 차례대로 뒤에 붙는다.
 *
 * 선생님 요청(2026-10-20): 유형별 출력에서 유형 순서를 바꿀 수 있게.
 */
export function applyTypeOrder<G extends { code: string }>(groups: G[], order: readonly string[]): G[] {
  if (order.length === 0) return groups;
  const at = (code: string) => {
    const i = order.indexOf(code);
    return i >= 0 ? i : order.length;
  };
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => at(a.g.code) - at(b.g.code) || a.i - b.i)
    .map((x) => x.g);
}

/** 상·하·영·한을 합쳐 문제 유형(코드)별로 묶음. order가 있으면 그 차례를 따른다. */
export function groupQuestionsByPrintType<
  T extends { option_key?: string | null; question_type?: string | null },
>(questions: T[], order: readonly string[] = []): PrintTypeGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const q of questions) {
    const code =
      printTypeCodeFromOptionKey(q.option_key) ||
      String(q.question_type || "기타");
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(q);
  }
  const codes = [...map.keys()].sort(
    (a, b) => printTypeSortIndex(a) - printTypeSortIndex(b) || a.localeCompare(b, "ko")
  );
  return applyTypeOrder(
    codes.map((code) => ({
      code,
      label: printTypeLabel(code),
      items: map.get(code)!,
    })),
    order
  );
}
