/**
 * 1지문 다문항(세트) — 지문 하나에 문항 2~3개를 붙이고 시험지에는 지문을 한 번만 찍는다.
 *
 * 다른 학원 요청(2026-10-10), 선생님 결정: 지문당 2문항·3문항을 고를 수 있게, 모든 학원에 연다.
 * 선생님 결정(2026-10-11): 「무조건 한 지문 안에 다 만들어지게, 그게 어려운 유형은 경고를 띄워 다른 유형을 고르게」.
 *  - 원문 그대로 푸는 유형(주제·제목·요지·일치·요약문 등)은 공용 지문을 함께 쓴다.
 *  - 지문에 빈칸·밑줄을 치는 유형(빈칸·어법·어휘·함축·제시어배열·지칭 등)은 문항마다 원문 위에서 만들고,
 *    바꾼 자리만 떼어 한 지문에 겹친다(passage-set-merge). 뒤에 만드는 문항은 앞 문항이 쓴 문장을 피한다.
 *  - 같은 표시(①~⑤, ⓐ~, (A)·(B), 빈칸)를 쓰는 유형 둘은 한 지문에서 번호가 겹쳐 함께 넣지 못한다.
 *  - 문장을 빼거나 지문을 자르는 유형(무관한문장·문장삽입·순서·어법 문장 수정)은 한 지문에 합칠 수 없어 뺀다.
 *  - 빈칸 정답과 주제·제목 정답이 겹쳐도 둔다 — 연습용이라 괜찮다(같은 날). 세트끼리 답이 새는지 보는 검수는 없다.
 */

/** 한 지문에 합칠 수 없는 유형 — 고르면 경고하고 다른 유형을 고르게 한다 */
const EXCLUDED_CODES = new Set(["무관한문장", "문장삽입", "순서추론", "어법문장오류수정"]);

/**
 * 지문에 표시하는 유형과 그 표시 갈래. 같은 갈래 둘은 한 지문에서 번호가 겹친다.
 *  ①~⑤ 밑줄 / ⓐ~ 밑줄·빈칸 / (A)·(B) / 번호 없는 빈칸 / 번호 없는 밑줄
 */
const MARK_FAMILY: Record<string, string> = {
  어휘추론: "①~⑤",
  어법추론: "①~⑤",
  어법개수: "ⓐ~",
  어휘개수: "ⓐ~",
  어법오류수정2: "ⓐ~",
  어법오류수정3: "ⓐ~",
  제시어배열기본: "ⓐ~",
  제시어배열어형변화: "ⓐ~",
  제시어배열단어추가: "ⓐ~",
  지칭대명사서술: "ⓐ~",
  함축의미추론: "(A)",
  연결어빈칸: "(A)",
  빈칸추론: "빈칸",
  특정표현의미서술: "밑줄",
  // 아래는 목록에 빠져 있던 표시형(2026-11-24 전반 점검) — 빠지면 세트에서 그 문항만 지문을 한 번 더 찍는다
  문법조건영작: "ⓐ~",
  어휘빈칸공통: "ⓐ~",
  구문변환: "ⓐ~",
  어법통문장: "①~⑤",
  빈칸단어: "빈칸",
};

export const PASSAGE_SET_SIZES = [2, 3] as const;
export type PassageSetSize = (typeof PASSAGE_SET_SIZES)[number];

export interface PassageSetConfig {
  size: PassageSetSize;
  /** 세트 안 문항 차례대로 유형 키(option key). 길이 = size. 구성이 여럿이면 첫 구성 */
  keys: string[];
  /**
   * 세트 구성 여럿(구성 A·B…). 지문 차례대로 A·B·A·B… 번갈아 붙인다(선생님 결정 2026-10-10: 「절반씩」).
   * 없으면 keys 하나만 쓴다.
   */
  variants?: string[][];
}

/** 세트 구성은 4개까지 */
export const MAX_SET_VARIANTS = 4;

const codeOf = (key: string) => String(key ?? "").split(":").pop() ?? "";

/** 지문에 빈칸·밑줄을 치는 유형인가 */
export const isSetMarkKey = (key: string) => codeOf(key) in MARK_FAMILY;
/** 세트에 넣을 수 있는 유형인가(한 지문에 합칠 수 있는가) */
export const isSetAllowedKey = (key: string) => !EXCLUDED_CODES.has(codeOf(key));
/** 이 유형이 지문에 쓰는 표시 갈래(표시형이 아니면 null) */
export const setMarkFamily = (key: string) => MARK_FAMILY[codeOf(key)] ?? null;

/** 이 세트 설정의 구성 목록 */
export function setVariants(set: PassageSetConfig): string[][] {
  return Array.isArray(set.variants) && set.variants.length > 0 ? set.variants : [set.keys];
}

/** pi번째 지문(0부터)에 붙일 구성 — 번갈아 붙인다 */
export function setKeysForPassage(set: PassageSetConfig, pi: number): string[] {
  const list = setVariants(set);
  return list[pi % list.length]!;
}

/** 구성 하나에서 한 지문에 합칠 수 없는 까닭(없으면 null) */
export function setVariantProblem(size: number, keys: string[]): string | null {
  if (!Array.isArray(keys) || keys.length !== size || keys.some((k) => !k)) {
    return `세트의 문항 ${size}개 유형을 모두 골라 주세요.`;
  }
  const excluded = keys.filter((k) => !isSetAllowedKey(k)).map(codeOf);
  if (excluded.length) {
    return `${[...new Set(excluded)].join("·")}은(는) 문장을 빼거나 지문을 잘라서 한 지문에 다른 문항과 함께 만들 수 없습니다. 다른 유형을 골라 주세요.`;
  }
  const seen = new Map<string, string>();
  for (const k of keys) {
    const fam = setMarkFamily(k);
    if (!fam) continue;
    const other = seen.get(fam);
    if (other) {
      return `${other}와(과) ${codeOf(k)}은(는) 지문에 같은 표시(${fam})를 써서 한 지문에 함께 넣으면 번호가 겹칩니다. 둘 중 하나를 다른 유형으로 골라 주세요.`;
    }
    seen.set(fam, codeOf(k));
  }
  return null;
}

/** 세트 구성이 맞는지. 틀리면 선생님께 보일 까닭, 맞으면 null */
export function passageSetProblem(set: PassageSetConfig | null | undefined): string | null {
  if (!set) return null;
  if (!PASSAGE_SET_SIZES.includes(set.size as PassageSetSize)) return "지문당 문항 수는 2문항이나 3문항입니다.";
  const list = setVariants(set);
  if (list.length > MAX_SET_VARIANTS) return `세트 구성은 ${MAX_SET_VARIANTS}개까지 넣을 수 있습니다.`;
  for (const [i, keys] of list.entries()) {
    const problem = setVariantProblem(set.size, keys);
    if (problem) return list.length > 1 ? `구성 ${"ABCD"[i]}: ${problem}` : problem;
  }
  return null;
}

/** 세트 구성을 유형별 개수로(크레딧 계산·기존 개수 칸과 맞춘다) */
export function passageSetCounts(set: PassageSetConfig): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of set.keys) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}

/** 세트에서 다른 유형으로 바꿔 만들 때 쓸 수 있는 후보인가 — 한 지문에 합칠 수 있어야 한다 */
export function setFallbackAllowed(candidateKey: string, otherKeys: string[]): boolean {
  if (!isSetAllowedKey(candidateKey)) return false;
  const fam = setMarkFamily(candidateKey);
  return !fam || !otherKeys.some((k) => setMarkFamily(k) === fam);
}
