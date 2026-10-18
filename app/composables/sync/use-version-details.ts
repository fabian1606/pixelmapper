/**
 * Version-history details ("what changed") of the open project. Wires
 * `createVersionDetails` to the Supabase client, connectivity and the
 * plugin manifests (effect names). See `utils/sync/version-details-controller.ts`.
 */
import { shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { modifierName } from '~/utils/engine/modifiers';
import type { ModifierInstance } from '~/utils/engine/types';
import { isOnline } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { createVersionDetails, type VersionDetails } from '~/utils/sync/version-details-controller';
import type { DiffOptions } from '~/utils/sync/version-diff';

/** Supabase client, or null outside a Nuxt app (tests) / without the module. */
function supabaseClient(): RemoteClient | null {
  try {
    return useSupabaseClient() as unknown as RemoteClient;
  }
  catch {
    return null;
  }
}

/** Effect names from installed plugin manifests; undefined when unknown. */
const DIFF_OPTIONS: DiffOptions = {
  modifierName: (m) => {
    if (typeof m.plugin !== 'string') return undefined;
    try {
      const name = modifierName({ plugin: m.plugin, params: (m.params ?? {}) as ModifierInstance['params'] });
      return name === 'Unknown modifier' ? undefined : name;
    }
    catch {
      return undefined;
    }
  },
};

/** Details loader for `projectId`; recreated when the open project changes. */
export function useVersionDetails(projectId: Readonly<Ref<string | undefined>>): Readonly<Ref<VersionDetails | null>> {
  const client = supabaseClient();
  const details = shallowRef<VersionDetails | null>(null);

  watch(projectId, (id) => {
    details.value = id
      ? createVersionDetails({ projectId: id, client: () => client, online: isOnline, diffOptions: () => DIFF_OPTIONS })
      : null;
  }, { immediate: true });

  return details;
}
