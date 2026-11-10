import type { StoredBlankCandidatePool } from "@/lib/lesson-materials/workbook-blank-cache";
import type { StoredWordOrderChunkCache } from "@/lib/lesson-materials/word-order-chunk-cache";
import type { StoredSentenceTranslation } from "@/lib/lesson-materials/translation-meta";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

import { collectLessonVocabCandidates, pickLessonVocab } from "@/lib/lesson-materials/lesson-vocab-pick";

export type LessonPackVocabItem = {
  word: string;
  meaning: string; // e.g. "a. 생산적인"
  synonyms: string[];
  antonyms: string[];
};

export type LessonPackData = {
  headerLabel: string;
  vocab: LessonPackVocabItem[];
  updatedAt?: string;
  /** Ranked blank-fill candidates for workbook reuse (no OpenAI on cache hit) */
  blankCandidatePool?: StoredBlankCandidatePool | null;
  passageSourceHash?: string;
  /** Per-sentence translation metadata (source / hash); korean lives on items */
  sentenceTranslations?: StoredSentenceTranslation[];
  /** Semantic chunks for word-order writing (cache hit → 0 OpenAI) */
  wordOrderChunkCache?: StoredWordOrderChunkCache | null;
  /** Grammar-choice candidates (legacy v3/v4 — unused by v5 pipeline) */
  grammarChoiceCache?: import("@/lib/lesson-materials/grammar-choice-cache").StoredGrammarChoiceCache | null;
  /** Internal GrammarBlueprint (preserved; not used as direct choice source) */
  grammarBlueprintCache?: import("@/lib/lesson-materials/grammar-blueprint-cache").StoredGrammarBlueprintCache | null;
  /** Final reviewed grammar-choice items (v5) */
  grammarChoiceV5Cache?: import("@/lib/lesson-materials/grammar-choice-v5-cache").StoredGrammarChoiceV5Cache | null;
  /** Grammar Choice V2 cache. Never copy V1 items into this field. */
  grammarChoiceV2Cache?: import("@/lib/lesson-materials/grammar-choice-v2/cache").StoredGrammarChoiceV2Cache | null;
  /** 어휘 선택·어휘 수정 재료(검수 통과한 [원래 낱말 / 틀린 낱말] 쌍) */
  vocabChoiceCache?: import("@/lib/lesson-materials/vocab-choice").StoredVocabChoiceCache | null;
  /** 1장 요약직보자료·1장 테스트 재료(주제·요약문·도식화·동반의어·어법 포인트·바꿔 쓰기·T/F·주요문장) */
  onePageContent?: import("@/lib/lesson-materials/one-page").OnePageContent | null;
  /**
   * 워크북 유형(요약문·도식화·지칭·함축·바꿔 말하기)만 쓰는 가벼운 1장 재료 — 어법·낱말이 비어 있다.
   * 1장 자료가 이것을 쓰면 안 되므로 onePageContent와 따로 둔다(2026-10-28).
   */
  workbookLiteContent?: import("@/lib/lesson-materials/one-page").OnePageContent | null;
  /** 테스트 교재 재료(단어 정리·중요문장·어순 덩어리) */
  testBookMaterial?: import("@/lib/lesson-materials/test-book").TestBookMaterial | null;
  /** 끊어 읽기(직독직해) 덩어리만 따로 만든 것 — 테스트 교재 재료 없이 워크북 해석 적기를 끊어 읽기로 바꿀 때 */
  chunkGlossCache?: { sourceHash: string; chunkGloss: Array<Array<{ en: string; ko: string }> | null>; createdAt: string } | null;
  /**
   * 반의어가 적은 단어장을 한 번 다시 만들었거나 선생님이 저장했다. 그 뒤로는 반의어가
   * 적어도 열 때마다 다시 만들지 않는다(예전에는 열 때마다 다시 만들어 고친 내용을 덮었다).
   */
  vocabAntonymChecked?: boolean;
  /** 교사용 수업 화면 해설(teacher-notes.ts, 2026-11-10) */
  teacherNotes?: import("@/lib/lesson-materials/teacher-notes").TeacherNotes | null;
};

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((s) => String(s ?? "").trim()).filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/[,/|；;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseVocabRows(raw: unknown[]): LessonPackVocabItem[] {
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const word = String(r.word ?? "").trim();
      const meaning = String(r.meaning ?? "").trim();
      const synonyms = toList(r.synonyms ?? r.synonym);
      const antonyms = toList(
        r.antonyms ?? r.antonym ?? r.opposites ?? r.opposite
      );
      return { word, meaning, synonyms, antonyms };
    })
    .filter((v) => v.word && v.meaning);
}

/** True when vocab exists but antonyms look like the old empty-AI output. */
export function vocabNeedsAntonymRefresh(vocab: LessonPackVocabItem[]): boolean {
  if (!vocab.length) return true;
  const withAnt = vocab.filter((v) => v.antonyms.length > 0).length;
  const withSyn = vocab.filter((v) => v.synonyms.length > 0).length;
  // Synonyms filled but antonyms almost empty → regenerate
  if (withSyn >= 3 && withAnt < Math.max(2, Math.ceil(vocab.length * 0.4))) {
    return true;
  }
  return false;
}

const SYSTEM = `너는 한국 중·고등 영어 지문에서 수업용 어휘를 정리하는 편집자다.
반드시 JSON만 반환:
{
  "vocab": [
    {
      "word": "fallacy",
      "meaning": "n. 오류, 잘못된 생각",
      "synonyms": ["falsehood", "illusion"],
      "antonyms": ["truth", "fact"]
    }
  ]
}

규칙:
- vocab는 「단어 목록」에 적힌 단어를 빠짐없이, 적힌 차례 그대로. 목록에 없는 단어를 보태거나 목록의 단어를 빼지 않는다.
- word는 목록에 적힌 기본형(lemma) 그대로 쓴다.
- meaning은 품사 약어(a./n./v./ad. 등) + 한국어 뜻(쉽고 짧게).
- synonyms는 각 단어마다 1~3개.
- antonyms는 각 단어마다 1~3개. 대립 개념이 분명하면 반드시 넣는다.
  예: assert↔deny, advance↔retreat, assume↔know, expect↔doubt.
- 반의어가 정말 없을 때만 []. 전체 중 최대 1~2개만 빈 배열 허용.
- synonyms / antonyms 키는 반드시 문자열 배열.`;

const ANTONYM_FILL_SYSTEM = `너는 영어 어휘 반의어를 채우는 편집자다.
입력 vocab에서 antonyms가 비어 있는 항목만 채워 JSON으로 반환:
{ "vocab": [ { "word": "...", "antonyms": ["..."] } ] }
규칙:
- 입력에 있는 word만 다룰 것.
- antonyms는 1~3개 영어 단어.
- 거의 모든 단어에 반의어를 넣을 것. 불가능하면만 [].`;

async function openAiJson(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal
): Promise<unknown> {
  const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`어휘 생성 실패 (HTTP ${res.status})`);
  const envelope = parseJsonSafe<{
    choices?: { message?: { content?: string } }[];
  }>(bodyText);
  const content = envelope?.choices?.[0]?.message?.content ?? bodyText;
  return parseJsonSafe(content);
}

async function fillEmptyAntonyms(
  apiKey: string,
  vocab: LessonPackVocabItem[],
  signal: AbortSignal
): Promise<LessonPackVocabItem[]> {
  const empty = vocab.filter((v) => v.antonyms.length === 0);
  if (empty.length === 0) return vocab;

  const parsed = (await openAiJson(
    apiKey,
    ANTONYM_FILL_SYSTEM,
    `다음 단어들의 반의어를 채워라:\n${JSON.stringify(
      empty.map((v) => ({ word: v.word, meaning: v.meaning }))
    )}`,
    signal
  )) as { vocab?: unknown } | null;

  const filled = Array.isArray(parsed?.vocab) ? parsed!.vocab : [];
  const byWord = new Map<string, string[]>();
  for (const row of filled) {
    const r = row as Record<string, unknown>;
    const word = String(r.word ?? "")
      .trim()
      .toLowerCase();
    if (!word) continue;
    byWord.set(word, toList(r.antonyms ?? r.antonym));
  }

  return vocab.map((v) => {
    if (v.antonyms.length > 0) return v;
    const extra = byWord.get(v.word.toLowerCase()) ?? [];
    return extra.length ? { ...v, antonyms: extra } : v;
  });
}

/** 영어 낱말 목록(약 27만) — 우리 단어장 밖 낱말이 진짜 영어인지 본다 */
let dictionary: Set<string> | null = null;
async function englishWords(): Promise<Set<string>> {
  if (!dictionary) {
    const mod = (await import("an-array-of-english-words/index.json")) as unknown as { default: string[] };
    dictionary = new Set(mod.default);
  }
  return dictionary;
}

export async function generateLessonPackVocab(input: {
  englishPassage: string;
  koreanPassage?: string;
  title?: string;
}): Promise<LessonPackVocabItem[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");

  const passage = input.englishPassage.trim().slice(0, 6000);
  if (passage.length < 20) throw new Error("지문이 너무 짧습니다.");

  /*
   * 어느 낱말을 실을지는 코드가 고른다(선생님 2026-10-25: 중학고난도 이상은 모두, 지문당 12~16개).
   * 모델은 뜻·동의어·반의어만 붙인다. 고르는 규칙은 lesson-vocab-pick.ts.
   */
  const picked = pickLessonVocab(
    collectLessonVocabCandidates(
      passage.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      await englishWords()
    )
  );
  const wanted = picked.map((c) => c.word);
  const wantedSet = new Set(wanted);
  const listBlock = picked.map((c) => `- ${c.word} (지문: ${c.surface})`).join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const user = `제목: ${input.title ?? "(없음)"}\n\nEN:\n${passage}\n\nKR:\n${
      (input.koreanPassage ?? "").trim() || "(없음)"
    }\n\n단어 목록(${wanted.length}개, 이 차례 그대로):\n${listBlock}\n\n위 지문에서 쓰인 뜻으로 목록의 단어마다 meaning·synonyms·antonyms를 채워라. 목록을 바꾸지 말고 반의어 빈 칸이 있으면 안 된다.`;

    let vocab: LessonPackVocabItem[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = (await openAiJson(
        apiKey,
        SYSTEM,
        attempt === 0
          ? user
          : `${user}\n\n이전 결과가 목록과 다르거나 반의어가 너무 비어 있었다. 목록의 단어를 모두 쓰고 각 단어 antonyms를 반드시 1개 이상 넣어라.`,
        controller.signal
      )) as { vocab?: unknown } | null;
      const raw = Array.isArray(parsed?.vocab) ? parsed!.vocab : [];
      // 목록에 있는 낱말만, 목록 차례로(모델이 보탠 것은 버리고 빠뜨린 것은 다음 시도에서 받는다)
      const byWord = new Map(parseVocabRows(raw).map((v) => [v.word.toLowerCase(), v] as const));
      vocab = wanted.flatMap((w) => {
        const v = byWord.get(w);
        return v && wantedSet.has(w) ? [{ ...v, word: w }] : [];
      });
      if (vocab.length < Math.min(3, wanted.length)) continue;
      const withAnt = vocab.filter((v) => v.antonyms.length > 0).length;
      if (vocab.length >= Math.ceil(wanted.length * 0.8) && withAnt >= Math.ceil(vocab.length * 0.6)) break;
    }

    if (vocab.length < 3) {
      throw new Error("어휘를 충분히 만들지 못했습니다. 다시 시도해 주세요.");
    }

    vocab = vocab.slice(0, 16);
    if (vocabNeedsAntonymRefresh(vocab)) {
      vocab = await fillEmptyAntonyms(apiKey, vocab, controller.signal);
    }
    return vocab;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("어휘 생성 시간이 초과되었습니다.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fisher–Yates shuffle (non-mutating). */
export function shuffleArray<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Build mixed choices for synonym/antonym tests (order randomized).
 * Always keeps every `primary` answer in the list; fills the rest with distractors.
 */
export function buildChoiceList(
  primary: string[],
  secondary: string[],
  extra: string[] = [],
  maxChoices = 6
): string[] {
  const clean = (w: string) => w.trim();
  const answers: string[] = [];
  const answerLower = new Set<string>();
  for (const w of primary) {
    const t = clean(w);
    if (!t) continue;
    const low = t.toLowerCase();
    if (answerLower.has(low)) continue;
    answerLower.add(low);
    answers.push(t);
  }

  const distractors: string[] = [];
  const seen = new Set(answerLower);
  for (const w of [...secondary, ...extra]) {
    const t = clean(w);
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    distractors.push(t);
  }

  if (answers.length === 0) {
    return shuffleArray(distractors).slice(0, maxChoices);
  }

  if (answers.length >= maxChoices) {
    return shuffleArray(answers).slice(0, maxChoices);
  }

  const filler = shuffleArray(distractors).slice(0, maxChoices - answers.length);
  return shuffleArray([...answers, ...filler]);
}
