import { buildBpmPacket, buildTimesyncPacket } from '~/utils/connectors/binary-encoder';
import { BaseConnector, type ConnectorMeta, type EngineConnectorState } from './base-connector';

// ── SerialConnector ───────────────────────────────────────────────────────────
// Forwards pre-built binary packets from the engine-store over USB serial.
// No encoding logic here — the store owns that.

export class SerialConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'serial',
    label: 'USB Serial (ESP32)',
    icon: 'Usb',
  };

  baudRate: number;

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readAbort: AbortController | null = null;

  private cachedBpm      = -1;
  private cachedLayout   = -1;
  private cachedChannels = -1;
  private cachedEffects  = -1;
  private frameCount     = 0;
  private readonly TIMESYNC_INTERVAL = 120;

  constructor(id: string, baudRate = 921600) {
    super(id);
    this.baudRate = baudRate;
  }

  async connect() {
    this.status = 'connecting';
    this.errorMessage = null;
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate: this.baudRate });
      this.writer = this.port!.writable!.getWriter();
      this.status = 'connected';
      // Reset caches so everything is sent fresh on first onEngineState call
      this.frameCount     = 0;
      this.cachedBpm      = -1;
      this.cachedLayout   = -1;
      this.cachedChannels = -1;
      this.cachedEffects  = -1;
      this.startReadLoop();
    } catch (e: any) {
      this.status = 'error';
      this.errorMessage = e?.message ?? 'Connection failed';
    }
  }

  async disconnect() {
    this.readAbort?.abort();
    this.readAbort = null;
    try {
      this.writer?.releaseLock();
      await this.port?.close();
    } catch (_) {}
    this.writer = null;
    this.port   = null;
    this.status = 'disconnected';
    this.errorMessage = null;
  }

  /** No-op — ESP32 renders its own DMX via the local Rust engine */
  sendFrame(_dmxBuffer: Uint8Array) {}

  override onEngineState(state: EngineConnectorState) {
    if (this.status !== 'connected' || !this.writer) return;

    const first = this.frameCount === 0;

    if (first || state.bpm !== this.cachedBpm) {
      this.send(buildBpmPacket(state.bpm));
      this.cachedBpm = state.bpm;
      if (first) this.pushLog(`[sync] bpm=${state.bpm}`);
    }

    if (first || state.layoutRevision !== this.cachedLayout) {
      this.send(state.layoutPacket);
      this.cachedLayout = state.layoutRevision;
      this.pushLog(`[sync] layout ${state.layoutPacket.length}B`);
    }

    if (first || state.channelsRevision !== this.cachedChannels) {
      this.send(state.channelsPacket);
      this.cachedChannels = state.channelsRevision;
      this.pushLog(`[sync] channels ${state.channelsPacket.length}B`);
    }

    if (first || state.effectsRevision !== this.cachedEffects) {
      this.send(state.effectsPacket);
      this.cachedEffects = state.effectsRevision;
      this.pushLog(`[sync] effects ${state.effectsPacket.length}B`);
    }

    if (first || this.frameCount % this.TIMESYNC_INTERVAL === 0) {
      this.send(buildTimesyncPacket(state.elapsedMs));
      if (first) this.pushLog(`[sync] timesync elapsed=${Math.round(state.elapsedMs)}ms`);
    }

    this.frameCount++;
  }

  private send(packet: Uint8Array) {
    try {
      this.writer!.write(packet).catch(() => this.disconnect());
    } catch {
      this.disconnect();
    }
  }

  private startReadLoop() {
    this.readAbort = new AbortController();
    const port = this.port!;

    const run = async () => {
      const decoder = new TextDecoderStream();
      port.readable!.pipeTo(decoder.writable, { signal: this.readAbort!.signal }).catch(() => {});
      let partial = '';
      const reader = decoder.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          partial += value;
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trimEnd();
            if (t) this.pushLog(t);
          }
        }
      } catch (_) {
      } finally {
        reader.releaseLock();
      }
    };

    run();
  }

  override getConfig() {
    return { baudRate: this.baudRate };
  }
}
