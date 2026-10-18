# WP-SERVER — Edge functions for offline sync

Part of [ADR 0004 — Offline-First](../adr/0004-offline-first.md) (§3.2, §4; D5, D11, D13, D14, D15).
Provides the server side of the sync cycle and a typed client wrapper. Client call sites are wired up by WP-SYNC / WP-ACCOUNT.

## Files

| File | Purpose |
|---|---|
| `supabase/functions/_shared/http.ts` | CORS, `json()`, `errorResponse()`, `preflight()`, `readJsonObject()` |
| `supabase/functions/_shared/auth.ts` | `authenticate()` (user-scoped client + user or 401), `adminClient()`, `callerRole()` |
| `supabase/functions/_shared/validate.ts` | Pure request parsers (`parsePullChanges`, `parseCreateProject`, `parseSaveSnapshot`, `parsePushChanges`, `parseRestoreSnapshot`, `parseProjectId`, `isUuid`) — tested with `bun test supabase/functions/_shared` |
| `supabase/functions/_shared/db-errors.ts` | `statusForDbError()`: SQLSTATE of an RPC/query → HTTP status (42501 → 403, P0002 → 404, 22023/22P02 → 400, …) |
| `supabase/functions/_shared/create-project-plan.ts` | `planExistingProject()`: pure decision for a create with an existing id (owned / adopt / 409 / 503) |
| `supabase/functions/_shared/snapshots.ts` | `LOADABLE_SNAPSHOT_FILTER`: snapshots a project may be loaded from (no `before offline sync` safety snapshots) |
| `supabase/functions/push-change/` | changed (009): writes through the `push_changes` RPC |
| `supabase/functions/restore-snapshot/` | changed (009): writes through the `restore_snapshot` RPC (marker change + snapshot) |
| `supabase/migrations/009_push_changes_rpc.sql` | `push_changes()`, `restore_snapshot()`, `project_lock_key()`, `projects.created_by`, `user_records` LWW guard fix |
| `supabase/functions/list-snapshots/` | rewritten (010): paged version-history list with SQL summaries, shared helpers |
| `supabase/functions/_shared/snapshot-list.ts` | Pure row → response mapping of `list-snapshots` (cursor of the last row) |
| `supabase/migrations/010_snapshot_summary.sql` | `snapshot_summary(jsonb)`, `list_snapshot_summaries()` (both `security invoker`) |
| `supabase/migrations/013_snapshot_retention.sql` | Snapshot retention: `content_hash` column + trigger, `prune_project_snapshots()`, `prune_project_snapshot_ids()`, `prune_all_project_snapshots()`, `list_snapshot_summaries()` without no-change autosaves (see "Snapshot retention") |
| `app/utils/sync/snapshot-content-hash.ts` | Client content hash (same normalization as 013) + per-session skip of no-change autosaves |
| `supabase/functions/_shared/snapshot-retention.ts` | Best-effort prune call after `save-snapshot` (`pruneSnapshotsBestEffort`, `runAfterResponse`, `edgeWaitUntil`) |
| `supabase/tests/` | SQL tests in a throwaway `postgres:16` container (`run-sql-tests.sh`, Supabase stub, `013_snapshot_retention.test.sql`) |
| `app/utils/sync/remote-api-snapshots.ts` | Typed wrapper `listSnapshots()` |
| `supabase/functions/snapshot-details/` | **new** (012): two snapshots + aggregated activity for the version-history details |
| `supabase/functions/_shared/snapshot-details.ts` | Pure request parser + row → response mapping of `snapshot-details` |
| `supabase/migrations/012_snapshot_details.sql` | `snapshot_details_pair()`, `snapshot_activity()`, `snapshot_restore_markers()` (all `security invoker`, explicit grants) |
| `app/utils/sync/remote-api-snapshot-details.ts` | Typed wrapper `getSnapshotDetails()` |
| `supabase/functions/snapshot-preview/` | **new** (014): compact scene schematic for version-history hover previews |
| `supabase/functions/_shared/snapshot-preview.ts` | Pure request parser + defensive layout normalization of `snapshot-preview` |
| `supabase/migrations/014_snapshot_preview.sql` | `snapshot_preview_layout()` (`security invoker`, explicit grants) |
| `supabase/migrations/015_snapshot_highlights.sql` | `snapshot_preview_highlights()` + pure `snapshot_highlights_compare()` and helpers (per-entity hashes; `security invoker`, explicit grants) |
| `supabase/functions/_shared/snapshot-highlights.ts` | Defensive `normalizeHighlights()` of the highlights RPC result |
| `supabase/tests/015_snapshot_highlights.test.sql` | SQL tests of 015 (categories, layout indices, pairing, cap, access) |
| `app/utils/sync/remote-restore.ts` | Client reaction to a pulled / realtime `restore-snapshot` marker (reload from the server) |
| `supabase/functions/create-project/` | changed: client id, idempotency, initial snapshot |
| `supabase/functions/pull-changes/` | **new**: paged change log after a cursor |
| `supabase/functions/load-project/` | changed: tail incl. `user_id`/`change_id`/`created_at`, `latestSequence`, 403 check |
| `supabase/functions/list-projects-sync/` | **new**: all accessible projects with sync heads |
| `supabase/functions/save-snapshot/` | changed: CORS, validation, label returned, 403 for viewers |
| `supabase/migrations/007_offline_sync.sql` | `project_sync_heads()` + index `project_collaborators_by_user` |
| `app/utils/sync/remote-api.ts` | Typed wrapper (`pullChanges`, `pushChanges`, `createProject`, `listProjectsForSync`, `saveSnapshot`, `loadProject`) |
| `app/utils/sync/remote-api-types.ts` | Request/response/result types |
| `app/utils/sync/remote-api-invoke.ts` | `invokeRemote()` + error classification + connectivity reporting |

`_shared/` is not deployed as a function (leading underscore); the CLI bundles it into every function that imports it.

All error responses of the changed/new functions are JSON `{ "error": string }` with CORS headers.

## Function API

### `create-project` (changed, backward compatible)

Request:

```jsonc
{
  "name": "Show",               // required
  "description": "…",           // optional
  "id": "<uuid>",               // optional, client-generated (D11)
  "snapshot": { … },            // optional ProjectSnapshot, stored at sequence 0 (D14)
  "snapshotLabel": "Uploaded"   // optional, ≤ 200 chars, default "Uploaded"
}
```

Response 200: the `projects` row plus

```jsonc
{ "id", "name", "description", "created_at", "updated_at", "public_share_token",
  "created": true,             // false = existing project of the caller returned
  "snapshot": { "id", "sequence_number", "label", "created_at" } | null }
```

- Without `id` the behaviour is as before (server-generated id).
- With `id` and the project exists (decision: `_shared/create-project-plan.ts`):
  - caller is the **owner** → returned with `created: false`. If a `snapshot` was sent and the project has **no changes yet**, it is stored as a new seq-0 snapshot (newest wins in `load-project`) and its meta is returned — a retry after a lost response uploads the *current* local state, so the base the client binds (`upload.ts`) equals the server state (review defect 7). If the project has changes already → **409** (the local copy cannot be bound to it any more).
  - owned by someone else → **409** `project id already in use`.
  - **no owner row yet** and younger than 60 s → **503** `project is being created, retry` (a concurrent create is in flight; `upload.ts` retries 503 three times with 1/2/3 s delay). Was a 409, which the client reported as "id already exists".
  - no owner row, older, and `created_by` = caller (migration 009) → the orphan is **adopted** (owner row inserted) and handled like an owned project. Orphans of someone else or of unknown creator (rows from before 009) → 409: ownership cannot be proven, so they are never handed out.
- The owner row is inserted with `ON CONFLICT DO NOTHING`, so a concurrent adoption by a retry never makes the original request fail and roll back.
- If inserting the owner row or the initial snapshot fails, the project is deleted again (compensating rollback) and 500 is returned.
- 400 for a missing name, a non-UUID `id`, a non-object `snapshot`, a bad label.

### `pull-changes` (new)

Request: `{ "projectId": "<uuid>", "afterSequence": 0, "limit": 500 }` — `limit` optional, default 500, clamped to 1000.

Response 200:

```jsonc
{
  "changes": [{ "sequence_number", "change_id", "user_id", "command_type", "payload", "created_at" }], // ascending
  "hasMore": false,          // another page exists after nextAfterSequence
  "nextAfterSequence": 42,   // last returned sequence_number, or afterSequence if empty
  "latestSequence": 42,      // highest sequence_number of the project (0 if none)
  "snapshotSequence": 40     // sequence_number of the latest server snapshot (0 if none)
}
```

- 401 without a valid token, 403 if the caller is not an accepted collaborator (any role), 400 for invalid input.
- **Ordering (009):** all writes go through `push_changes` / `restore_snapshot`, which hold a per-project advisory lock until COMMIT. Within a project, a row becomes visible only after every lower sequence number did, so `sequence_number > afterSequence` cannot skip a late commit. The client keeps its `PULL_OVERLAP` re-pull + dedup by change id as a second safety net (rows of old deployments or direct table inserts are not serialized; the overlap costs a few duplicate rows per pull).
- `snapshotSequence` ignores safety snapshots (same rule as `load-project`).
- Pages can be shorter than `limit` when PostgREST `max_rows` (default 1000) applies; `hasMore` accounts for that (it also compares with `latestSequence`). Always loop on `hasMore`.
- A client far behind (`latestSequence - afterSequence` large, `snapshotSequence > afterSequence`) MAY call `load-project` instead and rebase on the snapshot.

### `load-project` (changed, backward compatible)

Request: `{ "projectId": "<id>" }`

Response 200:

```jsonc
{
  "snapshot": { … } | null,
  "snapshotSequence": 40,
  "tail": [{ "sequence_number", "change_id", "user_id", "command_type", "payload", "created_at" }],
  "latestSequence": 42
}
```

- New: `change_id`, `user_id`, `created_at` per tail entry; `latestSequence`. If the last tail sequence is below `latestSequence`, the tail was cut by `max_rows` → continue with `pull-changes`.
- New: **403** if the caller is not an accepted collaborator (previously RLS returned an empty project). The existing client maps 403 to `projectError = 'unauthorized'`.
- Fix: among snapshots with the same `sequence_number` the newest one wins.
- 009: **400** for a non-UUID `projectId` (was a 22P02 → 500).
- 009: `before offline sync` safety snapshots are never loaded from. They are client-computed restore points; a client that rebased across a `restore-snapshot` marker computes one *without* the restore at a position after the marker, which would otherwise undo the restore for every loader. Normally a safety snapshot equals the server state at its position, so skipping it only lengthens the tail. Restoring a safety snapshot copies it under another label, so that copy is used. `load-shared-project` uses the same rule (plus `created_at desc`, review defect 9).

### `list-projects-sync` (new)

Request: `POST {}`. Response 200:

```jsonc
{ "projects": [{
  "id", "name", "description", "created_at", "updated_at",
  "role": "owner" | "editor" | "viewer",   // caller's role
  "owner_id": "<uuid>" | null,
  "latest_sequence": 42,                   // 0 if no changes
  "latest_change_at": "<ts>" | null,
  "latest_snapshot_sequence": 40           // 0 if no snapshot
}] }
```

Only accepted memberships, ordered by `updated_at desc`. Note: `projects.updated_at` only changes on rename/description edits — use `latest_sequence` against the local `serverCursor` to detect edited projects. Requires migration 007. `get-projects` is unchanged.

### `save-snapshot` (changed, backward compatible)

Request: `{ "projectId", "snapshot": { … }, "sequenceNumber": 42, "label"?: "before offline sync" }` (label ≤ 200 chars; it was already accepted before).
Response 200: `{ "id", "sequence_number", "label", "created_at" }` (`label` is new).
New: CORS headers + OPTIONS; 400 for a negative/non-integer `sequenceNumber` or non-object snapshot; 403 for viewers/non-members (was an RLS 500).
009: 400 for a non-UUID `projectId`, and for a `sequenceNumber` above the project's latest change (a snapshot cannot reflect changes that do not exist; `load-project` would skip later changes below that number).
013: after a successful insert the function calls `prune_project_snapshots(projectId)` with the caller's client — in the background (`EdgeRuntime.waitUntil`) and best effort (errors are logged as `[save-snapshot] prune failed …` and ignored). The response is unchanged.

### `push-change` (changed in 009, response shape unchanged)

Request: `{ "projectId": "<uuid>", "changes": [{ "changeId": "<uuid>", "commandType", "payload" }] }` (single form `{ projectId, changeId?, commandType, payload }` still accepted; a missing `changeId` gets a server UUID).
Response 200: `{ "sequenceNumbers": [n | null], "sequenceNumber": n | null, "changeIds": [...] }` in request order.

- Calls the RPC `push_changes(p_project_id, p_changes)` (security invoker → RLS applies; explicit owner/editor check → 42501 → **403**). It takes `pg_advisory_xact_lock(project_lock_key(project_id))`, inserts each change in request order with `ON CONFLICT (project_id, change_id) DO NOTHING`, and returns the sequence number per element.
- **Duplicate push** (retry after a lost response): the caller's existing row → its stored sequence number. Before, the PostgREST upsert was `ON CONFLICT DO UPDATE`, which needs an UPDATE policy that `project_changes` does not have → 42501 → 500 forever, and `pushRows` stopped at that chunk (review defect 1).
- A change id stored by **another user** → `null` (not confirmed; the client keeps the row). The old merge-upsert could have overwritten that row.
- 400 for a non-UUID `projectId`/`changeId`, missing `commandType`/`payload`.
- Realtime is unaffected: the RPC performs ordinary INSERTs on `project_changes`, which are published to `supabase_realtime` (migration 002) and filtered by the select policy as before.

### `restore-snapshot` (changed in 009)

Request: `{ "projectId": "<uuid>", "snapshotId": "<uuid>" }`.
Response 200: `{ "snapshot", "meta": { "id", "sequence_number", "created_at" }, "markerChangeId", "sourceSequence" }` — `meta.sequence_number` is the marker's sequence number.

- Calls the RPC `restore_snapshot(p_project_id, p_snapshot_id)`, one transaction under the same per-project lock: appends a marker change `{ command_type: 'restore-snapshot', payload: { snapshotId } }` and stores the restored snapshot **at the marker's sequence number** (label `Restored from snapshot <seq>`).
- So collaborators see the restore (pull, realtime), the project mirror sees `latest_sequence` advance, and no older snapshot can win in `load-project` (review defect 3). Before, only a snapshot at the latest sequence was inserted: nobody noticed, and a later snapshot silently undid the restore.
- Client: a pulled or realtime marker is never replayed; `remote-restore.ts` schedules one reload of the open project from the server (engine store: wait for the sync engine to be idle, then `loadProject(id, …, fromServer)`), and blocks server snapshots until then. The restoring client ignores its own marker echo (`runLocalRestore`).
- 400 for non-UUID ids, **403** unless owner/editor (was an RLS 500), 404 for an unknown snapshot.

### `list-snapshots` (rewritten, migration 010)

Request: `POST { "projectId": "<uuid>", "before"?: "<cursor>", "limit"?: 1…100 }` (default 30).
Response 200: `{ "snapshots": [{ "id", "sequenceNumber", "label", "createdAt", "createdBy", "authorName", "summary": { "fixtures", "groups", "modifiers" } }], "nextCursor": string | null }`, newest first.

- Version-history list (WP-SYNC "Version history"). Never returns the snapshot JSON: the RPC `list_snapshot_summaries` (010, `security invoker`, RLS applies) computes the counts with `snapshot_summary(jsonb)` — fixtures and groups counted recursively through group `children`, modifiers = `jsonb_array_length(modifiers)`; `authorName` = `profiles.display_name`.
- Order `sequence_number desc, created_at desc, id desc` (several snapshots can share a sequence number). `nextCursor` is an opaque keyset cursor `<seq>~<createdAt>~<id>` of the last row; the function asks for `limit + 1` rows to know whether another page exists.
- Shared helpers (CORS, preflight, POST only, JSON errors); 400 for invalid input / cursor, 403 for non-collaborators (viewers may read). Breaking change to the old GET `?projectId=` array response, which no client used.
- Since 013, unlabeled snapshots with the same content hash as their older neighbour are skipped (see "Snapshot retention").
- Pure parts: `_shared/validate.ts` (`parseListSnapshots`, cursor encode/decode), `_shared/snapshot-list.ts` (row → response); tests in `_shared/snapshot-list.test.ts`. The 010 SQL was verified against a throwaway `postgres:16` container (nested groups, malformed arrays, paging across equal sequence numbers).

### `snapshot-details` (new, migration 012)

Request: `POST { "projectId": "<uuid>", "snapshotId": "<uuid>", "compareToId"?: "<uuid>" }`.
Response 200: `{ "snapshot": { "id", "sequenceNumber", "label", "createdAt", "data" }, "previous": same | null, "activity": [{ "userId", "authorName", "commandType", "count" }], "restores": [{ "sequenceNumber", "createdAt", "userId", "authorName", "snapshotId", "sourceSequence", "sourceCreatedAt", "sourceLabel" }], "restoredFrom": restore | null }`.

- "What changed" of a version-history entry (WP-SYNC "Version history" › Change details). The client diffs `previous.data` → `snapshot.data`.
- `snapshot_details_pair(project, snapshot, compareTo)`: the snapshot plus `compareTo` when it exists in the project (and is not the snapshot itself), otherwise its older neighbour in the list order (`sequence_number desc, created_at desc, id desc`); no previous = first version.
- `snapshot_activity(project, after, upto)`: `project_changes` with `sequence_number` in `(previous.seq, snapshot.seq]` grouped by `user_id, command_type` (+ `profiles.display_name`), restore markers excluded, max 500 groups. No payloads are returned.
- `snapshot_restore_markers(project, after, upto)`: `restore-snapshot` markers in that range (only the payload's `snapshotId` is read, when it is a UUID) joined with the restored snapshot's metadata, max 50. For the first version only the snapshot's own sequence is queried; `restoredFrom` = the marker at `snapshot.sequenceNumber`.
- All three are `security invoker` (RLS applies) with `revoke … from public, anon` + `grant execute … to authenticated` (see 011 for why the grants are explicit). 400 invalid ids, 403 non-collaborators (viewers may read), 404 unknown snapshot.
- Pure parts in `_shared/snapshot-details.ts` (`parseSnapshotDetails`, `splitPair`, `detailRanges`, `toSnapshotDetailsResponse`); tests in `_shared/snapshot-details.test.ts`. The 012 SQL was verified against a throwaway `postgres:16` container (explicit/neighbour/missing compare, equal sequence numbers, other projects' rows, invalid marker ids).

## Snapshot retention (migration 013)

Autosave stores a full snapshot every 10–30 s (one dev project had 1,397 snapshots / 57 MB). Snapshots are thinned per project; **`project_changes` is never pruned** (the full change log is kept).

| Age (`now() - created_at`) | Kept |
|---|---|
| < 24 h | every snapshot |
| 24 h – 7 days | newest per UTC hour |
| 7 – 30 days | newest per UTC day |
| ≥ 30 days | newest per ISO week (Monday 00:00 UTC) |

The tier is part of the bucket key (an hour straddling the 7-day line is thinned in both tiers separately). "Newest" = `created_at desc, id desc`, computed over all rows of the bucket, so a protected row also counts as the bucket's representative.

**Always kept**, regardless of age:

- the newest snapshot by `(sequence_number, created_at)` and by `created_at`;
- the load base: newest by `sequence_number desc, created_at desc` among the loadable snapshots (all but `before offline sync`, `LOADABLE_SNAPSHOT_FILTER`) — the row `load-project`, `load-shared-project` and `pull-changes` (`snapshotSequence`) pick; rows tied with it are kept too, so pruning never changes what they return;
- every snapshot with a `label` (`before offline sync`, `Uploaded`, `Imported`, `Restored from snapshot …`, named versions);
- snapshots referenced by a `restore-snapshot` marker (`payload.snapshotId`, compared as text, so a malformed payload is harmless) and snapshots at a marker's sequence number (restore results);
- rows with `created_at` NULL.

**No-change autosaves** (an autosave whose content equals the previous version — "No changes to the project content." in the details view):

- **Content hash:** `project_snapshots.content_hash` (text, hex SHA-256) is set by the trigger `project_snapshots_content_hash` (before insert / update of `snapshot`) from `snapshot_content_hash(snapshot)`; 013 backfills existing rows. `snapshot_content_normalize(jsonb)` removes the fields the client diff (`app/utils/sync/version-diff/`) ignores: the top-level `clockEpoch` and `expanded` of every group in the `sceneNodes` tree at any depth (`snapshot_strip_group_ui`, recursive plpgsql; group = `_type: 'group'` or a `children` array, as in 010). The hash is taken over the normalized jsonb's text, which is canonical (sorted keys, fixed spacing).
- **Volatile fields that still count as content:** everything else, e.g. `selectedPresetId`, `activeSectionMembers` and `liveControllers` (the diff reports them as settings, so they are content by definition); a fixture's `expanded` (only group flags are ignored, like the diff); numeric formatting differences (`1` vs `1.0`) — the client always sends `JSON.stringify` output, so these do not occur in practice.
- **Pruning:** after the bucket rule, an unprotected, **unlabeled** survivor whose `content_hash` equals that of the next older survivor (list order `sequence_number, created_at, id`) is deleted too: of a run of identical snapshots the **oldest** stays (when the state appeared). The newest snapshot / load base are protected, so the load base never changes; labeled rows and restore sources/results always stay. Rows with a NULL hash are never deduplicated.
- **List:** `list_snapshot_summaries` is replaced (same signature, re-granted to `authenticated, service_role`) and skips an unlabeled row whose hash equals its older neighbour's (the next row in list order, hidden or not). The filter runs before the `LIMIT` and the cursor is the last returned row, so paging has no gaps or duplicates. Details (012) are unaffected: the client passes the previous *visible* entry as `compareToId`.
- **Client skip:** `doSaveSnapshot` (`app/stores/engine-store.ts`) hashes the snapshot it is about to send (`app/utils/sync/snapshot-content-hash.ts`: JSON round trip, same normalization, keys sorted, SHA-256 via WebCrypto) and skips the save when the hash equals the last snapshot **this session** saved successfully (memory per `wirePersistence`, i.e. per opened project; a failed save or a hashing error never suppresses the next one). The JS hash is not byte-compatible with the server's and is never compared with it. The unload-time keepalive save and the `before offline sync` safety snapshot are not deduplicated (the server prune/list handle them).

**Functions** (all `security definer`, `search_path = public`; clients have no delete policy on `project_snapshots`):

| Function | Who | Notes |
|---|---|---|
| `prune_project_snapshots(p_project_id) → integer` | `authenticated` (owner/editor of the project, else `42501`), `service_role` | Deleted count. Called by `save-snapshot`. |
| `prune_project_snapshot_ids(p_project_id) → setof uuid` | same | Deleted ids — **thumbnail hook**: a caller that stores per-snapshot objects (e.g. `<projectId>/<snapshotId>.webp`) deletes exactly these from storage. `prune_project_snapshots` is `count(*)` over it. |
| `prune_all_project_snapshots() → table(project_id, deleted)` | `service_role` or a direct DB session without JWT claims (psql / SQL editor) | One-off backfill; one row per project with deletions. |
| `prune_project_snapshots_core(p_project_id, p_now, p_wait)` | nobody (execute revoked; definer only) | The policy, with an explicit "now" (tests). |
| `prune_caller_allowed(p_project_id)` | nobody | Access check of the wrappers. |

Execute is revoked from `public`/`anon` and granted explicitly (see 011: objects created by the CLI role do not get Supabase's default grants). Partial index `project_changes_restore_markers` finds the markers without scanning the change log.

**Concurrency / idempotence:** pruning takes the per-project advisory lock of 009 (`project_lock_key`). The per-request wrappers only *try* it and return 0 when another writer (`push_changes`, `restore_snapshot`, another prune) holds it — the next autosave prunes; the backfill waits per project. A second run at the same time deletes nothing. A concurrent `save-snapshot` insert is invisible to the running prune and is never deleted (it is the newest). A `restore_snapshot` that read its source before a prune deleted it still succeeds (it copies the JSON).

**Tests:** `bash supabase/tests/run-sql-tests.sh` (Docker; applies a Supabase stub + all migrations to `postgres:16`, never a remote DB): every bucket boundary (exactly 24 h / 7 d / 30 d, UTC day and Monday week edges with a non-UTC session zone), labeled / newest / load-base / safety / restore source / restore result / NULL `created_at` kept, unchanged load base, idempotence, returned ids = deleted rows, access (stranger/viewer/anon `42501`, editor/owner/service role ok, core + backfill not callable by `authenticated`), busy lock → 0, backfill idempotent; content hash (clockEpoch / nested group `expanded` ignored, fixture `expanded` and nested changes not; trigger on insert/update; backfill of a row inserted before 013), dedupe (oldest of a run kept, labeled / restore-source / newest kept, load base unchanged, idempotent, dedupe after bucket thinning), list skip + paging with `limit 1`. `_shared/snapshot-retention.test.ts` (bun) covers the best-effort call; `app/utils/sync/snapshot-content-hash.test.ts` (Vitest) the client hash and skip.

Synthetic dataset (10 days × one 47-min session of 140 autosaves every 20 s = 1,400 snapshots, 2 safety + 1 upload label), pruned at 2 h after the newest session: **1,400 → 152** (140 of the last 24 h + 6 hourly + 3 daily + 3 labeled; −89 %). The same data 40 days later: **152 → 5** (2 weeks + 3 labeled). The same sessions where only every third autosave changes the content: **1,400 → 60** (47 distinct states of the last 24 h + the newest row as load base + 6 + 3 + 3). Steady state per project is bounded by the last 24 h of autosaves + ≤ 144 hourly + ≤ 23 daily + one per week + labeled rows.

### `snapshot-preview` (new, migration 014)

Request: `POST { "projectId": "<uuid>", "snapshotId": "<uuid>" }`.
Response 200:

```jsonc
{
  "snapshotId": "<uuid>",
  "layout": {
    "fixtures": [[x, y, w, h, r, c, s, b, g], …], // scene order, ≤ 400
    "groups": [["Truss"], …],                    // top-level groups, scene order, ≤ 100
    "total": 1200,                               // all drawable fixtures
    "truncated": true                            // total > fixtures.length
  }
}
```

Fixture tuple (world = 3000 × 3000 px, `FIXTURE_RADIUS` = 18 px):

| Field | Meaning |
|---|---|
| `x`, `y` | Centre, normalized 0…1 (`fixturePosition`), 3 decimals (≈ 3 world px; trailing zeros dropped). Fixtures without a numeric position are skipped and not counted in `total`. |
| `w`, `h` | Size multipliers (`fixtureSize`, default 1), 2 decimals. |
| `r` | Rotation in degrees, integer, mod 360. |
| `c` | Base colour `#rrggbb`: the `colorValue` of the `role = 'COLOR'` channels when exactly one distinct valid value exists, else `null` (RGB multi-colour fixture or no colour channel → draw neutral). |
| `s` | Shape: `0` single-beam (circle, radius 16·w), `1` multi-beam (> 1 beam; rounded rect, half-extent 18·w × 18·h, pixel grid), `2` kind fixture (rect). |
| `b` | Beam count (`beams` length, capped at 256), for the pixel dots of multi-beam fixtures. |
| `g` | Index into `groups` of the fixture's **top-level** group; `-1` when not grouped or the group is beyond the 100-group cap. The client draws group outlines as bounding boxes of the member fixtures. |

- Hover preview of a version-history entry (WP-SYNC). The schematic is computed in SQL by `snapshot_preview_layout(project, snapshot, limit = 400)` — **the snapshot JSON never goes over the wire**. Walk like `snapshot_summary` (010): groups are `_type = 'group'` or nodes with a `children` array; an ordinality path per node makes the order deterministic (depth-first scene order).
- Kind fixtures mirror the canvas (`kindCanvasFields` / `kindWorldAabb`): the tuple holds the axis-aligned bounding box of the rotated `kind.compiled.bounds` (centre normalized again, `w/h = max(half-extent, 8) / 18`, `r = 0`). The kind body is not reproduced — good enough for a schematic.
- Limits: `p_limit` clamped to 1…1000 (the function uses the default 400), group names cut to 60 chars, 100 groups. Measured in a `postgres:16` container (x/y rounded to 3 decimals, float8 so no trailing zeros): 500 fixtures + 100 groups = **22.5 KB** compact JSON (≈ 1.8 KB gzipped), so the default cap of 400 stays ≈ 18 KB, ~55 ms for a 1200-fixture snapshot.
- `security invoker` (RLS on `project_snapshots` applies) with `revoke … from public, anon` + `grant execute … to authenticated, service_role`. The RPC returns `null` for an unknown / invisible snapshot (also for a snapshot of another project) → **404** `Snapshot not found`. 400 invalid ids, 403 non-collaborators (viewers may read).
- `normalizeLayout()` (`_shared/snapshot-preview.ts`) re-validates the RPC result defensively: drops tuples without finite `x`/`y`, clamps `x`/`y` to 0…1, `w`/`h` to 0.01…100, `b` to 0…256, invalid colours → `null`, invalid shapes → 0, out-of-range group indices → -1; malformed group entries keep their slot as `[""]` so indices stay aligned. Tests in `_shared/snapshot-preview.test.ts`.

### `snapshot-preview` highlights (migration 015)

"What is special about this version" for the hover card (WP-SYNC "Hover preview"). Request: `POST { projectId, snapshotId, compareToId? }` (`compareToId` optional UUID or null; anything else → 400). The response adds `highlights`; all 014 fields are unchanged. The previous version is the one of `snapshot-details` (`snapshot_details_pair`): `compareToId` when it exists in the project and is not the snapshot itself, else the older list neighbour (`sequence_number desc, created_at desc, id desc`); none = first version (`previousId: null`, no categories).

```jsonc
"highlights": {
  "previousId": "<uuid>" | null,
  "categories": {                                   // only changed kinds
    "live": { "added": 0, "changed": 1, "removed": 0 },
    "effect": {…}, "preset": {…},
    "fixtures": { "added": 1, "changed": 3, "removed": 0, "moved": 2, "groups": 1 },
    "settings": { "added": 0, "changed": 1, "removed": 0 }
  },
  "live":    { "pages": [{ "status": "added|changed", "page": <LivePage>, "widgets": { "added": [id], "changed": [id], "removed": [{ "id", "type", "label" }] }, "sectionsChanged": false }], "removed": [{ "id", "name" }] },
  "effects": { "items": [{ "status", "modifier": <ModifierInstance>, "changedKeys": ["params.color", "strength"], "before": { "strength": 0.5 } }], "removed": [{ "id", "name": <plugin hash> }] },
  "presets": { "items": [{ "status", "preset": <Preset>, "changedKeys": [...] }], "removed": [{ "id", "name" }] },
  "fixtures": { "added": [layoutIdx], "changed": [layoutIdx], "moved": [layoutIdx], "removed": 2 },
  "fixtureIndex": { "<fixture id>": layoutIdx },    // ids referenced by returned items / changed fixtures
  "settings": ["globalBpm"],
  "truncated": false
}
```

- `snapshot_preview_highlights(project, snapshot, compareTo = null, limit = 400, maxBytes = 30000) → jsonb`, `security invoker` (RLS applies; `null` = not found / not visible), built on the pure `snapshot_highlights_compare(prev, cur, limit, maxBytes)` and small helpers (`snapshot_scene_walk`, `snapshot_layout_index`, `snapshot_id_key`, `snapshot_scene_hashes`, `snapshot_entity_list`, `snapshot_list_diff`, `snapshot_changed_keys`, `snapshot_live_widget_diff`, `snapshot_fixture_refs`). `revoke … from public, anon`; `grant execute … to authenticated, service_role`. 015 also grants `snapshot_details_pair` to `service_role` (012 granted `authenticated` only).
- **Comparison:** entities by id (string or number compared as text; first wins), hash = `md5(jsonb::text)`; only changed entities are returned. Scene flattened at any depth, a fixture's hash includes its parent group; *moved* = `fixturePosition`/`fixtureSize`/`rotation`/`positionZ`/`tiltX`/`rollZ` changed (moved ⊆ changed); group hash = name + parent + ordered members (`expanded` ignored). Modifiers: `params` expands to `params.<key>` when both sides are objects, `before` holds old values (missing keys and values > 2 KB omitted), keys sorted. Presets ignore `createdAt`. Live pages: widgets diffed by id + `sectionsChanged`; an added page lists all widgets as added. Settings: top-level keys except the entity lists, `clockEpoch`, `schemaVersion` (missing `globalBpm` = 120, missing `selectedPresetId` = null, `[]`/`{}` = missing).
- **Layout indices** use exactly the walk, drawable filter, order and cap of `snapshot_preview_layout` (014 unchanged); fixtures beyond the cap are omitted.
- **Caps:** budget `octet_length(highlights::text)` ≤ 30 KB. The base (counts, index lists ≤ 400, removed ≤ 20 per kind, names ≤ 60 chars, settings ≤ 50, widget ids ≤ 200, removed widgets ≤ 50) is always returned; then live pages (added first, then most widget changes), effects, presets and finally `fixtureIndex` entries of changed fixtures are added while they fit — an item's referenced `fixtureIndex` entries count towards its cost. What does not fit is dropped (counts stay complete) and `truncated = true` (also when a fixed list cap cut something).
- **Measured** (Docker `postgres:16`; 400 fixtures with UUID ids, 8 channels, 20 groups, 8 modifiers, 10 presets × 50 fixtures, 3 pages × 30 widgets; 593 KB snapshot; jsonb text sizes; layout alone 18.0 KB):

  | Scenario | highlights | full response | time |
  |---|---|---|---|
  | one widget changed | 6.0 KB | 24.2 KB | 62 ms |
  | one modifier param changed | 5.1 KB | 23.2 KB | 62 ms |
  | one preset added | 5.1 KB | 23.2 KB | 66 ms |
  | 20 fixtures moved | 1.4 KB | 19.6 KB | 143 ms |
  | everything changed | 30.0 KB (truncated: 3 pages, 1/8 effects, 1/10 presets) | 48.1 KB | 126 ms |
- The edge function runs the layout and highlights RPCs in parallel; if the highlights RPC fails (e.g. 015 not applied yet) it logs and omits `highlights`. `normalizeHighlights()` (`_shared/snapshot-highlights.ts`) re-validates the result (indices in range, malformed items dropped). Tests: `_shared/snapshot-highlights.test.ts`, `_shared/snapshot-preview.test.ts` (`compareToId`), `supabase/tests/015_snapshot_highlights.test.sql` (all categories and no-ops, layout indices vs. `snapshot_preview_layout` incl. cap, pairing incl. equal sequence numbers / foreign / self compareTo, payload cap, access: viewer ok, stranger null under RLS, anon denied, service_role ok).
- Known limits: wide changes drop most payloads (counts stay); an item bigger than the budget is never sent; hashes are formatting-sensitive (`1` vs `1.0`, as in 013); the snapshot pair is walked three times (60–140 ms for a 600 KB pair).

## Client wrapper (`app/utils/sync/remote-api.ts`)

```ts
type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: RemoteError };
interface RemoteError {
  kind: 'network' | 'auth' | 'forbidden' | 'not-found' | 'conflict' | 'bad-request'
      | 'server' | 'invalid-response' | 'unknown';
  status: number | null;  // null = no HTTP response
  message: string;        // server { error } or text
  retryable: boolean;     // network | server
  cause?: unknown;
}

pullChanges(client, { projectId, afterSequence, limit? }): Promise<RemoteResult<PullChangesResult>>
pushChanges(client, projectId, [{ changeId, commandType, payload }]): Promise<RemoteResult<PushAck[]>>
createProject(client, { id?, name, description?, snapshot?, snapshotLabel? }): Promise<RemoteResult<CreateProjectResult>>
listProjectsForSync(client): Promise<RemoteResult<RemoteProjectHead[]>>
saveSnapshot(client, { projectId, snapshot, sequenceNumber, label? }): Promise<RemoteResult<SnapshotMeta>>
loadProject(client, projectId): Promise<RemoteResult<LoadProjectResult>>
```

- `client` is anything with `functions.invoke` (`RemoteClient`), e.g. `useSupabaseClient()`.
- Results are camelCase (`RemoteChange { sequenceNumber, changeId, userId, commandType, payload, createdAt }`).
- Never throws. Network failures (`FunctionsFetchError`, `TypeError`, detected with `isNetworkError`) → `kind: 'network'` and `reportNetworkFailure()`; any HTTP response → `reportNetworkSuccess()` (the backend is reachable, even on 4xx/5xx).
- `pushChanges` returns one ack per input in request order; `sequenceNumber: null` means "not confirmed — keep in the outbox".
- `loadProject` adds `tailTruncated` (tail ends before `latestSequence`).
- Tolerates responses of the old deployments (`created`/`latestSequence` missing).

Tests: `app/utils/sync/remote-api.test.ts` (Vitest, mocked client).

## Deployment (manual — run by the maintainer)

From the repository root, linked to the project (`supabase link --project-ref <ref>` once):

```bash
# 1. Schema first: 007 (project_sync_heads), 008 (user_records),
#    009 (push_changes / restore_snapshot RPCs, projects.created_by,
#    user_records LWW fix), 010 (snapshot_summary /
#    list_snapshot_summaries for the version history), 012
#    (snapshot_details_pair / snapshot_activity / snapshot_restore_markers),
#    013 (snapshot retention, content_hash
#    column + backfill, list_snapshot_summaries replaced).

#    014 (snapshot_preview_layout for the version-history hover preview).
#    015 (snapshot_preview_highlights: what changed, for the hover preview).
supabase db push

# 2. Functions (each bundles ../_shared).
supabase functions deploy push-change          # needs 009 (push_changes)
supabase functions deploy restore-snapshot     # needs 009 (restore_snapshot)
supabase functions deploy create-project       # needs 009 (projects.created_by)
supabase functions deploy pull-changes
supabase functions deploy load-project
supabase functions deploy load-shared-project
supabase functions deploy save-snapshot        # needs 013 (prune_project_snapshots); without it every save logs a prune warning
supabase functions deploy list-projects-sync
supabase functions deploy list-snapshots       # needs 010 (list_snapshot_summaries)
supabase functions deploy snapshot-details     # needs 012 (snapshot_details_pair, …)
supabase functions deploy snapshot-preview     # needs 014 (snapshot_preview_layout); 015 for highlights (without it they are omitted)
```

All functions keep the default JWT verification. **Migration 009 must be applied before** `push-change`, `restore-snapshot` and `create-project` are deployed (they call the new RPCs / write `created_by`); the others work against the existing schema. Clients of the previous build keep working: the response shapes are unchanged (`restore-snapshot` only adds fields), and an older client ignores the `restore-snapshot` marker row with a "no handler" warning.

**One-off retention backfill (after 013 is applied):** prunes every existing project once (waits for each project's lock; run it as a single statement, ideally at a quiet time — locks are held until the statement commits). Run it in the dashboard SQL editor (as `postgres`), or with `psql "<connection string from Project Settings → Database>"`:

```sql
select * from prune_all_project_snapshots();  -- one row per project with deletions
-- optional: reclaim space of the deleted TOASTed snapshots
vacuum (analyze) project_snapshots;
```

Afterwards every `save-snapshot` keeps the project thinned.

**Type-check:** `deno check supabase/functions/<name>/index.ts` (needs a deno config with `"nodeModulesDir": "auto"` outside the repo root, because the root `package.json` otherwise makes Deno look for `npm:openai` in `node_modules`), e.g. from a scratch dir containing `{ "nodeModulesDir": "auto" }` as `deno.json`: `bunx deno check --config ./deno.json <repo>/supabase/functions/push-change/index.ts …`.

### Local verification of migration 009 (not run in CI)

The SQL of 009 was written without a database at hand; verify it locally before deploying:

```bash
supabase start            # local stack (Docker)
supabase db reset         # applies 001…009 to the local database
supabase functions serve  # optional: functions against the local stack
```

Then in `psql` against the local DB URL printed by `supabase status` (or Studio → SQL editor):

```sql
-- Test data: one user, one project, owner row.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'a@test');
insert into projects (id, name, created_by) values ('10000000-0000-4000-8000-000000000001', 'P', '00000000-0000-4000-8000-000000000001');
insert into project_collaborators (project_id, user_id, role, accepted_at)
  values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner', now());

-- Act as that user (RLS + auth.uid()).
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 1. Push two changes, then push the same chunk again: same sequence numbers, no error.
select * from push_changes('10000000-0000-4000-8000-000000000001',
  '[{"changeId":"20000000-0000-4000-8000-000000000001","commandType":"A","payload":{}},
    {"changeId":"20000000-0000-4000-8000-000000000002","commandType":"B","payload":{}}]');
select * from push_changes('10000000-0000-4000-8000-000000000001',
  '[{"changeId":"20000000-0000-4000-8000-000000000001","commandType":"A","payload":{}},
    {"changeId":"20000000-0000-4000-8000-000000000002","commandType":"B","payload":{}}]');

-- 2. Restore: marker row + snapshot at the marker's sequence.
insert into project_snapshots (project_id, snapshot, sequence_number, label)
  values ('10000000-0000-4000-8000-000000000001', '{"v":1}', 0, 'v1') returning id;  -- use this id below
select * from restore_snapshot('10000000-0000-4000-8000-000000000001', '<snapshot id>');
select sequence_number, command_type, payload from project_changes order by sequence_number;
select sequence_number, label from project_snapshots order by created_at;
rollback;
```

Expected: both `push_changes` calls return the same `(idx, ack_change_id, ack_sequence)` rows; `restore_snapshot` returns `r_sequence` = the sequence of a new `restore-snapshot` row, and the new snapshot has that sequence. Also check: a second user without a collaborator row gets `42501` from both functions; a change id inserted by user A and pushed by user B returns `ack_sequence = null`; two concurrent `push_changes` sessions on the same project block each other until COMMIT (open two psql sessions, `begin; select push_changes(...)` in both — the second waits). `user_records`: an update with the same `updated_at` as the stored row leaves the row unchanged. Realtime: with the app running against the local stack, a push from a second browser still arrives via `postgres_changes`.

## Open issues

- ~~Sequence visibility order~~ — fixed in 009 (per-project advisory lock in `push_changes` / `restore_snapshot`). Remaining gap: direct `insert` into `project_changes` is still allowed by the 001 RLS policy and is not serialized; the app never does it. Revoking it would require the RPCs to become `security definer`.
- The 009 SQL has not been executed in this repository's CI; see "Local verification of migration 009".
- `projects` rows created before 009 have `created_by = null`; an orphan among them cannot be adopted (409).
- Client: `pullStep` counts any pulled row whose change id is in the outbox as "own, acknowledged", regardless of `user_id`. With client-generated UUIDs a foreign row with the same id only occurs on purpose; the server no longer acknowledges such pushes.
- **`load-project` tail is capped** by PostgREST `max_rows` (default 1000). Signalled via `latestSequence` / `tailTruncated`; the current `engine-store` client ignores it (WP-SYNC should continue with `pull-changes`).
- **Orphan projects:** if the compensating rollback in `create-project` fails, the id stays occupied without an owner. Since 009 the creating user adopts it on retry (`created_by`); see `create-project`.
- `get-projects` still lacks CORS headers (unchanged; out of scope). `list-snapshots` uses the shared helpers since 010.
- Request size: an uploaded snapshot goes through one request; very large projects may hit the edge-function body limit.
- Client bug seen while reading (not changed here, WP-SYNC): `engine-store.loadProject` falls back to `data.snapshot?.sequence_number` (inside the snapshot JSON) instead of `data.snapshotSequence` when the tail is empty.
