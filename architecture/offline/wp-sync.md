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
| `sync-reject.ts` | Permanently rejected pushes (4xx): isolate row by row, discard + report |
| `sync-position.ts` | `SyncPosition` (floor / cursor / seen ids), pack/unpack of stored snapshots |
| `sync-transport.ts` | Paged `pullAll`, chunked `pushRows` |
| `sync-status.ts` | Pure status mapping for the header icon |
| `sync-restore.ts`, `remote-api-restore.ts` | "Restore state before sync" (`restore-snapshot`) |
| `project-state-port.ts`, `engine-state-port.ts` | Port to the live state: `capture` / `apply` / `replay` |
| `open-project.ts`, `open-flow.ts` | Local-first open, first-open download |
| `open-legacy-rows.ts` | First open: settle migrated (legacy WAL) outbox rows by pushing them once |
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
- A failed `appendOutbox` puts the unwritten rows of the batch back at the front of the queue (superseded dedupKey rows dropped) and retries with `backoffDelay`; until then they stay "unconfirmed", so no checkpoint can drop them.
- The persist queue no longer calls `reportNetworkSuccess()` after a hook result: the hook may resolve without a request (local-only, unbound copy). Real requests report connectivity in `invokeRemote`.
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
3. No local copy, cloud: signed out → `offline-unavailable`; else `load-project` (+ `pull-changes` when `tailTruncated`; cursor from `snapshotSequence`/last tail row — the old `snapshot.sequence_number` bug is gone). Network error → `offline-unavailable` ("Not available offline" view in `layouts/project.vue`), 401 → `resolveUnauthorized` (+ `endSession` from WP-ACCOUNT), 403 → `unauthorized`. Stores meta (`origin: 'cloud'`, `ownerUserId` = user), base and working. Outbox rows already present (legacy WAL) are acked when in the tail; the others are pushed once (`open-legacy-rows.ts`, idempotent by change id): a sequence ≤ `snapshotSequence` means the snapshot already contains the row (ack, no replay — previously it was applied twice), a higher one makes it a server change of the base (replayed after the tail, recorded in the position), an unconfirmed one stays pending on top. Like older builds, these rows are pushed as recorded (no rebase).
4. `startProjectSession`: writer, and a `SyncEngine` only if `origin === 'cloud'` and `syncBlocker(meta, userId)` is null. Collaboration (`useCollaboration.connect`) only for cloud projects.

## Sync cycle (§3.2)

Lock: every network operation of an engine (cycle or push) runs serialized. Triggers: start, `onReconnect`, realtime `SUBSCRIBED` (gap), every 60 s, and the persist queue while a backlog exists.

1. Pull all pages after `min(live.floor, base.floor)`.
2. Pending = stored outbox ∪ rows still being written (`mergePending`). Pulled rows whose id is pending are own → acked.
3. **Direct** (no backlog, or nothing pending, or no foreign rows the **base** lacks): replay foreign rows the live state lacks, record all pulled rows in the live position, advance it. Pulled own rows (lost ack) are acked and their sequence numbers handed to the persist queue.
4. **Rebase** (backlog + pending + foreign rows the **base** does not reflect — decided on the base, not the live position, so a row already applied via realtime still forces the rebase), synchronously via the state port:
   `previous[i]` = old base + original pending[0..i-1]; new base = old base + rows the base does not reflect (server order); each pending row is migrated (`migrateModifiersDeep`, `modifier.update` legacy fields), `rebaseChange(row, current, previous[i])`, replayed; skipped rows dropped. Live state = result. Then: `updateOutbox` (rebased payloads), ack skipped + own rows, store base + working, remember the D5 snapshot.
5. Push: first the `before offline sync` server snapshot (new base at its highest sequence) — if it fails nothing is pushed; then the outbox in order (chunks of 200, stop at the first unconfirmed row). An empty outbox clears the pending safety snapshot (nothing to protect); every rebase resets the id offered for "Restore state before sync". A non-retryable rejection (403/400/422/409) is isolated by pushing the remaining rows one by one: rejected rows are removed from the outbox and reported as a status error ("N changes were rejected by the server and discarded"), the others go through.
6. On success: backlog cleared, conflicts reported (toast with "Restore state before sync"), base checkpoint when nothing is pending, `meta.lastSyncedAt`.

**Backlog** is set when the outbox had rows at open, when the app goes offline, and when a push fails with a network error. Without backlog (normal online editing, rows in flight for milliseconds) remote rows apply in arrival order as before — no rebase, no safety snapshot.

**Realtime**: CDC rows go to `handleRemoteInsert`; known ids (reflected, own) are only recorded; foreign command rows are applied via the collaboration applier (`history.executeRemote`); rows the applier does not handle (it returns `false`, e.g. live-ops) and all rows without an applier are replayed through the state port — a peer that edited offline never broadcast them, and live-op values are absolute, so a second application via broadcast is harmless. During a cycle rows are deferred and decided afterwards.

## Session lifecycle and account binding

A session ends on every project switch, when the project page unmounts (`layouts/project.vue` → `engineStore.closeSession()`), on sign-out (`finishSignOut` → `teardownAccountSession`, before any cache clear) and on `SIGNED_OUT` / an account switch (`05.account.client.ts` via `account-events.ts`). `closeSession` is idempotent and:

- bumps a load generation, so a `loadProject` still in flight does not start its session afterwards;
- removes the unload handlers and unsubscribes the per-load token listener (`onAuthStateChange`);
- clears the undo/redo history (`clearHistory()`), which belongs to the closed project;
- awaits `ProjectSession.close()`: stop the engine first, then flush and dispose the working-snapshot writer (later `flush()` calls are no-ops, so a cleared cache is never refilled).

`SyncEngine.stop()` is async: it removes the triggers and waits for the running cycle/push (at most 5 s). As a backstop the engine wraps its `SyncDeps` (`sync-guard.ts`): once stopped, or once the signed-in account differs from `boundUserId`, remote calls, store writes and live-state access through the shared port throw `SyncBlockedError`, and `writeWorking` / `onLiveChanged` / `onSequence` / `onRebased` become no-ops. A late step of project A therefore never captures or replays into project B, and never pushes with account B's token.

The signed-in account is published synchronously by the account plugin (`utils/auth/current-account.ts`; `undefined` before the first auth event = not blocking). `cycle()`, `pushAndSettle()` and `pushForQueue()` (throws like offline, rows stay in the outbox) check `canSync()`; the unload keepalive is skipped when `!engine.canSync()`. The token cached for keepalive is cleared on sign-out.

After a rebase the engine calls `deps.onRebased()` (from `pullStep`'s `rebased` flag, no change in `sync-cycle.ts`); the engine store clears the undo/redo stacks then, because their before/after payloads predate the merged peer changes.

## Server snapshots (autosave)

Unchanged timers (10 s idle / 30 s cap / every 20 commands / Cmd+S), now only for sessions with an engine, online, with an empty persist queue and outbox (`canSaveServerSnapshot`). Uses `remote-api.saveSnapshot`.

## Service (`ProjectSyncService`)

- `mirrorProject(head, userId)`: open project → `engine.requestSync()` (if bound to `userId`). Closed: skipped for local projects, other accounts and projects with pending rows (also without meta: legacy-WAL rows have no account and are bound by the first signed-in open, never by a background pass); nothing is written when `userId` is no longer the signed-in account after the download; otherwise, if the server snapshot is newer than the local copy, it becomes base + working (`load-project`; the tail after it is pulled on the next open — headless code cannot replay).
- `flushAll(userId)`: cloud projects with `ownerUserId === userId` and no `remoteDeletedAt`. Open → `engine.flushNow()`. Closed → `pushHeadless`: pushes only if there is no foreign change since the base (no rebase needed) and records the acked ids in the working snapshot's position — only rows with `order <= outboxOrder` (contained in the snapshot); newer rows are pulled as server changes on the next open; otherwise the rows stay (rebased on the next open). Returns the pending count of all projects bound to the account.
- `countPending(projectId?)`: outbox count.

## Contract changes (additive)

- `persist-queue.setPersistProjectId(id, { outbox?: boolean })`; `flushPersistWal` now flushes the outbox writer (name kept).
- `use-history.setPersistenceHooks`: `walAppend` / `currentProjectId` removed (the queue writes the outbox row); `WalEntryForHooks` removed.
- `engine-store`: `projectOrigin`, `scheduleWorkingSnapshot()`, `projectError: 'offline-unavailable'`.
- `ProjectSyncService` signatures unchanged; `SyncEngine.boundUserId`, `flushNow()`.
- `SyncEngine.stop()` returns a promise; `SyncEngine.canSync()`; `SyncDeps.onRebased?()`; `SessionInput.onRebased?`; `engine-store.closeSession()` exported; `use-history.clearHistory()`.
- `restore-snapshot` edge function: CORS + JSON errors (needs deployment).

## Known limits

- **Snapshot-only state** (mutations that only mark the engine dirty, no command/live-op) is part of the working snapshot but not of the outbox; a rebase rebuilds the state from base + outbox and drops it.
- `previous[i]` ignores remote rows the live state already had above the base (rare: base is checkpointed whenever the outbox drains).
- A row acked by a push whose working snapshot write did not happen yet (crash between `ackOutbox` and the checkpoint's working write) is neither in the outbox nor in the working position: the next open pulls it as a foreign change and applies it on top of a state that already has it (harmless for absolute payloads).
- Rows discarded after a permanent rejection stay applied in the local live state (and in the next checkpoint) until the server state overwrites those values or the project is reloaded from the server.
- `pushHeadless` does not isolate rejected rows (a rejection keeps the closed project's rows until it is opened).
- A successful outbox write retry does not trigger a push by itself; the rows go out with the next push, cycle or periodic sync.
- Since migration 009 a restore appends a `restore-snapshot` marker change and stores the snapshot at its sequence. Clients never replay the marker: `remote-restore.ts` (called from `engine-state-port.replayChange` for pulls/rebases and from the realtime applier in `use-collaboration.ts`) schedules one reload of the open project from the server and blocks server snapshots until it finished. If the download fails (offline), the local copy is opened and the restore is only picked up on the next fresh open.
- Headless mirroring stores the server snapshot only; changes after it need an online open (or arrive with the next sync while open).
- `load-project` does not return the project name: a first open without meta stores `name: ''` until mirroring / the project list updates it.
- Not verified in a real browser / Tauri yet (see the report of this package).

## Tests

Fake port + in-memory fake server (`sync-test-kit.ts`, `sync-test-server.ts`: global sequence numbers, reserved late commits, unconfirmed acks, HTTP failure injection per function or per change id).

| Scenario (ADR 0004) | Test file → test |
|---|---|
| Offline open, first open, tail continuation, migrated rows (incl. covered by the snapshot) | `sync-open.test.ts` |
| Outbox order, acks, unconfirmed acks, offline push | `sync-outbox-push.test.ts` |
| Rebase: offline edit of A vs. remote add of B, rebased payload pushed, base/cursor advanced; same-field conflict + restore; skipped `modifier.update`; skip-only rebase leaves no stale D5 snapshot | `sync-rebase-engine.test.ts` |
| Second client replays the pushed payload and keeps B; `modifier.update` rebase; failing D5 snapshot → nothing pushed, retried next cycle; skipped `RenameNode`/`DeleteNodes`; restore id per rebase | `sync-rebase-safety.test.ts` |
| Overlap dedup, late lower sequence, realtime/own echoes, realtime row during a backlog still rebases | `sync-overlap.test.ts` |
| Local-only never calls remote, close + reopen yields the identical state; unbound copies (signed out / other account / deleted) | `sync-session.test.ts` |
| `mirrorProject` (closed, other account, open project: delegation, concurrent requests apply once), `flushAll` binding rules | `sync-service.test.ts` |
| Crash recovery on fake-indexeddb: restart, offline reopen, lost ack, idempotent re-push | `sync-recovery.test.ts` |
| Realtime live-ops, failed outbox writes, headless ack vs. `outboxOrder`, rejected pushes | `sync-hardening.test.ts` |
| Session lifecycle: stop waits for an in-flight push; a step finishing after stop cannot touch the next project; no sync as another account / signed out / after a switch mid-cycle; `onRebased` | `sync-engine-lifecycle.test.ts` |
| Headless mirror: legacy rows without meta stay unbound; no write-back after sign-out | `project-mirror-account.test.ts` |
| Close: final working write, disposed writer never writes again | `sync-session.test.ts` › close |

Also `persist-queue.test.ts` (outbox, no false "online"), `describe-conflicts.test.ts`, adapter tests in `merge/`.

### Bugs fixed by these tests

- Realtime row received during a backlog made the cycle skip the rebase and push stale payloads (`sync-cycle.ts`, rebase decided on the base).
- Skip-only rebase left `state.safety` set → stale `before offline sync` snapshot on a later push (`sync-push.ts`).
- Conflicts of a later rebase offered the snapshot of an earlier one for restore (`sync-cycle.ts` resets `safetySnapshotId`).
- Own rows confirmed by a pull returned no sequence number to the persist queue (`sync-cycle.ts`).
- Realtime live-op rows were marked seen but never applied (`sync-realtime.ts`, `use-collaboration.ts`).
- Failed outbox writes lost the rest of the batch (`outbox-writer.ts`).
- `pushHeadless` marked rows newer than the working snapshot as reflected (`project-mirror.ts`).
- Migrated rows covered by the server snapshot were applied twice on first open (`open-flow.ts`, `open-legacy-rows.ts`).
- A permanently rejected row blocked every later push (`sync-push.ts`, `sync-reject.ts`).
- The persist queue reported "online" after hooks that made no request (`persist-queue.ts`).

Not covered yet: realtime rows deferred during a running cycle (`drain`), the real `EngineStatePort` (tests use the fake port), browser/Tauri runs.
