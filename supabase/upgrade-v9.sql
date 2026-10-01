-- QuizLock upgrade v9 — publish/freeze results + results-email tracking
-- Backward-compatible: existing quizzes default to results_published=false (draft).
--
-- Publishing a quiz's results FREEZES grading (teacher_grade_answer and
-- teacher_reallow_student reject while published) and unlocks the "Email all" /
-- per-student result emails. Unpublish to edit again.

alter table quizzes  add column if not exists results_published    boolean not null default false;
alter table quizzes  add column if not exists results_published_at  timestamptz;
alter table students add column if not exists results_emailed_at    timestamptz;
alter table students add column if not exists results_email_error   text;

-- Grading: reject while the quiz's results are published (frozen).
create or replace function teacher_grade_answer(p_answer_id uuid, p_awarded numeric)
returns json
language plpgsql security definer set search_path = public as $$
declare v_student_id uuid; v_score numeric; v_published boolean;
begin
  select an.student_id, q.results_published into v_student_id, v_published
    from answers an
    join students s on s.id = an.student_id
    join quizzes  q on q.id = s.quiz_id
    where an.id = p_answer_id and q.teacher_id = auth.uid();
  if v_student_id is null then return json_build_object('error','not_allowed'); end if;
  if v_published then return json_build_object('error','results_frozen'); end if;

  update answers set awarded = p_awarded, is_correct = (coalesce(p_awarded,0) > 0)
    where id = p_answer_id;

  select coalesce(sum(coalesce(awarded,0)),0) into v_score
    from answers where student_id = v_student_id;
  update students set score = v_score where id = v_student_id;

  return json_build_object('score', v_score);
end $$;
grant execute on function teacher_grade_answer(uuid,numeric) to authenticated;

-- Re-allow (which clears a student's answers & score): also reject while frozen.
create or replace function teacher_reallow_student(p_student_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_published boolean;
begin
  select
    exists(select 1 from students s join quizzes q on q.id = s.quiz_id
           where s.id = p_student_id and q.teacher_id = auth.uid()),
    coalesce((select q.results_published from students s join quizzes q on q.id = s.quiz_id
              where s.id = p_student_id), false)
    into v_ok, v_published;
  if not v_ok then return json_build_object('error','not_allowed'); end if;
  if v_published then return json_build_object('error','results_frozen'); end if;

  delete from answers where student_id = p_student_id;
  update students set status='registered', allowed=true, warnings=0,
      score=null, total_points=null, started_at=null, submitted_at=null,
      submit_reason=null, camera_url=null, screen_url=null
    where id = p_student_id;
  return json_build_object('ok', true);
end $$;
grant execute on function teacher_reallow_student(uuid) to authenticated;

-- Done.
