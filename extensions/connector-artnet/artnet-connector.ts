/**
 * ArtNet output (ADR D17: every connector is an extension). Universes are
 * configured with outputs/mapping.
 *
 * Two transports (ADR 0003): when the platform can send UDP (desktop app),
 * ArtDMX packets go straight to the target. In the browser, frames go to a
 * small local bridge (`tools/artnet-bridge`, default `ws://localhost:7778`)
 * over WebSocket as `[universe u16 LE][512 bytes]` and the bridge emits the
 * UDP packets.
 */
import { ref } from 'vue';
import { ConnectorBase, getPlatform, type ConnectorStatus, type UdpApi, type UdpSocket } from '@pixelmapper/extension-api';
import { ARTNET_PORT, ArtDmxSequencer, encodeArtDmx, toArtNetUniverse } from './art-dmx';

/** Connect timeout and retry interval. */
const CONNECT_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 2000;

/**
 * Default URL of the old local bridge (`tools/artnet-bridge`). Port 7778:
 * 7777 belongs to the Art-Net 4 bridge `pmnet-bridge serve` (plan M3.4),
 * which does not serve this connector's protocol.
 */
export const LEGACY_BRIDGE_URL = 'ws://localhost:7778';

/** Former default bridge URLs (port 7777), migrated when a stored config is restored. */
const FORMER_DEFAULT_BRIDGE_URLS: ReadonlySet<string> = new Set(['ws://localhost:7777', 'ws://127.0.0.1:7777']);

/**
 * Maps a stored bridge URL to the current one: exactly the former default →
 * `LEGACY_BRIDGE_URL`; any other (custom) URL is kept as is.
 */
export function migrateLegacyBridgeUrl(url: string): string {
  return FORMER_DEFAULT_BRIDGE_URLS.has(url) ? LEGACY_BRIDGE_URL : url;
}

/** The platform's UDP access, or `null` (browser, or no host in tests). */
function platformUdp(): UdpApi | null {
  try {
    return getPlatform().udp;
  }
  catch {
    return null;
  }
}

export class ArtNetConnector extends ConnectorBase {
  readonly meta = { type: 'artnet', label: 'ArtNet (manual target)', icon: 'network' };

  bridgeUrl = ref(LEGACY_BRIDGE_URL);
  targetIp = ref('255.255.255.255');
  artnetPort = ref(ARTNET_PORT);

  private ws: WebSocket | null = null;
  /** Direct UDP socket (desktop app); `null` in bridge mode. */
  private udpSocket: UdpSocket | null = null;
  private sequencer = new ArtDmxSequencer();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    super(id);
    this.initOutputs(1);
  }

  /** True when packets go out directly over UDP (no bridge needed). */
  get directUdp(): boolean {
    return !!platformUdp();
  }

  /** Connects (idempotent; also used by the retry loop). */
  async connect(): Promise<void> {
    this.clearTimers();
    this.teardownSocket();
    await this.closeUdp();
    const udp = platformUdp();
    if (udp) return this.connectDirect(udp);
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
    await this.closeUdp();
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** Direct UDP has no connection to manage: connected as soon as it exists. */
  override alwaysConnected(): boolean {
    return this.directUdp;
  }

  override canAutoConnect(): boolean {
    return this.directUdp || !!this.bridgeUrl.value;
  }

  /** Sends one universe (1-based) directly or to the bridge. */
  override sendFrame(dmxBuffer: Uint8Array, universe?: number): void {
    if (this.udpSocket) return this.sendDirect(dmxBuffer, universe);
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

  /**
   * Restores an instance from a stored config. A stored bridge URL that is
   * exactly the former default (port 7777) moves to `LEGACY_BRIDGE_URL`; the
   * host persists it with the next save. URLs typed in the settings later
   * (`applyConfig`) are taken literally.
   */
  static fromConfig(id: string, config: Record<string, unknown>): ArtNetConnector {
    const c = new ArtNetConnector(id);
    const stored = typeof config.bridgeUrl === 'string' ? { ...config, bridgeUrl: migrateLegacyBridgeUrl(config.bridgeUrl) } : config;
    c.applyConfig(stored);
    return c;
  }

  // ── Direct UDP ─────────────────────────────────

  /** Opens a broadcast-capable UDP socket; no retry loop needed (UDP has no peer). */
  private async connectDirect(udp: UdpApi) {
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    try {
      this.udpSocket = await udp.bind({ broadcast: true });
    }
    catch (e) {
      return this.handleFailure(e as Error);
    }
    this.sequencer.reset();
    this.status.value = 'connected';
    this.autoReconnect.value = true;
    this.pushLog(`[artnet] direct UDP — target ${this.targetIp.value}:${this.artnetPort.value}`);
  }

  /** Encodes one ArtDMX packet and sends it to the target. */
  private sendDirect(dmxBuffer: Uint8Array, universe?: number) {
    const artUniverse = toArtNetUniverse(universe ?? 0);
    if (artUniverse === null || !this.udpSocket) return;
    const packet = encodeArtDmx(artUniverse, dmxBuffer, this.sequencer.next(artUniverse));
    try {
      this.udpSocket.send(packet, this.targetIp.value, this.artnetPort.value);
    }
    catch (e) {
      this.pushLog(`[artnet] send failed: ${(e as Error).message ?? e}`);
    }
  }

  private async closeUdp() {
    const socket = this.udpSocket;
    this.udpSocket = null;
    await socket?.close().catch(() => {});
  }

  // ── Bridge socket plumbing ─────────────────────

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
