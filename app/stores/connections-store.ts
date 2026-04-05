import { defineStore } from 'pinia';
import { shallowReactive } from 'vue';
import type { BaseConnector, EngineConnectorState } from '~/utils/connectors/base-connector';
import { useEngineStore } from '~/stores/engine-store';

export const useConnectionsStore = defineStore('connections', () => {
  const connectors = shallowReactive<BaseConnector[]>([]);

  function add(connector: BaseConnector) {
    connectors.push(connector);
  }

  function remove(id: string) {
    const idx = connectors.findIndex(c => c.id === id);
    if (idx === -1) return;
    const connector = connectors[idx];
    if (!connector) return;
    connector.disconnect();
    connectors.splice(idx, 1);
  }

  /**
   * Extract a 512-byte slice for a specific universe from the flat DMX buffer.
   * Universe 1 → bytes 0-511, Universe 2 → bytes 512-1023, etc.
   */
  function getUniverseBuffer(dmxBuffer: Uint8Array, universe: number): Uint8Array {
    const offset = (universe - 1) * 512;
    if (offset + 512 > dmxBuffer.length) {
      return new Uint8Array(512);
    }
    return dmxBuffer.subarray(offset, offset + 512);
  }

  /** Called by engine-store render loop — for DMX-output connectors */
  function sendFrame(dmxBuffer: Uint8Array) {
    const buf = dmxBuffer;
    const totalUniverses = Math.max(1, buf.length / 512);

    for (const connector of connectors) {
      if (connector.status.value !== 'connected') continue;
      if (connector.outputCount === 0) continue; // parameter-based connectors use onEngineState

      // Send each output's mapped universe
      for (let i = 0; i < connector.outputCount; i++) {
        const universe = connector.outputMapping.value[i];
        if (!universe || universe < 1 || universe > totalUniverses) continue;
        const universeBuf = getUniverseBuffer(buf, universe);
        connector.sendFrame(universeBuf);
      }
    }
  }

  /** Called by engine-store render loop — for parameter-based connectors (e.g. SerialConnector) */
  function notifyEngineState(state: EngineConnectorState) {
    for (const connector of connectors) {
      if (connector.status.value === 'connected' && connector.onEngineState) {
        connector.onEngineState(state);
      }
    }
  }

  /** Returns universe numbers currently used by fixtures. */
  function getUsedUniverses(): number[] {
    const engineStore = useEngineStore();
    return engineStore.usedUniverses;
  }

  return {
    connectors,
    add,
    remove,
    sendFrame,
    notifyEngineState,
    getUsedUniverses,
  };
});
