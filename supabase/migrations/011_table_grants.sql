-- ── Table grants for tables created in 005–008 ─────────────────────────────
-- Supabase normally grants table privileges to `anon`, `authenticated` and
-- `service_role` through default privileges. Tables created by another role
-- (e.g. the CLI's temporary login role) do not get them, which surfaces as
-- "permission denied for table …" despite correct RLS policies. Access stays
-- governed by RLS; these grants only mirror the defaults of the older tables.

grant select, insert, update, delete on table public.content_plugins  to anon, authenticated, service_role;
grant select, insert, update, delete on table public.extensions       to anon, authenticated, service_role;
grant select, insert, update, delete on table public.user_extensions  to anon, authenticated, service_role;
grant select, insert, update, delete on table public.user_records     to anon, authenticated, service_role;
