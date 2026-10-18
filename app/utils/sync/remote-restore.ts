/**
 * Restore markers from the server (ADR 0004 D5, migration 009).
 *
 * `restore-snapshot` appends a marker change `{ command_type:
 * 'restore-snapshot', payload: { snapshotId } }` and stores the restored
 * state as a snapshot AT the marker's sequence number. The marker cannot be
 * replayed onto a live state (the restored state is not in the change), so
 * a client that receives it — by pull or realtime — reopens the project
 * from the server instead, where `load-project` starts at the restored
 * snapshot.
 *
 * This module is the seam between the places that see markers (the replay
 * port, the realtime applier) and the engine store, which owns the reload:
 * - `handleRestoreMarker()` is called by those places for every change;
 * - the engine store registers the reload with `setRemoteRestoreHandler()`;
 * - while a reload is pending, `isRemoteRestorePending()` blocks server
 *   snapshots (they would store the pre-restore state at a position past
 *   the marker and undo the restore for everyone);
 * - `runLocalRestore()` wraps this client's own restore so the echo of its
 *   own marker does not trigger a second reload.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** `command_type` of the marker row written by the `restore_snapshot` RPC. */
export const RESTORE_MARKER_TYPE = 'restore-snapshot';

// ── State ────────────────────────────────────────────────────────────────────

/** Reload handler of the engine store (null while no project is open). */
type RemoteRestoreHandler = () => Promise<void>;

let handler: RemoteRestoreHandler | null = null;
let pending = false;
let localRestores = 0;

// ── API ──────────────────────────────────────────────────────────────────────

/** True for a restore marker row. */
export function isRestoreMarker(type: string): boolean {
  return type === RESTORE_MARKER_TYPE;
}

/** Register (or clear) the reload of the open project. */
export function setRemoteRestoreHandler(fn: RemoteRestoreHandler | null): void {
  handler = fn;
}

/** A remote restore was seen and the reload has not finished yet. */
export function isRemoteRestorePending(): boolean {
  return pending;
}

/**
 * Handle a change if it is a restore marker: schedule one reload of the open
 * project (coalesced) and return true. Returns false for any other change.
 *
 * The reload runs in a macrotask: callers are inside a sync cycle (engine
 * lock held) or a realtime callback, and the handler waits for the engine.
 */
export function handleRestoreMarker(type: string): boolean {
  if (!isRestoreMarker(type)) return false;
  // Our own restore reloads by itself.
  if (localRestores > 0) return true;
  if (pending || !handler) return true;
  pending = true;
  const run = handler;
  setTimeout(() => {
    run()
      .catch(err => console.warn('[sync] reload after remote restore failed:', err))
      .finally(() => { pending = false; });
  }, 0);
  return true;
}

/** Run this client's own restore; its marker echo is ignored meanwhile. */
export async function runLocalRestore<T>(fn: () => Promise<T>): Promise<T> {
  localRestores++;
  try {
    return await fn();
  }
  finally {
    localRestores--;
  }
}

/** Test helper: reset module state. */
export function resetRemoteRestoreState(): void {
  handler = null;
  pending = false;
  localRestores = 0;
}
