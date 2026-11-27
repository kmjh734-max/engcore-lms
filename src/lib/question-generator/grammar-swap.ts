/**
 * 어법 문항에서 「틀린 자리」가 원문 낱말의 형태를 바꾼 것인지 본다.
 *
 * 어법 오류는 원문 낱말의 형태를 바꿔 만든다(make → making, which → what, is → are). 전혀 다른 낱말로
 * 갈아 끼우면(without → tried) 문법으로 고칠 수 없는 「원문 복원」 문제가 된다(7차 시험 2026-10-04).
 * 관계사·대명사·관사·be·have·do처럼 같은 무리 안에서 바꾼 것은 어법 오류로 본다.
 */

const CLASSES: string[][] = [
  ["what", "which", "that", "where", "when", "who", "whom", "whose", "how", "why", "whether", "if", "whatever", "whoever", "whichever", "wherever", "whenever", "however"],
  ["it", "its", "they", "them", "their", "this", "these", "those", "that", "one", "ones", "itself", "themselves", "he", "him", "his", "she", "her",
    "myself", "yourself", "yourselves", "himself", "herself", "ourselves"],
  ["a", "an", "the"],
  ["much", "many", "few", "little", "less", "fewer", "more", "most"],
  ["be", "am", "is", "are", "was", "were", "been", "being"],
  ["have", "has", "had", "having"],
  ["do", "does", "did", "done", "doing"],
  ["to", "for", "of", "with", "in", "on", "at", "by", "from", "into"],
  ["and", "or", "but", "nor", "so", "yet"],
  ["as", "like", "alike", "than"],
  // 흔히 내는 혼동 짝(2026-10-07 저장 문항 대조에서 걸린 것)
  ["so", "such"],
  // 비교급 강조(much/far/even ↔ very)
  ["very", "much", "far", "even", "still", "a", "lot"],
  // 대동사 — 앞 동사가 be면 be, 일반동사면 do로 받는다
  ["do", "does", "did", "am", "is", "are", "was", "were"],
  ["good", "well"],
  ["although", "though", "despite", "because", "while", "whereas", "unless", "during", "since", "after", "before", "until"],
  ["can", "could", "will", "would", "shall", "should", "may", "might", "must"],
  /*
   * 관계대명사 ↔ 인칭대명사(접속사 없이 두 절을 잇는 자리: most of whom/them, which/it) — 학교 어법의 단골 자리다.
   * 2026-11-28 시험에서 who → they가 「다른 낱말」로 버려졌다.
   */
  ["who", "whom", "which", "whose", "they", "them", "it", "he", "him", "she", "her", "their", "its", "his"],
];

const IRREG: Record<string, string> = {
  went: "go", gone: "go", made: "make", took: "take", taken: "take", gave: "give", given: "give",
  saw: "see", seen: "see", came: "come", knew: "know", known: "know", thought: "think",
  brought: "bring", bought: "buy", found: "find", left: "leave", felt: "feel", kept: "keep",
  held: "hold", told: "tell", said: "say", began: "begin", begun: "begin", ran: "run",
  wrote: "write", written: "write", rose: "rise", risen: "rise", lay: "lie", lain: "lie",
  laid: "lay", fell: "fall", fallen: "fall", grew: "grow", grown: "grow", spoke: "speak",
  spoken: "speak", chose: "choose", chosen: "choose", better: "good", best: "good",
  worse: "bad", worst: "bad", children: "child", men: "man", women: "woman", people: "person",
  bore: "bear", born: "bear", borne: "bear", led: "lead", meant: "mean", sent: "send",
  spent: "spend", became: "become", stood: "stand", got: "get", gotten: "get", froze: "freeze",
  frozen: "freeze", built: "build", caught: "catch", taught: "teach", sought: "seek",
  // 앞 세 글자가 달라지는 불규칙 동사(2026-11-28 시험: been stealing → been stolen이 「다른 낱말」로 버려졌다)
  stole: "steal", stolen: "steal", broke: "break", broken: "break", drew: "draw", drawn: "draw",
  drove: "drive", driven: "drive", ate: "eat", eaten: "eat", sang: "sing", sung: "sing",
  rang: "ring", rung: "ring", swam: "swim", swum: "swim", drank: "drink", drunk: "drink",
  sank: "sink", sunk: "sink", struck: "strike", woke: "wake", woken: "wake", wore: "wear", worn: "wear",
  tore: "tear", torn: "tear", swore: "swear", sworn: "swear", won: "win", sold: "sell",
  paid: "pay", fought: "fight", flew: "fly", flown: "fly", met: "meet", sat: "sit", shot: "shoot",
  slept: "sleep", bit: "bite", bitten: "bite", hung: "hang", dug: "dig", fed: "feed", fled: "flee",
  wept: "weep", swept: "sweep", rode: "ride", ridden: "ride", arose: "arise", arisen: "arise",
  stuck: "stick", shook: "shake", shaken: "shake", hid: "hide", hidden: "hide", forgot: "forget",
  forgotten: "forget", forgave: "forgive", forgiven: "forgive", threw: "throw", thrown: "throw",
  understood: "understand", lost: "lose", heard: "hear", dealt: "deal"
};

// don't·doesn't·can't는 n't를 떼고 견준다(don't → doesn't가 「don」·「doe」로 갈렸다)
const CONTRACTED: Record<string, string> = { ca: "can", wo: "will", sha: "shall", d: "had", ve: "have", ll: "will", re: "are", m: "am" };
const clean = (w: string) => {
  const x = w.toLowerCase().replace(/n['’]t$/, "").replace(/^['’]/, "").replace(/[^a-z]/g, "");
  return CONTRACTED[x] ?? x;
};
// 앞 세 글자로 견준다(became/becoming, take/taking이 네 글자에서 갈렸다).
// 꼬리를 뗀 꼴도 같이 본다 — used/using이 「use」·「usi」로, need/needing이 갈려 다른 낱말로 잡혔다(2026-10-07).
const forms = (w: string): string[] => {
  const base = IRREG[w] ?? w;
  const cut = base.replace(/(?:ing|ed|es|s|ly)$/, "");
  return [base, cut, cut.replace(/e$/, ""), cut.replace(/i$/, "y")].filter(Boolean);
};
const sameStem = (x: string, y: string) =>
  forms(x).some((a) => forms(y).some((b) => a === b || (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3))));

function related(original: string, underlined: string): boolean {
  let wa = original.split(/\s+/).map(clean).filter(Boolean);
  let wb = underlined.split(/\s+/).map(clean).filter(Boolean);
  /*
   * 양쪽에 같이 있는 낱말은 빼고 바뀐 낱말끼리만 견준다. 「all average temperatures」 →
   * 「much average temperatures」가 average끼리 같다고 넘어갔다(2026-10-07 권승현 전용문제).
   * be를 빼서 만든 태 오류(has been shared → has shared)는 한쪽이 비므로 그대로 통과한다.
   */
  const rest = [...wb];
  wa = wa.filter((w) => {
    const i = rest.indexOf(w);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
  wb = rest;
  if (wa.length === 0 || wb.length === 0) return true;
  for (const x of wa) {
    for (const y of wb) {
      if (sameStem(x, y)) return true;
      if ((x.length <= 3 && y.startsWith(x)) || (y.length <= 3 && x.startsWith(y))) return true;
      if (CLASSES.some((c) => c.includes(x) && c.includes(y))) return true;
    }
  }
  return false;
}

const plain = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/[ⓐ-ⓖ①-⑤]/g, "").replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 원문 낱말과 관계없는 낱말로 바꾼 밑줄 자리들 */
export function grammarSwapSpots(passageOriginal: string, passageModified: string): Array<{ original: string; underlined: string }> {
  const orig = plain(passageOriginal);
  const out: Array<{ original: string; underlined: string }> = [];
  const spots = passageModified.matchAll(
    /((?:[A-Za-z’'-]+[\s,;:]+){0,2})(?:[ⓐ-ⓖ①-⑤]\s*)?<u>([\s\S]*?)<\/u>((?:[\s,;:]+[A-Za-z’'-]+){0,2})/g
  );
  for (const m of spots) {
    const before = plain(m[1] ?? "");
    const under = plain(m[2] ?? "");
    const after = plain(m[3] ?? "");
    if (!under || orig.includes(plain(`${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`))) continue; // 원문 그대로인 자리
    // 앞뒤 문맥이 둘 다 있어야 원문 자리를 바르게 찾는다(한쪽만 있으면 엉뚱한 자리를 잡았다)
    if (!before || !after) continue;
    const found = orig.match(new RegExp(`${esc(before)}\\s*(.{1,60}?)\\s*${esc(after)}`));
    if (!found) continue;
    const original = found[1]!.trim();
    // /s+/로 나눠 「slightly more sensitive」가 넷으로 세어져 빠졌다(2026-10-07)
    if (original.split(/\s+/).length > 4) continue; // 문장 경계를 넘어 잡은 것
    if (!related(original, under)) out.push({ original, underlined: under });
  }
  return out;
}
