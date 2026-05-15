import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import { applyPreset as _applyPreset, stopPreset as _stopPreset } from './preset-apply';
import { resolvePreset } from './preset-resolve';
import { persistChange } from './use-history';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

/**
 * The minimal slice of state preset activation operates on. Both the live
 * engine store and the project-load ReplayContext can satisfy this, which keeps
 * the core transition logic in one place.
 */
export interface PresetActivationContext {
  savedPresets: Preset[];
  flatFixtures: Fixture[];
  activeEffects: Effect[];
  getSelectedPresetId: () => string | null;
  setSelectedPresetId: (id: string | null) => void;
  triggerCanvasSync: () => void;
}

/**
 * Canonical preset transition: stop the currently-active preset (when switching
 * away from it), apply the target preset (or none), and update
 * `selectedPresetId` — the single source of truth for "which preset is active".
 * Pure with respect to side channels: no broadcast, no persistence.
 */
export function applyActivePreset(ctx: PresetActivationContext, presetId: string | null): void {
  const presets = ctx.savedPresets;
  const current = ctx.getSelectedPresetId();

  if (current && current !== presetId) {
    const cur = presets.find((p) => p.id === current);
    if (cur) _stopPreset(resolvePreset(cur, presets), ctx.flatFixtures, ctx.activeEffects);
  }

  if (presetId) {
    const target = presets.find((p) => p.id === presetId);
    if (!target) return;
    _applyPreset(resolvePreset(target, presets), ctx.flatFixtures, ctx.activeEffects);
    ctx.setSelectedPresetId(presetId);
  } else {
    ctx.setSelectedPresetId(null);
  }

  ctx.triggerCanvasSync();
}

function engineActivationContext(): PresetActivationContext {
  const engineStore = useEngineStore();
  return {
    savedPresets: engineStore.savedPresets,
    flatFixtures: engineStore.flatFixtures,
    activeEffects: engineStore.activeEffects,
    getSelectedPresetId: () => engineStore.selectedPresetId,
    setSelectedPresetId: (id) => { engineStore.selectedPresetId = id; },
    triggerCanvasSync: () => engineStore.triggerCanvasSync(),
  };
}

export interface SetActivePresetOptions {
  /** Broadcast `preset.set` to other clients. Default true. */
  broadcast?: boolean;
  /** Persist as a `SetActivePreset` change so it survives reload. Default true. */
  persist?: boolean;
}

/**
 * THE entry point for activating / deactivating a preset. Every UI surface
 * (design sidebar, live buttons, controller twins, section members) and the
 * `preset.set` live op funnels through here, so `selectedPresetId` stays a
 * consistent single source of truth and the change syncs + persists.
 */
export function setActivePreset(presetId: string | null, opts: SetActivePresetOptions = {}): void {
  applyActivePreset(engineActivationContext(), presetId);

  const liveBus = useLiveBusStore();
  const fromRemote = liveBus.isApplyingRemote();

  if (opts.broadcast !== false && !fromRemote) {
    liveBus.dispatch('preset.set', { presetId });
  }
  if (opts.persist !== false && !fromRemote) {
    persistChange('SetActivePreset', { presetId });
  }
}

/** Activate the preset, or deactivate it if it is already the active one. */
export function toggleActivePreset(presetId: string): void {
  const engineStore = useEngineStore();
  setActivePreset(engineStore.selectedPresetId === presetId ? null : presetId);
}
