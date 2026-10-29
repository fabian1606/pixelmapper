/**
 * Transport seam of `WsBridgeBackend`: a custom `BridgeTransport` factory and
 * the in-process transport over a fake `ArtNetBridgeApi` (desktop app's
 * built-in bridge). Same protocol logic as over the WebSocket.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeCommandError } from './backend';
import { WsBridgeBackend } from './ws-bridge-backend';
import { createInProcessTransport, IN_PROCESS_BRIDGE_LABEL } from './in-process-transport';
import type { BridgeTransport, BridgeTransportHandlers } from './bridge-transport';
import { FakeInProcessBridge } from './testing/fake-in-process-bridge';
import { backendProblem } from '../node/node-status';

/** A backend on the fake built-in bridge. */
function makeBackend(api = new FakeInProcessBridge()) {
  const backend = new WsBridgeBackend({ url: () => IN_PROCESS_BRIDGE_LABEL, clientVersion: '9.9.9', transport: createInProcessTransport(api) });
  return { api, backend };
}

/** Lets microtasks and zero-delay timers run. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('WsBridgeBackend — custom transport factory', () => {
  it('creates one transport per attempt with the url and speaks through it', async () => {
    const created: { url: string; handlers: BridgeTransportHandlers; texts: string[]; closed: boolean }[] = [];
    const backend = new WsBridgeBackend({
      url: () => 'label',
      clientVersion: '1',
      transport: (url, handlers) => {
        const t = { url, handlers, texts: [] as string[], closed: false };
        created.push(t);
        const transport: BridgeTransport = {
          get isOpen() { return !t.closed; },
          bufferedAmount: 0,
          sendText: text => { t.texts.push(text); },
          sendBinary: () => {},
          close: () => { t.closed = true; },
        };
        return transport;
      },
    });
    backend.start();
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe('label');
    const { handlers, texts } = created[0]!;
    handlers.onOpen();
    handlers.onMessage(JSON.stringify({ type: 'hello', bridge: '0.1.0', protocol: '1.0.0', interfaces: [], udp: { bound: true, port: 6454, error: null } }));
    const hello = JSON.parse(texts[0]!) as { id: number; type: string };
    expect(hello.type).toBe('hello');
    handlers.onMessage(JSON.stringify({ type: 'result', id: hello.id, result: {} }));
    await tick();
    expect(backend.state.value).toMatchObject({ kind: 'connected', url: 'label' });
    backend.stop();
    expect(created[0]!.closed).toBe(true);
  });
});

describe('WsBridgeBackend over the in-process transport', () => {
  it('delivers a hello that arrived before connect() resolved, after open', async () => {
    const { api, backend } = makeBackend();
    backend.start();
    expect(backend.state.value).toEqual({ kind: 'connecting', url: IN_PROCESS_BRIDGE_LABEL });
    const s = api.last;
    s.hello(); // before the session is handed out
    expect(s.commands).toHaveLength(0);
    s.accept();
    await tick();
    expect(s.command('hello')).toMatchObject({ client: 'pixelmapper', clientVersion: '9.9.9', protocol: '1.0.0' });
    s.answer('hello');
    await tick();
    expect(backend.state.value).toMatchObject({ kind: 'connected', url: IN_PROCESS_BRIDGE_LABEL, info: { bridgeVersion: '0.2.0' } });
    backend.stop();
    expect(s.closed).toBe(true);
  });

  it('round-trips a command and sends DMX frame sets through sendBinary', async () => {
    const { api, backend } = makeBackend();
    backend.start();
    const s = api.last;
    s.accept();
    await tick();
    s.hello();
    s.answer('hello');
    await tick();

    const nodes = backend.request('nodes', {});
    s.answer('nodes', { nodes: [] });
    await expect(nodes).resolves.toEqual({ nodes: [] });

    backend.sendDmx({ ip: '2.0.0.50', portAddress: 1 }, new Uint8Array([1, 2, 3]));
    await tick();
    expect(s.command('dmxRoutes')).toBeDefined();
    expect(s.frameSets()).toEqual([{ sync: true, entries: [{ route: 1, data: Uint8Array.from([1, 2, 3]) }] }]);

    // Backpressure: the session's bufferedAmount drops frame sets.
    s.bufferedAmount = 1024 * 1024;
    backend.sendDmx({ ip: '2.0.0.50', portAddress: 1 }, new Uint8Array([4]));
    await tick();
    expect(s.frames).toHaveLength(1);
    backend.stop();
  });

  it('reconnects after a contract close code and logs why', async () => {
    vi.useFakeTimers();
    const { api, backend } = makeBackend();
    const logs: string[] = [];
    backend.on('log', e => logs.push(e.text));
    backend.start();
    api.last.accept();
    await vi.advanceTimersByTimeAsync(0);
    api.last.hello();
    api.last.answer('hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.state.value.kind).toBe('connected');

    const open = backend.request('nodes', {});
    api.last.drop(4003, 'queue overflow');
    await expect(open).rejects.toMatchObject({ code: 'disconnected' });
    expect(logs.at(-1)).toMatch(/4003/);
    expect(backend.state.value).toMatchObject({ kind: 'unreachable', retryInMs: 1000 });
    expect(api.last.closed).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(api.sessions).toHaveLength(2);
    backend.stop();
  });

  it('reports why the bridge could not start and retries with backoff', async () => {
    vi.useFakeTimers();
    const { api, backend } = makeBackend();
    backend.start();
    api.last.refuse('UDP port 6454 is in use');
    await vi.advanceTimersByTimeAsync(0);
    const state = backend.state.value;
    expect(state).toMatchObject({ kind: 'unreachable', attempts: 1, retryInMs: 1000, error: 'UDP port 6454 is in use' });
    expect(backendProblem(state, true)).toBe('The built-in Art-Net bridge could not start: UDP port 6454 is in use — retrying');
    vi.advanceTimersByTime(1000);
    expect(api.sessions).toHaveLength(2);
    backend.stop();
  });

  it('treats a rejected sendText as a lost session', async () => {
    const { api, backend } = makeBackend();
    backend.start();
    const s = api.last;
    s.accept();
    await tick();
    s.hello();
    s.answer('hello');
    await tick();
    s.rejectSends = 'unknown session';
    const pending = backend.request('nodes', {});
    await expect(pending).rejects.toBeInstanceOf(BridgeCommandError);
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    expect(backend.state.value).toMatchObject({ kind: 'unreachable', error: 'unknown session' });
    expect(s.closed).toBe(true);
    backend.stop();
  });

  it('closes a session that resolves after stop()', async () => {
    const { api, backend } = makeBackend();
    backend.start();
    const s = api.last;
    backend.stop();
    s.accept();
    await tick();
    expect(s.closed).toBe(true);
    expect(backend.state.value.kind).toBe('idle');
  });
});
