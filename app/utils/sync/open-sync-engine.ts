import type { SyncEngine } from '~/utils/sync/sync-engine';

/**
 * The sync engine of the currently open cloud project, if any. Lets the
 * project sync service delegate to it (D13) and the collaboration layer feed
 * realtime inserts into it.
 */

let current: SyncEngine | null = null;

/** Set by the engine store when a session starts / ends. */
export function setOpenSyncEngine(engine: SyncEngine | null): void {
  current = engine;
}

/** Engine of the open project (null when none or local-only). */
export function getOpenSyncEngine(projectId?: string): SyncEngine | null {
  if (!current) return null;
  if (projectId && current.projectId !== projectId) return null;
  return current;
}
