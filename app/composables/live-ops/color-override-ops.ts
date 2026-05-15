import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyRGBOverride } from '~/components/engine/composables/preset-apply';
import type { RGB } from '~/utils/live/color-utils';

/**
 * Apply the currently stored color override for the active preset to fixtures.
 * Lean: only rewrites RGB step values for the active preset's targeted fixtures.
 * Used by the color wheel on every pointermove (~60fps).
 */
export function reapplyColorOverrideForActive(): void {
  const engineStore = useEngineStore();
  const liveStore = useLiveModeStore();
  const presetId = engineStore.selectedPresetId;
  if (!presetId) return;
  const preset = engineStore.savedPresets.find((p: any) => p.id === presetId);
  if (!preset) return;
  const resolved = resolvePreset(preset, engineStore.savedPresets);
  const rgb = liveStore.presetColorOverrides.get(presetId) ?? null;
  applyRGBOverride(resolved, engineStore.flatFixtures, rgb);
  engineStore.triggerCanvasSync?.();
}

/**
 * Single entry point for changing a preset's color override: writes locally,
 * re-applies fixtures, and broadcasts to remote tabs (when connected).
 * Use this for one-shot changes (section auto-color slot press, reset button).
 * The color wheel's drag handler uses the lower-level functions directly to
 * avoid going through LiveBus on every pointermove.
 */
export function setColorOverride(key: string, rgb: RGB | null): void {
  const liveStore = useLiveModeStore();
  const engineStore = useEngineStore();
  liveStore.setPresetColor(key, rgb);
  if (engineStore.selectedPresetId === key) reapplyColorOverrideForActive();
  const liveBus = useLiveBusStore();
  if (!liveBus.isApplyingRemote()) liveBus.dispatch('color.override', { key, rgb });
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
  apply: ({ key, rgb }) => {
    useLiveModeStore().setPresetColor(key, rgb);
    // Only touch fixtures if this override affects the currently active preset.
    const engineStore = useEngineStore();
    if (engineStore.selectedPresetId === key) reapplyColorOverrideForActive();
  },
});
