/**
 * `flushOpenSession` (desktop quit hook): flushes outbox rows and the open
 * session's working snapshot; nothing after the handlers were disposed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushOutboxWrites = vi.fn(async () => {});
vi.mock('~/utils/persistence/outbox-writer', () => ({ flushOutboxWrites: () => flushOutboxWrites() }));

const { flushOpenSession, installUnloadHandlers } = await import('./unload-handlers');
type Opts = Parameters<typeof installUnloadHandlers>[0];

/** Minimal options with a spy writer. */
function opts(flush: () => Promise<void>): Opts {
  return {
    projectId: 'p',
    session: { writer: { flush }, engine: null } as unknown as Opts['session'],
    token: () => '',
    functionsUrl: '',
    queued: () => [],
    isDirty: () => false,
    buildSnapshot: () => { throw new Error('unused'); },
    lastSequence: () => 0,
    beforeLeave: () => {},
  };
}

beforeEach(() => { flushOutboxWrites.mockClear(); });

describe('flushOpenSession', () => {
  it('flushes the outbox, then the open session writer', async () => {
    const order: string[] = [];
    flushOutboxWrites.mockImplementationOnce(async () => { order.push('outbox'); });
    const dispose = installUnloadHandlers(opts(async () => { order.push('writer'); }));
    await flushOpenSession();
    expect(order).toEqual(['outbox', 'writer']);
    dispose();
  });

  it('never rejects and skips the writer after dispose', async () => {
    const flush = vi.fn(async () => {});
    installUnloadHandlers(opts(flush))();
    flushOutboxWrites.mockRejectedValueOnce(new Error('idb closed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flushOpenSession()).resolves.toBeUndefined();
    expect(flush).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
