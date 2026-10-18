# WP-ACCOUNT — Optional account, local projects, login/logout

Implements the account part of [ADR 0004](../adr/0004-offline-first.md): D3 (account optional on desktop), D11 (client project ids), D13 (mirroring), D14 (upload dialog on login), D15 (desktop logout, owner binding), D16 (web logout).
Builds on WP-STORE (`ProjectStore`), WP-SERVER (`create-project` with client id and snapshot, `list-projects-sync`), WP-RECORDS (record account hooks) and the `ProjectSyncService` contract that WP-SYNC implements.

## Platform policy

Web and desktop differ in one place: `getAccountPolicy()` from `#platform` (ADR 0003 D3). The interface is in `app/platform/account-policy.ts`.

| Field | Web | Desktop (Tauri) |
|---|---|---|
| `accountRequired` | `true` | `false` (D3) |
| `mirrorCloudProjects` | `false` | `true` (D13) |
| `offerUploadOnLogin` | `false` | `true` (D14) |
| `logoutCache` | `'clear'` (D16) | `'ask'` (D15) |
| `importTarget` | `'cloud'` | `'local'` |
| `showForeignProjects` | `false` | `true` (D15) |

The routing difference also needs one build-time switch. `nuxt.config.ts` sets `supabase.redirect: !IS_TAURI`, so the module's global login redirect is off on desktop. `app/middleware/auth.global.ts` sends signed-out users from `/project/*` to the login page only when `accountRequired` is true. On the web the module still guards every other route, as before. WP-P0's offline session handling (`offline-session.client.ts`, cached sessions in the middleware) is unchanged.

## Files

| File | Purpose |
|---|---|
| `app/utils/account/known-accounts.ts` | `AccountIdentity`, `identityFromUser()` (works with claims and users), and the id → label map in localStorage for the "Owned by …" badge |
| `app/utils/account/project-list.ts` | `mergeProjectList()` (local store ∪ remote heads → list items with kind `local` / `cloud` / `foreign`) and `projectActions()` (what each item offers, given connectivity) |
| `app/utils/account/local-projects.ts` | Store-only operations: create, rename, delete, `detachAsLocalCopy()`, `listUploadCandidates()`, `listBoundCloudProjects()` |
| `app/utils/account/cloud-projects.ts` | Create (client UUID), rename and delete through the edge functions. Keeps the local copy in step |
| `app/utils/account/upload.ts` | `uploadLocalProject(s)()`: local → cloud in a single `create-project` call |
| `app/utils/account/remote-heads.ts` | `fetchRemoteHeads()`: `list-projects-sync`, falling back to `get-projects` while the new function is not deployed |
| `app/utils/account/mirror.ts` | `reconcileRemoteHeads()` and `runMirrorPass()` |
| `app/utils/account/mirror-scheduler.ts` | Runs a pass on start, on reconnect and every 5 min. Uses backoff and never overlaps passes |
| `app/utils/account/sign-out.ts` | `flushBeforeSignOut()`, `finishSignOut()`, `endSession()` |
| `app/utils/account/login-transition.ts` | `createLoginTracker()`: tells a real sign-in apart from a session refresh or restore |
| `app/utils/account/sync-service.ts` | `tryGetProjectSyncService()` (returns `null` until WP-SYNC registers) |
| `app/composables/account/account-state.ts` | Shared refs: `pendingLoginReview`, `localProjectsRevision`, mirror trigger |
| `app/composables/account/sign-out-flow.ts` | Sign-out state machine (dependencies injected, so it is testable) |
| `app/composables/account/use-account-session.ts` | `useAccountSession()`: the account, the policy and the single `signOut()` entry |
| `app/composables/account/use-project-list.ts` | Project list page logic |
| `app/plugins/05.account.client.ts` | Auth events: remembers labels, handles real sign-ins and starts/stops mirroring |
| `app/components/account/*` | `ProjectListHeader`, `ProjectListRow`, `ProjectFormDialog`, `ProjectDeleteDialog`, `LoginUploadDialog`, `SignOutDialog` |
| `app/pages/index.vue` | Page shell that composes the above |

## Project list (D1, D13, D15)

1. The page reads the local store first and renders right away, also offline.
2. If signed in and online, it fetches the remote heads. `reconcileRemoteHeads()` then:
   - updates name, description and role of copies bound to the account;
   - removes copies whose project disappeared from the server;
   - keeps such a copy if it still has pending outbox entries, sets `remoteDeletedAt` on it and shows a warning.
3. Heads without a local copy show as uncached cloud entries. On the web these are projects that were never opened; on desktop, projects not mirrored yet.

Each entry has a kind:

| Kind | Meaning | Badge |
|---|---|---|
| `local` | `origin: 'local'`, `ownerUserId: null` | Local |
| `cloud` | Bound to the signed-in account, or a remote head | Cloud |
| `foreign` | Bound to another account, or to any account while signed out | Owned by <label> |

Further badges: `N pending` (outbox count) and `Deleted on server`.

| Action | local | cloud (owner) | foreign / deleted on server |
|---|---|---|---|
| Rename | store only, offline OK | `rename-project` (online only; otherwise disabled with a hint) | disabled |
| Delete | store only | `delete-project` (online only) | "Remove from this device" |
| Detach as local copy | — | if cached | yes |
| Upload to account | when signed in | — | — |

**Create.**
- Web: always a cloud project, `createProject({ id: uuid, name })`.
- Desktop signed out: a local project.
- Desktop signed in: the dialog has a "Save to" select (Account / This device only). Account is disabled offline.
- Cloud projects created on desktop get a local meta right away (`origin: 'cloud'`, cursor 0, no snapshot); mirroring or the first open fills it.
- A new local project has no working snapshot. It opens with the default state.

**Import (.pmproject).** `importProjectBytes` follows `importTarget`:
- desktop: `createLocalProject` with the archive snapshot as working snapshot, no server call;
- web: `createProject({ id, name, snapshot, snapshotLabel: 'Imported' })`. This replaces the earlier `create-project` + `save-snapshot` pair.

**Detach (D15).** Creates a new UUID with `origin: 'local'` and `ownerUserId: null`. It copies the working snapshot (or the base snapshot if there is none) and adds no outbox entries. The source stays as it was.

**Open Recent.** `use-app-menu.ts` merges local metas into the name refresh, so local projects are never dropped.

## Login (D14)

`05.account.client.ts` watches `onAuthStateChange`.

- `createLoginTracker` persists the last account in `localStorage['pm:account:last-user']`. A session for a different account, or the first session after a `SIGNED_OUT`, counts as a real sign-in. Refreshes, restored sessions and a missing session at an offline boot do not.
- On a real sign-in, both platforms call `adoptLocalRecords(userId)` (custom fixtures). On desktop, the sign-in also sets `pendingLoginReview`.
- `LoginUploadDialog` (desktop, on the project list) then lists `listUploadCandidates()`: local projects with `ownerUserId === null`. Projects bound to another account are never offered. The dialog shows once per sign-in, all projects preselected.
  - "Keep local" closes it.
  - "Upload" calls `uploadLocalProjects()` sequentially. Failures stay listed, with only the failed projects selected.

Upload (`uploadLocalProject`):
1. Sends `createProject({ id, name, description, snapshot: working snapshot })`. The call is idempotent, so a retry is safe.
2. Writes meta with `origin: 'cloud'`, `ownerUserId`, `role: 'owner'`, `serverCursor = response.snapshot.sequenceNumber ?? 0` and `lastSyncedAt`.
3. Writes the base snapshot as the uploaded snapshot.

On failure the project stays local. Network errors read "You are offline"; a 409 means the id is used by another account.

## Logout (D15 desktop, D16 web)

Every deliberate sign-out goes through `useAccountSession().signOut()`, which drives `createSignOutFlow`. `SignOutDialog` renders it.

1. **syncing:** runs `flushAll(userId)` (WP-SYNC) and then `syncAllRecords()` plus `countPendingRecords(userId)`. Without a registered sync service it counts the outbox of the cloud projects bound to the account.
2. **pending:** shown if anything is still pending. It names the count ("N project changes and M custom fixtures") and needs an explicit "Sign out anyway".
3. **copies** (desktop only, when copies bound to the account exist): asks "Keep local copies?".
   - Keep: projects stay bound to `ownerUserId`.
   - Remove: deletes only the cloud copies of that account. Local-only projects and other accounts' copies always stay.
4. **finish:**
   - Web: `store.clearAll()` + `clearLocalRecords()`.
   - Then, on both: `endSession()`, then navigation (web → `/auth/login`, desktop → `/`).

`endSession()` calls `auth.signOut({ scope: 'local' })`, which signs out this device only (before, it was the default global scope). supabase-js keeps the session when the revoke request fails at the network level. In that case `endSession` removes the stored session locally through `auth._removeSession()`, a private but stable supabase-js v2 API, so an offline logout still works. It emits `SIGNED_OUT`.

When the auth server rejects the session (the 401 path in `engine-store.ts` `loadProject`), the store calls `endSession()` directly and keeps local data. Syncing is impossible at that point, and the data stays bound to the account until it signs in again.

## Owner binding (D15)

- A copy with `ownerUserId` ≠ the current user (or any `ownerUserId` while signed out) is `foreign`. It is visible on desktop with "Owned by <label>". The label comes from `known-accounts.ts`; if this device never saw the account, it reads "another account".
- It can still be opened and edited offline.
- It is excluded from the upload dialog and never reconciled or mirrored for another account (`reconcileRemoteHeads` skips it).
- Its sync must also be suppressed when it is opened under another account (see "Requirements for WP-SYNC").
- The web hides foreign copies.

## Background mirroring (D13, desktop)

The plugin starts a `MirrorScheduler` per signed-in account (`setMirrorUser`). It stops on `SIGNED_OUT` and restarts on an account switch. It runs:
- right away,
- on every reconnect,
- every 5 minutes after a successful pass,
- with `backoffDelay` after a failure. No timer runs while offline, and passes never overlap.

A pass (`runMirrorPass`):
1. Calls `listProjectsForSync`.
2. Runs `reconcileRemoteHeads`.
3. For each stale head (no local copy, or `latestSequence > serverCursor`), calls `mirrorProject(head, userId)` sequentially and stops if the account changes.
4. Projects deleted remotely are removed, or kept and marked when they have pending changes (with a warning toast).

While WP-SYNC is not registered yet, a pass counts as failed and retries with backoff. The project list calls `requestMirror()` when it sees stale heads, and the upload dialog calls it after uploading.

## Contract changes

- `LocalProjectMeta.remoteDeletedAt?: number | null` (additive, optional): marks a kept copy whose server project disappeared.
- `#platform` exports `getAccountPolicy()` (both entries). New file `app/platform/account-policy.ts`.

## Requirements for WP-SYNC

- Register `ProjectSyncService`. `mirrorProject` MUST be safe for the project that is currently open, or skip it. `flushAll(userId)` MUST only push projects bound to `userId`.
- Local-first open:
  - a local project (`origin: 'local'`) may have **no working snapshot** → open with the default state;
  - a cloud meta created on desktop may have no base snapshot yet (cursor 0) → load from the server.
- Never sync a project whose `ownerUserId` ≠ the signed-in user (foreign copy), and never sync while signed out.
- Projects with `remoteDeletedAt` set: do not push. The server project is gone, so the push would fail with 403/404.

## Tests

`app/utils/account/*.test.ts` and `app/composables/account/sign-out-flow.test.ts` (Vitest). They use the in-memory `ProjectStore` (plus one fake-indexeddb run), a mocked `RemoteClient`, a fake `ProjectSyncService` and fake timers for the scheduler.

Covered:
- merge and action rules
- local create/rename/delete/detach
- the upload binding (meta, cursor, base snapshot; failure leaves the project local)
- cloud create/rename/delete
- the heads fallback
- reconcile: names, remote deletion with and without pending changes, foreign copies untouched, stale detection
- mirror pass: sequential, cancellation
- the scheduler: interval, backoff, offline, reconnect, no overlap
- the logout steps per policy, including the offline `endSession` fallback
- the login tracker
- the sign-out state machine

## Not verified / follow-ups

- Not run in a real browser or the Tauri shell. That includes the module redirect switch, `_removeSession` offline, and the dialogs' look and feel.
- `use-app-menu.ts` "Open file" uses the same `importProjectBytes`, so File → Open on desktop also creates a local project.
- On the first start after this change, an existing session counts as one sign-in (no last account is stored yet). This adopts local records and, on desktop, shows the upload dialog if local projects exist.
