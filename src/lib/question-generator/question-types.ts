import type {
  QuestionCategory,
  QuestionTypeGroup,
  QuestionTypeOption,
} from "@/lib/question-generator/types";

/**
 * 고1 학력평가 수준의 변형 유형
 * 발문: 「윗글의 …」 / 태그: [202603H1_22요지추론_변형]
 */
function opt(
  type: QuestionTypeOption["type"],
  category: QuestionCategory,
  label: string,
  difficulty: QuestionTypeOption["difficulty"],
  choiceLanguage: QuestionTypeOption["choiceLanguage"],
  isObjective: boolean,
  preview: string,
  aingkaCode: string,
  koreanStem: string
): QuestionTypeOption & { aingkaCode: string; koreanStem: string } {
  const lang =
    choiceLanguage === "english"
      ? "en"
      : choiceLanguage === "korean"
        ? "ko"
        : "na";
  const diff =
    difficulty === "default"
      ? "default"
      : difficulty === "low"
        ? "low"
        : difficulty === "medium"
          ? "mid"
          : "high";
  return {
    key: `${type}:${lang}:${diff}:${aingkaCode}`,
    type,
    category,
    label,
    difficulty,
    choiceLanguage,
    isObjective,
    preview,
    aingkaCode,
    koreanStem,
  };
}

export type AingkaOption = ReturnType<typeof opt>;

export const QUESTION_TYPE_GROUPS: QuestionTypeGroup[] = [
  {
    category: "grammar_vocabulary",
    label: "Section · 어법·어휘",
    options: [
      opt(
        "grammar",
        "grammar_vocabulary",
        "어법 추론",
        "default",
        null,
        true,
        "ⓐ~ⓔ 중 어법상 틀린 것 하나 고르기",
        "어법추론",
        "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?"
      ),
      opt(
        "grammar",
        "grammar_vocabulary",
        "어색한 것 개수",
        "default",
        null,
        true,
        "ⓐ~ⓕ 중 어법상 어색한 것의 개수",
        "어법개수",
        "다음 글의 밑줄 친 부분 중, 어법상 틀린 것의 개수는?"
      ),
      /* 리얼영어 어법 오류갯수형 — 밑줄 8곳(ⓐ~ⓗ), 같은 코드의 상(2026-11-23) */
      opt(
        "grammar",
        "grammar_vocabulary",
        "어색한 것 개수 (8곳·상)",
        "high",
        null,
        true,
        "ⓐ~ⓗ 8곳 중 어법상 어색한 것의 개수 (① 1개 ~ ⑤ 5개)",
        "어법개수",
        "다음 글의 밑줄 친 부분 중, 어법상 틀린 것의 개수는?"
      ),
      opt(
        "vocabulary",
        "grammar_vocabulary",
        "어색한 것 고르기",
        "default",
        null,
        true,
        "①~⑤ 중 문맥상 낱말 쓰임이 적절하지 않은 것",
        "어휘추론",
        "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?"
      ),
      opt(
        "vocabulary",
        "grammar_vocabulary",
        "어색한 것 개수",
        "default",
        null,
        true,
        "①~⑥ 중 문맥상 쓰임이 적절하지 않은 것의 개수",
        "어휘개수",
        "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것의 개수는?"
      ),
    ],
  },
  {
    category: "details",
    label: "Section · 세부 정보",
    options: [
      opt(
        "content_true",
        "details",
        "(영) 하",
        "low",
        "english",
        true,
        "내용 일치 · 영어 선택지 · 난이도 하",
        "내용일치",
        "윗글의 내용과 일치하는 것은?"
      ),
      opt(
        "content_true",
        "details",
        "(영) 상",
        "high",
        "english",
        true,
        "내용 일치 · 영어 선택지 · 난이도 상",
        "내용일치",
        "윗글의 내용과 일치하는 것은?"
      ),
      opt(
        "content_true",
        "details",
        "(한) 하",
        "low",
        "korean",
        true,
        "내용 일치 · 한글 선택지 · 난이도 하",
        "내용일치",
        "윗글의 내용과 일치하는 것은?"
      ),
      opt(
        "content_true",
        "details",
        "(한) 상",
        "high",
        "korean",
        true,
        "내용 일치 · 한글 선택지 · 난이도 상",
        "내용일치",
        "윗글의 내용과 일치하는 것은?"
      ),
      opt(
        "content_false",
        "details",
        "(영) 하",
        "low",
        "english",
        true,
        "내용 불일치 · 영어 선택지 · 난이도 하",
        "내용불일치",
        "윗글의 내용과 일치하지 않는 것은?"
      ),
      opt(
        "content_false",
        "details",
        "(영) 상",
        "high",
        "english",
        true,
        "내용 불일치 · 영어 선택지 · 난이도 상",
        "내용불일치",
        "윗글의 내용과 일치하지 않는 것은?"
      ),
      opt(
        "content_false",
        "details",
        "(한) 하",
        "low",
        "korean",
        true,
        "내용 불일치 · 한글 선택지 · 난이도 하",
        "내용불일치",
        "윗글의 내용과 일치하지 않는 것은?"
      ),
      opt(
        "content_false",
        "details",
        "(한) 상",
        "high",
        "korean",
        true,
        "내용 불일치 · 한글 선택지 · 난이도 상",
        "내용불일치",
        "윗글의 내용과 일치하지 않는 것은?"
      ),
      opt(
        "content_count",
        "details",
        "(영) 하",
        "low",
        "english",
        false,
        "<보기> 영어 진술 · 불일치 개수 기입 · 난이도 하",
        "일치개수",
        "다음 글을 읽고 <보기> 중 글의 내용과 일치하지 않는 것의 개수를 적으시오."
      ),
      opt(
        "content_count",
        "details",
        "(영) 상",
        "high",
        "english",
        false,
        "<보기> 영어 진술 · 불일치 개수 기입 · 난이도 상",
        "일치개수",
        "다음 글을 읽고 <보기> 중 글의 내용과 일치하지 않는 것의 개수를 적으시오."
      ),
      opt(
        "content_count",
        "details",
        "(한) 하",
        "low",
        "korean",
        false,
        "<보기> 한글 진술 · 불일치 개수 기입 · 난이도 하",
        "일치개수",
        "다음 글을 읽고 <보기> 중 글의 내용과 일치하지 않는 것의 개수를 적으시오."
      ),
      opt(
        "content_count",
        "details",
        "(한) 상",
        "high",
        "korean",
        false,
        "<보기> 한글 진술 · 불일치 개수 기입 · 난이도 상",
        "일치개수",
        "다음 글을 읽고 <보기> 중 글의 내용과 일치하지 않는 것의 개수를 적으시오."
      ),
    ],
  },
  {
    category: "inference",
    label: "Section · 추론 능력",
    options: [
      // 순서: 하/상
      opt(
        "order",
        "inference",
        "하",
        "low",
        null,
        true,
        "지시문 원문 · (A)(B)(C) 원문",
        "순서추론",
        "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?"
      ),
      opt(
        "order",
        "inference",
        "상",
        "high",
        null,
        true,
        "지시문 paraphrase · (A)(B)(C) 원문",
        "순서추론",
        "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?"
      ),
      // 문장빈칸: 하/상
      opt(
        "sentence_blank",
        "inference",
        "하",
        "low",
        "english",
        true,
        "중요 문장 빈칸 · 보기 원문에 가깝게",
        "빈칸추론",
        "윗글의 빈칸에 들어갈 말로 알맞은 것은?"
      ),
      opt(
        "sentence_blank",
        "inference",
        "상",
        "high",
        "english",
        true,
        "중요 문장 빈칸 · 보기 paraphrase",
        "빈칸추론",
        "윗글의 빈칸에 들어갈 말로 알맞은 것은?"
      ),
      // 삽입(위치): 하/상
      opt(
        "sentence_insertion",
        "inference",
        "하",
        "low",
        null,
        true,
        "흐름상 중요 문장 삽입 · 원문",
        "문장삽입",
        "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?"
      ),
      opt(
        "sentence_insertion",
        "inference",
        "상",
        "high",
        null,
        true,
        "흐름상 중요 문장 삽입 · paraphrase",
        "문장삽입",
        "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?"
      ),
      // 무관한 문장: 하/상
      opt(
        "irrelevant_sentence",
        "inference",
        "하",
        "low",
        null,
        true,
        "중요 문장 → 주제·포인트가 다른 무관 문장(어휘는 유사)",
        "무관한문장",
        "다음 글의 전체 흐름과 가장 관계없는 문장은?"
      ),
      opt(
        "irrelevant_sentence",
        "inference",
        "상",
        "high",
        null,
        true,
        "본문 paraphrase + 어휘 유사·포인트 다른 무관 문장",
        "무관한문장",
        "다음 글의 전체 흐름과 가장 관계없는 문장은?"
      ),
      // 함축의미추론: 난이도 없음 · 영어 보기
      opt(
        "underlined_inference",
        "inference",
        "함축 의미",
        "default",
        "english",
        true,
        "밑줄 (A) 문맥 함축 의미 · 영어 보기 (사전적 풀이 금지 · 해당 표현 없으면 생략)",
        "함축의미추론",
        "다음 글의 밑줄 친 (A)가 의미하는 바로 가장 적절한 것은?"
      ),
      // 기타 (프리셋 호환)
      opt(
        "underlined_inference",
        "inference",
        "목적 추론",
        "default",
        "english",
        true,
        "「윗글의 목적으로 알맞은 것은?」 영어 선택지",
        "목적추론",
        "윗글의 목적으로 알맞은 것은?"
      ),
      opt(
        "underlined_inference",
        "inference",
        "심경 변화",
        "default",
        "english",
        true,
        "심경 변화 영어 선택지",
        "심경추론",
        "윗글에 드러난 심경 변화로 알맞은 것은?"
      ),
      opt(
        "sentence_blank",
        "inference",
        "연결어 빈칸 (A)(B)",
        "default",
        "english",
        true,
        "담화 표지 (A)(B) 연결 선택",
        "연결어빈칸",
        "윗글의 빈칸 (A), (B)에 들어갈 알맞은 말로 연결된 것은?"
      ),
    ],
  },
  {
    category: "main_idea",
    label: "Section · 대의 파악",
    options: [
      // 제목: (영/한) × (하/상)
      opt(
        "title",
        "main_idea",
        "(영) 하",
        "low",
        "english",
        true,
        "제목 · 영어 선택지 · 난이도 하",
        "제목추론",
        "다음 글의 제목으로 가장 적절한 것을 고르시오."
      ),
      opt(
        "title",
        "main_idea",
        "(영) 상",
        "high",
        "english",
        true,
        "제목 · 영어 선택지 · 난이도 상",
        "제목추론",
        "다음 글의 제목으로 가장 적절한 것을 고르시오."
      ),
      opt(
        "title",
        "main_idea",
        "(한) 하",
        "low",
        "korean",
        true,
        "제목 · 한글 선택지 · 난이도 하",
        "제목추론",
        "다음 글의 제목으로 가장 적절한 것을 고르시오."
      ),
      opt(
        "title",
        "main_idea",
        "(한) 상",
        "high",
        "korean",
        true,
        "제목 · 한글 선택지 · 난이도 상",
        "제목추론",
        "다음 글의 제목으로 가장 적절한 것을 고르시오."
      ),
      // 주제: (영/한) × (하/상)
      opt(
        "topic",
        "main_idea",
        "(영) 하",
        "low",
        "english",
        true,
        "주제 · 영어 선택지 · 난이도 하",
        "주제추론",
        "다음 글의 주제로 가장 적절한 것을 고르시오."
      ),
      opt(
        "topic",
        "main_idea",
        "(영) 상",
        "high",
        "english",
        true,
        "주제 · 영어 선택지 · 난이도 상",
        "주제추론",
        "다음 글의 주제로 가장 적절한 것을 고르시오."
      ),
      opt(
        "topic",
        "main_idea",
        "(한) 하",
        "low",
        "korean",
        true,
        "주제 · 한글 선택지 · 난이도 하",
        "주제추론",
        "다음 글의 주제로 가장 적절한 것을 고르시오."
      ),
      opt(
        "topic",
        "main_idea",
        "(한) 상",
        "high",
        "korean",
        true,
        "주제 · 한글 선택지 · 난이도 상",
        "주제추론",
        "다음 글의 주제로 가장 적절한 것을 고르시오."
      ),
      opt(
        "summary_mcq",
        "main_idea",
        "요지 (하)",
        "low",
        "korean",
        true,
        "요지 · 난이도 하",
        "요지추론",
        "다음 글의 요지로 가장 적절한 것을 고르시오."
      ),
      opt(
        "summary_mcq",
        "main_idea",
        "요지 (상)",
        "high",
        "korean",
        true,
        "요지 · 난이도 상",
        "요지추론",
        "다음 글의 요지로 가장 적절한 것을 고르시오."
      ),
      opt(
        "summary_mcq",
        "main_idea",
        "요지 (영)",
        "default",
        "english",
        true,
        "요지 · 영어 선택지 (A4 변형동형)",
        "요지추론",
        "다음 글의 요지로 가장 적절한 것을 고르시오."
      ),
      /* 요약문 완성 객관식(수능 40번형) — 윌링 2026-11-23. 키에 「요약문완성」을 넣지 않는다(옛 키 거르개 sanitizeCounts) */
      opt(
        "sentence_blank",
        "main_idea",
        "요약문 완성 (A)(B)",
        "medium",
        "english",
        true,
        "글 전체 요약문의 빈칸 (A)(B)에 들어갈 낱말 쌍 고르기 (수능 40번형)",
        "요약완성AB",
        "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?"
      ),
      opt(
        "sentence_blank",
        "main_idea",
        "요약문 완성 (A)(B) 상",
        "high",
        "english",
        true,
        "요약문 (A)(B) · 난이도 상(바꿔 쓴 낱말·비슷한 오답)",
        "요약완성AB",
        "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?"
      ),
      /* 리얼영어 「빈칸 추론(단어)」(2026-11-23) */
      opt(
        "sentence_blank",
        "inference",
        "빈칸 (단어)",
        "default",
        "english",
        true,
        "핵심 낱말 하나를 비우고 영어 한 낱말 보기 다섯에서 고르기",
        "빈칸단어",
        "다음 빈칸에 들어갈 말로 가장 적절한 것은?"
      ),
      /* 리얼영어 「답변 가능 개수형」·「사례 분류형」(2026-11-23) */
      opt(
        "sentence_blank",
        "details",
        "답변 가능 질문 개수",
        "default",
        "english",
        true,
        "<보기> 영어 질문 7개 중 글을 읽고 답할 수 있는 것의 개수 (① 2개 ~ ⑤ 6개)",
        "답변가능개수",
        "<보기>의 질문들 중 다음 글을 읽고 답할 수 있는 질문의 개수는?"
      ),
      opt(
        "sentence_blank",
        "inference",
        "사례 분류 (다른 하나)",
        "default",
        "english",
        true,
        "글의 개념에 비춘 영어 사례 5개 중 나머지 넷과 성격이 다른 것",
        "사례분류",
        "다음 글의 내용을 바탕으로 할 때, 사례 ①~⑤ 중 나머지 넷과 성격이 다른 것은?"
      ),
      /* 리얼영어 어법(통문장) — 밑줄 친 문장 다섯 중 틀린 문장(2026-11-23) */
      opt(
        "grammar",
        "grammar_vocabulary",
        "어법 (통문장)",
        "default",
        null,
        true,
        "밑줄 친 문장 ⓐ~ⓔ 중 어법상 적절하지 않은 문장 고르기",
        "어법통문장",
        "다음 글의 밑줄 친 문장 중, 어법상 적절하지 않은 것은?"
      ),
    ],
  },
  {
    category: "subjective",
    label: "Section · 서술형",
    options: [
      /* 리얼영어 서술형(2026-11-23) — 어휘 빈칸·주제문·구문 변환·대화문·내용 매칭 */
      opt("writing", "subjective", "어휘 빈칸 (공통 한 단어)", "default", null, false, "빈칸 ⓐ, ⓑ에 공통으로 들어갈 지문 속 영어 한 단어 쓰기", "어휘빈칸공통", "다음 글의 빈칸 ⓐ, ⓑ에 공통으로 들어갈 말을 1단어의 영어로 쓰시오."),
      opt("writing", "subjective", "주제문 작성 (명사구)", "default", null, false, "보기 단어를 모두 써서 글의 주제를 N단어 영어 명사구로 쓰기", "주제문작성", "다음 글의 주제를 <조건>에 맞게 영어로 작성하시오."),
      opt("writing", "subjective", "구문 변환", "default", null, false, "밑줄 친 문장을 <조건>(능동↔수동·주어·시제)에 맞게 바꿔 쓰기", "구문변환", "다음 글의 밑줄 친 부분을 <조건>에 맞게 바꾸어 쓰시오."),
      opt("writing", "subjective", "대화문 완성", "default", null, false, "글 내용을 두고 나눈 대화의 빈칸 ⓐ, ⓑ를 본문 어구로 채우기", "대화문완성", "다음은 윗글을 읽고 나눈 대화이다. 빈칸 ⓐ, ⓑ에 들어갈 말을 <조건>에 맞게 본문에서 찾아 쓰시오."),
      opt("writing", "subjective", "내용 매칭 (예시 번호)", "default", null, false, "개념 ⓐ, ⓑ에 맞는 예시를 <보기> ①~⑤에서 골라 번호 쓰기", "내용매칭", "다음 글의 내용을 읽고, ⓐ, ⓑ에 해당하는 가장 적절한 예시를 <보기>에서 찾아 그 번호를 쓰시오."),
      opt(
        "writing",
        "subjective",
        "제시어 배열 · 기본",
        "default",
        null,
        false,
        "어법서술형 GP 기반 · 중요 문장 · 어형 고정 배열",
        "제시어배열기본",
        "다음 글의 흐름에 맞게, 밑줄 친 ⓐ의 우리말 해석에 맞도록 <보기>의 단어들을 알맞게 배열하여 문장을 완성하시오."
      ),
      opt(
        "writing",
        "subjective",
        "제시어 배열 · 어형변화",
        "default",
        null,
        false,
        "어법서술형 GP 기반 · 중요 문장 · 필요 시 어형 변화",
        "제시어배열어형변화",
        "다음 <해석>의 우리말 문장과 같은 뜻이 되도록 <보기>의 표현만을 모두 한 번씩 사용하여 주어진 문장을 완성하시오."
      ),
      opt(
        "writing",
        "subjective",
        "제시어 배열 · 단어추가",
        "default",
        null,
        false,
        "어법서술형 GP 기반 · 중요 문장 · 단어 추가·어형 변화",
        "제시어배열단어추가",
        "다음 글의 흐름과 밑줄 친 ⓐ의 우리말 해석에 맞도록 <보기>의 단어를 활용하여 문장을 완성하시오."
      ),
      opt(
        "writing",
        "subjective",
        "제시어 배열 · 지정 문법",
        "default",
        null,
        false,
        "정해진 어법을 반드시 써서 빈칸 문장 완성",
        "문법조건영작",
        "다음 글의 빈칸 ⓐ에 들어갈 문장을 <조건>에 맞게 <보기>의 단어를 배열하여 완성하시오."
      ),
      opt(
        "summary_short",
        "subjective",
        "요약문 빈칸 · 영작",
        "default",
        null,
        false,
        "요약문 ⓐⓑ · <보기> 단어 배열 영작",
        "요약문빈칸영작",
        "다음 글의 흐름에 맞게 <보기>의 단어를 올바른 순서로 배열하여 요약문의 빈칸 ⓐ, ⓑ를 완성하시오."
      ),
      opt(
        "summary_short",
        "subjective",
        "요약문 빈칸 · 2단어",
        "default",
        null,
        false,
        "요약문 빈칸 · 본문 연속 2단어 찾기",
        "요약문빈칸2단어",
        "다음 글의 내용을 바탕으로 요약문의 빈칸에 들어갈 말을 본문에서 찾아 쓰시오."
      ),
      opt(
        "summary_short",
        "subjective",
        "요약문 빈칸 · 3단어",
        "default",
        null,
        false,
        "요약문 빈칸 · 본문 연속 3단어 찾기",
        "요약문빈칸3단어",
        "다음 글의 내용을 바탕으로 요약문의 빈칸에 들어갈 말을 본문에서 찾아 쓰시오."
      ),
      opt(
        "summary_short",
        "subjective",
        "요약표 빈칸 · 본문 단어",
        "default",
        null,
        false,
        "내용을 표로 정리 · 빈칸 (A)(B)(C)에 본문 단어 찾아 쓰기",
        "요약표빈칸단어",
        "다음 글의 내용을 표로 정리하고자 할 때, 빈칸 (A), (B), (C)에 들어갈 말을 본문에서 찾아 각각 한 단어로 쓰시오."
      ),
      opt(
        "writing",
        "subjective",
        "지칭 · 대명사·지시사",
        "default",
        null,
        false,
        "밑줄 대명사·지시사가 가리키는 말 · 본문에서 찾아 영작",
        "지칭대명사서술",
        "다음 글의 밑줄 친 ⓐit이 가리키는 바를 본문에서 정확히 찾아 한 단어의 영어로 쓰시오."
      ),
      opt(
        "writing",
        "subjective",
        "지칭 · 특정 표현",
        "default",
        null,
        false,
        "밑줄 표현의 문맥 의미 · 본문에서 N단어로 찾아 쓰기",
        "특정표현의미서술",
        "다음 글의 밑줄 친 표현이 문맥상 의미하는 바를 본문에서 찾아 영어로 쓰시오."
      ),
      opt(
        "grammar",
        "subjective",
        "어법 수정 · 2개",
        "default",
        null,
        false,
        "ⓐ~ⓔ 중 어법 오류 2개 찾아 기호·바른 형태로 수정",
        "어법오류수정2",
        "다음 글의 밑줄 친 ⓐ~ⓔ 중, 어법상 틀린 곳을 모두 찾아 그 기호를 쓰고, 바르게 고치시오."
      ),
      opt(
        "grammar",
        "subjective",
        "어법 수정 · 3개",
        "default",
        null,
        false,
        "ⓐ~ⓖ 중 어법 오류 3개 찾아 기호·바른 형태로 수정",
        "어법오류수정3",
        "다음 글의 밑줄 친 ⓐ~ⓖ 중, 어법상 틀린 곳을 모두 찾아 그 기호를 쓰고, 바르게 고치시오."
      ),
      opt(
        "grammar",
        "subjective",
        "어법 수정 · 문장",
        "default",
        null,
        false,
        "①~⑤ 중 어법상 틀린 문장 찾아 번호·바른 형태로 수정",
        "어법문장오류수정",
        "다음 글의 ①~⑤ 중 어법상 틀린 문장의 번호를 모두 쓰고, 틀린 부분을 찾아 바르게 고치시오."
      ),
    ],
  },
];

export const ALL_QUESTION_OPTIONS: QuestionTypeOption[] =
  QUESTION_TYPE_GROUPS.flatMap((g) => g.options);

export function findOptionByKey(key: string): QuestionTypeOption | undefined {
  return ALL_QUESTION_OPTIONS.find((o) => o.key === key);
}

export function findAingkaOption(key: string): AingkaOption | undefined {
  return ALL_QUESTION_OPTIONS.find((o) => o.key === key) as
    | AingkaOption
    | undefined;
}

export function emptyCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of ALL_QUESTION_OPTIONS) counts[o.key] = 0;
  return counts;
}

/** 알려진 유형만 남기고, 폐기된 객관식 요약문완성 키만 제거 */
export function sanitizeCounts(
  counts: Record<string, number> | null | undefined,
  maxPerType = 5
): Record<string, number> {
  const base = emptyCounts();
  if (!counts) return base;
  const migrated: Record<string, number> = { ...counts };
  // 함축의미: 한글 보기 키 → 영어 보기 키
  const oldHamchuk = "underlined_inference:ko:default:함축의미추론";
  const newHamchuk = "underlined_inference:en:default:함축의미추론";
  if ((migrated[oldHamchuk] ?? 0) > 0) {
    migrated[newHamchuk] = Math.max(
      migrated[newHamchuk] ?? 0,
      migrated[oldHamchuk] ?? 0
    );
    delete migrated[oldHamchuk];
  }
  // 어법 모두 고르기 → 어법 추론 (틀린 어법 하나)
  const oldEobeopAll = "grammar:na:default:어법모두고르기";
  const newEobeopInfer = "grammar:na:default:어법추론";
  if ((migrated[oldEobeopAll] ?? 0) > 0) {
    migrated[newEobeopInfer] = Math.max(
      migrated[newEobeopInfer] ?? 0,
      migrated[oldEobeopAll] ?? 0
    );
    delete migrated[oldEobeopAll];
  }
  for (const [k, v] of Object.entries(migrated)) {
    // 구형 객관식 요약문완성만 차단 (서술형 요약문 빈칸은 허용)
    if (/요약문완성/.test(k)) continue;
    if (!(k in base)) continue;
    const n = Math.max(0, Math.min(maxPerType, Math.floor(Number(v) || 0)));
    if (n > 0) base[k] = n;
  }
  return base;
}

export function sumCounts(counts: Record<string, number>): {
  total: number;
  objective: number;
  subjective: number;
  selectedTypes: number;
} {
  let total = 0;
  let objective = 0;
  let subjective = 0;
  let selectedTypes = 0;
  for (const o of ALL_QUESTION_OPTIONS) {
    const n = Math.max(0, Math.floor(counts[o.key] ?? 0));
    if (n <= 0) continue;
    selectedTypes += 1;
    total += n;
    if (o.isObjective) objective += n;
    else subjective += n;
  }
  return { total, objective, subjective, selectedTypes };
}

export function expandCountRequests(
  counts: Record<string, number>
): QuestionTypeOption[] {
  const list: QuestionTypeOption[] = [];
  for (const o of ALL_QUESTION_OPTIONS) {
    const n = Math.max(0, Math.floor(counts[o.key] ?? 0));
    for (let i = 0; i < n; i++) list.push(o);
  }
  return list;
}

export function buildAingkaTag(opts: {
  yearMonth?: string;
  gradeCode?: string;
  questionNo?: string | number;
  aingkaCode: string;
}): string {
  const ym = opts.yearMonth || "202603";
  const g = opts.gradeCode || "H1";
  const no = opts.questionNo != null ? String(opts.questionNo) : "";
  const prefix = no ? `${ym}${g}_${no}` : `${ym}${g}`;
  return `[${prefix}${opts.aingkaCode}_변형]`;
}

export const KOREAN_INSTRUCTION_BY_KEY: Record<string, string> =
  Object.fromEntries(
    (ALL_QUESTION_OPTIONS as AingkaOption[]).map((o) => [o.key, o.koreanStem])
  );
