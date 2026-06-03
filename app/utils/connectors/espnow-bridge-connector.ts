import { ref } from 'vue';
import { buildVersionRequestPacket, buildColorCommandPacket } from '~/utils/connectors/binary-encoder';
import { BaseConnector, type ConnectorMeta, type EngineConnectorState } from './base-connector';

// ── EspNowBridgeConnector ─────────────────────────────────────────────────────
// Drives a standalone ESP32-S3 (esp32s3_espnow_bridge firmware) over USB serial.
// The bridge does nothing but re-broadcast color frames via ESP-NOW, so audience
// fixtures without WiFi can follow along. We read the assigned fixture's final
// R/G/B + dimmer from the rendered DMX buffer each frame and forward it as a
// 4-byte TYPE_COLOR_CMD — the exact wire format the audience-receiver sketch
// already expects (r,g,b,brightness).

export class EspNowBridgeConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'espnow-bridge',
    label: 'ESP-NOW USB-Bridge',
    icon: 'RadioTower',
  };

  /** App-fixture whose color is read and broadcast (null = nothing to send). */
  fixtureId = ref<string | number | null>(null);
  label           = ref<string>('');
  firmwareVersion = ref<string | null>(null);

  baudRate: number;

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readAbort: AbortController | null = null;
  private readLoopDone: Promise<void> = Promise.resolve();

  private static readonly RETRY_INTERVAL_MS = 2000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Frame dedup: only push a color when it actually changed, plus a heartbeat
  // every ~1s so a freshly-booted bridge re-syncs even on a static look.
  private lastSent = -1;        // packed rgbw (or -1 = nothing sent yet)
  private lastSentMs = 0;
  private readonly HEARTBEAT_MS = 1000;

  constructor(id: string, baudRate = 115200) {
    super(id);
    this.baudRate = baudRate;
    // outputCount stays 0 — parameter-based, no per-universe DMX output.
  }

  async connect() {
    this.clearRetryTimer();
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    try {
      // First connect needs a user gesture (requestPort); retries reuse the port.
      if (!this.port) {
        this.port = await (navigator as any).serial.requestPort();
      }
      await this.port!.open({ baudRate: this.baudRate });
      this.writer = this.port!.writable!.getWriter();
      this.resetCaches();
      this.firmwareVersion.value = null;
      this.startReadLoop();
      await this.waitForBoot(3000);
      this.status.value = 'connected';
      this.autoReconnect.value = true;
      this.pushLog('[bridge] ESP32-S3 ready');
      // Request version once the device has settled (badge + [version] log line).
      setTimeout(() => {
        if (this.status.value !== 'connected') return;
        this.send(buildVersionRequestPacket());
      }, 500);
    } catch (e: any) {
      this.handleConnectFailure(e);
    }
  }

  async disconnect() {
    this.autoReconnect.value = false;
    this.clearRetryTimer();
    await this.teardownHandles();
    this.port = null;
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** No-op — this connector pushes color frames via onEngineState, not raw DMX. */
  sendFrame(_dmxBuffer: Uint8Array, _universe?: number) {}

  override onEngineState(state: EngineConnectorState) {
    if (this.status.value !== 'connected' || !this.writer) return;

    const id = this.fixtureId.value;
    if (id == null) return;
    const fixture = state.fixtures.find(f => String(f.id) === String(id));
    if (!fixture) return;

    const { r, g, b, brightness } = this.readColor(fixture, state.dmxBuffer);
    const packed = (r << 24) | (g << 16) | (b << 8) | brightness;

    const now = state.elapsedMs;
    if (packed !== this.lastSent || now - this.lastSentMs >= this.HEARTBEAT_MS) {
      this.send(buildColorCommandPacket(r, g, b, brightness));
      this.lastSent = packed;
      this.lastSentMs = now;
    }
  }

  /**
   * Read the fixture's raw R/G/B channel values + dimmer (as brightness) from
   * the rendered DMX buffer. Indices are absolute: startAddress-1 + addressOffset.
   * Missing color channels default to 0; a missing dimmer defaults to full (255).
   */
  private readColor(
    fixture: EngineConnectorState['fixtures'][number],
    dmx: Uint8Array,
  ): { r: number; g: number; b: number; brightness: number } {
    const base = fixture.startAddress - 1;
    const at = (type: string, fallback: number) => {
      const ch = fixture.channels.find(c => c.type === type);
      if (!ch) return fallback;
      return dmx[base + ch.addressOffset] ?? fallback;
    };
    return {
      r: at('RED', 0),
      g: at('GREEN', 0),
      b: at('BLUE', 0),
      brightness: at('DIMMER', 255),
    };
  }

  setFixtureId(id: string | number | null) {
    this.fixtureId.value = id;
    this.resetCaches();
  }

  // ── Connection plumbing (mirrors SerialConnector) ────────────────────────
  private handleConnectFailure(e: Error) {
    const msg = e?.message ?? 'Connection failed';
    this.pushLog(`[bridge] connect failed: ${msg}`);
    this.errorMessage.value = msg;
    this.teardownHandles();

    if (e.name === 'NotFoundError' || /no longer|not found|invalid state/i.test(msg)) {
      this.port = null;
      this.autoReconnect.value = false;
    }

    if (this.autoReconnect.value) {
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(() => this.connect(), EspNowBridgeConnector.RETRY_INTERVAL_MS);
      this.pushLog(`[bridge] retry in ${EspNowBridgeConnector.RETRY_INTERVAL_MS}ms`);
    } else {
      this.status.value = 'error';
    }
  }

  private async teardownHandles() {
    this.readAbort?.abort();
    this.readAbort = null;
    try { await this.readLoopDone; } catch {}
    try { this.writer?.releaseLock(); } catch {}
    this.writer = null;
    try { await this.port?.close(); } catch {}
  }

  private clearRetryTimer() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  private resetCaches() {
    this.lastSent = -1;
    this.lastSentMs = 0;
  }

  private waitForBoot(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const ready = this.logs.some(l => l.text.startsWith('[boot]') || l.text.startsWith('[info]'));
        if (ready) { clearInterval(check); clearTimeout(timeout); resolve(); }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(check);
        this.pushLog('[bridge] boot wait timed out — proceeding');
        resolve();
      }, timeoutMs);
    });
  }

  private send(packet: Uint8Array) {
    try {
      this.writer!.write(packet).catch(() => this.disconnect());
    } catch {
      this.disconnect();
    }
  }

  private startReadLoop() {
    const ctrl = new AbortController();
    this.readAbort = ctrl;
    const port = this.port!;

    const run = async () => {
      const textDecoder = new TextDecoder();
      const reader = port.readable!.getReader();
      const onAbort = () => reader.cancel().catch(() => {});
      ctrl.signal.addEventListener('abort', onAbort);
      let partial = '';
      let dropError: unknown = null;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (!ctrl.signal.aborted) dropError = new Error('Serial port closed');
            break;
          }
          partial += textDecoder.decode(value, { stream: true });
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trimEnd();
            if (!t) continue;
            const vMatch = t.match(/^\[version\]\s+([\w.\-]+)$/);
            if (vMatch) this.firmwareVersion.value = vMatch[1]!.trim();
            this.pushLog(t);
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) dropError = e;
      } finally {
        ctrl.signal.removeEventListener('abort', onAbort);
        try { reader.releaseLock(); } catch {}
      }
      if (dropError && this.status.value === 'connected') {
        this.handleConnectFailure(dropError as Error);
      }
    };

    this.readLoopDone = run();
  }

  override getConfig() {
    return {
      baudRate:  this.baudRate,
      label:     this.label.value,
      fixtureId: this.fixtureId.value,
    };
  }

  static fromConfig(id: string, config: Record<string, unknown>): EspNowBridgeConnector {
    const c = new EspNowBridgeConnector(id, Number(config.baudRate ?? 115200));
    c.label.value     = String(config.label ?? '');
    c.fixtureId.value = (config.fixtureId as string | number | null | undefined) ?? null;
    return c;
  }
}
