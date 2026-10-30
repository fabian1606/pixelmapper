/**
 * Per-device settings of *Settings → External agents*: on/off toggle and
 * the pairing token of `pixelmapper-mcp`. Stored in `localStorage`; every
 * access is guarded (private mode, blocked storage, SSR).
 */

/** `localStorage` key of the settings. */
export const AGENT_BRIDGE_STORAGE_KEY = 'pixelmapper.agentBridge';

/** Persisted settings. */
export interface AgentBridgeSettings {
  enabled: boolean;
  token: string;
}

/** Settings used when nothing (valid) is stored. */
export const DEFAULT_AGENT_BRIDGE_SETTINGS: AgentBridgeSettings = { enabled: false, token: '' };

/** Reads the settings; falls back to the defaults on any error. */
export function loadAgentBridgeSettings(): AgentBridgeSettings {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_BRIDGE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AGENT_BRIDGE_SETTINGS };
    const value = JSON.parse(raw) as Partial<AgentBridgeSettings>;
    return {
      enabled: value.enabled === true,
      token: typeof value.token === 'string' ? value.token : '',
    };
  } catch (error) {
    console.warn('[agent-bridge] could not read settings', error);
    return { ...DEFAULT_AGENT_BRIDGE_SETTINGS };
  }
}

/** Writes the settings; failures are logged and otherwise ignored. */
export function saveAgentBridgeSettings(settings: AgentBridgeSettings): void {
  try {
    globalThis.localStorage?.setItem(AGENT_BRIDGE_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('[agent-bridge] could not save settings', error);
  }
}

/** Normalises a pasted token (whitespace and line breaks from terminals). */
export function normalizeToken(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}
