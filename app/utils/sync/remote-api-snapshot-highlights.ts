import type { ModifierInstance } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import type { LivePage } from '~/utils/live/types';
import type {
  EffectHighlight,
  FixtureHighlight,
  HighlightCounts,
  HighlightKind,
  LivePageHighlight,
  PresetHighlight,
  RemovedEntity,
  RemovedWidget,
  SnapshotHighlights,
} from '~/utils/sync/version-preview/highlight-types';

/**
 * Parsing of the `highlights` part of the `snapshot-preview` response
 * (migration 015): what changed compared with the previous version. Fully
 * defensive — malformed items are dropped, a malformed block yields `null`
 * (the card then falls back to the plain layout preview). Entity payloads
 * (live pages, modifiers, presets) are shallow-checked only: renderers treat
 * them as untrusted snapshot JSON anyway.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const KINDS: HighlightKind[] = ['live', 'effect', 'preset', 'fixtures', 'settings'];

/** Plain object or null. */
function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Array or empty array. */
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Non-negative integer or 0. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Strings of a list (numbers converted: fixture / widget ids may be numeric). */
function ids(value: unknown): string[] {
  return arr(value)
    .filter(v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
    .map(String);
}

/** Valid layout indices (< `layoutSize`), deduplicated. */
function indices(value: unknown, layoutSize: number): number[] {
  const out = new Set<number>();
  for (const v of arr(value)) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < layoutSize) out.add(v);
  }
  return [...out];
}

const status = (v: unknown): 'added' | 'changed' | null => (v === 'added' || v === 'changed' ? v : null);

/** `{ id, name }` entries; id required. */
function removedList(value: unknown): RemovedEntity[] {
  return arr(value).flatMap((raw) => {
    const r = rec(raw);
    if (!r || (typeof r.id !== 'string' && typeof r.id !== 'number')) return [];
    return [{ id: String(r.id), name: typeof r.name === 'string' ? r.name : '' }];
  });
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function parseCounts(raw: unknown): Partial<Record<HighlightKind, HighlightCounts>> {
  const r = rec(raw) ?? {};
  const out: Partial<Record<HighlightKind, HighlightCounts>> = {};
  for (const kind of KINDS) {
    const c = rec(r[kind]);
    if (!c) continue;
    const counts: HighlightCounts = { added: count(c.added), changed: count(c.changed), removed: count(c.removed) };
    if (kind === 'fixtures') {
      counts.moved = count(c.moved);
      counts.groups = count(c.groups);
    }
    // A kind with only zeros counts as unchanged.
    if (counts.added + counts.changed + counts.removed + (counts.groups ?? 0) > 0) out[kind] = counts;
  }
  return out;
}

function parseLivePage(raw: unknown): LivePageHighlight | null {
  const r = rec(raw);
  const page = rec(r?.page);
  const st = status(r?.status);
  if (!r || !page || !st || typeof page.id !== 'string' || !Array.isArray(page.widgets)) return null;
  const w = rec(r.widgets) ?? {};
  const removedWidgets: RemovedWidget[] = arr(w.removed).flatMap((x) => {
    const e = rec(x);
    if (!e || typeof e.id !== 'string') return [];
    return [{ id: e.id, type: typeof e.type === 'string' ? e.type : '', label: typeof e.label === 'string' ? e.label : '' }];
  });
  return {
    status: st,
    page: page as unknown as LivePage,
    addedWidgets: ids(w.added),
    changedWidgets: ids(w.changed),
    removedWidgets,
    sectionsChanged: r.sectionsChanged === true,
  };
}

function parseEffect(raw: unknown): EffectHighlight | null {
  const r = rec(raw);
  const m = rec(r?.modifier);
  const st = status(r?.status);
  if (!r || !m || !st || typeof m.id !== 'string' || typeof m.plugin !== 'string') return null;
  return {
    status: st,
    modifier: m as unknown as ModifierInstance,
    changedKeys: arr(r.changedKeys).filter((k): k is string => typeof k === 'string'),
    before: rec(r.before) ?? {},
  };
}

function parsePreset(raw: unknown): PresetHighlight | null {
  const r = rec(raw);
  const p = rec(r?.preset);
  const st = status(r?.status);
  if (!r || !p || !st || typeof p.id !== 'string') return null;
  return {
    status: st,
    preset: p as unknown as Preset,
    changedKeys: arr(r.changedKeys).filter((k): k is string => typeof k === 'string'),
  };
}

function parseFixtures(raw: unknown, layoutSize: number): FixtureHighlight {
  const r = rec(raw) ?? {};
  return {
    added: indices(r.added, layoutSize),
    changed: indices(r.changed, layoutSize),
    // Contract: moved ⊆ changed (renderers do not rely on it).
    moved: indices(r.moved, layoutSize),
    removed: count(r.removed),
  };
}

function parseFixtureIndex(raw: unknown, layoutSize: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(rec(raw) ?? {})) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < layoutSize) out[id] = v;
  }
  return out;
}

const compact = <T>(list: Array<T | null>): T[] => list.filter((x): x is T => x !== null);

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parses `highlights`; `layoutSize` = decoded fixture count of the layout
 * (indices beyond it are dropped). `null` when absent (older server) or not
 * an object.
 */
export function parseSnapshotHighlights(raw: unknown, layoutSize: number): SnapshotHighlights | null {
  const h = rec(raw);
  if (!h) return null;
  const live = rec(h.live) ?? {};
  const effects = rec(h.effects) ?? {};
  const presets = rec(h.presets) ?? {};
  return {
    previousId: typeof h.previousId === 'string' ? h.previousId : null,
    categories: parseCounts(h.categories),
    live: { pages: compact(arr(live.pages).map(parseLivePage)), removed: removedList(live.removed) },
    effects: { items: compact(arr(effects.items).map(parseEffect)), removed: removedList(effects.removed) },
    presets: { items: compact(arr(presets.items).map(parsePreset)), removed: removedList(presets.removed) },
    fixtures: parseFixtures(h.fixtures, layoutSize),
    fixtureIndex: parseFixtureIndex(h.fixtureIndex, layoutSize),
    settings: arr(h.settings).filter((k): k is string => typeof k === 'string'),
    truncated: h.truncated === true,
  };
}
