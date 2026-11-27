/**
 * 조건 영작에 쓰는 어법 목록.
 *
 * 선생님 지적(2026-09-28): 「반드시 등위 병렬을 사용할 것」처럼 말이 안 되는 조건이 나왔다.
 * 지금까지는 1장 요약자료의 「어법 고르기」 목록을 그대로 썼는데, 고르는 문항과 직접
 * 만들어 내는 영작은 기준이 다르다. 그래서 영작 조건으로 말이 되는 것만 따로 모은다.
 * 수일치·대명사 선행사처럼 「틀린 곳 고르기」에만 쓰는 것은 여기에 넣지 않는다.
 *
 * label     — 조건에 그대로 적는 이름
 * form      — 이름 뒤 괄호에 붙이는 형태. 학생이 무엇을 쓸지 바로 알게 한다.
 * hint      — 화면에서 범위를 고를 때 보여 주는 한 줄 설명
 * check     — 정답 문장에 그 어법이 정말 쓰였는지 보는 식(눈으로 알아볼 수 있는 것만)
 *
 * 시험지 <조건>에는 이름과 형태만 싣는다. 선생님 지적(2026-09-28): 「선행사를 쓰지 말고
 * what으로 시작할 것」 같은 설명까지 적으면 답을 알려 주는 셈이라 필요 없다.
 */
export type WritingGrammar = {
  label: string;
  form: string;
  hint: string;
  check?: RegExp;
  /** 이 어법이 나오는 고등 교과서 종수 — 자주 나오는 것부터 보여 준다 */
  textbookBooks?: number;
};

export const WRITING_GRAMMARS: WritingGrammar[] = [
  // ── 동사의 꼴 ──
  {
    label: "수동태",
    form: "be + p.p.",
    hint: "주어가 동작을 당하는 쪽이면 be동사 뒤에 과거분사를 쓴다.",
    // be 와 분사 사이에 부사가 끼어도 알아본다 — can be <b>continuously</b> updated
    check: /\b(am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+|not\s+|also\s+|already\s+|still\s+|often\s+|never\s+|always\s+){0,2}(\w+ed|\w+en|done|made|given|taken|written|built|held|kept|told|sought|bought|brought|thought|taught|caught|fought|found|paid|said|sold|left|lost|meant|met|sent|spent|felt|heard|led|read|set|put|cut|hit|hurt|shut|spread|understood|won|hung|struck|stuck|dug|fed|bound|sung|rung|begun|drunk|sunk|spun|run|come|become|overcome|born|borne|worn|torn|sworn|shown|known|grown|thrown|drawn|flown|blown|laid|shot|bent|lent|dealt|swept|wept|slept)\b/i,
    // 불규칙 과거분사를 더 넣었다 — 「is always sought by」를 수동태가 아니라며 세 번 버렸다(2026-11-28 시험)
    textbookBooks: 2,
  },
  {
    label: "제안·요구 동사의 that절",
    form: "suggest/insist + that + (should) 동사원형",
    hint: "요구·제안·주장 동사의 that절에는 동사원형을 쓴다(should는 생략 가능).",
    check: /\b(suggest|suggests|suggested|insist|insists|insisted|demand|demands|demanded|require|requires|required|recommend|recommends|recommended|propose|proposes|proposed|order|orders|ordered)\b[\s\S]{0,40}?\bthat\b/i,
    textbookBooks: 7,
  },

  // ── 가정법·도치·강조 ──
  {
    label: "가정법 과거",
    form: "If + 과거동사, 주어 + would/could + 동사원형",
    hint: "지금 사실과 반대되는 일을 가정한다.",
    check: /\bif\b[\s\S]*\b(would|could|might)\s+\w+/i,
    textbookBooks: 2,
  },
  {
    label: "가정법 과거완료",
    form: "If + had p.p., 주어 + would have p.p.",
    hint: "지난 사실과 반대되는 일을 가정한다.",
    check: /\bif\b[\s\S]*\bhad\s+\w+[\s\S]*\b(would|could|might)\s+have\b/i,
    textbookBooks: 4,
  },
  {
    label: "부정어 도치",
    form: "Never/Not only + 조동사 + 주어",
    hint: "부정어가 문장 맨 앞에 오면 주어와 (조)동사의 자리가 바뀐다.",
    check: /^\s*(never|not only|rarely|seldom|little|no sooner|hardly|scarcely|not until)\b/i,
    textbookBooks: 11,
  },
  {
    label: "It - that 강조구문",
    form: "It is ~ that …",
    hint: "강조할 말을 It is와 that 사이에 넣는다.",
    check: /\bit\s+(is|was)\b[\s\S]{2,60}?\bthat\b/i,
    textbookBooks: 9,
  },

  // ── 관계사 ──
  {
    label: "관계대명사",
    form: "who / which / that",
    hint: "앞의 명사를 꾸미는 절을 이끈다. 절 안에 주어나 목적어가 비어 있다.",
    check: /\b(who|whom|whose|which|that)\b/i,
    textbookBooks: 5,
  },
  {
    label: "관계대명사 what",
    form: "what + 불완전한 절",
    hint: "꾸밀 명사가 앞에 없을 때 쓴다. 그 자체가 명사 노릇을 한다.",
    check: /\bwhat\b/i,
    textbookBooks: 12,
  },
  {
    label: "관계부사",
    form: "where / when / why / how",
    hint: "장소·때·까닭을 나타내는 명사 뒤에 완전한 절이 온다.",
    check: /\b(where|when|why|how)\b/i,
    textbookBooks: 13,
  },
  {
    label: "관계대명사 계속적 용법",
    form: "…, which / …, who",
    hint: "콤마 뒤에 덧붙여 설명한다. that은 쓸 수 없다.",
    check: /,\s*(which|who|whom|whose)\b/i,
    textbookBooks: 12,
  },

  // ── 준동사 ──
  {
    label: "분사구문",
    form: "V-ing …, 주어 + 동사",
    hint: "접속사와 주어를 없애고 분사로 줄인 부사구.",
    check: /(^\s*\w+ing\b[\s\S]*,)|(,\s*\w+ing\b)/i,
    textbookBooks: 16,
  },
  {
    label: "명사 수식 분사",
    form: "V-ing / p.p. + 명사",
    hint: "꾸밈받는 명사가 하는 쪽이면 V-ing, 당하는 쪽이면 과거분사.",
    check: /\b\w+(ing|ed|en)\s+(by|with|in|to|for|from)?\s*\w*/i,
    textbookBooks: 14,
  },
  {
    label: "목적격보어 to부정사",
    form: "allow/expect/ask + 목적어 + to V",
    hint: "이 동사들은 목적어 뒤에 to부정사를 데려온다.",
    check: /\b(allow|allows|allowed|expect|expects|expected|ask|asks|asked|cause|causes|caused|force|forces|forced|enable|enables|enabled|get|gets|got|encourage|encourages|encouraged|want|wants|wanted)\b[\s\S]{1,40}?\bto\s+\w+/i,
    textbookBooks: 8,
  },
  {
    label: "사역동사",
    form: "make/have/let + 목적어 + 동사원형",
    hint: "시키는 뜻의 동사 뒤에는 to 없는 동사원형이 온다.",
    check: /\b(make|makes|made|have|has|had|let|lets)\b\s+\w+(\s+\w+)?\s+\b(be|do|go|see|feel|stop|look|work|stay|come|think|know)\b/i,
    textbookBooks: 4,
  },
  {
    label: "지각동사",
    form: "see/hear/watch + 목적어 + 동사원형 / V-ing",
    hint: "보고 듣는 동사 뒤에는 동사원형이나 -ing가 온다.",
    check: /\b(see|sees|saw|hear|hears|heard|watch|watches|watched|feel|feels|felt|notice|notices|noticed)\b\s+\w+(\s+\w+)?\s+\b(\w+ing|\w+)\b/i,
    textbookBooks: 2,
  },
  {
    label: "가주어 it, 진주어 to부정사",
    form: "It is ~ to V",
    hint: "to부정사 주어가 길 때 it을 앞에 세우고 뒤로 보낸다.",
    check: /\bit\s+(is|was)\b[\s\S]{2,60}?\bto\s+\w+/i,
    textbookBooks: 6,
  },
  {
    label: "to부정사 의미상 주어",
    form: "for + 목적격 + to V",
    hint: "to부정사의 행위자가 문장 주어와 다를 때 for로 밝힌다.",
    check: /\bfor\s+\w+(\s+\w+)?\s+to\s+\w+/i,
    textbookBooks: 1,
  },

  // ── 비교·구문 ──
  {
    label: "as ~ as 원급 비교",
    form: "as + 원급 + as",
    hint: "두 대상이 같은 정도임을 나타낸다. 사이에는 원급을 쓴다.",
    check: /\bas\s+\w+\s+as\b/i,
  },
  {
    label: "비교급 than",
    form: "비교급 + than",
    hint: "두 대상을 견준다. -er 또는 more를 쓰고 than으로 잇는다.",
    check: /(\b\w+er\b|\bmore\b|\bless\b)[\s\S]{0,40}?\bthan\b/i,
    textbookBooks: 1,
  },
  {
    label: "the + 비교급, the + 비교급",
    form: "The 비교급 …, the 비교급 …",
    hint: "하나가 더할수록 다른 하나도 더하다는 뜻.",
    check: /\bthe\s+(\w+er|more|less)\b[\s\S]*,\s*the\s+(\w+er|more|less)\b/i,
    textbookBooks: 1,
  },
  {
    label: "so ~ that / such ~ that",
    form: "so + 형용사·부사 + that / such + 명사 + that",
    hint: "너무 ~해서 …하다. so 뒤에는 형용사·부사, such 뒤에는 명사가 온다.",
    check: /\b(so|such)\b[\s\S]{2,60}?\bthat\b/i,
    textbookBooks: 6,
  },
  {
    label: "too ~ to V / enough to V",
    form: "too + 형용사 + to V / 형용사 + enough + to V",
    hint: "너무 ~해서 못 한다, ~할 만큼 충분하다.",
    check: /(\btoo\b[\s\S]{2,40}?\bto\s+\w+)|(\benough\s+to\s+\w+)/i,
  },

  // ── 그 밖 ──
  {
    label: "간접의문문 어순",
    form: "의문사 + 주어 + 동사",
    hint: "의문사절이 다른 문장 안에 들어가면 평서문 어순이 된다.",
    check: /\b(what|who|whom|when|where|why|how|which)\b(\s+\w+){1,5}\s+\b(is|was|are|were|do|does|did|can|could|will|would|had|has|have|should|might)\b/i,
    textbookBooks: 4,
  },
  {
    label: "재귀대명사",
    form: "-self / -selves",
    hint: "목적어가 주어와 같은 대상이면 재귀대명사를 쓴다.",
    check: /\b\w+(self|selves)\b/i,
    textbookBooks: 6,
  },

  // ── 교과서에서 가져온 것 (2026-09-29) ──
  {
    label: "동격의 that",
    form: "명사 + that + 완전한 절",
    hint: "the fact that처럼 앞 명사의 내용을 that절이 그대로 풀어 준다.",
    check: /\b(fact|idea|news|belief|thought|hope|rumor|possibility|chance|question)\s+that\b/i,
    textbookBooks: 13,
  },
  {
    label: "현재완료 수동태",
    form: "have been + p.p.",
    hint: "지금까지 이어지는 일을 당하는 쪽에서 말한다.",
    // have 와 been 사이, been 과 분사 사이 어디에 부사가 끼어도 알아본다
    check:
      /\b(have|has|had)\s+(?:\w+ly\s+|not\s+|already\s+|always\s+|never\s+|just\s+){0,2}been\s+(?:\w+ly\s+|not\s+|already\s+|always\s+){0,2}(\w+ed|\w+en|built|kept|told|made|done|given|taken|written|held|left|lost|found|brought|bought|sent|spent|put|set|cut|read|felt|met|paid|said|sold|thought|taught|won|understood|become|begun|chosen|driven|drawn|grown|known|shown|worn)\b/i,
    textbookBooks: 8,
  },
  {
    label: "one of the + 최상급 + 복수명사",
    form: "one of the 최상급 + 복수명사",
    hint: "가장 ~한 것 가운데 하나. 뒤에는 복수명사가 온다.",
    check: /\bone\s+of\s+the\s+\w+(est|most\s+\w+)?\s*\w*s\b/i,
    textbookBooks: 9,
  },
  {
    label: "가목적어 it",
    form: "make/find/think + it + 형용사 + to V",
    hint: "목적어가 길면 it을 먼저 놓고 to부정사를 뒤로 보낸다.",
    check: /\b(make|makes|made|find|finds|found|think|thinks|thought|consider|considers|considered)\s+it\b[\s\S]{2,40}?\bto\s+\w+/i,
    textbookBooks: 6,
  },
  {
    label: "상관접속사",
    form: "not only A but also B",
    hint: "짝을 이루는 접속사. 앞뒤를 같은 꼴로 쓴다.",
    check: /\bnot\s+only\b[\s\S]*\bbut\b|\bboth\b[\s\S]*\band\b|\beither\b[\s\S]*\bor\b|\bneither\b[\s\S]*\bnor\b/i,
    textbookBooks: 6,
  },
  {
    label: "복합관계사",
    form: "whatever / whoever / whenever",
    hint: "선행사를 품은 관계사. ~하는 것은 무엇이든.",
    check: /\b(whatever|whoever|whomever|whenever|wherever|however)\b/i,
    textbookBooks: 5,
  },
  {
    label: "as if 가정법",
    form: "as if + 과거/과거완료",
    hint: "사실이 아닌 것을 마치 그런 것처럼 말한다.",
    check: /\bas\s+if\b/i,
    textbookBooks: 4,
  },
  {
    label: "without/but for 가정법",
    form: "Without ~, 주어 + would …",
    hint: "~이 없다면. if절 없이 가정한다.",
    check: /\b(without|but\s+for)\b[\s\S]*\b(would|could|might)\b/i,
    textbookBooks: 4,
  },
  {
    label: "with + 명사 + 분사",
    form: "with + 명사 + V-ing/p.p.",
    hint: "~한 채로. 곁따르는 상황을 덧붙인다.",
    // 명사구가 길거나(time and weather) 부사가 끼어도(also evoking) 알아본다 — 쉼표·마침표는 넘지 않는다
    check: /\bwith\s+[^,.;:!?]{1,60}?\b\w+(ing|ed|en)\b/i,
    textbookBooks: 4,
  },
  {
    label: "조건의 접속사",
    form: "unless / in case / provided that",
    hint: "~하지 않으면, ~할 경우에 대비해.",
    check: /\b(unless|in\s+case|provided\s+that|as\s+long\s+as)\b/i,
    textbookBooks: 6,
  },
  {
    label: "부사절의 「주어+be동사」 생략",
    form: "when/while + V-ing",
    hint: "주절과 주어가 같으면 부사절의 주어와 be동사를 줄인다.",
    check: /\b(when|while|if|though|although)\s+\w+ing\b/i,
    textbookBooks: 6,
  },
  {
    label: "전치사 + 관계대명사",
    form: "전치사 + which/whom",
    hint: "관계사절 안의 전치사를 관계대명사 앞으로 옮긴다.",
    check: /\b(in|on|at|for|with|to|from|of|by|about)\s+(which|whom)\b/i,
    textbookBooks: 3,
  },
  {
    label: "조동사 + have p.p.",
    form: "must/should have p.p.",
    hint: "지난 일에 대한 짐작·후회를 나타낸다.",
    check: /\b(must|should|could|would|might|may)\s+have\s+\w+(ed|en|n)\b/i,
    textbookBooks: 7,
  },
  {
    label: "목적의 so that",
    form: "so that + 주어 + can",
    hint: "~하기 위해서. 목적을 절로 나타낸다.",
    check: /\bso\s+that\b[\s\S]{0,40}?\b(can|could|will|would|may|might)\b/i,
    textbookBooks: 2,
  },
  {
    label: "완료부정사",
    form: "to have + p.p.",
    hint: "본동사보다 앞선 때를 나타낸다.",
    check: /\bto\s+have\s+\w+(ed|en|n)\b/i,
    textbookBooks: 2,
  },
  {
    label: "as many[much] + 명사 + as",
    form: "as many + 복수명사 + as",
    hint: "수·양이 같음을 나타낸다.",
    check: /\bas\s+(many|much)\s+\w+\s+as\b/i,
    textbookBooks: 2,
  },
  {
    label: "cannot ~ too / enough",
    form: "cannot + 동사 + too",
    hint: "아무리 ~해도 지나치지 않다.",
    // 교과서 예문 꼴까지: can never thank you enough, cannot be overstated(2026-10-13 대체 2문항)
    check: /\b(?:cannot|can[’']t|can\s+never|could\s+not|couldn[’']t|could\s+never)\b(?:[\s\S]{0,70}?\b(?:too|enough)\b|\s+(?:be\s+)?over[a-z]{4,})/i,
    textbookBooks: 2,
  },
  {
    label: "not A but B",
    form: "not A but B",
    hint: "A가 아니라 B다.",
    check: /\bnot\b[\s\S]{1,40}?\bbut\b/i,
    textbookBooks: 1,
  },
  {
    label: "to one's + 감정명사",
    form: "to one's surprise",
    hint: "~하게도. 문장 앞에 놓아 감정을 드러낸다.",
    check: /\bto\s+(my|his|her|their|our|one's)\s+(surprise|joy|delight|disappointment|relief|regret|horror)\b/i,
    textbookBooks: 2,
  },
  {
    label: "help + 목적어 + 동사원형",
    form: "help + 목적어 + (to) V",
    hint: "help 뒤에는 to가 있어도 없어도 된다.",
    check: /\bhelps?\s+\w+\s+(to\s+)?\w+\b/i,
    textbookBooks: 1,
  },
  {
    label: "wh- 명사절",
    form: "what/how + 절",
    hint: "의문사절이 주어·목적어·보어로 쓰인다.",
    check: /\b(what|how|who|which|where|when|why)\b[\s\S]{2,40}?\b(is|was|are|were|do|does|did)\b/i,
    textbookBooks: 3,
  },
  {
    label: "명사절 whether/if",
    form: "whether/if + 절",
    hint: "~인지 아닌지. 주어·목적어로 쓰인다.",
    check: /\bwhether\b/i,
    textbookBooks: 5,
  },
  {
    label: "전치사 + 동명사",
    form: "전치사 + V-ing",
    hint: "전치사 뒤에는 동명사가 온다.",
    check: /\b(in|on|at|for|with|by|of|about|after|before|without)\s+\w+ing\b/i,
    textbookBooks: 2,
  },
  {
    label: "과거완료",
    form: "had + p.p.",
    hint: "과거의 어느 때보다 더 앞선 일.",
    check: /\bhad\s+(\w+ed|\w+en|built|kept|told|made|done|given|taken|written|held|left|lost|found|brought|bought|sent|spent|put|set|cut|read|felt|met|paid|said|sold|thought|taught|won|understood|become|begun|chosen|driven|drawn|grown|known|shown|worn)\b/i,
    textbookBooks: 3,
  },
  {
    label: "독립부정사",
    form: "to be sure, so to speak",
    hint: "문장 전체를 꾸미는 굳어진 to부정사.",
    check: /\b(to\s+be\s+sure|so\s+to\s+speak|to\s+begin\s+with|needless\s+to\s+say|to\s+tell\s+the\s+truth|strange\s+to\s+say)\b/i,
    textbookBooks: 2,
  },
];

/** 프롬프트에 싣는 목록 — 이름(형태) — 설명 */
export const WRITING_GRAMMAR_LIST = WRITING_GRAMMARS.map(
  (g) => `  · ${g.label}(${g.form}) — ${g.hint}`
).join("\n");

/**
 * 영어로 끝나는 이름은 읽는 소리로 받침을 따진다.
 * should는 「슈드」라 받침이 없어 '를', what은 「왓」이라 '을'.
 */
const LATIN_TAIL_PARTICLE: Record<string, "을" | "를"> = {
  should: "를",
  v: "를",
  what: "을",
  that: "을",
  than: "을",
  it: "을",
};

/** 「강조구문을」·「도치를」 — 받침에 따라 조사를 고른다 */
export function objectParticle(word: string): "을" | "를" {
  const trimmed = word.trim();
  const last = trimmed.slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 === 0 ? "를" : "을";
  }
  const tail = trimmed.match(/[A-Za-z]+$/)?.[0]?.toLowerCase() ?? "";
  return LATIN_TAIL_PARTICLE[tail] ?? "을";
}

/**
 * 조건 첫 줄에서 어떤 어법을 시켰는지 찾아낸다.
 * 이름이 겹치는 것들이 있어(관계대명사 ↔ 관계대명사 what) 긴 이름부터 맞춰 본다.
 */
export function findWritingGrammar(conditionLine: string): WritingGrammar | null {
  /*
   * 띄어쓰기·물결표(～〜)가 조금만 달라도 못 찾아 멀쩡한 문항을 버렸다 — 단원문법 서술형 48문항 중
   * 19문항이 「어법 이름이 필요합니다」로 버려짐(2026-10-13 호원고1, cannot ~ too / enough).
   */
  const norm = (t: string) => t.replace(/[～〜∼]/g, "~").replace(/\s+/g, "").toLowerCase();
  const line = norm(conditionLine || "");
  const byLength = [...WRITING_GRAMMARS].sort((a, b) => b.label.length - a.label.length);
  return byLength.find((g) => line.includes(norm(g.label))) ?? null;
}
