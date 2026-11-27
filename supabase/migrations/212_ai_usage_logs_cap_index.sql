-- 212: 하루 호출 수 세기(ai_usage_logs: 학원·자리·시각)가 빠르게 (2026-11-28)
-- 쓰기를 막지 않도록 CONCURRENTLY — 트랜잭션 밖에서 한 문장씩 실행할 것
create index concurrently if not exists ai_usage_logs_academy_used_for_created_idx
  on public.ai_usage_logs (academy_id, used_for, created_at);
create index concurrently if not exists ai_usage_logs_project_id_idx
  on public.ai_usage_logs (project_id);
