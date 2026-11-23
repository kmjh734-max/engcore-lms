/**
 * 문항 유형을 값 받는 갈래로 나눈다.
 *
 * 확인 창(만들기 전)과 실제 차감(만든 뒤)이 서로 다른 기준을 쓰고 있었다 — 확인 창은
 * 어법추론·어법개수만 따로 세고 서술형은 아예 일반에 섞어 보여, 선생님이 보신 금액과
 * 빠져나간 금액이 달랐다(2026-10-01 선생님 지적). 두 곳이 갈라지지 않도록 여기 하나만 둔다.
 */

/** 어법 유형 — 지문 전체를 다시 읽고 여러 자리를 한꺼번에 봐야 해서 값이 더 든다 */
export const isGrammarBillingType = (key: string | null) =>
  /:(어법추론|어법개수|어법통문장)$/.test(String(key ?? ""));

/**
 * 서술형 — 호출이 2.3번 들어가고(검수에서 걸려 다시 만드는 일이 잦다) 해설이 길다.
 * 실측(2026-10-01): 객관식 41원, 서술형·어법 114원.
 */
export const isWritingBillingType = (key: string | null) =>
  /^(writing|summary_short):/.test(String(key ?? "")) ||
  /:(어법문장오류수정|어법오류수정2|어법오류수정3|지칭대명사서술|특정표현의미서술|요약표빈칸단어)$/.test(
    String(key ?? "")
  );

/*
 * 1지문 다문항(세트)도 유형마다 같은 갈래로 받는다 — 기본 110, 어법·서술형 150(선생님 결정 2026-10-11).
 * 10-10에는 세트 문항을 모두 150으로 받았는데(qg_generate_set), 90문항 13,500크레딧을 보시고
 * 「90문항이 150이면 안 될 것 같다, 어법이면 150 되도록」 하셨다.
 */

/** 유형 하나가 어느 갈래로 값을 받는지 */
export function billingFeatureFor(optionKey: string | null): string {
  if (isGrammarBillingType(optionKey)) return "qg_generate_grammar";
  if (isWritingBillingType(optionKey)) return "qg_generate_writing";
  return "qg_generate_job";
}
