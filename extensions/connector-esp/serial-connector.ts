/**
 * USB serial DMX node (ESP32): streams rendered universes (plan P6.2 —
 * no on-device rendering any more) and updates its firmware over the same
 * port (native OTA packets).
 */
import { computed, ref } from 'vue';
import { SerialPortConnector } from './serial-base';
import { dmxFrame, otaBegin, otaChunk, otaEnd, universeMap, versionRequest } from './protocol';

/** Release feed of the firmware. */
const RELEASES_URL = 'https://api.github.com/repos/fabian1606/pixelmapper/releases/latest';
/** OTA chunk size (fits the device's 8 KB RX buffer). */
const OTA_CHUNK = 2048;

/** True when `latest` is a newer semver than `current` (`dev` is always outdated). */
export function isNewer(latest: string | null, current: string | null): boolean {
  if (!latest || !current) return false;
  if (current === 'dev') return true;
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export class EspSerialConnector extends SerialPortConnector {
  readonly meta = { type: 'serial', label: 'USB Serial (ESP32)', icon: 'usb' };
  protected readonly tag = 'serial';
  protected readonly bootMarkers = ['[boot]', '[version]'];

  firmwareVersion = ref<string | null>(null);
  latestVersion = ref<string | null>(null);
  latestBinUrl = ref<string | null>(null);
  isFlashing = ref(false);
  flashProgress = ref(0);
  updateAvailable = computed(() => isNewer(this.latestVersion.value, this.firmwareVersion.value));

  /** Universe map last sent (resent when the mapping changes). */
  private sentUniverseMap = '';

  constructor(id: string, baudRate = 921600) {
    super(id, baudRate);
    this.initOutputs(8);
  }

  protected override onOpen(): void {
    this.sentUniverseMap = '';
    this.firmwareVersion.value = null;
    void this.fetchLatestVersion();
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

  /** One rendered universe per mapped output. */
  override sendFrame(dmxBuffer: Uint8Array, universe?: number): void {
    if (this.status.value !== 'connected' || this.isFlashing.value || !universe) return;
    const key = this.outputMapping.value.join(',');
    if (key !== this.sentUniverseMap) {
      this.send(universeMap(this.getActiveUniverses()));
      this.sentUniverseMap = key;
    }
    this.send(dmxFrame(universe, dmxBuffer));
  }

  override getConfig(): Record<string, unknown> {
    return { ...super.getConfig(), baudRate: this.baudRate };
  }

  override applyConfig(config: Record<string, unknown>): void {
    super.applyConfig(config);
    if (typeof config.baudRate === 'number') this.baudRate = config.baudRate;
  }

  /** Restores an instance from a stored config. */
  static fromConfig(id: string, config: Record<string, unknown>): EspSerialConnector {
    const c = new EspSerialConnector(id, Number(config.baudRate ?? 921600));
    c.applyConfig(config);
    return c;
  }

  // ── Firmware ───────────────────────────────────

  /** Downloads the latest release and flashes it over OTA. */
  async flashFirmware(): Promise<void> {
    if (this.isFlashing.value || !this.writable) return;
    if (!this.latestBinUrl.value) { this.pushLog('[flash] latest version unknown'); return; }
    this.isFlashing.value = true;
    this.flashProgress.value = 0;
    this.pushLog(`[flash] fetching v${this.latestVersion.value}`);
    try {
      const res = await fetch(`/api/firmware-proxy?url=${encodeURIComponent(this.latestBinUrl.value)}`);
      if (!res.ok) throw new Error(`Firmware download failed: ${res.statusText}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Begin (the device erases its partition first — can take seconds).
      const begun = this.waitForLine(l => l.includes('[ota] begin'), 10000);
      this.send(otaBegin(bytes.length));
      await begun;
      for (let written = 0; written < bytes.length;) {
        if (!this.isFlashing.value) throw new Error('Update cancelled');
        const end = Math.min(written + OTA_CHUNK, bytes.length);
        const acked = this.waitForLine(l => l.includes('[ota] chunk'), 5000);
        this.send(otaChunk(bytes.subarray(written, end)));
        written = end;
        this.flashProgress.value = Math.round((written / bytes.length) * 100);
        await acked;
      }
      this.send(otaEnd());
      this.firmwareVersion.value = null;
      await this.waitForLine(l => l.startsWith('[version]'), 8000);
      this.sentUniverseMap = '';
      this.pushLog(`[flash] update complete — running v${this.firmwareVersion.value}`);
    }
    catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      this.pushLog(`[flash] error: ${msg}`);
      this.errorMessage.value = `Flash failed: ${msg}`;
    }
    finally {
      this.isFlashing.value = false;
    }
  }

  /** Reads the latest release version and binary URL. */
  private async fetchLatestVersion(): Promise<void> {
    try {
      const res = await fetch(RELEASES_URL);
      if (!res.ok) return this.pushLog(`[version] fetch failed: HTTP ${res.status}`);
      const data = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
      this.latestVersion.value = data.tag_name?.replace(/^v/, '') ?? null;
      this.latestBinUrl.value = data.assets?.find(a => a.name === 'firmware.bin')?.browser_download_url ?? null;
    }
    catch (e) {
      this.pushLog(`[version] fetch error: ${(e as Error)?.message ?? e}`);
    }
  }
}
