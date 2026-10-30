# WP-STORE — Local project store

Implements the `ProjectStore` contract of ADR 0004 (D1, D8, D12, §3.1).
Code: `app/utils/persistence/project-store/`.

> Not wired into engine-store or the UI yet — that is WP-SYNC.

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | The contract (`ProjectStore`, `LocalProjectMeta`, `OutboxEntry`). Unchanged. |
| `idb-helpers.ts` | Schema constants, connection opener, promise wrappers for requests and transactions. |
| `indexeddb-project-store.ts` | `IndexedDbProjectStore`, the primary implementation. |
| `in-memory-project-store.ts` | `InMemoryProjectStore`, used by tests and as the fallback when IndexedDB is unavailable. |
| `legacy-wal-migration.ts` | `migrateLegacyWal(store)`, a one-time move of the old WAL into the outbox. |
| `index.ts` | `getProjectStore()` singleton plus re-exports. |
| `project-store-contract.ts` | Shared contract test suite (`runProjectStoreContract`). |
| `*.test.ts` | Runs the suite against both implementations, plus tests specific to each one. |

## Usage

```ts
import { getProjectStore, migrateLegacyWal } from '~/utils/persistence/project-store';

const store = await getProjectStore();   // IndexedDB, or memory + console.warn
await migrateLegacyWal(store);           // once at startup (idempotent)
const entry = await store.appendOutbox({ id, projectId, kind: 'live-op', type, payload, dedupKey, enqueuedAt: Date.now() });
```

`getProjectStore()` is **async**: it probes IndexedDB by opening the database
and only falls back to memory if that fails. The failed probe is not cached
inside `IndexedDbProjectStore`, but the singleton decision is cached for the
session.

## IndexedDB layout (`pixelmapper-projects`, version 1)

| Object store | keyPath | Content |
| --- | --- | --- |
| `meta` | `id` | `LocalProjectMeta` |
| `base-snapshots` | `projectId` | `{ projectId, snapshot }` |
| `working-snapshots` | `projectId` | `{ projectId, snapshot }` |
| `outbox` | `id` | `OutboxEntry`. Indexes: `byProjectOrder` `[projectId, order]`, `byProjectDedup` `[projectId, dedupKey]`, `byOrder` `order` |
| `counters` | `name` | `{ name: 'outboxOrder', value }` |

Entries without a `dedupKey` are not part of `byProjectDedup`, because IndexedDB
skips records with an undefined key component.

## Semantics

- **Durability.** Every write resolves only after its transaction fires `complete`.
- **Atomicity.** These operations each run in a single transaction:
  - `deleteProject` covers meta, both snapshots and the project's outbox entries.
  - `putBaseSnapshot` writes the snapshot and `meta.serverCursor`. If no meta exists, none is created.
  - `appendOutbox` covers the counter, the dedup delete and the insert.
- **Order.** `order = max(persisted counter, highest stored order) + 1`.
  - The counter is persisted, so it survives reloads and new store instances.
  - Acking the newest entry never makes the order go backwards.
  - `clearAll` keeps the counter on purpose.
  - The max-scan repairs a lost counter.
- **Dedup (D8).** Appending with a `dedupKey` deletes the pending entry with the
  same `(projectId, dedupKey)`. The new entry gets a fresh `order`, so it moves to the end.
- **`updateOutbox`.** Replaces the stored entries by id, but keeps the stored
  `order` and `projectId`. Unknown (already acked) ids are skipped.
- **`ackOutbox`.** Ignores unknown and empty ids.
- **`clearAll`.** Clears meta, snapshots and outbox (web logout, D16).
- **Copies.** IndexedDB structured-clones its values. The memory store does the same
  with `structuredClone`, so callers see the same semantics. Vue reactive proxies
  must be unwrapped (`toRaw`) before storing, otherwise a `DataCloneError` is thrown.

## Open handling

Same pattern as `wal.ts`:

- The connection is cached.
- `onversionchange` and `onclose` drop the cache, so the next call reopens.
- `onerror` and `onblocked` reject, and so does a missing `indexedDB` or a synchronous
  `open` throw (Safari private mode, sandboxed frames).
- Failures are **never cached**, so the next call retries.

## Legacy WAL migration

`migrateLegacyWal(store, { factory? })` reads `pixelmapper-wal` / `pending-changes`:

1. Opens the DB **without a version**. If it does not exist, the upgrade is aborted,
   so the migration never creates the legacy DB, and it returns zero counts.
2. Validates each record (`id`, `projectId`, `type ?? commandType`). Malformed
   records stay in the legacy DB and are counted as `invalid`.
3. Sorts by `enqueuedAt` and appends each record to the outbox:
   - `kind` defaults to `'command'`.
   - `dedupKey` is kept when present (the optional fields added to `WalEntry` by WP-P0).
4. Skips a record whose `id` is already in the outbox. It also skips one whose
   `dedupKey` is held by an outbox entry with `enqueuedAt` greater than or equal to its own.
5. Deletes all valid records from the legacy DB once they are durable in the outbox.

Each step is idempotent. If a crash happens between step 3 and step 5, the next run
moves nothing twice and does not resurrect a coalesced (superseded) live-op.

**Caveat for WP-SYNC.** While `wal.ts` is still in use, a migration run takes its
entries away. Run the migration only once the outbox has replaced the WAL in
the push path. Or run it before `walGetPending` is first called and stop
using `wal.ts` afterwards.

## Tests

`runProjectStoreContract(name, harness)` runs against both implementations
(`fake-indexeddb`, with a fresh `IDBFactory` per test). It covers:

- meta CRUD and copy semantics
- snapshots and the cursor update
- ordering and dedup replacement
- `updateOutbox`, ack and counts
- persistence across instances, including the order counter
- the `deleteProject` cascade and `clearAll`
- migration: no-op, ordering, idempotency after an interrupted run, malformed entries

Tests specific to IndexedDB cover a missing `indexedDB` and a retry, and a
`versionchange` followed by a reopen. The memory test file also covers the
`getProjectStore()` fallback.
