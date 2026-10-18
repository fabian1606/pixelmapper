// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMirrorScheduler, type MirrorSchedulerOptions } from './mirror-scheduler';

// ── Harness ──────────────────────────────────────────────────────────────────

const INTERVAL = 10_000;

/** Pass results to return, in order (default: success). */
let results: boolean[];
let online: boolean;
let reconnect: (() => void) | null;

/** Scheduler with injected connectivity and a fixed backoff (100 ms × 2^attempt). */
function setup(over: Partial<MirrorSchedulerOptions> = {}) {
  const runPass = vi.fn(async () => results.shift() ?? true);
  const unsubscribe = vi.fn(() => { reconnect = null; });
  const scheduler = createMirrorScheduler({
    runPass,
    intervalMs: INTERVAL,
    isOnline: () => online,
    onReconnect: (cb) => { reconnect = cb; return unsubscribe; },
    backoff: attempt => 100 * 2 ** attempt,
    ...over,
  });
  return { scheduler, runPass, unsubscribe };
}

beforeEach(() => {
  vi.useFakeTimers();
  results = [];
  online = true;
  reconnect = null;
});

afterEach(() => { vi.useRealTimers(); });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createMirrorScheduler', () => {
  it('runs a pass on start (once, idempotent) and then on the interval', async () => {
    const { scheduler, runPass } = setup();
    scheduler.start();
    scheduler.start();
    await scheduler.whenIdle();
    expect(runPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(runPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runPass).toHaveBeenCalledTimes(2);
  });

  it('backs off after failures and resets after a success', async () => {
    results = [false, false, true];
    const { scheduler, runPass } = setup();
    scheduler.start();
    await scheduler.whenIdle();
    await vi.advanceTimersByTimeAsync(100);
    expect(runPass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(runPass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(runPass).toHaveBeenCalledTimes(3);
    // Success → back to the regular interval.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(runPass).toHaveBeenCalledTimes(4);
  });

  it('a throwing pass counts as failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runPass = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    const { scheduler } = setup({ runPass });
    scheduler.start();
    await scheduler.whenIdle();
    await vi.advanceTimersByTimeAsync(100);
    expect(runPass).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('runs no timers while offline and passes again on reconnect', async () => {
    online = false;
    const { scheduler, runPass } = setup();
    scheduler.start();
    expect(runPass).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    online = true;
    reconnect!();
    await scheduler.whenIdle();
    expect(runPass).toHaveBeenCalledTimes(1);
  });

  it('a pass that fails because the network dropped waits for reconnect', async () => {
    const runPass = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(async () => { online = false; return false; })
      .mockResolvedValue(true);
    const { scheduler } = setup({ runPass });
    scheduler.start();
    await scheduler.whenIdle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(runPass).toHaveBeenCalledTimes(1);
    online = true;
    reconnect!();
    await scheduler.whenIdle();
    expect(runPass).toHaveBeenCalledTimes(2);
  });

  it('never overlaps: triggers during a pass cause exactly one follow-up', async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    const runPass = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (runPass.mock.calls.length === 1) await new Promise<void>((r) => { release = r; });
      active--;
      return true;
    });
    const { scheduler } = setup({ runPass });
    scheduler.start();
    scheduler.trigger();
    scheduler.trigger();
    reconnect!();
    release();
    await scheduler.whenIdle();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.whenIdle();
    expect(runPass).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('stop() cancels timers, listeners and the queued follow-up', async () => {
    let release!: () => void;
    const runPass = vi.fn(() => new Promise<boolean>((r) => { release = () => r(true); }));
    const { scheduler, unsubscribe } = setup({ runPass });
    scheduler.start();
    scheduler.trigger();
    scheduler.stop();
    release();
    await scheduler.whenIdle();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(runPass).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.trigger();
    expect(runPass).toHaveBeenCalledTimes(1);
  });
});
