import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { invokeRemote, type RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { RemoteResult } from '~/utils/sync/remote-api-types';

/**
 * Typed wrapper of the `restore-snapshot` edge function (ADR 0004 D5):
 * appends a `restore-snapshot` marker change and stores the older server
 * snapshot at the marker's sequence number.
 * Kept out of `remote-api.ts` to keep that file small; same conventions
 * (never throws, `RemoteResult`).
 */

/** Result of a restore: the restored state and where it now sits in the log. */
export interface RestoreSnapshotResult {
  snapshot: ProjectSnapshot;
  /** Id of the newly inserted head snapshot. */
  id: string;
  /**
   * Sequence number the restored snapshot was stored at: the server's
   * `restore-snapshot` marker change (migration 009; older deployments: the
   * latest change).
   */
  sequenceNumber: number;
}

/** Restore snapshot `snapshotId` of `projectId` at the head of the log. */
export function restoreSnapshot(
  client: RemoteClient,
  input: { projectId: string; snapshotId: string },
): Promise<RemoteResult<RestoreSnapshotResult>> {
  return invokeRemote(client, 'restore-snapshot', { ...input }, (data) => {
    const d = data && typeof data === 'object' ? data as Record<string, unknown> : null;
    const snapshot = d?.snapshot;
    const meta = d?.meta && typeof d.meta === 'object' ? d.meta as Record<string, unknown> : null;
    if (!snapshot || typeof snapshot !== 'object' || !meta || typeof meta.id !== 'string') return null;
    return {
      snapshot: snapshot as ProjectSnapshot,
      id: meta.id,
      sequenceNumber: typeof meta.sequence_number === 'number' ? meta.sequence_number : 0,
    };
  });
}
