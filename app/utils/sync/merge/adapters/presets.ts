import type { Preset, PresetCategory } from '~/utils/engine/preset-types';
import type { MergeConflict } from '../types';
import { deepClone } from '../values';
import { registerRebaseAdapter, passThroughAdapter, type RebaseAdapter } from './registry';
import { checkOverwrite, mergeField, ok, removeConflict, skip } from './helpers';

/**
 * Rebase adapters for saved presets (`ProjectSnapshot.savedPresets`) and the
 * active preset (`selectedPresetId`).
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

/** `OverwritePreset`: whole categories array of one preset (before/after). */
interface OverwritePresetPayload {
  presetId: string;
  presetName: string;
  oldCats: PresetCategory[];
  newCats: PresetCategory[];
}

/** Metadata patch: `undefined` = untouched, `null` = delete. */
type MetadataPatch = Partial<Record<'name' | 'color' | 'type' | 'overwriteTarget', unknown>>;

/** `UpdatePresetMetadata`. */
interface UpdatePresetMetadataPayload {
  presetId: string;
  before: MetadataPatch;
  after: MetadataPatch;
}

/** `SetActivePreset` command and `preset.set` live-op. */
interface ActivePresetPayload {
  presetId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Preset by id in a state. */
function findPreset(presets: Preset[] | undefined, id: string): Preset | undefined {
  return presets?.find(p => p.id === id);
}

/** Patch semantics: `null` means "absent". */
const norm = (v: unknown) => (v === null ? undefined : v);

// ── Adapters ─────────────────────────────────────────────────────────────────

/**
 * `OverwritePreset`: base = oldCats, local = newCats, remote = current
 * categories. Categories have no ids, so the array is atomic: a remote edit
 * of the same preset's categories conflicts and local wins.
 */
export const overwritePresetAdapter: RebaseAdapter = (payload: OverwritePresetPayload, { current }) => {
  const preset = findPreset(current.savedPresets, payload.presetId);
  if (!preset) return skip(payload, `preset ${payload.presetId} no longer exists`);
  const conflicts: MergeConflict[] = [];
  const merged = mergeField(payload.oldCats, payload.newCats, preset.categories, payload.presetId, [payload.presetId, 'categories'], conflicts);
  return ok({ ...payload, presetName: preset.name, oldCats: deepClone(preset.categories), newCats: merged }, conflicts);
};

/**
 * `UpdatePresetMetadata`: per patched field, a remote change to a different
 * value is a conflict (local wins). `before` is rebased to the current values.
 */
export const updatePresetMetadataAdapter: RebaseAdapter = (payload: UpdatePresetMetadataPayload, { current }) => {
  const preset = findPreset(current.savedPresets, payload.presetId) as Record<string, unknown> | undefined;
  if (!preset) return skip(payload, `preset ${payload.presetId} no longer exists`);
  const conflicts: MergeConflict[] = [];
  const before: MetadataPatch = {};
  for (const [key, value] of Object.entries(payload.after ?? {})) {
    if (value === undefined) continue;
    const cur = preset[key];
    checkOverwrite(norm(payload.before?.[key as keyof MetadataPatch]), norm(value), cur, payload.presetId, [payload.presetId, key], conflicts);
    // Absent optional fields are expressed as `null` (= delete on undo).
    before[key as keyof MetadataPatch] = cur === undefined && (key === 'color' || key === 'overwriteTarget') ? null : deepClone(cur);
  }
  return ok({ ...payload, before }, conflicts);
};

/**
 * `DeletePreset` (payload carries the full preset = what the deleter saw):
 * skip if already gone; keep (skip + `remove-modify`) if it was modified remotely.
 */
export const deletePresetAdapter: RebaseAdapter = (payload: { preset: Preset }, { current }) => {
  const id = payload.preset?.id;
  const preset = findPreset(current.savedPresets, id);
  if (!preset) return skip(payload, `preset ${id} already deleted`);
  const conflict = removeConflict(payload.preset, preset, id, [id]);
  if (conflict) return skip(payload, `preset ${id} was modified remotely; kept`, [conflict]);
  return ok(payload);
};

/**
 * `SetActivePreset` / `preset.set`: skip if the preset no longer exists.
 * With `previous`, a remote activation of another preset is a conflict.
 */
export const activePresetAdapter: RebaseAdapter = (payload: ActivePresetPayload, { current, previous }) => {
  const id = payload.presetId;
  if (id !== null && id !== undefined && !findPreset(current.savedPresets, id)) {
    return skip(payload, `preset ${id} no longer exists`);
  }
  const conflicts: MergeConflict[] = [];
  if (previous) {
    checkOverwrite(previous.selectedPresetId ?? null, id ?? null, current.selectedPresetId ?? null, null, ['selectedPresetId'], conflicts);
  }
  return ok(payload, conflicts);
};

/** `color.override` live-op: `key` is a preset id; skip if it is gone. */
export const colorOverrideAdapter: RebaseAdapter = (payload: { key: string }, { current }) => {
  if (!findPreset(current.savedPresets, payload.key)) return skip(payload, `preset ${payload.key} no longer exists`);
  return ok(payload);
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all preset adapters. */
export function registerPresetAdapters(): void {
  // Additive and idempotent by (UUID) id → replay as recorded.
  registerRebaseAdapter('SavePreset', passThroughAdapter);
  registerRebaseAdapter('OverwritePreset', overwritePresetAdapter);
  registerRebaseAdapter('UpdatePresetMetadata', updatePresetMetadataAdapter);
  registerRebaseAdapter('DeletePreset', deletePresetAdapter);
  registerRebaseAdapter('SetActivePreset', activePresetAdapter);
  registerRebaseAdapter('preset.set', activePresetAdapter);
  registerRebaseAdapter('color.override', colorOverrideAdapter);
}
