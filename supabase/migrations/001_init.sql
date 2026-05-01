-- ============================================================
-- profiles: auto-created on signup via trigger
-- ============================================================
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block auth even if profile insert fails
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- projects: metadata only, no owner column (owner lives in collaborators)
-- ============================================================
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute procedure set_updated_at();

-- ============================================================
-- project_collaborators: n-m users <-> projects with roles
-- ============================================================
create table project_collaborators (
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  invited_at  timestamptz default now(),
  accepted_at timestamptz,  -- null = invite pending
  primary key (project_id, user_id)
);

-- ============================================================
-- project_snapshots: checkpoint every 20 commands + version history
-- ============================================================
create table project_snapshots (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  -- full serialized state: {sceneNodes, savedPresets, pinnedModifiers, globalBases}
  snapshot         jsonb not null,
  -- sequence_number of the last project_change included in this snapshot
  sequence_number  bigint not null default 0,
  created_by       uuid references profiles(id),
  label            text,  -- optional: named versions e.g. "Before Show", "Final"
  created_at       timestamptz default now()
);

create index project_snapshots_by_seq on project_snapshots (project_id, sequence_number desc);

-- ============================================================
-- project_changes: event log — every command, used for tail-replay + realtime
-- ============================================================
create table project_changes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references profiles(id),
  command_type    text not null,
  payload         jsonb not null,
  sequence_number bigint generated always as identity,
  created_at      timestamptz default now()
);

create index project_changes_by_seq on project_changes (project_id, sequence_number);

-- ============================================================
-- RLS
-- ============================================================
alter table projects              enable row level security;
alter table project_collaborators enable row level security;
alter table project_snapshots     enable row level security;
alter table project_changes       enable row level security;

-- Helper: is the current user an accepted collaborator with at least one of the given roles?
create or replace function is_collaborator(p_project_id uuid, variadic p_roles text[])
returns boolean language sql security definer as $$
  select exists (
    select 1 from project_collaborators
    where project_id = p_project_id
      and user_id    = auth.uid()
      and accepted_at is not null
      and role = any(p_roles)
  );
$$;

-- projects
create policy "projects: read if collaborator" on projects for select
  using (is_collaborator(id, 'owner', 'editor', 'viewer'));

create policy "projects: update if owner/editor" on projects for update
  using (is_collaborator(id, 'owner', 'editor'));

create policy "projects: delete if owner" on projects for delete
  using (is_collaborator(id, 'owner'));

-- project_collaborators
create policy "collaborators: read if member" on project_collaborators for select
  using (
    user_id = auth.uid()
    or is_collaborator(project_id, 'owner', 'editor', 'viewer')
  );

create policy "collaborators: insert if owner" on project_collaborators for insert
  with check (is_collaborator(project_id, 'owner'));

create policy "collaborators: delete if owner" on project_collaborators for delete
  using (is_collaborator(project_id, 'owner'));

-- project_snapshots
create policy "snapshots: read if collaborator" on project_snapshots for select
  using (is_collaborator(project_id, 'owner', 'editor', 'viewer'));

create policy "snapshots: insert if owner/editor" on project_snapshots for insert
  with check (is_collaborator(project_id, 'owner', 'editor'));

-- project_changes
create policy "changes: read if collaborator" on project_changes for select
  using (is_collaborator(project_id, 'owner', 'editor', 'viewer'));

create policy "changes: insert if owner/editor" on project_changes for insert
  with check (is_collaborator(project_id, 'owner', 'editor'));
