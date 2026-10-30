/**
 * Version-history hover previews of the open project. Wires
 * `createVersionPreview` to the Supabase client and connectivity.
 * See `utils/sync/version-preview/preview-controller.ts`.
 */
import { shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { isOnline } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { createVersionPreview, type VersionPreview } from '~/utils/sync/version-preview/preview-controller';

/** Supabase client, or null outside a Nuxt app (tests) / without the module. */
function supabaseClient(): RemoteClient | null {
  try {
    return useSupabaseClient() as unknown as RemoteClient;
  }
  catch {
    return null;
  }
}

/** Preview loader for `projectId`; recreated (and the old one cancelled) when the project changes. */
export function useVersionPreview(projectId: Readonly<Ref<string | undefined>>): Readonly<Ref<VersionPreview | null>> {
  const client = supabaseClient();
  const preview = shallowRef<VersionPreview | null>(null);

  watch(projectId, (id) => {
    preview.value?.cancelAll();
    preview.value = id ? createVersionPreview({ projectId: id, client: () => client, online: isOnline }) : null;
  }, { immediate: true });

  return preview;
}
