import type { ModifierInstance } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import type { LivePage, LiveWidgetType } from '~/utils/live/types';

/**
 * Decoded "what is special about this version" part of the `snapshot-preview`
 * response (migration 015, `highlights`): the server compares the snapshot
 * with its previous list neighbour per entity (hashes in SQL) and sends the
 * changed entities only. Parsed by `remote-api-snapshot-highlights.ts`,
 * ranked by `highlight-ranking.ts`, rendered by the hover preview card.
 */

// ── Categories ───────────────────────────────────────────────────────────────

/** Preview categories, one chip each. */
export type HighlightKind = 'live' | 'effect' | 'preset' | 'fixtures' | 'settings';

/** Entity counts of one category. */
export interface HighlightCounts {
  added: number;
  changed: number;
  removed: number;
  /** Fixtures only: changed fixtures whose position / size / rotation changed. */
  moved?: number;
  /** Fixtures only: added / changed / removed groups. */
  groups?: number;
}

// ── Live view ────────────────────────────────────────────────────────────────

/** A removed widget (the page JSON no longer has it). */
export interface RemovedWidget {
  id: string;
  type: LiveWidgetType | string;
  label: string;
}

/** An added or changed live page with the widget-level diff. */
export interface LivePageHighlight {
  status: 'added' | 'changed';
  page: LivePage;
  /** Widget ids added since the previous version (all widgets of an added page). */
  addedWidgets: string[];
  /** Widget ids whose JSON changed. */
  changedWidgets: string[];
  removedWidgets: RemovedWidget[];
  /** Sections (preset sections) changed. */
  sectionsChanged: boolean;
}

// ── Effects / presets ────────────────────────────────────────────────────────

/** An added or changed modifier with its full JSON. */
export interface EffectHighlight {
  status: 'added' | 'changed';
  modifier: ModifierInstance;
  /** Changed keys: top-level (`strength`, `speed`, …) and `params.<key>`. */
  changedKeys: string[];
  /** Old values by changed key (same keys as `changedKeys`; missing when too large). */
  before: Record<string, unknown>;
}

/** An added or changed preset with its full JSON. */
export interface PresetHighlight {
  status: 'added' | 'changed';
  preset: Preset;
  changedKeys: string[];
}

/** A removed entity (name or plugin hash for display). */
export interface RemovedEntity {
  id: string;
  name: string;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Fixture changes as indices into `SnapshotLayout.fixtures`. */
export interface FixtureHighlight {
  added: number[];
  changed: number[];
  moved: number[];
  /** Removed fixtures (not drawable: they are not in this version). */
  removed: number;
}

// ── Response part ────────────────────────────────────────────────────────────

export interface SnapshotHighlights {
  /** Compared (older) snapshot; null = first version. */
  previousId: string | null;
  /** Categories with changes (absent kinds = unchanged). */
  categories: Partial<Record<HighlightKind, HighlightCounts>>;
  live: { pages: LivePageHighlight[]; removed: RemovedEntity[] };
  effects: { items: EffectHighlight[]; removed: RemovedEntity[] };
  presets: { items: PresetHighlight[]; removed: RemovedEntity[] };
  fixtures: FixtureHighlight;
  /** Fixture id (as string) → index into `SnapshotLayout.fixtures`, for ids referenced above. */
  fixtureIndex: Record<string, number>;
  /** Changed project settings (labels: "BPM", "Active preset", …). */
  settings: string[];
  /** Payloads were dropped to stay under the size cap. */
  truncated: boolean;
}
