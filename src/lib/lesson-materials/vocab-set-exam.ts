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
  set: { id: string; title: string },
  items: VocabItem[]
): TestBookProjectInput {
  // 번호는 단어장 인쇄(단어 탭 「인쇄」)와 같게 — 빼는 단어가 있어도 뒤 번호가 당겨지지 않는다
  const vocab: TestBookVocabRow[] = items
    .map((i, n) => ({ i, listNo: n + 1 }))
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
    source: null,
    sentences: [],
    // 「재료가 있는 지문」으로 세도록 비어 있지 않은 값을 둔다(단어 시험지는 읽지 않는다)
    content: {} as OnePageContent,
    material,
  };
}
