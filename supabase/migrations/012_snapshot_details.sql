-- ============================================================
-- 012 snapshot details for the version history ("what changed")
--
-- * snapshot_details_pair(...):     a snapshot and the older one it is
--                                   compared to (both with their JSON).
-- * snapshot_activity(...):         changes in a sequence range, aggregated
--                                   per author and command type (no payloads).
-- * snapshot_restore_markers(...):  `restore-snapshot` markers in a range with
--                                   the restored snapshot's metadata.
--
-- All are SECURITY INVOKER: RLS on project_snapshots / project_changes
-- ("read if collaborator") still decides what the caller may see. The edge
-- function `snapshot-details` additionally returns 403 for non-collaborators.
-- Explicit grants: functions created by the CLI's login role do not get the
-- default privileges (see 011).
-- ============================================================

-- ── snapshot_details_pair ───────────────────────────────────
-- Returns up to two rows: slot 'current' (p_snapshot_id) and slot
-- 'previous'. 'previous' is p_compare_to_id when it exists in the project
-- (and is not the snapshot itself); otherwise the next older snapshot in the
-- history order (sequence_number desc, created_at desc, id desc — the order
-- of list_snapshot_summaries). No 'previous' row = first version.
create or replace function snapshot_details_pair(
  p_project_id    uuid,
  p_snapshot_id   uuid,
  p_compare_to_id uuid default null
)
returns table (
  slot            text,
  id              uuid,
  sequence_number bigint,
  label           text,
  created_at      timestamptz,
  snapshot        jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cur as (
    select ps.id, ps.sequence_number, ps.label, ps.created_at, ps.snapshot
      from project_snapshots ps
     where ps.project_id = p_project_id and ps.id = p_snapshot_id
  ),
  explicit_prev as (
    select ps.id, ps.sequence_number, ps.label, ps.created_at, ps.snapshot
      from project_snapshots ps
     where p_compare_to_id is not null
       and ps.project_id = p_project_id
       and ps.id = p_compare_to_id
       and ps.id <> p_snapshot_id
  ),
  neighbour as (
    select ps.id, ps.sequence_number, ps.label, ps.created_at, ps.snapshot
      from project_snapshots ps
      join cur on (ps.sequence_number, ps.created_at, ps.id) < (cur.sequence_number, cur.created_at, cur.id)
     where ps.project_id = p_project_id
     order by ps.sequence_number desc, ps.created_at desc, ps.id desc
     limit 1
  )
  select 'current'::text, c.id, c.sequence_number, c.label, c.created_at, c.snapshot from cur c
  union all
  select 'previous'::text, e.id, e.sequence_number, e.label, e.created_at, e.snapshot from explicit_prev e
  union all
  select 'previous'::text, n.id, n.sequence_number, n.label, n.created_at, n.snapshot from neighbour n
   where not exists (select 1 from explicit_prev);
$$;

revoke all on function snapshot_details_pair(uuid, uuid, uuid) from public, anon;
grant execute on function snapshot_details_pair(uuid, uuid, uuid) to authenticated;

-- ── snapshot_activity ───────────────────────────────────────
-- Changes with sequence_number in (p_after_seq, p_upto_seq], grouped by
-- author and command type. Restore markers are excluded (see below). At most
-- 500 groups, largest first. author_name: profiles.display_name.
create or replace function snapshot_activity(
  p_project_id uuid,
  p_after_seq  bigint,
  p_upto_seq   bigint
)
returns table (
  user_id      uuid,
  author_name  text,
  command_type text,
  change_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.user_id, p.display_name, c.command_type, count(*)::bigint
    from project_changes c
    left join profiles p on p.id = c.user_id
   where c.project_id = p_project_id
     and c.sequence_number > p_after_seq
     and c.sequence_number <= p_upto_seq
     and c.command_type <> 'restore-snapshot'
   group by c.user_id, p.display_name, c.command_type
   order by count(*) desc, c.command_type, c.user_id
   limit 500;
$$;

revoke all on function snapshot_activity(uuid, bigint, bigint) from public, anon;
grant execute on function snapshot_activity(uuid, bigint, bigint) to authenticated;

-- ── snapshot_restore_markers ────────────────────────────────
-- `restore-snapshot` markers (migration 009) in (p_after_seq, p_upto_seq],
-- newest first, at most 50. Only the payload's `snapshotId` is read (when it
-- is a UUID); the restored snapshot's metadata is joined (null if deleted).
create or replace function snapshot_restore_markers(
  p_project_id uuid,
  p_after_seq  bigint,
  p_upto_seq   bigint
)
returns table (
  sequence_number    bigint,
  created_at         timestamptz,
  user_id            uuid,
  author_name        text,
  source_snapshot_id uuid,
  source_sequence    bigint,
  source_created_at  timestamptz,
  source_label       text
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.sequence_number, m.created_at, m.user_id, p.display_name,
         m.source_id, s.sequence_number, s.created_at, s.label
    from (
      select c.sequence_number, c.created_at, c.user_id,
             case when c.payload->>'snapshotId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (c.payload->>'snapshotId')::uuid end as source_id
        from project_changes c
       where c.project_id = p_project_id
         and c.sequence_number > p_after_seq
         and c.sequence_number <= p_upto_seq
         and c.command_type = 'restore-snapshot'
       order by c.sequence_number desc
       limit 50
    ) m
    left join profiles p on p.id = m.user_id
    left join project_snapshots s on s.project_id = p_project_id and s.id = m.source_id
   order by m.sequence_number desc;
$$;

revoke all on function snapshot_restore_markers(uuid, bigint, bigint) from public, anon;
grant execute on function snapshot_restore_markers(uuid, bigint, bigint) to authenticated;
