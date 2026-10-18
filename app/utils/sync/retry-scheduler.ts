/**
 * Connectivity-aware retry scheduling (ADR 0004 D9).
 *
 * Wraps the rules every network retry must follow: network failures are
 * reported to `connectivity.ts`; while offline nothing is retried on a timer
 * (the retry runs once on `onReconnect`); online failures (HTTP 5xx etc.)
 * retry with `backoffDelay(attempt)`. Used by the snapshot autosave.
 */
import {
  backoffDelay,
  isNetworkError,
  isOnline,
  onReconnect,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '~/utils/sync/connectivity';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RetryScheduler {
  /** Report a failed attempt: schedules `run` with backoff, or on reconnect when offline. */
  fail(err: unknown): void;
  /** Report a successful attempt: resets the backoff and cancels a pending retry. */
  succeed(): void;
  /** Schedule `run` for when the app is (or comes back) online, without counting a failure. */
  deferUntilOnline(): void;
  /** Cancel any pending retry (timer or reconnect wait). */
  cancel(): void;
  /** True while a retry (timer or reconnect wait) is pending. */
  readonly pending: boolean;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Create a scheduler that re-invokes `run` according to the D9 rules. */
export function createRetryScheduler(run: () => void): RetryScheduler {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeReconnect: (() => void) | null = null;

  /** Drop the timer and the reconnect subscription. */
  function cancel(): void {
    if (timer != null) { clearTimeout(timer); timer = null; }
    unsubscribeReconnect?.();
    unsubscribeReconnect = null;
  }

  /** Run once on the next offline → online transition. */
  function waitForReconnect(): void {
    if (unsubscribeReconnect) return;
    unsubscribeReconnect = onReconnect(() => {
      cancel();
      attempt = 0;
      run();
    });
  }

  return {
    fail(err: unknown): void {
      if (isNetworkError(err)) reportNetworkFailure();
      cancel();
      if (!isOnline.value) { waitForReconnect(); return; }
      timer = setTimeout(() => { timer = null; run(); }, backoffDelay(attempt++));
    },
    succeed(): void {
      attempt = 0;
      cancel();
      reportNetworkSuccess();
    },
    deferUntilOnline(): void {
      if (isOnline.value) { cancel(); run(); return; }
      waitForReconnect();
    },
    cancel,
    get pending() { return timer != null || unsubscribeReconnect != null; },
  };
}
