-- QuizLock v11 access test — run AFTER upgrade-v11.sql, in the SQL editor.
-- SAFE: it changes nothing. The two delete checks run inside a block that is
-- always rolled back, so no file is ever removed. It impersonates three
-- callers (the real owning teacher, a made-up unrelated teacher, and an
-- anonymous visitor) and records what each one can see.

-- 0) Admin view (service_role ignores access rules) — the ground truth.
set local role service_role;
select set_config('qlt.total', (select count(*) from storage.objects where bucket_id = 'recordings')::text, true);
select set_config('qlt.teacher', coalesce((
  select q.teacher_id::text
  from storage.objects o
  join public.students s on s.id::text = (storage.foldername(o.name))[1]
  join public.quizzes  q on q.id = s.quiz_id
  where o.bucket_id = 'recordings'
  order by o.created_at desc limit 1), '00000000-0000-0000-0000-000000000000'), true);
select set_config('qlt.own', (
  select count(*)
  from storage.objects o
  join public.students s on s.id::text = (storage.foldername(o.name))[1]
  join public.quizzes  q on q.id = s.quiz_id
  where o.bucket_id = 'recordings' and q.teacher_id::text = current_setting('qlt.teacher'))::text, true);
select set_config('qlt.sample', coalesce((
  select o.name
  from storage.objects o
  join public.students s on s.id::text = (storage.foldername(o.name))[1]
  join public.quizzes  q on q.id = s.quiz_id
  where o.bucket_id = 'recordings' and q.teacher_id::text = current_setting('qlt.teacher')
  limit 1), ''), true);
select set_config('qlt.orphans', (
  select count(*) from storage.objects o
  where o.bucket_id = 'recordings'
    and not exists (select 1 from public.students s where s.id::text = (storage.foldername(o.name))[1]))::text, true);
reset role;

-- 1) The owning teacher.
set local role authenticated;
select set_config('qlt.whoami', current_user, true);
select set_config('request.jwt.claim.sub', current_setting('qlt.teacher'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qlt.teacher'), 'role', 'authenticated')::text, true);
select set_config('qlt.r_owner', (select count(*) from storage.objects where bucket_id = 'recordings')::text, true);
select set_config('qlt.r_owner_open', (select count(*) from storage.objects where bucket_id = 'recordings' and name = current_setting('qlt.sample'))::text, true);
do $$ declare n int; begin
  begin
    delete from storage.objects where bucket_id = 'recordings' and name = current_setting('qlt.sample');
    get diagnostics n = row_count;
    raise exception 'qlt_rollback:%', n;          -- always undo: nothing is ever deleted
  exception when others then
    perform set_config('qlt.r_owner_del', case when sqlerrm like 'qlt_rollback:%' then substr(sqlerrm, 14) else 'error: ' || sqlerrm end, true);
  end;
end $$;

-- 2) An unrelated teacher (a random account id that owns no quizzes).
select set_config('qlt.stranger', gen_random_uuid()::text, true);
select set_config('request.jwt.claim.sub', current_setting('qlt.stranger'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qlt.stranger'), 'role', 'authenticated')::text, true);
select set_config('qlt.r_list', (select count(*) from storage.objects where bucket_id = 'recordings')::text, true);
select set_config('qlt.r_open', (select count(*) from storage.objects where bucket_id = 'recordings' and name = current_setting('qlt.sample'))::text, true);
do $$ declare n int; begin
  begin
    delete from storage.objects where bucket_id = 'recordings' and name = current_setting('qlt.sample');
    get diagnostics n = row_count;
    raise exception 'qlt_rollback:%', n;          -- always undo: nothing is ever deleted
  exception when others then
    perform set_config('qlt.r_del', case when sqlerrm like 'qlt_rollback:%' then substr(sqlerrm, 14) else 'error: ' || sqlerrm end, true);
  end;
end $$;
reset role;

-- 3) An anonymous visitor.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('qlt.r_anon', (select count(*) from storage.objects where bucket_id = 'recordings')::text, true);
reset role;

-- Results
select test, expected, actual, result from (values
  (1, '0. Role switching worked (test is valid)', 'authenticated', current_setting('qlt.whoami'),
      case when current_setting('qlt.whoami') = 'authenticated' then 'OK' else 'INVALID – tell Claude' end),
  (2, '1. Recording files in the bucket (admin view)', 'more than 0', current_setting('qlt.total'),
      case when current_setting('qlt.total')::int > 0 then 'OK' else 'NO DATA – inconclusive' end),
  (30, '2. Owning teacher sees all of their own files', current_setting('qlt.own'), current_setting('qlt.r_owner'),
      case when current_setting('qlt.own')::int > 0 and current_setting('qlt.r_owner') = current_setting('qlt.own') then 'PASS' else 'FAIL' end),
  (31, '2b. Owning teacher can open a specific own file', '1', current_setting('qlt.r_owner_open'),
      case when current_setting('qlt.r_owner_open') = '1' then 'PASS' else 'FAIL' end),
  (32, '2c. Owning teacher could delete an own file (tested, then undone)', '1', current_setting('qlt.r_owner_del'),
      case when current_setting('qlt.r_owner_del') = '1' then 'PASS' else 'CHECK' end),
  (4, '3. Unrelated teacher – files they can list', '0', current_setting('qlt.r_list'),
      case when current_setting('qlt.r_list') = '0' then 'PASS' else 'FAIL' end),
  (5, '4. Unrelated teacher – open a known file by exact path', '0', current_setting('qlt.r_open'),
      case when current_setting('qlt.r_open') = '0' then 'PASS' else 'FAIL' end),
  (6, '5. Unrelated teacher – files deleted when trying (then undone)', '0', current_setting('qlt.r_del'),
      case when current_setting('qlt.r_del') = '0' then 'PASS' else 'FAIL' end),
  (7, '6. Anonymous visitor – files they can list', '0', current_setting('qlt.r_anon'),
      case when current_setting('qlt.r_anon') = '0' then 'PASS' else 'FAIL' end),
  (8, '7. Bucket is private', 'false', (select public::text from storage.buckets where id = 'recordings'),
      case when (select public from storage.buckets where id = 'recordings') = false then 'PASS' else 'FAIL' end),
  (9, '8. Files whose student no longer exists (no teacher can see them)', 'info', current_setting('qlt.orphans'), 'INFO'),
  (10, '9. All access rules on storage files', 'read/delete = owner; upload/update = live attempt',
      (select string_agg(policyname || ' [' || cmd || ' → ' || array_to_string(roles, ',') || ']', '  |  ' order by policyname)
         from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'CHECK')
) as t(n, test, expected, actual, result)
order by case when n >= 30 then n / 10.0 + 0.0 else n end, n;
