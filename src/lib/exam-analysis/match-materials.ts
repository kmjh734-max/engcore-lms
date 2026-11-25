import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAcademyMaterialPassages } from "@/lib/exam-analysis/material-passages";
import { loadAllMockPassages, mockPassageShortLabel } from "@/lib/mock-passages";
import { resolveTextbookPassageAcademyId } from "@/lib/textbooks/shared-passages";

/**
 * 시험지 지문이 학원 수업자료(lesson_material_items) 지문과 같은지 글자로 대조한다.
 * 맞은 것만 출처를 단다 — 짐작한 출처는 두지 않는다.
 * 시험지는 지문을 조금 바꿔 내기도 하므로, 지문 앞부분의 5단어 묶음 가운데 30% 이상이 수업자료에 있으면 같은 지문으로 본다.
 */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/<\/?u>/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function shingles(ws: string[], n = 5): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(" "));
  return out;
}

type PoolEntry = { id: string; label: string; set: Set<string> };

/**
 * 지문마다 가장 많이 겹치는 것을 찾는다.
 *
 * 5낱말 묶음이 30% 넘게 겹치면 같은 지문으로 본다. 다만 발췌가 짧으면 묶음이 적어
 * 한 개 차이로 비율이 크게 흔들린다 — 스물다섯 낱말이면 묶음이 스물한 개뿐이라
 * 여섯 개가 겹쳐도 29%다. 그래서 겹친 <b>개수</b>가 다섯을 넘어도 같은 지문으로 본다.
 * 연속 다섯 낱말이 다섯 군데나 같으면 우연일 수 없다.
 *
 * 선생님과 함께 짚어 보니(2026-09-30) 발곡고 고1 19번이 25년 고1 6월 30번과
 * 여섯 군데 겹치는데 29%라 놓치고 있었다.
 */
const MIN_RATIO = 0.3;
const MIN_HITS = 5;
/*
 * 겹친 묶음이 그것대로 흔한지도 본다.
 *
 * 선생님 말씀(2026-09-30): 한 문장이라도 일치하거나 발췌한 것이면 출처로 삼아라.
 * 그런데 묶음 개수만 세면 흔한 인사말이 걸린다 — 불곡중 4번은 「do this weekend」가
 * 여덟 낱말이나 이어지는데 주말 계획을 묻는다는 것만 같은 전혀 다른 대화다.
 *
 * 그래서 겹친 묶음 가운데 <b>세 지문 이하에만 나오는 것</b>이 셋을 넘을 때만 잡는다.
 * 발곡고 고1 22번은 25년 고1 6월 24번을 다시 쓴 것인데 드문 묶음이 네 개라 잡히고,
 * 불곡중 4번은 두 개뿐이라 걸러진다.
 */
const RARE_SHINGLE_MAX_DOCS = 3;
const MIN_RARE_SHINGLES = 3;

/** 묶음마다 몇 개 지문에 나오는지 — 흔한 묶음을 가려내려고 미리 센다 */
function shingleDocFreq(pool: PoolEntry[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const m of pool) for (const g of m.set) df.set(g, (df.get(g) ?? 0) + 1);
  return df;
}

function bestMatches(
  pool: PoolEntry[],
  excerpts: { key: string; excerpt: string | null }[]
): Map<string, { id: string; label: string }> {
  const result = new Map<string, { id: string; label: string }>();
  if (pool.length === 0) return result;
  const df = shingleDocFreq(pool);
  for (const { key, excerpt } of excerpts) {
    if (!excerpt || words(excerpt).length < 8) continue;
    const sh = shingles(words(excerpt));
    if (sh.length === 0) continue;
    let best: { id: string; label: string; hit: number; rare: number } | null = null;
    for (const m of pool) {
      let hit = 0;
      let rare = 0;
      for (const s of sh) {
        if (!m.set.has(s)) continue;
        hit += 1;
        if ((df.get(s) ?? 0) <= RARE_SHINGLE_MAX_DOCS) rare += 1;
      }
      if (!best || hit > best.hit) best = { id: m.id, label: m.label, hit, rare };
    }
    if (!best || best.hit === 0) continue;
    const enough =
      best.hit / sh.length >= MIN_RATIO ||
      best.hit >= MIN_HITS ||
      best.rare >= MIN_RARE_SHINGLES;
    if (enough) result.set(key, { id: best.id, label: best.label });
  }
  return result;
}

/**
 * 바꿔 쓴 지문을 고유명사로 잡는다.
 *
 * 선생님과 함께 살펴보니(2026-09-30) 학교가 교과서 지문을 다시 써서 내는 일이
 * 있다. 「wanted to experiment with how easily one can manipulate public opinion」이
 * 시험지에서는 「wanted to see how easy people could influence public opinion」이 된다.
 * 다섯 낱말 묶음으로는 하나도 안 겹쳐 출처를 못 단다.
 *
 * 고유명사는 바꿔 써도 남는다. 교과서 모음 전체에서 세 지문 이하에만 나오는
 * 낱말(Oobah·Butler 같은 것)이 두 개 넘게 한 지문에 몰리면 같은 글로 본다.
 *
 * 다만 낱말만 보면 같은 인물을 다루는 <b>다른 글</b>이 걸린다. 일곱 건을 짚어 보니
 * 넷이 그랬다 — Carol Dweck을 말하는 교과서 대화문과 시험지 설명글이 엮이는 식이다.
 * 그래서 세 낱말 묶음도 12% 넘게 겹칠 때만 인정한다. 맞는 것은 18%였고 엮인 넷은
 * 0~5%여서 이 선에서 갈린다.
 */
const RARE_MAX_DOCS = 3;
const MIN_RARE_HITS = 2;
const MIN_TRIGRAM = 0.12;

type ParaphrasePool = {
  id: string;
  label: string;
  rare: Set<string>;
  three: Set<string>;
};

function buildParaphrasePool(
  rows: { id: string; label: string; text: string }[]
): ParaphrasePool[] {
  const docFreq = new Map<string, number>();
  const wordSets = rows.map((r) => {
    const set = new Set(words(r.text).filter((w) => w.length >= 4));
    for (const w of set) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    return set;
  });
  return rows.map((r, i) => ({
    id: r.id,
    label: r.label,
    rare: new Set([...wordSets[i]!].filter((w) => (docFreq.get(w) ?? 0) <= RARE_MAX_DOCS)),
    three: new Set(shingles(words(r.text), 3)),
  }));
}

/** 드문 낱말이 으뜸으로 몰리고 세 낱말 묶음도 겹치면 같은 지문으로 본다 */
function bestParaphraseMatch(
  pool: ParaphrasePool[],
  excerpt: string,
  rareWords: Set<string>
): { id: string; label: string } | null {
  const ws = words(excerpt);
  const mine = [...new Set(ws.filter((w) => w.length >= 4 && rareWords.has(w)))];
  if (mine.length < MIN_RARE_HITS) return null;
  const tri = shingles(ws, 3);
  if (tri.length === 0) return null;

  let best: { id: string; label: string; hits: number; tri: number } | null = null;
  let second = 0;
  for (const m of pool) {
    let hits = 0;
    for (const w of mine) if (m.rare.has(w)) hits++;
    if (!best || hits > best.hits) {
      second = best?.hits ?? 0;
      let t = 0;
      for (const g of tri) if (m.three.has(g)) t++;
      best = { id: m.id, label: m.label, hits, tri: t / tri.length };
    } else if (hits > second) {
      second = hits;
    }
  }
  if (!best || best.hits < MIN_RARE_HITS || best.hits <= second) return null;
  if (best.tri < MIN_TRIGRAM) return null;
  return { id: best.id, label: best.label };
}

export async function matchLessonMaterials(
  admin: SupabaseClient,
  academyId: string,
  excerpts: { key: string; excerpt: string | null }[],
  uploads?: Array<{ name: string; text: string }>
): Promise<Map<string, { itemId: string; label: string }>> {
  if (!excerpts.some((e) => e.excerpt && words(e.excerpt).length >= 8)) return new Map();
  // 수업자료 하나 = 지문 하나(문장들을 이어 붙인 것)와 대조한다
  const pool = (await loadAcademyMaterialPassages(admin, academyId)).map((m) => ({
    id: m.firstItemId,
    label: `${m.folder} · ${m.title}`,
    set: new Set(shingles(words(m.text))),
  }));
  if (uploads?.length) {
    let uploadIdCounter = 1;
    for (const u of uploads) {
      const chunkWords = words(u.text);
      // 대용량 PDF(예: 엔코어 변형문제 등)를 통째로 한 지문으로 취급하면,
      // MIN_HITS(5개)에 걸려 모든 문제가 다 적중했다고 나오는 False Positive가 발생함.
      // 따라서 250단어(약 1페이지 지문) 단위로 끊어서 판별한다.
      const chunkSize = 250;
      const overlap = 100;
      for (let i = 0; i < chunkWords.length; i += chunkSize - overlap) {
        const chunk = chunkWords.slice(i, i + chunkSize);
        if (chunk.length < 10) continue;
        pool.push({
          id: `upload-${uploadIdCounter++}`,
          label: `올린 자료 · ${u.name}`,
          set: new Set(shingles(chunk)),
        });
      }
    }
  }
  const out = new Map<string, { itemId: string; label: string }>();
  for (const [k, v] of bestMatches(pool, excerpts)) out.set(k, { itemId: v.id, label: v.label });
  return out;
}

/**
 * 교과서 본문과 대조 → 출처(예: 천재(조수경) 영어1 2과 본문3). 맞은 것만 단다.
 *
 * 이득희 선생님 말씀(2026-09-29): "저희 지역 학교가 지난번 서술형 포함하면
 * 교과서에서 70%가 나왔습니다. 이런 데이터가 없다면 70%라는 확률도 나오지 않기에
 * 분석지가 더 꼼꼼하게 작성되어 있으면 효율성의 면에서 도움이 되리라 봅니다."
 *
 * 그때까지는 수업자료와 모의고사만 대조했고 교과서 본문은 보지 않았다. 그래서
 * 분석한 여덟 시험 모두 교과서 적중이 0건이었다. 교과서 본문 891개를 넣어 보니
 * 호원고 고2가 77%, 의정부고 고2가 50%, 발곡고 고2가 41%로 바로 잡혔다.
 */
export async function matchTextbookPassages(
  admin: SupabaseClient,
  academyId: string,
  excerpts: { key: string; excerpt: string | null }[]
): Promise<Map<string, { textbookId: string; label: string; how: "text" | "paraphrase"; text: string }>> {
  if (!excerpts.some((e) => e.excerpt && words(e.excerpt).length >= 8)) return new Map();
  const ownerId = await resolveTextbookPassageAcademyId(admin, academyId);
  const rows: {
    id: string;
    subject: string;
    publisher: string;
    lesson: string;
    part: string;
    english_text: string;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("textbook_passages")
      .select("id, subject, publisher, lesson, part, english_text")
      .eq("academy_id", ownerId)
      .range(from, from + 999);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const pool = rows.map((m) => ({
    id: m.id,
    label: `${m.publisher} ${m.subject} ${m.lesson} ${m.part}`,
    set: new Set(shingles(words(String(m.english_text ?? "")))),
  }));
  const textOf = new Map(rows.map((m) => [m.id, String(m.english_text ?? "")]));
  const out = new Map<string, { textbookId: string; label: string; how: "text" | "paraphrase"; text: string }>();
  for (const [k, v] of bestMatches(pool, excerpts))
    out.set(k, { textbookId: v.id, label: v.label, how: "text", text: textOf.get(v.id) ?? "" });

  /*
   * 글자로 못 잡은 것은 고유명사로 한 번 더 본다 — 학교가 지문을 바꿔 써서 내는
   * 일이 있다. 자세한 사정은 bestParaphraseMatch에 적었다.
   */
  const left = excerpts.filter((e) => !out.has(e.key) && e.excerpt && words(e.excerpt).length >= 8);
  if (left.length > 0) {
    const paraPool = buildParaphrasePool(
      rows.map((m) => ({
        id: m.id,
        label: `${m.publisher} ${m.subject} ${m.lesson} ${m.part}`,
        text: String(m.english_text ?? ""),
      }))
    );
    const rareWords = new Set<string>();
    for (const p of paraPool) for (const w of p.rare) rareWords.add(w);
    for (const e of left) {
      const hit = bestParaphraseMatch(paraPool, e.excerpt!, rareWords);
      if (hit) out.set(e.key, { textbookId: hit.id, label: hit.label, how: "paraphrase", text: textOf.get(hit.id) ?? "" });
    }
  }
  return out;
}

/** 모의고사 지문 모음과 대조 → 출처(예: 24년 고2 6월 학평 24번). 맞은 것만 단다. */
export async function matchMockPassages(
  admin: SupabaseClient,
  excerpts: { key: string; excerpt: string | null }[]
): Promise<Map<string, { mockId: string; label: string; how: "text" | "paraphrase"; text: string }>> {
  if (!excerpts.some((e) => e.excerpt && words(e.excerpt).length >= 8)) return new Map();
  const rows = await loadAllMockPassages(admin);
  const pool = rows.map((m) => ({
    id: m.id,
    label: mockPassageShortLabel(m),
    set: new Set(shingles(words(m.english_text))),
  }));
  const textOf = new Map(rows.map((m) => [m.id, String(m.english_text ?? "")]));
  const out = new Map<string, { mockId: string; label: string; how: "text" | "paraphrase"; text: string }>();
  for (const [k, v] of bestMatches(pool, excerpts))
    out.set(k, { mockId: v.id, label: v.label, how: "text", text: textOf.get(v.id) ?? "" });

  /*
   * 글자로 못 잡은 것은 드문 낱말로 한 번 더 본다 — 교과서와 같은 방식이다.
   *
   * 선생님과 함께 짚어 보니(2026-09-30) 발곡고 고2 11번이 26년 고2 3월 34번을
   * 다시 쓴 것인데 놓치고 있었다. 「Artificial "pause fillers," generated by machines
   * to supplement silence」가 원문에서는 「Such artificial 'pause fillers' as
   * machine-generated supplements for silence」다. 낱말 차례가 달라 묶음이 안 맞는다.
   *
   * 최장 연속으로는 갈리지 않는다 — 불곡중 4번은 흔한 인사말이 여덟 낱말이나
   * 이어지는데 전혀 다른 글이다. 드문 낱말(pause·fillers 같은 것)이 몰리는지로 가른다.
   */
  const left = excerpts.filter((e) => !out.has(e.key) && e.excerpt && words(e.excerpt).length >= 8);
  if (left.length > 0) {
    const paraPool = buildParaphrasePool(
      rows.map((m) => ({ id: m.id, label: mockPassageShortLabel(m), text: m.english_text }))
    );
    const rareWords = new Set<string>();
    for (const p of paraPool) for (const w of p.rare) rareWords.add(w);
    for (const e of left) {
      const hit = bestParaphraseMatch(paraPool, e.excerpt!, rareWords);
      if (hit) out.set(e.key, { mockId: hit.id, label: hit.label, how: "paraphrase", text: textOf.get(hit.id) ?? "" });
    }
  }
  return out;
}

/** 저장된 문항표를 수업자료와 다시 대조해 적중 칸을 채운다(끄면 비운다). AI는 쓰지 않는다. */
export async function refreshMaterialMatches(
  admin: SupabaseClient,
  analysisId: string,
  academyId: string,
  enabled: boolean,
  uploads?: Array<{ name: string; text: string }>
): Promise<number> {
  /*
   * 선생님이 손으로 단 출처는 건드리지 않는다 — 자동 대조가 덮어쓰면 다시 비어 버린다.
   */
  const { data: items } = await admin
    .from("school_exam_items")
    .select("id, passage_excerpt")
    .eq("analysis_id", analysisId)
    .eq("source_edited", false);
  const rows = items ?? [];
  const matches = enabled
    ? await matchLessonMaterials(
        admin,
        academyId,
        rows.map((r) => ({ key: r.id as string, excerpt: (r.passage_excerpt as string | null) ?? null })),
        uploads
      )
    : new Map<string, { itemId: string; label: string }>();
  await Promise.all(
    rows.map((r) => {
      const m = matches.get(r.id as string);
      return admin
        .from("school_exam_items")
        .update({ matched_item_id: m?.itemId ?? null, matched_label: m?.label ?? null })
        .eq("id", r.id as string);
    })
  );
  await admin.from("school_exam_analyses").update({ match_materials: enabled }).eq("id", analysisId);
  return matches.size;
}
