/**
 * 같은 지문 여러 문항의 「정답 근거 문장」을 만들기 전에 코드가 나눠 맡긴다(선생님 2026-11-24 「너무 중복되지 않는가」).
 *
 * 10-15 이후 승인 1,913문항(179 지문 묶음)을 재 보니 25%의 지문에서 두 문항 이상이 같은 문장을 근거로 썼다.
 * 가장 많은 짝은 「삽입의 주어진 문장 = 빈칸으로 지운 문장」(23번), 다음이 어법·어휘 같은 자리, 빈칸 두 개가 같은 문장.
 * 「앞·가운데·뒤 셋으로 돌리기」는 문항이 넷만 되어도 부딪혔다.
 *
 * 문항들은 동시에 만들어지므로 앞 문항 결과를 뒤 문항에 알려 줄 수 없다. 그래서 유형마다 알맞은 문장을 고르는
 * 점수로 문장을 하나씩 나눠 주고(다른 문항이 맡은 문장은 피하라고 함께 적는다), 다시 만들지는 않는다 — 값이 늘지 않는다.
 */
import { ENGLISH_SENTENCE_GAP } from "./text-utils";

/** 근거 문장을 맡을 유형 — 맡는 문장이 무엇인지(프롬프트에 적는 말) */
export type AnchorKind = "blank" | "insert" | "rebuild" | "underline" | "connector" | "word" | "wrongsent" | "spot" | "spotmany" | "examples";

export function anchorKindFor(type: string, code: string): AnchorKind | null {
  if (type === "sentence_blank" && code === "빈칸추론") return "blank";
  if (type === "sentence_blank" && code === "연결어빈칸") return "connector";
  if (type === "sentence_blank" && code === "빈칸단어") return "word";
  if (type === "sentence_insertion") return "insert";
  if (type === "writing" && /^(제시어배열|문법조건영작|구문변환)/.test(code)) return "rebuild";
  // 함축·지칭·특정표현은 비유 표현·대명사가 있는 자리라야 해서 문장을 박지 않고 「피할 문장」만 알린다
  if (type === "underlined_inference" && code === "함축의미추론") return "underline";
  if (type === "writing" && /^(지칭대명사서술|특정표현의미서술)$/.test(code)) return "underline";
  // 틀린 밑줄 하나인 어법·어휘: 밑줄 자리는 item-variety가 정하므로 문장을 박지 않고 「피할 문장」만 알린다
  if ((type === "grammar" && code === "어법추론") || (type === "vocabulary" && code === "어휘추론")) return "spot";
  // 어법(통문장): 틀린 문장 하나를 맡긴다 — 같은 지문 어법 개수가 그 자리를 맞는 꼴로 밑줄 쳐 답이 보였다(2026-11-24 새 유형 실제 생성)
  if (type === "grammar" && code === "어법통문장") return "wrongsent";
  // 밑줄 여럿인 개수형: 다른 문항이 맡은 문장에는 밑줄을 긋지 않는다
  if ((type === "grammar" && code === "어법개수") || (type === "vocabulary" && code === "어휘개수")) return "spotmany";
  // 서술형 어법 수정(틀린 곳 2·3개)도 같은 갈래 — 어법 개수와 같은 realistic→realistically를 함께 물었다(2026-11-24 전 유형 점검)
  if (type === "grammar" && /^어법오류수정[23]$/.test(code)) return "spotmany";
  // 새 예시를 지어 쓰는 두 유형: 같은 지문에 함께 있으면 같은 사람·장면을 썼다(Daniel·토론 동아리, 2026-11-24)
  if ((type === "sentence_blank" && code === "사례분류") || (type === "writing" && code === "내용매칭")) return "examples";
  return null;
}

/** 이 차례로 먼저 고른다 — 문장을 가장 까다롭게 가리는 유형부터 */
const PRIORITY: AnchorKind[] = ["blank", "insert", "connector", "rebuild", "wrongsent", "underline", "word", "spot", "spotmany", "examples"];

export function splitPassageSentences(passage: string): string[] {
  return String(passage ?? "")
    .split(ENGLISH_SENTENCE_GAP)
    .map((t) => t.trim())
    .filter(Boolean);
}

const CONNECTOR = /^(However|But|Yet|Instead|Therefore|Thus|Hence|As a result|Consequently|In addition|Moreover|Furthermore|Besides|For example|For instance|In other words|In fact|Similarly|Likewise|On the other hand|In contrast|Nevertheless|Nonetheless|Otherwise|Meanwhile|Still|That is|In short)\b,?/;
const CUE = /^(This|These|That|Those|Such|It|They|He|She|His|Her|Their|Its|However|But|Yet|Instead|Therefore|Thus|As a result|For example|For instance|In addition|Also|Then|Later|Similarly|In fact|Still)\b/;
const CLAIM = /\b(therefore|thus|hence|in short|as a result|consequently|this means|this shows|in other words|the key|the point|what matters|must|should|need to|have to|it is (?:important|essential|crucial|necessary))\b/i;

function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/** 이 문장이 이 유형의 근거로 얼마나 알맞은가(-99 = 쓰지 않음) */
function fit(kind: AnchorKind, t: string, i: number, n: number): number {
  const w = wordCount(t);
  const question = /\?\s*["”’]?$/.test(t);
  const example = /^(For example|For instance|To illustrate)\b/i.test(t);
  const important = (CLAIM.test(t) ? 3 : 0) + (/^(However|But|Yet|Instead|In fact|Actually)\b/.test(t) ? 2 : 0) + (i === n - 1 ? 2 : 0);
  switch (kind) {
    case "blank":
      // 빈칸: 주제문·끝 문장 6~14낱말이 기출 꼴, 첫 문장은 비우지 않는다(2026-11-24 모의고사 분석). 같으면 뒤쪽 문장
      if (i === 0 || question || w < 6) return -99;
      return important + (w <= 22 ? 1 : 0) - (example ? 3 : 0) + i / n;
    case "insert":
      // 삽입: 첫·끝 문장은 빼지 않는다. 대명사·연결어로 시작해 자리 단서가 있는 문장
      if (i === 0 || i === n - 1 || w < 5) return -99;
      return (CUE.test(t) ? 3 : 0) + (i >= 2 && i <= n - 3 ? 1 : 0) - Math.abs(i - n / 2) / n;
    case "connector":
      if (i === 0 || !CONNECTOR.test(t)) return -99;
      return 2;
    case "rebuild":
      // 제시어 배열·영작: 중요한 문장(선생님 10-04 「주제문·결론으로」), 묻는 문장·따옴표·예시 아님, 8~26낱말
      if (question || /["“”]/.test(t) || w < 8 || w > 26) return -99;
      return important + (i === 0 ? 1 : 0) - (example ? 3 : 0) + (w <= 22 ? 1 : 0);
    case "underline":
      if (question || w < 6) return -99;
      return 0;
    case "word":
      if (w < 6) return -99;
      return 1 + (i > 0 && i < n - 1 ? 1 : 0);
    case "wrongsent":
      // 밑줄 친 문장 다섯 가운데 틀린 하나 — 너무 짧거나 긴 문장, 묻는 문장은 피한다
      if (question || w < 8 || w > 32) return -99;
      return (i > 0 ? 1 : 0) - (w > 26 ? 1 : 0);
    case "spot":
    case "spotmany":
    case "examples":
      return 0;
  }
}

export type AnchorPlan = {
  kind: AnchorKind;
  /** 맡은 문장(없으면 맡지 않고 피할 문장만) */
  sentence: string | null;
  /** 같은 지문의 다른 문항이 맡은 문장 */
  avoid: string[];
  /** 예시를 지어 쓰는 유형끼리 나눈 차례(0부터) — 이름·장면 묶음 */
  slot?: number;
  /** 어법(통문장): 밑줄 칠 다섯 문장(지문 차례)과 그중 틀린 문장의 자리(1~5) */
  group?: string[];
  wrongPos?: number;
  /** 밑줄형(어법·어휘 추론·개수·수정)이 여럿일 때 틀린 곳을 둘 구역(0 앞·1 가운데·2 뒤) — 서로 같은 자리를 묻지 않게 */
  region?: number;
};

/**
 * 한 지문의 문항들(작업에 청한 차례 그대로 — 이어 받기 토막에서도 같은 값이 나오게)에 근거 문장을 나눈다.
 * 근거 문장이 둘 이상인 유형만 대상이고, 혼자면 null.
 */
/** 문장을 맡는 유형(나머지는 피할 문장만 받거나, 예시 묶음만 받는다) */
const CLAIMS = new Set<AnchorKind>(["blank", "insert", "connector", "rebuild", "wrongsent", "word"]);

export function planAnchors(passage: string, items: Array<{ type: string; code: string }>): Array<AnchorPlan | null> {
  const kinds = items.map((it) => anchorKindFor(it.type, it.code));
  if (kinds.filter(Boolean).length < 2) return items.map(() => null);
  const sents = splitPassageSentences(passage);
  const n = sents.length;
  if (n < 3) return items.map(() => null);
  const used = new Array<number>(n).fill(0);
  const chosen: Array<number | null> = items.map(() => null);
  const order = kinds
    .map((k, idx) => ({ k, idx }))
    .filter((x): x is { k: AnchorKind; idx: number } => x.k != null && CLAIMS.has(x.k))
    .sort((a, b) => PRIORITY.indexOf(a.k) - PRIORITY.indexOf(b.k) || a.idx - b.idx);
  for (const { k, idx } of order) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      const f = fit(k, sents[i]!, i, n);
      if (f <= -99) continue;
      // 이미 맡긴 문장은 크게 깎는다 — 문항이 문장보다 많으면 덜 쓴 문장부터 다시 쓴다
      const s = f - used[i]! * 100;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0) {
      chosen[idx] = best;
      used[best]! += 1;
    }
  }
  /*
   * 어법(통문장)은 밑줄 다섯 문장을 통째로 보여 준다. 그 맞는 문장 안에 같은 지문 어법 개수·추론의 틀린 곳이 있으면
   * 서로 답이 보인다(2026-11-24 실제 생성: were ↔ was). 그래서 다섯 문장을 코드가 정하고, 다른 어법 문항은 그 문장들을 비운다.
   */
  const groups = new Map<number, number[]>();
  for (const { k, idx } of order) {
    const c = chosen[idx];
    if (k !== "wrongsent" || c == null) continue;
    const elig = [...Array(n).keys()].filter((i) => i !== c && fit("wrongsent", sents[i]!, i, n) > -99);
    const free = elig.filter((i) => used[i] === 0);
    const pool = free.length >= 4 ? free : elig;
    if (pool.length < 4) continue;
    const pick = [0, 1, 2, 3].map((j) => pool[Math.round((j * (pool.length - 1)) / 3)]!);
    const g = [...new Set([c, ...pick])].sort((a, b) => a - b);
    if (g.length === 5) groups.set(idx, g);
  }
  // 피할 문장은 먼저 맡은(까다로운) 유형 것부터, 지문 문장의 절반까지만 — 더 막으면 설 자리가 없다
  const ownerRank = new Map<number, number>();
  order.forEach(({ idx }, r) => {
    const c = chosen[idx];
    if (c != null && !ownerRank.has(c)) ownerRank.set(c, r);
  });
  const exampleIdx = kinds.map((k, idx) => (k === "examples" ? idx : -1)).filter((i) => i >= 0);
  const spotIdx = kinds.map((k, idx) => (k === "spot" || k === "spotmany" ? idx : -1)).filter((i) => i >= 0);
  return items.map((_, idx) => {
    const k = kinds[idx];
    if (!k) return null;
    if (k === "examples") {
      return exampleIdx.length >= 2 ? { kind: k, sentence: null, avoid: [], slot: exampleIdx.indexOf(idx) } : null;
    }
    const mine = chosen[idx];
    const myGroup = groups.get(idx);
    // 밑줄 문항(어법·어휘 추론·개수)은 다른 문항의 통문장 다섯 문장을 먼저 비운다
    const groupSents =
      k === "spot" || k === "spotmany"
        ? [...new Set([...groups.entries()].filter(([gi]) => gi !== idx).flatMap(([, g]) => g))]
        : [];
    const rest = [...ownerRank.entries()]
      .filter(([c]) => c !== mine && !groupSents.includes(c) && !(myGroup ?? []).includes(c))
      .sort((a, b) => a[1] - b[1])
      .map(([c]) => c);
    const avoid = [...groupSents, ...rest]
      .slice(0, Math.max(Math.floor(n / 2), groupSents.length))
      .sort((a, b) => a - b)
      .map((c) => sents[c]!);
    const region = spotIdx.length >= 2 && spotIdx.includes(idx) ? spotIdx.indexOf(idx) % 3 : undefined;
    if (mine == null && avoid.length === 0 && region == null) return null;
    return {
      kind: k,
      ...(region != null ? { region } : {}),
      sentence: mine == null ? null : sents[mine]!,
      avoid,
      ...(myGroup && mine != null ? { group: myGroup.map((c) => sents[c]!), wrongPos: myGroup.indexOf(mine) + 1 } : {}),
    };
  });
}

const WHAT: Record<AnchorKind, string> = {
  blank: "the sentence you turn into the blank",
  insert: "the given sentence you take out of the passage",
  connector: "the blank connector at the start of the sentence",
  rebuild: "the sentence to rebuild or rewrite",
  underline: "the underlined expression",
  word: "the sentence holding the blanked word",
  wrongsent: "the ONE underlined sentence with the grammar error",
  spot: "the WRONG underline",
  spotmany: "any underline (right or wrong)",
  examples: "",
};

/** 예시 유형끼리 나눠 쓰는 이름·장면(겹치지 않게) */
const EXAMPLE_SETS: Array<{ names: string; settings: string }> = [
  { names: "Elena, Joon, Mina, Carlos, Haruto, Grace", settings: "school life, classes and clubs" },
  { names: "Omar, Yuna, Lucas, Sora, Priya, Ben", settings: "work, business and the local community" },
  { names: "Diego, Nari, Ethan, Aisha, Tomas, Ji-ho", settings: "sports, hobbies and travel" },
  { names: "Kevin, Hana, Mateo, Leah, Ravi, Eun-ji", settings: "family, home and friendships" },
];

const head = (t: string, k = 9) => {
  const w = t.split(/\s+/);
  return w.length > k ? `${w.slice(0, k).join(" ")} …` : t;
};

/** 프롬프트 끝(ITEM SLOT)에 붙일 한 줄 */
export function anchorPlanLine(plan: AnchorPlan | null | undefined): string {
  if (!plan) return "";
  if (plan.kind === "examples") {
    const mine = EXAMPLE_SETS[(plan.slot ?? 0) % EXAMPLE_SETS.length]!;
    const others = EXAMPLE_SETS.filter((_, i) => i !== (plan.slot ?? 0) % EXAMPLE_SETS.length);
    return `- SAME-PASSAGE EXAMPLE PLAN: another question on this passage also writes new example situations. So that the two do not repeat each other, name people only from: ${mine.names}, and prefer situations from ${mine.settings} where they fit the concept. Do not use the names ${others.map((o) => o.names.split(", ")[0]).join(", ")} or Daniel, and do not reuse a situation that simply retells the passage.`;
  }
  const avoid = plan.avoid.slice(0, 8).map((t) => `"${head(t)}"`).join(", ");
  if (plan.kind === "wrongsent" && plan.sentence && plan.group?.length === 5 && plan.wrongPos) {
    const lab = "ⓐⓑⓒⓓⓔ";
    return `- SAME-PASSAGE SENTENCE PLAN (this overrides the position rule above): other grammar questions on this passage use other sentences, so underline EXACTLY these five whole sentences, in passage order: ${plan.group
      .map((t, i) => `${lab[i]} "${head(t)}"`)
      .join(", ")}. Put the grammar error in ${lab[plan.wrongPos - 1]} "${head(plan.sentence)}" (use any grammar point that sentence has). correctAnswer = ${plan.wrongPos}. Keep every other sentence of the passage, word for word — do not drop any sentence.`;
  }
  if (plan.kind === "spot" || plan.kind === "spotmany" || !plan.sentence) {
    const where =
      plan.region != null
        ? ` Other grammar/vocabulary questions on this passage test other parts, so put the WRONG ${plan.kind === "spotmany" ? "underlines" : "underline"} in the ${["FIRST", "MIDDLE", "LAST"][plan.region]} third of the passage.`
        : "";
    return avoid
      ? `- SAME-PASSAGE SENTENCE PLAN: other questions on this passage already use these sentences: ${avoid}. Do NOT put ${WHAT[plan.kind]} in them.${where}`
      : where
        ? `- SAME-PASSAGE SENTENCE PLAN:${where}`
        : "";
  }
  return `- SAME-PASSAGE SENTENCE PLAN: other questions on this passage use other sentences. Use the sentence starting "${head(plan.sentence)}" as ${WHAT[plan.kind]}.${
    avoid ? ` If it truly cannot work for this type, choose another sentence — but never these, which other questions use: ${avoid}.` : ""
  }`;
}
