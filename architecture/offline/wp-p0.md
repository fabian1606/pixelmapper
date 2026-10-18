# WP-P0 — Offline Foundations

Implements the foundation package of [ADR 0004](../adr/0004-offline-first.md): D6 (UUID ids), D8 (live-ops in the outbox/WAL), D9 (backoff + connectivity), D10 (offline never logs out).

## D6 — UUID ids

- `app/utils/ids.ts`: `newUuid()` (uses `crypto.randomUUID`, falls back to `getRandomValues` outside secure contexts) and `newPrefixedId(prefix)`.
- Groups: `group-<uuid>` (`use-workspace-operations.ts`, which used a per-page-load counter before).
- Presets: `preset-<uuid>` (`use-presets.ts`, `PresetsSidebar.vue` ×3, which used `Date.now()` before).
- Fixtures: `ofl-<uuid>` (`utils/engine/addressing.ts`, which used an `ofl-N` counter before). The code that parsed `ofl-N` to bump the counter is removed.
- History `changeId`s use `newUuid()`.
- Ids are opaque: no code parses the prefixes. Existing ids stay valid.
- Not changed here: custom fixture library ids (`AddFixtureDialog.vue`, owned by WP-RECORDS) and custom-fixture-editor SVG element ids (also custom fixture library).

## D8 — Persistent live-ops in the WAL

**Persist queue** (`app/utils/persistence/persist-queue.ts`). Moved out of `live-bus-store.ts`, which re-exports it.

- Keeps one chronological queue. When an entry with the same `dedupKey` arrives, the older pending entry is removed: its promise resolves with `undefined`, its unwritten WAL row is dropped, and the new entry goes to the end.
- `enqueueLiveOp(type, payload, dedupKey)` is called by LiveBus `dispatch` for persistent ops. It assigns a `changeId` (UUID) and queues a WAL row (`kind: 'live-op'`, `dedupKey`) for the project set with `setPersistProjectId()`. `loadProject` sets this id right after clearing the queue.
- WAL writes are batched over 50 ms (`WAL_SETTLE_MS`), so a 60 Hz drag causes about 20 IndexedDB transactions per second. `flushPersistQueue` takes the batch, waits for `flushPersistWal()`, and only then calls the push hook. This guarantees the WAL row exists before the entry is sent.
- WAL rows are also flushed on `visibilitychange → hidden`, on `beforeunload` and on `clearPersistQueue` (project switch).
- Payloads are stored as JSON copies, because IndexedDB cannot clone Vue proxies.
- Acks work as before: the ack hook removes every `changeId` that got a sequence number.

**WAL** (`app/utils/persistence/wal.ts`)

- `WalEntry` has two new optional fields: `kind?: 'command' | 'live-op'` and `dedupKey?`. The DB name, version and schema are unchanged, so rows from older builds are still read (they are treated as commands).
- `walAppendBatch(entries)` writes in one transaction. For each entry with a `dedupKey`, older rows of the same project with the same key are deleted in that transaction, so a superseded `changeId` is never pushed. This also covers an older entry that is currently in flight. If that push fails, the entry is not re-queued, because a newer payload exists for its key.
- `walNextEnqueuedAt()` is a strictly increasing timestamp used by both history commands and live-ops. Recovery (`walGetPending`, sorted by `enqueuedAt`) therefore replays changes in exactly the order they were made. Recovery in `loadProject` pushes live-op rows the same way as command rows; the tail replay already resolves them through the live-op registry.

**Per-target coalescing keys** (`app/composables/live-ops/coalesce-keys.ts`). Before this change these ops coalesced by type only, so edits on two targets inside one settle window collapsed into one.

| op | key |
|---|---|
| `modifier.update` | per modifier **and** touched field names (the payload is a partial patch) |
| `fixture.drag` | per sorted set of fixture ids |
| `channel.update` | per sorted set of `(fixtureId, channelIndex)` |
| `color.override` | per preset key |
| `section.setActive` | already per section (unchanged) |
| `engine.bpm` / `engine.speed` / `engine.clock` / `modifier.sync` / `preset.set` | per type (global state, unchanged) |

The same key is used in the queue, in the WAL and in the LiveBus broadcast batch (`pendingReplace`), so peers no longer lose updates either.

**Snapshot consistency.** `doSaveSnapshot` throws if history commands are still unsent after the flush. A snapshot taken at that point would already contain their effect but carry an older sequence number. The failure goes through the retry scheduler.

## D9 — Backoff + connectivity

- **Persist queue:** the 50 ms re-arm loop is gone. A failed flush calls `reportNetworkFailure()` on network errors and puts the batch back at the front in order. If online, it retries after `backoffDelay(attempt)`, and new entries do not shorten that wait. If offline, no timer runs: an `onReconnect` listener resets the backoff and flushes. A successful flush calls `reportNetworkSuccess()`.
- **Retry scheduler** (`app/utils/sync/retry-scheduler.ts`): `createRetryScheduler(run)` with `fail(err)`, `succeed()`, `deferUntilOnline()` and `cancel()`. The snapshot autosave in `engine-store.ts` uses it. While offline, autosave defers until reconnect and the engine stays dirty. `save-snapshot` errors are now detected (`invoke` returned them silently before). Fire-and-forget callers (the history threshold and Cmd+S) go through `saveSnapshotSafely`, which never rejects.
- **beforeunload:** always flushes the WAL first. When offline it sends no keepalive push or snapshot, because the next load's WAL recovery pushes them.
- **Collaboration** (`use-collaboration.ts`):
  - `connect()` never throws.
  - Offline, the subscription is deferred.
  - On every reconnect the token is refreshed, passed to realtime (`setAuth`), and the channel is subscribed if it was never joined or is closed.
  - `CHANNEL_ERROR` re-auth is skipped while offline.
  - Status handling and presence `track()` calls are wrapped, so they cannot cause unhandled rejections.
- **Connectivity probe** (new export `setConnectivityProbe` in `connectivity.ts`; existing signatures are unchanged). A reported failure without a browser `offline` event (server or DNS outage) used to leave `isOnline` false forever, because every retry waits for `onReconnect`. While offline and `navigator.onLine` is true, the probe now runs with `backoffDelay` spacing and reports the state back online on success. The `offline-session` plugin registers a `no-cors` GET to `<supabase>/auth/v1/health`: any HTTP answer counts as online.

## D10 — Offline never logs out

- **`app/utils/auth/session-recovery.ts`** (pure functions, unit-tested):
  - `readCachedSession(auth)` reads supabase-js's persisted session (localStorage in SPA/Tauri, cookie storage in SSR) with no network call, even when the token is expired.
  - `decodeJwtClaims(token)` decodes the claims locally.
  - `resolveUnauthorized(auth)` decides how to react to a 401: `'keep'` when offline or on a transient refresh error, `'retry'` after a successful refresh, `'sign-out'` only when the auth server rejects the refresh.
  - `hasAuthenticatedUser(session, auth, { validate })` is the route-guard decision. It trusts the cached session when offline or expired. When online, it validates each access token against the server once, with a 3 s timeout. A network error or timeout keeps the cached identity; only a definitive rejection counts as signed out.
- **`app/middleware/auth.global.ts`** no longer calls `getUser()` on every navigation.
  - SSR (web): uses the claims and session the Supabase server plugin already resolved.
  - Client (both `useSsrCookies` modes): uses `useSupabaseSession()` or the stored session, plus the one-time validation above.
- **`app/plugins/offline-session.client.ts`** (`dependsOn: ['supabase']`):
  - If the Supabase plugin left `useSupabaseSession()` or `useSupabaseUser()` empty (expired token, refresh failed offline; supabase-js keeps the stored session on retryable errors), it restores them from storage. Without this, the module's own `auth-redirect` guard would send every route to `/auth/login`. This matters most for the Tauri SPA (`useSsrCookies: false`).
  - It re-applies cached claims after the module's `page:start` → `getClaims()` nulls the user offline.
  - It calls `getSession()` (which refreshes an expired token) on reconnect.
  - It registers the connectivity probe.
- **`engine-store.ts` `loadProject`:**
  - A network failure only reports offline and shows the generic error. The local-first open is WP-SYNC.
  - A 401 runs `resolveUnauthorized`: on `'retry'` the project is loaded once more (`allowAuthRetry`), on `'keep'` the error view is shown, and only on `'sign-out'` the user is signed out and redirected.

## Tests

`app/utils/ids.test.ts`, `app/utils/persistence/wal.test.ts`, `app/utils/persistence/persist-queue.test.ts`, `app/utils/sync/retry-scheduler.test.ts` (includes the probe), `app/utils/auth/session-recovery.test.ts`, `app/composables/live-ops/coalesce-keys.test.ts`.

## Known limits / follow-ups

- If WAL recovery fails at load but `load-project` succeeds (a flaky connection), the recovered rows are not retried until the next load. Pushing them later would put them in the server log without applying them locally, and the next snapshot would then skip past them. WP-SYNC's pull/rebase cycle replaces this.
- While the persist queue is offline, history commands stay pending, so the snapshot autosave is (intentionally) deferred until they are pushed.
- `use-collaboration` still reads `user.value?.id` from the claims object; claims carry `sub`, so it falls back to `getUser()`. This was already the case before.
