/**
 * Connection status of the MCP bridge client (plan M3, protocol doc
 * `architecture/mcp-bridge-protocol.md` → "App reconnect behaviour").
 *
 * Kept free of Vue so the transport client stays host-agnostic; the Vue
 * wrapper lives in `bridge-status-ref.ts`.
 */

// ── Types ───────────────────────────────────────

/**
 * Bridge client state:
 * - `disabled`: not started (Settings → External agents off);
 * - `connecting`: first connection attempt in flight;
 * - `waiting`: hub not reachable, retrying with backoff ("waiting for pixelmapper-mcp");
 * - `connected`: handshake done (`welcome` received);
 * - `unauthorized`: token missing/rejected or Origin rejected (no reconnect);
 * - `superseded`: another Pixelmapper window took the slot (no reconnect);
 * - `incompatible`: protocol major differs (no reconnect, update hint).
 */
export type BridgeState =
  | 'disabled'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'unauthorized'
  | 'superseded'
  | 'incompatible';

/** Status snapshot published to listeners. */
export interface BridgeStatus {
  state: BridgeState;
  /** Human-readable line for the settings UI (English). */
  message?: string;
  /** Last error reported by the hub or the socket. */
  lastError?: string;
  /** MCP client name of the most recent tool call (e.g. `claude-code`). */
  lastClient?: string;
}

/** Listener of status changes. */
export type BridgeStatusListener = (status: BridgeStatus) => void;

// ── Messages ────────────────────────────────────

/** Default UI message of each state. */
export const BRIDGE_STATE_MESSAGES: Record<BridgeState, string> = {
  disabled: 'Off',
  connecting: 'Connecting…',
  waiting: 'Waiting for pixelmapper-mcp',
  connected: 'Connected',
  unauthorized: 'Pairing token rejected',
  superseded: 'Another Pixelmapper window is connected',
  incompatible: 'Update needed: Pixelmapper and pixelmapper-mcp speak different protocol versions',
};

/** Builds a status with the default message of its state (overridable). */
export function bridgeStatus(state: BridgeState, extra: Partial<BridgeStatus> = {}): BridgeStatus {
  return { state, message: BRIDGE_STATE_MESSAGES[state], ...extra };
}

/** One-line label for the settings UI, e.g. `Connected · claude-code`. */
export function bridgeStatusLabel(status: BridgeStatus): string {
  const base = status.message ?? BRIDGE_STATE_MESSAGES[status.state];
  if (status.state === 'connected' && status.lastClient) return `${base} · ${status.lastClient}`;
  return base;
}

// ── Emitter ─────────────────────────────────────

/** Holds the current status and notifies listeners on change. */
export class BridgeStatusEmitter {
  private current: BridgeStatus = bridgeStatus('disabled');
  private readonly listeners = new Set<BridgeStatusListener>();

  /** Current status snapshot. */
  get(): BridgeStatus {
    return this.current;
  }

  /** Replaces the status and notifies listeners (errors are isolated). */
  set(next: BridgeStatus): void {
    this.current = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch (error) {
        console.error('[agent-bridge] status listener failed', error);
      }
    }
  }

  /** Merges fields into the current status (e.g. `lastClient`). */
  patch(fields: Partial<BridgeStatus>): void {
    this.set({ ...this.current, ...fields });
  }

  /** Subscribes; the listener is called immediately with the current status. */
  subscribe(listener: BridgeStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
