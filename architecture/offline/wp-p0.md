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
- **Flap protection** (`connectivity.ts`). A persistent failure while the health endpoint answers (e.g. a CORS-blocked function) used to flip offline/online about once per second, re-running every reconnect listener each time.
  - The probe backoff is reset only when the connection had stayed online for `STABLE_ONLINE_MS` (30 s). Quick flaps keep growing it, up to the 30 s cap.
  - Reconnect notifications are at least `RECONNECT_MIN_INTERVAL_MS` (5 s) apart. The first one fires immediately; a reconnect inside the interval is deferred to its end and dropped if the app is offline by then.
  - `isNetworkError` no longer counts TypeErrors that are clearly code bugs ("is not a function", "Cannot read properties of undefined", …). Other TypeErrors still count, because wrappers (e.g. `engine-store` autosave) rethrow network failures as TypeError with arbitrary messages.

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

### Offline boot never waits for a token refresh

**Problem.** auth-js 2.104 refreshes an expired access token inside `getSession()` (`__loadSession` → `_callRefreshToken`). Offline, `_refreshAccessToken` retries with 200 ms · 2ⁿ backoff for up to one auto-refresh tick (30 s), and every attempt goes through the module's 3× `fetchWithRetry`. `_initialize()` (`_recoverAndRefresh`) already does this once when `autoRefreshToken` is on, and `getSession()` awaits `initializePromise` and then does it again. Nuxt runs plugins one after another, so every plugin that awaited `getSession()` added ~30 s of blank window: the `@nuxtjs/supabase` client plugin in SPA mode (`useSsrCookies: false`, Tauri) and `03.extension-loader`. `getSession()` then returned `{ session: null }`, so the extension loader used the anonymous installed list and a project's required extensions (e.g. `connector-esp`) were missing offline. Every Supabase data call (`_getAccessToken` → `getSession()`) pays the same wait.

**Boot helpers** (`app/utils/auth/boot-session.ts`):
- `resolveBootSession(auth, { online, timeoutMs = 3000 })`: offline → the stored session (`readCachedSession`) without calling `getSession()`; online → `getSession()` raced against the timeout. A fresh session wins (online boots behave as before). On timeout, a throw or a refresh error the stored session is used. The pending call keeps running and later updates state through `TOKEN_REFRESHED`.
- `shouldKeepCachedIdentity(auth, event)`: a missing session or missing claims only clears state on `SIGNED_OUT` or when supabase-js no longer stores a session.
- `bindAutoRefreshToConnectivity(auth, isOnline)`: runs the refresh ticker only while online.

**Desktop replacement of the module client plugin** (`app/runtime/supabase-spa.client.ts`). In desktop builds the `app:resolve` hook in `nuxt.config.ts` replaces the plugin whose `src` is `@nuxtjs/supabase/dist/runtime/plugins/supabase.client.js`. The module registers that plugin with `addPlugin`, `name: 'supabase'`, `enforce: 'pre'`. The build fails if the plugin cannot be found. The replacement keeps the module's contract:
- same plugin name, so `dependsOn: ['supabase']` still works;
- provides `$supabase.client` from `createClient(url, key, { ...clientOptions, global: { fetch: fetchWithRetry } })` (`fetchWithRetry` is copied to `app/utils/auth/fetch-retry.ts` because the package does not export it);
- fills `useSupabaseSession()` (`useState('supabase_session')`) and sets `useSupabaseUser()` from `getClaims()` on `page:start` and after auth events.

Differences from the module plugin:
- It uses `resolveBootSession` instead of an unbounded `getSession()`.
- `INITIAL_SESSION`/`null` after a failed offline refresh and failed `getClaims()` keep the cached identity.
- With `clientOptions.auth.autoRefreshToken: false` (desktop only, set in `nuxt.config.ts`) the ticker is started/stopped by connectivity. auth-js then skips the refresh in `_initialize()`, and the visibility handler does not start the ticker. While online the ticker (`startAutoRefresh`) refreshes 3 ticks before expiry, and `getSession()` still refreshes lazily. Offline no tick holds the auth lock for 30 s.

The web build keeps the module plugin, which does not await `getSession()` in SSR-cookie mode.

**Extension loader.**
- `03.extension-loader` uses `resolveLoaderBootConfig(supabase, useSupabaseUser().value)` (`app/utils/extensions/boot-config.ts`). It resolves the account through `resolveCurrentUserId`: the module user, else the stored session, with no network. So the signed-in user's installed list (Supabase `user_extensions`, mirrored in localStorage) is used offline too.
- `supabaseInstalledStore.list()` returns the mirror when offline and races the query against `REMOTE_TIMEOUT_MS` (4 s) otherwise.
- `listAvailableExtensions` bounds each source listing with the same timeout. `startLoading` shares one listing across all installed extensions.
- `registrySource` (`extension-sources.ts`) fails fast offline.

**Plugin remote** (`app/utils/plugins/plugin-remote.ts`):
- `userId()` reads the stored session instead of `getUser()`.
- `fetch`/`publish`/`list`/`findByAlias` throw `offline` right away when offline. Callers already treat throws as "not available".

## Tests

`app/utils/auth/boot-session.test.ts`, `app/utils/extensions/boot-config.test.ts` (offline boot picks the user's installed list without `getSession()`; hanging backend bounded by the timeout), `app/utils/plugins/plugin-remote.test.ts`, `app/utils/ids.test.ts`, `app/utils/persistence/persist-queue.test.ts`, `app/utils/sync/retry-scheduler.test.ts` (includes the probe), `app/utils/sync/connectivity.test.ts` (flap protection), `app/utils/auth/session-recovery.test.ts`, `app/composables/live-ops/coalesce-keys.test.ts`.

## Known limits / follow-ups

- If WAL recovery fails at load but `load-project` succeeds (a flaky connection), the recovered rows are not retried until the next load. Pushing them later would put them in the server log without applying them locally, and the next snapshot would then skip past them. WP-SYNC's pull/rebase cycle replaces this.
- While the persist queue is offline, history commands stay pending, so the snapshot autosave is (intentionally) deferred until they are pushed.
- `use-collaboration` still reads `user.value?.id` from the claims object; claims carry `sub`, so it falls back to `getUser()`. This was already the case before.
