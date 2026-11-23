/**
 * 유형마다 "이렇게 생긴 문제가 나옵니다" 예시.
 * 선생님 요청(2026-09-20): 변형문제에서 유형에 마우스를 올리면 어떤 모양의 문제인지 보이게.
 *
 * 문제 모양만 보면 되므로 지문은 짧은 예시 한 토막으로 통일한다.
 */
export type TypeSample = {
  /** 유형 이름 */
  name: string;
  /** 시험지에 나가는 지시문 */
  stem: string;
  /** 문제 모양 한 줄 설명 */
  shape: string;
  /** 예시 본문·보기 (줄 단위) */
  lines: string[];
  /** 난이도 하·상이 있는 유형은 무엇이 달라지는지 */
  levels?: { low: string; high: string };
  /** 난이도 칸이 없는 유형에 다는 한 줄 */
  levelNote?: string;
};

/** 고른 난이도(하·상·없음) */
export type SampleLevel = "low" | "high" | null;

const PASSAGE = "Curiosity is what keeps a reader turning pages.";

const SAMPLES: Record<string, TypeSample> = {
  어법추론: {
    name: "어법 추론",
    stem: "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?",
    shape: "지문 안에 밑줄 ⓐ~ⓔ 다섯 곳, 그중 틀린 곳 하나 고르기",
    lines: [
      "… a habit that ⓐ<u>keep</u> readers ⓑ<u>turning</u> pages,",
      "even when the story ⓒ<u>is</u> slow, ⓓ<u>which</u> they ⓔ<u>enjoy</u>.",
      "정답은 밑줄 기호(①=ⓐ … ⑤=ⓔ)로 고릅니다.",
    ],
    levelNote: "어법·어휘는 상·하 칸이 없어요. 위쪽 '전체 난이도'(내신·학력평가)를 따라 어려워집니다.",
  },
  어법개수: {
    name: "어법 개수",
    stem: "다음 글의 밑줄 친 부분 중, 어법상 틀린 것의 개수는?",
    shape: "밑줄 ⓐ~ⓕ 여섯 곳, 틀린 곳이 몇 개인지 고르기",
    lines: ["① 1개  ② 2개  ③ 3개  ④ 4개  ⑤ 5개"],
    levelNote: "밑줄이 하나 더 늘어 어법 추론보다 어렵습니다.",
  },
  어휘추론: {
    name: "어휘 추론",
    stem: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?",
    shape: "밑줄 다섯 곳 가운데 문맥에 맞지 않는 낱말 하나 고르기",
    lines: ["… curiosity ⓐ<u>fades</u> when every answer is ⓑ<u>given</u> in advance …"],
    levelNote: "어법·어휘는 상·하 칸이 없어요. 위쪽 '전체 난이도'를 따라 어려워집니다.",
  },
  어휘개수: {
    name: "어휘 개수",
    stem: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것의 개수는?",
    shape: "밑줄 여섯 곳 가운데 문맥에 맞지 않는 낱말이 몇 개인지 고르기",
    lines: ["① 1개  ② 2개  ③ 3개  ④ 4개  ⑤ 5개"],
    levelNote: "밑줄이 하나 더 늘어 어휘 추론보다 어렵습니다.",
  },
  내용일치: {
    name: "내용 일치",
    stem: "윗글의 내용과 일치하는 것은?",
    shape: "지문 내용과 맞는 선택지 하나 고르기 (영어 또는 한글 선택지)",
    lines: [
      "① Readers stop when they lose curiosity.",
      "② Curiosity grows only from long books.",
      "…  ⑤ Writers hide every answer on purpose.",
    ],
    levels: {
      low: "선택지가 지문 표현에 가까워 찾아 대조하면 풀립니다.",
      high: "다섯 선택지 모두 바꿔 쓴 표현이라 뜻으로 대조해야 합니다.",
    },
  },
  내용불일치: {
    name: "내용 불일치",
    stem: "윗글의 내용과 일치하지 않는 것은?",
    shape: "지문과 어긋나는 선택지 하나 고르기",
    lines: ["다섯 선택지 모두 지문 내용을 바꿔 쓴 문장, 그중 하나만 사실과 다릅니다."],
    levels: {
      low: "틀린 선택지가 뚜렷하게 어긋납니다.",
      high: "틀린 선택지도 지문 낱말을 그대로 쓰고 관계만 살짝 바꿉니다.",
    },
  },
  일치개수: {
    name: "일치 개수",
    stem: "다음 글을 읽고 <보기> 중 글의 내용과 일치하지 않는 것의 개수를 적으시오.",
    shape: "<보기> 문장 여러 개 가운데 틀린 것이 몇 개인지 세기",
    lines: ["<보기> (a) … (b) … (c) … (d) …", "① 1개  ② 2개  ③ 3개  ④ 4개  ⑤ 5개"],
    levels: {
      low: "<보기> 진술이 지문 표현에 가깝습니다.",
      high: "<보기> 진술을 모두 바꿔 써서 하나하나 대조해야 합니다.",
    },
  },
  순서추론: {
    name: "순서 배열",
    stem: "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?",
    shape: "주어진 글 뒤에 (A)(B)(C) 세 덩어리를 놓는 차례 고르기",
    lines: ["① (A)-(C)-(B)  ② (B)-(A)-(C)  ③ (B)-(C)-(A)  ④ (C)-(A)-(B)  ⑤ (C)-(B)-(A)"],
    levels: {
      low: "지시문과 (A)(B)(C) 덩어리가 지문 그대로입니다.",
      high: "지시문을 바꿔 써서 연결어·지칭어로만 차례를 찾아야 합니다.",
    },
  },
  빈칸추론: {
    name: "빈칸 추론",
    stem: "윗글의 빈칸에 들어갈 말로 알맞은 것은?",
    shape: "글의 요지를 떠받치는 자리를 빈칸으로 두고, 들어갈 말 고르기",
    lines: [
      "Curiosity is what ______________________________.",
      "① keeps a reader turning pages",
      "② makes every answer predictable",
      "…  ⑤ replaces the writer's own voice",
    ],
    levels: {
      low: "정답 선택지가 지문 표현에 가깝습니다.",
      high: "다섯 선택지 모두 바꿔 쓴 표현이라 글 전체를 읽어야 풀립니다.",
    },
  },
  문장삽입: {
    name: "문장 삽입",
    stem: "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?",
    shape: "빼낸 문장을 <보기>로 주고, 지문 안 ①~⑤ 자리 중 제자리 찾기",
    lines: ["<보기> But that pull disappears once nothing is left to wonder about.", "… ① … ② … ③ … ④ … ⑤ …"],
    levels: {
      low: "빼낸 문장이 지문 그대로라 이어지는 말이 눈에 띕니다.",
      high: "빼낸 문장을 바꿔 써서 지칭어·연결어로만 자리를 찾습니다.",
    },
  },
  무관한문장: {
    name: "무관한 문장",
    stem: "다음 글의 전체 흐름과 가장 관계없는 문장은?",
    shape: "지문 문장 다섯 개에 ①~⑤를 달고, 흐름에서 벗어난 문장 고르기",
    lines: ["① … ② … ③ 다른 화제로 빠진 문장 … ④ … ⑤ …"],
    levels: {
      low: "무관한 문장이 주제에서 뚜렷하게 벗어납니다.",
      high: "낱말은 지문과 비슷하고 말하려는 바만 달라 헷갈립니다.",
    },
  },
  함축의미추론: {
    name: "함축 의미",
    stem: "다음 글의 밑줄 친 (A)가 의미하는 바로 가장 적절한 것은?",
    shape: "문맥에서만 뜻이 살아나는 표현에 밑줄, 그 뜻을 영어 선택지로 고르기",
    lines: [
      "… readers (A)<u>turn pages in the dark</u> …",
      "① keep going without knowing what comes next",
      "…  ⑤ read only at night for comfort (직역은 오답)",
    ],
  },
  목적추론: {
    name: "목적",
    stem: "윗글의 목적으로 알맞은 것은?",
    shape: "글을 쓴 목적을 고르기 (편지·안내문에 자주 나옵니다)",
    lines: ["① To invite …  ② To complain about …  …  ⑤ To apologize for …"],
  },
  심경추론: {
    name: "심경·분위기",
    stem: "윗글에 드러난 심경 변화로 알맞은 것은?",
    shape: "앞뒤 심경 변화를 두 낱말 짝으로 고르기",
    lines: ["① worried → relieved  ② bored → excited  …  ⑤ proud → ashamed"],
  },
  요약완성AB: {
    name: "요약문 완성 (A)(B)",
    stem: "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?",
    shape: "글 전체를 한 문장으로 줄인 요약문의 두 빈칸에 들어갈 낱말 쌍 고르기 (수능 40번형)",
    lines: ["Although following light was once a(n) (A) method …, modern lights have made it (B).", "① accidental …… effective  ② reliable …… harmful  …"],
    levels: {
      low: "정답 낱말이 지문 표현과 가깝습니다.",
      high: "정답 낱말을 바꿔 쓰고, 뜻이 가까운 오답 낱말을 섞습니다.",
    },
  },
  빈칸단어: {
    name: "빈칸 (단어)",
    stem: "다음 빈칸에 들어갈 말로 가장 적절한 것은?",
    shape: "글의 핵심 낱말 하나를 비우고 영어 한 낱말 보기 다섯에서 고르기",
    lines: ["… Childhood gives ________ in a changing world.", "① flexibility  ② stability  ③ isolation  ④ instinct  ⑤ discipline"],
  },
  답변가능개수: {
    name: "답변 가능 질문 개수",
    stem: "<보기>의 질문들 중 다음 글을 읽고 답할 수 있는 질문의 개수는?",
    shape: "영어 질문 ⓐ~ⓖ 일곱 개 가운데 글에 답이 있는 것을 세기",
    lines: ["ⓐ What happens to children labeled as smart?  ⓑ In which year did …?  …", "① 2개  ② 3개  ③ 4개  ④ 5개  ⑤ 6개"],
  },
  사례분류: {
    name: "사례 분류",
    stem: "다음 글의 내용을 바탕으로 할 때, 사례 ①~⑤ 중 나머지 넷과 성격이 다른 것은?",
    shape: "글의 개념에 비추어 영어 사례 다섯 가운데 다른 편에 선 하나 고르기",
    lines: ["① A designer uses an AI tool to brainstorm but refines every detail by hand.", "② A newspaper replaces its journalists with an AI writer.  …"],
  },
  어법통문장: {
    name: "어법 (통문장)",
    stem: "다음 글의 밑줄 친 문장 중, 어법상 적절하지 않은 것은?",
    shape: "지문 속 밑줄 친 문장 다섯 가운데 어법이 틀린 문장 하나 고르기",
    lines: ["ⓐ <u>Many animals save food for the future.</u> … ⓓ <u>The agent give up some pleasure.</u> …"],
  },
  어휘빈칸공통: {
    name: "어휘 빈칸 (공통 한 단어)",
    stem: "다음 글의 빈칸 ⓐ, ⓑ에 공통으로 들어갈 말을 1단어의 영어로 쓰시오.",
    shape: "지문에 두 번 나오는 핵심어 자리를 비우고 같은 한 낱말 쓰기",
    lines: ["… the king's love for his ⓐ________ … to care for the ⓑ________ …", "ⓐ : people  ⓑ : people"],
  },
  주제문작성: {
    name: "주제문 작성",
    stem: "다음 글의 주제를 <조건>에 맞게 영어로 작성하시오.",
    shape: "<보기> 단어를 모두 써서 글의 주제를 정해진 낱말 수의 명사구로 쓰기",
    lines: ["<보기> functions / analogies / dual / philosophy / in / …", "주제 : dual functions of analogies in philosophy …"],
  },
  구문변환: {
    name: "구문 변환",
    stem: "다음 글의 밑줄 친 부분을 <조건>에 맞게 바꾸어 쓰시오.",
    shape: "밑줄 친 문장을 조건(능동↔수동·주어·시제)대로 바꿔 쓰기",
    lines: ["ⓐ <u>Greater importance is attached to …</u>", "<조건> 주어 they · 능동태 · 시제 유지"],
  },
  대화문완성: {
    name: "대화문 완성",
    stem: "다음은 윗글을 읽고 나눈 대화이다. 빈칸 ⓐ, ⓑ에 들어갈 말을 <조건>에 맞게 본문에서 찾아 쓰시오.",
    shape: "글을 두고 나눈 대화의 빈칸을 본문 어구로 채우기",
    lines: ["A: Why did the students do poorly?", "B: Because of their ⓐ__________, not reading skill."],
  },
  내용매칭: {
    name: "내용 매칭",
    stem: "다음 글의 내용을 읽고, ⓐ, ⓑ에 해당하는 가장 적절한 예시를 <보기>에서 찾아 그 번호를 쓰시오.",
    shape: "글의 두 개념에 맞는 예시 문장을 <보기> ①~⑤에서 골라 번호 쓰기",
    lines: ["<보기> ① A teacher … ② Schools … ⑤ A student's grade …", "ⓐ : ③  ⓑ : ⑤"],
  },
  연결어빈칸: {
    name: "연결어 빈칸",
    stem: "윗글의 빈칸 (A), (B)에 들어갈 알맞은 말로 연결된 것은?",
    shape: "연결어 두 자리를 비우고, 짝으로 된 선택지에서 고르기",
    lines: ["① However …… Therefore", "② For example …… In contrast", "…  ⑤ Moreover …… Nevertheless"],
  },
  제목추론: {
    name: "제목",
    stem: "다음 글의 제목으로 가장 적절한 것을 고르시오.",
    shape: "글 전체를 담은 제목 고르기 (영어 또는 한글 선택지)",
    lines: ["① What Keeps Us Reading", "② Why Long Books Sell Better", "…  ⑤ The History of Printing"],
    levels: {
      low: "정답 제목이 지문 표현을 그대로 씁니다.",
      high: "다섯 제목 모두 바꿔 쓴 표현이고, 비슷한 오답이 둘 이상입니다.",
    },
  },
  주제추론: {
    name: "주제",
    stem: "다음 글의 주제로 가장 적절한 것을 고르시오.",
    shape: "글이 다루는 내용을 명사구로 고르기",
    lines: ["① the role of curiosity in reading", "…  ⑤ the decline of printed books"],
    levels: {
      low: "정답이 지문 표현에 가깝습니다.",
      high: "모두 바꿔 쓴 표현이라 글 전체의 요지로 갈라야 합니다.",
    },
  },
  요지추론: {
    name: "요지",
    stem: "다음 글의 요지로 가장 적절한 것을 고르시오.",
    shape: "필자가 하려는 말을 한 문장으로 고르기 (한글 선택지)",
    lines: ["① 궁금증이 남아 있어야 독자가 계속 읽는다.", "…  ⑤ 책은 길수록 몰입이 잘 된다."],
    levels: {
      low: "정답이 지문 문장과 가깝습니다.",
      high: "선택지가 모두 그럴듯해 필자의 주장과 글 속 통념을 갈라야 합니다.",
    },
  },
  제시어배열기본: {
    name: "제시어 배열 · 기본",
    stem: "밑줄 친 ⓐ의 우리말 해석에 맞도록 <보기>의 단어들을 알맞게 배열하여 문장을 완성하시오.",
    shape: "서술형. <보기> 낱말을 순서대로 늘어놓아 문장 쓰기",
    lines: ["<보기> keeps / what / turning / a reader / is / pages", "→ ______________________________"],
  },
  제시어배열어형변화: {
    name: "제시어 배열 · 어형 변화",
    stem: "<보기>의 표현만을 모두 한 번씩 사용하여 주어진 문장을 완성하시오.",
    shape: "서술형. 배열하면서 낱말의 형태(시제·수·태)까지 고쳐 쓰기",
    lines: ["<보기> keep / reader / turn / page  (형태를 알맞게 바꿀 것)"],
  },
  제시어배열단어추가: {
    name: "제시어 배열 · 단어 추가",
    stem: "밑줄 친 ⓐ의 우리말 해석에 맞도록 <보기>의 단어를 활용하여 문장을 완성하시오.",
    shape: "서술형. <보기>에 없는 말(관사·전치사 등)을 더 넣어 문장 쓰기",
    lines: ["<보기> curiosity / keep / turn  (필요한 말을 더 넣어 쓸 것)"],
  },
  요약문빈칸영작: {
    name: "요약문 빈칸 · 영작",
    stem: "<보기>의 단어를 올바른 순서로 배열하여 요약문의 빈칸 ⓐ, ⓑ를 완성하시오.",
    shape: "서술형. 요약문 두 빈칸을 <보기> 낱말로 채우기",
    lines: ["요약문: Readers continue when ⓐ__________ , not when ⓑ__________ ."],
  },
  요약문빈칸2단어: {
    name: "요약문 빈칸 · 2단어",
    stem: "요약문의 빈칸에 들어갈 말을 본문에서 찾아 쓰시오.",
    shape: "서술형. 본문에 있는 연속된 두 낱말을 그대로 찾아 쓰기",
    lines: ["요약문: Curiosity keeps a reader __________ __________ ."],
  },
  요약문빈칸3단어: {
    name: "요약문 빈칸 · 3단어",
    stem: "요약문의 빈칸에 들어갈 말을 본문에서 찾아 쓰시오.",
    shape: "서술형. 본문에 있는 연속된 세 낱말을 그대로 찾아 쓰기",
    lines: ["요약문: What keeps a reader going is __________ __________ __________ ."],
  },
  요약표빈칸단어: {
    name: "요약표 빈칸 · 본문 단어",
    stem: "다음 글의 내용을 표로 정리하고자 할 때, 빈칸 (A), (B), (C)에 들어갈 말을 본문에서 찾아 각각 한 단어로 쓰시오.",
    shape: "서술형. 맞서는 두 부류를 표로 갈라 놓고, 빈칸을 본문 낱말로 채우기",
    lines: [
      "<조건> ○ 본문에서 찾아 쓸 것 ○ 각각 한 단어 ○ 본문 형태 그대로",
      "　　　　 | Event | Amina's response |",
      "Land　　 | Men began ____(A)____ and marking the ground. | She walked closer.",
      "Building | A school would be built for village children. | Her eyes ____(B)____ with joy.",
      "Distance | The nearest school was ____(C)____ away on foot. | She imagined learning.",
      "→ 답: (A) clearing / (B) school / (C) hours",
    ],
    levelNote: "두 갈래로 갈라 볼 수 없는 지문에서는 만들지 않고 건너뜁니다.",
  },
  문법조건영작: {
    name: "제시어 배열 · 지정 문법",
    stem: "다음 글의 빈칸 ⓐ에 들어갈 문장을 <조건>에 맞게 <보기>의 단어를 배열하여 완성하시오.",
    shape: "서술형. 지문에서 한 문장을 빼고, 그 문장을 정해 준 어법으로 써 넣기",
    lines: [
      "… A story slows, and the reader still turns the page.",
      "ⓐ__________________________________________",
      "Even a dull chapter keeps its hold for that reason.",
      "",
      "<조건> ○ It - that 강조구문을 사용할 것",
      "　　　 ○ <보기>에 있는 단어를 모두 한 번씩 사용할 것 (더하거나 빼지 말 것)",
      "　　　 ○ 필요하면 어형을 바꿔 쓸 것 (시제·수·태에 유의할 것)",
      "　　　 ○ 모두 9단어로 쓸 것  ○ 첫 글자는 대문자, 끝에는 마침표",
      "<보기> it / be / curiosity / that / keep / a / reader / turn / page",
      "<해석> 독자가 책장을 계속 넘기게 하는 것은 바로 호기심이다.",
      "→ 답: It is curiosity that keeps a reader turning pages.",
    ],
    levelNote:
      "지문에서 그 문장을 빼고 빈칸으로 둡니다. 지문에 실제로 쓰인 어법만 쓰고, 왼쪽에서 어법 범위를 좁힐 수 있어요.",
  },
  지칭대명사서술: {
    name: "지칭 · 대명사",
    stem: "밑줄 친 ⓐit이 가리키는 바를 본문에서 정확히 찾아 한 단어의 영어로 쓰시오.",
    shape: "서술형. 대명사가 가리키는 말을 본문에서 찾아 쓰기",
    lines: ["… ⓐ<u>it</u> keeps a reader turning pages.", "→ 답: curiosity"],
  },
  특정표현의미서술: {
    name: "지칭 · 특정 표현",
    stem: "밑줄 친 표현이 문맥상 의미하는 바를 본문에서 찾아 영어로 쓰시오.",
    shape: "서술형. 밑줄 표현과 같은 뜻인 구절을 본문에서 찾아 쓰기",
    lines: ["… <u>in the dark</u> …", "→ 답: without knowing what comes next"],
  },
  어법오류수정2: {
    name: "어법 수정 · 2개",
    stem: "밑줄 친 ⓐ~ⓔ 중, 어법상 틀린 곳을 모두 찾아 그 기호를 쓰고, 바르게 고치시오.",
    shape: "서술형. 틀린 밑줄 두 곳의 기호와 고친 형태를 쓰기",
    lines: ["ⓐ ________ → ________", "ⓑ ________ → ________"],
  },
  어법오류수정3: {
    name: "어법 수정 · 3개",
    stem: "밑줄 친 ⓐ~ⓖ 중, 어법상 틀린 곳을 모두 찾아 그 기호를 쓰고, 바르게 고치시오.",
    shape: "서술형. 밑줄 일곱 곳 가운데 틀린 세 곳을 고쳐 쓰기",
    lines: ["기호와 고친 형태를 세 줄에 나누어 씁니다."],
  },
  어법문장오류수정: {
    name: "어법 수정 · 문장",
    stem: "①~⑤ 중 어법상 틀린 문장의 번호를 모두 쓰고, 틀린 부분을 찾아 바르게 고치시오.",
    shape: "서술형. 문장 단위로 번호를 달고, 틀린 문장을 골라 고쳐 쓰기",
    lines: ["① … ② … ③ … ④ … ⑤ …", "→ 틀린 문장: ____ , 고친 부분: ____________"],
  },
};

/** option_key(…:어법추론)나 코드로 예시 찾기 */
export function typeSampleFor(key: string | null | undefined): TypeSample | null {
  const code = String(key ?? "").split(":").pop() ?? "";
  return SAMPLES[code] ?? null;
}

/** option_key에서 고른 난이도 읽기 (grammar:na:default:… 는 없음) */
export function sampleLevelFor(key: string | null | undefined): SampleLevel {
  const parts = String(key ?? "").split(":");
  const diff = parts.length >= 4 ? parts[2] : "";
  return diff === "low" ? "low" : diff === "high" ? "high" : null;
}

export { PASSAGE as TYPE_SAMPLE_PASSAGE };
