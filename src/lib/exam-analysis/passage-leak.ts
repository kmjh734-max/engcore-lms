/**
 * 동형모의고사에서 한 지문을 두 문항이 함께 쓸 때 답이 드러나지 않게 배정을 고른다(선생님 2026-11-28).
 *
 * 고른 지문이 문항 수보다 적으면 몇 지문은 두 번 쓰인다. 그때 한 문항이 지문을 바꿔 보이거나 일부를 가리면
 * (빈칸·제시어 배열·어휘·어법·순서·삽입·무관한 문장), 같은 지문을 쓰는 다른 문항이 원문을 그대로 보여 답이 드러난다.
 * 구현고1 동형 2·3차: 일치개수 지문에 어형변화 정답 문장이, 어법개수 지문에 빈칸 정답이 그대로 보였다.
 * 둘 다 원문을 그대로 보이는 유형(내용일치·제목·요지·요약문 빈칸 등)끼리만 지문을 나눠 쓰게 한다.
 */

/** 원문을 그대로 보이고, 답이 지문을 바꾸거나 가린 데 있지 않은 유형(유형 코드) — 모르는 유형은 바꾸는 쪽으로 본다 */
const SHOWS_AS_IS = new Set([
  "내용일치",
  "내용불일치",
  "일치개수",
  "제목추론",
  "주제추론",
  "요지추론",
  "함축의미추론",
  "목적추론",
  "심경추론",
  "요약완성AB",
  "요약문빈칸영작",
  "요약문빈칸2단어",
  "요약문빈칸3단어",
  "요약표빈칸단어",
  "주제문작성",
  "지칭대명사서술",
  "특정표현의미서술",
]);

export function showsPassageAsIs(optionKey: string): boolean {
  return SHOWS_AS_IS.has(optionKey.split(":").pop() ?? "");
}

/**
 * 두 묶음이 같은 지문을 쓸 때의 벌점 — 바꾸는 문항이 있으면 그 수(답이 드러남).
 * 둘 다 원문 그대로여도 같은 유형끼리면 0.5(내용불일치 둘이 한 지문이면 보기 내용이 겹친다).
 */
function pairCost(a: string[], b: string[]): number {
  const leak = [...a, ...b].filter((k) => !showsPassageAsIs(k)).length;
  if (leak) return leak;
  const code = (k: string) => k.split(":").pop();
  return a.some((x) => b.some((y) => code(x) === code(y))) ? 0.5 : 0;
}

/**
 * 묶음(단위)마다 정한 지문 번호를 서로 바꿔 가며 답이 드러나는 짝을 줄인다.
 * - unitKeys[u]: 그 묶음 문항들의 유형 키(한 묶음 안은 원래 시험이 같은 지문으로 냈으므로 서로 세지 않는다)
 * - fixed[u]: 선생님이 손으로 정한 자리 — 바꾸지 않는다
 * - passageKinds[p]: 지문 갈래(교과서·모의) — 같은 갈래 지문끼리만 바꾼다(교과서 자리엔 교과서 지문 그대로). 모르면 null
 */
export function reduceAnswerLeaks(
  assignment: number[],
  unitKeys: string[][],
  opts: { fixed?: boolean[]; passageKinds?: (string | null)[] } = {}
): number[] {
  const a = [...assignment];
  const n = a.length;
  const cost = (arr: number[]) => {
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (arr[i]! < 0) continue;
      for (let j = i + 1; j < n; j++) if (arr[j] === arr[i]) c += pairCost(unitKeys[i] ?? [], unitKeys[j] ?? []);
    }
    return c;
  };
  let cur = cost(a);
  for (let pass = 0; pass < 6 && cur > 0; pass++) {
    let improved = false;
    for (let i = 0; i < n && cur > 0; i++) {
      for (let j = i + 1; j < n && cur > 0; j++) {
        if (a[i] === a[j] || a[i]! < 0 || a[j]! < 0 || opts.fixed?.[i] || opts.fixed?.[j]) continue;
        if (opts.passageKinds && (opts.passageKinds[a[i]!] ?? null) !== (opts.passageKinds[a[j]!] ?? null)) continue;
        [a[i], a[j]] = [a[j]!, a[i]!];
        const next = cost(a);
        if (next < cur) {
          cur = next;
          improved = true;
        } else {
          [a[i], a[j]] = [a[j]!, a[i]!];
        }
      }
    }
    if (!improved) break;
  }
  return a;
}
