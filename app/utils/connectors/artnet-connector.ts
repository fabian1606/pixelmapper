import { ref } from 'vue';
import { BaseConnector, type ConnectorMeta, type ConnectorStatus } from './base-connector';

// ── ArtNetConnector ──────────────────────────────────────────────────────────
// Streams DMX frames to a small local Node/Bun bridge over WebSocket. The
// bridge re-emits each universe as an ArtDMX UDP packet. We keep this
// connector dumb on purpose — no ArtNet packet construction here, the bridge
// owns that. Universes are configured purely in the frontend via outputCount
// + outputMapping (inherited from BaseConnector, same flow as SerialConnector).

export class ArtNetConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'artnet',
    label: 'ArtNet (lokale Bridge)',
    icon: 'Network',
  };

  bridgeUrl   = ref<string>('ws://localhost:7777');
  targetIp    = ref<string>('255.255.255.255');
  artnetPort  = ref<number>(6454);
  label       = ref<string>('');

  private ws: WebSocket | null = null;

  // Reconnect machinery — same shape as WebSocketConnector.
  private static readonly CONNECT_TIMEOUT_MS = 5000;
  private static readonly RETRY_INTERVAL_MS  = 2000;
  private retryTimer:      ReturnType<typeof setTimeout> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    super(id);
    this.initOutputs(1);
  }

  /** Resize universe outputs, preserving existing mapping values where possible. */
  setOutputCount(n: number) {
    const clamped = Math.max(0, Math.min(64, Math.floor(n)));
    const prev = this.outputMapping.value.slice();
    this.outputCount = clamped;
    const next: number[] = [];
    for (let i = 0; i < clamped; i++) {
      next[i] = prev[i] ?? (i + 1);
    }
    this.outputMapping.value = next;
  }

  async connect() {
    this.clearTimers();
    this.teardownSocket();

    if (!this.bridgeUrl.value) return this.failTo('error', 'Bridge-URL fehlt');

    this.status.value = 'connecting';
    this.errorMessage.value = null;

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.bridgeUrl.value);
    } catch (e) {
      return this.handleConnectFailure(e as Error);
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this.connectWatchdog = setTimeout(() => {
      if (this.status.value === 'connecting') {
        this.pushLog('[artnet] connect watchdog — tearing down stale socket');
        this.handleConnectFailure(new Error('Connect timeout'));
      }
    }, ArtNetConnector.CONNECT_TIMEOUT_MS);

    ws.addEventListener('open',    () => this.handleOpen());
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close',   () => this.handleClose());
    ws.addEventListener('error',   () => this.handleError());
  }

  async disconnect() {
    this.autoReconnect.value = false;
    this.clearTimers();
    this.teardownSocket();
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  private handleOpen() {
    this.clearConnectWatchdog();
    this.status.value = 'connected';
    this.autoReconnect.value = true;
    this.pushLog(`[artnet] bridge connected — target ${this.targetIp.value}:${this.artnetPort.value}`);
    this.sendConfig();
  }

  /** Push the current target IP/port to the bridge as a JSON text frame. */
  private sendConfig() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'config',
        targetIp:   this.targetIp.value,
        artnetPort: this.artnetPort.value,
      }));
    } catch (e) {
      this.pushLog(`[artnet] config send failed: ${(e as Error).message ?? e}`);
    }
  }

  /** Push a config update mid-session — call from setters when the WS is live. */
  syncConfig() {
    if (this.status.value === 'connected') this.sendConfig();
  }

  private handleError() {
    this.pushLog('[artnet] error');
    this.errorMessage.value = 'Bridge error';
    this.teardownSocket();
    this.scheduleNextStep();
  }

  private handleConnectFailure(e: Error) {
    this.pushLog(`[artnet] connect failed: ${e.message}`);
    this.errorMessage.value = e.message;
    this.teardownSocket();
    this.scheduleNextStep();
  }

  private handleClose() {
    this.teardownSocket();
    this.pushLog('[artnet] closed');
    this.scheduleNextStep();
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data !== 'string') return;
    const lines = ev.data.split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line) this.pushLog(line);
    }
  }

  private scheduleNextStep() {
    this.clearConnectWatchdog();
    if (this.autoReconnect.value) {
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(() => this.connect(), ArtNetConnector.RETRY_INTERVAL_MS);
      this.pushLog(`[artnet] retry in ${ArtNetConnector.RETRY_INTERVAL_MS}ms`);
    } else {
      this.status.value = this.errorMessage.value ? 'error' : 'disconnected';
    }
  }

  private teardownSocket() {
    if (this.ws) {
      try {
        this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
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

  override sendFrame(dmxBuffer: Uint8Array, universe?: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!universe || universe < 1) return;

    const packet = new Uint8Array(2 + dmxBuffer.length);
    packet[0] = universe & 0xff;
    packet[1] = (universe >> 8) & 0xff;
    packet.set(dmxBuffer, 2);
    try {
      this.ws.send(packet);
    } catch (e) {
      this.pushLog(`[artnet] send failed: ${(e as Error).message ?? e}`);
    }
  }

  override getConfig() {
    return {
      bridgeUrl:    this.bridgeUrl.value,
      targetIp:     this.targetIp.value,
      artnetPort:   this.artnetPort.value,
      label:        this.label.value,
      outputCount:  this.outputCount,
      outputMapping: this.outputMapping.value.slice(),
    };
  }

  static fromConfig(id: string, config: Record<string, unknown>): ArtNetConnector {
    const c = new ArtNetConnector(id);
    if (typeof config.bridgeUrl  === 'string') c.bridgeUrl.value  = config.bridgeUrl;
    if (typeof config.targetIp   === 'string') c.targetIp.value   = config.targetIp;
    if (typeof config.artnetPort === 'number') c.artnetPort.value = config.artnetPort;
    if (typeof config.label      === 'string') c.label.value      = config.label;
    if (typeof config.outputCount === 'number') c.setOutputCount(config.outputCount);
    if (Array.isArray(config.outputMapping)) {
      c.outputMapping.value = (config.outputMapping as number[]).slice();
    }
    return c;
  }
}
