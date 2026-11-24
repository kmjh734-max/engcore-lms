/**
 * 변형문제 전 유형 회귀 검사 — API·DB 없이, 커밋 전에(선생님 2026-11-24 「자꾸 문제가 생기면 안 되는데」).
 *
 * 그날 실제 생성 점검에서 나온 빠짐은 코드끼리 맞물리는 자리였다(1지문 다문항 표시 목록에 새 유형 다섯이 빠짐,
 * 보기를 고친 뒤 규칙 검사를 안 거침). 모델을 부르지 않고 잡을 수 있는 것은 여기서 미리 잡는다.
 *
 *  1) 사례(cases.json, 사람이 쓴 모델 답)를 생성 함수의 다듬기·모양 검사·규칙 검사에 태운다 — 버려질 문항이면 실패
 *  2) 지문에 빈칸·밑줄을 치는 유형이 1지문 다문항 표시 목록(passage-set MARK_FAMILY)에 없으면 실패
 *  3) 모든 유형이 크레딧 갈래·개수 정리를 통과하는지
 *  4) 사례가 없는 유형이 새로 생기면 실패 — 새 유형은 사례부터 쓴다(UNCOVERED는 그날 이미 있던 유형)
 *
 *   npx tsx scripts/qg-regress/regress.mts        (quick-check.sh가 변형문제 파일이 바뀌면 부른다)
 */
import fs from "node:fs";
import path from "node:path";
import { generateOneQuestion } from "../../src/lib/question-generator/generate-question";
import { shouldRegenerate, validateGeneratedQuestion } from "../../src/lib/question-generator/validate-question";
import { QUESTION_TYPE_GROUPS, findOptionByKey, sanitizeCounts } from "../../src/lib/question-generator/question-types";
import { billingFeatureFor } from "../../src/lib/question-generator/billing-buckets";
import { isSetAllowedKey, isSetMarkKey } from "../../src/lib/question-generator/passage-set";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
/*
 * 사례 파일에는 교과서·모의고사 지문 원문이 들어 있어 저장소에 올리지 않는다(이 컴퓨터에만, _build-cases.mts로 만든다).
 * 없으면 지문 없이 되는 검사(3·4번 중 크레딧·개수 정리)만 돈다.
 */
const casesFile = path.join(here, "cases.json");
const hasCases = fs.existsSync(casesFile);
const cases = (hasCases ? JSON.parse(fs.readFileSync(casesFile, "utf8")) : []) as Array<{ key: string; passage: string; raw: Record<string, unknown> }>;
if (!hasCases) console.log("(사례 파일이 없어 유형 연결 검사만 합니다 — npx tsx --env-file=.env.local scripts/qg-regress/_build-cases.mts)");
const analysis = {
  overallTopic: "test",
  overallMainIdea: "test",
  titleCandidates: ["Test"],
} as never;

/** 2026-11-24에 이미 있었고 사례가 아직 없는 유형 — 여기에 새로 넣지 말고 cases.json에 사례를 쓴다 */
const UNCOVERED = new Set([
  "content_true:en:low:내용일치", "content_true:ko:low:내용일치", "content_true:ko:high:내용일치",
  "content_false:en:low:내용불일치", "content_false:ko:low:내용불일치", "content_false:ko:high:내용불일치",
  "content_count:en:low:일치개수", "content_count:ko:low:일치개수", "content_count:ko:high:일치개수",
  "order:na:low:순서추론", "sentence_blank:en:low:빈칸추론", "sentence_insertion:na:low:문장삽입",
  "irrelevant_sentence:na:low:무관한문장", "underlined_inference:en:default:목적추론", "underlined_inference:en:default:심경추론",
  "title:en:low:제목추론", "title:ko:low:제목추론", "title:ko:high:제목추론",
  "topic:en:low:주제추론", "topic:ko:low:주제추론", "topic:ko:high:주제추론", "summary_mcq:ko:low:요지추론",
  "writing:na:default:제시어배열어형변화", "writing:na:default:제시어배열단어추가", "writing:na:default:문법조건영작",
  "summary_short:na:default:요약문빈칸2단어", "summary_short:na:default:요약문빈칸3단어",
  "grammar:na:default:어법오류수정2", "grammar:na:default:어법문장오류수정", "grammar:na:high:어법개수",
  "sentence_blank:en:high:요약완성AB", "vocabulary:na:default:어휘추론",
  "content_false:en:high:내용불일치", "content_count:en:high:일치개수", "sentence_blank:en:default:연결어빈칸",
]);

const fails: string[] = [];
const squash = (t: string) => t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// 1) 2) 사례
const silence = console.log;
for (const c of cases) {
  const option = findOptionByKey(c.key);
  if (!option) {
    fails.push(`${c.key}: 유형 키가 없어졌습니다`);
    continue;
  }
  try {
    console.log = () => {};
    const payload = await generateOneQuestion({
      passage: c.passage, analysis, option, grade: "고1", overallDifficulty: "내신",
      offlineRaw: structuredClone(c.raw), typeTurn: 0, attempt: 2, retryNote: "offline",
    });
    console.log = silence;
    const v = validateGeneratedQuestion({ passage: c.passage, option, question: payload });
    if (shouldRegenerate(v)) fails.push(`${c.key}: 규칙 검사에서 버려짐 — ${v.warnings.join(" · ")}`);
    const mod = String(payload.passageModified ?? "");
    if (mod && squash(mod) !== squash(c.passage) && isSetAllowedKey(c.key) && !isSetMarkKey(c.key)) {
      fails.push(`${c.key}: 지문에 표시를 하는데 1지문 다문항 표시 목록(passage-set.ts MARK_FAMILY)에 없습니다`);
    }
  } catch (e) {
    console.log = silence;
    fails.push(`${c.key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 3) 4) 모든 유형
const covered = new Set(cases.map((c) => c.key));
for (const g of QUESTION_TYPE_GROUPS)
  for (const o of g.options) {
    if (!billingFeatureFor(o.key)) fails.push(`${o.key}: 크레딧 갈래 없음`);
    if ((sanitizeCounts({ [o.key]: 1 })[o.key] ?? 0) !== 1) fails.push(`${o.key}: 개수 정리에서 빠짐`);
    if (hasCases && !covered.has(o.key) && !UNCOVERED.has(o.key)) fails.push(`${o.key}: 새 유형에 사례가 없습니다 — scripts/qg-regress/cases.json에 모델 답 사례를 먼저 쓰세요`);
  }

if (fails.length) {
  console.log(`== 변형문제 회귀 검사 실패 ${fails.length}건`);
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
console.log(`변형문제 회귀 검사 통과 (사례 ${cases.length}개 · 유형 ${QUESTION_TYPE_GROUPS.reduce((n, g) => n + g.options.length, 0)}개)`);
