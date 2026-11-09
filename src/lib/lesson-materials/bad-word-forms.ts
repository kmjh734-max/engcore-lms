/**
 * 파생어가 아닌 짝(낱말>꼴). 윌링어학원 단어장 370낱말을 하나하나 읽어 골랐다(2026-10-30) — 뿌리가 다른 말(concerto → concerted),
 * 지어낸 말(perspectively), 변화형(lacks)을 모델이 파생어로 주어 시험 문항이 틀리게 나왔다.
 * 같은 날 전 학원 1,055쌍을 마저 읽어 더했다(fund → fundamental, university → universal 등).
 */
const BAD_FORM_PAIRS = new Set([
  "accompany>accompanied",
  "affect>affection",
  "affect>effect",
  "amplify>amplified",
  "award-winning>awarded",
  "citizen>citizenly",
  "content>contend",
  "cultivate>cultured",
  "currently>currency",
  "deny>denied",
  "design>designable",
  "differentiate>differentiable",
  "dig>diggable",
  "domain>dominant",
  "domain>dominate",
  "ensure>ensurer",
  "foster>fosterer",
  "fund>fundamental",
  "fund>fundamentally",
  "generate>generously",
  "ideal>ideality",
  "index>indicate",
  "interface>interact",
  "likely>likelier",
  "location>local",
  "mean>meanly",
  "minor>minutely",
  "objection>objective",
  "optimistic>optimally",
  "pose>position",
  "primary>primariness",
  "source>sourceless",
  "story>storied",
  "supply>supplied",
  "temperature>temper",
  "temperature>temperate",
  "tool>toolless",
  "university>universal",
  "university>universally",
  "version>versatilely",
  "capture>captivating",
  "chew>chewer",
  "cling>clingingness",
  "concern>concernment",
  "concerto>concerted",
  "council>counsel",
  "criterion>critical",
  "criterion>critically",
  "device>deviceful",
  "disability>disabuse",
  "discard>discards",
  "fade>fader",
  "flourish>flourisher",
  "formation>formal",
  "former>form",
  "hardship>hardly",
  "increase>increaser",
  "instance>instant",
  "instance>instantly",
  "intention>intended",
  "lack>lacks",
  "magnificent>magnify",
  "major>majorly",
  "majority>majorly",
  "mean>meaningly",
  "minor>minimize",
  "monitor>monitors",
  "perspective>perspectively",
  "possible>positively",
  "prime>primer",
  "prominent>promote",
  "quality>qualify",
  "revolutionary>revolve",
  "rise>riser",
  "solution>solving",
  "sought>seeking",
  "subordinate>subordinately",
  "tale>told",
  "tend>tender",
  "term>terminal",
  "term>terminate",
  "verse>versatile",
  "verse>versatilely",
  "version>versatile",
  "wild>wilder",
]);

/** -s만 붙여도 뜻이 따로 있는 명사 */
const PLURAL_FORM_OK = new Set(["remains", "dynamics", "genetics", "economics", "electronics", "physics", "politics", "ethics"]);

export function isBadWordForm(word: string, form: string): boolean {
  const w = word.trim().toLowerCase();
  const f = form.trim().toLowerCase();
  if (BAD_FORM_PAIRS.has(`${w}>${f}`)) return true;
  // 복수·3인칭 변화형(dump → dumps)은 파생어가 아니다
  return (f === `${w}s` || f === `${w}es`) && !PLURAL_FORM_OK.has(f);
}

/** 사람 이름 같은 고유명사 낱말(tilly — 뜻이 「틸리, 고유명사」「틸리, 인물 이름」 등으로 저장돼 있다) — 단어 시험·단어장에 넣지 않는다 */
export function isProperNounVocab(word: string, meaning: string | null | undefined): boolean {
  return /^tilly$/i.test(word.trim()) || /고유명사|(인물|사람|인공지능|로봇|등장인물) ?이름|인명|지명/.test(meaning ?? "");
}

/**
 * 자료함 「단어」 탭 단어장용: 「지명」은 땅 이름만 — 지명하다(nominate)·지명된 사람(nominee)·선견지명(vision)은
 * 보통 낱말이라 시험에 낸다(2026-11-09). 수업용 자료 단어 정리는 이미 인쇄한 번호가 바뀌지 않게 위 규칙 그대로 둔다.
 */
export function isProperNounVocabStrict(word: string, meaning: string | null | undefined): boolean {
  return /^tilly$/i.test(word.trim()) || /고유명사|(인물|사람|인공지능|로봇|등장인물) ?이름|인명|(?<!견)지명(?![하되된])/.test(meaning ?? "");
}

/** 동의어·반의어 칸에 모델이 「없음」 대신 적은 글자(none) — 보기로 나오면 안 된다 */
export function isEmptyVocabWord(word: string): boolean {
  return /^(none|n\/a|nil|null|없음|-+)$/i.test(word.trim());
}

/** 모델이 잘못 만든 원형을 바로잡는다(endowe → endow) — 이미 저장된 단어를 읽을 때 쓴다 */
export function fixVocabWord(word: string): string {
  return word.trim().toLowerCase() === "endowe" ? "endow" : word;
}
