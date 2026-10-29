import { backoffDelay, isOnline, onReconnect } from '~/utils/sync/connectivity';

/**
 * Drives background mirroring (ADR 0004 D13, D9): a pass on start, on every
 * reconnect and periodically; failures retry with exponential backoff; no
 * timer runs while offline. Passes never overlap — a trigger during a pass
 * schedules exactly one follow-up pass.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface MirrorSchedulerOptions {
  /** One pass; resolves true on success, false to retry with backoff. Must not throw (errors count as failure). */
  runPass: () => Promise<boolean>;
  /** Regular interval after a successful pass (default 5 min). */
  intervalMs?: number;
  /** Connectivity seam (tests). */
  isOnline?: () => boolean;
  onReconnect?: (cb: () => void) => () => void;
  backoff?: (attempt: number) => number;
}

export interface MirrorScheduler {
  /** Starts (idempotent) and runs a pass right away. */
  start(): void;
  /** Stops timers and listeners; a running pass finishes but schedules nothing. */
  stop(): void;
  /** Runs a pass now (or right after the running one). */
  trigger(): void;
  /** Resolves when no pass is running (tests). */
  whenIdle(): Promise<void>;
}

export const MIRROR_INTERVAL_MS = 5 * 60_000;

// ── Implementation ───────────────────────────────────────────────────────────

/** Creates a stopped scheduler. */
export function createMirrorScheduler(opts: MirrorSchedulerOptions): MirrorScheduler {
  const interval = opts.intervalMs ?? MIRROR_INTERVAL_MS;
  const online = opts.isOnline ?? (() => isOnline.value);
  const subscribe = opts.onReconnect ?? onReconnect;
  const delayFor = opts.backoff ?? backoffDelay;

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let current: Promise<void> | null = null;
  let rerun = false;
  let attempt = 0;

  /** Clears the pending timer. */
  function clearTimer(): void {
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  /** Schedules the next pass; offline waits for the reconnect listener instead. */
  function schedule(delay: number): void {
    clearTimer();
    if (!running || !online()) return;
    timer = setTimeout(() => { timer = null; trigger(); }, delay);
  }

  /** Runs one pass and schedules the next one. */
  async function pass(): Promise<void> {
    let ok = false;
    try { ok = await opts.runPass(); }
    catch (err) {
      console.warn('[mirror] pass failed:', err);
      ok = false;
    }
    if (ok) attempt = 0;
    if (!running) return;
    schedule(ok ? interval : delayFor(attempt++));
  }

  /** Runs a pass unless one is running (then queue one follow-up). */
  function trigger(): void {
    if (!running) return;
    if (current) {
      rerun = true;
      return;
    }
    if (!online()) return;
    clearTimer();
    current = pass().finally(() => {
      current = null;
      if (rerun) {
        rerun = false;
        trigger();
      }
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      unsubscribe = subscribe(() => {
        attempt = 0;
        trigger();
      });
      trigger();
    },
    stop() {
      running = false;
      rerun = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
    },
    trigger,
    async whenIdle() {
      while (current) await current;
    },
  };
}
