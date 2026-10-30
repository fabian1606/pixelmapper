-- ============================================================
-- 007 offline sync (ADR 0004, WP-SERVER)
--
-- * project_sync_heads(): one-query listing of all projects the caller can
--   access, with role, owner and sync heads (used by `list-projects-sync`
--   so the Tauri app can mirror all projects and detect changed ones, D13).
-- * Indexes for the queries of pull-changes / list-projects-sync.
--   (project_changes (project_id, sequence_number) already exists from 001.)
-- ============================================================

-- Collaborator rows by user (the primary key is (project_id, user_id), so a
-- lookup by user_id alone could not use it).
create index if not exists project_collaborators_by_user
  on project_collaborators (user_id)
  where accepted_at is not null;

-- ============================================================
-- project_sync_heads(): security invoker → RLS applies, so the result only
-- contains projects the caller is an accepted collaborator of.
-- ============================================================
create or replace function project_sync_heads()
returns table (
  id                        uuid,
  name                      text,
  description               text,
  created_at                timestamptz,
  updated_at                timestamptz,
  role                      text,
  owner_id                  uuid,
  latest_sequence           bigint,
  latest_change_at          timestamptz,
  latest_snapshot_sequence  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.description,
    p.created_at,
    p.updated_at,
    me.role,
    (select o.user_id
       from project_collaborators o
      where o.project_id = p.id and o.role = 'owner'
      limit 1),
    coalesce(head.sequence_number, 0),
    head.created_at,
    coalesce((select s.sequence_number
                from project_snapshots s
               where s.project_id = p.id
               order by s.sequence_number desc
               limit 1), 0)
  from project_collaborators me
  join projects p on p.id = me.project_id
  left join lateral (
    select c.sequence_number, c.created_at
      from project_changes c
     where c.project_id = p.id
     order by c.sequence_number desc
     limit 1
  ) head on true
  where me.user_id = auth.uid()
    and me.accepted_at is not null
  order by p.updated_at desc;
$$;

revoke all on function project_sync_heads() from public, anon;
grant execute on function project_sync_heads() to authenticated;
