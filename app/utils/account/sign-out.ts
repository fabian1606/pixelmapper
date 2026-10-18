import type { AccountPolicy } from '~/platform/account-policy';
import type { ProjectStore } from '~/utils/persistence/project-store';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import { listBoundCloudProjects } from './local-projects';

/**
 * Logout steps (ADR 0004 D15 desktop, D16 web), free of UI so they can be
 * tested: flush pending changes, then clean up the local cache according to
 * the platform policy, then end the Supabase session.
 */

// ── Seams ────────────────────────────────────────────────────────────────────

/** The part of `supabase.auth` used here. */
export interface SignOutAuth {
  signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: unknown }>;
}

/** User record hooks (`~/utils/sync/records`). */
export interface RecordHooks {
  syncAllRecords(): Promise<void>;
  countPendingRecords(userId: string): Promise<number>;
  clearLocalRecords(): Promise<void>;
  /** Binds local-only records to the account (optional; web sign-out). */
  adoptLocalRecords?(userId: string): Promise<number>;
}

export interface SignOutDeps {
  policy: AccountPolicy;
  store: ProjectStore;
  /** `null` when the sync engine is not registered (falls back to counting the outbox). */
  sync: ProjectSyncService | null;
  records: RecordHooks;
  auth: SignOutAuth;
  /**
   * Stops mirroring (waiting for a running pass) and closes the open
   * project's sync session (`teardownAccountSession`). Runs before the
   * cache is touched, so nothing writes the account's data back afterwards.
   */
  teardown?: () => Promise<void>;
}

// ── Step 1: flush ────────────────────────────────────────────────────────────

/** What could not be synced before logout. */
export interface PendingAfterFlush {
  /** Outbox entries of cloud projects bound to the account. */
  projects: number;
  /** User records (custom fixtures) with unsynced changes. */
  records: number;
}

/**
 * Pushes pending project changes and user records of `userId` (D15/D16).
 * Never throws: on errors the remaining counts are read locally.
 */
export async function flushBeforeSignOut(deps: SignOutDeps, userId: string): Promise<PendingAfterFlush> {
  let projects = 0;
  try {
    projects = deps.sync ? await deps.sync.flushAll(userId) : await countBoundPending(deps.store, userId);
  }
  catch (err) {
    console.warn('[account] flush before sign-out failed:', err);
    projects = await countBoundPending(deps.store, userId).catch(() => 0);
  }

  let records = 0;
  try {
    // Web (D16): local-only records (written while the account was unknown,
    // e.g. offline boot) would be deleted by the clear: upload them instead.
    if (deps.policy.logoutCache === 'clear') await deps.records.adoptLocalRecords?.(userId);
    await deps.records.syncAllRecords();
    records = await deps.records.countPendingRecords(userId);
  }
  catch (err) {
    console.warn('[account] record sync before sign-out failed:', err);
  }
  return { projects, records };
}

/** Pending outbox entries of the cloud projects bound to `userId`. */
async function countBoundPending(store: ProjectStore, userId: string): Promise<number> {
  const bound = await listBoundCloudProjects(store, userId);
  const counts = await Promise.all(bound.map(m => store.countPending(m.id)));
  return counts.reduce((a, b) => a + b, 0);
}

// ── Step 2: clean up + end session ───────────────────────────────────────────

export interface FinishSignOutOptions {
  /** Desktop (D15): keep the copies of cloud projects bound to the account. Ignored on web. */
  keepLocalCopies: boolean;
}

/**
 * Cleans up the local cache and ends the session.
 * - Web (`clear`, D16): deletes every local project and record.
 * - Desktop (`ask`, D15): keeps everything, or removes only the cloud copies
 *   bound to `userId`; local-only projects always stay.
 */
export async function finishSignOut(deps: SignOutDeps, userId: string, opts: FinishSignOutOptions): Promise<void> {
  // Nothing may sync, mirror or write a working snapshot for this account
  // from here on (the open project is flushed, then closed).
  await deps.teardown?.();
  if (deps.policy.logoutCache === 'clear') {
    await deps.store.clearAll();
    await deps.records.clearLocalRecords();
  }
  else if (!opts.keepLocalCopies) {
    for (const meta of await listBoundCloudProjects(deps.store, userId)) {
      await deps.store.deleteProject(meta.id);
    }
  }
  await endSession(deps.auth);
}

/**
 * Ends the Supabase session on this device. supabase-js keeps the session
 * when the revoke request fails at the network level, which would make an
 * offline logout impossible (D15): in that case the stored session is
 * removed locally (the refresh token expires on its own).
 */
export async function endSession(auth: SignOutAuth): Promise<void> {
  let error: unknown = null;
  try {
    ({ error } = await auth.signOut({ scope: 'local' }));
  }
  catch (err) {
    error = err;
  }
  if (!error) return;
  console.warn('[account] sign-out request failed, removing the local session:', error);
  const remove = (auth as unknown as { _removeSession?: () => Promise<void> })._removeSession;
  if (typeof remove === 'function') await remove.call(auth);
}
