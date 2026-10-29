/**
 * App wiring of the MCP bridge (plan M3, ADR 0002 B8): one shared bridge
 * per window. Reads the per-device settings, builds the agent host and the
 * tools lazily, and starts/stops the transport client. Exposed to the app
 * through `#platform` (`getAgentBridge`) so the platform decides the
 * `platform` field of the app hello.
 */
import { effectScope, readonly, shallowRef } from 'vue';
import type { DeepReadonly, Ref } from 'vue';
import type { AgentHost, ToolDefinition } from '@pixelmapper/agent-kit';
import { version as APP_VERSION } from '~~/package.json';
import { createBridgeClient } from './bridge-client';
import type { BridgeClient } from './bridge-client';
import { BridgeStatusEmitter, bridgeStatus } from './bridge-status';
import type { BridgeStatus } from './bridge-status';
import { useBridgeStatus } from './bridge-status-ref';
import { loadAgentBridgeSettings, normalizeToken, saveAgentBridgeSettings } from './agent-bridge-settings';
import type { AgentBridgeSettings } from './agent-bridge-settings';

// ── Types ───────────────────────────────────────

/** Platform reported in the app hello. */
export type AgentBridgePlatform = 'web' | 'tauri';

/** The app-level bridge used by the plugin and the settings UI. */
export interface AgentBridge {
  /** Reactive connection status. */
  status: Readonly<Ref<DeepReadonly<BridgeStatus>>>;
  /** Reactive persisted settings. */
  settings: Readonly<Ref<DeepReadonly<AgentBridgeSettings>>>;
  /** Starts the client if the settings say so (boot; idempotent). */
  init(): void;
  /** Turns the bridge on/off and persists the choice. */
  setEnabled(enabled: boolean): Promise<void>;
  /** Stores a new pairing token and reconnects when enabled. */
  setToken(token: string): Promise<void>;
  /** Reconnects after a terminal state (token rejected, superseded, …). */
  reconnect(): Promise<void>;
  /** Re-announces the tool list (call after the tool registry changed). */
  announceTools(): void;
}

// ── Implementation ──────────────────────────────

/** Host and tools, built on first start (keeps `#platform` imports light). */
interface BridgeDeps {
  host: AgentHost;
  tools: ToolDefinition[];
}

/** Creates a bridge for one platform. Use {@link getSharedAgentBridge}. */
export function createAgentBridge(platform: AgentBridgePlatform): AgentBridge {
  const settings = shallowRef<AgentBridgeSettings>(loadAgentBridgeSettings());
  // Stable status source that outlives individual clients (token changes recreate them).
  const statusSource = new BridgeStatusEmitter();
  // Detached from any component scope: the singleton lives as long as the window.
  const status = effectScope(true).run(() => useBridgeStatus(statusSource))!;
  let client: BridgeClient | null = null;
  let unsubscribe: (() => void) | null = null;
  let deps: Promise<BridgeDeps> | null = null;
  let generation = 0;
  let initialised = false;

  /** Imports host + tools once; dynamic to avoid cycles via the stores. */
  const loadDeps = (): Promise<BridgeDeps> => {
    deps ??= Promise.all([import('./host'), import('@pixelmapper/agent-kit')]).then(([hostModule, kit]) => ({
      host: hostModule.createAppAgentHost(),
      tools: kit.createTools(),
    }));
    return deps;
  };

  /** Stops and forgets the current client. */
  const stopClient = () => {
    generation++;
    unsubscribe?.();
    unsubscribe = null;
    client?.stop();
    client = null;
    statusSource.set(bridgeStatus('disabled'));
  };

  /** (Re)creates the client from the current settings. */
  const startClient = async () => {
    stopClient();
    const run = generation;
    statusSource.set(bridgeStatus('connecting'));
    let loaded: BridgeDeps;
    try {
      loaded = await loadDeps();
    } catch (error) {
      deps = null;
      console.error('[agent-bridge] could not build the agent host', error);
      statusSource.set(bridgeStatus('disabled', { message: 'Agent tools failed to load', lastError: String(error) }));
      return;
    }
    // Disabled or restarted while loading.
    if (run !== generation) return;
    client = createBridgeClient({
      token: settings.value.token,
      app: { name: 'pixelmapper', version: APP_VERSION, platform },
      tools: () => loaded.tools,
      host: loaded.host,
    });
    unsubscribe = client.subscribe((next) => statusSource.set(next));
    client.start();
  };

  /** Persists and publishes new settings. */
  const update = (next: AgentBridgeSettings) => {
    settings.value = next;
    saveAgentBridgeSettings(next);
  };

  return {
    status,
    settings: readonly(settings),
    init() {
      if (initialised) return;
      initialised = true;
      if (settings.value.enabled) void startClient();
    },
    async setEnabled(enabled) {
      initialised = true;
      update({ ...settings.value, enabled });
      if (enabled) await startClient();
      else stopClient();
    },
    async setToken(token) {
      update({ ...settings.value, token: normalizeToken(token) });
      if (settings.value.enabled) await startClient();
    },
    async reconnect() {
      if (settings.value.enabled) await startClient();
    },
    announceTools() {
      client?.announceTools();
    },
  };
}

/** Singleton per window. */
let shared: AgentBridge | null = null;

/** Returns the window's bridge (created on first use). */
export function getSharedAgentBridge(platform: AgentBridgePlatform): AgentBridge {
  shared ??= createAgentBridge(platform);
  return shared;
}
