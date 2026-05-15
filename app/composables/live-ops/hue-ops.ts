import { registerLiveOp, useLiveBusStore } from '~/stores/live-bus-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { ColorEffect } from '~/utils/engine/effects/color-effect';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { orderedSectionMembers, resolveSectionSource } from '~/utils/live/sections';
import type { ColorParams } from '~/utils/engine/types';

const HUE_OVERRIDE_ID = '__hue-override__';

/**
 * Removes any existing injected hue override effect and, if an override
 * is defined for the active preset (or globally), injects a fresh ColorEffect.
 * Called after every preset switch and after every hue.update op.
 */
export function applyHueOverrideEffect(): void {
  const engineStore = useEngineStore();
  const liveStore = useLiveModeStore();
  const effects = engineStore.activeEffects;

  // Remove old override
  for (let i = effects.length - 1; i >= 0; i--) {
    if ((effects[i] as any).__isHueOverride) effects.splice(i, 1);
  }

  const presetId = engineStore.selectedPresetId;
  if (!presetId) return;

  const overrides = liveStore.presetHueOverrides;
  const hasSpecific = overrides.has(presetId);
  const hasGlobal = overrides.has('global');
  if (!hasSpecific && !hasGlobal) return;

  const isGlobalKey = !hasSpecific;
  const params = (hasSpecific ? overrides.get(presetId) : overrides.get('global'))!;

  // Flash/overwrite presets only react to global scope
  const preset = engineStore.savedPresets.find((p: any) => p.id === presetId);
  if (!preset) return;
  if (!isGlobalKey && (preset.type === 'flash' || preset.type === 'overwrite')) return;

  const resolved = resolvePreset(preset, engineStore.savedPresets);
  const fixtureIds = [...new Set(resolved.categories.flatMap((c: any) => c.fixtureIds))] as (string | number)[];
  if (fixtureIds.length === 0) return;

  const eff = new ColorEffect();
  eff.id = HUE_OVERRIDE_ID;
  (eff as any).__isHueOverride = true;
  eff.colorParams = { ...params };
  eff.targetFixtureIds = fixtureIds;
  eff.targetChannels = ['RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE', 'AMBER', 'UV', 'CYAN', 'MAGENTA', 'YELLOW', 'LIME', 'INDIGO'] as any;
  eff.strength = 1;
  effects.push(eff);

  engineStore.triggerCanvasSync?.();
}

/**
 * Returns the ColorParams currently displayed by the color-wheel widget for
 * the active preset. Falls back to global override, then null.
 */
export function getActiveHueParams(): ColorParams | null {
  const engineStore = useEngineStore();
  const liveStore = useLiveModeStore();
  const presetId = engineStore.selectedPresetId;
  if (!presetId) return liveStore.presetHueOverrides.get('global') ?? null;
  return liveStore.presetHueOverrides.get(presetId) ?? liveStore.presetHueOverrides.get('global') ?? null;
}

// ── Live op ──────────────────────────────────────────────────────────────────

interface HueUpdatePayload {
  /** Preset ID, or 'global' for global scope. */
  key: string;
  params: ColorParams | null;
}

registerLiveOp<HueUpdatePayload>('hue.update', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ key, params }) => {
    useLiveModeStore().setPresetHue(key, params);
    applyHueOverrideEffect();
  },
});

// ── Section auto-color ────────────────────────────────────────────────────────

/**
 * Distribute hue evenly across all section slots and broadcast via LiveBus.
 * Each slot gets hueShift = (index / total) * 360 - 180.
 */
export function generateSectionAutoColors(sectionId: string, scope: 'preset' | 'global'): void {
  const liveStore = useLiveModeStore();
  const engineStore = useEngineStore();
  const bus = useLiveBusStore();

  const page = liveStore.activePage;
  if (!page) return;

  const section = page.sections?.find(s => s.id === sectionId);
  if (!section) return;

  const ordered = orderedSectionMembers(section, page);
  const total = ordered.length;
  if (total === 0) return;

  const ctx = {
    savedPresets: engineStore.savedPresets,
    selectedPresetId: engineStore.selectedPresetId,
  };
  const sourcePresets = resolveSectionSource(section.source, ctx);

  for (let i = 0; i < Math.min(total, sourcePresets.length); i++) {
    const preset = sourcePresets[i];
    if (!preset) continue;
    const key = scope === 'global' ? 'global' : preset.id;
    const hueShift = Math.round((i / total) * 360) - 180;
    const params: ColorParams = { hueShift, saturation: 1, hueRange: 0, satRange: 0 };
    bus.dispatch('hue.update', { key, params });
  }
}
