/**
 * Bridge client (plan M5.1): handshake and version check, reconnect with
 * backoff, command correlation, events, poll targets and DMX frame sets —
 * against a fake bridge socket (contract: architecture/artnet-bridge-ws-protocol.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeCommandError } from './backend';
import { WsBridgeBackend, type WebSocketFactory } from './ws-bridge-backend';
import { FakeBridgeSocket } from './testing/fake-socket';
import { makeNode } from './testing/fixtures';

/** A backend wired to the fake socket. */
function makeBackend(unsupported: string | null = null) {
  return new WsBridgeBackend({
    url: () => 'ws://127.0.0.1:7777',
    clientVersion: '9.9.9',
    unsupportedReason: () => unsupported,
    WebSocketImpl: FakeBridgeSocket as unknown as WebSocketFactory,
  });
}

/** Lets queued microtasks (frame-set flush, promise callbacks) run. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

beforeEach(() => {
  FakeBridgeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WsBridgeBackend — handshake', () => {
  it('connects after the bridge hello and the client hello', async () => {
    const b = makeBackend();
    b.start();
    expect(b.state.value).toEqual({ kind: 'connecting', url: 'ws://127.0.0.1:7777' });
    const s = FakeBridgeSocket.last;
    s.open();
    s.receive({ type: 'hello', bridge: '0.1.0', protocol: '1.2.0', interfaces: [{ name: 'en7', ip: '2.0.0.1', mask: '255.0.0.0', mac: null }], udp: { bound: true, port: 6454, error: null } });
    expect(s.command('hello')).toMatchObject({ client: 'pixelmapper', clientVersion: '9.9.9', protocol: '1.0.0' });
    expect(b.state.value.kind).toBe('connecting');
    s.answer('hello');
    await tick();
    const state = b.state.value;
    expect(state.kind).toBe('connected');
    if (state.kind === 'connected') expect(state.info).toMatchObject({ bridgeVersion: '0.1.0', protocol: '1.2.0', udp: { bound: true } });
    b.stop();
    expect(s.closed).toBe(true);
    expect(b.state.value.kind).toBe('idle');
  });

  it.each([
    ['2.0.0', 'appTooOld'],
    ['0.9.0', 'bridgeTooOld'],
  ])('reports protocol %s as %s and retries slowly', async (protocol, reason) => {
    vi.useFakeTimers();
    const b = makeBackend();
    b.start();
    const s = FakeBridgeSocket.last;
    s.open();
    s.receive({ type: 'hello', bridge: '0.5.0', protocol, interfaces: [], udp: { bound: true, port: 6454, error: null } });
    expect(b.state.value).toMatchObject({ kind: 'incompatible', reason, protocol, bridgeVersion: '0.5.0' });
    expect(s.closed).toBe(true);
    expect(s.command('hello')).toBeUndefined();
    vi.advanceTimersByTime(30_000);
    expect(FakeBridgeSocket.instances).toHaveLength(2);
    expect(b.state.value.kind).toBe('incompatible'); // kept while retrying
    b.stop();
  });

  it('treats a peer without hello (old bridge) as incompatible', () => {
    vi.useFakeTimers();
    const b = makeBackend();
    b.start();
    FakeBridgeSocket.last.open();
    vi.advanceTimersByTime(3000);
    expect(b.state.value).toMatchObject({ kind: 'incompatible', reason: 'noHello' });
    b.stop();
  });

  it('does not connect where the bridge is unsupported', () => {
    const b = makeBackend('Art-Net discovery is not supported in Safari.');
    b.start();
    expect(b.state.value).toEqual({ kind: 'unsupported', reason: 'Art-Net discovery is not supported in Safari.' });
    expect(FakeBridgeSocket.instances).toHaveLength(0);
  });
});

describe('WsBridgeBackend — reconnect', () => {
  it('backs off exponentially while unreachable and resets after a connection', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    b.start();
    FakeBridgeSocket.last.drop();
    expect(b.state.value).toMatchObject({ kind: 'unreachable', attempts: 1, retryInMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(FakeBridgeSocket.instances).toHaveLength(2);
    expect(b.state.value.kind).toBe('unreachable'); // no flicker to connecting
    FakeBridgeSocket.last.drop();
    expect(b.state.value).toMatchObject({ attempts: 2, retryInMs: 2000 });
    vi.advanceTimersByTime(2000);
    FakeBridgeSocket.last.handshake();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.state.value.kind).toBe('connected');
    FakeBridgeSocket.last.drop();
    expect(b.state.value).toMatchObject({ kind: 'unreachable', attempts: 1, retryInMs: 1000 });
    b.stop();
  });

  it('caps the backoff at 30 s and reconnectNow skips it', () => {
    vi.useFakeTimers();
    const b = makeBackend();
    b.start();
    for (let i = 0; i < 8; i++) {
      FakeBridgeSocket.last.drop();
      vi.advanceTimersByTime(30_000);
    }
    FakeBridgeSocket.last.drop();
    expect(b.state.value).toMatchObject({ kind: 'unreachable', retryInMs: 30_000 });
    const before = FakeBridgeSocket.instances.length;
    b.reconnectNow();
    expect(FakeBridgeSocket.instances).toHaveLength(before + 1);
    expect(b.state.value.kind).toBe('connecting');
    b.stop();
  });
});

describe('WsBridgeBackend — commands and events', () => {
  async function connected() {
    const b = makeBackend();
    b.start();
    const s = FakeBridgeSocket.last;
    s.handshake();
    await tick();
    return { b, s };
  }

  it('correlates results and errors by id', async () => {
    const { b, s } = await connected();
    const port = { bind: 1, index: 0 };
    const get = b.request('rdmGet', { nodeId: 'n', port, uid: '7FF0:00000001', pid: 0x00f0 });
    const set = b.request('rdmSet', { nodeId: 'n', port, uid: '7FF0:00000001', pid: 0x00f0, value: 513 });
    const [cGet, cSet] = s.commands.slice(-2);
    expect(cGet).toMatchObject({ type: 'rdmGet', pid: 0x00f0, port });
    expect(cSet!.id).not.toBe(cGet!.id);
    s.receive({ type: 'error', id: cSet!.id, code: 'nack', message: 'NACK DATA_OUT_OF_RANGE', details: { nackReason: 6, nackName: 'DATA_OUT_OF_RANGE' } });
    s.receive({ type: 'result', id: cGet!.id, result: { data: '0001', value: 1 } });
    await expect(get).resolves.toEqual({ data: '0001', value: 1 });
    const err = await set.catch(e => e as BridgeCommandError);
    expect(err).toBeInstanceOf(BridgeCommandError);
    expect([err.code, err.nackReason]).toEqual(['nack', 6]);
    b.stop();
  });

  it('rejects when not connected, on timeout and on disconnect', async () => {
    const idle = makeBackend();
    await expect(idle.request('nodes', {})).rejects.toMatchObject({ code: 'notConnected' });

    const { b, s } = await connected();
    vi.useFakeTimers();
    const slow = b.request('todRequest', { nodeId: 'n', port: { bind: 1, index: 0 } }, { timeoutMs: 100 });
    vi.advanceTimersByTime(100);
    await expect(slow).rejects.toMatchObject({ code: 'requestTimeout' });
    const open = b.request('nodes', {});
    s.drop();
    await expect(open).rejects.toMatchObject({ code: 'disconnected' });
    b.stop();
  });

  it('delivers events after the handshake and isolates listener errors', async () => {
    const b = makeBackend();
    const seen: string[] = [];
    b.on('node', () => { throw new Error('boom'); });
    const off = b.on('node', e => seen.push(e.node.nodeId));
    b.start();
    const s = FakeBridgeSocket.last;
    s.open();
    s.receive({ type: 'node', node: makeNode({ nodeId: 'early' }) }); // before handshake: ignored
    s.receive({ type: 'hello', bridge: '0.1.0', protocol: '1.0.0', interfaces: [], udp: { bound: true, port: 6454, error: null } });
    s.answer('hello');
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    s.receive({ type: 'node', node: makeNode() });
    s.receive({ type: 'somethingNew', x: 1 }); // unknown events are ignored
    s.receive('not json');
    off();
    s.receive({ type: 'node', node: makeNode({ nodeId: 'after-off' }) });
    expect(seen).toEqual(['7FF0:8A1B2C3D']);
    b.stop();
  });

  it('keeps poll targets across reconnects', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    const release = b.addPollTarget('10.0.0.50');
    b.start();
    FakeBridgeSocket.last.handshake();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeBridgeSocket.last.command('addPollTarget')).toMatchObject({ ip: '10.0.0.50' });
    FakeBridgeSocket.last.drop();
    vi.advanceTimersByTime(1000);
    FakeBridgeSocket.last.handshake();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeBridgeSocket.last.command('addPollTarget')).toMatchObject({ ip: '10.0.0.50' });
    release();
    expect(FakeBridgeSocket.last.command('removePollTarget')).toMatchObject({ ip: '10.0.0.50' });
    b.stop();
  });
});

describe('WsBridgeBackend — DMX', () => {
  it('sends one frame set per task with the route table first', async () => {
    const b = makeBackend();
    b.start();
    const s = FakeBridgeSocket.last;
    s.handshake();
    await tick();

    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array([1, 2]));
    b.sendDmx({ nodeId: 'B', portAddress: 0 }, new Uint8Array([3]));
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array([9, 9])); // same route: last write wins
    await tick();
    expect(s.command('dmxRoutes')).toMatchObject({ routes: [{ route: 1, nodeId: 'A', portAddress: 0 }, { route: 2, nodeId: 'B', portAddress: 0 }] });
    expect(s.frameSets()).toEqual([{ sync: true, entries: [{ route: 1, data: Uint8Array.from([9, 9]) }, { route: 2, data: Uint8Array.from([3]) }] }]);

    // Next frame: no new routes, no table.
    const tables = s.commands.filter(c => c.type === 'dmxRoutes').length;
    b.sendDmx({ ip: '2.255.255.255', portAddress: 5 }, new Uint8Array(512));
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array(512));
    await tick();
    expect(s.commands.filter(c => c.type === 'dmxRoutes')).toHaveLength(tables + 1); // the IP route is new
    expect(s.frameSets()[1]!.entries.map(e => e.route)).toEqual([3, 1]);

    // Backed-up socket: dropped, never queued.
    s.bufferedAmount = 1_000_000;
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array(512));
    await tick();
    expect(s.frames).toHaveLength(2);
    b.stop();
  });

  it('sends nothing before the handshake and re-sends routes after a reconnect', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    b.start();
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeBridgeSocket.last.frames).toHaveLength(0);

    FakeBridgeSocket.last.handshake();
    await vi.advanceTimersByTimeAsync(0);
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array(4));
    await vi.advanceTimersByTimeAsync(0);
    FakeBridgeSocket.last.drop();
    vi.advanceTimersByTime(1000);
    FakeBridgeSocket.last.handshake();
    await vi.advanceTimersByTimeAsync(0);
    b.sendDmx({ nodeId: 'A', portAddress: 0 }, new Uint8Array(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeBridgeSocket.last.command('dmxRoutes')).toMatchObject({ routes: [{ route: 1, nodeId: 'A' }] });
    expect(FakeBridgeSocket.last.frames).toHaveLength(1);
    b.stop();
  });
});
