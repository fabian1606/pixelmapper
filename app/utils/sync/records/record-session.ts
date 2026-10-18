/**
 * Process-wide state of the user record sync: the configured remote, the
 * signed-in account and the registered collections. Also hosts the account
 * hooks for the login/logout flows (ADR 0004 D14, D16), which another work
 * package wires into the UI.
 */
import { readonly, ref } from 'vue';
import { clearRecordDb, hasIndexedDb, listRecords, putRecords } from './record-db';
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

/**
 * Reports the signed-in account (called on auth state changes). On login
 * the visible lists change and every collection syncs.
 */
export async function setRecordUser(userId: string | null): Promise<void> {
  if (currentUserId.value === userId) return;
  currentUserId.value = userId;
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

/** Number of records with changes the server has not accepted yet (for D16's "sync first"). */
export async function countPendingRecords(userId: string): Promise<number> {
  if (!hasIndexedDb()) return 0;
  return (await listRecords()).filter(r => r.dirty && r.ownerUserId === userId).length;
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
}
