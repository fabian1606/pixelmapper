-- ============================================================
-- Tests for migration 013 (snapshot retention). Run through
-- supabase/tests/run-sql-tests.sh (throwaway postgres:16 container).
--
-- The core function is called with a fixed "now" so bucket boundaries are
-- exact: T = 2026-10-18 12:00:00 UTC (a Sunday).
-- ============================================================

\set ON_ERROR_STOP 1
-- Buckets must not depend on the session time zone.
set timezone = 'Europe/Berlin';
-- Silence fixture output; results are printed explicitly.
\o /dev/null

-- ── Fixtures ────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test'),
  ('00000000-0000-4000-8000-0000000000a2', 'editor@test'),
  ('00000000-0000-4000-8000-0000000000a3', 'viewer@test'),
  ('00000000-0000-4000-8000-0000000000a4', 'stranger@test');

insert into projects (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'buckets'),
  ('10000000-0000-4000-8000-000000000002', 'load base'),
  ('10000000-0000-4000-8000-000000000003', 'synthetic'),
  ('10000000-0000-4000-8000-000000000004', 'auth');

insert into project_collaborators (project_id, user_id, role, accepted_at) values
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'owner',  now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a2', 'editor', now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a3', 'viewer', now());

-- Named rows: `tag` → expected outcome. Helper table only for the test.
create temp table expect (tag text primary key, id uuid, keep boolean);

-- Inserts one snapshot of project 1 and records the expectation.
create function pg_temp.snap(p_tag text, p_at timestamptz, p_keep boolean,
                             p_seq bigint default 0, p_label text default null,
                             p_project uuid default '10000000-0000-4000-8000-000000000001')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into project_snapshots (project_id, snapshot, sequence_number, label, created_at)
  values (p_project, jsonb_build_object('tag', p_tag), p_seq, p_label, p_at)
  returning id into v_id;
  insert into expect values (p_tag, v_id, p_keep);
  return v_id;
end;
$$;

-- ── Project 1: bucket boundaries ────────────────────────────
-- T = 2026-10-18 12:00:00Z. Sequence numbers rise with time.
select pg_temp.snap('newest',        '2026-10-18 11:59:00Z', true,  100);
-- < 24 h: everything kept, even within one minute.
select pg_temp.snap('d0_a',          '2026-10-17 12:00:01Z', true,  90);   -- 23:59:59 old
select pg_temp.snap('d0_b',          '2026-10-17 12:00:02Z', true,  91);
-- Exactly 24 h → hourly tier. Hour 2026-10-17 12:00 holds only this row.
select pg_temp.snap('h_24h',         '2026-10-17 12:00:00Z', true,  89);
-- Hour 2026-10-16 10:00: three rows, newest wins.
select pg_temp.snap('h_10_10',       '2026-10-16 10:10:00Z', false, 80);
select pg_temp.snap('h_10_20',       '2026-10-16 10:20:00Z', false, 81);
select pg_temp.snap('h_10_50',       '2026-10-16 10:50:00Z', true,  82);
-- Hour 2026-10-16 11:00: a labeled older row and an unlabeled newer one.
select pg_temp.snap('h_11_label',    '2026-10-16 11:05:00Z', true,  83, 'Before Show');
select pg_temp.snap('h_11_newest',   '2026-10-16 11:30:00Z', true,  84);
-- Hour 2026-10-16 09:00: the labeled row is the newest → it represents the
-- bucket, the unlabeled one goes.
select pg_temp.snap('h_09_plain',    '2026-10-16 09:05:00Z', false, 78);
select pg_temp.snap('h_09_label',    '2026-10-16 09:30:00Z', true,  79, 'Uploaded');
-- 7-day boundary (T - 7 d = 2026-10-11 12:00:00Z).
select pg_temp.snap('h_7d_minus_1s', '2026-10-11 12:00:01Z', true,  70);   -- hourly tier
select pg_temp.snap('d_7d',          '2026-10-11 12:00:00Z', true,  69);   -- daily tier, day 10-11
select pg_temp.snap('d_7d_older',    '2026-10-11 11:00:00Z', false, 68);   -- same day, older
-- Daily tier: day 2026-10-01 with three rows.
select pg_temp.snap('d_01_a',        '2026-10-01 08:00:00Z', false, 60);
select pg_temp.snap('d_01_b',        '2026-10-01 13:00:00Z', false, 61);
select pg_temp.snap('d_01_c',        '2026-10-01 23:59:59Z', true,  62);
-- Day boundary is UTC midnight (Berlin is +2 h): 2026-10-02 00:30Z is day 10-02.
select pg_temp.snap('d_02_early',    '2026-10-02 00:30:00Z', true,  63);
-- 30-day boundary (T - 30 d = 2026-09-18 12:00:00Z, a Friday; ISO week 09-14).
select pg_temp.snap('d_30d_minus_1s','2026-09-18 12:00:01Z', true,  50);   -- daily tier
select pg_temp.snap('w_30d',         '2026-09-18 12:00:00Z', true,  49);   -- weekly, week 09-14
select pg_temp.snap('w_0917',        '2026-09-17 01:00:00Z', false, 48);
select pg_temp.snap('w_0914',        '2026-09-14 00:00:00Z', false, 47);   -- Monday 00:00 = same week
select pg_temp.snap('w_0913',        '2026-09-13 23:59:59Z', true,  46);   -- Sunday → previous week
select pg_temp.snap('w_0907',        '2026-09-07 10:00:00Z', false, 45);   -- same week as 09-13
-- Safety snapshot, old, labeled → kept.
select pg_temp.snap('w_safety',      '2026-08-01 10:00:00Z', true,  10, 'before offline sync');
select pg_temp.snap('w_0801_plain',  '2026-08-01 09:00:00Z', false, 9);
-- Restore: marker references an old snapshot (kept), result at the marker's seq.
select pg_temp.snap('w_restore_src', '2026-07-01 10:00:00Z', true,  5);
select pg_temp.snap('w_0701_newer',  '2026-07-01 11:00:00Z', true,  6);    -- restore result (below)
select pg_temp.snap('w_0702_plain',  '2026-07-02 11:00:00Z', true,  7);    -- newest of week 06-29
-- NULL created_at: age unknown → kept.
insert into project_snapshots (project_id, snapshot, sequence_number, created_at)
  values ('10000000-0000-4000-8000-000000000001', '{"tag":"null_at"}', 1, null);
insert into expect select 'null_at', id, true from project_snapshots where snapshot->>'tag' = 'null_at';

-- Week of 2026-06-29: w_0702_plain is the newest of the bucket, so the
-- other two would go. w_restore_src is the source of a restore marker and
-- w_0701_newer becomes the restore RESULT (a snapshot at the marker's
-- sequence number): both must survive.
-- Markers: change rows with explicit sequence numbers are not possible
-- (identity always), so align the snapshot to the generated marker number.
insert into project_changes (project_id, user_id, command_type, payload, change_id)
select '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
       'restore-snapshot', jsonb_build_object('snapshotId', (select id from expect where tag = 'w_restore_src')),
       gen_random_uuid();
update project_snapshots
   set sequence_number = (select max(sequence_number) from project_changes
                           where project_id = '10000000-0000-4000-8000-000000000001')
 where id = (select id from expect where tag = 'w_0701_newer');
-- A malformed marker payload must not break the prune.
insert into project_changes (project_id, user_id, command_type, payload, change_id)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
        'restore-snapshot', '{"snapshotId": 42}', gen_random_uuid());

-- Load base before pruning (same query as load-project).
create temp table base_before as
select id from project_snapshots
 where project_id = '10000000-0000-4000-8000-000000000001'
   and (label is null or label <> 'before offline sync')
 order by sequence_number desc, created_at desc limit 1;

-- ── Run ─────────────────────────────────────────────────────
create temp table deleted1 as
select x as id from prune_project_snapshots_core('10000000-0000-4000-8000-000000000001',
                                                  '2026-10-18 12:00:00Z', true) x;

do $$
declare r record; v_bad text := '';
begin
  for r in select e.tag, e.keep, exists (select 1 from project_snapshots s where s.id = e.id) as present
             from expect e order by e.tag loop
    if r.keep <> r.present then
      v_bad := v_bad || format(' %s(expected %s)', r.tag, case when r.keep then 'kept' else 'deleted' end);
    end if;
  end loop;
  if v_bad <> '' then raise exception 'bucket test failed:%', v_bad; end if;
  if (select count(*) from deleted1) <> (select count(*) from expect where not keep) then
    raise exception 'returned ids (%) do not match the deleted rows (%)',
      (select count(*) from deleted1), (select count(*) from expect where not keep);
  end if;
  if exists (select 1 from deleted1 d join expect e on e.id = d.id where e.keep) then
    raise exception 'a returned id belongs to a kept row';
  end if;
end $$;
\echo '   buckets / boundaries / labels / restore / null created_at: PASS'

-- Load base unchanged.
do $$
begin
  if (select id from base_before) is distinct from (
      select id from project_snapshots
       where project_id = '10000000-0000-4000-8000-000000000001'
         and (label is null or label <> 'before offline sync')
       order by sequence_number desc, created_at desc limit 1) then
    raise exception 'load base changed';
  end if;
end $$;
\echo '   load base unchanged: PASS'

-- Idempotent at the same "now".
do $$
begin
  if (select count(*) from prune_project_snapshots_core('10000000-0000-4000-8000-000000000001',
                                                         '2026-10-18 12:00:00Z', true)) <> 0 then
    raise exception 'second run deleted rows';
  end if;
end $$;
\echo '   idempotent: PASS'

-- ── Project 2: load base differs from "newest by time" ──────
-- All rows older than 30 days, one ISO week (2026-08-03 … 08-09):
--   seq 100 created 08-03 → load-project base (highest seq among loadable)
--   seq 50  created 08-05 → newest by time among unlabeled, bucket winner
--   seq 120 created 08-04 'before offline sync' → newest by sequence, labeled
--   seq 40  created 08-04 → pruned
--   seq 100 created 08-03 00:00 → tied seq, older → pruned
-- Plus a second week with a snapshot NEWER than all others at seq 30.
delete from expect;
select pg_temp.snap('lb_base',   '2026-08-03 12:00:00Z', true,  100, null, '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_tie_old','2026-08-03 00:00:00Z', false, 100, null, '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_safety', '2026-08-04 12:00:00Z', true,  120, 'before offline sync', '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_plain',  '2026-08-04 13:00:00Z', false, 40,  null, '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_bucket', '2026-08-05 12:00:00Z', true,  50,  null, '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_newest', '2026-08-12 12:00:00Z', true,  30,  null, '10000000-0000-4000-8000-000000000002');
select pg_temp.snap('lb_w2_old', '2026-08-11 12:00:00Z', false, 29,  null, '10000000-0000-4000-8000-000000000002');

select count(*) from prune_project_snapshots_core('10000000-0000-4000-8000-000000000002', '2026-10-18 12:00:00Z', true);
do $$
declare r record; v_bad text := '';
begin
  for r in select e.tag, e.keep, exists (select 1 from project_snapshots s where s.id = e.id) as present
             from expect e order by e.tag loop
    if r.keep <> r.present then
      v_bad := v_bad || format(' %s(expected %s)', r.tag, case when r.keep then 'kept' else 'deleted' end);
    end if;
  end loop;
  if v_bad <> '' then raise exception 'load-base test failed:%', v_bad; end if;
end $$;
\echo '   load base / safety / newest-by-time kept: PASS'

-- ── Access control ──────────────────────────────────────────
insert into project_snapshots (project_id, snapshot, sequence_number, created_at)
select '10000000-0000-4000-8000-000000000004', '{}', 0, date_trunc('hour', now() - interval '3 days') + g * interval '1 minute'
  from generate_series(1, 6) g;

-- Runs fn as an authenticated user; returns the SQLSTATE or 'ok:<count>'.
create function pg_temp.as_user(p_sub text, p_role text, p_sql text) returns text
language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'ok:' || v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end;
$$;

do $$
declare
  q text := $q$select prune_project_snapshots('10000000-0000-4000-8000-000000000004')$q$;
  r text;
begin
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a4', 'authenticated', q);
  if r <> '42501' then raise exception 'stranger: %', r; end if;
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a3', 'authenticated', q);
  if r <> '42501' then raise exception 'viewer: %', r; end if;
  r := pg_temp.as_user('', 'anon', q);
  if r <> '42501' then raise exception 'anon: % (expected permission denied)', r; end if;
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a2', 'authenticated',
    $q$select count(*)::int from prune_project_snapshots_core('10000000-0000-4000-8000-000000000004', now(), true)$q$);
  if r <> '42501' then raise exception 'core callable by authenticated: %', r; end if;
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a2', 'authenticated',
    $q$select count(*)::int from prune_all_project_snapshots()$q$);
  if r <> '42501' then raise exception 'backfill callable by authenticated: %', r; end if;
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a2', 'authenticated', q);
  if r <> 'ok:5' then raise exception 'editor: %', r; end if;
  r := pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', 'authenticated', q);
  if r <> 'ok:0' then raise exception 'owner (idempotent): %', r; end if;
  r := pg_temp.as_user('', 'service_role', q);
  if r <> 'ok:0' then raise exception 'service_role: %', r; end if;
end $$;
\echo '   access control: PASS'

-- ── Synthetic dataset: ~1,400 autosaves over 10 days ────────
-- 10 work sessions (one per day, 14:00 UTC), 140 autosaves every 20 s,
-- sequence numbers rising; 2 labeled safety snapshots and 1 upload.
insert into project_snapshots (project_id, snapshot, sequence_number, label, created_at)
select '10000000-0000-4000-8000-000000000003',
       '{"sceneNodes":[]}',
       (9 - d) * 1000 + i,          -- older days → lower sequence numbers
       case when i = 70 and d in (3, 7) then 'before offline sync'
            when i = 1 and d = 9 then 'Uploaded' end,
       timestamptz '2026-10-18 12:00:00Z' - d * interval '1 day' + interval '2 hours' + i * interval '20 seconds'
  from generate_series(0, 9) d, generate_series(1, 140) i;

create temp table synth (step text primary key, n bigint);
insert into synth select 'before', count(*) from project_snapshots
 where project_id = '10000000-0000-4000-8000-000000000003';
-- "Now" = 2026-10-18 16:00Z: day 0's session (14:00–14:47) is < 24 h old.
insert into synth select 'deleted', count(*)
  from prune_project_snapshots_core('10000000-0000-4000-8000-000000000003', '2026-10-18 16:00:00Z', true);
insert into synth select 'after', count(*) from project_snapshots
 where project_id = '10000000-0000-4000-8000-000000000003';
-- A month later the same data shrinks to weekly + protected rows.
insert into synth select 'deleted_40d', count(*)
  from prune_project_snapshots_core('10000000-0000-4000-8000-000000000003', '2026-11-27 16:00:00Z', true);
insert into synth select 'after_40d', count(*) from project_snapshots
 where project_id = '10000000-0000-4000-8000-000000000003';
\o
select step, n from synth order by n desc;
\o /dev/null

-- Expected after the first run: 140 (last 24 h) + days 1–6 → hourly tier,
-- one session hour each (6) + days 7–9 → daily tier (3) + labeled extras
-- (safety day 3, safety day 7, upload day 9) = 152.
-- After 40 days: weeks 10-05 and 10-12 (2) + the 3 labeled rows = 5.
do $$
declare v_after bigint := (select n from synth where step = 'after');
        v_40 bigint := (select n from synth where step = 'after_40d');
begin
  if v_after <> 152 then raise exception 'synthetic: expected 152 rows, got %', v_after; end if;
  if v_40 <> 5 then raise exception 'synthetic +40 d: expected 5 rows, got %', v_40; end if;
end $$;
\echo '   synthetic counts: PASS'

-- ── Backfill helper ─────────────────────────────────────────
-- Direct DB session (no JWT claims) may run it; returns one row per project
-- with deletions; a second run returns nothing.
create temp table backfill (run int, rows bigint);
insert into backfill select 1, count(*) from prune_all_project_snapshots();
insert into backfill select 2, count(*) from prune_all_project_snapshots();
\o
select * from backfill order by run;
\o /dev/null
do $$
begin
  if (select rows from backfill where run = 2) <> 0 then raise exception 'backfill not idempotent'; end if;
end $$;
\echo '   backfill helper idempotent: PASS'
