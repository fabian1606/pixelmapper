import { ref, readonly } from 'vue';
import type { Ref } from 'vue';

/**
 * Framework-free reachability probe for the configured AI endpoint
 * (ADR 0004 D20: AI features depend on reachability of the AI endpoint,
 * not on "online").
 *
 * The probe issues `GET ${baseUrl}/health` with a timeout, caches the result
 * for `ttlMs` and shares one in-flight request between concurrent callers.
 * It has no Nuxt dependency so it can be unit-tested with a mocked `fetch`;
 * `use-ai-reachability.ts` wraps one shared instance for the app.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Dependencies and tuning knobs of a probe instance. */
export interface AiReachabilityProbeOptions {
  /** Returns the AI backend base URL (no trailing slash needed). */
  getBaseUrl: () => string;
  /** `fetch` implementation; defaults to the global one. */
  fetchFn?: typeof fetch;
  /** Clock used for the cache TTL; defaults to `Date.now`. */
  now?: () => number;
  /** Abort the health request after this many ms. */
  timeoutMs?: number;
  /** How long a probe result stays valid. */
  ttlMs?: number;
}

/** Public surface of a probe instance. */
export interface AiReachabilityProbe {
  /** `null` = not probed yet, otherwise the last probe/report outcome. */
  reachable: Readonly<Ref<boolean | null>>;
  /** True while a health request is in flight. */
  checking: Readonly<Ref<boolean>>;
  /** Probe (or return the cached result unless `force`). */
  probe: (force?: boolean) => Promise<boolean>;
  /** Record that a real AI request succeeded (refreshes the cache). */
  reportSuccess: () => void;
  /** Drop the cached result so the next `probe()` hits the network. */
  invalidate: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Default timeout of a single health request. */
export const AI_PROBE_TIMEOUT_MS = 3_000;
/** Default cache lifetime of a probe result. */
export const AI_PROBE_TTL_MS = 45_000;

// ── Factory ──────────────────────────────────────────────────────────────────

/** Creates an independent probe with its own state and cache. */
export function createAiReachabilityProbe(options: AiReachabilityProbeOptions): AiReachabilityProbe {
  const timeoutMs = options.timeoutMs ?? AI_PROBE_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? AI_PROBE_TTL_MS;
  const now = options.now ?? (() => Date.now());

  const reachable = ref<boolean | null>(null);
  const checking = ref(false);
  // Timestamp of the last result; `null` means "no valid cache entry".
  let checkedAt: number | null = null;
  // Shared promise so concurrent callers trigger only one request.
  let inFlight: Promise<boolean> | null = null;

  /** Stores a result and stamps the cache. */
  function setResult(value: boolean): void {
    reachable.value = value;
    checkedAt = now();
  }

  /** Performs one health request; never throws. */
  async function runProbe(): Promise<boolean> {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    const base = options.getBaseUrl().replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}/health`, { method: 'GET', signal: controller.signal, cache: 'no-store' });
      return res.ok;
    } catch (err) {
      console.warn('[ai-reachability] health probe failed:', err);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Returns the cached result while fresh, otherwise probes once. */
  function probe(force = false): Promise<boolean> {
    if (inFlight) return inFlight;
    const fresh = checkedAt !== null && reachable.value !== null && now() - checkedAt < ttlMs;
    if (!force && fresh) return Promise.resolve(reachable.value as boolean);

    checking.value = true;
    inFlight = runProbe()
      .then((ok) => {
        setResult(ok);
        return ok;
      })
      .finally(() => {
        checking.value = false;
        inFlight = null;
      });
    return inFlight;
  }

  /** A successful real request proves reachability. */
  function reportSuccess(): void {
    setResult(true);
  }

  /** Forget the cached result (state stays visible until the next probe). */
  function invalidate(): void {
    checkedAt = null;
  }

  return {
    reachable: readonly(reachable),
    checking: readonly(checking),
    probe,
    reportSuccess,
    invalidate,
  };
}
