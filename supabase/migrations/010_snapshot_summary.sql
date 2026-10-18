-- ============================================================
-- 010 snapshot summaries for the version-history UI (ADR 0004 D17)
--
-- * snapshot_summary(jsonb):      counts fixtures / groups / modifiers of
--                                 one serialized ProjectSnapshot.
-- * list_snapshot_summaries(...): one page of a project's snapshots,
--                                 newest first, WITHOUT the snapshot JSON.
--
-- Both are SECURITY INVOKER: RLS on project_snapshots ("read if
-- collaborator") still decides what the caller may see.
-- ============================================================

-- ── snapshot_summary ────────────────────────────────────────
-- Walks `sceneNodes` recursively (groups have `children`). A node counts as
-- a group when `_type = 'group'` or it has a `children` array; every other
-- node is a fixture. `modifiers` is the length of the top-level array.
-- Missing or malformed arrays count as 0.
create or replace function snapshot_summary(p_snapshot jsonb)
returns table (fixtures integer, groups integer, modifiers integer)
language sql
immutable
security invoker
set search_path = public
as $$
  with recursive nodes(node) as (
    select n
      from jsonb_array_elements(
        case when jsonb_typeof(p_snapshot->'sceneNodes') = 'array'
             then p_snapshot->'sceneNodes' else '[]'::jsonb end
      ) as n
    union all
    select c
      from nodes
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(nodes.node) = 'object'
              and jsonb_typeof(nodes.node->'children') = 'array'
             then nodes.node->'children' else '[]'::jsonb end
      ) as c
  ),
  kinds as (
    -- coalesce: missing keys yield NULL, which must count as "not a group".
    select coalesce(jsonb_typeof(node) = 'object'
            and (node->>'_type' = 'group' or jsonb_typeof(node->'children') = 'array'), false) as is_group
      from nodes
  )
  select
    (count(*) filter (where not is_group))::integer,
    (count(*) filter (where is_group))::integer,
    (case when jsonb_typeof(p_snapshot->'modifiers') = 'array'
          then jsonb_array_length(p_snapshot->'modifiers') else 0 end)::integer
  from kinds;
$$;

grant execute on function snapshot_summary(jsonb) to authenticated;

-- ── list_snapshot_summaries ─────────────────────────────────
-- Order: sequence_number desc, created_at desc, id desc (several snapshots
-- can share a sequence number, e.g. a safety snapshot and an autosave).
-- Keyset cursor: pass the three values of the last row of the previous page
-- (all null for the first page). Returns at most p_limit rows (1…200).
-- author_name: profiles.display_name of created_by (null if unknown).
create or replace function list_snapshot_summaries(
  p_project_id uuid,
  p_limit      integer default 50,
  p_before_seq bigint default null,
  p_before_at  timestamptz default null,
  p_before_id  uuid default null
)
returns table (
  id              uuid,
  sequence_number bigint,
  label           text,
  created_at      timestamptz,
  created_by      uuid,
  author_name     text,
  fixtures        integer,
  groups          integer,
  modifiers       integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.sequence_number, s.label, s.created_at, s.created_by,
         p.display_name, sm.fixtures, sm.groups, sm.modifiers
    from (
      select ps.id, ps.sequence_number, ps.label, ps.created_at, ps.created_by, ps.snapshot
        from project_snapshots ps
       where ps.project_id = p_project_id
         and (p_before_seq is null
              or (ps.sequence_number, ps.created_at, ps.id) < (p_before_seq, p_before_at, p_before_id))
       order by ps.sequence_number desc, ps.created_at desc, ps.id desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) s
    left join profiles p on p.id = s.created_by
    cross join lateral snapshot_summary(s.snapshot) sm
   order by s.sequence_number desc, s.created_at desc, s.id desc;
$$;

revoke all on function list_snapshot_summaries(uuid, integer, bigint, timestamptz, uuid) from public, anon;
grant execute on function list_snapshot_summaries(uuid, integer, bigint, timestamptz, uuid) to authenticated;
