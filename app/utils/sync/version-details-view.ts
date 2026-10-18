import type { SnapshotDetails } from '~/utils/sync/remote-api-snapshot-details';
import { formatAuthorActivity, formatRestore, restoredVersionText, restoredSequenceFromLabel, summarizeActivity } from '~/utils/sync/version-activity';
import { diffSnapshots, type DiffOptions, type KindDiff, type SnapshotDiff } from '~/utils/sync/version-diff';

/**
 * View model of an expanded version-history entry: the structural diff to
 * the previous version as capped, grouped lines, plus the activity between
 * the two versions. Pure; cached per (project, snapshot) by the controller.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DetailLineKind = 'added' | 'removed' | 'changed' | 'info';

export interface DetailLine {
  kind: DetailLineKind;
  text: string;
}

/** One group of lines ("Fixtures", "Effects", …). */
export interface DetailSection {
  title: string;
  lines: DetailLine[];
  /** Lines hidden by the cap ("+N more"). */
  more: number;
}

export interface VersionDetailsView {
  /** No older version to compare with. */
  first: boolean;
  /** "Restored the version from …" for restored entries, if known. */
  restoredFrom: string | null;
  sections: DetailSection[];
  /** Compared, but nothing structural changed. */
  noChanges: boolean;
  /** One line per author: "Ada · 3× Move fixture". */
  activity: string[];
  /** Restore markers between the versions. */
  restores: string[];
}

/** Lines shown per section before "+N more". */
export const DETAIL_LINE_CAP = 8;

// ── Building ─────────────────────────────────────────────────────────────────

/** Lines of one entity kind: added, removed, changed, order. */
function kindLines(d: KindDiff): DetailLine[] {
  const lines: DetailLine[] = [
    ...d.added.map(e => ({ kind: 'added' as const, text: e.name })),
    ...d.removed.map(e => ({ kind: 'removed' as const, text: e.name })),
    ...d.changed.map(c => ({
      kind: 'changed' as const,
      text: `${c.name}${c.previousName ? ` (was ${c.previousName})` : ''}: ${c.fields.join(', ')}`,
    })),
  ];
  if (d.reordered) lines.push({ kind: 'info', text: 'Order changed' });
  return lines;
}

/** Caps a section's lines. */
export function capLines(title: string, lines: DetailLine[], cap = DETAIL_LINE_CAP): DetailSection {
  return { title, lines: lines.slice(0, cap), more: Math.max(0, lines.length - cap) };
}

/** Sections of a diff, empty ones omitted, in a fixed order. */
export function diffSections(diff: SnapshotDiff, cap = DETAIL_LINE_CAP): DetailSection[] {
  const groups: [string, DetailLine[]][] = [
    ['Fixtures', kindLines(diff.fixtures)],
    ['Groups', kindLines(diff.groups)],
    ['Effects', kindLines(diff.modifiers)],
    ['Presets', kindLines(diff.presets)],
    ['Live pages', kindLines(diff.livePages)],
    ['Project settings', diff.settings.map(s => ({
      kind: 'changed' as const,
      text: s.from !== undefined && s.to !== undefined ? `${s.label}: ${s.from} → ${s.to}` : s.label,
    }))],
  ];
  return groups.filter(([, lines]) => lines.length).map(([title, lines]) => capLines(title, lines, cap));
}

/** Text of the restore that produced the snapshot (marker, else its label). */
function restoredFromText(details: SnapshotDetails): string | null {
  if (details.restoredFrom) return `Restored ${restoredVersionText(details.restoredFrom)}`;
  const seq = restoredSequenceFromLabel(details.snapshot.label);
  return seq === null ? null : `Restored ${restoredVersionText({ sourceCreatedAt: null, sourceSequence: seq })}`;
}

/** Builds the view model from the server response. */
export function buildVersionDetailsView(details: SnapshotDetails, options: DiffOptions = {}): VersionDetailsView {
  const restoredFrom = restoredFromText(details);
  if (!details.previous) {
    return { first: true, restoredFrom, sections: [], noChanges: false, activity: [], restores: [] };
  }
  const diff = diffSnapshots(details.previous.data, details.snapshot.data, options);
  return {
    first: false,
    restoredFrom,
    sections: diffSections(diff),
    noChanges: diff.empty,
    activity: summarizeActivity(details.activity).map(formatAuthorActivity),
    restores: details.restores.map(formatRestore),
  };
}
