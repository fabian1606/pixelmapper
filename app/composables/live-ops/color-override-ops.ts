import { registerLiveOp } from '~/stores/live-bus-store';
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
