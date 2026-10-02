-- QuizLock upgrade v11 — recordings privacy: teacher-scoped access (G3)
--
-- Before: recordings_read and recordings_delete allowed ANY signed-in account
-- (and teacher sign-up is open) to list, open and delete EVERY recording.
--
-- After:
--   * A teacher can list / open / delete a recording only if it belongs to a
--     student who took one of THAT teacher's quizzes.
--   * Anonymous users have no read or delete access at all.
--   * Students never read storage directly; their own recording reaches them
--     only as a signed link created server-side by the submission email.
--   * Uploads are unchanged (upgrade-v10: live attempts only).
--
-- Every recording path starts with the student's id:
--   <studentId>/<attemptId>/camera/0000.webm   (live clips)
--   <studentId>/camera-<ts>-<n>.webm           (older single files)
--
-- Why the earlier owner-only rule (upgrade-v3) failed and was reverted: its
-- subquery said split_part(name, '/', 1), but inside that subquery `name`
-- resolved to students.name (the student's full name), not the file path.
-- So the check was always false and teachers could see nothing. Here the
-- folder is passed into a helper from the top level of the policy, where
-- `name` can only mean the storage object's path.

create or replace function public.teacher_owns_recording_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.quizzes q on q.id = s.quiz_id
    where s.id::text = p_folder
      and q.teacher_id = auth.uid()
  );
$$;

revoke execute on function public.teacher_owns_recording_folder(text) from public, anon;
grant  execute on function public.teacher_owns_recording_folder(text) to authenticated;

-- READ (list, open, signed links for the dashboard): owning teacher only.
drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recordings'
    and public.teacher_owns_recording_folder((storage.foldername(name))[1])
  );

-- DELETE (delete-quiz cleanup): owning teacher only.
drop policy if exists recordings_delete on storage.objects;
create policy recordings_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recordings'
    and public.teacher_owns_recording_folder((storage.foldername(name))[1])
  );

-- Keep the bucket private (no public URLs). Idempotent.
update storage.buckets set public = false where id = 'recordings';
