import type { HighlightCounts, HighlightKind, SnapshotHighlights } from '~/utils/sync/version-preview/highlight-types';

/**
 * Which change of a version the hover preview shows (pure).
 *
 * Ranking rule (WP-SYNC "Hover preview"):
 *   1. Fixed priority: live view > effect > preset > fixtures (what a user
 *      most likely remembers a version by; the layout is always visible in
 *      the other views anyway).
 *   2. Size exception: a structural rig change (≥ FIXTURE_STRUCTURAL_MIN
 *      fixtures added or removed) wins when every higher-ranked category is
 *      minor (nothing added or removed and at most one entity changed) —
 *      "patched 24 fixtures" beats "tweaked one effect param".
 * Project settings are no chip: they are mentioned as a note, and a version
 * that changed only settings shows the layout.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Chip kinds in priority order (first = most significant). */
export const CHIP_KINDS = ['live', 'effect', 'preset', 'fixtures'] as const;
export type ChipKind = typeof CHIP_KINDS[number];

/** Added + removed fixtures from which a rig change counts as structural. */
export const FIXTURE_STRUCTURAL_MIN = 5;

/** Chip captions (English UI). */
const CHIP_LABELS: Record<ChipKind, string> = {
  live: 'Live view',
  effect: 'Effects',
  preset: 'Presets',
  fixtures: 'Fixtures',
};

/** Human labels of top-level project settings keys (unknown keys are humanized). */
const SETTING_LABELS: Record<string, string> = {
  globalBpm: 'BPM',
  selectedPresetId: 'active preset',
  globalBases: 'base values',
  pinnedModifiers: 'pinned effects',
  liveControllers: 'controllers',
  activeSectionMembers: 'active section buttons',
  savedPositions: 'saved positions',
  requires: 'required extensions',
  extensionData: 'extension data',
};

// ── Types ────────────────────────────────────────────────────────────────────

/** What the card renders. `layout` = plain layout (first version / settings only), `none` = no change. */
export type PreviewView = ChipKind | 'layout' | 'none';

export interface PreviewChip {
  kind: ChipKind;
  label: string;
  /** Changed entities of the kind (added + changed + removed). */
  count: number;
}

export interface PreviewPlan {
  chips: PreviewChip[];
  /** Default view. */
  view: PreviewView;
  /** "Project settings changed: BPM, active preset" or ''. */
  settingsNote: string;
  /** No previous version. */
  first: boolean;
}

// ── Ranking ──────────────────────────────────────────────────────────────────

/** Total changed entities of a category. */
export function changeCount(c: HighlightCounts | undefined): number {
  return c ? c.added + c.changed + c.removed : 0;
}

/** A category with nothing added/removed and at most one changed entity. */
function isMinor(c: HighlightCounts): boolean {
  return c.added + c.removed === 0 && c.changed <= 1;
}

/** Default view among the chips (rule in the module comment). */
export function pickDefaultView(categories: SnapshotHighlights['categories']): ChipKind | null {
  const present = CHIP_KINDS.filter(k => categories[k] && (changeCount(categories[k]) > 0 || (k === 'fixtures' && (categories[k]!.groups ?? 0) > 0)));
  if (!present.length) return null;
  const fixtures = categories.fixtures;
  if (fixtures && fixtures.added + fixtures.removed >= FIXTURE_STRUCTURAL_MIN) {
    const higher = present.filter(k => k !== 'fixtures');
    if (higher.every(k => isMinor(categories[k]!))) return 'fixtures';
  }
  return present[0]!;
}

/** Humanizes a camelCase key ("activeSectionMembers" → "active section members"). */
function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** "Project settings changed: BPM, active preset" for the changed keys, '' for none. */
export function settingsNote(keys: string[]): string {
  if (!keys.length) return '';
  const labels = [...new Set(keys.map(k => SETTING_LABELS[k] ?? humanizeKey(k)))];
  return `Project settings changed: ${labels.join(', ')}`;
}

/** Chips + default view of a version; `null` highlights (older server) → plain layout. */
export function planPreview(h: SnapshotHighlights | null): PreviewPlan {
  if (!h) return { chips: [], view: 'layout', settingsNote: '', first: false };
  if (!h.previousId) return { chips: [], view: 'layout', settingsNote: '', first: true };
  const chips: PreviewChip[] = CHIP_KINDS
    .filter(k => h.categories[k])
    .map(k => ({
      kind: k,
      label: CHIP_LABELS[k],
      count: changeCount(h.categories[k]) + (k === 'fixtures' ? h.categories[k]!.groups ?? 0 : 0),
    }))
    .filter(c => c.count > 0);
  const note = settingsNote(h.settings);
  const view: PreviewView = pickDefaultView(h.categories) ?? (h.categories.settings || note ? 'layout' : 'none');
  return { chips, view, settingsNote: note, first: false };
}

// ── Captions ─────────────────────────────────────────────────────────────────

/** "Fixtures: 2 added · 3 moved · 1 changed · 1 removed · 2 groups changed". */
export function fixturesCaption(c: HighlightCounts | undefined): string {
  if (!c) return '';
  const moved = c.moved ?? 0;
  const parts = [
    c.added ? `${c.added} added` : '',
    moved ? `${moved} moved` : '',
    c.changed - moved > 0 ? `${c.changed - moved} changed` : '',
    c.removed ? `${c.removed} removed` : '',
    c.groups ? `${c.groups} ${c.groups === 1 ? 'group' : 'groups'} changed` : '',
  ].filter(Boolean);
  return parts.length ? `Fixtures: ${parts.join(' · ')}` : '';
}
