-- =====================================================================
--  QuizLock v2 upgrade — run ONCE in Supabase -> SQL Editor.
--  Adds: student-ID identity, passing score, show-results toggle,
--  and returns result info to the student on submit.
-- =====================================================================

-- 1) Identity by Student ID (one ID = one attempt per quiz; reusable across quizzes)
alter table students drop constraint if exists students_quiz_id_email_key;

-- Old test rows may share a Student ID (e.g. everyone typed "66076"). Clear the
-- IDs on those clashing rows so the unique rule can be applied. (Test data only.)
update students s set student_id_txt = null
  where student_id_txt is not null
    and exists (
      select 1 from students s2
      where s2.quiz_id = s.quiz_id
        and lower(s2.student_id_txt) = lower(s.student_id_txt)
        and s2.id <> s.id
    );

create unique index if not exists students_quiz_sid_idx
  on students (quiz_id, lower(student_id_txt))
  where student_id_txt is not null;

-- 2) Passing score (percent, null = no pass/fail) + show-results toggle
alter table quizzes add column if not exists pass_score int;
alter table quizzes add column if not exists show_results boolean not null default false;

-- 3) register_student — Student ID required, identity keyed on it
create or replace function register_student(
  p_quiz_id uuid, p_name text, p_email text, p_student_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_quiz quizzes; v_student students; v_needed int; v_available int; v_sid text;
begin
  v_sid := nullif(trim(p_student_id), '');
  if v_sid is null then return json_build_object('error','student_id_required'); end if;

  select * into v_quiz from quizzes where id = p_quiz_id;
  if v_quiz.id is null then return json_build_object('error','quiz_not_found'); end if;
  if v_quiz.is_open = false then return json_build_object('error','quiz_closed'); end if;

  select * into v_student from students
    where quiz_id = p_quiz_id and lower(student_id_txt) = lower(v_sid);

  if v_student.id is not null then
    if v_student.status = 'submitted' then return json_build_object('error','already_submitted'); end if;
    if v_student.status = 'blocked' and v_student.allowed = false then return json_build_object('error','blocked'); end if;
    -- reuse existing registration
  else
    insert into students (quiz_id, name, email, student_id_txt)
      values (p_quiz_id, p_name, p_email, v_sid)
      returning * into v_student;
  end if;

  v_needed := v_quiz.questions_per_student;
  if not exists (select 1 from assignments where student_id = v_student.id) then
    select count(*) into v_available from questions
      where quiz_id = p_quiz_id
      and id not in (select question_id from assignments a
                     join students s on s.id = a.student_id where s.quiz_id = p_quiz_id);
    if v_available < v_needed then
      return json_build_object('error','not_enough_questions','available', v_available, 'needed', v_needed);
    end if;

    insert into assignments (student_id, question_id, ord)
    select v_student.id, q.id, row_number() over ()
    from (
      select id from questions
      where quiz_id = p_quiz_id
        and id not in (select question_id from assignments a
                       join students s on s.id = a.student_id where s.quiz_id = p_quiz_id)
      order by random() limit v_needed for update skip locked
    ) q;
  end if;

  return json_build_object(
    'student_id', v_student.id, 'token', v_student.token, 'status', v_student.status,
    'quiz_title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes);
end $$;

-- 4) finish_quiz — also return show_results + pass_score for the student screen
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
    where q.id = an.question_id and q.type = 'mcq' and an.student_id = p_student_id;

  select coalesce(sum(q.points),0) into v_total
    from assignments a join questions q on q.id = a.question_id where a.student_id = p_student_id;
  select coalesce(sum(coalesce(an.awarded,0)),0) into v_score
    from answers an where an.student_id = p_student_id;

  update students set status='submitted', submitted_at=now(),
      submit_reason = p_reason, score = v_score, total_points = v_total
    where id = p_student_id;

  select * into v_quiz from quizzes where id = v_student.quiz_id;
  select email into v_teacher_email from auth.users where id = v_quiz.teacher_id;

  return json_build_object(
    'student_name', v_student.name, 'student_email', v_student.email,
    'teacher_email', v_teacher_email, 'quiz_title', v_quiz.title,
    'score', v_score, 'total_points', v_total,
    'show_results', v_quiz.show_results, 'pass_score', v_quiz.pass_score,
    'camera_url', v_student.camera_url, 'screen_url', v_student.screen_url);
end $$;

grant execute on function register_student(uuid,text,text,text) to anon, authenticated;
grant execute on function finish_quiz(uuid,text,text)           to anon, authenticated;

-- Done.
