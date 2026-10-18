/**
 * USB serial DMX node (ESP32): streams rendered universes (plan P6.2 —
 * no on-device rendering any more) and updates its firmware over the same
 * port (native OTA packets). The firmware comes from the app bundle
 * (desktop, offline) or the latest GitHub release (see `firmware-source.ts`).
 */
import { computed, ref, shallowRef } from 'vue';
import { getPlatform } from '@pixelmapper/extension-api';
import { SerialPortConnector } from './serial-base';
import { dmxFrame, otaBegin, otaChunk, otaEnd, universeMap, versionRequest } from './protocol';
import {
  fetchLatestRelease, isNewer, pickFirmware, readBundledFirmware, type FirmwareCandidate,
} from './firmware-source';

export { isNewer };

/** OTA chunk size (fits the device's 8 KB RX buffer). */
const OTA_CHUNK = 2048;

export class EspSerialConnector extends SerialPortConnector {
  readonly meta = { type: 'serial', label: 'USB Serial (ESP32)', icon: 'usb' };
  protected readonly tag = 'serial';
  protected readonly bootMarkers = ['[boot]', '[version]'];

  firmwareVersion = ref<string | null>(null);
  latestVersion = ref<string | null>(null);
  /** Firmware offered for flashing (newest of bundled / GitHub), `null` if none. */
  latestFirmware = shallowRef<FirmwareCandidate | null>(null);
  /** Bundled fallback when a GitHub download fails (desktop only). */
  private bundledFirmware: FirmwareCandidate | null = null;
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

  /** Loads the offered firmware (bundled or downloaded) and flashes it over OTA. */
  async flashFirmware(): Promise<void> {
    if (this.isFlashing.value || !this.writable) return;
    const firmware = this.latestFirmware.value;
    if (!firmware) { this.pushLog('[flash] no firmware available'); return; }
    this.isFlashing.value = true;
    this.flashProgress.value = 0;
    try {
      const bytes = await this.loadFirmware(firmware);
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

  /**
   * Loads the binary; a failed GitHub download falls back to the bundled
   * firmware (desktop, e.g. when the connection dropped meanwhile).
   */
  private async loadFirmware(firmware: FirmwareCandidate): Promise<Uint8Array> {
    this.pushLog(`[flash] loading v${firmware.version} (${firmware.origin})`);
    try {
      return await firmware.load();
    }
    catch (e) {
      const fallback = this.bundledFirmware;
      if (firmware.origin !== 'github' || !fallback) throw e;
      this.pushLog(`[flash] download failed (${(e as Error)?.message ?? e}) — using bundled v${fallback.version}`);
      this.latestFirmware.value = fallback;
      this.latestVersion.value = fallback.version;
      return await fallback.load();
    }
  }

  /**
   * Determines the firmware to offer: the bundled copy (offline) and, when
   * reachable, the latest GitHub release — whichever is newer.
   */
  private async fetchLatestVersion(): Promise<void> {
    const platform = getPlatform();
    try {
      this.bundledFirmware = await readBundledFirmware(platform);
    }
    catch (e) {
      this.pushLog(`[version] bundled firmware unreadable: ${(e as Error)?.message ?? e}`);
    }
    let remote: FirmwareCandidate | null = null;
    try {
      remote = await fetchLatestRelease(platform);
    }
    catch (e) {
      // Offline is normal on the desktop; the bundled firmware still works.
      this.pushLog(`[version] release check failed: ${(e as Error)?.message ?? e}`);
    }
    const picked = pickFirmware(this.bundledFirmware, remote);
    this.latestFirmware.value = picked;
    this.latestVersion.value = picked?.version ?? null;
  }
}
