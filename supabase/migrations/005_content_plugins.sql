-- ============================================================
-- content_plugins: content-addressed, immutable plugin packages
-- (ADR 0001 §6.10). Built-ins are never uploaded.
--
-- Row  = manifest + source (for recompile-verification) + toolchain id.
-- Blob = storage bucket `content-plugins`: `<hex>.wasm`, `<hex>.ui.js`
--        where `hash = 'sha256:' || <hex>`.
-- ============================================================
create table content_plugins (
  hash        text primary key check (hash ~ '^sha256:[0-9a-f]{64}$'),
  alias       text not null,
  name        text not null,
  version     text not null,
  kind        text not null check (kind in ('modifier', 'shader', 'visual')),
  manifest    jsonb not null,
  source      jsonb not null,
  toolchain   text not null,
  owner_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  visibility  text not null default 'private' check (visibility in ('private', 'project', 'public')),
  project_id  uuid references projects(id) on delete set null,
  created_at  timestamptz default now(),
  -- Project visibility needs a project.
  constraint content_plugins_project_visibility check (visibility <> 'project' or project_id is not null)
);

create index content_plugins_by_owner   on content_plugins (owner_id, created_at desc);
create index content_plugins_by_project on content_plugins (project_id) where project_id is not null;
create index content_plugins_public     on content_plugins (created_at desc) where visibility = 'public';
create index content_plugins_by_alias   on content_plugins (alias);

alter table content_plugins enable row level security;

-- Readable if public, own, or shared with a project the user collaborates on.
create policy "content_plugins: read public, own or project" on content_plugins for select
  using (
    visibility = 'public'
    or owner_id = auth.uid()
    or (project_id is not null and is_collaborator(project_id, 'owner', 'editor', 'viewer'))
  );

-- Insert by the authenticated owner; project plugins only by project editors.
create policy "content_plugins: insert own" on content_plugins for insert
  with check (
    auth.uid() is not null
    and owner_id = auth.uid()
    and (project_id is null or is_collaborator(project_id, 'owner', 'editor'))
  );

-- Immutable: no update policy, no delete policy in v1.

-- ============================================================
-- Storage bucket for the binaries
-- ============================================================
insert into storage.buckets (id, name, public)
values ('content-plugins', 'content-plugins', false)
on conflict (id) do nothing;

-- Objects are readable when their row is readable (row RLS applies inside).
create policy "content-plugins: read with row" on storage.objects for select
  using (
    bucket_id = 'content-plugins'
    and exists (
      select 1 from public.content_plugins c
      where c.hash = 'sha256:' || split_part(storage.objects.name, '.', 1)
    )
  );

-- Upload only for rows the user owns (insert the row first, then the blobs).
create policy "content-plugins: upload own" on storage.objects for insert
  with check (
    bucket_id = 'content-plugins'
    and exists (
      select 1 from public.content_plugins c
      where c.hash = 'sha256:' || split_part(storage.objects.name, '.', 1)
        and c.owner_id = auth.uid()
    )
  );
