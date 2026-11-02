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

function readingItems(key: MsWbTypeKey, unit: MsUnit, wb: MsWorkbook, part: string): TestItem[] {
  if (key === "r_line") {
    const p = unit.passages.find((t) => t.part === part);
    return (p?.lines ?? []).map((l, i) => ({ no: no(i), text: [l.en], lines: 1, answer: l.ko }));
  }
  const set = SET_OF[key];
  if (!set) return [];
  const items = (wb.sets?.[set]?.items ?? []).filter((it) => it.part === part);
  return items.map((it, i) => {
    switch (key) {
      case "r_ko_blank":
        return { no: no(i), text: [it.en ?? ""], ko: it.q, answer: it.answer };
      case "r_writing":
        return { no: no(i), text: [], ko: it.ko, hint: it.hint ? `${it.hint} (순서대로)` : undefined, lines: 1, answer: it.answer };
      case "r_verb_form":
      case "r_word_order":
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
