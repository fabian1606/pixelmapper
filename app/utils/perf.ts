/**
 * Lightweight wrapper around the User Timing API for tracing hot paths
 * (preset apply, color override, packet build, engine flush, worker frame).
 *
 * Marks/measures show up in Chrome DevTools → Performance under "Timings".
 * Disabled in production builds — set PERF_TRACE=0 to disable globally.
 */

const ENABLED = typeof performance !== 'undefined' && typeof performance.mark === 'function';

/** Stamp a point in time. Cheap (~µs); safe to sprinkle. */
export function mark(name: string): void {
  if (!ENABLED) return;
  try { performance.mark(name); } catch {}
}

/** Measure between two existing marks. */
export function measure(name: string, startMark: string, endMark: string): void {
  if (!ENABLED) return;
  try { performance.measure(name, startMark, endMark); } catch {}
}

/**
 * Time a synchronous function call. Returns the function's result.
 * Adds a `<name>.start` / `<name>.end` mark + `<name>` measure.
 */
export function trace<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const startMark = `${name}.start`;
  const endMark = `${name}.end`;
  try { performance.mark(startMark); } catch {}
  try {
    return fn();
  } finally {
    try {
      performance.mark(endMark);
      performance.measure(name, startMark, endMark);
    } catch {}
  }
}

/**
 * Console-friendly summary of all measures matching a prefix. Call from the
 * DevTools console: `window.__perfDump('preset')` after a few preset switches.
 */
export function dump(prefix: string): void {
  if (!ENABLED) return;
  const entries = performance.getEntriesByType('measure')
    .filter(e => e.name.startsWith(prefix))
    .map(e => ({ name: e.name, durationMs: +e.duration.toFixed(2), startTimeMs: +e.startTime.toFixed(2) }));
  console.table(entries);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __perfDump?: typeof dump }).__perfDump = dump;
}
