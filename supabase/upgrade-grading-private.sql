-- =====================================================================
--  QuizLock upgrade: private recordings + manual grading
--  Run ONCE in Supabase -> SQL Editor -> New query -> paste -> Run.
-- =====================================================================

-- 1) Make the recordings bucket PRIVATE (only signed links work now)
update storage.buckets set public = false where id = 'recordings';

drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated using (bucket_id = 'recordings');
-- (anon students can still UPLOAD via the existing recordings_upload policy)

-- 2) Per-answer awarded points (for grading text/code by hand)
alter table answers add column if not exists awarded numeric;

-- 3) finish_quiz now records awarded points for MCQ and totals from them
create or replace function finish_quiz(p_student_id uuid, p_token text, p_reason text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_student students; v_quiz quizzes; v_teacher_email text;
  v_score numeric; v_total int;
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
    'student_name', v_student.name, 'student_email', v_student.email,
    'teacher_email', v_teacher_email, 'quiz_title', v_quiz.title,
    'score', v_score, 'total_points', v_total,
    'camera_url', v_student.camera_url, 'screen_url', v_student.screen_url);
end $$;

-- 4) Teacher grades one text/code answer; student's score recomputes
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

grant execute on function teacher_grade_answer(uuid,numeric) to authenticated;

-- Done.
