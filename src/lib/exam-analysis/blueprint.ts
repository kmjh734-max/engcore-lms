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
    "지칭 대상": { key: `content_true:${lang}:${hi}:내용일치`, substituted: true },
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
    "우리말 조건 영작": { key: "writing:na:default:제시어배열단어추가", substituted: true },
    "빈칸 영작": { key: "summary_short:na:default:요약문빈칸2단어", substituted: true },
    "본문 찾아 쓰기": { key: "summary_short:na:default:요약문빈칸3단어", substituted: true },
    "요약표 수정": { key: "summary_short:na:default:요약문빈칸영작", substituted: true },
    "의미 설명": { key: "writing:na:default:특정표현의미서술" },
    "제목 쓰기": { key: "summary_short:na:default:요약문빈칸영작", substituted: true },
    "주제 쓰기": { key: "summary_short:na:default:요약문빈칸영작", substituted: true },
  };
  const hit = table[plain?.trim() ?? ""];
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
 * 시험지 문항 하나가 어떤 변형문제 유형에 해당하는지 — 적중 대조(hit-report)도 같은 길을 쓴다.
 * 동형모의고사를 만들 때와 같은 잣대라야 「유형이 같다」는 말이 같은 뜻이 된다.
 */
export function examTypeToOptionKey(it: ExamItemRow): { key: string; substituted: boolean } {
  const pick =
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

export function buildMockSlots(items: ExamItemRow[]): { slots: MockSlot[]; groupCount: number } {
  let group = -1;
  let lastHead = "__none__";
  const slots = items.map((it) => {
    const head = passageHead(it.passage_excerpt);
    // 지문 앞부분이 같으면 같은 지문. 지문이 비어 있으면(서술형 등) 앞 문항 지문에 붙인다
    if (group < 0 || (head && head !== lastHead)) {
      group += 1;
      if (head) lastHead = head;
    }
    const pick = (!it.edited && it.type_key ? pickByKey(it.type_key, it.level) : null) ?? pickByName(it.type_name, it.level, it.is_subjective);
    return {
      no: it.item_no,
      passageIndex: group,
      optionKey: pick.key,
      level: it.level,
      points: it.points,
      sourceType: it.type_name,
      typeLabel: typeNameFromKey(pick.key, it.is_subjective).name,
      substituted: Boolean(pick.substituted),
      group,
    } satisfies MockSlot;
  });
  return { slots, groupCount: group + 1 };
}
