/**
 * 정답을 가리고 직접 풀어 보는 검수.
 *
 * 선생님 결정(2026-10-04): 「조건부도 나오지 않게 완벽을 추구하자」.
 * 정수학원 세 작업의 조건부·불량 가운데 풀어 봐야 아는 것(두 보기가 다 맞음, 개수가 읽기에 따라
 * 갈림, 정답이 흐린 주제·제목)은 정답과 해설을 함께 보여 주는 검수가 자주 놓쳤다. 해설을 읽으면
 * 그 풀이에 끌려간다. 그래서 학생이 받는 것(지문·발문·보기)만 주고 풀게 한 뒤, 고른 답이 정답과
 * 다르거나 다른 답도 맞다고 하면 버리고 다시 만든다.
 *
 * 객관식(보기 4개 이상, 정답이 번호)과, 보기 없이 개수를 숫자로 쓰는 개수 문항(일치개수 등)을 본다.
 * 다른 서술형은 답이 글이라 이 방식으로 비교할 수 없다.
 * 끄려면 QG_BLIND_SOLVE=off. 호출이 실패하면 통과로 둔다.
 */
import { questionGeneratorChatJsonWithRetry } from "@/lib/question-generator/openai";
import type { GeneratedQuestionPayload } from "@/lib/question-generator/types";
import { engcoreLevelOf } from "@/lib/vocab/engcore-lemma";

/*
 * 모델이 「낯선 낱말」로 꼽은 것 중 지문에 있거나 우리 단어장(EngCore, 고교필수~수능필수)에 있는 것은 뺀다.
 * 고정 시험지(2026-11-10)에서 calamity가 아닌 civic·sensory·menacing 같은 단어장 낱말까지 낯설다며
 * 멀쩡한 문항을 버리고 다시 만들었다. 단어장 밖 낱말(locomotion, soot, morsel)만 남긴다.
 */
function filterRareWords(rawList: unknown, passage: string): string[] {
  const passageLower = String(passage ?? "").toLowerCase();
  return (Array.isArray(rawList) ? rawList : [])
    .map((w) => String(w).trim())
    .filter((w) => w && !passageLower.includes(w.toLowerCase()))
    .filter((w) => w.split(/\s+/).some((part) => engcoreLevelOf(part) === null));
}

const SOLVE_MODEL =
  process.env.OPENAI_MODEL_QG_SOLVE?.trim() || process.env.OPENAI_MODEL_QG_REVIEW?.trim() || "gpt-5.6-terra";

export function blindSolveEnabled(): boolean {
  return (process.env.QG_BLIND_SOLVE ?? "on").trim().toLowerCase() !== "off";
}

function hasChoices(payload: GeneratedQuestionPayload): boolean {
  return Array.isArray(payload.choices) && payload.choices.length >= 4;
}

function isCountItem(payload: GeneratedQuestionPayload): boolean {
  return (
    !hasChoices(payload) &&
    /개수/.test(String(payload.instruction ?? "")) &&
    /^\s*\d+\s*(개)?\s*$/.test(String(payload.correctAnswer ?? ""))
  );
}

/*
 * 번호가 지문 안에 박힌 객관식(문장삽입 ①~⑤ 자리, 무관한문장 ⓐ~ⓔ, 어휘추론·어법추론 밑줄 번호).
 * 보기 칸이 비어 있어 2026-11-10까지 직접 풀기를 건너뛰었다(고정 시험지에서 발견, 불량 59개가 이 네 유형).
 * 고정 시험지 결과(terra): 어법추론 불량 22/26 잡고 멀쩡한 것 1/25 버림, 어휘추론·무관한문장은 오탐 0~1.
 * 문장삽입은 모델이 자리를 자주 틀리게 골라(멀쩡한 것 7/25 버림, high로도 4/25) 뺀다 — 밑줄 없이 ①~⑤만 있는 꼴.
 * 끄려면 QG_SOLVE_EMBEDDED=off, 문장삽입까지 보려면 =all.
 */
const SPOT_SETS = ["①②③④⑤", "ⓐⓑⓒⓓⓔ"];
function isEmbeddedSpotItem(payload: GeneratedQuestionPayload): boolean {
  const mode = (process.env.QG_SOLVE_EMBEDDED ?? "on").trim().toLowerCase();
  if (mode === "off") return false;
  if (hasChoices(payload)) return false;
  const n = Number(payload.correctAnswer);
  if (!Number.isInteger(n) || n < 1 || n > 5) return false;
  const text = String(payload.passageModified ?? "");
  const circled = [..."①②③④⑤"].filter((ch) => text.includes(ch)).length >= 4;
  // 문장삽입(①~⑤ 자리, 밑줄 없음)은 =all 일 때만
  if (circled && !/<u>/i.test(text) && mode !== "all") return false;
  return SPOT_SETS.some((set) => [...set].filter((ch) => text.includes(ch)).length >= 4);
}

export function blindSolvable(payload: GeneratedQuestionPayload): boolean {
  if (isCountItem(payload)) return true;
  if (isEmbeddedSpotItem(payload)) return true;
  const n = Number(payload.correctAnswer);
  return hasChoices(payload) && Number.isInteger(n) && n >= 1;
}

const SOLVE_SYSTEM = `You are the strongest student in a Korean high-school English class, taking an exam. You see exactly what students see: the passage, the instruction, and the choices. Solve the item from the passage alone.
Then think like a student filing a formal objection (이의제기): is there another answer a careful student could defend with evidence from the passage? For count items (개수), judge every statement/spot one by one and note any whose truth depends on how it is read.
If the item has no choices and asks for a count, "answer" is the count and "alsoDefensible" lists other counts a careful student could defend.
For count items (개수), also give "count": the number you actually counted, and list other defensible counts in "alsoDefensible" as counts.
Also judge every CHOICE as written (선생님 기준: 객관식 보기가 어색하면 안 된다). List in "awkward" the number of any choice that is unnatural or ungrammatical English (or unnatural Korean), or that rewords the passage so loosely that a careful student cannot tell whether it is true or false (e.g. "quickly add up" turned into "brief paragraphs accumulate quickly"; "one evening" turned into "nightly"). Plain wrong distractors that are clearly wrong are fine.
Also list in "rareWords" any word in the choices (or count-item statements) that is NOT in the passage and that a typical Korean 고등학생 preparing for 수능 would not know: specialist or technical terms (pigmentation, hominid, locomotion, acreage), GRE-style words (rapport, affinity, substantive, toil), or a common word used in an unusual sense (stock meaning "cardboard"). Normal 수능 vocabulary (recognition, reliance, exposure, sustain, evolutionary) is fine — do not list it.
Return ONE JSON object: {"answer":<choice number, or the count>,"count":<count items only>,"alsoDefensible":[<other answers a careful student could defend, or empty>],"debatable":<true if your answer depends on a reading a reasonable student could make differently>,"awkward":[<choice numbers, or empty>],"rareWords":[<words, or empty>],"reason":"<Korean, one or two sentences>"}
Be honest, not generous: list an answer in alsoDefensible only if you could argue it in front of a teacher with passage evidence. Normal hard items with one clearly best answer are NOT debatable.`;

function compact(text: unknown, max = 2600): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)} …` : s;
}

export type BlindSolveResult = {
  verdict: "pass" | "drop";
  answer: number | null;
  reason: string;
  /** 서술형 확인이 고친 칸(해설) */
  fixed?: string[];
  /** 낯선 낱말 때문에만 버릴 때 그 낱말들 — 문항 전체 대신 그 낱말만 바꿔 쓸 수 있다 */
  rareWords?: string[];
  /** 정답은 맞는데 이 오답들도 정답처럼 읽혀 버릴 때 — 문항 전체 대신 그 보기만 다시 쓸 수 있다(2026-11-12) */
  repairChoices?: number[];
};

export async function blindSolveQuestion(opts: {
  passage: string;
  payload: GeneratedQuestionPayload;
}): Promise<BlindSolveResult> {
  const { payload } = opts;
  const mcq = hasChoices(payload);
  const unit = mcq || isEmbeddedSpotItem(payload) ? "번" : "개";
  const key = Number(String(payload.correctAnswer ?? "").replace(/[^0-9]/g, ""));
  const shown = payload.passageModified?.trim() ? payload.passageModified : opts.passage;
  const choices = mcq
    ? (payload.choices ?? []).map((c) => `${"①②③④⑤⑥⑦"[(c.number ?? 1) - 1] ?? c.number} ${c.text}`).join("\n")
    : "";
  const user = [
    `INSTRUCTION: ${compact(payload.instruction, 400)}`,
    `\nPASSAGE (<u>…</u> = underline, ___ = blank):\n${compact(shown)}`,
    payload.questionText ? `\nQUESTION TEXT:\n${compact(payload.questionText, 1600)}` : "",
    mcq
      ? `\nCHOICES:\n${choices}`
      : isEmbeddedSpotItem(payload)
        ? "\nCHOICES: the numbered spots in the passage (① … ⑤, or ⓐ … ⓔ where ⓐ=1 … ⓔ=5). Answer with the spot number 1-5."
        : "\n(No choices: write the count as the answer.)",
  ]
    .filter(Boolean)
    .join("\n");

  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: SOLVE_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 2000,
      /*
       * 개수 문항은 깊이 생각하게 한다. 2026-10-04 시험: low로는 같은 어법개수 문항을 풀 때마다
       * 개수가 달라졌고(멀쩡한 것을 버리고 불량을 통과), medium은 개수 문항 불량·조건부 5개를
       * 모두 잡았다. 다른 유형은 low로도 멀쩡한 18개를 하나도 버리지 않았다.
       */
      reasoningEffort:
        (process.env.QG_SOLVE_EFFORT as "low" | "medium" | undefined) ||
        // 객관식도 깊이 본다 — low로는 애매한 보기(내용불일치·문장삽입)를 놓쳤다(7차 시험 2026-10-04)
        "medium",
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-solve",
    })) as Record<string, unknown>;
  } catch {
    return { verdict: "pass", answer: null, reason: "풀기 호출 실패 — 통과로 둔다" };
  }

  /*
   * 보기가 「1개 … 5개」인 개수 문항은 모델이 보기 번호와 개수를 헷갈린다(시험에서 「틀린 것은
   * 4개」라 쓰고 답은 3번). 센 개수를 따로 받아 그 개수의 보기 번호로 바꾼다.
   */
  const countChoice = new Map<number, number>();
  if (mcq) {
    for (const c of payload.choices ?? []) {
      const m = String(c.text).match(/^\s*(\d+)\s*개/);
      if (m) countChoice.set(Number(m[1]), Number(c.number));
    }
  }
  const countMode = mcq && countChoice.size === (payload.choices?.length ?? 0) && Number.isInteger(Number(raw.count));
  const toChoice = (n: number) => (countMode ? countChoice.get(n) ?? -1 : n);

  const answer = countMode ? toChoice(Number(raw.count)) : Number(raw.answer);
  const reason = compact(raw.reason, 300);
  const also = (Array.isArray(raw.alsoDefensible) ? raw.alsoDefensible : [])
    .map((n) => toChoice(Number(n)))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== key);
  if (!Number.isInteger(answer)) return { verdict: "pass", answer: null, reason: reason || "답을 못 읽어 통과" };
  if (answer !== key) return { verdict: "drop", answer, reason: `직접 풀면 ${answer}${unit} — ${reason}` };
  if (also.length) return { verdict: "drop", answer, reason: `${also.join("·")}${unit}도 답이 될 수 있음 — ${reason}` };
  if (raw.debatable === true) return { verdict: "drop", answer, reason: `읽기에 따라 답이 갈림 — ${reason}` };
  // 보기가 어색하거나 참·거짓이 애매하게 바꿔 쓴 것이면 다시 만든다(선생님 기준: 객관식 보기가 어색하면 안 된다)
  const awkward = (Array.isArray(raw.awkward) ? raw.awkward : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  if (mcq && awkward.length) return { verdict: "drop", answer, reason: `보기 ${awkward.join("·")}번이 어색하거나 애매함 — ${reason}` };
  /*
   * 낯선 낱말(선생님 말 2026-10-04: 「너무 낯선 단어들이 포함되지 않도록」). 단어장 표는 수능 어휘보다 좁아
   * 코드만으로는 정상 수능 단어까지 걸린다. 풀어 보는 모델이 고등학생에게 낯선 말만 골라낸다.
   */
  const rare = filterRareWords(raw.rareWords, opts.passage);
  if (rare.length) return { verdict: "drop", answer, reason: `낯선 낱말(${rare.slice(0, 5).join(", ")})을 고등학생이 아는 말로 바꿔 쓴다 — ${reason}`, rareWords: rare };
  return { verdict: "pass", answer, reason };
}

/*
 * 서술형 확인(2026-10-04). 정수학원 273문항 대조에서 조건부 23개 중 14개, 불량 2개가 모두
 * 서술형이었다 — 다른 어순·다른 본문 표현도 답이 되거나, 맞는 자리를 틀렸다고 한 오류 수정.
 * 선생님 지시: 허용답으로 살리지 말고 답이 하나뿐인 문항만 남긴다. 그래서 다른 답이 나오면 버린다.
 * 답이 글이라 정답을 가리고 맞춰 볼 수 없어서, 정답을 보여 주고 「이 답이 맞는지, 다른 답도
 * 되는지」를 묻는다.
 */
export function subjectiveCheckable(payload: GeneratedQuestionPayload): boolean {
  if (hasChoices(payload) || isCountItem(payload)) return false;
  const key = payload.correctAnswer;
  return typeof key === "string" && key.trim().length > 0;
}

const SUBJECTIVE_SYSTEM = `You check one subjective (서술형) item of a Korean high-school English exam. You see the passage, the instruction with its <조건>, the question text, and the KEYED answer.
1. Solve the item yourself first, following every condition.
2. Decide whether the keyed answer is correct and satisfies every stated condition (word count, "본문에서 찾아", given words used exactly, 어형 변화 rule, the Korean translation). For error-correction items, check that every spot the key calls wrong is really ungrammatical under every reading and that every other spot is correct.
3. Do NOT look for other possible answers — the teacher judges alternative answers. Judge only whether the keyed answer itself is right.
4. Treat these as keyWrong too: the summary sentence is ungrammatical or meaningless once the answer is filled in; the <보기> words cannot produce the answer (missing or extra words, wrong forms for the stated 어형 rule); a 지칭 answer is a pronoun or determiner instead of the noun referred to; a 특정표현 answer does not MEAN the same as the underlined expression (only a related action, a cause/result, or the words right after it); the passage or question text is garbled, truncated, or leaks the answer; the item invents content the passage does not have.
4-1. 특정표현 (the instruction asks what an underlined expression means, answered with a phrase from the passage): put the keyed phrase IN PLACE OF the underlined expression and reread that sentence. keyWrong = true unless the sentence keeps the same meaning and scope — not broader (covers more cases than the underline), not narrower, not a different subject or object (what "ones"/"them" refers to must match), not a cause, result, example or the words right after the underline. Be strict: when in doubt, keyWrong = true.
5. Check the EXPLANATION (Korean). It is wrong if it claims a word changes form (A → B) when the <보기> already gives B, or names a change for a word that is not in <보기>, or leaves out a word whose form the answer actually changes (have → has, opinion → opinions); if it contains a generic sentence that is not about THIS passage; or if it uses a wrong grammar term, wrong referent, or wrong reason. If the key is right but the explanation is wrong, write a corrected one in "fixedExplanation" (Korean, 평서형 "~다", same shape and length as the original). Otherwise leave it out. Wording style alone is not wrong.
Return ONE JSON object: {"keyWrong":<true|false>,"fixedExplanation":<optional Korean string>,"reason":"<Korean, one or two sentences>"}`;

/*
 * 다른 정답은 찾지 않는다(선생님 결정 2026-10-04: 「다른 정답은 사용자가 생각하게 해도 괜찮아,
 * 그런 건 인간이 할 영역」). 정답 자체가 맞는지와 해설만 본다. 다른 답을 찾느라 쓰던 생각도 줄어 값이 내려간다.
 */
export async function checkSubjectiveQuestion(opts: {
  passage: string;
  payload: GeneratedQuestionPayload;
  /** 유형 코드(aingkaCode) — 다른 답을 어떻게 다룰지 정한다 */
  code?: string | null;
}): Promise<BlindSolveResult> {
  const { payload } = opts;
  const shown = payload.passageModified?.trim() ? payload.passageModified : opts.passage;
  const user = [
    `INSTRUCTION: ${compact(payload.instruction, 400)}`,
    `\nPASSAGE (<u>…</u> = underline):\n${compact(shown)}`,
    payload.questionText ? `\nQUESTION TEXT:\n${compact(payload.questionText, 1600)}` : "",
    `\nKEYED ANSWER: ${compact(payload.correctAnswer, 600)}`,
    `\nEXPLANATION (Korean):\n${compact(payload.explanation, 1600)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: SUBJECTIVE_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 2000,
      // 오류 수정은 자리마다 따져야 해서 깊이 생각하게 한다(개수 문항과 같은 까닭)
      reasoningEffort:
        (process.env.QG_SOLVE_EFFORT as "low" | "medium" | undefined) ||
        // 특정표현의 「같은 뜻인가」도 미묘해 깊이 본다(선생님 결정 2026-10-04: 맞는 지문에서만 내고 아니면 다른 유형으로)
        (/어법|오류|수정/.test(String(payload.instruction ?? "")) || opts.code === "특정표현의미서술" ? "medium" : "low"),
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-solve-subjective",
    })) as Record<string, unknown>;
  } catch {
    return { verdict: "pass", answer: null, reason: "확인 호출 실패 — 통과로 둔다" };
  }
  const reason = compact(raw.reason, 300);
  if (raw.keyWrong === true) return { verdict: "drop", answer: null, reason: `정답이 맞지 않음 — ${reason}` };
  // 해설만 틀렸으면 고쳐서 살린다(뜻 검수의 fix와 같은 잣대)
  const fixedExplanation = typeof raw.fixedExplanation === "string" ? raw.fixedExplanation.trim() : "";
  if (fixedExplanation.length >= 10 && !/[A-Za-z]{40,}/.test(fixedExplanation) && fixedExplanation !== payload.explanation) {
    payload.explanation = fixedExplanation;
    return { verdict: "pass", answer: null, reason: `해설을 고침 · ${reason}`, fixed: ["explanation"] };
  }
  return { verdict: "pass", answer: null, reason };
}

/*
 * 보기별 독립 판정(2026-10-04, ChatGPT 조언 반영 시험). 「정답 하나 고르기」는 고르지 않은 보기가
 * 애매하거나 어색한지를 잘 보지 않았다(11차: 검수가 조건부 10개 중 3개만 잡음). 보기마다 따로 판정하게 하고,
 * 판정을 정답과 맞춰 보는 일은 코드가 한다. 정답·해설·출제 의도는 보여 주지 않는다.
 *   내용일치·불일치·일치개수: supported / refuted / unverifiable / ambiguous
 *   제목·주제: valid / not_representative / conflicts / unclear
 */
/*
 * 요지(summary_mcq)도 보기별로 본다(2026-11-12). 고정 시험지 요지 28문항: 조건부 3개 중 2개 잡고 합격 25개는
 * 낯선 낱말 1건 말고 버린 것 없음(직접 풀기는 조건부를 못 잡았다). 낯선 낱말은 낱말만 바꿔 쓴다.
 */
export const PER_CHOICE_TYPES = new Set(["content_true", "content_false", "content_count", "title", "topic", "summary_mcq"]);

const PER_CHOICE_SYSTEM = `You verify ONE Korean high-school English exam item, choice by choice. You see the passage, the instruction and the choices (or numbered statements). You are NOT told the answer or why anything was written.
Judge EACH choice/statement on its own, from the passage alone. Do not pass a choice just because another choice is better.
For fact items (일치/불일치/개수), each verdict is one of:
- "supported": the passage clearly supports it
- "refuted": the passage clearly contradicts it (quote the contradicting words)
- "unverifiable": the passage neither supports nor contradicts it (an added time frame, cause, premise, comparison or quantity the passage never states; a person or belief the passage never mentions; two separate facts joined into a cause)
- "ambiguous": its truth depends on how a word or reference is read (unclear "this/such/it", vague wording, a loose paraphrase that changes the object, quantity, scope, cause or time)
For title/topic items, each verdict is one of:
- "valid": a good title/topic for the whole passage
- "not_representative": covers only part, or is too broad (if the passage treats two parallel aspects or two views — e.g. it opens with "A and B" — a choice that covers only one of them covers only part)
- "conflicts": states something the passage denies or does not claim
- "unclear": wording is vague or could be read several ways, or it is so abstract or metaphorical that a student reading only this choice cannot tell what the passage is about (the subject is hidden behind a cover word or image)
Also set "natural": false if the choice is unnatural or ungrammatical English (or Korean), or if it contradicts itself or is absurd on its own so a student could cross it out without reading the passage ("warmed the greenhouse below freezing", "acts in the direction of motion and slows it"). List in "rareWords" words not in the passage that a Korean 고등학생 would not know (specialist terms, GRE-style words, unusual senses); normal 수능 vocabulary is fine.
Return ONE JSON object: {"choices":[{"n":<number>,"verdict":"...","evidence":"<short quote or empty>","natural":true|false}],"rareWords":[...],"reason":"<Korean, one or two sentences on any problem>"}`;

export async function verifyChoicesIndependently(opts: {
  passage: string;
  payload: GeneratedQuestionPayload;
  type: string;
}): Promise<BlindSolveResult> {
  const { payload, type } = opts;
  const isCount = type === "content_count";
  const isGist = type === "title" || type === "topic" || type === "summary_mcq";
  const shown = payload.passageModified?.trim() ? payload.passageModified : opts.passage;
  const items = isCount
    ? String(payload.questionText ?? "")
    : (payload.choices ?? []).map((c) => `${"①②③④⑤⑥⑦"[(c.number ?? 1) - 1] ?? c.number} ${c.text}`).join("\n");
  const user = [
    `ITEM KIND: ${isGist ? "title/topic" : "fact (일치/불일치/개수)"}`,
    `INSTRUCTION: ${compact(payload.instruction, 400)}`,
    `\nPASSAGE:\n${compact(shown)}`,
    `\n${isCount ? "STATEMENTS" : "CHOICES"}:\n${items}`,
  ].join("\n");

  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: PER_CHOICE_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 2600,
      reasoningEffort: (process.env.QG_SOLVE_EFFORT as "low" | "medium" | undefined) || "medium",
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-verify-choices",
    })) as Record<string, unknown>;
  } catch {
    return { verdict: "pass", answer: null, reason: "보기별 판정 호출 실패 — 통과로 둔다" };
  }
  const reason = compact(raw.reason, 300);
  const rows = (Array.isArray(raw.choices) ? raw.choices : []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { verdict: "pass", answer: null, reason: reason || "판정을 못 읽어 통과" };
  const v = (r: Record<string, unknown>) => String(r.verdict ?? "").toLowerCase();
  const key = Number(String(payload.correctAnswer ?? "").replace(/[^0-9]/g, ""));

  const unnatural = rows.filter((r) => r.natural === false).map((r) => r.n);
  if (unnatural.length) return { verdict: "drop", answer: null, reason: `보기 ${unnatural.join("·")}이 어색함 — ${reason}` };
  const rare = filterRareWords(raw.rareWords, opts.passage);
  if (rare.length) return { verdict: "drop", answer: null, reason: `낯선 낱말(${rare.slice(0, 5).join(", ")})을 고등학생이 아는 말로 바꿔 쓴다 — ${reason}`, rareWords: rare };

  if (isGist) {
    const valid = rows.filter((r) => v(r) === "valid").map((r) => Number(r.n));
    const unclear = rows.filter((r) => v(r) === "unclear").map((r) => r.n);
    if (unclear.length) return { verdict: "drop", answer: null, reason: `보기 ${unclear.join("·")}이 모호함 — ${reason}` };
    if (valid.length !== 1 || valid[0] !== key) {
      const extra = valid.filter((n) => n !== key);
      return {
        verdict: "drop",
        answer: null,
        reason: `제목·주제로 성립하는 보기가 ${valid.length ? valid.join("·") + "번" : "없음"}(정답 ${key}번) — ${reason}`,
        // 정답은 성립하고 오답 한둘이 함께 성립할 때만 그 보기를 고쳐 쓴다
        ...(valid.includes(key) && extra.length >= 1 && extra.length <= 2 ? { repairChoices: extra } : {}),
      };
    }
    return { verdict: "pass", answer: key, reason };
  }

  const bad = rows.filter((r) => v(r) === "unverifiable" || v(r) === "ambiguous").map((r) => `${r.n}(${v(r) === "ambiguous" ? "모호" : "판단 불가"})`);
  if (bad.length) return { verdict: "drop", answer: null, reason: `보기 ${bad.join("·")} — 지문으로 참·거짓이 정해지지 않음 — ${reason}` };
  const supported = rows.filter((r) => v(r) === "supported").map((r) => Number(r.n));
  const refuted = rows.filter((r) => v(r) === "refuted").map((r) => Number(r.n));
  if (type === "content_true" && (supported.length !== 1 || supported[0] !== key)) {
    return { verdict: "drop", answer: null, reason: `일치하는 보기가 ${supported.join("·") || "없음"}(정답 ${key}번) — ${reason}` };
  }
  if (type === "content_false" && (refuted.length !== 1 || refuted[0] !== key)) {
    return { verdict: "drop", answer: null, reason: `일치하지 않는 보기가 ${refuted.join("·") || "없음"}(정답 ${key}번) — ${reason}` };
  }
  if (isCount && refuted.length !== key) {
    return { verdict: "drop", answer: null, reason: `틀린 진술이 ${refuted.length}개(정답 ${key}개) — ${reason}` };
  }
  return { verdict: "pass", answer: key, reason };
}

/*
 * 빈칸 보기별 판정(2026-11-12, 선생님 「전부 조건부가 안 나오게」). 직접 풀기는 보기를 서로 견주어 「가장 나은 것」을 고르므로
 * 정답처럼 읽히는 오답(may로 약해져 참이 된 보기, 앞 문장에 그대로 이어지는 보기)을 지나친다.
 * 보기를 하나씩 빈칸에 넣어 따로 판정하게 하고, 들어맞는 보기가 정답 하나뿐인지 코드가 본다.
 * 고정 시험지 빈칸 36문항: 불량·조건부 12개 중 10개 잡음(직접 풀기 2개), 합격 24개 중 4개 버림 —
 * 버린 4개를 풀어 보니 2개는 실제 흠(학생 지문에 근거 없는 정답, 정답처럼 읽히는 오답)이었다.
 * 「unclear」로는 버리지 않는다(그것까지 버리면 합격 7개를 버렸다). 시험 scripts/tmp-rv/qg-1112/_blank-perchoice.mts
 */
const BLANK_CHOICE_SYSTEM = `You verify ONE Korean high-school English blank-inference item, choice by choice. You see the passage with a blank (___) and the choices. You are NOT told the answer.
Judge EACH choice on its own: put it in the blank and reread the whole passage. Do not rank the choices against each other and do not pass a choice just because another is better.
Verdict per choice:
- "fits": with this choice in the blank the passage reads coherently and says what the surrounding sentences support. A weaker, hedged (may/can/some) or less exact wording that is still true to the passage is "fits".
- "defeated": specific words in the passage contradict it, or it claims something the passage clearly does not support (quote the defeating words in "evidence").
- "unclear": you cannot tell; its truth depends on how it is read.
Return ONE JSON object: {"choices":[{"n":<number>,"verdict":"fits|defeated|unclear","evidence":"<short quote>"}],"reason":"<Korean, one sentence>"}`;

export function blankChoicesCheckable(payload: GeneratedQuestionPayload): boolean {
  if (process.env.QG_BLANK_PER_CHOICE === "0") return false;
  const key = Number(payload.correctAnswer);
  return hasChoices(payload) && (payload.choices?.length ?? 0) === 5 && Number.isInteger(key) && /_{3,}/.test(String(payload.passageModified ?? ""));
}

export async function verifyBlankChoices(opts: { payload: GeneratedQuestionPayload }): Promise<BlindSolveResult> {
  const { payload } = opts;
  const key = Number(payload.correctAnswer);
  const choiceLines = (payload.choices ?? [])
    .map((c) => `${"①②③④⑤"[(c.number ?? 1) - 1] ?? c.number} ${c.text}`)
    .join("\n");
  const user = `PASSAGE:\n${compact(payload.passageModified)}\n\nCHOICES:\n${choiceLines}`;
  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: BLANK_CHOICE_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 2600,
      reasoningEffort: (process.env.QG_SOLVE_EFFORT as "low" | "medium" | undefined) || "medium",
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-verify-blank",
    })) as Record<string, unknown>;
  } catch {
    return { verdict: "pass", answer: null, reason: "빈칸 보기별 판정 호출 실패 — 통과로 둔다" };
  }
  const rows = (Array.isArray(raw.choices) ? raw.choices : []) as Array<Record<string, unknown>>;
  if (rows.length < 5) return { verdict: "pass", answer: null, reason: "빈칸 보기별 판정을 못 읽어 통과" };
  const fits = rows.filter((r) => String(r.verdict ?? "").toLowerCase() === "fits").map((r) => Number(r.n));
  const reason = compact(raw.reason, 300);
  if (fits.length === 1 && fits[0] === key) return { verdict: "pass", answer: key, reason };
  const others = fits.filter((n) => n !== key);
  return {
    verdict: "drop",
    answer: null,
    reason: others.length
      ? `오답 ${others.join("·")}번도 빈칸에 넣으면 지문과 어긋나지 않음(정답 ${key}번) — 그 보기를 지문의 말과 분명히 어긋나게 다시 쓴다. ${reason}`
      : `정답 ${key}번이 빈칸에 들어맞는다고 볼 근거가 학생 지문에 없음 — ${reason}`,
    ...(fits.includes(key) && others.length >= 1 && others.length <= 2 ? { repairChoices: others } : {}),
  };
}

/*
 * 정답처럼 읽히는 오답만 다시 쓴다(2026-11-12, 선생님 「조건부도 안 나왔으면」 + 10-13 「버릴 것 대신 고친다」).
 * 문항 전체를 다시 만들면 값이 열 배쯤 들고 같은 흠이 또 나온다. 걸린 보기 한둘과 해설의 그 대목만 바꾸고,
 * 부른 쪽이 같은 판정을 한 번 더 돌린다. 정답·다른 보기·지문은 건드리지 않는다.
 */
const REPAIR_SYSTEM = `You edit ONE Korean high-school English multiple-choice item. The keyed answer is correct, but the listed wrong choices can also be defended as correct, so the item has more than one answer.
Rewrite ONLY the listed wrong choices so that each is clearly wrong for a reader of the passage: it must state a relation the passage contradicts (reverse a cause, direction, subject or outcome that the passage states), so a teacher can point to the passage words that defeat it. A hedge (may, can, some) must not make it true. Do not make it absurd or off-topic: keep the passage's subject matter, the same language, grammatical form and about the same length as the other choices, and do not copy the keyed answer's idea.
Make it a GOOD distractor, not a giveaway. Do NOT simply negate the old choice or swap one word for its opposite (Cheering → Discouraging, can → cannot, Create → Eliminate): a student would cross that out without reading. Instead:
- title / topic / main-idea items: narrow it to one detail or example of the passage, shift the focus to a side point, or state a different relation between the passage's own concepts (wrong cause, purpose or result). It must clearly fail to cover the passage's main point.
- blank items: give a different outcome or reason that sounds natural after the sentence before the blank but conflicts with what the passage says around or after the blank.
The new choice must read as natural English/Korean on its own.
Also return the explanation with ONLY the parts about the rewritten choices updated (same language, same shape, 평서형 "~다"); keep every other sentence as it is.
Return ONE JSON object: {"choices":[{"number":<n>,"text":"<new text>"}],"explanation":"<full explanation>"}`;

export async function repairDistractors(opts: {
  passage: string;
  payload: GeneratedQuestionPayload;
  numbers: number[];
}): Promise<boolean> {
  const { payload, numbers } = opts;
  const key = Number(payload.correctAnswer);
  const targets = numbers.filter((n) => n !== key && (payload.choices ?? []).some((c) => Number(c.number) === n));
  if (!targets.length || !hasChoices(payload)) return false;
  const shown = payload.passageModified?.trim() ? payload.passageModified : opts.passage;
  const choiceLines = (payload.choices ?? []).map((c) => `${c.number}. ${c.text}`).join("\n");
  const user = [
    `INSTRUCTION: ${compact(payload.instruction, 400)}`,
    `\nPASSAGE (___ = blank):\n${compact(shown)}`,
    `\nCHOICES:\n${choiceLines}`,
    `\nKEYED ANSWER: ${key}`,
    `\nWRONG CHOICES TO REWRITE: ${targets.join(", ")}`,
    `\nEXPLANATION:\n${compact(payload.explanation, 1600)}`,
  ].join("\n");
  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: REPAIR_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 2000,
      reasoningEffort: "low",
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-repair-distractor",
    })) as Record<string, unknown>;
  } catch {
    return false;
  }
  const rows = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
  let changed = 0;
  const next = (payload.choices ?? []).map((c) => {
    if (!targets.includes(Number(c.number))) return c;
    const r = rows.find((x) => Number(x.number) === Number(c.number));
    const text = typeof r?.text === "string" ? r.text.trim() : "";
    if (!text || text === c.text) return c;
    changed += 1;
    return { ...c, text };
  });
  if (changed !== targets.length) return false;
  payload.choices = next;
  const expl = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
  if (expl.length >= 10) payload.explanation = expl;
  return true;
}

/*
 * 낯선 낱말만 쉬운 말로 바꾼다(2026-10-04, 12차 시험: 다시 만든 17번 가운데 절반 이상이 상 문항의 낯선 낱말 때문이었고,
 * 그때마다 문항 전체를 다시 만들어 원가가 1.3배까지 떨어졌다). 보기·진술의 그 낱말만 바꾸고 뜻·참거짓·정답은 그대로 둔다.
 * 바꾼 뒤에는 부른 쪽이 같은 검수를 한 번 더 돌린다.
 */
export async function rewriteRareWords(opts: { payload: GeneratedQuestionPayload; words: string[] }): Promise<boolean> {
  const { payload, words } = opts;
  const hasChoices = Array.isArray(payload.choices) && payload.choices.length > 0;
  const user = [
    `WORDS TO REPLACE: ${words.join(", ")}`,
    hasChoices ? `\nCHOICES:\n${(payload.choices ?? []).map((c) => `${c.number}. ${c.text}`).join("\n")}` : "",
    !hasChoices && payload.questionText ? `\nSTATEMENTS:\n${payload.questionText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let raw: Record<string, unknown>;
  try {
    raw = (await questionGeneratorChatJsonWithRetry({
      system: `You edit exam choices for Korean high-school students. Replace ONLY the listed words with common words a 고등학생 knows (고교 수준), keeping each sentence's meaning, truth value, grammar and length. Do not change anything else.
Return ONE JSON object: ${hasChoices ? '{"choices":[{"number":1,"text":"..."}]}' : '{"statements":"the full statements block with the same numbering and line breaks"}'}`,
      user,
      temperature: 0,
      maxTokens: 1500,
      reasoningEffort: "low",
      preferredModels: [SOLVE_MODEL],
      cacheKey: "qg-rewrite-rare",
    })) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (hasChoices) {
    const rows = Array.isArray(raw.choices) ? (raw.choices as Array<{ number?: unknown; text?: unknown }>) : [];
    if (rows.length !== payload.choices!.length) return false;
    payload.choices = payload.choices!.map((c) => {
      const r = rows.find((x) => Number(x.number) === Number(c.number));
      const text = typeof r?.text === "string" && r.text.trim() ? r.text.trim() : c.text;
      return { ...c, text };
    });
    return true;
  }
  const st = typeof raw.statements === "string" ? raw.statements.trim() : "";
  const before = (String(payload.questionText ?? "").match(/\(\d+\)/g) ?? []).length;
  if (!st || (st.match(/\(\d+\)/g) ?? []).length !== before) return false;
  payload.questionText = st;
  return true;
}
