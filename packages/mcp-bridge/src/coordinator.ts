// ── Coordinator: hub or relay, with takeover ────────────
//
// Decides at startup whether this process owns the port (hub) or relays
// through another instance, and re-runs that decision when the hub dies.
// To the MCP layer it is a single stable `ToolBackend`.

import { ChangeEmitter } from './backend';
import type { BackendState, CallRequest, ToolBackend } from './backend';
import type { BridgeConfig } from './config';
import { Hub } from './hub';
import { logInfo, logWarn } from './log';
import { BridgeError, NO_APP_MESSAGE } from './protocol';
import type { ClientInfo, ToolCallOutcome } from './protocol';
import { RelayClient } from './relay-client';

/** Delay before retrying when neither hub nor relay could be established. */
const RETRY_DELAY_MS = 2_000;

/** Stable backend facade that switches between hub and relay. */
export class BridgeCoordinator implements ToolBackend {
  private readonly emitter = new ChangeEmitter();
  private current: Hub | RelayClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError = '';
  private closed = false;

  constructor(
    private readonly config: BridgeConfig,
    private readonly token: string,
    /** Returns the MCP client info (known only after MCP initialize). */
    private readonly clientInfo: () => ClientInfo,
  ) {}

  /** Establishes the first backend; never rejects (failures schedule retries). */
  async start(): Promise<void> {
    await this.attempt();
  }

  /** The active hub, if this process owns the port (tests, status). */
  get hub(): Hub | null {
    return this.current instanceof Hub ? this.current : null;
  }

  // ── ToolBackend ─────────────────────────────────────────

  getState(): BackendState {
    return this.current?.getState() ?? { mode: 'connecting', appConnected: false, tools: [] };
  }

  call(request: CallRequest): Promise<ToolCallOutcome> {
    if (!this.current) return Promise.reject(new BridgeError('no_app', NO_APP_MESSAGE));
    return this.current.call(request);
  }

  onChange(listener: () => void): () => void {
    return this.emitter.on(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.unsubscribe?.();
    const current = this.current;
    this.current = null;
    await current?.close();
  }

  // ── Role election ───────────────────────────────────────

  /** Tries hub first, then relay; schedules a retry if both fail. */
  private async attempt(): Promise<void> {
    if (this.closed) return;
    try {
      this.attach(await Hub.start(this.config, this.token));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        this.reportError(`cannot listen on port ${this.config.port}: ${(error as Error).message}`);
        this.scheduleRetry(RETRY_DELAY_MS);
        return;
      }
    }
    try {
      const relay = await RelayClient.connect(this.config, this.token, this.clientInfo());
      if (this.closed) {
        await relay.close();
        return;
      }
      relay.onClosed(() => this.handleHubLost());
      this.attach(relay);
    } catch (error) {
      const hint = error instanceof BridgeError && error.code === 'unauthorized'
        ? ' (the running hub uses a different token file)'
        : '';
      this.reportError(`port ${this.config.port} is busy and relaying failed: ${(error as Error).message}${hint}`);
      this.scheduleRetry(RETRY_DELAY_MS);
    }
  }

  /** Switches to a new backend and forwards its change events. */
  private attach(backend: Hub | RelayClient): void {
    this.lastError = '';
    this.unsubscribe?.();
    this.current = backend;
    this.unsubscribe = backend.onChange(() => this.emitter.emit());
    this.emitter.emit();
  }

  /** Relay lost the hub: race for the port after a random delay. */
  private handleHubLost(): void {
    logInfo('hub connection lost; trying to take over');
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = null;
    this.emitter.emit();
    // Jitter avoids several relays hammering the port at the same instant.
    this.scheduleRetry(100 + Math.floor(Math.random() * 500));
  }

  /** Schedules the next election attempt. */
  private scheduleRetry(delayMs: number): void {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, delayMs);
  }

  /** Logs an election error once (avoids spamming stderr every retry). */
  private reportError(message: string): void {
    if (message === this.lastError) return;
    this.lastError = message;
    logWarn(message);
  }
}
