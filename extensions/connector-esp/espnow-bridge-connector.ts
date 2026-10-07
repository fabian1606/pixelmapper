/**
 * ESP-NOW USB bridge: a standalone ESP32-S3 re-broadcasts a color via
 * ESP-NOW so audience devices without WiFi follow along. Each frame the
 * assigned fixture's rendered R/G/B + dimmer is sent as a color command
 * (deduplicated, with a 1 s heartbeat).
 */
import { ref } from 'vue';
import { getFixture, type ConnectorEngineState, type FixtureId } from '@pixelmapper/extension-api';
import { SerialPortConnector } from './serial-base';
import { colorCommand, versionRequest } from './protocol';

/** Heartbeat so a freshly booted bridge re-syncs on a static look. */
const HEARTBEAT_MS = 1000;
/** Frames between re-reading the fixture's channel layout. */
const LAYOUT_REFRESH_FRAMES = 30;

export class EspNowBridgeConnector extends SerialPortConnector {
  readonly meta = { type: 'espnow-bridge', label: 'ESP-NOW USB bridge', icon: 'radio-tower' };
  protected readonly tag = 'bridge';
  protected readonly bootMarkers = ['[boot]', '[info]'];

  /** Fixture whose color is broadcast (null = nothing). */
  fixtureId = ref<FixtureId | null>(null);
  firmwareVersion = ref<string | null>(null);

  private lastSent = -1;
  private lastSentMs = 0;
  private frame = 0;
  /** Absolute DMX indices of R, G, B, dimmer (−1 = missing). */
  private layout: { r: number; g: number; b: number; dim: number } | null = null;

  constructor(id: string, baudRate = 115200) {
    super(id, baudRate);
  }

  protected override onOpen(): void {
    this.resetCaches();
    this.firmwareVersion.value = null;
  }

  protected override onReady(): void {
    setTimeout(() => {
      if (this.status.value === 'connected') this.send(versionRequest());
    }, 500);
  }

  protected override onLine(line: string): void {
    const v = /^\[version\]\s+([\w.-]+)$/.exec(line);
    if (v) this.firmwareVersion.value = v[1]!.trim();
  }

  /** Sends the fixture's current color when it changed (or on heartbeat). */
  override onEngineState(state: ConnectorEngineState): void {
    if (this.status.value !== 'connected' || this.fixtureId.value == null) return;
    if (!this.layout || this.frame++ % LAYOUT_REFRESH_FRAMES === 0) this.readLayout();
    const l = this.layout;
    if (!l) return;
    const at = (i: number, fallback: number) => (i >= 0 ? state.dmxBuffer[i] ?? fallback : fallback);
    const r = at(l.r, 0), g = at(l.g, 0), b = at(l.b, 0), dim = at(l.dim, 255);
    const packed = ((r << 24) | (g << 16) | (b << 8) | dim) >>> 0;
    if (packed !== this.lastSent || state.elapsedMs - this.lastSentMs >= HEARTBEAT_MS) {
      this.send(colorCommand(r, g, b, dim));
      this.lastSent = packed;
      this.lastSentMs = state.elapsedMs;
    }
  }

  override getConfig(): Record<string, unknown> {
    return { ...super.getConfig(), baudRate: this.baudRate, fixtureId: this.fixtureId.value };
  }

  override applyConfig(config: Record<string, unknown>): void {
    super.applyConfig(config);
    if (typeof config.baudRate === 'number') this.baudRate = config.baudRate;
    if ('fixtureId' in config) {
      this.fixtureId.value = (config.fixtureId as FixtureId | null) ?? null;
      this.resetCaches();
    }
  }

  /** Restores an instance from a stored config. */
  static fromConfig(id: string, config: Record<string, unknown>): EspNowBridgeConnector {
    const c = new EspNowBridgeConnector(id, Number(config.baudRate ?? 115200));
    c.applyConfig(config);
    return c;
  }

  /** Resolves the absolute DMX indices of the color channels. */
  private readLayout(): void {
    const f = this.fixtureId.value != null ? getFixture(this.fixtureId.value) : undefined;
    if (!f) { this.layout = null; return; }
    const idx = (type: string) => {
      const ch = f.channels.find(c => c.type === type && !c.isFine);
      return ch ? ch.dmxAddress - 1 : -1;
    };
    this.layout = { r: idx('RED'), g: idx('GREEN'), b: idx('BLUE'), dim: idx('DIMMER') };
  }

  private resetCaches(): void {
    this.lastSent = -1;
    this.lastSentMs = 0;
    this.layout = null;
    this.frame = 0;
  }
}
