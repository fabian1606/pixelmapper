import { ref, readonly } from 'vue';

/**
 * Connectivity tracking shared by every network-dependent retry (ADR 0004 §3.4).
 *
 * `navigator.onLine` alone is unreliable (it only reports whether a network
 * interface is up), so callers also report the outcome of real requests:
 * a network-level failure flips the state to offline, a success flips it
 * back. Retries MUST use `backoffDelay` instead of fixed short timers.
 */

// ── State ────────────────────────────────────────────────────────────────────

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

/** Reactive, read-only online flag. */
export const isOnline = readonly(online);

const reconnectListeners = new Set<() => void>();

/** Switch state and notify reconnect listeners on an offline → online edge. */
function setOnline(next: boolean): void {
  const wasOnline = online.value;
  online.value = next;
  // Online → offline: start the (optional) recovery probe, see setConnectivityProbe.
  if (wasOnline && !next) startProbing();
  if (!wasOnline && next) {
    for (const cb of reconnectListeners) {
      try { cb(); }
      catch (err) { console.warn('[connectivity] reconnect listener failed:', err); }
    }
  }
}

// Browser events give a fast hint; real request outcomes stay authoritative.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}

// ── Reporting ────────────────────────────────────────────────────────────────

/** Call when a request failed at the network level (fetch threw, status 0). */
export function reportNetworkFailure(): void {
  setOnline(false);
}

/** Call when any request to the backend succeeded. */
export function reportNetworkSuccess(): void {
  setOnline(true);
}

/**
 * Register a callback for the offline → online transition.
 * Returns an unsubscribe function.
 */
export function onReconnect(cb: () => void): () => void {
  reconnectListeners.add(cb);
  return () => { reconnectListeners.delete(cb); };
}

// ── Backoff ──────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/**
 * Exponential backoff with ±20 % jitter: 500 ms, 1 s, 2 s, … capped at 30 s.
 * `attempt` is 0-based (0 = first retry).
 */
export function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

/** True when an error looks like a network failure rather than an HTTP error. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError when offline
  const name = (err as { name?: string } | null)?.name ?? '';
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
  return name === 'FunctionsFetchError' || /failed to fetch|network|load failed/i.test(msg);
}

// ── Probe ────────────────────────────────────────────────────────────────────
// A reported network failure flips the state to offline, but if the browser's
// interface never went down (server/DNS outage, captive portal) no `online`
// event will follow and nothing would ever flip it back — every retry waits
// for `onReconnect`. An optional probe closes that gap: while offline (and
// `navigator.onLine` is true) it is called with `backoffDelay` spacing, and a
// successful probe reports the state back online.

let probe: (() => Promise<boolean>) | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;

/**
 * Register the reachability probe (resolves true when the backend answered at
 * all). Pass null to remove it. Starts probing immediately if offline.
 */
export function setConnectivityProbe(fn: (() => Promise<boolean>) | null): void {
  probe = fn;
  if (!fn && probeTimer != null) { clearTimeout(probeTimer); probeTimer = null; }
  if (fn && !online.value) startProbing();
}

/** Reset the probe backoff and schedule the first probe. */
function startProbing(): void {
  probeAttempt = 0;
  scheduleProbe();
}

/** Schedule the next probe with backoff (no-op without probe / when online). */
function scheduleProbe(): void {
  if (!probe || probeTimer != null || online.value) return;
  probeTimer = setTimeout(runProbe, backoffDelay(probeAttempt++));
}

/** Run one probe; flip online on success, otherwise schedule the next. */
async function runProbe(): Promise<void> {
  probeTimer = null;
  if (online.value || !probe) return;
  // Interface down: the browser's `online` event will bring us back — no timer.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  let ok = false;
  try { ok = await probe(); }
  catch { ok = false; }
  if (ok) setOnline(true);
  else scheduleProbe();
}
