// ── snapshot-preview: highlights normalization (migration 015) ──────────────
//
// Pure functions (no Deno/Supabase imports), unit-tested with
// `bun test supabase/functions/_shared`. Re-validates the result of
// `snapshot_preview_highlights` before `snapshot-preview` returns it:
// malformed items are dropped, counts clamped, layout indices outside the
// returned layout removed. The wire shape is the one of the RPC (see the
// header of 015 and the client's `highlight-types.ts`).

import { isPlainObject, isUuid } from './validate.ts';

// ── Constants ────────────────────────────────────────────────────────────────

/** Highlight categories (one chip each on the client). */
export const HIGHLIGHT_KINDS = ['live', 'effect', 'preset', 'fixtures', 'settings'] as const;

/** Upper bound of any list in the highlights (the RPC caps far below). */
const MAX_LIST = 1000;

// ── Wire types ───────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
export type HighlightKind = typeof HIGHLIGHT_KINDS[number];
export type ItemStatus = 'added' | 'changed';

/** Entity counts of one category (`moved` / `groups` for fixtures only). */
export interface HighlightCounts { added: number; changed: number; removed: number; moved?: number; groups?: number }
/** A removed entity (`name` = plugin hash for modifiers). */
export interface RemovedEntity { id: string; name: string }
/** A removed live widget. */
export interface RemovedWidget { id: string; type: string; label: string }

export interface LivePageItem {
  status: ItemStatus;
  page: Json;
  widgets: { added: string[]; changed: string[]; removed: RemovedWidget[] };
  sectionsChanged: boolean;
}
export interface EffectItem { status: ItemStatus; modifier: Json; changedKeys: string[]; before: Json }
export interface PresetItem { status: ItemStatus; preset: Json; changedKeys: string[] }

export interface SnapshotHighlights {
  previousId: string | null;
  categories: Partial<Record<HighlightKind, HighlightCounts>>;
  live: { pages: LivePageItem[]; removed: RemovedEntity[] };
  effects: { items: EffectItem[]; removed: RemovedEntity[] };
  presets: { items: PresetItem[]; removed: RemovedEntity[] };
  fixtures: { added: number[]; changed: number[]; moved: number[]; removed: number };
  fixtureIndex: Record<string, number>;
  settings: string[];
  truncated: boolean;
}

// ── Primitive helpers ────────────────────────────────────────────────────────

/** Non-negative integer count (anything else → 0). */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Array items mapped through `fn`, dropping `null`s, capped. */
function list<T>(raw: unknown, fn: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_LIST).map(fn).filter((v): v is T => v !== null);
}

/** String or null. */
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 'added' | 'changed' or null. */
const status = (v: unknown): ItemStatus | null => (v === 'added' || v === 'changed' ? v : null);

/** Valid layout index (integer in [0, layoutCount)) or null. */
function layoutIndex(v: unknown, layoutCount: number): number | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < layoutCount ? v as number : null;
}

/** `{ id, name }` with string id; name defaults to ''. */
function removedEntity(v: unknown): RemovedEntity | null {
  if (!isPlainObject(v) || typeof v.id !== 'string') return null;
  return { id: v.id, name: str(v.name) ?? '' };
}

// ── Sections ─────────────────────────────────────────────────────────────────

/** Category counts of the known kinds; other keys / non-objects dropped. */
function normalizeCategories(raw: unknown): SnapshotHighlights['categories'] {
  const out: SnapshotHighlights['categories'] = {};
  if (!isPlainObject(raw)) return out;
  for (const kind of HIGHLIGHT_KINDS) {
    const c = raw[kind];
    if (!isPlainObject(c)) continue;
    const counts: HighlightCounts = { added: count(c.added), changed: count(c.changed), removed: count(c.removed) };
    if (kind === 'fixtures') {
      counts.moved = Math.min(count(c.moved), counts.changed);
      counts.groups = count(c.groups);
    }
    out[kind] = counts;
  }
  return out;
}

/** One live page item; null when status / page / page id are invalid. */
function livePage(v: unknown): LivePageItem | null {
  if (!isPlainObject(v) || !status(v.status) || !isPlainObject(v.page) || typeof v.page.id !== 'string') return null;
  const w = isPlainObject(v.widgets) ? v.widgets : {};
  return {
    status: status(v.status)!,
    page: v.page,
    widgets: {
      added: list(w.added, str),
      changed: list(w.changed, str),
      removed: list(w.removed, r => (isPlainObject(r) && typeof r.id === 'string'
        ? { id: r.id, type: str(r.type) ?? '', label: str(r.label) ?? '' }
        : null)),
    },
    sectionsChanged: v.sectionsChanged === true,
  };
}

/** One effect item; null when status / modifier / modifier id are invalid. */
function effectItem(v: unknown): EffectItem | null {
  if (!isPlainObject(v) || !status(v.status) || !isPlainObject(v.modifier) || typeof v.modifier.id !== 'string') return null;
  return {
    status: status(v.status)!,
    modifier: v.modifier,
    changedKeys: list(v.changedKeys, str),
    before: isPlainObject(v.before) ? v.before : {},
  };
}

/** One preset item; null when status / preset / preset id are invalid. */
function presetItem(v: unknown): PresetItem | null {
  if (!isPlainObject(v) || !status(v.status) || !isPlainObject(v.preset) || typeof v.preset.id !== 'string') return null;
  return { status: status(v.status)!, preset: v.preset, changedKeys: list(v.changedKeys, str) };
}

/** `{ items, removed }` of an entity section. */
function section<T>(raw: unknown, itemKey: string, fn: (v: unknown) => T | null) {
  const obj = isPlainObject(raw) ? raw : {};
  return { items: list(obj[itemKey], fn), removed: list(obj.removed, removedEntity) };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Defensive mapping of the `snapshot_preview_highlights` result. `layoutCount`
 * = number of fixtures in the returned layout (indices must point into it).
 * `null` when the result is not an object (snapshot not found / RPC missing).
 */
export function normalizeHighlights(raw: unknown, layoutCount: number): SnapshotHighlights | null {
  if (!isPlainObject(raw)) return null;
  const idx = (v: unknown) => layoutIndex(v, layoutCount);
  const fx = isPlainObject(raw.fixtures) ? raw.fixtures : {};
  const changed = list(fx.changed, idx);
  const fixtureIndex: Record<string, number> = {};
  if (isPlainObject(raw.fixtureIndex)) {
    for (const [id, v] of Object.entries(raw.fixtureIndex).slice(0, MAX_LIST)) {
      const i = idx(v);
      if (i !== null) fixtureIndex[id] = i;
    }
  }
  const live = section(raw.live, 'pages', livePage);
  return {
    previousId: isUuid(raw.previousId) ? raw.previousId.toLowerCase() : null,
    categories: normalizeCategories(raw.categories),
    live: { pages: live.items, removed: live.removed },
    effects: section(raw.effects, 'items', effectItem),
    presets: section(raw.presets, 'items', presetItem),
    fixtures: {
      added: list(fx.added, idx),
      changed,
      // moved ⊆ changed.
      moved: list(fx.moved, idx).filter(i => changed.includes(i)),
      removed: count(fx.removed),
    },
    fixtureIndex,
    settings: list(raw.settings, str),
    truncated: raw.truncated === true,
  };
}
