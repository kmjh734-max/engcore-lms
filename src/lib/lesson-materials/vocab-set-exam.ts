import type { VocabItem } from "@/types/database";
import { fixVocabWord, isBadWordForm, isEmptyVocabWord, isProperNounVocabStrict } from "@/lib/lesson-materials/bad-word-forms";
import type {
  OnePageContent,
} from "@/lib/lesson-materials/one-page";
import type { TestBookMaterial, TestBookProjectInput, TestBookVocabRow } from "@/lib/lesson-materials/test-book";

function splitList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;/]/)
    .map((w) => w.trim())
    .filter((w) => w && !isEmptyVocabWord(w));
}

/**
 * 자료함 「단어」 탭 단어장을 수업용 자료 「단어 시험지」에 넣을 수 있게 지문 하나처럼 묶는다
 * (선생님 2026-10-29: 단어 탭 시험지와 수업용 자료 단어 시험지가 달라 맞춘다).
 * 단어장에는 지문 정보가 없으므로 단어학습에 저장된 단어(차례·뜻·품사·동의어·반의어)를 그대로 쓴다 —
 * 단어학습에서 고친 단어도 그대로 나온다. 파생어·혼동어휘는 단어장을 만들 때 단어 정리에서 함께 옮겨 둔 것이다(2026-10-30).
 * 단어 시험지는 material.vocab만 읽으므로 나머지 재료는 빈 값이다.
 */
export function vocabSetAsProject(
  set: { id: string; title: string; source?: string | null },
  items: VocabItem[],
  /** 지문별로 나눠 넘길 때 이 조각의 첫 단어 번호 - 1(번호는 단어장 전체 차례 그대로) */
  offset = 0
): TestBookProjectInput {
  // 번호는 단어장 인쇄(단어 탭 「인쇄」)와 같게 — 빼는 단어가 있어도 뒤 번호가 당겨지지 않는다
  const vocab: TestBookVocabRow[] = items
    .map((i, n) => ({ i, listNo: offset + n + 1 }))
    .filter(({ i }) => i.word?.trim() && i.meaning?.trim() && !isProperNounVocabStrict(i.word, i.meaning))
    .map(({ i, listNo }) => ({
      word: fixVocabWord(i.word.trim()),
      pos: i.part_of_speech?.trim() ?? "",
      meaning: i.meaning.trim(),
      synonyms: splitList(i.synonyms),
      antonyms: splitList(i.antonyms),
      forms: (Array.isArray(i.forms) ? i.forms : []).filter((f) => !isBadWordForm(i.word, f.word)),
      phrase: "",
      confusables: Array.isArray(i.confusables) ? i.confusables : [],
      key: false,
      listNo,
    }));
  const material = { version: "vocab-set", sourceHash: set.id, vocab, keyIndexes: [], chunks: [] } as unknown as TestBookMaterial;
  return {
    id: set.id,
    title: set.title,
    titleEn: null,
    source: set.source ?? null,
    sentences: [],
    // 「재료가 있는 지문」으로 세도록 비어 있지 않은 값을 둔다(단어 시험지는 읽지 않는다)
    content: {} as OnePageContent,
    material,
  };
}

/**
 * 수업용 자료의 단어 번호를 이어진 단어장(파일 payload.vocabSetId) 차례에 맞춘다 — 번호는 단어장 한 곳에서만 센다
 * (선생님 2026-11-13 윌링 「단어장·수업용 자료·인쇄한 것이 따로 논다」: 단어장은 나중에 더한 낱말이 맨 뒤에 붙는데
 * 수업용 자료는 지문 차례로 다시 세어 번호가 밀렸다). 단어장에 없는 낱말은 단어장 끝 번호 뒤에 잇는다.
 * 차례가 이미 같으면(대부분의 파일) 아무것도 바꾸지 않는다. 단어장과 낱말이 절반도 안 겹치면 손대지 않는다.
 */
export function numberProjectsByVocabSet(projects: TestBookProjectInput[], setWords: string[]): TestBookProjectInput[] {
  const pos = new Map<string, number>();
  setWords.forEach((w, i) => {
    for (const k of [w, fixVocabWord(w ?? "")]) {
      const key = (k ?? "").trim().toLowerCase();
      if (key && !pos.has(key)) pos.set(key, i + 1);
    }
  });
  if (!pos.size) return projects;
  const no = new Map<string, number>();
  let next = setWords.length;
  let natural = 0;
  let matched = 0;
  let same = true;
  for (const p of projects) {
    for (const row of p.material?.vocab ?? []) {
      const k = row.word.toLowerCase();
      if (no.has(k)) continue;
      natural++;
      const hit = pos.get(k.trim()) ?? pos.get(fixVocabWord(row.word.trim()).toLowerCase());
      if (hit) matched++;
      const n = hit ?? ++next;
      no.set(k, n);
      if (n !== natural) same = false;
    }
  }
  if (same || matched * 2 < natural) return projects;
  return projects.map((p) =>
    p.material
      ? { ...p, material: { ...p.material, vocab: p.material.vocab.map((row) => ({ ...row, listNo: no.get(row.word.toLowerCase()) })) } }
      : p
  );
}

/**
 * 단어장이 수업용 자료에서 만든 것이면 지문마다 나눠 넘긴다(선생님 2026-11-11 「전체 단어장도 지문마다 출처·제목으로」,
 * 「단어 시험지도 지문마다 뽑게」). 지문 구간을 못 찾으면 예전처럼 한 덩어리.
 */
export function vocabSetAsProjects(
  set: { id: string; title: string },
  items: VocabItem[],
  groups: Array<{ from: number; to: number; source?: string | null; title?: string | null; label: string }> | undefined
): TestBookProjectInput[] {
  if (!groups || groups.length < 2) return [vocabSetAsProject(set, items)];
  return groups.map((g, gi) =>
    vocabSetAsProject(
      { id: `${set.id}#${gi + 1}`, title: g.title?.trim() || g.label, source: g.source ?? null },
      items.slice(g.from - 1, g.to),
      g.from - 1
    )
  );
}
