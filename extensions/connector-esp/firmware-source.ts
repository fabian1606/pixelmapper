/**
 * Where the USB serial node's firmware comes from (ADR 0004 D19).
 *
 * - Bundled: the desktop app ships the `firmware.bin` matching its release
 *   (`platform.resources`, written by `scripts/tauri/firmware-bundle.ts`).
 *   Works offline.
 * - GitHub: the latest release. Desktop downloads it natively
 *   (`platform.http`, no CORS); the web goes through the Nitro proxy
 *   `/api/firmware-proxy`.
 *
 * The newest available candidate wins; on equal versions the bundled copy
 * is preferred (no download needed). Access goes through the platform
 * contract only (ADR 0003 D3), so this works in prebuilt bundles too.
 */
import type { Platform } from '@pixelmapper/extension-api';

/** Release feed of the firmware. */
export const RELEASES_URL = 'https://api.github.com/repos/fabian1606/pixelmapper/releases/latest';
/** Bundled firmware paths inside the app resources. */
const BUNDLED_BIN = 'firmware/firmware.bin';
const BUNDLED_META = 'firmware/firmware-meta.json';

/** One flashable firmware. */
export interface FirmwareCandidate {
  /** Semver without `v` (`dev` for local builds). */
  version: string;
  origin: 'bundled' | 'github';
  /** Loads the binary (bundled: from disk; github: downloads it). */
  load(): Promise<Uint8Array>;
}

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

/** The firmware bundled with the app, or `null` (web, or built without one). */
export async function readBundledFirmware(platform: Platform): Promise<FirmwareCandidate | null> {
  const resources = platform.resources ?? null;
  if (!resources) return null;
  const metaBytes = await resources.read(BUNDLED_META);
  if (!metaBytes) return null;
  const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as { version?: string };
  if (!meta.version) return null;
  return {
    version: meta.version,
    origin: 'bundled',
    async load() {
      const bin = await resources.read(BUNDLED_BIN);
      if (!bin) throw new Error('Bundled firmware is missing');
      return bin;
    },
  };
}

/**
 * The latest GitHub release, or `null` when unknown (offline, no asset).
 * Throws on network failures so the caller can log them.
 */
export async function fetchLatestRelease(platform: Platform, fetchFn: typeof fetch = fetch): Promise<FirmwareCandidate | null> {
  const res = await fetchFn(RELEASES_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
  const version = data.tag_name?.replace(/^v/, '');
  const url = data.assets?.find(a => a.name === 'firmware.bin')?.browser_download_url;
  if (!version || !url) return null;
  const http = platform.http ?? null;
  return {
    version,
    origin: 'github',
    async load() {
      // Desktop: native download. Web: GitHub assets lack CORS → Nitro proxy.
      if (http) return await http.getBytes(url);
      const proxied = await fetchFn(`/api/firmware-proxy?url=${encodeURIComponent(url)}`);
      if (!proxied.ok) throw new Error(`Firmware download failed: ${proxied.statusText}`);
      return new Uint8Array(await proxied.arrayBuffer());
    },
  };
}

/** Picks the firmware to offer: the newer one, the bundled copy on ties. */
export function pickFirmware(
  bundled: FirmwareCandidate | null,
  remote: FirmwareCandidate | null,
): FirmwareCandidate | null {
  if (!remote) return bundled;
  if (!bundled) return remote;
  return isNewer(remote.version, bundled.version) ? remote : bundled;
}
