import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { EffectEngine } from '~/utils/engine/engine';
import type { ModifierInstance, ChannelType } from '~/utils/engine/types';
import { BUILTIN_ALIASES, builtinHash, cloneModifier, createModifier } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import { findRichestFixture, syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import { usePinnedModifiersStore } from '~/stores/pinned-modifiers-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
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
  let modifierDragBeforeEffects: ModifierInstance[] | null = null;
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

  function hasMatchingChannel(effect: ModifierInstance) {
    if (!effect.targetChannels) return false;
    return effect.targetChannels.some(type => availableChannelTypes.value.includes(type));
  }

  const activeModifiers = computed(() => {
    if (!effectEngine || !richestFixture.value) return [];
    return effectEngine.modifiers.filter(effect => {
      // Matches the richest fixture
      const matchesFixture = effect.targetFixtureIds?.includes(richestFixture.value!.id);

      // Matches channel category
      const matchesChannels = hasMatchingChannel(effect);

      return matchesFixture && matchesChannels;
    });
  });

  /** Average position of the edited fixtures (default origin). */
  function averagePosition(): { x: number; y: number } {
    const n = props.fixtures.length;
    if (n === 0) return { x: 0.5, y: 0.5 };
    return {
      x: props.fixtures.reduce((sum, f) => sum + f.fixturePosition.x, 0) / n,
      y: props.fixtures.reduce((sum, f) => sum + f.fixturePosition.y, 0) / n,
    };
  }

  /**
   * Host defaults for a new instance of `plugin` on the edited fixtures:
   * targets, blend mode (absolute outputs override instead of add), a
   * gradient handle along the selection, and per-built-in starting values.
   */
  function newInstance(plugin: string, carry?: ModifierInstance): ModifierInstance {
    const manifest = getManifest(plugin);
    const { x, y } = averagePosition();
    const inst = createModifier(plugin, {
      targetChannels: [...(carry?.targetChannels ?? availableChannelTypes.value)],
      targetFixtureIds: carry?.targetFixtureIds ? [...carry.targetFixtureIds] : props.fixtures.map(f => f.id),
      strength: carry?.strength ?? 1,
      speed: carry ? { ...carry.speed } : { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
      blendMode: manifest?.output === 'absolute' ? 'override' : (effectEngine?.stackBlendMode.value ?? 'add'),
      distribution: carry ? carry.distribution : { mode: 'linear', origin: { x, y }, end: { x: x + 0.1, y } },
    });
    if (plugin === builtinHash(BUILTIN_ALIASES.noise)) {
      if (!carry) inst.strength = 0.5;
      inst.speed = carry ? inst.speed : { mode: 'beat', timeMs: 500, beatValue: 1, beatOffset: 0 };
      inst.distribution = { ...inst.distribution, mode: 'none' };
    }
    else if (plugin === builtinHash(BUILTIN_ALIASES.sequencer)) {
      // Vertical split axis through the fixtures — sensible for horizontal rows.
      inst.params = { ...inst.params, origin: { x, y }, angle: Math.PI / 2 };
      inst.distribution = { ...inst.distribution, mode: 'none' };
    }
    else if (plugin === builtinHash(BUILTIN_ALIASES.colorAdjust)) {
      inst.distribution = { ...inst.distribution, mode: 'none' };
    }
    return inst;
  }

  /** Adds a new modifier running `plugin` to the edited fixtures. */
  function addModifier(plugin: string) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const inst = newInstance(plugin);
    effectEngine.addModifier(inst);
    // Select the proxy from the reactive array so Vue tracks property changes.
    effectEngine.activeModifier.value = effectEngine.modifiers[effectEngine.modifiers.length - 1] ?? inst;
    emit('change');
    commitModifiers(before, `Add ${getManifest(plugin)?.name ?? 'Modifier'}`);
  }

  function resolveStaleEffect(effect: ModifierInstance, selectedIds: (string | number)[]): ModifierInstance {
    if (effect.targetFixtureIds && !effect.targetFixtureIds.some(id => selectedIds.includes(id))) {
      const newEff = effectEngine?.modifiers.find(e =>
        e.targetFixtureIds &&
        e.targetFixtureIds.some(id => selectedIds.includes(id)) &&
        e.plugin === effect.plugin
      );
      if (newEff) return newEff;
    }
    return effect;
  }

  function getSafeEffectToMutate(effect: ModifierInstance, selectedIds: (string | number)[]): { eff: ModifierInstance; didSplit: boolean } {
    const eff = resolveStaleEffect(effect, selectedIds);

    if (eff.targetFixtureIds) {
      const unselectedTargets = eff.targetFixtureIds.filter(id => !selectedIds.includes(id));
      if (unselectedTargets.length > 0) {
        // Split — keep unselected fixtures on the original, clone for the edited subset
        eff.targetFixtureIds = unselectedTargets;
        const clone = cloneModifier(eff);
        // New id so remote can distinguish the two effects after modifier.sync
        (clone as any).id = crypto.randomUUID();
        clone.targetFixtureIds = [...selectedIds];
        effectEngine!.addModifier(clone);
        return { eff: clone, didSplit: true };
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
          effectEngine.modifiers.forEach(otherEff => {
            if (otherEff !== eff && otherEff.plugin === eff.plugin) {
              const sameChannels = otherEff.targetChannels && eff.targetChannels &&
                otherEff.targetChannels.length === eff.targetChannels.length &&
                otherEff.targetChannels.every(c => eff.targetChannels!.includes(c));

              if (sameChannels && otherEff.targetFixtureIds) {
                otherEff.targetFixtureIds = otherEff.targetFixtureIds.filter(id => !newlyAddedIds.includes(id));
              }
            }
          });

          // Cleanup orphaned effects
          for (let i = effectEngine.modifiers.length - 1; i >= 0; i--) {
            const o = effectEngine.modifiers[i];
            if (o && o !== eff && o.targetFixtureIds && o.targetFixtureIds.length === 0) {
              effectEngine.modifiers.splice(i, 1);
            }
          }
        }
      }
    }
    return { eff, didSplit: false };
  }

  function dispatchModifierUpdate(eff: ModifierInstance, changes: Record<string, any>, didSplit: boolean) {
    const liveBus = useLiveBusStore();
    if (didSplit && effectEngine) {
      // Structural change — remote must replace their full effects list
      liveBus.dispatch('modifier.sync', { modifiers: JSON.parse(JSON.stringify(effectEngine.modifiers)) });
    } else if ((eff as any).id) {
      liveBus.dispatch('modifier.update', { effectId: (eff as any).id, changes });
    }
  }

  function handleModifierDragEnd(description: string) {
    if (modifierDragBeforeEffects) {
      commitModifiers(modifierDragBeforeEffects, description);
      modifierDragBeforeEffects = null;
    }
  }

  function updateModifier(effect: ModifierInstance, key: string, value: any) {
    if (!effectEngine) return;

    // Is this a continuous value change? If so, debounce the commit
    const isContinuous = key === 'speed' || key === 'strength' || key === 'params';
    const isDirection = key === 'distribution';

    let before: ModifierInstance[] | null = null;

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
    const { eff: safeEff, didSplit } = getSafeEffectToMutate(effect, selectedIds);
    // Guard against NaN from half-typed numbers (e.g. "-" or empty input)
    if (typeof value === 'number' && isNaN(value)) return;
    (safeEff as any)[key] = value;
    emit('change');

    dispatchModifierUpdate(safeEff, { [key]: value }, didSplit);

    if (isDirection && before) {
      commitModifiers(before, 'Change Modifier Distribution');
    }
  }

  function updateModifierProperties(effect: ModifierInstance, updates: Partial<ModifierInstance>, historyLabel: string, isContinuous = false) {
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
      const { eff: safeEff, didSplit } = getSafeEffectToMutate(effect, selectedIds);
      Object.assign(safeEff, updates);
      emit('change');
      dispatchModifierUpdate(safeEff, updates as Record<string, any>, didSplit);
    } else {
      const before = captureModifiers();
      const selectedIds = props.fixtures.map(f => f.id);
      const { eff: safeEff, didSplit } = getSafeEffectToMutate(effect, selectedIds);
      Object.assign(safeEff, updates);
      emit('change');
      dispatchModifierUpdate(safeEff, updates as Record<string, any>, didSplit);
      if (before) commitModifiers(before, historyLabel);
    }
  }

  function toggleTargetChannel(effect: ModifierInstance, type: ChannelType) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    const selectedIds = props.fixtures.map(f => f.id);

    // Prevent deselecting the last channel to avoid orphan effects
    if (effect.targetChannels?.includes(type) && effect.targetChannels.length <= 1) {
      return;
    }

    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const { eff: safeEff, didSplit } = getSafeEffectToMutate(effect, selectedIds);

    const idx = safeEff.targetChannels.indexOf(type);
    if (idx >= 0) {
      safeEff.targetChannels.splice(idx, 1);
    } else {
      safeEff.targetChannels.push(type);
    }
    emit('change');
    dispatchModifierUpdate(safeEff, { targetChannels: [...safeEff.targetChannels] }, didSplit);
    commitModifiers(before, 'Toggle Modifier Channel');
  }

  function removeModifier(effect: ModifierInstance) {
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
        const idx = effectEngine.modifiers.indexOf(eff);
        if (idx >= 0) effectEngine.modifiers.splice(idx, 1);
      }
    } else {
      const idx = effectEngine.modifiers.indexOf(eff);
      if (idx >= 0) effectEngine.modifiers.splice(idx, 1);
    }
    emit('change');
    commitModifiers(before, 'Remove Modifier');
  }

  function selectModifier(effect: ModifierInstance | null) {
    if (effectEngine) {
      effectEngine.activeModifier.value = effect;
    }
  }

  /** Adds a pinned modifier snapshot to the edited fixtures (new id, current targets). */
  function addPinnedModifier(snapshot: ModifierInstance) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'modifiers');
    const pinnedStore = usePinnedModifiersStore();
    const inst = pinnedStore.applyPinnedModifier(snapshot);
    if (!inst) return;
    inst.targetChannels = [...availableChannelTypes.value];
    inst.targetFixtureIds = props.fixtures.map(f => f.id);
    effectEngine.addModifier(inst);
    effectEngine.activeModifier.value = effectEngine.modifiers[effectEngine.modifiers.length - 1] ?? inst;
    emit('change');
    commitModifiers(before, 'Add Pinned Modifier');
  }

  /** Switches a modifier to another plugin, keeping targets, strength and speed. */
  function switchModifierType(effect: ModifierInstance, plugin: string) {
    const before = captureModifiers();
    if (!effectEngine || !before || effect.plugin === plugin) return;
    const replacement = newInstance(plugin, effect);
    const idx = effectEngine.modifiers.indexOf(effect);
    if (idx >= 0) effectEngine.modifiers.splice(idx, 1, replacement);
    else effectEngine.addModifier(replacement);
    effectEngine.activeModifier.value = replacement;
    emit('change');
    commitModifiers(before, `Switch Modifier to ${getManifest(plugin)?.name ?? 'Modifier'}`);
  }

  function reverseDirection(effect: ModifierInstance) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    const selectedIds = props.fixtures.map(f => f.id);
    const { eff: safeEff, didSplit } = getSafeEffectToMutate(effect, selectedIds);
    safeEff.distribution = { ...safeEff.distribution, reverse: !safeEff.distribution.reverse };
    emit('change');
    dispatchModifierUpdate(safeEff, { distribution: safeEff.distribution }, didSplit);
    commitModifiers(before, 'Reverse Modifier Direction');
  }

  function reorderModifiers(fromIndex: number, toIndex: number) {
    const before = captureModifiers();
    if (!effectEngine || !before) return;
    // `activeModifiers` is a filtered view; we need to move within the full effects array
    const allEffects = effectEngine.modifiers;
    const fromEffect = activeModifiers.value[fromIndex];
    const toEffect = activeModifiers.value[toIndex];
    if (!fromEffect || !toEffect) return;
    const fromGlobal = allEffects.indexOf(fromEffect as ModifierInstance);
    const toGlobal = allEffects.indexOf(toEffect as ModifierInstance);
    if (fromGlobal < 0 || toGlobal < 0) return;
    const [moved] = allEffects.splice(fromGlobal, 1);
    allEffects.splice(toGlobal, 0, moved!);
    emit('change');
    commitModifiers(before, 'Reorder Modifiers');
  }

  return {
    availableChannelTypes,
    activeModifiers,
    addModifier,
    addPinnedModifier,
    switchModifierType,
    handleModifierDragEnd,
    updateModifier,
    updateModifierProperties,
    toggleTargetChannel,
    removeModifier,
    selectModifier,
    reverseDirection,
    reorderModifiers,
  };
}
