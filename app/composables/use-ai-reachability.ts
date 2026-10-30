import type { Ref } from 'vue';
import { isNetworkError, onReconnect } from '~/utils/sync/connectivity';
import { createAiReachabilityProbe } from '~/utils/sync/ai-reachability-probe';

/**
 * App-wide AI endpoint reachability (ADR 0004 D20).
 *
 * One probe instance is shared by every caller (module-level state), so all
 * AI buttons agree and concurrent checks hit the network only once. The probe
 * re-runs automatically on reconnect and after a real AI request failed at
 * network level (`reportAiFailure`).
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** UI hint shown next to disabled AI controls. */
export const AI_UNREACHABLE_HINT = 'AI backend not reachable';

/** Fallback when the runtime config does not define an AI backend URL. */
const DEFAULT_AI_BACKEND_URL = 'http://localhost:4000';

// ── Shared state ─────────────────────────────────────────────────────────────

// Captured from the runtime config on the first composable call (a Nuxt
// context is required for `useRuntimeConfig`, helpers run outside of it).
let aiBaseUrl = DEFAULT_AI_BACKEND_URL;

const probe = createAiReachabilityProbe({ getBaseUrl: () => aiBaseUrl });

// Reconnect listener is registered lazily and only in the browser.
let reconnectRegistered = false;

/** Registers the reconnect re-probe once (client-side only). */
function ensureReconnectListener(): void {
  if (reconnectRegistered || typeof window === 'undefined') return;
  reconnectRegistered = true;
  onReconnect(() => { void probe.probe(true); });
}

// ── Helpers (usable outside setup) ───────────────────────────────────────────

/** Probe the AI endpoint (cached unless `force`). Resolves `false` on the server. */
export function probeAi(force = false): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  ensureReconnectListener();
  return probe.probe(force);
}

/**
 * Call when a real AI request failed. Network-level failures invalidate the
 * cache and trigger a fresh probe so the UI reflects the actual state.
 */
export function reportAiFailure(err: unknown): void {
  if (!isNetworkError(err)) return;
  probe.invalidate();
  void probeAi(true);
}

/** Call when a real AI request reached the backend. */
export function reportAiSuccess(): void {
  probe.reportSuccess();
}

// ── Composable ───────────────────────────────────────────────────────────────

/** Reactive access to the shared AI reachability state. */
export function useAiReachability(): {
  aiReachable: Readonly<Ref<boolean | null>>;
  aiChecking: Readonly<Ref<boolean>>;
  aiBaseUrl: string;
  probeAi: (force?: boolean) => Promise<boolean>;
} {
  // Read the configured endpoint while a Nuxt context is available.
  try {
    aiBaseUrl = useRuntimeConfig().public.aiBackendUrl || DEFAULT_AI_BACKEND_URL;
  } catch (err) {
    console.warn('[ai-reachability] runtime config unavailable, using default URL:', err);
  }
  ensureReconnectListener();
  return {
    aiReachable: probe.reachable,
    aiChecking: probe.checking,
    aiBaseUrl,
    probeAi,
  };
}
