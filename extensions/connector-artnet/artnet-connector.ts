/**
 * ArtNet output via a small local bridge (ADR D17: every connector is an
 * extension). Frames go to the bridge over WebSocket as
 * `[universe u16 LE][512 bytes]`; the bridge emits ArtDMX UDP packets to
 * the configured target. Universes are configured with outputs/mapping.
 */
import { ref } from 'vue';
import { ConnectorBase, type ConnectorStatus } from '@pixelmapper/extension-api';

/** Connect timeout and retry interval. */
const CONNECT_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 2000;

export class ArtNetConnector extends ConnectorBase {
  readonly meta = { type: 'artnet', label: 'ArtNet (local bridge)', icon: 'network' };

  bridgeUrl = ref('ws://localhost:7777');
  targetIp = ref('255.255.255.255');
  artnetPort = ref(6454);

  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    super(id);
    this.initOutputs(1);
  }

  /** Connects (idempotent; also used by the retry loop). */
  async connect(): Promise<void> {
    this.clearTimers();
    this.teardownSocket();
    if (!this.bridgeUrl.value) return this.failTo('error', 'Bridge URL missing');

    this.status.value = 'connecting';
    this.errorMessage.value = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.bridgeUrl.value);
    }
    catch (e) {
      return this.handleFailure(e as Error);
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.connectWatchdog = setTimeout(() => {
      if (this.status.value === 'connecting') this.handleFailure(new Error('Connect timeout'));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => this.handleOpen());
    ws.addEventListener('message', ev => this.handleMessage(ev));
    ws.addEventListener('close', () => { this.teardownSocket(); this.pushLog('[artnet] closed'); this.scheduleNextStep(); });
    ws.addEventListener('error', () => { this.pushLog('[artnet] error'); this.errorMessage.value = 'Bridge error'; this.teardownSocket(); this.scheduleNextStep(); });
  }

  /** Disconnects and stops retrying. */
  async disconnect(): Promise<void> {
    this.autoReconnect.value = false;
    this.clearTimers();
    this.teardownSocket();
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  override canAutoConnect(): boolean {
    return !!this.bridgeUrl.value;
  }

  /** Sends one universe to the bridge. */
  override sendFrame(dmxBuffer: Uint8Array, universe?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !universe || universe < 1) return;
    const packet = new Uint8Array(2 + dmxBuffer.length);
    packet[0] = universe & 0xff;
    packet[1] = (universe >> 8) & 0xff;
    packet.set(dmxBuffer, 2);
    try {
      this.ws.send(packet);
    }
    catch (e) {
      this.pushLog(`[artnet] send failed: ${(e as Error).message ?? e}`);
    }
  }

  override getConfig(): Record<string, unknown> {
    return { ...super.getConfig(), bridgeUrl: this.bridgeUrl.value, targetIp: this.targetIp.value, artnetPort: this.artnetPort.value };
  }

  override applyConfig(config: Record<string, unknown>): void {
    super.applyConfig(config);
    if (typeof config.bridgeUrl === 'string') this.bridgeUrl.value = config.bridgeUrl;
    if (typeof config.targetIp === 'string') this.targetIp.value = config.targetIp;
    if (typeof config.artnetPort === 'number') this.artnetPort.value = config.artnetPort;
    // Push target changes to a live bridge.
    if ('targetIp' in config || 'artnetPort' in config) this.sendConfig();
  }

  /** Restores an instance from a stored config. */
  static fromConfig(id: string, config: Record<string, unknown>): ArtNetConnector {
    const c = new ArtNetConnector(id);
    c.applyConfig(config);
    return c;
  }

  // ── Socket plumbing ────────────────────────────

  private handleOpen() {
    this.clearConnectWatchdog();
    this.status.value = 'connected';
    this.autoReconnect.value = true;
    this.pushLog(`[artnet] bridge connected — target ${this.targetIp.value}:${this.artnetPort.value}`);
    this.sendConfig();
  }

  /** Sends target IP/port to the bridge (JSON text frame). */
  private sendConfig() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'config', targetIp: this.targetIp.value, artnetPort: this.artnetPort.value }));
    }
    catch (e) {
      this.pushLog(`[artnet] config send failed: ${(e as Error).message ?? e}`);
    }
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data !== 'string') return;
    for (const raw of ev.data.split('\n')) {
      const line = raw.trimEnd();
      if (line) this.pushLog(line);
    }
  }

  private handleFailure(e: Error) {
    this.pushLog(`[artnet] connect failed: ${e.message}`);
    this.errorMessage.value = e.message;
    this.teardownSocket();
    this.scheduleNextStep();
  }

  /** Retries when armed, else settles in error/disconnected. */
  private scheduleNextStep() {
    this.clearConnectWatchdog();
    if (this.autoReconnect.value) {
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(() => this.connect(), RETRY_INTERVAL_MS);
      this.pushLog(`[artnet] retry in ${RETRY_INTERVAL_MS}ms`);
    }
    else {
      this.status.value = this.errorMessage.value ? 'error' : 'disconnected';
    }
  }

  private teardownSocket() {
    if (!this.ws) return;
    try {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      this.ws.close();
    }
    catch { /* already closed */ }
    this.ws = null;
  }

  private clearTimers() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.clearConnectWatchdog();
  }

  private clearConnectWatchdog() {
    if (this.connectWatchdog) { clearTimeout(this.connectWatchdog); this.connectWatchdog = null; }
  }

  private failTo(status: ConnectorStatus, msg: string) {
    this.status.value = status;
    this.errorMessage.value = msg;
  }
}
