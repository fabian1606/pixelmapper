/**
 * Platform selection of the shared backend: the desktop app's built-in
 * bridge when the platform provides `artnetBridge`, else a WebSocket to the
 * bridge URL (browser).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtNetBridgeApi, Platform, SharedGlobals } from '@pixelmapper/extension-api';
import { DEFAULT_BRIDGE_URL, getArtNetBackend, installArtNetBackend, usesBuiltInBridge } from './shared';
import { IN_PROCESS_BRIDGE_LABEL } from './in-process-transport';
import { FakeInProcessBridge } from './testing/fake-in-process-bridge';
import { FakeBridgeSocket } from './testing/fake-socket';
import { backendProblem } from '../node/node-status';

/** Installs a host stub that only provides `platform`. */
function stubPlatform(artnetBridge: ArtNetBridgeApi | null) {
  const platform: Platform = { kind: artnetBridge ? 'tauri' : 'web', udp: null, serial: null, midi: null, artnetBridge };
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { platform } as unknown as SharedGlobals['api'] };
}

afterEach(() => {
  installArtNetBackend(null);
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
  vi.unstubAllGlobals();
  FakeBridgeSocket.instances = [];
});

describe('getArtNetBackend — platform selection', () => {
  it('uses the built-in bridge when the platform provides one', () => {
    const api = new FakeInProcessBridge();
    stubPlatform(api);
    vi.stubGlobal('WebSocket', FakeBridgeSocket);
    expect(usesBuiltInBridge()).toBe(true);
    const backend = getArtNetBackend();
    backend.start();
    expect(api.sessions).toHaveLength(1);
    expect(FakeBridgeSocket.instances).toHaveLength(0);
    expect(backend.state.value).toEqual({ kind: 'connecting', url: IN_PROCESS_BRIDGE_LABEL });
  });

  it('uses a WebSocket to the bridge URL otherwise', () => {
    stubPlatform(null);
    vi.stubGlobal('WebSocket', FakeBridgeSocket);
    expect(usesBuiltInBridge()).toBe(false);
    getArtNetBackend().start();
    expect(FakeBridgeSocket.last.url).toBe(DEFAULT_BRIDGE_URL);
  });

  it('falls back to WebSocket without a host (tests, old hosts)', () => {
    expect(usesBuiltInBridge()).toBe(false);
  });
});

describe('backendProblem — hint texts', () => {
  const unreachable = { kind: 'unreachable', url: DEFAULT_BRIDGE_URL, attempts: 1, retryInMs: 1000 } as const;

  it('tells browser users to start pmnet-bridge', () => {
    expect(backendProblem(unreachable, false)).toMatch(/pmnet-bridge serve/);
  });

  it('never mentions pmnet-bridge for the built-in bridge', () => {
    expect(backendProblem(unreachable, true)).toBe('The built-in Art-Net bridge could not start — retrying');
    const noHello = { kind: 'incompatible', url: IN_PROCESS_BRIDGE_LABEL, reason: 'noHello', bridgeVersion: null, protocol: null } as const;
    expect(backendProblem(noHello, true)).not.toMatch(/pmnet-bridge/);
  });
});
