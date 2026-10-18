import type { ProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { restoreSnapshot } from '~/utils/sync/remote-api-restore';
import { packSnapshot, SyncPosition } from '~/utils/sync/sync-position';

/**
 * "Restore state before sync" (ADR 0004 D5, D17): copy the `before offline
 * sync` server snapshot to the head of the log, make it the local base and
 * working copy, and reload the project.
 */

export interface RestoreInput {
  client: RemoteClient;
  store: ProjectStore;
  projectId: string;
  snapshotId: string;
  /** Stop the open session WITHOUT writing its working snapshot. */
  closeSession(): Promise<void>;
  /** Reopen the project from the local store. */
  reload(): Promise<void>;
}

/** Never throws; resolves true when the state was restored and reloaded. */
export async function restoreBeforeSync(input: RestoreInput): Promise<boolean> {
  const { client, store, projectId, snapshotId } = input;
  try {
    const res = await restoreSnapshot(client, { projectId, snapshotId });
    if (!res.ok) {
      console.warn('[sync] restore failed:', res.error.message);
      return false;
    }
    const { snapshot, sequenceNumber } = res.data;
    // The live state must not overwrite the restored copy afterwards.
    await input.closeSession();
    // The restored snapshot sits at the latest change: nothing before it is
    // replayed again. Pending rows made after the sync stay in the outbox and
    // are replayed on top (outbox order 0 = none reflected).
    const position = SyncPosition.at(sequenceNumber);
    await store.putBaseSnapshot(projectId, packSnapshot(snapshot, position), sequenceNumber);
    await store.putWorkingSnapshot(projectId, packSnapshot(snapshot, position, 0));
    await input.reload();
    return true;
  }
  catch (err) {
    console.warn('[sync] restore failed:', err);
    return false;
  }
}
