/**
 * 연결어빈칸 오답 보기를 코드가 바로잡는다(2026-11-28 「원가 4배」 — 연결어빈칸이 2.7~4배).
 *
 * 전 유형 시험에서 버린 까닭이 둘이었다.
 *  1) 오답 자리말이 그 자리 문법에 맞지 않음 — 문장 머리 「However,」 자리에 Although·Since·Unless(종속 접속사),
 *     문장 가운데 「, but」 자리에 Therefore·consequently. 직접 풀기가 「보기 1·2·3·5 어색」으로 통째로 버렸다.
 *  2) 오답 두 자리 모두 정답과 같은 갈래(However ↔ Nevertheless, As a result ↔ Consequently) — 「4번도 답」.
 *
 * 걸린 자리말만 같은 문법 꼴·다른 갈래의 말로 바꾼다. 표에 없는 말·정답은 건드리지 않는다.
 */

type Cat = "contrast" | "result" | "addition" | "example" | "similar" | "restate" | "emphasis" | "time" | "otherwise";

/** 문장 머리(쉼표 앞)에 오는 연결 부사구 — 갈래별 */
const ADVERBS: Record<Cat, string[]> = {
  contrast: ["However", "Nevertheless", "In contrast", "On the other hand", "Nonetheless", "Yet", "Still", "Conversely", "Instead", "But"],
  result: ["Therefore", "As a result", "Thus", "Consequently", "Hence", "Accordingly", "So"],
  addition: ["In addition", "Moreover", "Furthermore", "Besides", "Also", "Additionally"],
  example: ["For example", "For instance"],
  similar: ["Similarly", "Likewise", "In the same way"],
  restate: ["In other words", "That is", "In short", "In sum", "In brief"],
  emphasis: ["In fact", "Indeed", "Actually", "Crucially"],
  time: ["Meanwhile", "Then", "Later", "Finally", "Afterward"],
  otherwise: ["Otherwise"],
};
/** 바꿔 넣을 때 고르는 차례(학교 시험 보기에 흔한 것부터) */
const PICK: Record<Cat, string> = {
  contrast: "However",
  result: "Therefore",
  addition: "In addition",
  example: "For example",
  similar: "Similarly",
  restate: "In other words",
  emphasis: "In fact",
  time: "Meanwhile",
  otherwise: "Otherwise",
};
const PICK_ORDER: Cat[] = ["contrast", "result", "addition", "example", "similar", "restate", "emphasis"];

/** 절 가운데 쉼표 뒤에 오는 등위 접속사 */
const COORD: Record<string, Cat> = { but: "contrast", yet: "contrast", so: "result", and: "addition", or: "otherwise", because: "result", while: "contrast", whereas: "contrast", although: "contrast" };
const COORD_PICK = ["but", "so", "and", "or", "because", "while"];

/** 부사 자리에 오면 문장이 깨지는 종속 접속사 */
const SUBORD = /^(although|though|even though|since|because|unless|while|whereas|if|when|once|as long as|even if)$/i;

const norm = (w: string) => w.trim().replace(/[,.;:]+$/, "").replace(/\s+/g, " ");

function adverbCat(w: string): Cat | null {
  const k = norm(w).toLowerCase();
  for (const [cat, list] of Object.entries(ADVERBS) as [Cat, string[]][]) {
    if (list.some((x) => x.toLowerCase() === k)) return cat;
  }
  return null;
}

type Slot = { kind: "adverb" | "coord"; cat: Cat } | null;

function slotOf(w: string): Slot {
  const t = norm(w);
  if (!t) return null;
  if (/^[a-z]/.test(t) && COORD[t] !== undefined) return { kind: "coord", cat: COORD[t]! };
  if (/^[A-Z]/.test(t) && /^(although|while|whereas|because)$/i.test(t)) return null;
  const cat = adverbCat(t);
  // 소문자로 쓴 부사(however·therefore)도 부사 갈래로 본다 — 자리 꼴은 정답 쪽 대소문자로 맞춘다
  return cat ? { kind: "adverb", cat } : null;
}

const SEP = /\s*(?:……|…|\.{3,}|―|—{1,2})\s*/;

export function splitConnectorPair(text: string): [string, string] | null {
  const parts = String(text ?? "").split(SEP).map((x) => x.trim()).filter(Boolean);
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
}

function matchCase(word: string, like: string): string {
  return /^[a-z]/.test(norm(like)) ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * 보기를 고친다. 고친 보기 번호를 돌려준다(없으면 빈 배열).
 * choices·explanation은 제자리에서 바꾼다.
 */
export function fixConnectorChoices(payload: {
  choices?: Array<{ number?: unknown; text?: unknown }>;
  correctAnswer?: unknown;
  explanation?: string;
}): number[] {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (choices.length !== 5) return [];
  const keyNo = Number(payload.correctAnswer);
  const keyChoice = choices.find((c) => Number(c.number) === keyNo);
  const key = keyChoice ? splitConnectorPair(String(keyChoice.text ?? "")) : null;
  if (!key) return [];
  const keySlots = key.map(slotOf);
  const pairs = choices.map((c) => splitConnectorPair(String(c.text ?? "")));
  if (pairs.some((p) => !p)) return [];
  const used = [0, 1].map((s) => new Set(pairs.map((p) => norm(p![s]!).toLowerCase())));
  const changed: number[] = [];
  let explanation = String(payload.explanation ?? "");

  const replacement = (s: number, avoid: Cat[], other: string): string | null => {
    const k = keySlots[s];
    if (!k) return null;
    // 바꿔 넣는 말은 늘 정답 갈래 밖에서, 같은 보기의 다른 자리 말과 겹치지 않게
    avoid = [...avoid, k.cat];
    const otherCat = slotOf(other)?.cat;
    if (otherCat) avoid.push(otherCat);
    if (k.kind === "coord") {
      for (const w of COORD_PICK) {
        if (avoid.includes(COORD[w]!) || used[s]!.has(w) || norm(other).toLowerCase() === w) continue;
        return w;
      }
      return null;
    }
    for (const cat of PICK_ORDER) {
      if (avoid.includes(cat)) continue;
      for (const cand of [PICK[cat], ...ADVERBS[cat]]) {
        if (cand === "But" || cand === "So" || cand === "Yet") continue;
        if (used[s]!.has(cand.toLowerCase())) continue;
        return matchCase(cand, key[s]!);
      }
    }
    return null;
  };

  choices.forEach((c, i) => {
    if (Number(c.number) === keyNo) return;
    const pair = pairs[i]!;
    const next: [string, string] = [pair[0], pair[1]];
    for (const s of [0, 1]) {
      const k = keySlots[s];
      if (!k) continue;
      const w = norm(pair[s]!);
      const ws = slotOf(w);
      // 절 가운데 「, ___」 자리는 whereas·while·because도 문법에 맞는다 — 문장 머리 부사 자리에서만 깨진다
      const subord = k.kind === "adverb" && SUBORD.test(w);
      // 문장 머리 부사 자리에 종속 접속사·등위 접속사, 절 가운데 등위 접속사 자리에 부사
      const wrongForm =
        subord ||
        (k.kind === "adverb" && ws?.kind === "coord") ||
        (k.kind === "coord" && ws !== null && ws.kind === "adverb");
      // 대소문자만 다른 꼴(문장 머리 자리에 소문자 however)
      const wrongCase = ws !== null && ws.kind === k.kind && /^[a-z]/.test(w) !== /^[a-z]/.test(norm(key[s]!));
      if (wrongForm) {
        const other = s === 0 ? 1 : 0;
        const otherSame = keySlots[other] && slotOf(next[other])?.cat === keySlots[other]!.cat;
        // 다른 자리가 정답 갈래면 이 자리는 반드시 다른 갈래로 — 둘 다 맞으면 답이 둘이 된다
        const r = replacement(s, otherSame ? [k.cat] : [], next[s === 0 ? 1 : 0]);
        if (r) {
          next[s] = r;
          used[s]!.add(r.toLowerCase());
        }
      } else if (wrongCase) {
        next[s] = matchCase(w, key[s]!);
      }
    }
    // 두 자리가 모두 정답과 같은 갈래(같은 말 포함)면 정답이 둘 — 둘째 자리를 다른 갈래로
    const both = [0, 1].every((s) => keySlots[s] && slotOf(next[s])?.cat === keySlots[s]!.cat);
    if (both) {
      const s = keySlots[1] ? 1 : 0;
      const r = replacement(s, [keySlots[s]!.cat], next[s === 0 ? 1 : 0]);
      if (r) {
        next[s] = r;
        used[s]!.add(r.toLowerCase());
      }
    }
    if (next[0] !== pair[0] || next[1] !== pair[1]) {
      for (const s of [0, 1]) {
        if (next[s] === pair[s]) continue;
        // 해설에 그 보기 자리말을 짚었으면 같이 바꾼다(낱말 경계로만)
        const old = norm(pair[s]!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        explanation = explanation.replace(new RegExp(`(?<![A-Za-z])${old}(?![A-Za-z])`, "g"), (m) =>
          // 정답에도 같은 말이 있으면 해설을 건드리지 않는다
          key.some((k) => norm(k).toLowerCase() === m.toLowerCase()) ? m : next[s]!
        );
      }
      c.text = `${next[0]} …… ${next[1]}`;
      changed.push(Number(c.number));
    }
  });
  if (changed.length) payload.explanation = explanation;
  return changed;
}

/** 프롬프트에 붙이는 보기 규칙 */
export function connectorChoiceRules(): string {
  return `- Blank only connectives that start a clause on their own (However, / Therefore, / For example, …, or a mid-sentence ", but"). Never blank part of a longer phrase such as "As a result of" or "Despite".
- Every choice word must fit the SAME grammar slot as the answer: a sentence-start connective adverb gets other connective adverbs (However, Therefore, In addition, For example, Similarly, In other words, In fact, Instead); a mid-sentence coordinator (but, so, and, or) gets other coordinators. Never use subordinators (Although, Since, Because, Unless, While, If) or prepositions — they make the sentence broken, and broken choices get the item thrown away.
- Wrong choices differ from the answer in MEANING GROUP (contrast / result / addition / example / similarity / restatement / emphasis). In each wrong pair at least one slot must be from a different group than the answer's word there; never pair two same-group synonyms of the answer (However↔Nevertheless, Therefore↔As a result) — that makes a second correct answer.`;
}
