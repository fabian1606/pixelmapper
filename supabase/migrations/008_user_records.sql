-- ============================================================
-- user_records: generic per-user records synced by the client
-- (ADR 0004 D21, WP-RECORDS). First kind: 'custom-fixture'.
--
-- Conflict resolution is last-writer-wins per record on the
-- client-supplied `updated_at`; the trigger below rejects writes
-- that are older than the stored row, so LWW holds even when two
-- devices push concurrently.
--
-- Deletes are soft (`deleted_at` tombstones) so other devices can
-- learn about them through the incremental pull.
--
-- `server_updated_at` is set by the server on every accepted write
-- and is the incremental pull cursor. It is independent of client
-- clocks, so a device with a skewed clock cannot hide a write
-- behind another device's cursor.
-- ============================================================
create table user_records (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind              text not null check (char_length(kind) between 1 and 64),
  data              jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- LWW lookups by kind and time.
create index user_records_by_user_kind on user_records (user_id, kind, updated_at);
-- Keyset pagination of the incremental pull.
create index user_records_pull on user_records (user_id, kind, server_updated_at, id);

-- ── LWW guard + server cursor ───────────────────────────────
create or replace function user_records_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- Older write than the stored row: keep the stored row (skip update).
    if new.updated_at < old.updated_at then
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

create trigger user_records_before_write
  before insert or update on user_records
  for each row execute procedure user_records_before_write();

-- ── Row level security: own rows only ───────────────────────
alter table user_records enable row level security;

create policy "user_records: select own" on user_records for select
  using (user_id = auth.uid());

create policy "user_records: insert own" on user_records for insert
  with check (auth.uid() is not null and user_id = auth.uid());

create policy "user_records: update own" on user_records for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Clients delete via tombstones; hard delete is allowed for own rows
-- (e.g. a future pruning job running as the user).
create policy "user_records: delete own" on user_records for delete
  using (user_id = auth.uid());
