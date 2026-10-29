/**
 * Connectivity flap protection: throttled reconnect fan-out, probe backoff
 * kept across quick flaps, and code-bug TypeErrors not counted as offline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Connectivity = typeof import('~/utils/sync/connectivity');

let conn: Connectivity;

beforeEach(async () => {
  // Fresh module state per test (throttle + backoff are module-level).
  vi.resetModules();
  vi.useFakeTimers();
  conn = await import('~/utils/sync/connectivity');
  conn.reportNetworkSuccess();
});

afterEach(() => {
  conn.setConnectivityProbe(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('reconnect throttling', () => {
  it('notifies the first reconnect immediately and coalesces quick flaps', async () => {
    const onBack = vi.fn();
    conn.onReconnect(onBack);

    conn.reportNetworkFailure();
    conn.reportNetworkSuccess();
    expect(onBack).toHaveBeenCalledTimes(1);

    // Three more flaps within the interval → one deferred notification.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(500);
      conn.reportNetworkFailure();
      conn.reportNetworkSuccess();
    }
    expect(onBack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(conn.RECONNECT_MIN_INTERVAL_MS);
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('drops a deferred notification when offline again by then', async () => {
    const onBack = vi.fn();
    conn.onReconnect(onBack);
    conn.reportNetworkFailure();
    conn.reportNetworkSuccess();
    conn.reportNetworkFailure();
    conn.reportNetworkSuccess();
    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(conn.RECONNECT_MIN_INTERVAL_MS);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('notifies immediately again once the interval has passed', async () => {
    const onBack = vi.fn();
    conn.onReconnect(onBack);
    conn.reportNetworkFailure();
    conn.reportNetworkSuccess();
    await vi.advanceTimersByTimeAsync(conn.RECONNECT_MIN_INTERVAL_MS);
    conn.reportNetworkFailure();
    conn.reportNetworkSuccess();
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('probe backoff across flaps', () => {
  /** Times (ms after the drop) at which the probe ran. */
  async function probeTimes(probe: ReturnType<typeof vi.fn>, windowMs: number): Promise<number[]> {
    const times: number[] = [];
    const start = Date.now();
    probe.mockImplementation(async () => { times.push(Date.now() - start); return false; });
    await vi.advanceTimersByTimeAsync(windowMs);
    return times;
  }

  it('keeps growing the backoff when the connection drops right after a reconnect', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
    const probe = vi.fn(async () => true);
    conn.setConnectivityProbe(probe);

    // Flap twice: probe succeeds after 500 ms, then the app fails again at once.
    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(500); // attempt 0 → online
    expect(conn.isOnline.value).toBe(true);
    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(1000); // attempt 1 → online
    expect(conn.isOnline.value).toBe(true);
    conn.reportNetworkFailure();

    // Next probe uses attempt 2 (2 s), not a reset 500 ms.
    const times = await probeTimes(probe, 2500);
    expect(times[0]).toBe(2000);
  });

  it('resets the backoff after a stable online period', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const probe = vi.fn(async () => true);
    conn.setConnectivityProbe(probe);
    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(500);
    conn.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(1000);
    expect(conn.isOnline.value).toBe(true);

    await vi.advanceTimersByTimeAsync(conn.STABLE_ONLINE_MS);
    conn.reportNetworkFailure();
    const times = await probeTimes(probe, 1000);
    expect(times[0]).toBe(500);
  });
});

describe('isNetworkError', () => {
  it('counts fetch failures, but not programming-error TypeErrors', () => {
    expect(conn.isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(conn.isNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(conn.isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(conn.isNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(conn.isNetworkError(new TypeError('Failed to send a request to the Edge Function'))).toBe(true);
    expect(conn.isNetworkError(new TypeError('x.map is not a function'))).toBe(false);
    expect(conn.isNetworkError(new TypeError('Cannot read properties of undefined (reading \'id\')'))).toBe(false);
    expect(conn.isNetworkError(new TypeError('undefined is not an object (evaluating \'a.b\')'))).toBe(false);
    expect(conn.isNetworkError(new Error('HTTP 500'))).toBe(false);
  });
});
