-- ============================================================
-- 013 snapshot retention / thinning (ADR 0004 D5, D17)
--
-- Autosave stores a full snapshot every 10–30 s, so a busy project collects
-- thousands of rows. This migration thins them per project:
--
--   age < 24 h        keep every snapshot
--   1 – 7 days        keep the newest snapshot per hour
--   7 – 30 days       keep the newest snapshot per day
--   > 30 days         keep the newest snapshot per week
--
-- Buckets are UTC calendar hours / days / ISO weeks of `created_at`, and the
-- tier is part of the bucket key (an hour that straddles the 7-day line is
-- thinned in both tiers separately). Age is measured against now().
--
-- Always kept, regardless of age:
--   * the newest snapshot by (sequence_number, created_at) and by created_at;
--   * the snapshot load-project / pull-changes / load-shared-project pick as
--     base: newest by (sequence_number desc, created_at desc) among the
--     LOADABLE snapshots (all but `before offline sync`, _shared/snapshots.ts).
--     Rows tied with it are kept too, so pruning never changes the choice;
--   * every snapshot with a label (safety, "Uploaded", "Imported",
--     "Restored from snapshot …", named versions);
--   * snapshots referenced by a `restore-snapshot` marker (`payload.snapshotId`)
--     and snapshots at a marker's sequence number (restore results);
--   * rows with a NULL created_at (age unknown).
-- A kept row also counts as its bucket's representative ("newest of the
-- bucket" is computed over all rows of the bucket).
--
-- `project_changes` is NOT pruned (the full change log is kept).
--
-- Concurrency: pruning takes the per-project advisory lock of migration 009
-- (`project_lock_key`), so it never runs concurrently with push_changes /
-- restore_snapshot or another prune of the same project. The per-request
-- variant only TRIES the lock and returns 0 when it is busy (the next
-- autosave prunes); the backfill waits for it.
-- A restore_snapshot that read its source row before a prune deleted it
-- still succeeds: it copies the JSON and inserts its marker afterwards.
--
-- Thumbnail hook: `prune_project_snapshot_ids()` returns the ids of the
-- deleted rows, so a caller can delete per-snapshot storage objects
-- (e.g. `<projectId>/<snapshotId>.webp`) for exactly those ids.
-- ============================================================

-- Restore markers per project, without scanning the whole change log.
create index if not exists project_changes_restore_markers
  on project_changes (project_id, sequence_number)
  where command_type = 'restore-snapshot';

-- ── Core (internal) ─────────────────────────────────────────
-- Deletes the prunable snapshots of one project as of p_now and returns
-- their ids. No access check: only callable by the definer / superusers
-- (execute revoked from everyone else); the public wrappers check access.
--   p_wait  true  → wait for the project lock (backfill)
--           false → return nothing when the lock is busy
create or replace function prune_project_snapshots_core(
  p_project_id uuid,
  p_now        timestamptz,
  p_wait       boolean
)
returns setof uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_project_id is null or p_now is null then
    return;
  end if;

  if coalesce(p_wait, false) then
    perform pg_advisory_xact_lock(project_lock_key(p_project_id));
  elsif not pg_try_advisory_xact_lock(project_lock_key(p_project_id)) then
    return;
  end if;

  return query
  with snaps as (
    select s.id, s.sequence_number, s.label, s.created_at,
           -- Load-base candidates (same rule as LOADABLE_SNAPSHOT_FILTER).
           (s.label is distinct from 'before offline sync') as loadable,
           -- Tier: 0 = keep all, 1 = hourly, 2 = daily, 3 = weekly.
           case
             when s.created_at is null                      then 0
             when p_now - s.created_at < interval '24 hours' then 0
             when p_now - s.created_at < interval '7 days'   then 1
             when p_now - s.created_at < interval '30 days'  then 2
             else 3
           end as tier
      from project_snapshots s
     where s.project_id = p_project_id
  ),
  markers as (
    select c.sequence_number, c.payload->>'snapshotId' as snapshot_ref
      from project_changes c
     where c.project_id = p_project_id
       and c.command_type = 'restore-snapshot'
  ),
  ranked as (
    select sn.*,
           -- Bucket: the row itself in tier 0, else the UTC hour/day/week.
           case sn.tier
             when 0 then null
             when 1 then date_trunc('hour', sn.created_at at time zone 'UTC')
             when 2 then date_trunc('day',  sn.created_at at time zone 'UTC')
             else        date_trunc('week', sn.created_at at time zone 'UTC')
           end as bucket,
           rank() over (order by sn.sequence_number desc, sn.created_at desc nulls first) as newest_by_seq,
           rank() over (order by sn.created_at desc nulls last) as newest_by_time,
           rank() over (partition by sn.loadable
                        order by sn.sequence_number desc, sn.created_at desc nulls first) as load_rank
      from snaps sn
  ),
  decided as (
    select r.id,
           -- Newest row of its bucket (ties broken by id: deterministic).
           (r.tier = 0
            or row_number() over (partition by r.tier, r.bucket
                                  order by r.created_at desc, r.id desc) = 1) as bucket_keep,
           (r.newest_by_seq = 1
            or r.newest_by_time = 1
            or (r.loadable and r.load_rank = 1)
            or r.label is not null
            or exists (select 1 from markers m
                        where m.snapshot_ref = r.id::text
                           or m.sequence_number = r.sequence_number)) as protected
      from ranked r
  )
  delete from project_snapshots d
   using decided x
   where d.id = x.id
     and d.project_id = p_project_id
     and not x.bucket_keep
     and not x.protected
  returning d.id;
end;
$$;

revoke all on function prune_project_snapshots_core(uuid, timestamptz, boolean) from public, anon, authenticated;

-- ── Access check ────────────────────────────────────────────
-- Allowed: the service role, a direct database session without JWT claims
-- (psql / SQL editor as postgres), or an accepted owner/editor.
create or replace function prune_caller_allowed(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text := coalesce(v_claims::jsonb->>'role', '');
begin
  if v_role = 'service_role' then
    return true;
  end if;
  if v_claims is null and session_user not in ('authenticator', 'anon', 'authenticated') then
    return true;
  end if;
  return is_collaborator(p_project_id, 'owner', 'editor');
end;
$$;

revoke all on function prune_caller_allowed(uuid) from public, anon, authenticated;

-- ── prune_project_snapshot_ids (public, returns ids) ────────
-- Prunes one project now and returns the deleted snapshot ids (thumbnail
-- hook). 42501 unless owner/editor or service role. Returns no rows when
-- another writer holds the project lock.
create or replace function prune_project_snapshot_ids(p_project_id uuid)
returns setof uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not prune_caller_allowed(p_project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from prune_project_snapshots_core(p_project_id, now(), false);
end;
$$;

revoke all on function prune_project_snapshot_ids(uuid) from public, anon;
grant execute on function prune_project_snapshot_ids(uuid) to authenticated, service_role;

-- ── prune_project_snapshots (public, returns count) ─────────
-- Same as above, returns the number of deleted snapshots. Called by
-- save-snapshot after every insert (best effort).
create or replace function prune_project_snapshots(p_project_id uuid)
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  select count(*)::integer from prune_project_snapshot_ids(p_project_id);
$$;

revoke all on function prune_project_snapshots(uuid) from public, anon;
grant execute on function prune_project_snapshots(uuid) to authenticated, service_role;

-- ── prune_all_project_snapshots (one-off backfill) ──────────
-- Prunes every project (waiting for each project's lock) and returns one
-- row per project with deletions. Service role / direct DB session only.
-- Locks are transaction-scoped: run it as its own statement.
create or replace function prune_all_project_snapshots()
returns table (project_id uuid, deleted integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_project uuid;
  v_count integer;
begin
  if coalesce(v_claims::jsonb->>'role', '') <> 'service_role'
     and not (v_claims is null and session_user not in ('authenticator', 'anon', 'authenticated')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_project in select p.id from projects p order by p.id loop
    select count(*)::integer into v_count
      from prune_project_snapshots_core(v_project, now(), true);
    if v_count > 0 then
      project_id := v_project;
      deleted := v_count;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function prune_all_project_snapshots() from public, anon, authenticated;
grant execute on function prune_all_project_snapshots() to service_role;
