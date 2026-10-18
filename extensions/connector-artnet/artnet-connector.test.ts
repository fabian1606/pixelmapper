/**
 * ArtNet connector transports (ADR 0003): direct UDP when the platform has
 * it, the WebSocket bridge otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Platform, SharedGlobals, UdpApi } from '@pixelmapper/extension-api';
import { ArtNetConnector } from './artnet-connector';

/** Installs a host stub that only provides `platform`. */
function stubPlatform(udp: UdpApi | null) {
  const platform: Platform = { kind: udp ? 'tauri' : 'web', udp, serial: null, midi: null };
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { platform } as unknown as SharedGlobals['api'] };
}

/** Fake UDP access recording every datagram. */
function fakeUdp() {
  const sent: { data: Uint8Array; host: string; port: number }[] = [];
  const close = vi.fn(async () => {});
  const bind = vi.fn(async () => ({ send: (data: Uint8Array, host: string, port: number) => { sent.push({ data, host, port }); }, close }));
  return { api: { bind } satisfies UdpApi, sent, close, bind };
}

afterEach(() => {
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
  vi.unstubAllGlobals();
});

describe('ArtNetConnector — direct UDP', () => {
  it('connects without a bridge and sends ArtDMX to the target', async () => {
    const udp = fakeUdp();
    stubPlatform(udp.api);
    const c = ArtNetConnector.fromConfig('a1', { targetIp: '2.0.0.10', artnetPort: 6455, bridgeUrl: '' });
    expect(c.directUdp).toBe(true);
    expect(c.alwaysConnected()).toBe(true);
    expect(c.canAutoConnect()).toBe(true);

    await c.connect();
    expect(c.status.value).toBe('connected');
    expect(udp.bind).toHaveBeenCalledWith({ broadcast: true });

    c.sendFrame(new Uint8Array([255, 128]), 2);
    expect(udp.sent).toHaveLength(1);
    const { data, host, port } = udp.sent[0]!;
    expect([host, port]).toEqual(['2.0.0.10', 6455]);
    expect(data[14]).toBe(1); // U2 → port-address 1
    expect(data[12]).toBe(1); // first sequence number
    expect([data[18], data[19]]).toEqual([255, 128]);

    await c.disconnect();
    expect(udp.close).toHaveBeenCalled();
    expect(c.status.value).toBe('disconnected');
  });

  it('ignores invalid universes', async () => {
    const udp = fakeUdp();
    stubPlatform(udp.api);
    const c = new ArtNetConnector('a2');
    await c.connect();
    c.sendFrame(new Uint8Array(512), 0);
    c.sendFrame(new Uint8Array(512));
    expect(udp.sent).toHaveLength(0);
  });

  it('settles in error when the socket cannot be opened', async () => {
    stubPlatform({ bind: async () => { throw new Error('EACCES'); } });
    const c = new ArtNetConnector('a3');
    await c.connect();
    expect(c.status.value).toBe('error');
    expect(c.errorMessage.value).toBe('EACCES');
  });
});

describe('ArtNetConnector — bridge fallback', () => {
  it('uses the WebSocket bridge when the platform has no UDP', async () => {
    stubPlatform(null);
    const urls: string[] = [];
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      readyState = 0;
      constructor(url: string) { urls.push(url); }
      addEventListener() {}
      close() {}
    });
    const c = new ArtNetConnector('b1');
    expect(c.directUdp).toBe(false);
    expect(c.alwaysConnected()).toBe(false);
    await c.connect();
    expect(urls).toEqual(['ws://localhost:7777']);
    expect(c.status.value).toBe('connecting');
    await c.disconnect();
  });
});
