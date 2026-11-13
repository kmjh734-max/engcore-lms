import { normalizeVocabExam, type VocabExam, type VocabExamOptions } from "@/lib/lesson-materials/test-book";

/**
 * 수업용 자료 「단어 시험지」를 인쇄·PDF로 뽑은 그대로(파일 payload.vocabExamSaved).
 * 선생님 2026-11-02: 「한번 만들면 고정해야지 계속 바뀌면 문제가 되잖아」 — 인쇄해 나눠 준 시험지와
 * 나중에 다시 연 화면(정답지)이 달라 채점이 어려웠다. 다시 열면 이것을 그대로 보여 준다.
 */
export type SavedVocabExam = {
  exam: VocabExam;
  counts: VocabExamOptions;
  inOrder: boolean;
  rangeFrom: number;
  rangeTo: number;
  /** 지문을 여러 개 골라 뽑았으면 그 지문 번호들(2026-11-13) */
  passages?: number[];
  round: number;
  title: string;
  answers: boolean;
  wordList: boolean;
  savedAt?: string;
};

/**
 * 영→한·한→영 단어 안 겹치게(17c135ee)를 배포한 때. 그 전에 만든 파일은 예전 방식으로 뽑아야
 * 그때 인쇄한 시험지와 같은 단어가 나온다.
 */
const EXCLUSIVE_PICK_FROM = "2026-11-02T09:52:00Z";

type DocRow = { created_at?: unknown; payload?: unknown } | null | undefined;

export function lessonPackSavedExam(doc: DocRow): SavedVocabExam | null {
  const raw = (doc?.payload as { vocabExamSaved?: unknown } | null | undefined)?.vocabExamSaved as Partial<SavedVocabExam> | undefined;
  if (!raw || !raw.exam || !Array.isArray(raw.exam.sections) || typeof raw.exam.total !== "number") return null;
  return {
    exam: raw.exam,
    counts: normalizeVocabExam(raw.counts),
    inOrder: raw.inOrder === true,
    rangeFrom: Number(raw.rangeFrom) || 0,
    rangeTo: Number(raw.rangeTo) || 0,
    passages: Array.isArray(raw.passages) ? raw.passages.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
    round: Number(raw.round) || 0,
    title: typeof raw.title === "string" ? raw.title : "",
    answers: raw.answers !== false,
    wordList: raw.wordList === true,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : undefined,
  };
}

/** 저장된 시험지가 없는 옛 파일: 예전 뽑기(영→한·한→영 겹침 허용)로 그때와 같은 단어를 낸다 */
export function lessonPackLegacyPick(doc: DocRow): boolean {
  const at = typeof doc?.created_at === "string" ? doc.created_at : "";
  return !!at && new Date(at).getTime() < new Date(EXCLUSIVE_PICK_FROM).getTime();
}
