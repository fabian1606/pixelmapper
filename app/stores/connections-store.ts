/**
 * Output connectors (ADR D17/D18): instances of connector types contributed
 * by extensions, fed with rendered frames by the engine store.
 *
 * Connector setups belong to the user and device, not to the project
 * ("everyone may output differently"): they are stored in localStorage per
 * signed-in user (`pm:connectors:<userId|local>`), never in snapshots or the
 * change log, and survive switching projects.
 */
import { defineStore } from 'pinia';
import { shallowReactive } from 'vue';
import type { Connector, ConnectorEngineState } from '@pixelmapper/extension-api';
import { restoreConnector } from '~/utils/connectors/connector-registry';

/** One persisted connector. */
export interface StoredConnector {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

/** localStorage key of a user's connectors. */
export function connectorStorageKey(userId: string | null): string {
  return `pm:connectors:${userId ?? 'local'}`;
}

/** Reads stored connectors (empty on any storage error). */
export function readStoredConnectors(userId: string | null): StoredConnector[] {
  try {
    const raw = localStorage.getItem(connectorStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(c => c && typeof c.id === 'string' && typeof c.type === 'string') : [];
  }
  catch {
    return [];
  }
}

/** Writes stored connectors (ignored when storage is unavailable). */
export function writeStoredConnectors(userId: string | null, list: StoredConnector[]): void {
  try {
    localStorage.setItem(connectorStorageKey(userId), JSON.stringify(list));
  }
  catch (err) {
    console.warn('[connections] cannot persist connectors:', err);
  }
}

export const useConnectionsStore = defineStore('connections', () => {
  const connectors = shallowReactive<Connector[]>([]);
  /** Owner of the loaded set (null = signed out / local). */
  let userId: string | null = null;
  /** Stored entries whose connector type is not installed (kept, not dropped). */
  let unresolved: StoredConnector[] = [];
  let loaded = false;

  /** Persists the current set (plus unresolved entries). */
  function persist() {
    if (!loaded) return;
    const list = connectors.map(c => ({ id: c.id, type: c.meta.type, config: c.getConfig() }));
    writeStoredConnectors(userId, [...list, ...unresolved]);
  }

  /**
   * Loads the user's connectors (once per user). Auto-connects instances
   * that can connect without a user gesture.
   */
  async function load(forUserId: string | null) {
    if (loaded && forUserId === userId) return;
    await reset();
    userId = forUserId;
    unresolved = [];
    for (const stored of readStoredConnectors(userId)) {
      const c = restoreConnector(stored.type, stored.id, stored.config ?? {});
      if (c) connectors.push(c);
      else unresolved.push(stored);
    }
    loaded = true;
    for (const c of connectors) {
      if (c.canAutoConnect()) c.connect().catch((e: unknown) => console.warn('[connections] auto-connect failed:', c.id, e));
    }
  }

  /** Adds an instance and persists; always-connected instances connect right away. */
  function add(connector: Connector) {
    connectors.push(connector);
    persist();
    if (connector.alwaysConnected?.()) {
      connector.connect().catch((e: unknown) => console.warn('[connections] connect failed:', connector.id, e));
    }
  }

  /** Removes an instance (disconnecting it) and persists. */
  function remove(id: string) {
    const idx = connectors.findIndex(c => c.id === id);
    if (idx === -1) return;
    void connectors[idx]!.disconnect();
    connectors.splice(idx, 1);
    persist();
  }

  /** Applies a config patch to an instance and persists. */
  function update(id: string, patch: Record<string, unknown>) {
    const c = connectors.find(x => x.id === id);
    if (!c) return;
    c.applyConfig(patch);
    persist();
  }

  /** Disconnects and drops every instance (user switch). */
  async function reset() {
    for (const c of connectors) {
      try { await c.disconnect(); }
      catch { /* already closed */ }
    }
    connectors.splice(0, connectors.length);
    loaded = false;
  }

  /** One universe slice (512 bytes) of the flat DMX buffer; zeros beyond it. */
  function universeSlice(dmxBuffer: Uint8Array, universe: number): Uint8Array {
    const offset = (universe - 1) * 512;
    return offset + 512 > dmxBuffer.length ? new Uint8Array(512) : dmxBuffer.subarray(offset, offset + 512);
  }

  /** Every frame: mapped universes to DMX-output connectors. */
  function sendFrame(dmxBuffer: Uint8Array) {
    const totalUniverses = Math.max(1, dmxBuffer.length / 512);
    for (const c of connectors) {
      if (c.status.value !== 'connected' || c.outputCount === 0) continue;
      for (let i = 0; i < c.outputCount; i++) {
        const universe = c.outputMapping.value[i];
        if (!universe || universe < 1 || universe > totalUniverses) continue;
        c.sendFrame(universeSlice(dmxBuffer, universe), universe);
      }
    }
  }

  /** Every frame: rendered state to connectors that use it. */
  function notifyEngineState(state: ConnectorEngineState) {
    for (const c of connectors) {
      if (c.status.value !== 'connected' || !c.onEngineState) continue;
      try {
        c.onEngineState(state);
      }
      catch (err) {
        console.warn(`[connections] ${c.meta.type} onEngineState failed:`, err);
      }
    }
  }

  return { connectors, load, add, remove, update, reset, persist, sendFrame, notifyEngineState };
});
