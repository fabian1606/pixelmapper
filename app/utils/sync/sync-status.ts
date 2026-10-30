import type { SyncStatus } from '~/utils/sync/project-sync-service';
import type { RemoteError } from '~/utils/sync/remote-api';

/**
 * Maps the sync engine's situation to the header status (ADR 0004 D17).
 * Pure, so the mapping is unit-testable.
 */

/** Inputs of the status mapping. */
export interface StatusInput {
  online: boolean;
  /** A sync cycle is running. */
  running: boolean;
  /** Pending outbox rows (stored + being written). */
  pending: number;
  /** Error of the last remote call, if any. */
  error: RemoteError | null;
  lastSyncedAt: number | null;
}

/** Human-readable message of a remote error for the tooltip. */
function errorMessage(error: RemoteError): string {
  switch (error.kind) {
    case 'auth': return 'Sign in again to sync this project.';
    case 'forbidden': return 'You do not have permission to change this project.';
    case 'not-found': return 'The project no longer exists on the server.';
    case 'server': return 'The server had a problem. Retrying…';
    default: return error.message || 'Sync failed.';
  }
}

/** Status for the open cloud project. */
export function describeStatus(input: StatusInput): SyncStatus {
  const base = { pending: input.pending, lastSyncedAt: input.lastSyncedAt, error: undefined };
  if (!input.online || input.error?.kind === 'network') return { ...base, state: 'offline' };
  if (input.error) return { ...base, state: 'error', error: errorMessage(input.error) };
  if (input.running || input.pending > 0) return { ...base, state: 'syncing' };
  return { ...base, state: 'synced' };
}
