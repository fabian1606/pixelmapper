import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyRGBOverride } from '~/components/engine/composables/preset-apply';
import type { RGB } from '~/utils/live/color-utils';
import type { Preset } from '~/utils/engine/preset-types';

/**
 * Reads the actual step-0 RGB currently driving the FIRST pixel of the FIRST
 * fixture of the preset's primary RGB category. Reflects whatever is currently
 * live — natural after preset apply, overridden after wheel drag or slot press.
 * Returns null if the preset has no RGB-controlling category.
 */
export function getEffectiveRGB(preset: Preset, fixtures: any[]): RGB | null {
  const resolved = resolvePreset(preset, useEngineStore().savedPresets);
  for (const cat of resolved.categories) {
    let hasRGB = false;
    for (const snap of cat.channels) {
      if (snap.channelType === 'RED' || snap.channelType === 'GREEN' || snap.channelType === 'BLUE') {
        hasRGB = true;
        break;
      }
    }
    if (!hasRGB) continue;
    const fixtureId = cat.fixtureIds[0];
    if (fixtureId === undefined) continue;
    const fixture = fixtures.find((f: any) => f.id === fixtureId);
    if (!fixture) continue;
    // First-occurrence wins so we read pixel 0 (multi-pixel fixtures have
    // multiple R/G/B channel snapshots in the same category).
    let r: number | null = null, g: number | null = null, b: number | null = null;
    for (const snap of cat.channels) {
      const ch = fixture.channels[snap.channelIndex];
      if (!ch) continue;
      const v = ch.chaserConfig?.stepValues?.[0] ?? 0;
      if (snap.channelType === 'RED'   && r === null) r = v;
      if (snap.channelType === 'GREEN' && g === null) g = v;
      if (snap.channelType === 'BLUE'  && b === null) b = v;
      if (r !== null && g !== null && b !== null) break;
    }
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }
  return null;
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
  const engineStore = useEngineStore();
  const preset = engineStore.savedPresets.find((p: any) => p.id === key);
  if (preset) {
    const resolved = resolvePreset(preset, engineStore.savedPresets);
    applyRGBOverride(resolved, engineStore.flatFixtures, rgb);
    engineStore.markChannelsDirty?.();
  }
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
    const engineStore = useEngineStore();
    const preset = engineStore.savedPresets.find((p: any) => p.id === key);
    if (!preset) return;
    const resolved = resolvePreset(preset, engineStore.savedPresets);
    applyRGBOverride(resolved, engineStore.flatFixtures, rgb);
    engineStore.markChannelsDirty?.();
  },
});
