import { ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Preset } from '~/utils/engine/preset-types';
import type { Effect } from '~/utils/engine/types';
import type { SceneNode } from '~/utils/engine/core/group';
import { extractCategories } from './preset-diff';
import { applyPreset as _applyPreset, stopPreset as _stopPreset } from './preset-apply';
import { resolvePreset } from './preset-resolve';

// Re-export for consumers that import extractCategories from this module
export { extractCategories } from './preset-diff';

import { storeToRefs } from 'pinia';
import { useEngineStore } from '~/stores/engine-store';

// ─── Singleton state ──────────────────────────────────────────────────────────

let nextPresetIndex = 1;

// ─── Composable ───────────────────────────────────────────────────────────────

/**
 * Global preset state composable (singleton).
 *
 * All methods receive the live `effects` array from `EffectEngine.effects`
 * so that modifiers are included in preset saves, unsaved-change detection,
 * and preset application.
 */
export function usePresets() {
  const store = useEngineStore();
  const { savedPresets, selectedPresetId } = storeToRefs(store);

  function getActivePreset(): Preset | null {
    return selectedPresetId.value
      ? (savedPresets.value.find((p) => p.id === selectedPresetId.value) ?? null)
      : null;
  }

  function getActivePresetResolved(): Preset | null {
    const raw = getActivePreset();
    return raw ? resolvePreset(raw, savedPresets.value) : null;
  }

  function getUnsavedChanges(fixtures: Fixture[], effects: Effect[] = [], nodes?: SceneNode[]) {
    return extractCategories(fixtures, effects, getActivePresetResolved(), nodes);
  }


  function savePreset(name: string, fixtures: Fixture[], effects: Effect[], nodes?: SceneNode[]): Preset {
    const id = `preset-${Date.now()}-${nextPresetIndex++}`;
    const preset: Preset = {
      id,
      name,
      createdAt: new Date().toISOString(),
      categories: extractCategories(fixtures, effects, null, nodes),
    };
    savedPresets.value.push(preset);
    selectedPresetId.value = id;
    return preset;
  }

  function overwritePreset(id: string, fixtures: Fixture[], effects: Effect[], nodes?: SceneNode[]): Preset | null {
    const preset = savedPresets.value.find((p) => p.id === id);
    if (!preset) return null;
    preset.categories = extractCategories(fixtures, effects, null, nodes);
    return preset;
  }

  function applyPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
    const resolved = resolvePreset(preset, savedPresets.value);
    _applyPreset(resolved, fixtures, effects);
    selectedPresetId.value = preset.id;
  }

  function stopPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
    const resolved = resolvePreset(preset, savedPresets.value);
    _stopPreset(resolved, fixtures, effects);
    if (selectedPresetId.value === preset.id) selectedPresetId.value = null;
  }

  function deletePreset(id: string): void {
    const idx = savedPresets.value.findIndex((p) => p.id === id);
    if (idx !== -1) savedPresets.value.splice(idx, 1);
    if (selectedPresetId.value === id) selectedPresetId.value = null;
  }

  function renamePreset(id: string, newName: string): void {
    const preset = savedPresets.value.find((p) => p.id === id);
    if (preset) preset.name = newName;
  }

  return {
    savedPresets,
    selectedPresetId,
    getActivePreset,
    getActivePresetResolved,
    getUnsavedChanges,
    savePreset,
    overwritePreset,
    applyPreset,
    stopPreset,
    deletePreset,
    renamePreset,
  };
}
