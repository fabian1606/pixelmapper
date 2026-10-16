-- ============================================================
-- Extension catalog + per-user installations (ADR 0001 §5.9).
--
-- extensions        one row per published id@version (immutable)
-- user_extensions   what a user installed (version range)
-- bucket extensions <id>/<version>/index.js | style.css | extension.json
--
-- Bundles are public: anyone may read the catalog; publishing requires an
-- authenticated publisher, who owns the id once its first version exists.
-- ============================================================
create table extensions (
  id          text not null check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version     text not null check (version ~ '^\d+\.\d+\.\d+([-+].*)?$'),
  manifest    jsonb not null,
  publisher   uuid not null default auth.uid() references profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (id, version)
);

create index extensions_by_id on extensions (id, created_at desc);

alter table extensions enable row level security;

create policy "extensions: read all" on extensions for select using (true);

-- A publisher may add versions of ids nobody else published before.
create policy "extensions: publish own ids" on extensions for insert
  with check (
    auth.uid() is not null
    and publisher = auth.uid()
    and not exists (select 1 from extensions e where e.id = extensions.id and e.publisher <> auth.uid())
  );

-- Immutable: no update, no delete in v1.

create table user_extensions (
  user_id        uuid not null default auth.uid() references profiles(id) on delete cascade,
  extension_id   text not null,
  version_range  text not null default '*',
  installed_at   timestamptz default now(),
  primary key (user_id, extension_id)
);

alter table user_extensions enable row level security;

create policy "user_extensions: own rows" on user_extensions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- Storage bucket (public read, publisher write)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('extensions', 'extensions', true)
on conflict (id) do nothing;

create policy "extensions bucket: read all" on storage.objects for select
  using (bucket_id = 'extensions');

-- Upload into <id>/<version>/… only for a published row of the uploader.
create policy "extensions bucket: publisher upload" on storage.objects for insert
  with check (
    bucket_id = 'extensions'
    and exists (
      select 1 from public.extensions e
      where e.id = split_part(storage.objects.name, '/', 1)
        and e.version = split_part(storage.objects.name, '/', 2)
        and e.publisher = auth.uid()
    )
  );
