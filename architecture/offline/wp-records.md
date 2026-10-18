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
| `app/plugins/04.user-records.client.ts` | Installs the remote, forwards `onAuthStateChange` → `setRecordUser` |
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

## Accounts

- **Signed out**: new records get `ownerUserId: null` and never leave the device. Lists show every local record (records bound to an account stay usable offline, cf. D15); they sync when that account signs in again.
- **Signed in as U**: lists show records with `ownerUserId` `null` or `U`. New records belong to `U`.
- Records of other accounts are hidden.

Hooks for WP-ACCOUNT (no UI here):

| Function | Use |
|---|---|
| `adoptLocalRecords(userId, { kinds? })` | D14: bind local-only records to the account and upload them. Returns the count. Not called automatically. |
| `countPendingRecords(userId)` | D16: check for unsynced changes before logout. |
| `syncAllRecords()` | Sync every collection now (e.g. before logout). |
| `clearLocalRecords()` | D16 web logout: signs the record sync out, waits for running rounds, deletes all local records and cursors. |
| `setRecordUser(id \| null)` | Report the account (done by the plugin). |

> **Note for WP-ACCOUNT (web):** the web app has no D14 dialog, but fixtures migrated from localStorage start local-only (`ownerUserId: null`). On web, call `adoptLocalRecords(userId)` after sign-in so they reach the account.

## Custom fixture library

`useCustomFixtureLibrary()` → `{ customFixtures, loaded, ready, saveCustomFixture(ofl, id?), removeCustomFixture(id) }`.

- Record kind `custom-fixture`, data `{ name, ofl, createdAt }`, list sorted by `createdAt` (newest first, edits keep their position).
- **Identity is the UUID, not the name.** `saveCustomFixture(ofl)` always creates a new entry, even if the name exists. `saveCustomFixture(ofl, id)` replaces entry `id` (editing). `AddFixtureDialog` remembers the id of the entry opened with "Edit" and passes it when the editor emits `update-type`.
- **Migration**: on first use, entries of `localStorage['pixelmapper:customFixtures']` are written in one transaction with new UUIDs (name, definition and `createdAt` kept), then the key is removed. Invalid JSON is left untouched and logged.
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

`bun run test` — `app/utils/sync/records/*.test.ts` and `app/composables/use-custom-fixture-library.test.ts` (fake-indexeddb, in-memory server `fake-record-remote.ts` that mirrors the migration's trigger, mocked Supabase client for the remote): LWW in both directions, tombstones (local and remote), offline → reconnect, local-only records and adoption, clearing, scheduler backoff, localStorage migration and editing semantics.

## Deploy

1. Apply the migration to the Supabase project: `supabase db push` (runs `008_user_records.sql`; requires `supabase link` to the project).
2. Optional: regenerate `app/types/database.types.ts` (`supabase gen types typescript`). The remote uses an untyped client, so this is not required.
3. Deploy the frontend. No edge function is needed.

Until the migration is deployed, pushes fail with a non-network error; records stay local and dirty, the collection status is `error`, and the sync retries with backoff (max. every 30 s).
