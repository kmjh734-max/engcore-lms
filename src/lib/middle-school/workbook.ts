import type { TestBookTypeKey, TestItem, TestSection, TestSeg, TestSheet } from "@/lib/lesson-materials/test-book";
import type { MsText, MsUnit } from "./queries";

/**
 * 중학교 워크북(선생님 2026-10-29): 내신용·정수학원만이라 과마다 문항을 미리 정해 둔다.
 * 본문 유형은 족보닷컴 「본문 10단계 워크북」 문항 그대로(ms_units.workbook), 대화문·단어 유형은 교재 글로 만든다.
 * 그리는 것은 고등 테스트지(TestBookSheets)와 같은 부품 — 디자인도 같다.
 */

export type MsWbItem = { part: string; ko?: string; en?: string; q?: string; answer: string; hint?: string };
export type MsWbContext = { part: string; count: string; passage: string; answers: string[] };
export type MsWorkbook = {
  sets?: Partial<Record<MsWbSetKey, { direction: string; items: MsWbItem[] }>>;
  contextFix?: MsWbContext[];
};
type MsWbSetKey = "ko_blank" | "en_blank" | "verb_form" | "grammar_choice" | "word_order" | "writing";

export type MsWbTypeKey =
  | "r_line"
  | "r_ko_blank"
  | "r_en_blank"
  | "r_verb_form"
  | "r_grammar"
  | "r_context"
  | "r_word_order"
  | "r_writing"
  | "d_line"
  | "d_writing"
  | "d_order"
  | "w_en_ko"
  | "w_ko_en";

export type MsWbGroup = "본문" | "대화문" | "단어";

export const MS_WB_TYPES: Array<{ key: MsWbTypeKey; group: MsWbGroup; label: string; hint: string; render: TestBookTypeKey }> = [
  { key: "r_line", group: "본문", label: "해석 쓰기", hint: "문장을 보고 우리말 해석 쓰기", render: "line" },
  { key: "r_ko_blank", group: "본문", label: "빈칸 (우리말)", hint: "영문을 보고 해석의 빈칸 채우기", render: "blank" },
  { key: "r_en_blank", group: "본문", label: "빈칸 (영문)", hint: "해석을 보고 영문의 빈칸 채우기", render: "blank" },
  { key: "r_verb_form", group: "본문", label: "동사 형태", hint: "괄호 안 단어를 알맞게 고쳐 쓰기", render: "grammarFix" },
  { key: "r_grammar", group: "본문", label: "어법 선택", hint: "[ A / B ] 어법상 알맞은 것 고르기", render: "grammar" },
  { key: "r_context", group: "본문", label: "어색한 곳 고치기", hint: "글에서 어색한 곳 찾아 고쳐 쓰기", render: "vocabFix" },
  { key: "r_word_order", group: "본문", label: "순서 배열", hint: "우리말 보고 단어·어구 배열하기", render: "wordOrder" },
  { key: "r_writing", group: "본문", label: "영작", hint: "주어진 단어를 순서대로 써서 영작하기", render: "writing" },
  { key: "d_line", group: "대화문", label: "대화문 해석 쓰기", hint: "말차례마다 해석 쓰기", render: "line" },
  { key: "d_writing", group: "대화문", label: "대화문 영작", hint: "해석을 보고 영어로 쓰기", render: "writing" },
  { key: "d_order", group: "대화문", label: "대화 순서 배열", hint: "첫 말 뒤 (A)~ 순서 맞추기", render: "sentenceOrder" },
  { key: "w_en_ko", group: "단어", label: "단어 영→한", hint: "영어 단어의 뜻 쓰기", render: "words" },
  { key: "w_ko_en", group: "단어", label: "단어 한→영", hint: "뜻을 보고 영어 단어 쓰기", render: "words" },
];

const SET_OF: Partial<Record<MsWbTypeKey, MsWbSetKey>> = {
  r_ko_blank: "ko_blank",
  r_en_blank: "en_blank",
  r_verb_form: "verb_form",
  r_grammar: "grammar_choice",
  r_word_order: "word_order",
  r_writing: "writing",
};

export function msWbLabel(key: MsWbTypeKey): string {
  return MS_WB_TYPES.find((t) => t.key === key)?.label ?? key;
}

// ---------------------------------------------------------------- 글 → 조각

/** 「______ ______」 빈칸과 「[A / B]」 고르기를 조각으로 */
export function toSegs(q: string): TestSeg[] {
  const out: TestSeg[] = [];
  const re = /(_{3,})|\[\s*([^\]/]+?)\s*\/\s*([^\]]+?)\s*\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m.index > last) out.push(q.slice(last, m.index));
    out.push(m[1] ? { blank: "" } : { pick: [m[2], m[3]] });
    last = m.index + m[0].length;
  }
  if (last < q.length) out.push(q.slice(last));
  return out;
}

const no = (i: number) => `(${i + 1})`;
const LETTERS = "ABCDEFGHIJKLMN";

/** 짧은 무작위(같은 seed면 같은 결과) */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- 유형별 문항

/** 영어 비교용: 줄임말을 풀고(I'm = I am) 글자·숫자만 남긴다 — 양쪽에 똑같이 쓴다 */
const enNorm = (s: string) =>
  ` ${s
    .replace(/[’‘]/g, "'")
    .replace(/\b(can)'t\b/gi, "$1 not")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/n't\b/gi, " not")
    .replace(/'m\b/gi, " am")
    .replace(/'re\b/gi, " are")
    .replace(/'ll\b/gi, " will")
    .replace(/'ve\b/gi, " have")
    .replace(/\b(it|he|she|that|there|what|where|who|here)'s\b/gi, "$1 is")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()} `;

/** 그 과 본문 줄(1~4줄 묶음)에서 이 영어를 품은 가장 짧은 묶음 */
function windowWith(passages: { lines: { en: string; ko: string }[] }[], english: string): { en: string; ko: string } | null {
  const want = enNorm(english);
  if (want.trim().length < 3) return null;
  for (let size = 1; size <= 4; size++) {
    for (const p of passages) {
      for (let a = 0; a + size <= p.lines.length; a++) {
        const w = p.lines.slice(a, a + size);
        if (enNorm(w.map((l) => l.en).join(" ")).includes(want)) return { en: w.map((l) => l.en).join(" "), ko: w.map((l) => l.ko).filter(Boolean).join(" ") };
      }
    }
  }
  return null;
}

/**
 * 영작·순서 배열 정답을 본문 문장 전체로(선생님 2026-11-04 「워크북 영작 정답이 잘못돼 있다」).
 * 족보닷컴 원본은 「Vincent van Gogh ____ ____.」처럼 문장 틀의 빈칸만 쓰게 해서 정답도 빈칸 몫(「was a Dutch artist」)만 있고,
 * 틀이 깨진 문항은 조각(「started to paint himself / He painted / self-portraits」)이다. 우리 시험지는 우리말만 주고 문장 전체를 쓰게 하므로,
 * 정답 조각이 차례대로 다 들어 있는 가장 짧은 본문 줄 묶음(1~6줄)을 찾아 그 영어 전체와 해석을 쓴다.
 * 순서 배열 우리말 칸에 원본 머리글(「순서배열 연습」「Ann Jones, 방문객」)이 잘못 들어간 것도 이것으로 바로잡힌다. 못 찾으면 원본 그대로.
 */
export function msPassageSentence(
  lines: { en: string; ko: string }[],
  answer: string,
  /** 문제에 보이는 낱말(순서 배열의 섞인 낱말·앞에 준 말) — 이것까지 다 들어 있는 문장 묶음을 고른다 */
  mustWords: string[] = [],
): { en: string; ko: string } | null {
  const parts = answer
    .split(/\s*\/\s*/)
    .map((p) => enNorm(p).trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const must = [...new Set(mustWords.map((w) => enNorm(w).trim()).filter((w) => w.length > 1 && !w.includes(" ")))];
  if (must.length) {
    for (let size = 1; size <= 6; size++) {
      for (let a = 0; a + size <= lines.length; a++) {
        const win = lines.slice(a, a + size);
        const text = enNorm(win.map((l) => l.en).join(" "));
        const words = new Set(text.trim().split(" "));
        if (!must.every((w) => words.has(w))) continue;
        let pos = 0;
        let ok = true;
        for (const p of parts) {
          const i = text.indexOf(` ${p} `, pos);
          if (i < 0) {
            ok = false;
            break;
          }
          pos = i + p.length + 1;
        }
        if (ok) return { en: win.map((l) => l.en).join(" "), ko: win.map((l) => l.ko).filter(Boolean).join(" ") };
      }
    }
  }
  for (let size = 1; size <= 6; size++) {
    for (let a = 0; a + size <= lines.length; a++) {
      const win = lines.slice(a, a + size);
      const text = enNorm(win.map((l) => l.en).join(" "));
      let pos = 0;
      let ok = true;
      for (const p of parts) {
        const i = text.indexOf(` ${p} `, pos);
        if (i < 0) {
          ok = false;
          break;
        }
        pos = i + p.length + 1;
      }
      if (ok) return { en: win.map((l) => l.en).join(" "), ko: win.map((l) => l.ko).filter(Boolean).join(" ") };
    }
  }
  // 앞에 원본 머리글 조각이 붙었거나(「Say No to Single-Use Plastic / I often …」) 원본 정답에 낱말이 하나 빠진(「made so excited」) 문항:
  // 앞 조각부터 떼어 다시 찾고, 그래도 없으면 정답 낱말의 85% 이상이 들어 있는 가장 짧은 묶음
  if (parts.length > 1) {
    const rest = answer.split(/\s*\/\s*/).filter(Boolean).slice(1).join(" / ");
    const again = msPassageSentence(lines, rest, mustWords);
    if (again) return again;
  }
  const want = parts.join(" ").split(" ").filter(Boolean);
  if (want.length >= 4) {
    for (let size = 1; size <= 4; size++) {
      for (let a = 0; a + size <= lines.length; a++) {
        const win = lines.slice(a, a + size);
        const words = new Set(enNorm(win.map((l) => l.en).join(" ")).trim().split(" "));
        if (want.filter((w) => words.has(w)).length >= want.length * 0.85) return { en: win.map((l) => l.en).join(" "), ko: win.map((l) => l.ko).filter(Boolean).join(" ") };
      }
    }
  }
  return null;
}

/**
 * 빈칸·동사 형태·어법 선택 정답 바로잡기(선생님 2026-11-04 「정답지가 잘못된 것이 있다」).
 * 족보닷컴 원본을 읽을 때 앞 줄의 말(역할 이름 「janitor」「방문객」, 앞 문항 정답 「know / am」)이 정답 앞에 붙은 문항이 있다(32과 116문항).
 * 빈칸 수보다 정답이 많으면 ① 문제에 이미 적힌 말을 빼고 ② 그래도 많으면 앞 조각부터 뗀다.
 * 동사 형태처럼 괄호 수보다 정답이 모자란 문항은 답을 맞출 수 없으니 싣지 않는다(null).
 */
export function msBlankAnswer(set: string, q: string, answer: string): string | null {
  if (set === "writing" || set === "word_order") return answer;
  // 동사 형태: 괄호를 모두 빈칸으로 센다(떼기는 덜 떼는 쪽으로). 문항 빼기는 줄임말 풀이 괄호(「BRT (be right there)」)를 빼고 센 수로.
  const holes =
    set === "grammar_choice" ? (q.match(/\[[^\]]+\/[^\]]+\]/g) ?? []).length : set === "verb_form" ? (q.match(/\([^)]+\)/g) ?? []).length : (q.match(/_{3,}/g) ?? []).length;
  const needed = set === "verb_form" ? holes - (q.match(/(?:^|[^A-Za-z])[A-Z]{2,}\s*\([^)]+\)/g) ?? []).length : holes;
  let parts = answer.split(/\s*\/\s*/).filter(Boolean);
  // 빈칸·괄호·[A / B]가 하나도 없는 문항은 원본 머리글(「Amy 드림」「Uncle Jay」)이 문항으로 잘못 들어간 것 — 싣지 않는다
  if (!holes) return null;
  if (!parts.length) return answer;
  const size = (p: string) => (set === "en_blank" ? p.split(/\s+/).filter(Boolean).length : 1);
  const total = (ps: string[]) => ps.reduce((n, p) => n + size(p), 0);
  // 동사 형태: 괄호마다 그 동사의 꼴인 조각을 짝지어 본다(끼어든 말이 앞·가운데 어디에 있어도)
  if (set === "verb_form" && parts.length > holes) {
    const insides = (q.match(/\(([^)]+)\)/g) ?? []).map((m) => m.slice(1, -1));
    // 끼어든 말은 대개 앞(앞 줄 머리글·앞 문항 정답)에 붙으므로 뒤에서부터 짝짓는다
    const picked: string[] = [];
    let j = parts.length - 1;
    for (let h = insides.length - 1; h >= 0; h--) {
      let k = j;
      while (k >= 0 && !fitsVerb(parts[k], insides[h])) k--;
      if (k < 0) break;
      picked.unshift(parts[k]);
      j = k - 1;
    }
    if (picked.length === insides.length) return picked.join(" / ");
  }
  if (total(parts) > holes) {
    const outside = q.replace(/_{3,}/g, " ");
    // 우리말 빈칸만: 영어는 「ice ___ … a new ice palace」처럼 정답 낱말이 문장에 또 나올 수 있다
    const kept = parts.filter((p) => set !== "ko_blank" || !outside.includes(p));
    if (kept.length && total(kept) >= holes) parts = kept;
  }
  while (parts.length > 1 && total(parts) > holes && total(parts.slice(1)) >= holes) parts = parts.slice(1);
  if ((set === "verb_form" || set === "grammar_choice") && parts.length < needed) return null;
  return parts.join(" / ");
}

const koNorm = (s: string) => s.replace(/_{3,}/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "");
function koBigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}
function koDice(a: string, b: string): number {
  const A = koBigrams(a);
  const B = koBigrams(b);
  let inter = 0;
  let n = 0;
  for (const [k, v] of A) {
    inter += Math.min(v, B.get(k) ?? 0);
    n += v;
  }
  for (const v of B.values()) n += v;
  return n ? (2 * inter) / n : 0;
}

/**
 * 빈칸(우리말) 문항 위에 보여 줄 영어 문장(선생님 2026-11-04 정답지 점검): 원본을 읽을 때 영어 칸이 머리글(「Carlos Diaz, a janitor」「JAN 20」)로
 * 밀린 문항이 있다(32과 50문항). 영어가 본문에 그대로 있으면 그대로, 아니면 그 과 모든 본문 줄(1~3줄 묶음)에서 우리말 글자가 가장 많이 겹치는 문장을 쓴다.
 * 겹침이 너무 적으면(0.45 미만) 맞는 영어를 모르는 것이니 싣지 않는다(null).
 */
export function msKoBlankEnglish(passages: { lines: { en: string; ko: string }[] }[], en: string, q: string, answer = ""): string | null {
  // 빈칸을 정답으로 채운 우리말로 비교한다(빈칸 자리 글자가 빠지면 짧은 줄이 더 높게 나온다)
  const fill = answer.split(/\s*\/\s*/).filter(Boolean);
  let k = 0;
  const want = koNorm(q.replace(/_{3,}/g, () => fill[k++] ?? ""));
  // 원래 영어가 본문 문장이고 그 해석이 이 우리말과 맞으면 그대로(본문 문장이어도 한 줄 밀린 문장일 수 있다 — 「민수: 나도. ___ 거야」 위에 보라의 문장)
  const own = en.trim() ? windowWith(passages, en) : null;
  if (own && koDice(want, koNorm(own.ko)) >= 0.5) return en;
  let best = { s: 0, en: "" };
  for (const p of passages) {
    for (let a = 0; a < p.lines.length; a++) {
      for (let size = 1; size <= 3 && a + size <= p.lines.length; size++) {
        const w = p.lines.slice(a, a + size);
        const s = koDice(want, koNorm(w.map((l) => l.ko).join("")));
        if (s > best.s) best = { s, en: w.map((l) => l.en).join(" ") };
      }
    }
  }
  if (best.s < 0.45) return null;
  // 원래 영어가 찾은 문장을 거의 다 품고 있으면(「Dear Nick, Congratulations! Frindle is …」) 원래 것을 쓴다 — 줄 나눔만 달랐던 것
  const have = new Set(enNorm(en).trim().split(" "));
  const found = enNorm(best.en).trim().split(" ");
  if (en.trim() && found.filter((w) => have.has(w)).length >= found.length * 0.8) return en;
  return best.en;
}

/** 불규칙 동사 꼴(동사 형태 정답 짝 맞추기용) */
const IRREGULAR: Record<string, string[]> = {
  be: ["am", "is", "are", "was", "were", "been", "being", "'m", "'s", "'re", "isn't", "aren't", "wasn't", "weren't"],
  do: ["did", "does", "done", "don't", "doesn't", "didn't"],
  have: ["has", "had", "having"],
  begin: ["began", "begun"], see: ["saw", "seen"], say: ["said"], get: ["got", "gotten"], leave: ["left"], run: ["ran"], eat: ["ate", "eaten"],
  make: ["made"], find: ["found"], tear: ["tore", "torn"], buy: ["bought"], think: ["thought"], go: ["went", "gone"], come: ["came"],
  take: ["took", "taken"], give: ["gave", "given"], tell: ["told"], feel: ["felt"], fall: ["fell", "fallen"], throw: ["threw", "thrown"],
  catch: ["caught"], know: ["knew", "known"], spend: ["spent"], send: ["sent"], bring: ["brought"], teach: ["taught"], win: ["won"],
  write: ["wrote", "written"], hold: ["held"], stand: ["stood"], sit: ["sat"], meet: ["met"], lose: ["lost"], keep: ["kept"], sleep: ["slept"],
  break: ["broke", "broken"], choose: ["chose", "chosen"], hear: ["heard"], pay: ["paid"], become: ["became"], grow: ["grew", "grown"],
  draw: ["drew", "drawn"], fly: ["flew", "flown"], wear: ["wore", "worn"], speak: ["spoke", "spoken"], drive: ["drove", "driven"],
  ride: ["rode", "ridden"], swim: ["swam"], sing: ["sang", "sung"], drink: ["drank", "drunk"], forget: ["forgot", "forgotten"],
  shoot: ["shot"], lead: ["led"], feed: ["fed"], fight: ["fought"], build: ["built"], lend: ["lent"], hang: ["hung"], dig: ["dug"],
  sell: ["sold"], understand: ["understood"], hide: ["hid", "hidden"], shake: ["shook"], wake: ["woke"], steal: ["stole"], blow: ["blew"],
  can: ["could", "can't", "couldn't"], will: ["would", "won't"],
};
/** 정답 조각이 그 괄호(원형)의 꼴인지 */
export function fitsVerb(part: string, inside: string): boolean {
  const words = part.toLowerCase().replace(/[’]/g, "'").split(/\s+/);
  const bases = inside
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((w) => w && w !== "not" && w !== "to");
  return bases.some((b) => {
    // confuse → confused, capture → to capture, use → used: 끝 두 글자를 뺀 앞부분(최소 3자)으로 맞춘다
    const stem = b.length >= 5 ? b.slice(0, b.length - 2) : b;
    return words.some((w) => w === b || w.startsWith(stem) || (IRREGULAR[b] ?? []).includes(w));
  });
}

/** 정답을 문제에 넣은 영어 문장(빈칸·동사 형태·어법 선택) — 본문과 대조하는 데 쓴다 */
function filledEnglish(set: string, q: string, answer: string): string {
  const parts = answer.split(/\s*\/\s*/).filter(Boolean);
  let k = 0;
  if (set === "en_blank") {
    const words = parts.join(" ").split(/\s+/);
    return q.replace(/_{3,}/g, () => words[k++] ?? "");
  }
  if (set === "verb_form") return q.replace(/(?<![A-Z]{2}\s?)\(([^)]+)\)/g, (m) => (k < parts.length ? parts[k++] : m));
  return q.replace(/\[\s*([^\]/]+?)\s*\/\s*([^\]]+?)\s*\]/g, (m) => (k < parts.length ? parts[k++] : m));
}

/**
 * 어법 선택 정답을 본문으로 정한다(선생님 2026-11-04 정답지 점검): [A / B]마다 본문 문장이 되는 쪽을 고른다.
 * 원본 정답이 「정답」 같은 글자이거나 앞 문항 정답이 붙은 문항도 바로잡힌다. 본문에서 못 찾으면 원본 정답(보기 중 하나일 때만).
 */
function grammarChoiceAnswer(passages: { lines: { en: string; ko: string }[] }[], q: string, answer: string): string | null {
  const picks = [...q.matchAll(/\[\s*([^\]/]+?)\s*\/\s*([^\]]+?)\s*\]/g)].map((m) => [m[1].trim(), m[2].trim()] as const);
  if (!picks.length) return null;
  if (picks.length <= 8) {
    for (let mask = 0; mask < 1 << picks.length; mask++) {
      const choice = picks.map((p, i) => p[(mask >> i) & 1]);
      let k = 0;
      const filled = q.replace(/\[\s*([^\]/]+?)\s*\/\s*([^\]]+?)\s*\]/g, () => choice[k++]);
      if (windowWith(passages, filled)) return choice.join(" / ");
    }
  }
  const parts = answer.split(/\s*\/\s*/).filter(Boolean);
  const ok = parts.length === picks.length && parts.every((p, i) => picks[i].some((o) => o.toLowerCase() === p.trim().toLowerCase()));
  return ok ? parts.join(" / ") : null;
}

/** 원본 조건 칸에 머리글·교재 이름이 잘못 들어간 것(「동아(이병민)」「영작 연습」) */
const JUNK_HINT = /동아\(|천재\(|연습$/;

function readingItems(key: MsWbTypeKey, unit: MsUnit, wb: MsWorkbook, part: string): TestItem[] {
  if (key === "r_line") {
    const p = unit.passages.find((t) => t.part === part);
    return (p?.lines ?? []).map((l, i) => ({ no: no(i), text: [l.en], lines: 1, answer: l.ko }));
  }
  const set = SET_OF[key];
  if (!set) return [];
  const plines = unit.passages.find((t) => t.part === part)?.lines ?? [];
  const items = (wb.sets?.[set]?.items ?? [])
    .filter((it) => it.part === part)
    .map((it) => {
      let answer = msBlankAnswer(set, it.q ?? "", it.answer ?? "");
      if (set === "grammar_choice") answer = grammarChoiceAnswer(unit.passages, it.q ?? "", answer ?? it.answer ?? "");
      if (answer === null) return null;
      if (set === "ko_blank") {
        const en = msKoBlankEnglish(unit.passages, it.en ?? "", it.q ?? "", answer);
        return en === null ? null : { ...it, answer, en };
      }
      // 문제 아래 해석: 정답을 넣은 문장의 본문 해석과 다르면(한 줄 밀림) 본문 해석으로
      if (set === "en_blank" || set === "verb_form" || set === "grammar_choice") {
        const w = windowWith(unit.passages, filledEnglish(set, it.q ?? "", answer));
        if (w?.ko && (!it.ko || koDice(koNorm(it.ko), koNorm(w.ko)) < 0.5)) return { ...it, answer, ko: w.ko };
      }
      return { ...it, answer };
    })
    .filter((it): it is MsWbItem => it !== null);
  return items.map((it, i) => {
    switch (key) {
      case "r_ko_blank":
        return { no: no(i), text: [it.en ?? ""], ko: it.q, answer: it.answer };
      case "r_writing": {
        const full = msPassageSentence(plines, it.answer ?? "");
        const hint = it.hint && !JUNK_HINT.test(it.hint) ? `${it.hint} (순서대로)` : undefined;
        return { no: no(i), text: [], ko: full?.ko || it.ko, hint, lines: 1, answer: full?.en ?? it.answer };
      }
      case "r_word_order": {
        // 문제(섞인 낱말 + 앞에 준 말)의 낱말이 다 들어 있는 문장 묶음으로 — 「I'm Hannah. (…)」처럼 두 문장에 걸친 문항
        const full = msPassageSentence(plines, it.answer ?? "", (it.q ?? "").split(/[^A-Za-z0-9'’]+/));
        return { no: no(i), text: [it.q ?? ""], ko: full?.ko || it.ko, lines: 1, answer: full?.en ?? it.answer };
      }
      case "r_verb_form":
        return { no: no(i), text: [it.q ?? ""], ko: it.ko, lines: 1, answer: it.answer };
      default:
        return { no: no(i), text: toSegs(it.q ?? ""), ko: it.ko, answer: it.answer };
    }
  });
}

function dialogueSection(key: MsWbTypeKey, t: MsText, seed: string): TestSection | null {
  const meta = MS_WB_TYPES.find((x) => x.key === key)!;
  if (key === "d_line") {
    return {
      type: "line",
      title: "",
      hint: meta.hint,
      items: t.lines.map((l, i) => ({ no: no(i), text: [`${l.speaker}: ${l.en}`], lines: 1, answer: l.ko })),
    };
  }
  if (key === "d_writing") {
    return {
      type: "writing",
      title: "",
      hint: meta.hint,
      items: t.lines
        .filter((l) => l.ko && l.en.split(/\s+/).length <= 16)
        .map((l, i) => ({ no: no(i), text: [], ko: `${l.speaker}: ${l.ko}`, lines: 1, answer: `${l.speaker}: ${l.en}` })),
    };
  }
  if (key === "d_order") {
    if (t.lines.length < 3) return null;
    const [first, ...rest] = t.lines;
    const body = rest.slice(0, LETTERS.length);
    const mixed = shuffle(
      body.map((l, i) => ({ l, i })),
      seeded(`${seed}-${t.id}`),
    );
    const letterOf = new Map(mixed.map((x, k) => [x.i, LETTERS[k]]));
    return {
      type: "sentenceOrder",
      title: "",
      hint: meta.hint,
      given: `${first.speaker}: ${first.en}`,
      items: mixed.map((x, k) => ({ no: `(${LETTERS[k]})`, text: [`${x.l.speaker}: ${x.l.en}`], answer: "" })),
      answer: body.map((_, i) => `(${letterOf.get(i)})`).join(" - "),
    };
  }
  return null;
}

function wordSection(key: MsWbTypeKey, unit: MsUnit): TestSection {
  const meta = MS_WB_TYPES.find((x) => x.key === key)!;
  const words = unit.words.filter((w) => w.word.length > 1);
  return {
    type: "words",
    title: "",
    hint: meta.hint,
    items: words.map((w, i) =>
      key === "w_en_ko"
        ? { no: String(i + 1), text: [w.word], answer: w.meaning }
        : { no: String(i + 1), text: [w.meaning.replace(/^(n|v|a|adj|adv|prep|conj|pron|int)\.\s*/, "")], answer: w.word },
    ),
  };
}

// ---------------------------------------------------------------- 시트 조립

export type MsWbSheet = { key: string; index: number; title: string; titleEn: string | null; source: string; sheet: TestSheet };

/** 고른 유형으로 지문(본문1·대화문1…·단어)마다 테스트지를 만든다. 문항 고르기(뽑기)는 pick으로. */
export function buildMsWorkbook(
  unit: MsUnit,
  wb: MsWorkbook,
  types: MsWbTypeKey[],
  opts: { seed?: string; pick?: (key: MsWbTypeKey, items: TestItem[]) => TestItem[] } = {},
): MsWbSheet[] {
  const seed = opts.seed ?? "workbook";
  const pick = opts.pick ?? ((_k, items) => items);
  const source = `${unit.grade} ${unit.publisher} ${unit.lessonNo}과`;
  const sheets: MsWbSheet[] = [];
  const on = (g: MsWbGroup) => MS_WB_TYPES.filter((t) => t.group === g && types.includes(t.key));
  const renumber = (items: TestItem[]) => items.map((it, i) => ({ ...it, no: /^\d+$/.test(it.no) ? String(i + 1) : `(${i + 1})` }));

  for (const p of unit.passages) {
    const sections: TestSection[] = [];
    for (const t of on("본문")) {
      if (t.key === "r_context") {
        const ctx = (wb.contextFix ?? []).filter((c) => c.part === p.part);
        ctx.forEach((c) =>
          sections.push({
            type: "vocabFix",
            title: t.label,
            hint: `어색한 것 ${c.count}를 찾아 바르게 고쳐 쓰기`,
            passage: [c.passage],
            items: c.answers.map((a, i) => ({ no: no(i), text: ["____________ → ____________"], answer: a })),
          }),
        );
        continue;
      }
      const items = renumber(pick(t.key, readingItems(t.key, unit, wb, p.part)));
      if (items.length) sections.push({ type: t.render, title: t.label, hint: t.hint, items });
    }
    if (sections.length) {
      sheets.push({
        key: p.id,
        index: sheets.length,
        title: `${p.part} ${p.title ?? ""}`.trim(),
        titleEn: unit.passages[0] === p ? unit.title : null,
        source,
        sheet: { projectId: p.id, title: p.part, source, sections },
      });
    }
  }
  // 대화문은 짧아 하나에 한 쪽씩 쓰면 빈 쪽이 많다 — 한 묶음(대화문)에 유형·대화마다 이어 싣는다
  const dSections: TestSection[] = [];
  for (const t of on("대화문")) {
    for (const d of unit.dialogues) {
      const sec = dialogueSection(t.key, d, seed);
      if (!sec) continue;
      const items = sec.type === "sentenceOrder" ? sec.items : renumber(pick(t.key, sec.items));
      if (items.length) dSections.push({ ...sec, title: `${t.label} · ${d.part}`, items });
    }
  }
  if (dSections.length) {
    sheets.push({
      key: `${unit.id}-dialogues`,
      index: sheets.length,
      title: "대화문",
      titleEn: null,
      source,
      sheet: { projectId: `${unit.id}-dialogues`, title: "대화문", source, sections: dSections },
    });
  }
  const wordTypes = on("단어");
  if (wordTypes.length && unit.words.length) {
    // 단어 칸은 한 덩어리로 그려진다 — 한 쪽에 들어가게 40개씩 끊는다
    const WORDS_PER_BLOCK = 40;
    const sections = wordTypes.flatMap((t) => {
      const s = wordSection(t.key, unit);
      const items = renumber(pick(t.key, s.items));
      const out: TestSection[] = [];
      for (let i = 0; i < items.length; i += WORDS_PER_BLOCK) {
        out.push({ ...s, title: i ? `${t.label} (이어서)` : t.label, hint: i ? undefined : s.hint, items: items.slice(i, i + WORDS_PER_BLOCK) });
      }
      return out;
    });
    sheets.push({
      key: `${unit.id}-words`,
      index: sheets.length,
      title: "단어",
      titleEn: null,
      source,
      sheet: { projectId: `${unit.id}-words`, title: "단어", source, sections },
    });
  }
  return sheets;
}

/** 이 과에서 유형마다 문항이 몇 개인지(화면의 유형 고르기 옆 숫자) */
export function msWbCounts(unit: MsUnit, wb: MsWorkbook): Record<MsWbTypeKey, number> {
  const out = {} as Record<MsWbTypeKey, number>;
  for (const t of MS_WB_TYPES) {
    out[t.key] = buildMsWorkbook(unit, wb, [t.key]).reduce(
      (n, s) => n + s.sheet.sections.reduce((k, sec) => k + (sec.type === "sentenceOrder" ? 1 : sec.items.length), 0),
      0,
    );
  }
  return out;
}

// ---------------------------------------------------------------- 테스트지 뽑기

export type MsDrawLength = "short" | "normal" | "long";
/** 지문 하나에서 유형마다 뽑을 문항 수(고등 뽑기 짧게/보통/길게와 같은 감각) */
export const MS_DRAW_LIMITS: Record<MsDrawLength, number> = { short: 3, normal: 5, long: 8 };
export const MS_DRAW_WORDS: Record<MsDrawLength, number> = { short: 10, normal: 15, long: 25 };

/** 테스트지에 넣는 족보닷컴 문제 수(대화문·문법 각각) */
export const MS_DRAW_QUESTIONS: Record<MsDrawLength, number> = { short: 5, normal: 10, long: 15 };

/**
 * 테스트지용 문제 뽑기: 그 과 문제 중 영역(의사소통·어법)이 맞고 숨기지 않은 것에서 무작위로 n개.
 * 같은 seed면 같은 문제. 찍는 차례는 출처 차례 → 그 안 번호(같은 글을 받는 문항이 붙어 나온다).
 */
export function drawMsQuestions<Q extends { id: number; area: string; review: string }>(questions: Q[], area: string, n: number, seed: string): Q[] {
  const pool = questions.filter((q) => q.area === area && !q.review);
  if (pool.length <= n) return pool;
  const keep = new Set(shuffle(pool.map((q) => q.id), seeded(`${seed}|q|${area}`)).slice(0, n));
  return pool.filter((q) => keep.has(q.id));
}

export function drawMsWorkbook(unit: MsUnit, wb: MsWorkbook, types: MsWbTypeKey[], length: MsDrawLength, seed: string): MsWbSheet[] {
  const rand = seeded(seed);
  return buildMsWorkbook(unit, wb, types, {
    seed,
    pick: (key, items) => {
      const n = key.startsWith("w_") ? MS_DRAW_WORDS[length] : MS_DRAW_LIMITS[length];
      if (items.length <= n) return items;
      // 무작위로 고르되 차례는 글 차례 그대로
      const keep = new Set(shuffle(items.map((_, i) => i), rand).slice(0, n));
      return items.filter((_, i) => keep.has(i));
    },
  });
}
