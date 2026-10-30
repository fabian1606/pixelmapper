# WP-RECORDS — User record sync + custom fixture library

Implements [ADR 0004](../adr/0004-offline-first.md) D21 (with D3, D6, D9, D14, D16).

## Overview

User-level data that is not part of a project (first: the custom fixture library) is stored as **user records**: small JSON documents in IndexedDB, synced per record to the Supabase table `user_records` with last-writer-wins on `updatedAt`.

```
 AddFixtureDialog ─► useCustomFixtureLibrary ─► RecordCollection<'custom-fixture'>
                                                  │ put / remove → IndexedDB (pixelmapper-user-records)
                                                  │ debounced / on login / on reconnect
                                                  ▼
                                    record-sync: push dirty → pull since cursor
                                                  ▼
                                    RecordRemote (Supabase: user_records, RLS)
```

## Files

| File | Role |
|---|---|
| `supabase/migrations/008_user_records.sql` | Table, LWW trigger, server cursor, RLS |
| `app/utils/sync/records/types.ts` | `UserRecord`, server rows, `RecordRemote` |
| `app/utils/sync/records/record-db.ts` | All IndexedDB access (`records` store with `kind` index, `meta` store for cursors) |
| `app/utils/sync/records/record-sync.ts` | One push + pull round (pure over db + remote) |
| `app/utils/sync/records/sync-scheduler.ts` | Single-flight runner, debounce, `backoffDelay` retries |
| `app/utils/sync/records/record-collection.ts` | `createRecordCollection<T>(kind)` — reactive list + mutations |
| `app/utils/sync/records/record-session.ts` | Remote, signed-in account, collection registry, account hooks |
| `app/utils/sync/records/record-remote.ts` | Supabase implementation of `RecordRemote` |
| `app/utils/sync/records/record-auth-binding.ts` | `bindRecordUserToAuth(auth, setUser)` — auth events → account, with cached-session fallback (D10) |
| `app/plugins/04.user-records.client.ts` | Installs the remote, binds `onAuthStateChange` → `setRecordUser` via `bindRecordUserToAuth` |
| `app/composables/use-custom-fixture-library.ts` | Custom fixture library on the `custom-fixture` collection |
| `app/utils/engine/custom-fixture-legacy-migration.ts` | One-time localStorage → IndexedDB migration |

## Data model

Local record (`UserRecord<T>`): `{ id, kind, data, updatedAt, deletedAt, dirty, ownerUserId }`.

- `id` — UUID (D6).
- `updatedAt` — LWW clock (epoch ms). Local writes use `max(now, previous + 1)`.
- `deletedAt` — pending tombstone. Visible lists hide it; after the server accepted it the record is deleted locally.
- `dirty` — has changes the server has not accepted.
- `ownerUserId` — account the record belongs to; `null` = local only.

Server table `user_records(id, user_id, kind, data, updated_at, deleted_at, server_updated_at)`:

- `updated_at` is the client LWW clock. A `BEFORE UPDATE` trigger **skips** writes with an older `updated_at` than the stored row, so LWW holds for concurrent pushes. Ownership and kind are immutable.
- `server_updated_at` (addition to the ADR column list) is set by the trigger on every accepted write and is the **pull cursor**. Pulling on the client clock `updated_at` would miss writes from devices whose clocks lag behind.
- RLS: every policy is `user_id = auth.uid()`.
- Tombstones stay on the server (pruning is out of scope).

## Sync round (`syncRecordKind`)

1. **Push** dirty records with `ownerUserId === currentUser` (upsert on `id`, chunks of 100). The upsert returns only accepted ids. Accepted → marked clean (tombstones deleted) unless edited meanwhile. Rejected → the server row is newer; it is fetched and replaces the local record.
2. **Pull** rows of the kind with `(server_updated_at, id) > cursor` (keyset pages of 500). The first page restarts 5 s before the stored cursor so a transaction that committed late is not skipped (re-applying is idempotent). Per row:
   - local dirty and `local.updatedAt >= remote.updated_at` → keep local (it will be pushed);
   - remote tombstone → delete locally;
   - otherwise → replace local with the remote row (clean, owned by the account).
3. The cursor is stored per account and kind in the `meta` store.

## Triggers and connectivity

- **Login**: `setRecordUser(id)` (from the plugin) reloads every list and syncs every collection. A collection created while signed in syncs once after its first load.
- **Local change**: debounced round (1 s).
- **Reconnect**: `onReconnect` from `connectivity.ts` resets the backoff and syncs.
- **Failure**: retry with `backoffDelay(attempt)` (500 ms … 30 s, D9). Network errors (`isNetworkError`) call `reportNetworkFailure()`; successes call `reportNetworkSuccess()`.
- **Offline gate**: while `isOnline` is false the scheduler starts no round (`syncNow`, debounce and retry timers are no-ops) and arms no retry timer; the reconnect handler resumes. A round offline would only fail — with an expired token auth-js spends ~28 s on the refresh attempt first.

## Accounts

- **Signed out**: new records get `ownerUserId: null` and never leave the device. Lists show every local record (records bound to an account stay usable offline, cf. D15); they sync when that account signs in again.
- **Signed in as U**: lists show records with `ownerUserId` `null` or `U`. New records belong to `U`.
- Records of other accounts are hidden.

### Account resolution (auth events → `setRecordUser`)

- `bindRecordUserToAuth` (plugin 04) resolves every auth event with `resolveAuthEventUser`: the event's session, `null` only on a real `SIGNED_OUT`, otherwise the **cached session** (no network). Offline with an expired token auth-js emits `INITIAL_SESSION` with a null session; without the fallback every record saved afterwards would be local-only — never uploaded, never adopted (no new sign-in), and deleted without warning by a web logout. Events are deferred (`setTimeout 0`, auth-js deadlock) and handled strictly in order.
- **Records written before the account is known.** Until the first `setRecordUser` call the account is unknown (the plugin defers; the legacy migration or a quick save may run first). Collections report records they wrote without owner in that window (`noteOwnerlessWrites`). The first `setRecordUser(id)` binds exactly those (still local-only, not deleted) records to `id` and uploads them — they were created by this device's signed-in user, so this is no D14 upload of foreign data. If the first resolution is `null` (really signed out) they stay local-only. Tracking is in-memory: a reload before the account resolves leaves them local-only, which `countPendingRecords` then reports.
- **Account switch during a round.** `setRecordUser` switches the account first and then waits for running rounds (`whenIdle`) before reloading and syncing. Every round carries `isCurrent = () => getRecordUser() === userId`; `record-sync` checks it before every local write (inside the IndexedDB transaction for applied rows, and before marking pushes clean and storing the cursor) and stops with `RecordSyncAbortedError` (status `idle`, no retry). So rows pulled for A after a switch to B (or after `clearLocalRecords`) are never written.

Hooks for WP-ACCOUNT (no UI here):

| Function | Use |
|---|---|
| `adoptLocalRecords(userId, { kinds? })` | D14: bind local-only records to the account and upload them. Returns the count. Not called automatically. |
| `countPendingRecords(userId)` | D16: check for unsynced changes before logout. Counts dirty records of `userId` **and every local-only record** (`ownerUserId: null`) — `clearLocalRecords` would delete those too. |
| `clearForeignRecords(userId)` → `{ removed, keptDirty }` | D16 cache clear a logout could not do (e.g. automatic sign-out, then another account signs in on web): deletes synced (non-dirty) records of other accounts, keeps and counts their dirty ones; local-only and `userId` records are untouched. |
| `syncAllRecords()` | Sync every collection now (e.g. before logout). |
| `clearLocalRecords()` | D16 web logout: signs the record sync out, waits for running rounds, deletes all local records and cursors. |
| `setRecordUser(id \| null)` | Report the account (done by the plugin). |

> **Note for WP-ACCOUNT (web):** the web app has no D14 dialog, but fixtures migrated from localStorage start local-only (`ownerUserId: null`). On web, call `adoptLocalRecords(userId)` after sign-in so they reach the account.

## Custom fixture library

`useCustomFixtureLibrary()` → `{ customFixtures, loaded, ready, saveCustomFixture(ofl, id?), removeCustomFixture(id) }`.

- Record kind `custom-fixture`, data `{ name, ofl, createdAt }`, list sorted by `createdAt` (newest first, edits keep their position).
- **Identity is the UUID, not the name.** `saveCustomFixture(ofl)` always creates a new entry, even if the name exists. `saveCustomFixture(ofl, id)` replaces entry `id` (editing). `AddFixtureDialog` remembers the id of the entry opened with "Edit" and passes it when the editor emits `update-type`.
- **Migration**: on first use, entries of `localStorage['pixelmapper:customFixtures']` are written in one transaction with new UUIDs (name, definition and `createdAt` kept), then the key is removed. Invalid JSON is left untouched and logged.
- **Migration across tabs**: two tabs opened at once must not both migrate (every fixture would be duplicated under new UUIDs). With the Web Locks API the migration runs under the exclusive lock `pixelmapper:custom-fixture-migration`; the second tab then finds the key gone. Without Web Locks the list is **claimed** synchronously: read, copied to `pixelmapper:customFixtures:migrating` with a timestamp and removed from the legacy key in one task; the claim is removed after the write. A claim older than 60 s is from a crashed tab and is migrated again.
- `pixelmapper:recentFixtures` stays in localStorage (device-local).
- During SSR (no IndexedDB) the library is empty.

## Using it for a new kind

```ts
const presets = createRecordCollection<MyData>('my-kind');
await presets.ready;
presets.items.value;            // RecordItem<MyData>[]
const id = await presets.put(data);   // new UUID
await presets.put(next, id);          // replace
await presets.remove(id);             // tombstone (or delete if local-only)
```

`createRecordCollection` returns one shared instance per kind.

## Tests

`bun run test` — `app/utils/sync/records/*.test.ts` and `app/composables/use-custom-fixture-library.test.ts` (fake-indexeddb, in-memory server `fake-record-remote.ts` that mirrors the migration's trigger, mocked Supabase client for the remote): LWW in both directions, tombstones (local and remote), offline → reconnect, local-only records and adoption, clearing, scheduler backoff, localStorage migration and editing semantics. `record-account.test.ts`: offline cold start (`INITIAL_SESSION` without session → cached account), adoption of records written before the account is known, `countPendingRecords` with local-only records, `clearForeignRecords`, and account switch / logout clear during a running pull. `custom-fixture-legacy-migration.test.ts`: two tabs migrating at once (Web Locks and claim fallback), stale claims.

## Deploy

1. Apply the migration to the Supabase project: `supabase db push` (runs `008_user_records.sql`; requires `supabase link` to the project).
2. Optional: regenerate `app/types/database.types.ts` (`supabase gen types typescript`). The remote uses an untyped client, so this is not required.
3. Deploy the frontend. No edge function is needed.

Until the migration is deployed, pushes fail with a non-network error; records stay local and dirty, the collection status is `error`, and the sync retries with backoff (max. every 30 s).
