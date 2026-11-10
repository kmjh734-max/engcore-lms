import { openAiFetch } from "@/lib/ai-usage/openai-fetch";
import { engcoreLevelOf } from "@/lib/vocab/engcore-lemma";
import { isUsableAntonym } from "@/lib/lesson-materials/teacher-notes-shared";
export { isUsableAntonym };

/**
 * 교사용 수업자료 해설(선생님 2026-11-10, 정수학원 먼저).
 *
 * 지문 하나에 호출 한 번으로 배경지식 · 강의 Tip · 주제/제목/요약문 · FLOW · 어휘(어원) ·
 * 비유/함축 · 출제 유형 별점 · 마무리 정리, 그리고 지문 위에 겹칠 「쉽게 말하면」과
 * 출제 자리(빈칸·삽입·지칭·함축)를 만든다. 문법 번호와 동반의어는 분석서·단어표에 이미 있어
 * 여기서 만들지 않는다. 학생용은 같은 재료에서 칸만 비운다.
 */

export type TeacherSpotKind = "blank" | "insert" | "reference" | "implication";

export type TeacherNotes = {
  version: 1;
  background: Array<{ term: string; termEn: string; definition: string; example: string }>;
  tip: { hookTitle: string; script: string; analogy: string; points: string[] };
  topic: { en: string; ko: string };
  title: { en: string; ko: string };
  summary: { en: string; ko: string };
  flow: Array<{ label: string; sentences: string; lines: string[] }>;
  vocab: Array<{ word: string; meaning: string; etymology: string; synonyms: string[] }>;
  figurative: Array<{ expression: string; meaningEn: string; explainKo: string }>;
  questionTypes: Array<{ type: string; stars: number; reason: string; spot: string; trap: string; strategy: string }>;
  review: { mainIdea: string; studentLine: string; vocabNote: string; typesNote: string; figurativeNote: string };
  /** 어려운 문장 아래 「쉽게 말하면」 — 문장 번호는 0부터 */
  easy: Array<{ sentence: number; text: string }>;
  /** 지문 위 출제 자리 — q는 그 문장에 그대로 있는 어구 */
  spots: Array<{ sentence: number; q: string; kind: TeacherSpotKind; note: string }>;
  /** 지문 아래 문법 한 줄 요약(문법 해설지처럼) — 분석서 문법 자리(q·label)마다 */
  grammarShort?: Array<{ q: string; label: string; text: string; term?: string }>;
  /** 지문 위 동반의어(5~7개, 문맥 동의어·반의어) — 없으면 vocab에서 */
  keyVocab?: KeyVocab[];
  sourceHash: string;
  model: string;
  createdAt: string;
};

export const TEACHER_NOTES_MODEL = process.env.OPENAI_TEACHER_NOTES_MODEL || "gpt-5.6-sol";

const SYSTEM = `너는 대한민국 수능 영어 1타 강사이자, 초보 강사의 수업 설계 파트너다.
주어진 영어 지문(문장 번호가 붙어 있음)으로, 초보 강사가 영포자 고등학생에게 쉽고 재미있게 설명할 수 있는 교사용 해설을 만든다.

절대 원칙
- 지문이 최우선 근거다. 원문에 없는 주장·사실을 보태지 않는다.
- 배경지식과 지문 요약을 엄격히 가른다. 배경지식 칸에서 지문 내용을 요약하지 않는다.
- 한국 고등학생(영포자) 눈높이. 추상 개념은 학교생활·시험·유튜브·SNS·게임·친구 관계 같은 친숙한 예로.
- 강의 대사는 실제 강사가 말하는 자연스러운 한국어 구어체.
- 어원·역사를 지어내지 않는다. 확실하지 않으면 etymology를 빈 문자열로 둔다.
- 원문의 논리 흐름을 왜곡하지 않는다. 모든 지문에 같은 FLOW 틀을 강제하지 않는다.

칸별 규칙
- background: 2~4개. 꼭 필요한 용어·개념만. term은 한국어 이름, termEn은 영어(지문에 나온 꼴이 있으면 그것). definition은 쉬운 한 문장, example은 일상 예 한 문장.
- tip.hookTitle: 도입 썰 소재 한 줄. tip.script: 강사 대사 3~5문장(구어체, "얘들아," 같은 말투 가능). tip.analogy: 가장 어려운 개념 하나를 친숙한 비유로 한두 문장. tip.points: 수업에서 강조할 것 2~4개(문장 번호를 밝혀).
  토론·실험 활동은 제안하지 않는다.
- topic.en: 영어 소문자 명사구. title.en: 영어 Title Case, 핵심 주장이나 역설을 담는다. summary.en: 영어 한 문장, 원문 핵심어를 살리되 동사·명사 일부를 바꿔 쓴다. "the text tells/discusses", "the passage talks about" 금지. 각 ko는 그 한국어 해석.
- flow: 3~6단계. label은 구조 용어(도입·문제 제기·통념·반박·역설 제시·원인·개념 구분·부연 설명·예시·비교 및 대조·결론 가운데 실제에 맞는 것). sentences는 해당 문장 번호("1" 또는 "3·4"). lines는 1~3줄, 기호(→ ∵ ∴ = ≠ vs ⬅ ⏎)로 짧게. 원문 정보량은 지키고 반복은 뺀다.
- vocab: 6~10개. CEFR B2~C1 핵심어 우선, 쉬워도 논리에 중요한 낱말 포함. word는 지문에 나온 꼴. meaning은 문맥상 뜻. etymology는 접두사·어근·접미사(확실한 것만, 아니면 ""). 복수 -s·과거 -ed·부사 -ly처럼 낱말 하나에 꼬리만 붙은 것은 어원이 아니므로 "". synonyms는 같은 품사로, 그 문장의 그 자리에 바꿔 넣어도 뜻이 그대로인 것만 중요한 만큼 1~3개(시험에 패러프레이징으로 나올 만한 것 먼저). 사전 뜻만 비슷하고 이 문맥에선 뜻이 바뀌는 말은 넣지 않는다(예: "projects have been promoted as improving ~"의 promoted는 '~로 내세워지다'라 encouraged·supported는 틀림, presented·advertised는 맞음).
- figurative: 학생이 글자 그대로 해석하면 뜻이 틀어지는 비유·은유·함축 표현(낯선 뜻으로 쓴 낱말 포함). 글자 그대로 읽어도 뜻이 통하는 평범한 어구는 넣지 않는다. expression은 원문에서 정확히 옮긴 영어. meaningEn은 원문 핵심어를 살려 바꿔 쓴 영어(구는 구로, 문장은 문장으로). explainKo는 쉬운 한국어. 없으면 빈 배열 — 억지로 만들지 않는다.
- questionTypes: 빈칸 추론·문장 삽입·글의 순서·주제/제목/요지·어휘 추론, 필요하면 함축 의미·지칭 추론·요약문 완성 등 기타. stars 1~5(평가원 확률이 아니라 지문 구조를 본 교육적 판단). reason·spot(예상 출제 지점, 문장 번호)·trap(출제자 함정)·strategy(실전 풀이)를 각각 한 문장.
- review: 시험 직전 암기 자료처럼. mainIdea(주제+필자 주장 한두 문장), studentLine(학생이 말로 할 수 있는 짧은 한 줄), vocabNote(암기 어휘와 동의어·패러프레이징 대비), typesNote(높은 유형·풀이·함정), figurativeNote(핵심 비유와 변형 가능성).
- easy: 고1이 읽기 어려운 문장(구조가 꼬였거나 추상적인 문장)만 0~3개. sentence는 문장 번호에서 1을 뺀 값. text는 화면에서 「쉽게 말하면」 이름표 뒤에 붙는 쉬운 한국어 설명 1~2문장(직역이 아니라 뜻을 풀어 줌, "쉽게 말하면"으로 시작하지 않는다). 학생에게 말하듯 쓴다.
- spots: 지문 위에 표시할 출제 예상 자리. kind는
  blank(빈칸: 주제문 속 핵심 어구, 글 전체가 되풀이하는 말),
  insert(문장 삽입: However·By contrast·This·such처럼 앞 문장이 있어야 성립하는 연결어·지시어로 흐름이 끊기는 문장 — q는 그 연결어·지시어),
  reference(지칭: 대상이 헷갈리는 대명사·지시어구 — note에 가리키는 대상. who·which·that 같은 관계대명사는 지칭 추론으로 내지 않으므로 넣지 않는다),
  implication(함축: 21번 밑줄처럼 주제를 비유로 바꿔 말한 어구·글이 붙인 이름표·속담 — note에 그 뜻 한 줄. 글자 그대로의 설명 어구는 아니다. 없으면 넣지 않는다).
  sentence는 문장 번호에서 1을 뺀 값, q는 그 문장에 글자 그대로 있는 영어(대소문자·문장부호 포함). 각 kind는 0~3개, 확실한 자리만.

JSON 하나만 돌려준다. 키: background, tip, topic, title, summary, flow, vocab, figurative, questionTypes, review, easy, spots.`;

export function teacherNotesSourceHash(sentences: string[]): string {
  let h = 0;
  const s = sentences.join("\n");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `tn1:${(h >>> 0).toString(16)}:${s.length}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown) => arr(v).map(str).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

/** 모델 답을 지문과 대조해 틀린 칸은 버린다 — 고치지 못하는 것만 빠진다 */
export function sanitizeTeacherNotes(
  raw: Record<string, unknown>,
  sentences: string[],
  meta: { model: string },
): { notes: TeacherNotes; dropped: string[] } {
  const dropped: string[] = [];
  const passage = norm(sentences.join(" "));
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const tip = o(raw.tip);
  const review = o(raw.review);
  const pair = (v: unknown) => ({ en: str(o(v).en), ko: str(o(v).ko) });

  const topic = pair(raw.topic);
  if (topic.en && topic.en !== topic.en.toLowerCase()) topic.en = topic.en.toLowerCase();
  const summary = pair(raw.summary);
  if (/the (text|passage) (tells|discusses|talks about)/i.test(summary.en)) dropped.push("summary: 금지 표현");

  const inPassage = (q: string) => q.length > 0 && passage.includes(norm(q));
  const wordInPassage = (w: string) => {
    const stem = norm(w).replace(/(ing|ed|es|s|ly|ment|tion)$/, "").slice(0, Math.max(4, norm(w).length - 3));
    return passage.includes(norm(w)) || (stem.length >= 4 && passage.includes(stem));
  };

  const vocab = arr(raw.vocab)
    .map((v) => ({ word: str(o(v).word), meaning: str(o(v).meaning), etymology: str(o(v).etymology), synonyms: strs(o(v).synonyms).slice(0, 3) }))
    .filter((v) => {
      const ok = v.word && v.meaning && wordInPassage(v.word);
      if (!ok) dropped.push(`vocab: ${v.word || "(빈 낱말)"}`);
      return ok;
    });

  const figurative = arr(raw.figurative)
    .map((v) => ({ expression: str(o(v).expression), meaningEn: str(o(v).meaningEn), explainKo: str(o(v).explainKo) }))
    .filter((v) => {
      const ok = inPassage(v.expression) && v.explainKo;
      if (!ok) dropped.push(`figurative: 원문에 없음 「${v.expression}」`);
      return ok;
    });

  const kinds = new Set<TeacherSpotKind>(["blank", "insert", "reference", "implication"]);
  const spots = arr(raw.spots)
    .map((v) => ({ sentence: Number(o(v).sentence), q: str(o(v).q), kind: str(o(v).kind) as TeacherSpotKind, note: str(o(v).note) }))
    .map((s) => {
      // 문장 번호를 1부터 센 답도 있다 — 그 문장에 없고 다음 칸 문장에 있으면 옮긴다
      const has = (i: number) => i >= 0 && i < sentences.length && norm(sentences[i]).includes(norm(s.q));
      if (!has(s.sentence) && has(s.sentence - 1)) return { ...s, sentence: s.sentence - 1 };
      if (!has(s.sentence)) {
        const found = sentences.findIndex((_, i) => has(i));
        if (found >= 0) return { ...s, sentence: found };
      }
      return s;
    })
    .filter((s) => {
      const ok =
        kinds.has(s.kind) &&
        !(s.kind === "reference" && /^(who|whom|whose|which|that|what|where|when)$/i.test(s.q.trim())) &&
        Number.isInteger(s.sentence) &&
        s.sentence >= 0 &&
        s.sentence < sentences.length &&
        s.q.length > 0 &&
        norm(sentences[s.sentence]).includes(norm(s.q));
      if (!ok) dropped.push(`spot: ${s.kind} 「${s.q}」(${s.sentence})`);
      return ok;
    });

  const easy = arr(raw.easy)
    .map((v) => ({ sentence: Number(o(v).sentence), text: str(o(v).text).replace(/^쉽게 말하면\s*[,，:]?\s*/, "") }))
    .filter((e) => {
      const ok = Number.isInteger(e.sentence) && e.sentence >= 0 && e.sentence < sentences.length && e.text;
      if (!ok) dropped.push(`easy: ${e.sentence}`);
      return ok;
    })
    .slice(0, 4);

  const questionTypes = arr(raw.questionTypes)
    .map((v) => ({
      type: str(o(v).type),
      stars: Math.max(1, Math.min(5, Math.round(Number(o(v).stars) || 0))),
      reason: str(o(v).reason),
      spot: str(o(v).spot),
      trap: str(o(v).trap),
      strategy: str(o(v).strategy),
    }))
    .filter((q) => q.type)
    .sort((a, b) => b.stars - a.stars);

  const notes: TeacherNotes = {
    version: 1,
    background: arr(raw.background)
      .map((v) => ({ term: str(o(v).term), termEn: str(o(v).termEn), definition: str(o(v).definition), example: str(o(v).example) }))
      .filter((b) => b.term && b.definition),
    tip: { hookTitle: str(tip.hookTitle), script: str(tip.script), analogy: str(tip.analogy), points: strs(tip.points) },
    topic,
    title: pair(raw.title),
    summary,
    flow: arr(raw.flow)
      .map((v) => ({ label: str(o(v).label), sentences: str(o(v).sentences), lines: strs(o(v).lines) }))
      .filter((f) => f.label && f.lines.length),
    vocab,
    figurative,
    questionTypes,
    review: {
      mainIdea: str(review.mainIdea),
      studentLine: str(review.studentLine),
      vocabNote: str(review.vocabNote),
      typesNote: str(review.typesNote),
      figurativeNote: str(review.figurativeNote),
    },
    easy,
    spots,
    sourceHash: teacherNotesSourceHash(sentences),
    model: meta.model,
    createdAt: new Date().toISOString(),
  };
  return { notes, dropped };
}

export type TeacherNotesUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number };

export async function generateTeacherNotes(input: {
  sentences: string[];
  korean?: string[];
  model?: string;
  effort?: "low" | "medium";
}): Promise<{ notes: TeacherNotes; dropped: string[]; usage: TeacherNotesUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 없음");
  const model = input.model ?? TEACHER_NOTES_MODEL;
  const lines = input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const ko = (input.korean ?? []).some(Boolean)
    ? `\n\n[참고 해석]\n${(input.korean ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `[지문]\n${lines}${ko}` },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: input.effort ?? "low",
    max_completion_tokens: 16_000,
    prompt_cache_key: "teacher-notes",
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      lastErr = text.slice(0, 300);
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
    const json = JSON.parse(text) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json.choices[0]?.message?.content ?? "");
    } catch {
      lastErr = "JSON 아님";
      continue;
    }
    const { notes, dropped } = sanitizeTeacherNotes(parsed, input.sentences, { model: json.model });
    return {
      notes,
      dropped,
      usage: {
        inputTokens: json.usage.prompt_tokens,
        cachedInputTokens: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: json.usage.completion_tokens,
        reasoningTokens: json.usage.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }
  throw new Error(`교사용 해설 만들기 실패: ${lastErr}`);
}

const GRAMMAR_SHORT_SYSTEM = `너는 고등학교 영어 문법 해설지를 쓰는 강사다. 각 문법 자리마다 정확한 문법 용어와 설명을 쓴다(선생님 2026-11-10 「정확한 문법 표현을 쓴 다음에 설명」).
- term: 교과서·천일문식 정확한 문법 용어(예: "현재완료 수동태", "목적격 관계대명사 생략", "결과의 분사구문", "5형식 수동태(목적격보어 to부정사)", "자동사 rise vs 타동사 raise"). 받은 이름표보다 정확하면 바꿔 쓴다.
- text: 이 문장에서 왜 그 형태인지 1~2문장(40~90자). 형태 규칙 → 이 문장의 근거 순서로. 학생이 읽고 바로 이해하게.
- 예: {"term":"현재완료 수동태","text":"have been p.p. 꼴. 주어 projects가 '추진되는' 대상이라 수동태, 과거부터 지금까지 이어진 일이라 현재완료를 쓴다."}
- 복수 주어에 맞춘 현재형(live, care)을 '동사원형'이라 부르지 않는다 — '복수 현재형'이라 쓴다.
- 설명에 없는 내용을 보태지 않는다. 받은 순서 그대로 같은 개수.
JSON {"items": [{"term":"…","text":"…"}, …]} 하나만 돌려준다.`;

/** 분석서 문법 설명(길다)을 해설지 한 줄로 — 호출 한 번, 출력 수백 토큰 */
export async function generateGrammarShort(
  points: Array<{ sentence: string; q: string; label: string; explanation: string }>,
  model = TEACHER_NOTES_MODEL
): Promise<Array<{ term: string; text: string }>> {
  if (!points.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 없음");
  const user = points
    .map((p, i) => `${i + 1}. [${p.label}] 자리: ${p.q}\n문장: ${p.sentence}\n설명: ${p.explanation}`)
    .join("\n\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: GRAMMAR_SHORT_SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        max_completion_tokens: 6000,
        prompt_cache_key: "teacher-notes-grammar",
      }),
    });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`문법 요약 실패: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    try {
      const items = (JSON.parse(json.choices[0]?.message?.content ?? "") as { items?: unknown }).items;
      if (Array.isArray(items)) {
        const out = items.map((x, i) =>
          x && typeof x === "object"
            ? { term: String((x as { term?: unknown }).term ?? "").trim() || points[i]!.label, text: String((x as { text?: unknown }).text ?? "").trim() }
            : { term: points[i]?.label ?? "", text: String(x ?? "").trim() }
        );
        if (out.length === points.length) return out;
      }
    } catch {
      /* 다시 */
    }
  }
  return [];
}

/** 지문 위 동반의어용 핵심 어휘(선생님 2026-11-11 「동반의어 개선」): 고르기·문맥 동의어·반의어를 한 번에 */
export type KeyVocab = { word: string; synonyms: string[]; antonym: string };

const KEY_VOCAB_SYSTEM = `너는 고1 내신·수능 영어 강사다. 지문과 후보 어휘를 받아, 지문 위에 동반의어를 달 낱말·어구를 고르고 동의어·반의어를 단다.

고르기(5~7개)
- 주제·논리 전개의 핵심어이거나, 패러프레이징(바꿔 쓰기)·어휘 추론 문제로 나올 만한 낱말·어구만.
- 빼는 것: 쉬운 말(중학 필수 수준 이하: under, vast, buy, often, reach 등), 고유명사·전문 명칭·학문 용어(marine, oceanographer, orbit, organic, millennia 등), 동의어로 바꿔 외울 필요가 없는 말.
- 후보에 없어도 지문에 있으면 골라도 된다. word는 지문에 나온 꼴 그대로(대소문자·굴절 포함).

동의어(synonyms)
- 후보 3~4개를 좋은 순서로(화면에는 걸러서 2개만 싣는다). 그 문장의 그 자리에 넣어도 뜻과 어법이 그대로인 것만(품사·시제·수·뒤에 오는 전치사까지 맞춘다).
- 고1이 교과서·수능에서 흔히 보는 말만. trailblazer, enigma, intricacy, notwithstanding 같은 낯선 말은 쓰지 않는다.
- 수준은 원래 낱말과 비슷하거나 쉬운 것, 수능·내신 패러프레이징에 실제로 쓰이는 말. 너무 쉬운 말(use, give, change, good, together)·희귀어(enigma, intricacy 등)·사전 뜻만 비슷하고 이 문맥에선 뜻이 바뀌는 말은 금지. 어구 가능.
- 예: "projects have been promoted as improving ~"의 promoted → presented, advertised (encouraged·supported는 틀림)
- 예: "afford the rent"의 afford → pay for, manage to pay (finance는 틀림)

반의어(antonym)
- 이 문맥에서 반대 뜻이 분명하고 학습에 쓸모 있을 때만 1개, 아니면 "".
- 한 낱말이나 굳은 표현만. 'fail to ~', 'not ~', 'remain ~', 'stay ~'처럼 부정·동사구로 만든 표현, 네 낱말 이상은 쓰지 않는다(없으면 "").

JSON {"items":[{"word":"…","synonyms":["…","…"],"antonym":"…"}]} 하나만 돌려준다.`;

export async function generateKeyVocab(input: {
  sentences: string[];
  candidates: Array<{ word: string; meaning: string }>;
  model?: string;
}): Promise<KeyVocab[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 없음");
  const user = `[지문]\n${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n[후보 어휘]\n${input.candidates
    .map((c) => `- ${c.word}: ${c.meaning}`)
    .join("\n")}`;
  const passage = input.sentences.join(" ").toLowerCase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.model ?? TEACHER_NOTES_MODEL,
        messages: [
          { role: "system", content: KEY_VOCAB_SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        max_completion_tokens: 4000,
        prompt_cache_key: "teacher-notes-keyvocab",
      }),
    });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`핵심 어휘 실패: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    try {
      const items = (JSON.parse(json.choices[0]?.message?.content ?? "") as { items?: unknown }).items;
      if (!Array.isArray(items)) continue;
      const out: KeyVocab[] = [];
      for (const x of items) {
        const o = (x ?? {}) as { word?: unknown; synonyms?: unknown; antonym?: unknown };
        const word = String(o.word ?? "").trim();
        const lw = word.toLowerCase();
        // 지문에 있는 말만(굴절형은 앞부분으로)
        if (!word || (!passage.includes(lw) && !passage.includes(lw.slice(0, Math.max(4, lw.length - 3))))) continue;
        const synonyms = (Array.isArray(o.synonyms) ? o.synonyms : [])
          .map((s) => String(s ?? "").trim())
          .filter((s) => s && s.toLowerCase() !== lw && !s.toLowerCase().includes(lw))
          .filter((s) => isFamiliarSynonym(s, word))
          .slice(0, 2);
        const antonym = String(o.antonym ?? "").trim();
        if (!synonyms.length) continue; // 동의어가 남지 않으면 지문 위에 올리지 않는다
        out.push({ word, synonyms, antonym: antonym.toLowerCase() === lw || !isUsableAntonym(antonym) ? "" : antonym });
      }
      if (out.length) return out.slice(0, 8);
    } catch {
      /* 다시 */
    }
  }
  return [];
}


/**
 * 학생이 아는 동의어인지(선생님 2026-11-11 「trailblazer 이런 단어 잘 안 써」): 사이트 어휘 등급표(초등~수능필수)에 있고,
 * 원래 낱말보다 한 단계 넘게 어렵지 않아야(고교기본까지는 늘 허용). 어구는 낱말마다 같은 기준(관사·전치사 같은 짧은 말은 넘어감).
 */
function isFamiliarSynonym(syn: string, word: string): boolean {
  const base = word.includes(" ") ? null : engcoreLevelOf(word);
  const ceiling = Math.max(7, (base ?? 7) + 1); // 원래 낱말보다 한 단계까지(고교기본은 늘 허용) — pioneer(중학고난도) → trailblazer(고교필수) 빠짐
  const tokens = syn.toLowerCase().split(/[\s]+/).filter((t) => t.length > 3);
  if (!tokens.length) return true;
  return tokens.every((t) => {
    const lv = engcoreLevelOf(t);
    return lv !== null && lv <= ceiling;
  });
}
