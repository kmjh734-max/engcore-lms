import { normalizeTestBookOptions, type TestBookOptions } from "@/lib/lesson-materials/test-book";
import { BOOK_COVER_PALETTES, normalizeCoverOverrides, type BookCoverSpec, type BookCoverStyle } from "@/lib/lesson-materials/book-cover";

/**
 * 최종통합자료: 수업용 자료·분석서·변형문제·워크북을 앞표지·목차·간지·뒤표지와 함께 한 파일로
 * 묶는다. 자료함 파일(lesson_material_documents, kind = integrated)의 payload에 구성을 둔다.
 */

export type IntegratedSectionKind = "lesson_pack" | "analysis_report" | "questions" | "workbook";

export const INTEGRATED_SECTION_ORDER: IntegratedSectionKind[] = [
  "lesson_pack",
  "analysis_report",
  "questions",
  "workbook",
];

export const INTEGRATED_SECTION_META: Record<
  IntegratedSectionKind,
  { title: string; en: string; sub: string; icon: string }
> = {
  lesson_pack: { title: "수업용 자료", en: "MATERIAL FOR CLASS", sub: "수업용 자료", icon: "✦" },
  analysis_report: { title: "분석서", en: "ANALYSIS & SUMMARY", sub: "지문 분석서", icon: "📄" },
  questions: { title: "변형문제", en: "PRACTICE QUESTIONS", sub: "예상 및 변형 문제", icon: "✒" },
  workbook: { title: "워크북", en: "WORKBOOK", sub: "워크북 학습 자료", icon: "📘" },
};

/*
 * 테스트 교재에서 옮긴 묶음(선생님 2026-10-21 — 테스트 교재를 최종통합자료로 합침). 고른 파일이 아니라
 * 고른 파일들의 지문으로 만든다. 켜야 들어간다(옛 통합자료는 그대로).
 */
export type IntegratedExtraKind = "plan" | "vocab" | "word_note" | "blank_note" | "tests" | "tb_answers";
/*
 * 고를 수 있는 묶음. 전체 단어장·단어 정리·문장별 해석은 수업용 자료가 테스트 교재 모양이 되며(2026-10-21)
 * 수업용 자료 안에 들어가 여기서는 뺐다(두 번 들어가지 않게). 테스트지 자료·정답은 자료함 「테스트지 뽑기」로(선생님 2026-10-21).
 */
// 전체 단어장을 다시 고를 수 있게(선생님 2026-11-11 「최종통합자료에도 단어장」) — 새 수업용 자료는 단어를 싣지 않는다
export const INTEGRATED_EXTRA_KINDS: IntegratedExtraKind[] = ["plan", "vocab", "blank_note"];
/** 목차·본문 순서에 놓이는 묶음(파일 묶음 + 테스트 교재 묶음) */
export type IntegratedPartKind = IntegratedSectionKind | IntegratedExtraKind;

export const INTEGRATED_EXTRA_META: Record<IntegratedExtraKind, { title: string; en: string; sub: string }> = {
  plan: { title: "학습 계획표 · 이수표", en: "STUDY PLAN", sub: "앞표지 바로 뒤" },
  vocab: { title: "전체 단어장", en: "VOCABULARY", sub: "지문 단어 · 파생어 · 동반의어" },
  word_note: { title: "단어 정리 · 문장별 해석", en: "WORDS & READING", sub: "지문마다 단어 정리 · 문장별 해석" },
  blank_note: { title: "백지노트", en: "BLANK NOTE", sub: "지문마다 백지 복습" },
  tests: { title: "테스트지 자료", en: "TEST", sub: "단어 시험 · 동반의어·품사 TEST · 유형별 테스트" },
  tb_answers: { title: "테스트지 정답", en: "ANSWER KEY", sub: "테스트지 자료 정답" },
};

/** 테스트지 자료 설정(테스트 교재와 같은 뜻) */
export type IntegratedTestOptions = Pick<
  TestBookOptions,
  "types" | "translation" | "writing" | "lineMode" | "level" | "wordTest" | "allWordTest" | "vocabExam"
>;

export function normalizeIntegratedTestOptions(raw: unknown): IntegratedTestOptions {
  const o = normalizeTestBookOptions(raw);
  return {
    types: o.types,
    translation: o.translation,
    writing: o.writing,
    lineMode: o.lineMode,
    level: o.level,
    wordTest: o.wordTest,
    allWordTest: o.allWordTest,
    vocabExam: o.vocabExam,
  };
}

export function integratedPartMeta(k: IntegratedPartKind): { title: string; en: string; sub: string } {
  return (INTEGRATED_EXTRA_KINDS as string[]).includes(k)
    ? INTEGRATED_EXTRA_META[k as IntegratedExtraKind]
    : INTEGRATED_SECTION_META[k as IntegratedSectionKind];
}

/**
 * 「테스트 교재 구성」: 표지 → 계획표 → 목차 → 단어장 → 수업용 자료 → 단어 정리·문장별 해석 → 백지노트 →
 * 분석서 → 워크북 → 테스트지 자료 → 변형문제 → 테스트지 정답 (계획표는 순서와 상관없이 표지 뒤)
 */
export const TEST_BOOK_PART_ORDER: IntegratedPartKind[] = [
  "plan",
  "vocab",
  "lesson_pack",
  "word_note",
  "blank_note",
  "analysis_report",
  "workbook",
  "tests",
  "questions",
  "tb_answers",
];

/** 계획표·단어장·백지노트 쪽 모양(테스트 교재 내지 디자인과 같다) */
export type IntegratedTheme = "a" | "b" | "c" | "d";

export type IntegratedCover = {
  /** 표지 프리셋 id(COVER_PRESETS) */
  presetId: string;
  /** 표지 상단 라벨 / 부제 (예: 호원고 기말고사) */
  label: string;
  /** 표지 메인 제목 (줄바꿈 가능) */
  title: string;
  /** 진도 표기 (줄바꿈으로 여러 줄) */
  progress: string;
  /** 표지 강사 / 학원명 */
  academy: string;
  /** 테스트 교재 표지(색 번짐)의 큰 글자(줄바꿈 가능). 비우면 「read. / test. / note.」 */
  headline?: string;
  /** 내신 표지(layout "exam")에서 선생님이 고친 칸. 고치지 않은 칸은 위 칸들에서 읽는다(legacyCoverSpec) */
  exam?: Partial<BookCoverSpec>;
};

export type IntegratedPayload = {
  /** 구성 순서(목차·본문 순서) */
  order: IntegratedSectionKind[];
  /** 유형별로 고른 파일 id(변형문제는 작업 id) */
  selections: Record<IntegratedSectionKind, string[]>;
  cover: IntegratedCover;
  /** 자료 사이 간지를 넣는다 */
  dividers: boolean;
  /** 변형문제 정답을 맨 뒤 "정답" 부분에 모은다 */
  answerKey: boolean;
  /** 테스트 교재 묶음까지 넣은 목차·본문 순서(order는 파일 묶음만 — 만들기 창이 쓴다) */
  parts: IntegratedPartKind[];
  /** 켠 테스트 교재 묶음 */
  extras: Record<IntegratedExtraKind, boolean>;
  /** 계획표·단어장·백지노트 내지 디자인 */
  theme: IntegratedTheme;
  /** 테스트지 자료 설정 */
  tests: IntegratedTestOptions;
  /** 단어학습에 등록한 단어장(다시 누르면 같은 단어장을 고친다) */
  vocabSetId?: string | null;
  /** 전체 단어장을 선생님이 직접 켜고 끈 적이 있는지(없으면 기본 켬) */
  vocabPicked?: boolean;
};

/** 파일 묶음 순서에 테스트 교재 묶음을 끼운다: 계획표 맨 앞, 단어장은 수업용 자료 앞, 백지노트는 뒤. */
function partsFromOrder(order: IntegratedSectionKind[]): IntegratedPartKind[] {
  const out: IntegratedPartKind[] = ["plan"];
  for (const k of order) {
    if (k === "lesson_pack") out.push("vocab", k, "word_note", "blank_note");
    else out.push(k);
  }
  out.push("tests", "tb_answers");
  return out;
}

export const DEFAULT_INTEGRATED_COVER: IntegratedCover = {
  presetId: "exam-black",
  label: "",
  title: "",
  progress: "",
  academy: "",
};

export function emptyIntegratedPayload(title = ""): IntegratedPayload {
  return {
    order: [...INTEGRATED_SECTION_ORDER],
    selections: { lesson_pack: [], analysis_report: [], questions: [], workbook: [] },
    cover: { ...DEFAULT_INTEGRATED_COVER, title },
    dividers: true,
    answerKey: true,
    parts: partsFromOrder(INTEGRATED_SECTION_ORDER),
    extras: { plan: false, vocab: true, word_note: false, blank_note: false, tests: false, tb_answers: false },
    theme: "b",
    tests: normalizeIntegratedTestOptions(null),
  };
}

/** 저장된 payload가 옛 형식이거나 일부가 빠져도 쓸 수 있게 채운다. */
export function normalizeIntegratedPayload(raw: unknown): IntegratedPayload {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<IntegratedPayload>;
  const order = (Array.isArray(p.order) ? p.order : []).filter((k): k is IntegratedSectionKind =>
    (INTEGRATED_SECTION_ORDER as string[]).includes(k)
  );
  for (const k of INTEGRATED_SECTION_ORDER) if (!order.includes(k)) order.push(k);
  const sel = (p.selections ?? {}) as Partial<Record<IntegratedSectionKind, unknown>>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    order,
    selections: {
      lesson_pack: list(sel.lesson_pack),
      analysis_report: list(sel.analysis_report),
      questions: list(sel.questions),
      workbook: list(sel.workbook),
    },
    cover: (() => {
      // 예전에 만든 자료는 표지 id가 저장돼 있어 그대로 열린다. id가 없을 때만 새 기본(내신 · 검정).
      const c = { ...DEFAULT_INTEGRATED_COVER, ...(p.cover ?? {}) };
      return { ...c, exam: normalizeCoverOverrides(c.exam) };
    })(),
    dividers: p.dividers !== false,
    answerKey: p.answerKey !== false,
    parts: (() => {
      const all: IntegratedPartKind[] = [...INTEGRATED_SECTION_ORDER, ...INTEGRATED_EXTRA_KINDS];
      const saved = (Array.isArray(p.parts) ? p.parts : []).filter((k): k is IntegratedPartKind =>
        (all as string[]).includes(k)
      );
      if (saved.length === 0) return partsFromOrder(order);
      // 나중에 생긴 묶음: 단어 정리는 수업용 자료 뒤, 나머지는 끝에
      for (const k of all) {
        if (saved.includes(k)) continue;
        const at = k === "word_note" || k === "vocab" ? saved.indexOf("lesson_pack") : -1;
        // 전체 단어장은 수업용 자료 앞, 단어 정리는 뒤
        if (at >= 0) saved.splice(k === "vocab" ? at : at + 1, 0, k);
        else if (k === "vocab") saved.splice(Math.min(1, saved.length), 0, k);
        else saved.push(k);
      }
      return [...new Set(saved)];
    })(),
    extras: {
      plan: p.extras?.plan === true,
      // 전체 단어장은 기본으로 켠다 — 예전 파일은 vocab:false로 저장돼 있어(그때는 고를 수 없었다) vocabPicked가 있을 때만 저장값을 따른다
      vocab: (p as { vocabPicked?: boolean }).vocabPicked === true ? p.extras?.vocab === true : true,
      word_note: p.extras?.word_note === true,
      blank_note: p.extras?.blank_note === true,
      tests: p.extras?.tests === true,
      tb_answers: p.extras?.tb_answers === true,
    },
    tests: normalizeIntegratedTestOptions(p.tests ?? null),
    vocabSetId: typeof p.vocabSetId === "string" ? p.vocabSetId : null,
    ...((p as { vocabPicked?: boolean }).vocabPicked === true ? { vocabPicked: true } : {}),
    theme: (["a", "b", "c", "d"] as const).includes(p.theme as IntegratedTheme) ? (p.theme as IntegratedTheme) : "b",
  };
}


/** 표지 배치: 내신 표지 하나(book-cover.ts · BookCover.tsx). 판(coverStyle)과 배색(paletteId)만 다르다. */
export type CoverLayout = "exam";

export type CoverPreset = {
  id: string;
  name: string;
  /** 고르는 창에 쓰는 한 줄 설명 */
  description: string;
  layout: CoverLayout;
  /** 앞표지 배경 */
  background: string;
  /** 제목 색 */
  ink: string;
  /** 보조 글자 색 */
  muted: string;
  /** 선·장식 색 */
  rule: string;
  /** 목차 번호·간지 글자처럼 흰 종이 위에 쓰는 강조색(흰 바탕에서 읽히는 진한 색) */
  accent: string;
  /** 간지 왼쪽 띠 */
  strip: string;
  /** 뒤표지 배경·글자 */
  backBackground: string;
  backInk: string;
  backMuted: string;
  /** layout "exam"의 배색 id(BOOK_COVER_PALETTES[coverStyle]) */
  paletteId?: string;
  /** layout "exam"의 판(C 프리미엄 · D 큰 숫자 · E 분할 · F 밝은 판). 없으면 프리미엄 */
  coverStyle?: BookCoverStyle;
};

/**
 * 내신 표지(선생님 2026-10-21 승인 — 학교 시험 대비 교재 표지). 판 넷 × 배색:
 *   C 프리미엄(exam-<배색>) · D 큰 숫자(exam-numeral-<배색>) · E 분할(exam-split-<배색>) · F 밝은 판(exam-light-<배색>)
 *   · 미니멀(exam-minimal-<배색>) · 마스터(exam-master-<배색>) · 스트립(exam-strip-<배색>) — 2026-10-22 추가
 * 앞표지는 BookCover가 그리고, 여기 색은 목차 · 간지 · 뒤표지가 쓴다. accent는 흰 종이 위 목차 번호라
 * 짙은 바탕 배색은 짙은 색을 따로 둔다.
 */
const EXAM_BACK: Record<string, { muted: string; rule: string; accent: string }> = {
  black: { muted: "#9a9aa2", rule: "#4fd1c5", accent: "#0f7f75" },
  navy: { muted: "#9aa7c0", rule: "#7fd3ff", accent: "#1f4f9a" },
  forest: { muted: "#93aca1", rule: "#e8d29a", accent: "#1d5a45" },
  wine: { muted: "#c19aa2", rule: "#f2c48d", accent: "#7a1f33" },
  charcoal: { muted: "#8b8d92", rule: "#d9b56c", accent: "#7a5a1e" },
  cocoa: { muted: "#bba39d", rule: "#f2a48d", accent: "#8a3a26" },
  ink: { muted: "#9a9ca4", rule: "#ffb26b", accent: "#8a4a12" },
};

const EXAM_STYLE_NAMES: Partial<Record<BookCoverStyle, { name: string; description: string }>> = {
  premium: { name: "내신", description: "학교 · 학년 · 시험 영문 · 교과서 정보 띠" },
  numeral: { name: "내신 큰 숫자", description: "학년 숫자가 그림 · 시험 영문은 작게" },
  split: { name: "내신 분할", description: "위 짙은 바탕 · 아래 흰 칸에 정보 띠" },
  light: { name: "내신 밝은 판", description: "흰 종이 · 토너가 덜 든다" },
  minimal: { name: "내신 미니멀", description: "가는 글자만 · 넓게 띄운 시험 영문" },
  master: { name: "내신 마스터", description: "세로 두 줄 영문 · 거대한 두 색 한글" },
  strip: { name: "내신 스트립", description: "학년색 세로 띠 · 외곽선 그림자 영문" },
};

const EXAM_COVER_PRESETS: CoverPreset[] = (["premium", "numeral", "split", "light", "minimal", "master", "strip"] as const).flatMap((style) =>
  BOOK_COVER_PALETTES[style].map((pal): CoverPreset => {
    const back = EXAM_BACK[pal.id];
    const dark = Boolean(back);
    return {
      id: style === "premium" ? `exam-${pal.id}` : `exam-${style}-${pal.id}`,
      name: `${EXAM_STYLE_NAMES[style]!.name} · ${pal.name}`,
      description: EXAM_STYLE_NAMES[style]!.description,
      layout: "exam",
      background: pal.bg,
      ink: pal.ink,
      muted: back?.muted ?? pal.muted,
      rule: back?.rule ?? pal.steps[0]!,
      accent: back?.accent ?? pal.steps[1]!,
      strip: dark ? pal.bg : pal.steps[1]!,
      backBackground: pal.bg,
      backInk: pal.ink,
      backMuted: back?.muted ?? pal.muted,
      paletteId: pal.id,
      coverStyle: style,
    };
  })
);

/**
 * 표지 = 내신 표지뿐(선생님 2026-10-22: 새로 만든 것 말고 다른 표지는 다 지워). 여기 색은 앞표지뿐 아니라
 * 목차 · 간지 · 뒤표지가 함께 쓴다. 모두 인쇄에서 배경색까지 그대로 찍힌다.
 */
export const COVER_PRESETS: CoverPreset[] = EXAM_COVER_PRESETS;

/** 저장된 표지 id가 없거나 지운 예전 표지(색면 폭발 · 색 번짐 등)면 첫 표지(내신 · 검정)를 쓴다. */
export function coverPreset(id: string | undefined | null): CoverPreset {
  const key = (id ?? "").trim();
  return COVER_PRESETS.find((p) => p.id === key) ?? COVER_PRESETS[0]!;
}
