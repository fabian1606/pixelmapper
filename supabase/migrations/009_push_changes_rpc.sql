-- ============================================================
-- 009 serialized change log (ADR 0004, WP-SERVER review fixes)
--
-- * push_changes():     idempotent, per-project serialized push.
-- * restore_snapshot(): restore as a change-log marker + snapshot.
-- * projects.created_by: lets create-project adopt its own orphans.
-- * user_records LWW guard: equal timestamps no longer overwrite.
--
-- Why serialize per project?
--   `project_changes.sequence_number` is one global identity. Its value is
--   taken at INSERT time, but becomes visible at COMMIT time. Two concurrent
--   pushes to the same project could commit in the opposite order of their
--   numbers, and a pull between the two commits (`sequence_number > cursor`)
--   would move the cursor past the not-yet-visible lower number for good.
--   Both functions below take a transaction-scoped advisory lock keyed by
--   the project id BEFORE inserting. The next writer of that project can
--   only take its number after the previous one committed, so per project
--   numbers become visible in ascending order. (Numbers of other projects
--   interleave; pulls filter by project, so that does not matter.)
--
-- Why an RPC instead of a PostgREST upsert?
--   `upsert(..., ignoreDuplicates: false)` is `ON CONFLICT DO UPDATE`, which
--   needs an UPDATE policy on project_changes (there is none → 42501), so a
--   retried chunk the server had already committed failed forever. It could
--   also have merged into another user's row reusing the same change_id.
--   Here a duplicate is `DO NOTHING`, and only the caller's own existing row
--   counts as an acknowledgement.
--
-- Both functions are SECURITY INVOKER: RLS on project_changes /
-- project_snapshots still applies; the explicit role check only turns an
-- RLS failure into a clear `42501` ("forbidden") error.
--
-- Note: direct inserts into project_changes (bypassing push_changes) are
-- still allowed by the 001 insert policy and are NOT serialized. The app
-- only writes through push-change / restore-snapshot.
-- ============================================================

-- ── Lock key ────────────────────────────────────────────────
-- 64-bit hash of the project id for pg_advisory_xact_lock(bigint).
create or replace function project_lock_key(p_project_id uuid)
returns bigint
language sql
immutable
set search_path = public
as $$
  select hashtextextended(p_project_id::text, 0);
$$;

-- ── push_changes ────────────────────────────────────────────
-- p_changes: [{ "changeId": uuid, "commandType": text, "payload": json }, ...]
-- Returns one row per request element, in request order:
--   idx           0-based position in p_changes
--   ack_change_id the change id
--   ack_sequence  its sequence number, or NULL when the id belongs to a row
--                 of ANOTHER user (conflict: never acknowledge it).
-- A change id already stored for the caller returns the stored number
-- (retry after a lost response).
create or replace function push_changes(p_project_id uuid, p_changes jsonb)
returns table (idx integer, ack_change_id uuid, ack_sequence bigint)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_item   jsonb;
  v_ord    bigint;
  v_id     uuid;
  v_seq    bigint;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a JSON array' using errcode = '22023';
  end if;
  if not is_collaborator(p_project_id, 'owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Serialize all writers of this project until COMMIT (see header).
  perform pg_advisory_xact_lock(project_lock_key(p_project_id));

  for v_item, v_ord in
    select e.value, e.ord from jsonb_array_elements(p_changes) with ordinality as e(value, ord) order by e.ord
  loop
    v_id := (v_item->>'changeId')::uuid;
    if v_id is null or coalesce(v_item->>'commandType', '') = '' or not (v_item ? 'payload') then
      raise exception 'change % needs changeId, commandType and payload', v_ord - 1 using errcode = '22023';
    end if;

    -- One insert per element: numbers are taken in request order.
    v_seq := null;
    insert into project_changes as pc (project_id, user_id, command_type, payload, change_id)
    values (p_project_id, v_user, v_item->>'commandType', v_item->'payload', v_id)
    on conflict (project_id, change_id) do nothing
    returning pc.sequence_number into v_seq;

    if v_seq is null then
      -- Duplicate: acknowledge only the caller's own row.
      select pc.sequence_number into v_seq
        from project_changes pc
       where pc.project_id = p_project_id
         and pc.change_id = v_id
         and pc.user_id = v_user;
    end if;

    idx := (v_ord - 1)::integer;
    ack_change_id := v_id;
    ack_sequence := v_seq;
    return next;
  end loop;
end;
$$;

revoke all on function push_changes(uuid, jsonb) from public, anon;
grant execute on function push_changes(uuid, jsonb) to authenticated;

-- ── restore_snapshot ────────────────────────────────────────
-- Restores snapshot p_snapshot_id of p_project_id:
--   1. appends a marker change { command_type: 'restore-snapshot',
--      payload: { snapshotId } } through the same serialized path, so
--      collaborators and mirrors see the restore (pull, realtime, sync heads);
--   2. stores a copy of the snapshot AT THE MARKER'S sequence number, so
--      load-project starts from the restored state and never replays the
--      marker, and a snapshot taken before the restore can never win.
-- Both rows commit together.
create or replace function restore_snapshot(p_project_id uuid, p_snapshot_id uuid)
returns table (
  r_snapshot_id      uuid,         -- id of the new (restored) snapshot row
  r_snapshot         jsonb,        -- the restored state
  r_sequence         bigint,       -- marker sequence = snapshot position
  r_created_at       timestamptz,
  r_marker_change_id uuid,
  r_source_sequence  bigint        -- position of the source snapshot
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_snapshot jsonb;
  v_source   bigint;
  v_marker   uuid := gen_random_uuid();
  v_seq      bigint;
  v_new_id   uuid;
  v_created  timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not is_collaborator(p_project_id, 'owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.snapshot, s.sequence_number into v_snapshot, v_source
    from project_snapshots s
   where s.id = p_snapshot_id and s.project_id = p_project_id;
  if not found then
    raise exception 'snapshot not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(project_lock_key(p_project_id));

  insert into project_changes as pc (project_id, user_id, command_type, payload, change_id)
  values (p_project_id, v_user, 'restore-snapshot', jsonb_build_object('snapshotId', p_snapshot_id), v_marker)
  returning pc.sequence_number into v_seq;

  insert into project_snapshots as ps (project_id, snapshot, sequence_number, created_by, label)
  values (p_project_id, v_snapshot, v_seq, v_user, 'Restored from snapshot ' || v_source)
  returning ps.id, ps.created_at into v_new_id, v_created;

  r_snapshot_id := v_new_id;
  r_snapshot := v_snapshot;
  r_sequence := v_seq;
  r_created_at := v_created;
  r_marker_change_id := v_marker;
  r_source_sequence := v_source;
  return next;
end;
$$;

revoke all on function restore_snapshot(uuid, uuid) from public, anon;
grant execute on function restore_snapshot(uuid, uuid) to authenticated;

-- ── projects.created_by ─────────────────────────────────────
-- Set by create-project (service role). Lets a retry of the creating user
-- adopt a project that has no collaborator rows yet (in-flight create or a
-- failed compensating rollback). NULL for projects created before 009.
alter table projects
  add column if not exists created_by uuid references profiles(id) on delete set null;

-- ── user_records LWW guard (fix of 008) ─────────────────────
-- An UPDATE with the SAME client timestamp as the stored row is now skipped
-- too. Before, equal timestamps overwrote, while the client treats an equal
-- timestamp as "up to date" — two devices writing in the same millisecond
-- could keep different data forever. Replaced here (not in 008) because 008
-- may already be deployed.
create or replace function user_records_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- Not newer than the stored row: keep the stored row (skip update).
    if new.updated_at <= old.updated_at then
      return null;
    end if;
    -- Ownership and kind are immutable.
    new.user_id = old.user_id;
    new.kind = old.kind;
  end if;
  new.server_updated_at = clock_timestamp();
  return new;
end;
$$;
