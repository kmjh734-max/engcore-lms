import {
  buildStudentRecordChatBody,
  isGpt5FamilyModel,
  isModelUnavailableError,
  isUnsupportedParameterError,
  isUnsupportedTemperatureError,
  studentRecordModelSupportsTemperature,
  STUDENT_RECORD_MODEL_FALLBACK,
  STUDENT_RECORD_MODEL_PRIMARY,
} from "@/lib/student-records/model";
import type { NeltGrowthAnalysis } from "@/lib/nelt/compare/types";
import {
  buildKoreanNameForms,
  joinKoreanList,
  normalizeStudentNamesInMessage,
} from "@/lib/nelt/korean-name";
import { ACADEMY_NAME } from "@/lib/branding";
import { openAiFetch } from "@/lib/ai-usage/openai-fetch";

export type NeltParentMessageTone = "standard" | "short" | "detail";

export type NeltParentMessageMeta = {
  parentTitle?: string;
  senderRole?: string;
  senderName?: string;
  enrollmentDate?: string | null;
  studyDuration?: string | null;
  reportUrl?: string | null;
  academyName?: string;
  variationSeed?: number | string | null;
  /** 0~(VERSIONS-1) — 문구 다시 만들기마다 순환 */
  messageVersion?: number | null;
  /** 직전 문구 — 비슷하게 쓰지 않도록 */
  previousMessage?: string | null;
};

/** 문구 다시 만들기용 버전 (사실 동일, 구성·문장만 다르게) */
export const NELT_MESSAGE_VERSIONS = [
  {
    id: "warm-journey",
    label: "여정형",
    focus:
      "학원과 함께한 시간·성장 여정을 먼저 이야기한 뒤 NELT와 성장 내용을 이어서 쓴다. 문단 시작을 기간/추억으로.",
  },
  {
    id: "growth-first",
    label: "성장강조형",
    focus:
      "인사 직후 가장 잘 성장한 영역·수치를 먼저 구체적으로 말하고, 그다음 NELT 실시 이유와 칭찬을 쓴다.",
  },
  {
    id: "praise-home",
    label: "칭찬권유형",
    focus:
      "집에서도 칭찬해 달라는 말을 자연스럽게 살리고, 성장 사실은 문장 속에 녹여 쓴다. 다소 다정한 톤.",
  },
  {
    id: "next-plan",
    label: "지도계획형",
    focus:
      "성장은 간결히 2개만, 보완·앞으로 수업에서 챙길 계획을 구체적 항목으로 조금 더 자세히 쓴다.",
  },
  {
    id: "compare-flow",
    label: "비교흐름형",
    focus:
      "이전 NELT와 이번을 비교하는 흐름으로 쓴다. ‘이전에는… 지금은…’ 식의 자연스러운 대비를 중심으로.",
  },
  {
    id: "short-warm",
    label: "담백형",
    focus:
      "문장을 짧게, 문단을 조금 덜 쓴다. 군더더기 없이 핵심만. 그래도 따뜻함은 유지.",
  },
] as const;

export const NELT_MESSAGE_VERSION_COUNT = NELT_MESSAGE_VERSIONS.length;

export function resolveNeltMessageVersion(
  version: number | null | undefined,
  seed?: number | string | null
): (typeof NELT_MESSAGE_VERSIONS)[number] & { index: number } {
  let index: number;
  if (typeof version === "number" && Number.isFinite(version)) {
    index =
      ((Math.floor(version) % NELT_MESSAGE_VERSION_COUNT) +
        NELT_MESSAGE_VERSION_COUNT) %
      NELT_MESSAGE_VERSION_COUNT;
  } else {
    index = variationIndex(seed, NELT_MESSAGE_VERSION_COUNT);
  }
  return { ...NELT_MESSAGE_VERSIONS[index]!, index };
}

function formatDateDots(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.replaceAll("-", ".");
}

/** 수강 시작일 → "1년 7개월" 형식. 없으면 null */
export function formatStudyDuration(
  enrollmentDate: string | null | undefined,
  asOf: Date = new Date()
): string | null {
  if (!enrollmentDate) return null;
  const start = new Date(`${enrollmentDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  let months =
    (asOf.getFullYear() - start.getFullYear()) * 12 +
    (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) months -= 1;
  if (months < 1) return "한 달";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem}개월`;
  if (rem === 0) return `${years}년`;
  return `${years}년 ${rem}개월`;
}

function resolveMeta(
  analysis: NeltGrowthAnalysis,
  meta: NeltParentMessageMeta = {}
) {
  const academyName = meta.academyName?.trim() || ACADEMY_NAME;
  const parentTitle = (meta.parentTitle?.trim() || "어머님").replace(
    /^학부모\s*/,
    ""
  );
  const senderRole = meta.senderRole?.trim() || "";
  const senderName = meta.senderName?.trim() || "";
  const enrollmentDate = meta.enrollmentDate?.trim() || null;
  const studyDuration =
    meta.studyDuration?.trim() ||
    formatStudyDuration(enrollmentDate) ||
    null;
  const reportUrl = meta.reportUrl?.trim() || null;
  const latestTestDate =
    formatDateDots(analysis.end.testDate) ||
    formatDateDots(analysis.start.testDate);
  const names = buildKoreanNameForms(analysis.studentName.trim());
  const version = resolveNeltMessageVersion(
    meta.messageVersion,
    meta.variationSeed
  );
  return {
    academyName,
    parentTitle,
    senderRole,
    senderName,
    enrollmentDate,
    studyDuration,
    reportUrl,
    latestTestDate,
    names,
    variationSeed: meta.variationSeed ?? null,
    previousMessage: meta.previousMessage?.trim() || null,
    version,
  };
}

export const NELT_PARENT_MESSAGE_TITLE = "[NELT 성장 리포트]";

/** 카카오톡 본문 맨 앞에 제목 보장 */
export function ensureNeltMessageTitle(message: string): string {
  const t = message.trim();
  if (!t) return NELT_PARENT_MESSAGE_TITLE;
  if (
    t.startsWith(NELT_PARENT_MESSAGE_TITLE) ||
    /^\[NELT[^\]]*\]/.test(t)
  ) {
    return t;
  }
  return `${NELT_PARENT_MESSAGE_TITLE}\n\n${t}`;
}

function greetingLine(m: ReturnType<typeof resolveMeta>): string {
  const intro =
    m.senderRole && m.senderName
      ? `${m.academyName} ${m.senderRole} ${m.senderName}입니다.`
      : m.senderName
        ? `${m.academyName} ${m.senderName}입니다.`
        : `${m.academyName}입니다.`;
  // parentAddressName 완성형 그대로 (지환이 / 윤우)
  return `안녕하세요~ ${m.names.parentAddressName} ${m.parentTitle} :)\n${intro}`;
}

function growthFacts(analysis: NeltGrowthAnalysis): string[] {
  const out: string[] = [];
  const v = analysis.vocabularyGrowth;
  if (v.sizeDelta != null && v.sizeDelta > 0) {
    out.push(
      `처음 약 ${v.beforeSize?.toLocaleString()}단어 수준이었던 어휘량이 현재는 약 ${v.afterSize?.toLocaleString()}단어 수준까지 늘었습니다`
    );
  }
  if (v.requiredPctDelta != null && v.requiredPctDelta > 0) {
    out.push(
      `초등 필수 어휘 이해도도 ${v.beforeRequiredPct}%에서 ${v.afterRequiredPct}%로 올랐습니다`
    );
  }
  for (const d of analysis.domainGrowth) {
    if (
      (d.status === "major_growth" || d.status === "growth") &&
      d.levelDelta != null &&
      d.levelDelta > 0.4 &&
      d.beforeLevel &&
      d.afterLevel &&
      d.beforeLevel !== d.afterLevel
    ) {
      out.push(
        `${d.label}도 ${d.beforeLevel}에서 ${d.afterLevel} 수준까지 꾸준히 성장했습니다`
      );
    }
  }
  if (
    analysis.start.overallLevel &&
    analysis.end.overallLevel &&
    analysis.start.overallLevel !== analysis.end.overallLevel
  ) {
    out.unshift(
      `종합 레벨이 ${analysis.start.overallLevel}에서 ${analysis.end.overallLevel}로 올랐습니다`
    );
  }
  return out.slice(0, 3);
}

function mainGrowthAreas(analysis: NeltGrowthAnalysis): string[] {
  return analysis.domainGrowth
    .filter(
      (d) =>
        d.status === "major_growth" ||
        d.status === "growth" ||
        d.status === "advanced_challenge"
    )
    .map((d) => d.label)
    .slice(0, 3);
}

function focusAreas(analysis: NeltGrowthAnalysis): string[] {
  const focus = analysis.domainGrowth
    .filter((d) => d.status === "focus_needed")
    .map((d) => d.label);
  if (focus.length > 0) return focus.slice(0, 2);
  return analysis.domainGrowth
    .filter((d) => d.status === "maintained")
    .map((d) => d.label)
    .slice(0, 1);
}

function learningPlanLines(analysis: NeltGrowthAnalysis): string[] {
  const labels = focusAreas(analysis);
  const lines: string[] = [];
  for (const label of labels) {
    const d = analysis.domainGrowth.find((x) => x.label === label);
    if (d) lines.push(analysis.learningPlan[d.domain].nextGoal);
  }
  if (lines.length > 0) return lines.slice(0, 2);
  return [analysis.nextGoalsNarrative].filter(Boolean).slice(0, 2);
}

function variationIndex(
  seed: number | string | null | undefined,
  mod: number
): number {
  if (mod <= 0) return 0;
  if (seed == null || seed === "") {
    return Math.floor(Math.random() * mod);
  }
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** 규칙 기반 폴백 — 버전별로 문단 구성이 다르게 */
export function buildNeltParentMessageFallback(
  analysis: NeltGrowthAnalysis,
  academyNameOrMeta: string | NeltParentMessageMeta = ACADEMY_NAME,
  tone: NeltParentMessageTone = "standard"
): string {
  const metaIn: NeltParentMessageMeta =
    typeof academyNameOrMeta === "string"
      ? { academyName: academyNameOrMeta }
      : academyNameOrMeta;
  const m = resolveMeta(analysis, metaIn);
  const { studentSubjectName, studentTopicName } = m.names;
  const vi = m.version.index;
  const facts = growthFacts(analysis);
  const areas = joinKoreanList(mainGrowthAreas(analysis));
  const focus = focusAreas(analysis);
  const plans = learningPlanLines(analysis);
  const factLimit =
    tone === "short" || vi === 5 ? 1 : tone === "detail" || vi === 3 ? 3 : 2;

  const periodLine = m.studyDuration
    ? [
        `${studentSubjectName} ${m.academyName}과 함께한 지도\n어느덧 ${m.studyDuration}이 되었습니다.`,
        `${studentSubjectName} ${m.academyName}에서 영어 공부를 시작한 지도\n벌써 ${m.studyDuration}이 되었네요.`,
        `처음 수업을 시작했을 때가 엊그제 같은데,\n벌써 ${m.academyName}과 함께 공부한 지 ${m.studyDuration}이 되어갑니다.`,
        `${studentSubjectName} ${m.academyName}에서 ${m.studyDuration} 동안 영어를 배워 오고 있어요.`,
        `${m.academyName}과 함께한 지 ${m.studyDuration}, ${studentSubjectName} 많이 달라졌습니다.`,
        `${studentSubjectName} ${m.academyName}에서 영어를 공부한 지 ${m.studyDuration} 됐어요.`,
      ][vi]!
    : [
        `${studentSubjectName} ${m.academyName}에서 꾸준히 영어 공부를\n이어오고 있는데요.`,
        `${studentSubjectName} ${m.academyName}에서 영어 실력을 차근차근 쌓아 오고 있습니다.`,
        `${m.academyName} 수업에서 ${studentTopicName} 점점 자신감을 보이는 편이에요.`,
        `${studentSubjectName} ${m.academyName}에서 영어 공부를 잘 따라오고 있어요.`,
        `${studentTopicName} 평소 수업에서 조금씩 성장하는 모습이 보였습니다.`,
        `${studentSubjectName} ${m.academyName}에서 영어를 꾸준히 배우고 있어요.`,
      ][vi]!;

  const neltWhy = [
    "그동안 배운 내용이 얼마나 잘 쌓였는지,\n또 어떤 부분이 성장했는지 함께 확인해 보기 위해\n이번에 NELT를 진행했습니다.",
    "지금까지의 학습 성과를 조금 더 객관적으로 확인해 보고자\nNELT를 실시해 보았습니다.",
    "성장한 부분을 학부모님과 함께 나눠 보고 싶어\nNELT 결과를 정리해 보았습니다.",
    "수업에서 느낀 변화를 숫자로도 짚어 보기 위해\n이번에 NELT를 진행했습니다.",
    analysis.attemptCount >= 2
      ? "이전 NELT와 이번 결과를 나란히 놓고 보면\n변화가 더 분명해 보여서 리포트로 묶어 드렸습니다."
      : "NELT 결과로 현재 실력을 한번 정리해 보았습니다.",
    "NELT로 현재 위치를 확인하고,\n앞으로 수업에서 챙길 부분을 정리해 드렸어요.",
  ][vi]!;

  const deliver =
    analysis.attemptCount >= 2
      ? [
          "NELT 결과를 이전 평가와 함께 비교해\n성장 리포트로 정리해 보내드립니다.",
          `${analysis.attemptCount}번의 NELT를 모아 성장한 부분 위주로 정리했습니다.`,
          "회차별 결과를 한곳에 모아 리포트로 보내드립니다.",
          "성장 리포트에 영역별 변화를 자세히 적어 두었습니다.",
          "이전과 이번을 비교한 성장 리포트를 보내드립니다.",
          "아래 리포트에 핵심만 정리해 두었습니다.",
        ][vi]!
      : "NELT 결과를 성장 리포트로 정리해 보내드립니다.";

  const growthLead = areas
    ? [
        `이전 결과와 함께 살펴보니 ${areas}에서 특히 좋은 성장이 확인되었습니다.`,
        `가장 눈에 띄는 부분은 ${areas}였습니다.`,
        `${areas}에서 변화가 잘 보여서 먼저 말씀드리고 싶었어요.`,
        `${areas}는 잘 따라오고 있고, 앞으로 다듬을 부분도 함께 정리했습니다.`,
        `이전에는 조금 아쉬웠던 ${areas}가 이번엔 한결 안정적으로 보였습니다.`,
        `${areas}가 좋아졌어요.`,
      ][vi]!
    : "의미 있는 성장이 몇 가지 보였습니다.";

  const praise = [
    `이런 변화는 한 번의 시험을 잘 본 결과라기보다,\n${studentSubjectName} 그동안 수업과 학습을\n꾸준히 따라와 준 결과라고 생각합니다.\n이 부분은 집에서도 충분히 칭찬해 주셔도 좋을 것 같아요.`,
    `그동안 차근차근 노력해 온 부분이 결과에 잘 나타난 것 같아\n저도 기분이 좋았습니다.`,
    `특히 이 부분은 집에서도 많이 칭찬해 주셔도 좋을 것 같아요.\n${studentSubjectName} 스스로도 뿌듯해할 만한 변화입니다.`,
    `${studentSubjectName} 꾸준히 따라와 준 덕분에 이런 결과가 나왔습니다.`,
    `한순간에 나온 점수가 아니라,\n평소 수업에서 쌓인 힘이 결과에 반영된 느낌입니다.`,
    `집에서도 한번 꼭 칭찬해 주세요.`,
  ][vi]!;

  const closing = [
    `앞으로도 ${studentTopicName} 잘하는 부분은 더 자신감을 가질 수 있도록 돕고,\n조금 더 필요한 부분은 수업에서 꼼꼼하게 채워가겠습니다.\n\n리포트를 보시고 궁금하신 부분이 있으시면\n언제든 편하게 말씀해 주세요~\n감사합니다 :)`,
    `${studentTopicName} 강점은 살리고, 부족한 부분은 수업에서 챙기겠습니다.\n궁금한 점 있으시면 편하게 말씀해 주세요. 감사합니다 :)`,
    `가정과 학원이 같이 응원해 주시면 ${studentSubjectName} 더 힘을 낼 거예요.\n리포트 보시고 궁금하신 거 있으면 언제든 연락 주세요~`,
    `앞으로는 필요한 부분을 수업에서 더 구체적으로 연습하겠습니다.\n궁금하신 점 있으시면 편하게 말씀해 주세요.`,
    `비교해 보시면 변화가 더 잘 보이실 거예요.\n궁금한 점 있으시면 언제든 말씀해 주세요. 감사합니다.`,
    `궁금한 점 있으시면 편하게 말씀해 주세요~\n감사합니다 :)`,
  ][vi]!;

  const parts: string[] = [
    NELT_PARENT_MESSAGE_TITLE,
    "",
    greetingLine(m),
    "",
  ];

  // 버전별 문단 순서 다르게
  if (vi === 1) {
    // 성장 먼저
    if (facts.length > 0) {
      parts.push(growthLead);
      parts.push(facts.slice(0, factLimit).join(".\n") + ".");
      parts.push("");
    }
    parts.push(periodLine);
    parts.push("");
    parts.push(neltWhy);
    parts.push("");
    parts.push(deliver);
  } else if (vi === 4) {
    parts.push(periodLine);
    parts.push("");
    parts.push(neltWhy);
    parts.push("");
    parts.push(deliver);
    parts.push("");
    parts.push(growthLead);
    if (facts.length > 0) {
      parts.push(facts.slice(0, factLimit).join(".\n") + ".");
    }
  } else {
    parts.push(periodLine);
    parts.push("");
    parts.push(neltWhy);
    parts.push("");
    parts.push(deliver);
    if (facts.length > 0 || areas) {
      parts.push("");
      parts.push(growthLead);
      if (facts.length > 0) {
        parts.push(facts.slice(0, factLimit).join(".\n") + ".");
      }
    }
  }

  if (tone !== "short" && vi !== 5) {
    parts.push("");
    parts.push(praise);
  } else if (vi === 5 || tone === "short") {
    parts.push("");
    parts.push(praise.split("\n")[0]!);
  }

  if (tone !== "short" && vi !== 5 && (focus.length > 0 || plans.length > 0)) {
    parts.push("");
    if (focus.length > 0) {
      parts.push(
        vi === 3
          ? `${joinKoreanList(focus)}는 앞으로 수업에서 좀 더 다듬을 부분입니다.`
          : `${joinKoreanList(focus)}는 아직 조금 더 연습이 필요해 보입니다.`
      );
    }
    if (plans.length > 0) {
      parts.push(`앞으로는 ${plans[0]!}`);
    } else {
      parts.push(
        "아직 조금 더 연습해야 할 부분은 수업에서 꼼꼼히 채워가겠습니다."
      );
    }
  }

  parts.push("");
  parts.push(
    vi === 5
      ? "자세한 내용은 아래 리포트에서 확인해 주세요."
      : "어휘·문법·듣기·독해가 차수별로 어떻게 변화했는지와\n앞으로의 학습 계획은 아래 리포트에 자세히 정리해 두었습니다."
  );
  if (m.reportUrl) {
    parts.push("");
    parts.push(m.reportUrl);
  }

  parts.push("");
  parts.push(closing);

  const raw = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalizeStudentNamesInMessage(raw, m.names.studentName);
}

const NELT_PARENT_MESSAGE_SYSTEM = `너는 정수학원에서 학부모에게 보내는 카카오톡 안내문을 작성하는 전문 교육 커뮤니케이션 담당자다.

이 글은 광고 문구, 성적표 공지, 보고서가 아니다.
학생을 오랫동안 지도한 원장 또는 영어전임 강사가
학부모에게 직접 안부를 전하며 성장 과정을 설명하는
따뜻하고 자연스러운 카카오톡 메시지여야 한다.

━━━━━━━━━━━━━━━━━━━━
[가장 중요한 원칙]
━━━━━━━━━━━━━━━━━━━━

1. 입력 데이터에 다음 이름 형태가 별도로 제공된다.

- studentName: 학생 원래 이름
- parentAddressName: 학부모 호칭 앞에 사용할 이름
- studentSubjectName: “지환이가”, “윤우가”처럼 조사가 완성된 형태
- studentTopicName: “지환이는”, “윤우는”처럼 조사가 완성된 형태

이 값들은 코드에서 이미 한국어 조사에 맞게 완성된 문자열이다.

절대로 값을 수정하거나 다시 조사를 붙이지 않는다.

예:

parentAddressName이 “지환이”라면:
“안녕하세요~ 지환이 어머님 :)”

studentSubjectName이 “지환이가”라면:
“지환이가 정수학원과 함께한 지도 어느덧 1년이 되었습니다.”

다음처럼 쓰면 안 된다.

- 지환가
- 지환이이가
- 지환이가가
- 윤우이가
- 서윤가
- 지환 학생가
- {studentName}가

이름 뒤에 필요한 조사는 직접 판단하거나 생성하지 않고,
반드시 입력된 완성형 문자열을 그대로 사용한다.

2. 안내문을 작성한 뒤 내부적으로 다음 항목을 검토한다.

- 학생 이름이 정확한가?
- 이름 뒤의 조사가 자연스러운가?
- “지환가”와 같은 잘못된 표현이 없는가?
- 학부모에게 직접 말하는 자연스러운 문장인가?
- 공문처럼 딱딱한 표현이 없는가?
- 입력되지 않은 사실을 임의로 만들지 않았는가?

검토 결과 문제가 있으면 스스로 수정한 뒤
완성된 안내문만 출력한다.

━━━━━━━━━━━━━━━━━━━━
[말투]
━━━━━━━━━━━━━━━━━━━━

정수학원 원장 또는 영어전임 강사가
평소 학부모에게 카카오톡을 보내는 말투로 작성한다.

전체적인 분위기는 다음과 같다.

- 따뜻하다.
- 학생에 대한 애정이 느껴진다.
- 학부모에게 직접 이야기하듯 자연스럽다.
- 지나치게 격식을 차리지 않는다.
- 그렇다고 가볍거나 장난스럽지는 않다.
- 설명은 구체적이지만 보고서처럼 쓰지 않는다.
- AI가 작성한 티가 나지 않아야 한다.

첫 문장은 반드시 다음 형식을 사용한다. (맨 위에 [NELT 성장 리포트] 단독 줄 후)

안녕하세요~ {parentAddressName} {parentTitle} :)
정수학원 {senderRole} {senderName}입니다.

senderRole/senderName이 없으면 "정수학원입니다."로 쓴다.
parentTitle이 아버님이면 어머님을 쓰지 않는다.

“안녕하십니까”, “귀 자녀”, “송부드립니다”,
“다음과 같이 안내드립니다”와 같은 공문체는 사용하지 않는다.

━━━━━━━━━━━━━━━━━━━━
[자연스러운 문장 방식]
━━━━━━━━━━━━━━━━━━━━

다음과 같이 말하듯이 작성한다.

- {studentSubjectName} 정수학원과 함께한 지도 어느덧 1년이 되었습니다.
- {studentSubjectName} 처음 영어 수업을 시작했을 때와 비교하면 정말 많이 성장했는데요.
- 그동안 배운 내용이 얼마나 잘 쌓였는지 확인해 보기 위해 이번에 NELT를 진행했습니다.
- 이전 결과와 함께 살펴보니 어휘와 독해에서 특히 좋은 성장이 확인되었습니다.
- 그동안 꾸준히 수업을 따라와 준 결과가 잘 나타난 것 같습니다.
- 이 부분은 집에서도 충분히 칭찬해 주셔도 좋을 것 같아요.
- 아직 조금 더 연습해야 할 부분은 수업에서 꼼꼼히 채워가겠습니다.
- 자세한 내용은 아래 성장 리포트에서 확인해 주세요.

다음처럼 지나치게 인위적이거나 번역체인 문장은 사용하지 않는다.

- 시간이 이렇게 흘렀습니다.
- 성장 여정이 가시적인 성과로 나타났습니다.
- 유의미한 향상세가 관찰되었습니다.
- 분석 결과 두드러진 성취가 확인되었습니다.
- 학습 역량의 고도화가 이루어졌습니다.
- 해당 영역에 대한 보완이 요구됩니다.
- 지속적인 모니터링을 실시하겠습니다.
- 매우 기특한 결과라 사료됩니다.

━━━━━━━━━━━━━━━━━━━━
[학생과 함께한 기간]
━━━━━━━━━━━━━━━━━━━━

학원 수강 기간(studyDuration)이 제공되면 다음처럼 자연스럽게 언급한다.

좋은 예:
“{studentSubjectName} 정수학원과 함께한 지도 어느덧 1년 6개월이 되었습니다.”
“{studentSubjectName} 정수학원에서 영어 공부를 시작한 지도 벌써 1년이 훌쩍 지났네요.”

나쁜 예:
“정수학원 수강 기간은 1년 6개월입니다.”
“본원과 함께한 시간이 18개월 경과했습니다.”

수강 기간 정보가 없으면 기간을 만들어내지 않는다.
이 경우:
“{studentSubjectName} 정수학원에서 꾸준히 영어 공부를 이어오고 있는데요.”

━━━━━━━━━━━━━━━━━━━━
[NELT 실시 이유]
━━━━━━━━━━━━━━━━━━━━

NELT를 단순히 시험을 치렀다고 공지하지 않는다.
학생이 그동안 배운 내용과 성장 과정을 확인하기 위해 실시했다는 흐름으로 작성한다.

━━━━━━━━━━━━━━━━━━━━
[성장 내용]
━━━━━━━━━━━━━━━━━━━━

성장 내용은 가장 의미 있는 2~3개만 선택한다.
수치를 나열하는 보고서처럼 작성하지 말고 문장 속에 자연스럽게 넣는다.
성장 내용 뒤에는 학생의 노력을 인정하는 문장을 넣는다.
태도·성실성 데이터가 없으면 ‘항상 성실했다’ 등을 만들지 않는다.
학년 수준이 실제로 오른 경우만 성장이라고 말한다. 난이도만 넓어진 경우는 “더 넓은 범위에 도전”으로 설명한다.

━━━━━━━━━━━━━━━━━━━━
[보완할 부분]
━━━━━━━━━━━━━━━━━━━━

약점을 평가하듯 말하지 않는다.
다음 단계에서 학원이 어떻게 가르칠지를 중심으로 작성한다.
보완 내용은 최대 1~2개, 반드시 구체적 지도 계획으로 이어지게 한다.

금지: 문법 실력이 부족합니다 / 성적이 하락했습니다 / 기초가 약합니다 / 학습 결손 / 보완이 요구됩니다 / 문제점이 확인되었습니다 / 판정 수준

━━━━━━━━━━━━━━━━━━━━
[리포트 링크]
━━━━━━━━━━━━━━━━━━━━

“어휘·문법·듣기·독해가 차수별로 어떻게 변화했는지와 앞으로의 학습 계획은 아래 리포트에 자세히 정리해 두었습니다.”
다음 줄에 reportUrl이 있을 때만 링크만 표시. 없으면 URL을 지어내지 말 것.

━━━━━━━━━━━━━━━━━━━━
[마무리]
━━━━━━━━━━━━━━━━━━━━

“앞으로도 {studentTopicName} 잘하는 부분은 더 자신감을 가질 수 있도록 돕고,
조금 더 필요한 부분은 수업에서 꼼꼼하게 채워가겠습니다.

리포트를 보시고 궁금하신 부분이 있으시면
언제든 편하게 말씀해 주세요~
감사합니다 :)”

━━━━━━━━━━━━━━━━━━━━
[버전 다양성 — 매우 중요]
━━━━━━━━━━━━━━━━━━━━

입력 JSON에 messageVersion, versionId, versionFocus가 있다.
같은 사실을 쓰되, 문장·문단 순서·강조점을 versionFocus에 맞게 완전히 다르게 쓴다.
previousMessage가 있으면 그 글과 문장·시작·연결어를 반복하지 않는다.
“문구 다시 만들기”마다 다른 버전의 카톡이어야 한다. 템플릿 문장을 복사하지 말 것.

━━━━━━━━━━━━━━━━━━━━
[분량과 형식]
━━━━━━━━━━━━━━━━━━━━

- 맨 첫 줄 단독: [NELT 성장 리포트]
- 공백 포함 550~850자 (tone이 short이거나 versionId가 short-warm이면 400~550자, detail이면 650~900자)
- 6~8개의 짧은 문단
- 한 문단은 1~3문장
- 목록보다 자연스럽게 이어지는 카카오톡 편지 형식
- 이모티콘은 전체 1~2개만 사용
- 안내문 본문만 출력
- 제목 외 설명, 분석 과정, 검토 결과는 출력하지 않음
- 입력 JSON 사실만 사용. 없는 기간·성장을 만들지 말 것.`;

function getNeltParentMessageModels(): string[] {
  const configured = process.env.OPENAI_MODEL_NELT?.trim();
  const list = [
    configured,
    STUDENT_RECORD_MODEL_PRIMARY,
    "gpt-5.5",
    STUDENT_RECORD_MODEL_FALLBACK,
    "gpt-5",
  ].filter((m): m is string => Boolean(m && m.trim()));
  return [...new Set(list)];
}

export async function generateNeltParentMessageAi(
  analysis: NeltGrowthAnalysis,
  academyNameOrMeta: string | NeltParentMessageMeta = ACADEMY_NAME,
  tone: NeltParentMessageTone = "standard",
  /** 넘기면 이 신호로 모든 모델·재시도를 끊는다(부르는 라우트 시간 한도 안에서 끝내려고) */
  signal?: AbortSignal
): Promise<
  | {
      ok: true;
      message: string;
      model: string;
      versionIndex: number;
      versionLabel: string;
    }
  | { ok: false; message: string }
> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, message: "OPENAI_API_KEY가 없습니다." };
  }

  const metaIn: NeltParentMessageMeta =
    typeof academyNameOrMeta === "string"
      ? { academyName: academyNameOrMeta }
      : academyNameOrMeta;
  const m = resolveMeta(analysis, metaIn);
  const seed =
    m.variationSeed != null && m.variationSeed !== ""
      ? String(m.variationSeed)
      : String(Date.now());

  const facts = {
    tone,
    variationSeed: seed,
    messageVersion: m.version.index,
    versionId: m.version.id,
    versionLabel: m.version.label,
    versionFocus: m.version.focus,
    previousMessage: m.previousMessage
      ? m.previousMessage.slice(0, 900)
      : null,
    studentName: m.names.studentName,
    parentAddressName: m.names.parentAddressName,
    studentSubjectName: m.names.studentSubjectName,
    studentTopicName: m.names.studentTopicName,
    parentTitle: m.parentTitle,
    senderRole: m.senderRole || null,
    senderName: m.senderName || null,
    academyName: m.academyName,
    studyDuration: m.studyDuration,
    attemptCount: analysis.attemptCount,
    latestTestDate: m.latestTestDate,
    reportUrl: m.reportUrl,
    mainGrowthAreas: mainGrowthAreas(analysis),
    growthHighlights: growthFacts(analysis),
    focusAreas: focusAreas(analysis),
    learningPlan: learningPlanLines(analysis),
    overall: {
      from: analysis.start.overallLevel,
      to: analysis.end.overallLevel,
      percentileFrom: analysis.start.overallPercentile,
      percentileTo: analysis.end.overallPercentile,
      percentileImproved:
        analysis.start.overallPercentile != null &&
        analysis.end.overallPercentile != null &&
        analysis.end.overallPercentile < analysis.start.overallPercentile,
    },
    domains: analysis.domainGrowth.map((d) => ({
      label: d.label,
      status: d.status,
      beforeLevel: d.beforeLevel,
      afterLevel: d.afterLevel,
      difficultyUp: d.difficultyUp,
      beforeDifficulty: d.beforeDifficulty,
      afterDifficulty: d.afterDifficulty,
    })),
    vocabulary: analysis.vocabularyGrowth,
  };

  const user = `아래 JSON만 근거로 학부모 카카오톡 안내문을 작성하세요.

이번 요청은 버전 ${m.version.index + 1}/${NELT_MESSAGE_VERSION_COUNT} (${m.version.label}) 입니다.
versionFocus를 반드시 반영해, previousMessage와 다른 문장·다른 문단 순서로 쓰세요.

이름 규칙 (절대):
- 인사: parentAddressName + parentTitle 그대로
- 본문 주어: studentSubjectName 그대로
- 본문 주제: studentTopicName 그대로
- 조사를 절대 추가·수정·재조합하지 마세요.

작성 후 이름·조사·공문체·이전 문구 중복을 스스로 검토하고, 완성된 안내문만 출력하세요.

${JSON.stringify(facts, null, 2)}`;

  const candidates = getNeltParentMessageModels();
  let lastErr = "AI 생성 실패";

  for (const model of candidates) {
    try {
      // gpt-5.x 는 temperature 미지원 — 넣지 않음
      let includeTemperature = studentRecordModelSupportsTemperature(model);
      let includeReasoningEffort = isGpt5FamilyModel(model);
      for (let attempt = 0; attempt < 4; attempt++) {
        const body = buildStudentRecordChatBody(
          model,
          NELT_PARENT_MESSAGE_SYSTEM,
          user,
          {
            includeTemperature,
            includeReasoningEffort,
          }
        );
        if (includeTemperature) {
          body.temperature = 0.85;
        } else {
          delete body.temperature;
        }
        if (isGpt5FamilyModel(model)) {
          body.max_completion_tokens = 4500;
          if (includeReasoningEffort) body.reasoning_effort = "low";
          else delete body.reasoning_effort;
        }

        if (signal?.aborted) return { ok: false, message: "시간 초과" };
        const res = await openAiFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          ...(signal ? { signal } : {}),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
          if (includeTemperature && isUnsupportedTemperatureError(text)) {
            includeTemperature = false;
            continue;
          }
          if (
            includeReasoningEffort &&
            isUnsupportedParameterError(text, "reasoning_effort")
          ) {
            includeReasoningEffort = false;
            continue;
          }
          if (isModelUnavailableError(res.status, text)) {
            lastErr = text.slice(0, 200);
            break;
          }
          lastErr = text.slice(0, 200);
          break;
        }
        const json = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content?.trim();
        if (!content) {
          lastErr = "빈 응답";
          if (includeReasoningEffort) {
            includeReasoningEffort = false;
            continue;
          }
          break;
        }
        const normalized = normalizeStudentNamesInMessage(
          ensureNeltMessageTitle(content),
          m.names.studentName
        );
        return {
          ok: true,
          message: normalized,
          model,
          versionIndex: m.version.index,
          versionLabel: m.version.label,
        };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "요청 실패";
    }
  }

  return { ok: false, message: lastErr };
}

/** 공유 링크를 안내문 본문에 자연스럽게 붙이거나 교체 */
export function attachReportUrlToMessage(
  message: string,
  reportUrl: string
): string {
  const url = reportUrl.trim();
  const base = ensureNeltMessageTitle(message);
  if (!url) return base;
  if (base.includes(url)) return base;
  if (/https?:\/\/\S+/i.test(base)) {
    return base.replace(/https?:\/\/\S+/gi, url);
  }
  return `${base}\n\n어휘·문법·듣기·독해가 차수별로 어떻게 변화했는지와\n앞으로의 학습 계획은 아래 리포트에 자세히 정리해 두었습니다.\n\n${url}`;
}
