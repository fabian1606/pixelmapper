/**
 * Desktop quit hook: handlers run on `app-before-quit`, are bounded by a
 * timeout, and `app_quit_ready` is always called afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (..._args: unknown[]) => undefined);
type QuitListener = (e: { payload: string }) => Promise<void>;
let quitListener: QuitListener | null = null;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: QuitListener) => {
    if (event === 'app-before-quit') quitListener = cb;
    return () => {};
  }),
}));

const { createTauriAppShell, runQuitHandlers, QUIT_FLUSH_TIMEOUT_MS } = await import('./app-shell');

beforeEach(() => { invoke.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('runQuitHandlers', () => {
  it('waits for all handlers and ignores their failures', async () => {
    const done: string[] = [];
    await runQuitHandlers([
      async () => { await Promise.resolve(); done.push('a'); },
      async () => { throw new Error('boom'); },
    ], 1000);
    expect(done).toEqual(['a']);
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    let settled = false;
    const p = runQuitHandlers([() => new Promise<void>(() => {})], 3000).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });
});

describe('onBeforeQuit', () => {
  it('flushes, then tells the backend to perform the close/exit', async () => {
    const order: string[] = [];
    invoke.mockImplementation(async (cmd: unknown) => { order.push(String(cmd)); return undefined; });
    const off = createTauriAppShell().onBeforeQuit(async () => { order.push('flush'); });
    await Promise.resolve();
    expect(quitListener).not.toBeNull();

    await quitListener!({ payload: 'exit' });
    expect(order).toEqual(['flush', 'app_quit_ready']);
    expect(invoke).toHaveBeenCalledWith('app_quit_ready', { mode: 'exit' });
    off();
  });

  it('still quits when a handler hangs (after the timeout)', async () => {
    vi.useFakeTimers();
    const off = createTauriAppShell().onBeforeQuit(() => new Promise<void>(() => {}));
    const p = quitListener!({ payload: 'close' });
    await vi.advanceTimersByTimeAsync(QUIT_FLUSH_TIMEOUT_MS);
    await p;
    expect(invoke).toHaveBeenCalledWith('app_quit_ready', { mode: 'close' });
    off();
  });
});
