import { findOptionByKey } from "@/lib/question-generator/question-types";
import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadOwnAnalysis, requireExamStaff } from "@/lib/exam-analysis/access";
import { applySlotEdits, buildMockSlots, type MockSlotEdit } from "@/lib/exam-analysis/blueprint";
import { reduceAnswerLeaks } from "@/lib/exam-analysis/passage-leak";
import { levelBriefFor } from "@/lib/exam-analysis/reading-level";
import { countExamMocks, loadExamAnalysis } from "@/lib/exam-analysis/load";
import { extendShortMaterialPassages, loadAcademyMaterialPassages } from "@/lib/exam-analysis/material-passages";
import { lessonCreditShortfall } from "@/lib/credits/lesson-credits";
import { billingFeatureFor } from "@/lib/question-generator/billing-buckets";
import { createJobFromConfig } from "@/lib/question-generator/create-job";
import { runGenerationChunkAndChain } from "@/lib/question-generator/job-chain";
import type { GenerationRequestConfig } from "@/lib/question-generator/types";
import { MIN_SENTENCES_FOR_INSERTION_IRRELEVANT } from "@/lib/question-generator/constants";
import { countEnglishSentences } from "@/lib/question-generator/text-utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/** materialItemId = 수업자료(lesson_material_projects) id */
type PassageIn = { materialItemId?: string; text?: string; title?: string };

/**
 * 동형모의고사 만들기: 분석한 시험의 설계도(번호·유형·난이도·배점)에 새 지문을 배정해 변형문제 작업을 만든다.
 * { passages: [{ materialItemId } | { text, title }], assignment: [묶음마다 지문 번호], title? }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExamStaff();
  if ("error" in auth) return auth.error;
  const { profile } = auth;
  const { id } = await context.params;
  if (!(await loadOwnAnalysis(id, profile.academy_id))) {
    return NextResponse.json({ ok: false, message: "분석을 찾을 수 없어요." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { passages?: PassageIn[]; assignment?: number[];
    /** 배정을 문항마다 보냈는가 (묶음을 푼 경우) */
    perSlot?: boolean; title?: string; round?: number;
    /** 변형문제 화면과 같은 만들기 설정 (선생님 요청 2026-09-30) */
    overallDifficulty?: string;
    paraphraseGrammarVocab?: boolean;
    wordOrderMode?: "passage" | "paraphrase";
    /** 순서 배열 지문: 난이도대로 / 본문 그대로(하) / 주어진 글만 바꿔 쓰기(상) / 지문 일부만 */
    orderMode?: "level" | "original" | "paraphrase" | "excerpt";
    grammarWritingMode?: "passage" | "paraphrase";
    /** 문항 번호마다 바꾼 유형·난이도 */
    slotEdit?: Record<string, MockSlotEdit>;
    /** 한 번에 만들 회차 수 (선생님 요청 2026-10-10) */
    rounds?: number;
  };
  const inputs = (body.passages ?? []).slice(0, 30);
  if (inputs.length === 0) {
    return NextResponse.json({ ok: false, message: "시험 범위 지문을 1개 이상 골라 주세요." }, { status: 400 });
  }

  // 수업자료에서 고른 지문은 서버에서 문장을 이어 붙여 가져온다(내 학원 것만)
  const admin = createAdminClient();
  const materialIds = inputs.map((p) => p.materialItemId).filter((x): x is string => Boolean(x));
  const materials = new Map<string, { title: string; text: string }>();
  if (materialIds.length) {
    const loaded = await loadAcademyMaterialPassages(admin, profile.academy_id, materialIds);
    // 2~4문장짜리 본문은 같은 과의 앞 본문을 붙여 쓴다(material-passages.ts에 까닭)
    const extended = await extendShortMaterialPassages(admin, profile.academy_id, loaded, countEnglishSentences);
    for (const m of loaded) {
      materials.set(m.projectId, { title: `${m.folder} · ${m.title}`, text: extended.get(m.projectId) ?? m.text });
    }
  }
  const passages = inputs.map((p, i) => {
    const m = p.materialItemId ? materials.get(p.materialItemId) : null;
    return {
      clientId: `mock-${i}`,
      title: (m?.title ?? p.title ?? `지문 ${i + 1}`).slice(0, 80),
      sourceDetail: m?.title ?? "",
      text: (m?.text ?? p.text ?? "").trim(),
    };
  });
  const empty = passages.findIndex((p) => p.text.split(/\s+/).filter(Boolean).length < 40);
  if (empty >= 0) {
    return NextResponse.json({ ok: false, message: `${empty + 1}번 지문이 너무 짧아요. 영어 지문 전체를 넣어 주세요.` }, { status: 400 });
  }

  const data = await loadExamAnalysis(id, profile.academy_id);
  if (!data || data.items.length === 0) {
    return NextResponse.json({ ok: false, message: "분석한 문항이 없어요." }, { status: 400 });
  }
  const { slots, groupCount } = buildMockSlots(data.items, { passageRewrite: body.paraphraseGrammarVocab === true });
  const firstRound = (await countExamMocks(id, profile.academy_id)) + 1;
  const rounds = Math.min(10, Math.max(1, Math.floor(Number(body.rounds) || 1)));
  // 문장 삽입·무관한 문장은 6문장 이상 지문이 있어야 만들 수 있다. 짧으면 긴 지문으로 옮기고,
  // 긴 지문이 하나도 없으면 같은 난이도의 순서 배열로 바꾼다(빈 번호가 생기지 않게).
  const longEnough = passages.map((p) => countEnglishSentences(p.text) >= MIN_SENTENCES_FOR_INSERTION_IRRELEVANT);
  /*
   * 고른 지문을 하나도 남기지 않고 쓴다.
   *
   * 선생님 지적(2026-09-30): 지문을 다 골랐는데 고른 지문이 다 안 들어간다.
   * 까닭은 지문을 「묶음」에 하나씩만 주고 있었기 때문이다. 묶음은 원래 시험에서
   * 같은 지문을 쓴 문항끼리 묶은 것이라, 원래 시험의 지문 수보다 많이 고르면
   * 남는 지문은 갈 자리가 없었다(여덟 묶음짜리 시험에 열여섯 지문을 고르면 여덟 개만 썼다).
   *
   * 고른 지문이 묶음보다 많으면 묶음을 풀어 문항마다 다른 지문을 준다.
   * 그러면 문항 수만큼은 반드시 쓰인다. 손으로 정해 둔 자리는 그대로 지킨다.
   */
  const spread = passages.length > groupCount;
  // 화면이 문항마다 정해 보내면 그 차례로 읽는다 (묶음을 푼 경우)
  const perSlot = body.perSlot === true;
  const unitOf = (s: (typeof slots)[number], slotIdx: number) => (perSlot || spread ? slotIdx : s.group);
  const unitCount = perSlot || spread ? slots.length : groupCount;

  // 선생님이 바꾼 유형·난이도·배점 — 객관식↔서술형이 바뀌면 번호도 다시 매긴다(화면과 같은 함수)
  const edited = applySlotEdits(slots, body.slotEdit, (k) => Boolean(findOptionByKey(k)));
  function buildBlueprint(assignment: number[], round: number) {
    return slots.map((s, slotIdx) => {
      const want = assignment[unitOf(s, slotIdx)];
      let passageIndex =
        Number.isInteger(want) && want! >= 0 && want! < passages.length
          ? want!
          : (unitOf(s, slotIdx) + round - 1) % passages.length;
      // 선생님이 그 번호의 유형·난이도를 바꿨으면 그것을 쓴다
      const e = edited[slotIdx]!;
      const level = e.level;
      let optionKey = e.optionKey;
      // 순서 배열을 한 방식으로 고르면 문항 난이도와 상관없이 그 버전으로
      if (optionKey.startsWith("order:") && (body.orderMode === "original" || body.orderMode === "paraphrase")) {
        optionKey = `order:na:${body.orderMode === "original" ? "low" : "high"}:순서추론`;
      }
      if (/^(sentence_insertion|irrelevant_sentence):/.test(optionKey) && !longEnough[passageIndex]) {
        // 긴 지문 가운데 아직 안 쓴(덜 쓴) 것으로 옮긴다 — 첫 긴 지문으로만 옮기면 두 문항이 한 지문을 함께 써 답이 드러났다
        const used = assignment.filter((x) => Number.isInteger(x));
        const longs = longEnough.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
        const alt = longs.length ? longs.reduce((b, i) => (used.filter((x) => x === i).length < used.filter((x) => x === b).length ? i : b)) : -1;
        if (alt >= 0) passageIndex = alt;
        else optionKey = `order:na:${level === "상" ? "high" : "low"}:순서추론`;
      }
      // 원래 문항을 어떻게 냈는지는 유형을 그대로 둘 때만 넘긴다(선생님이 유형을 바꾸면 맞지 않는다)
      const schoolNote = optionKey === s.optionKey ? s.schoolNote : undefined;
      return { no: e.no, passageIndex, optionKey, level, points: e.points, ...(schoolNote ? { schoolNote } : {}) };
    });
  }

  /*
   * 여러 회차를 한 번에 만든다 — 선생님 요청(2026-10-10).
   * 첫 회차는 화면에서 보신 배정 그대로, 다음 회차부터는 지문을 새로 섞는다.
   * 같은 지문이 앞 회차와 같은 유형으로 다시 나오지 않도록, 여러 번 섞어 보고
   * 지문·유형 짝이 가장 적게 겹치는 배정을 고른다.
   */
  const typeBase = (key: string) => key.split(":")[0]!;
  const seenPairs = new Set<string>();
  const remember = (bp: ReturnType<typeof buildBlueprint>) => {
    for (const b of bp) seenPairs.add(`${b.passageIndex}|${typeBase(b.optionKey)}`);
  };
  function randomAssignment(): number[] {
    const order = passages.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return Array.from({ length: unitCount }, (_, u) => order[u % order.length]!);
  }
  /*
   * 지문이 모자라 두 번 쓰는 지문은 원문을 그대로 보이는 유형끼리 나눠 쓰게 한다(2026-11-28 구현고1 동형 —
   * 일치개수 지문에 어형변화 정답 문장, 어법개수 지문에 빈칸 정답이 그대로 보였다). 화면이 정해 보낸 자리는 그대로 둔다.
   */
  const unitKeys: string[][] = Array.from({ length: unitCount }, () => []);
  slots.forEach((s, slotIdx) => unitKeys[unitOf(s, slotIdx)]!.push(edited[slotIdx]!.optionKey));
  const sent = (u: number) => {
    const want = Array.isArray(body.assignment) ? body.assignment[u] : undefined;
    return Number.isInteger(want) && want! >= 0 && want! < passages.length;
  };
  function firstAssignment(round: number): number[] {
    const base = Array.from({ length: unitCount }, (_, u) =>
      sent(u) ? (body.assignment as number[])[u]! : (u + round - 1) % passages.length
    );
    return reduceAnswerLeaks(base, unitKeys, { fixed: base.map((_, u) => sent(u)) });
  }
  const blueprints: { round: number; blueprint: ReturnType<typeof buildBlueprint> }[] = [];
  for (let r = 0; r < rounds; r++) {
    const round = firstRound + r;
    let blueprint: ReturnType<typeof buildBlueprint>;
    if (r === 0) {
      blueprint = buildBlueprint(firstAssignment(round), round);
    } else {
      let best: ReturnType<typeof buildBlueprint> | null = null;
      let bestRepeats = Infinity;
      for (let t = 0; t < 40 && bestRepeats > 0; t++) {
        const bp = buildBlueprint(reduceAnswerLeaks(randomAssignment(), unitKeys), round);
        const repeats = bp.filter((b) => seenPairs.has(`${b.passageIndex}|${typeBase(b.optionKey)}`)).length;
        if (repeats < bestRepeats) {
          best = bp;
          bestRepeats = repeats;
        }
      }
      blueprint = best!;
    }
    remember(blueprint);
    blueprints.push({ round, blueprint });
  }

  /*
   * 만들기 전에 크레딧이 모자라지 않은지 본다.
   *
   * 선생님 요청(2026-09-29): 크레딧이 마이너스가 될 것 같으면 모자란다고 알리고 멈춰 달라.
   * 값은 만든 뒤에 받으므로(후불) 여기서 막지 않으면 잔액이 마이너스가 된다.
   * 어법 유형은 값이 달라서 갈라 센다. 여러 회차면 모든 회차를 합쳐 센다.
   */
  // 갈래는 billing-buckets 한곳에서 정한다(만들 때 차감하는 기준과 같아야 한다)
  const billSlots = new Map<string, number>();
  for (const { blueprint } of blueprints) {
    for (const b of blueprint) {
      const feature = billingFeatureFor(b.optionKey);
      billSlots.set(feature, (billSlots.get(feature) ?? 0) + 1);
    }
  }
  for (const [featureKey, quantity] of billSlots) {
    if (quantity <= 0) continue;
    const short = await lessonCreditShortfall(profile.academy_id, featureKey, quantity);
    if (short) return NextResponse.json({ ok: false, message: short }, { status: 402 });
  }

  const a = data.analysis;
  const baseTitle =
    body.title?.trim().slice(0, 70) ||
    [a.school_name, a.grade ? `${a.grade}학년` : "", a.subject, "동형모의고사"].filter(Boolean).join(" ");
  const baseConfig: Omit<GenerationRequestConfig, "title" | "blueprint"> = {
    schoolName: a.school_name ?? "",
    grade: a.grade ? `고${String(a.grade).replace(/\D/g, "") || "1"}` : "고1",
    sourceType: "자체 지문",
    sourceDetail: a.exam_label ? `${a.exam_label} 동형` : "",
    overallDifficulty: body.overallDifficulty?.trim() || "내신",
    passage: passages[0]!.text,
    passages,
    mode: "custom",
    presetId: null,
    counts: {},
    examAnalysisId: id,
    ...(body.paraphraseGrammarVocab ? { paraphraseGrammarVocab: true } : {}),
    ...(body.wordOrderMode ? { wordOrderMode: body.wordOrderMode } : {}),
    ...(body.orderMode === "excerpt" ? { orderMode: "excerpt" as const } : {}),
    ...(body.grammarWritingMode ? { grammarWritingMode: body.grammarWritingMode } : {}),
    // 원래 시험지에서 잰 수준을 그대로 넘긴다(선생님 요청 2026-09-28: 수준이 정말 반영되도록)
    levelBrief: levelBriefFor({
      sentenceWords: a.sentence_words,
      choiceWords: a.choice_words,
      lexile: a.lexile,
      vocabLevel: a.vocab_level,
    }),
  };

  /*
   * 선생님 지적(2026-09-29): 최다빈 선생님이 문제를 꽤 만드는데 차감이 안 된다.
   *
   * 값은 실제로 만들어진 문항 수만큼 작업이 끝날 때 받는다(billGeneratedQuestions).
   * 그런데 그쪽은 request_config에 _billing 표시가 있어야 일한다. 변형문제 화면은
   * 시작할 때 /jobs/[id]로 그 표시를 붙이는데, 동형모의고사는 여기서 바로 돌리느라
   * 붙이지 않았다. 그래서 동형모의고사로 만든 문항은 값을 한 푼도 안 받고 있었다
   * (2026-09-29까지 네 학원 1,383문항).
   */
  const supabase = await createClient();
  const origin = new URL(request.url).origin;
  const jobIds: string[] = [];
  for (const { round, blueprint } of blueprints) {
    // 회차 이름은 자동으로 「1차」「2차」… — 이 시험으로 만든 동형모의고사 차례대로
    const config: GenerationRequestConfig = { ...baseConfig, title: `${baseTitle} ${round}차`, blueprint };
    const result = await createJobFromConfig(supabase, profile.id, profile.academy_id, {
      ...config,
      _billing: { mode: "post", billed: 0, billedAt: new Date(0).toISOString() },
    } as typeof config);
    if ("error" in result) {
      if (jobIds.length === 0) {
        return NextResponse.json({ ok: false, message: result.error }, { status: result.status ?? 400 });
      }
      break;
    }
    jobIds.push(result.jobId);
    after(() => runGenerationChunkAndChain(result.jobId, origin));
  }
  /*
   * 그래도 남는 지문이 있으면(고른 지문이 문항 수보다 많을 때) 몇 개가 남는지 알린다.
   * 말없이 빼 버리면 선생님은 다 들어간 줄 안다.
   */
  const used = new Set(blueprints[0]!.blueprint.map((b) => b.passageIndex));
  const unused = passages.length - used.size;
  return NextResponse.json({
    ok: true,
    jobId: jobIds[0],
    jobIds,
    requestedRounds: rounds,
    passageCount: passages.length,
    usedPassageCount: used.size,
    unusedPassageCount: unused,
  });
}
