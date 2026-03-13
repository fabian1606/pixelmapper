import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { BaseConnector } from '~/utils/connectors/base-connector';

export const useConnectionsStore = defineStore('connections', () => {
  // reactive() makes connector.status / connector.errorMessage auto-reactive in the UI
  const connectors = reactive<BaseConnector[]>([]);

  function add(connector: BaseConnector) {
    connectors.push(connector);
  }

  function remove(id: string) {
    const idx = connectors.findIndex(c => c.id === id);
    if (idx === -1) return;
    connectors[idx].disconnect();
    connectors.splice(idx, 1);
  }

  /** Called by the engine-store render loop after every engine.render() */
  function sendFrame(dmxBuffer: Uint8Array) {
    for (const connector of connectors) {
      if (connector.status === 'connected') {
        connector.sendFrame(dmxBuffer);
      }
    }
  }

  return { connectors, add, remove, sendFrame };
});
