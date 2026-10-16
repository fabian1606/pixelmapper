/**
 * Loads the signed-in user's connectors once the app is mounted (all
 * extension connector types are registered by then) and reloads them when
 * the user changes (ADR D18: connector setups are per user and device).
 */
import { watch } from 'vue';
import { useConnectionsStore } from '~/stores/connections-store';

export default defineNuxtPlugin({
  name: 'pm:connectors',
  setup(nuxtApp) {
    nuxtApp.hook('app:mounted', () => {
      let user: { value: { id?: string } | null } | null = null;
      try {
        user = useSupabaseUser() as unknown as { value: { id?: string } | null };
      }
      catch {
        user = null;
      }
      const store = useConnectionsStore();
      if (!user) {
        void store.load(null);
        return;
      }
      watch(() => user!.value?.id ?? null, id => { void store.load(id); }, { immediate: true });
    });
  },
});
