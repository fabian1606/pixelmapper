# WP-SERVER — Edge functions for offline sync

Part of [ADR 0004 — Offline-First](../adr/0004-offline-first.md) (§3.2, §4; D5, D11, D13, D14, D15).
Provides the server side of the sync cycle and a typed client wrapper. Client call sites are wired up by WP-SYNC / WP-ACCOUNT.

## Files

| File | Purpose |
|---|---|
| `supabase/functions/_shared/http.ts` | CORS, `json()`, `errorResponse()`, `preflight()`, `readJsonObject()` |
| `supabase/functions/_shared/auth.ts` | `authenticate()` (user-scoped client + user or 401), `adminClient()`, `callerRole()` |
| `supabase/functions/_shared/validate.ts` | Pure request parsers (`parsePullChanges`, `parseCreateProject`, `parseSaveSnapshot`, `isUuid`) — tested with `bun test supabase/functions/_shared` |
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

All error responses of the changed/new functions are JSON `{ "error": string }` with CORS headers. `push-change` is unchanged.

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
- With `id`: if the project exists and the caller is its **owner**, it is returned with `created: false` (if a `snapshot` was sent and the project has none yet, it is added — completes a half-failed earlier attempt). If it belongs to someone else → **409** `project id already in use`. A concurrent create with the same id → 409 `project is being created, retry`.
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
- Fix: among snapshots with the same `sequence_number` (restore-snapshot inserts at the head) the newest one wins.

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
# 1. Schema first (list-projects-sync needs project_sync_heads()).
supabase db push

# 2. Functions (each bundles ../_shared).
supabase functions deploy create-project
supabase functions deploy pull-changes
supabase functions deploy load-project
supabase functions deploy list-projects-sync
supabase functions deploy save-snapshot
```

All functions keep the default JWT verification. Order matters only for `list-projects-sync` (needs migration 007); the others work against the existing schema. The changed functions are backward compatible with the current client, so they can be deployed before WP-SYNC lands.

Local verification (optional): `supabase start && supabase functions serve` and call them with a test user token. Type-check: `deno check supabase/functions/<name>/index.ts` (needs a deno config with `"nodeModulesDir": "auto"` outside the repo root, because the root `package.json` otherwise makes Deno look for `npm:openai` in `node_modules`).

## Open issues

- **Sequence visibility order.** `project_changes.sequence_number` is a global identity: two concurrent inserts can commit in a different order than their numbers. A pull between the two commits can advance the cursor past a not-yet-visible lower number, which is then skipped. The window is tiny (single-statement inserts), and realtime has the same property. Fix if needed: push through an RPC that takes `pg_advisory_xact_lock(hashtext(project_id::text))` before inserting, so per-project numbers become visible in order; or have the client re-pull with a small overlap and dedupe by `change_id`.
- **`load-project` tail is capped** by PostgREST `max_rows` (default 1000). Signalled via `latestSequence` / `tailTruncated`; the current `engine-store` client ignores it (WP-SYNC should continue with `pull-changes`).
- **Orphan projects:** if the compensating rollback in `create-project` fails, the id stays occupied without an owner and later creates with that id get 409.
- `get-projects`, `list-snapshots`, `restore-snapshot` still lack CORS headers (unchanged; out of scope).
- Request size: an uploaded snapshot goes through one request; very large projects may hit the edge-function body limit.
- Client bug seen while reading (not changed here, WP-SYNC): `engine-store.loadProject` falls back to `data.snapshot?.sequence_number` (inside the snapshot JSON) instead of `data.snapshotSequence` when the tail is empty.
