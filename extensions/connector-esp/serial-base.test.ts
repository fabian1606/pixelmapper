/**
 * Serial plumbing on the platform serial contract (ADR 0003): boot wait,
 * line splitting across chunks, writes, drops and the no-serial message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Platform, SerialApi, SerialEvents, SerialPortHandle, SharedGlobals } from '@pixelmapper/extension-api';
import { SerialPortConnector } from './serial-base';

/** Minimal concrete connector recording received lines. */
class TestSerialConnector extends SerialPortConnector {
  readonly meta = { type: 'test-serial', label: 'Test', icon: 'usb' };
  protected readonly tag = 'test';
  protected readonly bootMarkers = ['[boot]'];
  lines: string[] = [];
  protected override onLine(line: string) { this.lines.push(line); }
  write(bytes: number[]) { this.send(new Uint8Array(bytes)); }
}

/** Installs a host stub that only provides `platform`. */
function stubPlatform(serial: SerialApi | null) {
  const platform: Platform = { kind: 'web', serial, midi: null, artnetBridge: null };
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { platform } as unknown as SharedGlobals['api'] };
}

/** Fake serial port; `boot` text is delivered right after opening. */
function fakeSerial(boot: string) {
  let events: SerialEvents | null = null;
  const written: number[][] = [];
  const close = vi.fn(async () => {});
  const api: SerialApi = {
    // Explicit return type: `vi.fn` drops the contextual typing of `open`'s parameters.
    requestPort: vi.fn(async (): Promise<SerialPortHandle> => ({
      open: async (_opts, ev) => {
        events = ev;
        // Like real hardware, data arrives in a later task (after connect() armed the boot wait).
        setTimeout(() => ev.onData(new TextEncoder().encode(boot)), 0);
        return { write: async (d) => { written.push([...d]); }, close };
      },
    })),
  };
  return { api, written, close, emit: (text: string) => events?.onData(new TextEncoder().encode(text)), drop: () => events?.onDrop(new Error('unplugged')) };
}

afterEach(() => {
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
});

describe('SerialPortConnector', () => {
  it('waits for the boot marker, splits lines across chunks and writes', async () => {
    const serial = fakeSerial('[boot] ok\nhel');
    stubPlatform(serial.api);
    const c = new TestSerialConnector('s1', 115200);
    await c.connect();
    expect(c.status.value).toBe('connected');
    serial.emit('lo\r\nworld\n');
    expect(c.lines).toEqual(['[boot] ok', 'hello', 'world']);
    c.write([1, 2]);
    expect(serial.written).toEqual([[1, 2]]);
  });

  it('retries after a drop and stops on disconnect', async () => {
    const serial = fakeSerial('[boot]\n');
    stubPlatform(serial.api);
    const c = new TestSerialConnector('s2', 115200);
    await c.connect();
    serial.drop();
    expect(c.status.value).toBe('connecting');
    expect(c.errorMessage.value).toBe('unplugged');
    await c.disconnect();
    expect(c.status.value).toBe('disconnected');
    expect(serial.close).toHaveBeenCalled();
  });

  it('explains when the platform has no serial ports', async () => {
    stubPlatform(null);
    const c = new TestSerialConnector('s3', 115200);
    await c.connect();
    expect(c.status.value).toBe('error');
    expect(c.errorMessage.value).toMatch(/desktop app/);
  });
});
