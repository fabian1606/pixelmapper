import { getProjectSyncService, type ProjectSyncService } from '~/utils/sync/project-sync-service';

/**
 * Optional access to the sync engine (WP-SYNC registers it at startup).
 *
 * The account flows must keep working when it is missing (e.g. an early
 * boot phase, or a build without the engine): mirroring is skipped and the
 * logout check falls back to counting the local outbox.
 */
export function tryGetProjectSyncService(): ProjectSyncService | null {
  try {
    return getProjectSyncService();
  }
  catch {
    return null;
  }
}
