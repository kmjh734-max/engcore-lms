/** 제시어 배열 <보기> 정규화: 원형화 + 무작위 섞기 + 조건 정리 */

const FUNCTION_KEEP = new Set(
  [
    "a",
    "an",
    "the",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "by",
    "as",
    "if",
    "or",
    "and",
    "but",
    "not",
    "no",
    "so",
    "than",
    "that",
    "this",
    "these",
    "those",
    "it",
    "its",
    "they",
    "them",
    "their",
    "he",
    "she",
    "him",
    "her",
    "we",
    "us",
    "our",
    "you",
    "your",
    "i",
    "me",
    "my",
    "who",
    "which",
    "what",
    "when",
    "where",
    "why",
    "how",
    "will",
    "would",
    "can",
    "could",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "do",
    "does",
    "did",
    "be",
    "am",
    "is",
    "are",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
  ].map((w) => w.toLowerCase())
);

/** 불규칙·자주 나오는 과거/과거분사 → 원형 */
const IRREGULAR: Record<string, string> = {
  been: "be",
  was: "be",
  were: "be",
  gone: "go",
  went: "go",
  known: "know",
  knew: "know",
  done: "do",
  did: "do",
  made: "make",
  taken: "take",
  took: "take",
  given: "give",
  gave: "give",
  seen: "see",
  saw: "see",
  came: "come",
  become: "become",
  became: "become",
  begun: "begin",
  began: "begin",
  broken: "break",
  broke: "break",
  brought: "bring",
  built: "build",
  bought: "buy",
  caught: "catch",
  chosen: "choose",
  chose: "choose",
  cut: "cut",
  drawn: "draw",
  drew: "draw",
  driven: "drive",
  drove: "drive",
  eaten: "eat",
  ate: "eat",
  fallen: "fall",
  fell: "fall",
  felt: "feel",
  found: "find",
  forgotten: "forget",
  forgot: "forget",
  gotten: "get",
  got: "get",
  grown: "grow",
  grew: "grow",
  heard: "hear",
  held: "hold",
  kept: "keep",
  left: "leave",
  lent: "lend",
  lost: "lose",
  meant: "mean",
  met: "meet",
  paid: "pay",
  put: "put",
  read: "read",
  ridden: "ride",
  rode: "ride",
  risen: "rise",
  rose: "rise",
  run: "run",
  ran: "run",
  said: "say",
  sold: "sell",
  sent: "send",
  set: "set",
  shown: "show",
  showed: "show",
  shut: "shut",
  sung: "sing",
  sang: "sing",
  sat: "sit",
  spoken: "speak",
  spoke: "speak",
  spent: "spend",
  stood: "stand",
  stolen: "steal",
  stole: "steal",
  stuck: "stick",
  swum: "swim",
  swam: "swim",
  taught: "teach",
  told: "tell",
  thought: "think",
  thrown: "throw",
  threw: "throw",
  understood: "understand",
  woken: "wake",
  woke: "wake",
  worn: "wear",
  wore: "wear",
  won: "win",
  written: "write",
  wrote: "write",
  allowed: "allow",
  allows: "allow",
  assumed: "assume",
  assumes: "assume",
  received: "receive",
  receives: "receive",
  reduced: "reduce",
  reduces: "reduce",
  tested: "test",
  tests: "test",
  provided: "provide",
  provides: "provide",
  required: "require",
  requires: "require",
  decided: "decide",
  decides: "decide",
  included: "include",
  includes: "include",
  created: "create",
  creates: "create",
};

const IRREGULAR_NOUN: Record<string, string> = {
  children: "child",
  men: "man",
  women: "woman",
  // people → person, data → datum 은 뺐다. 보기에 person이 나오면 정답 people을 못 쓴다
  // (100문항 대조 2026-10-02, 제시어배열단어추가 #82).
  teeth: "tooth",
  feet: "foot",
  mice: "mouse",
  geese: "goose",
  leaves: "leaf",
  lives: "life",
  knives: "knife",
  wives: "wife",
  selves: "self",
  monies: "money",
  moneys: "money",
  analyses: "analysis",
  crises: "crisis",
  theses: "thesis",
  phenomena: "phenomenon",
  criteria: "criterion",
};

/**
 * be·do·have 꼴 → 원형. 어형변화 보기를 만들 때만 쓴다(auxiliaries: true).
 * 부정 축약형은 원형만 남기고 not은 학생이 붙인다(조건에 「어형 변화」가 있다).
 */
const AUX_BASE: Record<string, string> = {
  am: "be",
  is: "be",
  are: "be",
  was: "be",
  were: "be",
  been: "be",
  being: "be",
  "isn't": "be",
  "aren't": "be",
  "wasn't": "be",
  "weren't": "be",
  does: "do",
  did: "do",
  done: "do",
  "don't": "do",
  "doesn't": "do",
  "didn't": "do",
  has: "have",
  had: "have",
  having: "have",
  "hasn't": "have",
  "haven't": "have",
  "hadn't": "have",
};

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** -ing로 끝나지만 분사가 아닌 기본형·명사 */
const ING_KEEP = new Set([
  "meaning",
  "feeling",
  "building",
  "ceiling",
  "sibling",
  "morning",
  "evening",
  "something",
  "anything",
  "nothing",
  "everything",
  "wedding",
  "meeting",
  "hearing",
  "during",
  "according",
  "regarding",
  "including",
  "excluding",
  "following",
  "outstanding",
  "understanding",
  "beginning",
  "clothing",
  "housing",
  "offering",
  "training",
  "warning",
]);

/** 동사 과거·3인칭 / 명사 복수 → 기본형 (고신뢰만; e 임의 추가·삭제 금지) */
const S_KEEP = new Set(
  [
    "always",
    // -s로 끝나는 부사(2026-10-10 점검: 보기에 nowaday가 나왔다)
    "nowadays",
    "sometimes",
    "indoors",
    "outdoors",
    "upstairs",
    "downstairs",
    "overseas",
    "backwards",
    "forwards",
    "upwards",
    "downwards",
    "news",
    "means",
    "series",
    "species",
    "physics",
    "mathematics",
    "economics",
    "politics",
    "basics",
    "thanks",
    "towards",
    "afterwards",
    "focus",
    "campus",
    "status",
    "bonus",
    "virus",
    "process",
    "access",
    "success",
    "progress",
    "address",
    "business",
    "perhaps",
    "otherwise",
    "ourselves",
    "themselves",
    "yourselves",
    "analysis",
    "basis",
    "crisis",
    "thesis",
    "across",
    "unless",
    "whereas",
    "besides",
    // 복수로만 쓰거나 복수일 때 뜻이 달라지는 명사(선생님 지적 2026-10-05: 보기에 clothe·custom이 나왔다)
    "clothes",
    "customs",
    "goods",
    "belongings",
    "surroundings",
    "savings",
    "earnings",
    "manners",
    "outskirts",
    "glasses",
    "scissors",
    "trousers",
    "pants",
    "jeans",
    "headquarters",
    "premises",
    "congratulations",
    "electronics",
    "statistics",
  ].map((w) => w.toLowerCase())
);

/**
 * 원래 낱말이 겹자음으로 끝나는 것들. 여기 걸리면 겹자음을 떼지 않는다.
 *
 * 선생님 지적(2026-09-28): 보기에 blessing이 bles로 잘려 나왔다.
 * running→run을 위한 규칙이 bless·call·add까지 잘라 버린 탓이다.
 * ff·ll·ss·zz로 끝나는 낱말은 원래 그 꼴이고(call, pass, off, buzz),
 * 그 밖에 겹자음으로 끝나는 낱말은 몇 개뿐이라 따로 적어 둔다.
 */
const DOUBLE_END_KEEP = new Set(["add", "ebb", "egg", "err", "inn", "odd", "purr"]);

/** -ves 가 f 로 돌아가는 낱말 (wolves → wolf) */
const VES_TO_F = new Set([
  "calf", "elf", "half", "leaf", "loaf", "scarf", "self", "sheaf", "shelf",
  "thief", "wharf", "wolf",
]);
/** -ves 가 fe 로 돌아가는 낱말 (knives → knife) */
const VES_TO_FE = new Set(["knife", "life", "wife"]);

function stripDoubledConsonant(stem: string): string | null {
  if (!/(.)\1$/.test(stem) || stem.length < 2) return null;
  if ("flsz".includes(stem.slice(-1))) return null;
  if (DOUBLE_END_KEEP.has(stem)) return null;
  return stem.slice(0, -1);
}

export function lemmaEnglishToken(
  raw: string,
  /**
   * keepS: 끝의 -s·-es·-ies는 떼지 않는다. 동사 3인칭인지 명사 복수인지 낱말 하나로는 모르기 때문이다.
   * 어형변화 보기·화면 표시에 쓴다 — 명사 복수형까지 깎아 clothe·custom이 나왔다(2026-10-05).
   */
  opts?: { auxiliaries?: boolean; keepS?: boolean } | number
): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase().replace(/[’ʼ]/g, "'");
  // .map(lemmaEnglishToken)으로 불리면 둘째 인자가 index(숫자)다 — 그때는 옵션이 없다
  const auxiliaries = typeof opts === "object" && opts !== null && opts.auxiliaries === true;
  const keepS = typeof opts === "object" && opts !== null && opts.keepS === true;
  if (auxiliaries && AUX_BASE[lower]) return AUX_BASE[lower];
  if (FUNCTION_KEEP.has(lower)) return lower;
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  if (IRREGULAR_NOUN[lower]) return IRREGULAR_NOUN[lower];
  if (S_KEEP.has(lower)) return lower;
  if (keepS && /s$/.test(lower)) return lower;

  // -ies → y (cities → city, studies → study)
  if (/^[a-z]+ies$/i.test(lower) && lower.length > 4) {
    return lower.slice(0, -3) + "y";
  }
  /*
   * -ves → f 는 정해 둔 낱말에만 쓴다.
   *
   * 선생님과 함께 전수조사(2026-09-30): 보기에 prof·detectif·motif 같은 말이
   * 나왔다. proves·detectives·motives처럼 ves 로 끝나기만 하면 f 를 붙인 탓이다.
   * f·fe 로 바뀌는 낱말은 몇 개뿐이라 적어 두고, 나머지는 -s 만 뗀다.
   */
  if (/^[a-z]+ves$/i.test(lower) && lower.length > 4) {
    const base = lower.slice(0, -3);
    if (VES_TO_F.has(`${base}f`)) return `${base}f`;
    if (VES_TO_FE.has(`${base}fe`)) return `${base}fe`;
    return lower.slice(0, -1);
  }
  // -oes → o (heroes → hero, goes → go)
  if (/^[a-z]+oes$/i.test(lower) && lower.length > 4) {
    return lower.slice(0, -2);
  }
  // -sses / -ches / -shes / -xes / -zes → drop -es
  if (/(?:ss|ch|sh|x|z)es$/i.test(lower)) {
    return lower.slice(0, -2);
  }
  /*
   * buses / gases → bus / gas. 짧은 낱말에만 쓴다.
   *
   * 100문항 대조(2026-10-02): purchases가 purchas로 나왔다. 모음+ses면 다 es를 떼던
   * 탓이다. purchases·houses·cases·causes·promises는 s 하나만 떼야 한다.
   */
  // 다섯 글자여도 bases·cases·noses·roses·doses·vases·poses는 s 하나만 뗀다(2026-10-03 bas·cas·nos가 나왔다).
  // es를 떼는 것은 bus·gas처럼 원형이 자음으로 끝나는 몇 낱말뿐이다.
  if (/^(buses|gases|pluses|minuses|bonuses|campuses|viruses|focuses|census?es)$/i.test(lower)) {
    return lower.slice(0, -2);
  }
  // -ied → y (studied → study)
  if (/^[a-z]+ied$/i.test(lower) && lower.length > 4) {
    return lower.slice(0, -3) + "y";
  }
  // -ed: 고신뢰만 — 불규칙 맵 또는 자음 중복 (stopped → stop). e 임의 부착 금지.
  if (/^[a-z]+ed$/i.test(lower) && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (stem.length >= 3) {
      const stripped = stripDoubledConsonant(stem);
      if (stripped) return stripped;
    }
    return lower;
  }
  // -ing: 명사 유지 · 자음 중복만 (running → run). making→make 등 추측 금지.
  if (/^[a-z]+ing$/i.test(lower) && lower.length > 5) {
    if (ING_KEEP.has(lower)) return lower;
    const stem = lower.slice(0, -3);
    const stripped = stripDoubledConsonant(stem);
    if (stripped) return stripped;
    return lower;
  }
  // 3인칭·복수 -s (allows → allow, consumers → consumer, changes → change)
  if (/^[a-z]+s$/i.test(lower) && lower.length > 4 && !/ss$/i.test(lower)) {
    if (/(?:ous|ius|us|is|ess|asis|esis|osis)$/i.test(lower)) return lower;
    // pages → page, changes → change
    if (/[bcdfghjklmnpqrstvwxyz]es$/i.test(lower)) {
      return lower.slice(0, -1);
    }
    if (/[^aeiou]s$/i.test(lower)) {
      return lower.slice(0, -1);
    }
  }

  return lower;
}

export function splitWordBank(raw: string): string[] {
  return raw
    .split(/\s*\/\s*|\s*,\s*|\n+/)
    .map((w) => w.trim())
    // \uC22B\uC790\uB3C4 \uB0B1\uB9D0\uC774\uB2E4(2018 \uB4F1) \u2014 \uC601\uBB38\uC790\uB9CC \uC138\uBA74 <\uBCF4\uAE30>\uC5D0\uC11C \uBE60\uC9C4\uB2E4
    .filter((w) => w && /[A-Za-z0-9]/.test(w) && !/[\uAC00-\uD7A3]/.test(w));
}

export function joinWordBank(words: string[]): string {
  return words.join(" / ");
}

/** 정답 영어 구 → 토큰 (구두점 제거) */
export function tokenizeAnswerPhrase(answer: string): string[] {
  return String(answer ?? "")
    .replace(/^[ⓐⓑⓒⓓⓔ]\s*[:：]?\s*/i, "")
    /*
     * 낱말 안의 홑따옴표는 살린다 — artist’s가 artists가 되면 정답을 쓸 수 없다
     * (선생님 지적 2026-09-29 요약문 빈칸). 낱말 밖의 따옴표만 걷어 낸다.
     */
    .replace(/[“”‘’"'`ʼ]/g, (mark, at: number, whole: string) => {
      const before = whole[at - 1] ?? "";
      const after = whole[at + 1] ?? "";
      if (/[A-Za-z]/.test(before) && /[A-Za-z]/.test(after)) return "’";
      /*
       * 복수 소유격(members’ votes)도 살린다 — 떼면 <보기>에 members만 남아 정답을 쓸 수 없다(2026-11-09 점검 dbda145e).
       * 앞에 열린 홑따옴표(‘ 또는 낱말 앞 ')가 남아 있으면 닫는 따옴표로 본다.
       */
      if (/[’'ʼ]/.test(mark) && /s/i.test(before) && (!after || /\s/.test(after))) {
        const head = whole.slice(0, at);
        const opens = (head.match(/‘|(?:^|\s)'/g) ?? []).length;
        const closes = (head.match(/’(?![A-Za-z])|[A-Za-z]'(?![A-Za-z])/g) ?? []).length;
        if (opens <= closes) return "’";
      }
      return "";
    })
    /*
     * 낱말 안의 붙임표도 살린다 — hip-hop이 hip과 hop으로 갈라지면 <보기>에 둘로
     * 나와서 붙여 쓸 길이 없고, 조건의 낱말 수와도 어긋난다.
     *
     * 선생님과 함께 전수조사(2026-09-29): 제시어배열어형변화 9월분 152문항 가운데
     * 여섯 개가 그랬다. English-speaking·self-worth·hip-hop이 갈라져 있었다.
     * 긴 줄표(— –)는 낱말 사이를 가르는 것이므로 그대로 공백으로 둔다.
     */
    .replace(/-/g, (mark, at: number, whole: string) => {
      const before = whole[at - 1] ?? "";
      const after = whole[at + 1] ?? "";
      return /[A-Za-z]/.test(before) && /[A-Za-z]/.test(after) ? "-" : " ";
    })
    .replace(/[.,!?;:()[\]{}…—–]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    /*
     * 숫자도 낱말이다. 영문자가 있어야만 센 탓에 「It was in 2018 that …」의 2018이
     * <보기>에서도 빠지고 낱말 수에서도 빠졌다. 조건은 「단어를 더하거나 빼지 말 것」인데
     * 보기에 없는 2018을 넣어야 답이 되었다(2026-10-01 Jayden 선생님 지적).
     */
    .filter((w) => w.length > 0 && /[A-Za-z0-9]/.test(w));
}

export type WordOrderBankMode = "basic" | "inflect" | "add";

/**
 * 문장 가운데 대문자로 시작하는 낱말(고유명사·약어·I)은 보기에서도 그 꼴을 지킨다.
 * 100문항 대조(2026-10-02): OED·Korean·Datanla가 oed·korean·datanla로 나왔다.
 */
function keepProperCase(original: string, lemma: string, index: number): string {
  if (/^[A-Z][A-Z0-9-]+$/.test(original)) return original; // OED, AI, U.S.
  if (original === "I") return "I";
  // DJing·MCing처럼 앞 대문자가 둘 이상이면 그 머리를 살린다(Djing으로 나가던 것, 10-07 발곡고2)
  const caps = original.match(/^[A-Z]{2,}/)?.[0];
  if (caps && lemma.toLowerCase().startsWith(caps.toLowerCase())) return caps + lemma.slice(caps.length);
  if (index > 0 && /^[A-Z]/.test(original) && lemma) {
    return lemma.charAt(0).toUpperCase() + lemma.slice(1);
  }
  return lemma;
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const ca = countMap(a);
  const cb = countMap(b);
  for (const [k, n] of ca) if (cb.get(k) !== n) return false;
  return true;
}

/**
 * 정답에 쓰인 단어가 <보기>에 빠지지 않게 맞춤.
 * - basic / inflect: 모델이 낸 보기가 정답과 맞으면 그대로 쓰고, 아니면 정답에서 다시 만든다
 *   (어형변화 모드는 원형). 모델 보기를 되도록 지키는 까닭: 해설이 그 보기를 보고 쓰였다.
 *   보기만 갈아 끼우면 「be를 are로 바꾼다」처럼 해설이 보기와 어긋난다(100문항 대조 2026-10-02).
 * - add: 모델 보기 가운데 정답에 뿌리가 있는 낱말만 남기고, 정답의 내용어 누락분을 보강
 *   (zip-line·zip-lining 중복, 정답에 없는 sneaky·make가 보기에 남던 것을 막는다)
 */
/** 바로 뒤의 -s 낱말을 3인칭 동사로 볼 주어 */
const SUBJECT_BEFORE_VERB_S = new Set([
  "he", "she", "it", "this", "that", "which", "who", "what", "one", "everyone", "everybody", "someone",
  "somebody", "anyone", "anybody", "nobody", "no-one", "everything", "something", "anything", "nothing", "each",
]);

/** 바로 뒤의 -s 낱말을 명사 복수형으로 볼 자리(한정사·수사·전치사) */
const NOUN_SLOT_BEFORE = new Set([
  "the", "a", "an", "my", "your", "his", "her", "our", "their", "its", "these", "those", "many", "some", "any", "all",
  "several", "few", "both", "such", "various", "other", "more", "most", "no", "two", "three", "four", "five",
  "ten", "hundreds", "thousands", "millions", "first", "last", "next", "diverse", "different", "emotional", "of", "during", "for", "with", "in", "on", "at", "by", "from", "into",
  "about", "among", "between", "through", "without", "within", "under", "over", "after", "before", "to",
]);

export function buildWordBankFromAnswer(
  correctAnswer: string,
  mode: WordOrderBankMode,
  existingBankRaw = ""
): string[] {
  const answerTokens = tokenizeAnswerPhrase(correctAnswer);
  const given = splitWordBank(scrubWordBankNoise(existingBankRaw));
  if (answerTokens.length === 0) {
    return given.map((t) => lemmaEnglishToken(t));
  }
  const lem = (t: string) => lemmaEnglishToken(t, { auxiliaries: mode === "inflect" });

  /*
   * 어형변화: 동사 꼴만 원형으로 돌린다. 끝의 -s는 바로 앞이 주어 대명사일 때(3인칭 동사)만 떼고
   * 명사 복수형은 정답 꼴 그대로 둔다(선생님 지적 2026-10-05: customs→custom, clothes→clothe).
   */
  const lemVerb = (t: string) => lemmaEnglishToken(t, { auxiliaries: true, keepS: true });
  // 모델 보기에 -s 없는 꼴(allow)이 있고 정답 꼴(allows)은 없으면 모델이 동사로 본 것이다
  const givenLower = new Set(given.map((g) => g.toLowerCase()));
  /*
   * 2026-10-12 점검: 모델이 보기에 educator·librarian·weekend처럼 명사 단수형을 넣으면 위 규칙이
   * 동사로 믿어 그대로 깎았다(Progressive educators and librarians, During weekends).
   * 바로 앞이 한정사·수사·전치사·형용사 꼴이거나, and/or 앞 낱말이 복수형으로 남았으면 명사 자리로 보고 정답 꼴을 둔다.
   */
  const nounSlot = (tokens: string[], i: number): boolean => {
    const prev = (tokens[i - 1] ?? "").toLowerCase();
    if (!prev) return false;
    // is·was·has·does는 명사가 아니다(what is important is)
    if (/^(?:is|was|has|does)$/i.test(tokens[i]!)) return false;
    if (NOUN_SLOT_BEFORE.has(prev)) return true;
    /*
     * 뒤에 관계사·조동사·복수 be가 오면 명사다 — 「not only places where」「cheap things can」「also spaces where」를
     * 앞말로는 못 가려 place·thing·space로 깎았다(2026-10-12 의고2 직전보충문제).
     */
    if (/^(?:where|which|who|whom|whose|can|could|will|would|may|might|must|should|are|were)$/.test((tokens[i + 1] ?? "").toLowerCase())) return true;
    if (/[’']s$/.test(prev)) return true; // people’s needs
    if (/(?:ive|ous|ful|less|able|ible)$/.test(prev) && prev.length > 4) return true;
    if ((prev === "and" || prev === "or") && i >= 2) {
      const left = inflectToken(tokens, i - 2);
      return /s$/i.test(tokens[i - 2]!) && left.toLowerCase() === tokens[i - 2]!.toLowerCase();
    }
    return false;
  };
  const inflectToken = (tokens: string[], i: number): string => {
    const t = tokens[i]!;
    const prev = (tokens[i - 1] ?? "").toLowerCase();
    if (/s$/i.test(t)) {
      const base = lem(t);
      if (SUBJECT_BEFORE_VERB_S.has(prev)) return base;
      if (base !== t.toLowerCase() && givenLower.has(base) && !givenLower.has(t.toLowerCase()) && !nounSlot(tokens, i)) return base;
    }
    // 규칙 과거·-ing는 철자를 짐작하지 않는다(destined→destine?). 모델 보기에 그 원형이 있으면 그것을 쓴다
    const low = t.toLowerCase();
    if (!givenLower.has(low)) {
      const guesses = /ed$/.test(low) ? [low.slice(0, -2), low.slice(0, -1)] : /ing$/.test(low) ? [low.slice(0, -3), `${low.slice(0, -3)}e`] : [];
      const hit = guesses.find((g) => g.length >= 2 && givenLower.has(g));
      if (hit) return hit;
    }
    return lemVerb(t);
  };

  /*
   * 단어추가: 정답의 내용어(관사·전치사 등 FUNCTION_KEEP 제외)를 보기로. 어형변화는 동사만 하므로
   * 동사만 원형(inflectToken), 명사·형용사·부사는 정답 꼴 그대로(선생님 2026-10-24: apples는 apples).
   * 모델 보기는 -ed·-ing 원형 짐작에만 쓴다(givenLower).
   */
  if (mode === "add") {
    const bank: string[] = [];
    const contentNeeded = answerTokens
      .map((t, i) => keepProperCase(t, inflectToken(answerTokens, i), i))
      .filter((t) => t && !FUNCTION_KEEP.has(t.toLowerCase()));
    for (const w of contentNeeded) {
      if (!bank.some((x) => x.toLowerCase() === w.toLowerCase())) bank.push(w);
    }
    return bank.filter(Boolean);
  }

  if (given.length === answerTokens.length && sameMultiset(given.map(lem), answerTokens.map(lem))) {
    /*
     * 어형변화는 보기를 원형으로 둔다. 모델이 destined·doing·ideas처럼 바뀐 꼴을 보기에 넣고
     * 해설에는 「destine을 destined로 바꾼다」고 써서, 보기와 해설이 어긋났다(2026-10-03 #95·#86).
     * 기본·추가는 모델 보기를 그대로 둔다.
     */
    if (mode !== "inflect") return given;
  }

  // basic: 형태 고정 → 정답 표면형 유지 / inflect: 동사 꼴만 원형
  return answerTokens
    .map((t, i) => keepProperCase(t, mode === "inflect" ? inflectToken(answerTokens, i) : t.toLowerCase(), i))
    .filter(Boolean);
}

function countMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

/** 보기가 정답 토큰을 모두 커버하는지 (lemma 기준) */
export function wordBankMissingFromAnswer(
  bankRaw: string,
  correctAnswer: string,
  mode: WordOrderBankMode
): string[] {
  const bank = splitWordBank(scrubWordBankNoise(bankRaw)).map(lemmaEnglishToken);
  const bankCounts = countMap(bank);
  const answerTokens = tokenizeAnswerPhrase(correctAnswer).map(lemmaEnglishToken);
  const needed =
    mode === "add"
      ? answerTokens.filter((t) => t && !FUNCTION_KEEP.has(t))
      : answerTokens.filter(Boolean);

  const missing: string[] = [];
  const needCounts = countMap(needed);
  for (const [w, n] of needCounts) {
    const have = bankCounts.get(w) ?? 0;
    for (let i = have; i < n; i++) missing.push(w);
  }
  return missing;
}

export function normalizeAndShuffleWordBank(raw: string): string {
  const tokens = splitWordBank(scrubWordBankNoise(raw))
    .map(lemmaEnglishToken)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  shuffleInPlace(tokens);
  return joinWordBank(tokens);
}

/**
 * 어형을 그대로 두고 섞기만 한다.
 *
 * 요약문 빈칸 영작처럼 「보기 단어를 모두 한 번씩」 쓰는 유형에 쓴다. 원형으로 바꾸면
 * expresses가 express로, child's가 child로 되어 정답과 맞지 않는다.
 */
export function shuffleWordBankKeepForms(raw: string): string {
  const tokens = splitWordBank(scrubWordBankNoise(raw)).filter(Boolean);
  if (tokens.length === 0) return "";
  shuffleInPlace(tokens);
  return joinWordBank(tokens);
}

/** 표시용: 원형만 (재섞기 없음 — 매 렌더마다 순서가 바뀌지 않게). 끝의 -s는 떼지 않는다(명사 복수형 보존) */
export function lemmaWordBankOnly(raw: string): string {
  const tokens = splitWordBank(scrubWordBankNoise(raw))
    .map((t) => lemmaEnglishToken(t, { keepS: true }))
    .filter(Boolean);
  if (tokens.length === 0) return "";
  return joinWordBank(tokens);
}

/** 보기에 섞인 «에 없는 단어 추가 가능»·한글 잔여 제거 */
const EXTRA_WORD_RE =
  /(?:<\/?보기>|\s*보기)?\s*에\s*없는\s*단어\s*추가\s*가능|없는\s*단어\s*추가\s*가능/gi;

export function scrubWordBankNoise(raw: string): string {
  return (raw || "")
    .replace(/<\/?보기>/gi, "")
    .replace(EXTRA_WORD_RE, " ")
    .replace(/^○\s*.+$/gm, " ")
    .replace(/[\uAC00-\uD7A3]+/g, " ")
    .replace(/\/\s*\//g, "/")
    .replace(/^\s*\/\s*|\s*\/\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripExtraWordHint(conditions: string): {
  conditions: string;
  allowExtraWords: boolean;
} {
  let allowExtraWords = EXTRA_WORD_RE.test(conditions);
  EXTRA_WORD_RE.lastIndex = 0;
  let next = conditions
    .replace(EXTRA_WORD_RE, "")
    .replace(/\s*\/\s*$/g, "")
    .replace(/^\s*\/\s*/g, "")
    .replace(/\n{2,}/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^○\s*$/.test(l) && !/^·\s*$/.test(l))
    .join("\n")
    .trim();
  /*
   * 한 줄에 여러 조건이 / 로 이어진 경우 줄바꿈.
   * 조건 끝말(「~할 것」) 뒤의 / 만 나눈다 — 「cannot ~ too / enough를 사용할 것」처럼
   * 어법 이름 속 / 까지 잘라 조건 영작이 늘 버려졌다(2026-10-13 호원고1 47/48 대체).
   */
  const CONDITION_SPLIT = /(?<=(?:것|오|라|함)\.?)\s\/\s/;
  if (!/\n/.test(next) && CONDITION_SPLIT.test(next)) {
    next = next
      .split(CONDITION_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("○") || s.startsWith("·") ? s : `○ ${s}`))
      .join("\n");
  }
  if (allowExtraWords || /추가\s*가능/.test(conditions)) {
    allowExtraWords = true;
  }
  return { conditions: next, allowExtraWords };
}

/** questionText의 <보기>·<조건>을 정리해 다시 조립.
 * correctAnswer가 있으면 정답에 필요한 단어가 보기에 빠지지 않게 보정한다.
 */
export function normalizeWordOrderQuestionText(
  questionText: string,
  opts?: { correctAnswer?: string; mode?: WordOrderBankMode }
): string {
  const cleaned = (questionText || "")
    .replace(/<보기>(의|를|에|만|와|과|로|을|은|이|가)/g, "보기$1")
    .trim();
  if (!/<조건>/.test(cleaned) || !/<보기>/.test(cleaned) || !/<해석>/.test(cleaned)) {
    return questionText;
  }
  let conditions =
    cleaned.match(/<조건>\s*([\s\S]*?)(?=<보기>|$)/)?.[1]?.trim() ?? "";
  let words =
    cleaned.match(/<보기>\s*([\s\S]*?)(?=<해석>|$)/)?.[1]?.trim() ?? "";
  const translation =
    cleaned.match(/<해석>\s*([\s\S]*?)$/)?.[1]?.trim() ?? "";

  // 보기 본문에 섞인 안내·중복 태그·한글 잔여 제거
  words = scrubWordBankNoise(words)
    .replace(/가정법[\s\S]*?(?=\n|$)/g, "")
    .trim();
  // 조건에 문법 팁이 잘못 들어간 경우 조건만 남김 (긴 문법 설명은 제거하지 않되 보기 힌트는 분리)
  const stripped = stripExtraWordHint(conditions);
  conditions = stripped.conditions;
  if (stripped.allowExtraWords && !/어형|중복|추가|사용/.test(conditions)) {
    conditions = "○ 단어 중복·어형 변화 가능";
  } else if (stripped.allowExtraWords && !/추가/.test(conditions)) {
    /* keep */
  }

  const mode: WordOrderBankMode =
    opts?.mode ??
    (stripped.allowExtraWords || /추가\s*가능/.test(conditions)
      ? "add"
      : /어형|변화/.test(conditions)
        ? "inflect"
        : "basic");

  const answer = String(opts?.correctAnswer ?? "").trim();
  if (answer) {
    /*
     * 기본(어형 변화 없음)은 보기를 정답에 쓰인 꼴 그대로 다시 짠다 — 모델 보기가 원형 비교로 같아 보여도
     * (apple / apples) 그대로 두면 조건상 풀 수 없는 문항이 된다(선생님 2026-10-24).
     */
    const reconciled = buildWordBankFromAnswer(answer, mode, mode === "basic" ? "" : words);
    if (reconciled.length > 0) {
      shuffleInPlace(reconciled);
      words = joinWordBank(reconciled);
    } else {
      words = normalizeAndShuffleWordBank(words);
    }
  } else {
    words = normalizeAndShuffleWordBank(words);
  }

  const condBlock = conditions
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

  // add 모드: 조건에 "단어 추가 가능" 이 반드시 있어야 한다
  /*
   * 단어추가의 조건은 늘 이 두 줄로 고정한다. 모델이 「주어진 단어를 모두 한 번씩만 사용할 것」을
   * 남겨 두면, 정답에 makes가 필요한데 조건상 make를 바꿀 수 없는 문항이 된다
   * (2026-10-03 전수 대조: Born English 단어추가 3개가 모두 이랬다).
   */
  if (mode === "add") {
    const finalCond = "○ 단어 중복·어형 변화 가능\n○ 보기에 없는 단어 추가 가능";
    return `<조건>\n${finalCond}\n\n<보기>\n${words}\n\n<해석>\n${translation}`.trim();
  }
  // 기본: 보기가 정답 꼴 그대로이므로 조건도 「어형을 바꾸지 말 것」으로 고정한다(「필요 시 어형 변화 가능」이 섞여 나왔다)
  if (mode === "basic") {
    const rest = condBlock
      .split("\n")
      .filter((l) => !/어형|형태|단어를\s*모두|한 번씩/.test(l));
    const finalCond = ["○ 주어진 단어를 모두 한 번씩만 사용할 것 (어형을 바꾸지 말 것)", ...rest].join("\n");
    return `<조건>\n${finalCond}\n\n<보기>\n${words}\n\n<해석>\n${translation}`.trim();
  }

  return `<조건>\n${condBlock}\n\n<보기>\n${words}\n\n<해석>\n${translation}`.trim();
}



/**
 * 어형변화: 해설이 「destine을 destined로 바꾼다」고 했는데 보기에 이미 destined가 있으면,
 * 보기 낱말을 해설이 말한 원래 꼴(destine)로 돌려 둘을 맞춘다.
 *
 * 2026-10-03 대조에서 어형변화마다 이 어긋남이 나왔다(#86 ideas, #91 exhaled, #95 destined).
 * 모델이 보기에 바뀐 꼴을 넣고, 해설은 원형에서 바꾼다고 쓴 것이다. 원형 변환기로는 -ed·-ing를
 * 다 돌릴 수 없어, 해설이 직접 밝힌 짝만 쓴다.
 */
export function alignInflectBankToExplanation(questionText: string, explanation: string): string {
  const m = questionText.match(/(<보기>\s*\n)([^\n]+)/);
  if (!m) return questionText;
  const tokens = splitWordBank(m[2]!);
  if (tokens.length === 0) return questionText;
  const pairRe = /([A-Za-z][A-Za-z'-]*)\s*(?:은|는|을|를|이|가)\s*(?:각각\s*)?(?:[가-힣]+\s+)?([A-Za-z][A-Za-z'-]*)\s*(?:으로|로)(?![가-힣])|([A-Za-z][A-Za-z'-]*)\s*(?:→|->)\s*([A-Za-z][A-Za-z'-]*)/g;
  let changed = false;
  for (const p of String(explanation ?? "").matchAll(pairRe)) {
    const src = (p[1] ?? p[3] ?? "").trim();
    const dst = (p[2] ?? p[4] ?? "").trim();
    if (!src || !dst || src.toLowerCase() === dst.toLowerCase()) continue;
    // 같은 낱말의 다른 꼴일 때만(어간이 같거나 불규칙 짝). 「that은 because로 이어진다」 같은 짝은 건드리지 않는다.
    if (!sameLexeme(src, dst)) continue;
    const hasSrc = tokens.some((t) => t.toLowerCase() === src.toLowerCase());
    const at = tokens.findIndex((t) => t.toLowerCase() === dst.toLowerCase());
    if (!hasSrc && at >= 0) {
      tokens[at] = src.toLowerCase();
      changed = true;
    }
  }
  if (!changed) return questionText;
  return questionText.replace(m[0], `${m[1]}${joinWordBank(tokens)}`);
}

const IRREGULAR_FAMILIES: string[][] = [
  ["be", "am", "is", "are", "was", "were", "been", "being"],
  ["have", "has", "had", "having"],
  ["do", "does", "did", "done", "doing"],
  ["will", "would"], ["can", "could"], ["shall", "should"], ["may", "might"],
  ["go", "goes", "went", "gone"], ["make", "made"], ["take", "took", "taken"], ["give", "gave", "given"],
  ["bring", "brought"], ["buy", "bought"], ["think", "thought"], ["teach", "taught"], ["catch", "caught"],
  ["see", "saw", "seen"], ["come", "came"], ["become", "became"], ["get", "got", "gotten"], ["find", "found"],
  ["leave", "left"], ["keep", "kept"], ["feel", "felt"], ["lead", "led"], ["hold", "held"], ["stand", "stood"],
  ["understand", "understood"], ["write", "wrote", "written"], ["speak", "spoke", "spoken"], ["know", "knew", "known"],
  ["grow", "grew", "grown"], ["show", "showed", "shown"], ["begin", "began", "begun"], ["run", "ran"],
  ["child", "children"], ["person", "people"], ["man", "men"], ["woman", "women"], ["mouse", "mice"], ["foot", "feet"], ["tooth", "teeth"],
  ["good", "better", "best"], ["bad", "worse", "worst"], ["many", "more", "most"], ["much", "more", "most"], ["little", "less", "least"],
];
/** 두 낱말이 같은 낱말의 다른 꼴인지(어간 앞 세 글자가 같거나, 불규칙 짝) */
function sameLexeme(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length >= 3 && y.length >= 3 && x.slice(0, 3) === y.slice(0, 3)) return true;
  if (Math.min(x.length, y.length) <= 2 && (y.startsWith(x) || x.startsWith(y))) return true;
  return IRREGULAR_FAMILIES.some((f) => f.includes(x) && f.includes(y));
}

/**
 * 정답 첫 낱말이 고유명사면 <보기>에서도 대문자로 둔다.
 *
 * keepProperCase는 첫 자리를 늘 소문자로 내린다(문장 첫 대문자와 구별이 안 된다). 그래서
 * 「Kool Herc’s style …」의 Kool이 보기에 「kool」로 나갔다(2026-10-07 대공황·힙합 작업).
 * 지문 문장 가운데서도 대문자로 쓰인 낱말이면 고유명사로 보고 되살린다.
 */
export function restoreLeadingProperNoun(questionText: string, correctAnswer: string, passage: string): string {
  const m = questionText.match(/(<보기>\s*\n)([^\n]+)/);
  if (!m) return questionText;
  const tokens = m[2]!.split(" / ");
  const p = String(passage ?? "");
  const words = String(correctAnswer ?? "").trim().match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  let changed = false;
  words.forEach((w, k) => {
    if (!/[A-Z]/.test(w) || w === w.toLowerCase()) return;
    if (k === 0 && !/[A-Z]/.test(w.slice(1))) {
      // 첫 낱말이 대문자로 시작하기만 하면 문장 첫머리라서일 수 있다 — 지문 문장 가운데에 대문자로 나오고 소문자로는 안 나와야 고유명사다
      if (!new RegExp(`[A-Za-z0-9][,;]?\\s+${w}\\b`).test(p)) return;
      // the·with처럼 지문에 소문자로도 나오면 고유명사가 아니다(제목 속 「The Saturday Evening Post」에 걸렸다)
      if (new RegExp(`\\b${w.toLowerCase()}\\b`).test(p)) return;
    }
    /*
     * 문장 가운데 대문자 낱말(the Bronx, Kuo)과 안에 대문자가 든 낱말(DJing)은 고유명사·약어다.
     * 보기를 원형으로 만들며 소문자가 된 것을 되돌린다(2026-10-10 점검: bronx·kuo·djing).
     */
    const i = tokens.findIndex((t) => t.trim() === w.toLowerCase());
    if (i < 0) return;
    tokens[i] = w;
    changed = true;
  });
  return changed ? questionText.replace(m[0], `${m[1]}${tokens.join(" / ")}`) : questionText;
}
