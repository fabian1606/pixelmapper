/**
 * Version history of the open project (ADR 0004 D17) for the sync status
 * popover. Wires `createVersionHistory` to the real app: Supabase client,
 * connectivity, the open sync engine, the sync status and the local
 * project store (role). See `utils/sync/version-history-controller.ts`.
 */
import { shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { getProjectStore } from '~/utils/persistence/project-store';
import { isOnline } from '~/utils/sync/connectivity';
import { getOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import { syncStatus } from '~/utils/sync/project-sync-service';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { createVersionHistory, type VersionHistory } from '~/utils/sync/version-history-controller';

/** Supabase client, or null outside a Nuxt app (tests) / without the module. */
function supabaseClient(): RemoteClient | null {
  try {
    return useSupabaseClient() as unknown as RemoteClient;
  }
  catch {
    return null;
  }
}

/**
 * Controller for `projectId`; recreated when the open project changes.
 * The client is resolved once during setup (composables must run there).
 */
export function useVersionHistory(projectId: Readonly<Ref<string | undefined>>): Readonly<Ref<VersionHistory | null>> {
  const client = supabaseClient();
  const history = shallowRef<VersionHistory | null>(null);

  watch(projectId, (id) => {
    history.value = id
      ? createVersionHistory({
          projectId: id,
          isLocal: () => syncStatus.value.state === 'local-only',
          client: () => client,
          online: isOnline,
          engine: () => getOpenSyncEngine(id),
          pendingCount: async () => {
            const stored = await getProjectStore().then(s => s.countPending(id)).catch(() => 0);
            // The status also counts pushed-but-unconfirmed rows.
            return Math.max(stored, syncStatus.value.pending);
          },
          role: async () => (await getProjectStore().then(s => s.getProject(id)))?.role,
        })
      : null;
  }, { immediate: true });

  return history;
}
