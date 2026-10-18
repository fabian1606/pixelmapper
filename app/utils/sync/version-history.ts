import type { SnapshotListEntry, SnapshotSummary } from '~/utils/sync/remote-api-snapshots';

/**
 * Pure view logic of the version history (ADR 0004 D17): label badges,
 * summary text and collapsing of consecutive autosaves.
 */

// ── Labels ───────────────────────────────────────────────────────────────────

/** Category of a snapshot label (drives the badge). */
export type SnapshotKind = 'autosave' | 'before-sync' | 'uploaded' | 'imported' | 'restored' | 'named';

/** Badge text and variant per kind (`named` shows the label itself). */
export interface SnapshotBadge {
  text: string;
  variant: 'default' | 'secondary' | 'outline';
}

/** Label of the D5 safety snapshot (`BEFORE_SYNC_LABEL` in sync-push.ts). */
const BEFORE_SYNC = 'before offline sync';
/** Prefix written by the `restore_snapshot` RPC (migration 009). */
const RESTORED_PREFIX = 'Restored from snapshot';

/** Classify a snapshot label. */
export function snapshotKind(label: string | null): SnapshotKind {
  if (!label) return 'autosave';
  if (label === BEFORE_SYNC) return 'before-sync';
  if (label === 'Uploaded') return 'uploaded';
  if (label === 'Imported') return 'imported';
  if (label.startsWith(RESTORED_PREFIX)) return 'restored';
  return 'named';
}

/** Badge for a label. */
export function snapshotBadge(label: string | null): SnapshotBadge {
  switch (snapshotKind(label)) {
    case 'autosave': return { text: 'Autosave', variant: 'outline' };
    case 'before-sync': return { text: 'Before offline sync', variant: 'secondary' };
    case 'uploaded': return { text: 'Uploaded', variant: 'secondary' };
    case 'imported': return { text: 'Imported', variant: 'secondary' };
    case 'restored': return { text: 'Restored', variant: 'default' };
    default: return { text: label ?? '', variant: 'secondary' };
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

/** "1 fixture" / "3 fixtures". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "12 fixtures · 2 groups · 3 modifiers" (groups omitted when 0). */
export function formatSummary(s: SnapshotSummary): string {
  const parts = [plural(s.fixtures, 'fixture')];
  if (s.groups > 0) parts.push(plural(s.groups, 'group'));
  parts.push(plural(s.modifiers, 'modifier'));
  return parts.join(' · ');
}

// ── Collapsing autosaves ─────────────────────────────────────────────────────

/** A row of the rendered list. */
export type VersionRow =
  | { type: 'entry'; entry: SnapshotListEntry }
  | { type: 'collapsed'; key: string; count: number };

/**
 * Collapse runs of consecutive autosaves: the newest of a run stays
 * visible, the older ones become one `collapsed` row (key = id of the first
 * hidden entry) unless that key is in `expanded`. Runs shorter than 3 are
 * never collapsed (a "1 more" row saves nothing).
 */
export function collapseAutosaves(entries: SnapshotListEntry[], expanded: ReadonlySet<string>): VersionRow[] {
  const rows: VersionRow[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i]!;
    if (snapshotKind(entry.label) !== 'autosave') {
      rows.push({ type: 'entry', entry });
      i++;
      continue;
    }
    // Find the end of this autosave run.
    let end = i + 1;
    while (end < entries.length && snapshotKind(entries[end]!.label) === 'autosave') end++;
    rows.push({ type: 'entry', entry });
    const hidden = entries.slice(i + 1, end);
    const key = hidden[0]?.id;
    if (hidden.length >= 2 && key && !expanded.has(key)) {
      rows.push({ type: 'collapsed', key, count: hidden.length });
    }
    else {
      for (const h of hidden) rows.push({ type: 'entry', entry: h });
    }
    i = end;
  }
  return rows;
}
