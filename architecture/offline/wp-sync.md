# WP-SYNC — Sync engine and local-first loading

Implements the integration package of [ADR 0004](../adr/0004-offline-first.md): D1 (local-first), D4 (rebase + 3-way merge), D5 (safety snapshot), D8 (outbox), D9 (connectivity), D13 (mirroring service), D17 (sync UI), §3.

## Modules (`app/utils/sync/`)

| File | Role |
|---|---|
| `sync-engine.ts` | `SyncEngine`, one per open cloud project: lock, triggers, push hook, realtime intake, status |
| `sync-context.ts` | Shared deps/state types, `mergePending` |
| `sync-cycle.ts` | Pull step: classify pulled rows, apply directly or rebase |
| `sync-rebase.ts` | `computeRebase` (synchronous, over the state port), payload migration |
| `sync-push.ts` | Push outbox, safety snapshot (D5), base checkpoint, `lastSyncedAt` |
| `sync-position.ts` | `SyncPosition` (floor / cursor / seen ids), pack/unpack of stored snapshots |
| `sync-transport.ts` | Paged `pullAll`, chunked `pushRows` |
| `sync-status.ts` | Pure status mapping for the header icon |
| `sync-restore.ts`, `remote-api-restore.ts` | "Restore state before sync" (`restore-snapshot`) |
| `project-state-port.ts`, `engine-state-port.ts` | Port to the live state: `capture` / `apply` / `replay` |
| `open-project.ts`, `open-flow.ts` | Local-first open, first-open download |
| `project-session.ts` | Per-open-project session: writer + engine + push hook, binding rules |
| `working-snapshot-writer.ts` | Debounced working snapshot (1 s quiet, 5 s max) |
| `unload-handlers.ts` | `visibilitychange`/`beforeunload`: durable writes, best-effort keepalive |
| `project-mirror.ts`, `project-sync-service-impl.ts`, `open-sync-engine.ts` | `ProjectSyncService` (headless mirror / push, delegation to the open engine) |
| `legacy-wal.ts` | One-time `migrateLegacyWal` (plugin + before every open) |
| `current-user.ts` | Signed-in user id without network |
| `sync-conflicts.ts`, `describe-conflicts.ts` | Conflict report contract, human-readable lines |

Persist side: `app/utils/persistence/outbox-writer.ts` (new), `persist-queue.ts` (outbox instead of WAL). `wal.ts` is removed. UI: `app/components/sync/SyncStatusIndicator.vue` (in `AppHeader.vue`), `app/composables/use-sync-conflict-toast.ts` (plugin `06.sync-conflict-toast`), actions/lines in `use-notifications.ts` + `ToastStack.vue`. Service registration: plugin `07.project-sync.client.ts`.

## Persist path (D8)

```
history command / persistent live-op
  → persist queue (memory: order, dedupKey coalescing, settle 50 ms, backoff)
      → outbox-writer: appendOutbox (commands immediately, live-ops batched 50 ms)
  → flush → push hook = SyncEngine.pushForQueue
      → (backlog? full cycle : push) — pushes the STORED outbox, acks rows
```

- One serialized write chain keeps the store `order` equal to the creation order (commands flush the pending live-op batch first).
- The outbox is authoritative for what is sent; the queue only triggers pushes and gets sequence numbers back (rebased payloads are therefore what goes out).
- Local-only projects: `setPersistProjectId(id, { outbox: false })`, the push hook resolves `undefined` — no rows, no requests. Their persistence is the working snapshot.
- Cloud copies that must not sync (signed out, another account, `remoteDeletedAt`): rows are written and kept, the push hook sends nothing.

## Stored data

Snapshots in the `ProjectStore` carry `pmSync` (`StoredSyncSnapshot`):

- **position**: `floor`, `cursor`, `seen[{id, seq}]` — every change ≤ floor is reflected, above it exactly the `seen` ids. Pulls restart at `floor` (`PULL_OVERLAP` = 200 sequence numbers below the cursor) and skip seen ids. This handles out-of-order commits (wp-server.md open issue) and makes realtime + pulls idempotent.
- **outboxOrder** (working only): highest outbox `order` the snapshot reflects. Reopening replays rows with a higher order. The writer first writes all queued outbox rows, so no reflected row can get a higher order later.
- Base snapshot = server state at its position, nothing pending. Written on download, after a rebase, and as a **checkpoint** (live capture) whenever nothing is pending after a push. `meta.serverCursor` = base cursor.

## Open (`engine-store.loadProject` → `open-flow.ts`)

1. Close the previous session (working snapshot written first), reset queue/hooks, `ensureLegacyWalMigrated()`.
2. Local copy (working, else base) → extension gate → apply → replay outbox rows above `outboxOrder`. Works offline and signed out. A local project with meta only opens with `emptyProjectSnapshot()`.
3. No local copy, cloud: signed out → `offline-unavailable`; else `load-project` (+ `pull-changes` when `tailTruncated`; cursor from `snapshotSequence`/last tail row — the old `snapshot.sequence_number` bug is gone). Network error → `offline-unavailable` ("Not available offline" view in `layouts/project.vue`), 401 → `resolveUnauthorized` (+ `endSession` from WP-ACCOUNT), 403 → `unauthorized`. Stores meta (`origin: 'cloud'`, `ownerUserId` = user), base and working. Outbox rows already present (legacy WAL) are acked when in the tail, else replayed and pushed.
4. `startProjectSession`: writer, and a `SyncEngine` only if `origin === 'cloud'` and `syncBlocker(meta, userId)` is null. Collaboration (`useCollaboration.connect`) only for cloud projects.

## Sync cycle (§3.2)

Lock: every network operation of an engine (cycle or push) runs serialized. Triggers: start, `onReconnect`, realtime `SUBSCRIBED` (gap), every 60 s, and the persist queue while a backlog exists.

1. Pull all pages after `min(live.floor, base.floor)`.
2. Pending = stored outbox ∪ rows still being written (`mergePending`). Pulled rows whose id is pending are own → acked.
3. **Direct** (no backlog, or nothing pending, or no unseen foreign rows): replay unseen foreign rows on the live state, record all pulled rows in the live position, advance it.
4. **Rebase** (backlog + pending + unseen foreign rows), synchronously via the state port:
   `previous[i]` = old base + original pending[0..i-1]; new base = old base + rows the base does not reflect (server order); each pending row is migrated (`migrateModifiersDeep`, `modifier.update` legacy fields), `rebaseChange(row, current, previous[i])`, replayed; skipped rows dropped. Live state = result. Then: `updateOutbox` (rebased payloads), ack skipped + own rows, store base + working, remember the D5 snapshot.
5. Push: first the `before offline sync` server snapshot (new base at its highest sequence) — if it fails nothing is pushed; then the outbox in order (chunks of 200, stop at the first unconfirmed row).
6. On success: backlog cleared, conflicts reported (toast with "Restore state before sync"), base checkpoint when nothing is pending, `meta.lastSyncedAt`.

**Backlog** is set when the outbox had rows at open, when the app goes offline, and when a push fails with a network error. Without backlog (normal online editing, rows in flight for milliseconds) remote rows apply in arrival order as before — no rebase, no safety snapshot.

**Realtime**: CDC rows go to `handleRemoteInsert`; known ids (reflected, own) are only recorded; foreign command rows are applied via the collaboration applier (`history.executeRemote`); live-op rows are only recorded (broadcast applies them). During a cycle rows are deferred and decided afterwards.

## Server snapshots (autosave)

Unchanged timers (10 s idle / 30 s cap / every 20 commands / Cmd+S), now only for sessions with an engine, online, with an empty persist queue and outbox (`canSaveServerSnapshot`). Uses `remote-api.saveSnapshot`.

## Service (`ProjectSyncService`)

- `mirrorProject(head, userId)`: open project → `engine.requestSync()` (if bound to `userId`). Closed: skipped for local projects, other accounts and projects with pending rows; otherwise, if the server snapshot is newer than the local copy, it becomes base + working (`load-project`; the tail after it is pulled on the next open — headless code cannot replay).
- `flushAll(userId)`: cloud projects with `ownerUserId === userId` and no `remoteDeletedAt`. Open → `engine.flushNow()`. Closed → `pushHeadless`: pushes only if there is no foreign change since the base (no rebase needed) and records the acked ids in the working snapshot's position; otherwise the rows stay (rebased on the next open). Returns the pending count of all projects bound to the account.
- `countPending(projectId?)`: outbox count.

## Contract changes (additive)

- `persist-queue.setPersistProjectId(id, { outbox?: boolean })`; `flushPersistWal` now flushes the outbox writer (name kept).
- `use-history.setPersistenceHooks`: `walAppend` / `currentProjectId` removed (the queue writes the outbox row); `WalEntryForHooks` removed.
- `engine-store`: `projectOrigin`, `scheduleWorkingSnapshot()`, `projectError: 'offline-unavailable'`.
- `ProjectSyncService` signatures unchanged; `SyncEngine.boundUserId`, `flushNow()`.
- `restore-snapshot` edge function: CORS + JSON errors (needs deployment).

## Known limits

- **Snapshot-only state** (mutations that only mark the engine dirty, no command/live-op) is part of the working snapshot but not of the outbox; a rebase rebuilds the state from base + outbox and drops it.
- `previous[i]` ignores remote rows the live state already had above the base (rare: base is checkpointed whenever the outbox drains).
- A missed realtime **live-op** row is recorded as seen but only applied by the broadcast; if the broadcast was missed too, the value is stale until a reload from the server.
- `restore-snapshot` inserts a snapshot at the head but no change row: other open clients do not see the restore until they reload (pre-existing).
- Headless mirroring stores the server snapshot only; changes after it need an online open (or arrive with the next sync while open).
- `load-project` does not return the project name: a first open without meta stores `name: ''` until mirroring / the project list updates it.
- Not verified in a real browser / Tauri yet (see the report of this package).

## Tests

`app/utils/sync/*.test.ts` (fake port + fake server; scenarios: offline open, first-open offline error, outbox order/acks, rebase of offline edit vs. remote add, conflicts + restore, skipped changes, overlap dedup, local-only never calls remote, binding rules, service), `persist-queue.test.ts` (outbox), `describe-conflicts.test.ts`.
