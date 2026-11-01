import { reactive } from 'vue';
import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';
import { colorOverrideKey } from './coalesce-keys';
import { useEngineStore } from '~/stores/engine-store';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyRGBOverride } from '~/components/engine/composables/preset-apply';
import { getPresetNaturalRGB } from '~/utils/live/color-utils';
import type { RGB } from '~/utils/live/color-utils';
import type { Preset } from '~/utils/engine/preset-types';
import { mark, measure, trace } from '~/utils/perf';

// ── Override tracking ────────────────────────────────────────────────────────

/**
 * Color override per preset ID that is currently on the fixtures. The
 * override itself is a fixture mutation, so this (reactive) map is the only
 * record of it: color wheel / variant slots display it and Step back
 * restores it. Cleared when a preset is (re)applied.
 */
const overrides = reactive(new Map<string, RGB>());

function trackOverride(key: string, rgb: RGB | null): void {
  if (rgb) overrides.set(key, { ...rgb });
  else overrides.delete(key);
}

/** The override currently applied to a preset, or null when it shows its own colors. */
export function getColorOverride(presetId: string | null): RGB | null {
  return presetId ? overrides.get(presetId) ?? null : null;
}

/**
 * The color a preset currently shows: its tracked override, else its natural
 * reference color. Reactive (reads the reactive override map). Not read back
 * from the fixtures — the recolor keeps every sample's brightness, so no
 * fixture sample has to equal the picked color.
 */
export function getEffectiveRGB(preset: Preset): RGB | null {
  const engineStore = useEngineStore();
  return getColorOverride(preset.id)
    ?? getPresetNaturalRGB(preset.id, engineStore.savedPresets, engineStore.flatFixtures);
}

/** A preset was (re)applied, which reloads its snapshot and drops the override. */
export function forgetColorOverride(presetId: string | null): void {
  if (presetId) overrides.delete(presetId);
}

/**
 * Apply a color override (or revert with rgb=null) directly to the fixtures of
 * the currently selected preset. No state is stored — the override is just a
 * fixture-state mutation. The next preset (re-)activation reloads the snapshot
 * and naturally clears it.
 *
 * Used by the color wheel on every pointermove (RAF-throttled by the caller).
 */
export function applyRGBToActivePreset(rgb: RGB | null): void {
  const engineStore = useEngineStore();
  const presetId = engineStore.selectedPresetId;
  if (!presetId) return;
  const preset = engineStore.savedPresets.find((p: any) => p.id === presetId);
  if (!preset) return;
  const resolved = resolvePreset(preset, engineStore.savedPresets);
  applyRGBOverride(resolved, engineStore.flatFixtures, rgb);
  engineStore.markChannelsDirty?.();
}

/**
 * Public entry point for the wheel pointer-up and section slot press. Applies
 * locally and broadcasts to peer tabs via LiveBus.
 *
 * `key` is the preset ID the override targets — remote clients resolve their
 * own copy of that preset by ID before applying.
 */
export function setColorOverride(key: string, rgb: RGB | null): void {
  mark('color.start');
  const engineStore = useEngineStore();
  const preset = engineStore.savedPresets.find((p: any) => p.id === key);
  trackOverride(key, rgb);
  if (preset) {
    const resolved = resolvePreset(preset, engineStore.savedPresets);
    trace('color.apply', () => applyRGBOverride(resolved, engineStore.flatFixtures, rgb));
    engineStore.flushEngineOutput?.();
  }
  mark('color.flush.done');
  measure('color.total-sync', 'color.start', 'color.flush.done');
  const liveBus = useLiveBusStore();
  const fromRemote = liveBus.isApplyingRemote();
  queueMicrotask(() => {
    if (!fromRemote) liveBus.dispatch('color.override', { key, rgb });
  });
}

// ── Live op ──────────────────────────────────────────────────────────────────

interface ColorOverridePayload {
  /** Preset ID this override applies to. */
  key: string;
  rgb: RGB | null;
}

registerLiveOp<ColorOverridePayload>('color.override', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  persistent: true,
  // Per preset — overrides on two presets within one window both persist (ADR 0004 D8).
  coalesceKey: colorOverrideKey,
  apply: ({ key, rgb }) => {
    const engineStore = useEngineStore();
    trackOverride(key, rgb);
    const preset = engineStore.savedPresets.find((p: any) => p.id === key);
    if (!preset) return;
    const resolved = resolvePreset(preset, engineStore.savedPresets);
    applyRGBOverride(resolved, engineStore.flatFixtures, rgb);
    engineStore.markChannelsDirty?.();
  },
});
