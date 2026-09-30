-- QuizLock upgrade v7 — storage hardening for the 'recordings' bucket
-- Low-risk lockdown that does NOT touch the student upload path (no exam-day risk):
--
-- 1) Cap the max file size so nobody (the anon key is public in the frontend)
--    can upload huge files and run up your storage/egress bill. 1 GB comfortably
--    fits a long capped recording (~400 MB/hr screen) while stopping abuse.
update storage.buckets set file_size_limit = 1073741824 where id = 'recordings';  -- 1 GB

-- 2) Let the teacher (authenticated) DELETE recordings. delete-quiz already calls
--    storage.remove() but there was no DELETE policy, so cleanup was silently
--    failing and leaving orphaned files forever. This fixes that.
drop policy if exists recordings_delete on storage.objects;
create policy recordings_delete on storage.objects
  for delete to authenticated using (bucket_id = 'recordings');

-- Uploads stay INSERT-only for anon (no overwrite of existing files); reads stay
-- teacher-only via signed URLs. Full per-student isolation (signed upload URLs)
-- is a larger change left for later if this is ever exposed to the public web.
