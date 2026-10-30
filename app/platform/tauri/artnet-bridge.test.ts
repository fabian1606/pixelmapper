/**
 * In-process Art-Net bridge of the Tauri platform: `artnet_*` commands over
 * a mocked `invoke` and a fake `Channel` (ordering, raw binary IPC, close).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtNetSessionEvent } from './artnet-bridge';

const invoke = vi.fn();

/** Fake `Channel`: tests push events through `emit` like the Rust side would. */
class FakeChannel<T> {
  static last: FakeChannel<unknown> | null = null;
  onmessage: (event: T) => void = () => {};
  constructor() {
    FakeChannel.last = this as FakeChannel<unknown>;
  }

  /** Delivers one event from the native side. */
  emit(event: T) {
    this.onmessage(event);
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: FakeChannel,
}));

const { createTauriArtNetBridge } = await import('./artnet-bridge');

/** The channel of the last `artnet_connect`. */
const channel = () => FakeChannel.last as FakeChannel<ArtNetSessionEvent>;
/** Lets microtasks and zero-delay timers run. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
  FakeChannel.last = null;
});

describe('Tauri ArtNetBridgeApi', () => {
  it('queues events until connect() resolved, then delivers them in order', async () => {
    const messages: string[] = [];
    let resolveConnect!: (id: number) => void;
    invoke.mockImplementationOnce(() => new Promise<number>((r) => { resolveConnect = r; }));
    const connecting = createTauriArtNetBridge().connect({ onMessage: t => messages.push(t), onClose: () => {} });
    expect(invoke).toHaveBeenCalledWith('artnet_connect', { onEvent: channel() });

    channel().emit({ kind: 'message', text: 'hello' });
    resolveConnect(3);
    const session = await connecting;
    // The caller's continuation runs before any handler.
    expect(messages).toEqual([]);
    channel().emit({ kind: 'message', text: 'second' });
    await tick();
    expect(messages).toEqual(['hello', 'second']);
    channel().emit({ kind: 'message', text: 'third' });
    expect(messages).toEqual(['hello', 'second', 'third']);

    invoke.mockResolvedValue(undefined);
    await session.sendText('{"type":"nodes","id":1}');
    expect(invoke).toHaveBeenLastCalledWith('artnet_send_text', { session: 3, text: '{"type":"nodes","id":1}' });
  });

  it('sends binary as raw IPC body with the session header and tracks bufferedAmount', async () => {
    invoke.mockResolvedValueOnce(5);
    const session = await createTauriArtNetBridge().connect({ onMessage: () => {}, onClose: () => {} });
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    const data = new Uint8Array([1, 2, 3, 4]);
    session.sendBinary(data);
    expect(invoke).toHaveBeenLastCalledWith('artnet_send_binary', data, { headers: { 'x-session': '5' } });
    expect(session.bufferedAmount).toBe(4);
    finish();
    await tick();
    expect(session.bufferedAmount).toBe(0);
  });

  it('keeps sends in order: the next invoke starts after the previous settled', async () => {
    invoke.mockResolvedValueOnce(6);
    const session = await createTauriArtNetBridge().connect({ onMessage: () => {}, onClose: () => {} });
    let finishText!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>((r) => { finishText = r; }));
    invoke.mockResolvedValue(undefined);
    const routes = session.sendText('{"type":"dmxRoutes","id":2,"routes":[]}');
    session.sendBinary(new Uint8Array([9]));
    expect(invoke).toHaveBeenLastCalledWith('artnet_send_text', { session: 6, text: '{"type":"dmxRoutes","id":2,"routes":[]}' });
    expect(session.bufferedAmount).toBe(1);
    finishText();
    await routes;
    await tick();
    expect(invoke).toHaveBeenLastCalledWith('artnet_send_binary', new Uint8Array([9]), { headers: { 'x-session': '6' } });
    expect(session.bufferedAmount).toBe(0);
  });

  it('logs only the first failed binary send', async () => {
    invoke.mockResolvedValueOnce(1);
    const session = await createTauriArtNetBridge().connect({ onMessage: () => {}, onClose: () => {} });
    invoke.mockRejectedValue('unknown session');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    session.sendBinary(new Uint8Array(1));
    session.sendBinary(new Uint8Array(1));
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('turns string rejections into Errors', async () => {
    invoke.mockRejectedValueOnce('UDP port 6454 is in use');
    await expect(createTauriArtNetBridge().connect({ onMessage: () => {}, onClose: () => {} })).rejects.toThrow('UDP port 6454 is in use');

    invoke.mockResolvedValueOnce(2);
    const session = await createTauriArtNetBridge().connect({ onMessage: () => {}, onClose: () => {} });
    invoke.mockRejectedValueOnce('unknown session 2');
    await expect(session.sendText('{}')).rejects.toThrow('unknown session 2');
  });

  it('reports the close once and nothing after it', async () => {
    invoke.mockResolvedValueOnce(4);
    const messages: string[] = [];
    const onClose = vi.fn();
    const session = await createTauriArtNetBridge().connect({ onMessage: t => messages.push(t), onClose });
    await tick();
    channel().emit({ kind: 'close', code: 4002, reason: 'no client hello' });
    channel().emit({ kind: 'message', text: 'late' });
    expect(onClose).toHaveBeenCalledWith(4002, 'no client hello');
    expect(messages).toEqual([]);
    await expect(session.sendText('{}')).rejects.toThrow(/closed/);
  });

  it('disconnects once and delivers nothing after close()', async () => {
    invoke.mockResolvedValueOnce(9);
    const messages: string[] = [];
    const session = await createTauriArtNetBridge().connect({ onMessage: t => messages.push(t), onClose: () => {} });
    channel().emit({ kind: 'message', text: 'queued' });
    invoke.mockResolvedValue(undefined);
    session.close();
    session.close();
    await tick();
    expect(invoke.mock.calls.filter(c => c[0] === 'artnet_disconnect')).toEqual([['artnet_disconnect', { session: 9 }]]);
    expect(messages).toEqual([]);
    invoke.mockClear();
    session.sendBinary(new Uint8Array(1));
    expect(invoke).not.toHaveBeenCalled();
  });
});
