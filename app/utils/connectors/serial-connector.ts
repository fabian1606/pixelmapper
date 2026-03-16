import { ref, computed } from 'vue';
import { buildBpmPacket, buildTimesyncPacket, buildVersionRequestPacket } from '~/utils/connectors/binary-encoder';
import { BaseConnector, type ConnectorMeta, type EngineConnectorState } from './base-connector';

// ── SerialConnector ───────────────────────────────────────────────────────────
// Forwards pre-built binary packets from the engine-store over USB serial.
// No encoding logic here — the store owns that.

function isNewer(latest: string | null, current: string | null): boolean {
  if (!latest || !current || current === 'dev') return false;
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export class SerialConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'serial',
    label: 'USB Serial (ESP32)',
    icon: 'Usb',
  };

  baudRate: number;

  // ── Firmware version state ─────────────────────────────────────────────────
  firmwareVersion = ref<string | null>(null);
  latestVersion   = ref<string | null>(null);
  latestBinUrl    = ref<string | null>(null);
  isFlashing      = ref(false);
  flashProgress   = ref(0);
  updateAvailable = computed(() => isNewer(this.latestVersion.value, this.firmwareVersion.value));

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
      this.frameCount         = 0;
      this.cachedBpm          = -1;
      this.cachedLayout       = -1;
      this.cachedChannels     = -1;
      this.cachedEffects      = -1;
      this.firmwareVersion.value = null;
      this.startReadLoop();
      // Request firmware version immediately after connect
      this.send(buildVersionRequestPacket());
      this.fetchLatestVersion();
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

  async flashFirmware() {
    if (!this.port || !this.latestBinUrl.value || this.isFlashing.value) return;
    this.isFlashing.value  = true;
    this.flashProgress.value = 0;
    this.pushLog('[flash] starting firmware update...');
    try {
      // Release writer before esptool-js takes control of the port
      this.writer?.releaseLock();
      this.writer = null;
      this.readAbort?.abort();
      this.readAbort = null;

      const { ESPLoader, Transport } = await import('esptool-js');
      const transport = new Transport(this.port, false);
      const self = this;
      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
        enableTracing: false,
        terminal: {
          clean() {},
          writeLine(s: string) { self.pushLog(s); },
          write(s: string) { self.pushLog(s); },
        },
      });

      await loader.main();
      this.pushLog('[flash] connected to ESP32 bootloader');

      const binResp = await fetch(this.latestBinUrl.value);
      const binData = await binResp.arrayBuffer();
      // esptool-js expects base64-encoded binary
      const bytes = new Uint8Array(binData);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const b64 = btoa(binary);

      await loader.writeFlash({
        fileArray: [{ data: b64, address: 0x0 }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress(_idx: number, written: number, total: number) {
          self.flashProgress.value = Math.round((written / total) * 100);
          self.pushLog(`[flash] ${self.flashProgress.value}%`);
        },
      });

      await loader.softReset(false);  // soft reset, run user code
      await transport.disconnect();
      this.pushLog('[flash] done — rebooting ESP32');
    } catch (e: any) {
      this.pushLog(`[flash] error: ${e?.message ?? e}`);
    } finally {
      this.isFlashing.value = false;
      // Re-acquire writer for normal operation
      if (this.port?.writable) {
        try {
          this.writer = this.port.writable.getWriter();
        } catch (_) {}
      }
      // Re-start read loop to catch boot output (version line)
      this.firmwareVersion.value = null;
      this.startReadLoop();
    }
  }

  private async fetchLatestVersion() {
    try {
      const res  = await fetch('https://api.github.com/repos/fabian1606/pixelmapper/releases/latest');
      if (!res.ok) return;
      const data = await res.json();
      // Releases are tagged "v1.2.3" — strip the "v"
      this.latestVersion.value = (data.tag_name as string | undefined)?.replace(/^v/, '') ?? null;
      const asset = (data.assets as any[] | undefined)?.find((a: any) => a.name === 'firmware.bin');
      this.latestBinUrl.value  = asset?.browser_download_url ?? null;
    } catch (_) {
      // Non-fatal — no internet or no releases yet
    }
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
            if (!t) continue;
            // Parse firmware version from boot output or version request response
            const vMatch = t.match(/^\[version\]\s+(.+)$/);
            if (vMatch) {
              this.firmwareVersion.value = vMatch[1]!.trim();
            }
            this.pushLog(t);
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
