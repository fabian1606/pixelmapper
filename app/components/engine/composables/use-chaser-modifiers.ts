import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect, ChannelType } from '~/utils/engine/types';
import type { PresetModifierSnapshot } from '~/utils/engine/preset-types';
import { WaveformEffect } from '~/utils/engine/effects/waveform-effect';
import { NoiseEffect } from '~/utils/engine/effects/noise-effect';
import { SequencerEffect } from '~/utils/engine/effects/sequencer-effect';
import { findRichestFixture, syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import { usePinnedModifiersStore } from '~/stores/pinned-modifiers-store';
import type { useChaserHistory } from './use-chaser-history';

export function useChaserModifiers(
  props: { fixtures: Fixture[]; activeTab: string },
  effectEngine: EffectEngine | undefined,
  historyTools: ReturnType<typeof useChaserHistory>,
  tabChannelFilter: (type: ChannelType, role?: string) => boolean,
  emit: (event: 'change') => void
) {
  const { captureModifiers, commitModifiers } = historyTools;

  // Global variable to keep track of drag state for modifier continuous parameters (speed, strength, fanning)
  let modifierDragBeforeEffects: Effect[] | null = null;
  let modifierDragTimeout: any = null;

  const availableChannelTypes = computed<ChannelType[]>(() => {
    const types = new Set<ChannelType>();
    for (const f of props.fixtures) {
      for (const c of f.channels) {
        if (tabChannelFilter(c.type, c.role)) types.add(c.type);
      }
    }
    return Array.from(types);
  });

  const richestFixture = computed(() => {
    return findRichestFixture(props.fixtures, tabChannelFilter, effectEngine);
  });

  function hasMatchingChannel(effect: Effect) {
    if (!effect.targetChannels) return false;
    return effect.targetChannels.some(type => availableChannelTypes.value.includes(type));
  }

  const activeModifiers = computed(() => {
    if (!effectEngine || !richestFixture.value) return [];
    return effectEngine.effects.filter(effect => {
      // Matches the richest fixture
      const matchesFixture = effect.targetFixtureIds?.includes(richestFixture.value!.id);

      // Matches channel category
      const matchesChannels = hasMatchingChannel(effect);

      return matchesFixture && matchesChannels;
    });
  });

  function addWaveformModifier() {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const effect = new WaveformEffect();
    effect.targetChannels = [...availableChannelTypes.value]; // default to all relevant channels
    effect.targetFixtureIds = props.fixtures.map(f => f.id);
    effect.strength = 100;
    effect.speed = { mode: 'time', timeMs: 2000, beatValue: 1, beatOffset: 0 };
    effect.fanning = 0.1;
    effect.direction = 'LINEAR';
    const avgX = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.x, 0) / props.fixtures.length
      : 0.5;
    const avgY = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.y, 0) / props.fixtures.length
      : 0.5;

    effect.originX = avgX;
    effect.originY = avgY;
    effect.angle = 0;
    effect.reverse = false;
    effectEngine.addEffect(effect);
    // Assign the proxy from the reactive array to ensure Vue tracks property changes
    effectEngine.activeModifier.value = (effectEngine.effects[effectEngine.effects.length - 1] ?? effect) as Effect;
    emit('change');
    commitModifiers(before, 'Add Waveform Modifier');
  }

  function addNoiseModifier() {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const effect = new NoiseEffect();
    effect.targetChannels = [...availableChannelTypes.value];
    effect.targetFixtureIds = props.fixtures.map(f => f.id);
    effect.strength = 50;
    effect.speed = { mode: 'time', timeMs: 500, beatValue: 1, beatOffset: 0 };
    effectEngine.addEffect(effect);
    effectEngine.activeModifier.value = (effectEngine.effects[effectEngine.effects.length - 1] ?? effect) as Effect;
    emit('change');
    commitModifiers(before, 'Add Noise Modifier');
  }

  function cloneModifier(effect: Effect): Effect {
    if (effect instanceof WaveformEffect) {
      const clone = new WaveformEffect();
      clone.targetChannels = [...(effect.targetChannels || [])];
      clone.targetFixtureIds = effect.targetFixtureIds ? [...effect.targetFixtureIds] : undefined;
      clone.direction = effect.direction;
      clone.reverse = effect.reverse;
      clone.strength = effect.strength;
      clone.fanning = effect.fanning;
      clone.speed = { ...effect.speed };
      clone.waveformShape = effect.waveformShape;
      clone.waveformParams = { ...effect.waveformParams };
      (clone as any).timePhase = (effect as any).timePhase;
      return clone;
    }
    return effect;
  }

  function resolveStaleEffect(effect: Effect, selectedIds: (string | number)[]): Effect {
    if (effect.targetFixtureIds && !effect.targetFixtureIds.some(id => selectedIds.includes(id))) {
      const newEff = effectEngine?.effects.find(e =>
        e.targetFixtureIds &&
        e.targetFixtureIds.some(id => selectedIds.includes(id)) &&
        e instanceof effect.constructor
      );
      if (newEff) return newEff;
    }
    return effect;
  }

  function getSafeEffectToMutate(effect: Effect, selectedIds: (string | number)[]): Effect {
    const eff = resolveStaleEffect(effect, selectedIds);

    if (eff.targetFixtureIds) {
      const unselectedTargets = eff.targetFixtureIds.filter(id => !selectedIds.includes(id));
      if (unselectedTargets.length > 0) {
        // Split!
        eff.targetFixtureIds = unselectedTargets;
        const clone = cloneModifier(eff);
        clone.targetFixtureIds = [...selectedIds];
        effectEngine!.addEffect(clone);
        return clone;
      } else {
        // Mutate in place & expand to all selected
        const newlyAddedIds = selectedIds.filter(id => !eff.targetFixtureIds!.includes(id));

        for (const id of selectedIds) {
          if (!eff.targetFixtureIds.includes(id)) {
            eff.targetFixtureIds.push(id);
          }
        }

        // Heal split / override conflicting modifiers of the same type that were overridden
        if (newlyAddedIds.length > 0 && effectEngine) {
          effectEngine.effects.forEach(otherEff => {
            if (otherEff !== eff && otherEff.constructor === eff.constructor) {
              const sameChannels = otherEff.targetChannels && eff.targetChannels &&
                otherEff.targetChannels.length === eff.targetChannels.length &&
                otherEff.targetChannels.every(c => eff.targetChannels!.includes(c));

              if (sameChannels && otherEff.targetFixtureIds) {
                otherEff.targetFixtureIds = otherEff.targetFixtureIds.filter(id => !newlyAddedIds.includes(id));
              }
            }
          });

          // Cleanup orphaned effects
          for (let i = effectEngine.effects.length - 1; i >= 0; i--) {
            const o = effectEngine.effects[i];
            if (o && o !== eff && o.targetFixtureIds && o.targetFixtureIds.length === 0) {
              effectEngine.effects.splice(i, 1);
            }
          }
        }
      }
    }
    return eff;
  }

  function handleModifierDragEnd(description: string) {
    if (modifierDragBeforeEffects) {
      commitModifiers(modifierDragBeforeEffects, description);
      modifierDragBeforeEffects = null;
    }
  }

  function updateModifier(effect: Effect, key: string, value: any) {
    if (!effectEngine) return;

    // Is this a continuous value change? If so, debounce the commit
    const isContinuous = key === 'speed' || key === 'strength' || key === 'fanning';
    const isDirection = key === 'direction';

    let before: Effect[] | null = null;

    if (isDirection) {
      // Immediate commit mapping for direction picks
      before = captureModifiers();
    } else if (isContinuous) {
      if (!modifierDragBeforeEffects) {
        modifierDragBeforeEffects = captureModifiers();
      }
      if (modifierDragTimeout) clearTimeout(modifierDragTimeout);

      // Commit dragging changes 400ms after last input
      modifierDragTimeout = setTimeout(() => {
        handleModifierDragEnd(`Update Modifier ${key}`);
      }, 400); // Wait until dragging likely stops
    }

    const selectedIds = props.fixtures.map(f => f.id);
    const safeEff = getSafeEffectToMutate(effect, selectedIds);
    // Guard against NaN from half-typed numbers (e.g. "-" or empty input)
    if (typeof value === 'number' && isNaN(value)) return;
    (safeEff as any)[key] = value;
    emit('change');

    if (isDirection && before) {
      commitModifiers(before, 'Change Modifier Direction');
    }
  }

  function updateModifierProperties(effect: Effect, updates: Partial<Effect>, historyLabel: string, isContinuous = false) {
    if (!effectEngine) return;

    if (isContinuous) {
      if (!modifierDragBeforeEffects) {
        modifierDragBeforeEffects = captureModifiers();
      }
      if (modifierDragTimeout) clearTimeout(modifierDragTimeout);

      modifierDragTimeout = setTimeout(() => {
        handleModifierDragEnd(historyLabel);
      }, 400);

      const selectedIds = props.fixtures.map(f => f.id);
      const safeEff = getSafeEffectToMutate(effect, selectedIds);
      Object.assign(safeEff, updates);
      emit('change');
    } else {
      const before = captureModifiers();
      const selectedIds = props.fixtures.map(f => f.id);
      const safeEff = getSafeEffectToMutate(effect, selectedIds);
      Object.assign(safeEff, updates);
      emit('change');
      if (before) commitModifiers(before, historyLabel);
    }
  }

  function toggleTargetChannel(effect: Effect, type: ChannelType) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    const selectedIds = props.fixtures.map(f => f.id);

    // Prevent deselecting the last channel to avoid orphan effects
    if (effect.targetChannels?.includes(type) && effect.targetChannels.length <= 1) {
      return;
    }

    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const safeEff = getSafeEffectToMutate(effect, selectedIds);

    const idx = safeEff.targetChannels.indexOf(type);
    if (idx >= 0) {
      safeEff.targetChannels.splice(idx, 1);
    } else {
      safeEff.targetChannels.push(type);
    }
    emit('change');
    commitModifiers(before, 'Toggle Modifier Channel');
  }

  function removeModifier(effect: Effect) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const selectedIds = props.fixtures.map(f => f.id);

    if (effectEngine.activeModifier.value === effect) {
      effectEngine.activeModifier.value = null;
    }

    const eff = resolveStaleEffect(effect, selectedIds);

    if (eff.targetFixtureIds) {
      eff.targetFixtureIds = eff.targetFixtureIds.filter(id => !selectedIds.includes(id));

      if (eff.targetFixtureIds.length === 0) {
        const idx = effectEngine.effects.indexOf(eff);
        if (idx >= 0) effectEngine.effects.splice(idx, 1);
      }
    } else {
      const idx = effectEngine.effects.indexOf(eff);
      if (idx >= 0) effectEngine.effects.splice(idx, 1);
    }
    emit('change');
    commitModifiers(before, 'Remove Modifier');
  }

  function selectModifier(effect: Effect | null) {
    if (effectEngine) {
      effectEngine.activeModifier.value = effect;
    }
  }

  function addSequencerModifier() {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const effect = new SequencerEffect();
    effect.targetChannels = [...availableChannelTypes.value];
    effect.targetFixtureIds = props.fixtures.map(f => f.id);
    effect.strength = 100;
    const avgX = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.x, 0) / props.fixtures.length
      : 0.5;
    const avgY = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.y, 0) / props.fixtures.length
      : 0.5;
    // Default angle π/2 gives a vertical split axis — sensible default for horizontal fixture rows
    effect.sequencerParams = { ...effect.sequencerParams, originX: avgX, originY: avgY, angle: Math.PI / 2 };
    effectEngine.addEffect(effect);
    effectEngine.activeModifier.value = (effectEngine.effects[effectEngine.effects.length - 1] ?? effect) as Effect;
    emit('change');
    commitModifiers(before, 'Add Sequencer Modifier');
  }

  function addPinnedModifier(snapshot: PresetModifierSnapshot) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const pinnedStore = usePinnedModifiersStore();
    const effect = pinnedStore.applyPinnedModifier(snapshot);
    if (!effect) return;
    effect.targetChannels = [...availableChannelTypes.value];
    effect.targetFixtureIds = props.fixtures.map(f => f.id);
    effectEngine.addEffect(effect);
    effectEngine.activeModifier.value = (effectEngine.effects[effectEngine.effects.length - 1] ?? effect) as Effect;
    emit('change');
    commitModifiers(before, 'Add Pinned Modifier');
  }

  function switchModifierType(effect: Effect, type: 'Waveform' | 'Noise' | 'Sequencer') {
    const before = captureModifiers();
    if (!effectEngine || !before) return;

    const current = effect instanceof SequencerEffect ? 'Sequencer' : effect instanceof NoiseEffect ? 'Noise' : 'Waveform';
    if (type === current) return;

    const targetChannels = [...(effect.targetChannels || [])];
    const targetFixtureIds = effect.targetFixtureIds ? [...effect.targetFixtureIds] : undefined;
    const strength = effect.strength ?? 100;
    const speed = (effect as any).speed ? { ...(effect as any).speed } : { mode: 'time' as const, timeMs: 500, beatValue: 1, beatOffset: 0 };

    const avgX = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.x, 0) / props.fixtures.length
      : 0.5;
    const avgY = props.fixtures.length > 0
      ? props.fixtures.reduce((sum, f) => sum + f.fixturePosition.y, 0) / props.fixtures.length
      : 0.5;

    let replacement: Effect;
    if (type === 'Noise') {
      const n = new NoiseEffect();
      n.targetChannels = targetChannels;
      n.targetFixtureIds = targetFixtureIds;
      n.strength = strength;
      n.speed = speed;
      replacement = n as unknown as Effect;
    } else if (type === 'Sequencer') {
      const s = new SequencerEffect();
      s.targetChannels = targetChannels;
      s.targetFixtureIds = targetFixtureIds;
      s.strength = strength;
      s.sequencerParams = { ...s.sequencerParams, originX: avgX, originY: avgY, angle: Math.PI / 2 };
      replacement = s as unknown as Effect;
    } else {
      const w = new WaveformEffect();
      w.targetChannels = targetChannels;
      w.targetFixtureIds = targetFixtureIds;
      w.strength = strength;
      w.speed = speed;
      w.fanning = 0.1;
      w.direction = 'LINEAR';
      w.originX = avgX;
      w.originY = avgY;
      w.angle = 0;
      w.reverse = false;
      replacement = w as unknown as Effect;
    }

    const idx = effectEngine.effects.indexOf(effect);
    if (idx >= 0) {
      effectEngine.effects.splice(idx, 1, replacement);
    } else {
      effectEngine.addEffect(replacement);
    }
    effectEngine.activeModifier.value = replacement;
    emit('change');
    commitModifiers(before, `Switch Modifier to ${type}`);
  }

  function reverseDirection(effect: Effect) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    const selectedIds = props.fixtures.map(f => f.id);
    const safeEff = getSafeEffectToMutate(effect, selectedIds);
    // Toggle the new reverse property
    safeEff.reverse = !safeEff.reverse;
    emit('change');
    commitModifiers(before, 'Reverse Modifier Direction');
  }

  return {
    availableChannelTypes,
    activeModifiers,
    addWaveformModifier,
    addNoiseModifier,
    addSequencerModifier,
    addPinnedModifier,
    switchModifierType,
    handleModifierDragEnd,
    updateModifier,
    updateModifierProperties,
    toggleTargetChannel,
    removeModifier,
    selectModifier,
    reverseDirection
  };
}
