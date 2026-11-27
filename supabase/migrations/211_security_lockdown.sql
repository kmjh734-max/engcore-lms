-- 211: 보안 잠금 (2026-11-28 코드 점검)
--  1) profiles: 본인이 역할·소속 학원·활성·승인 값을 바꾸지 못하게, 학원 관리자가 최고관리자를 만들지 못하게
--  2) 가입 트리거: 클라이언트가 보낸 role 을 믿지 않음(항상 student, 역할은 서버가 service role 로 맞춤)
--  3) 크레딧·결제 함수: anon / authenticated 실행 권한 회수(서버 service role 만)
--  4) 학원 구분 없는 「관리자 전부 허용」(is_admin) 규칙 22개를 학원 단위로

-- 붐비는 표에 잠금을 오래 기다리지 않게(기다리면 통째로 취소 → 다시 실행)
set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) profiles 보호 트리거
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- 서버(service role)·SQL 편집기·가입 트리거 등 사용자 세션이 없는 경로는 그대로 허용
  -- (anon 요청도 uid 가 null 이지만 profiles 에는 anon 쓰기 규칙이 없어 RLS 에서 먼저 막힌다)
  if v_uid is null or auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_super_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role not in ('teacher', 'student') then
      raise exception '권한이 없습니다. (역할)' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 최고관리자 행을 건드리거나 최고관리자로 올리는 것은 최고관리자만(위에서 이미 통과)
  if new.role = 'super_admin' or old.role = 'super_admin' then
    raise exception '권한이 없습니다. (역할)' using errcode = '42501';
  end if;

  if new.id = v_uid then
    -- 본인 행: 이름 등만 바꿀 수 있음(로그인 정보·소속·승인 값은 서버만)
    if new.role is distinct from old.role
       or new.academy_id is distinct from old.academy_id
       or new.is_active is distinct from old.is_active
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by
       or new.created_by is distinct from old.created_by
       or new.email is distinct from old.email
       or new.username is distinct from old.username then
      raise exception '권한이 없습니다. (계정 정보)' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 다른 사람 행(학원 관리자·선생님, 어느 행인지는 RLS 가 이미 제한)
  if new.role is distinct from old.role
     and (new.role not in ('teacher', 'student') or old.role not in ('teacher', 'student')) then
    raise exception '권한이 없습니다. (역할)' using errcode = '42501';
  end if;
  if new.academy_id is distinct from old.academy_id
     and not (old.academy_id is null and new.academy_id = public.current_user_academy_id()) then
    raise exception '권한이 없습니다. (소속 학원)' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_protected_columns on public.profiles;
create trigger profiles_guard_protected_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_protected_columns();

-- ---------------------------------------------------------------------------
-- 2) 가입 트리거: role 은 항상 student 로 시작
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 역할·학원은 서버(manage-user 의 syncProfileAfterAuthCreate, service role)가 바로 이어서 맞춘다.
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'student'
  )
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) 크레딧·결제 함수: 서버만
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'grant_academy_credits',
        'adjust_academy_credits',
        'debit_academy_credits',
        'debit_academy_credits_postpaid',
        'approve_credit_payment_order',
        'refund_credit_payment_order',
        'expire_academy_credits'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) 학원 단위 관리자 규칙
-- ---------------------------------------------------------------------------
-- 정책 안에서 한 번만 계산되도록(행마다 profiles 를 다시 읽지 않게) 집합을 돌려주는 도우미
create or replace function public.current_academy_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
  where p.academy_id is not null
    and p.academy_id = public.current_user_academy_id();
$$;

create or replace function public.current_academy_course_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.courses c
  where c.academy_id is not null
    and c.academy_id = public.current_user_academy_id();
$$;

revoke all on function public.current_academy_member_ids() from public, anon;
revoke all on function public.current_academy_course_ids() from public, anon;
grant execute on function public.current_academy_member_ids() to authenticated, service_role;
grant execute on function public.current_academy_course_ids() to authenticated, service_role;
-- 정책이 PUBLIC(anon 포함)에 걸리므로 anon 도 부를 수 있어야 한다(uid 가 없으면 빈 집합)
grant execute on function public.current_academy_member_ids() to anon;
grant execute on function public.current_academy_course_ids() to anon;

-- 강좌
alter policy "Admins full access lessons" on public.lessons
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and course_id in (select public.current_academy_course_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and course_id in (select public.current_academy_course_ids()))));
alter policy "Admins full access sections" on public.sections
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and course_id in (select public.current_academy_course_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and course_id in (select public.current_academy_course_ids()))));
alter policy "Admins read all lesson progress" on public.lesson_progress
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));

-- 학생 기록 (student_id)
alter policy "Admins manage listening_dictation_attempts" on public.listening_dictation_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage listening_exam_attempts" on public.listening_exam_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage vocab_example_attempts" on public.vocab_example_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage vocab_final_test_attempts" on public.vocab_final_test_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage vocab_set_sessions" on public.vocab_set_sessions
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage vocab_spelling_attempts" on public.vocab_spelling_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins manage vocab_stage_progress" on public.vocab_stage_progress
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins update vocab_progress" on public.vocab_progress
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins select vocab_progress" on public.vocab_progress
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins delete vocab_progress" on public.vocab_progress
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins select vocab_test_attempts" on public.vocab_test_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins delete vocab_test_attempts" on public.vocab_test_attempts
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins insert vocab_progress" on public.vocab_progress
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));
alter policy "Admins insert vocab_test_attempts" on public.vocab_test_attempts
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and student_id in (select public.current_academy_member_ids()))));

-- 답안 (attempt_id → 시도의 학생)
alter policy "Admins manage listening_exam_answers" on public.listening_exam_answers
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.listening_exam_attempts a where a.id = listening_exam_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.listening_exam_attempts a where a.id = listening_exam_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))));
alter policy "Admins manage vocab_final_test_answers" on public.vocab_final_test_answers
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.vocab_final_test_attempts a where a.id = vocab_final_test_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))))
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.vocab_final_test_attempts a where a.id = vocab_final_test_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))));
alter policy "Admins select vocab_test_answers" on public.vocab_test_answers
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.vocab_test_attempts a where a.id = vocab_test_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))));
alter policy "Admins insert vocab_test_answers" on public.vocab_test_answers
  with check (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.vocab_test_attempts a where a.id = vocab_test_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))));
alter policy "Admins delete vocab_test_answers" on public.vocab_test_answers
  using (((select public.is_super_admin()) or ((select public.is_academy_admin()) and exists (select 1 from public.vocab_test_attempts a where a.id = vocab_test_answers.attempt_id and a.student_id in (select public.current_academy_member_ids())))));

