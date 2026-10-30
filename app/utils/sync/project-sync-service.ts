import { ref, readonly } from 'vue';
import type { RemoteProjectHead } from '~/utils/sync/remote-api-types';

/**
 * Contract between the sync engine (WP-SYNC, implements) and the account /
 * project-list flows (WP-ACCOUNT, consumes) — ADR 0004 D13–D17.
 *
 * WP-SYNC registers the implementation once at startup via
 * `registerProjectSyncService`; consumers call `getProjectSyncService()`.
 */

// ── Status ───────────────────────────────────────────────────────────────────

/** Sync state of the currently open project, shown by the header icon (D17). */
export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'local-only';

export interface SyncStatus {
  state: SyncState;
  /** Pending outbox entries of the open project. */
  pending: number;
  /** Last error message (state 'error'). */
  error?: string;
  lastSyncedAt: number | null;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface ProjectSyncService {
  /**
   * Bring the local copy of a cloud project up to date without opening it
   * (background mirroring, D13). Downloads the snapshot when missing, pulls
   * changes after the local cursor otherwise. Never throws; logs and returns
   * false on failure.
   */
  mirrorProject(head: RemoteProjectHead, userId: string): Promise<boolean>;
  /**
   * Push pending outbox entries of all cloud projects bound to `userId`
   * (before logout, D15/D16). Resolves with the number still pending.
   */
  flushAll(userId: string): Promise<number>;
  /** Pending outbox entries for one project, or all projects. */
  countPending(projectId?: string): Promise<number>;
}

let service: ProjectSyncService | null = null;

/** Called once by WP-SYNC. */
export function registerProjectSyncService(impl: ProjectSyncService): void {
  service = impl;
}

/** Throws if the sync engine has not been registered yet. */
export function getProjectSyncService(): ProjectSyncService {
  if (!service) throw new Error('[sync] ProjectSyncService not registered');
  return service;
}

// ── Shared reactive status (written by WP-SYNC, read by UI) ──────────────────

const status = ref<SyncStatus>({ state: 'synced', pending: 0, lastSyncedAt: null });

/** Read-only sync status of the open project. */
export const syncStatus = readonly(status);

/** Update the status (WP-SYNC only). */
export function setSyncStatus(next: Partial<SyncStatus>): void {
  status.value = { ...status.value, ...next };
}
