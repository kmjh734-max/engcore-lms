import table from "@/lib/vocab/engcore-levels.generated.json";

/**
 * EngCore 단어장 등급 찾기(굴절·파생·불규칙형까지). 없으면 null.
 *
 * engcore-level.ts의 lookup은 굴절(-s·-ed·-ing)만 벗겨 speakers·weakness·grew 같은 쉬운 말도
 * 「단어장 밖」으로 셌다. 변형문제 보기 낱말 수준을 단어장에 맞추려면(선생님 말 2026-10-04) 파생형도
 * 원형으로 돌려 봐야 한다.
 */
const WORDS: Record<string, number> = (table as { words: Record<string, number> }).words;

const IRREGULAR: Record<string, string> = {
  grew: "grow", grown: "grow", began: "begin", begun: "begin", made: "make", built: "build",
  went: "go", gone: "go", took: "take", taken: "take", gave: "give", given: "give", saw: "see",
  seen: "see", came: "come", knew: "know", known: "know", thought: "think", brought: "bring",
  bought: "buy", found: "find", left: "leave", felt: "feel", kept: "keep", held: "hold",
  told: "tell", said: "say", ran: "run", wrote: "write", written: "write", rose: "rise",
  risen: "rise", fell: "fall", fallen: "fall", spoke: "speak", spoken: "speak", chose: "choose",
  chosen: "choose", led: "lead", meant: "mean", sent: "send", spent: "spend", caught: "catch",
  taught: "teach", sought: "seek", became: "become", stood: "stand", understood: "understand",
  children: "child", men: "man", women: "woman", people: "person", lives: "life", better: "good",
  best: "good", worse: "bad", worst: "bad", strongest: "strong", earth: "earth",
  arose: "arise", arisen: "arise", drove: "drive", driven: "drive", feet: "foot", teeth: "tooth",
  cannot: "can", shown: "show", drew: "draw", drawn: "draw", flew: "fly", flown: "fly", wore: "wear",
  worn: "wear", hid: "hide", hidden: "hide", forgot: "forget", forgotten: "forget", lost: "lose",
  paid: "pay", sold: "sell", won: "win", broke: "break", broken: "break", ate: "eat", eaten: "eat",
  judgment: "judge", judgments: "judge", likelihood: "likely", humankind: "human", everyday: "every",
};

/** 단어장 표에 빠진 아주 쉬운 말 */
const BASIC = new Set(["well", "photograph", "photographs", "online", "website", "internet", "smartphone", "email"]);

/** 단어장 표에 그 꼴 그대로 올라 있는 낱말인가(원형 후보 고르기용, 굴절을 벗기지 않는다) */
export function isEngcoreHeadword(raw: string): boolean {
  return WORDS[raw.toLowerCase()] !== undefined;
}

function direct(w: string): number | null {
  return WORDS[w] !== undefined ? WORDS[w]! : null;
}

/** 합성어 조각용: 원형 후보까지만 본다(조각을 다시 쪼개지 않는다) */
function lookupSimple(w: string): number | null {
  const hit = direct(w);
  if (hit !== null) return hit;
  for (const c of candidates(w)) {
    const lv = direct(c);
    if (lv !== null) return lv;
  }
  return null;
}

/** 원형 후보들(가까운 것부터) */
function candidates(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => s.length >= 2 && out.push(s);
  if (IRREGULAR[w]) add(IRREGULAR[w]!);
  w = w.replace(/'s$|s'$/, "");
  add(w);
  // 굴절
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/([^aeiou])\1ed$/.test(w)) add(w.slice(0, -3)); }
  if (w.endsWith("ing")) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); if (/([^aeiou])\1ing$/.test(w)) add(w.slice(0, -4)); }
  if (w.endsWith("est")) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
  // 비교급·최상급: easier/easiest → easy, redder/reddest → red, earlier → early
  if (w.endsWith("ier")) add(w.slice(0, -3) + "y");
  if (w.endsWith("iest")) add(w.slice(0, -4) + "y");
  if (/([^aeiou])\1er$/.test(w)) add(w.slice(0, -3));
  if (/([^aeiou])\1est$/.test(w)) add(w.slice(0, -4));
  if (w.endsWith("er")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("ish")) add(w.slice(0, -3));
  if (w.endsWith("hood")) add(w.slice(0, -4));
  // 파생(흔한 접미사만)
  const SUF: Array<[string, string[]]> = [
    ["ness", [""]], ["ment", [""]], ["ers", ["", "e"]], ["er", ["", "e"]], ["ors", ["", "e"]], ["or", ["", "e"]],
    ["ity", ["", "e"]], ["ive", ["", "e"]], ["ion", ["", "e"]], ["ation", ["e", ""]], ["ful", [""]], ["less", [""]],
    ["able", ["", "e"]], ["ible", ["", "e"]], ["al", [""]], ["ally", [""]], ["ly", [""]], ["ily", ["y"]], ["iness", ["y"]],
    ["ance", ["", "e"]], ["ence", ["", "e"]], ["ist", [""]], ["ism", [""]], ["ize", [""]], ["ise", [""]], ["ous", [""]],
    ["ition", ["ize", "ise", ""]], ["ty", ["", "e"]], ["y", [""]],
    // survival→survive, exposure→expose, widen→wide, remarkably→remarkable, youngster→young, prioritize→priority, competitor→compete
    ["al", ["e"]], ["ure", ["e", ""]], ["en", ["", "e"]], ["ably", ["able"]], ["ibly", ["ible"]], ["ster", [""]], ["ize", ["y"]], ["itor", ["e"]],
  ];
  for (const [suf, reps] of SUF) {
    if (w.endsWith(suf) && w.length - suf.length >= 2) for (const r of reps) add(w.slice(0, -suf.length) + r);
  }
  // 접두사
  for (const pre of ["un", "in", "im", "dis", "re", "non", "over", "under", "self-", "mis"]) {
    if (w.startsWith(pre) && w.length > pre.length + 3) add(w.slice(pre.length));
  }
  return out;
}

export function engcoreLevelOf(raw: string): number | null {
  const w = raw.toLowerCase().replace(/[^a-z'-]/g, "");
  if (!w) return null;
  const hit = direct(w);
  if (hit !== null) return hit;
  // 하이픈 낱말은 두 낱말 중 어려운 쪽
  if (w.includes("-")) {
    const parts = w.split("-").filter(Boolean).map((p) => engcoreLevelOf(p));
    if (parts.every((p) => p !== null)) return Math.max(...(parts as number[]));
    return null;
  }
  for (const c of candidates(w)) {
    const lv = direct(c);
    if (lv !== null) return lv;
  }
  /*
   * 굴절을 뗀 꼴에 한 번 더 원형 찾기를 댄다. 전에는 한 단계만 돌아 users·specialists·coverings·
   * uncertainty 같은 쉬운 말이 「단어장 밖」으로 걸려 문항을 다시 만들었다
   * (정수학원 272문항 작업 2026-10-05: 일치개수 8문항이 이렇게 버려짐).
   */
  for (const c of candidates(w)) {
    for (const c2 of candidates(c)) {
      const lv = direct(c2);
      if (lv !== null) return lv;
    }
  }
  if (BASIC.has(w)) return 0;
  // 합성어: 두 낱말이 모두 단어장에 있으면 어려운 쪽(wildfire = wild + fire, elsewhere, daybreak)
  for (let i = 3; i <= w.length - 3; i++) {
    const a = lookupSimple(w.slice(0, i)), b = lookupSimple(w.slice(i));
    if (a !== null && b !== null) return Math.max(a, b);
  }
  // 접두사를 뗀 뒤 활용형까지 한 번 더 본다(unchanged → changed → change, unaffected → affect)
  for (const pre of ["un", "in", "im", "dis", "re", "non", "mis", "over", "under"]) {
    if (w.startsWith(pre) && w.length > pre.length + 3) {
      const rest = w.slice(pre.length);
      for (const c of candidates(rest)) {
        const lv = direct(c);
        if (lv !== null) return lv;
      }
    }
  }
  return null;
}
