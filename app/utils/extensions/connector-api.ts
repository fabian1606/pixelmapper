/**
 * Host side of the extension API's `connectors` and `getUserKey` (API 1.4).
 *
 * `connectors` is a thin facade over the connections store (the user's
 * connector instances on this device, ADR D18), so extensions can add the
 * connector of a device they found, list and remove instances, and persist
 * config a connector learned by itself. The user key is the signed-in
 * user's id (set by the connectors plugin), else `'local'`.
 */
import { shallowRef } from 'vue';
import type { Connector, ConnectorSet } from '@pixelmapper/extension-api';
import { useConnectionsStore } from '~/stores/connections-store';

/** Id of the signed-in user, null when signed out (reactive). */
const currentUserId = shallowRef<string | null>(null);

/** Sets the current user (called by the connectors plugin on sign-in/out). */
export function setCurrentUserId(id: string | null): void {
  currentUserId.value = id;
}

/** Key of the current user for per-user storage: user id or `'local'`. */
export function getUserKey(): string {
  return currentUserId.value ?? 'local';
}

/** The connector set backed by the connections store. */
export function createHostConnectorSet(): ConnectorSet {
  return {
    list(type?: string): readonly Connector[] {
      // The store's instances (Pinia's typing unwraps their refs; at runtime they are the connectors).
      const all = useConnectionsStore().connectors as unknown as readonly Connector[];
      return type ? all.filter(c => c.meta.type === type) : all;
    },
    add(connector: Connector): void {
      useConnectionsStore().add(connector);
    },
    remove(id: string): void {
      useConnectionsStore().remove(id);
    },
    persist(id: string): void {
      const store = useConnectionsStore();
      if (store.connectors.some(c => c.id === id)) store.persist();
    },
  };
}
