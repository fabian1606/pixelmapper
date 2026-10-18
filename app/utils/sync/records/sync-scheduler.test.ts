/**
 * Sync scheduler: single flight, debounce and backoff retries.
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncScheduler } from './sync-scheduler';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createSyncScheduler', () => {
  it('runs one round at a time and queues one follow-up', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<boolean>((r) => { release = () => r(true); }));
    const s = createSyncScheduler({ run, debounceMs: 100 });
    const first = s.syncNow();
    void s.syncNow();
    void s.syncNow();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('debounces local changes', async () => {
    const run = vi.fn(async () => true);
    const s = createSyncScheduler({ run, debounceMs: 100 });
    s.scheduleDebounced();
    s.scheduleDebounced();
    await vi.advanceTimersByTimeAsync(99);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries failed rounds with growing backoff and stops after dispose', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
    const run = vi.fn(async () => false);
    const s = createSyncScheduler({ run, debounceMs: 100 });
    await s.syncNow();
    await vi.advanceTimersByTimeAsync(499);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 500 ms
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // 1 s
    expect(run).toHaveBeenCalledTimes(3);
    s.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
