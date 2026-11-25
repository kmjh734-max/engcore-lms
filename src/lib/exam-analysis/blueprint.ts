import { findOptionByKey } from "@/lib/question-generator/question-types";
import type { BlueprintSlot } from "@/lib/question-generator/types";
import { typeNameFromKey, type ExamItemRow, type ExamLevel } from "@/lib/exam-analysis/types";

/**
 * 분석한 시험지 → 동형모의고사 설계도.
 * 문항마다 변형문제 유형(선택지 key)·난이도·배점을 정하고, 같은 지문에 달린 문항끼리 묶는다.
 * 변형문제로 아직 못 만드는 유형은 가장 가까운 유형으로 대신하고 표시한다.
 */

export type MockSlot = BlueprintSlot & {
  /** 원래 시험지 유형 이름 */
  sourceType: string;
  /** 만들 유형 이름 */
  typeLabel: string;
  /** 비슷한 유형으로 대신했는가 */
  substituted: boolean;
  /** 같은 지문 묶음 번호 */
  group: number;
  /** 원래 시험지가 이 문항 지문을 바꿔 써서 냈는가(원문 대조) — 「지문 바꿔 쓰기」 기본값을 정한다 */
  passageRewritten?: boolean;
  /** 원래 시험지 이 문항 지문이 교과서였는지 모의고사·외부였는지 — 지문 배정 비율을 맞춘다 */
  sourceKind?: "textbook" | "mock" | null;
  /** 원래 문항 정답이 본문 그대로/바꿔 말함 — 설계도 화면에 보인다 */
  answerStyle?: "verbatim" | "paraphrase" | "partial" | null;
};

type Pick = { key: string; substituted?: boolean };

/** 문항표 유형 이름 → 변형문제 유형. 상이면 상 버전, 아니면 하 버전을 고른다 */
function pickByName(name: string, level: ExamLevel, isSubjective: boolean): Pick {
  const [plain, langPart] = name.split(" · ");
  const lang = langPart?.includes("한글") ? "ko" : "en";
  const hi = level === "상" ? "high" : "low";
  const table: Record<string, Pick> = {
    주제: { key: `topic:${lang}:${hi}:주제추론` },
    제목: { key: `title:${lang}:${hi}:제목추론` },
    요지: { key: lang === "en" ? "summary_mcq:en:default:요지추론" : `summary_mcq:ko:${hi}:요지추론` },
    주장: { key: `summary_mcq:ko:${hi}:요지추론`, substituted: true },
    목적: { key: "underlined_inference:en:default:목적추론" },
    "심경·분위기": { key: "underlined_inference:en:default:심경추론" },
    "내용 일치": { key: `content_true:${lang}:${hi}:내용일치` },
    "내용 불일치": { key: `content_false:${lang}:${hi}:내용불일치` },
    "일치 개수": { key: `content_count:${lang}:${hi}:일치개수` },
    // 객관식 지칭은 변형문제에 없어 밑줄 의미로(내용 일치보다 가깝다), 서답형은 지칭 서술
    "지칭 대상": isSubjective ? { key: "writing:na:default:지칭대명사서술" } : { key: "underlined_inference:en:default:함축의미추론", substituted: true },
    "빈칸 추론": { key: `sentence_blank:en:${hi}:빈칸추론` },
    "순서 배열": { key: `order:na:${hi}:순서추론` },
    "문장 삽입": { key: `sentence_insertion:na:${hi}:문장삽입` },
    "무관한 문장": { key: `irrelevant_sentence:na:${hi}:무관한문장` },
    "밑줄 의미": { key: "underlined_inference:en:default:함축의미추론" },
    // 요약문 완성 객관식을 따로 만든다(윌링 2026-11-23 「객관식 요약문이 없다」)
    "요약문 완성": { key: level === "상" ? "sentence_blank:en:high:요약완성AB" : "sentence_blank:en:mid:요약완성AB" },
    연결어: { key: "sentence_blank:en:default:연결어빈칸" },
    "어법 판단": { key: "grammar:na:default:어법추론" },
    "어법 (개수)": { key: "grammar:na:default:어법개수" },
    "어휘 판단": { key: "vocabulary:na:default:어휘추론" },
    "어휘 (개수)": { key: "vocabulary:na:default:어휘개수" },
    영영풀이: { key: "vocabulary:na:default:어휘추론", substituted: true },
    "조건 영작(배열)": { key: level === "하" ? "writing:na:default:제시어배열기본" : "writing:na:default:제시어배열어형변화" },
    "요약문 영작": { key: "summary_short:na:default:요약문빈칸영작" },
    "어법 오류 수정": { key: level === "상" ? "grammar:na:default:어법오류수정3" : "grammar:na:default:어법오류수정2" },
    "우리말 조건 영작": { key: isSubjective ? "writing:na:default:문법조건영작" : "writing:na:default:제시어배열단어추가", substituted: true },
    "빈칸 영작": { key: "summary_short:na:default:요약문빈칸2단어", substituted: true },
    "본문 찾아 쓰기": { key: "summary_short:na:default:요약문빈칸3단어", substituted: true },
    "요약표 수정": { key: "summary_short:na:default:요약표빈칸단어", substituted: true },
    "의미 설명": { key: "writing:na:default:특정표현의미서술" },
    "제목 쓰기": { key: "writing:na:default:주제문작성", substituted: true },
    "주제 쓰기": { key: "writing:na:default:주제문작성" },
    "답할 수 있는 질문": { key: "sentence_blank:en:default:답변가능개수" },
    "개념 적용": { key: "sentence_blank:en:default:사례분류" },
    "사례 선택": { key: "sentence_blank:en:default:사례분류" },
  };
  const nm = plain?.trim() ?? "";
  const hit = table[nm] ?? table[NAME_ALIAS[nm] ?? ""] ?? table[NAME_ALIAS[nm.replace(/\s+/g, "")] ?? ""];
  if (hit) return hit;
  return isSubjective
    ? { key: "writing:na:default:제시어배열어형변화", substituted: true }
    : { key: `content_true:en:${hi}:내용일치`, substituted: true };
}

/** 분석이 준 key가 그대로 쓸 수 있으면 난이도에 맞는 버전으로 바꿔 쓴다 */
function pickByKey(typeKey: string, level: ExamLevel): Pick | null {
  if (!findOptionByKey(typeKey)) return null;
  const [base, lang, diff, code] = typeKey.split(":");
  if (diff === "low" || diff === "high") {
    const want = `${base}:${lang}:${level === "상" ? "high" : "low"}:${code}`;
    if (findOptionByKey(want)) return { key: want };
  }
  return { key: typeKey };
}

/**
 * 발문을 보고 유형을 바로잡는다 — 분석이 준 유형 키·이름보다 먼저(선생님 2026-11-24 「올린 시험지 유형을 제대로 반영」).
 * 올라온 829문항 대조: 「한 문장으로 요약 … (A), (B)」 50문항이 「요지(영)」 키를 받아 동형에서 영어 요지 다섯 문장 고르기로
 * 바뀌었다. 「답할 수 있는 질문」「예시로 적절한」「가리키는」도 이름이 표와 달라 내용 일치로 대신됐다.
 */
function pickByStem(it: ExamItemRow): Pick | null {
  const stem = String(it.stem ?? "").replace(/\s+/g, " ");
  const hi = it.level === "상" ? "high" : "low";
  if (!stem) return null;
  if (!it.is_subjective) {
    // 요약문 완성(객관식): 한 문장으로 요약 + 빈칸 (A)(B)
    if (/요약/.test(stem) && /\(A\)|빈칸/.test(stem))
      return { key: it.level === "상" ? "sentence_blank:en:high:요약완성AB" : "sentence_blank:en:mid:요약완성AB" };
    // 구현고2 대조(선생님 2026-11-24 「분석 유형과 다르게 나온다」「어법과 어휘 구분이 안 된다」)
    // 빈칸 여럿 (a)~(e) 중 「적절하지 않은」 말 — 한 빈칸 고르기가 아니라 낱말 쓰임 판단에 가깝다
    if (/빈칸\s*\(?[a-eA-Eⓐ①]/.test(stem) && /적절하지 않은|어색한|들어갈 수 없는/.test(stem))
      return { key: "vocabulary:na:default:어휘추론", substituted: true };
    // 빈칸에 들어갈 말(낱말) 고르기 — 짧은 글 여러 개를 묶은 [1~6] 꼴 포함
    if (/빈칸에\s*(가장\s*)?(적절한|알맞은)\s*(말|낱말|단어)/.test(stem) && /^\[\s*\d+\s*[~∼-]/.test(stem))
      return { key: "sentence_blank:en:default:빈칸단어" };
    // 상황에 맞게 영작한 문장 (a)~(e)의 적절성 — 문장 단위 어법 판단
    if (/영작/.test(stem) && /적절하지 않은|틀린/.test(stem)) return { key: "grammar:na:default:어법통문장", substituted: true };
    if (/답할 수 있는 질문/.test(stem)) return { key: "sentence_blank:en:default:답변가능개수" };
    if (/(예시|사례)로?.*(적절|부합|해당)/.test(stem)) return { key: "sentence_blank:en:default:사례분류" };
    // 「두 개 고르면」은 변형문제에 없어 같은 갈래(어법/어휘)의 개수형으로
    if (/어법/.test(stem) && /두\s*개|2\s*개/.test(stem)) return { key: "grammar:na:default:어법개수", substituted: true };
    if (/(낱말|어휘|단어)의?\s*쓰임/.test(stem) && /두\s*개|2\s*개/.test(stem)) return { key: "vocabulary:na:default:어휘개수", substituted: true };
    if (/어법상\s*(틀린|어색한|적절하지 않은)\s*것은\?/.test(stem)) return { key: "grammar:na:default:어법추론" };
    if (/(낱말|어휘|단어)의?\s*쓰임이\s*적절하지 않은\s*것은\?/.test(stem)) return { key: "vocabulary:na:default:어휘추론" };
    if (/답할 수 있는 질문/.test(stem)) return { key: "sentence_blank:en:default:답변가능개수" };
    if (/(예시|사례)로?.*(적절|부합|해당)/.test(stem)) return { key: "sentence_blank:en:default:사례분류" };
    // 밑줄이 가리키는 대상(객관식 지칭)은 변형문제에 객관식이 없어 밑줄 의미로 가장 가깝게
    if (/가리키는/.test(stem)) return { key: "underlined_inference:en:default:함축의미추론", substituted: true };
    if (/필자가 주장하는|필자의 주장/.test(stem)) return { key: `summary_mcq:ko:${hi}:요지추론`, substituted: true };
    return null;
  }
  // 어법상 틀린 것 n개를 골라 고쳐 쓰기 — 3개 이상이면 3개형
  if (/어법/.test(stem) && /고쳐|수정/.test(stem) && !/순서|요약/.test(stem)) {
    const n = Number((stem.match(/([2-9])\s*개/) ?? [])[1] ?? 0);
    return { key: n >= 3 ? "grammar:na:default:어법오류수정3" : "grammar:na:default:어법오류수정2", substituted: n > 3 };
  }
  // 가리키는 대상을 지문에서 찾아 쓰기 — 지칭 서술(조건 영작으로 잘못 고쳐 둔 이름보다 발문이 맞다)
  if (/가리키는/.test(stem) && /(찾아|쓰시오)/.test(stem)) return { key: "writing:na:default:지칭대명사서술" };
  // 우리말에 맞게 빈칸에 한 단어 쓰기 — 낱말 하나를 쓰는 서술형으로
  if (/우리말/.test(stem) && /빈칸/.test(stem) && /한\s*(단어|낱말)/.test(stem)) return { key: "writing:na:default:어휘빈칸공통", substituted: true };
  if (/주제를.*(영어|조건)|주제문/.test(stem)) return { key: "writing:na:default:주제문작성" };
  if (/제목을.*(영어|조건)/.test(stem)) return { key: "writing:na:default:주제문작성", substituted: true };
  if (/영영\s*풀이/.test(stem)) return { key: "writing:na:default:어휘빈칸공통", substituted: true };
  if (/표/.test(stem) && /\(A\)/.test(stem) && /(찾아|본문|글에서)/.test(stem)) return { key: "summary_short:na:default:요약표빈칸단어" };
  if (/요약/.test(stem) && /(찾아|본문에서|글에서)/.test(stem)) return { key: "summary_short:na:default:요약문빈칸2단어" };
  return null;
}

/** 유형 이름을 표에서 찾을 때 「추론」·띄어쓰기 차이는 같게 본다(주장추론=주장, 지칭추론=지칭 대상) */
const NAME_ALIAS: Record<string, string> = {
  주장추론: "주장",
  지칭추론: "지칭 대상",
  "지칭 추론": "지칭 대상",
  요약문빈칸: "요약문 완성",
  "요약문 어휘추론": "요약문 완성",
  "대화문 빈칸": "빈칸 추론",
  대화문빈칸: "빈칸 추론",
  "문맥상 동의어": "어휘 판단",
  어법오류수정5: "어법 오류 수정",
  "요약문 빈칸 본문 단어": "본문 찾아 쓰기",
};

/**
 * 시험지 문항 하나가 어떤 변형문제 유형에 해당하는지 — 적중 대조(hit-report)도 같은 길을 쓴다.
 * 동형모의고사를 만들 때와 같은 잣대라야 「유형이 같다」는 말이 같은 뜻이 된다.
 */
export function examTypeToOptionKey(it: ExamItemRow): { key: string; substituted: boolean } {
  // 발문이 가장 정확하다 — 이름을 고친 문항도 발문부터 본다(구현고2: 고친 이름 「어휘 판단」이 빈칸 고르기 발문을 덮어 어색한 낱말 고르기로 나왔다)
  const pick =
    pickByStem(it) ??
    (!it.edited && it.type_key ? pickByKey(it.type_key, it.level) : null) ??
    pickByName(it.type_name, it.level, it.is_subjective);
  return { key: pick.key, substituted: pick.substituted === true };
}

const passageHead = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");

/**
 * 원래 시험지 그 번호 문항을 「어떻게 냈는지」 — 만드는 모델에게 그 번호에만 넘긴다.
 *
 * 선생님 지적(2026-11-25): 「유형과 개수만 맞추면 안 돼. 하나하나 기출을 분석해서 제대로 해야 해」.
 * 발곡고 빈칸 3문항은 하나가 본문 그대로, 둘이 바꿔 말하기였는데 우리는 전부 바꿔 말하기로 냈다.
 * 보기 길이·어휘·오답 만드는 법·지문 변형·난이도 근거까지 문항마다 넘긴다.
 * 예전 분석(값 없음)은 아무것도 넘기지 않는다 — 지어내지 않는다.
 */
export function schoolItemNote(it: ExamItemRow, opts: { passageRewrite?: boolean } = {}): string {
  const lines: string[] = [];
  if (it.stem?.trim()) lines.push(`- 원래 발문: ${it.stem.trim().slice(0, 160)}`);
  if (it.answer_style === "verbatim") {
    lines.push(
      "- 정답 꼴: 이 학교는 이 문항 정답을 **지문 속 표현 그대로** 냈다. 정답 선지는 비운 자리의 원문 어구를 그대로 쓴다(바꿔 말하지 않는다). 이 줄이 위의 「바꿔 말하라(reword/paraphrase)」 규칙보다 먼저다."
    );
  } else if (it.answer_style === "paraphrase") {
    lines.push("- 정답 꼴: 이 학교는 이 문항 정답을 지문 표현을 **바꿔 말해** 냈다. 원문 어구를 그대로 옮기지 않는다.");
  } else if (it.answer_style === "partial") {
    lines.push("- 정답 꼴: 이 학교는 이 문항 정답에 지문 낱말을 일부만 살리고 나머지는 바꿔 말했다.");
  }
  const choice: string[] = [];
  if (it.choice_lang === "en") choice.push("영어");
  else if (it.choice_lang === "ko") choice.push("한글");
  else if (it.choice_lang === "mixed") choice.push("영어·한글 섞임");
  if (typeof it.choice_avg_words === "number" && it.choice_avg_words > 0) choice.push(`평균 ${it.choice_avg_words}낱말(±3 안으로 맞춘다)`);
  if (it.vocab_level?.trim()) choice.push(`어휘 수준 ${it.vocab_level.trim()}`);
  if (choice.length) lines.push(`- 선택지: ${choice.join(", ")}`);
  if (it.level_reason?.trim()) lines.push(`- 선택지 난이도: ${it.level_reason.trim().slice(0, 200)}`);
  if (it.distractor_method?.trim()) lines.push(`- 오답 만드는 법: ${it.distractor_method.trim().slice(0, 120)}`);
  if (it.passage_change?.trim()) {
    const pc = it.passage_change.trim();
    lines.push(
      `- 지문 변형: ${
        pc.startsWith("none")
          ? "원문 그대로 냈다(문항에 필요한 표시 말고는 지문을 바꾸지 않는다)"
          : pc.startsWith("heavy")
            ? `이 학교는 지문을 바꿔 써서 냈다(${pc.replace(/^heavy:?\s*/, "").slice(0, 140)}).${
                opts.passageRewrite ? " 지문(passageModified)도 위 바꿔 쓰기 규칙 안에서 같은 정도로 바꿔 쓴다 — 뜻·흐름·정답 근거는 지킨다." : ""
              }`
            : `이 학교는 지문을 조금 바꿔 냈다(${pc.replace(/^light:?\s*/, "").slice(0, 140)}).${
                opts.passageRewrite ? " 지문 낱말 몇 개를 같은 뜻 다른 말로 바꾼다." : ""
              }`
      }`
    );
  }
  if (it.difficulty_reason?.trim()) lines.push(`- 난이도(${it.level}): ${it.difficulty_reason.trim().slice(0, 200)} — 이보다 쉽게 만들지 않는다.`);
  // 발문·난이도만 있는 예전 분석은 넘기지 않는다(유형 규칙이 이미 다룬다)
  const hasStyle = it.answer_style || it.choice_lang || it.choice_avg_words || it.level_reason || it.distractor_method || it.passage_change;
  if (!hasStyle) return "";
  return `이 문항은 원래 시험지 ${it.item_no}번을 따라 만든다. 그 문항을 이렇게 냈다 — 유형 규칙은 그대로 지키고, 아래와 같게 만든다.\n${lines.join("\n")}`;
}

/** 원래 문항 지문의 갈래: 선생님이 정한 것 먼저, 아니면 대조 결과 */
export function itemSourceKind(it: ExamItemRow): "textbook" | "mock" | null {
  if (it.source_kind === "textbook") return "textbook";
  if (it.source_kind === "mock" || it.source_kind === "outside") return "mock";
  if (it.matched_textbook_id) return "textbook";
  if (it.matched_mock_id) return "mock";
  return null;
}

export function buildMockSlots(
  items: ExamItemRow[],
  opts: { passageRewrite?: boolean } = {}
): { slots: MockSlot[]; groupCount: number } {
  let group = -1;
  let lastHead = "__none__";
  const slots = items.map((it) => {
    const head = passageHead(it.passage_excerpt);
    // 지문 앞부분이 같으면 같은 지문. 지문이 비어 있으면(서술형 등) 앞 문항 지문에 붙인다
    if (group < 0 || (head && head !== lastHead)) {
      group += 1;
      if (head) lastHead = head;
    }
    const pick = examTypeToOptionKey(it);
    return {
      no: it.item_no,
      passageIndex: group,
      optionKey: pick.key,
      level: it.level,
      points: it.points,
      sourceType: it.type_name,
      typeLabel: typeNameFromKey(pick.key, it.is_subjective).name,
      substituted: pick.substituted,
      group,
      schoolNote: schoolItemNote(it, opts) || undefined,
      passageRewritten: String(it.passage_change ?? "").startsWith("heavy"),
      sourceKind: itemSourceKind(it),
      answerStyle: it.answer_style ?? null,
    } satisfies MockSlot;
  });
  return { slots, groupCount: group + 1 };
}
