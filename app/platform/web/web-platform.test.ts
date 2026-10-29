/**
 * Web platform (ADR 0003): capabilities follow the browser, and the Web
 * Serial / Web MIDI adapters translate to the transport-shaped contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake Web Serial port whose reader yields the given chunks, then ends. */
function fakeSerialPort(chunks: Uint8Array[], opts: { endsWithDrop: boolean }) {
  const written: Uint8Array[] = [];
  let pending: ((r: { value?: Uint8Array; done: boolean }) => void) | null = null;
  const queue = [...chunks];
  const reader = {
    read: () => new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => {
      const next = queue.shift();
      if (next) resolve({ value: next, done: false });
      else if (opts.endsWithDrop) resolve({ done: true });
      else pending = resolve;
    }),
    cancel: async () => { pending?.({ done: true }); },
    releaseLock: () => {},
  };
  const port = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    readable: { getReader: () => reader },
    writable: { getWriter: () => ({ write: async (d: Uint8Array) => { written.push(d); }, releaseLock: () => {} }) },
  };
  return { port, written };
}

describe('createWebPlatform', () => {
  it('has no built-in Art-Net bridge and no serial/MIDI without browser support', () => {
    vi.stubGlobal('navigator', {});
    const p = createWebPlatform();
    expect(p.kind).toBe('web');
    expect(p.artnetBridge).toBeNull();
    expect(p.serial).toBeNull();
    expect(p.midi).toBeNull();
  });

  it('forwards serial data, writes, and reports a drop', async () => {
    const { port, written } = fakeSerialPort([new Uint8Array([104, 105])], { endsWithDrop: true });
    vi.stubGlobal('navigator', { serial: { requestPort: async () => port } });
    const serial = createWebPlatform().serial!;
    const handle = await serial.requestPort();

    const data: number[][] = [];
    const drop = new Promise<Error>((resolve) => {
      void handle.open({ baudRate: 115200 }, { onData: c => data.push([...c]), onDrop: resolve }).then(conn => conn.write(new Uint8Array([1])));
    });
    expect((await drop).message).toBe('Serial port closed');
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(data).toEqual([[104, 105]]);
    expect(written).toEqual([new Uint8Array([1])]);
  });

  it('does not report a drop after close()', async () => {
    const { port } = fakeSerialPort([], { endsWithDrop: false });
    vi.stubGlobal('navigator', { serial: { requestPort: async () => port } });
    const handle = await createWebPlatform().serial!.requestPort();
    const onDrop = vi.fn();
    const conn = await handle.open({ baudRate: 9600 }, { onData: () => {}, onDrop });
    await conn.close();
    expect(onDrop).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalled();
  });

  it('wraps Web MIDI ports, messages and state changes', async () => {
    const input = Object.assign(new EventTarget(), { id: 'in1', name: 'APC mini mk2', manufacturer: 'AKAI', type: 'input' });
    const sent: number[][] = [];
    const output = { id: 'out1', name: 'APC mini mk2', send: (d: number[]) => sent.push(d) };
    const access = Object.assign(new EventTarget(), { inputs: new Map([['in1', input]]), outputs: new Map([['out1', output]]) });
    const requestMIDIAccess = vi.fn(async () => access);
    vi.stubGlobal('navigator', { requestMIDIAccess });

    const handle = await createWebPlatform().midi!.requestAccess({ sysex: true });
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: true });
    const [inPort] = handle.inputs();
    const [outPort] = handle.outputs();
    expect(inPort!.name).toBe('APC mini mk2');

    const messages: number[][] = [];
    const off = inPort!.onMessage(d => messages.push([...d]));
    input.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array([0x90, 1, 127]) }));
    off();
    input.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array([0x80, 1, 0]) }));
    expect(messages).toEqual([[0x90, 1, 127]]);

    outPort!.send([0x96, 100, 3]);
    expect(sent).toEqual([[0x96, 100, 3]]);

    const changes: unknown[] = [];
    handle.onStateChange(c => changes.push(c));
    access.dispatchEvent(Object.assign(new Event('statechange'), { port: { id: 'in1', name: 'APC mini mk2', manufacturer: 'AKAI', type: 'input', state: 'disconnected' } }));
    expect(changes).toEqual([{ port: { id: 'in1', name: 'APC mini mk2', manufacturer: 'AKAI' }, direction: 'input', state: 'disconnected' }]);
  });
});
