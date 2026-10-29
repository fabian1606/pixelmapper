/**
 * Time formatting for the sync UI (status indicator, version history).
 */

/** "just now", "2 min ago", "3 h ago", "4 days ago". */
export function relativeTime(ts: number, at: number): string {
  const s = Math.max(0, Math.round((at - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** Absolute local date + time, e.g. "Oct 18, 2026, 10:42". Empty for invalid input. */
export function absoluteTime(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
