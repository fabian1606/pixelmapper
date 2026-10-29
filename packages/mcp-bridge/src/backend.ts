// ── Tool backend interface ──────────────────────────────
//
// The MCP layer talks to one `ToolBackend`. The hub (owns the port, talks to
// the app) and the relay client (talks to the hub) both implement it; the
// coordinator switches between them on takeover.

import type { AppInfo, ToolCallOutcome, ToolDefinition } from './protocol';

/** Snapshot of what the backend knows about the app. */
export interface BackendState {
  /** `'hub'` / `'relay'` while running, `'connecting'` while (re)establishing. */
  mode: 'hub' | 'relay' | 'connecting';
  /** True when an app is connected (directly or via the hub). */
  appConnected: boolean;
  /** The connected app's tools (empty when not connected). */
  tools: ToolDefinition[];
  /** The connected app's metadata, if any. */
  app?: AppInfo;
}

/** Parameters of one forwarded tool call. */
export interface CallRequest {
  tool: string;
  input: Record<string, unknown>;
  /** MCP client name used for actor attribution (`agent:mcp:<client>`). */
  client: string;
  /** Aborts the call (MCP cancellation). */
  signal?: AbortSignal;
}

/** Something that can execute tool calls in the app. */
export interface ToolBackend {
  /** Current state snapshot. */
  getState(): BackendState;
  /** Forwards a call; rejects with `BridgeError` on transport/tool failure. */
  call(request: CallRequest): Promise<ToolCallOutcome>;
  /** Subscribes to state changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
  /** Releases sockets / ports. */
  close(): Promise<void>;
}

/** Minimal listener set used by backend implementations. */
export class ChangeEmitter {
  private listeners = new Set<() => void>();

  /** Adds a listener; returns its unsubscribe function. */
  on(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifies all listeners, isolating listener errors. */
  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[mcp] change listener failed', error);
      }
    }
  }
}
