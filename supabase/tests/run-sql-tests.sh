#!/usr/bin/env bash
# ── SQL tests against a throwaway postgres:16 container ─────────────────────
#
# Usage (from anywhere):  bash supabase/tests/run-sql-tests.sh
#
# 1. starts `postgres:16` (removed on exit),
# 2. applies supabase/tests/supabase-stub.sql (roles, auth, storage stand-ins)
#    and every supabase/migrations/*.sql in order,
# 3. runs every supabase/tests/*.test.sql (each must `\echo ... PASS` or fail
#    with an exception; psql stops at the first error),
# 4. runs the lock-contention check of migration 013 with two sessions.
# Never touches a remote database.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NAME="pm-sql-tests-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=pg postgres:16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

# psql inside the container; stops at the first error.
run_psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "== schema"
run_psql < "$HERE/supabase-stub.sql"
SEED_SNAPSHOT_ID='88888888-0000-4000-8000-000000000001'
for f in "$ROOT"/migrations/*.sql; do
  # 013 backfills content_hash: seed a row that exists before it.
  if [ "$(basename "$f")" = "013_snapshot_retention.sql" ]; then
    run_psql <<SQL
insert into projects (id, name) values ('88888888-0000-4000-8000-000000000000', 'pre-013');
insert into project_snapshots (id, project_id, snapshot)
  values ('$SEED_SNAPSHOT_ID', '88888888-0000-4000-8000-000000000000', '{"clockEpoch": 5, "a": 1}');
SQL
  fi
  echo "   $(basename "$f")"
  run_psql < "$f"
done

echo "== 013 content_hash backfill"
backfilled=$(docker exec "$NAME" psql -U postgres -At -c \
  "select content_hash = snapshot_content_hash('{\"a\": 1}') from project_snapshots where id = '$SEED_SNAPSHOT_ID';")
[ "$backfilled" = "t" ] || { echo "FAIL content_hash backfill ($backfilled)"; exit 1; }
echo "   PASS"

for t in "$HERE"/*.test.sql; do
  echo "== $(basename "$t")"
  run_psql < "$t"
done

# ── 013: a busy project lock makes the per-request prune a no-op ───────────
echo "== 013 lock contention"
run_psql <<'SQL'
insert into projects (id, name) values ('99999999-0000-4000-8000-000000000001', 'lock');
insert into project_snapshots (project_id, snapshot, sequence_number, created_at)
select '99999999-0000-4000-8000-000000000001', '{}', 0, date_trunc('hour', now() - interval '3 days') + g * interval '1 minute'
  from generate_series(1, 5) g;
SQL
# Session 1 holds the project lock for 3 s.
docker exec "$NAME" psql -U postgres -q -c \
  "begin; select pg_advisory_xact_lock(project_lock_key('99999999-0000-4000-8000-000000000001')); select pg_sleep(3); commit;" \
  >/dev/null &
HOLDER=$!
sleep 1
busy=$(docker exec "$NAME" psql -U postgres -At -c \
  "select prune_project_snapshots('99999999-0000-4000-8000-000000000001');")
wait "$HOLDER"
free=$(docker exec "$NAME" psql -U postgres -At -c \
  "select prune_project_snapshots('99999999-0000-4000-8000-000000000001');")
echo "   deleted while locked: $busy, after release: $free"
[ "$busy" = "0" ] && [ "$free" = "4" ] || { echo "FAIL lock contention"; exit 1; }
echo "   PASS"

echo "== all SQL tests passed"
