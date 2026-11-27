import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/get-profile";
import {
  wrongFitsWordLevel,
  type StoredVocabChoiceCache,
  type VocabWordLevel,
} from "@/lib/lesson-materials/vocab-choice";
import { suggestGrammarWrong, suggestVocabOpposite } from "@/lib/lesson-materials/choice-edit";
import { engcoreWordPos } from "@/lib/vocab/engcore-level";
import { callGrammarChoiceV2Json } from "@/lib/lesson-materials/grammar-choice-v2/openai-call";
import { resolveV2AnalyzerModel } from "@/lib/lesson-materials/grammar-choice-v2/generate";
import { flushAiUsage, withAiUsage } from "@/lib/ai-usage/context";
import { aiCallsLastDay } from "@/lib/ai-usage/daily-cap";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 워크북 어법·어휘 선택에 선생님이 자리를 직접 더할 때, 그 자리에 넣을 틀린 말 후보.
 * 어법은 규칙(단어장 품사로 없는 활용형을 거른다), 어휘는 이 지문을 만들 때 나온 짝(검수를
 * 거친 것)에서 먼저 찾는다.
 *
 * 선생님 요청(2026-10-20): 문항을 더할 때 알아서 제안하게. 규칙·저장된 짝으로 못 찾으면
 * (어법은 활용형이 없는 낱말, 어휘는 짝이 없는 낱말) 지문 문맥을 주고 모델에 한 번 묻는다.
 * 낱말 하나에 짧게 묻는 보조 호출이라 크레딧은 받지 않고 원가만 기록한다.
 */
const SYSTEM_GRAMMAR = `당신은 고등학교 영어 내신 어법 문항 출제자이다.
지문의 한 자리(target)를 [맞는 말 / 틀린 말] 어법 선택 문항으로 만든다. 그 자리에 넣을 "어법상 틀린 말" 후보를 3개까지 낸다.
- 원래 말과 같은 낱말 뿌리나 같은 기능의 말로, 문법만 틀리게 한다(수 일치, 시제·태, 분사, 동명사/to부정사, 관계사·접속사, 형용사/부사, 대명사 수·격 등).
- 그 문장에서 반드시 틀려야 한다. 넣어도 문법적으로 맞을 수 있는 말은 내지 않는다.
- 실재하는 영어 꼴만 쓴다. 원래 말의 대소문자를 따른다.
- 묻기 좋은 것부터 차례로 낸다. 어법으로 물을 거리가 없는 자리면 빈 목록을 낸다.
- alreadyShown이 오면 그 말들은 내지 않고 다른 말을 낸다.`;

const SYSTEM_VOCAB = `당신은 고등학교 영어 내신 어휘 문항 출제자이다.
지문의 한 자리(target)를 [맞는 말 / 틀린 말] 어휘 선택 문항으로 만든다. 그 자리에 넣을 "문맥상 틀린 낱말" 후보를 3개까지 낸다.
- 원래 낱말과 품사·어형(시제, 수, -ing/-ed/-ly, 비교급)이 같아 문법만으로는 가려지지 않아야 한다.
- 넣으면 지문 내용과 확실히 모순되어야 한다. 반의어나 논리를 뒤집는 말이 좋다. 동의어·비슷한 말은 내지 않는다.
- 바로 앞에 a/an이 있으면 그 관사와 맞는 낱말을 쓴다. 원래 낱말의 대소문자를 따른다.
- alreadyShown이 오면 그 말들은 내지 않고 다른 말을 낸다.
- wordLevel이 "normal"이면 중학생이 아는 쉬운 낱말로만 낸다. "hard"면 고2~수능 수준 낱말도 쓰고, 어려운 낱말을 먼저 낸다.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: { suggestions: { type: "array", maxItems: 3, items: { type: "string" } } },
} as const;

/** 값 없는 보조 호출이라 학원마다 하루 호출 수에 테두리를 둔다(「새로 추천받기」를 되풀이해도, 2026-11-28) */
const SUGGEST_DAILY_CAP = 600;

async function askModel(input: {
  kind: "grammar" | "vocab";
  word: string;
  sentence: string;
  passage: string;
  academyId: string;
  actorId: string;
  projectId: string;
  wordLevel: VocabWordLevel;
  /** 이미 보인 말 — 이것들 말고 다른 말을 낸다 */
  avoid: string[];
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !input.sentence) return [];
  try {
    if ((await aiCallsLastDay(input.academyId, "workbook_choice_suggest")) >= SUGGEST_DAILY_CAP) return [];
    const called = await withAiUsage(
      { academyId: input.academyId, actorId: input.actorId, usedFor: "workbook_choice_suggest", projectId: input.projectId },
      () =>
        callGrammarChoiceV2Json({
          stage: "GENERATOR",
          apiKey,
          model: resolveV2AnalyzerModel(),
          reasoningEffort: "none",
          system: input.kind === "grammar" ? SYSTEM_GRAMMAR : SYSTEM_VOCAB,
          user: JSON.stringify({
            // 어법은 그 문장만 봐도 되고, 어휘는 글 전체의 흐름을 봐야 한다.
            ...(input.kind === "vocab" ? { passage: input.passage.slice(0, 4000) } : {}),
            sentence: input.sentence,
            target: input.word,
            ...(input.kind === "vocab" ? { wordLevel: input.wordLevel } : {}),
            ...(input.avoid.length ? { alreadyShown: input.avoid.slice(0, 12) } : {}),
          }),
          schemaName: "choice_suggest",
          schema: SCHEMA as unknown as Record<string, unknown>,
          maxCompletionTokens: 300,
          hedgeAfterMs: null,
          deadlineMs: 25_000,
        })
    );
    await flushAiUsage();
    const parsed = JSON.parse(called.content) as { suggestions?: unknown[] };
    return (parsed.suggestions ?? [])
      .map((s) => String(s).trim())
      .filter((s) => /^[A-Za-z][A-Za-z' -]*$/.test(s) && s.split(/\s+/).length <= 4);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "teacher") || !profile.academy_id) {
      return NextResponse.json({ ok: false, message: "권한이 없습니다." }, { status: 403 });
    }
    const body = (await request.json()) as {
      projectId?: string;
      word?: string;
      kind?: string;
      sentence?: string;
      passage?: string;
      /** 워크북의 어휘 수준(일반 / 난이도 UP). 어휘 추천에만 쓴다. */
      wordLevel?: string;
      /** 「새로 추천받기」: 규칙·저장된 짝을 건너뛰고 avoid 말고 다른 말을 문맥으로 고른다 */
      fresh?: boolean;
      avoid?: unknown[];
    };
    const projectId = String(body.projectId ?? "").trim();
    const raw = String(body.word ?? "").trim();
    const word = raw.toLowerCase();
    if (!projectId || !word) return NextResponse.json({ ok: true, suggestions: [] });
    const kind = body.kind === "grammar" ? "grammar" : "vocab";
    const wordLevel: VocabWordLevel = body.wordLevel === "hard" ? "hard" : "normal";
    const fresh = body.fresh === true;
    const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map((a) => String(a).trim()).filter(Boolean);
    const avoidSet = new Set(avoid.map((a) => a.toLowerCase()));
    const model = () =>
      askModel({
        kind,
        word: raw,
        sentence: String(body.sentence ?? "").trim().slice(0, 1000),
        passage: String(body.passage ?? ""),
        academyId: profile.academy_id!,
        actorId: profile.id,
        projectId,
        wordLevel,
        avoid: fresh ? avoid : [],
      });
    const clean = (list: string[]) => {
      const seen = new Set<string>();
      return list.filter((s) => {
        const k = s.toLowerCase();
        if (!s || k === word || seen.has(k) || avoidSet.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    if (fresh) {
      if ((await aiCallsLastDay(profile.academy_id, "workbook_choice_suggest")) >= SUGGEST_DAILY_CAP) {
        return NextResponse.json({ ok: false, message: "오늘 새로 추천받을 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요." });
      }
      const suggestions = clean(await model());
      const ordered =
        kind === "vocab"
          ? [...suggestions.filter((s) => wrongFitsWordLevel(s, wordLevel)), ...suggestions.filter((s) => !wrongFitsWordLevel(s, wordLevel))]
          : suggestions;
      return NextResponse.json({ ok: true, suggestions: ordered });
    }

    if (kind === "grammar") {
      const rules = suggestGrammarWrong(raw, engcoreWordPos);
      const suggestions = clean(rules.length ? rules : await model());
      return NextResponse.json({ ok: true, suggestions: suggestions.slice(0, 4) });
    }

    const supabase = await createClient();
    const { data } = await supabase
      .from("lesson_material_projects")
      .select("lesson_pack_json")
      .eq("id", projectId)
      .eq("academy_id", profile.academy_id)
      .maybeSingle();
    const pack = (data?.lesson_pack_json ?? {}) as {
      vocabChoiceCache?: StoredVocabChoiceCache | null;
      vocab?: Array<{ word?: string; antonyms?: string[] }>;
    };
    // 저장된 짝도 이 워크북 수준에 맞는 것만 쓴다(일반인데 어려운 짝이면 문맥을 보고 새로 고른다).
    const saved: string[] = [];
    for (const p of pack.vocabChoiceCache?.pairs ?? []) {
      if (p.targetText.trim().toLowerCase() === word && wrongFitsWordLevel(p.wrongText, wordLevel)) {
        saved.push(p.wrongText.trim());
      }
    }
    // 검수를 거친 짝이 없으면 문맥을 보고 만든다. 단어장 반의어·쉬운 반대말 표는 문맥을 모르므로 뒤에 둔다.
    const fromModel = saved.length ? [] : await model();
    const antonyms: string[] = [];
    for (const v of pack.vocab ?? []) {
      const w = String(v.word ?? "").trim().toLowerCase();
      if (w && (w === word || word.startsWith(w))) antonyms.push(...(v.antonyms ?? []).map((a) => String(a).trim()));
    }
    const all = clean([...saved, ...fromModel, ...antonyms, ...suggestVocabOpposite(raw)]);
    // 일반이면 쉬운 낱말을 앞세운다. 다 걸러지면(단어장에 없는 낱말뿐) 그대로 보여 준다.
    const fit = all.filter((s) => wrongFitsWordLevel(s, wordLevel));
    const suggestions = [...fit, ...all.filter((s) => !fit.includes(s))];
    return NextResponse.json({ ok: true, suggestions: suggestions.slice(0, 6) });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "제안을 찾지 못했습니다." });
  }
}
