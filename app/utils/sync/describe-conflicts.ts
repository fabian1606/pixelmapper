import type { ProjectSnapshot, SerializedNode } from '~/utils/engine/serialize';
import type { ModifierInstance } from '~/utils/engine/types';
import type { EntityId, MergeConflict } from '~/utils/sync/merge/types';
import type { SyncConflictItem } from '~/utils/sync/sync-conflicts';

/**
 * Turns sync conflicts (ADR 0004 D17) into short human-readable lines for
 * the conflict toast, e.g. `Effect "Rainbow": speed` or `BPM`.
 *
 * Pure TS: no Vue, no stores. Modifier names come from plugin manifests, so
 * callers may pass a `modifierName` resolver; without it effects fall back
 * to a short id.
 */

// ── Options & constants ──────────────────────────────────────────────────────

/** Optional resolvers for names that are not stored in the snapshot. */
export interface DescribeConflictsOptions {
  /** Display name of an effect (modifier instance). */
  modifierName?: (m: ModifierInstance) => string;
  /** Maximum number of lines before "and N more" (default 8). */
  maxLines?: number;
}

/** Default line cap of the toast. */
const DEFAULT_MAX_LINES = 8;

/** Container keys that never describe a field by themselves. */
const STRUCTURAL_KEYS = new Set([
  'livePages', 'widgets', 'sections', 'sceneNodes', 'children', 'savedPresets',
  'modifiers', 'params', 'config', 'kind', 'extensionData', 'fixture', 'group', 'node', '',
]);

/** Field keys with a friendlier label than their camelCase split. */
const FIELD_ALIASES: Record<string, string> = {
  globalBpm: 'BPM',
  fixturePosition: 'position',
  positionZ: 'position',
  x: 'position',
  y: 'position',
  z: 'position',
  tiltX: 'rotation',
  rollZ: 'rotation',
  startAddress: 'DMX address',
  selectedPresetId: 'active preset',
};

/** Entity domain a change type belongs to. */
type Domain = 'effect' | 'preset' | 'live' | 'engine' | 'scene' | 'unknown';

/** A resolved entity: kind noun plus name. */
interface EntityLabel { noun: string; name: string }

// ── Domain & entity resolution ───────────────────────────────────────────────

/** Maps a command / live-op type onto its entity domain. */
function domainOf(changeType: string): Domain {
  if (changeType === 'SetModifiers' || changeType.startsWith('modifier.')) return 'effect';
  if (/Preset$/.test(changeType) || changeType.startsWith('preset.') || changeType === 'color.override') return 'preset';
  if (changeType.startsWith('live.') || changeType.startsWith('section.')) return 'live';
  if (changeType.startsWith('engine.')) return 'engine';
  if (/Fixture|Node|Dmx|Channel|ExtensionData/.test(changeType) || /^(fixture|channel|scene)\./.test(changeType)) return 'scene';
  return 'unknown';
}

/** Short form of an id for entities without a resolvable name. */
function shortId(id: EntityId): string {
  return String(id).slice(0, 8);
}

/** Depth-first search of a scene node (fixtures and groups) by id. */
function findNode(nodes: SerializedNode[] | undefined, id: EntityId): SerializedNode | undefined {
  for (const n of nodes ?? []) {
    if (String(n.id) === String(id)) return n;
    if (n._type === 'group') {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Effect label; uses the optional manifest-based resolver. */
function effectLabel(state: ProjectSnapshot, id: EntityId, opts: DescribeConflictsOptions): EntityLabel | undefined {
  const m = (state.modifiers ?? []).find(x => String(x.id) === String(id));
  if (!m) return undefined;
  let name = shortId(id);
  try { if (opts.modifierName) name = opts.modifierName(m); }
  catch (err) { console.warn('[sync] modifier name lookup failed:', err); }
  return { noun: 'Effect', name };
}

/** Scene node label (fixture or group). */
function sceneLabel(state: ProjectSnapshot, id: EntityId): EntityLabel | undefined {
  const n = findNode(state.sceneNodes, id);
  if (!n) return undefined;
  return { noun: n._type === 'group' ? 'Group' : 'Fixture', name: n.name || shortId(id) };
}

/** Preset label. */
function presetLabel(state: ProjectSnapshot, id: EntityId): EntityLabel | undefined {
  const p = (state.savedPresets ?? []).find(x => String(x.id) === String(id));
  return p ? { noun: 'Preset', name: p.name || shortId(id) } : undefined;
}

/** Live page, widget or section label. */
function liveLabel(state: ProjectSnapshot, id: EntityId): EntityLabel | undefined {
  for (const page of state.livePages ?? []) {
    if (page.id === String(id)) return { noun: 'Live page', name: page.name || shortId(id) };
    const w = page.widgets?.find(x => x.id === String(id));
    if (w) return { noun: 'Live widget', name: w.label || w.type || shortId(id) };
    const s = page.sections?.find(x => x.id === String(id));
    if (s) return { noun: 'Live section', name: s.name || shortId(id) };
  }
  return undefined;
}

/** Fallback noun of a domain when the entity cannot be found. */
const DOMAIN_NOUNS: Record<Domain, string> = {
  effect: 'Effect', preset: 'Preset', live: 'Live item', engine: 'Setting', scene: 'Fixture', unknown: 'Item',
};

/** Resolves the conflict's entity in the domain of its change type. */
function resolveEntity(domain: Domain, state: ProjectSnapshot, id: EntityId, opts: DescribeConflictsOptions): EntityLabel {
  const lookups: Record<Domain, Array<() => EntityLabel | undefined>> = {
    effect: [() => effectLabel(state, id, opts)],
    preset: [() => presetLabel(state, id)],
    live: [() => liveLabel(state, id)],
    scene: [() => sceneLabel(state, id)],
    engine: [],
    // Unknown (e.g. extension commands): try every domain.
    unknown: [() => sceneLabel(state, id), () => effectLabel(state, id, opts), () => presetLabel(state, id), () => liveLabel(state, id)],
  };
  for (const lookup of lookups[domain]) {
    const hit = lookup();
    if (hit) return hit;
  }
  return { noun: DOMAIN_NOUNS[domain], name: shortId(id) };
}

// ── Paths ────────────────────────────────────────────────────────────────────

/** camelCase / snake_case → lower-case words. */
function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim();
}

/** All entity ids of the snapshot, used to drop ids from conflict paths. */
function collectIds(state: ProjectSnapshot): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: SerializedNode[] | undefined): void => {
    for (const n of nodes ?? []) {
      ids.add(String(n.id));
      if (n._type === 'group') walk(n.children);
    }
  };
  walk(state.sceneNodes);
  for (const m of state.modifiers ?? []) ids.add(String(m.id));
  for (const p of state.savedPresets ?? []) ids.add(String(p.id));
  for (const page of state.livePages ?? []) {
    ids.add(page.id);
    for (const w of page.widgets ?? []) ids.add(w.id);
    for (const s of page.sections ?? []) ids.add(s.id);
  }
  return ids;
}

/** True for segments that are ids or indices rather than field names. */
function isIdSegment(seg: EntityId, entityId: EntityId | null, ids: Set<string>): boolean {
  if (typeof seg === 'number') return true;
  if (entityId !== null && seg === String(entityId)) return true;
  if (ids.has(seg)) return true;
  if (/^\d+$/.test(seg)) return true;
  // UUIDs and other opaque ids (long tokens containing digits).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || (seg.length >= 12 && /\d/.test(seg) && !/[A-Z]/.test(seg));
}

/** Readable field label of a conflict, or null if the path names no field. */
function fieldLabel(conflict: MergeConflict, ids: Set<string>): string | null {
  if (conflict.kind === 'order') return 'order';
  if (conflict.kind === 'remove-modify' && conflict.path.every(s => isIdSegment(s, conflict.entityId, ids) || STRUCTURAL_KEYS.has(String(s)))) {
    return 'kept although deleted elsewhere';
  }
  // The first meaningful key is the field the user edited (`params.speed` → speed).
  const key = conflict.path.find(s => !isIdSegment(s, conflict.entityId, ids) && !STRUCTURAL_KEYS.has(String(s)));
  if (key === undefined) return null;
  return FIELD_ALIASES[String(key)] ?? humanize(String(key));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Describes one conflict as a single line. */
function describeOne(item: SyncConflictItem, state: ProjectSnapshot, ids: Set<string>, opts: DescribeConflictsOptions): string {
  const { conflict } = item;
  const domain = domainOf(item.changeType);
  const field = fieldLabel(conflict, ids);
  // Global values (no entity), e.g. BPM.
  if (conflict.entityId === null || conflict.entityId === undefined) {
    if (!field) return DOMAIN_NOUNS[domain];
    return field === 'BPM' ? field : field.charAt(0).toUpperCase() + field.slice(1);
  }
  const entity = resolveEntity(domain, state, conflict.entityId, opts);
  const head = `${entity.noun} "${entity.name}"`;
  return field ? `${head}: ${field}` : head;
}

/**
 * Human-readable, de-duplicated lines for a conflict report, capped at
 * `maxLines` plus an "and N more" line.
 */
export function describeConflicts(items: SyncConflictItem[], state: ProjectSnapshot, opts: DescribeConflictsOptions = {}): string[] {
  const max = opts.maxLines ?? DEFAULT_MAX_LINES;
  const ids = collectIds(state);
  const lines: string[] = [];
  for (const item of items) {
    const line = describeOne(item, state, ids, opts);
    if (!lines.includes(line)) lines.push(line);
  }
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `and ${lines.length - max} more`];
}
