import { defineStore } from 'pinia';
import { shallowReactive } from 'vue';
import type { BaseConnector, EngineConnectorState } from '~/utils/connectors/base-connector';

export const useConnectionsStore = defineStore('connections', () => {
  const connectors = shallowReactive<BaseConnector[]>([]);

  function add(connector: BaseConnector) {
    connectors.push(connector);
  }

  function remove(id: string) {
    const idx = connectors.findIndex(c => c.id === id);
    if (idx === -1) return;
    connectors[idx].disconnect();
    connectors.splice(idx, 1);
  }

  /** Called by engine-store render loop — for DMX-output connectors */
  function sendFrame(dmxBuffer: Uint8Array) {
    for (const connector of connectors) {
      if (connector.status === 'connected') {
        connector.sendFrame(dmxBuffer);
      }
    }
  }

  /** Called by engine-store render loop — for parameter-based connectors (e.g. SerialConnector) */
  function notifyEngineState(state: EngineConnectorState) {
    for (const connector of connectors) {
      if (connector.status === 'connected' && connector.onEngineState) {
        connector.onEngineState(state);
      }
    }
  }

  return { connectors, add, remove, sendFrame, notifyEngineState };
});
