/**
 * 문장 표시 분석(내신 지문분석지 방식)의 자료 구조와 검증.
 *
 * 선생님 요청: "지문분석지는 가능하면 이렇게 분석을 해주면 정말 좋겠다" — 문장을 크게 띄워 찍고
 * 그 위아래에 직접 표시를 넣는 방식이다. 단어 아래에는 문장성분(S·V·O·C, 종속절은 S¹·V¹),
 * 구간에는 괄호([부사절] <명사절> (삽입·생략)), 구간 위에는 짧은 한국어 문법 이름표,
 * 설명할 자리에는 동그라미 번호(①②③)와 별표, 규칙은 점선 상자로 뽑고, 아래에 해석과 번호 설명을 둔다.
 *
 * 모델은 좌표를 세지 못하므로 구간을 "원문에서 그대로 따온 글자"로 내놓게 하고, 여기서 그 글자가
 * 문장 안에 실제로 있는지 찾아 좌표로 바꾼다. 못 찾거나 이름표가 고정 어휘에 없거나 구간이 서로
 * 어긋나게 걸치면 그 항목만 버린다. 틀린 분석을 찍느니 비우는 편이 낫다.
 */
import { GRAMMAR_ONTOLOGY } from "@/lib/lesson-materials/grammar-choice-v2/grammar-ontology";
import { normalizeMarkupRoles } from "@/lib/lesson-materials/analysis-markup-roles";
import { labelFitsSpan, raiseRoleLevels } from "@/lib/lesson-materials/analysis-markup-rules";
import { fillMissingRoles } from "@/lib/lesson-materials/analysis-markup-fill";

/** 문장 안 글자 범위. start는 포함, end는 제외. */
export type MarkupSpan = { start: number; end: number };

/** 문장성분 기호. 내신 분석지에서 쓰는 것만 둔다. */
export type MarkupRoleCode = "S" | "V" | "O" | "C" | "IO" | "DO" | "M" | "A";

/** 0=주절, 1=종속절(S¹), 2=그 안의 절(S²). 분석지도 두 단계까지만 쓴다. */
export type MarkupRoleLevel = 0 | 1 | 2;

export type MarkupRoleMark = {
  span: MarkupSpan;
  role: MarkupRoleCode;
  level: MarkupRoleLevel;
  /** 선생님이 직접 고친 표시. 코드 검사(analysis-markup-roles.ts)가 손대지 않는다. */
  edited?: boolean;
};

/**
 * 구간 괄호. 분석지 관례를 그대로 따른다.
 * adverbial [ ] 부사절 · nominal < > 명사절·명사구·간접의문문 · inserted ( ) 삽입·생략
 */
export type MarkupBracketKind = "adverbial" | "nominal" | "inserted";

export type MarkupBracket = {
  span: MarkupSpan;
  kind: MarkupBracketKind;
};

/** 구간 위에 작게 얹는 한국어 이름표. label은 고정 어휘에서만 온다. */
export type MarkupSpanNote = {
  span: MarkupSpan;
  label: string;
  /** 이름표 뒤에 붙는 짧은 뜻풀이. 예: "'~해서 …한'" */
  gloss?: string;
  /** 선생님이 직접 고친 이름표 */
  edited?: boolean;
};

/** 동그라미 번호를 붙여 아래에서 설명하는 자리. */
export type MarkupNumberedPoint = {
  /** 1부터. 화면에는 ①②③으로 찍는다. */
  index: number;
  span: MarkupSpan;
  label: string;
  /** 가장 중요한 자리에는 별표를 붙인다(분석지의 ★). */
  star: boolean;
  /** 한국어 설명 2~5문장. 규칙 이름과 왜 이 형태인지. */
  explanation: string;
  /** 바꿔 쓴 형태. 예: "→ [도치 이전 문장] You should show it to ~" */
  rewrite?: string;
  /** 선생님이 직접 고친 설명 */
  edited?: boolean;
};

/** 점선 상자로 뽑아 주는 규칙(문형 전환·관용 표현 등). */
export type MarkupCallout = {
  /** 상자가 가리키는 구간. 상자 머리에 이 구간 글자를 같이 찍는다. */
  span: MarkupSpan;
  title: string;
  body: string;
  tone: "red" | "blue";
};

/** 문장 모서리 꼬리표. 고정 목록에서만 온다. */
export const MARKUP_SENTENCE_TAGS = [
  "주제문",
  "서술형 대비",
  "빈칸 추론",
  "어법 빈출",
  "함축 의미",
  "어휘 추론",
  "순서·삽입",
  "요약문",
] as const;

export type MarkupSentenceTag = (typeof MARKUP_SENTENCE_TAGS)[number];

/** 문장의 한 부분을 가리키는 꼬리표들 — 이 꼬리표를 쓰면 자리를 함께 받는다. */
export const SPAN_TAGS: readonly MarkupSentenceTag[] = [
  "빈칸 추론",
  "함축 의미",
  "어휘 추론",
  "어법 빈출",
];

export type MarkupChunk = { en: string; ko: string };

/** 조각을 이은 것이 원문과 같은지(띄어쓰기·따옴표 모양 차이는 무시). 다르면 null. */
export function verifiedChunks(text: string, raw: unknown): MarkupChunk[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const chunks: MarkupChunk[] = [];
  for (const r of raw) {
    const row = r as Record<string, unknown>;
    const en = String(row?.en ?? "").replace(/\s+/g, " ").trim();
    const ko = String(row?.ko ?? "").replace(/\s+/g, " ").trim();
    if (!en) continue;
    // 뜻이 빈 조각이 하나라도 있으면 직독직해를 싣지 않는다(빈칸으로 찍히던 것)
    if (!ko) return undefined;
    chunks.push({ en, ko });
  }
  if (chunks.length < 2) return undefined;
  const norm = (t: string) =>
    t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, "").toLowerCase();
  return norm(chunks.map((c) => c.en).join(" ")) === norm(text) ? chunks : undefined;
}

export type MarkupTagSpan = {
  tag: MarkupSentenceTag;
  span: MarkupSpan;
  /**
   * 함축 의미로 나올 자리는 그 말이 무슨 뜻인지 바꿔 쓴 문장을 함께 적는다
   * (선생님 요청: "어떤 의미인지 패러프레이징 문장을 써 주고").
   */
  paraphrase?: string;
};

export type AnalysisSentenceMarkup = {
  /** 이 표시가 붙은 원문(공백 정리본). 문장이 바뀌면 표시를 버리는 기준이 된다. */
  text: string;
  roles: MarkupRoleMark[];
  brackets: MarkupBracket[];
  notes: MarkupSpanNote[];
  points: MarkupNumberedPoint[];
  callouts: MarkupCallout[];
  /** 문장 해석(한 줄). */
  translation: string;
  /** 선생님이 해석을 직접 고쳤다 */
  translationEdited?: boolean;
  tags: MarkupSentenceTag[];
  /**
   * 꼬리표가 가리키는 자리. 빈칸 추론·함축 의미·어휘 추론처럼 문장의 한 부분을 두고 붙는
   * 꼬리표는 어디를 말하는지 표시해야 한다(선생님 지적: "어디가 그런건지도 써줘야지").
   */
  tagSpans?: MarkupTagSpan[];
  /**
   * 직독직해 조각. 원문을 앞에서부터 의미 덩어리로 자른 영어 조각과 그 뜻.
   * 조각을 이으면 원문과 같아야 한다(다르면 버린다). 선생님 요청: 전체 해석 대신 고를 수 있게.
   */
  chunks?: MarkupChunk[];
};

/* ------------------------------------------------------------------ */
/* 고정 이름표 어휘                                                      */
/* ------------------------------------------------------------------ */

/**
 * 분석지에서 쓰는 표시 이름표. 워크북 어법 엔진의 이름표(grammar-ontology labelKo)에
 * 분석지 관례 표현을 더한 것이다. 여기 없는 이름은 찍지 않는다(모델이 지어낸 용어 차단).
 */
const MARKUP_EXTRA_LABELS = [
  // 문형
  "1형식", "2형식", "3형식", "4형식", "5형식",
  "주어", "동사", "목적어", "보어", "수식어", "부사적 어구",
  "간접목적어", "직접목적어", "주격보어", "목적격보어",
  // 구·절
  "명사절", "형용사절", "부사절", "명사구", "형용사구", "부사구", "전명구",
  "주절", "종속절", "등위절", "삽입절", "삽입구", "동격절", "동격구",
  "간접의문문", "의문사절", "관계사절", "관계부사절", "분사구문", "부정사구", "동명사구",
  "부정의 시간 부사절", "때 부사절", "조건 부사절", "양보 부사절", "이유 부사절",
  "목적 부사절", "결과 부사절", "비교 부사절", "양태 부사절",
  // as가 「~함에 따라」일 때. 목록에 없어 모델이 「시간 부사절」을 골랐다(2026-10-21 최다빈 선생님 지문 대조)
  "비례 부사절",
  // 생략·축약
  "관계사 생략", "관계사 생략 절", "접속사 that 생략", "주어+be 생략",
  "반복 어구 생략", "대동사", "공통 관계", "축약 관계절",
  // 시제·태
  "현재완료", "과거완료", "미래완료", "현재진행", "과거진행", "완료진행",
  "수동태", "완료 수동", "진행 수동", "조동사 수동",
  // 준동사
  "to부정사", "동명사", "현재분사", "과거분사", "원형부정사",
  "의미상 주어", "완료부정사", "완료동명사", "수동부정사", "수동동명사",
  "가주어 it", "진주어", "가목적어 it", "진목적어", "비인칭 주어 it",
  // 어순·강조·특수
  "도치", "부정어 도치", "강조구문", "강조의 do", "부분 부정", "이중 부정",
  "어순", "부정대명사+else", "상관접속사", "병렬구조", "동격",
  // 자주 쓰는 구문 이름
  "감정 형용사+that절", "판단 형용사+of", "so ... that 구문", "such ... that 구문",
  "too ... to 구문", "enough to 구문", "the 비교급, the 비교급", "배수 비교",
  "as ... as 구문", "원급 비교", "비교급 강조", "최상급 표현",
  "it takes 구문", "not only A but also B", "no sooner ~ than",
  "have+O+p.p.", "사역동사+O+원형", "help+O+(to) V",
] as const;

function normalizeLabel(raw: string): string {
  return String(raw ?? "")
    .replace(/[[\]<>（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_LABELS: ReadonlySet<string> = new Set(
  [
    ...GRAMMAR_ONTOLOGY.map((p) => p.labelKo),
    ...MARKUP_EXTRA_LABELS,
  ]
    .map((l) => normalizeLabel(l))
    .filter(Boolean)
);

/** 모델이 자주 쓰는 다른 표현을 고정 어휘로 옮긴다. 없으면 그대로 두고 대조한다. */
const LABEL_ALIASES: Record<string, string> = {
  // let·have 문장에도 make가 보여 헷갈린다 — 선생님 2026-11-09 「사역동사+O+원형」으로. 옛 저장본도 새 이름으로 보인다
  "make+O+원형": "사역동사+O+원형",
  "관계대명사절": "관계사절",
  "관계대명사 절": "관계사절",
  "형용사적 수식 분사": "분사 명사 수식",
  "전치사구": "전명구",
  "부정사": "to부정사",
  "to 부정사": "to부정사",
  "수동": "수동태",
  "현재 완료": "현재완료",
  "과거 완료": "과거완료",
  "가주어": "가주어 it",
  "가목적어": "가목적어 it",
  "5형식 문장": "5형식",
  "4형식 문장": "4형식",
  "3형식 문장": "3형식",
  "목적격 보어": "목적격보어",
  "주격 보어": "주격보어",
  "간접 의문문": "간접의문문",
  "분사 구문": "분사구문",
  "병렬 구조": "병렬구조",
  "생략": "반복 어구 생략",
  // 이름만 다른 것은 하나로(2026-10-22 저장본 159가지 대조)
  "관계사 생략 절": "관계사 생략",
  "전치사+동명사 분석": "전치사+동명사",
  "때 부사절": "시간 부사절",
  "as ... as": "as ... as 구문",
  "삽입": "삽입구",
  "의문사절": "간접의문문",
  "의문사 명사절": "간접의문문",
  "5형식 목적격보어": "5형식",
  "동명사 주어 수일치": "동명사 주어",
  "2형식 보어": "2형식",
  "there+be": "there be 수일치",
};

/** 고정 어휘에 있으면 그 표기로 돌려주고, 없으면 null(=찍지 않는다). */
/**
 * 수업에서 안 쓰는 학술 용어. 선생님 지적(2026-09-17): "이런 표현 좀 쓰지 말구"(의사분열문).
 * 쉬운 말이 있으면 바꾸고, 없으면 그 이름표는 달지 않는다(표시 자체는 그대로 남는다).
 */
const TOO_ACADEMIC: Record<string, string> = {
  "의사분열문": "",
  "의사분열문 all": "",
  "분열문": "강조 구문",
  "외치": "",
  "비한정적 관계절": "계속적 용법",
  "한정적 관계절": "관계사절",
  "명사절 보문": "명사절",
  "보문": "",
  "동격절 보문": "동격절",
  "무생물 주어 구문": "",
  "결과절": "",
};

export function canonicalMarkupLabel(raw: unknown): string | null {
  const norm = normalizeLabel(String(raw ?? ""));
  if (!norm) return null;
  const plain = TOO_ACADEMIC[norm];
  if (plain !== undefined) {
    if (!plain) return null;
    return ALLOWED_LABELS.has(plain) ? plain : null;
  }
  const aliased = LABEL_ALIASES[norm] ?? norm;
  if (ALLOWED_LABELS.has(aliased)) return aliased;
  // "부사절(시간)"처럼 뒤에 괄호 설명이 붙은 경우 앞머리만 다시 본다.
  const head = aliased.split(/[·:,]/)[0]?.trim() ?? "";
  if (head && ALLOWED_LABELS.has(head)) return head;
  const aliasedHead = LABEL_ALIASES[head];
  if (aliasedHead && ALLOWED_LABELS.has(aliasedHead)) return aliasedHead;
  return null;
}

/** 점검 스크립트에서 쓰는 전체 어휘(정렬본). */
export function markupLabelVocabulary(): string[] {
  return [...ALLOWED_LABELS].sort();
}

/* ------------------------------------------------------------------ */
/* 구간 찾기                                                            */
/* ------------------------------------------------------------------ */

/** 따옴표·붙임표 모양 차이만 지우고 비교한다(모델이 ' 를 ’ 로 바꿔 내놓는 일이 잦다). */
function canonChar(ch: string): string {
  if (ch === "‘" || ch === "’" || ch === "ʼ") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (ch === "–" || ch === "—" || ch === "−") return "-";
  if (ch === " ") return " ";
  return ch;
}

type CanonText = { text: string; map: number[] };

/** 공백을 하나로 줄이고 글자 모양을 맞춘 비교용 문자열 + 원문 좌표표. */
function canonicalize(input: string): CanonText {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < input.length; i++) {
    const ch = canonChar(input[i]!);
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out.push(" ");
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    out.push(ch);
    map.push(i);
    lastWasSpace = false;
  }
  while (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

/**
 * 문장 안에서 모델이 따온 글자를 찾아 좌표로 바꾼다. 같은 글자가 여러 번 나오면
 * occurrence(1부터)로 고른다. 못 찾으면 null.
 */
export function resolveMarkupSpan(
  sentence: string,
  quote: string,
  occurrence = 1
): MarkupSpan | null {
  const q = canonicalize(String(quote ?? "")).text;
  if (!q) return null;
  const doc = canonicalize(sentence);
  const nth = Math.max(1, Math.floor(occurrence) || 1);

  /*
   * 낱말 경계에 맞는 자리만 센다. 경계를 보지 않으면 짧은 낱말이 앞 낱말 속에 걸렸다
   * (Then 속의 he에 주어 S가 찍힘 — 2026-10-21 최다빈 선생님 지문분석 대조). 경계에 맞는 자리가
   * 없을 때만(따옴말이 낱말 일부인 경우) 예전처럼 아무 자리나 센다.
   */
  const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);
  const onBoundary = (pos: number) =>
    (!isWordChar(q[0]) || !isWordChar(doc.text[pos - 1])) &&
    (!isWordChar(q[q.length - 1]) || !isWordChar(doc.text[pos + q.length]));
  const findNth = (strict: boolean) => {
    let from = 0;
    let hit = -1;
    for (let k = 0; k < nth; ) {
      const pos = doc.text.indexOf(q, from);
      if (pos < 0) return -1;
      from = pos + 1;
      if (strict && !onBoundary(pos)) continue;
      hit = pos;
      k++;
    }
    return hit;
  };
  let found = findNth(true);
  if (found < 0) found = findNth(false);
  if (found < 0) return null;

  const start = doc.map[found];
  const lastIdx = doc.map[found + q.length - 1];
  if (start == null || lastIdx == null) return null;
  return { start, end: lastIdx + 1 };
}

/** 구간이 문장 안에 있고 비어 있지 않은가. */
export function isSaneSpan(span: MarkupSpan, length: number): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= length
  );
}

/** 두 구간이 서로 걸치기만 하는가(포함도 아니고 떨어져 있지도 않다 → 괄호를 칠 수 없다). */
export function spansCross(a: MarkupSpan, b: MarkupSpan): boolean {
  if (a.end <= b.start || b.end <= a.start) return false; // 떨어져 있다
  const aInB = b.start <= a.start && a.end <= b.end;
  const bInA = a.start <= b.start && b.end <= a.end;
  return !aInB && !bInA;
}

/** 같은 구간인가. */
function sameSpan(a: MarkupSpan, b: MarkupSpan): boolean {
  return a.start === b.start && a.end === b.end;
}

/* ------------------------------------------------------------------ */
/* 렌더 트리                                                            */
/* ------------------------------------------------------------------ */

export type MarkupDecoration = {
  bracket?: MarkupBracketKind;
  /** idx: markup.roles 안의 자리(분석지에서 눌러 고칠 때 쓴다) */
  role?: { code: MarkupRoleCode; level: MarkupRoleLevel; idx: number; edited?: boolean };
};

/**
 * 글자 사이에 끼워 넣는 표시.
 * 이름표·번호·점선 상자 꼬리표는 구간을 감싸지 않고 구간이 시작하는 자리에만 찍는다.
 * 그래서 이것들은 다른 구간과 걸쳐도 상관이 없고(괄호를 치지 않으므로), 버려지지 않는다.
 */
export type MarkupMarker = {
  notes: MarkupSpanNote[];
  points: MarkupNumberedPoint[];
  /** markup.callouts의 번호 */
  calloutIndexes: number[];
};

export type MarkupNode =
  /** at은 문장 안 시작 좌표. 형광펜처럼 글자 단위로 덧칠할 때 쓴다. */
  | { kind: "text"; text: string; at: number }
  | ({ kind: "marker" } & MarkupMarker)
  | {
      kind: "span";
      span: MarkupSpan;
      deco: MarkupDecoration;
      children: MarkupNode[];
    };

/**
 * 괄호와 문장성분만 포개 트리로 만들고, 이름표·번호·상자 꼬리표는 시작 자리에 끼워 넣는다.
 * 넓은 구간이 바깥, 좁은 구간이 안쪽이다.
 */
export function buildMarkupTree(markup: AnalysisSentenceMarkup): MarkupNode[] {
  const text = markup.text;

  type Building = { span: MarkupSpan; deco: MarkupDecoration; kids: Building[] };
  const entries: Building[] = [];

  const upsert = (span: MarkupSpan): MarkupDecoration => {
    const hit = entries.find((e) => sameSpan(e.span, span));
    if (hit) return hit.deco;
    const deco: MarkupDecoration = {};
    entries.push({ span, deco, kids: [] });
    return deco;
  };

  for (const b of markup.brackets) upsert(b.span).bracket = b.kind;
  markup.roles.forEach((r, idx) => {
    upsert(r.span).role = { code: r.role, level: r.level, idx, edited: r.edited };
  });

  // 넓은 것이 먼저, 같으면 앞선 것이 먼저.
  entries.sort((a, b) => {
    const len = b.span.end - b.span.start - (a.span.end - a.span.start);
    if (len !== 0) return len;
    return a.span.start - b.span.start;
  });

  const tops: Building[] = [];
  const insert = (list: Building[], node: Building): void => {
    for (const cur of list) {
      if (cur.span.start <= node.span.start && node.span.end <= cur.span.end) {
        insert(cur.kids, node);
        return;
      }
    }
    list.push(node);
  };
  for (const e of entries) insert(tops, { ...e, kids: [] });

  // 끼워 넣을 표시를 시작 자리별로 모은다.
  const markers = new Map<number, MarkupMarker>();
  const markerAt = (at: number): MarkupMarker => {
    const hit = markers.get(at);
    if (hit) return hit;
    const fresh: MarkupMarker = { notes: [], points: [], calloutIndexes: [] };
    markers.set(at, fresh);
    return fresh;
  };
  for (const n of markup.notes) markerAt(n.span.start).notes.push(n);
  for (const p of markup.points) markerAt(p.span.start).points.push(p);
  markup.callouts.forEach((c, i) => markerAt(c.span.start).calloutIndexes.push(i));

  const used = new Set<number>();
  const emitMarker = (at: number, out: MarkupNode[]): void => {
    const m = markers.get(at);
    if (!m || used.has(at)) return;
    used.add(at);
    out.push({ kind: "marker", ...m });
  };

  /** [from, to) 구간의 글자를 끼워 넣을 표시로 잘라 가며 내보낸다. */
  const emitRange = (from: number, to: number, out: MarkupNode[]): void => {
    let at = from;
    const cuts = [...markers.keys()]
      .filter((k) => k > from && k < to && !used.has(k))
      .sort((x, y) => x - y);
    for (const cut of cuts) {
      if (cut > at) out.push({ kind: "text", text: text.slice(at, cut), at });
      emitMarker(cut, out);
      at = cut;
    }
    if (at < to) out.push({ kind: "text", text: text.slice(at, to), at });
  };

  const render = (list: Building[], from: number, to: number): MarkupNode[] => {
    const sorted = [...list].sort((a, b) => a.span.start - b.span.start);
    const out: MarkupNode[] = [];
    let at = from;
    emitMarker(from, out);
    for (const node of sorted) {
      if (node.span.start > at) emitRange(at, node.span.start, out);
      emitMarker(node.span.start, out);
      out.push({
        kind: "span",
        span: node.span,
        deco: node.deco,
        children: render(node.kids, node.span.start, node.span.end),
      });
      at = Math.max(at, node.span.end);
    }
    if (at < to) emitRange(at, to, out);
    return out;
  };

  return render(tops, 0, text.length);
}

/* ------------------------------------------------------------------ */
/* 저장본 다시 읽기                                                      */
/* ------------------------------------------------------------------ */

const ROLE_CODES: ReadonlySet<string> = new Set([
  "S", "V", "O", "C", "IO", "DO", "M", "A",
]);

function asSpan(raw: unknown, length: number): MarkupSpan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { start?: unknown; end?: unknown };
  const span = { start: Number(o.start), end: Number(o.end) };
  return isSaneSpan(span, length) ? span : null;
}

/**
 * 저장된 JSON을 다시 읽을 때도 같은 검사를 통과한 것만 쓴다. 저장 당시의 원문과
 * 지금 문장이 다르면(선생님이 원문을 고쳤다) 표시를 통째로 버린다.
 */
export function readAnalysisMarkup(
  raw: unknown,
  sentenceText: string
): AnalysisSentenceMarkup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? "").trim();
  if (!text) return null;
  if (canonicalize(text).text !== canonicalize(sentenceText).text) return null;
  const len = text.length;

  const roles: MarkupRoleMark[] = [];
  for (const r of Array.isArray(o.roles) ? o.roles : []) {
    const row = r as Record<string, unknown>;
    const span = asSpan(row.span, len);
    const code = String(row.role ?? "").toUpperCase();
    if (!span || !ROLE_CODES.has(code)) continue;
    const level = Math.min(2, Math.max(0, Math.floor(Number(row.level) || 0)));
    roles.push({
      span,
      role: code as MarkupRoleCode,
      level: level as MarkupRoleLevel,
      ...(row.edited === true ? { edited: true } : {}),
    });
  }

  const brackets: MarkupBracket[] = [];
  for (const b of Array.isArray(o.brackets) ? o.brackets : []) {
    const row = b as Record<string, unknown>;
    const span = asSpan(row.span, len);
    const kind = String(row.kind ?? "");
    if (!span) continue;
    if (kind !== "adverbial" && kind !== "nominal" && kind !== "inserted") continue;
    brackets.push({ span, kind });
  }

  const notes: MarkupSpanNote[] = [];
  for (const n of Array.isArray(o.notes) ? o.notes : []) {
    const row = n as Record<string, unknown>;
    const span = asSpan(row.span, len);
    const label = canonicalMarkupLabel(row.label);
    if (!span || !label) continue;
    const gloss = String(row.gloss ?? "").trim();
    // 이름표 모양이 그 자리와 안 맞으면(선생님이 고친 것은 빼고) 찍지 않는다
    if (row.edited !== true && !labelFitsSpan(label, text.slice(span.start, span.end), text.slice(Math.max(0, span.start - 24), span.start))) continue;
    notes.push({ span, label, gloss: gloss || undefined, ...(row.edited === true ? { edited: true } : {}) });
  }

  const points: MarkupNumberedPoint[] = [];
  for (const p of Array.isArray(o.points) ? o.points : []) {
    const row = p as Record<string, unknown>;
    const span = asSpan(row.span, len);
    const label = canonicalMarkupLabel(row.label);
    const explanation = String(row.explanation ?? "").trim();
    if (!span || !label || !explanation) continue;
    if (row.edited !== true && !labelFitsSpan(label, text.slice(span.start, span.end), text.slice(Math.max(0, span.start - 24), span.start))) continue;
    const rewrite = String(row.rewrite ?? "").trim();
    points.push({
      index: points.length + 1,
      span,
      label,
      star: row.star === true,
      explanation,
      rewrite: rewrite || undefined,
      ...(row.edited === true ? { edited: true } : {}),
    });
  }

  const callouts: MarkupCallout[] = [];
  for (const c of Array.isArray(o.callouts) ? o.callouts : []) {
    const row = c as Record<string, unknown>;
    const span = asSpan(row.span, len);
    const title = String(row.title ?? "").trim();
    const body = String(row.body ?? "").trim();
    if (!span || !title || !body) continue;
    callouts.push({
      span,
      title,
      body,
      tone: row.tone === "blue" ? "blue" : "red",
    });
  }

  const tags: MarkupSentenceTag[] = [];
  for (const t of Array.isArray(o.tags) ? o.tags : []) {
    const tag = String(t ?? "").trim();
    if ((MARKUP_SENTENCE_TAGS as readonly string[]).includes(tag)) {
      if (!tags.includes(tag as MarkupSentenceTag)) {
        tags.push(tag as MarkupSentenceTag);
      }
    }
  }

  /* 꼬리표가 가리키는 자리. 이걸 읽어 오지 않으면 저장된 분석서에서 표시가 사라진다. */
  const tagSpans: MarkupTagSpan[] = [];
  for (const t of Array.isArray(o.tagSpans) ? o.tagSpans : []) {
    const row = t as Record<string, unknown>;
    const tag = String(row.tag ?? "").trim();
    if (!(MARKUP_SENTENCE_TAGS as readonly string[]).includes(tag)) continue;
    if (!tags.includes(tag as MarkupSentenceTag)) continue;
    const span = asSpan(row.span, len);
    if (!span) continue;
    const paraphrase = String(row.paraphrase ?? "").trim().slice(0, 220);
    if (tagSpans.some((x) => x.tag === tag)) continue;
    tagSpans.push({
      tag: tag as MarkupSentenceTag,
      span,
      paraphrase: paraphrase || undefined,
    });
  }

  const translation = String(o.translation ?? "").trim();
  const chunks = verifiedChunks(text, o.chunks);
  // 같은 자리에 같은 이름의 번호 설명이 있으면 이름표는 겹쳐 찍지 않는다(이름 묶기로 같아진 것 포함)
  const notesKept = notes.filter((n) => !points.some((p) => p.span.start === n.span.start && p.label === n.label));
  // 제목·구호 줄(짧고 마침표 없음)은 성분·이름표를 찍지 않는다(The First Period (2003~2009)에 2형식이 붙던 것)
  const heading = isHeadingLine(text);
  const markup: AnalysisSentenceMarkup = {
    text,
    // 표기 규칙(준동사 V 없음·목적격보어 C·조동사부터 V)을 예전 저장본에도 그대로 적용한다. 빠진 주절 성분·잘린 준동사구는 채운다
    roles: heading ? [] : fillMissingRoles(text, raiseRoleLevels(text, normalizeMarkupRoles(text, roles, brackets), brackets, notesKept), brackets),
    brackets: heading ? [] : brackets,
    notes: heading ? [] : notesKept,
    points: heading ? [] : points,
    callouts,
    tagSpans,
    chunks,
    translation,
    ...(o.translationEdited === true ? { translationEdited: true } : {}),
    tags,
  };
  return hasAnyMarkup(markup) ? markup : null;
}

/** 제목·번호 줄처럼 문장이 아닌 줄: 여섯 낱말 이하이고 끝에 마침표·물음표·느낌표가 없다 */
export function isHeadingLine(text: string): boolean {
  const t = text.trim();
  if (/[.?!]["”’)]*$/.test(t)) return false;
  return t.split(/\s+/).filter(Boolean).length <= 6;
}

export function hasAnyMarkup(m: AnalysisSentenceMarkup | null | undefined): boolean {
  if (!m) return false;
  return (
    m.roles.length > 0 ||
    m.brackets.length > 0 ||
    m.notes.length > 0 ||
    m.points.length > 0 ||
    m.callouts.length > 0 ||
    m.translation.length > 0
  );
}
