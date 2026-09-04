-- =====================================================================
--  QuizLock v3 upgrade — run ONCE in Supabase -> SQL Editor.
--  Adds: True/False questions, availability window, assign-at-start
--  (stops the question-pool leak), and owner-scoped recording access.
-- =====================================================================

-- 1) True/False question type
alter table questions drop constraint if exists questions_type_check;
alter table questions add constraint questions_type_check
  check (type in ('mcq','truefalse','text','code'));

-- 2) Availability window (optional)
alter table quizzes add column if not exists opens_at  timestamptz;
alter table quizzes add column if not exists closes_at timestamptz;

-- 3) register_student — no longer assigns questions (that moves to start),
--    and it checks the availability window.
create or replace function register_student(
  p_quiz_id uuid, p_name text, p_email text, p_student_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_quiz quizzes; v_student students; v_sid text;
begin
  v_sid := nullif(trim(p_student_id), '');
  if v_sid is null then return json_build_object('error','student_id_required'); end if;

  select * into v_quiz from quizzes where id = p_quiz_id;
  if v_quiz.id is null then return json_build_object('error','quiz_not_found'); end if;
  if v_quiz.is_open = false then return json_build_object('error','quiz_closed'); end if;
  if v_quiz.opens_at is not null and now() < v_quiz.opens_at then return json_build_object('error','not_open_yet'); end if;
  if v_quiz.closes_at is not null and now() > v_quiz.closes_at then return json_build_object('error','quiz_closed'); end if;

  select * into v_student from students
    where quiz_id = p_quiz_id and lower(student_id_txt) = lower(v_sid);
  if v_student.id is not null then
    if v_student.status = 'submitted' then return json_build_object('error','already_submitted'); end if;
    if v_student.status = 'blocked' and v_student.allowed = false then return json_build_object('error','blocked'); end if;
  else
    insert into students (quiz_id, name, email, student_id_txt)
      values (p_quiz_id, p_name, p_email, v_sid) returning * into v_student;
  end if;

  return json_build_object('student_id', v_student.id, 'token', v_student.token,
    'status', v_student.status, 'quiz_title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes);
end $$;

-- 4) get_quiz_for_student — assigns the UNIQUE set here (at real start),
--    so a no-show who never begins no longer consumes questions.
create or replace function get_quiz_for_student(p_student_id uuid, p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student students; v_quiz quizzes; v_questions json; v_needed int; v_available int;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  if v_student.status = 'submitted' then return json_build_object('error','already_submitted'); end if;

  select * into v_quiz from quizzes where id = v_student.quiz_id;
  if v_quiz.closes_at is not null and now() > v_quiz.closes_at then return json_build_object('error','quiz_closed'); end if;

  if not exists (select 1 from assignments where student_id = v_student.id) then
    v_needed := v_quiz.questions_per_student;
    select count(*) into v_available from questions
      where quiz_id = v_quiz.id
      and id not in (select question_id from assignments a join students s on s.id = a.student_id where s.quiz_id = v_quiz.id);
    if v_available < v_needed then return json_build_object('error','not_enough_questions'); end if;
    insert into assignments (student_id, question_id, ord)
    select v_student.id, q.id, row_number() over ()
    from (
      select id from questions where quiz_id = v_quiz.id
        and id not in (select question_id from assignments a join students s on s.id = a.student_id where s.quiz_id = v_quiz.id)
      order by random() limit v_needed for update skip locked
    ) q;
  end if;

  if v_student.status = 'registered' then
    update students set status='in_progress', started_at = coalesce(started_at, now())
      where id = v_student.id returning * into v_student;
  end if;

  select json_agg(row_to_json(x) order by x.ord) into v_questions from (
    select a.ord, q.id, q.type, q.prompt, q.options, q.points,
           (select response from answers an where an.student_id=v_student.id and an.question_id=q.id) as response
    from assignments a join questions q on q.id = a.question_id where a.student_id = v_student.id
  ) x;

  return json_build_object('quiz_title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes,
    'started_at', v_student.started_at, 'warnings', v_student.warnings,
    'questions', coalesce(v_questions,'[]'::json));
end $$;

-- 5) finish_quiz — auto-grade True/False as well as MCQ
create or replace function finish_quiz(p_student_id uuid, p_token text, p_reason text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student students; v_quiz quizzes; v_teacher_email text; v_score numeric; v_total int;
begin
  select * into v_student from students where id = p_student_id and token = p_token;
  if v_student.id is null then return json_build_object('error','bad_token'); end if;
  if v_student.status = 'submitted' then return json_build_object('error','already_submitted'); end if;

  update answers an set
      is_correct = (lower(coalesce(an.response,'')) = lower(coalesce(q.correct_key,'~none~'))),
      awarded = (case when lower(coalesce(an.response,'')) = lower(coalesce(q.correct_key,'~none~'))
                      then q.points else 0 end)
    from questions q
    where q.id = an.question_id and q.type in ('mcq','truefalse') and an.student_id = p_student_id;

  select coalesce(sum(q.points),0) into v_total
    from assignments a join questions q on q.id = a.question_id where a.student_id = p_student_id;
  select coalesce(sum(coalesce(an.awarded,0)),0) into v_score
    from answers an where an.student_id = p_student_id;

  update students set status='submitted', submitted_at=now(),
      submit_reason = p_reason, score = v_score, total_points = v_total where id = p_student_id;

  select * into v_quiz from quizzes where id = v_student.quiz_id;
  return json_build_object('student_name', v_student.name, 'student_email', v_student.email,
    'teacher_email', (select email from auth.users where id = v_quiz.teacher_id),
    'quiz_title', v_quiz.title, 'score', v_score, 'total_points', v_total,
    'show_results', v_quiz.show_results, 'pass_score', v_quiz.pass_score,
    'camera_url', v_student.camera_url, 'screen_url', v_student.screen_url);
end $$;

grant execute on function register_student(uuid,text,text,text) to anon, authenticated;
grant execute on function get_quiz_for_student(uuid,text)       to anon, authenticated;
grant execute on function finish_quiz(uuid,text,text)           to anon, authenticated;

-- 6) Recordings — owner-scoped read (only the quiz's teacher can view its videos)
drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated using (
    bucket_id = 'recordings' and exists (
      select 1 from students s join quizzes q on q.id = s.quiz_id
      where s.id::text = split_part(name, '/', 1) and q.teacher_id = auth.uid()
    )
  );

-- Done.
