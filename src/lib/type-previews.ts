/**
 * 유형 미리보기 그림 목록(선생님 2026-10-26: 유형에 마우스를 올리면 실제 자료 캡처가 보이게).
 * scripts/tmp-rv/type-previews/ 의 shoot-workbook·shoot-qg 로 실제 저장본을 찍고 build-manifest 가 이 파일을 적는다.
 * 손으로 고치지 말 것. w·h 는 그림 픽셀(2배·1.5배로 찍어 화면에서는 줄여 보인다).
 */
export type TypePreviewShot = { src: string; w: number; h: number };

const WORKBOOK: Record<string, { w: number; h: number }> = {
  "blank_fill": {
    "h": 798,
    "w": 990
  },
  "full_en_writing": {
    "h": 798,
    "w": 990
  },
  "gist_ko": {
    "h": 798,
    "w": 990
  },
  "grammar_choice": {
    "h": 798,
    "w": 990
  },
  "grammar_fix": {
    "h": 798,
    "w": 990
  },
  "key_word_order": {
    "h": 798,
    "w": 990
  },
  "one_line_ko": {
    "h": 798,
    "w": 990
  },
  "sentence_order": {
    "h": 798,
    "w": 990
  },
  "tb_chunk_line": {
    "h": 798,
    "w": 990
  },
  "tb_flow": {
    "h": 798,
    "w": 990
  },
  "tb_implication": {
    "h": 798,
    "w": 990
  },
  "tb_insert": {
    "h": 798,
    "w": 990
  },
  "tb_link": {
    "h": 798,
    "w": 990
  },
  "tb_reference": {
    "h": 798,
    "w": 990
  },
  "tb_sequence": {
    "h": 798,
    "w": 990
  },
  "tb_summary": {
    "h": 798,
    "w": 990
  },
  "tb_vocab_exam": {
    "h": 798,
    "w": 990
  },
  "tf": {
    "h": 798,
    "w": 990
  },
  "vocab_choice": {
    "h": 798,
    "w": 990
  },
  "vocab_fix": {
    "h": 798,
    "w": 990
  },
  "word_order_writing": {
    "h": 798,
    "w": 990
  }
};

const QG: Record<string, { file: string; w: number; h: number }> = {
  "content_count:en:high:일치개수": {
    "file": "qg-01",
    "h": 804,
    "w": 708
  },
  "content_count:en:low:일치개수": {
    "file": "qg-02",
    "h": 972,
    "w": 738
  },
  "content_count:ko:high:일치개수": {
    "file": "qg-03",
    "h": 970,
    "w": 708
  },
  "content_count:ko:low:일치개수": {
    "file": "qg-04",
    "h": 1030,
    "w": 708
  },
  "content_false:en:high:내용불일치": {
    "file": "qg-05",
    "h": 860,
    "w": 738
  },
  "content_false:en:low:내용불일치": {
    "file": "qg-06",
    "h": 1010,
    "w": 708
  },
  "content_false:ko:high:내용불일치": {
    "file": "qg-07",
    "h": 876,
    "w": 708
  },
  "content_false:ko:low:내용불일치": {
    "file": "qg-08",
    "h": 806,
    "w": 738
  },
  "content_true:en:high:내용일치": {
    "file": "qg-09",
    "h": 1040,
    "w": 708
  },
  "content_true:en:low:내용일치": {
    "file": "qg-10",
    "h": 806,
    "w": 738
  },
  "content_true:ko:high:내용일치": {
    "file": "qg-11",
    "h": 776,
    "w": 738
  },
  "content_true:ko:low:내용일치": {
    "file": "qg-12",
    "h": 842,
    "w": 738
  },
  "grammar:na:default:어법개수": {
    "file": "qg-13",
    "h": 844,
    "w": 738
  },
  "grammar:na:default:어법문장오류수정": {
    "file": "qg-14",
    "h": 682,
    "w": 738
  },
  "grammar:na:default:어법오류수정2": {
    "file": "qg-15",
    "h": 954,
    "w": 738
  },
  "grammar:na:default:어법오류수정3": {
    "file": "qg-16",
    "h": 682,
    "w": 738
  },
  "grammar:na:default:어법추론": {
    "file": "qg-17",
    "h": 540,
    "w": 738
  },
  "grammar:na:default:어법통문장": {
    "file": "qg-18",
    "h": 740,
    "w": 738
  },
  "grammar:na:high:어법개수": {
    "file": "qg-19",
    "h": 638,
    "w": 738
  },
  "irrelevant_sentence:na:high:무관한문장": {
    "file": "qg-20",
    "h": 778,
    "w": 708
  },
  "irrelevant_sentence:na:low:무관한문장": {
    "file": "qg-21",
    "h": 708,
    "w": 738
  },
  "order:na:high:순서추론": {
    "file": "qg-22",
    "h": 972,
    "w": 708
  },
  "order:na:low:순서추론": {
    "file": "qg-23",
    "h": 938,
    "w": 738
  },
  "sentence_blank:en:default:답변가능개수": {
    "file": "qg-24",
    "h": 1188,
    "w": 738
  },
  "sentence_blank:en:default:비유대응": {
    "file": "qg-25",
    "h": 974,
    "w": 738
  },
  "sentence_blank:en:default:빈칸단어": {
    "file": "qg-26",
    "h": 842,
    "w": 738
  },
  "sentence_blank:en:default:사례분류": {
    "file": "qg-27",
    "h": 1132,
    "w": 738
  },
  "sentence_blank:en:default:연결어빈칸": {
    "file": "qg-28",
    "h": 944,
    "w": 738
  },
  "sentence_blank:en:high:빈칸추론": {
    "file": "qg-29",
    "h": 1014,
    "w": 708
  },
  "sentence_blank:en:high:요약완성AB": {
    "file": "qg-30",
    "h": 954,
    "w": 738
  },
  "sentence_blank:en:low:빈칸추론": {
    "file": "qg-31",
    "h": 904,
    "w": 738
  },
  "sentence_blank:en:mid:요약완성AB": {
    "file": "qg-32",
    "h": 1124,
    "w": 708
  },
  "sentence_insertion:na:high:문장삽입": {
    "file": "qg-33",
    "h": 556,
    "w": 708
  },
  "sentence_insertion:na:low:문장삽입": {
    "file": "qg-34",
    "h": 792,
    "w": 738
  },
  "summary_mcq:ko:high:요지추론": {
    "file": "qg-35",
    "h": 872,
    "w": 738
  },
  "summary_mcq:ko:low:요지추론": {
    "file": "qg-36",
    "h": 996,
    "w": 738
  },
  "summary_short:na:default:요약문빈칸2단어": {
    "file": "qg-37",
    "h": 1106,
    "w": 738
  },
  "summary_short:na:default:요약문빈칸3단어": {
    "file": "qg-38",
    "h": 1108,
    "w": 738
  },
  "summary_short:na:default:요약문빈칸영작": {
    "file": "qg-39",
    "h": 1056,
    "w": 738
  },
  "summary_short:na:default:요약표빈칸단어": {
    "file": "qg-40",
    "h": 1402,
    "w": 708
  },
  "title:en:high:제목추론": {
    "file": "qg-41",
    "h": 728,
    "w": 738
  },
  "title:en:low:제목추론": {
    "file": "qg-42",
    "h": 874,
    "w": 738
  },
  "title:ko:high:제목추론": {
    "file": "qg-43",
    "h": 774,
    "w": 708
  },
  "title:ko:low:제목추론": {
    "file": "qg-44",
    "h": 842,
    "w": 738
  },
  "topic:en:high:주제추론": {
    "file": "qg-45",
    "h": 792,
    "w": 738
  },
  "topic:en:low:주제추론": {
    "file": "qg-46",
    "h": 938,
    "w": 708
  },
  "topic:ko:high:주제추론": {
    "file": "qg-47",
    "h": 1036,
    "w": 738
  },
  "topic:ko:low:주제추론": {
    "file": "qg-48",
    "h": 842,
    "w": 738
  },
  "underlined_inference:en:default:목적추론": {
    "file": "qg-49",
    "h": 1098,
    "w": 738
  },
  "underlined_inference:en:default:심경추론": {
    "file": "qg-50",
    "h": 844,
    "w": 738
  },
  "underlined_inference:en:default:함축의미추론": {
    "file": "qg-51",
    "h": 910,
    "w": 738
  },
  "vocabulary:na:default:어휘개수": {
    "file": "qg-52",
    "h": 742,
    "w": 738
  },
  "vocabulary:na:default:어휘추론": {
    "file": "qg-53",
    "h": 712,
    "w": 738
  },
  "writing:na:default:구문변환": {
    "file": "qg-54",
    "h": 836,
    "w": 738
  },
  "writing:na:default:내용매칭": {
    "file": "qg-55",
    "h": 1526,
    "w": 738
  },
  "writing:na:default:대화문완성": {
    "file": "qg-56",
    "h": 1170,
    "w": 738
  },
  "writing:na:default:문법조건영작": {
    "file": "qg-57",
    "h": 1070,
    "w": 708
  },
  "writing:na:default:어휘빈칸공통": {
    "file": "qg-58",
    "h": 952,
    "w": 738
  },
  "writing:na:default:제시어배열기본": {
    "file": "qg-59",
    "h": 1016,
    "w": 738
  },
  "writing:na:default:제시어배열단어추가": {
    "file": "qg-60",
    "h": 944,
    "w": 708
  },
  "writing:na:default:제시어배열어형변화": {
    "file": "qg-61",
    "h": 1070,
    "w": 708
  },
  "writing:na:default:주제문작성": {
    "file": "qg-62",
    "h": 1022,
    "w": 738
  },
  "writing:na:default:지칭대명사서술": {
    "file": "qg-63",
    "h": 578,
    "w": 738
  },
  "writing:na:default:특정표현의미서술": {
    "file": "qg-64",
    "h": 778,
    "w": 738
  }
};

/** 워크북 유형(id) 미리보기 */
export function workbookTypePreview(id: string): TypePreviewShot | null {
  const s = WORKBOOK[id];
  return s ? { src: `/type-previews/workbook/${id}.jpg`, ...s } : null;
}

/**
 * 변형문제 유형(option_key) 미리보기. 그 키로 만든 문항이 없으면 같은 유형 코드의 다른 키 그림을 쓴다
 * (하·상, 영·한만 다른 것).
 */
export function questionTypePreview(key: string | null | undefined): TypePreviewShot | null {
  const k = String(key ?? "");
  const code = k.split(":").pop() ?? "";
  const hit = QG[k] ?? Object.entries(QG).find(([other]) => other.split(":").pop() === code && other.split(":")[0] === k.split(":")[0])?.[1];
  return hit ? { src: `/type-previews/qg/${hit.file}.jpg`, w: hit.w, h: hit.h } : null;
}
