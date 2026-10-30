import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';
import { colorOverrideKey } from './coalesce-keys';
import { useEngineStore } from '~/stores/engine-store';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyRGBOverride } from '~/components/engine/composables/preset-apply';
import type { RGB } from '~/utils/live/color-utils';
import type { Preset } from '~/utils/engine/preset-types';
import { mark, measure, trace } from '~/utils/perf';

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

// ── Override tracking (for Step back) ────────────────────────────────────────

/**
 * Color override per preset ID that is currently on the fixtures. Only for
 * Step back (live-history): the override itself is a fixture mutation, so
 * this map is the only record of it. Cleared when a preset is (re)applied.
 */
const overrides = new Map<string, RGB>();

function trackOverride(key: string, rgb: RGB | null): void {
  if (rgb) overrides.set(key, { ...rgb });
  else overrides.delete(key);
}

/** The override currently applied to a preset, or null when it shows its own colors. */
export function getColorOverride(presetId: string | null): RGB | null {
  return presetId ? overrides.get(presetId) ?? null : null;
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
