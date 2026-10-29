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

/**
 * Minimum spacing of reconnect notifications. Every listener fans out into
 * real work (list refresh, session refresh, mirror, records sync, autosave),
 * so quick offline/online flaps must not re-run all of it every second.
 */
export const RECONNECT_MIN_INTERVAL_MS = 5_000;

/**
 * The probe backoff is only reset once the connection stayed up this long;
 * a drop right after a reconnect keeps growing the backoff instead.
 */
export const STABLE_ONLINE_MS = 30_000;

/** `Date.now()` of the last offline → online edge (-∞ = online since start). */
let onlineSince = Number.NEGATIVE_INFINITY;
/** `Date.now()` of the last reconnect notification. */
let lastReconnectAt = Number.NEGATIVE_INFINITY;
/** Pending (throttled) reconnect notification. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Run every reconnect listener (each isolated from the others' errors). */
function notifyReconnect(): void {
  lastReconnectAt = Date.now();
  for (const cb of reconnectListeners) {
    try { cb(); }
    catch (err) { console.warn('[connectivity] reconnect listener failed:', err); }
  }
}

/**
 * Notify reconnect listeners now, or — within `RECONNECT_MIN_INTERVAL_MS` of
 * the last notification — once the interval has passed, if still online.
 */
function scheduleReconnect(): void {
  const wait = lastReconnectAt + RECONNECT_MIN_INTERVAL_MS - Date.now();
  if (wait <= 0) { notifyReconnect(); return; }
  if (reconnectTimer != null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (online.value) notifyReconnect();
  }, wait);
}

/** Switch state and notify reconnect listeners on an offline → online edge. */
function setOnline(next: boolean): void {
  const wasOnline = online.value;
  online.value = next;
  // Online → offline: start the (optional) recovery probe, see setConnectivityProbe.
  if (wasOnline && !next) startProbing();
  if (!wasOnline && next) {
    onlineSince = Date.now();
    scheduleReconnect();
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

/**
 * TypeError messages of programming errors (not network failures), e.g.
 * "x is not a function", "Cannot read properties of undefined".
 */
const CODE_BUG_TYPE_ERROR = /is not a (?:function|constructor)|is not iterable|cannot (?:read|set|convert|destructure)|of (?:undefined|null)\b|(?:undefined|null) is not|is read-only|not extensible|is not defined/i;

/** True when an error looks like a network failure rather than an HTTP error. */
export function isNetworkError(err: unknown): boolean {
  // fetch() rejects with TypeError when offline ("Failed to fetch", "Load
  // failed", "NetworkError …", "fetch failed"). Wrappers may rethrow other
  // messages as TypeError, so every TypeError counts — except obvious code
  // bugs, which would otherwise flap the app offline/online forever.
  if (err instanceof TypeError) return !CODE_BUG_TYPE_ERROR.test(err.message);
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

/**
 * Schedule the first probe after going offline. The backoff restarts only
 * when the connection had been stable (`STABLE_ONLINE_MS`); quick flaps keep
 * growing it, so a persistent failure cannot cause ~1 s offline/online cycles.
 */
function startProbing(): void {
  if (Date.now() - onlineSince >= STABLE_ONLINE_MS) probeAttempt = 0;
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
