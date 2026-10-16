/**
 * ESP32-S3 LED strip node over WebSocket. One instance per device; slots
 * bind NeoPixel strip fixtures to GPIO pins. Since plan P6.2 the node only
 * receives rendered pixel bytes: a strip-slots layout packet when the slot
 * setup changes and one pixel frame per slot per frame (the strip's
 * channels are contiguous R,G,B(,W) per logical pixel).
 */
import { ref } from 'vue';
import { ConnectorBase, getFixture, type ConnectorEngineState, type ConnectorStatus, type FixtureId } from '@pixelmapper/extension-api';
import { pixelFrame, stripSlots, versionRequest, type StripSlotPayload } from './protocol';
import { stripOf } from './strip-view';

/** A strip bound to a GPIO pin of the node. */
export interface FixtureSlot {
  fixtureId: FixtureId;
  pin: number | null;
  /** Start LED on a shared data line (not on the wire yet). */
  ledOffset?: number;
}

const CONNECT_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 2000;
/** Frames between re-reading the bound fixtures (addresses, strip config). */
const LAYOUT_REFRESH_FRAMES = 30;

/** Resolved slot for sending. */
interface ResolvedSlot {
  start: number;
  count: number;
  payload: StripSlotPayload;
}

export class WsStripConnector extends ConnectorBase {
  readonly meta = { type: 'websocket', label: 'WebSocket LED strip (ESP32-S3)', icon: 'wifi' };

  url = ref('');
  fixtureSlots = ref<FixtureSlot[]>([]);
  firmwareVersion = ref<string | null>(null);
  /** Data pin reported by the device (fallback for a single slot). */
  devicePin = ref<number | null>(null);

  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private resolved: ResolvedSlot[] = [];
  private sentSlots = '';

  constructor(id: string) {
    super(id);
  }

  /** Connects (idempotent; also used by the retry loop). */
  async connect(): Promise<void> {
    this.clearTimers();
    this.teardownSocket();
    if (!this.url.value) return this.failTo('error', 'WebSocket URL missing');
    if (!this.fixtureSlots.value.some(s => s.fixtureId)) return this.failTo('error', 'No strip fixture assigned');
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    this.resetCaches();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url.value);
    }
    catch (e) {
      return this.handleFailure(e as Error);
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.connectWatchdog = setTimeout(() => {
      if (this.status.value === 'connecting') this.handleFailure(new Error('Connect timeout'));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      this.clearConnectWatchdog();
      this.status.value = 'connected';
      this.autoReconnect.value = true;
      this.pushLog('[ws] connected — requesting version');
      this.send(versionRequest());
    });
    ws.addEventListener('message', ev => this.handleMessage(ev));
    ws.addEventListener('close', () => { this.teardownSocket(); this.pushLog('[ws] closed'); this.scheduleNextStep(); });
    ws.addEventListener('error', () => { this.pushLog('[ws] error'); this.errorMessage.value = 'WebSocket error'; this.teardownSocket(); this.scheduleNextStep(); });
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
    return !!this.url.value && this.fixtureSlots.value.some(s => s.fixtureId);
  }

  /** Sends the slot layout (on change) and one pixel frame per slot. */
  override onEngineState(state: ConnectorEngineState): void {
    if (this.status.value !== 'connected' || !this.ws) return;
    if (this.frame++ % LAYOUT_REFRESH_FRAMES === 0) this.resolveSlots();
    if (this.resolved.length === 0) return;
    const key = JSON.stringify(this.resolved.map(r => r.payload));
    if (key !== this.sentSlots) {
      this.send(stripSlots(this.resolved.map(r => r.payload)));
      this.sentSlots = key;
      this.pushLog(`[sync] strip-slots (${this.resolved.length})`);
    }
    this.resolved.forEach((r, i) => {
      this.send(pixelFrame(i, state.dmxBuffer.subarray(r.start, r.start + r.count)));
    });
  }

  /** Total logical pixels over all slots (RAM guide for the node). */
  logicalPixels(): number {
    return this.fixtureSlots.value.reduce((sum, s) => {
      const strip = s.fixtureId ? stripOf(getFixture(s.fixtureId)) : null;
      return sum + (strip ? Math.max(1, Math.ceil(strip.ledCount / Math.max(1, strip.groupSize))) : 0);
    }, 0);
  }

  override getConfig(): Record<string, unknown> {
    return { ...super.getConfig(), url: this.url.value, fixtureSlots: this.fixtureSlots.value.map(s => ({ ...s })), devicePin: this.devicePin.value };
  }

  override applyConfig(config: Record<string, unknown>): void {
    super.applyConfig(config);
    if (typeof config.url === 'string') this.url.value = config.url;
    if ('devicePin' in config) this.devicePin.value = config.devicePin != null ? Number(config.devicePin) : null;
    if (Array.isArray(config.fixtureSlots)) {
      this.fixtureSlots.value = (config.fixtureSlots as FixtureSlot[]).map(s => ({ fixtureId: s.fixtureId, pin: s.pin ?? null, ledOffset: s.ledOffset ?? 0 }));
      this.resetCaches();
    }
  }

  /** Restores an instance from a stored config. */
  static fromConfig(id: string, config: Record<string, unknown>): WsStripConnector {
    const c = new WsStripConnector(id);
    c.applyConfig(config);
    return c;
  }

  // ── Internals ──────────────────────────────────

  /**
   * Resolves slots to DMX ranges and layout payloads. Pins: a slot without
   * a pin falls back to the device pin only for the first slot; two slots
   * may not share a pin (the firmware can't tell them apart yet).
   */
  private resolveSlots(): void {
    const seen = new Set<number>();
    this.resolved = [];
    this.fixtureSlots.value.forEach((slot, index) => {
      const f = slot.fixtureId ? getFixture(slot.fixtureId) : undefined;
      const strip = stripOf(f);
      if (!f || !strip) return;
      const pin = slot.pin ?? (index === 0 ? this.devicePin.value : null);
      if (pin == null || seen.has(pin)) {
        if (this.frame <= 1) this.pushLog(`[sync] strip ${index + 1} skipped — ${pin == null ? 'no GPIO pin' : `GPIO ${pin} already used`}`);
        return;
      }
      seen.add(pin);
      this.resolved.push({
        start: f.startAddress - 1,
        count: f.channels.length,
        payload: { pin, chipType: strip.chipType, ledCount: strip.ledCount, groupSize: strip.groupSize, ledsPerMeter: strip.ledsPerMeter },
      });
    });
  }

  private resetCaches(): void {
    this.frame = 0;
    this.resolved = [];
    this.sentSlots = '';
    this.firmwareVersion.value = null;
  }

  private send(packet: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(packet);
    }
    catch (e) {
      this.pushLog(`[ws] send failed: ${(e as Error).message ?? e}`);
    }
  }

  private handleMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    for (const raw of ev.data.split('\n')) {
      const line = raw.trimEnd();
      if (!line) continue;
      const v = /^\[version\]\s+([\w.-]+)$/.exec(line);
      if (v) this.firmwareVersion.value = v[1]!.trim();
      const p = /\bpin=(\d+)/.exec(line);
      if (p) this.devicePin.value = Number(p[1]);
      this.pushLog(line);
    }
  }

  private handleFailure(e: Error): void {
    this.pushLog(`[ws] connect failed: ${e.message}`);
    this.errorMessage.value = e.message;
    this.teardownSocket();
    this.scheduleNextStep();
  }

  /** Retries when armed, else settles in error/disconnected. */
  private scheduleNextStep(): void {
    this.clearConnectWatchdog();
    if (this.autoReconnect.value) {
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(() => this.connect(), RETRY_INTERVAL_MS);
      this.pushLog(`[ws] retry in ${RETRY_INTERVAL_MS}ms`);
    }
    else {
      this.status.value = this.errorMessage.value ? 'error' : 'disconnected';
    }
  }

  private teardownSocket(): void {
    if (!this.ws) return;
    try {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      this.ws.close();
    }
    catch { /* already closed */ }
    this.ws = null;
  }

  private clearTimers(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.clearConnectWatchdog();
  }

  private clearConnectWatchdog(): void {
    if (this.connectWatchdog) { clearTimeout(this.connectWatchdog); this.connectWatchdog = null; }
  }

  private failTo(status: ConnectorStatus, msg: string): void {
    this.status.value = status;
    this.errorMessage.value = msg;
  }
}
