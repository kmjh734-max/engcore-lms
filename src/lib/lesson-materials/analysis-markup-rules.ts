/**
 * 이름표·설명이 붙은 자리가 그 이름표의 모양과 맞는지, 성분의 층(level)이 절 구조와 맞는지를
 * 모델 없이 코드로 맞춘다(2026-10-22, 선생님: 결과가 확실히 나오게).
 *
 * 1) labelFitsSpan — 이름표마다 「이 글자가 꼭 있어야 한다」는 모양 규칙. 안 맞으면 그 이름표·설명을 뺀다
 *    (틀린 표시를 찍느니 비운다). 모양 규칙이 없는 이름표는 손대지 않는다. 바로 앞 두 낱말도 같이 본다
 *    (is [quite different]처럼 동사를 뺀 구간이 흔하다).
 * 2) raiseRoleLevels — 괄호·관계사절 이름표로 절 구간을 알 수 있으니, 그 안의 성분은 그 깊이만큼
 *    층을 올린다(because절 안 관계사절의 that happen → 2). 내리지는 않는다(괄호가 빠졌을 수 있다).
 * 만들 때와 저장본을 읽을 때 둘 다 지나므로 예전 분석지에도 바로 반영된다.
 * 저장된 539문장으로 맞춰 봄(scripts/tmp-rv/ana-1022/rules-test.mts).
 */
import type { MarkupBracket, MarkupRoleMark, MarkupSpan, MarkupSpanNote } from "@/lib/lesson-materials/analysis-markup";

const PP_IRREGULAR =
  "made|done|known|born|built|shown|given|taken|written|seen|used|left|kept|held|brought|set|put|lit|led|grown|thrown|worn|torn|chosen|frozen|spoken|broken|hidden|driven|drawn|eaten|fallen|forgotten|gotten|hung|laid|lost|paid|read|sold|sent|spent|told|understood|won|bought|caught|taught|thought|felt|heard|meant|run|cut|hit|shut|spread|become|begun|come|gone|had|said|been|proven|lain|risen|struck|sung|swung|woven|bitten|beaten|blown|flown|sewn|shaken|stolen|sworn|woken|withdrawn|overcome|undertaken|bound|dug|fed|fled|fought|ground|lent|met|slid|stuck|stung|swept|wound|found|called";
const PP = `(?:\\w+(?:ed|en)|\\w*(?:${PP_IRREGULAR}))`;
const BE = "(?:am|is|are|was|were|be|been|being)";
const MODAL = "(?:can|could|will|would|shall|should|may|might|must|cannot)";
/** 조동사 공유 병렬에서 「공유」될 수 있는 말(have to·be동사·have도 포함) */
const AUX_SHARE = `(?:${MODAL}|has to|have to|had to|${BE}|has|have|had|do|does|did|used to)`;
const PREP = "(?:by|of|in|for|to|at|on|with|from|about|after|before|without|through|into|upon|despite|instead of|besides|like|than|toward|towards|against|while|when|as|during|under|over|onto|within)";
const ADV = "(?:\\w+ly|also|just|still|often|always|already|even|only|really|never|not|simply|first|once|again|all|both|then|ever|usually|sometimes|now|yet|soon|much|well|long|here|there|far)";
const PRON = "(?:i|you|he|she|it|we|they|there|this|that|these|those|\\w+)";
const WH = "(?:what|who|whom|whose|which|when|where|why|how|whether|if)";
const REL = "(?:who|whom|whose|which|that|where|when|why|how)";
const CONJ_TIME = "(?:when|whenever|while|before|after|until|till|as|once|since|as soon as|by the time|every time|the moment|the first time|the next time|now that)";
const CONJ_COND = "(?:if|unless|once|as long as|provided|providing|in case|suppose|supposing|only if|even if)";
const CONJ_REASON = "(?:because|since|as|now that|for|in that|seeing that)";
const CONJ_CONC = "(?:though|although|even though|even if|while|whereas|whatever|however|no matter|despite the fact|even when)";
const LINK = `(?:${BE}|isn't|aren't|wasn't|weren't|become|becomes|became|seem|seems|seemed|remain|remains|remained|get|gets|got|turn|turns|turned|grow|grows|grew|look|looks|looked|sound|sounds|sounded|feel|feels|felt|smell|smells|taste|tastes|appear|appears|appeared|stay|stays|stayed|keep|keeps|kept|prove|proves|proved|proven|go|goes|went|come|comes|came|lie|lies|lay|fall|falls|fell|stand|stands|stood|sit|sits|sat)`;
/** -ing로 끝나지만 동명사·분사가 아닌 흔한 말 */
const NOT_ING = /^(?:thing|things|during|something|anything|nothing|everything|morning|evening|string|spring|bring|sing|king|ring|wing|ceiling|clothing|sibling|siblings|darling|pudding|wedding|shilling|herring)$/i;

const r = (s: string) => new RegExp(s, "i");
const b = (s: string) => r(`(?:^|[^A-Za-z'])${s}(?![A-Za-z])`);
const start = (s: string) => r(`^[“"'(\\[]?(?:\\w+,? )?${s}(?![A-Za-z])`);
const bePP = b(`${BE}(?: ${ADV})* ${PP}`);
const modalBePP = b(`${MODAL}(?: ${ADV})* be(?: ${ADV})* ${PP}`);
const TO_V = b("to(?: \\w+ly)? [a-z]+");
const hasPP = b(PP);
const ingWord = (t: string) => /\b[A-Za-z]{2,}ing\b/i.test(t) && (t.match(/\b[A-Za-z]{2,}ing\b/gi) ?? []).some((w) => !NOT_ING.test(w));
const ING: Rule = (t) => ingWord(t);
const ING_OR_PP: Rule = (t) => ingWord(t) || hasPP.test(t);
const PARALLEL = r("\\b(?:and|or|but|nor)\\b|,|\\brather than\\b|\\bas well as\\b");

type Rule = RegExp | ((t: string) => boolean);
const test = (rule: Rule, t: string) => (rule instanceof RegExp ? rule.test(t) : rule(t));

/**
 * 이름표 → 그 자리에 있어야 하는 모양. 모든 조건을 만족해야 한다. 여기 없는 이름표는 검사하지 않는다.
 * 보수적으로 잡는다 — 맞는 표시를 떼는 쪽이 더 나쁘다.
 */
const SHAPE: Record<string, Rule[]> = {
  수동태: [bePP],
  "조동사 수동": [modalBePP],
  "완료 수동": [b(`(?:has|have|had) (?:${ADV} )*been (?:${ADV} )*${PP}`)],
  "진행 수동": [b(`${BE} (?:${ADV} )*being ${PP}`)],
  "5형식 수동": [bePP],
  "4형식 수동": [bePP],
  "사역동사 수동": [b(`${BE} (?:${ADV} )*(?:made|let|had) to`)],
  현재완료: [b(`(?:has|have)(?: ${ADV}| ${PRON})* ${PP}`)],
  과거완료: [r(`(?:^|[^A-Za-z])(?:had|\\w+'d)(?: ${ADV}| ${PRON})* ${PP}(?![A-Za-z])`)],
  완료진행: [b("(?:has|have|had)(?: \\w+)* been \\w+ing")],
  현재진행: [b(`(?:am|is|are)(?: ${ADV}| ${PRON})* \\w+ing`)],
  과거진행: [b(`(?:was|were)(?: ${ADV}| ${PRON})* \\w+ing`)],
  "would 과거 습관": [b("would")],
  "조동사+have p.p.": [b(`(?:may|might|must|could|should|would|can't|cannot|couldn't|needn't)(?: not)? have ${PP}`)],
  "조동사 공유 병렬": [b(AUX_SHARE), b("and|or|but|nor")],
  "동사 병렬": [b("and|or|but|nor")],
  병렬구조: [PARALLEL],
  "준동사 병렬": [PARALLEL],
  "명사구 병렬": [PARALLEL],
  "등위 병렬": [PARALLEL],
  "절 병렬": [b("and|or|but|nor|so")],
  "to 공유 병렬": [b("to"), b("and|or")],
  "반복 that 병렬": [r("\\bthat\\b.*\\b(?:and|or)\\b.*\\bthat\\b")],
  등위절: [start("(?:and|but|or|so|yet|nor|for)")],
  "시간 부사절": [start(CONJ_TIME)],
  "비례 부사절": [r("^[“\"'(\\[]?(?:as|the \\w+er|the more|the less)(?![A-Za-z])")],
  "이유 부사절": [start(CONJ_REASON)],
  "조건 부사절": [start(CONJ_COND)],
  "양보 부사절": [start(CONJ_CONC)],
  "목적 부사절": [start("(?:so that|in order that|so|lest|that)")],
  "결과 부사절": [start("(?:so that|so|that)")],
  "양태 부사절": [start("(?:as|like|as if|as though|the way|just as)")],
  "시간·조건절 현재": [start(`(?:${CONJ_TIME}|${CONJ_COND})`)],
  "that 명사절": [start("that")],
  "동격 that": [b("that")],
  "접속사 that 생략": [r("^(?!that\\b)")],
  "whether/if 명사절": [start("(?:whether|if)")],
  간접의문문: [start(WH)],
  "간접의문문 어순": [start(WH)],
  "의문사 명사절": [start(WH)],
  의문사절: [start(WH)],
  "관계대명사 what": [b("what")],
  관계사절: [b(REL)],
  "주격 관계대명사": [b("(?:who|which|that)")],
  "목적격 관계대명사": [b("(?:whom|which|that|who)")],
  "소유격 관계대명사": [b("whose")],
  "계속적 용법": [b("(?:who|whom|whose|which|where|when)")],
  "전치사+which": [b(`${PREP} (?:which|whom)`)],
  "관계부사 where": [b("where")],
  "관계부사 when": [b("when")],
  "관계부사 why": [b("why")],
  "관계부사 how": [b("how")],
  관계부사절: [b("(?:where|when|why|how)")],
  복합관계사: [b("(?:whatever|whenever|wherever|whoever|whichever|however|whomever)")],
  "전치사+동명사": [(t) => r(`(?:^|[^A-Za-z'])${PREP}(?: \\w+)? [A-Za-z]{2,}ing(?![A-Za-z])`).test(t) && ingWord(t)],
  "동명사 주어": [ING],
  "동명사 주어 수일치": [ING],
  동명사구: [ING],
  동명사: [ING],
  "동사+동명사": [ING],
  "분사 명사 수식": [ING_OR_PP],
  현재분사: [ING],
  과거분사: [hasPP],
  "분사 능동·수동": [ING_OR_PP],
  "축약 관계절": [ING_OR_PP],
  분사구문: [ING_OR_PP],
  "능동 분사구문": [ING],
  "수동 분사구문": [hasPP],
  "접속사+분사구문": [start("(?:while|when|after|before|although|though|if|unless|once|until|as)"), ING_OR_PP],
  독립분사구문: [ING_OR_PP],
  "with+O+분사": [start("with"), ING_OR_PP],
  "주어+be 생략": [start("(?:while|when|though|although|if|unless|once|until|as|whenever|where)")],
  to부정사: [TO_V],
  "명사적 용법 to부정사": [TO_V],
  "형용사적 용법": [TO_V],
  "부사적 용법": [TO_V],
  "목적격보어 to부정사": [TO_V],
  "가주어+to부정사": [b("it"), TO_V],
  "가주어 it": [b("it")],
  수동부정사: [b(`to be ${PP}`)],
  "수동 to부정사": [b(`to be ${PP}`)],
  완료부정사: [b(`to have ${PP}`)],
  "의미상 주어 for/of": [b("(?:for|of) \\w+(?: \\w+)? to")],
  "there be 수일치": [b("there")],
  "부분 표현": [b("of"), b("(?:some|most|half|much|many|part|all|none|one|two|three|four|five|six|seven|eight|nine|ten|\\w+-\\w+|hundred|thousand|hundreds|thousands|millions|dozens|several|few|percent|per cent|majority|minority|rest|each|both|quarter|third|fraction|number|amount|lot|lots|plenty|\\d+)")],
  "부정어 도치": [start("(?:not|never|little|seldom|rarely|hardly|scarcely|only|no|nor|neither|nowhere|under no)")],
  "장소 도치": [start(`${PREP}|here|there`)],
  강조구문: [r("^[“\"'(]?it (?:is|was)\\b"), b("(?:that|who|which)")],
  "강조의 do": [b("(?:do|does|did) [a-z]+")],
  "부분 부정": [b("(?:not|never)"), b("(?:all|every|always|necessarily|both|entirely|completely|whole|everything|everyone|altogether)")],
  비교급: [r("\\b(?:\\w+er|more|less|fewer|better|worse|further)\\b")],
  "비교 대상": [b("(?:than|as)")],
  "as ... as 구문": [r("\\bas\\b.*\\bas\\b")],
  "원급 비교": [r("\\bas\\b.*\\bas\\b")],
  "최상급 표현": [r("\\b(?:\\w+est|most|best|worst|least)\\b")],
  "one of 최상급": [b("one of")],
  "not only A but also B": [b("not only")],
  "both A and B": [b("both"), b("and")],
  "either A or B": [b("either")],
  "neither A nor B": [b("neither")],
  "so ... that 구문": [b("so")],
  "too ... to 구문": [b("too")],
  "enough to 구문": [b("enough")],
  "enough to 결과 관계": [b("enough")],
  "have+O+p.p.": [b(`(?:have|has|had|having) \\w+(?: \\w+)* ${PP}`)],
  "대명사 선행사": [r("^[“\"'(]?(?:it|its|they|them|their|this|that|these|those|he|she|him|her|his|one|ones|such|itself|themselves)(?![A-Za-z])")],
  "it 지시": [b("it")],
  "대동사 do": [b("(?:do|does|did)")],
  "감정 형용사+that절": [b("that|glad|sure|afraid|sorry|happy|surprised|hopeful|certain|proud|aware|worried|disappointed|confident|pleased|shocked|amazed")],
  "2형식": [b(LINK)],
  "연결동사 보어": [b(LINK)],
  주격보어: [b(LINK)],
  "필수 전치사": [b(PREP + "|as")],
  "부정 범위": [r("\\b(?:not|never|no|nothing|nobody|cannot|none)\\b")],
  "by the time": [b("by the time")],
  "since/for": [b("(?:since|for)")],
  "otherwise 가정": [b("otherwise")],
  "as if 과거": [b("as (?:if|though)")],
  "관계절 수일치": [b(REL)],
  "관계절 선행사 수일치": [b(REL)],
  "사역동사+O+원형": [b("(?:make|makes|made|making|let|lets|have|has|had)")],
  "사역동사 능동": [b("(?:make|makes|made|making|let|lets|have|has|had|get|gets|got)")],
  "지각동사 보어": [b("(?:see|sees|saw|seen|hear|hears|heard|watch|watches|watched|feel|feels|felt|notice|notices|noticed|observe|observed|witness|witnessed|look at|listen to)")],
  "사역·지각 원형 분석": [b("(?:make|makes|made|let|lets|have|has|had|see|saw|hear|heard|watch|watched|feel|felt|notice|noticed)")],
  "문장 부사": [r("\\b\\w+ly\\b|\\b(?:however|indeed|in fact|of course|sadly|luckily|perhaps|maybe|still|then|thus|therefore|meanwhile|so)\\b")],
  삽입구: [r("^(?!(?:such as|including|like|especially)\\b)")],
};

/** 바로 앞 낱말까지 같이 봐야 하는 이름표(동사·전치사를 뺀 구간이 흔하다) */
const WITH_BEFORE = new Set([
  "2형식", "연결동사 보어", "주격보어", "전치사+동명사", "조동사 공유 병렬", "수동태", "현재완료", "과거완료",
  "조동사 수동", "완료 수동", "진행 수동", "현재진행", "과거진행", "완료진행", "5형식 수동", "4형식 수동", "동명사",
  "동사+동명사", "가주어 it", "부분 표현", "필수 전치사", "it 지시", "대명사 선행사",
]);

/** 축약형을 풀어 쓴다('ve made → have made). 's·'d는 둘 중 무엇인지 몰라 그대로 둔다. */
function expand(t: string): string {
  return t
    .replace(/[’‘]/g, "'")
    .replace(/\b(\w+)n't\b/gi, "$1 not")
    .replace(/\bcan not\b/gi, "cannot")
    .replace(/'ve\b/gi, " have")
    .replace(/'re\b/gi, " are")
    .replace(/'m\b/gi, " am")
    .replace(/'ll\b/gi, " will")
    .replace(/\s+/g, " ")
    .trim();
}

/** 이름표가 그 자리의 모양과 맞는가. before는 구간 바로 앞 글자(두 낱말쯤). 모양 규칙이 없는 이름표는 true. */
export function labelFitsSpan(label: string, spanText: string, before = ""): boolean {
  const rules = SHAPE[label];
  if (!rules) return true;
  const span = expand(spanText);
  if (rules.every((rule) => test(rule, span))) return true;
  if (!WITH_BEFORE.has(label)) return false;
  const lead = expand(before).split(" ").filter(Boolean).slice(-2).join(" ");
  if (!lead) return false;
  return rules.every((rule) => test(rule, `${lead} ${span}`));
}

/** 절을 여는 말로 시작하는 구간인가(준동사구·명사구는 절이 아니다). */
const CLAUSE_HEAD = r(
  `^[“"'(\\[]?(?:(?:${PREP}|and|but|or|so|yet|,) )?(?:${REL}|${WH}|${CONJ_TIME}|${CONJ_COND}|${CONJ_REASON}|${CONJ_CONC}|so that|in order that|that|whatever|whenever|wherever|whoever|whichever|however|there)(?![A-Za-z])\\s*(\\S*)`
);
const CLAUSE_LABEL = /관계|명사절|부사절|의문|계속적 용법|동격 that|복합관계사|whether\/if|관계부사|강조구문/;

const inside = (a: MarkupSpan, c: MarkupSpan) => c.start <= a.start && a.end <= c.end && !(a.start === c.start && a.end === c.end);
const nearSame = (a: MarkupSpan, c: MarkupSpan) => Math.abs(a.start - c.start) <= 2 && Math.abs(a.end - c.end) <= 2;

function isClauseRegion(text: string, span: MarkupSpan): boolean {
  if (span.end - span.start >= text.length * 0.8) return false;
  const m = CLAUSE_HEAD.exec(text.slice(span.start, span.end));
  if (!m) return false;
  // when dealing · after taking 처럼 접속사 뒤가 바로 준동사면 절이 아니다
  const next = (m[1] ?? "").replace(/[^A-Za-z]/g, "");
  if (next && (/ing$/i.test(next) || hasPP.test(` ${next}`))) return false;
  return true;
}

/**
 * 괄호·이름표가 보여 주는 절 깊이만큼 성분의 층을 올린다. 선생님이 고친 성분은 두고, 내리지는 않는다.
 */
export function raiseRoleLevels(
  text: string,
  roles: MarkupRoleMark[],
  brackets: MarkupBracket[],
  notes: MarkupSpanNote[]
): MarkupRoleMark[] {
  const regions: MarkupSpan[] = [];
  const add = (s: MarkupSpan) => {
    if (!isClauseRegion(text, s)) return;
    if (regions.some((x) => nearSame(x, s))) return;
    regions.push(s);
  };
  for (const bk of brackets) if (bk.kind !== "inserted") add(bk.span);
  for (const n of notes) if (n.label !== "등위절" && CLAUSE_LABEL.test(n.label)) add(n.span);
  if (regions.length === 0) return roles;
  // 모든 성분이 그 안에 들어 있는 구간은 주절 자체다(Then what are the key factors ~?) — 올리지 않는다
  const live = roles.filter((x) => !x.edited);
  const clauses = regions.filter((reg) => !live.every((x) => inside(x.span, reg) || (x.span.start === reg.start && x.span.end === reg.end)));
  if (clauses.length === 0) return roles;
  return roles.map((role) => {
    if (role.edited) return role;
    const depth = clauses.filter((reg) => inside(role.span, reg)).length;
    const level = Math.min(2, depth) as 0 | 1 | 2;
    return level > role.level ? { ...role, level } : role;
  });
}
