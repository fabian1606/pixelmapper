import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Scheduler = typeof import('~/utils/sync/retry-scheduler');
type Connectivity = typeof import('~/utils/sync/connectivity');

let rs: Scheduler;
let conn: Connectivity;

beforeEach(async () => {
  // Fresh connectivity state per test.
  vi.resetModules();
  vi.useFakeTimers();
  conn = await import('~/utils/sync/connectivity');
  rs = await import('~/utils/sync/retry-scheduler');
  conn.reportNetworkSuccess();
});

afterEach(() => { vi.useRealTimers(); });

describe('createRetryScheduler', () => {
  it('backs off on non-network failures', () => {
    const run = vi.fn();
    const s = rs.createRetryScheduler(run);
    s.fail(new Error('HTTP 500'));
    expect(conn.isOnline.value).toBe(true);
    vi.advanceTimersByTime(399);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(run).toHaveBeenCalledTimes(1);
    s.fail(new Error('HTTP 500'));
    vi.advanceTimersByTime(799);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(450);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits for reconnect after a network failure (no timer)', () => {
    const run = vi.fn();
    const s = rs.createRetryScheduler(run);
    s.fail(new TypeError('Failed to fetch'));
    expect(conn.isOnline.value).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).not.toHaveBeenCalled();
    expect(s.pending).toBe(true);
    conn.reportNetworkSuccess();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
  });

  it('deferUntilOnline runs immediately when online, otherwise on reconnect', () => {
    const run = vi.fn();
    const s = rs.createRetryScheduler(run);
    s.deferUntilOnline();
    expect(run).toHaveBeenCalledTimes(1);
    conn.reportNetworkFailure();
    s.deferUntilOnline();
    s.deferUntilOnline(); // idempotent
    expect(run).toHaveBeenCalledTimes(1);
    conn.reportNetworkSuccess();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('succeed() cancels a pending retry', () => {
    const run = vi.fn();
    const s = rs.createRetryScheduler(run);
    s.fail(new Error('HTTP 500'));
    s.succeed();
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('connectivity probe', () => {
  it('probes with backoff while offline and flips back online on success', async () => {
    let reachable = false;
    const probe = vi.fn(async () => reachable);
    conn.setConnectivityProbe(probe);
    const onBack = vi.fn();
    conn.onReconnect(onBack);

    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(700);
    expect(probe).toHaveBeenCalledTimes(1);
    reachable = true;
    await vi.advanceTimersByTimeAsync(1300);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(conn.isOnline.value).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Online: no more probing.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(2);
    conn.setConnectivityProbe(null);
  });
});
