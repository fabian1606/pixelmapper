/**
 * Sync engine boot (ADR 0004 D8, D13): registers the `ProjectSyncService`
 * used by the account flows and moves the old WAL into the outbox once.
 */
import { getProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { registerProjectSyncService } from '~/utils/sync/project-sync-service';
import { createProjectSyncService } from '~/utils/sync/project-sync-service-impl';
import { ensureLegacyWalMigrated } from '~/utils/sync/legacy-wal';

export default defineNuxtPlugin({
  name: 'pm:project-sync',
  dependsOn: ['supabase'],
  setup() {
    // The outbox replaced the WAL in the persist path: migrate leftovers now.
    void ensureLegacyWalMigrated();
    let client: RemoteClient;
    try {
      client = useSupabaseClient() as unknown as RemoteClient;
    }
    catch (err) {
      console.warn('[sync] Supabase unavailable, project sync disabled:', err);
      return;
    }
    registerProjectSyncService(createProjectSyncService({ client, store: getProjectStore }));
  },
});
