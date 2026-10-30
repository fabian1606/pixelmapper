/**
 * Process-wide state of the user record sync: the configured remote, the
 * signed-in account and the registered collections. Also hosts the account
 * hooks for the login/logout flows (ADR 0004 D14, D16), which another work
 * package wires into the UI.
 */
import { readonly, ref } from 'vue';
import { clearRecordDb, getRecord, hasIndexedDb, listRecords, mutateRecord, putRecords } from './record-db';
import type { RecordRemote } from './types';

// ── Collection registry ──────────────────────────────────────────────────────

/** What the session needs from a collection. */
export interface RegisteredCollection {
  readonly kind: string;
  /** Re-reads the local list from IndexedDB. */
  reload(): Promise<void>;
  /** Runs a sync round (no-op without remote/account). */
  syncNow(): Promise<void>;
  /** Resolves when no sync round is running. */
  whenIdle(): Promise<void>;
  /** Stops timers and listeners. */
  dispose(): void;
}

const collections = new Map<string, RegisteredCollection>();

/** Registered collection of a kind, if any. */
export function getRegisteredCollection(kind: string): RegisteredCollection | undefined {
  return collections.get(kind);
}

/** Registers a collection (one per kind). */
export function registerCollection(collection: RegisteredCollection): void {
  collections.set(collection.kind, collection);
}

// ── Remote + account ─────────────────────────────────────────────────────────

let remote: RecordRemote | null = null;
const currentUserId = ref<string | null>(null);

/** Signed-in account id as seen by the record sync (reactive, read-only). */
export const recordUserId = readonly(currentUserId);

/** Installs the server access (Supabase in the app, a fake in tests). */
export function configureRecordRemote(next: RecordRemote | null): void {
  remote = next;
}

/** Currently configured remote. */
export function getRecordRemote(): RecordRemote | null {
  return remote;
}

/** Current account id, `null` when signed out. */
export function getRecordUser(): string | null {
  return currentUserId.value;
}

/** Runs `syncNow` on every collection; errors are handled per collection. */
export async function syncAllRecords(): Promise<void> {
  await Promise.all([...collections.values()].map(c => c.syncNow()));
}

/** Re-reads every collection's list. */
async function reloadAll(): Promise<void> {
  await Promise.all([...collections.values()].map(c => c.reload()));
}

// ── Account resolution ───────────────────────────────────────────────────────

/**
 * False until the first `setRecordUser` call: the plugin defers the auth
 * event (and offline it first reads the cached session), so the custom
 * fixture migration or a quick save can write before the account is known.
 */
let userResolved = false;
/** Ids of records written with `ownerUserId: null` while the account was unknown. */
const unresolvedWrites = new Set<string>();

/**
 * Called by collections after writing records without owner. While the
 * account is still unknown the ids are remembered, so `setRecordUser` can
 * hand them to the account that turns out to be signed in.
 */
export function noteOwnerlessWrites(ids: readonly string[]): void {
  if (userResolved) return;
  for (const id of ids) unresolvedWrites.add(id);
}

/**
 * Binds the records written before the account was known to `userId`
 * (only those still local-only). These were created by the signed-in user
 * of this device, so this is no D14 upload of foreign local data.
 */
async function adoptUnresolvedWrites(userId: string): Promise<number> {
  const ids = [...unresolvedWrites];
  unresolvedWrites.clear();
  let adopted = 0;
  for (const id of ids) {
    const result = await mutateRecord(id, (current) => {
      if (!current || current.ownerUserId !== null || current.deletedAt !== null) return undefined;
      return { ...current, ownerUserId: userId, dirty: true };
    });
    if (result) adopted++;
  }
  return adopted;
}

/**
 * Reports the signed-in account (called on auth state changes). On login
 * the visible lists change and every collection syncs.
 *
 * The account is switched first, so running rounds of the previous account
 * stop writing (`syncRecordKind` checks `getRecordUser()` before every
 * write); then this waits for them to finish before reloading and syncing.
 */
export async function setRecordUser(userId: string | null): Promise<void> {
  const firstResolution = !userResolved;
  userResolved = true;
  if (currentUserId.value === userId && !firstResolution) return;
  currentUserId.value = userId;
  await Promise.all([...collections.values()].map(c => c.whenIdle()));
  if (firstResolution) {
    if (userId && hasIndexedDb()) await adoptUnresolvedWrites(userId);
    else unresolvedWrites.clear(); // really signed out: they stay local-only
  }
  await reloadAll();
  if (userId) await syncAllRecords();
}

// ── Account hooks (D14 / D16) ────────────────────────────────────────────────

/**
 * Binds every local-only record (`ownerUserId: null`) to `userId` and marks
 * it for upload, then syncs. For the login flow (D14): call it after the
 * user agreed to upload local data. Returns the number of adopted records.
 */
export async function adoptLocalRecords(userId: string, options: { kinds?: string[] } = {}): Promise<number> {
  if (!hasIndexedDb()) return 0;
  const all = await listRecords();
  const adopted = all
    .filter(r => r.ownerUserId === null && (!options.kinds || options.kinds.includes(r.kind)))
    .map(r => ({ ...r, ownerUserId: userId, dirty: true }));
  // Local-only tombstones never reach the server; they are deleted on remove.
  await putRecords(adopted);
  await reloadAll();
  if (currentUserId.value === userId) await syncAllRecords();
  return adopted.length;
}

/**
 * Number of records with changes the server has not accepted yet (for D16's
 * "sync first"). Counts the account's dirty records plus every local-only
 * record (`ownerUserId: null`, never uploaded): `clearLocalRecords` would
 * delete those too, so a web logout must not treat them as safe.
 */
export async function countPendingRecords(userId: string): Promise<number> {
  if (!hasIndexedDb()) return 0;
  return (await listRecords())
    .filter(r => r.dirty && (r.ownerUserId === userId || r.ownerUserId === null))
    .length;
}

/** Result of `clearForeignRecords`. */
export interface ClearForeignRecordsResult {
  /** Synced copies of other accounts that were deleted. */
  removed: number;
  /** Records of other accounts kept because they have unsynced changes. */
  keptDirty: number;
}

/**
 * Removes the synced records of other accounts (D16 web cache clear that a
 * logout could not do, e.g. after an automatic sign-out): records owned by
 * an account other than `userId` and not dirty are deleted (the server
 * still has them); dirty ones are kept and counted (unsynced data of that
 * account). Local-only records and records of `userId` are untouched.
 * Each delete re-checks the record atomically, so a concurrent edit wins.
 */
export async function clearForeignRecords(userId: string): Promise<ClearForeignRecordsResult> {
  if (!hasIndexedDb()) return { removed: 0, keptDirty: 0 };
  const isForeign = (r: { ownerUserId: string | null }) => r.ownerUserId !== null && r.ownerUserId !== userId;
  let removed = 0;
  let keptDirty = 0;
  for (const record of (await listRecords()).filter(isForeign)) {
    const result = await mutateRecord(record.id, (current) => {
      if (!current || !isForeign(current) || current.dirty) return undefined;
      return null;
    });
    if (result === null) removed++;
    else if ((await getRecord(record.id))?.dirty) keptDirty++;
  }
  if (removed > 0) await reloadAll();
  return { removed, keptDirty };
}

/**
 * Deletes every local record and cursor (web logout, D16). Also signs the
 * record sync out, so no running or later round downloads the data again;
 * the next `setRecordUser(id)` re-downloads everything. Callers sync
 * pending changes first (`syncAllRecords` + `countPendingRecords`).
 */
export async function clearLocalRecords(): Promise<void> {
  if (!hasIndexedDb()) return;
  currentUserId.value = null;
  await Promise.all([...collections.values()].map(c => c.whenIdle()));
  await clearRecordDb();
  await reloadAll();
}

// ── Tests ────────────────────────────────────────────────────────────────────

/** Disposes all collections and resets the session (tests only). */
export function resetRecordSessionForTests(): void {
  for (const c of collections.values()) c.dispose();
  collections.clear();
  remote = null;
  currentUserId.value = null;
  userResolved = false;
  unresolvedWrites.clear();
}
