-- ============================================================
-- Minimal stand-in for the Supabase platform schema, so the migrations in
-- supabase/migrations/ can be applied to a plain `postgres:16` container
-- (see supabase/tests/run-sql-tests.sh). NOT a migration.
--
-- Provides: the API roles, auth.users / auth.uid() / auth.role() (reading
-- `request.jwt.claims` like Supabase), storage.buckets / storage.objects,
-- and the `supabase_realtime` publication.
-- ============================================================

-- ── Roles ───────────────────────────────────────────────────
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login password 'test';
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase default privileges on public tables.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid;
$$;

create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
$$;

-- ── storage ─────────────────────────────────────────────────
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;

-- ── realtime ────────────────────────────────────────────────
create publication supabase_realtime;
