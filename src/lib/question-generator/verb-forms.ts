/**
 * 동사 어형 표 — 「어형변화」는 동사만 한다(선생님 결정 2026-10-24).
 *
 * 서술형 보기(요약문 빈칸 영작·제시어 배열 어형변화·조건 영작)는 동사만 원형으로 주고
 * 명사·형용사·부사는 정답에 쓰인 꼴 그대로 준다(apples는 apples, better는 better).
 * 여기 둔 표와 규칙으로 「보기 낱말이 정답의 어느 낱말로 바뀌었는가」를 가린다.
 * 워크북 쪽에서도 같은 판단이 필요해 따로 모듈로 둔다.
 */

/** 불규칙 동사: [원형, 과거, 과거분사, (그 밖의 꼴)] */
const IRREGULAR_VERB_FAMILIES: string[][] = [
  ["be", "am", "is", "are", "was", "were", "been", "being"],
  ["have", "has", "had", "having"],
  ["do", "does", "did", "done", "doing"],
  ["go", "goes", "went", "gone", "going"],
  ["make", "made", "making"],
  ["take", "took", "taken", "taking"],
  ["give", "gave", "given", "giving"],
  ["get", "got", "gotten", "getting"],
  ["see", "saw", "seen", "seeing"],
  ["come", "came", "coming"],
  ["become", "became", "becoming"],
  ["overcome", "overcame", "overcoming"],
  ["find", "found"],
  ["think", "thought"],
  ["bring", "brought"],
  ["buy", "bought"],
  ["teach", "taught"],
  ["catch", "caught"],
  ["fight", "fought"],
  ["seek", "sought"],
  ["feel", "felt"],
  ["keep", "kept"],
  ["sleep", "slept"],
  ["sweep", "swept"],
  ["weep", "wept"],
  ["leave", "left", "leaving"],
  ["lose", "lost", "losing"],
  ["meet", "met"],
  ["build", "built"],
  ["send", "sent"],
  ["spend", "spent"],
  ["lend", "lent"],
  ["bend", "bent"],
  ["lead", "led"],
  ["feed", "fed"],
  ["bleed", "bled"],
  ["breed", "bred"],
  ["speed", "sped"],
  ["read"],
  ["say", "said"],
  ["pay", "paid"],
  ["lay", "laid"],
  ["tell", "told"],
  ["sell", "sold"],
  ["hold", "held"],
  ["stand", "stood"],
  ["understand", "understood"],
  ["withstand", "withstood"],
  ["know", "knew", "known"],
  ["grow", "grew", "grown"],
  ["show", "showed", "shown"],
  ["throw", "threw", "thrown"],
  ["blow", "blew", "blown"],
  ["draw", "drew", "drawn"],
  ["withdraw", "withdrew", "withdrawn"],
  ["fly", "flew", "flown", "flies"],
  ["speak", "spoke", "spoken"],
  ["break", "broke", "broken"],
  ["choose", "chose", "chosen", "choosing"],
  ["freeze", "froze", "frozen", "freezing"],
  ["forget", "forgot", "forgotten", "forgetting"],
  ["wear", "wore", "worn"],
  ["tear", "tore", "torn"],
  ["swear", "swore", "sworn"],
  ["bear", "bore", "borne", "born"],
  ["write", "wrote", "written", "writing"],
  ["drive", "drove", "driven", "driving"],
  ["rise", "rose", "risen", "rising"],
  ["arise", "arose", "arisen", "arising"],
  ["ride", "rode", "ridden", "riding"],
  ["hide", "hid", "hidden", "hiding"],
  ["bite", "bit", "bitten", "biting"],
  ["eat", "ate", "eaten"],
  ["fall", "fell", "fallen"],
  ["begin", "began", "begun", "beginning"],
  ["drink", "drank", "drunk"],
  ["sing", "sang", "sung"],
  ["ring", "rang", "rung"],
  ["sink", "sank", "sunk"],
  ["shrink", "shrank", "shrunk"],
  ["swim", "swam", "swum", "swimming"],
  ["run", "ran", "running"],
  ["sit", "sat", "sitting"],
  ["win", "won", "winning"],
  ["spin", "spun", "spinning"],
  ["dig", "dug", "digging"],
  ["stick", "stuck"],
  ["strike", "struck", "striking"],
  ["hang", "hung"],
  ["swing", "swung"],
  ["cling", "clung"],
  ["put", "putting"],
  ["cut", "cutting"],
  ["let", "letting"],
  ["set", "setting"],
  ["hit", "hitting"],
  ["quit", "quitting"],
  ["split", "splitting"],
  ["shut", "shutting"],
  ["hurt"],
  ["cost"],
  ["cast"],
  ["broadcast"],
  ["spread"],
  ["burst"],
  ["bet", "betting"],
  ["upset", "upsetting"],
  ["lie", "lay", "lain", "lying"],
  ["mean", "meant"],
  ["deal", "dealt"],
  ["dream", "dreamt", "dreamed"],
  ["learn", "learnt", "learned"],
  ["burn", "burnt", "burned"],
  ["bind", "bound"],
  ["wind", "wound"],
  ["grind", "ground"],
  ["shake", "shook", "shaken", "shaking"],
  ["wake", "woke", "woken", "waking"],
  ["awake", "awoke", "awoken", "awaking"],
  ["steal", "stole", "stolen"],
  ["prove", "proved", "proven", "proving"],
  ["light", "lit", "lighted"],
  ["undergo", "underwent", "undergone", "undergoes"],
  ["forgive", "forgave", "forgiven", "forgiving"],
  ["mistake", "mistook", "mistaken", "mistaking"],
  ["shoot", "shot"],
  ["slide", "slid", "sliding"],
  ["spit", "spat", "spitting"],
  ["sting", "stung"],
  ["strive", "strove", "striven", "striving"],
  ["weave", "wove", "woven", "weaving"],
  ["wring", "wrung"],
  ["hear", "heard"],
  ["sew", "sewed", "sewn"],
  ["sow", "sowed", "sown"],
  ["mow", "mowed", "mown"],
  ["foresee", "foresaw", "foreseen", "foreseeing"],
  ["oversee", "oversaw", "overseen", "overseeing"],
  ["undertake", "undertook", "undertaken", "undertaking"],
  ["uphold", "upheld"],
  ["withhold", "withheld"],
  ["behold", "beheld"],
  ["flee", "fled", "fleeing"],
  ["kneel", "knelt", "kneeled"],
  ["leap", "leapt", "leaped"],
  ["spell", "spelt", "spelled"],
  ["smell", "smelt", "smelled"],
  ["spill", "spilt", "spilled"],
  ["spoil", "spoilt", "spoiled"],
  // 조동사 짝 — 보기에 will을 주고 would로 쓰게 하는 문항이 드물게 있다. 동사 꼴로 본다.
  ["will", "would"],
  ["can", "could"],
  ["shall", "should"],
  ["may", "might"],
];

const IRREGULAR_FORMS_BY_BASE = new Map<string, Set<string>>();
const IRREGULAR_BASES_BY_FORM = new Map<string, string[]>();
for (const family of IRREGULAR_VERB_FAMILIES) {
  const base = family[0]!;
  IRREGULAR_FORMS_BY_BASE.set(base, new Set(family));
  for (const form of family) {
    const list = IRREGULAR_BASES_BY_FORM.get(form) ?? [];
    if (!list.includes(base)) list.push(base);
    IRREGULAR_BASES_BY_FORM.set(form, list);
  }
}

const VOWELS = "aeiou";

/** 끝이 자음-모음-자음이라 겹자음으로 늘일 수 있는 꼴(stop → stopped). w·x·y는 늘이지 않는다 */
function canDoubleFinal(base: string): boolean {
  if (base.length < 3) return false;
  const [a, b, c] = [base.at(-3)!, base.at(-2)!, base.at(-1)!];
  if (!/[a-z]/.test(a) || !/[a-z]/.test(b) || !/[a-z]/.test(c)) return false;
  if (VOWELS.includes(a) || !VOWELS.includes(b) || VOWELS.includes(c)) return false;
  return !"wxy".includes(c);
}

/**
 * 원형에서 나올 수 있는 동사 꼴 전부(원형 포함, 소문자).
 * 규칙 변화는 넉넉하게 만든다(visited·visitted 둘 다) — 정답에 있는 꼴과 맞춰 보는 데만 쓰므로
 * 넘치는 쪽이 모자라는 쪽보다 낫다.
 */
export function inflectionsOf(baseRaw: string): Set<string> {
  const base = baseRaw.trim().toLowerCase().replace(/[’ʼ]/g, "'");
  const out = new Set<string>();
  if (!base) return out;
  out.add(base);
  const irregular = IRREGULAR_FORMS_BY_BASE.get(base);
  if (irregular) for (const f of irregular) out.add(f);
  if (!/^[a-z][a-z'-]*$/.test(base)) return out;

  const stemY = /[^aeiou]y$/.test(base) ? base.slice(0, -1) : null;
  const doubled = canDoubleFinal(base) ? base + base.at(-1)! : null;

  // 3인칭 단수
  if (/(?:s|sh|ch|x|z|o)$/.test(base)) {
    out.add(`${base}es`);
    out.add(`${base}s`);
  } else if (stemY) {
    out.add(`${stemY}ies`);
  } else {
    out.add(`${base}s`);
  }

  // 과거·과거분사
  if (/e$/.test(base)) {
    out.add(`${base}d`);
  } else if (stemY) {
    out.add(`${stemY}ied`);
  } else {
    out.add(`${base}ed`);
    if (doubled) out.add(`${doubled}ed`);
    if (/c$/.test(base)) out.add(`${base}ked`);
  }

  // 현재분사·동명사
  if (/ie$/.test(base)) {
    out.add(`${base.slice(0, -2)}ying`);
  } else if (/e$/.test(base) && !/(?:ee|ye|oe)$/.test(base)) {
    out.add(`${base.slice(0, -1)}ing`);
    out.add(`${base}ing`); // ageing·singeing
  } else {
    out.add(`${base}ing`);
    if (doubled) out.add(`${doubled}ing`);
    if (/c$/.test(base)) out.add(`${base}king`);
  }
  return out;
}

/**
 * 바뀐 꼴에서 가능한 원형 후보(소문자). 사전이 없으니 철자 규칙으로 여럿을 돌려준다.
 * (stopped → stop·stopp·stoppe, cities → city·citie, made → make)
 */
export function verbBaseForms(wordRaw: string): string[] {
  const w = wordRaw.trim().toLowerCase().replace(/[’ʼ]/g, "'");
  const out: string[] = [];
  const push = (c: string) => {
    if (c && c.length >= 2 && !out.includes(c)) out.push(c);
  };
  if (!w) return out;
  for (const b of IRREGULAR_BASES_BY_FORM.get(w) ?? []) push(b);
  push(w);
  if (/ies$/.test(w) && w.length > 4) push(`${w.slice(0, -3)}y`);
  if (/(?:ss|sh|ch|x|z|o)es$/.test(w)) push(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));
  if (/ied$/.test(w) && w.length > 4) push(`${w.slice(0, -3)}y`);
  if (/ed$/.test(w) && w.length > 3) {
    const stem = w.slice(0, -2);
    push(stem);
    push(`${stem}e`);
    if (/(.)\1$/.test(stem) && !"flsz".includes(stem.at(-1)!)) push(stem.slice(0, -1));
    if (/ck$/.test(stem)) push(stem.slice(0, -1));
  }
  if (/ying$/.test(w) && w.length > 5) push(`${w.slice(0, -4)}ie`);
  if (/ing$/.test(w) && w.length > 4) {
    const stem = w.slice(0, -3);
    push(stem);
    push(`${stem}e`);
    if (/(.)\1$/.test(stem) && !"flsz".includes(stem.at(-1)!)) push(stem.slice(0, -1));
    if (/ck$/.test(stem)) push(stem.slice(0, -1));
  }
  return out;
}

/** 어형이 바뀌지 않는 말(관사·전치사·대명사·접속사). 보기 대조에서 건너뛴다 */
const UNINFLECTED = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "from", "with", "by", "as", "if", "or", "and",
  "but", "not", "no", "so", "than", "that", "this", "these", "those", "it", "its", "they", "them", "their",
  "he", "she", "him", "her", "his", "we", "us", "our", "you", "your", "i", "me", "my", "who", "whom", "whose",
  "which", "what", "when", "where", "why", "how", "must", "because", "while", "although", "though", "whether",
  "until", "since", "before", "after", "into", "about", "between", "among", "through", "without", "within",
  "during", "over", "under", "up", "down", "out", "off", "there", "here", "very", "too", "also", "even",
  "only", "just", "both", "either", "neither", "each", "every", "some", "any", "all", "such", "own",
]);

/** 이 말 바로 뒤의 -s 낱말은 명사 복수형이다(한정사·소유격·수량·전치사·흔한 형용사) */
const NOUN_SLOT_BEFORE = new Set([
  "the", "a", "an", "my", "your", "his", "her", "our", "their", "its", "these", "those", "many", "some", "any",
  "all", "several", "few", "both", "such", "various", "other", "more", "most", "no", "two", "three", "four",
  "five", "six", "seven", "eight", "nine", "ten", "hundreds", "thousands", "millions", "first", "last", "next",
  "own", "same", "different", "diverse", "new", "old", "young", "small", "large", "big", "little", "good",
  "bad", "important", "social", "human", "local", "natural", "physical", "mental", "emotional", "negative",
  "positive", "certain", "common", "daily", "early", "modern", "major", "main", "basic", "simple", "complex",
  "of", "during", "for", "with", "in", "on", "at", "by", "from", "into", "about", "among", "between",
  "through", "without", "within", "under", "over", "after", "before", "to", "like", "than", "toward",
  "towards", "against", "across", "around", "behind", "beyond", "despite", "except", "inside", "outside",
  "per", "since", "until", "upon", "via", "as",
]);

/** 이 말 바로 앞의 -s 낱말은 명사 복수형이다(복수 be·조동사) */
const NOUN_SLOT_AFTER = new Set([
  "are", "were", "have", "can", "could", "will", "would", "may", "might", "must", "should", "do",
]);

/** 이 말 바로 뒤의 -s 낱말은 3인칭 동사다(주어 대명사·관계대명사). 뒤에 조동사가 와도 동사로 본다(what matters can be) */
const SUBJECT_PRONOUN_BEFORE = new Set([
  "he", "she", "it", "who", "what", "which", "whoever", "whatever", "whichever", "one", "everyone", "everybody",
  "someone", "somebody", "anyone", "anybody", "nobody", "everything", "something", "anything", "nothing", "each",
]);

/**
 * 문장 토큰 가운데 i번째 -s 낱말이 분명한 명사 자리인가.
 * 앞말이 한정사·소유격·수량·전치사·흔한 형용사·소유격 -'s·-ive/-ous/-ful/-less/-able/-ible 꼴이거나,
 * 뒷말이 복수 be·조동사면 명사다. 앞말이 주어 대명사·관계대명사(he·it·what·which)면 동사로 본다.
 * 그 밖(주어 명사 뒤 등)은 3인칭 동사일 수 있어 모른다고 본다.
 */
export function isClearNounSlot(tokens: string[], i: number): boolean {
  const prev = (tokens[i - 1] ?? "").toLowerCase().replace(/[’ʼ]/g, "'");
  const next = (tokens[i + 1] ?? "").toLowerCase();
  const self = (tokens[i] ?? "").toLowerCase();
  if (SUBJECT_PRONOUN_BEFORE.has(prev)) return false;
  // as follows·as regards 같은 관용구
  if (prev === "as" && /^(?:follows|regards|concerns)$/.test(self)) return false;
  if (prev) {
    if (NOUN_SLOT_BEFORE.has(prev)) return true;
    if (/'s$/.test(prev) || /s'$/.test(prev)) return true;
    if (/(?:ive|ous|ful|less|able|ible)$/.test(prev) && prev.length > 4) return true;
    // 하이픈 꾸밈말 뒤는 명사 자리(first-preference votes, long-term goals) — 2026-11-10 시험에서 vote가 원형으로 남아
    // 「동사만 바꿀 것」 조건으로는 정답을 쓸 수 없었다
    if (/^[a-z]+(?:-[a-z]+)+$/.test(prev)) return true;
  }
  if (next && NOUN_SLOT_AFTER.has(next)) return true;
  return false;
}

/** 불규칙 명사 복수 (원형 → 복수) */
const IRREGULAR_NOUN_PLURAL: Record<string, string[]> = {
  child: ["children"],
  person: ["people", "persons"],
  man: ["men"],
  woman: ["women"],
  foot: ["feet"],
  tooth: ["teeth"],
  goose: ["geese"],
  mouse: ["mice"],
  ox: ["oxen"],
  phenomenon: ["phenomena"],
  criterion: ["criteria"],
  analysis: ["analyses"],
  crisis: ["crises"],
  thesis: ["theses"],
  hypothesis: ["hypotheses"],
  medium: ["media"],
  datum: ["data"],
  bacterium: ["bacteria"],
  curriculum: ["curricula"],
  stimulus: ["stimuli"],
  fungus: ["fungi"],
  cactus: ["cacti"],
  species: ["species"],
};

/** 불규칙 비교급·최상급 */
const IRREGULAR_COMPARATIVE: Record<string, string[]> = {
  good: ["better", "best"],
  well: ["better", "best"],
  bad: ["worse", "worst"],
  badly: ["worse", "worst"],
  many: ["more", "most"],
  much: ["more", "most"],
  little: ["less", "least"],
  far: ["farther", "farthest", "further", "furthest"],
  old: ["elder", "eldest"],
};

/**
 * 보기 낱말 bank가 정답 낱말 token으로 「동사가 아닌 꼴 바꾸기」(명사 복수·비교급·최상급·부사 -ly·
 * -ing 명사의 복수)로 바뀐 것인가. 동사 어형으로도 읽히는 -s·-es·-ies 꼴은 ambiguous로 돌려주고,
 * 부르는 쪽이 문장 자리(isClearNounSlot)로 가린다.
 */
export function nonVerbVariantKind(
  bankRaw: string,
  tokenRaw: string
): "plural" | "comparative" | "adverb" | "ambiguous-s" | null {
  const bank = bankRaw.trim().toLowerCase().replace(/[’ʼ]/g, "'");
  const token = tokenRaw.trim().toLowerCase().replace(/[’ʼ]/g, "'");
  if (!bank || !token || bank === token) return null;
  if (!/^[a-z][a-z'-]*$/.test(bank)) return null;
  const verbForms = inflectionsOf(bank);

  // 불규칙 명사 복수·-ves 복수: 동사 꼴로는 안 읽힌다
  if ((IRREGULAR_NOUN_PLURAL[bank] ?? []).includes(token)) return "plural";
  if (/fe?$/.test(bank) && token === `${bank.replace(/fe?$/, "")}ves`) return "plural";
  // -ing 명사의 복수(feelings·findings·savings): 동사 꼴에 s가 더 붙었다
  if (/ings$/.test(token) && verbForms.has(token.slice(0, -1))) return "plural";

  // 비교급·최상급·-ly 부사: 동사 꼴에는 없다
  if ((IRREGULAR_COMPARATIVE[bank] ?? []).includes(token)) return "comparative";
  const stemY = /[^aeiou]y$/.test(bank) ? bank.slice(0, -1) : null;
  const doubled = canDoubleFinal(bank) ? bank + bank.at(-1)! : null;
  const compStems = [bank, stemY ? `${stemY}i` : null, doubled, /e$/.test(bank) ? bank.slice(0, -1) : null].filter(
    (s): s is string => Boolean(s)
  );
  if (!verbForms.has(token)) {
    // 두 글자 원형(be·do)에 -er·-est·-ly를 붙여 보지 않는다(be → best·beer 같은 억지 짝)
    if (bank.length < 3) return null;
    for (const s of compStems) {
      if (s.length < 3) continue;
      if (token === `${s}er` || token === `${s}est`) return "comparative";
    }
    if (token === `${bank}ly` || (stemY && token === `${stemY}ily`) || (/le$/.test(bank) && token === `${bank.slice(0, -1)}y`)) {
      return "adverb";
    }
    return null;
  }

  // 동사 3인칭으로도, 명사 복수로도 읽히는 -s·-es·-ies 꼴
  const pluralCandidates = new Set<string>([`${bank}s`, `${bank}es`]);
  if (stemY) pluralCandidates.add(`${stemY}ies`);
  if (pluralCandidates.has(token)) return "ambiguous-s";
  return null;
}

/** 축약 부정형을 풀어 토큰으로(doesn't → does·not, can't → can·not, won't → will·not) */
export function splitNegativeContraction(tokenRaw: string): string[] {
  const t = tokenRaw.replace(/[’ʼ]/g, "'");
  const m = t.match(/^([A-Za-z]+)n't$/);
  if (!m) return [t];
  const base = m[1]!.toLowerCase();
  if (base === "ca") return ["can", "not"];
  if (base === "wo") return ["will", "not"];
  if (base === "sha") return ["shall", "not"];
  return [m[1]!, "not"];
}

export type BankFormIssue = {
  bank: string;
  answer: string;
  kind: "plural" | "comparative" | "adverb";
};

/**
 * 보기 낱말과 정답 토큰을 맞춰 보고, 동사가 아닌데 원형으로 준 보기를 찾는다.
 *
 * 1) 정답에 그대로 있는 보기는 그 토큰을 쓴다(대소문자 무시).
 * 2) 남은 보기는 동사 어형(inflectionsOf)으로 정답 토큰과 맞춘다. -s·-es·-ies로만 다른 짝은
 *    정답 문장에서 그 자리가 분명한 명사 자리일 때만 명사로 본다(그 밖은 3인칭 동사로 봐 준다).
 * 3) 동사 꼴로 읽히지 않는 복수·비교급·최상급·부사 -ly 짝은 명사·형용사·부사로 본다.
 * 정답 어디에도 없는 보기는 여기서 다루지 않는다(다른 검사 몫).
 *
 * @param bankWords 보기 낱말들
 * @param answerTokens 정답 토큰(문장 차례대로). 요약문이면 빈칸을 채운 요약문 전체를 주면 자리 판단이 정확하다
 */
export function findNonVerbBankForms(bankWords: string[], answerTokens: string[]): BankFormIssue[] {
  const tokens = answerTokens.flatMap(splitNegativeContraction);
  const lowerTokens = tokens.map((t) => t.toLowerCase().replace(/[’ʼ]/g, "'"));
  const used = new Array<boolean>(tokens.length).fill(false);
  const pending: string[] = [];
  for (const raw of bankWords) {
    const w = raw.trim().toLowerCase().replace(/[’ʼ]/g, "'");
    if (!w) continue;
    const at = lowerTokens.findIndex((t, i) => !used[i] && t === w);
    if (at >= 0) {
      used[at] = true;
    } else {
      pending.push(w);
    }
  }
  const issues: BankFormIssue[] = [];
  for (const w of pending) {
    if (UNINFLECTED.has(w)) continue;
    const forms = inflectionsOf(w);
    // 동사 꼴로 읽히는 짝을 먼저 찾되, -s 짝은 자리를 본다
    let matched = -1;
    let issue: BankFormIssue | null = null;
    for (let i = 0; i < lowerTokens.length; i += 1) {
      if (used[i]) continue;
      const t = lowerTokens[i]!;
      const kind = nonVerbVariantKind(w, t);
      if (kind === "ambiguous-s") {
        if (isClearNounSlot(tokens, i)) {
          issue = { bank: w, answer: tokens[i]!, kind: "plural" };
          matched = i;
          // 명사 자리가 아닌 같은 꼴이 뒤에 있으면 그쪽이 동사다 — 계속 찾는다
          continue;
        }
        matched = i;
        issue = null;
        break;
      }
      if (kind) {
        issue = { bank: w, answer: tokens[i]!, kind };
        matched = i;
        break;
      }
      if (forms.has(t)) {
        matched = i;
        issue = null;
        break;
      }
    }
    if (matched >= 0) used[matched] = true;
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * 보기에서 명사·형용사·부사를 원형으로 준 것을 정답 꼴로 되돌린 보기(바뀐 것이 없으면 null).
 *
 * 검수(validate-question)가 같은 규칙으로 걸러 다시 만들게 하지만, 보기 한 낱말 때문에 다시 부를
 * 까닭이 없다(대체는 최대한 줄인다 — 선생님 2026-10-13). 만들 때 여기서 먼저 고친다.
 * 해설이 그 원형을 들어 설명하면(「apple을 apples로 바꾼다」) 보기만 고치면 해설과 어긋나므로
 * 손대지 않고 검수에 맡긴다.
 */
export function fixNonVerbBankForms(bankWords: string[], answerTokens: string[], explanation = ""): string[] | null {
  const issues = findNonVerbBankForms(bankWords, answerTokens);
  if (issues.length === 0) return null;
  const out = [...bankWords];
  let changed = false;
  for (const issue of issues) {
    const escaped = issue.bank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^A-Za-z])${escaped}(?![A-Za-z])`, "i").test(explanation)) continue;
    const at = out.findIndex((t) => t.trim().toLowerCase().replace(/[’ʼ]/g, "'") === issue.bank);
    if (at < 0) continue;
    const given = out[at]!;
    // 보기가 소문자였으면 정답 꼴도 소문자로(문장 첫 Germs → germs). 고유명사(Koreans)는 정답 꼴 그대로
    out[at] = given === given.toLowerCase() ? issue.answer.toLowerCase() : issue.answer;
    changed = true;
  }
  return changed ? out : null;
}
