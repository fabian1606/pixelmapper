/**
 * Firmware sources (ADR 0004 D19): bundled copy offline, newer GitHub
 * release when reachable, native download on the desktop, proxy on the web.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '@pixelmapper/extension-api';
import { fetchLatestRelease, pickFirmware, readBundledFirmware, type FirmwareCandidate } from './firmware-source';

const BIN = new Uint8Array([1, 2, 3]);

/** Desktop-like platform with bundled files and native HTTP. */
function desktop(files: Record<string, Uint8Array>, getBytes = vi.fn(async () => BIN)): Platform {
  return {
    kind: 'tauri', udp: null, serial: null, midi: null,
    http: { getBytes },
    resources: { read: async path => files[path] ?? null },
  };
}

const WEB: Platform = { kind: 'web', udp: null, serial: null, midi: null };

/** A release feed answer. */
const release = (tag: string) => new Response(JSON.stringify({
  tag_name: tag,
  assets: [{ name: 'firmware.bin', browser_download_url: 'https://github.com/x/releases/download/a/firmware.bin' }],
}));

/** Candidate stub for `pickFirmware`. */
const cand = (version: string, origin: FirmwareCandidate['origin']): FirmwareCandidate => ({ version, origin, load: async () => BIN });

describe('firmware sources', () => {
  it('reads the bundled firmware and its version', async () => {
    const meta = new TextEncoder().encode(JSON.stringify({ version: '0.1.27' }));
    const fw = await readBundledFirmware(desktop({ 'firmware/firmware-meta.json': meta, 'firmware/firmware.bin': BIN }));
    expect(fw?.version).toBe('0.1.27');
    expect(await fw?.load()).toEqual(BIN);
    expect(await readBundledFirmware(desktop({}))).toBeNull();
    expect(await readBundledFirmware(WEB)).toBeNull();
  });

  it('downloads natively on the desktop and via the proxy on the web', async () => {
    const getBytes = vi.fn(async () => BIN);
    const native = await fetchLatestRelease(desktop({}, getBytes), async () => release('v0.2.0'));
    expect(native?.version).toBe('0.2.0');
    await native?.load();
    expect(getBytes).toHaveBeenCalledWith('https://github.com/x/releases/download/a/firmware.bin');

    const fetchFn = vi.fn(async (url: string) => url.startsWith('/api/') ? new Response(BIN) : release('v0.2.0'));
    const web = await fetchLatestRelease(WEB, fetchFn as unknown as typeof fetch);
    expect(await web?.load()).toEqual(BIN);
    expect(fetchFn).toHaveBeenLastCalledWith(expect.stringMatching(/^\/api\/firmware-proxy\?url=/));
  });

  it('prefers the newer firmware and the bundled copy on ties', () => {
    expect(pickFirmware(cand('0.1.0', 'bundled'), cand('0.2.0', 'github'))?.origin).toBe('github');
    expect(pickFirmware(cand('0.2.0', 'bundled'), cand('0.2.0', 'github'))?.origin).toBe('bundled');
    expect(pickFirmware(cand('0.2.0', 'bundled'), null)?.origin).toBe('bundled');
    expect(pickFirmware(null, null)).toBeNull();
  });
});
