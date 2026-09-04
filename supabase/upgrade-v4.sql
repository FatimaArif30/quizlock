-- =====================================================================
--  QuizLock v4 upgrade — run ONCE in Supabase -> SQL Editor.
--  Fixes recordings display, adds per-type default marks, and a
--  language per code question (for the VS Code-style editor + runner).
-- =====================================================================

-- 1) Restore recording visibility for the teacher (the owner-scoped rule
--    was blocking signed links). Back to: any signed-in teacher can read.
drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated using (bucket_id = 'recordings');

-- 2) Per-type default marks on a quiz, e.g. {"mcq":1,"truefalse":1,"text":2,"code":5}
alter table quizzes add column if not exists type_points jsonb not null default '{}'::jsonb;

-- 3) Language for a code question (Monaco/Piston id, e.g. "python")
alter table questions add column if not exists code_lang text;

-- 4) get_quiz_for_student — include code_lang so the editor knows the language
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
    select a.ord, q.id, q.type, q.prompt, q.options, q.points, q.code_lang,
           (select response from answers an where an.student_id=v_student.id and an.question_id=q.id) as response
    from assignments a join questions q on q.id = a.question_id where a.student_id = v_student.id
  ) x;

  return json_build_object('quiz_title', v_quiz.title, 'duration_minutes', v_quiz.duration_minutes,
    'started_at', v_student.started_at, 'warnings', v_student.warnings,
    'questions', coalesce(v_questions,'[]'::json));
end $$;

grant execute on function get_quiz_for_student(uuid,text) to anon, authenticated;

-- Done.
