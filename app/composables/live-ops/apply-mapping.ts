import { getManifest } from '~/utils/plugins/plugin-store';
import type { LiveMapping, SpeedConfig } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { setActivePreset, pressFlashPreset, releaseFlashPreset } from '~/components/engine/composables/preset-activation';
import { isTriggerParam } from '~/utils/plugins/trigger-param';
import { controlParamValue } from '~/utils/live/control-param-value';
import { setEffectTrigger } from './effect-trigger';
import { setEffectParam } from './effect-param';
import { faderToSpeed } from '~/utils/live/speed-fader';
import { INSTANT_GLOBAL_FUNCTIONS } from '~/utils/live/button-actions';

/**
 * Shared runtime dispatcher for a {@link LiveMapping}. Used by canvas buttons,
 * canvas sliders, xy pads (`effect-param` → point params), and controller-twin
 * controls (buttons + faders) so that every
 * mapping type behaves identically no matter where the control lives.
 *
 * Plain functions that reach for the Pinia stores internally — same pattern as
 * `sectionPress` in use-section-binding.ts — so they can be called from event
 * handlers outside component setup.
 *
 * Note: section-bound controls are handled separately via sectionPress/Release;
 * this module is only for a control's *own* (child / widget) mapping.
 */

export interface MappingContext {
  /** Tracking key for overwrite / flash presets (widget.id or `${widgetId}::${controlId}`). */
  key: string;
  /** Continuous 0..1 value for sliders/faders (x axis of an xy pad); omit for buttons. */
  value?: number;
  /** 0..1 y axis of an xy pad (drives `point` params together with `value`). */
  value2?: number;
}

/** Key of the `trigger` param an `effect-param` mapping targets (ABI 1.3), else null. */
export function triggerParamKey(mapping: LiveMapping): string | null {
  if (mapping.type !== 'effect-param' || mapping.effectId == null || !mapping.paramKey?.startsWith('params.')) return null;
  const effect = useEngineStore().modifiers.find((e: any) => e.id === mapping.effectId);
  const key = mapping.paramKey.slice('params.'.length);
  return effect && isTriggerParam(getManifest(effect.plugin), key) ? key : null;
}

/** Manifest type of the plugin param an `effect-param` mapping targets, else null. */
export function effectParamType(mapping: LiveMapping): string | null {
  if (mapping.type !== 'effect-param' || mapping.effectId == null || !mapping.paramKey?.startsWith('params.')) return null;
  const effect = useEngineStore().modifiers.find((e: any) => e.id === mapping.effectId);
  const key = mapping.paramKey.slice('params.'.length);
  return (effect && getManifest(effect.plugin)?.params.find(p => p.key === key)?.type) ?? null;
}

/**
 * Whether a mapping should behave as momentary "flash" (held = active, release
 * = revert) — used for the ⚡ indicator and press/release semantics.
 */
export function isFlashMapping(mapping: LiveMapping): boolean {
  const engineStore = useEngineStore();
  if (mapping.type === 'preset' && mapping.presetId) {
    const preset = engineStore.savedPresets.find((p: any) => p.id === mapping.presetId);
    if (preset?.type === 'flash' || preset?.type === 'overwrite') return true;
  }
  // Speed buttons can be latch — only flash when behavior === 'hold'.
  if (mapping.type === 'global-function' && mapping.globalFunction === 'speed') {
    return (mapping.globalFunctionConfig as SpeedConfig | undefined)?.behavior === 'hold';
  }
  // Other global functions are hold-to-active (flash behavior).
  if (mapping.type === 'global-function') return true;
  // Trigger params are momentary by definition (press / release edges).
  if (triggerParamKey(mapping)) return true;
  // Bool params driven by a button in 'hold' mode are on only while held.
  if (mapping.behavior === 'hold' && effectParamType(mapping) === 'bool') return true;
  return false;
}

export function getFixturesForDimmerGroup(mapping: LiveMapping): any[] {
  const engineStore = useEngineStore();

  if (mapping.fixtureId != null && !mapping.groupId) {
    const f = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    return f ? [f] : [];
  }

  if (mapping.groupId) {
    const findGroup = (nodes: any[]): any => {
      for (const node of nodes) {
        if (String(node.id) === String(mapping.groupId)) return node;
        if (node.children?.length) {
          const found = findGroup(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const group = findGroup(engineStore.sceneNodes);
    if (group?.getAllFixtures) return group.getAllFixtures();
  }

  return [];
}

/**
 * Group dimmer: sets the group's level in the engine's intensity layer (see
 * utils/engine/intensity.ts). It scales the output — DIMMER channels, or the
 * COLOR channels of fixtures without one — and never rewrites programmed
 * values, so presets, chasers and color variants keep running underneath.
 */
function applyDimmerGroup(mapping: LiveMapping, value: number) {
  const targetKey = mapping.groupId ? `group:${mapping.groupId}` : `fixture:${mapping.fixtureId ?? ''}`;
  const fixtureIds = getFixturesForDimmerGroup(mapping).map((f: any) => f.id);
  useEngineStore().setGroupLevel(targetKey, fixtureIds, value);
}

/**
 * Apply a mapping's effect. `active` is press/release for buttons; sliders pass
 * `active = true` with a continuous `value`.
 */
export function applyMapping(mapping: LiveMapping, active: boolean, ctx: MappingContext): void {
  const engineStore = useEngineStore();
  const store = useLiveModeStore();
  const liveBus = useLiveBusStore();
  const { key, value } = ctx;

  // Instant global functions (Stop all, Step back, Beat, speed steps) are handled by the button runtime.
  if (mapping.type === 'global-function' && mapping.globalFunction && INSTANT_GLOBAL_FUNCTIONS.has(mapping.globalFunction)) return;

  if (mapping.type === 'preset' && mapping.presetId) {
    const preset = engineStore.savedPresets.find((p: any) => p.id === mapping.presetId);
    if (preset?.type === 'overwrite' && preset.overwriteTarget) {
      if (active) {
        engineStore.pressOverwrite(key, preset.overwriteTarget, {});
        queueMicrotask(() => liveBus.dispatch('overwrite.press', {
          key, type: preset.overwriteTarget!, config: {},
        }));
      } else {
        engineStore.releaseOverwrite(key);
        queueMicrotask(() => liveBus.dispatch('overwrite.release', { key }));
      }
    } else if (preset?.type === 'flash') {
      if (active) pressFlashPreset(key, mapping.presetId);
      else releaseFlashPreset(key);
    } else if (active) {
      setActivePreset(mapping.presetId);
    }
  } else if (mapping.type === 'channel') {
    const dmxValue = value !== undefined ? Math.round(value * 255) : (active ? 255 : 0);
    if (mapping.groupId && mapping.channelType) {
      const fixtures = getFixturesForDimmerGroup(mapping);
      for (const fixture of fixtures) {
        for (const ch of fixture.channels) {
          if (ch.type === mapping.channelType) {
            ch.chaserConfig.stepValues = [dmxValue];
          }
        }
      }
      engineStore.triggerCanvasSync?.();
    } else if (mapping.fixtureId != null && mapping.channelOffset != null) {
      const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
      const ch = fixture?.channels[mapping.channelOffset];
      if (ch) {
        ch.chaserConfig.stepValues = [dmxValue];
        engineStore.triggerCanvasSync?.();
      }
    }
  } else if (mapping.type === 'dimmer-group') {
    applyDimmerGroup(mapping, value ?? (active ? 1 : 0));
  } else if (mapping.type === 'effect-param' && triggerParamKey(mapping)) {
    // Trigger param (ABI 1.3): buttons send press/release; sliders press above half.
    setEffectTrigger(mapping.effectId!, triggerParamKey(mapping)!, value !== undefined ? value >= 0.5 : active);
  } else if (mapping.type === 'effect-param' && mapping.effectId != null && mapping.paramKey != null) {
    applyEffectParam(mapping, active, ctx);
  } else if (mapping.type === 'page-switch' && mapping.targetPageId && active) {
    store.setActivePage(mapping.targetPageId);
  } else if (mapping.type === 'global-function' && mapping.globalFunction === 'speed') {
    const cfg = (mapping.globalFunctionConfig ?? { multiplier: 1, behavior: 'latch' }) as SpeedConfig;
    if (active) {
      engineStore.setSpeedMultiplier(cfg.multiplier);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier: cfg.multiplier }));
    } else if (cfg.behavior === 'hold') {
      engineStore.setSpeedMultiplier(1);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier: 1 }));
    }
  } else if (mapping.type === 'speed' && value !== undefined) {
    // Speed fader: sets the multiplier on top of the tapped BPM; only broadcast real changes.
    const multiplier = faderToSpeed(value, mapping.speedMode ?? 'continuous');
    if (multiplier !== engineStore.speedMultiplier) {
      engineStore.setSpeedMultiplier(multiplier);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier }));
    }
  } else if (mapping.type === 'master-dimmer' && value !== undefined) {
    // Master dimmer fader: scales the whole rig on the output, so presets can't reset it.
    if (value !== engineStore.masterLevel) {
      engineStore.setMasterLevel(value);
      queueMicrotask(() => liveBus.dispatch('engine.master', { level: value }));
    }
  } else if (mapping.type === 'position-recall' && mapping.positionId && active) {
    const position = store.savedPositions.find((p: any) => p.id === mapping.positionId);
    if (position) {
      for (const snap of position.snapshot) {
        const fixture = engineStore.flatFixtures.find((f: any) => f.id === snap.fixtureId);
        const ch = fixture?.channels[snap.channelOffset];
        if (ch) {
          ch.chaserConfig.stepValues = [snap.value];
        }
      }
      engineStore.triggerCanvasSync?.();
    }
  } else if (mapping.type === 'global-function' && mapping.globalFunction) {
    if (active) {
      engineStore.pressOverwrite(key, mapping.globalFunction, mapping.globalFunctionConfig ?? {});
      queueMicrotask(() => liveBus.dispatch('overwrite.press', {
        key, type: mapping.globalFunction!, config: mapping.globalFunctionConfig ?? {},
      }));
    } else {
      engineStore.releaseOverwrite(key);
      queueMicrotask(() => liveBus.dispatch('overwrite.release', { key }));
    }
  }
}

/**
 * `effect-param` mapping (non-trigger): sliders drive the built-in keys and
 * number/int/bool params, buttons drive bool params (toggle or momentary per
 * `mapping.behavior`), xy pads drive point params. Inputs a param type cannot
 * take are ignored (the `live.*` operation verify warns about them).
 */
function applyEffectParam(mapping: LiveMapping, active: boolean, ctx: MappingContext): void {
  const engineStore = useEngineStore();
  const effect = engineStore.modifiers.find((e: any) => e.id === mapping.effectId);
  const pk = mapping.paramKey!;
  if (!effect) return;
  const { value } = ctx;

  if (pk.startsWith('params.') || pk.startsWith('waveformParams.')) {
    // Plugin param: the control input maps onto the param's type (range, toggle, point).
    const key = pk.slice(pk.indexOf('.') + 1);
    const def = getManifest(effect.plugin)?.params.find(p => p.key === key);
    const next = controlParamValue(def, effect.params[key], { active, value, value2: ctx.value2, behavior: mapping.behavior });
    if (next !== undefined) setEffectParam(effect.id, key, next);
    return;
  }

  // Built-in modifier keys need a continuous value (sliders / faders).
  if (value === undefined) return;
  if (pk === 'strength') {
    effect.strength = value;
  } else if (pk === 'speed') {
    if (effect.speed) effect.speed.timeMs = Math.max(100, Math.round(50 + value * 5000));
  } else if (pk === 'fanning') {
    // Spread: length of the gradient handle (direction kept), 0–1 of the world width.
    const d = effect.distribution;
    const dx = d.end.x - d.origin.x;
    const dy = d.end.y - d.origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const l = Math.max(0.001, value);
    effect.distribution = { ...d, end: { x: d.origin.x + (dx / len) * l, y: d.origin.y + (dy / len) * l } };
  }
  engineStore.triggerCanvasSync?.();
}
