/**
 * Types and defaults of the app-side MCP bridge client (`bridge-client.ts`).
 */
import type { AgentHost, ToolDefinition } from '@pixelmapper/agent-kit';
import type { BridgeStatus, BridgeStatusListener } from './bridge-status';

// ── Types ───────────────────────────────────────

/** Default hub address (env `PIXELMAPPER_MCP_PORT` on the CLI side). */
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:7778';

/** Reconnect delays; the last entry is the cap (reset after `welcome`). */
export const DEFAULT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

/** The subset of the WebSocket API the client uses (browser and `ws` both fit). */
export interface BridgeSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** WebSocket constructor (defaults to `globalThis.WebSocket`). */
export type BridgeSocketCtor = new (url: string) => BridgeSocket;

/** Options of {@link createBridgeClient}. */
export interface BridgeClientOptions {
  url?: string;
  /** Pairing token (`bun run mcp token`). */
  token: string;
  app: { name: string; version: string; platform: 'web' | 'tauri' };
  tools: () => ToolDefinition[];
  /** Host instance, or a getter resolved on each call. */
  host: AgentHost | (() => AgentHost);
  WebSocketImpl?: BridgeSocketCtor;
  /** Reconnect delays in ms (tests use tiny values). */
  backoffMs?: number[];
}

/** Public API of the bridge client. */
export interface BridgeClient {
  start(): void;
  stop(): void;
  /** Re-sends the full tool list (`tools` frame) when connected. */
  announceTools(): void;
  getStatus(): BridgeStatus;
  /** Subscribes to status changes (called immediately); returns unsubscribe. */
  subscribe(listener: BridgeStatusListener): () => void;
}
