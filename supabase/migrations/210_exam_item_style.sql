-- 내신 시험지 문항마다 「어떻게 냈는지」를 적어 둔다.
--
-- 선생님 지적(2026-11-25):
--  「동형모의고사는 그 학교 기출을 제대로 파악하는 게 정말 중요해. 유형과 개수만 맞추면 안 돼.」
--  「발곡고는 빈칸이 3문제쯤 나왔는데, 하나는 본문 그대로, 둘은 패러프레이징이었다.」
--  「난이도를 분석해서 맞아야 해. 지문 난이도도, 보기 난이도도.」
--
-- 지금까지 동형모의고사는 유형·상중하·시험지 전체 수준만 이어받았다. 아래 값은 문항마다
-- 분석 때 함께 적고, 동형모의고사를 만들 때 그 번호 문항에 그대로 넘긴다.
-- 예전 분석(값 없음)은 넘길 것이 없으니 예전처럼 만든다.

alter table public.school_exam_items
  -- 빈칸·요약 정답이 지문 표현 그대로인지(verbatim), 바꿔 말했는지(paraphrase), 일부만 같은지(partial). 해당 없으면 null
  add column if not exists answer_style text check (answer_style in ('verbatim', 'paraphrase', 'partial')),
  -- 오답 보기를 만든 방법 한 마디(예: 본문 낱말 재활용, 정답 반대말, 반쯤 맞는 말)
  add column if not exists distractor_method text,
  -- 원문 대비 지문 변형: none(그대로) / light(낱말 몇 개) / heavy(문장 추가·삭제·바꿔 쓰기) 와 짧은 설명
  add column if not exists passage_change text;

comment on column public.school_exam_items.choice_avg_words is
  '선택지 다섯 개의 평균 낱말 수(분석 모델이 센 값, 2026-11-25부터 채움).';
comment on column public.school_exam_items.vocab_level is
  '선택지 어휘 수준 한 마디(2026-11-25부터 채움).';
comment on column public.school_exam_items.level_reason is
  '선택지 구문·추상도·오답 매력도 한 문장(2026-11-25부터 채움).';
