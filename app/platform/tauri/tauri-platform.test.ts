/**
 * Tauri platform (ADR 0003): web platform plus native UDP over `invoke`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { createPlatform } = await import('./index');

beforeEach(() => {
  invoke.mockReset();
});

describe('Tauri platform', () => {
  it('reports kind tauri and provides UDP', () => {
    const p = createPlatform();
    expect(p.kind).toBe('tauri');
    expect(p.udp).not.toBeNull();
  });

  it('binds, sends raw bytes with target headers, and closes', async () => {
    invoke.mockResolvedValueOnce(7);
    const socket = await createPlatform().udp!.bind({ broadcast: true });
    expect(invoke).toHaveBeenLastCalledWith('udp_bind', { port: 0, broadcast: true });

    invoke.mockResolvedValue(undefined);
    const data = new Uint8Array([1, 2, 3]);
    socket.send(data, '2.255.255.255', 6454);
    expect(invoke).toHaveBeenLastCalledWith('udp_send', data, {
      headers: { 'x-socket': '7', 'x-host': '2.255.255.255', 'x-port': '6454' },
    });

    await socket.close();
    expect(invoke).toHaveBeenLastCalledWith('udp_close', { id: 7 });
    invoke.mockClear();
    socket.send(data, '2.255.255.255', 6454);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('logs only the first failed send', async () => {
    invoke.mockResolvedValueOnce(1);
    const socket = await createPlatform().udp!.bind();
    invoke.mockRejectedValue('network unreachable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    socket.send(new Uint8Array(1), '10.0.0.1', 6454);
    socket.send(new Uint8Array(1), '10.0.0.1', 6454);
    await new Promise(r => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
