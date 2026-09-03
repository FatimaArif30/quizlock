-- =====================================================================
--  QuizLock — database schema
--  Run this ONCE in your Supabase project:
--  Supabase dashboard -> SQL Editor -> New query -> paste all -> Run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- TABLES ----------------------------------------------------

create table if not exists quizzes (
  id                    uuid primary key default gen_random_uuid(),
  teacher_id            uuid not null references auth.users(id) on delete cascade,
  title                 text not null,
  num_students          int  not null default 1,
  questions_per_student int  not null default 1,
  duration_minutes      int  not null default 30,
  allowed_types         text[] not null default '{mcq,text,code}',
  pass_score            int,                 -- passing percent (null = no pass/fail)
  show_results          boolean not null default false,
  is_open               boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists questions (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references quizzes(id) on delete cascade,
  type         text not null check (type in ('mcq','text','code')),
  prompt       text not null,
  options      jsonb not null default '[]',   -- for mcq: [{"key":"A","text":"..."}]
  correct_key  text,                          -- for mcq: the correct option key
  points       int  not null default 1,
  created_at   timestamptz not null default now()
);

create table if not exists students (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references quizzes(id) on delete cascade,
  name           text not null,
  email          text not null,
  student_id_txt text,
  token          text not null default encode(gen_random_bytes(16),'hex'),
  status         text not null default 'registered'
                   check (status in ('registered','in_progress','submitted','blocked')),
  allowed        boolean not null default true,
  warnings       int not null default 0,
  score          numeric,
  total_points   int,
  camera_url     text,
  screen_url     text,
  started_at     timestamptz,
  submitted_at   timestamptz,
  submit_reason  text,
  created_at     timestamptz not null default now()
);
-- Identity by Student ID: one ID can take a quiz once (reusable across quizzes).
create unique index if not exists students_quiz_sid_idx
  on students (quiz_id, lower(student_id_txt)) where student_id_txt is not null;

create table if not exists assignments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  ord         int not null default 0,
  unique (question_id),               -- a question is used by ONE student -> uniqueness
  unique (student_id, question_id)
);

create table if not exists answers (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  response    text,
  is_correct  boolean,
  awarded     numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, question_id)
);

-- ---------- ROW LEVEL SECURITY ---------------------------------------
-- Teachers (logged in) manage their own quizzes. Students are anonymous
-- and NEVER touch tables directly — they only call the functions below.

alter table quizzes    enable row level security;
alter table questions  enable row level security;
alter table students   enable row level security;
alter table assignments enable row level security;
alter table answers    enable row level security;

drop policy if exists quizzes_owner on quizzes;
create policy quizzes_owner on quizzes
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists questions_owner on questions;
create policy questions_owner on questions
  for all using (exists (select 1 from quizzes q where q.id = questions.quiz_id and q.teacher_id = auth.uid()))
  with check (exists (select 1 from quizzes q where q.id = questions.quiz_id and q.teacher_id = auth.uid()));

drop policy if exists students_owner on students;
create policy students_owner on students
  for all using (exists (select 1 from quizzes q where q.id = students.quiz_id and q.teacher_id = auth.uid()))
  with check (exists (select 1 from quizzes q where q.id = students.quiz_id and q.teacher_id = auth.uid()));

drop policy if exists assignments_owner on assignments;
create policy assignments_owner on assignments
  for all using (exists (select 1 from students s join quizzes q on q.id = s.quiz_id
                         where s.id = assignments.student_id and q.teacher_id = auth.uid()));

drop policy if exists answers_owner on answers;
create policy answers_owner on answers
  for all using (exists (select 1 from students s join quizzes q on q.id = s.quiz_id
                         where s.id = answers.student_id and q.teacher_id = auth.uid()));

-- ---------- STUDENT-FACING FUNCTIONS (SECURITY DEFINER) --------------
-- These run with elevated rights but each checks a per-student token,
-- and none of them ever return the correct answer to the browser.

-- Register a student for a quiz and assign a UNIQUE set of questions.
create or replace function register_student(
  p_quiz_id uuid, p_name text, p_email text, p_student_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_quiz quizzes;
  v_student students;
  v_needed int;
  v_available int;
  v_sid text;
begin
  v_sid := nullif(trim(p_student_id), '');
  if v_sid is null then return json_build_object('error','student_id_required'); end if;

  select * into v_quiz from quizzes where id = p_quiz_id;
  if v_quiz.id is null then
    return json_build_object('error','quiz_not_found');
  end if;
  if v_quiz.is_open = false then
    return json_build_object('error','quiz_closed');
  end if;

  select * into v_student from students
    where quiz_id = p_quiz_id and lower(student_id_txt) = lower(v_sid);

  if v_student.id is not null then
    if v_student.status = 'submitted' then
      return json_build_object('error','already_submitted');
    end if;
    if v_student.status = 'blocked' and v_student.allowed = false then
      return json_build_object('error','blocked');
    end if;
    -- reuse existing registration
  else
    insert into students (quiz_id, name, email, student_id_txt)
      values (p_quiz_id, p_name, p_email, v_sid)
      returning * into v_student;
  end if;

  -- assign unique questions if this student has none yet
  v_needed := v_quiz.questions_per_student;
  if not exists (select 1 from assignments where student_id = v_student.id) then
    select count(*) into v_available from questions
      where quiz_id = p_quiz_id
      and id not in (select question_id from assignments a
                     join students s on s.id = a.student_id where s.quiz_id = p_quiz_id);
    if v_available < v_needed then
      return json_build_object('error','not_enough_questions',
                               'available', v_available, 'needed', v_needed);
    end if;

    insert into assignments (student_id, question_id, ord)
    select v_student.id, q.id, row_number() over ()
    from (
      select id from questions
      where quiz_id = p_quiz_id
        and id not in (select question_id from assignments a
                       join students s on s.id = a.student_id where s.quiz_id = p_quiz_id)
      order by random()
      limit v_needed
      for update skip locked
    ) q;
  end if;

  return json_build_object(
    'student_id', v_student.id,
    'token', v_student.token,
    'status', v_student.status,
    'quiz_title', v_quiz.title,
    'duration_minutes', v_quiz.duration_minutes);
end $$;

-- Load a student's questions (correct answers stripped out).
create or replace function get_quiz_for_student(p_student_id uuid, p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_student students;
  v_quiz quizzes;
  v_questions json;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  if v_student.status = 'submitted' then return json_build_object('error','already_submitted'); end if;

  select * into v_quiz from quizzes where id = v_student.quiz_id;

  if v_student.status = 'registered' then
    update students set status='in_progress',
      started_at = coalesce(started_at, now()) where id = v_student.id
      returning * into v_student;
  end if;

  select json_agg(row_to_json(x) order by x.ord) into v_questions from (
    select a.ord, q.id, q.type, q.prompt, q.options, q.points,
           (select response from answers an where an.student_id=v_student.id and an.question_id=q.id) as response
    from assignments a join questions q on q.id = a.question_id
    where a.student_id = v_student.id
  ) x;

  return json_build_object(
    'quiz_title', v_quiz.title,
    'duration_minutes', v_quiz.duration_minutes,
    'started_at', v_student.started_at,
    'warnings', v_student.warnings,
    'questions', coalesce(v_questions,'[]'::json));
end $$;

-- Save (or update) one answer. Never reveals correctness.
create or replace function save_answer(p_student_id uuid, p_token text, p_question_id uuid, p_response text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student students;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  if v_student.status <> 'in_progress' then return json_build_object('error','not_active'); end if;
  if not exists (select 1 from assignments where student_id=p_student_id and question_id=p_question_id) then
    return json_build_object('error','not_your_question');
  end if;

  insert into answers (student_id, question_id, response)
    values (p_student_id, p_question_id, p_response)
  on conflict (student_id, question_id)
    do update set response = excluded.response, updated_at = now();

  return json_build_object('ok', true);
end $$;

-- Count a proctoring warning (tab switch / leaving fullscreen, etc.)
create or replace function record_warning(p_student_id uuid, p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student students; v_new int;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  update students set warnings = warnings + 1 where id = p_student_id returning warnings into v_new;
  return json_build_object('warnings', v_new);
end $$;

-- Store the uploaded recording URLs.
create or replace function set_recording_urls(p_student_id uuid, p_token text, p_camera text, p_screen text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student students;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  update students set camera_url = coalesce(p_camera, camera_url),
                      screen_url = coalesce(p_screen, screen_url)
    where id = p_student_id;
  return json_build_object('ok', true);
end $$;

-- Finish the quiz: grade MCQs, lock the attempt, return data for the email.
create or replace function finish_quiz(p_student_id uuid, p_token text, p_reason text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_student students; v_quiz quizzes; v_teacher_email text;
  v_score numeric; v_total int;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  if v_student.status = 'submitted' then
    return json_build_object('error','already_submitted');
  end if;

  -- grade multiple-choice answers (set is_correct + awarded points)
  update answers an set
      is_correct = (lower(coalesce(an.response,'')) = lower(coalesce(q.correct_key,'~none~'))),
      awarded = (case when lower(coalesce(an.response,'')) = lower(coalesce(q.correct_key,'~none~'))
                      then q.points else 0 end)
    from questions q
    where q.id = an.question_id and q.type = 'mcq' and an.student_id = p_student_id;

  select coalesce(sum(q.points),0) into v_total
    from assignments a join questions q on q.id = a.question_id
    where a.student_id = p_student_id;

  select coalesce(sum(coalesce(an.awarded,0)),0) into v_score
    from answers an where an.student_id = p_student_id;

  update students set status='submitted', submitted_at=now(),
      submit_reason = p_reason, score = v_score, total_points = v_total
    where id = p_student_id;

  select * into v_quiz from quizzes where id = v_student.quiz_id;
  select email into v_teacher_email from auth.users where id = v_quiz.teacher_id;

  return json_build_object(
    'student_name', v_student.name,
    'student_email', v_student.email,
    'teacher_email', v_teacher_email,
    'quiz_title', v_quiz.title,
    'score', v_score, 'total_points', v_total,
    'show_results', v_quiz.show_results, 'pass_score', v_quiz.pass_score,
    'camera_url', v_student.camera_url,
    'screen_url', v_student.screen_url);
end $$;

-- ---------- TEACHER FUNCTION -----------------------------------------
-- Give one student a fresh attempt (keeps their questions, clears answers).
create or replace function teacher_reallow_student(p_student_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select exists(
    select 1 from students s join quizzes q on q.id = s.quiz_id
    where s.id = p_student_id and q.teacher_id = auth.uid()
  ) into v_ok;
  if not v_ok then return json_build_object('error','not_allowed'); end if;

  delete from answers where student_id = p_student_id;
  update students set status='registered', allowed=true, warnings=0,
      score=null, total_points=null, started_at=null, submitted_at=null,
      submit_reason=null, camera_url=null, screen_url=null
    where id = p_student_id;
  return json_build_object('ok', true);
end $$;

-- Teacher grades one text/code answer; the student's score recomputes.
create or replace function teacher_grade_answer(p_answer_id uuid, p_awarded numeric)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student_id uuid; v_score numeric;
begin
  select an.student_id into v_student_id from answers an
    join students s on s.id = an.student_id
    join quizzes q on q.id = s.quiz_id
    where an.id = p_answer_id and q.teacher_id = auth.uid();
  if v_student_id is null then return json_build_object('error','not_allowed'); end if;

  update answers set awarded = p_awarded, is_correct = (coalesce(p_awarded,0) > 0)
    where id = p_answer_id;

  select coalesce(sum(coalesce(awarded,0)),0) into v_score
    from answers where student_id = v_student_id;
  update students set score = v_score where id = v_student_id;

  return json_build_object('score', v_score);
end $$;

-- ---------- GRANTS ----------------------------------------------------
grant execute on function register_student(uuid,text,text,text) to anon, authenticated;
grant execute on function get_quiz_for_student(uuid,text)       to anon, authenticated;
grant execute on function save_answer(uuid,text,uuid,text)      to anon, authenticated;
grant execute on function record_warning(uuid,text)             to anon, authenticated;
grant execute on function set_recording_urls(uuid,text,text,text) to anon, authenticated;
grant execute on function finish_quiz(uuid,text,text)           to anon, authenticated;
grant execute on function teacher_reallow_student(uuid)         to authenticated;
grant execute on function teacher_grade_answer(uuid,numeric)    to authenticated;

-- ---------- STORAGE (recordings bucket) ------------------------------
insert into storage.buckets (id, name, public)
  values ('recordings','recordings', false)
  on conflict (id) do nothing;

drop policy if exists recordings_upload on storage.objects;
create policy recordings_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'recordings');

drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings');

-- Done.
