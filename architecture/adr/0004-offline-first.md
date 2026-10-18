# ADR 0004 — Offline-First Projects (Local-First with Supabase Sync)

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-10-18 |
| **Deciders** | Fabian Rafreider |
| **Builds on** | [ADR 0003 — Platform Layer](0003-native-platform-layer.md), [live-collaboration.md](../live-collaboration.md) |

This ADR is the **normative specification** for making Pixelmapper work without network access. The desktop app (Tauri) MUST work fully offline; the web app MUST NOT lose data when the connection drops, but does not need to boot offline.

Key words: **MUST** / **MUST NOT** = hard requirement, **SHOULD** = default unless there is a documented reason, **MAY** = optional.

---

## 1. Context (state before this ADR)

- The server was the source of truth on load: `loadProject` always called the `load-project` edge function. Offline, no project could be opened.
- `auth.global.ts` called `supabase.auth.getUser()` (network) on every navigation; offline every `/project/*` route redirected to login. A 401 from `load-project` signed the user out.
- History commands went through an IndexedDB WAL (`app/utils/persistence/wal.ts`), but **persistent live-ops did not** (BPM, fixture drag, color overrides, modifier scrubs, live widgets) — they were lost when the tab closed offline.
- The persist queue (`live-bus-store.ts`) retried failed flushes every 50 ms forever, without backoff or online detection.
- Project create/list/rename/delete/import existed only as edge functions.
- OFL fixture library and firmware download depended on Nitro server routes (absent in the Tauri SPA build).
- Group ids (`group-${counter}` restarting at 1 per page load), preset ids (`preset-${Date.now()}`) and custom fixture ids (`custom-${Date.now()}`) could collide across clients.
- `SetModifiers` and `modifier.sync` replace the **whole** modifier list. Replayed after an offline period, they would delete entities a collaborator created meanwhile.

---

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Local-first.** A local `ProjectStore` (IndexedDB) is the primary store. Supabase is a sync and collaboration layer. Opening a project reads the local copy first and syncs in the background. |
| D2 | **Tauri: fully offline. Web: resilient only.** Same data layer on both. The web app gets no service worker/PWA and keeps SSR; a reload while offline is allowed to fail there. |
| D3 | **Account optional in Tauri; mandatory in the web app.** Tauri boots without login; projects can be purely local. |
| D4 | **Conflict resolution: rebase + field-level 3-way merge, last-writer-wins on true conflicts.** On reconnect: pull remote changes → apply → re-apply local pending changes on top, transformed by a generic 3-way merge per entity (by id) and per field. Only the *same field of the same entity* changed on both sides is a conflict; the local value wins and the conflict is reported. |
| D5 | **Safety net:** before applying a rebase that had pending local changes, a server snapshot labelled `before offline sync` is saved, and the user can restore it from the conflict toast. |
| D6 | **All ids are UUIDs** (`crypto.randomUUID()`), including groups, presets and custom fixtures. Existing ids stay valid (they are opaque strings). |
| D7 | **Commands stay as they are for now (merge at rebase time).** New commands SHOULD be fine-grained (add/remove/patch by id). Converting old whole-list commands is a later, incremental task. |
| D8 | **Every persisted change goes through the local outbox** — history commands *and* persistent live-ops — with a client `changeId`. High-frequency live-ops are coalesced by `dedupKey` inside the outbox. |
| D9 | **Retries use exponential backoff tied to connectivity** (`app/utils/sync/connectivity.ts`); nothing retries in a hot loop while offline. |
| D10 | **Offline never logs the user out.** An expired access token while offline keeps the cached identity; the token is refreshed on reconnect. Route guards MUST NOT require a network round-trip. |
| D11 | **Project ids are client-generated UUIDs.** A local project keeps its id when uploaded (`create-project` accepts a client id). |
| D12 | **Storage: IndexedDB now, file-based later.** The `ProjectStore` interface (`app/utils/persistence/project-store/types.ts`) MUST stay implementable by a future `.pmproject` file store (no IndexedDB queries outside the implementation). |
| D13 | **Mirroring:** Tauri mirrors *all* cloud projects of the signed-in user (own + shared) in the background. The web app only keeps projects that were opened. |
| D14 | **Login with local projects (Tauri):** a one-time dialog lists local-only projects with checkboxes: "Upload to your account?". Local projects are never uploaded automatically. |
| D15 | **Logout (Tauri):** pending changes are synced first (warn if offline). Then the user is asked whether to keep local copies of cloud projects. Kept projects stay **bound to their owner account** (`ownerUserId`) — editable offline, synced when the same account signs in again, hidden from upload prompts and shown with an "owned by …" badge for other accounts; a "Detach as local copy" action creates an unbound copy with a new id. |
| D16 | **Logout (web):** sync pending changes first (explicit confirmation if that is impossible), then delete the local cache. |
| D17 | **Sync UI:** a status icon in the header (synced / syncing / offline · N pending / error), plus a toast after a rebase with conflicts, listing them, with "Restore state before sync". Full version-history UI is out of scope. |
| D18 | **OFL library bundled in Tauri** (client-side loader replacing `/api/fixtures`); the web keeps the Nitro route. |
| D19 | **Firmware bundled in Tauri** (the `firmware.bin` matching the app release); online, a newer release MAY be offered. Tauri downloads via the native HTTP path, so the CORS proxy is not needed there. |
| D20 | **AI features depend on reachability of the configured AI endpoint**, not on "online". (The endpoint may become a local model later.) |
| D21 | **User-level records sync** through a generic record sync (table with `id`, `user_id`, `kind`, `data`, `updated_at`, `deleted_at`; LWW per record). First user: the custom fixture library (moves from localStorage to IndexedDB, UUID ids, no more name-based identity). Connector setups stay per device. |

### Out of scope (later)

Version-history UI · converting whole-list commands to fine-grained ones · file-based `ProjectStore` · local AI models · pruning old server snapshots.

---

## 3. Architecture

```
 UI / stores / commands
        │  pushChange / persistChange / live-bus persistent ops
        ▼
 ┌─────────────────────────┐      ┌──────────────────────────────┐
 │ Outbox (ProjectStore)   │◄────►│ SyncEngine (per open project) │
 │ pending changes, ordered│      │ pull → merge → push → compact │
 ├─────────────────────────┤      └──────────────┬───────────────┘
 │ working snapshot        │                     │ connectivity-gated
 │ base snapshot + cursor  │                     ▼
 │ project meta            │            Supabase edge functions
 └─────────────────────────┘            (pull-changes, push-change,
     IndexedDB (D12)                     save-snapshot, create-project…)
```

### 3.1 Local data per project

- **meta** (`LocalProjectMeta`): id, name, origin (`local` | `cloud`), ownerUserId, serverCursor, timestamps.
- **base snapshot**: project state at `serverCursor` (everything the server has, nothing pending). Used as the base for rebasing.
- **working snapshot**: base + pending local changes. Used to open the project instantly. Rewritten periodically (debounced) — it is a cache, the outbox is the durable record.
- **outbox**: pending changes in order. Entries are removed only after the server acknowledged them (returned a sequence number).

### 3.2 Sync cycle (cloud projects, online)

1. **Push-first if no remote changes are known; otherwise pull-first.** Pull all `project_changes` with `sequence_number > serverCursor` (`pull-changes` function).
2. Remote changes whose `change_id` is in the local outbox are already applied locally → treat them as acknowledged.
3. If the outbox is empty: apply remote changes to the live state and to the base snapshot; advance the cursor.
4. If the outbox is not empty (rebase):
   1. Save server snapshot `before offline sync` (D5).
   2. new base = base + remote changes.
   3. For each pending change in order: **transform** it against the new state with the 3-way merge (`app/utils/sync/merge/`), producing a rebased payload and a list of conflicts.
   4. Replace the live state with new base + rebased pending changes.
   5. Push the **rebased** payloads (so other clients replaying them do not wipe concurrent work).
   6. Show the conflict toast if conflicts exist (D17).
5. After the push, write the new base snapshot and cursor; save a server snapshot following the existing autosave rules.

### 3.3 3-way merge (generic)

`mergeEntityLists(base, local, remote, { idKey })` for arrays of entities with ids, and `mergeObjects(base, local, remote)` for plain objects:

- Entity added on one side → kept. Added on both with the same id → field merge.
- Entity removed on one side, untouched on the other → removed. Removed on one side, **modified** on the other → kept with the modification, reported as conflict.
- Field changed on one side → that change wins. Changed on both sides to different values → **local wins**, reported as conflict `{ entityId, path, base, local, remote }`.
- Order: remote order, with local-only additions inserted after their local predecessor.
- Nested plain objects merge recursively; arrays of primitives and arrays without ids are treated as atomic values.

Command adapters map a whole-list command payload (`before`, `after`) onto `base = before`, `local = after`, `remote = current state`.

### 3.4 Connectivity

`app/utils/sync/connectivity.ts` exposes a reactive `isOnline`, `reportNetworkFailure()`, `reportNetworkSuccess()`, `onReconnect(cb)` and `backoffDelay(attempt)`. Every network-dependent retry MUST use it.

---

## 4. Work packages

| Package | Contents | Depends on |
|---|---|---|
| **WP-P0** foundations | UUID ids for groups and presets; persistent live-ops into the outbox/WAL with `changeId`; backoff + connectivity in the persist queue; offline-tolerant auth middleware and no sign-out on 401 while offline | — |
| **WP-MERGE** merge library | `app/utils/sync/merge/` + Vitest suite + command adapters (SetModifiers, OverwritePreset, …) | — |
| **WP-STORE** local project store | IndexedDB implementation of `ProjectStore`, migration of the old WAL DB into the outbox, tests (fake-indexeddb) | — |
| **WP-SERVER** edge functions | `create-project` with client id; `pull-changes` (since cursor, incl. `user_id`, `change_id`); `load-project` returns `user_id`; `upload-project` or equivalent for local → cloud; migration if needed | — |
| **WP-TAURI** desktop autarky | bundled OFL loader, bundled firmware, AI reachability gating | — |
| **WP-RECORDS** user record sync | migration `user_records`, generic record sync, custom fixture library on IndexedDB with UUIDs | — |
| **WP-SYNC** sync engine | SyncEngine, local-first `loadProject`, rebase with merge library, pre-sync snapshot, sync status icon, conflict toast | P0, MERGE, STORE, SERVER |
| **WP-ACCOUNT** optional account | local projects list/create/rename/delete, Tauri boot without login, upload dialog on login, logout dialogs, owner binding, background mirroring, web logout clears cache | SYNC |

---

## 5. Amendments after implementation (2026-10-18)

- **Merge ordering (§3.3):** if only the local side reordered shared entities, the local order wins (otherwise an offline reorder would be dropped silently); both sides reordered → local wins and an `order` conflict is reported; otherwise remote order.
- **Server ordering (§3.2):** pushes go through the `push_changes` RPC (migration 009), which serializes inserts per project with an advisory lock and is idempotent (`ON CONFLICT DO NOTHING`, returns stored sequence numbers). Within a project, commit order equals sequence order; the client's 200-number pull overlap stays as a second safety net.
- **Restore (D5):** `restore-snapshot` appends a `restore-snapshot` marker change and stores the snapshot at its sequence number; clients never replay the marker but reload the open project from the server. Safety snapshots (`before offline sync`) are never used as a load base.
- **Session lifecycle (D10, D15, D16):** a project's sync session is closed when the project is left, on sign-out and on account switch; the sync engine only acts for its bound account. Undo/redo is cleared on load and after a rebase.
- **Desktop boot (D2, D10):** the `@nuxtjs/supabase` client plugin is replaced in Tauri builds by `app/runtime/supabase-spa.client.ts`, which resolves the boot session from storage (no blocking token refresh offline); token auto-refresh runs only while online.
- **Quit (D2):** the desktop app flushes outbox writes and the working snapshot before a window close or app exit (`src-tauri/src/lifecycle.rs`, `AppShell.onBeforeQuit`).
