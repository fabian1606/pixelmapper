/**
 * Firmware offer of the USB serial connector: the bundled copy is offered
 * immediately, a slow release check only upgrades it later.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Platform, SharedGlobals } from '@pixelmapper/extension-api';
import { EspSerialConnector } from './serial-connector';

const META = new TextEncoder().encode(JSON.stringify({ version: '0.1.0' }));

/** Installs a desktop-like host with a bundled firmware. */
function stubDesktop() {
  const platform: Platform = {
    kind: 'tauri', artnetBridge: null, serial: null, midi: null,
    http: { getBytes: async () => new Uint8Array([1]) },
    resources: { read: async path => (path.endsWith('meta.json') ? META : new Uint8Array([1])) },
  };
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { platform } as unknown as SharedGlobals['api'] };
}

/** Lets pending microtasks (bundled read) run. */
const flush = () => new Promise(r => setTimeout(r, 0));

/** Calls the private release check. */
const check = (c: EspSerialConnector) => (c as unknown as { fetchLatestVersion(): Promise<void> }).fetchLatestVersion();

afterEach(() => { vi.unstubAllGlobals(); });

describe('EspSerialConnector firmware offer', () => {
  it('offers the bundled firmware before the release check settles, then upgrades', async () => {
    stubDesktop();
    let answer: (res: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    const c = new EspSerialConnector('t');
    const done = check(c);
    await flush();
    expect(c.latestFirmware.value?.origin).toBe('bundled');
    expect(c.latestVersion.value).toBe('0.1.0');

    answer(new Response(JSON.stringify({
      tag_name: 'v0.2.0',
      assets: [{ name: 'firmware.bin', browser_download_url: 'https://github.com/x/firmware.bin' }],
    })));
    await done;
    expect(c.latestFirmware.value?.origin).toBe('github');
    expect(c.latestVersion.value).toBe('0.2.0');
  });

  it('keeps the bundled firmware when the release check fails', async () => {
    stubDesktop();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const c = new EspSerialConnector('t');
    await check(c);
    expect(c.latestFirmware.value?.origin).toBe('bundled');
  });
});
