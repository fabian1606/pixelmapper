/**
 * Single-flight sync scheduler: at most one round runs at a time (a request
 * during a round queues exactly one follow-up), local changes trigger a
 * debounced round, failed rounds retry with `backoffDelay` (ADR 0004 D9).
 *
 * While offline no round starts and no retry timer runs: a round would only
 * fail (with an expired token auth-js spends ~28 s on the refresh first).
 * The owner calls `syncNow` on reconnect (`onReconnect`), which resumes.
 */
import { backoffDelay, isOnline } from '../connectivity';

/** Options of `createSyncScheduler`. */
export interface SyncSchedulerOptions {
  /** One sync round; resolves `true` on success, `false` to retry with backoff. */
  run: () => Promise<boolean>;
  /** Delay between a local change and the round it triggers. */
  debounceMs: number;
  /** Connectivity gate (default: `isOnline` of connectivity.ts). */
  isOnline?: () => boolean;
}

/** Handle returned by `createSyncScheduler`. */
export interface SyncScheduler {
  /** Runs a round now (or joins the running one and queues a follow-up). */
  syncNow(): Promise<void>;
  /** Requests a round after the debounce delay. */
  scheduleDebounced(): void;
  /** Resolves when no round is running (without requesting one). */
  whenIdle(): Promise<void>;
  /** Restarts the backoff sequence (e.g. on reconnect). */
  resetBackoff(): void;
  /** Cancels timers; later requests are ignored. */
  dispose(): void;
}

/** Creates a scheduler around `options.run`. */
export function createSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let running: Promise<void> | null = null;
  let rerun = false;
  let disposed = false;
  // `!== false`: runtimes without `navigator.onLine` count as online.
  const online = options.isOnline ?? (() => isOnline.value !== false);

  /** Retries with exponential backoff (capped at 30 s, so no hot loop offline). */
  function scheduleRetry(): void {
    if (disposed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    // Offline: wait for the reconnect's syncNow instead of polling (D9).
    if (!online()) return;
    retryTimer = setTimeout(() => { retryTimer = null; void syncNow(); }, backoffDelay(attempt++));
  }

  /** One round plus its retry bookkeeping. */
  async function runOnce(): Promise<void> {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    let ok = false;
    try { ok = await options.run(); }
    catch (err) { console.warn('[sync-scheduler] round threw:', err); }
    if (ok) attempt = 0;
    else scheduleRetry();
  }

  function syncNow(): Promise<void> {
    // Offline: skip; the reconnect handler requests the round again.
    if (disposed || !online()) return Promise.resolve();
    if (running) { rerun = true; return running; }
    running = (async () => {
      do {
        rerun = false;
        await runOnce();
      } while (rerun && !disposed);
    })().finally(() => { running = null; });
    return running;
  }

  function scheduleDebounced(): void {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; void syncNow(); }, options.debounceMs);
  }

  async function whenIdle(): Promise<void> {
    while (running) await running;
  }

  function dispose(): void {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    debounceTimer = null;
    retryTimer = null;
  }

  return { syncNow, scheduleDebounced, whenIdle, resetBackoff: () => { attempt = 0; }, dispose };
}
