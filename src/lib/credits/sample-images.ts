import type { CreditSampleKind } from "@/lib/credits/confirm-store";

/**
 * 만들기 전 확인 창에 보여 주는 견본 사진.
 *
 * 선생님 요청(2026-09-28): 손으로 흉내 낸 그림 말고 <b>실제 화면을 찍은 사진</b>으로.
 * 첫 화면(LandingPage)에서 쓰는 것과 같은 방식이다.
 *
 * public/samples 아래 사진은 실제로 만들어 둔 자료의 <b>첫 장</b>을 그대로 찍은 것이다
 * (scripts/tmp-rv/_samplesshot.mjs). 비율은 A4 그대로(0.706)라 견본 칸에 잘림 없이 들어간다.
 * 자료 모양이 바뀌면 그 스크립트를 다시 돌려 사진만 갈아 끼우면 된다.
 *
 * 사진이 없는 갈래는 여기에 적지 않는다. 그러면 예전처럼 모양만 그린 견본이 나온다.
 */
export interface SampleImage {
  src: string;
  /** 사진 안에서 먼저 보여 줄 자리 — 대부분 위쪽이 제목이라 top */
  position?: string;
  /** 무엇을 찍은 것인지 (화면 읽어 주는 이를 위해) */
  alt: string;
}

export const SAMPLE_IMAGES: Partial<Record<CreditSampleKind, SampleImage>> = {
  lesson_pack: {
    src: "/samples/lesson-pack.jpg",
    alt: "수업용 자료 — 지문과 단어정리, 해석을 묶은 실제 인쇄 첫 장",
  },
  analysis_report: {
    src: "/samples/analysis-report.jpg",
    alt: "지문 분석서 — 문장마다 구조 표시와 해석이 붙은 실제 인쇄 첫 장",
  },
  workbook: {
    src: "/samples/workbook.jpg",
    alt: "워크북 — 같은 지문으로 만든 문제지 실제 인쇄 첫 장",
  },
  one_page_summary: {
    src: "/samples/one-page-summary.jpg",
    alt: "1장 요약직보자료 — 요약문·어법 포인트·중요 표현을 한 장에 모은 실제 인쇄 화면",
  },
  one_page_test: {
    src: "/samples/one-page-test.jpg",
    alt: "1장 테스트 — 한 장짜리 확인 시험지 실제 인쇄 화면",
  },
  integrated: {
    src: "/samples/integrated.jpg",
    alt: "최종통합자료 — 표지와 차례를 붙여 한 권으로 묶은 실제 인쇄 첫 장",
  },
  question: {
    src: "/samples/question.jpg",
    alt: "변형문제 — 고른 유형으로 만든 시험지 실제 인쇄 첫 장",
  },
  /*
   * 선생님 지적(2026-09-30): 시험 분석을 만들 때 뜨는 예시가 보고서 화면이 아니었다.
   * 그려 둔 견본이 나오고 있었다. 실제 분석지 첫 장을 찍어 넣는다.
   */
  exam_mock: {
    src: "/samples/exam-analysis.jpg",
    alt: "내신 시험 분석 — 영역·난이도·지문 출처를 한 장에 모은 실제 분석지 첫 장",
  },
};

/** 동형모의고사 만들기 창: 분석 보고서가 아니라 만들어질 학교 시험지 양식 첫 쪽(선생님 2026-11-24 「이미지 동형모의고사로」) */
SAMPLE_IMAGES.exam_mock_paper = {
  src: "/samples/exam-mock.jpg",
  alt: "동형모의고사 — 학교 시험지 양식으로 만든 문제지 실제 인쇄 첫 쪽",
};

export function sampleImageFor(kind: CreditSampleKind): SampleImage | null {
  return SAMPLE_IMAGES[kind] ?? null;
}
