import { deepEqual } from '~/utils/sync/merge/values';
import { byId, entities, humanize, type Entity } from './compare';
import type { SettingChange } from './types';

/**
 * Project-level settings of the version diff: every top-level snapshot key
 * that is not an entity list. Readable scalars (BPM, active preset) carry
 * `from` / `to`; the rest only names the setting.
 */

/** Top-level keys handled as entity lists (see `diffSnapshots`). */
export const ENTITY_KEYS = ['sceneNodes', 'modifiers', 'savedPresets', 'livePages'] as const;

/**
 * Keys never reported: `clockEpoch` is rewritten on every save and has no
 * meaning to the user.
 */
const IGNORED = new Set<string>([...ENTITY_KEYS, 'clockEpoch']);

/** Labels of known settings (unknown keys use `humanize`). */
const LABELS: Record<string, string> = {
  globalBpm: 'BPM',
  selectedPresetId: 'Active preset',
  globalBases: 'Global levels',
  pinnedModifiers: 'Pinned effects',
  liveControllers: 'Live controllers',
  savedPositions: 'Saved positions',
  activeSectionMembers: 'Live selections',
  requires: 'Required extensions',
  extensionData: 'Extension data',
  schemaVersion: 'Format version',
};

/** Default BPM of a snapshot without `globalBpm` (see `deserializeProject`). */
const DEFAULT_BPM = 120;

/** Number formatted without trailing noise ("128", "127.5"). */
function num(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—';
}

/** Preset name by id in a snapshot ("None" when unset, the id when unknown). */
function presetName(snapshot: Entity, id: unknown): string {
  if (id === null || id === undefined || id === '') return 'None';
  const preset = byId(entities(snapshot.savedPresets)).get(String(id));
  return typeof preset?.name === 'string' && preset.name ? preset.name : String(id);
}

/** One setting change, with from/to for the readable ones. */
function describe(key: string, prev: Entity, next: Entity): SettingChange {
  const label = LABELS[key] ?? humanize(key).replace(/^./, c => c.toUpperCase());
  switch (key) {
    case 'globalBpm': return { label, from: num(prev[key] ?? DEFAULT_BPM), to: num(next[key] ?? DEFAULT_BPM) };
    case 'schemaVersion': return { label, from: num(prev[key]), to: num(next[key]) };
    case 'selectedPresetId': return { label, from: presetName(prev, prev[key]), to: presetName(next, next[key]) };
    default: return { label };
  }
}

/** Normalized value for comparison (defaults applied, empty == missing). */
function normalized(key: string, snapshot: Entity): unknown {
  const value = snapshot[key];
  if (key === 'globalBpm') return value ?? DEFAULT_BPM;
  if (key === 'selectedPresetId') return value ?? null;
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;
  return value;
}

/** Changed settings, in a stable order (known labels first, then unknown keys). */
export function diffSettings(prev: Entity, next: Entity): SettingChange[] {
  const keys = new Set([...Object.keys(LABELS), ...Object.keys(prev), ...Object.keys(next)]);
  const changes: SettingChange[] = [];
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    if (!(key in prev) && !(key in next)) continue;
    if (deepEqual(normalized(key, prev), normalized(key, next))) continue;
    changes.push(describe(key, prev, next));
  }
  return changes;
}
