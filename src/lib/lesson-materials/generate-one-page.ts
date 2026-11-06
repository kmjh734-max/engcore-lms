import { plainKorean } from "@/lib/question-generator/plain-korean";
import {
  isGpt5FamilyModel,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  studentRecordModelSupportsTemperature,
} from "@/lib/student-records/model";
import {
  ONE_PAGE_CONTENT_VERSION,
  findPhrase,
  namesSomething,
  sameWords,
  onePageSourceHash,
  sortOnePageMarks,
  type OnePageContent,
  type OnePageExamPoint,
  type OnePageExamPointKind,
  type OnePageGrammarPoint,
  type OnePageImplication,
  type OnePageParaphrase,
  type OnePageReference,
  type OnePageTfItem,
  type OnePageVocabNote,
} from "@/lib/lesson-materials/one-page";
import { scanReferenceCandidates } from "@/lib/lesson-materials/one-page-reference-scan";
import { hashSeedToUint32 } from "@/lib/lesson-materials/sentence-order-shuffle";
import { rejectFabricatedDistractor } from "@/lib/lesson-materials/grammar-choice-v2/distractor-guard";
import { validateMinimalPair } from "@/lib/lesson-materials/grammar-choice-v2/minimal-pair";
import {
  onePageGrammarRule,
  onePageGrammarRulesText,
  textbookWeightOf,
} from "@/lib/lesson-materials/one-page-grammar-rules";
import {
  examBlankFocusRules,
  examGrammarCase,
  examGrammarCaseBlock,
  examParaphraseFocusRules,
} from "@/lib/lesson-materials/one-page-exam-focus";
import {
  verifyOnePageGrammar,
  verifyOnePageReferences,
  verifyOnePageTranslations,
  verifyOnePageVocab,
} from "@/lib/lesson-materials/one-page-verify";
import { formatWorkbookPassage } from "@/lib/lesson-materials/workbook-types";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

/**
 * 1장 요약직보자료·1장 테스트 재료를 만든다: 한글 주제, 영어 제목, 요약문(핵심 어구·해석), 도식화,
 * 동·반의어, 어법 포인트, 지칭 정리, 표현 바꿔 쓰기, T/F, 영작 문장.
 * 시험지의 어법 선택·어휘 선택은 워크북 문항을 쓰므로 여기서 만들지 않는다.
 *
 * 2026-09-16 선생님 지적을 받아 세 겹으로 거른다.
 * 1) 프롬프트: 어법은 워크북 엔진의 교재 규칙 목록(one-page-grammar-rules)에 있는 것만, 두 형태가
 *    다 맞는 자리는 금지. 낱말은 한 낱말·같은 품사·진짜 반대말만.
 * 2) 코드: 본문에 있는 그대로인지, 그 문장에 한 번만 나오는지, 밑줄이 근거(cue)까지 덮는지,
 *    오답이 굴절·기능어 하나만 다른지(워크북의 오답 검사를 그대로 쓴다)를 본다.
 * 3) 검수(one-page-verify): 값싼 모델에 항목을 하나씩 되물어 두 형태가 다 맞거나 설명·동반의어·
 *    지칭·해석이 틀린 것을 버리거나 고친다. 버려서 모자라면 겹치지 않는 것으로 더 뽑는다.
 */

/**
 * 기본은 gpt-5-mini(추론 low). 2026-09-16 같은 지문으로 비교: gpt-4o·gpt-4.1은 어법 포인트가
 * 3~4개에 그치고 설명이 틀린 것이 섞였고(가주어 진주어를 "common 뒤 to부정사"로 설명), gpt-5-mini는
 * 5개를 맞게 설명했다. 만들기·지칭 풀이·검수·보충을 모두 나눠 동시에 부르므로 지문 하나에
 * 80초 안팎(옛 방식은 140~180초), 약 50원이 든다.
 */
/*
 * 어법 포인트를 만드는 설정은 여러 가지로 재 봤다(2026-09-17, 같은 9문장 지문).
 *   gpt-5-mini · 생각 조금  = 33초, 어법이 제대로 나온다 (지금 쓰는 것)
 *   gpt-5-mini · 생각 최소  = 20초, 엉뚱한 자리를 집는다 (선생님 지적한 그 증상)
 *   gpt-5.5   · 생각 최소  = 107초, 너무 느리다
 *   조각을 더 잘게 나누기   = 40초, 호출이 서로 밀려 오히려 느려진다
 *   늦은 조각 한 번 더 부르기 = 43초, 같은 이유로 느려진다
 * 그래서 값싼 모델에 생각을 조금 남겨 두는 지금 조합을 그대로 둔다.
 */

export function resolveOnePageModel(): string {
  return process.env.OPENAI_MODEL_ONE_PAGE?.trim() || "gpt-5-mini";
}

const VOCAB_SECTION = `[vocab] 이 지문의 뜻을 떠받치는 핵심 낱말(개수는 아래 지시를 따른다).
- 고르는 기준은 '어려운 낱말'이 아니라 '내용상 중요한 낱말'이다. 그 낱말을 반대말로 바꾸면 글의 흐름·주장이 뒤집히는 낱말을 먼저 고른다(increase↔decrease, sustain↔lose, necessarily↔hardly). 어렵기만 하고 바꿔도 논지가 그대로인 낱말은 넣지 않는다.
- 진짜 반대말이 있는 낱말을 먼저 고른다. 반대말이 없는 낱말(astronomy, novel, experience처럼 반의어가 빈 낱말)은 논지를 가르는 낱말에 밀린다.
- 앞에 쓴 것일수록 논지가 더 많이 걸린 낱말이 되게 순서를 매겨 낸다.
- 이 지문의 키워드를 먼저 고른다: 주제문·요약문에 들어갈 말, 지문에서 되풀이되거나 다른 말로 바꿔 다시 나오는 말, 그 낱말을 모르면 글을 못 읽는 말. 지나가는 자리의 낱말은 뒤로 민다.
- 고를 것: 글의 주제·논지를 나르는 내용어(명사·동사·형용사·부사). 쉬운 낱말이라도 논지를 가르면 넣는다.
- 빼야 할 것: 중학 수준의 쉬운 낱말(steal, cash, money, help, balance), 고유명사·약어(NEAs, Jackson High School), 숫자·단위, 두 낱말 이상의 구(그런 표현은 paraphrases로 보낸다), 한 지문에서 같은 어근인 낱말(diversify·diversity·variety 중 하나만).
- surface: 지문에 나온 형태 그대로의 낱말 하나(하이픈으로 이어진 낱말은 하나로 본다). 구는 안 된다. no: 그 낱말이 나온 문장.
- meaningKo: 이 문맥에서의 뜻 하나만, 품사에 맞게 쓴다(명사는 "~것", 동사는 "~하다", 형용사는 "~한"). 여러 뜻을 늘어놓지 않는다.
- synonyms: 이 뜻으로 그 자리에 넣어도 말이 되는 낱말 2개. surface와 품사가 같아야 하고(명사↔명사, 동사↔동사), 한 낱말짜리를 먼저 쓴다. 지어낸 어구(ethical license, mountain vents 같은 것)는 쓰지 않는다.
- antonyms: 이 뜻의 진짜 반대말 2개, 품사도 같아야 한다. "다른 것"은 반대말이 아니다(asteroid↔comet, diameter↔radius, wages↔poverty는 틀렸다). 진짜 반대말이 없으면 []로 두고, 그런 낱말은 애초에 고르지 않는 편이 낫다.`;

const GRAMMAR_SECTION = `어법은 두 걸음으로 만든다. scan을 먼저 채우고, 그 안에서 고른 것만 grammar에 넣는다.

[scan] 1차 — 지문의 문법 자리를 구조로 훑는다 (아직 문항으로 만들지 않는다)
문장을 하나씩 구조로 읽고, 고등학교 모의고사·수능이 다루는 문법 지점을 적는다.
아래 넷 가운데 둘 이상에 해당해야 적는다.
 1) 모의고사 밑줄 어법 선택지로 바꿀 수 있다
 2) 문장 구조를 봐야 형태의 맞고 틀림을 가릴 수 있다
 3) 고등학생이 헷갈릴 다른 형태가 있다
 4) 정확한 해석에 실질적으로 영향을 준다
적지 않는 것: 단순 현재·과거시제, 일반 복수·3인칭 단수, 일반 관사·전치사, 단순 SVO,
단순 조동사+동사원형, to부정사에 이름만 붙이기, 모든 V-ing를 동명사라고 하기, 단순 be+p.p., 일반 숙어·어휘.
- term: 구조를 가리키는 문법 항목 이름(관계대명사 what, 전치사+동명사, 지각동사 목적격보어, 분사구문처럼).
  V-ing를 아무 데나 분사라고 하지 않는다 — 전치사 뒤면 동명사, 명사를 꾸미면 분사,
  부사구를 이루면 분사구문, 동사의 목적어면 동명사다. p.p.도 마찬가지로 수동태·분사·완료를 가려 적는다.
- span: 그 자리가 든, 지문에 나온 그대로의 부분(2~10 words).
- structure: 그 문장의 구조를 한 줄로. 예) 주절: they(S) have seen(V) the kind(O) // 관계사절: we(S') have seen(V') bring about(C')
- hard: 1~5. 고등학생이 실제로 틀릴 만한 정도. 아래 잣대로 매긴다.
  · 1~2 — 앞말만 보면 바로 풀리는 자리. 전치사 뒤 동명사, 관사 뒤 명사, 형용사·부사 자리,
    주어 바로 뒤 수일치처럼 구조를 따질 것 없이 형태만 맞추면 되는 것.
  · 3 — 한 가지를 더 따져야 하는 자리. 수식어가 하나 끼어든 수일치, 분사의 능동·수동.
  · 4~5 — 문장 구조를 읽어야 풀리는 자리. 긴 주어·삽입절을 건너뛴 수일치, 관계사의 격과
    선행사, 병렬의 짝, 시제의 앞뒤 관계, 가정법·도치처럼 학생이 실제로 자주 틀리는 것.
- why: 무엇을 알아야 이 자리를 가릴 수 있는지 한국어 한 줄(20~40자).
이번에 받은 문장에서만, 문장마다 많아야 2개씩 적는다. 같은 원리가 되풀이되면 대표 하나만.
scan은 고르기 위한 메모다 — 짧게 적고, 없으면 적지 않는다.

[grammar] 2차 — scan에 적은 것 가운데 내신 어법 선택·수정 문제로 그대로 낼 수 있는 자리만 고른다
hard가 큰 것부터 본다. hard가 4~5인 자리를 먼저 다 담고, 모자랄 때만 3을 담는다.
hard가 1~2인 자리(전치사 뒤 동명사 같은 것)는 그 위 자리가 모자랄 때만 담는다 —
쉬운 자리로 개수를 채우면 정작 시험에 나올 자리가 밀려난다. code는 아래 GRAMMAR_RULES에 있는 것만 쓴다.
각 자리는 다음을 모두 만족해야 하고, 하나라도 어기면 그 자리는 빼라.
1) 이 문장에서 맞는 형태가 오직 하나여야 한다. 다른 형태도 문법에 맞으면 싣지 않는다. 예를 들어 주어 자리의 동명사(to부정사도 주어가 된다), 콤마 없는 관계절의 that/which, 목적격 관계대명사 생략, help 뒤의 원형/to V, 목적어절의 if/whether, 강조구문의 that/who는 모두 둘 다 되므로 금지다.
2) 관사, 쉼표, 철자, 단수·복수 표기, 생략된 말은 고르게 할 수 없으니 금지다.
   조동사 뒤(would become/would becomes)와 to 뒤(to go/to goes)도 금지다 — 틀린 쪽이 영어에 아예 없는 말이다.
   지각·사역동사 뒤(see him go, make her stay)는 오답을 to부정사로 세울 때만 낸다(see him to go).
   원형과 V-ing를 맞세우는 것(see him go / see him going)은 둘 다 맞으므로 금지다.
3) 답을 정하는 근거가 같은 문장 안에 드러나 있어야 한다.
4) 주어가 동사 바로 앞에 있는 인칭·수 일치(I am, you need, they feel, Humans enjoy, There are)는 시험에 나오지 않는다. 수일치는 주어와 동사 사이에 수식어구·관계절이 끼어 있을 때만 낸다.
5) code가 말하는 원리와 실제로 묻는 원리가 같아야 한다. 전치사 뒤 V-ing를 분사·분사구문 코드로 내지 않는다.
- 아래에 적힌 개수만큼 낸다. 검수에서 걸러지므로 넉넉히 내되, hard가 낮은 것으로 개수를 채우지는 않는다.
  조건 1~5를 지키는 자리가 그만큼 없으면 있는 만큼만 낸다.
- from: 그 자리가 나온 scan 항목의 번호(1부터 센다).
- hard: scan에 적은 값 그대로.
- caseId: 아래 "어법 빈출 자리"에 있는 id 그대로. 그 목록에 없으면 "".
- code: GRAMMAR_RULES의 코드 그대로.
- target: 근거와 정답을 함께 담은, 지문에 나온 그대로의 부분(3~12 words). 정리자료에서 이 부분에 밑줄이 그어지므로 explanation이 말하는 것이 모두 이 안에 있어야 한다. 그 문장에 두 번 나오는 부분은 고르지 않는다.
- right: target 안에서 정답이 되는 낱말(1~3 words), 지문 그대로.
- cue: 오답이 왜 안 되는지를 정해 주는 말(진짜 주어 명사, 선행사, 전치사, to부정사의 to, 수동태의 be·been, 시간 표시어, 연결동사 등), 지문 그대로. 이 말은 반드시 target 안에 있어야 한다.
- wrong: right와 한 가지만 다른 형태(굴절 하나 또는 기능어 하나). 학생이 실제로 하는 실수여야 하고 영어에 있는 형태여야 한다(slow downing, would caused, won’t able처럼 없는 형태 금지). 낱말을 덧붙이거나 빼지 않는다.
- wrongWhy: wrong이 이 문장에서 왜 틀렸는지 한국어 한 문장. "어색하다", "덜 자연스럽다"가 아니라 문법적으로 왜 안 되는지 적는다. 그렇게 쓸 수 없으면 그 자리를 빼라.
- explanation: right가 맞는 이유를 한국어 한 문장(35자 안팎, 짧을수록 좋다). 근거가 되는 본문 낱말을 그대로 적어 말한다("target", "cue", "문장" 같은 말은 쓰지 않는다). "~다"로 끝나는 평서형으로 쓰고(존댓말 금지), 본문에 없는 규칙을 지어내지 않는다.`;

const COMMON_HEADER = `너는 한국 고등학교 내신 영어 시험 대비 "1장 요약직보자료"와 "1장 테스트" 재료를 만드는 편집자다.
입력 지문(문장마다 no가 있다)만 근거로 쓰고, 정해진 JSON으로만 답한다.

[공통]
- no는 입력 문장 번호를 그대로 쓴다.
- surface·target·right·expression은 그 문장(no)에 나온 글자 그대로 복사한다(대소문자·어형 포함, 바꾸거나 줄이지 않는다).
- 한국어는 짧고 자연스럽게 쓴다.

`;

/**
 * 만드는 호출을 셋으로 나눠 한꺼번에(병렬로) 부른다. 선생님 지적: "1장 요약직보자료 실행속도가
 * 너무 느려요." 한 호출이 모든 갈래를 다 쓰느라 출력이 길어져 그 길이가 그대로 대기 시간이 됐다.
 * 갈래를 나누면 가장 긴 호출 하나만큼만 기다린다(합이 아니라 최댓값).
 */
const CORE_PROMPT = `${COMMON_HEADER}
[topicKo] 지문의 주제를 한국어 한 문장(35~60자)으로. "~다."로 끝낸다.
[titleEn] 지문 내용을 담은 영어 제목(4~10 words, Title Case).
[summary]
- en: 지문 전체를 요약한 영어 한 문장(22~38 words). 지문 문장을 그대로 베끼지 말고 바꿔 쓴다.
- keywords: en 안에 철자·대소문자까지 똑같이 들어 있는 핵심 어구 3~4개(각 1~4 words, 서로 겹치지 않음, en에 나오는 순서대로). 요약문 빈칸 문제의 정답이 되므로 주제를 드러내는 내용어를 고르고, 관사·전치사만으로 된 어구는 안 된다.
- ko: en의 자연스러운 한국어 해석.
- verbs: keywords 안에 든 동사마다 { form: en에 쓰인 꼴 그대로, base: 원형 }. 동사만 넣고 명사·형용사·부사는 넣지 않는다(복수 명사는 동사가 아니다). be동사·have는 base를 be·have로. 동사가 없으면 빈 배열.
[flow] 글의 논리 흐름 4~5단계. 이 칸만 읽어도 글의 줄거리가 잡혀야 한다 — 라벨만 달고 끝내지 않는다.
- en: "라벨: 그 단계에서 실제로 무슨 일이 있었는지" 꼴로 8~16 words. 라벨 예: Assumption, Claim, Example, Counter-example, Cause, Result, Contrast, Solution, Conclusion.
  나쁜 예(너무 짧다): "Background: Evolutionary monitoring function"
  좋은 예: "Background: Humans evolved to watch how others react to them"
  주어와 동사가 있는 문장 꼴로 쓰고, 누가 무엇을 하는지/무엇이 무엇을 낳는지가 드러나게 한다.
- ko: 같은 내용의 한국어(20~45자). 영어를 그대로 옮기되 자연스럽게.
- 마지막 단계는 결론·교훈이다.
- from, to: 이 단계의 근거가 되는 문장 번호 범위(from ≤ to). 단계는 지문 순서대로 놓고, 앞 단계의 to보다 뒤 단계의 from이 커야 한다(범위가 겹치지 않게).
[tf] 내용 일치 T/F 영어 문장 정확히 5개(각 12~25 words). 지문 문장을 그대로 베끼지 말고 내용 이해를 묻는다. {{TF_TRUE_COUNT}} 문항마다 먼저 evidence(근거 문장 번호)를 적고, F로 할 문장은 wrong에 지문과 어긋나는 점을 한국어로 적은 뒤 answer를 정한다. answer는 개수와 상관없이 지문에 비추어 판정한다 — 지문과 맞는 문장을 F로 두지 않는다. F를 만들려면 문장을 지문과 분명히 다르게 바꿔 쓴다(애매·추측·지문에 없는 내용 금지). T 문장도 지문에 그대로 근거가 있어야 한다(지문이 '~일 수 있다'고만 하면 단정하지 않는다).
[keySentences] 서술형·영작에 나올 핵심 문장 번호 4개(주제문·핵심 주장·중요 구문이 있는 문장, 가능하면 8~35 words). 문장이 4개보다 적으면 모두.
[낱말 수준 — titleEn·summary.en·flow.en·tf] 고등학교 교과서·수능 필수 어휘 수준의 쉬운 낱말로 쓴다(선생님 2026-11-06 「너무 어렵고 난해한 단어가 섞인다」). 지문에 나온 낱말이나 그보다 쉬운 낱말을 쓰고, 지문보다 어려운 말로 바꿔 쓰지 않는다. 학술어·문어체·드문 낱말(ameliorate, efficacy, salient, proliferation, paradigm, ubiquitous, juxtapose, exacerbate, mitigate, intrinsic, multifaceted, pivotal, underscore, foster, facilitate, leverage 등)과 관용구·비유는 쓰지 않는다. 지문의 핵심 명사(글감)는 어려워도 그대로 써도 된다.
`;

/**
 * 출제 포인트만 따로 묻는다. 선생님 지적("출제포인트가 너무 모호하다")에 따라 유형마다 실제
 * 문항이 되는 값(빈칸이 될 어구·오답 방향, <보기>로 뺄 문장, 덩어리가 갈리는 자리)까지 받는다.
 * 요약문 빈칸은 요약문 핵심 어구에서 코드가 만든다(모델에 다시 묻지 않는다).
 */
const EXAM_PROMPT = `${COMMON_HEADER}
[examPoints] 이 지문으로 실제로 낼 만한 유력 출제 자리 2~3개(문장 순서대로). 지문이 받쳐 주지 않는 유형은 넣지 않는다(억지로 채우지 않는다).
- kind: "blank"(빈칸 추론), "insert"(문장 삽입) 중 하나. blank는 최대 2개, insert는 최대 1개. 순서 배열은 쓰지 않는다.
- blank: no는 그 문장 번호, target은 그 문장에 나온 그대로의 어구(2~8 words). 주제·결론을 떠받치는 어구를 고른다(예시·숫자·고유명사는 안 된다). 그 문장에 한 번만 나오는 어구여야 하고, 앞뒤 문맥만으로 답을 찾을 수 있어야 한다.
  distractors: 학생이 고를 만한 오답의 '방향'을 한국어 짧은 구로 1~2개(예: "반대 개념을 넣은 선택지", "지문에 없는 원인을 넣은 선택지"). 영어 선택지를 지어내지 않는다.
  splitNos: [].
- insert: no는 지문에서 빼내어 <보기>로 줄 문장의 번호(2 이상). 그 문장을 빼내면 앞뒤가 논리로 끊겨(연결어·지칭어가 근거) 자리를 되찾을 수 있어야 한다. target은 "", distractors는 [], splitNos는 [].
- order: splitNos는 새 덩어리가 시작하는 문장 번호 2~3개를 오름차순으로(모두 2 이상, 첫 덩어리는 1번 문장부터인 주어진 글이다). 덩어리마다 뜻이 이어져야 하고, 덩어리 첫 문장에 연결어·지칭어가 있어 순서를 되찾을 수 있어야 한다. no는 splitNos의 첫 번째 값, target은 "", distractors는 [].
- reasonKo: 답을 찾는 근거를 한국어 한 줄(15~40자), "~다"로 끝낸다. "중요하다" 같은 말 대신 무엇이 근거인지(연결어·지칭어·대조·인과)를 적는다.

${examBlankFocusRules()}
`;

/** 바꿔 쓰기 표현(목록이 길어 따로 부른다. 지칭 정리는 코드로 훑어 따로 푼다). */
const EXTRA_PROMPT = `${COMMON_HEADER}
[paraphrases] 서술형·바꿔 쓰기에 나올 핵심 표현 7~9개(검수에서 걸러 4~5개만 싣는다. 넉넉히 내되 아래 기준을 지킨다). 고등학생이 뜻을 이미 아는 기초 표현(a lot of, in order to, such as, for example, the same as, kind of, a number of 같은 것)과 글자 뜻 그대로인 표현은 넣지 않는다. 이 지문에서만 쓰이는 말, 문맥이 있어야 풀리는 말, 내신 서술형에서 바꿔 쓰게 할 만한 말을 고른다. expression은 지문에 나온 그대로의 2~6 words 어구(낱말 하나짜리는 vocab이 맡는다), meaningKo는 이 문맥에 맞는 짧고 자연스러운 한국어 뜻, paraphrases는 이 문맥에서 바꿔 써도 뜻이 같은 영어 표현 1~2개(지문의 다른 표현을 그대로 베끼지 않는다).

${examParaphraseFocusRules()}

[implications] 문맥에서만 풀리는 말 0~4개(검수에서 걸러 2개만 싣는다). 올인원 자료의 "밑줄 친 …이 의미하는 바를 서술하시오" 문항이 된다.
- expression: 지문에 나온 그대로의 1~5 words. 따옴표 안의 말, 비유, 앞 내용을 통째로 받는 짧은 구처럼 글자 뜻만으로는 풀리지 않는 것만 고른다.
- 낱말 뜻만 알면 되는 말(vocab이 맡는다), 단순한 지칭어(it·this·they), paraphrases에 이미 넣은 표현은 고르지 않는다.
- meaningEn: 그 말이 이 문맥에서 뜻하는 바를 지문의 다른 문장을 베끼지 않고 8~16 words 한 구절로(뜻을 잡는 데만 쓴다).
- meaningKo: 정답이 되는 줄이다. 그 말이 가리키는 바·뜻하는 바를 한국어 한 줄로 풀어 적는다(20~45자).
  그 문장을 해석하지 않는다. "…라는 뜻", "…을 가리킨다"처럼 표현 하나의 속뜻만 적고,
  그 말을 모르는 학생이 읽어도 무엇을 말하는지 알 수 있게 구체적으로 적는다.
- 지문에 그런 말이 없으면 빈 배열로 둔다(억지로 만들지 않는다).
`;

const GRAMMAR_PROMPT = `${COMMON_HEADER}
${GRAMMAR_SECTION}

GRAMMAR_RULES (code(이름): 고르는 기준):
${onePageGrammarRulesText()}

${examGrammarCaseBlock()}`;

const WORDS_PROMPT = `${COMMON_HEADER}
${VOCAB_SECTION}`;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const strList = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const VOCAB_SCHEMA = {
  type: "array",
  items: obj({ no: int, surface: str, meaningKo: str, synonyms: strList, antonyms: strList }),
} as const;

const GRAMMAR_SCAN_SCHEMA = {
  type: "array",
  items: obj({ no: int, term: str, span: str, structure: str, hard: int, why: str }),
} as const;

const GRAMMAR_ITEMS_SCHEMA = {
  type: "array",
  items: obj({
    no: int,
    from: int,
    hard: int,
    code: str,
    caseId: str,
    target: str,
    right: str,
    cue: str,
    wrong: str,
    wrongWhy: str,
    explanation: str,
  }),
} as const;

const CORE_SCHEMA = obj({
  topicKo: str,
  titleEn: str,
  summary: obj({ en: str, keywords: strList, ko: str, verbs: { type: "array", items: obj({ form: str, base: str }) } }),
  flow: { type: "array", items: obj({ en: str, ko: str, from: int, to: int }) },
  // 근거·틀린 점을 정답보다 먼저 적게 한다(2026-11-02: 참 개수를 맞추려고 맞는 문장을 F로 둔 것이 495문항 중 15)
  tf: { type: "array", items: obj({ statement: str, evidence: { type: "array", items: int }, wrong: str, answer: { type: "string", enum: ["T", "F"] } }) },
  keySentences: { type: "array", items: int },
});

const EXTRA_SCHEMA = obj({
  paraphrases: {
    type: "array",
    items: obj({ no: int, expression: str, meaningKo: str, paraphrases: strList }),
  },
  implications: {
    type: "array",
    items: obj({ no: int, expression: str, meaningEn: str, meaningKo: str }),
  },
});

const EXAM_SCHEMA = obj({
  examPoints: {
    type: "array",
    items: obj({
      kind: { type: "string", enum: ["blank", "insert"] },
      no: int,
      target: str,
      distractors: strList,
      splitNos: { type: "array", items: int },
      reasonKo: str,
    }),
  },
});

const GRAMMAR_SCHEMA = obj({ scan: GRAMMAR_SCAN_SCHEMA, grammar: GRAMMAR_ITEMS_SCHEMA });
/*
 * 보충은 이미 훑어 둔 자리를 메우는 호출이라 1차 메모(scan)를 다시 받을 까닭이 없다.
 * 그 메모가 답을 길게 만들고, 보충은 맨 뒤에 붙는 시간이다(2026-09-29 속도 손질).
 */
const GRAMMAR_REFILL_SCHEMA = obj({ grammar: GRAMMAR_ITEMS_SCHEMA });

const WORDS_SCHEMA = obj({ vocab: VOCAB_SCHEMA });


type Row = Record<string, unknown>;
type RawContent = {
  topicKo?: unknown;
  titleEn?: unknown;
  summary?: { en?: unknown; keywords?: unknown; ko?: unknown; verbs?: unknown } | null;
  flow?: unknown;
  vocab?: unknown;
  grammar?: unknown;
  paraphrases?: unknown;
  implications?: unknown;
  references?: unknown;
  examPoints?: unknown;
  tf?: unknown;
  keySentences?: unknown;
};

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const str1 = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v : []).map((r) => (r ?? {}) as Row);

function strList1(v: unknown, max: number): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,/;]/) : [];
  const out: string[] = [];
  for (const row of list) {
    const s = str1(row);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** 요약문 핵심 어구: 요약문에 실제로 있는 것만, 나온 순서대로, 겹치지 않게(요약문에 나온 글자 그대로). */
function locateKeywords(summary: string, raw: unknown): string[] {
  const found: Array<{ text: string; start: number; end: number }> = [];
  for (const kw of strList1(raw, 8)) {
    const hit = findPhrase(summary, kw);
    if (!hit) continue;
    if (found.some((f) => hit.start < f.end && f.start < hit.end)) continue;
    found.push({ text: summary.slice(hit.start, hit.end), ...hit });
  }
  return found
    .sort((a, b) => a.start - b.start)
    .slice(0, 5)
    .map((f) => f.text);
}

/*
 * 한 장에 싣는 어법 포인트 수.
 *
 * 선생님 지적(2026-09-29): "너무 많은 어법을 골라내서 정작 필요한 어법이 안 나온다.
 * 최소 5개 이상은 뽑아 달라." 상한을 여덟에서 여섯으로 줄이고, 다섯은 채우도록 한다.
 * 채우는 방법은 검수를 무르게 하는 것이 아니라, 검수를 통과한 자리 가운데
 * 점수를 한 칸 내려 고르는 것이다. 그래도 모자라면 한 번 더 뽑는데,
 * 그 호출이 맨 뒤에 30초쯤 붙는다(선생님 지적: 느리다).
 */
export const MIN_GRAMMAR = 5;
const MAX_GRAMMAR = 6;
/** 정리자료에 싣는 낱말 수 상한(선생님 요청: 10~12개) */
const MAX_VOCAB = 12;
/**
 * 검수에서 버려질 것을 감안해 더 뽑아 둔다. 다시 뽑는 호출(약 20초·토큰 절반)보다
 * 처음에 두어 개 더 받는 편이 값이 덜 든다.
 */
/*
 * 한 장에 싣는 것은 6개인데 18개까지 받아 두면 답이 길어져 그만큼 더 기다리고,
 * 교재가 거의 묻지 않는 자리까지 올라온다. 12면 검수에서 몇 개 버려도 6은 남는다.
 *
 * 2026-09-28 선생님 요청: "어법 포인트가 더 많이 나오게. 대신 어렵고 중요한 수준으로."
 * 실을 기준(4점 이상)은 그대로 두고 후보만 16으로 늘린다. 조각 수는 문장 수로 정해지므로
 * 호출 횟수는 그대로이고, 조각마다 3개씩 묻던 것을 4개씩 묻게 된다.
 * 기준을 낮춰 개수를 채우면 2026-09-20에 지적받은 "안 나올 자리가 섞인다"로 돌아간다.
 */
/*
 * 2026-09-29 속도 손질: scan 메모를 조각 크기에 맞춰 짧게 줄인 만큼 후보를 조금 늘린다.
 * 조각 호출은 서로 병렬이라 여기서 늘어난 시간은 맨 뒤에 붙지 않는다. 대신 검수를
 * 통과한 자리가 늘어 보충 호출 자체가 덜 걸린다(그쪽이 꼬리에 붙는 시간이다).
 */
const GRAMMAR_CANDIDATES = 28;
/** 보충(모자란 어법을 더 뽑는 호출)을 기다리는 한도. 늦으면 있는 것으로 만든다. */
const SPARE_DEADLINE_MS = 26_000;
/**
 * 어법 조각 하나(만들기+검수)를 기다리는 한도. 대개 25~40초에 돌아오는데 한 조각이 70초 넘게
 * 끄는 일이 있어, 그런 조각만 끊고 나머지로 만든다(조각은 서로 기다리지 않는다).
 */
const GRAMMAR_CHUNK_DEADLINE_MS = 58_000;
const VOCAB_CANDIDATES = 22;
/** 정리자료 한 장에 실을 낱말 수(검수에서 빠져 이보다 적어지면 더 뽑는다). */
export const MIN_VOCAB = 10;
/** 지칭 정리에 싣는 최대 개수(선생님 요청: 지문의 지칭어를 모두 싣는다. 넘치면 두 쪽으로 간다). */
const MAX_REFERENCES = 24;
/** 출제 포인트 표시 수(선생님 요청: 2~5개) */
const MAX_EXAM_POINTS = 5;
/** 밑줄 구간의 최대 길이. 근거까지 담느라 문장 전체가 밑줄이 되는 것을 막는다. */
const MAX_TARGET_WORDS = 14;

/** 같은 어근인지 대충 본다(diversify·diversity, compensate·compensation). 한 장에 한 번만 싣기 위한 것. */
function sameStem(a: string, b: string): boolean {
  const cut = (w: string) =>
    w
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .replace(/(?:ies|ing|ies|ed|es|s|ly|ness|ment|tion|sion|ity|ive|ous|al)$/, "");
  const x = cut(a);
  const y = cut(b);
  if (!x || !y) return false;
  return x.length >= 4 && y.length >= 4 && (x === y || x.startsWith(y) || y.startsWith(x));
}

/** 낱말 경계로 센 등장 횟수 */
function countPhrase(text: string, phrase: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const hit = findPhrase(text.slice(from), phrase);
    if (!hit) return count;
    count += 1;
    from += hit.end;
    if (count > 4) return count;
  }
}

/** 앞에 붙어 답을 정하는 기능어. 밑줄이 이 말을 빠뜨리면 설명과 어긋난다(to ask, been nominated). */
const LEADING_CUES = new Set([
  "to","be","been","being","is","are","was","were","am","has","have","had","of","in","on","at","for","from",
  "after","before","without","by","with","about","than","as","not","the","a","an",
]);
/** 조동사 뒤 동사원형은 시험에 낼 수 없는 자리다. */
const MODALS = new Set(["should","would","can","could","will","shall","may","might","must","do","does","did"]);

/**
 * 동사원형만 올 수 있는 자리(조동사 뒤, to 뒤, 사역·지각동사 뒤)는 어법 문항이 되지 않는다.
 * 그런 자리는 틀린 쪽이 영어에 아예 없는 말이라 학생이 고민하지 않는다.
 * 선생님 지적(2026-09-17): "[would become / would becomes] 같은 얼토당토않은 어법 포인트".
 * 바뀌는 낱말 바로 앞을 보고, 그런 자리면 싣지 않는다.
 */
/**
 * 동사원형만 올 수 있는 자리를 만드는 말.
 *
 * to와 조동사 뒤는 고를 거리가 없어 늘 버린다.
 * 지각·사역동사 뒤는 다르다 — 선생님 지적(2026-09-29): 「we have seen bring about」의
 * bring 자리는 엄청 중요한 자리인데 못 걸러내고 있다. 여기는 to부정사를 쓰면 틀리는
 * 자리라 시험에 자주 나온다. 그래서 오답이 to부정사일 때만 살린다.
 */
const BARE_FORM_TRIGGERS = new Set(["to"]);

/** 뒤에 동사원형이 오는 지각·사역동사. 오답이 to부정사면 낼 수 있는 자리다. */
const CAUSATIVE_PERCEPTION = new Set([
  "help","helps","helped","make","makes","made","let","lets","have","has","had",
  "see","sees","saw","seen","hear","hears","heard","watch","watches","watched",
  "feel","feels","felt","notice","notices","noticed",
]);

/** 뒤에 -ing가 오면 동명사다. 분사·분사구문 자리가 아니다. */
const PREPOSITIONS_BEFORE_GERUND = new Set([
  "by","after","before","in","on","at","of","for","with","without","about","through",
  "upon","since","despite","besides","from","into","over","under","against","during",
  "toward","towards","beyond","like","worth",
]);

function inBareFormSlot(right: string, wrong: string, sentence: string, rightStart: number): boolean {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
  const a = words(right);
  const b = words(wrong);
  let idx = 0;
  while (idx < a.length && idx < b.length && a[idx]!.toLowerCase() === b[idx]!.toLowerCase()) idx++;
  const prev =
    idx > 0
      ? a[idx - 1]!.toLowerCase().replace(/[^a-z'’-]/g, "")
      : (sentence.slice(0, rightStart).match(/([A-Za-z’']+)\s*$/)?.[1] ?? "").toLowerCase();
  if (!prev) return false;
  if (MODALS.has(prev) || BARE_FORM_TRIGGERS.has(prev)) return true;
  if (CAUSATIVE_PERCEPTION.has(prev)) {
    // to부정사를 맞세운 것만 남긴다. 원형 ↔ V-ing는 둘 다 맞아서 고를 수 없다.
    return !/^to\s+[a-z]/i.test(wrong.trim());
  }
  return false;
}

/** 바른 형태 바로 앞에 오는 낱말 */
function wordBefore(sentence: string, rightStart: number): string {
  return (sentence.slice(0, rightStart).match(/([A-Za-z’']+)\s*$/)?.[1] ?? "").toLowerCase();
}

/** 오답이 바른 형태와 굴절·기능어 하나만 다른지. 워크북 오답 검사에 더해 낱말 자체가 바뀐 것을 막는다. */
function minimalFormPair(right: string, wrong: string): boolean {
  const tok = (t: string) => t.toLowerCase().replace(/[^a-z'’-]/g, "");
  const a = right.split(/\s+/).map(tok).filter(Boolean);
  const b = wrong.split(/\s+/).map(tok).filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  const sameWord = (x: string, y: string) => {
    if (x === y) return true;
    if (FUNCTION_WORDS.has(x) && FUNCTION_WORDS.has(y)) return true;
    if (FUNCTION_WORDS.has(x) !== FUNCTION_WORDS.has(y)) return false;
    const head = Math.min(4, Math.min(x.length, y.length));
    return head >= 3 && x.slice(0, head) === y.slice(0, head);
  };
  if (a.length === b.length) {
    const diffs = a.map((w, i) => (w === b[i] ? null : [w, b[i]!] as const)).filter(Boolean);
    return diffs.length === 1 && sameWord(diffs[0]![0], diffs[0]![1]);
  }
  if (Math.abs(a.length - b.length) !== 1) return false;
  // 한쪽에만 있는 낱말 하나가 기능어면 된다(because / because of, can be frozen / can frozen).
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  let skipped = "";
  for (const w of long) {
    if (i < short.length && sameWord(w, short[i]!)) {
      i += 1;
      continue;
    }
    if (skipped) return false;
    skipped = w;
  }
  return i === short.length && FUNCTION_WORDS.has(skipped);
}

/** 굴절·짝으로만 갈리는 기능어(오답이 이 안에서 바뀌는 것은 어법 문항이 된다). */
const FUNCTION_WORDS = new Set([
  "a","an","the","be","been","being","is","are","was","were","am","do","does","did","have","has","had",
  "to","of","in","on","at","for","from","by","with","about","into","over","under","after","before","during",
  "while","since","until","because","although","though","despite","without","than","as","so","that","which",
  "who","whom","whose","what","where","when","why","how","whether","if","and","or","but","not","no",
  "it","its","they","them","their","he","him","his","she","her","we","us","our","i","me","my","you","your",
  "this","that","these","those","one","ones","much","many","few","little","most","some","any","each","every",
  "will","would","can","could","shall","should","may","might","must","there",
]);

const PERSONAL_PRONOUNS = new Set(["i", "you", "we", "they", "he", "she", "it"]);
const WEAK_WORDS = /어색|자연스럽|더 낫|부드럽|흔히 쓰|선호/;

type Placed = { si: number; exact: string; start: number; end: number };

/** 모델이 준 문장 번호(1부터)에 그 부분이 있으면 그 문장, 없으면 처음 나오는 문장. 본문에 없으면 null. */
function makePlaceIn(sentences: string[]) {
  return (no: unknown, phrase: string): Placed | null => {
    const k = Math.floor(Number(no)) - 1;
    const tryAt = (si: number) => {
      const hit = findPhrase(sentences[si]!, phrase);
      return hit ? { si, exact: sentences[si]!.slice(hit.start, hit.end), ...hit } : null;
    };
    if (k >= 0 && k < sentences.length) {
      const hit = tryAt(k);
      if (hit) return hit;
    }
    for (let si = 0; si < sentences.length; si++) {
      const hit = tryAt(si);
      if (hit) return hit;
    }
    return null;
  };
}

/**
 * 낱말 하나를 본다. 지문에 있는 한 낱말이어야 하고, 같은 어근이 이미 실렸으면 싣지 않는다.
 */
function checkVocabNote(
  r: Row,
  placeIn: (no: unknown, phrase: string) => Placed | null,
  already: OnePageVocabNote[]
): OnePageVocabNote | null {
  const surface = str1(r.surface);
  // 낱말 하나만 싣는다(구는 바꿔 쓰기가 맡는다).
  if (!surface || wordCount(surface) !== 1) return null;
  const placed = placeIn(r.no, surface);
  if (!placed) return null;
  if (already.some((v) => v.surface.toLowerCase() === placed.exact.toLowerCase())) return null;
  // 같은 어근은 한 번만(diversify·diversity·variety).
  if (already.some((v) => sameStem(v.surface, placed.exact))) return null;
  const synonyms = strList1(r.synonyms, 3).filter((w) => !sameStem(w, placed.exact));
  const antonyms = strList1(r.antonyms, 2).filter((w) => !sameStem(w, placed.exact));
  if (synonyms.length === 0 && antonyms.length === 0) return null;
  return {
    sentenceIndex: placed.si,
    surface: placed.exact,
    meaningKo: str1(r.meaningKo),
    synonyms,
    antonyms,
  };
}

/**
 * 어법 포인트 하나를 본다. 답이 하나로 정해지는 자리만 남긴다.
 * - code는 정리자료가 쓰는 어법 목록(교재 규칙)에 있어야 한다.
 * - target은 그 문장에 한 번만 나와야 하고(밑줄이 엉뚱한 자리에 가지 않게), right는 target 안에 있어야 한다.
 * - 설명이 짚는 근거(cue)까지 밑줄 안에 들어오도록 구간을 넓힌다.
 * - 오답은 굴절·기능어 하나만 다르고 실제로 있는 형태여야 한다(워크북 엔진의 검사를 그대로 쓴다).
 */
/** 두 형태가 마지막 낱말의 -s(es) 하나로만 갈리는가(복수형 표기 함정) */
function pluralOnlyPair(right: string, wrong: string): boolean {
  const a = right.trim().toLowerCase().split(/\s+/);
  const b = wrong.trim().toLowerCase().split(/\s+/);
  if (a.length !== b.length) return false;
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (diff >= 0) return false;
    diff = i;
  }
  if (diff < 0) return false;
  const [x, y] = [a[diff]!, b[diff]!].sort((m, n) => m.length - n.length);
  return y === `${x}s` || y === `${x}es`;
}

function checkGrammarPoint(
  r: Row,
  sentences: string[],
  placeIn: (no: unknown, phrase: string) => Placed | null
): OnePageGrammarPoint | null {
  const code = str1(r.code).toUpperCase();
  const rule = onePageGrammarRule(code);
  if (!rule) return null;

  const placed = placeIn(r.no, str1(r.target));
  if (!placed) return null;
  const sentence = sentences[placed.si]!;
  if (countPhrase(sentence, placed.exact) !== 1) return null;

  const rightHit = findPhrase(placed.exact, str1(r.right));
  if (!rightHit) return null;
  const right = placed.exact.slice(rightHit.start, rightHit.end);
  if (countPhrase(placed.exact, right) !== 1) return null;
  const rightStart = placed.start + rightHit.start;
  const rightEnd = placed.start + rightHit.end;

  // 근거(cue)를 밑줄 안으로. 문장에 없거나 구간이 너무 길어지면 버린다.
  const cueHit = findPhrase(sentence, str1(r.cue));
  if (!cueHit) return null;
  let start = Math.min(placed.start, cueHit.start);
  const end = Math.max(placed.end, cueHit.end);
  // 답을 정하는 앞말(to ask의 to, been nominated의 been)이 밑줄 밖이면 설명과 어긋난다. 한 낱말 당겨 온다.
  const before = sentence.slice(0, start).match(/([A-Za-z’']+)\s*$/);
  if (before && LEADING_CUES.has(before[1]!.toLowerCase())) {
    start -= before[0].length;
  }
  const target = sentence.slice(start, end).replace(/^\s+/, "");
  if (wordCount(target) > MAX_TARGET_WORDS) return null;
  if (countPhrase(sentence, target) !== 1) return null;

  // 주어가 동사 바로 앞에 붙은 수일치(they feel, Humans enjoy)는 시험 문항이 되지 않는다.
  if (code.startsWith("AGREEMENT_")) {
    const cueWord = sentence.slice(cueHit.start, cueHit.end).toLowerCase();
    if (PERSONAL_PRONOUNS.has(cueWord)) return null;
    const gapFrom = Math.min(cueHit.end, rightEnd);
    const gapTo = Math.max(cueHit.start, rightStart);
    if (gapTo <= gapFrom || wordCount(sentence.slice(gapFrom, gapTo)) < 2) return null;
  }

  const wrong = str1(r.wrong);
  if (!wrong || wrong.toLowerCase() === right.toLowerCase()) return null;
  // 명사의 단수·복수 표기만 다른 짝(endings/ending)은 고르게 할 수 없다. 동사 수일치는 예외다.
  if (!code.startsWith("AGREEMENT_") && pluralOnlyPair(right, wrong)) return null;
  // 동사원형만 올 수 있는 자리(조동사·to 뒤)는 고를 거리가 없다.
  if (inBareFormSlot(right, wrong, sentence, rightStart)) return null;
  /*
   * 선생님 지적(2026-09-29): by V-ing 같은 전치사 뒤 -ing를 「현재분사」·「분사구문」이라고
   * 부르고 있었다. 전치사 뒤는 동명사 자리다. 분사 쪽 이름이 붙으면 버리고,
   * 전치사 + 동명사 코드로만 내게 한다(설명까지 틀린 문법을 가르치던 것을 막는다).
   */
  if (/^(PARTICIP|WITH_OBJECT_PARTICIPLE|ABSOLUTE_PARTICIPLE)/.test(code)) {
    const before = wordBefore(sentence, rightStart);
    if (PREPOSITIONS_BEFORE_GERUND.has(before) && /^[a-z]+ing\b/i.test(right.trim())) {
      return null;
    }
  }
  if (!minimalFormPair(right, wrong)) return null;
  if (rejectFabricatedDistractor({ pointCode: code, correct: right, wrong, sentence })) return null;
  if (validateMinimalPair({ pointCode: code, sourceSpan: right, distractor: wrong, sentence })) return null;

  /*
   * 해설 말투를 「맞다.」체로 맞춘다.
   *
   * 선생님 요청(2026-09-29): 「맞다」와 「맞습니다」가 섞여 나와 학생이 헷갈린다.
   * 변형문제는 그때 고쳤는데 1장 요약자료는 그대로였다. 훑어 보니 어법 해설
   * 372군데 가운데 112군데가 존댓말이었고 오늘 만든 것에도 섞여 있었다.
   */
  const explanation = plainKorean(str1(r.explanation));
  const wrongWhy = plainKorean(str1(r.wrongWhy));
  if (!explanation || !wrongWhy) return null;
  // "어색하다"는 둘 다 된다는 뜻이다. 그런 자리는 싣지 않는다.
  if (WEAK_WORDS.test(wrongWhy)) return null;

  // 교재 빈출 케이스에 해당하면 그 이름·팁을 쓴다(변형문제 어법추론과 같은 목록).
  const examCase = examGrammarCase(str1(r.caseId));

  return {
    sentenceIndex: placed.si,
    code,
    target,
    right,
    cue: sentence.slice(cueHit.start, cueHit.end),
    wrong,
    wrongWhy,
    /*
     * 이름은 code를 따른다. 검수도 설명도 code 기준인데 이름만 교재 케이스에서
     * 가져오다 보니 어긋났다 — 분사구문 자리에 「수식하는 분사」가 찍히는 식이다
     * (2026-09-29 확인). 교재 케이스는 팁(caseTipKo)으로만 남긴다.
     */
    point: rule.labelKo,
    hard: Math.max(0, Math.min(5, Math.floor(Number(r.hard) || 0))) || undefined,
    caseId: examCase?.id,
    caseTipKo: examCase?.koTip,
    explanation,
  };
}

// 순서 배열은 빼기로 했다(선생님 요청 2026-09-17) — 표시가 흐릿하고 문항으로 잘 이어지지 않았다.
const EXAM_KINDS: OnePageExamPointKind[] = ["blank", "insert", "summary"];

/**
 * 출제 포인트를 본다. 지문이 받쳐 주는 자리만 남긴다.
 * - 빈칸 추론: 그 문장에 한 번만 나오는 2~8낱말 어구여야 표시가 엉뚱한 자리로 가지 않는다.
 * - 문장 삽입·순서 배열: 첫 문장 앞은 경계가 될 수 없다.
 * - 요약문 빈칸: 요약문에 그대로 있는 어구여야 한다.
 * 같은 유형은 둘까지, 모두 합해 5개까지 싣는다.
 */
function checkExamPoints(
  raw: unknown,
  sentences: string[],
  summary: { en: string; keywords: string[] }
): OnePageExamPoint[] {
  const out: OnePageExamPoint[] = [];
  const n = sentences.length;
  for (const r of rows(raw)) {
    const kind = str1(r.kind).toLowerCase() as OnePageExamPointKind;
    if (!EXAM_KINDS.includes(kind) || kind === "summary") continue;
    const reasonKo = str1(r.reasonKo);
    if (!reasonKo) continue;
    if (kind === "blank") {
      const si = Math.floor(Number(r.no)) - 1;
      if (!(si >= 0 && si < n)) continue;
      const phrase = str1(r.target);
      if (!phrase || wordCount(phrase) < 2 || wordCount(phrase) > 8) continue;
      const hit = findPhrase(sentences[si]!, phrase);
      if (!hit) continue;
      const target = sentences[si]!.slice(hit.start, hit.end);
      // 네모를 엉뚱한 자리에 치지 않게, 그 문장에 한 번만 나오는 어구만 쓴다.
      if (countPhrase(sentences[si]!, target) !== 1) continue;
      if (out.some((e) => e.kind === "blank" && e.target.toLowerCase() === target.toLowerCase())) continue;
      if (out.filter((e) => e.kind === "blank").length >= 2) continue;
      out.push({
        kind,
        sentenceIndex: si,
        target,
        reasonKo,
        distractorsKo: strList1(r.distractors, 2),
      });
    } else if (kind === "insert") {
      // <보기>로 빼낼 문장. 첫 문장은 뺄 수 없고(자리를 알 수 없다), 문장이 셋은 넘어야 문항이 된다.
      const si = Math.floor(Number(r.no)) - 1;
      if (!(si >= 1 && si < n) || n < 4) continue;
      if (out.some((e) => e.kind === "insert")) continue;
      out.push({ kind, sentenceIndex: si, target: "", reasonKo, insertSentence: sentences[si]! });
    } else {
      // 순서 배열: 덩어리가 시작하는 자리. 주어진 글(1번 문장부터) 뒤로 덩어리가 둘 이상이어야 한다.
      if (out.some((e) => e.kind === "order")) continue;
      const splits: number[] = [];
      for (const v of Array.isArray(r.splitNos) ? r.splitNos : []) {
        const k = Math.floor(Number(v)) - 1;
        if (k >= 1 && k < n && !splits.includes(k)) splits.push(k);
        if (splits.length >= 3) break;
      }
      splits.sort((a, b) => a - b);
      if (splits.length < 2 || n < splits.length + 2) continue;
      out.push({
        kind,
        sentenceIndex: splits[0]!,
        target: "",
        reasonKo,
        splitIndexes: splits,
        orderLabels: orderLabelsFor(sentences, splits.length),
      });
    }
    if (out.length >= MAX_EXAM_POINTS) break;
  }
  // 요약문 빈칸은 이미 검증된 요약문 핵심 어구에서 코드가 만든다(모델에 다시 묻지 않는다).
  if (summary.keywords.length >= 2 && out.length < MAX_EXAM_POINTS) {
    const words = summary.keywords.slice(0, 2);
    const at = sentences.findIndex((s) => findPhrase(s, words[0]!));
    out.push({
      kind: "summary",
      sentenceIndex: at >= 0 ? at : 0,
      target: words.join(", "),
      reasonKo: "요약문의 핵심 어구 두 개를 빈칸으로 내는 자리다.",
      summaryWords: words,
    });
  }
  return out;
}

/**
 * 순서 배열 덩어리에 붙는 (A)(B)(C) 라벨. 시험지는 덩어리를 섞어 내므로, 지문 순서대로 놓인
 * 덩어리에 섞은 라벨을 붙여 둔다(이어 읽으면 그대로 정답 순서가 된다). 같은 지문이면 늘 같게
 * 나오도록 지문으로 씨앗을 만든다.
 */
function orderLabelsFor(sentences: string[], blocks: number): string[] {
  const labels = ["(A)", "(B)", "(C)"].slice(0, blocks);
  const seed = hashSeedToUint32(sentences.join(" "));
  const out = [...labels];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (seed >>> (i * 5)) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 낱말 후보 거르기. 만드는 호출이 돌아오는 대로 걸러 바로 검수로 넘긴다. */
function pickVocabNotes(raw: unknown, sentences: string[]): OnePageVocabNote[] {
  const placeIn = makePlaceIn(sentences);
  const vocab: OnePageVocabNote[] = [];
  for (const r of rows(raw)) {
    const note = checkVocabNote(r, placeIn, vocab);
    if (!note) continue;
    vocab.push(note);
    if (vocab.length >= VOCAB_CANDIDATES) break;
  }
  return vocab;
}

/**
 * 어법 후보 거르기(조각 하나 분량). 한 문장에 둘까지, 같은 어법은 둘까지 남긴다.
 * 조각끼리는 문장이 겹치지 않으므로 여기서는 조각 안에서만 본다(합칠 때 다시 고르게 편다).
 */
function pickGrammarPoints(raw: unknown, sentences: string[], max: number): OnePageGrammarPoint[] {
  const placeIn = makePlaceIn(sentences);
  const grammar: OnePageGrammarPoint[] = [];
  for (const r of rows(raw)) {
    const point = checkGrammarPoint(r, sentences, placeIn);
    if (!point) continue;
    if (grammar.filter((g) => g.sentenceIndex === point.sentenceIndex).length >= 2) continue;
    if (grammar.filter((g) => g.code === point.code).length >= 2) continue;
    if (grammar.some((g) => g.target.toLowerCase() === point.target.toLowerCase())) continue;
    grammar.push(point);
    if (grammar.length >= max) break;
  }
  return grammar;
}

type CheckedCore = {
  topicKo: string;
  titleEn: string;
  summaryEn: string;
  summaryKeywords: string[];
  summaryVerbs: Array<{ form: string; base: string }>;
  summaryKo: string;
  flow: OnePageContent["flow"];
  paraphrases: OnePageParaphrase[];
  implications: OnePageImplication[];
  examPoints: OnePageExamPoint[];
  tf: OnePageTfItem[];
  keySentenceIndexes: number[];
  problems: string[];
};

/** 주제·요약문·도식화·바꿔 쓰기 표현·출제 포인트·T/F·핵심 문장을 거른다(낱말·어법·지칭은 따로 온다). */
function checkCore(
  raw: Pick<
    RawContent,
    "topicKo" | "titleEn" | "summary" | "flow" | "paraphrases" | "implications" | "examPoints" | "tf" | "keySentences"
  >,
  sentences: string[]
): CheckedCore {
  const problems: string[] = [];
  const n = sentences.length;
  const placeIn = makePlaceIn(sentences);

  const topicKo = str1(raw.topicKo);
  if (!topicKo) problems.push("주제 없음");
  const titleEn = str1(raw.titleEn);

  const summaryEn = str1(raw.summary?.en);
  const summaryKo = str1(raw.summary?.ko);
  const summaryKeywords = summaryEn ? locateKeywords(summaryEn, raw.summary?.keywords) : [];
  // 핵심 어구 안의 동사(쓰인 꼴 → 원형). 어구에 없는 것·원형과 같은 것은 뺀다.
  const inKeyword = (form: string) => {
    const re = new RegExp(`(?<![A-Za-z])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i");
    return summaryKeywords.some((k) => re.test(k));
  };
  const summaryVerbs = rows(raw.summary?.verbs)
    .map((r) => ({ form: str1(r.form), base: str1(r.base).toLowerCase() }))
    .filter((v) => v.form && v.base && v.form.toLowerCase() !== v.base && /^[a-z'-]+$/.test(v.base) && inKeyword(v.form))
    .slice(0, 8);
  if (!summaryEn) problems.push("요약문 없음");
  if (summaryKeywords.length < 3) problems.push("요약문 핵심 어구 부족(summary.en에 그대로 있어야 함)");

  const flow = rows(raw.flow)
    .map((r): OnePageContent["flow"][number] => {
      // 근거 문장 범위(1부터 받아 0부터로). 틀린 범위는 버리고, 그릴 때 낱말을 맞춰 찾는다.
      const from = Math.floor(Number(r.from)) - 1;
      const to = Math.floor(Number(r.to)) - 1;
      const ok = from >= 0 && from <= to && to < n;
      return { en: str1(r.en), ko: str1(r.ko), ...(ok ? { from, to } : {}) };
    })
    .filter((f) => f.en)
    .slice(0, 5);
  if (flow.length < 3) problems.push("도식화 부족");

  const paraphrases: OnePageParaphrase[] = [];
  for (const r of rows(raw.paraphrases)) {
    const placed = placeIn(r.no, str1(r.expression));
    const alts = strList1(r.paraphrases, 2);
    if (!placed || alts.length === 0) continue;
    if (paraphrases.some((p) => p.expression.toLowerCase() === placed.exact.toLowerCase())) continue;
    paraphrases.push({
      sentenceIndex: placed.si,
      expression: placed.exact,
      meaningKo: str1(r.meaningKo),
      paraphrases: alts,
    });
    if (paraphrases.length >= 9) break;
  }
  if (paraphrases.length < 3) problems.push("바꿔 쓰기 표현 부족(expression은 지문 그대로)");

  // 함축의미: 지문에 그대로 있는 말이어야 하고, 이미 바꿔 쓰기 표현으로 쓴 말은 뺀다.
  const implications: OnePageImplication[] = [];
  for (const r of rows(raw.implications)) {
    const placed = placeIn(r.no, str1(r.expression));
    const meaningEn = str1(r.meaningEn);
    if (!placed || !meaningEn) continue;
    if (meaningEn.split(/\s+/).length < 5) continue;
    if (paraphrases.some((x) => sameWords(x.expression, placed.exact))) continue;
    if (implications.some((x) => sameWords(x.expression, placed.exact))) continue;
    implications.push({
      sentenceIndex: placed.si,
      expression: placed.exact,
      meaningEn,
      meaningKo: str1(r.meaningKo),
    });
    if (implications.length >= 4) break;
  }

  const examPoints = checkExamPoints(raw.examPoints, sentences, {
    en: summaryEn,
    keywords: summaryKeywords,
  });

  const tf: OnePageTfItem[] = [];
  for (const r of rows(raw.tf)) {
    const statement = str1(r.statement);
    const a = str1(r.answer).toUpperCase();
    const answer = a === "T" || a === "TRUE" ? "T" : a === "F" || a === "FALSE" ? "F" : null;
    if (!statement || !answer) continue;
    // F인데 지문과 어긋나는 점을 못 댄 문장은 맞는 문장일 수 있다 — 싣지 않는다
    if (answer === "F" && "wrong" in r && str1(r.wrong).length < 4) continue;
    tf.push({ statement, answer });
    if (tf.length >= 5) break;
  }
  if (tf.length < 5) problems.push("T/F 문항 수 부족");
  else if (!tf.some((t) => t.answer === "T") || !tf.some((t) => t.answer === "F")) {
    problems.push("T/F 정답이 한쪽으로 몰림");
  }

  const picked = new Set<number>();
  for (const v of Array.isArray(raw.keySentences) ? raw.keySentences : []) {
    const k = Math.floor(Number(v)) - 1;
    if (k >= 0 && k < n) picked.add(k);
    if (picked.size >= 4) break;
  }
  // 모자라면 알맞은 길이의 긴 문장으로 채운다.
  if (picked.size < Math.min(4, n)) {
    const fill = sentences
      .map((s, i) => ({ i, words: wordCount(s) }))
      .filter((r) => !picked.has(r.i) && r.words >= 6)
      .sort((a, b) => (a.words <= 35 ? 0 : 1) - (b.words <= 35 ? 0 : 1) || b.words - a.words);
    for (const r of fill) {
      if (picked.size >= Math.min(4, n)) break;
      picked.add(r.i);
    }
  }

  return {
    topicKo,
    titleEn,
    summaryEn,
    summaryKeywords,
    summaryVerbs,
    summaryKo,
    flow,
    paraphrases,
    implications,
    examPoints,
    tf,
    keySentenceIndexes: [...picked].sort((a, b) => a - b),
    problems,
  };
}

type Usage = { inputTokens: number; outputTokens: number };

async function requestContent(
  apiKey: string,
  userContent: string,
  signal: AbortSignal,
  shape: {
    system: string;
    schemaName: string;
    schema: Record<string, unknown>;
    /** 손이 덜 가는 갈래는 추론을 줄여 더 빨리 받는다(요약·T/F·지칭 풀이). */
    effort?: "minimal" | "low" | "medium";
    /** 갈래마다 다른 모델을 쓸 때(어법은 큰 모델을 가볍게 쓰는 쪽이 빠르고 정확하다). */
    model?: string;
  }
): Promise<{ text: string; model: string; usage: Usage }> {
  const primary = shape.model?.trim() || resolveOnePageModel();
  const candidates = primary === "gpt-4o" ? ["gpt-4o", "gpt-4o-mini"] : [primary, "gpt-4o"];

  let lastErr = "";
  for (const model of candidates) {
    let includeTemperature = studentRecordModelSupportsTemperature(model);
    let includeReasoningEffort = isGpt5FamilyModel(model);
    let format: "schema" | "json" | "none" = "schema";
    for (let attempt = 0; attempt < 5; attempt++) {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: shape.system },
          { role: "user", content: userContent },
        ],
        prompt_cache_key: `one-page-${shape.schemaName}`,
      };
      if (format === "schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: shape.schemaName, strict: true, schema: shape.schema },
        };
      } else if (format === "json") {
        body.response_format = { type: "json_object" };
      }
      if (includeTemperature) body.temperature = 0.3;
      if (isGpt5FamilyModel(model)) {
        body.max_completion_tokens = 12_000;
        if (includeReasoningEffort) body.reasoning_effort = shape.effort ?? "low";
      } else {
        body.max_tokens = 5_000;
      }
      const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify(body),
      });
      const bodyText = await res.text();
      if (res.ok) {
        const envelope = parseJsonSafe<{
          model?: string;
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        }>(bodyText);
        return {
          text: envelope?.choices?.[0]?.message?.content ?? "",
          model: String(envelope?.model ?? model),
          usage: {
            inputTokens: Number(envelope?.usage?.prompt_tokens ?? 0),
            outputTokens: Number(envelope?.usage?.completion_tokens ?? 0),
          },
        };
      }
      if (includeTemperature && isUnsupportedTemperatureError(bodyText)) {
        includeTemperature = false;
        continue;
      }
      if (includeReasoningEffort && isUnsupportedParameterError(bodyText, "reasoning_effort")) {
        includeReasoningEffort = false;
        continue;
      }
      if (format !== "none" && isUnsupportedParameterError(bodyText, "response_format")) {
        format = format === "schema" ? "json" : "none";
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        // 한도에 걸려 다시 부르면 그만큼 통째로 늦어진다. 어디서 늦었는지 서버 기록에 남긴다.
        console.warn(`[one-page] ${shape.schemaName} ${res.status} 재시도`);
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
        continue;
      }
      lastErr = bodyText.slice(0, 200);
      break;
    }
  }
  throw new Error(`1장 자료를 만들지 못했습니다${lastErr ? `: ${lastErr}` : ""}`.slice(0, 180));
}

/**
 * 검수에서 버려져 어법 포인트·낱말이 모자랄 때, 이미 쓴 것과 버린 것을 빼고 더 뽑아 검수까지 마친다.
 * 만드는 호출 전체를 다시 하지 않아 값이 덜 든다.
 */
/**
 * 어법 포인트가 정말 시험에 나올 자리인지 매긴다(선생님 지적 2026-09-18: 요약자료 어법이
 * 너무 쉽거나 말이 안 되는 것이 섞인다 — 워크북 어법 선택처럼 골라 달라).
 * 워크북 어법 선택 엔진이 쓰는 잣대와 같은 것을 묻는다: 두 형태 중 하나만 맞는가, 문법을
 * 묻는가(낱말 뜻이 아니라), 고등 내신·모의고사에 실제로 나오는 자리인가, 너무 뻔하지 않은가.
 * 한 번만 부르고, 실패하면 있는 대로 쓴다(자료가 안 나오는 것보다 낫다).
 */
async function rateGrammarPoints(input: {
  apiKey: string;
  sentences: string[];
  points: OnePageGrammarPoint[];
  signal: AbortSignal;
  usage: Usage;
  notes: string[];
}): Promise<Array<OnePageGrammarPoint & { examScore?: number }>> {
  const { points } = input;
  if (points.length <= 1) return points;
  const list = points
    .map((g, i) => {
      const sentence = input.sentences[g.sentenceIndex] ?? "";
      const hard = g.hard ? ` 어려움${g.hard}` : "";
      return `${i + 1}) [${g.code}]${hard} 이름: ${g.point}\n   밑줄: ${g.target}\n   정답: ${g.right} / 오답: ${g.wrong}\n   문장: ${sentence}`;
    })
    .join("\n");
  try {
    const res = await requestContent(
      input.apiKey,
      `아래는 한 지문에서 뽑은 어법 선택 후보다. 각각 고등학교 내신·모의고사 어법 문항으로 낼 만한지 매겨라.\n\n${list}\n\n각 후보에 대해:\n- no: 후보 번호\n- score: 0~5. 5는 실제 시험에 그대로 나올 만한 자리, 3은 낼 수는 있는 자리, 1 이하는 내면 안 되는 자리.\n- drop: true면 싣지 않는다.\n다음이면 drop으로 한다: 두 형태가 다 맞는 자리, 오답이 영어에 아예 없는 꼴이라 고를 거리가 안 되는 자리,\n낱말 뜻·연어를 묻는 자리, 중학생도 바로 아는 뻔한 자리(주어 바로 뒤 be동사, 인칭대명사 수일치 등),\n설명과 실제로 묻는 것이 다른 자리.
- 교재 빈출 목록에 없는 자리는 2점 이하로 매긴다.
- 높은 점수는 문장 구조를 알아야 풀리는 자리(관계사·준동사·병렬·태·시제·비교·가정법·도치, 수식어가 끼어든 수일치)에 준다. 철자·연어·인접 수일치는 낮다.
- 그런 자리는 몇 개가 나오든 모두 4점 이상으로 매긴다. 한 장에 실을 개수를 생각해서 점수를 깎지 마라. 고르는 것은 이쪽에서 한다.
- 거꾸로, 구조를 안 봐도 형태만 보고 풀리는 자리는 아무리 많이 남아도 3점을 넘기지 마라.
  전치사 뒤 동명사, 관사 뒤 명사, 형용사·부사 자리, 주어 바로 뒤 수일치가 그렇다 — 2점 이하로 매겨라.
- 이름이 그 자리의 실제 구조와 다르면 drop으로 한다. 전치사 뒤 V-ing를 분사·분사구문이라 부르거나,
  동사의 목적어인 동명사를 현재분사라 부르거나, 수동태의 p.p.를 명사 수식 분사라 부르는 것이 그렇다.
- 설명(정답이 맞는 이유)이 실제로 답을 정하는 근거와 다르면 drop으로 한다.`,
      input.signal,
      {
        system: "너는 한국 고등학교 내신 영어 출제 검수자다. 정해진 JSON으로만 답한다.",
        schemaName: "one_page_grammar_rating",
        effort: "low",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["no", "score", "drop"],
                properties: {
                  no: { type: "integer" },
                  score: { type: "integer" },
                  drop: { type: "boolean" },
                },
              },
            },
          },
        },
      }
    );
    input.usage.inputTokens += res.usage.inputTokens;
    input.usage.outputTokens += res.usage.outputTokens;
    const parsed = parseJsonSafe<{ items?: Array<{ no?: number; score?: number; drop?: boolean }> }>(res.text);
    const byNo = new Map<number, { score: number; drop: boolean }>();
    for (const it of parsed?.items ?? []) {
      const no = Math.floor(Number(it?.no));
      if (!(no >= 1 && no <= points.length)) continue;
      byNo.set(no, { score: Math.max(0, Math.min(5, Math.floor(Number(it?.score) || 0))), drop: it?.drop === true });
    }
    if (byNo.size === 0) return points;
    const scored = points.map((g, i) => ({ ...g, examScore: byNo.get(i + 1)?.score ?? 3, drop: byNo.get(i + 1)?.drop === true }));
    /*
     * 선생님 지적(2026-09-20): "2개만 있어도 괜찮아. 정말 이건 나오겠다 하는 중요 어법 자리에 넣어 줘."
     * 개수를 채우지 않는다. 확실한 자리(4점 이상)만 싣고, 그런 자리가 없을 때만 기준을 내린다.
     *
     * 2026-09-28 선생님 요청("더 많이, 대신 어렵고 중요한 수준으로")에도 이 기준은 그대로 둔다.
     * 더 싣는 방법은 기준을 내리는 것이 아니라 4점짜리를 더 찾아 오는 것이다(GRAMMAR_CANDIDATES·
     * 프롬프트의 찾는 차례). 4점 이상은 MAX_GRAMMAR까지 모두 싣는다.
     */
    /*
     * 2026-09-29 선생님 지적: "어법이 너무 적거나 그냥 그런 게 많다."
     * 두 가지를 고친다.
     *  · 같은 점수면 <b>고등 교과서가 많이 다루는 자리</b>를 먼저 싣는다.
     *    찾는 차례를 프롬프트의 권유로만 두지 않고 여기서 실제로 줄을 세운다.
     *  · 3점까지 내려받던 뒷문을 없앤다. 4점이 하나도 없으면 어법 칸을 비운다
     *    — 개수를 채우기보다 적중(2026-09-20 기준)을 지킨다.
     */
    /*
     * 2026-09-29 선생님 요청: "최소 5개 이상은 뽑아 달라."
     * 검수(checkGrammarPoint)를 통과한 자리는 이미 「답이 하나로 정해지는 자리」다.
     * 점수는 중요한 정도일 뿐이므로, 다섯이 안 될 때만 점수를 한 칸 내려 고른다.
     * 검수에서 버린 자리를 다시 넣지는 않는다 — 틀린 자리로 개수를 채우지 않는다.
     */
    /*
     * 선생님 요청(2026-09-29): "전치사 동명사 이런 건 솔직히 쉬워. 어려운 순으로 뽑아."
     * 그래서 어려움을 먼저 본다. 시험에 낼 자리인지(examScore)는 이미 drop으로 걸러진
     * 뒤라, 남은 것 가운데서는 어려운 자리가 먼저 실리는 것이 맞다.
     */
    const rank = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
      (b.hard ?? 0) - (a.hard ?? 0) ||
      b.examScore - a.examScore ||
      textbookWeightOf(b.code ?? "") - textbookWeightOf(a.code ?? "");
    const alive = scored.filter((g) => !g.drop);
    const sure = alive.filter((g) => g.examScore >= 4).sort(rank);
    if (sure.length < MIN_GRAMMAR) {
      const more = alive.filter((g) => g.examScore === 3).sort(rank);
      sure.push(...more.slice(0, MIN_GRAMMAR - sure.length));
    }
    const dropped = points.length - sure.length;
    if (dropped > 0) input.notes.push(`어법 ${dropped}개 제외(시험에 낼 자리가 아님)`);
    return sure.map((g) => {
      const rest = { ...g } as Partial<typeof g>;
      delete rest.drop;
      return rest as Omit<typeof g, "drop">;
    });
  } catch {
    return points;
  }
}

/**
 * 빈칸 추론 자리와 바꿔 쓰기 표현도 시험에 나올 만한 것만 남긴다(선생님 지적 2026-09-18:
 * "별로 안 중요한 것도 있다"). 어법처럼 한 번에 매겨 점수가 낮은 것을 빼고 높은 것부터 싣는다.
 * 요약문 빈칸은 코드가 요약문 핵심 어구로 만들므로 매기지 않는다. 실패하면 있는 대로 쓴다.
 */
async function rateExamAndParaphrases(input: {
  apiKey: string;
  sentences: string[];
  examPoints: OnePageExamPoint[];
  paraphrases: OnePageParaphrase[];
  implications: OnePageImplication[];
  signal: AbortSignal;
  usage: Usage;
  notes: string[];
}): Promise<{
  examPoints: OnePageExamPoint[];
  paraphrases: OnePageParaphrase[];
  implications: OnePageImplication[];
}> {
  const blanks = input.examPoints.filter((e) => e.kind === "blank" || e.kind === "insert");
  const { paraphrases, implications } = input;
  if (blanks.length + paraphrases.length + implications.length === 0) return input;
  const blankList = blanks
    .map((e, i) => `B${i + 1}) [${e.kind === "blank" ? "빈칸 추론" : "문장 삽입"}] ${e.kind === "blank" ? `빈칸: ${e.target}` : "이 문장을 뺀다"}
   문장: ${input.sentences[e.sentenceIndex] ?? ""}`)
    .join("\n");
  const paraList = paraphrases
    .map((p, i) => `P${i + 1}) ${p.expression} (${p.meaningKo})
   문장: ${input.sentences[p.sentenceIndex] ?? ""}`)
    .join("\n");
  const impList = implications
    .map((m, i) => `I${i + 1}) ${m.expression} → ${m.meaningKo}
   문장: ${input.sentences[m.sentenceIndex] ?? ""}`)
    .join("\n");
  try {
    const res = await requestContent(
      input.apiKey,
      `아래는 한 지문에서 뽑은 출제 후보다. 고등학교 내신·모의고사에 실제로 나올 만한지 매겨라.

[지문]
${input.sentences.join(" ")}

[빈칸 추론·문장 삽입 후보]
${blankList || "(없음)"}

[바꿔 쓰기 표현 후보]
${paraList || "(없음)"}

[함축의미 후보]
${impList || "(없음)"}

각 후보에 대해 id(B1, P2, I1 …), score(0~5), drop을 답한다.
- 빈칸 추론: 주제문·결론문에서 요지를 담은 어구, 앞뒤 연결어·대조·인과로 답이 하나로 좁혀지는 자리가 높다(학력평가 31~34번과 같은 자리). 지엽적인 사실·예시·숫자·고유명사, 문맥 없이도 맞힐 수 있는 뻔한 자리, 앞 문장을 그대로 옮기면 되는 자리는 drop.
- 문장 삽입: 지칭어·연결어로 자리가 하나로 정해질 때만 높다.
- 바꿔 쓰기: 이 문맥에서만 뜻이 살아나는 표현(비유·관용·함축), 주제문에서 요지를 떠받치는 구, 서술형에 그대로 나오는 구동사·숙어·구문이 높다. 사전 뜻·직역으로 끝나는 구, 흔한 일상 표현(a lot of, in the past), 지문 흐름과 상관없는 표현은 drop.
- 함축의미: "밑줄 친 …이 의미하는 바를 쓰시오"로 낼 자리다. 글자 뜻만으로는 풀리지 않고 앞뒤를 읽어야 풀리는 말(따옴표 안의 말, 비유, 앞 내용을 통째로 받는 구)이 높다.
  풀이(→ 뒤의 한국어)도 함께 본다: 그 문장을 그대로 해석한 것, 표현을 말만 바꿔 되풀이한 것, 두루뭉술해서 채점할 수 없는 것은 drop.
  낱말 뜻만 알면 풀리는 말, 단순한 지칭어(it·this·they), 바꿔 쓰기 후보와 겹치는 말도 drop.`,
      input.signal,
      {
        system: "너는 한국 고등학교 내신 영어 출제 검수자다. 정해진 JSON으로만 답한다.",
        schemaName: "one_page_exam_rating",
        effort: "low",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "score", "drop"],
                properties: {
                  id: { type: "string" },
                  score: { type: "integer" },
                  drop: { type: "boolean" },
                },
              },
            },
          },
        },
      }
    );
    input.usage.inputTokens += res.usage.inputTokens;
    input.usage.outputTokens += res.usage.outputTokens;
    const parsed = parseJsonSafe<{ items?: Array<{ id?: string; score?: number; drop?: boolean }> }>(res.text);
    const byId = new Map<string, { score: number; drop: boolean }>();
    for (const it of parsed?.items ?? []) {
      const id = String(it?.id ?? "").trim().toUpperCase();
      if (!id) continue;
      byId.set(id, { score: Math.max(0, Math.min(5, Math.floor(Number(it?.score) || 0))), drop: it?.drop === true });
    }
    if (byId.size === 0) return input;
    const keep = <T,>(list: T[], prefix: string, min: number, bar = 3, cap = Number.MAX_SAFE_INTEGER) => {
      const scored = list
        .map((x, i) => ({ x, r: byId.get(`${prefix}${i + 1}`) ?? { score: 3, drop: false } }))
        .sort((a, b) => b.r.score - a.r.score);
      const strict = scored.filter((s) => !s.r.drop && s.r.score >= bar);
      // 합격선을 넘는 것이 모자라면 기준을 한 칸 내리고, 그래도 없으면 점수 높은 것부터 되살린다.
      // 검수가 후보를 모두 버려 자료가 통째로 비는 일을 막는다.
      const loose = scored.filter((s) => !s.r.drop);
      const pool = (strict.length >= min ? strict : loose.length > 0 ? loose : scored).slice(
        0,
        Math.max(cap === Number.MAX_SAFE_INTEGER ? scored.length : cap, min)
      );
      return { list: pool.map((s) => s.x), dropped: list.length - pool.length };
    };
    const b = keep(blanks, "B", 1);
    // 선생님 지적 2026-09-22: 중요표현·함축의미의 질을 올린다 — 넉넉히 받아 4점 이상만 싣는다.
    const p = keep(paraphrases, "P", 3, 4, 5);
    const m = keep(implications, "I", 0, 4, 2);
    const dropped = b.dropped + p.dropped + m.dropped;
    if (dropped > 0) input.notes.push(`출제 자리·표현 ${dropped}개 제외(시험에 나올 자리가 아님)`);
    return {
      examPoints: [...b.list, ...input.examPoints.filter((e) => e.kind !== "blank" && e.kind !== "insert")],
      paraphrases: p.list,
      implications: m.list,
    };
  } catch {
    return input;
  }
}

async function refillMaterial(input: {
  apiKey: string;
  baseUser: string;
  sentences: string[];
  grammar: OnePageGrammarPoint[];
  vocab: OnePageVocabNote[];
  /** 검수에서 버린 어법 자리·낱말(다시 뽑지 않게) */
  dropped: { targets: string[]; words: string[] };
  /** 몇 개가 더 필요한지(검수 전에 미리 부를 때는 밖에서 정한다). */
  need?: { grammar: number; vocab: number };
  signal: AbortSignal;
  usage: Usage;
}): Promise<{ grammar: OnePageGrammarPoint[]; vocab: OnePageVocabNote[] }> {
  const needGrammar = input.need ? input.need.grammar : Math.max(0, MIN_GRAMMAR - input.grammar.length);
  const needVocab = input.need ? input.need.vocab : Math.max(0, MIN_VOCAB - input.vocab.length);
  if (needGrammar === 0 && needVocab === 0) return { grammar: [], vocab: [] };
  const usedTargets = [...input.grammar.map((g) => g.target), ...input.dropped.targets];
  const usedWords = [...input.vocab.map((v) => v.surface), ...input.dropped.words];
  /**
   * 모자란 갈래만 따로, 동시에 묻는다. 예전에는 어법·낱말을 한 호출에 몰아 물어 답이 길어졌고
   * 그 길이가 그대로 맨 뒤에 붙는 대기 시간이 됐다(지문 하나에 50초씩 더 걸렸다).
   */
  const askFor = async (
    kind: "grammar" | "vocab",
    count: number,
    used: string[]
  ): Promise<unknown[]> => {
    if (count === 0) return [];
    // 한 호출에 여러 개를 물으면 답이 길어져 그만큼 늦는다. 앞뒤로 나눠 동시에 묻는다.
    const parts = chunkPlan(input.sentences.length, count, 2);
    const answers = await Promise.all(
      parts.map(async (part) => {
        const user = `${input.baseUser}

이미 쓴 ${kind === "grammar" ? "어법 자리" : "낱말"}: ${JSON.stringify(used)}
이것들과 겹치지 않는 것을, no가 ${part.from}~${part.to}인 문장에서만 ${part.ask}개 더 골라라.${
          kind === "grammar" ? " 두 형태가 다 맞는 자리는 넣지 마라. 이번에는 scan을 적지 말고 grammar만 낸다." : ""
        }`;
        const res = await requestContent(input.apiKey, user, input.signal, {
          system: kind === "grammar" ? GRAMMAR_PROMPT : WORDS_PROMPT,
          schemaName: kind === "grammar" ? "one_page_grammar" : "one_page_words",
          schema: (kind === "grammar" ? GRAMMAR_REFILL_SCHEMA : WORDS_SCHEMA) as unknown as Record<string, unknown>,
          effort: kind === "grammar" ? "low" : "minimal",
        });
        input.usage.inputTokens += res.usage.inputTokens;
        input.usage.outputTokens += res.usage.outputTokens;
        const raw = parseJsonSafe<RawContent>(res.text);
        return rows(kind === "grammar" ? raw?.grammar : raw?.vocab);
      })
    );
    return answers.flat();
  };
  const [gRows, vRows] = await Promise.all([
    askFor("grammar", needGrammar > 0 ? needGrammar + 3 : 0, usedTargets),
    askFor("vocab", needVocab > 0 ? needVocab + 3 : 0, usedWords),
  ]);
  const parsed = { grammar: gRows, vocab: vRows };
  if (gRows.length === 0 && vRows.length === 0) return { grammar: [], vocab: [] };
  const placeIn = makePlaceIn(input.sentences);

  const freshGrammar: OnePageGrammarPoint[] = [];
  if (needGrammar > 0) {
    const taken = (t: string) => usedTargets.some((x) => x.toLowerCase() === t.toLowerCase());
    for (const r of rows(parsed.grammar)) {
      const point = checkGrammarPoint(r, input.sentences, placeIn);
      if (!point || taken(point.target)) continue;
      const all = [...input.grammar, ...freshGrammar];
      if (all.some((g) => g.target.toLowerCase() === point.target.toLowerCase())) continue;
      if (all.filter((g) => g.code === point.code).length >= 2) continue;
      if (all.filter((g) => g.sentenceIndex === point.sentenceIndex).length >= 2) continue;
      freshGrammar.push(point);
      if (freshGrammar.length >= needGrammar + 2) break;
    }
  }

  const freshVocab: OnePageVocabNote[] = [];
  if (needVocab > 0) {
    for (const r of rows(parsed.vocab)) {
      const note = checkVocabNote(r, placeIn, [...input.vocab, ...freshVocab]);
      if (!note) continue;
      if (usedWords.some((w) => w.toLowerCase() === note.surface.toLowerCase())) continue;
      freshVocab.push(note);
      if (freshVocab.length >= needVocab + 3) break;
    }
  }
  if (freshGrammar.length === 0 && freshVocab.length === 0) return { grammar: [], vocab: [] };

  // 보충은 맨 뒤에 붙는 시간이라 검수를 어법에만 건다(낱말은 코드 검사만으로도 쓸 만하다).
  if (freshGrammar.length === 0) return { grammar: [], vocab: freshVocab };
  const checked = await verifyOnePageGrammar({
    apiKey: input.apiKey,
    sentences: input.sentences,
    grammar: freshGrammar,
    signal: input.signal,
  });
  input.usage.inputTokens += checked.usage.inputTokens;
  input.usage.outputTokens += checked.usage.outputTokens;
  return { grammar: checked.grammar, vocab: freshVocab };
}

const REFERENCE_FILL_PROMPT = `You resolve reference expressions in an English passage for a Korean high-school study sheet ("what does the underlined word refer to?").
You get the numbered passage and a list of candidate expressions found in it (id, sentenceNo, surface, and the sentence it sits in).
For each candidate answer:
- isReference: true only if, in this passage, the expression points back to something already mentioned. Set it false for a dummy or impersonal "it", an "it" in a fixed phrase (it is important to, it turns out that), a first-mention "the" phrase, a generic "this"/"that" that points at nothing in the passage, a numeral "one", a relative or conjunction "that", a generic "they"/"you" meaning people in general, and anything referring to the writer or the reader.
- referentNo: the number of the sentence that holds the antecedent. It must be EARLIER than sentenceNo, or the same sentence when the antecedent stands before the expression in it. Among several earlier mentions, take the NEAREST one the expression actually picks up.
- referent: that antecedent copied word for word from that sentence (normally 1-12 words). When "this", "that" or "so" points at a whole idea, copy the whole clause or sentence word for word (max 40 words).
- The referent must be a full noun phrase or clause that names the thing. Never answer with another pronoun or a vague phrase ("it", "they", "these things", "such a thing", "something", "one"); go back to the wording that names it. Never answer with the same words as the expression itself ("the Earth" -> "the Earth", "The asteroid" -> "The asteroid"): when the only earlier wording repeats the expression, set isReference false.
- Set isReference false when the thing is only implied and no earlier wording states it, and when the expression is a plain repeat of a noun already named in full ("the Earth", "the students") rather than a pointer a test would ask about.
- surfaceFix: when the candidate cuts a noun phrase short ("This essential survival" for "This essential survival mechanism"), give the whole phrase exactly as written, starting at the same word; otherwise "".
Never guess: when you are not sure what the expression points back to, set isReference false and leave referent "".
Return only JSON.`;

const REFERENCE_FILL_SCHEMA = obj({
  results: {
    type: "array",
    items: obj({ id: str, isReference: bool, referentNo: int, referent: str, surfaceFix: str }),
  },
});

/**
 * 지칭어를 빠짐없이 싣기 위한 호출. 만드는 모델의 성실함에 기대지 않고 지칭 후보를 코드로 훑어
 * (one-page-reference-scan) "이 말이 무엇을 가리키느냐"만 되묻는다. 만드는 호출과 같이 띄울 수
 * 있어 기다리는 시간이 늘지 않는다. 돌아온 답은 "그 말이 앞 문장에 그대로 있는지"를 코드로
 * 확인해 맞는 것만 남긴다(틀린 지칭은 버린다).
 */
async function resolveScannedReferences(input: {
  apiKey: string;
  sentences: string[];
  signal: AbortSignal;
}): Promise<{ references: OnePageReference[]; scanned: number; resolved: number; usage: Usage }> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const candidates = scanReferenceCandidates(input.sentences).slice(0, 28);
  if (candidates.length === 0) return { references: [], scanned: 0, resolved: 0, usage };
  const passage = input.sentences.map((en, i) => `${i + 1}. ${en}`).join("\n");
  // 후보가 많으면 나눠 동시에 묻는다(한 번에 다 물으면 답이 길어져 그대로 기다리는 시간이 된다).
  const parts: Array<Array<{ c: (typeof candidates)[number]; i: number }>> = [];
  const size = 4;
  candidates.forEach((c, i) => {
    if (i % size === 0) parts.push([]);
    parts[parts.length - 1]!.push({ c, i });
  });
  const answers = await Promise.all(
    parts.map((part) =>
      requestContent(
        input.apiKey,
        JSON.stringify({
          passage,
          items: part.map(({ c, i }) => ({
            id: String(i),
            sentenceNo: c.sentenceIndex + 1,
            surface: c.surface,
            sentence: input.sentences[c.sentenceIndex] ?? "",
          })),
        }),
        input.signal,
        {
          system: REFERENCE_FILL_PROMPT,
          schemaName: "one_page_reference_fill",
          schema: REFERENCE_FILL_SCHEMA as unknown as Record<string, unknown>,
          effort: "low",
        }
      )
    )
  );
  const resultRows: Row[] = [];
  for (const res of answers) {
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    resultRows.push(...rows(parseJsonSafe<{ results?: unknown }>(res.text)?.results));
  }
  const byId = new Map(resultRows.map((r) => [str1(r.id), r] as const));

  const references: OnePageReference[] = [];
  /** 이미 표시를 붙인 자리(같은 말에 표시가 두 번 겹치지 않게) */
  const takenSpans: Array<{ si: number; start: number; end: number }> = [];
  candidates.forEach((c, i) => {
    const row = byId.get(String(i));
    if (!row || row.isReference !== true) return;
    const referent = str1(row.referent);
    if (!referent || wordCount(referent) > 40) return;
    // 가리키는 말이 또 대명사·막연한 말이면(these things, something) 풀이가 되지 않는다.
    if (!namesSomething(referent)) return;
    // 지칭어와 똑같은 말을 답으로 준 것(the Earth → the Earth)은 풀이가 아니다.
    if (sameWords(referent, c.surface)) return;
    const from = Math.floor(Number(row.referentNo)) - 1;
    if (!(from >= 0 && from <= c.sentenceIndex)) return;
    // 가리키는 말이 그 문장에 그대로 있어야 하고, 지칭어보다 앞에 있어야 한다.
    const hit = findPhrase(input.sentences[from] ?? "", referent);
    if (!hit) return;
    if (from === c.sentenceIndex && hit.start >= c.start) return;
    // 후보가 명사구를 반 토막 냈으면 모델이 준 온전한 어구로 바꾼다(같은 자리에서 시작해야 한다).
    const sentence = input.sentences[c.sentenceIndex] ?? "";
    const fix = str1(row.surfaceFix);
    const fixHit = fix && wordCount(fix) <= 6 ? findPhrase(sentence, fix, { from: c.start, to: sentence.length }) : null;
    const surface = fixHit && fixHit.start === c.start ? sentence.slice(fixHit.start, fixHit.end) : c.surface;
    const end = c.start + surface.length;
    // 명사구를 넓혀 잡으면 그 안의 낱말이 따로 또 후보로 올라온다(the large ones / ones). 겹치면 버린다.
    if (takenSpans.some((t) => t.si === c.sentenceIndex && c.start < t.end && t.start < end)) return;
    takenSpans.push({ si: c.sentenceIndex, start: c.start, end });
    if (sameWords(referent, surface)) return;
    // 같은 말이 같은 것을 가리키면 한 번만 싣는다(they → people이 세 줄씩 늘어서지 않게).
    if (references.some((r) => sameWords(r.surface, surface) && sameWords(r.referent, referent))) return;
    // 같은 지칭어는 두 번까지만(it·they가 목록을 다 차지하지 않게).
    if (references.filter((r) => sameWords(r.surface, surface)).length >= 2) return;
    const occurrence = surface === c.surface ? c.occurrence : countPhrase(sentence.slice(0, c.start), surface);
    references.push({
      sentenceIndex: c.sentenceIndex,
      surface,
      referent: input.sentences[from]!.slice(hit.start, hit.end),
      referentSentenceIndex: from,
      meaningKo: "",
      occurrence,
    });
  });
  return { references, scanned: candidates.length, resolved: references.length, usage };
}

/**
 * 어법을 몇 조각으로 나눠 물을지. 출력이 길수록 그 길이가 그대로 기다리는 시간이 되므로,
 * 조각마다 서너 개씩만 받아 동시에 부른다(문맥은 지문 전체를 준다).
 */
function chunkPlan(
  sentenceCount: number,
  total: number,
  maxChunks: number
): Array<{ from: number; to: number; ask: number }> {
  const chunks = Math.max(1, Math.min(maxChunks, Math.ceil(sentenceCount / 2.5)));
  const per = Math.ceil(sentenceCount / chunks);
  const ask = Math.max(3, Math.ceil(total / chunks));
  const plan: Array<{ from: number; to: number; ask: number }> = [];
  for (let from = 1; from <= sentenceCount; from += per) {
    const to = Math.min(sentenceCount, from + per - 1);
    // 문장 수보다 많이 달라고 하면 억지로 채운 것이 섞인다(문장 하나에 셋까지).
    plan.push({ from, to, ask: Math.max(2, Math.min(ask, (to - from + 1) * 3)) });
  }
  return plan;
}

export async function generateOnePageContent(input: {
  title: string;
  sentences: string[];
  /**
   * 워크북 유형(요약문·도식화·지칭·함축·바꿔 말하기)만 쓸 때: 어법·낱말 갈래와 그 보충·채점을 건너뛴다.
   * 그 둘이 원가의 약 4분의 3이다(2026-10-28 실측 44원 중 34원). 결과의 grammar·vocab은 비어 있으므로
   * 1장 자료 재료(onePageContent)로 저장하면 안 된다.
   */
  lite?: boolean;
}): Promise<{ content: OnePageContent; model: string; usage: Usage; notes: string[] }> {
  const lite = input.lite === true;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  const sentences = input.sentences.map((s) => formatWorkbookPassage(s)).filter(Boolean);
  if (sentences.length < 2) throw new Error("지문 문장이 너무 적습니다.");

  const baseUser = JSON.stringify({
    title: input.title || "",
    sentences: sentences.map((en, i) => ({ no: i + 1, en })),
  });

  const controller = new AbortController();
  // 만들기·검수·보충까지 경로 상한(300초) 안에 들게 둔다.
  const timer = setTimeout(() => controller.abort(), 270_000);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let model = "";
  try {
    /**
     * 만드는 호출(주제·요약, 출제 포인트, 바꿔 쓰기, 낱말, 어법 조각들)과 지칭 풀이를 한꺼번에
     * 띄우고, 갈래가 돌아오는 대로 그 갈래의 검수를 바로 이어 붙인다. 기다리는 시간이 합이
     * 아니라 "가장 긴 갈래 하나"가 된다(선생님 지적: 1장 자료가 너무 느리다).
     */
    const startedAt = Date.now();
    const seconds = (from: number) => Math.round((Date.now() - from) / 100) / 10;
    const lap: string[] = [];
    const ask = async (
      label: string,
      system: string,
      schemaName: string,
      schema: Record<string, unknown>,
      extraUser = "",
      /** 베껴 오기만 하는 갈래(요약·바꿔 쓰기·낱말)는 생각을 줄여 더 빨리 받는다. */
      effort: "minimal" | "low" = "low",
      /** 조각마다 따로 끊을 수 있게(어법). 주지 않으면 전체 신호를 쓴다. */
      signal: AbortSignal = controller.signal,
      modelOverride?: string
    ) => {
      const at = Date.now();
      const res = await requestContent(apiKey, `${baseUser}${extraUser}`, signal, {
        system,
        schemaName,
        schema,
        effort,
        model: modelOverride,
      });
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      lap.push(`${label} ${seconds(at)}초`);
      return res;
    };
    /** 검수까지 끝난 갈래에 걸린 시간을 적는다(어디가 길었는지 notes에서 본다). */
    const done = <T>(label: string, work: Promise<T>): Promise<T> => {
      const at = Date.now();
      return work.then((value) => {
        lap.push(`${label} ${seconds(at)}초`);
        return value;
      });
    };

    /*
     * 참·거짓의 참 개수를 코드가 먼저 정한다.
     *
     * 선생님과 함께 훑어 보니(2026-09-29) 1장 요약자료 705문항의 58%, 1장
     * 테스트지 202문항의 60%가 참이었다. 「T 2~3개」라고만 적어 두니 3개 쪽으로
     * 기울었다. 다섯 중 둘 또는 셋으로 못박으면 평균이 절반이 된다.
     */
    const trueCount = 2 + Math.floor(Math.random() * 2);
    // 개수는 목표로만 준다 — 「정확히」라고 못박으니 맞는 문장을 F로 표시해 개수를 맞췄다(2026-11-02 선생님 지적, 495문항 중 15).
    const corePrompt = CORE_PROMPT.replace(
      "{{TF_TRUE_COUNT}}",
      `T는 ${trueCount}개, F는 ${5 - trueCount}개가 되도록 문장을 만든다(F로 할 문장은 처음부터 지문과 다르게 쓴다).`
    );

    const corePromise = ask(
      "core",
      corePrompt,
      "one_page_core",
      CORE_SCHEMA as unknown as Record<string, unknown>,
      "",
      "minimal"
    );
    const examPromise = ask("exam", EXAM_PROMPT, "one_page_exam", EXAM_SCHEMA as unknown as Record<string, unknown>);
    const extraPromise = ask(
      "extra",
      EXTRA_PROMPT,
      "one_page_extra",
      EXTRA_SCHEMA as unknown as Record<string, unknown>,
      "",
      "minimal"
    );

    // ---- 낱말: 앞뒤로 나눠 만들고, 다 돌아오면 걸러 바로 검수한다.
    const vocabPicked = Promise.all(
      (lite ? [] : chunkPlan(sentences.length, VOCAB_CANDIDATES, 2)).map((part, i) =>
        ask(
          `words${i + 1}`,
          WORDS_PROMPT,
          "one_page_words",
          WORDS_SCHEMA as unknown as Record<string, unknown>,
          `\n\n이번에는 no가 ${part.from}~${part.to}인 문장에서만 ${part.ask}개를 고른다.`,
          "minimal"
        )
      )
    ).then((parts) =>
      pickVocabNotes(
        parts.flatMap((res) => rows(parseJsonSafe<{ vocab?: unknown }>(res.text)?.vocab)),
        sentences
      )
    );
    const vocabPromise = done(
      "낱말+검수",
      vocabPicked.then(async (picked) => {
        if (lite) return { picked, vocab: [] as OnePageVocabNote[], notes: [] as string[] };
        const checked = await verifyOnePageVocab({ apiKey, sentences, vocab: picked, signal: controller.signal });
        usage.inputTokens += checked.usage.inputTokens;
        usage.outputTokens += checked.usage.outputTokens;
        return { picked, ...checked };
      })
    );

    // ---- 어법: 조각마다 따로 만들고, 그 조각이 돌아오는 대로 그 조각만 검수한다.
    /*
     * 실측(2026-09-17, 9문장 지문): 전체 32.8초 가운데 어법이 18.6·21.7·24.6초에 돌아오고
     * 마지막 조각의 검수가 끝나는 32.8초가 곧 전체 시간이었다. 나머지(주제·요약·낱말·지칭)는
     * 20초 안에 다 끝나 있다. 조각을 더 잘게 나눠 봤더니 오히려 40초가 됐다 — 조각 길이가
     * 아니라 호출마다 들쭉날쭉한 것이 문제였다(같은 크기인데 17초와 35초가 섞인다).
     * 늦는 조각을 한 번 더 불러 봤더니(먼저 오는 쪽 쓰기) 42초로 더 느려졌다 — 호출을 늘리면
     * 서로 밀려 모두 느려진다. 그래서 부르는 횟수를 늘리지 않고, 어법 생성만 가벼운 설정으로 둔다.
     */
    const grammarChunks = (lite ? [] : chunkPlan(sentences.length, GRAMMAR_CANDIDATES, 4)).map((part, i) => {
      /**
       * 조각 하나가 유난히 오래 끄는 일이 있다(같은 지문에서 20초와 70초가 섞인다). 조각은 서로
       * 기다리지 않으므로, 기한을 넘긴 조각은 끊고 나머지로 만든다. 한 장에 실을 수보다 넉넉히
       * 뽑아 두므로 하나쯤 빠져도 자리는 찬다.
       */
      const chunkAbort = new AbortController();
      const stop = () => chunkAbort.abort();
      controller.signal.addEventListener("abort", stop);
      const deadline = setTimeout(stop, GRAMMAR_CHUNK_DEADLINE_MS);
      const askChunk = () =>
        ask(
          `grammar${i + 1}`,
          GRAMMAR_PROMPT,
          "one_page_grammar",
          GRAMMAR_SCHEMA as unknown as Record<string, unknown>,
          `\n\n이번에는 no가 ${part.from}~${part.to}인 문장에서만 ${part.ask}개를 고른다(조건에 맞는 자리가 그보다 적으면 있는 만큼만).`,
          "low",
          chunkAbort.signal
        ).then((res) =>
          pickGrammarPoints(parseJsonSafe<{ grammar?: unknown }>(res.text)?.grammar, sentences, part.ask + 1)
        );
      const picked = askChunk();
      const verified = picked
        .then(async (list) => {
          const checked = await verifyOnePageGrammar({
            apiKey,
            sentences,
            grammar: list,
            signal: chunkAbort.signal,
          });
          usage.inputTokens += checked.usage.inputTokens;
          usage.outputTokens += checked.usage.outputTokens;
          return { picked: list, ...checked };
        })
        .catch(() => ({
          picked: [] as OnePageGrammarPoint[],
          grammar: [] as OnePageGrammarPoint[],
          notes: [`어법 조각 ${i + 1} 시간 초과로 건너뜀`],
        }))
        .finally(() => {
          clearTimeout(deadline);
          controller.signal.removeEventListener("abort", stop);
        });
      return { picked: picked.catch(() => [] as OnePageGrammarPoint[]), verified };
    });
    const grammarPromise = done(
      "어법+검수",
      Promise.all(grammarChunks.map((c) => c.verified))
    );

    /**
     * 뽑힌 자리가 빠듯하면(검수에서 한둘은 버려진다) 검수를 기다리지 않고 보충을 같이 띄운다.
     * 검수가 끝난 뒤에 부르면 그 시간이 통째로 맨 뒤에 붙는다(지문 하나에 40초). 보충도 앞뒤로
     * 나눠 동시에 부르고, 늦으면 끊고 있는 것으로 만든다.
     */
    const sparePromise = Promise.all(grammarChunks.map((c) => c.picked)).then((lists) => {
      /*
       * 검수에서 한둘은 버려지므로, 뽑은 수가 실을 수보다 두 개쯤 많지 않으면 미리 띄운다.
       * 이 호출은 검수·채점과 겹쳐 도니 맨 뒤에 붙는 시간이 아니다(2026-09-29 속도 손질).
       */
      if (lite || lists.flat().length >= MIN_GRAMMAR + 2) return { grammar: [] as OnePageGrammarPoint[] };
      const spareAbort = new AbortController();
      const stop = () => spareAbort.abort();
      controller.signal.addEventListener("abort", stop);
      const deadline = setTimeout(stop, SPARE_DEADLINE_MS);
      return done(
        "보충",
        refillMaterial({
          apiKey,
          baseUser,
          sentences,
          grammar: lists.flat(),
          vocab: [],
          dropped: { targets: [], words: [] },
          need: { grammar: Math.max(3, MIN_GRAMMAR + 2 - lists.flat().length), vocab: 0 },
          signal: spareAbort.signal,
          usage,
        })
          .catch(() => ({ grammar: [] as OnePageGrammarPoint[] }))
          .finally(() => {
            clearTimeout(deadline);
            controller.signal.removeEventListener("abort", stop);
          })
      );
    });

    // ---- 지칭: 후보는 코드로 훑으므로 만드는 호출을 기다리지 않는다. 풀리는 대로 바로 검수한다.
    const referencePromise = done(
      "지칭+검수",
      resolveScannedReferences({ apiKey, sentences, signal: controller.signal }).then(async (scan) => {
        usage.inputTokens += scan.usage.inputTokens;
        usage.outputTokens += scan.usage.outputTokens;
        const checked = await verifyOnePageReferences({
          apiKey,
          sentences,
          references: scan.references.slice(0, MAX_REFERENCES),
          signal: controller.signal,
        });
        usage.inputTokens += checked.usage.inputTokens;
        usage.outputTokens += checked.usage.outputTokens;
        return { scan, ...checked };
      })
    );

    // ---- 주제·요약·출제 포인트·바꿔 쓰기: 둘이 다 오면 해석만 다시 확인한다.
    const corePipeline = done(
      "요약+출제+검수",
      Promise.all([corePromise, extraPromise, examPromise]).then(async ([coreRes, extraRes, examRes]) => {
        model = coreRes.model;
        const core = parseJsonSafe<RawContent>(coreRes.text);
        if (!core) throw new Error("1장 자료 응답을 읽지 못했습니다. 다시 시도해 주세요.");
        const checked = checkCore(
          {
            ...core,
            paraphrases: parseJsonSafe<{ paraphrases?: unknown }>(extraRes.text)?.paraphrases ?? [],
            implications: parseJsonSafe<{ implications?: unknown }>(extraRes.text)?.implications ?? [],
            examPoints: parseJsonSafe<{ examPoints?: unknown }>(examRes.text)?.examPoints ?? [],
          },
          sentences
        );
        if (
          checked.problems.some((p) => p === "요약문 없음" || p === "주제 없음") ||
          checked.tf.length < 3 ||
          checked.summaryKeywords.length === 0
        ) {
          throw new Error(`1장 자료를 만들지 못했습니다(${checked.problems.join(", ")}). 다시 시도해 주세요.`);
        }
        const verified = await verifyOnePageTranslations({
          apiKey,
          summaryEn: checked.summaryEn,
          summaryKo: checked.summaryKo,
          paraphrases: checked.paraphrases,
          signal: controller.signal,
        });
        usage.inputTokens += verified.usage.inputTokens;
        usage.outputTokens += verified.usage.outputTokens;
        return { checked, verified };
      })
    );

    /*
     * 모자란 어법을 채우는 보충을 어법 검수가 끝나는 대로 띄운다.
     *
     * 앞서는 이것을 채점 바로 앞에 두었는데, 그 자리는 위 Promise.all이 <b>모두</b> 끝난
     * 뒤였다. 같이 띄워 둔 보충(spare)이 40초를 쓰면 그만큼 늦게 시작해, 결국 통째로
     * 맨 뒤에 붙었다(2026-09-29 실측 114초). 어법 검수만 끝나면 몇 개가 모자란지 알 수
     * 있으니, 다른 갈래를 기다리지 않고 여기서 바로 부른다.
     */
    const tailRefill = grammarPromise.then((parts) => {
      const verified = parts.flatMap((p) => p.grammar);
      /*
       * 채점에서 또 한둘이 떨어지므로, 검수를 통과한 수만 보고 딱 맞게 부르면 모자란다.
       * 모자랄 때는 넉넉히(둘 이상) 가져온다 — 어차피 한 번만 부르는 호출이다.
       */
      if (lite || verified.length >= MIN_GRAMMAR + 2) {
        return { grammar: [] as OnePageGrammarPoint[], vocab: [] as OnePageVocabNote[] };
      }
      const need = Math.max(2, MIN_GRAMMAR + 2 - verified.length);
      return refillMaterial({
        apiKey,
        baseUser,
        sentences,
        grammar: verified,
        vocab: [],
        dropped: {
          targets: parts
            .flatMap((p) => p.picked)
            .filter((g) => !verified.some((k) => k.target === g.target))
            .map((g) => g.target),
          words: [],
        },
        need: { grammar: need, vocab: 0 },
        signal: controller.signal,
        usage,
      }).catch(() => ({ grammar: [] as OnePageGrammarPoint[], vocab: [] as OnePageVocabNote[] }));
    });

    const [{ checked: core, verified: translated }, vocabDone, grammarParts, referenceDone, spare] =
      await Promise.all([corePipeline, vocabPromise, grammarPromise, referencePromise, sparePromise]);

    const notes: string[] = [];
    notes.push(
      `지칭 후보 ${referenceDone.scan.scanned}개 중 ${referenceDone.scan.resolved}개 풀이, ${referenceDone.references.length}개 실음`
    );
    notes.push(...translated.notes, ...vocabDone.notes, ...grammarParts.flatMap((p) => p.notes), ...referenceDone.notes);

    /*
     * 한 장에 실을 것 고르기. 같은 어법이 둘이면 뒤엣것은 자리가 남을 때만 쓴다.
     * 다만 서로 다른 어법을 채우는 데만 매달리면 교재가 거의 묻지 않는 희귀한 자리가
     * 앞자리를 차지한다(선생님 지적 2026-09-17: "얼토당토않은 어법 포인트"). 후보를
     * 10개에서 18개로 늘리면서 이 일이 더 자주 생겼다. 그래서 교재가 자주 묻는
     * 어법부터 고른다.
     */
    const spread = <T extends { code?: string; caseId?: string; examScore?: number; hard?: number }>(
      list: T[],
      max: number
    ) => {
      const freqOf = (x: T) => onePageGrammarRule(String(x.code ?? ""))?.freq ?? 0;
      // 시험에 나올 자리인지 매긴 점수가 먼저, 같으면 교재 빈출 케이스에 걸린 것, 그 다음 교재가 자주 묻는 어법 순서.
      const scoreOf = (x: T) => (typeof x.examScore === "number" ? x.examScore : 3);
      const caseOf = (x: T) => (x.caseId ? 1 : 0);
      const hardOf = (x: T) => (typeof x.hard === "number" ? x.hard : 0);
      // 어려운 자리가 먼저다(선생님 요청 2026-09-29). 같으면 시험에 나올 자리부터.
      const ranked = [...list].sort(
        (a, b) => hardOf(b) - hardOf(a) || scoreOf(b) - scoreOf(a) || caseOf(b) - caseOf(a) || freqOf(b) - freqOf(a)
      );
      const seen = new Set<string>();
      const first = ranked.filter((x) => {
        const key = x.caseId ? `case:${x.caseId}` : `code:${x.code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const chosen = [...first, ...ranked.filter((x) => !first.includes(x))].slice(0, max);
      /*
       * 쉬운 자리(어려움 1~2 — 전치사 뒤 동명사처럼 앞말만 보면 풀리는 것)는
       * 개수를 채울 때만 쓴다. 뒤에서부터 덜어내되 실을 최소(5)는 지킨다.
       */
      while (chosen.length > MIN_GRAMMAR && hardOf(chosen[chosen.length - 1]!) <= 2) chosen.pop();
      return chosen;
    };
    // 검수에서 버려진 자리는 같이 띄워 둔 보충에서 겹치지 않는 것으로 메운다.
    const verifiedGrammar = grammarParts.flatMap((p) => p.grammar);
    const taken = new Set(verifiedGrammar.map((g) => `${g.sentenceIndex}|${g.target.toLowerCase()}`));
    const addGrammar = spare.grammar.filter((g) => !taken.has(`${g.sentenceIndex}|${g.target.toLowerCase()}`));
    if (addGrammar.length) notes.push(`어법 ${addGrammar.length}개 더 뽑음`);
    const [gradedGrammar, gradedExam] = await Promise.all([
      lite
        ? Promise.resolve([] as OnePageGrammarPoint[])
        : rateGrammarPoints({
            apiKey,
            sentences,
            points: [...verifiedGrammar, ...addGrammar],
            signal: controller.signal,
            usage,
            notes,
          }),
      rateExamAndParaphrases({
        apiKey,
        sentences,
        examPoints: core.examPoints,
        paraphrases: translated.paraphrases,
        implications: core.implications,
        signal: controller.signal,
        usage,
        notes,
      }),
    ]);
    let grammar = spread(gradedGrammar, MAX_GRAMMAR);
    let vocab = vocabDone.vocab.slice(0, MAX_VOCAB);

    // 검수 직후에 띄워 둔 보충을 여기서 받는다. 어법이 찼으면 기다리지 않는다.
    if (!lite && grammar.length < MIN_GRAMMAR) {
      const at = Date.now();
      const more = await tailRefill;
      const has = new Set(grammar.map((g) => `${g.sentenceIndex}|${g.target.toLowerCase()}`));
      const add = more.grammar.filter((g) => !has.has(`${g.sentenceIndex}|${g.target.toLowerCase()}`));
      if (add.length) notes.push(`어법 ${add.length}개 더 뽑음`);
      grammar = [...grammar, ...add].slice(0, MAX_GRAMMAR);
      lap.push(`어법 보충 ${seconds(at)}초`);
    }
    if (!lite && vocab.length < MIN_VOCAB - 2) {
      const at = Date.now();
      const more = await refillMaterial({
        apiKey,
        baseUser,
        sentences,
        grammar: [],
        vocab,
        dropped: {
          targets: [],
          words: vocabDone.picked.filter((v) => !vocab.some((k) => k.surface === v.surface)).map((v) => v.surface),
        },
        need: { grammar: 0, vocab: MIN_VOCAB - vocab.length },
        signal: controller.signal,
        usage,
      });
      if (more.vocab.length) notes.push(`낱말 ${more.vocab.length}개 더 뽑음`);
      vocab = [...vocab, ...more.vocab].slice(0, MAX_VOCAB);
      lap.push(`낱말 보충 ${seconds(at)}초`);
    }

    notes.unshift(`전체 ${seconds(startedAt)}초(${lap.join(", ")})`);

    // 표시 기호가 본문에 나오는 차례대로 붙도록, 마지막에 모두 지문 순서로 줄 세운다.
    const ordered = {
      grammar: sortOnePageMarks(grammar, sentences, (g) => ({
        sentenceIndex: g.sentenceIndex,
        surface: g.target,
      })),
      vocab: sortOnePageMarks(vocab, sentences, (v) => ({
        sentenceIndex: v.sentenceIndex,
        surface: v.surface,
      })),
      references: sortOnePageMarks(referenceDone.references, sentences, (r) => ({
        sentenceIndex: r.sentenceIndex,
        surface: r.surface,
        occurrence: r.occurrence,
      })),
      paraphrases: sortOnePageMarks(gradedExam.paraphrases, sentences, (p) => ({
        sentenceIndex: p.sentenceIndex,
        surface: p.expression,
      })),
      implications: sortOnePageMarks(gradedExam.implications, sentences, (m) => ({
        sentenceIndex: m.sentenceIndex,
        surface: m.expression,
      })),
      // 삽입·순서 표시는 문장 앞에 붙으므로 그 문장의 맨 앞으로 본다.
      examPoints: sortOnePageMarks(gradedExam.examPoints, sentences, (e) => ({
        sentenceIndex: e.sentenceIndex,
        surface: e.kind === "blank" ? e.target : "",
        atSentenceStart: e.kind === "insert" || e.kind === "order",
      })),
    };

    return {
      content: {
        topicKo: core.topicKo,
        titleEn: core.titleEn,
        summaryEn: core.summaryEn,
        summaryKeywords: core.summaryKeywords,
        summaryVerbs: core.summaryVerbs,
        summaryKo: translated.summaryKo,
        flow: core.flow,
        tf: core.tf,
        keySentenceIndexes: core.keySentenceIndexes,
        ...ordered,
        version: ONE_PAGE_CONTENT_VERSION,
        sourceHash: onePageSourceHash(sentences),
        createdAt: new Date().toISOString(),
      },
      model,
      usage,
      notes,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("1장 자료를 만드는 시간이 초과되었습니다. 다시 시도해 주세요.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
