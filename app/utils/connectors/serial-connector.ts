import { ref, computed } from 'vue';
import { buildBpmPacket, buildTimesyncPacket, buildVersionRequestPacket, buildOtaBeginPacket, buildOtaChunkPacket, buildOtaEndPacket } from '~/utils/connectors/binary-encoder';
import { BaseConnector, type ConnectorMeta, type EngineConnectorState } from './base-connector';

// ── SerialConnector ───────────────────────────────────────────────────────────
// Forwards pre-built binary packets from the engine-store over USB serial.
// No encoding logic here — the store owns that.

function isNewer(latest: string | null, current: string | null): boolean {
  if (!latest || !current) return false;
  if (current === 'dev') return true; // dev build is always considered outdated when a release exists
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
  private readLoopDone: Promise<void> = Promise.resolve();

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
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate: this.baudRate });
      this.writer = this.port!.writable!.getWriter();
      // Reset caches so everything is sent fresh on first onEngineState call
      this.frameCount         = 0;
      this.cachedBpm          = -1;
      this.cachedLayout       = -1;
      this.cachedChannels     = -1;
      this.cachedEffects      = -1;
      this.firmwareVersion.value = null;
      this.startReadLoop();
      this.fetchLatestVersion();
      // Wait for ESP32 to finish booting (port.open may trigger reset via DTR/RTS).
      // Listen for [boot] message or timeout after 3s.
      await this.waitForBoot(3000);
      this.status.value = 'connected';
      this.pushLog('[serial] ESP32 ready — syncing engine state');
      // Send VERSION_REQ after a short additional delay
      setTimeout(() => {
        if (this.status.value === 'connected') {
          this.pushLog('[version] sending VERSION_REQ...');
          this.send(buildVersionRequestPacket());
        }
      }, 500);
    } catch (e: any) {
      this.status.value = 'error';
      this.errorMessage.value = e?.message ?? 'Connection failed';
    }
  }

  private waitForBoot(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        // Check if we've seen a [boot] or [version] line from the read loop
        const hasBootMessage = this.logs.some(l =>
          l.text.startsWith('[boot]') || l.text.startsWith('[version]')
        );
        if (hasBootMessage) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(check);
        this.pushLog('[serial] boot wait timed out — proceeding');
        resolve();
      }, timeoutMs);
    });
  }

  async disconnect() {
    this.readAbort?.abort();
    this.readAbort = null;
    await this.readLoopDone;
    try { this.writer?.releaseLock(); } catch (_) {}
    this.writer = null;
    try { await this.port?.close(); } catch (_) {}
    this.port   = null;
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** No-op — ESP32 renders its own DMX via the local Rust engine */
  sendFrame(_dmxBuffer: Uint8Array) {}

  override onEngineState(state: EngineConnectorState) {
    if (this.status.value !== 'connected' || !this.writer) return;

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
    if (this.isFlashing.value) return;
    if (!this.port) { this.pushLog('[flash] no port'); return; }
    if (!this.latestBinUrl.value) { this.pushLog('[flash] no bin URL — latest version not fetched yet'); return; }
    this.isFlashing.value  = true;
    this.flashProgress.value = 0;
    this.status.value = 'connecting'; // stop onEngineState from sending packets during flash
    this.pushLog('[flash] starting firmware update...');
    try {
      this.pushLog(`[flash] fetching v${this.latestVersion.value} from ${this.latestBinUrl.value}`);
      const binResp = await fetch(`/api/firmware-proxy?url=${encodeURIComponent(this.latestBinUrl.value)}`);
      if (!binResp.ok) throw new Error(`Firmware download failed: ${binResp.statusText}`);
      const binData = await binResp.arrayBuffer();
      const totalBytes = binData.byteLength;
      this.pushLog(`[flash] binary size: ${totalBytes} bytes`);

      // Begin OTA
      this.pushLog('[flash] starting native OTA update...');
      this.send(buildOtaBeginPacket(totalBytes));

      // Wait a moment for the ESP32 to erase the flash space
      await new Promise(r => setTimeout(r, 500));

      const bytes = new Uint8Array(binData);
      const CHUNK_SIZE = 2048; // 2KB chunks to easily fit in the ESP32's 8KB RX buffer
      let written = 0;

      while (written < totalBytes) {
        if (!this.isFlashing.value) throw new Error('Update cancelled by user');

        const end = Math.min(written + CHUNK_SIZE, totalBytes);
        const chunk = bytes.subarray(written, end);
        
        this.send(buildOtaChunkPacket(chunk));
        written = end;

        this.flashProgress.value = Math.round((written / totalBytes) * 100);
        this.pushLog(`[flash] sent chunk: ${written} / ${totalBytes} bytes (${this.flashProgress.value}%)`);

        // Give the ESP32 time to write the chunk to flash.
        // Update.write is blocking, so we need to pace ourselves.
        await new Promise(r => setTimeout(r, 30));
      }

      this.pushLog('[flash] sending OTA end...');
      this.send(buildOtaEndPacket());

      this.pushLog('[flash] done! ESP32 will reboot in 100ms...');
      
      // We don't need to close/reopen the port. The ESP32 restart will 
      // cause the OS to drop the USB connection and we can handle it seamlessly.
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.pushLog(`[flash] error: ${msg}`);
      this.errorMessage.value = `Flash failed: ${msg}`;
    } finally {
      this.isFlashing.value = false;
    }
  }

  private async fetchLatestVersion() {
    try {
      const res  = await fetch('https://api.github.com/repos/fabian1606/pixelmapper/releases/latest');
      if (!res.ok) {
        this.pushLog(`[version] fetch failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      this.latestVersion.value = (data.tag_name as string | undefined)?.replace(/^v/, '') ?? null;
      const asset = (data.assets as any[] | undefined)?.find((a: any) => a.name === 'firmware.bin');
      this.latestBinUrl.value  = asset?.browser_download_url ?? null;
      this.pushLog(`[ota] latest=${this.latestVersion.value ?? 'none'} binUrl=${this.latestBinUrl.value ? 'ok' : 'missing'}`);
    } catch (e: any) {
      this.pushLog(`[version] fetch error: ${e?.message ?? e}`);
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
      const textDecoder = new TextDecoder();
      const reader = port.readable!.getReader();
      const onAbort = () => reader.cancel().catch(() => {});
      this.readAbort!.signal.addEventListener('abort', onAbort);
      let partial = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { console.log('[serial] reader done'); break; }
          console.log('[serial] rx bytes:', value?.length);
          partial += textDecoder.decode(value, { stream: true });
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trimEnd();
            if (!t) continue;
            const vMatch = t.match(/^\[version\]\s+([\w.\-]+)$/);
            if (vMatch) {
              this.firmwareVersion.value = vMatch[1]!.trim();
              this.pushLog(`[version] parsed: ${this.firmwareVersion.value}`);
            }
            this.pushLog(t);
          }
        }
      } catch (_) {
      } finally {
        this.readAbort?.signal.removeEventListener('abort', onAbort);
        reader.releaseLock();
      }
    };

    this.readLoopDone = run();
  }

  override getConfig() {
    return { baudRate: this.baudRate };
  }
}
