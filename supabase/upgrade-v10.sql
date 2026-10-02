-- QuizLock upgrade v10 — tighten recordings-bucket uploads (security fix #2)
--
-- Before: the recordings_upload policy let ANY caller (anon — i.e. anyone
-- holding the public anon key that ships inside the JS bundle) INSERT arbitrary
-- objects into the 'recordings' bucket. That is a storage-abuse / cost hole:
-- a stranger could upload unlimited junk and run up the Supabase bill.
--
-- After: an upload is accepted only when the FIRST folder of its path is the
-- UUID of a student whose attempt is currently in progress. Students upload to
-- "<studentId>/<attempt>/camera|screen/NNNN.webm", so every write is now tied
-- to a live attempt. No application change is required.
--
-- Why the SECURITY DEFINER helper: the uploading student is the 'anon' role,
-- and the students table's own RLS hides every row from anon. An inline EXISTS
-- in the policy would therefore match nothing and deny ALL uploads. The helper
-- runs as the table owner (RLS bypassed) and leaks nothing — it only returns
-- true/false for a folder name the caller already supplied.

create or replace function public.is_active_attempt_folder(p_folder text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from students
    where id::text = p_folder
      and status = 'in_progress'
  );
$$;

grant execute on function public.is_active_attempt_folder(text) to anon, authenticated;

-- INSERT: new clips during a live attempt.
drop policy if exists recordings_upload on storage.objects;
create policy recordings_upload on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'recordings'
    and public.is_active_attempt_folder((storage.foldername(name))[1])
  );

-- UPDATE: a retried upload to the same path (upsert) during a live attempt.
drop policy if exists recordings_update on storage.objects;
create policy recordings_update on storage.objects
  for update to anon, authenticated
  using (
    bucket_id = 'recordings'
    and public.is_active_attempt_folder((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'recordings'
    and public.is_active_attempt_folder((storage.foldername(name))[1])
  );

-- recordings_read (teacher-only SELECT) and recordings_delete (teacher-only
-- DELETE) from earlier upgrades are intentionally left unchanged.
