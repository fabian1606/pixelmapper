// @vitest-environment node
/**
 * AI reachability probe (ADR 0004 D20): health request, timeout, TTL cache,
 * shared in-flight promise and invalidation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiReachabilityProbe } from './ai-reachability-probe';

/** Builds a probe with a controllable clock and mocked fetch. */
function setup(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  let clock = 1_000;
  const fetchFn = vi.fn(fetchImpl);
  const probe = createAiReachabilityProbe({
    getBaseUrl: () => 'http://ai.test/',
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => clock,
    timeoutMs: 50,
    ttlMs: 1_000,
  });
  return { probe, fetchFn, advance: (ms: number) => { clock += ms; } };
}

/** A minimal successful/failed Response stand-in. */
const okResponse = (ok = true) => ({ ok } as Response);

afterEach(() => {
  vi.useRealTimers();
});

describe('createAiReachabilityProbe', () => {
  it('starts unknown and becomes reachable on a 2xx health response', async () => {
    const { probe, fetchFn } = setup(async () => okResponse(true));
    expect(probe.reachable.value).toBeNull();
    await expect(probe.probe()).resolves.toBe(true);
    expect(probe.reachable.value).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('http://ai.test/health', expect.objectContaining({ method: 'GET' }));
  });

  it('reports unreachable on HTTP errors and network errors', async () => {
    const http = setup(async () => okResponse(false));
    await expect(http.probe.probe()).resolves.toBe(false);
    const net = setup(async () => { throw new TypeError('Failed to fetch'); });
    await expect(net.probe.probe()).resolves.toBe(false);
    expect(net.probe.reachable.value).toBe(false);
  });

  it('caches the result for the TTL and re-probes afterwards or when forced', async () => {
    const { probe, fetchFn, advance } = setup(async () => okResponse(true));
    await probe.probe();
    await probe.probe();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await probe.probe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    advance(1_500);
    await probe.probe();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolve!: (r: Response) => void;
    const { probe, fetchFn } = setup(() => new Promise<Response>((r) => { resolve = r; }));
    const a = probe.probe();
    const b = probe.probe(true);
    expect(probe.checking.value).toBe(true);
    resolve(okResponse(true));
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(probe.checking.value).toBe(false);
  });

  it('aborts after the timeout and reports unreachable', async () => {
    vi.useFakeTimers();
    const { probe } = setup((_url, init) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe(false);
  });

  it('invalidate() forces the next probe; reportSuccess() marks reachable', async () => {
    const { probe, fetchFn } = setup(async () => okResponse(false));
    await probe.probe();
    probe.reportSuccess();
    expect(probe.reachable.value).toBe(true);
    await probe.probe();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    probe.invalidate();
    await expect(probe.probe()).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
