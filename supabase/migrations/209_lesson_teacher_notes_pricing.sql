-- 교사용·학생용 수업 화면의 교사용 해설(선생님 2026-11-10): 지문당 500.
-- 실측 원가 지문당 99~118원(gpt-5.6-sol 할인가). 지금은 정수학원만 켠 기능(lesson_class_view)이다.

begin;

insert into public.feature_pricing (feature_key, label, credit_cost, billing_type, is_active) values
  ('lesson_teacher_notes', '교사용 수업 해설 (지문당)', 500, 'per_use', true)
on conflict (feature_key) do update set
  label = excluded.label,
  credit_cost = excluded.credit_cost,
  billing_type = excluded.billing_type,
  is_active = excluded.is_active;

commit;
