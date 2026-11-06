/**
 * 교재 표지 디자인 시스템.
 *
 * 국내 학습서 표지(교보문고 영어 문제집·독해·수능 116권, 내신 기출·평가문제집 163권)가 쓰는 문법을 따른다.
 * 짙은 바탕에 굵은 「학교 학년」, 크게 기울인 시험 영문(Final · Midterm), 아래에 기출문제집처럼
 * 「교과서 · 출판사 | 큰 학년 숫자 + 학기 · 시험 | 범위」 정보 띠. 배색만 고른다.
 *
 * 같은 시리즈는 스타일·배색이 같고, 학년마다 강조색만 배색이 정한 단계로 바뀐다(100발100중·
 * 내신콘서트처럼 권마다 출판사·학년·학기·시험 덩어리만 갈아 끼운다).
 * 크기는 모두 A4(210mm) 기준 mm로 적고, 다른 판형은 폭 비율(--s)로 줄인다.
 */

/**
 * 프리미엄(승인 · 앱에 붙음)과 같은 내신 정보 · 위계를 쓰는 판 셋(시안): 큰 학년 숫자 · 위아래 분할 · 밝은 판.
 * 선생님 2026-10-21: 타이포그래피 · 그래픽 안은 뺌. 2026-10-22: 아예 다른 스타일도(팝 · 화이트 에디토리얼 · 레터 그리드는
 * 「다 별로」로 뺌) — 상위권 교재 계열로 다시: 미니멀(헤더진 Final) · 마스터(READING MASTER) · 스트립(2017 FINAL).
 * 라벨(blacklabel)은 「L 빼고는 다 괜찮아」로 뺌.
 */
export type BookCoverStyle = "premium" | "numeral" | "split" | "light" | "minimal" | "master" | "strip";

/** 판형. B5는 국내 교재에서 B5라 부르는 4×6배판(188×257mm)이다. */
export type BookCoverPaper = "A4" | "B5";

export const BOOK_COVER_PAPERS: Record<BookCoverPaper, { name: string; widthMm: number; heightMm: number }> = {
  A4: { name: "A4 (210×297)", widthMm: 210, heightMm: 297 },
  B5: { name: "B5 (188×257)", widthMm: 188, heightMm: 257 },
};

/**
 * 표지에 들어가는 내용 — 학교 시험 대비 교재 기준. 비운 칸은 그 자리를 접는다.
 * 제목(학교 + 학년)과 큰 영문 낱말(시험)은 이 칸들에서 만든다.
 */
export type BookCoverSpec = {
  /** 시리즈 이름 (예: EngCore 내신) — 같은 이름이면 같은 판을 쓴다 */
  series: string;
  /** 학교 (예: 호원고) */
  school: string;
  /** 학년 (예: 1, 고1, 중2) — 숫자로 읽히면 큰 숫자로 쓰고 학년마다 강조색이 바뀐다 */
  grade: string;
  /** 연도 (예: 2026) */
  year: string;
  /** 학기 (예: 2학기) */
  semester: string;
  /** 시험 (예: 기말고사, 중간고사, 3월 모의고사) */
  exam: string;
  /** 자료 종류 (예: 통합 테스트북, 변형문제) */
  material: string;
  /** 교과서 (예: 영어독해와작문, 공통영어1) */
  textbook: string;
  /** 출판사·저자 (예: 천재(윤), 동아 | 윤정미) */
  publisher: string;
  /** 시험 범위 (예: 2과~4과 · 외부지문) */
  range: string;
  /** 특장점 (줄마다 한 항목) */
  points: string;
  /** 큰 영문 낱말을 직접 정할 때 (비우면 시험에서 정한다: 기말 → Final) */
  wordmark: string;
  /** 출판 브랜드 (학원명) */
  brand: string;
};

export const EMPTY_BOOK_COVER_SPEC: BookCoverSpec = {
  series: "",
  school: "",
  grade: "",
  year: "",
  semester: "",
  exam: "",
  material: "",
  textbook: "",
  publisher: "",
  range: "",
  points: "",
  wordmark: "",
  brand: "",
};

/** 학년 숫자(1·2·3). 못 읽으면 null. */
export function gradeNumber(grade: string): number | null {
  const m = grade.match(/\d+/);
  return m ? Math.max(1, Number(m[0])) : null;
}

/** "1" → "1학년", "고1" → "고1", "1학년" → "1학년" */
export function gradeLabel(grade: string): string {
  const t = grade.trim();
  return /^\d+$/.test(t) ? `${t}학년` : t;
}

/** 표지 제목: 학교 + 학년 (예: 호원고 1학년). 학교가 없으면(모의고사 자료 등) 교과서 · 자료 종류. */
export function coverTitle(spec: BookCoverSpec): string {
  if (!spec.school.trim()) {
    const alt = spec.textbook.trim() || spec.material.trim();
    if (alt) return [gradeLabel(spec.grade), alt].filter(Boolean).join(" ");
  }
  return [spec.school.trim(), gradeLabel(spec.grade)].filter(Boolean).join(" ");
}

/** 시험 이름에서 영문 낱말. 직접 적은 낱말이 있으면 그것. */
export function examWord(spec: BookCoverSpec): string {
  if (spec.wordmark.trim()) return spec.wordmark.trim();
  const e = spec.exam;
  if (/기말/.test(e)) return "Final";
  if (/중간/.test(e)) return "Midterm";
  if (/모의|학력평가|학평/.test(e)) return "Mock Test";
  if (/수행/.test(e)) return "Performance";
  return "Exam";
}

/** 표지 칸에서 한 번에 고르는 시험 · 학기 */
export const BOOK_COVER_EXAMS = ["중간고사", "기말고사", "모의고사", "수행평가"] as const;
export const BOOK_COVER_SEMESTERS = ["1학기", "2학기"] as const;

/**
 * 오늘 날짜로 짐작한 다음 시험(추천 표시에만 쓴다 — 학교마다 일정이 달라 자동으로 넣지 않는다).
 * 3~4월 1학기 중간 · 5~7월 1학기 기말 · 8~10월 2학기 중간 · 11~2월 2학기 기말.
 */
export function suggestedExam(now: Date = new Date()): { semester: string; exam: string } {
  const m = now.getMonth() + 1;
  if (m >= 3 && m <= 4) return { semester: "1학기", exam: "중간고사" };
  if (m >= 5 && m <= 7) return { semester: "1학기", exam: "기말고사" };
  if (m >= 8 && m <= 10) return { semester: "2학기", exam: "중간고사" };
  return { semester: "2학기", exam: "기말고사" };
}

/** 시험 줄: 2026 2학기 기말고사 */
export function examLine(spec: BookCoverSpec): string {
  return [spec.year, spec.semester, spec.exam].map((v) => v.trim()).filter(Boolean).join(" ");
}

/** 표지 고르기 창에 띄우는 칸(순서대로). */
export const BOOK_COVER_FIELDS: { key: keyof BookCoverSpec; label: string; placeholder?: string; rows?: number }[] = [
  { key: "school", label: "학교", placeholder: "예: 호원고" },
  { key: "grade", label: "학년", placeholder: "예: 1" },
  { key: "year", label: "연도", placeholder: "예: 2026" },
  { key: "semester", label: "학기", placeholder: "예: 2학기" },
  { key: "exam", label: "시험", placeholder: "예: 기말고사 · 중간고사 · 3월 모의고사" },
  { key: "material", label: "자료 종류", placeholder: "예: 통합 테스트북 · 변형문제" },
  { key: "textbook", label: "교과서", placeholder: "예: 영어독해와작문" },
  { key: "publisher", label: "출판사 · 저자", placeholder: "예: 천재(윤)" },
  { key: "range", label: "시험 범위", placeholder: "예: 2과~4과 · 외부지문" },
  { key: "points", label: "특장점 (줄마다 한 항목)", rows: 2 },
  { key: "series", label: "시리즈 (왼쪽 위 띠)", placeholder: "예: EngCore 내신" },
  { key: "wordmark", label: "큰 영문 (비우면 시험에서: 기말 → Final)" },
];

const PUBLISHER =
  /^(?:NE)?능률|^천재|^YBM|^비상|^동아|^미래엔|^지학사?|^금성|^다락원|^교학사|^씨마스|^(?:좋은책)?신사고|^시사|^창비|^해냄|^지학/;

/** 학교 · 학년 · 연도 · 학기 · 시험을 글 하나에서 읽고, 읽은 말을 뺀 나머지(rest)도 돌려준다. */
function parseExamName(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  let rest = t;
  const take = (m: RegExpMatchArray | null, i = 1): string => {
    if (!m) return "";
    rest = rest.replace(m[0], " ");
    return m[i] ?? "";
  };
  const school = take(t.match(/([가-힣A-Za-z]+?(?:고등학교|중학교|여자고|여고|여중|고|중))(?=\s|\d|·|,|$)/));
  const afterSchool = school ? t.slice(t.indexOf(school) + school.length) : "";
  let grade = "";
  const g1 = school ? afterSchool.match(/^\s*(\d)(?!\d)\s*(?:학년)?/) : null;
  if (g1) {
    grade = g1[1]!;
    // 학교 바로 뒤의 학년(「상우고1」 · 「리얼고 1학년」) — 학교는 이미 뺐으니 처음 나오는 그 글을 뺀다
    rest = rest.replace(g1[0].trim(), " ");
  } else {
    grade = take(rest.match(/(\d)\s*학년/)) || take(rest.match(/(?:^|[^가-힣])(?:고|중)\s*([1-3])(?!\d)/));
  }
  const full = take(rest.match(/(20\d{2})\s*(?:년도?|\.)?/));
  const short = full ? "" : take(rest.match(/(?:^|\D)(\d{2})\s*년도?/));
  const year = full || (short ? `20${short}` : "");
  const sem = take(rest.match(/([12])\s*학기/));
  const examRaw = take(
    rest.match(/(\d+\s*월\s*(?:전국연합\s*)?(?:모의고사|학력평가)|중간고사|기말고사|중간|기말|모의고사|학력평가|수행평가)/)
  );
  const exam = examRaw === "중간" ? "중간고사" : examRaw === "기말" ? "기말고사" : examRaw;
  rest = rest
    .replace(/대비/g, " ")
    .replace(/[·,|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { school, grade, year, semester: sem ? `${sem}학기` : "", exam, rest };
}

/** 「영어독해와작문 천재(윤) 2과」 → 교과서 · 출판사 · 범위. 출판사 이름이 없으면 null. */
function splitBook(text: string): { textbook: string; publisher: string; range: string } | null {
  const tokens = text.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const at = tokens.findIndex((x) => PUBLISHER.test(x));
  if (at < 0) return null;
  return { textbook: tokens.slice(0, at).join(" "), publisher: tokens[at]!, range: tokens.slice(at + 1).join(" ") };
}

/**
 * 저장된 칸(자료 이름 · 예전 라벨 · 제목 · 진도 · 학원명)에서 내신 표지 칸을 읽는다.
 *   자료 이름 「리얼고 1학년 기말대비 1회차」 → 학교 · 학년 · 시험, 나머지 「1회차」는 자료 이름 칸
 *   예전 라벨 「호원고 3학년 · 26년도 1학기 중간고사 대비」 → 학교 · 학년 · 연도 · 학기 · 시험
 *   제목 · 지문 출처 「영어독해와작문 천재(윤) 2과」 → 교과서 · 출판사 · 범위 (출판사 이름을 찾아 앞뒤로 가른다)
 *   진도 → 특장점, 학원명 → 브랜드
 * 못 읽은 칸은 비워 둔다(표지가 그 자리를 접는다). 선생님이 고친 칸이 늘 이것보다 앞선다.
 */
export function legacyCoverSpec(
  input: { label: string; title: string; progress: string; academy: string },
  defaults: { material?: string; range?: string } = {}
): BookCoverSpec {
  const title = input.title.replace(/\r?\n/g, " ").trim();
  const name = parseExamName(`${input.label} ${title}`);
  const book = splitBook(title) ?? splitBook(defaults.range ?? "");
  let textbook = book?.textbook ?? "";
  let range = book?.range ?? "";
  // 제목이 출판사 없는 여러 줄(예전 표지 「교과서 / 범위」)이면 첫 줄을 교과서로
  if (!book && /\n/.test(input.title) && !name.school) {
    const rows = input.title.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    textbook = rows[0] ?? "";
    range = rows.slice(1).join(" ");
  }
  if (!book && !range && defaults.range) range = defaults.range;
  // 출판사로 가르지 못한 이름의 나머지.
  let nameRest = splitBook(title) ? "" : parseExamName(title).rest;
  // 범위처럼 생긴 나머지(「18~45번」 · 「3과」)는 범위로, 아니면(「1회차」 · 「통합 테스트북」) 자료 이름으로
  if (nameRest && !range && /\d+\s*(?:과|번|강)?\s*[~∼\-–]\s*\d+|\d+\s*과|lesson|unit/i.test(nameRest)) {
    range = nameRest;
    nameRest = "";
  }
  return {
    ...EMPTY_BOOK_COVER_SPEC,
    school: name.school,
    grade: name.grade,
    year: name.year,
    semester: name.semester,
    exam: name.exam,
    material: defaults.material || nameRest,
    textbook,
    publisher: book?.publisher ?? "",
    range,
    points: input.progress.trim(),
    brand: input.academy.trim(),
  };
}

/** 예전 칸에서 읽은 값 위에 선생님이 고친 칸을 얹는다. */
export function mergeCoverSpec(base: BookCoverSpec, overrides: Partial<BookCoverSpec> | null | undefined): BookCoverSpec {
  const out = { ...base };
  for (const f of BOOK_COVER_FIELDS) {
    const v = overrides?.[f.key];
    if (typeof v === "string") out[f.key] = v;
  }
  if (typeof overrides?.brand === "string" && overrides.brand) out.brand = overrides.brand;
  return out;
}

/** 저장된 고친 칸을 문자열만 남겨 받는다. */
export function normalizeCoverOverrides(raw: unknown): Partial<BookCoverSpec> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<BookCoverSpec> = {};
  for (const f of BOOK_COVER_FIELDS) {
    const v = o[f.key];
    if (typeof v === "string") out[f.key] = v.slice(0, 300);
  }
  return out;
}

export type BookCoverPalette = {
  id: string;
  name: string;
  /** 바탕 */
  bg: string;
  /** 주 글자 */
  ink: string;
  /** 보조 글자 */
  muted: string;
  /** 학년 1~4의 강조색(제목·큰 낱말·배지). 학년을 못 읽으면 첫 색, 넘으면 마지막 색 */
  steps: string[];
};

/**
 * 배색. 짙은 바탕 위에서 학년마다 색상 자체를 바꾼다(한 줄로 꽂아도 학년이 갈린다).
 */
const DARK_PALETTES: BookCoverPalette[] = [
  { id: "black", name: "검정", bg: "#0b0b0d", ink: "#ffffff", muted: "#9a9aa2", steps: ["#4fd1c5", "#c5e05a", "#ff6fae", "#ffb04a"] },
  { id: "navy", name: "남색", bg: "#0f1b33", ink: "#ffffff", muted: "#9aa7c0", steps: ["#7fd3ff", "#ffd166", "#ff8fa3", "#b6ee8a"] },
  { id: "forest", name: "짙은 초록", bg: "#0f2a22", ink: "#f4f1e8", muted: "#93aca1", steps: ["#e8d29a", "#9fe0c2", "#f2a3a3", "#c3b6ff"] },
  { id: "wine", name: "와인", bg: "#3a0f19", ink: "#fbf2ee", muted: "#c19aa2", steps: ["#f2c48d", "#f7a8b8", "#9fd8d0", "#e6e1a3"] },
];

export const BOOK_COVER_PALETTES: Record<BookCoverStyle, BookCoverPalette[]> = {
  premium: DARK_PALETTES,
  numeral: DARK_PALETTES,
  split: DARK_PALETTES,
  /** 흰 종이 — 학원 레이저 프린터로 많이 찍어도 토너가 덜 든다. 강조색은 흰 바탕에서 읽히는 짙은 색 */
  light: [
    { id: "white", name: "흰 종이", bg: "#ffffff", ink: "#121417", muted: "#6c7179", steps: ["#0f8a7e", "#2a55c9", "#d23f5d", "#c96d0c"] },
    { id: "grey", name: "회색 종이", bg: "#eceef1", ink: "#121417", muted: "#646a73", steps: ["#0c7b70", "#244bb3", "#bf3653", "#b4610a"] },
    { id: "mint", name: "옅은 청록", bg: "#e6f2ef", ink: "#10201c", muted: "#5d6f69", steps: ["#0b6f64", "#2347a8", "#b8334f", "#a65a09"] },
  ],
  /** 미니멀: 짙은 바탕 · 가는 글자만. 학년색은 시험 한글 두 줄과 가는 선 */
  minimal: [
    { id: "black", name: "검정", bg: "#0d0d0e", ink: "#f2f2f2", muted: "#7c7c84", steps: ["#5fd0bf", "#e9c46a", "#ff8fa3", "#9ec5ff"] },
    { id: "charcoal", name: "숯", bg: "#202225", ink: "#f4f1ea", muted: "#8b8d92", steps: ["#d9b56c", "#9fd8c6", "#e8a0a8", "#a9c3f0"] },
    { id: "navy", name: "남색", bg: "#0e1a2e", ink: "#f1f3f7", muted: "#7f8ba3", steps: ["#7fd3ff", "#f2c48d", "#ff9eb5", "#b6ee8a"] },
  ],
  /** 마스터: 짙은 갈색 · 초록 · 먹. 학년색은 세로 영문 첫 줄 · 한글 둘째 줄 */
  master: [
    { id: "cocoa", name: "코코아", bg: "#2e1714", ink: "#ffffff", muted: "#bba39d", steps: ["#f2a48d", "#f2c48d", "#e9a3c0", "#a8d5c8"] },
    { id: "forest", name: "짙은 초록", bg: "#102a22", ink: "#ffffff", muted: "#9db5aa", steps: ["#9fe0c2", "#e8d29a", "#f2a3a3", "#b7c8ff"] },
    { id: "ink", name: "먹", bg: "#14161c", ink: "#ffffff", muted: "#9a9ca4", steps: ["#ffb26b", "#7fd3ff", "#ff8fa3", "#c5e05a"] },
  ],
  /** 스트립: 짙은 바탕 · 학년색 세로 띠와 영문 */
  strip: [
    { id: "black", name: "검정", bg: "#151617", ink: "#ffffff", muted: "#8a8c90", steps: ["#c8e86b", "#7fd3ff", "#ff9eb5", "#ffc46b"] },
    { id: "navy", name: "남색", bg: "#0f1a2c", ink: "#ffffff", muted: "#8592a8", steps: ["#ffc46b", "#9fe0c2", "#ff9eb5", "#c8e86b"] },
  ],
};

export const BOOK_COVER_STYLES: { id: BookCoverStyle; name: string; description: string }[] = [
  { id: "premium", name: "C 프리미엄", description: "승인 · 앱에 붙음 — 기울인 시험 영문이 그림" },
  { id: "numeral", name: "D 큰 숫자", description: "학년 숫자가 그림 · 시험 영문은 제목 아래 작게" },
  { id: "split", name: "E 분할", description: "위 짙은 바탕 · 아래 흰 칸에 정보 띠" },
  { id: "light", name: "F 밝은 판", description: "C를 흰 종이에 — 토너가 덜 든다" },
  { id: "minimal", name: "J 미니멀", description: "가는 글자만 · 맨 위 넓게 띄운 영문 · 가운데 축" },
  { id: "master", name: "K 마스터", description: "세로로 세운 두 줄 영문 · 오른쪽 아래 거대한 두 색 한글" },
  { id: "strip", name: "M 스트립", description: "학년색 세로 띠 · 가는 큰 연도 · 외곽선 그림자 영문" },
];

/** 시리즈 하나의 판: 같은 시리즈 교재는 모두 이것을 쓴다. */
export type BookCoverSeriesDesign = {
  style: BookCoverStyle;
  paletteId: string;
  paper: BookCoverPaper;
};

export function bookCoverPalette(style: BookCoverStyle, paletteId: string | null | undefined): BookCoverPalette {
  const list = BOOK_COVER_PALETTES[style];
  return list.find((p) => p.id === paletteId) ?? list[0]!;
}

/** 학년에 맞는 강조색. 학년을 못 읽으면 첫 단계. */
export function gradeAccent(palette: BookCoverPalette, grade: string): string {
  const i = gradeNumber(grade) ?? 1;
  return palette.steps[Math.min(i, palette.steps.length) - 1]!;
}

/** 표지가 쓰는 글꼴(Google Fonts). 인쇄 전에 document.fonts.ready를 기다린다. */
export const BOOK_COVER_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100;62..125,200;62..125,500;62..125,700;62..125,800;62..125,900&family=Playfair+Display:ital,wght@1,700;1,900&display=block";
